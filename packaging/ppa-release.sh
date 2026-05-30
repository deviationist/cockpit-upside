#!/usr/bin/env bash
#
# Build (and optionally upload) the Debian source package for the UPSide
# Launchpad PPA. Full background + one-time setup: docs/releasing-ppa.md.
#
# Default is SAFE: it builds a signed source package only and does NOT upload.
# Pass --upload to dput it to the PPA (you control the publish moment).
#
#   packaging/ppa-release.sh              # build signed source package
#   packaging/ppa-release.sh --no-sign    # build unsigned (before you have a GPG key)
#   packaging/ppa-release.sh --check      # also build a local binary .deb + lintian
#   packaging/ppa-release.sh --upload     # build signed source package AND dput it
#
# Env: PPA overrides the dput target (default ppa:deviationist/cockpit-upside).

set -euo pipefail

PPA="${PPA:-ppa:deviationist/cockpit-upside}"
PKG="cockpit-upside"

upload=0 check=0 sign=1
for arg in "$@"; do
    case "$arg" in
        --upload)  upload=1 ;;
        --check)   check=1 ;;
        --no-sign) sign=0 ;;
        -h|--help) sed -n '3,14p' "$0"; exit 0 ;;
        *) echo "unknown option: $arg" >&2; exit 2 ;;
    esac
done

cd "$(dirname "$0")/.."          # repo root
ROOT="$PWD"
OUT="$ROOT/deb-build"

die() { echo "error: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing tool '$1' — see docs/releasing-ppa.md (sudo apt install devscripts debhelper dput-ng)"; }

# --- preflight ---------------------------------------------------------------
need make; need git; need debuild; need dpkg-parsechangelog
[ "$upload" = 1 ] && need dput
[ "$check"  = 1 ] && { need dpkg-buildpackage; need lintian; }

VERSION="$(dpkg-parsechangelog -l debian/changelog -S Version)"
MAKEVER="$(make -s print-version)"
[ "$VERSION" = "$MAKEVER" ] || die "version mismatch: debian/changelog is '$VERSION' but 'make print-version' is '$MAKEVER'.
  Tag the release to match the changelog, e.g.:  git tag $VERSION"

if [ "$sign" = 1 ] && ! gpg --list-secret-keys >/dev/null 2>&1; then
    die "no GPG secret key found, but a signed build was requested.
  Set one up (docs/releasing-ppa.md) or run with --no-sign to build unsigned."
fi

echo ">> building $PKG $VERSION (sign=$sign upload=$upload check=$check)"

# --- clean source tree via 'make dist' --------------------------------------
# make dist produces a tarball with the built dist/ and no node_modules; we
# build the package from a clean extraction of it, not the working tree.
make dist
TARBALL="$ROOT/$PKG-$VERSION.tar.xz"
[ -f "$TARBALL" ] || die "expected $TARBALL from 'make dist' but it's not there"

rm -rf "$OUT"; mkdir -p "$OUT"
tar -C "$OUT" -xf "$TARBALL"
cd "$OUT/$PKG"

# --- build -------------------------------------------------------------------
SIGNFLAGS=""
[ "$sign" = 0 ] && SIGNFLAGS="-us -uc"
# shellcheck disable=SC2086
debuild -S -sa $SIGNFLAGS

if [ "$check" = 1 ]; then
    echo ">> local binary build + lintian"
    dpkg-buildpackage -b -us -uc
    lintian ../"$PKG"_*_all.deb || true
fi

CHANGES="$OUT/${PKG}_${VERSION}_source.changes"
echo ">> artifacts in $OUT/"
ls -1 "$OUT" | sed 's/^/   /'

if [ "$upload" = 1 ]; then
    [ "$sign" = 1 ] || die "refusing to upload an unsigned package (drop --no-sign)"
    echo ">> dput $PPA $CHANGES"
    dput "$PPA" "$CHANGES"
    echo ">> uploaded. Launchpad will email you when the build finishes."
else
    echo ">> not uploaded (re-run with --upload to push to $PPA)"
    echo "   manual: dput $PPA $CHANGES"
fi
