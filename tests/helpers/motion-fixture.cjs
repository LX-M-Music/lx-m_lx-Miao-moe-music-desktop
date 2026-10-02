const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { _electron } = require('playwright-core')

const project = process.env.LX_TEST_PROJECT ? path.resolve(process.env.LX_TEST_PROJECT) : path.resolve(__dirname, '../..')

async function launch({ record = false, profilePath, initializeMotion = true, reducedMotion = 'no-preference', rendererPath = process.env.LX_TEST_RENDERER_PATH, disableHardwareAcceleration = true, args = [] } = {}) {
  if (process.env.LX_TEST_PROJECT) rendererPath = path.join(project, 'dist/index.html')
  const output = profilePath ?? await fs.mkdtemp(path.join(os.tmpdir(), 'lx-motion-check-'))
  await fs.mkdir(path.join(output, 'portable'), { recursive: true })
  const wrapper = path.join(output, 'wrapper.cjs')
  await fs.writeFile(wrapper, `const electron = require('electron');
electron.app.setAppPath(${JSON.stringify(project)});
electron.app.getVersion = () => ${JSON.stringify(require(path.join(project, 'package.json')).version)};
electron.app.setAsDefaultProtocolClient = () => false;
electron.app.removeAsDefaultProtocolClient = () => false;
${rendererPath ? `electron.app.on('web-contents-created', (_event, contents) => {
  const loadURL = contents.loadURL.bind(contents);
  contents.loadURL = (url, options) => {
    const parsed = new URL(url);
    const renderer = parsed.origin === 'http://localhost:9080' ? ${JSON.stringify(pathToFileURL(rendererPath).href)}
      : parsed.origin === 'http://localhost:9081' && parsed.pathname === '/lyric.html' ? ${JSON.stringify(pathToFileURL(path.join(path.dirname(rendererPath), 'lyric.html')).href)} : null;
    return loadURL(renderer ? renderer + parsed.search : url, options);
  };
});` : ''}
require(${JSON.stringify(path.join(project, 'dist/main.js'))});`)
  const env = { ...process.env, PORTABLE_EXECUTABLE_DIR: output }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await _electron.launch({
    executablePath: process.env.LX_TEST_ELECTRON ?? require(path.join(project, 'node_modules/electron')),
    args: [wrapper, '-hidden', ...(disableHardwareAcceleration ? ['-dha'] : []), ...args],
    env,
    ...(record ? { recordVideo: { dir: path.join(output, 'video'), size: { width: 1114, height: 718 } } } : {}),
  })
  let page = await app.firstWindow()
  // Development mode opens detached DevTools before the application page.
  if (page.url().startsWith('devtools:')) {
    page = app.windows().find(page => !page.url().startsWith('devtools:')) ?? await app.waitForEvent('window', {
      predicate: page => !page.url().startsWith('devtools:'),
    })
  }
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error' && /TypeError:|insertBefore|parentNode|Maximum recursive updates/.test(message.text())) errors.push(message.text())
  })
  try {
    await page.waitForSelector('#container')
  } catch (error) {
    console.error('Renderer startup failed:', {
      windows: app.windows().map(page => {
        const url = new URL(page.url())
        return `${url.origin}${url.pathname}`
      }),
      errors,
    })
    await app.close()
    throw error
  }
  // Target the app window, not its detached DevTools, and keep the compositor running.
  const window = await app.browserWindow(page)
  await window.evaluate((window, record) => {
    window.webContents.closeDevTools()
    window.webContents.setBackgroundThrottling(false)
    if (record) window.show()
    else window.showInactive()
  }, record)
  await window.dispose()
  await page.evaluate(initializeMotion => {
    Object.assign(window.lxData.appSetting, {
      'common.isAgreePact': true,
      'common.showChangeLog': false,
      ...(initializeMotion ? {
        'common.isShowAnimation': true,
        'ui.smoothAnimation': true,
        'ui.animationSpeed': 1,
      } : {}),
      'playDetail.isDelayScroll': false,
    })
    // Startup update requests are unrelated to motion and may otherwise open a modal mid-check.
    window.lxData.versionInfo.newVersion = { version: window.lxData.versionInfo.version, history: [], desc: '' }
    window.lxData.versionInfo.showModal = false
    // Inspect the production component tree; no test hooks are shipped in the app.
    window.__motionComponents = () => {
      const components = []
      const visit = node => {
        if (!node) return
        if (Array.isArray(node)) return node.forEach(visit)
        if (node.component) {
          components.push(node.component)
          visit(node.component.subTree)
        } else if (Array.isArray(node.children)) node.children.forEach(visit)
      }
      visit(document.querySelector('#root')._vnode)
      return components
    }
    window.__motionDetail = () => window.__motionComponents().find(c => c.type.name === 'CorePlayDetail').setupState
    for (const component of window.__motionComponents()) {
      if ('isShowChangeLog' in component.setupState) component.setupState.isShowChangeLog = false
    }
  }, initializeMotion)
  await page.waitForTimeout(500)
  // Apply after startup: opening DevTools can reset Chromium's media emulation.
  await page.emulateMedia({ reducedMotion })
  await page.waitForFunction(() => {
    const setting = window.lxData.appSetting
    const enabled = setting['common.isShowAnimation'] && setting['ui.smoothAnimation'] && !setting['ui.lowPowerMode']
    return document.documentElement.dataset.motionEnabled === String(enabled)
  })
  return { app, page, errors, output }
}

async function seedTrack(page) {
  await page.evaluate(() => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#10273c"/><stop offset=".55" stop-color="#297c88"/><stop offset="1" stop-color="#deb695"/></linearGradient></defs><rect width="600" height="600" fill="url(#g)"/><circle cx="410" cy="180" r="96" fill="#f7d6a2"/><path d="M0 360Q120 290 280 365T600 365V600H0Z" fill="#173b54"/><path d="M0 470Q180 390 345 460T600 420V600H0Z" fill="#142735"/><text x="42" y="74" fill="#fff" font-size="24" font-family="Segoe UI" letter-spacing="6">EVENING TIDE</text></svg>'
    const pic = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    const info = { id: 'motion-demo-1', name: '晚风与海', singer: 'LX-M 动效预览', source: 'local', interval: '03:40', meta: { picUrl: pic, albumName: 'Evening Tide', filePath: '', ext: 'mp3' } }
    Object.assign(window.lxData.musicInfo, { id: info.id, name: info.name, singer: info.singer, album: 'Evening Tide', pic })
    Object.assign(window.lxData.playMusicInfo, { musicInfo: info, listId: 'default' })
    window.lxData.playQueueList.splice(0, Infinity, ...['晚风与海', '蓝色时刻', '沿途的光', '日落以后', '慢慢靠近'].map((name, i) => ({ listId: 'default', musicInfo: { ...info, id: 'motion-demo-' + (i + 1), name } })))
  })
  // A repeated seed can arrive during the previous cover's leave transition.
  await page.locator('#player [data-player-cover] img').last().waitFor()
  await page.waitForFunction(() => Array.from(document.querySelectorAll('#player [data-player-cover] img')).some(image => image.getAttribute('src') === window.lxData.musicInfo.pic && image.complete))
}

async function seedLyrics(page) {
  await page.evaluate(() => {
    const lyric = window.__motionComponents().find(c => c.setupState.lyric).setupState.lyric
    window.__motionLyric = lyric
    const texts = ['晚风轻轻，掠过海面', '把日落，留在你身边', '沿着光，慢慢向前', '听见远处，潮声绵延', '让这一刻，缓缓浮现', '每一次切换，都自然一点', '晚风又吹过，蓝色海面', '我们在这里，等下一篇']
    lyric.lines = texts.map((text, i) => {
      const element = document.createElement('div')
      element.className = 'line-content line-mode'
      element.time = i * 5000
      const line = document.createElement('div')
      line.className = 'line'
      const span = document.createElement('span')
      span.className = 'font-lrc'
      span.textContent = text
      line.appendChild(span)
      element.appendChild(line)
      return { text, time: i * 5000, extendedLyrics: [], dom_line: element }
    })
    window.__motionLine = index => {
      lyric.lines.forEach((line, i) => line.dom_line.classList.toggle('active', i === index))
      lyric.text = lyric.lines[index].text
      lyric.line = index
    }
    window.__motionLine(0)
  })
}

const route = (page, url) => page.evaluate(url => document.querySelector('#root').__vue_app__.config.globalProperties.$router.push(url), url)
const showDetail = (page, show) => page.evaluate(show => { window.__motionDetail().isShowPlayerDetail = show }, show)
const settled = page => page.waitForFunction(() => !document.querySelector('[data-cover-flight]') &&
  Array.from(document.querySelectorAll('[data-motion-outlet]')).every(el => el.getAnimations().length === 0))

module.exports = { launch, seedTrack, seedLyrics, route, showDetail, settled }
