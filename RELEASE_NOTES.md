# Three.js Scene Factory v1.0.1

项目名称与 GitHub 仓库已统一为 `Three.js Scene Factory` / `threejs-scene-factory`，并保留完整的通用场景生成 Pipeline、收音机示例和房间示例。

## 主要内容

- 支持自然语言和 JSON Scene Spec 两种输入。
- 自动生成独立的 Vite + TypeScript + Three.js 项目。
- 支持门铰链、旋转、地面拖动、点击开关、悬停高亮和状态重置。
- 自动执行规格、必需文件、资源路径、基础质量、TypeScript 和 Vite 构建检查。
- 仅在全部硬门通过后生成 ZIP。
- 保留原有程序化收音机与交互式房间案例。
- 附带通过端到端验收的低多边形天文台项目。

## Release 附件

- `threejs-scene-factory-v1.0.1.zip`：完整仓库源码包。
- `observatory-project.zip`：可独立安装运行的天文台生成项目。
- `ACCEPTANCE_REPORT.md`：实际验收报告。
- `SHA256SUMS.txt`：ZIP 文件校验值。

解压项目后运行：

```bash
npm install
npm run dev
```

当前版本的未知物体采用通用基础几何近似；暂未包含自动碰撞布局、精细语义建模或外部模型下载。
