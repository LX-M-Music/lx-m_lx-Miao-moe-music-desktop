<template>
  <div
    :class="[$style.sliderContent, { [$style.disabled]: disabled }, className]" role="slider" :tabindex="disabled ? -1 : 0"
    :aria-valuemin="min" :aria-valuemax="max" :aria-valuenow="value" :aria-disabled="disabled"
    @keydown.left.down.prevent="handleKeyStep(-1)" @keydown.right.up.prevent="handleKeyStep(1)"
    @wheel="handleWheel"
  >
    <div :class="[$style.slider]">
      <div ref="dom_sliderBar" :class="$style.sliderBar" :style="{ transform: `scaleX(${(value - min) / (max - min) || 0})` }" />
    </div>
    <div :class="$style.sliderMask" @mousedown="handleSliderMsDown" />
  </div>
</template>

<script>
import { ref, onBeforeUnmount } from '@common/utils/vueTools'
// import { player as eventPlayerNames } from '@renderer/event/names'

export default {
  props: {
    className: {
      type: String,
      default: '',
    },
    value: {
      type: Number,
      required: true,
    },
    min: {
      type: Number,
      required: true,
    },
    max: {
      type: Number,
      required: true,
    },
    step: {
      type: Number,
      default: 1,
    },
    disabled: {
      type: Boolean,
      default: false,
    },
    wheel: {
      type: Boolean,
      default: false,
    },
    wheelStep: {
      type: Number,
      default: 0,
    },
  },
  emits: ['change'],
  setup(props, { emit }) {
    const sliderEvent = {
      isMsDown: false,
      msDownX: 0,
      msDownRatio: 0,
    }
    const wheelEvent = {
      delta: 0,
      direction: 0,
      time: 0,
    }
    const dom_sliderBar = ref(null)

    const clampValue = val => {
      if (val < props.min) return props.min
      if (val > props.max) return props.max
      return val
    }
    const getSteppedValue = val => {
      const step = props.step > 0 ? props.step : 1
      const stepped = Math.round((val - props.min) / step) * step + props.min
      return clampValue(Number(stepped.toFixed(10)))
    }
    const getSliderWidth = () => dom_sliderBar.value?.clientWidth || 0
    const getRange = () => props.max - props.min
    const emitSteppedValue = rawValue => {
      const value = getSteppedValue(rawValue)
      emit('change', value)
      return value
    }

    const handleSliderMsDown = event => {
      if (props.disabled) return
      const width = getSliderWidth()
      if (!width) return

      sliderEvent.isMsDown = true
      sliderEvent.msDownX = event.clientX

      const rawValue = (event.offsetX / width) * getRange() + props.min
      const value = emitSteppedValue(rawValue)
      sliderEvent.msDownRatio = getRange() === 0 ? 0 : (value - props.min) / getRange()
    }
    const handleSliderMsUp = () => {
      sliderEvent.isMsDown = false
    }
    const handleSliderMsMove = event => {
      if (!sliderEvent.isMsDown || props.disabled) return
      const width = getSliderWidth()
      if (!width) return

      const ratio = sliderEvent.msDownRatio + (event.clientX - sliderEvent.msDownX) / width
      const rawValue = ratio * getRange() + props.min
      emitSteppedValue(rawValue)
    }
    const handleKeyStep = direction => {
      if (props.disabled) return
      emitSteppedValue(props.value + props.step * direction)
    }

    const WHEEL_STEP_DELTA = 50
    const WHEEL_GESTURE_TIMEOUT = 250
    const handleWheel = event => {
      if (!props.wheel || props.disabled) return
      if (!event.deltaY) return

      const direction = event.deltaY < 0 ? 1 : -1
      const step = props.wheelStep > 0 ? props.wheelStep : props.step
      const nextValue = getSteppedValue(props.value + step * direction)
      // Leave the page scrollable once the slider cannot move any further.
      if (nextValue === props.value) return
      event.preventDefault()

      const now = Date.now()
      if (direction !== wheelEvent.direction || now - wheelEvent.time > WHEEL_GESTURE_TIMEOUT) wheelEvent.delta = 0
      wheelEvent.direction = direction
      wheelEvent.time = now
      wheelEvent.delta += Math.abs(event.deltaY)
      // High-resolution trackpads send small deltas, so accumulate them into one step.
      if (wheelEvent.delta < WHEEL_STEP_DELTA) return
      wheelEvent.delta = 0
      emit('change', nextValue)
    }

    document.addEventListener('mousemove', handleSliderMsMove)
    document.addEventListener('mouseup', handleSliderMsUp)
    onBeforeUnmount(() => {
      document.removeEventListener('mousemove', handleSliderMsMove)
      document.removeEventListener('mouseup', handleSliderMsUp)
    })

    return {
      handleSliderMsDown,
      handleKeyStep,
      handleWheel,
      dom_sliderBar,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.sliderContent {
  flex: none;
  position: relative;
  width: 100px;
  padding: 5px 0;
  // margin-right: 10px;
  display: flex;
  align-items: center;
  opacity: .7;
  border-radius: var(--radius-sm);
  transition: opacity var(--duration-fast) var(--ease-standard);
  &:hover {
    opacity: 1;

    .slider {
      transform: scaleY(1.35);
    }
  }
  &:focus-visible {
    opacity: 1;
    box-shadow: var(--focus-ring);
  }
  &.disabled {
    opacity: .3;
    .sliderMask {
      cursor: default;
    }
  }
}

:global(#root[data-ambient-controls]) .sliderContent:not(.disabled) {
  opacity: 1;
}

.slider {
  // cursor: pointer;
  width: 100%;
  height: 5px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  transition: var(--duration-fast) var(--ease-standard);
  transition-property: background-color, opacity, transform;
  background-color: var(--color-primary-alpha-700);
  // background-color: #f5f5f5;
  position: relative;
  // border-radius: @radius-progress-border;
}

// .muted {
//   opacity: .5;
// }

.sliderBar {
  position: absolute;
  left: 0;
  top: 0;
  transform: scaleX(0);
  transform-origin: 0;
  transition-property: transform;
  transition-timing-function: var(--ease-standard);
  width: 100%;
  height: 100%;
  // border-radius: @radius-progress-border;
  transition-duration: var(--duration-fast);
  background-color: var(--color-button-font);
}

.sliderMask {
  position: absolute;
  top: 0;
  width: 100%;
  height: 100%;
  cursor: pointer;
}

</style>
