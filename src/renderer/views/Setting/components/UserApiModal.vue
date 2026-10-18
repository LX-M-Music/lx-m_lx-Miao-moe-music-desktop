<template lang="pug">
material-modal(:show="modelValue" bg-close teleport="#view" @close="handleClose")
  main.scroll(:class="$style.main" data-user-api-manager)
    h2 {{ $t('user_api__title') }}
    ul.scroll(v-if="apiList.length" :class="$style.content")
      li(v-for="api in apiList" :key="api.id" :data-source-id="api.id" :data-musicfree-id="isMusicFreeSource(api.id) ? api.id : undefined" :class="[$style.listItem, {[$style.active]: appSetting['common.apiSource'] == api.id}]")
        div(:class="$style.listLeft")
          h3
            | {{ api.name }}
            span(v-if="isMusicFreeSource(api.id)") MusicFree
            span(v-if="api.version") {{ /^\d/.test(api.version) ? `v${api.version}` : api.version }}
            span(v-if="api.author") {{ api.author }}
            svg-icon.help-icon(v-if="api.description" name="help-circle-outline" :aria-label="api.description")
          template(v-if="isMusicFreeSource(api.id)")
            base-checkbox(:id="`user_api_${api.id}`" :model-value="api.enabled" :class="$style.checkbox" :disabled="busy" :label="$t('setting__is_enable')" @update:model-value="handleSetEnabled(api, $event)")
            p(v-if="!api.methods.includes('search') || !api.supportedSearchType.includes('music')" :class="$style.pluginNote") {{ $t('musicfree__no_search') }}
            details(v-if="api.userVariables.length" :class="$style.variables")
              summary {{ $t('musicfree__variables') }}
              label(v-for="variable in api.userVariables" :key="variable.key" :class="$style.variable")
                span {{ variable.title }}
                input(v-model="variables[api.id][variable.key]" :type="/token|cookie|secret|key|password/i.test(variable.key) ? 'password' : 'text'" autocomplete="off" :disabled="busy")
              base-btn(min :disabled="busy" @click="handleSaveVariables(api)") {{ $t('musicfree__save') }}
          div(v-else)
            base-checkbox(:id="`user_api_${api.id}`" v-model="api.allowShowUpdateAlert" :class="$style.checkbox" :label="$t('user_api__allow_show_update_alert')" @change="handleChangeAllowUpdateAlert(api, $event)")
        base-btn(:class="$style.listBtn" outline :disabled="busy" :aria-label="$t('user_api__btn_remove')" @click.stop="handleRemove(api)")
          svg(v-once version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="0 0 212.982 212.982" space="preserve")
            use(xlink:href="#icon-delete")
    div(v-else :class="$style.content")
      div(:class="$style.noitem") {{ $t('user_api__noitem') }}
    div(:class="$style.note")
      p {{ $t('user_api__formats') }}
      p(:class="[$style.ruleLink]")
        | {{ $t('user_api__readme') }}
        span.hover.underline(aria-label="https://lxmusic.toside.cn/desktop/custom-source" @click="handleOpenUrl('https://lyswhut.github.io/lx-music-doc/desktop/custom-source')") FAQ
      p {{ $t('user_api__note') }}
    p(v-if="message" role="status" :class="$style.message") {{ message }}
    div(:class="$style.footer")
      base-btn(:class="$style.footerBtn" :disabled="busy" @click="isShowOnlineImportModal = true") {{ $t('user_api__btn_import_online') }}
      base-btn(:class="$style.footerBtn" :disabled="busy" @click="handleImport") {{ $t('user_api__btn_import') }}
    UserApiOnlineImportModal(v-model:show="isShowOnlineImportModal" :import-source="handleOnlineImport")
</template>

<script>
import { formatError } from '@common/utils/errorMessage'
import { removeUserApi, showSelectDialog, setAllowShowUserApiUpdateAlert } from '@renderer/utils/ipc'
import { readFileLimited } from '@common/utils/nodejs'
import { isMusicFreeSource } from '@common/musicFree'
import { openUrl } from '@common/utils/electron'
import apiSourceInfo from '@renderer/utils/musicSdk/api-source-info'
import { userApi } from '@renderer/store'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { computed, ref, reactive, watch } from '@common/utils/vueTools'
import { importCustomSource } from '@renderer/core/customSourceImport'
import { musicFreePlugins, initMusicFreeSources, removeMusicFree, configureMusicFree } from '@renderer/store/musicFree'

import UserApiOnlineImportModal from './UserApiOnlineImportModal.vue'

export default {
  components: {
    UserApiOnlineImportModal,
  },
  props: {
    modelValue: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['update:modelValue'],
  setup(props) {
    const isShowOnlineImportModal = ref(false)
    const apiList = computed(() => [...userApi.list, ...musicFreePlugins.value])
    const busy = ref(false)
    const message = ref('')
    const variables = reactive({})
    watch(musicFreePlugins, plugins => {
      for (const plugin of plugins) variables[plugin.id] = Object.fromEntries(plugin.userVariables.map(item => [item.key, plugin.variables[item.key] ?? '']))
      for (const id of Object.keys(variables)) if (!plugins.some(plugin => plugin.id === id)) Reflect.deleteProperty(variables, id)
    }, { immediate: true })
    watch(() => props.modelValue, show => {
      if (show) {
        message.value = ''
        void initMusicFreeSources().catch(error => { message.value = formatError(error, '', 'SOURCE_LOAD_FAILED') })
      }
    })

    return {
      userApi,
      apiList,
      appSetting,
      isShowOnlineImportModal,
      isMusicFreeSource,
      busy,
      message,
      variables,
    }
  },
  methods: {
    async run(action) {
      if (this.busy) return
      this.busy = true
      this.message = ''
      try { await action() } catch (error) { this.message = formatError(error, '', 'SOURCE_OPERATION_FAILED') } finally { this.busy = false }
    },
    importSummary(count, errors) {
      return [count ? this.$t('user_api__imported', { count }) : '', ...errors].filter(Boolean).join('\n')
    },
    async handleOnlineImport(input) {
      this.busy = true
      this.message = ''
      try {
        const result = await importCustomSource(input)
        this.message = this.importSummary(result.imported.length, result.errors)
        if (result.errors.length) throw new Error(result.errors.join('\n'))
      } finally { this.busy = false }
    },
    async handleImport() {
      if (this.busy) return
      const result = await showSelectDialog({
        title: this.$t('user_api__import_file'),
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'LX / MusicFree', extensions: ['js', 'json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })
      if (result.canceled) return
      await this.run(async() => {
        let count = 0
        const errors = []
        for (const filePath of result.filePaths) {
          const fileName = filePath.split(/[\\/]/).pop() ?? filePath
          try {
            const data = await readFileLimited(filePath, 2 * 1024 * 1024)
            const imported = await importCustomSource({ script: data.toString('utf8') })
            count += imported.imported.length
            errors.push(...imported.errors.map(error => `${fileName}: ${error}`))
          } catch (err) { errors.push(`${fileName}: ${formatError(err, '', 'SOURCE_IMPORT_FAILED')}`) }
        }
        this.message = this.importSummary(count, errors)
      })
    },
    async handleSetEnabled(api, enabled) {
      await this.run(async() => configureMusicFree(api, enabled))
    },
    async handleSaveVariables(api) {
      await this.run(async() => {
        await configureMusicFree(api, api.enabled, { ...this.variables[api.id] })
        this.message = this.$t('musicfree__saved')
      })
    },
    async handleRemove(api) {
      await this.run(async() => {
        if (isMusicFreeSource(api.id)) return removeMusicFree(api.id)
        if (appSetting['common.apiSource'] == api.id) {
          const backApi = apiSourceInfo.find(api => !api.disabled) ?? userApi.list.find(item => item.id !== api.id)
          await updateSetting({ 'common.apiSource': backApi?.id ?? '' })
        }
        userApi.list = await removeUserApi([api.id])
      })
    },
    handleClose() {
      if (!this.busy) this.$emit('update:modelValue', false)
    },
    handleOpenUrl(url) {
      void openUrl(url)
    },
    handleChangeAllowUpdateAlert(api, enable) {
      void setAllowShowUserApiUpdateAlert(api.id, enable)
    },
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  padding: 15px 8px;
  max-width: 550px;
  min-width: 300px;
  display: flex;
  flex-flow: column nowrap;
  min-height: 0;
  // max-height: 100%;
  // overflow: hidden;
  h2 {
    flex: none;
    font-size: 16px;
    color: var(--color-font);
    line-height: 1.3;
    text-align: center;
  }
}

.name {
  color: var(--color-primary);
}

.checkbox {
  margin-top: 3px;
  font-size: 14px;
  opacity: .86;
}

.content {
  flex: auto;
  min-height: 80px;
  max-height: 100%;
  margin-top: 15px;
  padding: 0 7px;
}
.listItem {
  display: flex;
  flex-flow: row nowrap;
  align-items: center;
  transition: background-color 0.2s ease;
  padding: 15px 10px;
  border-radius: @radius-border;
  &:hover {
    background-color: var(--color-primary-background-hover);
  }
  &.active {
    background-color: var(--color-primary-background-active);
  }
  h3 {
    font-size: 15px;
    color: var(--color-font);
    word-break: break-all;
    span {
      font-size: 12px;
      color: var(--color-font-label);
      margin-left: 6px;
    }
  }
}
.noitem {
  height: 100px;
  font-size: 18px;
  color: var(--color-font-label);
  display: flex;
  justify-content: center;
  align-items: center;
}
.listLeft {
  flex: auto;
  min-width: 0;
  display: flex;
  flex-flow: column nowrap;
  justify-content: center;
}
.listBtn {
  flex: none;
  height: 30px;
  width: 30px;
  padding: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  svg {
    width: 60%;
  }
}
.pluginNote {
  font-size: 12px;
  color: var(--color-font-label);
  line-height: 1.5;
  margin-top: 6px;
}
.variables {
  font-size: 12px;
  margin: 10px 10px 0 0;
  summary { cursor: pointer; }
  button { margin-top: 8px; }
}
.variable {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  span { flex: 0 1 100px; overflow-wrap: anywhere; }
  input {
    flex: 1;
    min-width: 0;
    padding: 6px 8px;
    background: var(--color-primary-background);
    color: var(--color-font);
    border: 1px solid var(--color-primary-light-200-alpha-200);
    border-radius: @radius-border;
  }
}
.message {
  flex: none;
  padding: 0 7px;
  margin-top: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 100px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.5;
}
.note {
  flex: none;
  padding: 0 7px;
  margin-top: 15px;
  font-size: 12px;
  line-height: 1.25;
  color: var(--color-font);
  p {
    + p {
      margin-top: 5px;
    }
  }
}
.footer {
  flex: none;
  padding: 0 7px;
  margin-top: 15px;
  display: flex;
  flex-flow: row nowrap;
}
.footerBtn {
  flex: auto;
  height: 36px;
  line-height: 36px;
  padding: 0 10px !important;
  width: 150px;
  .mixin-ellipsis-1();
  + .footerBtn {
    margin-left: 15px;
  }
}
.ruleLink {
  .mixin-ellipsis-1();
}

</style>
