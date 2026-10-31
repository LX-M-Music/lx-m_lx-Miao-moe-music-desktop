# 动态背景备份（Kawarp 方案，2026-10-31）

备份内容：
- src/renderer/utils/kawarpBackground/（128px 模糊 + 单层顶点扭曲 + 2 套渲染器）
- src/renderer/components/layout/PlayDetail/KawarpBackground.vue
- src/renderer/App.vue（动态背景相关 CSS/挂载）
- tests/kawarp-*.test.cjs（旧测试）

恢复：把上述文件复制回原路径，重新构建 renderer/main/renderer-lyric。
