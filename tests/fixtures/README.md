# 转换测试样例

这些文件仅供 Node 测试使用，不随 `dist/` 发布，也不依赖仓库外的示例目录。

- `pixel-character.pindou.json`：64 × 64 的本地像素重绘工程，用于验证原生图与最近邻放大图转换一致。
- `outline-character.pindou.json`：112 × 112 的人物转换工程，用于验证外轮廓小断口修补与内部细节保护。
- `noisy-character.rgba.gz`：用户提供的 158 × 158 图片的无损 RGBA 数据，经 gzip 压缩。用于验证带噪声图片不会被强行套入错误网格；测试仅依赖 Node 内置解压功能。
