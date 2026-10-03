# 切歌后无法播放：抓取播放诊断日志

适用于切歌后持续显示“歌曲链接获取中…”、进度停在 00:00、播放状态与当前歌曲不一致，或音源偶发无法返回链接的情况。普通 main.log 未必包含完整的播放过程，使用本目录的 playback-debug.js 在出现问题的机器上记录。

## 给出现问题的用户

1. 将 `playback-debug.js` 发给用户。脚本可以在现有安装包中运行，不需要重新安装。
2. 打开 **设置 → 软件更新**，连续点击“当前版本”文字 **6 次**，每两次间隔不超过 1 秒，打开开发者工具。
3. 进入 **Console（控制台）**，将 JS 文件全部内容粘贴并执行。看到 `[PlaybackDebug] Ready. Log:` 后，脚本已经开始写入日志。也可以用下面这一行执行保存到本地的脚本，路径请换成实际文件位置：

   ```js
   require('node:vm').runInThisContext(require('node:fs').readFileSync('D:/download/playback-debug.js', 'utf8'))
   ```

4. 可以关闭开发者工具，再按平常的操作复现。出现问题后，保持最后一首歌 **至少 35 秒**，便于记录链接请求的最终超时或错误。
5. 重新打开 Console，执行以下命令，在日志中标记问题发生并停止记录，然后定位到日志文件：

   ```js
   lxPlaybackDebug.mark('这里出现问题：一直获取链接，无法播放')
   lxPlaybackDebug.stop()
   lxPlaybackDebug.openLog()
   ```

6. 把定位到的 `playback.jsonl` 发回，同时提供软件版本、音源名称、出错歌名、是否切换过音源，以及问题发生时间和录屏。无需发送音源脚本、密钥或整份软件数据目录。

优先保留平常的播放设置完成一轮记录。如果自动跳歌把最终错误掩盖了，再关闭 **设置 → 播放设置 → 播放错误时自动切换歌曲**，将播放音质设为 **128k**，重新运行脚本，选中一首出问题的歌并等待 35 秒；说明这是第二轮诊断设置。

日志路径可以用 `lxPlaybackDebug.logPath` 查询。Windows 下位于 `%TEMP%\lx-playback-debug-随机字符\playback.jsonl`，记录随事件写入磁盘，软件退出后也可以找到已写入的内容。重启、刷新页面后需重新运行脚本；再次运行会停止上一次记录并生成新文件。每轮最多记录 30 分钟或 5 MB，达到限制后停止，可重新执行开始下一轮。

## 日志记录什么

- 每次点击或双击的歌曲 ID、当前播放目标、界面显示歌曲、列表 ID 和队列位置。
- 当前版本、Electron 版本、音质、自动跳过等少量播放设置，以及音源名称和初始化状态。
- 音源请求与返回、音质、耗时、失败原因、切歌时的取消，以及 URL 缓存命中情况。
- 音频加载、开始播放、暂停、等待、错误及每 2 秒的播放时间、缓冲范围、就绪状态。
- 手动标记、页面报错和未处理的 Promise 错误。

脚本只选取以上字段，不保存 Cookie、Token、请求头、音源脚本、歌词内容或整份歌单。HTTP 地址只保留协议和主机名，不记录账号、路径和查询参数；消息中的常见密钥字段会替换为 `[redacted]`。日志不上传到网络。

脚本为诊断临时观察 IPC 和音频方法，保留原调用参数、原返回值及原 Promise；停止后恢复这些方法并移除监听。它不会更改音源、歌单、音质或自动跳歌设置。附加观察可能轻微影响时序，偶发问题应保留录屏作对照。

## 如何判断

| 日志顺序或字段 | 排查方向 |
| --- | --- |
| `row-dblclick` 与后续 `player-state.selected.id` 不一致 | 检查点击处理、虚拟列表或队列目标是否发生变化。单击可能只选择歌曲，应以实际播放动作区分。 |
| `cache-response.hasUrl` 为 true | 本次使用已缓存链接，未必会发起新的音源请求。 |
| `source-request` 后只有 heartbeat，pending 的 ageMs 持续增长 | 音源尚未返回；等待最终 `source-error`，核对超时与取消。 |
| 切换歌曲后 `source-cancel` 与旧请求的 requestKey 对应 | 旧曲链接请求被主动取消；结合当前目标判断，不单凭取消认定故障。 |
| 发出 `source-cancel` 数秒后，旧请求仍出现 `source-response` | 检查取消消息是否在主进程生效，并核对版本；同时区分取消与返回恰好同时发生的竞争情况。 |
| `source-error` 包含 HTTP 403、超时或其他错误 | 检查音源返回、网络和权限；按 requestId、requestKey 对照耗时和歌曲。 |
| `source-response.hasUrl` 为 true，但没有 `media-source` / `media-loadstart` | 检查响应对应的歌曲是否已切走，或链接是否未传入音频播放器。歌词/封面请求不会产生音频加载，应先确认 action 是 musicUrl。 |
| 有 `media-loadstart`，随后 `media-error` | 链接已经进入播放器，检查 errorCode；2 为网络失败，3 为解码失败，4 为格式或地址不受支持。 |
| 有 `media-playing` 且 heartbeat.currentTime 持续增加 | 音频已在播放；若无声音，继续核对音量、输出设备和音效。此脚本不能测量耳机的实际声压。 |
| `apiInitSettled` 长期为 false，且没有音源请求 | 音源初始化仍未结束，核对 source-status 及 main.log。 |

日志时间为 UTC ISO 格式，`elapsedMs` 表示从本轮记录开始的毫秒数。北京时间可将 time 加 8 小时，与录屏或 main.log 对照。

## 补充主进程日志

源码当前使用以下位置，普通主进程日志可作为补充；只发送与问题时间对应的日志文件，无需发送配置和数据目录：

- 普通安装：`%APPDATA%\LX-M Music\logs\main.log`。
- 使用软件旁 `portable` 数据目录：`portable\userData\logs\main.log`。

脚本面向 LX-M 的当前主进程 IPC、全局播放器状态和标准音频接口。若出现报错、没有 `[PlaybackDebug] Ready`，或缺少某一类事件，保留具体错误与软件版本反馈，不代表故障已经定位。
