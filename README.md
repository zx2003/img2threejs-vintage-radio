# Three.js Scene Factory

这是一个可运行的 Three.js 场景自动生成系统。它将自然语言或 JSON 请求转换为统一的 Scene Spec，再生成一个完整、独立的 Vite + TypeScript + Three.js 项目，自动完成校验和构建，最后输出 ZIP。

仓库原有的程序化收音机和交互式卧室仍可正常访问，但现在被视为 `examples/` 下的参考案例，不再是生成器的硬编码主流程。

## 能力概览

- 两种输入：`--prompt` 自然语言或 `request.json`。
- 统一 Scene Spec：相机、灯光、物体、基础几何、材质、变换和交互均为结构化数据。
- 通用程序化建模：盒体、球体、圆柱、圆锥、平面和圆环可任意组合。
- 可复用组件库：门、椅子、灯、桌子、书架、植物等由声明式配方组成。
- 未知物体兜底：组件库未收录的物体会生成可配置的通用组合几何，而不是要求修改生成器源码。
- 通用交互：点击开关、铰链旋转、地面拖动、悬停高亮和状态重置。
- 严格出包门控：Scene Spec、必需文件、资源路径、基础质量、依赖安装、TypeScript 和 Vite 构建全部通过后才生成 ZIP。

## 保留的原有案例

- 收音机支持鼠标旋转、滚轮缩放、组件选择、爆炸视图和多种检查模式。
- 房间支持门开合、椅子地面拖动、抽屉开关、台灯开关、悬停高亮和场景重置。
- 两个页面继续由 Vite 多入口构建并通过 GitHub Pages 发布。

## 技术栈

- [Three.js](https://threejs.org/) `0.180.x`
- TypeScript `5.9.x`
- Vite `6.x`
- GitHub Actions 与 GitHub Pages

## 环境要求

- Node.js 20 或更高版本
- npm 10 或兼容版本
- 支持 WebGL 的现代浏览器

## 安装

```bash
npm install
npm link
```

`npm link` 会在本机注册 `generate-scene` 命令。也可以不注册，改用 `npm run generate-scene -- ...`。

## 命令行用法

从自然语言生成：

```bash
generate-scene --prompt "生成一个低多边形卧室，门可以打开，椅子可以拖动"
```

在仓库内等价执行：

```bash
npm run generate-scene -- --prompt "生成一个低多边形卧室，门可以打开，椅子可以拖动"
```

从 JSON 请求生成：

```bash
generate-scene request.json
```

指定输出目录：

```bash
generate-scene request.json --output ./my-outputs
```

JSON 文件有两种合法形式：

```json
{
  "prompt": "生成一个低多边形展厅，展柜可以拖动",
  "name": "my-showroom",
  "title": "My Showroom"
}
```

或者直接提供完整 Scene Spec。

## Scene Spec

最小规格示例：

```json
{
  "version": "1.0",
  "name": "minimal-scene",
  "title": "Minimal Scene",
  "style": {
    "preset": "low-poly",
    "background": "#ded6ca",
    "groundColor": "#b98655"
  },
  "camera": {
    "type": "perspective",
    "position": [8, 6, 9],
    "target": [0, 1, 0],
    "fov": 36,
    "near": 0.05,
    "far": 100
  },
  "lights": [
    {
      "id": "key",
      "type": "directional",
      "color": "#ffd398",
      "intensity": 2,
      "position": [-5, 8, 6],
      "castShadow": true
    }
  ],
  "objects": [
    {
      "id": "movable-box",
      "name": "Movable box",
      "type": "generic",
      "geometry": { "shape": "box", "size": [1, 1, 1] },
      "material": { "color": "#6c8f86", "roughness": 0.72 },
      "transform": {
        "position": [0, 0.5, 0],
        "rotation": [0, 0, 0],
        "scale": [1, 1, 1]
      },
      "interactions": [
        {
          "type": "drag",
          "bounds": { "minX": -4, "maxX": 4, "minZ": -4, "maxZ": 4 }
        },
        { "type": "hover" }
      ]
    }
  ]
}
```

物体支持递归 `children`，因此新的家具或装置可以通过基础几何组合完成。支持的几何形状为 `box`、`sphere`、`cylinder`、`cone`、`plane` 和 `torus`；交互类型为 `toggle`、`hinge`、`rotate`、`drag` 和 `hover`。

## 生成流程

```text
Prompt / request.json
        ↓
统一 Scene Spec
        ↓
Schema 与语义校验
        ↓
模板 + 参数化组件生成完整项目
        ↓
必需文件 / 资源路径 / 基础质量检查
        ↓
npm install → TypeScript → Vite build
        ↓
outputs/<scene-name>.zip
```

任一硬检查失败时流程会停止，并保留项目目录和 `validation-report.json` 供排查，不会产生新的通过 ZIP。

## 生成项目内容

每个输出项目至少包含：

```text
package.json
index.html
README.md
scene-spec.json
src/main.ts
src/createScene.ts
src/interactions.ts
src/sceneSpec.ts
src/styles.css
public/assets/
```

解压 ZIP 后可直接执行：

```bash
npm install
npm run dev
```

## 仓库结构

```text
src/
├─ cli/               命令行入口
├─ pipeline/          请求读取、自然语言适配与总流程
├─ spec/              Scene Spec 类型与严格校验
├─ generators/        独立 Three.js 项目生成器
├─ validators/        文件、资源、构建和质量检查
├─ packager/          无外部运行时依赖的 ZIP 打包器
├─ room/              原交互房间兼容入口源码
├─ main.ts            原收音机兼容入口
└─ createObjectModel.ts
templates/vite-threejs/  生成项目模板
component-library/       声明式可复用组件配方
examples/                原案例登记与请求示例
tests/                   核心规格、泛化与打包测试
outputs/                 生成项目和 ZIP
```

## 扩展方式

### 添加组件

在 `component-library/catalog.json` 中增加声明式配方：填写别名、基础几何、材质、默认位置和可选子组件。不要在生成器中增加场景名称判断。

### 添加基础几何

同时扩展：

1. `src/spec/types.ts` 的 `PrimitiveShape`；
2. Scene Spec validator；
3. `templates/vite-threejs/src/createScene.ts.tpl` 的几何构造分支；
4. 对应测试。

### 添加交互

先扩展 `InteractionType` 与 validator，再在生成模板的 `interactions.ts.tpl` 中实现统一状态和动画逻辑。交互必须由 Scene Spec 驱动，不能绑定具体场景名称。

## 现有参考案例

- 收音机：根路径 `/`，说明见 `examples/radio/`。
- 交互房间：`/room.html`，说明见 `examples/room/`。

原有房间的门、椅子、抽屉、台灯、悬停和重置功能均保留；原收音机的组件选择、爆炸视图和检查参数也保持不变。

## 测试与构建

```bash
npm test
npm run build
```

`npm test` 覆盖自然语言到规格、未知物体兜底、严格规格失败、项目文件生成和 ZIP 内容。`npm run build` 同时检查新增系统与两个原有浏览器入口。

## 当前限制

- 自然语言适配器是确定性的本地规则解析，不是通用大语言模型；复杂关系最好直接用 JSON Scene Spec 表达。
- 未知物体会得到可运行的基础组合几何，但不会自动具有精细语义外形。
- 当前只生成程序化基础材质和几何，不自动下载外部模型、纹理或音频。
- 质量检查覆盖结构、路径、类型和构建，不等同于图像相似度或美术审查。
- 拖动物体使用轴对齐地面边界，尚未实现家具间碰撞和导航网格。

## 原有预览与部署

- 收音机：<https://zx2003.github.io/img2threejs-vintage-radio/>
- 房间：<https://zx2003.github.io/img2threejs-vintage-radio/room.html>

### 收音机检查参数

预览页提供了一组查询参数，可用于固定相机、自动化截图或模型检查。

| 参数 | 示例 | 说明 |
| --- | --- | --- |
| `light` | `?light=neutral` | 光照模式：`reference`、`neutral` 或 `grazing` |
| `az` | `?az=35` | 相机方位角，单位为度 |
| `el` | `?el=18` | 相机仰角，单位为度 |
| `margin` | `?margin=1.3` | 相机构图边距 |
| `explode` | `?explode=0.65` | 初始爆炸程度，范围 `0`–`1` |
| `select` | `?select=bodyShell` | 按组件 ID 预选部件 |
| `capture` | `?capture=1` | 隐藏普通界面，生成稳定截图视图 |
| `silhouette` | `?silhouette=1` | 输出白色模型与黑色背景的轮廓视图 |
| `mask` | `?mask=1` | 使用统一颜色输出几何检查视图 |
| `manifest` | `?manifest=1` | 在页面中输出运行时组件与性能清单 |

参数可以组合，例如：

```text
https://zx2003.github.io/img2threejs-vintage-radio/?light=grazing&az=45&el=16
```

### 收音机模型结构

程序化模型以一个根节点组织，并保留主要组件的独立对象层级，包括：

- 圆角机身与前面板结构；
- 提手及左右安装连接件；
- 扬声器外圈、内凹安装区域和 grille；
- 调谐窗口外框、内嵌面板、刻度与指针；
- 左右旋钮、安装座和轴向连接；
- 与机身底部连接的四个支脚。

运行时会记录组件节点、装配 socket、连接关系和三角形数量，以支持质量检查及后续动画开发。

### 自动部署

`.github/workflows/deploy-pages.yml` 会在 `main` 分支更新时执行：

1. 安装锁定版本的 npm 依赖；
2. 运行 TypeScript 检查和 Vite 构建；
3. 上传 `dist/` 产物；
4. 发布到 GitHub Pages。

仓库的 Pages Source 需要保持为 **GitHub Actions**。

### 数据与隐私边界

公开仓库只包含运行预览所需的源码、配置和部署工作流。原始参考图片、雕刻 Spec、评测裁剪图及本地材质证据不会随 Pages 版本发布。

### 当前状态

这是面向浏览器实时展示的测试版本，重点验证程序化模型、组件结构、材质表现和交互能力。它不是扫描级数字孪生，单张参考图不可见区域仍包含合理推断。

### 许可

当前仓库尚未附带开源许可证。在添加许可证前，默认保留所有权利。
