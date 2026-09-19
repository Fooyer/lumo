// Builds Lumo and publishes it as a GitHub Release (electron-updater then offers it to installed copies).
//
//   npm run release              build + publish the version in package.json
//   npm run release -- --overwrite   replace the files of a release that already exists (use with care)
//
// The token comes from GH_TOKEN in the environment or in a git-ignored ".env" file at the project root;
// failing that, from the GitHub CLI login (`gh auth login`).
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const pkg = require('../package.json')
const OWNER_REPO = 'Fooyer/lumo'
const overwrite = process.argv.includes('--overwrite')

function fail(message) {
  console.error(`\n✖ ${message}\n`)
  process.exit(1)
}

/** Reads KEY=VALUE lines from .env without overriding what is already set in the environment. */
function loadDotEnv() {
  const file = path.join(root, '.env')
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!m || m[1].startsWith('#')) continue
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2')
    if (value && process.env[m[1]] === undefined) process.env[m[1]] = value
  }
}

function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, { cwd: root, encoding: 'utf-8', shell: process.platform === 'win32', ...options })
}

function tokenFromGhCli() {
  for (const gh of ['gh', 'C:\Program Files\GitHub CLI\gh.exe']) {
    const r = run(gh.includes(' ') ? `"${gh}"` : gh, ['auth', 'token'])
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim()
  }
  return ''
}

loadDotEnv()
if (!process.env.GH_TOKEN) process.env.GH_TOKEN = tokenFromGhCli()
if (!process.env.GH_TOKEN) {
  fail('Sem token do GitHub. Coloque GH_TOKEN=... no arquivo .env (veja .env.example) ou faça `gh auth login`.')
}

// The release's tag is created on GitHub's main branch, so what's released must be what's pushed.
if (run('git', ['status', '--porcelain']).stdout.trim()) {
  fail('Há alterações sem commit. Faça commit e push antes de publicar o release.')
}
run('git', ['fetch', 'origin', 'main', '--quiet'])
const unpushed = run('git', ['rev-list', '--count', 'origin/main..HEAD']).stdout.trim()
if (unpushed !== '0') fail(`Há ${unpushed} commit(s) local(is) sem push. Rode "git push" antes de publicar.`)

const tag = `v${pkg.version}`
;(async () => {
  const headers = { Authorization: `Bearer ${process.env.GH_TOKEN}`, 'User-Agent': 'lumo-release' }
  const res = await fetch(`https://api.github.com/repos/${OWNER_REPO}/releases/tags/${tag}`, { headers })
  if (res.status === 401) fail('O GitHub recusou o token (inválido ou expirado).')
  if (res.status === 200 && !overwrite) {
    fail(`O release ${tag} já existe. Aumente "version" no package.json (ou use --overwrite para trocar os arquivos).`)
  }

  console.log(`\n▶ Publicando o Lumo ${tag} em ${OWNER_REPO}\n`)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  for (const [cmd, args] of [
    ['npm', ['run', 'build']],
    ['npx', ['electron-builder', '--win', '--publish', 'always']]
  ]) {
    const r = spawnSync(cmd, args, { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' })
    if (r.status !== 0) fail(`"${cmd} ${args.join(' ')}" falhou.`)
  }
  console.log(`\n✔ Release publicado: https://github.com/${OWNER_REPO}/releases/tag/${tag}\n`)
})().catch((e) => fail(e.message))
