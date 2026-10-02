# Windows 自动更新

自动更新由当前运行的包类型、CPU 架构及 Electron 运行时决定。渲染进程选择发布附件后，主进程再次校验，不能跨类型更新。

| 当前版本 | 对应附件 | 更新行为 |
| --- | --- | --- |
| 安装版 | `ARCH-Setup.exe` | 校验完整安装包，在原目录静默安装并重启。 |
| 便携目录版 | `win_ARCH-green.7z`，Win7 为 `win7_ARCH-green.7z` | 优先差分更新；不可用时下载同类型完整压缩包，在原目录替换程序并重启。 |
| 单文件版 | `ARCH-portable.exe` | 下载完整单文件程序，退出后替换原 EXE，并从原目录启动新版。原文件改名也能更新。 |

`x64`、`x86`/`ia32`、`arm64` 单独匹配。`x86_64` 合并包只作为安装版和单文件版的低优先级候选，不能用于 ARM64 或目录便携版。Win7 运行时只选择带 `win7` 标记的附件，普通版排除这些附件；没有匹配包时保留手动更新入口。

新包在 `resources/lx-update-runtime.json` 写入类型标记。旧包通过单文件启动器的 `PORTABLE_EXECUTABLE_FILE` 和安装目录中的卸载程序识别；`portable` 数据目录本身不改变包类型。

## 便携差分附件

绿色包打包流程会在签名和所有附件完成后，从实际应用目录生成以下两个附加文件。例如 x64 普通版：

```text
LX-M.Music-vVERSION-win_x64-green-update.json
LX-M.Music-vVERSION-win_x64-green-update.bin
```

发布时必须把这两个文件与该版本的完整 `green.7z` 一起上传到同一 GitHub Release。`afterAllArtifactBuild` 会返回它们供 electron-builder 的发布流程处理；使用自定义上传脚本时也必须包含它们。保留文件名，尤其不要单独修改清单中记录的 `.bin` 名称。

清单和完整包使用 GitHub 发布附件提供的 SHA-256 摘要；清单包含每个程序文件和每个数据块的 SHA-256、架构、版本、Win7 标记及对应数据文件信息。更新先测速数据附件，再比对原目录内的数据块，复用相同内容，仅用 HTTP Range 下载变化块，并校验重建后的每个文件。不需要为每一个旧版本单独生成补丁。

主进程更新文件操作使用 Electron 的 `original-fs`，直接读取 `app.asar` 的原始字节，避免虚拟 ASAR 目录处理干扰差分比对、校验和清理。差分附件从 Vue 状态传给主进程前也会转换为普通对象。

缺少附件或摘要、清单不匹配、节点不支持精确 Range、数据损坏时，自动退回同类型完整便携包。没有差分附件的历史 Release 也可更新。完整包由随程序分发的 7za 解压，解压前检查路径，再检查包内架构和新包类型标记。

## 替换、重启和数据

下载和文件重建均在独立临时目录完成。原应用仍在运行时不会替换文件。重启助手先验证暂存文件并检查原目录能否写入，准备成功后旧程序才退出。助手使用 Windows 自带的 JScript GUI 宿主独立启动隐藏 PowerShell，等待旧进程退出后备份并替换列出的程序文件，再启动原位置的新程序。

`portable` 用户数据、歌单、下载文件和额外个人文件不在更新范围内。只有上次程序清单中列出且校验未变化的旧程序文件才会删除；本地改动过的旧文件保留。

新程序主界面初始化完成后，会核对版本、类型和原 EXE 路径并确认启动，随后清理备份。替换失败或新进程提前退出时会恢复旧文件并重启旧版。新进程仍存活但没有确认启动时保留备份，避免覆盖正在运行的程序。原目录不可写或系统脚本宿主无法运行时，会在退出前报告错误。

PowerShell 脚本避免使用 PowerShell 3 之后才提供的 JSON/哈希命令，目标包含 Windows 7 的 PowerShell 2。当前机器上的 Electron 22 和普通版测试不能替代 Windows 7 实机验收。

## 回归验证

```powershell
node --test tests/auto-update.test.cjs tests/update-sources.test.cjs tests/windows-update-editions.test.cjs tests/portable-differential-update.test.cjs tests/portable-archive-update.test.cjs tests/windows-update-relaunch.test.cjs
node --test --test-concurrency=1 tests/auto-update.electron.test.cjs tests/update-speed-test.electron.test.cjs tests/portable-update.electron.test.cjs
```

Electron 测试应指向刚构建的生产目录；开发服务运行时使用隔离产物及 `LX_TEST_PROJECT`，避免覆盖开发构建。测试使用临时用户数据、本地 HTTPS 服务和临时编译的测试程序，不下载或安装真实发布版。生命周期测试直接启动 Electron，保留退出后仍需运行的助手；界面交互由浏览器自动化测试单独覆盖。
