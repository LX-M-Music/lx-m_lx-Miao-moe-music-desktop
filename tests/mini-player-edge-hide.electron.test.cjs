const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { launch, seedTrack, captureHidden } = require('./helpers/motion-fixture.cjs')
const { nativeHitTest, nativeIgnoresMouse, resizeWindow } = require('./helpers/native-window-drag.cjs')

async function nativeRegion(native) {
  const handle = await native.evaluate(window => window.getNativeWindowHandle().readBigUInt64LE().toString())
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class EdgeRegion {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("gdi32.dll")] public static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);
  [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr region);
  [DllImport("user32.dll")] public static extern int GetWindowRgn(IntPtr window, IntPtr region);
  [DllImport("gdi32.dll")] public static extern int GetRgnBox(IntPtr region, out Rect bounds);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] public static extern int GetWindowLong(IntPtr window, int index);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect bounds);
}
'@
$null = [EdgeRegion]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
$targetWindow = [IntPtr]::new([long]${handle})
$region = [EdgeRegion]::CreateRectRgn(0, 0, 0, 0)
$type = [EdgeRegion]::GetWindowRgn($targetWindow, $region)
$rect = New-Object EdgeRegion+Rect
$null = [EdgeRegion]::GetRgnBox($region, [ref]$rect)
$null = [EdgeRegion]::DeleteObject($region)
$ignore = ([EdgeRegion]::GetWindowLong($targetWindow, -20) -band 32) -ne 0
$windowRect = New-Object EdgeRegion+Rect
$null = [EdgeRegion]::GetWindowRect($targetWindow, [ref]$windowRect)
@{ type = $type; x = $rect.Left; y = $rect.Top; width = $rect.Right - $rect.Left; height = $rect.Bottom - $rect.Top; ignore = $ignore; windowWidth = $windowRect.Right - $windowRect.Left; windowHeight = $windowRect.Bottom - $windowRect.Top } | ConvertTo-Json -Compress
`], { windowsHide: true, timeout: 10000 })
  return JSON.parse(stdout.trim())
}

test('mini player hides at side/top edges and reveals without changing the saved full size', { skip: process.platform !== 'win32', timeout: 120000 }, async t => {
  const fixture = await launch({ hidden: true, rendererPath: path.resolve('dist/index.html') })
  const { app, page } = fixture
  const edition = process.env.LX_TEST_PROJECT ? 'win7' : 'standard'
  const output = path.resolve('output/mini-player-edge-motion-20261026', edition)
  const errors = [], evidence = [], frames = []
  let native, mini
  const update = values => page.evaluate(values => window.lxData.updateSetting(values), values)
  const cursor = point => app.evaluate((_electron, point) => { global.__edgeHidePointer = point }, point)
  const saved = () => app.evaluate(() => ({ x: global.lx.appSetting['miniPlayer.x'], y: global.lx.appSetting['miniPlayer.y'], width: global.lx.appSetting['miniPlayer.width'], height: global.lx.appSetting['miniPlayer.height'] }))
  const holdCompletion = async() => {
    await mini.evaluate(() => { getComputedStyle(document.querySelector('.mini-edge-content')).transform })
    await app.evaluate(() => { global.__holdEdgeCompletion = true })
  }
  const captureMotion = async(mode, phase) => {
    await mini.waitForFunction(phase => {
      const node = document.querySelector('.mini-edge-content')
      getComputedStyle(node).transform
      return node.dataset.edgePhase === phase && node.getAnimations().some(animation => animation.transitionProperty === 'transform')
    }, phase, { polling: 10 })
    const frame = await mini.evaluate(({ phase, edge }) => {
      const node = document.querySelector('.mini-edge-content')
      const animation = node.getAnimations().find(animation => animation.transitionProperty === 'transform')
      const duration = Number(animation.effect.getTiming().duration)
      animation.pause()
      animation.currentTime = duration / 4
      const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform)
      return { phase, edge, duration, x: matrix.m41, y: matrix.m42, width: node.offsetWidth, height: node.offsetHeight }
    }, { phase, edge: mode.edge })
    assert.equal(frame.duration, 240)
    if (mode.edge === 'top') assert(frame.y < -1 && frame.y > -frame.height + 6 && frame.x === 0, JSON.stringify(frame))
    else assert(Math.abs(frame.x) > 1 && Math.abs(frame.x) < frame.width - 6 && frame.y === 0 && Math.sign(frame.x) === (mode.edge === 'left' ? -1 : 1), JSON.stringify(frame))
    const bounds = await native.evaluate(window => window.getBounds())
    assert(Math.abs(bounds.width - 450) <= 2 && Math.abs(bounds.height - 240) <= 2, 'animation must not resize the native window')
    await captureHidden(app, mini, path.join(output, `${mode.name}-${phase}-middle.png`))
    frames.push(frame)
    await mini.evaluate(() => { for (const animation of document.querySelector('.mini-edge-content').getAnimations()) animation.finish() })
    await app.evaluate(() => { global.__releaseEdgeCompletion() })
  }
  const assertFullSize = async(size = { width: 450, height: 240 }) => {
    const actual = await native.evaluate(window => window.getBounds())
    assert(Math.abs(actual.width - size.width) <= 2 && Math.abs(actual.height - size.height) <= 2, JSON.stringify({ actual, size }))
    const stored = await saved()
    assert.deepEqual({ width: stored.width, height: stored.height }, size)
    assert.deepEqual(await native.evaluate(window => window.getMinimumSize()), [280, 180])
    return actual
  }
  const waitHidden = async edge => {
    await mini.locator(`[data-mini-edge="${edge}"]`).waitFor({ state: 'attached' })
    await mini.waitForFunction(() => document.querySelector('.mini-edge-content').dataset.edgePhase === 'hidden')
    const bounds = await native.evaluate(window => window.getContentBounds())
    const region = await nativeRegion(native)
    const scale = await app.evaluate(({ screen }, bounds) => screen.getDisplayMatching(bounds).scaleFactor, bounds)
    assert.equal(region.type, 2, 'Windows uses a rectangular clipping region')
    assert((edge === 'top' ? region.height : region.width) <= Math.ceil(8 * scale), JSON.stringify(region))
    if (edge === 'right') assert(Math.abs(region.x + region.width - region.windowWidth) <= 3, JSON.stringify(region))
    if (edge === 'left') assert.equal(region.x, 0)
    if (edge === 'top') assert.equal(region.y, 0)
    assert.deepEqual(await native.evaluate(window => window.getMinimumSize()), [280, 180])
    const handle = await mini.locator('.mini-edge-handle').evaluate(node => {
      const rect = node.getBoundingClientRect()
      return { color: getComputedStyle(node).backgroundColor, x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    })
    assert.notEqual(handle.color, 'rgba(0, 0, 0, 0)', 'transparent and borderless players retain a visible recovery strip')
    assert(handle.width > 0 && handle.height > 0)
    assert.equal(region.ignore, true)
    return { x: bounds.x + handle.x, y: bounds.y + handle.y, width: handle.width, height: handle.height, region }
  }
  const reveal = async bounds => {
    await cursor({ x: bounds.x + Math.min(2, bounds.width - 1), y: bounds.y + Math.min(2, bounds.height - 1) })
    await mini.locator('.mini-edge-handle').waitFor({ state: 'detached' })
    await mini.waitForFunction(() => document.querySelector('.mini-edge-content').dataset.edgePhase === 'shown')
  }
  try {
    await fs.mkdir(output, { recursive: true })
    const area = await app.evaluate(({ screen }) => {
      global.__edgeHidePointer = { x: -10000, y: -10000 }
      screen.getCursorScreenPoint = () => global.__edgeHidePointer
      // Hold only completion while capturing a paused real CSS transition.
      // Production timing is separately verified with the unit clock and the
      // subsequent unmodified real-time hide/reveal cycles.
      const originalSetTimeout = global.setTimeout, originalClearTimeout = global.clearTimeout
      const held = new Map()
      global.setTimeout = (callback, delay, ...args) => {
        if (!global.__holdEdgeCompletion || delay !== 240) return originalSetTimeout(callback, delay, ...args)
        const timer = originalSetTimeout(callback, 10000, ...args)
        held.set(timer, () => callback(...args))
        return timer
      }
      global.clearTimeout = timer => { held.delete(timer); originalClearTimeout(timer) }
      global.__releaseEdgeCompletion = () => {
        global.__holdEdgeCompletion = false
        const pending = [...held]
        held.clear()
        for (const [timer, callback] of pending) { originalClearTimeout(timer); callback() }
      }
      return screen.getPrimaryDisplay().workArea
    })
    await seedTrack(page)
    for (const mode of [
      { name: 'left', edge: 'left' }, { name: 'right', edge: 'right' }, { name: 'top', edge: 'top' },
      { name: 'top-left', edge: 'left', corner: true }, { name: 'top-right', edge: 'right', corner: true, locked: true },
    ]) {
      await t.test(mode.name, async() => {
        try {
          await update({
            'miniPlayer.enable': true, 'miniPlayer.isLock': false, 'miniPlayer.isLockScreen': true,
            'miniPlayer.width': 450, 'miniPlayer.height': 240, 'miniPlayer.x': area.x + 100, 'miniPlayer.y': area.y + 120,
            'miniPlayer.autoHideControls': false, 'miniPlayer.backgroundOpacity': 0, 'miniPlayer.showBorder': false,
          })
          const matches = page => page.url().includes('mini=true')
          mini = app.windows().find(matches) ?? await app.waitForEvent('window', { predicate: matches })
          mini.setDefaultTimeout(8000)
          mini.on('pageerror', error => errors.push(error.message))
          await mini.locator('.mini-track-info h1').waitFor({ state: 'attached' })
          native = await app.browserWindow(mini)
          const target = {
            x: mode.edge === 'left' ? area.x : mode.edge === 'right' ? area.x + area.width - 450 : area.x + Math.round((area.width - 450) / 2),
            y: mode.corner || mode.edge === 'top' ? area.y : area.y + 200,
          }
          await cursor({ x: target.x + 80, y: target.y + 40 })
          await native.evaluate((window, { target, mode, area }) => {
            const proposed = { ...window.getBounds(), ...target }
            if (mode.edge === 'left') proposed.x = area.x - 20
            if (mode.edge === 'right') proposed.x = area.x + area.width
            if (mode.corner || mode.edge === 'top') proposed.y = area.y - 20
            let prevented = false
            window.emit('will-move', { preventDefault() { prevented = true } }, proposed)
            if (!prevented) window.setBounds(proposed)
          }, { target, mode, area })
          await page.waitForFunction(target => Math.abs(window.lxData.appSetting['miniPlayer.x'] - target.x) <= 2 && Math.abs(window.lxData.appSetting['miniPlayer.y'] - target.y) <= 2, target)
          assert.equal(await nativeHitTest(app, mini, '.mini-track-info h1'), 2)
          await native.evaluate(window => { window.emit('moved') })
          if (mode.locked) await update({ 'miniPlayer.isLock': true })
          const full = await assertFullSize()
          if (!mode.corner) await holdCompletion()
          await cursor({ x: -10000, y: -10000 })
          if (!mode.corner) await captureMotion(mode, 'hiding')
          const strip = await waitHidden(mode.edge)
          const stored = await saved()
          // A top-only drag can initially land one DIP away from the proposed
          // x at fractional scaling. Hiding must retain that actual position.
          assert.deepEqual(stored, { x: mode.edge === 'top' ? full.x : target.x, y: target.y, width: 450, height: 240 })
          const visibleEdge = mode.edge === 'top' ? strip.y : mode.edge === 'left' ? strip.x : strip.x + strip.width
          const displayEdge = mode.edge === 'top' ? area.y : mode.edge === 'left' ? area.x : area.x + area.width
          assert(Math.abs(visibleEdge - displayEdge) <= 2, JSON.stringify({ strip, area }))
          await captureHidden(app, mini, path.join(output, `${mode.name}-strip.png`))
          if (!mode.corner) {
            await holdCompletion()
            await cursor({ x: strip.x + 2, y: strip.y + 2 })
            await captureMotion(mode, 'showing')
          }
          await reveal(strip)
          const restored = await assertFullSize()
          evidence.push({ mode, area, full, strip, stored, restored })
          await captureHidden(app, mini, path.join(output, `${mode.name}-expanded.png`))
          if (mode.locked) {
            assert.equal(await nativeIgnoresMouse(app, mini), true)
            await cursor({ x: restored.x + restored.width - 20, y: restored.y + 20 })
            await mini.waitForTimeout(150)
            assert.equal(await nativeIgnoresMouse(app, mini), false, 'unlock remains available after edge recovery')
          } else assert.equal(await nativeIgnoresMouse(app, mini), false, 'an unlocked expanded player accepts input again')
          if (mode.name === 'left') {
            const before = await native.evaluate(window => window.getBounds())
            const size = await resizeWindow(app, mini, { ...before, width: 530, height: 310 })
            await page.waitForFunction(size => window.lxData.appSetting['miniPlayer.width'] === size.width && window.lxData.appSetting['miniPlayer.height'] === size.height, size)
            for (let i = 0; i < 5; i++) {
              await cursor({ x: -10000, y: -10000 })
              const nextStrip = await waitHidden('left')
              await reveal(nextStrip)
              await assertFullSize({ width: size.width, height: size.height })
            }
          }
        } finally {
          await app.evaluate(() => { global.__releaseEdgeCompletion() })
          await native?.dispose()
          native = null
          await update({ 'miniPlayer.enable': false })
          if (mini && !mini.isClosed()) await mini.waitForEvent('close')
          mini = null
        }
      })
    }
    assert.deepEqual(errors, [])
    assert.deepEqual(fixture.errors, [])
    await fs.writeFile(path.join(output, 'bounds.json'), JSON.stringify(evidence, null, 2) + '\n')
    await fs.writeFile(path.join(output, 'animation-frames.json'), JSON.stringify(frames, null, 2) + '\n')
  } finally {
    await native?.dispose()
    await app.evaluate(({ app }) => { app.exit(0) }).catch(() => {})
    await app.close().catch(() => {})
  }
})
