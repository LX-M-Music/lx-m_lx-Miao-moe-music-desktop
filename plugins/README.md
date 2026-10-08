# 官方插件

在软件的 **设置 → 插件商店** 中查看自带功能，或安装、更新、卸载及导入导出其他插件。音效增强和音频标签编辑已合并到软件中，商店状态显示「自带」，首次离线启动即可使用：

- **音效增强（自带）**：十段均衡器、环境混响、环绕音效、变调，以及原有的个人音效预设。可从歌曲详情页播放条上方的按钮快速打开，也可在商店卡片中展开设置。
- **音频可视化 1.2.2**：为桌面歌词提供经典频谱、柔波曲线、audioMotion 环形频谱三种样式，可独立选择、开关。
- **Folia 歌词动效 1.2.8**：将 Folia 的 13 种原版歌词渲染器接入播放详情页，动效铺满页面，双击歌词切换全屏，控制栏随鼠标靠近显示，支持逐字动效、样式预览和独立开关。
- **音频标签编辑（自带）**：在下载列表右键选择「修改音频标签」，直接编辑所选 MP3、FLAC 文件；也可在商店卡片中打开编辑器，手动选择本地文件。

其他插件安装后立即生效，卸载后对应按钮、设置和功能退出运行，并删除插件文件。歌曲继续播放，其他插件可继续使用。自带功能随软件更新，不单独安装、更新、卸载或导出；旧版本安装的同名插件会跳过加载，原有音效参数和个人预设继续沿用。

在插件商店展开音频可视化的「插件设置」，可预览、选择桌面歌词的频谱样式，选择后自动启用。没有播放音乐时显示演示预览，播放时使用当前音乐的频谱。可视化开关位于设置面板右上方，支持方向键选择样式。

已有 1.0.0 插件的用户，在商店刷新后点击「更新」即可升级，无需重新安装主程序。样式选择保存在 `LxDatas/plugins/preferences/audio-visualizer.json`，更新、卸载及重启都会保留；桌面歌词即时同步自己的样式选择。

1.2.2 将音频可视化限定在桌面歌词，播放详情页的歌词区域不再绘制频谱。桌面歌词使用适合其窗口大小的圆环，保持背景透明。三种样式的预览与实际绘制共用实现。

1.2.0 移除律动音柱、镜像光谱、旧环形脉冲和星点跃动。旧环形脉冲的选择自动迁移到 audioMotion，其余已移除的样式回到经典频谱。

环形频谱使用 [audioMotion-analyzer 4.5.4](https://github.com/hvianna/audioMotion-analyzer) 和 8192 点 FFT，依赖随插件打包，离线可用。插件包附带 AGPL-3.0-or-later 许可与来源说明，见 [NOTICE.md](../src/optional-plugins/audio-visualizer/NOTICE.md)。`build-config/plugins/audiomotion-loader.js` 为固定上游版本增加单帧绘制入口，并补全卸载时的监听器及延迟任务清理。播放分析仍在主窗口完成，通过原有字节数组通道将采样率与频谱同步到桌面歌词，宿主接口版本保持为 1。

## Folia 歌词动效

1.2.8 跟随主程序的歌词详情页字体开关：启用时使用所选界面字体，关闭时使用默认歌词字体；旧主程序沿用原有字体选择。此版本也包含 1.2.5–1.2.7 的更新：双击歌词区域切换全屏，再次双击或按 Esc 退出；修复与动态背景同时启用时页面底部变白的问题；关闭莫奈样式内置的音频频谱。

1.2.4 修复开启动效后无法拖动播放窗口的问题：插件在顶栏中央提供原生拖动区域，兼容尚未内置拖动区域的主程序版本；窗口按钮、样式选择及最大化、全屏状态保持原有操作。

1.2.2 修复高刷新率屏幕上部分动画绕过 60 帧上限的问题：在动画库初始化前启用共享帧时钟，减少重复布局。心象样式复用当前行的文字测量和文字节点，字体加载完成或布局变化时更新缓存。保留原有样式、画质、配色、逐字时序和动效参数。

1.2.1 优化状态同步与布局复用：主题和歌词内容未变时，不再因换行、暂停跳转或控制栏调整重复计算文字布局和绘制场景；样式、字体及控制栏尺寸变化单独同步配置。保持原有 13 种样式、60 帧上限、颜色、逐字时序与动效参数，暂停拖动进度时仍立即刷新画面。

1.2.0 增加控制栏自动收起：鼠标靠近页面顶部时显示窗口按钮和样式选择，靠近底部时显示播放条与操作按钮，离开约半秒后淡出。拖动进度条、打开音量或倍速面板、展开播放列表以及键盘焦点所在的控件会保持显示。中间的歌词区域仍可交互，触屏设备和设置预览保持控制栏可见。

1.1.0 将播放详情页改为沉浸式布局：移除动效面板的外边距、圆角和最大宽度限制，整个渲染画面延伸到窗口边缘，窗口按钮、样式选择与播放控制叠放在画面上，并使用适合深色背景的配色。底部字幕根据播放栏的实际高度自动上移，缩放、最大化和全屏时随页面铺开。插件设置中的预览仍保留独立面板；切回标准歌词、打开评论或选词时自动恢复原页面。已有 Folia 的用户可通过商店更新插件，无需重新安装主程序。

安装后默认启用「流光」。在插件设置中可无声预览全部样式，在播放详情页顶部可直接切换样式；详情页底部的 **F** 按钮以及插件设置中的开关可启用或停用 Folia。选择保存在 `LxDatas/plugins/preferences/folia-lyrics.json`，重启、更新和卸载都会保留。

| 样式 | 样式 | 样式 |
| --- | --- | --- |
| 流光 Luminous | 浮名 Fume | 云阶 Partita |
| 倾诉 Tilt | 心象 Mindscape | 群唱 Cappella |
| 回环 Claddagh | 镜台 Diorama | 莫奈 Monet |
| 时计 Pendolo | 商籁 Sonnet | 凝彩 Tempera |
| 静止 Still | | |

动效沿用当前歌曲、封面及软件解析后的歌词。歌曲有逐字时间轴时使用逐字动效，普通 LRC 按整行时间显示；暂停、跳转、倍速和歌词偏移跟随播放器。Folia 接管播放详情页的歌词区域，评论、播放控制和标准歌词仍可使用；桌面歌词保持原有显示。镜台、商籁、凝彩需要 WebGL，无可用上下文时会提示切换样式。插件也会遵循软件的减少动态效果设置。

来源为 [Folia 0.7.4](https://github.com/chthollyphile/folia-major)。原始渲染器、素材和注释保存在 `src/optional-plugins/folia-lyrics/engine/vendor`，`upstream.json` 记录来源文件的 SHA-256。插件只适配外围布局、播放时钟和数据接口，未接入 Folia 的账号、AI 服务或自定义背景图库。React、Motion、PixiJS、Three.js 等依赖随插件打包。源码 ZIP 内包含完整插件源码、AGPL-3.0 许可、依赖许可和来源说明，见 [NOTICE.md](../src/optional-plugins/folia-lyrics/NOTICE.md)。

构建时还通过 `engine/adapters/pausedCamera.mjs` 为浮名补上暂停时的镜头定位，避免在暂停状态切换样式或跳转时，当前歌词留在画面之外。该适配保留原始文件和注释，匹配位置变化时会中止构建以便检查。

## 音频标签编辑

在下载列表右键点击歌曲，选择「修改音频标签」，即可在下载页面直接编辑该文件，无需安装插件。也可在「设置 → 插件商店」展开音频标签编辑卡片，通过「选择音频文件」打开本地 MP3、FLAC 文件。编辑完成后点击「保存标签」，或按 `Ctrl / Command + S`；修改会写入音频文件，可在系统文件属性及其他播放器中查看。

未完成、已重新开始下载及不支持的格式会禁用右键入口。点击时按下载记录 ID 重新核对任务，优先使用记录中的原文件路径；原路径缺失时检查当前按歌单分组的下载目录和下载根目录。仅接受存在、非空且可读取的普通文件，权限错误、文件夹或符号链接会报错；发现多个同名文件时要求手动选择。缺失文件、已删除记录及文件在确认期间移动时保留已有草稿，并显示具体原因。

支持标题、副标题、艺术家、专辑艺术家、专辑、年份／日期、曲目序号、光盘序号、流派、作曲者、发行者、编码人员、版权和备注。清空输入框并保存即可移除对应文本。文件名保持原样；「还原修改」恢复本次打开或上次保存时的标签。切换文件时会提示处理未保存的修改，关闭窗口会保留当前编辑草稿。

保存只替换修改过的标签，保留 MP3 的其他原始帧、FLAC 的其他元数据块以及音频数据。先写入同目录临时文件并校验，再替换原文件；写入前和替换前再次核对下载状态及路径，文件被其他程序修改、缺失或无法替换时显示错误。支持软件生成的普通 ID3v2.3、ID3v2.4 MP3 和原生 FLAC；旧版、带扩展头或整体非同步编码的 ID3 标签暂不支持编辑，读取时会明确提示。

编辑器代码及依赖随主程序构建，离线可用。商店中历史的 1.1.0 插件包继续保留，兼容旧主程序；新版会拒绝导入与自带功能同名的包。文件读写及路径测试为 `node --test tests/audio-tag-editor.test.cjs tests/audio-tag-editor-downloads.test.cjs`，界面测试为 `node --test --test-concurrency=1 tests/audio-tag-editor.electron.test.cjs tests/audio-tag-editor-downloads.electron.test.cjs`。

## 下载来源和存储

商店从本仓库 `master` 分支的 [官方目录](https://raw.githubusercontent.com/Miao-moe/lx-m_lx-Miao-moe-music-desktop/master/plugins/store/catalog.json) 文字列表获取版本和插件包地址。选装插件默认安装 `.lxplugin`；只有 ZIP 的目录条目继续使用 ZIP。本地导入同时支持 LXPlugin 与源码 ZIP。从商店下载及更新需要连接 GitHub，本地导入导出无需联网；启动时只校验并加载本地已安装插件，离线时可继续使用。刷新目录失败会显示提示，下载或校验失败保留原有安装。

安装文件位于用户数据目录的 `LxDatas/plugins` 下，`installed.json` 记录已安装版本和包格式，`catalog-cache.json` 保存最近一次有效目录。下载的压缩包只在内存中读取，不在磁盘保留；安装成功或失败后均清理临时目录。`.lxplugin` 校验后直接加载，不需要编译；源码 ZIP 安装目录的 `.source/` 保存已校验的源码及依赖，导出时重新生成 ZIP，后续启动直接加载已编译文件。用户手动导入的原始文件不会被删除。离线重启后仍显示缓存的插件名称与介绍；从目录移除的已安装插件仍可使用和卸载。音效增强、混响资源、变调处理器、音频标签编辑及其依赖随应用安装包提供，无需连接商店。可视化和其他选装功能仍由插件包提供。自带功能的旧安装记录和文件保留但不再加载，个人设置不受影响。

本体根据官方目录动态发现插件，无需在本体代码中登记新 ID、名称或介绍。在线安装校验官方目录、下载来源、路径和文件哈希，本地导入也检查接口兼容性、路径和全部文件哈希。插件代码在应用渲染进程中运行，可访问本机文件，使用应用提供的 Vue、播放器和设置接口；此接口不是第三方插件沙箱，请仅导入可信来源的插件。Folia 的 React 渲染器运行在独立 iframe 内，关闭 Node 集成，通过消息接收歌词、播放时钟和频谱。

使用固定插件名单的旧主程序需要升级一次，才能获得动态商店。此后使用现有接口的新插件和插件更新，都可通过「刷新商店」直接发现、安装和即时加载。只有插件需要本体尚未提供的接口时，才会提示升级主程序；不兼容的新包不会替换仍可运行的本地版本，较旧的目录版本也不会显示为更新。

Folia 使用宿主接口 2，音频标签编辑 1.1.0 使用接口 3，宿主支持接口 1、2、3。商店列表仍只读取 `catalog.json` 文字文件，目录格式为 `schemaVersion: 2`。官方条目的 `path`、`bytes`、`sha256` 保留源码 ZIP，兼容只支持源码的客户端；`packages.lxplugin` 提供默认安装包的路径、大小和哈希。列表加载不会下载插件包。旧版 `plugins/official/` 文件保留，新版两种包独立发布在 `plugins/store/`。

## 导入和导出

- 点击商店顶部的「导入插件」，选择 `.lxplugin` 或规范的纯源码 `.zip` 文件，核对插件名称、ID 和版本后确认。`.lxplugin` 校验后直接加载；源码 ZIP 会由内置编译器在独立进程中自动构建，完成后加载。两种格式均可离线导入，无需安装 Node.js。
- 相同 ID 会提示替换已安装版本，同版本可重新导入修复，较旧版本会明确提示降级。确认期间原安装发生变化会中止操作，校验或写入失败保留原安装。
- 已安装插件卡片上的「导出」保留安装包格式：源码安装导出 ZIP，包含 Vue/TypeScript 源码、依赖、素材和许可证；预编译安装导出 `.lxplugin`，可在另一台兼容的主程序中直接导入。均不包含个人设置或预设。
- 本地导入显示「本地导入」，通过再次导入更新或修复；如需切换回商店版本，可卸载后从商店安装。导入、替换和卸载均保留本机的个人设置。
- 源码 ZIP 限制为压缩后 64 MiB、解压后 256 MiB、16,000 项；编译产物限制为 40 MiB、100 个文件。损坏、不兼容、路径越界、链接或文件冲突会被拒绝。编译错误、超时及写入失败保留原安装。导出前重新校验安装文件、源码清单和全部源码，取消选择不会更改安装或目标文件。
- `.lxplugin` 限制为压缩后 20 MiB、文件总大小 40 MiB、100 个文件，兼容原有预编译包和安装记录。包扩展名必须与实际格式一致，改名不能转换格式。源码安装缺少必需源码时仍需重新安装，个人设置保留。

完整源码目录、清单、入口和打包规则见 [源码 ZIP 规范](SOURCE-FORMAT.md)，可从 [最小模板](template) 开始开发。四个官方插件在 `src/optional-plugins/<id>/plugin.json` 中声明源码构建信息，官方 `.lxplugin` 由同一份源码 ZIP 编译生成；商店与本地 ZIP 导入共用编译流程。

## 独立开发工具包

工具包源码与说明位于 [developer-kit](developer-kit/README.md)。在仓库根目录安装依赖后，运行 `npm run build:plugin-devkit`，生成独立工具及 `plugins/lx-m-plugin-devkit-1.0.0.zip`，即可转发给其他开发者。接收者安装 Node.js 22 或更新版本后，就能创建、检查、打包和解包插件，不需要主程序仓库。Windows 可将插件目录拖到 pack.cmd 打包。生成文件和压缩包不提交到 Git。

四个官方插件的源码位于 [src/optional-plugins](../src/optional-plugins)，运行 `npm run build:plugins` 后会在 [development-examples](development-examples/README.md) 生成对应的源码包，与构建后的商店 catalog.json 中的源码 ZIP 内容一致，包含开发说明、接口类型、原始资源和离线依赖。工具包支持保留这些内容进行解包、修改和重新打包。接口能力见 [API.md](developer-kit/API.md)。

```sh
npm run build:plugin-devkit
node plugins/developer-kit/lx-plugin.cjs init ../my-plugin
node plugins/developer-kit/lx-plugin.cjs pack ../my-plugin
```

维护者运行 `npm run build:plugin-devkit` 重新生成工具包，运行 `npm run build:plugins` 用同一打包实现生成四个 ZIP、对应的默认 .lxplugin、文字目录和命名清晰的示例副本。

## 新增插件

维护仓库内置的示例时，在 `src/optional-plugins/<id>` 中添加 `plugin.json`、`index.ts` 和 `store.json`。构建脚本会自动发现含有清单的目录。ID 使用小写字母开头的小写字母、数字和连字符组合，最多 64 个字符，不能使用系统保留名称。独立开发的插件使用上面的工具包即可，无需在主程序中登记。

`plugin.json` 声明 `format: "lx-m-plugin-source"`、`formatVersion: 1`、`id`、`version`、`apiVersion` 和 `entry: "src/index.ts"`；有桌面歌词代码时增加 `lyricEntry: "src/lyric.ts"` 及对应的 `lyric.ts`。版本使用三段数字，例如 `1.2.0`。仓库内的源码在打包时放入 ZIP 的 `src/` 目录，样式从源码导入。构建只读取 `plugin.json`。

`store.json` 的显示信息同时写入目录和新插件包，示例：

```json
{
  "name": { "zh-cn": "新歌词插件", "en-us": "New lyrics" },
  "description": { "zh-cn": "插件的功能说明", "en-us": "What this plugin does" },
  "icon": "#icon-lyric"
}
```

名称和介绍也可直接写成字符串；缺少当前语言时依次尝试语言前缀、英文、简体中文和首个翻译。未提供名称时显示插件 ID，未提供图标时使用默认图标。文本按普通文字显示。

`index.ts` 默认导出插件模块，可使用以下入口注册界面，不需要给本体添加专用组件：

| 入口 | 用途 |
| --- | --- |
| `components.Settings` | 商店中的插件设置面板 |
| `slots.playDetailControls` | 播放详情页控制栏的按钮或控件 |
| `playDetail: { component, enabled }` | 可由 Vue ref 开关的完整歌词显示区域 |
| `downloadActions: [{ id, name, isAvailable, run }]` | 下载列表右键菜单；`run(taskId, { openSettings })` 接收所点击任务的稳定 ID，可在校验并载入文件后打开插件设置（接口 3） |
| `slots.desktopLyricOverlay` | 在 `lyric.ts` 导出模块中注册桌面歌词叠加内容 |
| `activate(context)` | 初始化功能，返回停止监听、释放资源的清理函数 |

初始化上下文提供 `id`、插件 `version`、宿主 `apiVersion`、`assetUrl(name)` 和 `readAsset(name)`。主窗口仍通过 `window.__lxPluginHost` 提供共享 Vue、播放器、歌曲信息、歌词时钟和设置接口；桌面歌词窗口提供共享 Vue、歌词状态与主窗口频谱通道。使用上述动态界面入口的插件声明 `apiVersion: 2`。

下载菜单入口需要声明 `apiVersion: 3`。`@renderer/utils/downloadFiles` 提供 `getDownloads()` 读取实时任务列表，`getDownloadSavePaths(task)` 提供当前分组目录和下载根目录。`isAvailable(task)` 只做同步状态判断；执行时须重新按 ID 查找任务、验证文件，异步确认后也要重新检查，避免列表变动或文件移动导致选错歌曲。卸载插件时会立即移除菜单入口。

运行 `npm run build:plugins -- <id>` 后，将源码、`catalog.json`、新的 `.lxplugin` 和 `.zip` 一起发布到官方仓库。主程序默认直接安装预编译包，也可选择源码编译；使用现有接口的插件更新不需要重新构建主程序。

## 构建和发布

在仓库根目录执行：

```sh
npm ci --prefix src/optional-plugins/folia-lyrics/engine
npm run build:plugins
```

只更新可视化插件时，可以保留其他插件的目录记录和包：

```sh
npm run build:plugins -- audio-visualizer
```

只构建 Folia 时使用 `npm run build:plugins -- folia-lyrics`。仓库已包含所需 Folia 源码，无需额外下载原项目；更新来源时可运行 `node build-config/plugins/import-folia.cjs /path/to/folia-major`，并检查生成的文件及哈希清单。

源代码在 `src/optional-plugins/<id>`。每个插件的 `plugin.json` 声明版本、接口版本、源码入口、依赖版本与资源，`store.json` 提供可随插件发布的多语言显示信息。依赖从本机已安装、版本匹配的包中收集，包含所需的嵌套依赖和许可证。构建分析插件引用的 SDK 源文件，打包源码 ZIP，再使用同一编译器生成 `.lxplugin`，完成后清理临时源码及编译目录。最终生成：

```text
plugins/store/catalog.json
plugins/store/<id>/<version>/<sha256>.zip
plugins/store/<id>/<version>/<sha256>.lxplugin
```

`.zip` 是纯源码包；`.lxplugin` 是包含清单和编译产物的 gzip JSON 包，与原有格式兼容。目录为两种包分别提供路径、大小和 SHA-256，默认优先使用 `.lxplugin`。安装时先验证完整下载和全部文件，再切换安装记录；启动时重新检查本地文件。损坏的安装可在商店中点击「重新安装」修复。

修改插件后递增其版本并重新构建，将源码、目录和生成的插件包一起提交到 `dev` 并同步 `master`，商店即可发现新版本。发布后保留旧的哈希文件，避免正在使用旧目录的客户端下载失败。修改宿主接口时，同时维护 `src/common/optionalPlugins.ts` 的 `PLUGIN_API_VERSION` 和插件清单的 `apiVersion`；不兼容的包会阻止安装并提示更新软件。

应用本身仍按原有流程构建。`build:plugins` 不构建 Windows 安装包，也不会清理已有版本的安装包。

`build:main` 同时将内置编译器及依赖放入 `dist/plugin-compiler`，应用打包配置会将其放在 `app.asar.unpacked` 中；发布应用时需要包含该目录。

编译器的 Tailwind 依赖含有平台组件。跨系统或架构构建时需要目标平台对应的依赖，重新生成并验证 `dist/plugin-compiler`，不能直接复用其他平台生成的目录。当前集成验证环境为 Windows x64。

## 验证

先生成插件包，再执行安装管理测试：

```sh
node --test tests/optional-plugins.test.cjs
node --test tests/folia-lyrics.test.cjs
node --test tests/plugin-source.test.cjs
node --test tests/plugin-devkit.test.cjs
```

构建主进程、主界面和桌面歌词后，可执行真实 Electron 集成测试：

```sh
npm run build:main
npm run build:renderer
npm run build:renderer-lyric
node --test tests/plugin-store.electron.test.cjs
node --test tests/audio-visualizer.electron.test.cjs
node --test tests/folia-lyrics.electron.test.cjs
node --test tests/dynamic-plugin-store.electron.test.cjs
node --test tests/plugin-transfer.electron.test.cjs
node --test tests/plugin-source.electron.test.cjs
node --test tests/plugin-devkit.electron.test.cjs
```

集成测试使用隔离的临时用户目录，拦截 GitHub 请求并提供实际构建的插件包，验证独立安装、播放中的卸载、重复安装、频谱绘制、离线重启和不同窗口尺寸下的布局。测试音频在输出前静音。

源码测试检查 ZIP 路径、完整性和依赖结构，使用随主程序提供的编译器重新构建四个官方插件；界面测试验证离线导入、编译过程提示、重新打包导出源码、编译失败保留旧版本、即时更新及离线重启。运行这些测试前需完成 `build:main`。

可视化测试还验证从 1.1.1 更新到当前版本、旧样式迁移、三种样式预览与绘制、桌面歌词设置保存及同步、键盘操作和关闭预览后释放分析器。

Folia 测试逐个检查 13 种样式，使用软件 WebGL 渲染验证三种画布样式，并检查播放时钟、暂停、歌词偏移、切歌、无歌词、开关和离线重启。截图保存在测试输出的临时目录中。

动态商店测试生成本体从未见过的随机插件 ID，在同一个应用进程中发现、安装和更新插件，验证通用播放控件、歌词区域和桌面歌词入口，随后检查离线重启、接口不兼容、目录回退以及下架后的卸载。
