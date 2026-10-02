import { httpGet } from './request'
import { getWindowsUpdatePriority } from '@common/utils/update'
import { getUpdateRuntime } from './ipc'

const REPO_OWNER = 'Miao-moe'
const REPO_NAME = 'lx-m_lx-Miao-moe-music-desktop'
const LATEST_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`

const request = async(url, retryNum = 0) => {
  return new Promise((resolve, reject) => {
    httpGet(url, {
      timeout: 10000,
      follow: true,
      follow_max: 5,
      headers: {
        'User-Agent': 'lx-m-music-desktop',
        Accept: 'application/vnd.github+json',
      },
    }, (err, resp, body) => {
      if (err || resp.statusCode != 200) {
        ++retryNum >= 3
          ? reject(err || Object.assign(new Error(resp.statusMessage || String(resp.statusCode)), { statusCode: resp.statusCode }))
          : request(url, retryNum).then(resolve).catch(reject)
      } else resolve(body)
    })
  })
}

const getArchKeyword = () => {
  switch (process.arch) {
    case 'x64': return 'x64'
    case 'ia32': return 'x86'
    case 'arm64': return 'arm64'
    case 'arm': return 'armv7l'
    default: return process.arch
  }
}

const selectAsset = (assets, runtime) => {
  if (!Array.isArray(assets) || !assets.length) return null
  const arch = getArchKeyword().toLowerCase()
  const platform = process.platform

  if (platform === 'win32') {
    return assets
      .map(asset => ({ asset, priority: getWindowsUpdatePriority(asset.name || '', runtime) }))
      .filter(({ priority }) => priority > 0)
      .sort((a, b) => b.priority - a.priority)[0]?.asset ?? null
  }

  let candidates = assets.filter(asset => {
    const name = (asset.name || '').toLowerCase()
    switch (platform) {
      case 'darwin': return name.endsWith('.dmg')
      case 'linux': return name.endsWith('.appimage') || name.endsWith('.deb')
      default: return false
    }
  })
  if (!candidates.length) return null

  const archMatched = candidates.filter(asset => (asset.name || '').toLowerCase().includes(arch))
  if (archMatched.length) candidates = archMatched

  return candidates[0]
}

export const getVersionInfo = async() => {
  const info = await request(LATEST_API)
  if (!info || info.tag_name == null) throw new Error('failed')

  const version = String(info.tag_name).replace(/^v/i, '')
  const runtime = process.platform === 'win32' ? await getUpdateRuntime() : null
  const asset = selectAsset(info.assets, runtime)
  let differential
  if (runtime?.edition === 'portable') {
    const find = type => info.assets?.find(asset => getWindowsUpdatePriority(asset.name || '', runtime, type) > 0)
    const manifest = find('manifest')
    const payload = find('payload')
    const convert = asset => ({ downloadUrl: asset.browser_download_url, fileName: asset.name, size: asset.size, digest: asset.digest })
    if (manifest && payload) differential = { manifest: convert(manifest), payload: convert(payload) }
  }

  return {
    version,
    desc: info.body ?? '',
    history: [],
    downloadUrl: asset?.browser_download_url ?? '',
    fileName: asset?.name ?? '',
    size: asset?.size ?? 0,
    digest: asset?.digest ?? '',
    edition: runtime?.edition,
    differential,
  }
}
