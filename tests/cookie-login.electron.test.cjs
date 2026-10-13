const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')
const sources = ['wy', 'tx', 'kg', 'kw', 'mg']
const urls = { wy: 'https://music.163.com/', tx: 'https://y.qq.com/', kg: 'https://www.kugou.com/', kw: 'https://www.kuwo.cn/', mg: 'https://music.migu.cn/v5/' }
const cookies = { wy: 'MUSIC_U=fixture-session', tx: 'uin=7; qqmusic_key=fixture-session', kg: 'KuGoo=KugooID=7&t=fixture-session', kw: 'userid=7; sid=fixture-session', mg: 'mg_auth_sid=fixture-session; mg_auth_uid=7' }
const output = path.resolve('output/playwright/platform-login-audit')

// Use the source browser connection for read-only page inspection during opt-in live checks.
const bidi = (app, method, params) => app.evaluate(async(_, { method, params }) => {
  const tab = global.__cookieBrowserTabs.at(-1)
  if (!tab) throw Error('No browser login connection')
  const id = 1000000 + (global.__cookieTestCommandId = (global.__cookieTestCommandId ?? 0) + 1)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { tab.socket.off('message', read); reject(Error(method + ' test timeout')) }, 15000)
    const read = data => {
      const message = JSON.parse(data.toString())
      if (message.id !== id) return
      clearTimeout(timer); tab.socket.off('message', read)
      message.type === 'error' ? reject(Error(message.message)) : resolve(message.result)
    }
    tab.socket.on('message', read)
    tab.socket.send(JSON.stringify({ id, method, params: { ...params, ...((method.startsWith('browsingContext.') && method !== 'browsingContext.getTree') || method.startsWith('input.') ? { context: tab.context } : {}), ...(method === 'script.evaluate' ? { target: params.target ?? { context: tab.context }, awaitPromise: true } : {}) } }))
  })
}, { method, params })

test('platform settings and home modal support both login modes, playlist checks and persisted login', { timeout: 360000 }, async t => {
  await fs.mkdir(output, { recursive: true })
  const profilePath = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-cookie-login-ui-'))
  const server = http.createServer((req, res) => {
    const source = req.headers['x-fixture-source']
    const body = source === 'wy' ? (req.url.includes('account/get') ? { code: 200, account: { id: 7 } } : { code: 200, playlist: [] })
      : source === 'tx' ? { code: 0, data: { disslist: [] } }
        : source === 'kg' ? { status: 1, error_code: 0, data: { list_count: 0, info: [] } }
          : source === 'kw' ? { result: 'ok', plist: [] } : { code: '000000', data: { myCreatedMusicLists: { createdMusicLists: [] } } }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let fixture
  let app
  let page
  const launchApp = async() => {
    fixture = await launch({ profilePath, rendererPath: path.resolve('dist/index.html') }); app = fixture.app; page = fixture.page
    page.setDefaultTimeout(12000)
    await page.evaluate(port => {
      const https = require('https'), http = require('http'), request = https.request
      const hosts = { 'interfacepc.music.163.com': 'wy', 'interface.music.163.com': 'wy', 'c.y.qq.com': 'tx', 'gateway.kugou.com': 'kg', 'nplserver.kuwo.cn': 'kw', 'c.musicapp.migu.cn': 'mg', 'app.c.nf.migu.cn': 'mg' }
      https.request = function(options, callback) {
        const source = hosts[options.hostname ?? options.host]
        if (source) return http.request({ ...options, protocol: 'http:', hostname: '127.0.0.1', host: '127.0.0.1', port, agent: undefined, headers: { ...options.headers, 'x-fixture-source': source } }, callback)
        return request.apply(this, arguments)
      }
    }, server.address().port)
    await route(page, '/setting?name=SettingCookie'); await settled(page)
  }
  const row = source => page.locator(`[data-setting-search="setting__cookie_source_${source}"]`)
  try {
    await launchApp()
    await t.test('settings keep login choices first and playlist test/clear last for every platform', async() => {
      for (const source of sources) assert.deepEqual(await row(source).locator('button').allTextContents(), ['软件内登录', '浏览器登录', '测试获取歌单', '清空'])
      await page.screenshot({ path: path.join(output, 'settings-login-options.png') })
    })

    if (process.env.LX_TEST_LIVE_COOKIE_LOGIN) {
      const live = []
      const liveSources = process.env.LX_TEST_LOGIN_SOURCES?.split(',') ?? sources
      for (const source of liveSources) {
        await t.test(`live ${source}: embedded official page and login panel open and cancel correctly`, async() => {
          let login
          for (let attempt = 0; attempt < 2; attempt++) {
            const opened = app.waitForEvent('window', { predicate: candidate => !candidate.url().includes('dist/index.html') })
            await row(source).getByRole('button', { name: '软件内登录', exact: true }).click()
            try { login = await opened } catch (error) {
              console.error(source + ' window open failed: ' + await row(source).innerText())
              throw error
            }
            try { await login.waitForLoadState('domcontentloaded', { timeout: 30000 }); break } catch (error) {
              if (attempt || !login.isClosed()) throw error
              console.log(source + ' first load failed: ' + (await row(source).innerText()).split('\n').slice(-3).join(' '))
            }
          }
          login.on('pageerror', error => console.error(source + ' login page: ' + error.message))
          await login.locator('#lx-login-titlebar').waitFor({ timeout: 30000 })
          let entry
          for (let attempt = 0; attempt < 30 && !entry; attempt++) {
            for (const candidate of await login.getByText('登录', { exact: true }).all()) if (await candidate.isVisible()) { entry = candidate; break }
            if (!entry) await new Promise(resolve => setTimeout(resolve, 500))
          }
          assert(entry, source + ': official login entry missing')
          await new Promise(resolve => setTimeout(resolve, 1200))
          let info
          for (let attempt = 0; attempt < 3; attempt++) {
            await entry.click()
            await new Promise(resolve => setTimeout(resolve, 1800))
            info = await login.evaluate(() => ({ title: document.title, url: location.href, text: document.body.innerText, frames: [...document.querySelectorAll('iframe')].map(frame => frame.src) }))
            if (/扫码|二维码|密码|验证码|手机号|QQ登录|微信登录|酷我帐号|酷我账号|快捷登录/.test(info.text) || info.frames.some(url => /login|passport|oauth|auth/i.test(url))) break
          }
          if (['tx', 'mg'].includes(source)) {
            let authReady = false
            for (let attempt = 0; attempt < 50 && !authReady; attempt++) {
              for (const frame of login.frames()) {
                if (!(source === 'tx' ? frame.url().includes('xui.ptlogin2.qq.com') : frame.url().includes('passport.migu.cn'))) continue
                authReady ||= await frame.evaluate(source => {
                  const elements = source === 'tx' ? document.querySelectorAll('img[src*="ptqrshow"]') : document.querySelectorAll('input[placeholder*="手机号"], input[type="tel"]')
                  return [...elements].some(el => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== 'hidden' && (el.tagName === 'INPUT' || el.naturalWidth > 0))
                }, source).catch(() => false)
              }
              if (!authReady) await new Promise(resolve => setTimeout(resolve, 500))
            }
            assert(authReady, source + ': authorization form or QR code did not load')
          }
          await fs.writeFile(path.join(output, source + '-embedded-panel.json'), JSON.stringify({ ...info, windows: app.windows().map(page => page.url()) }, null, 2))
          const win = await app.browserWindow(login)
          const screenshot = await win.evaluate(async win => (await win.webContents.capturePage()).toPNG().toString('base64'))
          await win.dispose()
          await fs.writeFile(path.join(output, source + '-embedded-official-login.png'), Buffer.from(screenshot, 'base64'))
          assert(/扫码|二维码|密码|验证码|手机号|QQ登录|微信登录|酷我帐号|酷我账号|快捷登录/.test(info.text) || info.frames.some(url => /login|passport|oauth|auth/i.test(url)), source + ': login panel missing')
          live.push({ source, mode: 'embedded', title: info.title, url: info.url, opened: true })
          await login.locator('#lx-login-titlebar').getByRole('button', { name: '×', exact: true }).click()
          await row(source).getByRole('button', { name: '软件内登录', exact: true }).waitFor()
          await page.waitForFunction(source => ![...document.querySelectorAll(`[data-setting-search="setting__cookie_source_${source}"] button`)].some(el => el.textContent === '登录中…'), source)
        })
        if (live.at(-1)?.source !== source || live.at(-1)?.mode !== 'embedded') throw Error('Embedded live check failed for ' + source)
        await t.test(`live ${source}: default-browser official login opens and closing releases the request`, async() => {
          const before = await app.evaluate(() => global.__cookieBrowserTabs.length)
          await row(source).getByRole('button', { name: '浏览器登录', exact: true }).click()
          for (let i = 0; i < 80 && await app.evaluate(() => global.__cookieBrowserTabs.length) === before; i++) await new Promise(resolve => setTimeout(resolve, 250))
          assert(await app.evaluate(() => global.__cookieBrowserTabs.length) > before, 'default browser did not start')
          let info
          for (let i = 0; i < 45; i++) {
            const result = await bidi(app, 'script.evaluate', { expression: 'JSON.stringify({title:document.title,url:location.href,text:document.body?.innerText||""})' })
            if (result.type === 'success') info = JSON.parse(result.result.value)
            if (info?.title && /登录/.test(info.text)) break
            await new Promise(resolve => setTimeout(resolve, 500))
          }
          assert(info?.title && /登录/.test(info.text), source + ': default-browser page not ready')
          await new Promise(resolve => setTimeout(resolve, 1200))
          const selected = await bidi(app, 'script.evaluate', { expression: '(() => {const entries=[...document.querySelectorAll("a,button,div,span")].filter(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);if(el.textContent.trim()!=="登录"||r.width<=0||r.height<=0||s.visibility==="hidden"||s.display==="none")return false;const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===el||el.contains(hit)});const entry=entries.find(el=>el.tagName==="A"||el.tagName==="BUTTON")??entries[0];if(!entry)throw Error("Login entry missing");const r=entry.getBoundingClientRect();return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)})})()' })
          const point = JSON.parse(selected.result.value)
          let panelInfo
          for (let attempt = 0; attempt < 3; attempt++) {
            await bidi(app, 'input.performActions', { actions: [{ type: 'pointer', id: 'login-mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', x: point.x, y: point.y, origin: 'viewport' }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }] })
            await new Promise(resolve => setTimeout(resolve, 1800))
            const panel = await bidi(app, 'script.evaluate', { expression: 'JSON.stringify({text:document.body.innerText,frames:[...document.querySelectorAll("iframe")].map(frame=>frame.src),visibility:document.visibilityState})' })
            panelInfo = JSON.parse(panel.result.value)
            if (/扫码|二维码|密码|验证码|手机号|QQ登录|微信登录|酷我帐号|酷我账号|快捷登录/.test(panelInfo.text) || panelInfo.frames.some(url => /login|passport|oauth|auth/i.test(url))) break
          }
          if (['tx', 'mg'].includes(source)) {
            let authReady = false
            for (let attempt = 0; attempt < 50 && !authReady; attempt++) {
              const tree = await bidi(app, 'browsingContext.getTree', { maxDepth: 6 })
              const flatten = items => items.flatMap(item => [item, ...flatten(item.children ?? [])])
              for (const frame of flatten(tree.contexts)) {
                if (!(source === 'tx' ? frame.url.includes('xui.ptlogin2.qq.com') : frame.url.includes('passport.migu.cn'))) continue
                const selector = source === 'tx' ? 'img[src*="ptqrshow"]' : 'input[placeholder*="手机号"],input[type="tel"]'
                const ready = await bidi(app, 'script.evaluate', { target: { context: frame.context }, expression: `String([...document.querySelectorAll(${JSON.stringify(selector)})].some(el=>el.getBoundingClientRect().width>0&&el.getBoundingClientRect().height>0&&getComputedStyle(el).visibility!=="hidden"&&(el.tagName==="INPUT"||el.naturalWidth>0)))` })
                authReady ||= ready.result?.value === 'true'
              }
              if (!authReady) await new Promise(resolve => setTimeout(resolve, 500))
            }
            assert(authReady, source + ': browser authorization form or QR code did not load')
          }
          await fs.writeFile(path.join(output, source + '-browser-panel.json'), JSON.stringify(panelInfo, null, 2))
          const screenshot = await bidi(app, 'browsingContext.captureScreenshot', {})
          await fs.writeFile(path.join(output, source + '-browser-official-login.png'), Buffer.from(screenshot.data, 'base64'))
          assert(/扫码|二维码|密码|验证码|手机号|QQ登录|微信登录|酷我帐号|酷我账号|快捷登录/.test(panelInfo.text) || panelInfo.frames.some(url => /login|passport|oauth|auth/i.test(url)), source + ': browser login panel missing')
          live.push({ source, mode: 'browser', title: info.title, url: info.url, opened: true })
          await bidi(app, 'browser.close', {}).catch(() => {})
          await page.waitForFunction(source => ![...document.querySelectorAll(`[data-setting-search="setting__cookie_source_${source}"] button`)].some(el => el.textContent === '登录中…'), source)
        })
        if (live.at(-1)?.source !== source || live.at(-1)?.mode !== 'browser') throw Error('Browser live check failed for ' + source)
      }
      await fs.writeFile(path.join(output, 'live-login-results.json'), JSON.stringify(live, null, 2))
    }

    await app.evaluate(async({ session }, { sources, urls, cookies }) => {
      for (const source of sources) {
        const ses = session.fromPartition('cookie-login-embedded:' + source)
        ses.protocol.handle('https', async request => {
          if (request.url.includes('/pc/user/home-page/')) return new Response(JSON.stringify({ data: { myCreatedMusicLists: { createdMusicLists: [] } } }), { headers: { 'Content-Type': 'application/json' } })
          const script = source === 'mg'
            ? 'localStorage.setItem("mg_auth_sid",JSON.stringify("fixture-session"));sessionStorage.setItem("mg_auth_uid","7");'
            : cookies[source].split('; ').map(cookie => 'document.cookie=' + JSON.stringify(cookie + '; path=/; secure') + ';').join('')
          return new Response(`<title>${source} login fixture</title><h1 id="login-fixture">${source} official login fixture</h1><button id="authenticate">Complete fixture login</button><script>document.querySelector('#authenticate').onclick=()=>{${script}location.href=${JSON.stringify(urls[source] + '?authorized=1')}};</script>`, { headers: { 'Content-Type': 'text/html' } })
        })
      }
    }, { sources, urls, cookies })

    for (const source of sources) await t.test(`${source}: real embedded window collects fixture credentials, saves settings and checks playlists`, async() => {
      const opened = app.waitForEvent('window', { predicate: candidate => !candidate.url().includes('dist/index.html') })
      await row(source).getByRole('button', { name: '软件内登录', exact: true }).click()
      const login = await opened
      await login.locator('#login-fixture').waitFor()
      assert.equal(await login.locator('#lx-login-titlebar').getByRole('button', { name: '浏览器登录', exact: true }).count(), 1)
      await login.locator('#authenticate').click()
      await page.waitForFunction(({ source, expected }) => window.lxData.appSetting['cookie.' + source]?.includes(expected), { source, expected: cookies[source].split('; ')[0] })
      if (!login.isClosed()) await login.waitForEvent('close', { timeout: 12000 })
      await row(source).getByRole('button', { name: '测试获取歌单', exact: true }).click()
      await row(source).getByText('获取成功，共 0 个个人歌单', { exact: true }).waitFor()
      assert.equal(await row(source).getByText('登录成功', { exact: true }).count(), 1)
    })

    await t.test('cancelling a quick login preserves pending manually entered credentials', async() => {
      await row('wy').locator('textarea').fill('MUSIC_U=manual-session')
      const opened = app.waitForEvent('window', { predicate: candidate => !candidate.url().includes('dist/index.html') })
      await row('wy').getByRole('button', { name: '软件内登录', exact: true }).click()
      const login = await opened
      await login.locator('#lx-login-titlebar').getByRole('button', { name: '×', exact: true }).click()
      assert.equal(await app.evaluate(() => global.lx.appSetting['cookie.wy']), 'MUSIC_U=manual-session')
      await row('wy').getByRole('button', { name: '软件内登录', exact: true }).waitFor()
    })

    await t.test('settings browser buttons call the browser route for all five platforms', async() => {
      await app.evaluate(({ ipcMain }, cookies) => {
        ipcMain.removeHandler('winMain_cookie_login')
        global.__cookieBrowserCalls = []
        ipcMain.handle('winMain_cookie_login', (_event, source) => { global.__cookieBrowserCalls.push(source); return { cookie: cookies[source], playlists: [] } })
      }, cookies)
      for (const source of sources) {
        await row(source).getByRole('button', { name: '浏览器登录', exact: true }).click()
        await page.waitForFunction(source => ![...document.querySelectorAll(`[data-setting-search="setting__cookie_source_${source}"] button`)].some(el => el.textContent === '登录中…'), source)
      }
      assert.deepEqual(await app.evaluate(() => global.__cookieBrowserCalls), sources)
      await page.screenshot({ path: path.join(output, 'settings-login-saved.png') })
    })

    await t.test('saved credentials survive restart, home reports login, and clearing updates both views', async() => {
      assert.deepEqual(fixture.errors, [])
      await app.close(); await launchApp()
      for (const source of sources) assert.equal(await page.evaluate(source => window.lxData.appSetting['cookie.' + source], source), cookies[source])
      await page.evaluate(() => window.lxData.updateSetting({ 'experimental.newHome': true }))
      await route(page, '/home'); await settled(page)
      await page.getByRole('button', { name: '管理登录', exact: true }).click()
      const modal = page.locator('main').filter({ has: page.getByRole('heading', { name: '平台登录', exact: true }) })
      assert.equal(await modal.getByRole('button', { name: '软件内登录', exact: true }).count(), 5)
      assert.equal(await modal.getByRole('button', { name: '浏览器登录', exact: true }).count(), 5)
      assert.equal(await modal.getByText('已连接', { exact: true }).count(), 5)
      await page.screenshot({ path: path.join(output, 'home-login-options.png') })
      await page.keyboard.press('Escape')
      await route(page, '/setting?name=SettingCookie'); await settled(page)
      await row('wy').getByRole('button', { name: '清空', exact: true }).click()
      await page.waitForFunction(() => window.lxData.appSetting['cookie.wy'] === '')
      assert.equal(await row('wy').getByText('登录成功', { exact: true }).count(), 0)
    })
    assert.deepEqual(fixture.errors, [])
  } finally {
    await app?.close()
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  }
})
