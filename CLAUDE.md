# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

**AnyPose** - 交互式姿势识别与骨骼预览网页应用

## 技术栈

- 原生 JavaScript (ES6+)
- HTML5 Canvas
- CSS3 (Grid, Flexbox, Gradients)
- MediaPipe Pose (姿势识别)

## 项目结构

```
骨骼/
├── index.html      # 主入口页面
├── styles.css      # 样式文件
├── app.js          # 核心应用逻辑
└── CLAUDE.md       # 本文件
```

## 核心功能

1. **骨骼预览** - 2D Canvas 渲染人体骨架，支持多种视图切换
2. **姿势识别** - 集成 MediaPipe Pose，可从图片或摄像头中识别姿势
3. **交互调整** - 支持拖动骨架关键点自定义姿势
4. **预设姿势** - 提供站立、坐姿、T型、弓步等预设姿势
5. **相似度评分** - 计算当前姿势与参考姿势的匹配度
6. **数据导出** - 支持导出 JSON 数据和骨架图片
7. **身体部位显示控制** - 可切换显示/隐藏头、手臂、躯干、腿部

## 开发指南

### 运行项目

直接在浏览器中打开 `index.html` 即可，无需构建工具：

```bash
# 使用 Python 启动简易服务器
python -m http.server 8080

# 或使用 Node.js
npx serve .

# 然后在浏览器访问 http://localhost:8080
```

### 核心类

`AnyPoseApp` - 主应用类，位于 [app.js](app.js)

主要方法：
- `initCanvas()` - 初始化 Canvas
- `initMediaPipe()` - 设置 MediaPipe Pose
- `handleImageUpload(file)` - 处理图片上传
- `detectPose()` - 执行姿势识别
- `toggleCamera()` - 切换摄像头
- `render()` - 渲染骨架
- `exportJSON()` / `exportImage()` - 导出功能

### MediaPipe 连接

应用通过 CDN 加载 MediaPipe：
```html
<script src="https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js"></script>
```

## 注意事项

- 摄像头功能需要 HTTPS 或 localhost 环境
- MediaPipe 模型首次加载需要网络连接
- Canvas 绘制使用 devicePixelRatio 处理高 DPI 屏幕

