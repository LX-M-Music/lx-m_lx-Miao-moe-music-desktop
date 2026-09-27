import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { builtinPlugins } from '@common/builtinPlugins'
import { PLUGIN_API_VERSION } from '@common/optionalPlugins'
import type { createPluginRuntime } from '@common/optionalPluginRuntime'
import type { PluginModule } from '@common/optionalPluginTypes'
import soundEffects from '../../optional-plugins/sound-effects'
import audioTagEditor from '../../optional-plugins/audio-tag-editor'
import { editor } from '../../optional-plugins/audio-tag-editor/session'

const modules: Record<string, PluginModule> = {
  'sound-effects': { ...soundEffects, components: { SoundEffectButton: soundEffects.components.SoundEffectButton, Settings: soundEffects.components.Settings } },
  'audio-tag-editor': {
    ...audioTagEditor,
    components: { Settings: audioTagEditor.components.Settings },
    activate() {
      const dispose = audioTagEditor.activate()
      return () => { editor.visible = false; dispose() }
    },
    downloadActions: audioTagEditor.downloadActions.map(action => ({
      ...action,
      async run(id) {
        await action.run(id, { openSettings: async() => { editor.visible = true } })
      },
    })),
  },
}

export const initBuiltinPlugins = (runtime: ReturnType<typeof createPluginRuntime>) => {
  for (const { id, version } of builtinPlugins) {
    const assets = new URL(`builtin/${id}/`, document.baseURI)
    runtime.registerBuiltin(id, modules[id], {
      id,
      version,
      apiVersion: PLUGIN_API_VERSION,
      assetUrl: name => new URL(name, assets).href,
      async readAsset(name) {
        const url = new URL(name, assets)
        if (url.protocol === 'file:') return fs.readFile(fileURLToPath(url))
        const response = await fetch(url.href)
        if (!response.ok) throw new Error(`Cannot read built-in resource: ${response.status}`)
        return new Uint8Array(await response.arrayBuffer())
      },
    })
  }
}
