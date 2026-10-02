import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { APP_NAME } from '@common/constants'

const getEdition = (): LX.UpdateEdition => {
  if (!app.isPackaged) return 'development'
  if (process.env.PORTABLE_EXECUTABLE_FILE) return 'single-file'
  const root = path.dirname(app.getPath('exe'))
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(root, 'resources/lx-update-runtime.json'), 'utf8'))
    if (marker.schema === 1 && marker.appId === 'com.lx-m.music.desktop') {
      if (marker.edition === 'installed' || marker.edition === 'portable') return marker.edition
      if (marker.edition === 'single-file') return 'development' // Missing outer launcher path; never replace its temporary image.
    }
  } catch {}
  return fs.existsSync(path.join(root, `Uninstall ${APP_NAME}.exe`)) ? 'installed' : 'portable'
}

export const getUpdateRuntime = (): LX.UpdateRuntime => ({
  edition: getEdition(),
  arch: process.arch,
  win7: process.versions.electron?.split('.')[0] === '22',
})

export const getUpdateExecutable = (): string => process.env.PORTABLE_EXECUTABLE_FILE ?? app.getPath('exe')
