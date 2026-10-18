# MusicFree 音源兼容

统一入口：**设置 → 基本设置 → 自定义源 → 自定义源管理**。

- **本地导入**：选择 LX `.js` 自定义源、MusicFree `.js` 插件，或含插件地址的 `.json` 订阅；支持混合多选，自动识别格式。
- **在线导入**：填写插件 JS 地址或 JSON 订阅地址。订阅格式为 `{"plugins":[{"name":"音源名称","url":"https://example.com/plugin.js"}]}`，也接受地址数组。
- 导入前在独立环境中检查插件，成功后保存。相同 `platform` 的插件再次导入会更新原插件，保留启用状态、配置和收藏歌曲的关联。订阅中个别插件失败不会撤销已经成功导入的插件，界面会列出失败原因。
- 所有已导入的 LX 和 MusicFree 音源都在原“自定义源管理”列表中管理，不再提供独立的 MusicFree 设置入口。MusicFree 行带有格式标记，可启用、配置和移除；旧入口已导入的音源会直接出现在这里。
- 勾选启用后，支持歌曲搜索的插件会立即加入搜索平台和换源窗口。MusicFree 与 LX 自定义源独立工作，不需要改动“自定义源”的选择。LX 自定义源最多 20 个，MusicFree 最多 40 个，两者分别计数。
- 插件声明了 `userVariables` 时，可在“插件配置”中填写并保存。非空配置通过系统安全存储加密保存；更换系统账户或设备后需重新填写。

## 已接入的能力

| MusicFree 能力 | LX-M 行为 |
| --- | --- |
| CommonJS `module.exports` / `module.exports.default` 对象 | 独立音源，使用插件的 `platform` 作为名称 |
| `search(query, page, "music")` | 独立搜索及聚合搜索，按插件分页大小和 `isEnd` 翻页 |
| `getMediaSource(item, quality)` | 播放和下载取链；支持返回 `headers`、`userAgent` |
| 歌曲自带 `url` | 插件没有 `getMediaSource` 时使用默认地址 |
| `getLyric(item)` 的 `rawLrc` / `translation` | 原文歌词及翻译；没有此函数时支持歌曲的 `rawLrc` / `lrc` |
| `artwork` / `getMusicInfo(item).artwork` | 歌曲列表和播放器封面 |
| `primaryKey` 及任意可序列化歌曲字段 | 完整保存在歌曲元数据中，收藏、重启、备份和 WebDAV 歌曲同步后继续保留 |
| `env.getUserVariables()` | 返回管理界面中保存的插件配置 |

音质档位对应如下。它们是接口之间的对应关系，实际编码、码率、音质是否可用均由插件返回的资源决定。

| LX-M 档位 | MusicFree 参数 |
| --- | --- |
| 128k | low |
| 192k | standard |
| 320k | high |
| flac | super |

更高的 LX 音质选项从 `super` 开始尝试；失败后按上述档位逐级降低。MusicFree 播放地址每次重新解析，不将本次进程的转发地址写入音频 URL 缓存。

## 运行环境与边界

兼容 [MusicFree 官方协议](https://musicfree.catcat.work/plugin/protocol.html)和官方列出的依赖名：`axios`、`cheerio`、`crypto-js`、`dayjs`、`big-integer`、`qs`、`he`、`webdav`。这些依赖由 LX-M 提供，插件自身打包的纯 JavaScript 依赖也可运行；不提供 Node 的 `fs`、`child_process` 或本地原生模块。

插件运行在隐藏的 Chromium 沙箱中，通过宿主转发公共 HTTP(S) 请求，支持重定向、压缩响应和取消。私有网络、本地文件以及窗口导航不会放行。普通网络响应上限为 8 MiB，插件文件上限为 2 MiB；音频采用流式转发，不受普通响应体大小限制。最多安装 40 个插件，同时保留最多 8 个运行环境。

当前接入的是歌曲音源能力。MusicFree 的专辑/歌手/歌单搜索、榜单、评论、`importMusicSheet` / `importMusicItem` 以及自动订阅更新尚未接入 LX-M 对应界面。现有备份和同步保留歌曲，不包含 MusicFree 插件脚本；另一台设备需要重新导入同名插件并填写配置。

兼容协议不保证第三方平台接口持续可用。验收使用标准 MusicFree 插件夹具、真实 Electron 隔离环境、音频解码、请求头转发、收藏及重启恢复；没有把模拟网络结果当作任何第三方音源的在线可用性承诺。
