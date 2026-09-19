// electron-builder "afterSign" hook: signs the packaged castLabs Electron build with the EVS service
// (VMP), which Widevine license servers require. Runs after packaging (and Windows code signing) so
// nothing modifies the executable afterwards. Needs `pip install castlabs-evs` and an EVS account
// logged in on this machine. Set SKIP_VMP_SIGN=1 to build without it (DRM sites will then refuse to play).
const { spawnSync } = require('child_process')

exports.default = async function vmpSign(context) {
  if (process.env.SKIP_VMP_SIGN === '1') {
    console.warn('  • SKIP_VMP_SIGN=1: skipping VMP signing — DRM playback will not work in this build')
    return
  }
  console.log(`  • VMP-signing ${context.appOutDir}`)
  const result = spawnSync('python', ['-m', 'castlabs_evs.vmp', 'sign-pkg', context.appOutDir], { stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error('VMP signing failed. Log in to EVS (python -m castlabs_evs.account ...) or set SKIP_VMP_SIGN=1.')
  }
}
