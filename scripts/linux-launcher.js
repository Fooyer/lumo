// electron-builder "afterPack" hook (Linux only): renames the packaged executable to "lumo.bin" and puts a
// small launcher in its place that starts it with --no-sandbox --in-process-gpu.
//
// Chromium can't set up its process sandbox or launch its GPU process on some Linux setups (Bazzite/Fedora
// Atomic, for one): chrome-sandbox from an AppImage isn't setuid-root, and the app aborts at startup. Those
// switches must be on the command line — the main process is too late — and an AppImage has no other place
// to carry them. Same flags as scripts/electron-vite.js uses in development.
const fs = require('fs')
const path = require('path')

exports.default = async function linuxLauncher(context) {
  if (context.electronPlatformName !== 'linux') return
  const exe = context.packager.executableName
  const dir = context.appOutDir
  fs.renameSync(path.join(dir, exe), path.join(dir, `${exe}.bin`))
  const launcher = `#!/bin/sh
# Resolve symlinks so it works when started through one (AppImage, /usr/bin link, ...).
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/${exe}.bin" --no-sandbox --in-process-gpu "$@"
`
  fs.writeFileSync(path.join(dir, exe), launcher, { mode: 0o755 })
}
