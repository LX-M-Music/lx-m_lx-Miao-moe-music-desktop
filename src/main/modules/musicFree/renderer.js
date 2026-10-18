/* global Headers, Response */
import axios from 'axios'
import * as cheerio from 'cheerio'
import CryptoJS from 'crypto-js'
import dayjs from 'dayjs'
import bigInteger from 'big-integer'
import qs from 'qs'
import he from 'he'
import * as webdav from 'webdav/web'
import { Buffer } from 'buffer'
import { MUSIC_FREE_METHODS } from '@common/musicFree'

// This entire bundle runs in a sandboxed Chromium main world, without Node.
// A bounded network broker is the only privileged capability exposed to it.
window.createMusicFreeRuntime = (code, variables = {}) => {
  const bridge = window.musicFreeBridge
  let sequence = 0
  let activeCall = ''
  let queue = Promise.resolve()
  const requests = new Map()
  const cancelled = new Set()
  const network = async(url, options = {}, signal) => {
    const id = String(++sequence)
    const callId = activeCall
    if (signal?.aborted || cancelled.has(callId)) throw new axios.CanceledError()
    const cancel = () => bridge.cancel(id)
    requests.set(id, { callId, cancel })
    signal?.addEventListener('abort', cancel, { once: true })
    try { return await bridge.request({ id, url, options }) } finally {
      signal?.removeEventListener('abort', cancel)
      requests.delete(id)
    }
  }
  const adapter = async(config) => {
    const result = await network(axios.getUri(config), {
      method: config.method,
      headers: config.headers.toJSON ? config.headers.toJSON() : config.headers,
      data: config.data,
      timeout: config.timeout,
      responseType: config.responseType,
    }, config.signal)
    const response = { ...result, config, request: {} }
    if (config.responseType === 'arraybuffer') response.data = result.data.buffer.slice(result.data.byteOffset, result.data.byteOffset + result.data.byteLength)
    if (!config.validateStatus || config.validateStatus(response.status)) return response
    throw new axios.AxiosError('Request failed with status code ' + response.status, response.status >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST', config, {}, response)
  }
  axios.defaults.adapter = adapter
  const brokerFetch = async(input, init = {}) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url
    const headers = Object.fromEntries(new Headers(init.headers ?? input?.headers).entries())
    const result = await network(url, { method: init.method ?? input?.method, headers, data: init.body, responseType: 'arraybuffer' }, init.signal)
    return new Response([204, 205, 304].includes(result.status) ? null : result.data, { status: result.status, statusText: result.statusText, headers: result.headers })
  }
  window.fetch = brokerFetch
  webdav.getPatcher().patch('fetch', brokerFetch)
  window.Buffer = Buffer
  const env = Object.freeze({ getUserVariables: () => ({ ...variables }) })
  const dependencies = { axios, cheerio, 'crypto-js': CryptoJS, dayjs, 'big-integer': bigInteger, qs, he, webdav, buffer: { Buffer }, env }
  const requirePlugin = name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    if (name.startsWith('crypto-js/')) {
      const part = name.slice(10)
      const enc = { 'enc-base64': 'Base64', 'enc-hex': 'Hex', 'enc-utf8': 'Utf8', 'enc-latin1': 'Latin1' }[part]
      const algorithms = { md5: 'MD5', sha1: 'SHA1', sha256: 'SHA256', sha512: 'SHA512', aes: 'AES', tripledes: 'TripleDES', 'hmac-sha256': 'HmacSHA256', 'hmac-md5': 'HmacMD5' }
      if (part === 'core') return CryptoJS
      if (enc) return CryptoJS.enc[enc]
      if (algorithms[part]) return CryptoJS[algorithms[part]]
    }
    throw new Error('MUSICFREE_DEPENDENCY_UNSUPPORTED: 不支持的 MusicFree 依赖：' + name)
  }
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', 'env', 'fetch', 'Buffer', code)(module, module.exports, requirePlugin, env, brokerFetch, Buffer)
  const plugin = module.exports.default ?? module.exports
  if (!plugin || typeof plugin !== 'object' || typeof plugin.platform !== 'string' || !plugin.platform.trim() || plugin.platform.length > 100) throw new Error('MUSICFREE_PLUGIN_INVALID: 不是有效的 MusicFree 插件（缺少 platform）')
  const methods = MUSIC_FREE_METHODS.filter(name => typeof plugin[name] === 'function')
  if (!methods.length) throw new Error('MUSICFREE_PLUGIN_INVALID: MusicFree 插件未提供可用功能')
  const primaryKey = plugin.primaryKey ?? ['id']
  if (!Array.isArray(primaryKey) || !primaryKey.length || primaryKey.length > 16 || !primaryKey.every(key => typeof key === 'string' && /^[\w-]{1,80}$/.test(key) && !['constructor', 'prototype', '__proto__'].includes(key))) throw new Error('MUSICFREE_PLUGIN_INVALID: MusicFree 主键无效')
  const userVariables = Array.isArray(plugin.userVariables) ? plugin.userVariables.slice(0, 40).map(item => ({ key: String(item.key), title: String(item.title ?? item.key) })) : []
  bridge.listen(packet => {
    if (packet.cancel) {
      cancelled.add(packet.id)
      for (const request of requests.values()) if (request.callId === packet.id) request.cancel()
      return
    }
    queue = queue.then(async() => {
      activeCall = packet.id
      try {
        if (cancelled.has(packet.id)) throw new axios.CanceledError()
        if (!methods.includes(packet.method)) throw new Error('MusicFree 插件没有此功能：' + packet.method)
        const value = await plugin[packet.method](...packet.args)
        bridge.reply({ id: packet.id, value: value ?? null })
      } catch (error) { bridge.reply({ id: packet.id, error: String(error?.message ?? error).slice(0, 2000) }) } finally {
        for (const request of requests.values()) if (request.callId === packet.id) request.cancel()
        cancelled.delete(packet.id)
        activeCall = ''
      }
    })
  })
  return {
    name: plugin.platform.trim(),
    version: String(plugin.version ?? '0.0.0').slice(0, 80),
    author: String(plugin.author ?? '').slice(0, 100),
    methods,
    primaryKey,
    supportedSearchType: Array.isArray(plugin.supportedSearchType) ? plugin.supportedSearchType.filter(value => typeof value === 'string').slice(0, 5) : ['music', 'sheet', 'album', 'artist', 'lyric'],
    userVariables,
  }
}
