const http = require('http')
const https = require('https')
const fs = require('fs')
// Electron 22's Node HTTP client does not recognize a worker's browser URL class.
const { URL } = require('node:url')
const { Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { httpOverHttp, httpsOverHttp } = require('tunnel')

module.exports = async(url, filePath, proxy, { timeout = 15000, maxBytes = 10 * 1024 * 1024, maxRedirects = 5 } = {}) => {
  let request; let response; let writer; let opened = false; let timedOut
  const timer = setTimeout(() => {
    timedOut = Object.assign(new Error('Artwork download timeout'), { code: 'ETIMEDOUT' })
    request?.destroy(timedOut)
    response?.destroy(timedOut)
    writer?.destroy(timedOut)
  }, timeout)
  const fetch = async(target, redirects) => {
    const parsed = new URL(target)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw Object.assign(new Error('Unsupported artwork protocol'), { code: 'ERR_ARTWORK_PROTOCOL' })
    if (timedOut) throw timedOut
    response = await new Promise((resolve, reject) => {
      request = (parsed.protocol === 'https:' ? https : http).request(parsed, {
        agent: proxy ? (parsed.protocol === 'https:' ? httpsOverHttp : httpOverHttp)({ proxy }) : undefined,
        headers: { 'User-Agent': 'LX-M Music' },
      }, resolve)
      request.once('error', reject)
      request.end()
    })
    if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
      const location = new URL(response.headers.location, parsed).href
      response.destroy()
      if (redirects >= maxRedirects) throw Object.assign(new Error('Too many artwork redirects'), { code: 'ERR_ARTWORK_REDIRECT' })
      return fetch(location, redirects + 1)
    }
    if (response.statusCode !== 200) throw Object.assign(new Error('Artwork HTTP ' + response.statusCode), { code: 'ERR_ARTWORK_HTTP', statusCode: response.statusCode })
    if (Number(response.headers['content-length']) > maxBytes) throw Object.assign(new Error('Artwork exceeds size limit'), { code: 'ERR_ARTWORK_SIZE' })
    let bytes = 0
    const limit = new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length
        callback(bytes > maxBytes ? Object.assign(new Error('Artwork exceeds size limit'), { code: 'ERR_ARTWORK_SIZE' }) : null, chunk)
      },
    })
    writer = fs.createWriteStream(filePath, { flags: 'wx' })
    writer.once('open', () => { opened = true })
    await pipeline(response, limit, writer)
    if (!bytes || !response.complete) throw Object.assign(new Error('Incomplete artwork'), { code: 'ERR_ARTWORK_INCOMPLETE' })
    return true
  }
  try { return await fetch(url, 0) } catch (error) {
    response?.destroy()
    writer?.destroy()
    if (writer && !writer.closed) await new Promise(resolve => writer.once('close', resolve))
    if (opened) await fs.promises.unlink(filePath).catch(() => {})
    throw timedOut || error
  } finally { clearTimeout(timer) }
}
