import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import WebSocket from 'ws'
import { isLoginPage, loginStorageScript, type CookieLoginDefinition, type LoginCookie } from '@common/cookieLogin'

interface PendingCommand {
  resolve: (result: any) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface BrowsingContext { context: string, url: string, children?: BrowsingContext[] }
const cancelled = () => new Error('[COOKIE_LOGIN_CANCELLED] 登录窗口已关闭')

// Stock Firefox and Firefox-derived browsers expose BiDi, rather than Chromium CDP.
export const createFirefoxLoginBrowser = async(executablePath: string, profilePath: string, headless = false) => {
  await writeFile(path.join(profilePath, 'user.js'), [
    'user_pref("browser.aboutwelcome.enabled", false);',
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("browser.startup.homepage_override.mstone", "ignore");',
    'user_pref("zen.welcome-screen.seen", true);',
  ].join('\n'))
  const child = spawn(executablePath, [
    ...(headless ? ['--headless'] : []), '--no-remote', '--new-instance',
    '--profile', profilePath, '--remote-debugging-port', '0', 'about:blank',
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let socket: WebSocket | undefined
  let commandId = 0
  let loginContext = ''
  let contextClosed = false
  const pending = new Map<number, PendingCommand>()
  const rejectPending = () => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(cancelled()) }
    pending.clear()
  }
  const command = async(method: string, params: Record<string, unknown> = {}): Promise<any> => {
    if (socket?.readyState !== WebSocket.OPEN) throw cancelled()
    return new Promise((resolve, reject) => {
      const id = ++commandId
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('[COOKIE_LOGIN_BROWSER_TIMEOUT] 浏览器未响应，请关闭登录窗口后重试'))
      }, 20_000)
      pending.set(id, { resolve, reject, timer })
      socket!.send(JSON.stringify({ id, method, params }), error => {
        if (!error) return
        clearTimeout(timer); pending.delete(id); reject(cancelled())
      })
    })
  }
  const close = async() => {
    if (socket?.readyState === WebSocket.OPEN) await command('browser.close').catch(() => {})
    socket?.terminate()
    rejectPending()
    if (child.exitCode == null) {
      child.kill()
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, 2000)
        child.once('exit', () => { clearTimeout(timer); resolve() })
      })
    }
  }
  try {
    const address = await new Promise<string>((resolve, reject) => {
      let output = ''
      let connected = false
      const timer = setTimeout(() => { connected = true; reject(new Error('[COOKIE_LOGIN_BROWSER_START] 无法启动浏览器登录窗口')) }, 20_000)
      const read = (chunk: Buffer) => {
        if (connected) return
        output = (output + chunk.toString()).slice(-8000)
        const url = /WebDriver BiDi listening on (ws:\/\/[^\s]+)/.exec(output)?.[1]
        if (!url) return
        connected = true; clearTimeout(timer)
        resolve(url.endsWith('/session') ? url : url + '/session')
      }
      child.stdout.on('data', read)
      child.stderr.on('data', read)
      child.once('error', error => { connected = true; clearTimeout(timer); reject(error) })
      child.once('exit', () => { if (!connected) { connected = true; clearTimeout(timer); reject(cancelled()) } })
    })
    socket = new WebSocket(address, { handshakeTimeout: 10_000 })
    await new Promise<void>((resolve, reject) => { socket!.once('open', resolve); socket!.once('error', reject) })
    socket.on('close', rejectPending)
    socket.on('error', rejectPending)
    socket.on('message', data => {
      let message: any
      try { message = JSON.parse((Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data)).toString()) } catch { return }
      if (message.type === 'event' && message.method === 'browsingContext.contextDestroyed' && message.params.context === loginContext) contextClosed = true
      const item = pending.get(message.id)
      if (!item) return
      pending.delete(message.id); clearTimeout(item.timer)
      if (message.type === 'error') item.reject(new Error('[COOKIE_LOGIN_BROWSER_COMMAND] ' + message.message))
      else item.resolve(message.result)
    })
    await command('session.new', { capabilities: {} })
    const tree = await command('browsingContext.getTree', { maxDepth: 0 })
    const context: string = tree.contexts[0]?.context ?? (await command('browsingContext.create', { type: 'tab' })).context
    loginContext = context
    await command('browsingContext.activate', { context })
    await command('session.subscribe', { events: ['browsingContext.contextDestroyed'] })
    const getContexts = async(): Promise<BrowsingContext[]> => {
      const { contexts } = await command('browsingContext.getTree', { maxDepth: 6 })
      const flatten = (items: BrowsingContext[]): BrowsingContext[] => items.flatMap(item => [item, ...flatten(item.children ?? [])])
      return flatten(contexts)
    }
    return {
      command,
      context,
      isClosed: () => contextClosed || socket?.readyState !== WebSocket.OPEN,
      loadURL: async(url: string) => command('browsingContext.navigate', { context, url, wait: 'interactive' }),
      cookies: async(): Promise<LoginCookie[]> => {
        const result = await command('storage.getCookies')
        return result.cookies.map((cookie: any) => ({
          name: cookie.name,
          value: cookie.value.type === 'base64' ? Buffer.from(cookie.value.value, 'base64').toString() : cookie.value.value,
          domain: cookie.domain,
        }))
      },
      storage: async(definition: CookieLoginDefinition) => {
        const values = new Map<string, string>()
        if (!definition.storageKeys?.length) return values
        for (const item of await getContexts()) {
          if (!isLoginPage(item.url, definition)) continue
          const result = await command('script.evaluate', { target: { context: item.context }, expression: loginStorageScript(definition), awaitPromise: false }).catch(() => null)
          if (result?.type !== 'success' || result.result?.type !== 'string') continue
          const entries = JSON.parse(result.result.value) as Record<string, string>
          for (const [name, value] of Object.entries(entries)) if (value) values.set(name, value)
        }
        return values
      },
      evaluate: async(expression: string) => {
        const result = await command('script.evaluate', { target: { context }, expression, awaitPromise: true })
        return result.type === 'success' && result.result?.type === 'string' ? result.result.value as string : undefined
      },
      close,
    }
  } catch (error) {
    await close()
    throw error
  }
}
