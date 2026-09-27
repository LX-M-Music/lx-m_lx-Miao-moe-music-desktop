<template lang="pug">
dt#basic {{ $t('setting__basic') }}
dd
  div
    .gap-top
      base-checkbox(id="setting_show_animate" :model-value="appSetting['common.isShowAnimation']" :label="$t('setting__basic_show_animation')" @update:model-value="updateSetting({'common.isShowAnimation': $event})")
    common-setting-reveal(:show="appSetting['common.isShowAnimation']" depends="setting_show_animate")
      .gap-top
        base-checkbox(id="setting_animate" :model-value="appSetting['common.randomAnimate']" :label="$t('setting__basic_animation')" @update:model-value="updateSetting({'common.randomAnimate': $event})")
    .gap-top
      base-checkbox(id="setting_start_in_fullscreen" :model-value="appSetting['common.startInFullscreen']" :label="$t('setting__basic_start_in_fullscreen')" @update:model-value="updateSetting({'common.startInFullscreen': $event})")
    .gap-top
      base-checkbox(id="setting_to_tray" :model-value="appSetting['tray.enable']" :label="$t('setting__basic_to_tray')" @update:model-value="updateSetting({'tray.enable': $event})")
    .p.gap-top
      base-btn.btn(min @click="isShowPlayTimeoutModal = true") {{ $t('setting__play_timeout')}} {{ timeLabel ? ` (${timeLabel})` : '' }}

dd(data-setting-search="setting__basic_theme theme")
  h3#basic_theme {{ $t('setting__basic_theme') }}
  div
    ul(:class="$style.theme")
      li(v-for="theme in themeList" :key="theme.id" :aria-label="theme.name" :style="theme.styles" :class="[$style.themeItem, {[$style.active]: themeId == theme.id}]" @click="toggleTheme(theme)" @contextmenu="handleEditTheme(theme)")
        div(:class="$style.bg")
        span(:class="$style.label") {{ theme.name }}
      li(v-if="showThemeOptions || themeId == 'auto'" :aria-label="$t('theme_auto_tip')" :style="autoTheme" :class="[$style.themeItem, $style.auto, {[$style.active]: themeId == 'auto'}]" @click="handleSetThemeAuto" @contextmenu="isShowThemeSelectorModal = true")
        div(:class="$style.bg")
          div(:class="$style.bgContent")
            div(:class="$style.light")
            div(:class="$style.dark")
        span(:class="$style.label") {{ $t('theme_auto') }}
      li(v-if="showThemeOptions" :aria-label="$t('theme_add')" :class="[$style.themeItem, $style.add]" @click="handleEditTheme()")
        div(:class="$style.bg")
          div(:class="$style.bgContent")
            svg-icon(:class="$style.icon" name="plus")
        span(:class="$style.label") {{ $t('theme_add') }}
      li(v-if="showThemeOptions" :aria-label="$t('theme_import')" :class="[$style.themeItem, $style.add]" @click="handleImportTheme")
        div(:class="$style.bg")
          div(:class="$style.bgContent")
            svg-icon(:class="$style.icon" name="download")
        span(:class="$style.label") {{ $t('theme_import') }}
      li(v-if="!showThemeOptions" :aria-label="$t('theme_more_btn_show')" :class="[$style.themeItem, $style.moreThme]" @click="showAllTheme = true")
        span(:class="$style.label") {{ $t('theme_more_btn_show') }}
        svg-icon(name="angle-right-solid" :class="$style.activeIcon")

dd
  h3#basic_source {{ $t('setting__basic_source') }}
  div
    .gap-top(v-for="item in apiSources" :key="item.id")
      base-checkbox(
        :id="`setting_api_source_${item.id}`" name="setting_api_source"
        need :model-value="appSetting['common.apiSource']" :disabled="item.disabled" :value="item.id" :aria-label="item.label" @update:model-value="updateSetting({'common.apiSource': $event})")
        span(:class="$style.sourceLabel")
          | {{ item.name }}
          span(v-if="item.desc" :class="$style.desc") {{ item.desc }}
          span(v-if="item.statusLabel" :class="$style.status") {{ item.statusLabel }}
    .p.gap-top.setting-actions
      base-btn.btn(min @click="isShowUserApiModal = true") {{ $t('setting__basic_source_user_api_btn') }}
      base-btn.btn(min @click="isShowQualityCheckModal = true") {{ $t('setting__basic_source_check_quality') }}

dd
  h3#basic_window_size {{ $t('setting__basic_window_size') }}
  div.setting-options
    base-checkbox.gap-left(
      v-for="item in windowSizeList" :id="`setting_window_size_${item.id}`" :key="item.id"
      name="setting_window_size" need :model-value="appSetting['common.windowSizeId']" :disabled="isFullscreen" :value="item.id" :label="$t('setting__basic_window_size_' + item.name)"
      @update:model-value="updateSetting({'common.windowSizeId': $event})")

dd
  h3#basic_font_size {{ $t('setting__basic_font_size') }}
  div.setting-options
    //- base-selection.gap-teft(:list="fontSizeList" :model-value="appSetting['common.fontSize']" @update:model-value="updateSetting({'common.fontSize': $event})")
    base-checkbox.gap-left(
      v-for="item in fontSizeList" :id="`setting_basic_font_size_${item.id}`" :key="item.id"
      name="setting_basic_font_size" need :model-value="appSetting['common.fontSize']" :value="item.id"
      :label="item.label" :disabled="isFullscreen" @update:model-value="updateSetting({'common.fontSize': $event})")

setting-fonts

dd
  h3#basic_lang {{ $t('setting__basic_lang') }}
  div.setting-options
    base-checkbox.gap-left(
      v-for="item in langList" :id="`setting_lang_${item.locale}`" :key="item.locale" name="setting_lang"
      need :model-value="appSetting['common.langId']" :value="item.locale" :label="item.name" @update:model-value="updateSetting({'common.langId': $event})")

dd
  h3#basic_sourcename {{ $t('setting__basic_sourcename') }}
  div.setting-options
    base-checkbox.gap-left(
      v-for="item in sourceNameTypes" :id="`setting_abasic_sourcename_${item.id}`" :key="item.id"
      name="setting_basic_sourcename" need :model-value="appSetting['common.sourceNameType']" :value="item.id" :label="item.label" @update:model-value="updateSetting({'common.sourceNameType': $event})")
dd
  h3#basic_control_btn_position {{ $t('setting__basic_control_btn_position') }}
  div.setting-options
    base-checkbox.gap-left(
      v-for="item in controlBtnPositionList" :id="`setting_basic_control_btn_position_${item.id}`" :key="item.id"
      name="setting_basic_control_btn_position" need :model-value="appSetting['common.controlBtnPosition']" :value="item.id" :label="item.name" @update:model-value="updateSetting({'common.controlBtnPosition': $event})")
dd
  h3#basic_playbar_progress_style {{ $t('setting__basic_playbar_progress_style') }}
  div.setting-options
    base-checkbox.gap-left(
      id="setting_basic_playbar_progress_style_mini" name="setting_basic_playbar_progress_style"
      need :model-value="appSetting['common.playBarProgressStyle']" value="mini" :label="$t('setting__basic_playbar_progress_style_mini')" @update:model-value="updateSetting({'common.playBarProgressStyle': $event})")
    base-checkbox.gap-left(
      id="setting_basic_playbar_progress_style_middle" name="setting_basic_playbar_progress_style"
      need :model-value="appSetting['common.playBarProgressStyle']" value="middle" :label="$t('setting__basic_playbar_progress_style_middle')" @update:model-value="updateSetting({'common.playBarProgressStyle': $event})")
    base-checkbox.gap-left(
      id="setting_basic_playbar_progress_style_full" name="setting_basic_playbar_progress_style"
      need :model-value="appSetting['common.playBarProgressStyle']" value="full" :label="$t('setting__basic_playbar_progress_style_full')" @update:model-value="updateSetting({'common.playBarProgressStyle': $event})")

ThemeSelectorModal(v-model="isShowThemeSelectorModal")
ThemeEditModal(v-model="isShowThemeEditModal" :theme-id="editThemeId" @submit="handleRefreshTheme")
play-timeout-modal(v-model="isShowPlayTimeoutModal")
user-api-modal(v-model="isShowUserApiModal")
quality-check-modal(v-model="isShowQualityCheckModal")
</template>

<script>
import { formatError } from '@common/utils/errorMessage'
import { computed, ref, watch, reactive, shallowReactive } from '@common/utils/vueTools'
import { windowSizeList, userApi, isFullscreen, themeId, themeInfo } from '@renderer/store'
import { langList, useI18n } from '@root/lang'
import { saveTheme, showSelectDialog } from '@renderer/utils/ipc'
import apiSourceInfo from '@renderer/utils/musicSdk/api-source-info'
import { useTimeout } from '@renderer/core/player/timeoutStop'
import { dialog } from '@renderer/plugins/Dialog'
import { checkPath, createDir, joinPath, readLxConfigFile, saveStrToFile } from '@common/utils/nodejs'
import { isUrl } from '@common/utils/common'

import ThemeSelectorModal from './ThemeSelectorModal.vue'
import ThemeEditModal from './ThemeEditModal/index.vue'
import PlayTimeoutModal from './PlayTimeoutModal.vue'
import UserApiModal from './UserApiModal.vue'
import QualityCheckModal from './QualityCheckModal.vue'
import SettingFonts from './SettingFonts.vue'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { getThemes, applyTheme, findTheme, buildBgUrl } from '@renderer/store/utils'

export default {
  name: 'SettingBasic',
  components: {
    ThemeSelectorModal,
    ThemeEditModal,
    PlayTimeoutModal,
    UserApiModal,
    QualityCheckModal,
    SettingFonts,
  },
  props: {
    searchKeyword: { type: String, default: '' },
  },
  setup(props) {
    const t = useI18n()

    const showAllTheme = ref(false)
    const showThemeOptions = computed(() => showAllTheme.value || !!props.searchKeyword.trim())
    const defaultThemesRaw = shallowReactive([])
    const defaultThemes = computed(() => {
      return defaultThemesRaw.map(theme => ({ ...theme, isDefault: true, name: t('theme_' + theme.id) }))
    })
    const userThemes = shallowReactive([])
    const allThemes = computed(() => {
      return [...defaultThemes.value, ...userThemes]
    })
    const themeList = computed(() => {
      if (!allThemes.value.length) return []
      return showThemeOptions.value
        ? allThemes.value
        : themeId.value == 'auto'
          ? []
          : [allThemes.value.find(t => t.id == themeId.value) ?? allThemes.value[0]]
    })
    const autoTheme = reactive({})
    const updateAutoTheme = (info) => {
      let light = findTheme(info, appSetting['theme.lightId'])
      light ??= info.themes.find(theme => theme.id == 'green')
      let dark = findTheme(info, appSetting['theme.darkId'])
      dark ??= info.themes.find(theme => theme.id == 'black')
      autoTheme['--color-primary-theme-light'] = light.config.themeColors['--color-theme']
      autoTheme['--background-image-theme-light'] = light.isCustom
        ? light.config.extInfo['--background-image'] == 'none'
          ? 'none'
          : buildBgUrl(light.config.extInfo['--background-image'], info.dataPath)
        : light.config.extInfo['--background-image']
      autoTheme['--color-primary-theme-dark'] = dark.config.themeColors['--color-theme']
      autoTheme['--background-image-theme-dark'] = dark.isCustom
        ? dark.config.extInfo['--background-image'] == 'none'
          ? 'none'
          : buildBgUrl(dark.config.extInfo['--background-image'], info.dataPath)
        : dark.config.extInfo['--background-image']
    }

    let dataPath = ''
    const init = () => {
      getThemes((info) => {
        // console.log(info)
        dataPath = info.dataPath
        defaultThemesRaw.splice(0, defaultThemesRaw.length, ...info.themes.map(t => {
          return {
            id: t.id,
            styles: {
              '--color-primary-theme': t.config.themeColors['--color-theme'],
              '--background-image-theme': t.config.extInfo['--background-image'],
            },
          }
        }))
        userThemes.splice(0, userThemes.length, ...info.userThemes.map(t => {
          return {
            id: t.id,
            name: t.name,
            styles: {
              '--color-primary-theme': t.config.themeColors['--color-theme'],
              '--background-image-theme': t.config.extInfo['--background-image'] == 'none'
                ? 'none'
                : buildBgUrl(t.config.extInfo['--background-image'], info.dataPath),
            },
          }
        }))
        updateAutoTheme(info)
      })
    }
    const editThemeId = ref('')
    const handleEditTheme = (theme) => {
      // console.log(theme)
      if (theme?.isDefault) return
      if (!theme && userThemes.length >= 10) {
        void dialog({
          message: t('theme_max_tip'),
          confirmButtonText: t('alert_button_text'),
        })
        return
      }
      editThemeId.value = theme ? theme.id : ''
      isShowThemeEditModal.value = true
    }
    const handleRefreshTheme = () => {
      init()
    }
    const handleImportTheme = async() => {
      if (userThemes.length >= 10) {
        void dialog({
          message: t('theme_max_tip'),
          confirmButtonText: t('alert_button_text'),
        })
        return
      }
      const result = await showSelectDialog({
        title: t('theme_import_desc'),
        properties: ['openFile'],
        filters: [
          { name: 'Theme', extensions: ['lxmc', 'json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })
      if (result.canceled || !result.filePaths.length) return
      let theme
      let importError
      try {
        const data = await readLxConfigFile(result.filePaths[0])
        theme = data?.type == 'theme' ? data.theme : data
      } catch (err) {
        importError = err
        theme = null
      }
      if (!theme?.config?.themeColors || !theme?.config?.extInfo) {
        void dialog.error({
          message: formatError(importError ?? { code: 'THEME_INVALID_DATA', message: t('theme_import_failed') }, '', 'THEME_LOAD_FAILED'),
          confirmButtonText: t('alert_button_text'),
        })
        return
      }
      const baseTheme = themeInfo.themes[0]
      const newTheme = {
        id: 'user_theme_' + Date.now(),
        name: String(theme.name ?? '').substring(0, 20) || t('theme_import_default_name'),
        isDark: !!theme.isDark,
        isDarkFont: !!theme.isDarkFont,
        isCustom: true,
        config: {
          themeColors: { ...baseTheme?.config.themeColors, ...theme.config.themeColors },
          extInfo: { ...baseTheme?.config.extInfo, ...theme.config.extInfo },
        },
      }
      const bg = newTheme.config.extInfo['--background-image']
      if (typeof bg == 'string' && bg.startsWith('data:image/')) {
        const match = /^data:image\/([\w.+-]+);base64,([\s\S]+)$/.exec(bg)
        if (match) {
          try {
            const ext = match[1].toLowerCase().replace('svg+xml', 'svg').replace('jpeg', 'jpg')
            const fileName = `${newTheme.id}.${ext}`
            if (!await checkPath(dataPath)) await createDir(dataPath)
            await saveStrToFile(joinPath(dataPath, fileName), Buffer.from(match[2], 'base64'))
            newTheme.config.extInfo['--background-image'] = fileName
          } catch (err) {
            importError = err
            newTheme.config.extInfo['--background-image'] = 'none'
          }
        } else {
          newTheme.config.extInfo['--background-image'] = 'none'
        }
      } else if (bg != 'none' && !isUrl(bg)) {
        newTheme.config.extInfo['--background-image'] = 'none'
      }
      themeInfo.userThemes.push(newTheme)
      await saveTheme(newTheme)
      init()
      void dialog({
        message: importError && appSetting['common.showErrorDialog'] ? formatError(importError, t('theme_import_success'), 'THEME_BACKGROUND_LOAD_FAILED') : t('theme_import_success'),
        confirmButtonText: t('alert_button_text'),
      })
    }
    init()
    const toggleTheme = (theme) => {
      if (themeId.value == theme.id) return
      themeId.value = theme.id
      applyTheme(theme.id, appSetting['theme.lightId'], appSetting['theme.darkId'], dataPath)
      void updateSetting({ 'theme.id': theme.id })
    }

    watch(() => [appSetting['theme.lightId'], appSetting['theme.darkId']], () => {
      getThemes(updateAutoTheme)
    })
    const isShowThemeSelectorModal = ref(false)
    const handleSetThemeAuto = () => {
      if (themeId.value == 'auto') return
      if (window.localStorage.getItem('theme-auto-tip') != 'true') {
        window.localStorage.setItem('theme-auto-tip', 'true')
        void dialog({
          message: t('setting__basic_theme_auto_tip'),
          confirmButtonText: t('ok'),
        })
      }
      toggleTheme({ id: 'auto' })
    }
    const isShowThemeEditModal = ref(false)

    const isShowPlayTimeoutModal = ref(false)
    const { timeLabel } = useTimeout()

    const isShowUserApiModal = ref(false)
    const isShowQualityCheckModal = ref(false)
    const getApiStatus = () => {
      let status
      if (userApi.status) status = t('setting__basic_source_status_success')
      else if (userApi.message == 'initing') status = t('setting__basic_source_status_initing')
      else status = `${t('setting__basic_source_status_failed')}\n${userApi.message ? userApi.message : formatError(null, '', 'SOURCE_LOAD_FAILED')}`

      return status
    }
    const apiSources = computed(() => {
      return [
        ...apiSourceInfo.map(api => ({
          id: api.id,
          name: api.name,
          label: api.name,
          disabled: api.disabled,
        })),
        ...userApi.list.map(api => ({
          id: api.id,
          name: api.name,
          label: `${api.name}${api.id == appSetting['common.apiSource'] ? `[${getApiStatus()}]` : ''}`,
          desc: [/^\d/.test(api.version) ? `v${api.version}` : api.version].filter(Boolean).join(', '),
          statusLabel: api.id == appSetting['common.apiSource'] ? `[${getApiStatus()}]` : '',
          status: api.status,
          message: api.message,
          disabled: false,
        })),
      ]
    })

    const sourceNameTypes = computed(() => {
      return [
        { id: 'real', label: t('setting__basic_sourcename_real') },
        { id: 'alias', label: t('setting__basic_sourcename_alias') },
      ]
    })


    const controlBtnPositionList = computed(() => {
      return [
        { id: 'left', name: t('setting__basic_control_btn_position_left') },
        { id: 'right', name: t('setting__basic_control_btn_position_right') },
      ]
    })

    const fontSizeList = computed(() => {
      return [
        { id: 14, label: t('setting__basic_font_size_14px') },
        { id: 15, label: t('setting__basic_font_size_15px') },
        { id: 16, label: t('setting__basic_font_size_16px') },
        { id: 17, label: t('setting__basic_font_size_17px') },
        { id: 18, label: t('setting__basic_font_size_18px') },
        { id: 19, label: t('setting__basic_font_size_19px') },
      ]
    })


    return {
      appSetting,
      updateSetting,
      userThemes,
      autoTheme,
      showAllTheme,
      showThemeOptions,
      themeList,
      // currentStting,
      // themes,
      // themeClassName,
      isShowThemeSelectorModal,
      isShowThemeEditModal,
      handleSetThemeAuto,
      isShowPlayTimeoutModal,
      timeLabel,
      apiSources,
      isShowUserApiModal,
      isShowQualityCheckModal,
      windowSizeList,
      langList,
      sourceNameTypes,
      controlBtnPositionList,
      isFullscreen,
      toggleTheme,
      themeId,
      handleRefreshTheme,
      handleImportTheme,
      editThemeId,
      handleEditTheme,
      fontSizeList,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.theme {
  display: flex;
  flex-flow: row wrap;
  // padding: 0 15px;
  margin-bottom: -20px;

  .themeItem {
    display: flex;
    flex-flow: column nowrap;
    align-items: center;
    cursor: pointer;
    // color: var(--color-primary);
    margin-right: 8px;
    transition: .3s ease;
    transition-property: color, opacity;
    margin-bottom: 18px;
    width: 86px;

    &:hover {
      opacity: .7;
    }

    &:last-child {
      margin-right: 0;
    }

    &.active {
      color: var(--color-primary-font-active);
      .bg {
        border-color: var(--color-primary-font-active);
      }

      &:hover {
        opacity: 1;
      }
    }

    .bg {
      display: block;
      width: 36px;
      height: 36px;
      margin-bottom: 5px;
      border: 2Px solid transparent;
      padding: 2Px;
      transition: border-color .3s ease;
      border-radius: 5px;
      &:after {
        display: block;
        content: ' ';
        width: 100%;
        height: 100%;
        border-radius: @radius-border;
        background-position: center;
        background-size: cover;
        background-repeat: no-repeat;
        background-color: var(--color-primary-theme);
        background-image: var(--background-image-theme);
      }
    }

    .label {
      width: 100%;
      text-align: center;
      height: 1.2em;
    }

    &.auto {

      &.active {
        color: var(--color-primary-font-active);
        .bg {
          border-color: var(--color-primary-font-active);
        }
      }

      >.bg {
        &:after {
          content: none;
        }
      }
      .bgContent {
        position: relative;
        height: 100%;
        overflow: hidden;
        border-radius: 5px;
      }
      .light, .dark {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        &:after {
          display: block;
          content: ' ';
          width: 100%;
          height: 100%;
          background-position: center;
          background-size: cover;
          background-repeat: no-repeat;
        }
      }
      .light {
        &:after {
          clip-path: polygon(0 0, 100% 0, 0 100%);
        }
        svg {
          fill: var(--color-primary-theme-light);
        }
        &:after {
          background-color: var(--color-primary-theme-light);
          background-image: var(--background-image-theme-light);
        }
      }
      .dark {
        &:after {
          clip-path: polygon(0 100%, 100% 0, 100% 100%);
        }
        svg {
          fill: var(--color-primary-theme-dark);
        }
        &:after {
          background-color: var(--color-primary-theme-dark);
          background-image: var(--background-image-theme-dark);
        }
      }
    }

    &.add {
      >.bg {
        &:after {
          content: none;
        }
        .bgContent {
          transition: .3s ease;
          transition-property: border, color;
          box-sizing: border-box;
          border: 1Px dashed var(--color-primary-light-100-alpha-300);
          color: var(--color-primary-light-100-alpha-300);
          position: relative;
          height: 100%;
          overflow: hidden;
          border-radius: 5px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .icon {
          // position: absolute;
          // font-size: 16px;
          width: 66%;
          height: auto;
        }
      }
      .label {
        color: var(--color-primary-dark-100-alpha-300);
      }
    }

    &.moreThme {
      flex-direction: row;
      width: auto;
      gap: 5px;
      color: var(--color-primary-font-active);
      .label {
        height: auto;
      }
    }
  }
}

.sourceLabel {
  flex: auto;
  margin-left: 5px;
  line-height: 1.5;
  cursor: pointer;

  .desc {
    color: var(--color-500);
    font-size: 12px;
    margin-left: 5px;
  }

  .status {
    margin-left: 5px;
  }
}

</style>
