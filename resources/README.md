# 树 UI 可复用资源清单

下载日期：2026-11-10

---

## 一、视觉素材（Kenney CC0 免费商用）

### kenney/foliage-sprites.zip（2.4MB）★ 最相关
- 100 个 2D 植物精灵图（Flat 版 + Shaded 版各 50 个）
- Vector/ 内含完整 SVG 矢量文件（foliageSprites_flat.svg、foliageSprites_shaded.svg）
- 灌木、草丛、藤蔓、花朵、蘑菇等，可直接嵌入 SVG 作为节点装饰
- 预览图：extracted/foliage-sprites/Sample.png

### kenney/nature-kit.zip（10.5MB）
- Side/ 文件夹：各种树的侧面 PNG（tree_default、tree_tall、tree_oak、tree_pine 系列）
- 还有草地、原木、树桩、蘑菇、花等装饰
- 适合用作背景元素或节点周围装饰

### kenney/foliage-pack.zip（2.2MB）
- Tilesheet/treeLeaves_default.png — 树冠叶片贴图（可裁切复用）
- Vector/ 矢量图
- 大量树叶、灌木 sprite

### kenney/game-icons.zip（1MB）
- 600+ 白色 2D 图标（star、checkmark、potion、gem、key、heart、book、shield...）
- 1x/2x 两种尺寸 + Vector SVG
- 适合做节点内的功能小图标

### kenney/abstract-platformer.zip（2.5MB）
- Vector/vector_complete.svg — 完整矢量图
- 背景、平台、几何风格关卡元素
- 可用于关卡路径节点底座

### kenney/ui-pack.zip（1.2MB）
- 通用 UI 按钮、面板、进度条素材
- 可用于详情面板装饰

---

## 二、代码参考（npm 包，全部已解包到 code-refs/unpacked/）

### 直接相关 ★

| 包名 | 用途 |
|------|------|
| svg-path-properties | **核心**：沿 SVG 路径计算点坐标 getPointAtLength()，把节点均匀分布在曲线上 |
| roughjs | **核心**：手绘风格 SVG/Canvas 渲染，可让藤条看起来有机自然 |
| d3-hierarchy | 树布局算法（tidy tree、radial tree），计算节点位置 |
| @visx/hierarchy | Airbnb 的 D3 hierarchy React 封装，拿来即用 |
| bezier-easing | 贝塞尔曲线数学，辅助生成平滑路径 |
| framer-motion | 已在用：弹性动画、过渡效果 |

### 游戏引擎级（大型，看思路）

| 包名 | 用途 |
|------|------|
| phaser | 2D 游戏引擎，有 PathFollower、Tilemap、Camera Scroll 等消消乐式关卡实现 |
| pixi.js | 高性能 2D WebGL 渲染，可做粒子+精灵图动画 |

### 动画增强

| 包名 | 用途 |
|------|------|
| gsap | 专业动画库，scrollTrigger 可做滚动视差 |
| lottie-react | 播放 After Effects JSON 动画 |
| react-spring | 弹性物理动画 |
| matter-js | 2D 物理引擎（果实掉落、叶子飘动效果） |

### 交互辅助

| 包名 | 用途 |
|------|------|
| react-zoom-pan-pinch | 鼠标/触屏平移缩放 SVG 画布 |
| react-svg-pan-zoom | SVG 专用平移缩放 |
| svg.js | SVG DOM 操作库 |

### 已有参考项目

| 目录 | 说明 |
|------|------|
| beautiful-skill-tree/ | React 技能树，用 CSS 渐变连线（非 SVG path）；节点状态管理可借鉴 |
| react-d3-tree/ | D3 树布局 + React 渲染，有 Link 组件绘制 cubic bezier 连线 |

---

## 三、实现消消乐藤条的关键技术思路

消消乐关卡地图的本质 = **一条 S 形贝塞尔曲线** + **节点沿曲线等距分布** + **装饰元素**

```
1. 定义路径: M(起点) C/C(控制点) ... → 一条从底部到顶部的蛇形 SVG path
2. 等距取点: 用 svg-path-properties 的 getPointAtLength(i * step) 取每个节点坐标
3. 画粗藤条: <path stroke-width="20" stroke="green" stroke-linecap="round" fill="none">
4. 节点: 在每个取点位置画圆形果实 + 小叶子（Kenney sprites）
5. 背景: 蓝天白云 + 视差滚动（framer-motion 或 gsap ScrollTrigger）
6. 交互: 点击节点 → 弹出详情面板
```

---

## 四、许可证

- 所有 Kenney 素材：CC0（免费商用，无需署名）
- 所有 npm 包代码：MIT / ISC（可参考学习）
