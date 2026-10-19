const fs = require('node:fs/promises')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { createHash } = require('node:crypto')
const { electron, createManifest } = require('./profile.cjs')

const root = path.resolve(__dirname, '../..')
const workspace = path.join(root, 'build/win7/workspace')
const artifacts = path.join(root, 'build/win7/artifacts')
const lockFile = path.join(__dirname, 'package-lock.json')
const sourceDirectories = ['src', 'build-config', 'resources', 'licenses', 'tests', 'plugins']
const sourceFiles = ['package.json', 'tsconfig.json', 'jsconfig.json', 'postcss.config.js', '.eslintrc.cjs', '.eslintrc.base.cjs', 'LICENSE', 'README.md', 'CHANGELOG.md']
const env = { ...process.env, BUILD_WIN7: 'true', NODE_ENV: 'production', NODE_OPTIONS: '--max-old-space-size=8192', LX_WIN7_OUTPUT: artifacts }
delete env.ELECTRON_RUN_AS_NODE
// Installation must include the build tools even when the caller is in production mode.
delete env.npm_config_production

const run = (args, cwd = workspace, extraEnv = {}) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { cwd, env: { ...env, ...extraEnv }, stdio: 'inherit', windowsHide: true })
  child.once('error', reject)
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${path.basename(args[0])} exited with code ${code}`)))
})
const npm = args => {
  const cli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
  return run([cli, ...args])
}

const insideWorkspace = filename => {
  const resolved = path.resolve(filename)
  if (!resolved.startsWith(workspace + path.sep)) throw new Error('Path is outside the Win7 workspace: ' + filename)
  return resolved
}
const sourceFingerprint = async() => {
  const hash = createHash('sha256')
  const walk = async(filename, relative) => {
    const stat = await fs.lstat(filename)
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(filename)).sort()) {
        if (!['node_modules', '.git', 'dist', 'build', 'logs'].includes(name)) await walk(path.join(filename, name), relative + '/' + name)
      }
    } else if (stat.isFile()) hash.update(relative).update(await fs.readFile(filename))
  }
  for (const name of [...sourceDirectories.filter(name => !['tests', 'plugins'].includes(name)), ...sourceFiles, 'package-lock.json']) await walk(path.join(root, name), name)
  return hash.digest('hex')
}
const copySources = async() => {
  if (require(path.join(root, 'package.json')).lxBuildTarget === 'win7') throw new Error('Run Win7 commands from the original source checkout')
  const sourceHash = await sourceFingerprint()
  await fs.mkdir(workspace, { recursive: true })
  for (const name of sourceDirectories) {
    const destination = insideWorkspace(path.join(workspace, name))
    await fs.rm(destination, { recursive: true, force: true })
    await fs.cp(path.join(root, name), destination, {
      recursive: true,
      filter: filename => !['node_modules', '.git', 'dist', 'build', 'logs'].includes(path.basename(filename)),
    })
  }
  for (const name of sourceFiles) await fs.copyFile(path.join(root, name), path.join(workspace, name))
  const manifest = createManifest(require(path.join(root, 'package.json')), require(path.join(root, 'package-lock.json')))
  await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  const tsconfig = await fs.readFile(path.join(workspace, 'tsconfig.json'), 'utf8')
  await fs.writeFile(path.join(workspace, 'tsconfig.json'), tsconfig.replace('"target": "ESNext"', '"target": "ES2022"'))
  if (sourceHash !== await sourceFingerprint()) throw new Error('Source changed while preparing Win7; retry the build')
  await fs.writeFile(path.join(workspace, '.source.sha256'), sourceHash)
  return manifest
}

const prepare = async(refreshLock = false) => {
  await copySources()
  if (refreshLock) {
    await fs.copyFile(path.join(root, 'package-lock.json'), path.join(workspace, 'package-lock.json'))
    await npm(['install', '--package-lock-only', '--ignore-scripts', '--include=dev', '--no-audit', '--no-fund'])
    await fs.copyFile(path.join(workspace, 'package-lock.json'), lockFile)
    return
  }
  await fs.copyFile(lockFile, path.join(workspace, 'package-lock.json'))
  const signature = createHash('sha256').update(await fs.readFile(lockFile)).update(await fs.readFile(path.join(workspace, 'package.json'))).digest('hex')
  const marker = path.join(workspace, '.installed.sha256')
  const installed = await fs.readFile(marker, 'utf8').catch(() => '')
  if (installed !== signature) {
    await npm(['ci', '--ignore-scripts', '--include=dev', '--no-audit', '--no-fund'])
    await run(['node_modules/electron/install.js'])
    await fs.writeFile(marker, signature)
  }
  const actual = JSON.parse(await fs.readFile(path.join(workspace, 'node_modules/electron/package.json'), 'utf8')).version
  if (actual !== electron) throw new Error(`Win7 requires Electron ${electron}, found ${actual}`)
  // Packaging x86 changes the staged native bindings; restore both before tests/builds.
  await run(['node_modules/electron-builder/cli.js', 'install-app-deps', '--arch', 'x64'])
  await fs.mkdir(path.join(workspace, 'build/Release'), { recursive: true })
  await fs.copyFile(path.join(root, 'build-config/lib/qrc_decode_electron-v110-win32-x64.node'), path.join(workspace, 'build/Release/qrc_decode.node'))
  await run(['build-config/dependencies-patch.js'])
}

const build = async() => {
  // Keep each compiler in its own process to bound memory use.
  await fs.rm(insideWorkspace(path.join(workspace, 'dist')), { recursive: true, force: true })
  for (const target of ['main', 'renderer', 'renderer-lyric', 'renderer-scripts', 'musicfree']) {
    await run(['build-config/win7/compile.cjs', target])
  }
  const compilerPackages = require('./audit.cjs').auditPackages([path.join(workspace, 'dist/plugin-compiler/node_modules')])
  const sourceHash = await fs.readFile(path.join(workspace, '.source.sha256'), 'utf8')
  if (sourceHash !== await sourceFingerprint()) throw new Error('Source changed during the Win7 build; build again before packaging')
  await fs.writeFile(path.join(workspace, 'dist/win7-build.json'), JSON.stringify({ electron, node: '16.17.1', target: 'win7', version: require(path.join(root, 'package.json')).version, sourceHash, compilerPackages }, null, 2))
}

const main = async() => {
  const [command = 'build', ...args] = process.argv.slice(2)
  if (process.platform !== 'win32') throw new Error('Build the Win7 edition on Windows 10/11 with Node 22 or newer')
  if (command === 'lock') return prepare(true)
  if (command === 'prepare' || command === 'build') {
    await prepare()
    if (command === 'build') await build()
    return
  }
  if (command === 'pack') {
    const marker = JSON.parse(await fs.readFile(path.join(workspace, 'dist/win7-build.json'), 'utf8').catch(() => '{}'))
    if (marker.electron !== electron || marker.sourceHash !== await sourceFingerprint()) throw new Error('Run npm run build:win7 before packaging; the staged build is missing or out of date')
    await run(['build-config/build-pack.js', 'target=win', ...args])
    return
  }
  throw new Error('Unknown Win7 command: ' + command)
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { workspace, artifacts, createManifest, insideWorkspace }
