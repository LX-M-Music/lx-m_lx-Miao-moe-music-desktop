import { app } from 'electron'
import fs from 'original-fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { UPDATE_RELAUNCH_SCRIPT, UPDATE_RELAUNCH_BOOTSTRAP } from './updateRelaunchScript'
import { assertUnlinkedPath, type StagedUpdate } from './updatePortable'
import { getUpdateExecutable, getUpdateRuntime } from './updateRuntime'

export interface RelaunchPlan {
  schema: 1
  nonce: string
  oldPid: number
  version: string
  kind: 'portable' | 'single-file'
  root: string
  executable: string
  stage: string
  files: StagedUpdate['files']
  obsolete: StagedUpdate['obsolete']
  confirmationTimeoutMs: number
}

export const launchWindowsRelaunch = async(stage: StagedUpdate, kind: RelaunchPlan['kind'], version: string, tempRoot: string) => {
  if (!path.win32.isAbsolute(stage.executable) || !/\.exe$/i.test(stage.executable) || !version || Array.from(version).some(char => char.charCodeAt(0) < 32)) throw new Error('自动重启更新路径无效')
  if (path.dirname(path.resolve(tempRoot)) !== path.resolve(os.tmpdir()) || !path.basename(tempRoot).startsWith('lx-m-update-') || path.resolve(stage.directory) !== path.join(path.resolve(tempRoot), 'app')) throw new Error('更新暂存目录无效')
  assertUnlinkedPath(stage.root)
  assertUnlinkedPath(tempRoot)
  // Fail before quitting if the current folder is read-only.
  const testFile = path.join(stage.root, `.lx-m-update-write-${crypto.randomUUID()}`)
  const probe = await fs.promises.open(testFile, 'wx')
  await probe.close()
  await fs.promises.unlink(testFile)
  const plan: RelaunchPlan = {
    schema: 1,
    nonce: crypto.randomUUID(),
    oldPid: process.pid,
    version,
    kind,
    root: path.resolve(stage.root),
    executable: path.resolve(stage.executable),
    stage: path.resolve(stage.directory),
    files: stage.files,
    obsolete: stage.obsolete,
    confirmationTimeoutMs: 60000,
  }
  const planFile = path.join(tempRoot, 'relaunch.json')
  const script = path.join(tempRoot, 'relaunch.ps1')
  const bootstrap = path.join(tempRoot, 'relaunch.js')
  assertUnlinkedPath(planFile)
  assertUnlinkedPath(script)
  assertUnlinkedPath(bootstrap)
  for (const suffix of ['.ready', '.ack', '.result']) await fs.promises.unlink(planFile + suffix).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
  await fs.promises.writeFile(planFile, JSON.stringify(plan))
  await fs.promises.writeFile(script, UPDATE_RELAUNCH_SCRIPT)
  await fs.promises.writeFile(bootstrap, UPDATE_RELAUNCH_BOOTSTRAP)
  const logFile = path.join(tempRoot, 'relaunch.log')
  assertUnlinkedPath(logFile)
  const log = fs.openSync(logFile, 'w')
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const powershell = path.join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
  const scriptHost = path.join(systemRoot, 'System32/wscript.exe')
  let child: ReturnType<typeof spawn>
  try {
    child = spawn(scriptHost, ['//B', '//NoLogo', bootstrap, powershell, script, planFile], {
      detached: true, stdio: ['ignore', log, log], windowsHide: true, cwd: tempRoot,
    })
  } finally { fs.closeSync(log) }
  let failure: Error | undefined
  child.once('error', error => { failure = error })
  child.unref()
  try {
    for (let i = 0; i < 1200; i++) {
      if (failure) throw failure
      if (child.exitCode != null) {
        const result = await fs.promises.readFile(planFile + '.result', 'utf8').catch(() => '')
        const message = result ? JSON.parse(result).message : (await fs.promises.readFile(logFile, 'utf8').catch(() => '')).slice(0, 4096)
        throw new Error(`更新重启助手启动失败${message ? `：${String(message)}` : ''}`)
      }
      const ready = await fs.promises.readFile(planFile + '.ready', 'utf8').catch(() => '')
      if (ready && JSON.parse(ready).nonce === plan.nonce) return
      await delay(50)
    }
    throw new Error('更新重启助手未能准备完成，请重试')
  } catch (error) {
    // The GUI host can already have started PowerShell. Its nonce-specific
    // cancellation file also stops a slow helper after an unsuccessful launch.
    await fs.promises.writeFile(planFile + '.cancel-' + plan.nonce, '').catch(() => {})
    child.kill()
    throw error
  }
}

export const confirmWindowsUpdate = () => {
  const planFile = process.env.LX_M_UPDATE_CONFIRM
  delete process.env.LX_M_UPDATE_CONFIRM
  if (!planFile) return
  try {
    const root = path.dirname(planFile)
    if (path.basename(planFile) !== 'relaunch.json' || !path.basename(root).startsWith('lx-m-update-') || fs.realpathSync.native(path.dirname(root)) !== fs.realpathSync.native(os.tmpdir())) return
    assertUnlinkedPath(planFile)
    const plan: RelaunchPlan = JSON.parse(fs.readFileSync(planFile, 'utf8'))
    if (plan.schema !== 1 || !/^[a-f0-9-]{36}$/i.test(plan.nonce) || plan.version !== app.getVersion() ||
      plan.kind !== getUpdateRuntime().edition || fs.realpathSync.native(plan.executable).toLowerCase() !== fs.realpathSync.native(getUpdateExecutable()).toLowerCase()) return
    fs.writeFileSync(planFile + '.ack', JSON.stringify({ nonce: plan.nonce, version: app.getVersion() }), { flag: 'wx' })
  } catch {}
}
