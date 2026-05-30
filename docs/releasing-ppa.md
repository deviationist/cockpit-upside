# Releasing to a Launchpad PPA (Ubuntu apt install)

This is how UPSide is published so Ubuntu users can install and auto-update it
with apt:

```sh
sudo add-apt-repository ppa:deviationist/cockpit-upside
sudo apt update
sudo apt install cockpit-upside
```

The package is `Architecture: all` (a pre-built static web bundle that installs
to `/usr/share/cockpit/upside`), so a single upload serves every architecture.

> **Why we ship the pre-built bundle.** Launchpad builds in a network-isolated
> environment, but our build fetches Cockpit's `pkg/lib` over git and runs
> `npm install`. Rather than vendor all of that, the source package ships the
> already-built `dist/` and `debian/rules` just installs it (no rebuild). This
> is normal for a personal PPA. The "build from source on Launchpad" route
> would need `pkg/lib` + `node_modules` vendored into the source — not worth it
> here.

---

## One-time setup (Launchpad side — only you can do this)

1. **Launchpad account:** create/sign in at <https://launchpad.net>, and sign
   the Ubuntu Code of Conduct (Launchpad → your profile → "Sign the Ubuntu Code
   of Conduct"). Source uploads are rejected until this is done.

2. **GPG key** that matches the maintainer in `debian/changelog`
   (`Robert Sæther <robert4832@pm.me>` — keep these identical or Launchpad
   rejects the signature):

   ```sh
   gpg --full-generate-key          # RSA 4096, real name + robert4832@pm.me
   gpg --list-secret-keys --keyid-format=long      # note the key id
   # publish it where Launchpad can find it:
   gpg --keyserver keyserver.ubuntu.com --send-keys <KEYID>
   ```

   Then in Launchpad → profile → "OpenPGP keys", paste the fingerprint and
   confirm the encrypted email it sends you.

3. **Create the PPA:** Launchpad → your profile → "Create a new PPA", name it
   `cockpit-upside` (→ `ppa:deviationist/cockpit-upside`).

4. **dput target** — add to `~/.dput.cf` (or rely on the built-in `ppa:` alias
   in modern `dput`):

   ```ini
   [cockpit-upside-ppa]
   fqdn = ppa.launchpad.net
   method = ftp
   incoming = ~deviationist/cockpit-upside/ubuntu/
   login = anonymous
   allow_unsigned_uploads = 0
   ```

## One-time setup (this machine — build toolchain)

```sh
sudo apt install devscripts debhelper dput-ng
# devscripts → debuild/dch; debhelper → dh; dput-ng → dput
```

---

## Per release

The helper `packaging/ppa-release.sh` automates the build; you control the
upload. It is **safe by default** — it builds a signed source package and does
**not** upload unless you pass `--upload`.

1. **Bump the changelog** and **tag** to match (the script refuses to proceed if
   `debian/changelog` and `make print-version` disagree):

   ```sh
   dch -v 0.1.0          # or edit debian/changelog; pick the target series
   git tag 0.1.0
   ```

2. **Build** (and optionally check / upload):

   ```sh
   make deb                              # signed source package in deb-build/
   packaging/ppa-release.sh --check      # also build a local .deb + run lintian
   packaging/ppa-release.sh --no-sign    # build unsigned (before you have a GPG key)
   make deb-upload                       # build signed source package AND dput it
   ```

   Sanity-check the local binary before uploading (what `--check` does):

   ```sh
   sudo apt install ./deb-build/cockpit-upside_0.1.0_all.deb   # then reload Cockpit
   ```

3. `make deb-upload` (or `ppa-release.sh --upload`) runs
   `dput ppa:deviationist/cockpit-upside …`. Launchpad emails you when the build
   finishes (a few minutes); after that `add-apt-repository` +
   `apt install cockpit-upside` works for users.

**What the script does** (run by hand if you prefer): `make dist` →
extract the clean tarball (built `dist/`, no `node_modules`) → `debuild -S -sa`
in the extraction → `dput` the `…_source.changes`. Artifacts land in
`deb-build/`.

## Multiple Ubuntu series

A PPA build targets one series per source upload. To cover, say, 22.04/24.04/
24.10, upload the same source three times with series-suffixed versions so each
is unique and lands in the right series, e.g. `0.1.0~ubuntu24.04.1` /
`~ubuntu22.04.1`. The `backportpackage` tool automates this:

```sh
backportpackage -u ppa:deviationist/cockpit-upside -s noble -d jammy \
    ../cockpit-upside_0.1.0.dsc
```

## Notes

- Keep `debian/changelog` maintainer == your Launchpad GPG identity.
- The source upload includes some build scaffolding (`pkg/`, `tools/`) that the
  binary doesn't use; harmless, just slightly larger. Trim later with
  `debian/source/options` `tar-ignore` if desired.
- This complements, not replaces, `make install` / `sudo make install` for
  non-Ubuntu hosts (see the README) and the RPM/Arch packaging under
  `packaging/`.
