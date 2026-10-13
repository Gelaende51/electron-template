# electron-template

The middle layer of three templates, each a starting point *and* a package the projects
made from it depend on:

| Template | For | Builds on |
|---|---|---|
| development-template | any software project | — |
| **electron-template** | apps and plugins on Electron | development-template |
| obsidian-plugin-template | Obsidian plugins | electron-template |

Tooling comes from Lure (an Obsidian plugin) and moves here layer by layer.

Status: 0.13.0 (phase 3 of 8). A project lists each layer it uses as its own devDependency by exact tag (`…/tar.gz/refs/tags/v0.13.0`): npm 12 fetches URL dependencies only for the project itself (`allow-remote=root` in `.npmrc`), so the layers do not depend on each other through npm. Licence: AGPL-3.0 (see `LICENSE`).

## In here so far

- `bin/electron-distro-deps.sh` — what Electron needs on a bare Debian/Ubuntu, Fedora,
  Arch, openSUSE or Alpine image: a virtual display, Electron's libraries (with
  fallbacks for the `t64` renames in newer Debian/Ubuntu), a font and `fc-cache`.
  Containers run as root; slim images lack curl and fonts.

- `lib/cdp-session.mjs` — one CDP session with the app's window: `connect({ pickTarget, check })`,
  `evaluate` (awaits the page's promises, deadline, stuck-page stack sample), real key
  presses (`pressKey(page, "ctrl+shift+F2")`, macOS Cmd/Alt mapping and editing
  commands), `PAUSE(ms)` and `SLOW` (a slowness factor for emulated or capped machines),
  `parkPointer`, `isPainting` (a window that stopped compositing reports nonsense
  geometry), `asPosix`, `decodeTitle`. Env: `CDP_PORT`, `WINDOW`, `SLOW`.

- `bin/electron-suites.sh` (`electron-suites`) — every suite × every app version through
  the project's `RUN_SUITE`, under Xvfb where there is no display, reported as Actions
  reads it (exit 2 = skipped cases, a warning) with the app log's tail on failure.

- `.github/workflows/distros.yml` — reusable: the suites in distribution containers (one job
  per image, as root, Xvfb), with everything the slim images lack; `images`, `suites`,
  `versions`, `run`, `build`, `suite-env` as inputs.

- `.github/workflows/flatpak.yml` — reusable: the app from Flathub, suites in full and in
  restricted access (one folder only; `EXPECT_SANDBOX=1`), the run command handed over in
  the variable the project's run script reads.

- `.github/workflows/wine.yml` — reusable: the app's Windows build (electron-builder NSIS,
  unpacked) under WineHQ staging, the suites run by Windows' Node under Wine, the Chromium
  flags Wine needs, esbuild's Windows binary when the project uses esbuild.

- `.github/workflows/snap.yml` — reusable: the app from the Snap store, the suites against it.

- `.github/workflows/wayland.yml` — reusable: headless Weston, Chromium's Ozone/Wayland flags.

- `.github/workflows/nix.yml` — reusable: the app from nixpkgs (unfree allowed).
- `.github/workflows/limits.yml` — reusable: 1.5 GB and half a CPU (`SLOW=3`), a 1024x600
  screen, HiDPI scale 2, no GPU.

- `.github/workflows/platform.yml` — reusable: one runner (Linux on Arm, Windows on Arm,
  macOS…), optionally x64 Node for emulation, a slowness factor, a `probe` flag for targets
  that may fail without failing the run.

- `.github/workflows/data-elsewhere.yml` — reusable: the app's data outside home, on SMB
  and NFS shares served on the runner, NFS on macOS, a second drive, a UNC path; the folder
  handed over in the variable the run script reads; `places` picks which.

- `.github/workflows/windows-vm.yml` — reusable: the suites in a Windows guest (Server 2019
  and others GitHub has no runner for) over KVM, driven by the project's guest scripts
  through a shared folder.

- `.github/workflows/distro-package.yml` — reusable: the app from a distribution's own
  package on the system's Electron, in that distribution's container.

## Coming

- Run scripts (start an app with `--remote-debugging-port`,
  Xvfb/Wayland, slowness factor).
- Reusable workflows for Wine
  FreeBSD, Alpine, Nix.
- The next-Electron canary; a local container runner for private runs.
