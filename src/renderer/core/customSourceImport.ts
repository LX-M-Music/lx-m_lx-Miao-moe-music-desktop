import { importUserApi } from '@renderer/utils/ipc'
import { userApi } from '@renderer/store'
import { importMusicFree } from '@renderer/store/musicFree'

export interface CustomSourceImportResult {
  imported: string[]
  errors: string[]
}

export const importCustomSource = async(input: { script: string, url?: string }): Promise<CustomSourceImportResult> => {
  const script = input.script.replace(/^\uFEFF/, '').trim()
  if (!script || Buffer.byteLength(script, 'utf8') > 2 * 1024 * 1024) throw new Error('SOURCE_IMPORT_INVALID: 自定义源文件不能为空或超过 2 MiB')
  // LX requires a leading metadata comment. CommonJS exports take precedence
  // unless the script explicitly uses the LX bridge (including bundled LX APIs).
  const hasLxHeader = /^\/\*[\s\S]+?\*\//.test(script)
  const hasCommonJs = /\b(?:module\s*(?:\.\s*exports|\[\s*['"]exports['"]\s*\])|exports\s*(?:\.|\[))/.test(script)
  const hasLxBridge = /\b(?:window|globalThis)\s*(?:\.\s*lx|\[\s*['"]lx['"]\s*\])|\blx\s*\.\s*(?:EVENT_NAMES|on|send|request)\b/.test(script)
  if (!hasLxHeader || (hasCommonJs && !hasLxBridge)) {
    const result = await importMusicFree({ ...input, script })
    return { imported: result.imported, errors: result.errors }
  }
  if (userApi.list.length >= 20) throw new Error('SOURCE_IMPORT_LIMIT: 最多导入 20 个 LX 自定义源')
  const { apiList, apiInfo } = await importUserApi(script)
  userApi.list = apiList
  return { imported: [apiInfo.name], errors: [] }
}
