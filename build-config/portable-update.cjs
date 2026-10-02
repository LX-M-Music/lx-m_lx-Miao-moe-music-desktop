const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { deflateRaw } = require('node:zlib')
const { promisify } = require('node:util')
const { Arch } = require('electron-builder')
const compress = promisify(deflateRaw)
const chunkSize = 1024 * 1024
const inventoryPath = 'resources/lx-update-inventory.json'
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

// The build tools already have TypeScript; share the runtime path rules instead
// of letting the published inventory include local data or unsupported names.
const source = require('node:fs').readFileSync(path.join(__dirname, '../src/common/updateManifest.ts'), 'utf8')
const code = require('typescript').transpileModule(source, { compilerOptions: { module: 1, target: 9 } }).outputText
const manifestModule = { exports: {} }
new Function('exports', code)(manifestModule.exports)
const { isManagedUpdatePath } = manifestModule.exports

async function listFiles(root, relative = '') {
  const files = []
  for (const name of (await fs.readdir(path.join(root, relative))).sort()) {
    const item = relative ? relative + '/' + name : name
    const stat = await fs.lstat(path.join(root, item))
    if (stat.isSymbolicLink()) throw Error('Linked file in portable package: ' + item)
    if (stat.isDirectory()) files.push(...await listFiles(root, item))
    else if (stat.isFile()) {
      if (!isManagedUpdatePath(item)) throw Error('Unmanaged file in portable package: ' + item)
      files.push(item)
    }
  }
  return files
}

async function stageUpdateTools(appOutDir) {
  const { downloadBuilderToolset } = require('app-builder-lib/out/util/electronGet')
  // The verified x86 7za works on Win7 x86/x64 and normal Windows, including
  // ARM64's x86 compatibility. The application itself keeps its native arch.
  const tool = await downloadBuilderToolset({
    releaseName: '7zip@1.0.0', filenameWithExt: '7zip-win-ia32.tar.gz',
    checksums: { '7zip-win-ia32.tar.gz': 'ac3f38f96ce7498096a123bb0862dd6db863a7353c9e9e1c15f73c183adf6620' },
    githubOrgRepo: 'electron-userland/electron-builder-binaries',
  })
  const target = path.join(appOutDir, 'resources/update-tools')
  await fs.mkdir(target, { recursive: true })
  await fs.copyFile(path.join(tool, 'bin/7za.exe'), path.join(target, '7za.exe'))
  for (const name of ['LICENSE.txt', 'COPYING']) await fs.copyFile(path.join(tool, name), path.join(target, name))
}

async function writeInventory(appOutDir) {
  const files = []
  for (const name of await listFiles(appOutDir)) {
    if (name === inventoryPath) continue
    const bytes = await fs.readFile(path.join(appOutDir, name))
    files.push({ path: name, size: bytes.length, sha256: digest(bytes) })
  }
  await fs.writeFile(path.join(appOutDir, inventoryPath), JSON.stringify({ schema: 1, appId: 'com.lx-m.music.desktop', files }))
}

async function createPortableDelta(appOutDir, outDir, { version, arch, win7 = false }) {
  const suffix = arch === 'ia32' ? 'x86' : arch
  const base = `LX-M.Music-v${version}-${win7 ? 'win7' : 'win'}_${suffix}-green-update`
  const payloadName = base + '.bin'
  const payloadPath = path.join(outDir, payloadName)
  const manifestPath = path.join(outDir, base + '.json')
  await fs.mkdir(outDir, { recursive: true })
  const payload = await fs.open(payloadPath, 'w')
  const payloadHash = createHash('sha256')
  const files = []
  let offset = 0
  try {
    for (const name of await listFiles(appOutDir)) {
      const input = await fs.open(path.join(appOutDir, name), 'r')
      const hash = createHash('sha256')
      const chunks = []
      let size = 0
      try {
        const buffer = Buffer.alloc(chunkSize)
        while (true) {
          const { bytesRead } = await input.read(buffer, 0, buffer.length, size)
          if (!bytesRead) break
          const raw = buffer.subarray(0, bytesRead)
          const compressed = await compress(raw, { level: 6 })
          const data = compressed.length < raw.length ? compressed : raw
          let written = 0
          while (written < data.length) written += (await payload.write(data, written, data.length - written, offset + written)).bytesWritten
          payloadHash.update(data)
          hash.update(raw)
          chunks.push({ offset, length: data.length, size: raw.length, sha256: digest(raw), encoding: data === raw ? 'raw' : 'deflate' })
          offset += data.length
          size += raw.length
        }
      } finally { await input.close() }
      files.push({ path: name, size, sha256: hash.digest('hex'), chunks })
    }
  } finally { await payload.close() }
  const manifest = {
    schema: 1, appId: 'com.lx-m.music.desktop', edition: 'portable', version, arch, win7,
    payload: { fileName: payloadName, size: offset, sha256: payloadHash.digest('hex') }, files,
  }
  await fs.writeFile(manifestPath, JSON.stringify(manifest))
  return [manifestPath, payloadPath]
}

function portableArtifactHook(contexts, win7) {
  return async({ outDir }) => {
    const files = []
    for (const context of contexts) files.push(...await createPortableDelta(context.appOutDir, outDir, {
      version: context.packager.appInfo.version, arch: Arch[context.arch], win7,
    }))
    return files
  }
}

module.exports = { stageUpdateTools, writeInventory, createPortableDelta, portableArtifactHook }
