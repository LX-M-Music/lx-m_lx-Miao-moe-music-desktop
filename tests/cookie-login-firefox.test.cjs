const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')
const { createFirefoxLoginBrowser } = loader({ ws: require('ws') })('src/main/modules/winMain/rendererEvent/cookieLoginFirefox.ts')
const { hasLoginState } = loader()('src/common/cookieLogin.ts')

test('stock Firefox/Zen collects cookies and both storage types, then detects closing the login tab', { skip: !process.env.LX_TEST_FIREFOX, timeout: 40000 }, async() => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-login-bidi-'))
  const server = http.createServer((_req, res) => res.writeHead(200, { 'Content-Type': 'text/html' }).end('<title>Local login</title><script>document.cookie="MUSIC_U=local-test-session; path=/";localStorage.setItem("mg_auth_sid", JSON.stringify("local-test-session"));sessionStorage.setItem("mg_auth_uid","7")</script>'))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await createFirefoxLoginBrowser(process.env.LX_TEST_FIREFOX, profile, true)
    const definition = { url: `http://127.0.0.1:${server.address().port}/`, domains: ['127.0.0.1'], cookieGroups: [['MUSIC_U']], storageKeys: ['mg_auth_sid', 'mg_auth_uid'], storageGroups: [['mg_auth_sid', 'mg_auth_uid']] }
    await browser.loadURL(definition.url)
    const cookies = await browser.cookies()
    assert(cookies.some(cookie => cookie.name === 'MUSIC_U' && cookie.value === 'local-test-session'))
    const storage = await browser.storage(definition)
    assert.deepEqual([...storage], [['mg_auth_sid', 'local-test-session'], ['mg_auth_uid', '7']])
    assert(hasLoginState(cookies, storage, definition))
    assert(hasLoginState([], storage, definition))
    await browser.command('browsingContext.close', { context: browser.context }).catch(() => {})
    await new Promise(resolve => setTimeout(resolve, 100))
    assert(browser.isClosed())
  } finally {
    await browser?.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
