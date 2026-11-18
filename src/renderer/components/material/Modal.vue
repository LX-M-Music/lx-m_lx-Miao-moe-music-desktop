<template>
  <teleport :to="teleport">
    <div v-if="showModal" ref="dom_container" :class="$style.container">
      <transition enter-active-class="ui-backdrop-enter" leave-active-class="ui-backdrop-leave">
        <div
          v-show="showContent" :class="[$style.modal, {[$style.filter]: filter}]"
          @pointerdown="handleBackdropPointerDown" @pointerup="handleBackdropPointerUp"
          @pointercancel="resetBackdropPointer" @click="handleBackdropClick"
        >
          <transition :enter-active-class="inClass" :leave-active-class="outClass" @after-enter="$emit('after-enter', $event)" @after-leave="handleAfterLeave">
            <div v-show="showContent" :class="$style.content" :style="contentStyle" @click.stop>
              <header :class="$style.header">
                <button v-if="closeBtn" type="button" :aria-label="$t('close')" @click="close">
                  <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 212.982 212.982" space="preserve">
                    <use xlink:href="#icon-delete" />
                  </svg>
                </button>
              </header>
              <slot />
            </div>
          </transition>
        </div>
      </transition>
    </div>
  </teleport>
</template>

<script>
import { getRandom } from '@common/utils/common'
import { nextTick } from '@common/utils/vueTools'
import { appSetting } from '@renderer/store/setting'

let modalCount = 0
export default {
  props: {
    show: {
      type: Boolean,
      default: false,
    },
    closeBtn: {
      type: Boolean,
      default: true,
    },
    bgClose: {
      type: Boolean,
      default: false,
    },
    teleport: {
      type: String,
      default: '#root',
    },
    maxWidth: {
      type: String,
      default: '76%',
    },
    minWidth: {
      type: String,
      default: '280px',
    },
    maxHeight: {
      type: String,
      default: '76%',
    },
    width: {
      type: String,
      default: 'auto',
    },
    height: {
      type: String,
      default: 'auto',
    },
  },
  emits: ['after-enter', 'after-leave', 'close'],
  data() {
    return {
      animates: [
        [['jackInTheBox', 'flipInX', 'flipInY', 'lightSpeedIn'], ['flipOutX', 'flipOutY', 'lightSpeedOut']],
        // [['jackInTheBox', 'lightSpeedIn'], ['lightSpeedOut']],
        [['rotateInDownLeft', 'rotateInDownRight', 'rotateInUpLeft', 'rotateInUpRight'], ['rotateOutDownLeft', 'rotateOutDownRight', 'rotateOutUpLeft', 'rotateOutUpRight']],
        [['jackInTheBox', 'zoomInDown', 'zoomInUp'], ['zoomOutDown', 'zoomOutUp']],
        [['slideInDown', 'slideInLeft', 'slideInRight', 'slideInUp'], ['slideOutDown', 'slideOutLeft', 'slideOutRight', 'slideOutUp']],

        // ['flipInX', 'flipOutX'],
        // ['flipInY', 'flipOutY'],
        // ['lightSpeedIn', 'lightSpeedOut'],
        // ['rotateInDownLeft', 'rotateOutDownLeft'],
        // ['rotateInDownRight', 'rotateOutDownRight'],
        // ['rotateInUpLeft', 'rotateOutUpLeft'],
        // ['rotateInUpRight', 'rotateOutUpRight'],
        // // ['rollIn', 'rollOut'],
        // // ['zoomIn', 'zoomOut'],
        // ['zoomInDown', 'zoomOutDown'],
        // // ['zoomInLeft', 'zoomOutLeft'],
        // // ['zoomInRight', 'zoomOutRight'],
        // ['zoomInUp', 'zoomOutUp'],
        // ['slideInDown', 'slideOutDown'],
        // ['slideInLeft', 'slideOutLeft'],
        // ['slideInRight', 'slideOutRight'],
        // ['slideInUp', 'slideOutUp'],
        // // ['jackInTheBox', 'hinge'],
      ],
      // animateIn: [
      //   'flipInX',
      //   'flipInY',
      //   // 'fadeIn',
      //   // 'bounceIn',
      //   'lightSpeedIn',
      //   'rotateInDownLeft',
      //   'rotateInDownRight',
      //   'rotateInUpLeft',
      //   'rotateInUpRight',
      //   'rollIn',
      //   'zoomIn',
      //   'zoomInDown',
      //   'zoomInLeft',
      //   'zoomInRight',
      //   'zoomInUp',
      //   'slideInDown',
      //   'slideInLeft',
      //   'slideInRight',
      //   'slideInUp',
      //   'jackInTheBox',
      // ],
      // animateOut: [
      //   'flipOutX',
      //   'flipOutY',
      //   // 'fadeOut',
      //   // 'bounceOut',
      //   'lightSpeedOut',
      //   'rotateOutDownLeft',
      //   'rotateOutDownRight',
      //   'rotateOutUpLeft',
      //   'rotateOutUpRight',
      //   'rollOut',
      //   'zoomOut',
      //   'zoomOutDown',
      //   'zoomOutLeft',
      //   'zoomOutRight',
      //   'zoomOutUp',
      //   'slideOutDown',
      //   'slideOutLeft',
      //   'slideOutRight',
      //   'slideOutUp',
      //   'hinge',
      // ],
      inClass: 'ui-modal-enter',
      outClass: 'ui-modal-leave',
      showModal: false,
      showContent: false,
      modalCount: false,
      isAddedClass: false,
      backdropPointerId: null,
      backdropPointerReleased: false,
      // ai: 0,
    }
  },
  computed: {
    contentStyle() {
      return {
        maxWidth: this.maxWidth,
        minWidth: this.minWidth,
        width: this.width,
        height: this.height,
        maxHeight: this.maxHeight,
      }
    },
    filter() {
      return this.teleport == '#root' || this.teleport == '[data-player-detail]' || this.modalCount > 1
    },
  },
  watch: {
    show(val) {
      this.handleShowChange(val)
    },
  },
  mounted() {
    if (this.show) this.handleShowChange(true)
    this.setRandomAnimation()
  },
  beforeUnmount() {
    this.removeClass()
  },
  methods: {
    handleShowChange(val) {
      this.resetBackdropPointer()
      if (val) {
        // const dom = document.getElementById(this.teleport)
        // if (dom) {
        //   // dom.t
        // }
        this.setRandomAnimation()
        this.modalCount = ++modalCount
        this.showModal = true
        void nextTick(() => {
          const node = this.$refs.dom_container.parentNode
          if (!node.classList.contains('show-modal')) {
            node.classList.add('show-modal')
            this.isAddedClass = true
          }
          this.showContent = true
        })
      } else {
        if (modalCount > 0) this.modalCount = --modalCount
        this.removeClass()
        this.showContent = false
      }
    },
    removeClass() {
      if (!this.isAddedClass) return
      this.$refs.dom_container?.parentNode.classList.remove('show-modal')
    },
    setRandomAnimation() {
      if (appSetting['common.randomAnimate']) {
        const variants = [
          ['ui-modal-enter', 'ui-modal-leave'],
          ['ui-modal-enter-alt', 'ui-modal-leave-alt'],
        ]
        const [inClass, outClass] = variants[getRandom(0, variants.length)]
        this.inClass = inClass
        this.outClass = outClass
        return
      }
      this.inClass = 'ui-modal-enter'
      this.outClass = 'ui-modal-leave'
    },
    close() {
      this.$emit('close')
    },
    handleBackdropPointerDown(event) {
      this.backdropPointerId = event.target === event.currentTarget ? event.pointerId : null
      this.backdropPointerReleased = false
    },
    handleBackdropPointerUp(event) {
      this.backdropPointerReleased = this.backdropPointerId === event.pointerId && event.target === event.currentTarget
    },
    resetBackdropPointer() {
      this.backdropPointerId = null
      this.backdropPointerReleased = false
    },
    handleBackdropClick(event) {
      const shouldClose = this.bgClose && event.target === event.currentTarget && this.backdropPointerReleased
      this.resetBackdropPointer()
      if (shouldClose) this.close()
    },
    handleAfterLeave(event) {
      this.$emit('after-leave', event)
      this.showModal = false
    },
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 99;
  -webkit-app-region: no-drag;
}

.modal {
  width: 100%;
  height: 100%;
  // background-color: rgba(0, 0, 0, .2);
  // background-color: rgba(255, 255, 255, .6);
  // background-color: var(--color-primary-light-600-alpha-900);
  // backdrop-filter: blur(4px);
  // backdrop-filter: grayscale(70%);
  display: grid;
  align-items: center;
  justify-items: center;
  // will-change: transform;

  &.filter {
    background-color: rgba(0, 0, 0, .12);
    backdrop-filter: grayscale(35%);
  }

  // &:before {
  //   .mixin-after();
  //   position: absolute;
  //   left: 0;
  //   top: 0;
  //   width: 100%;
  //   height: 100%;
  //   background-color: var(--color-000);
  //   opacity: .6;
  // }
}

.content {
  position: relative;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-modal);
  overflow: hidden;
  // max-height: 80%;
  // max-width: 76%;
  min-width: 220px;
  position: relative;
  display: flex;
  flex-flow: column nowrap;
  z-index: 100;
  background-color: var(--color-surface-elevated);
}

.header {
  flex: none;
  background-color: var(--color-primary-light-100-alpha-100);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  height: 30px;

  button {
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    background-color: transparent;
    color: var(--color-primary-dark-500-alpha-500);
    border-radius: var(--radius-sm);
    outline: none;
    transition: background-color var(--duration-fast) var(--ease-standard);
    line-height: 0;
    -webkit-app-region: no-drag;

    svg {
      width: 12px;
      height: 12px;
      pointer-events: none;
    }

    &:hover {
      background-color: var(--color-primary-dark-100-alpha-600);
    }
    &:active {
      background-color: var(--color-primary-dark-200-alpha-600);
    }
    &:focus-visible {
      box-shadow: var(--focus-ring);
    }
  }
}

:global(.ui-backdrop-enter) {
  animation: ui-backdrop-in var(--duration-normal) var(--ease-standard) both;
}

:global(.ui-backdrop-leave) {
  animation: ui-backdrop-out var(--duration-fast) var(--ease-standard) both;
}

:global(.ui-modal-enter) {
  animation: ui-modal-in var(--duration-normal) var(--ease-emphasized) both;
}

:global(.ui-modal-leave) {
  animation: ui-modal-out var(--duration-fast) var(--ease-standard) both;
}

:global(.ui-modal-enter-alt) {
  animation: ui-modal-in-alt var(--duration-normal) var(--ease-emphasized) both;
}

:global(.ui-modal-leave-alt) {
  animation: ui-modal-out-alt var(--duration-fast) var(--ease-standard) both;
}

@keyframes ui-backdrop-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes ui-backdrop-out {
  from { opacity: 1; }
  to { opacity: 0; }
}

@keyframes ui-modal-in {
  from {
    opacity: 0;
    transform: scale(.98) translateY(4px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

@keyframes ui-modal-out {
  from {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
  to {
    opacity: 0;
    transform: scale(.99) translateY(2px);
  }
}

@keyframes ui-modal-in-alt {
  from {
    opacity: 0;
    transform: scale(.985) translateY(-4px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

@keyframes ui-modal-out-alt {
  from {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
  to {
    opacity: 0;
    transform: scale(.99) translateY(-2px);
  }
}

</style>
