// Runs electron-vite (dev / preview) and, on Linux, starts Electron with --no-sandbox --in-process-gpu.
//
//   node scripts/electron-vite.js dev
//   node scripts/electron-vite.js preview
//
// On Linux (Bazzite/Fedora Atomic included) Chromium's zygote aborts at startup ("zygote_host_impl_linux.cc:
// Invalid argument") because its process sandbox can't be set up: chrome-sandbox from node_modules isn't
// setuid-root and the user-namespace fallback fails too. Likewise the separate GPU process can't be launched
// ("gpu_process_host.cc: GPU process launch failed: error_code=1002", then "GPU process isn't usable"), so the
// GPU runs inside the browser process instead. --disable-gpu also opens the app but loses acceleration.
// The flags have to be on Electron's command line — appending them from the main process is too late for
// the sandbox. Windows and macOS are left untouched.
const { spawnSync } = require('child_process')
const path = require('path')

const bin = path.join(__dirname, '..', 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
const args = [bin, ...process.argv.slice(2)]
if (process.platform === 'linux') args.push('--', '--no-sandbox', '--in-process-gpu')

// A shell that has ELECTRON_RUN_AS_NODE set would make Electron start as plain Node and fail on `app`.
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const result = spawnSync(process.execPath, args, { stdio: 'inherit', env })
process.exitCode = result.status ?? 1
