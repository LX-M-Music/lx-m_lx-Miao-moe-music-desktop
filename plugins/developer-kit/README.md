# LX-M 插件开发工具包 1.0.0

使用本工具包可以独立开发插件，打包为 ZIP 后直接导入支持源码插件的 LX-M，不需要修改主程序代码或下载主程序仓库。它适用于本项目提供的插件接口；不代表所有原版洛雪版本都支持此格式。

开发者需要 Node.js 22 或更新版本。工具已包含 ZIP 处理依赖，无需 npm install；接收插件的用户只需要 LX-M。

从本仓库使用时，先在仓库根目录安装依赖并运行 `npm run build:plugin-devkit`，生成下面命令所需的 `lx-plugin.cjs`、模板和独立 ZIP。仓库只保存开发工具包的源码、配置和文档，生成文件不提交到 Git。已解压独立工具包的使用者可以直接开始。

## 第一个插件

在工具包文件夹内打开终端：

```text
node lx-plugin.cjs init ../my-plugin
node lx-plugin.cjs check ../my-plugin
node lx-plugin.cjs pack ../my-plugin
```

生成 `my-plugin.zip` 后，在 LX-M 的「设置 → 插件商店 → 导入插件」中选择它。插件会出现在商店卡片中；点击卡片上的「插件设置」即可使用计数器。修改 `src/Settings.vue` 后重新打包、导入即可更新。

Windows 也可以直接复制 `template` 文件夹到工具包外，修改 plugin.json 的 id，再把插件文件夹拖到 `pack.cmd`。将文件夹或 ZIP 拖到 `check.cmd` 可以校验。文件路径含空格时，命令行中请加双引号。

## 命令

| 命令 | 用途 |
| --- | --- |
| `init <新目录> [插件ID]` | 创建示例和编辑器配置；默认以文件夹名为 ID |
| `check <目录或.zip>` | 校验入口、资源、路径和 ZIP 校验清单；不运行代码 |
| `pack <目录> [输出.zip]` | 自动生成完整校验清单；默认输出到目录旁的同名 ZIP |
| `unpack <输入.zip> <新目录>` | 校验并解包，方便基于已有插件开发 |
| `vendor <目录> [main或engine]` | 收集项目中已安装的第三方依赖，默认 main |

命令前统一加 `node lx-plugin.cjs`。`init`、`unpack` 和 `vendor` 的目标目录必须不存在，避免覆盖已有工作。`pack` 可替换已有输出 ZIP；输出必须在项目目录之外。相同内容重复打包产生相同 ZIP。

检查目录时直接校验文件、路径和清单，不生成临时 ZIP；压缩后的大小限制在 `pack` 时检查。打包及依赖收集会排除 `.env`、`.npmrc`、`.yarnrc`、`.yarnrc.yml`、`.netrc` 和 `_netrc` 等本地凭据配置，包括 vendor 内的同名文件。

## 修改四个官方示例

随本地发布提供的 `development-examples` 文件夹包含声音效果、音频可视化、Folia 歌词、音频标签编辑四个 ZIP。四个包使用同一工具包生成；源码、资源、离线依赖和许可说明均已保留。

```text
node lx-plugin.cjs unpack ../development-examples/sound-effects-1.0.0.zip ../my-effects
node lx-plugin.cjs pack ../my-effects ../my-effects.zip
```

修改前，建议在 plugin.json 设置自己的唯一 ID 和显示名称，避免替换原插件。只改功能后重新打包时不需要重新收集现有 vendor 依赖。

## 第三方依赖

简单 Vue 插件使用宿主提供的 Vue，不需要打包 Vue。编辑器如需类型提示，可以在插件项目内运行 `npm install --ignore-scripts` 安装模板中的开发依赖；此步骤不影响打包功能。

如果源码增加 npm 库：

1. 在插件项目中安装所需库，使用 `npm install --save-exact --ignore-scripts <库名@版本>`，将运行依赖精确锁定在 package.json 的 dependencies 中。
2. 执行 `node <工具包目录>/lx-plugin.cjs vendor <插件目录>`，生成 `vendor/main`，包含传递依赖、已安装的 peer 依赖和版本清单。
3. 执行 pack，依赖将随 ZIP 一起分发，可离线导入。

支持仅提供 ESM `import` 入口或子路径入口的依赖，无需依赖公开导出 package.json。

浏览器引擎的依赖声明放在 `src/engine/package.json`，安装到该目录的 node_modules 后使用 `vendor <插件目录> engine`。只支持项目内实际安装的普通 npm 目录；不支持外链、workspace 链接或依赖原生二进制扩展的任意 npm 包。依赖应与插件运行环境相容。已有 vendor 目录可能有专门适配，更新前请手动备份并移开对应目录，再收集新依赖。

## 文件和兼容性

- `API.md`：主程序已经提供的插件接口与示例。
- `SOURCE-FORMAT.md`：ZIP 格式及编译约定。
- `template/`：可直接编辑的 Vue / TypeScript 示例。
- `types/`：与当前插件 API 3 对应的类型声明。
- `LICENSE`、`THIRD-PARTY-LICENSES.txt`：工具和打包依赖的许可。

工具包生成源码 ZIP；商店默认安装的 `.lxplugin` 是另一种预编译格式，不能通过改扩展名互相转换。已有商店继续读取文字目录，保持默认 `.lxplugin` 和可选 ZIP 安装。当前工具包不发布商店、不修改用户配置、不自动联网，也不提供独立 UI 预览；导入 LX-M 即可编译和调试。
