<template>
  <div
    v-if="detailMounted" v-show="detailDisplayed" ref="detailRoot" data-player-detail
    :class="[$style.container, { fullscreen: isFullscreen, [$style.ambientDetail]: appSetting['ui.ambientBackground'] && !pluginPlayDetail }]" :aria-hidden="!isShowPlayerDetail"
    :style="{ '--playDetail-font-weight': appSetting['playDetail.style.fontWeight'] }"
    :inert="!isShowPlayerDetail ? '' : null" @contextmenu="handleContextMenu"
  >
    <div :class="$style.bg" />
    <ControlBtnsLeftHeader v-if="appSetting['common.controlBtnPosition'] == 'left'" data-detail-part="chrome" />
    <ControlBtnsRightHeader v-else data-detail-part="chrome" />
    <component :is="pluginPlayDetail" v-if="visibled && pluginPlayDetail && !isShowPlayComment && !isShowLrcSelectContent" :class="$style.main" data-detail-part="lyrics" />
    <div v-else :class="[$style.main, {[$style.showComment]: isShowPlayComment}]">
      <div class="left" :class="$style.left">
        <div :class="$style.info">
          <img
            v-if="playerCover" ref="detailCover" :class="[$style.img, {[$style.coverTravelling]: coverTravelling}]" :src="playerCover"
            @mousemove="handleCoverMove" @mouseleave="resetCoverTilt"
          >
          <div class="description scroll" :class="$style.description" data-detail-part="info">
            <p>{{ $t('player__music_name') }}{{ musicInfo.name }}</p>
            <p>
              {{ $t('player__music_singer') }}
              <template v-if="canNavigateEntity && singerNames.length">
                <template v-for="(singer, index) in singerNames" :key="`${singer}__${index}`">
                  <span v-if="index">、</span>
                  <button type="button" :class="$style.entityLink" @click.stop="handleOpenEntity('singer', singer)" @keydown.stop @keyup.stop>{{ singer }}</button>
                </template>
              </template>
              <template v-else>{{ musicInfo.singer }}</template>
            </p>
            <p v-if="musicInfo.album">
              {{ $t('player__music_album') }}
              <button v-if="canNavigateEntity" type="button" :class="$style.entityLink" @click.stop="handleOpenEntity('album', musicInfo.album)" @keydown.stop @keyup.stop>{{ musicInfo.album }}</button>
              <template v-else>{{ musicInfo.album }}</template>
            </p>
          </div>
        </div>
      </div>
      <LyricPlayer v-if="visibled" data-detail-part="lyrics" :data-ambient-lyrics="appSetting['ui.ambientBackground'] && !pluginPlayDetail ? '' : null" />
      <music-comment v-if="visibled" :class="$style.comment" :show="isShowPlayComment" :music-info="playMusicInfo.musicInfo" @close="hideComment" />
    </div>
    <play-bar v-if="visibled" data-detail-part="controls" />
    <common-audio-visualizer v-if="appSetting['player.audioVisualization'] && visibled && !pluginPlayDetail" />
    <!-- Native drag regions follow document order, so this must follow plugin no-drag surfaces. -->
    <div
      v-if="isShowPlayerDetail && visibled && pluginPlayDetail && !isShowPlayComment && !isShowLrcSelectContent && !isFullscreen && !isMaximized"
      :class="$style.windowDrag" data-detail-window-drag aria-hidden="true"
    />
  </div>
</template>


<script>
import { computed, watch } from '@common/utils/vueTools'
import { pluginRuntime } from '@renderer/store/optionalPlugins'
import usePlayerDetailMotion from '@renderer/utils/compositions/usePlayerDetailMotion'
import useEntityDetailNavigation from '@renderer/utils/compositions/useEntityDetailNavigation'
import { isFullscreen, isMaximized } from '@renderer/store'
import {
  isShowPlayerDetail,
  isShowPlayComment,
  isShowLrcSelectContent,
  musicInfo,
  playerCover,
  playMusicInfo,
} from '@renderer/store/player/state'
import {
  setShowPlayerDetail,
  setShowPlayComment,
  setShowPlayLrcSelectContentLrc,
} from '@renderer/store/player/action'
import LyricPlayer from './LyricPlayer.vue'
import PlayBar from './PlayBar.vue'
import MusicComment from './components/MusicComment/index.vue'
import ControlBtnsLeftHeader from './ControlBtnsLeftHeader.vue'
import ControlBtnsRightHeader from './ControlBtnsRightHeader.vue'
import { registerAutoHideMounse, unregisterAutoHideMounse } from './autoHideMounse'
import { appSetting } from '@renderer/store/setting'
import { closeWindow, maxWindow, minWindow, setFullScreen } from '@renderer/utils/ipc'

export default {
  name: 'CorePlayDetail',
  components: {
    ControlBtnsLeftHeader,
    ControlBtnsRightHeader,
    LyricPlayer,
    PlayBar,
    MusicComment,
  },
  setup() {
    const pluginPlayDetail = computed(() => Object.values(pluginRuntime.playDetails).find(detail => detail?.enabled.value)?.component)
    const { canOpenEntity, getSingerNames, openEntityDetail } = useEntityDetailNavigation()
    const entityMusicInfo = computed(() => {
      const info = playMusicInfo.musicInfo
      return info && 'progress' in info ? info.metadata.musicInfo : info
    })
    const canNavigateEntity = computed(() => !!entityMusicInfo.value && canOpenEntity(entityMusicInfo.value))
    const singerNames = computed(() => entityMusicInfo.value ? getSingerNames(entityMusicInfo.value) : [])
    let clickTime = 0

    const hide = () => {
      setShowPlayerDetail(false)
    }
    const handleOpenEntity = (type, name) => {
      if (!canNavigateEntity.value || !name) return
      openEntityDetail(entityMusicInfo.value, type, name)
      hide()
    }
    const handleContextMenu = () => {
      if (window.performance.now() - clickTime > 400) {
        clickTime = window.performance.now()
        return
      }
      clickTime = 0
      hide()
    }

    const hideComment = () => {
      setShowPlayComment(false)
    }

    const handleAfterEnter = () => {
      if (isFullscreen.value) registerAutoHideMounse()
    }

    const handleAfterLeave = () => {
      setShowPlayLrcSelectContentLrc(false)
      hideComment(false)

      unregisterAutoHideMounse()
    }

    const detailMotion = usePlayerDetailMotion({ onOpened: handleAfterEnter, onClosed: handleAfterLeave })

    watch(isFullscreen, isFullscreen => {
      (isFullscreen ? registerAutoHideMounse : unregisterAutoHideMounse)()
    })


    return {
      appSetting,
      playMusicInfo,
      isShowPlayerDetail,
      isShowLrcSelectContent,
      pluginPlayDetail,
      isShowPlayComment,
      musicInfo,
      playerCover,
      canNavigateEntity,
      singerNames,
      handleOpenEntity,
      hide,
      handleContextMenu,
      hideComment,
      handleAfterEnter,
      handleAfterLeave,
      ...detailMotion,
      isFullscreen,
      isMaximized,
      fullscreenExit() {
        void setFullScreen(false).then((fullscreen) => {
          isFullscreen.value = fullscreen
        })
      },
      min() {
        minWindow()
      },
      max() {
        maxWindow()
      },
      close() {
        closeWindow()
      },
    }
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

@control-btn-width: @height-toolbar * .26;

// Plugins may hide their chrome or cover it with an iframe. Keep a native drag
// target above that surface, leaving both possible window-button groups free.
.windowDrag {
  position: absolute;
  top: 0;
  left: 240px;
  right: 240px;
  height: @height-toolbar;
  z-index: 3;
  -webkit-app-region: drag;
}

.container {
  position: absolute;
  display: flex;
  flex-flow: column nowrap;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  background-color: var(--color-content-background);
  z-index: 10;
  // -webkit-app-region: drag;
  overflow: hidden;
  border-radius: @radius-border;
  color: var(--color-font);
  font-weight: var(--playDetail-font-weight, 400);
  // border-left: 12px solid var(--color-primary-alpha-900);
  -webkit-app-region: no-drag;
  contain: strict;

  box-sizing: border-box;

  * {
    box-sizing: border-box;
  }
}
.ambientDetail {
  background-color: transparent;
  .bg { display: none; }
}
.bg {
  position: absolute;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  background: var(--background-image) var(--background-image-position) no-repeat;
  background-size: var(--background-image-size);
  // background-size: 110% 110%;
  // filter: blur(60px);
  opacity: .7;
  z-index: -1;
  &:before {
    content: '';
    display: block;
    width: 100%;
    height: 100%;
    background-color: var(--color-app-background);
  }
  &:after {
    position: absolute;
    left: 0;
    top: 0;
    content: '';
    display: block;
    width: 100%;
    height: 100%;
    background-color: var(--color-main-background);
  }
}
// .bg2 {
//   position: absolute;
//   width: 100%;
//   height: 100%;
//   top: 0;
//   left: 0;
//   z-index: -1;
//   background-color: rgba(255, 255, 255, .8);
// }

.main {
  flex: auto;
  min-height: 0;
  overflow: hidden;
  display: flex;
  margin: 0 30px;
  position: relative;

  &.showComment {
    :global {
      .left {
        flex-basis: 18%;
        .description p {
          font-size: 12px;
        }
      }
      .right {
        flex-basis: 30%;
        .lyricSelectContent {
          font-size: 14px;
        }
      }
      .comment {
        opacity: 1;
        transform: scaleX(1);
      }
    }
  }
}
:global(.maximized), :global(.fullscreen) {
  .main {
    align-self: center;
    width: calc(100% - 60px);
    max-width: 1600px;
  }
  .left {
    justify-content: center;
  }
}
.left {
  flex: 0 0 40%;
  display: flex;
  flex-flow: column nowrap;
  align-items: center;
  padding: 13px;
  overflow: hidden;
  transition: flex-basis @transition-normal;
}

.info {
  display: flex;
  flex-flow: column nowrap;
  justify-content: flex-start;
  max-width: 300px;
  min-height: 0;
}
.img {
  max-width: 100%;
  max-height: 80%;
  min-width: 100%;
  box-shadow: 0 0 6px var(--color-primary-alpha-500);
  border-radius: 6px;
  opacity: .8;
  transition: transform var(--duration-normal) var(--ease-standard);
}
.coverTravelling {
  visibility: hidden;
}
.description {
  max-width: 300px;
  margin-top: 15px;
  padding-bottom: 15px;
  min-height: 0;
  p {
    line-height: 1.5;
    font-size: 14px;
    overflow-wrap: break-word;
  }
}
.entityLink {
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
  outline: none;
  transition: color var(--duration-fast);
  &:hover, &:focus-visible {
    color: var(--color-primary);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  &:focus-visible { box-shadow: var(--focus-ring); }
}


.comment {
  position: absolute;
  right: 0;
  top: 0;
  width: 50%;
  height: 100%;
  opacity: 1;
  margin-left: 10px;
  transform: scaleX(0);
}


</style>
