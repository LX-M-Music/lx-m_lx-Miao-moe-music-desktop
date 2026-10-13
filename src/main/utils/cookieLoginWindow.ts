const loginWindows = new WeakSet<Electron.WebContents>()

export const registerCookieLoginWindow = (contents: Electron.WebContents) => {
  loginWindows.add(contents)
  contents.once('destroyed', () => loginWindows.delete(contents))
}

// Only the sandboxed login windows may follow the platform's web authorization redirects.
export const canNavigateCookieLoginWindow = (contents: Electron.WebContents, url: string) => {
  if (!loginWindows.has(contents)) return false
  try { return ['https:', 'http:'].includes(new URL(url).protocol) } catch { return false }
}
