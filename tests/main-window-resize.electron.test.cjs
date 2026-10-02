const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { test } = require('node:test')
const { launch, route, settled, seedTrack, showDetail } = require('./helpers/motion-fixture.cjs')
const { nativeHitTest } = require('./helpers/native-window-drag.cjs')

const corners = [
  { edge: 'top-left', sizing: 4, hit: 13, left: true, top: true },
  { edge: 'top-right', sizing: 5, hit: 14, left: false, top: true },
  { edge: 'bottom-left', sizing: 7, hit: 16, left: true, top: false },
  { edge: 'bottom-right', sizing: 8, hit: 17, left: false, top: false },
]

async function nativeResize(app, window, bounds, corner) {
  const info = await window.evaluate(window => ({ id: window.id, handle: window.getNativeWindowHandle().readBigUInt64LE().toString() }))
  const target = await app.evaluate(({ screen, BrowserWindow }, { id, bounds }) => screen.dipToScreenRect(BrowserWindow.fromId(id), bounds), { id: info.id, bounds })
  // Send the real Windows sizing message, so Chromium's aspect constraint and
  // Electron's native resize events run. No renderer gesture is simulated.
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CornerResize {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll", EntryPoint="SendMessageTimeoutW")] public static extern IntPtr SendSizing(IntPtr window, uint message, IntPtr wParam, ref Rect rect, uint flags, uint timeout, out UIntPtr result);
  [DllImport("user32.dll", EntryPoint="SendMessageTimeoutW")] public static extern IntPtr SendSimple(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
}
'@
$null = [CornerResize]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
$handle = [IntPtr]::new([long]${info.handle})
$result = [UIntPtr]::Zero
$null = [CornerResize]::SendSimple($handle, 561, [IntPtr]::Zero, [IntPtr]::Zero, 2, 3000, [ref]$result)
$rect = New-Object CornerResize+Rect
$rect.Left = ${target.x}
$rect.Top = ${target.y}
$rect.Right = ${target.x + target.width}
$rect.Bottom = ${target.y + target.height}
$sent = [CornerResize]::SendSizing($handle, 532, [IntPtr]::new(${corner.sizing}), [ref]$rect, 2, 3000, [ref]$result)
if ($sent -eq [IntPtr]::Zero) { throw 'Native sizing timed out.' }
if (-not [CornerResize]::SetWindowPos($handle, [IntPtr]::Zero, $rect.Left, $rect.Top, $rect.Right-$rect.Left, $rect.Bottom-$rect.Top, 20)) { throw 'Native sizing could not apply bounds.' }
$null = [CornerResize]::SendSimple($handle, 562, [IntPtr]::Zero, [IntPtr]::Zero, 2, 3000, [ref]$result)
`], { windowsHide: true, timeout: 10000 })
  return window.evaluate(window => window.getBounds())
}

test('main window replaces size presets with native proportional corner resizing', { skip: process.platform !== 'win32', timeout: 120000 }, async t => {
  let fixture = await launch()
  let { app, page } = fixture
  let window = await app.browserWindow(page)
  const { output } = fixture
  const traces = []
  page.setDefaultTimeout(10000)
  try {
    const original = await window.evaluate(window => window.getBounds())
    const ratio = original.width / original.height
    await t.test('size presets disappear from settings while normal corners have native resize cursors', async() => {
      await route(page, '/setting')
      await settled(page)
      assert.equal(await page.locator('#basic_window_size, [name="setting_window_size"]').count(), 0)
      await page.locator('#basic_font_size').waitFor()
      assert.equal(await window.evaluate(window => window.isResizable()), true)
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      for (const corner of corners) assert.equal(await nativeHitTest(app, page, 'html', {
        x: corner.left ? 2 : viewport.width - 2,
        y: corner.top ? 2 : viewport.height - 2,
      }), corner.hit, corner.edge)
      await page.screenshot({ path: path.join(output, 'settings-without-window-size.png') })
    })

    for (const corner of corners) {
      await t.test(`${corner.edge} grows and shrinks with the opposite corner anchored`, async() => {
        await window.evaluate((window, original) => window.setBounds(original), original)
        const grown = await nativeResize(app, window, {
          x: original.x - (corner.left ? 90 : 0), y: original.y - (corner.top ? 35 : 0),
          width: original.width + 90, height: original.height + 35,
        }, corner)
        assert(grown.width > original.width + 20 && grown.height > original.height + 20)
        assert(Math.abs(grown.width - grown.height * ratio) <= 2, 'native drag preserves the original aspect ratio')
        assert(Math.abs((corner.left ? grown.x + grown.width : grown.x) - (corner.left ? original.x + original.width : original.x)) <= 2, 'opposite horizontal edge remains anchored')
        assert(Math.abs((corner.top ? grown.y + grown.height : grown.y) - (corner.top ? original.y + original.height : original.y)) <= 2, 'opposite vertical edge remains anchored')
        const shrunk = await nativeResize(app, window, {
          x: grown.x + (corner.left ? 80 : 0), y: grown.y + (corner.top ? 45 : 0),
          width: grown.width - 80, height: grown.height - 45,
        }, corner)
        assert(shrunk.width < grown.width && shrunk.height < grown.height)
        assert(Math.abs(shrunk.width - shrunk.height * ratio) <= 2)
        await page.waitForFunction(bounds => window.lxData.appSetting['common.windowWidth'] === bounds.width && window.lxData.appSetting['common.windowHeight'] === bounds.height, shrunk)
        traces.push({ edge: corner.edge, grown, shrunk })
      })
    }

    await t.test('playback corners resize, expanded windows restore without saving their screen-sized bounds', async() => {
      await seedTrack(page)
      await showDetail(page, true)
      await settled(page)
      const before = await window.evaluate(window => window.getBounds())
      const resized = await nativeResize(app, window, { ...before, width: before.width + 80, height: before.height + 30 }, corners[3])
      assert(Math.abs(resized.width - resized.height * ratio) <= 2)
      await page.waitForFunction(bounds => window.lxData.appSetting['common.windowWidth'] === bounds.width && window.lxData.appSetting['common.windowHeight'] === bounds.height, resized)
      const maximize = await page.evaluate(() => window.i18n.t('window_maximize'))
      await page.locator('[data-player-detail]').getByRole('button', { name: maximize, exact: true }).click()
      await page.locator('html.maximized').waitFor()
      assert.equal(await window.evaluate(window => window.isResizable()), false)
      await page.keyboard.press('F11')
      await page.locator('html.fullscreen').waitFor()
      await page.keyboard.press('F11')
      await page.locator('html.maximized:not(.fullscreen)').waitFor()
      const restore = await page.evaluate(() => window.i18n.t('window_restore'))
      await page.locator('[data-player-detail]').getByRole('button', { name: restore, exact: true }).click()
      await page.locator('html:not(.maximized):not(.fullscreen)').waitFor()
      assert.equal(await window.evaluate(window => window.isResizable()), true)
      const restored = await window.evaluate(window => window.getBounds())
      assert(Math.abs(restored.width - resized.width) <= 1 && Math.abs(restored.height - resized.height) <= 1)
      await page.waitForFunction(bounds => window.lxData.appSetting['common.windowWidth'] === bounds.width && window.lxData.appSetting['common.windowHeight'] === bounds.height, resized)
      await page.screenshot({ path: path.join(output, 'resized-playback-page.png') })
      await showDetail(page, false)
      await settled(page)
    })

    await t.test('legacy preset changes no longer snap the window and the resized dimensions survive restart', async() => {
      const before = await window.evaluate(window => window.getBounds())
      await page.evaluate(() => window.lxData.updateSetting({ 'common.windowSizeId': 6 }))
      await page.waitForFunction(() => window.lxData.appSetting['common.windowSizeId'] === 6)
      assert.deepEqual(await window.evaluate(window => window.getBounds()), before)
      assert.deepEqual(fixture.errors, [])
      await window.dispose()
      await app.close()
      fixture = await launch({ profilePath: output })
      ;({ app, page } = fixture)
      window = await app.browserWindow(page)
      const after = await window.evaluate(window => window.getBounds())
      assert(Math.abs(after.width - before.width) <= 1 && Math.abs(after.height - before.height) <= 1, 'native DPI rounding stays within one logical pixel')
      assert.equal(await page.evaluate(() => window.lxData.appSetting['common.windowWidth']), before.width, 'startup rounding does not replace the saved size')
      assert.equal(await page.evaluate(() => window.lxData.appSetting['common.windowHeight']), before.height)
      assert.equal(await window.evaluate(window => window.isResizable()), true)
      await window.dispose()
      await app.close()
      fixture = await launch({ profilePath: output })
      ;({ app, page } = fixture)
      window = await app.browserWindow(page)
      const repeated = await window.evaluate(window => window.getBounds())
      assert.equal(repeated.width, after.width, 'repeated restarts do not accumulate display rounding')
      assert.equal(repeated.height, after.height)
    })
    assert.deepEqual(fixture.errors, [])
    await fs.writeFile(path.join(output, 'native-corner-resize.json'), JSON.stringify(traces, null, 2))
    console.log('Native main-window resize checks:', output)
  } finally { await window.dispose(); await app.close() }
})
