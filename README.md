# electron-template

The middle layer of three templates, each a starting point *and* a package the projects
made from it depend on:

| Template | For | Builds on |
|---|---|---|
| development-template | any software project | — |
| **electron-template** | apps and plugins on Electron | development-template |
| obsidian-plugin-template | Obsidian plugins | electron-template |

Tooling comes from Lure (an Obsidian plugin) and moves here layer by layer.

Status: 0.1.0 (phase 3 of 8 begun). Licence: AGPL-3.0 (see `LICENSE`).

## In here so far

- `bin/electron-distro-deps.sh` — what Electron needs on a bare Debian/Ubuntu, Fedora,
  Arch, openSUSE or Alpine image: a virtual display, Electron's libraries (with
  fallbacks for the `t64` renames in newer Debian/Ubuntu), a font and `fc-cache`.
  Containers run as root; slim images lack curl and fonts.

## Coming

- CDP session and helpers; run scripts (start an app with `--remote-debugging-port`,
  Xvfb/Wayland, slowness factor).
- Reusable workflows for distro containers, Flatpak (full and restricted), Snap, Wine
  (Windows Node driving the suites), FreeBSD, Alpine, Nix, Wayland, limits, emulation,
  and data outside the home folder (SMB, NFS, another drive, UNC).
- The next-Electron canary; a local container runner for private runs.
