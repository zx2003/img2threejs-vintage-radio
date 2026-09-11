# Procedural Vintage Radio

一个使用 TypeScript 与 Three.js 编写的程序化复古便携收音机模型。模型由代码生成，不依赖外部 GLTF/GLB 文件，可直接在现代浏览器中实时渲染和交互。

## 在线预览

- GitHub Pages：<https://zx2003.github.io/img2threejs-vintage-radio/>
- 源码仓库：<https://github.com/zx2003/img2threejs-vintage-radio>

在线预览支持鼠标旋转、滚轮缩放、组件选择以及爆炸视图。

## 项目特点

- 程序化 Three.js 建模：机身、提手、扬声器、调谐窗口、旋钮和支脚均由代码创建。
- 独立组件层级：主要结构拥有独立节点，便于检查、选择和后续动画扩展。
- 实时浏览器渲染：使用透视相机、环境光、方向光、软阴影和色调映射。
- 交互式检查：点击模型部件可显示选择框，并可通过滑块查看爆炸装配视图。
- 多种检查模式：提供参考光照、中性光照、掠射光、轮廓输出和运行时清单模式。
- GitHub Pages 自动部署：推送到 `main` 后由 GitHub Actions 构建并发布。

## 技术栈

- [Three.js](https://threejs.org/) `0.180.x`
- TypeScript `5.9.x`
- Vite `6.x`
- GitHub Actions 与 GitHub Pages

## 环境要求

- Node.js 20 或更高版本
- npm 10 或兼容版本
- 支持 WebGL 的现代浏览器

## 本地运行

克隆仓库并安装依赖：

```bash
git clone https://github.com/zx2003/img2threejs-vintage-radio.git
cd img2threejs-vintage-radio
npm install
```

启动开发服务器：

```bash
npm run dev
```

终端会显示本地访问地址，通常为 `http://localhost:5173/`。

## 生产构建

执行 TypeScript 检查并生成生产版本：

```bash
npm run build
```

构建结果位于 `dist/`。本地检查生产构建：

```bash
npm run preview
```

## 操作方式

| 操作 | 效果 |
| --- | --- |
| 鼠标左键拖动 | 旋转观察模型 |
| 鼠标滚轮 | 放大或缩小 |
| 点击组件 | 选择部件并显示包围框 |
| 拖动“爆炸视图”滑块 | 展开模型装配层级 |
| 点击“复位” | 恢复相机、选择和爆炸状态 |

## URL 参数

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

## 目录结构

```text
.
├─ .github/workflows/deploy-pages.yml  # GitHub Pages 构建与部署
├─ src/
│  ├─ createObjectModel.ts             # 模型、材质、灯光和相机辅助函数
│  ├─ main.ts                          # 场景初始化、交互和检查模式
│  └─ style.css                        # 预览界面样式
├─ index.html                          # Vite 页面入口
├─ package.json                        # npm 脚本与依赖
├─ tsconfig.json                       # TypeScript 配置
└─ vite.config.ts                      # Vite 与 Pages 相对路径配置
```

## 模型结构

程序化模型以一个根节点组织，并保留主要组件的独立对象层级，包括：

- 圆角机身与前面板结构；
- 提手及左右安装连接件；
- 扬声器外圈、内凹安装区域和 grille；
- 调谐窗口外框、内嵌面板、刻度与指针；
- 左右旋钮、安装座和轴向连接；
- 与机身底部连接的四个支脚。

运行时会记录组件节点、装配 socket、连接关系和三角形数量，以支持质量检查及后续动画开发。

## 自动部署

`.github/workflows/deploy-pages.yml` 会在 `main` 分支更新时执行：

1. 安装锁定版本的 npm 依赖；
2. 运行 TypeScript 检查和 Vite 构建；
3. 上传 `dist/` 产物；
4. 发布到 GitHub Pages。

仓库的 Pages Source 需要保持为 **GitHub Actions**。

## 数据与隐私边界

公开仓库只包含运行预览所需的源码、配置和部署工作流。原始参考图片、雕刻 Spec、评测裁剪图及本地材质证据不会随 Pages 版本发布。

## 当前状态

这是面向浏览器实时展示的测试版本，重点验证程序化模型、组件结构、材质表现和交互能力。它不是扫描级数字孪生，单张参考图不可见区域仍包含合理推断。

## 许可

当前仓库尚未附带开源许可证。在添加许可证前，默认保留所有权利。
