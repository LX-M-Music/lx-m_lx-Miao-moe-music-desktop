<template>
  <material-modal :show="show" teleport="#view" @close="handleClose" @after-enter="$refs.input.focus()">
    <main :class="$style.main" data-user-api-online-import>
      <h2>{{ $t('user_api_import_online__title') }}</h2>
      <base-input
        ref="input"
        v-model="url"
        :class="$style.input"
        type="url"
        :disabled="disabled"
        :placeholder="$t('user_api_import_online__input_tip')"
        @submit="handleSubmit" @blur="verify"
      />
      <div :class="$style.footer">
        <base-btn :class="$style.btn" :disabled="disabled" @click="handleClose">{{ $t('btn_close') }}</base-btn>
        <base-btn :class="$style.btn" :disabled="disabled" @click="handleSubmit">{{ btnText }}</base-btn>
      </div>
    </main>
  </material-modal>
</template>

<script>
import { formatError } from '@common/utils/errorMessage'
import { dialog } from '@renderer/plugins/Dialog'
import { httpFetch } from '@renderer/utils/request'

export default {
  props: {
    show: {
      type: Boolean,
      default: false,
    },
    importSource: {
      type: Function,
      required: true,
    },
  },
  emits: ['update:show'],
  data() {
    return {
      url: '',
      disabled: false,
      btnText: '',
    }
  },
  watch: {
    show(n) {
      if (n) {
        this.url = ''
        this.disabled = false
        this.btnText = this.$t('user_api_import_online__input_confirm')
      }
    },
  },
  methods: {
    handleClose() {
      if (!this.disabled) this.$emit('update:show', false)
    },
    verify() {
      this.url = this.url.trim()
      if (!/^https?:\/\//i.test(this.url)) this.url = ''
      return this.url
    },
    async handleSubmit() {
      if (this.disabled) return
      const url = this.verify()
      if (!url) return
      this.disabled = true
      this.btnText = this.$t('user_api_import_online__input_loading')
      try {
        const response = await httpFetch(url, { follow_max: 3 }).promise
        if (response.statusCode !== 200) throw new Error(`HTTP ${response.statusCode}`)
        const script = typeof response.body === 'string' ? response.body : JSON.stringify(response.body)
        await this.importSource({ script, url })
        this.$emit('update:show', false)
      } catch (err) {
        void dialog.error(this.$t('user_api_import__failed', { message: formatError(err, '', 'SOURCE_IMPORT_FAILED') }))
        return
      } finally {
        this.disabled = false
        this.btnText = this.$t('user_api_import_online__input_confirm')
      }
    },
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  padding: 0 15px;
  width: 450px;
  min-width: 280px;
  display: flex;
  flex-flow: column nowrap;
  min-height: 0;
  // max-height: 100%;
  // overflow: hidden;
  h2 {
    font-size: 13px;
    color: var(--color-font);
    line-height: 1.3;
    word-break: break-all;
    // text-align: center;
    padding: 15px 0 8px;
  }
}

.input {
  // width: 100%;
  // height: 26px;
  padding: 8px 8px;
}
.footer {
  margin: 20px 0 15px auto;
}
.btn {
  // box-sizing: border-box;
  // margin-left: 15px;
  // margin-bottom: 15px;
  // height: 36px;
  // line-height: 36px;
  // padding: 0 10px !important;
  min-width: 70px;
  // .mixin-ellipsis-1();

  +.btn {
    margin-left: 10px;
  }
}


</style>
