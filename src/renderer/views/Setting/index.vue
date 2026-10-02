<template>
  <div :class="$style.main">
    <common-resizable-sidebar name="setting" :label="$t('setting')">
      <div :class="$style.searchBox">
        <svg :class="$style.searchIcon" viewBox="0 0 30.239 30.239" aria-hidden="true">
          <use xlink:href="#icon-search" />
        </svg>
        <base-input
          ref="dom_filter_input" v-model="settingFilter" :class="$style.searchInput"
          :trim="false" :placeholder="$t('setting__filter_placeholder')" :aria-label="$t('setting__filter_placeholder')"
          autocomplete="off" :spellcheck="false"
          @compositionstart="isComposing = true" @compositionend="finishFilterComposition"
          @keydown="handleFilterKeydown"
        />
        <button
          v-if="settingFilter" type="button" :class="$style.clearSearchBtn"
          :aria-label="$t('setting__filter_clear')" @click="clearSettingFilter"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <use xlink:href="#icon-window-close" />
          </svg>
        </button>
      </div>
      <div ref="dom_toc_ref" class="scroll" :class="$style.tocScroll" data-setting-navigation>
        <ul v-if="visibleTocList.length" :class="$style.tocList" role="tablist" aria-orientation="vertical">
          <li v-for="h2 in visibleTocList" :key="h2.id" :class="$style.tocListItem" role="presentation">
            <h2
              :class="[$style.tocH2, {[$style.active]: avtiveComponentName == h2.id }]"
              role="tab" :aria-selected="avtiveComponentName == h2.id"
              :tabindex="avtiveComponentName == h2.id ? 0 : -1" :data-setting-tab="h2.id"
              :aria-label="h2.title" ignore-tip @click="toggleTab(h2.id)"
              @keydown="handleTabKeydown($event, h2.id)"
            >
              <transition name="list-active">
                <svg-icon v-if="avtiveComponentName == h2.id" name="angle-right-solid" :class="$style.activeIcon" />
              </transition>
              {{ h2.title }}
            </h2>
            <!-- <ul v-if="h2.children.length" :class="$style.tocList">
              <li v-for="h3 in h2.children" :key="h3.id" :class="$style.tocSubListItem">
                <h3 :class="[$style.tocH3, toc.activeId == h3.id ? $style.active : null]" :aria-label="h3.title">
                  <a :href="'#' + h3.id" @click.stop="toc.activeId = h3.id">{{ h3.title }}</a>
                </h3>
              </li>
            </ul> -->
          </li>
        </ul>
        <p v-else :class="$style.searchEmpty">{{ $t('setting__filter_empty') }}</p>
      </div>
    </common-resizable-sidebar>
    <common-motion-view :motion-key="avtiveComponentName" :distance="24">
      <div ref="dom_content_ref" class="scroll" :class="[$style.setting, {[$style.searchFiltering]: isFiltering}]" data-setting-content @wheel.passive="cancelScrollRestore" @pointerdown="cancelScrollRestore" @keydown="cancelScrollRestore">
      <p v-if="isFiltering && !visibleTocList.length" :class="$style.contentEmpty">{{ $t('setting__filter_empty') }}</p>
      <dl v-show="visibleTocList.length">
        <component :is="avtiveComponentName" v-bind="avtiveComponentName == 'SettingBasic' ? { searchKeyword: filterQuery } : avtiveComponentName == 'SettingPluginStore' ? { pluginId: requestedPluginId } : {}" />
        <!-- <SettingBasic />
        <SettingPlay />
        <SettingPlayDetail />
        <SettingDesktopLyric />
        <SettingSearch />
        <SettingList />
        <SettingDownload />
        <SettingSync />
        <SettingHotKey />
        <SettingNetwork />
        <SettingOdc />
        <SettingBackup />
        <SettingOther />
        <SettingUpdate />
        <SettingAbout /> -->
      </dl>
      </div>
    </common-motion-view>
  </div>
</template>

<script>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from '@common/utils/vueTools'
// import { currentStting } from './setting'
import { useI18n } from '@renderer/plugins/i18n'
import { useRoute } from '@common/utils/vueRouter'
import { pluginText } from '@common/optionalPlugins'
import { builtinPlugins, getBuiltinPlugin } from '@common/builtinPlugins'
import { pluginStore } from '@renderer/store/optionalPlugins'
import { appSetting } from '@renderer/store/setting'
import { isMac, isLinux } from '@common/utils'
import { userApi, themeInfo } from '@renderer/store'
import { langList } from '@root/lang'
import apiSourceInfo from '@renderer/utils/musicSdk/api-source-info'
import { SOURCE_NAME } from '@renderer/utils/cookieManager'
import { createSearchIndex, matchSearchIndex, matchesSearchKey, matchesSearchText, normalizeSearchText, searchTerms } from './search'
import { settingSession } from './session'

import SettingBasic from './components/SettingBasic.vue'
import SettingPlay from './components/SettingPlay.vue'
import SettingPluginStore from './components/SettingPluginStore.vue'
import SettingPlayDetail from './components/SettingPlayDetail.vue'
import SettingDesktopLyric from './components/SettingDesktopLyric.vue'
import SettingSearch from './components/SettingSearch.vue'
import SettingList from './components/SettingList.vue'
import SettingDownload from './components/SettingDownload.vue'
import SettingSync from './components/SettingSync/index.vue'
import SettingOpenAPI from './components/SettingOpenAPI.vue'
import SettingHotKey from './components/SettingHotKey.vue'
import SettingNetwork from './components/SettingNetwork.vue'
import SettingCookie from './components/SettingCookie.vue'
import SettingAdvanced from './components/SettingAdvanced.vue'
import SettingBackup from './components/SettingBackup.vue'
import SettingOther from './components/SettingOther.vue'
import SettingUpdate from './components/SettingUpdate.vue'
import SettingAbout from './components/SettingAbout.vue'

export default {
  name: 'Setting',
  components: {
    SettingBasic,
    SettingPlay,
    SettingPluginStore,
    SettingPlayDetail,
    SettingDesktopLyric,
    SettingSearch,
    SettingList,
    SettingDownload,
    SettingSync,
    SettingOpenAPI,
    SettingHotKey,
    SettingNetwork,
    SettingCookie,
    SettingAdvanced,
    SettingBackup,
    SettingOther,
    SettingUpdate,
    SettingAbout,
  },
  setup() {
    const t = useI18n()
    const route = useRoute()

    const dom_content_ref = ref(null)
    const dom_filter_input = ref(null)
    const dom_toc_ref = ref(null)
    const settingFilter = ref('')
    const filterQuery = ref('')
    const isComposing = ref(false)
    const customThemeEntries = ref([])
    let customThemeNames = ''
    watch(settingFilter, value => {
      if (!isComposing.value) filterQuery.value = value
      const names = JSON.stringify(themeInfo.userThemes.map(theme => theme.name))
      if (names !== customThemeNames) {
        customThemeNames = names
        customThemeEntries.value = themeInfo.userThemes.map(theme => ({ key: 'theme_custom', text: theme.name }))
      }
    })
    const finishFilterComposition = event => {
      isComposing.value = false
      settingFilter.value = filterQuery.value = event.target.value
    }

    const pluginSearchEntries = computed(() => {
      const snapshot = pluginStore.value
      const catalog = new Map(snapshot.catalog.map(plugin => [plugin.id, plugin]))
      return [...new Set([...builtinPlugins.map(plugin => plugin.id), ...catalog.keys(), ...Object.keys(snapshot.installed), ...Object.keys(snapshot.errors)])].map(id => {
        const installed = snapshot.installed[id]
        const local = installed?.source === 'local' || snapshot.sources?.[id] === 'local'
        const display = getBuiltinPlugin(id) ?? (local ? installed?.manifest : catalog.get(id) ?? installed?.manifest)
        return {
          key: `plugin-card:${id}`,
          text: `${id} ${Object.keys(window.i18n.messages).map(language => {
            return `${pluginText(display?.name, language, id)} ${pluginText(display?.description, language)}`
          }).join(' ')}`,
        }
      })
    })

    const tocList = computed(() => {
      return [
        {
          id: 'SettingBasic',
          title: t('setting__basic'),
          prefixes: ['setting__basic', 'theme'],
          keys: ['setting__play_timeout'],
          entries: [
            ...customThemeEntries.value,
            ...[...apiSourceInfo, ...userApi.list].map(source => ({ key: 'setting__basic_source', text: source.name })),
            ...langList.map(language => ({ key: 'setting__basic_lang', text: language.name })),
          ],
        },
        { id: 'SettingPlay', title: t('setting__play'), prefixes: ['setting__play', 'setting__player'], excludes: ['setting__play_detail', 'setting__play_timeout', ...(!isMac ? ['setting__play_statusbar_lyric'] : [])] },
        { id: 'SettingPluginStore', title: t('setting__plugins'), prefixes: ['setting__plugins'], keys: ['audio_visualization', 'setting__desktop_lyric_audio_visualization'], entries: pluginSearchEntries.value },
        { id: 'SettingPlayDetail', title: t('setting__play_detail'), prefixes: ['setting__play_detail'] },
        { id: 'SettingDesktopLyric', title: t('setting__desktop_lyric'), prefixes: ['setting__desktop_lyric'], keys: ['desktop_lyric__lrc_active_zoom_on'], excludes: ['setting__desktop_lyric_audio_visualization', ...(isLinux ? ['setting__desktop_lyric_hover_hide'] : [])] },
        { id: 'SettingSearch', title: t('setting__search'), prefixes: ['setting__search', 'setting__odc_clear_search'] },
        { id: 'SettingList', title: t('setting__list'), prefixes: ['setting__list'] },
        { id: 'SettingDownload', title: t('setting__download'), prefixes: ['setting__download'], keys: ['setting_download_save_group_list_name', 'setting__is_enable'] },
        { id: 'SettingHotKey', title: t('setting__hot_key'), prefixes: ['setting__hot_key'], keys: ['setting__is_enable'] },
        { id: 'SettingSync', title: t('setting__sync'), prefixes: ['setting__sync'] },
        { id: 'SettingOpenAPI', title: t('setting__open_api'), prefixes: ['setting__open_api'] },
        { id: 'SettingNetwork', title: t('setting__network'), prefixes: ['setting__network'], keys: ['setting__is_enable'] },
        { id: 'SettingCookie', title: t('setting__cookie'), prefixes: ['setting__cookie'], searchText: 'Cookie', entries: Object.entries(SOURCE_NAME).map(([id, name]) => ({ key: `setting__cookie_source_${id}`, text: `Cookie ${name} ${id}` })) },
        { id: 'SettingAdvanced', title: t('setting__advanced'), prefixes: ['setting__advanced'], excludes: ['setting__advanced_window_controls'] },
        { id: 'SettingBackup', title: t('setting__backup'), prefixes: ['setting__backup'] },
        { id: 'SettingOther', title: t('setting__other'), prefixes: ['setting__other'] },
        { id: 'SettingUpdate', title: t('setting__update'), prefixes: ['setting__update'] },
        { id: 'SettingAbout', title: t('setting__about'), prefixes: ['setting__about'] },
      ]
    })

    const translatedMessages = computed(() => {
      // Use the same fallback as rendering. Other installed UI languages are
      // searchable too, so Chinese/English terms work after switching locale.
      void appSetting['common.langId']
      const result = {}
      for (const messages of Object.values(window.i18n.messages)) {
        for (const [key, value] of Object.entries(messages)) (result[key] ??= []).push(value)
      }
      return result
    })
    const searchIndex = computed(() => createSearchIndex(tocList.value, translatedMessages.value))
    const headingKeys = computed(() => {
      void appSetting['common.langId']
      const result = new Map()
      for (const key of Object.keys(translatedMessages.value)) {
        const text = normalizeSearchText(t(key))
        if (!text) continue
        if (!result.has(text)) result.set(text, [])
        result.get(text).push(key)
      }
      return result
    })
    const isFiltering = computed(() => !!normalizeSearchText(filterQuery.value))
    const matchedGroups = computed(() => matchSearchIndex(searchIndex.value, filterQuery.value))
    const visibleTocList = computed(() => {
      if (!isFiltering.value) return tocList.value
      return tocList.value.filter(group => matchedGroups.value.has(group.id))
    })

    const legacyPluginId = name => typeof name === 'string' && name.startsWith('SettingPlugin_') ? name.slice('SettingPlugin_'.length) : ''
    const resolveRequestedTab = name => tocList.value.find(tab => tab.id === name)?.id ?? (legacyPluginId(name) ? 'SettingPluginStore' : null)
    const requestedPluginId = computed(() => typeof route.query.plugin === 'string' && route.query.plugin ? route.query.plugin : legacyPluginId(route.query.name))
    const requestedTab = resolveRequestedTab(route.query.name)
    const savedView = !requestedTab ? settingSession.current : null
    const rememberedView = savedView && tocList.value.some(tab => tab.id === savedView.id) ? savedView : null
    const avtiveComponentName = ref(requestedTab ?? rememberedView?.id ?? (savedView ? 'SettingPluginStore' : tocList.value[0].id))
    settingFilter.value = filterQuery.value = rememberedView?.query ?? ''

    let disposed = false
    let restoreRevision = 0
    let pendingScrollTop = null
    const currentScrollTop = () => pendingScrollTop ?? dom_content_ref.value?.scrollTop ?? 0
    const cancelScrollRestore = () => { ++restoreRevision; pendingScrollTop = null }
    const restoreScroll = () => {
      const content = dom_content_ref.value
      if (disposed || pendingScrollTop == null || !content) return
      content.scrollTop = pendingScrollTop
      // Async plugin content may not be tall enough on the first render.
      // Stop retrying once the position is reachable, or as soon as the user interacts.
      if (content.scrollHeight - content.clientHeight >= pendingScrollTop) pendingScrollTop = null
    }
    const restorePosition = (top, sidebarTop) => {
      const revision = ++restoreRevision
      pendingScrollTop = top
      void nextTick(() => {
        if (disposed || revision !== restoreRevision) return
        applySettingFilter()
        restoreScroll()
        if (sidebarTop != null && dom_toc_ref.value) dom_toc_ref.value.scrollTop = sidebarTop
      })
    }
    const rememberTabPosition = () => {
      if (!lastQuery) settingSession.tabPositions.set(avtiveComponentName.value, currentScrollTop())
    }

    const markedElements = new Set()
    const clearSettingFilterState = () => {
      for (const element of markedElements) element.classList.remove('setting-search-visible', 'setting-search-branch')
      markedElements.clear()
    }
    const markSearchBranch = (element) => {
      if (!element) return
      element.classList.add('setting-search-branch')
      let parent = element
      while (parent && parent !== dom_content_ref.value) {
        parent.classList.add('setting-search-visible')
        markedElements.add(parent)
        parent = parent.parentElement
      }
    }
    const applySettingFilter = () => {
      clearSettingFilterState()
      const terms = searchTerms(filterQuery.value)
      if (!terms.length || !dom_content_ref.value) return

      const match = matchedGroups.value.get(avtiveComponentName.value)
      if (!match) return
      if (match.full) {
        markSearchBranch(dom_content_ref.value.querySelector('dl'))
        return
      }

      // Use the same matched keys as the navigation, including help text and
      // options inside dialogs. Prefer the most specific setting section.
      const localTexts = match.keys.map(key => {
        const text = window.i18n.getMessage(key)
        return text === key ? '' : normalizeSearchText(text.replace(/\{[^}]+\}/g, ''))
      }).filter(Boolean)
      const sections = [...dom_content_ref.value.querySelectorAll('h3, h4, [data-setting-search]')].map(element => ({
        element,
        prefixes: [
          ...(element.dataset.settingSearch ?? '').split(/\s+/).filter(Boolean),
          ...(element.id ? [element.id.startsWith('setting__') ? element.id : `setting__${element.id}`] : []),
          // A heading's translation is more reliable than legacy DOM IDs.
          ...(headingKeys.value.get(normalizeSearchText(element.textContent)) ?? []),
        ],
      }))
      for (const key of match.keys) {
        const related = sections.map(section => ({
          ...section,
          length: Math.max(0, ...section.prefixes.filter(prefix => matchesSearchKey(key, prefix)).map(prefix => prefix.length)),
        }))
        const longest = Math.max(0, ...related.map(section => section.length))
        if (longest) {
          for (const { element, length } of related) {
            if (length == longest) markSearchBranch(element.closest('[data-setting-search]') ?? element.closest('dd') ?? element)
          }
        }
      }

      const groupTitle = searchIndex.value.find(group => group.id === avtiveComponentName.value)?.title ?? ''
      const getElementText = element => normalizeSearchText(`${element.textContent ?? ''} ${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('title') ?? ''} ${element.getAttribute('placeholder') ?? ''}`)
      const elements = [...dom_content_ref.value.querySelectorAll('dt, h3, h4, label, p, button, span, li, a, td, th, dd > div, [aria-label], [title], [placeholder]')]
      const matchingElements = elements.filter(element => {
        const text = getElementText(element)
        return matchesSearchText(`${groupTitle} ${text}`, terms) || localTexts.some(local => text.includes(local))
      })
      const targets = matchingElements.filter(element => !matchingElements.some(child => child !== element && element.contains(child)))

      const pageTitle = dom_content_ref.value.querySelector('dl > dt')
      markSearchBranch(pageTitle)
      if (targets.some(target => target.tagName == 'DT')) {
        markSearchBranch(pageTitle?.parentElement)
        return
      }

      for (const target of targets) {
        const section = target.closest('dd')
        let itemRoot
        if (target.closest('[data-setting-search]')) {
          itemRoot = target.closest('[data-setting-search]')
        } else if (target.tagName == 'H3' || section?.querySelector(':scope > h3, :scope > [data-setting-reveal-content] > h3')) {
          // 命中组内选项时保留整组，便于查看和切换其他选项。
          itemRoot = section
        } else if (target.tagName == 'H4') {
          itemRoot = target.parentElement
        } else {
          const control = target.closest('label, button, p')
          itemRoot = target.closest('.gap-top, .p') ?? (control?.tagName == 'LABEL' ? control.parentElement : control ?? target)
        }
        markSearchBranch(itemRoot)

        markSearchBranch(section?.querySelector(':scope > h3, :scope > [data-setting-reveal-content] > h3'))
      }
      // Dependent controls keep the switch/mode that makes them available.
      for (const element of dom_content_ref.value.querySelectorAll('[data-setting-search-depends]')) {
        if (!element.classList.contains('setting-search-visible') && !element.closest('.setting-search-branch')) continue
        for (const id of element.dataset.settingSearchDepends.split(/\s+/)) {
          const control = document.getElementById(id)
          if (control && dom_content_ref.value.contains(control)) markSearchBranch(control.closest('.gap-top, dd') ?? control)
        }
      }
      // A conditional control may not exist yet. Keep the page's controls
      // available so a matching category never opens to just an empty title.
      if (!dom_content_ref.value.querySelector('dd.setting-search-visible')) {
        markSearchBranch(pageTitle?.parentElement)
      }
    }
    const toggleTab = (id, top) => {
      rememberTabPosition()
      avtiveComponentName.value = id
      restorePosition(top ?? (isFiltering.value ? 0 : settingSession.tabPositions.get(id) ?? 0))
    }
    const clearSettingFilter = () => {
      isComposing.value = false
      settingFilter.value = filterQuery.value = ''
      clearSettingFilterState()
      void nextTick(() => dom_filter_input.value?.focus())
    }

    let searchOrigin = rememberedView?.searchOrigin ?? null
    let lastQuery = normalizeSearchText(filterQuery.value)
    watch(() => route.query.name, (name) => {
      const tab = resolveRequestedTab(name)
      if (tab) {
        searchOrigin = null
        settingFilter.value = filterQuery.value = ''
        toggleTab(tab, 0)
      }
    })

    watch([visibleTocList, filterQuery], ([list, query]) => {
      const normalized = normalizeSearchText(query)
      const queryChanged = normalized !== lastQuery
      if (normalized && !lastQuery) {
        rememberTabPosition()
        searchOrigin = { id: avtiveComponentName.value, top: currentScrollTop(), sidebarTop: dom_toc_ref.value?.scrollTop ?? 0 }
      }
      const restore = !normalized && lastQuery ? searchOrigin : null
      const previousTab = avtiveComponentName.value
      if (restore && tocList.value.some(group => group.id === restore.id)) avtiveComponentName.value = restore.id
      if (!normalized) searchOrigin = null
      lastQuery = normalized
      if (!tocList.value.some(group => group.id === avtiveComponentName.value)) {
        avtiveComponentName.value = 'SettingPluginStore'
      }
      if (isFiltering.value && list.length && !list.some(group => group.id == avtiveComponentName.value)) {
        avtiveComponentName.value = list[0].id
      }
      if (queryChanged || previousTab !== avtiveComponentName.value) restorePosition(restore?.top ?? 0, restore?.sidebarTop)
      else void nextTick(() => { if (!disposed) applySettingFilter() })
    })

    // Alt + ← / Alt + → 切换上一个 / 下一个设置面板
    const goPrevPanel = () => {
      const ids = visibleTocList.value.map(i => i.id)
      const idx = ids.indexOf(avtiveComponentName.value)
      if (idx > 0) toggleTab(ids[idx - 1])
    }
    const goNextPanel = () => {
      const ids = visibleTocList.value.map(i => i.id)
      const idx = ids.indexOf(avtiveComponentName.value)
      if (idx < ids.length - 1) toggleTab(ids[idx + 1])
    }
    const handleKeydown = (e) => {
      if (e.isComposing || isComposing.value || e.keyCode === 229 || window.lx.isEditingHotKey) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLocaleLowerCase() === 'f') {
        const target = e.target
        const isEditingControl = target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable)
        if (isEditingControl && target !== dom_filter_input.value?.$el) {
          e.preventDefault()
          e.stopPropagation()
          return
        }
        e.preventDefault()
        e.stopPropagation()
        dom_filter_input.value?.focus()
        dom_filter_input.value?.$el.select()
        return
      }
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (e.target instanceof HTMLElement && (e.target.matches('input, textarea, select') || e.target.isContentEditable) && e.target !== dom_filter_input.value?.$el) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        e.stopPropagation()
        goPrevPanel()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        e.stopPropagation()
        goNextPanel()
      }
    }
    const focusTab = id => dom_toc_ref.value?.querySelector(`[data-setting-tab="${id}"]`)?.focus()
    const handleTabKeydown = (event, id) => {
      if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
      const ids = visibleTocList.value.map(group => group.id)
      let index = ids.indexOf(id)
      if (event.key === 'ArrowUp') index = Math.max(0, index - 1)
      else if (event.key === 'ArrowDown') index = Math.min(ids.length - 1, index + 1)
      else if (event.key === 'Home') index = 0
      else if (event.key === 'End') index = ids.length - 1
      else if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      event.stopPropagation()
      toggleTab(ids[index])
      void nextTick(() => focusTab(ids[index]))
    }
    const handleFilterKeydown = event => {
      if (event.isComposing || isComposing.value || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        clearSettingFilter()
      } else if (event.key === 'ArrowDown' && visibleTocList.value.length) {
        event.preventDefault()
        focusTab(avtiveComponentName.value)
      } else if (event.key === 'Enter' && visibleTocList.value.length) {
        event.preventDefault()
        const controls = dom_content_ref.value?.querySelectorAll('button, input, select, textarea, [tabindex="0"]') ?? []
        const first = [...controls].find(element => element.getBoundingClientRect().height && !element.closest('[inert]') && !element.disabled && element.getAttribute('aria-disabled') !== 'true')
        first?.focus()
      }
    }
    let filterPending = false
    const contentResizeObserver = new window.ResizeObserver(restoreScroll)
    const searchObserver = new MutationObserver(() => {
      if (!isFiltering.value || filterPending) return
      filterPending = true
      void nextTick(() => {
        filterPending = false
        if (!disposed) applySettingFilter()
      })
    })
    onMounted(() => {
      window.addEventListener('keydown', handleKeydown, true)
      contentResizeObserver.observe(dom_content_ref.value)
      contentResizeObserver.observe(dom_content_ref.value.querySelector('dl'))
      restorePosition(rememberedView?.top ?? 0, rememberedView?.sidebarTop)
      searchObserver.observe(dom_content_ref.value, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['aria-label', 'title', 'placeholder', 'data-setting-search'],
      })
    })
    onBeforeUnmount(() => {
      rememberTabPosition()
      settingSession.current = {
        id: avtiveComponentName.value,
        top: currentScrollTop(),
        sidebarTop: dom_toc_ref.value?.scrollTop ?? 0,
        query: filterQuery.value,
        searchOrigin,
      }
      disposed = true
      cancelScrollRestore()
      contentResizeObserver.disconnect()
      window.removeEventListener('keydown', handleKeydown, true)
      searchObserver.disconnect()
      clearSettingFilterState()
    })

    return {
      visibleTocList,
      isFiltering,
      avtiveComponentName,
      requestedPluginId,
      dom_content_ref,
      dom_filter_input,
      dom_toc_ref,
      settingFilter,
      filterQuery,
      isComposing,
      finishFilterComposition,
      handleFilterKeydown,
      handleTabKeydown,
      cancelScrollRestore,
      toggleTab,
      clearSettingFilter,
    }
  },
  // mounted() {
  //   this.initTOC()
  // },
  // methods: {
  //   initTOC() {
  //     const list = this.$refs.dom_setting_list.children
  //     const toc = []
  //     let prevTitle
  //     for (const item of list) {
  //       if (item.tagName == 'DT') {
  //         prevTitle = {
  //           title: item.innerText.replace(/[（(].+?[)）]/, ''),
  //           id: item.getAttribute('id'),
  //           dom: item,
  //           children: [],
  //         }
  //         toc.push(prevTitle)
  //         continue
  //       }
  //       const h3 = item.querySelector('h3')
  //       if (h3) {
  //         prevTitle.children.push({
  //           title: h3.innerText.replace(/[（(].+?[)）]/, ''),
  //           id: h3.getAttribute('id'),
  //           dom: h3,
  //         })
  //       }
  //     }
  //     console.log(toc)
  //     this.toc.list = toc
  //   },
  //   handleListScroll(event) {
  //     // console.log(event.target.scrollTop)
  //   },
  // },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  display: flex;
  flex-flow: row nowrap;
  height: 100%;
  border-top: var(--color-list-header-border-bottom);
}

.tocScroll {
  flex: auto;
  min-height: 0;
  overflow-y: scroll;
}
.searchBox {
  position: relative;
  flex: none;
  z-index: 2;
  padding: 10px 8px 8px;
  background-color: var(--setting-search-background, var(--color-main-background));
}
.searchIcon {
  position: absolute;
  z-index: 1;
  top: 18px;
  left: 16px;
  width: 13px;
  height: 13px;
  color: var(--color-button-font);
  pointer-events: none;
}
.searchInput {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 26px;
}
.clearSearchBtn {
  position: absolute;
  top: 15px;
  right: 13px;
  width: 20px;
  height: 20px;
  padding: 4px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-button-font);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-standard);

  &:hover {
    background-color: var(--color-button-background-hover);
  }
  &:focus-visible {
    box-shadow: var(--focus-ring);
    outline: none;
  }
  svg {
    width: 100%;
    height: 100%;
  }
}
.searchEmpty {
  padding: 18px 10px;
  color: var(--color-font-label);
  font-size: 12px;
  line-height: 1.5;
  text-align: center;
}
.contentEmpty {
  position: absolute;
  top: 50%;
  left: 0;
  width: 100%;
  color: var(--color-font-label);
  font-size: 13px;
  text-align: center;
  transform: translateY(-50%);
}
.tocH2 {
  line-height: 1.5;
  .mixin-ellipsis-1();
  font-size: 13px;
  color: var(--color-font);
  padding: 8px 10px;
  transition: @transition-fast;
  transition-property: background-color, color;

  &:not(.active) {
    cursor: pointer;
    &:hover {
      background-color: var(--color-button-background-hover);
    }
  }
  &.active {
    color: var(--color-primary);
  }
  &:focus-visible {
    outline: none;
    box-shadow: inset var(--focus-ring);
  }
}
.activeIcon {
  height: .9em;
  width: .9em;
  margin-left: -0.45em;
  vertical-align: -0.05em;
}
// .tocH3 {
//   font-size: 13px;
//   opacity: .8;
// }

// .tocList {
//   .tocList {
//     // padding-left: 15px;
//   }
// }
// .tocSubListItem {
//   padding-top: 10px;
// }

.setting {
  --setting-row-gap: 8px;
  --setting-column-gap: 16px;
  --setting-section-gap: 24px;
  --setting-inset: 16px;
  padding: 0 var(--setting-inset) var(--setting-section-gap);
  font-size: 14px;
  box-sizing: border-box;
  overflow-y: auto;
  height: 100%;
  position: relative;
  width: 100%;

  :global {
    dt {
      border-left: 5px solid var(--color-primary-alpha-700);
      padding: 3px 7px;
      margin: 16px 0;

      + dd h3 {
        margin-top: 0;
      }
    }

    dd {
      // margin-left: 15px;
      // font-size: 13px;
      > div {
        padding: 0 var(--setting-inset);
      }

    }
    h3 {
      font-size: 12px;
      line-height: 1.5;
      margin: var(--setting-section-gap) 0 12px;
    }
    .p {
      padding-top: 0;
      padding-bottom: 0;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }
    .p + .p, .p + .gap-top, .gap-top + .p, .gap-top + .gap-top,
    [data-setting-reveal] + .gap-top, [data-setting-reveal] + .p,
    .p > .p + div {
      margin-top: var(--setting-row-gap);
    }
    .gap-top.top { margin-top: var(--setting-section-gap); }
    // Keep space inside the animated content so collapsed groups leave no extra gap.
    dd [data-setting-reveal] > [data-setting-reveal-content] > :first-child:is(.p, .gap-top),
    dd[data-setting-reveal] > [data-setting-reveal-content] > .p:first-child {
      margin-top: var(--setting-row-gap);
    }
    [role='checkbox'] + span, [role='radio'] + span {
      margin-left: var(--setting-row-gap);
    }
    .setting-row, .setting-options, .setting-actions, .setting-slider-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--setting-row-gap);
      > .gap-left { margin-left: 0; }
      > * { max-width: 100%; }
      > .help-icon { margin: 0; }
    }
    .setting-options { column-gap: var(--setting-column-gap); }
    .setting-slider-row { column-gap: 12px; }
    .setting-label {
      display: inline-flex;
      align-items: center;
      gap: var(--setting-row-gap);
      .help-icon { flex: none; margin: 0; }
    }
    .setting-value { color: var(--color-font-label); font-size: 12px; }
    .setting-slider { width: 200px; max-width: 100%; }
    button[data-motion-button] {
      min-height: 28px;
      max-width: 100%;
      box-sizing: border-box;
      padding: 4px 12px;
      line-height: 1.5;
      vertical-align: middle;
    }
    input:not([type='checkbox']):not([type='radio']), select, textarea {
      max-width: 100%;
      box-sizing: border-box;
    }

    .help-btn {
      padding: 0;
      margin: 0 0 0 var(--setting-row-gap);
      border: none;
      border-radius: 50%;
      background: transparent;
      color: var(--color-font);
      cursor: pointer;
      transition: opacity 0.2s ease;
      &:hover {
        opacity: 0.7;
      }
    }
    .help-icon {
      margin: 0 0 0 var(--setting-row-gap);
      vertical-align: middle;
    }
  }
}

:global(#view .help-icon), :global([data-backup-preview] .help-icon) {
  color: var(--color-font);
  background: transparent;
  border-radius: 50%;
  cursor: help;
  flex: none;
  transition: opacity 0.2s ease;
  &:hover { opacity: 0.7; }
}

.searchFiltering {
  :global {
    dl *:not(.setting-search-visible):not(.setting-search-branch *) {
      display: none !important;
    }
  }
}

// .btn-content {
//   display: inline-block;
//   transition: @transition-theme;
//   transition-property: opacity, transform;
//   opacity: 1;
//   transform: scale(1);

//   &.hide {
//     opacity: 0;
//     transform: scale(0);
//   }
// }


// :global(dt):target, :global(h3):target {
//   animation: highlight 1s ease;
// }

// @keyframes highlight {
//   from { background: yellow; }
//   to { background: transparent; }
// }

</style>

