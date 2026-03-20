// AnyPose 主应用逻辑 - 修复版本

// 生成参数默认值
const DEFAULT_GENERATION_PARAMS = {
    guidance_scale: 7.5,
    num_inference_steps: 30,
    strength: 0.8,
    seed: -1 // 随机种子
};

// 提示词最大长度限制
const MAX_PROMPT_LENGTH = 500;

class AnyPoseApp {
    constructor() {
        // Canvas
        this.mainCanvas = document.getElementById('mainCanvas');
        this.previewCanvas = document.getElementById('previewCanvas');
        this.mainCtx = this.mainCanvas.getContext('2d');
        this.previewCtx = this.previewCanvas.getContext('2d');

        // 状态
        this.currentPoseData = null;
        this.originalPoseData = null;
        this.uploadedImage = null;
        this.lastImageInfo = null;
        this.zoom = 1;
        this.selectedPoint = null;
        this.lineThickness = 8;
        this.colorTheme = 'rgb';

        // AI生成状态
        this.isGenerating = false;
        this.apiKey = ''; // 用户API密钥（会话级存储）
        this.lastGenerationResult = null;

        // 历史记录
        this.history = [];
        this.HISTORY_KEY = 'anypose_history';
        this.MAX_HISTORY = 50;

        // 配置中心
        this.config = {
            provider: 'doubao', // 默认服务商
            doubao: {
                apiKey: '',
                endpoint: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
                model: 'doubao-seedream-5-0-260128'
            },
            qwen: {
                apiKey: '',
                endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
                model: 'qwen-image-2.0-pro'
            },
            openai: {
                apiKey: '',
                endpoint: 'https://api.openai.com/v1/images/generations',
                model: 'dall-e-3'
            },
            // 可以添加更多服务商
            stability: {
                apiKey: '',
                endpoint: 'https://api.stability.ai/v1/generation/stable-diffusion-v1-6/text-to-image',
                model: 'stable-diffusion-v1-6'
            }
        };

        // 上传状态管理
        this.isProcessing = false;

        // 从 localStorage 加载配置
        this.loadConfigFromStorage();

        this.initCanvas();
        this.initEventListeners();
        this.initConfigUI();
        this.loadDefaultPose();
        this.loadHistory();
        this.renderHistory();
    }

    initCanvas() {
        // 主画布
        const mainRect = this.mainCanvas.getBoundingClientRect();
        this.mainCanvas.width = mainRect.width * window.devicePixelRatio;
        this.mainCanvas.height = mainRect.height * window.devicePixelRatio;
        this.mainCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
        this.mainCanvasWidth = mainRect.width;
        this.mainCanvasHeight = mainRect.height;

        // 预览画布
        const previewRect = this.previewCanvas.getBoundingClientRect();
        this.previewCanvas.width = previewRect.width * window.devicePixelRatio;
        this.previewCanvas.height = previewRect.height * window.devicePixelRatio;
        this.previewCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
        this.previewCanvasWidth = previewRect.width;
        this.previewCanvasHeight = previewRect.height;
    }

    destroyMediaPipe() {
        if (this.pose) {
            try {
                // 关闭并清理旧的 pose 实例
                this.pose.close();
            } catch (e) {
                // 忽略关闭错误
            }
            this.pose = null;
        }
    }

    async loadMediaPipeScripts() {
        if (typeof window.Pose !== 'undefined') {
            return true;
        }

        const scripts = [
            'https://unpkg.com/@mediapipe/pose/pose.js',
            'https://unpkg.com/@mediapipe/camera_utils/camera_utils.js',
            'https://unpkg.com/@mediapipe/drawing_utils/drawing_utils.js'
        ];

        for (const src of scripts) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = src;
                script.onload = resolve;
                script.onerror = reject;
                document.body.appendChild(script);
            });
        }

        return true;
    }

    async initMediaPipe() {
        // 首先清理任何现有的实例
        this.destroyMediaPipe();

        try {
            // 动态加载 MediaPipe 脚本
            await this.loadMediaPipeScripts();

            if (typeof window.Pose === 'undefined') {
                this.pose = null;
                return;
            }
            this.pose = new window.Pose({
                locateFile: (file) => `https://unpkg.com/@mediapipe/pose/${file}`
            });
            this.pose.setOptions({
                modelComplexity: 1,
                smoothLandmarks: true,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });
            this.pose.onResults((results) => this.onPoseResults(results));
        } catch (error) {
            this.pose = null;
        }
    }

    initEventListeners() {
        // 上传按钮
        const uploadBtn = document.getElementById('uploadBtn');
        const fileInput = document.getElementById('fileInput');
        if (uploadBtn && fileInput) {
            uploadBtn.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    this.handleImageUpload(file);
                    // 清空 input 以允许重复上传同名文件
                    e.target.value = '';
                }
            });
        }

        // 线条粗细
        const thicknessSlider = document.getElementById('thicknessSlider');
        const thicknessValue = document.getElementById('thicknessValue');
        if (thicknessSlider) {
            thicknessSlider.value = this.lineThickness;
            if (thicknessValue) thicknessValue.textContent = this.lineThickness + 'PX';
            thicknessSlider.addEventListener('input', (e) => {
                this.lineThickness = parseInt(e.target.value);
                if (thicknessValue) thicknessValue.textContent = this.lineThickness + 'PX';
                this.render();
            });
        }

        // 颜色主题
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                this.colorTheme = e.currentTarget.dataset.theme;
                this.render();
            });
        });

        // 下载按钮
        const downloadBtn = document.getElementById('downloadBtn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => this.exportImage());
        }

        // AI生成按钮
        const aiGenerateBtn = document.getElementById('aiGenerateBtn');
        if (aiGenerateBtn) {
            aiGenerateBtn.addEventListener('click', () => this.handleAIGenerate());
        }

        // 预览骨骼图按钮
        const previewSkeletonBtn = document.getElementById('previewSkeletonBtn');
        if (previewSkeletonBtn) {
            previewSkeletonBtn.addEventListener('click', () => this.previewSkeletonForAI());
        }

        // 骨骼图预览对话框关闭按钮
        const skeletonPreviewCloseBtn = document.getElementById('skeletonPreviewCloseBtn');
        if (skeletonPreviewCloseBtn) {
            skeletonPreviewCloseBtn.addEventListener('click', () => this.closeSkeletonPreview());
        }
        const closeSkeletonPreviewBtn = document.getElementById('closeSkeletonPreviewBtn');
        if (closeSkeletonPreviewBtn) {
            closeSkeletonPreviewBtn.addEventListener('click', () => this.closeSkeletonPreview());
        }

        // 开始生成按钮
        const startGenerateBtn = document.getElementById('startGenerateBtn');
        if (startGenerateBtn) {
            startGenerateBtn.addEventListener('click', () => this.confirmPromptAndGenerate());
        }

        // 提示词模板按钮
        document.querySelectorAll('.template-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const prompt = e.target.dataset.prompt;
                const promptInput = document.getElementById('promptInput');
                if (promptInput && prompt) {
                    promptInput.value = prompt;
                    promptInput.focus();
                }
            });
        });

        // 清空历史记录按钮
        const clearHistoryBtn = document.getElementById('clearHistoryBtn');
        if (clearHistoryBtn) {
            clearHistoryBtn.addEventListener('click', () => this.clearHistory());
        }

        // API设置按钮
        const apiSettingsBtn = document.getElementById('apiSettingsBtn');
        if (apiSettingsBtn) {
            apiSettingsBtn.addEventListener('click', () => this.showApiSettings());
        }

        // API设置对话框按钮
        const modalCloseBtn = document.getElementById('modalCloseBtn');
        const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
        const cancelApiKeyBtn = document.getElementById('cancelApiKeyBtn');
        const apiKeyInput = document.getElementById('apiKeyInput');
        const providerSelect = document.getElementById('providerSelect');
        const testApiBtn = document.getElementById('testApiBtn');
        const endpointInput = document.getElementById('endpointInput');
        const modelInput = document.getElementById('modelInput');

        if (modalCloseBtn) {
            modalCloseBtn.addEventListener('click', () => this.hideApiSettings());
        }

        if (saveApiKeyBtn) {
            saveApiKeyBtn.addEventListener('click', () => this.saveApiKey());
        }

        if (cancelApiKeyBtn) {
            cancelApiKeyBtn.addEventListener('click', () => this.hideApiSettings());
        }

        if (apiKeyInput) {
            apiKeyInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.saveApiKey();
                }
            });
        }

        if (providerSelect) {
            providerSelect.addEventListener('change', (e) => this.switchProvider(e.target.value));
        }

        if (testApiBtn) {
            testApiBtn.addEventListener('click', () => this.testApiConnection());
        }

        if (endpointInput) {
            endpointInput.addEventListener('change', (e) => this.updateConfig('endpoint', e.target.value));
        }

        if (modelInput) {
            modelInput.addEventListener('change', (e) => this.updateConfig('model', e.target.value));
        }

        // 重置按钮
        const resetBtn = document.getElementById('resetBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.resetPose());
        }

        // 主画布鼠标事件
        this.mainCanvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.mainCanvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.mainCanvas.addEventListener('mouseup', () => this.onMouseUp());

        // 窗口大小变化
        window.addEventListener('resize', () => {
            this.initCanvas();
            this.render();
        });
    }

    async handleImageUpload(file) {
        // 【关键】立即清除所有可能导致不匹配的状态
        // 清除骨骼，这样在新骨骼准备好之前不会在新图片上绘制旧骨骼
        this.currentPoseData = null;
        this.lastImageInfo = null;
        this.boneLengths = null;
        this.isProcessing = true;

        // 更新占位符显示（显示"暂无骨骼预览"）
        this.updatePlaceholderVisibility();

        // 【关键】每次上传新图片时，完全重新初始化 MediaPipe Pose！
        // 这样可以确保没有旧的回调能够触发并干扰
        await this.initMediaPipe();

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                // 立即设置 uploadedImage，让用户看到新图片
                this.uploadedImage = img;

                if (this.pose) {
                    // 发送到新的（干净的）pose 实例
                    this.pose.send({ image: img });
                }

                // 立即渲染，显示新图片但不显示骨骼
                this.render();
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    onPoseResults(results) {
        // 由于我们在每次上传时重新初始化 MediaPipe，
        // 这个结果一定是来自最新的图片！无需检查 ID。

        if (results.poseLandmarks) {
            this.isProcessing = false;
            const mp = results.poseLandmarks;

            const getPoint = (index, defaultX, defaultY) => {
                if (mp[index]) {
                    let x = mp[index].x;
                    let y = mp[index].y;
                    const visibility = mp[index].visibility || 1;
                    const z = mp[index].z || 0;

                    if (x < 0 || x > 1 || y < 0 || y > 1 || !isFinite(x) || !isFinite(y)) {
                        return { x: defaultX, y: defaultY, z: 0, visibility: 1 };
                    }
                    return { x, y, z, visibility };
                }
                return { x: defaultX, y: defaultY, z: 0, visibility: 1 };
            };

            const interpolatePoint = (p1, p2, t) => {
                return {
                    x: p1.x + (p2.x - p1.x) * t,
                    y: p1.y + (p2.y - p1.y) * t,
                    z: (p1.z + p2.z) / 2,
                    visibility: Math.min(p1.visibility, p2.visibility)
                };
            };

            // OpenPose 20点结构
            // 0: 鼻子, 1: 左眼内, 2: 左眼外, 3: 右眼内, 4: 右眼外
            const nose = getPoint(0, 0.5, 0.22);
            const leftEyeIn = getPoint(1, 0.47, 0.2);
            const leftEyeOut = getPoint(2, 0.44, 0.21);
            const rightEyeIn = getPoint(4, 0.53, 0.2);
            const rightEyeOut = getPoint(5, 0.56, 0.21);

            const leftShoulder = getPoint(11, 0.4, 0.3);
            const rightShoulder = getPoint(12, 0.6, 0.3);
            const neck = interpolatePoint(leftShoulder, rightShoulder, 0.5);
            neck.y -= 0.02;

            const leftElbow = getPoint(13, 0.3, 0.4);
            const leftWrist = getPoint(15, 0.22, 0.5);
            const rightElbow = getPoint(14, 0.7, 0.4);
            const rightWrist = getPoint(16, 0.78, 0.5);

            const leftHip = getPoint(23, 0.43, 0.55);
            const rightHip = getPoint(24, 0.57, 0.55);
            const pelvis = interpolatePoint(leftHip, rightHip, 0.5);

            const leftKnee = getPoint(25, 0.42, 0.7);
            const leftAnkle = getPoint(27, 0.4, 0.88);
            const rightKnee = getPoint(26, 0.58, 0.7);
            const rightAnkle = getPoint(28, 0.6, 0.88);

            this.currentPoseData = [
                nose,           // 0: 鼻子
                leftEyeIn,      // 1: 左眼内
                leftEyeOut,     // 2: 左眼外
                rightEyeIn,     // 3: 右眼内
                rightEyeOut,    // 4: 右眼外
                leftShoulder,   // 5: 左肩
                leftElbow,      // 6: 左肘
                leftWrist,      // 7: 左手腕
                rightShoulder,  // 8: 右肩
                rightElbow,     // 9: 右肘
                rightWrist,     // 10: 右手腕
                leftHip,        // 11: 左髋
                leftKnee,       // 12: 左膝
                leftAnkle,      // 13: 左脚踝
                rightHip,       // 14: 右髋
                rightKnee,      // 15: 右膝
                rightAnkle,     // 16: 右脚踝
                neck,           // 17: 脖子
                pelvis          // 18: 骨盆
            ];

            this.currentPoseData.forEach((p) => {
                if (p.x < 0.05) p.x = 0.05;
                if (p.x > 0.95) p.x = 0.95;
                if (p.y < 0.05) p.y = 0.05;
                if (p.y > 0.95) p.y = 0.95;
            });

            this.originalPoseData = this.currentPoseData.map(p => ({ ...p }));

            // 识别完成后立刻计算并锁定所有肢体的长度
            this.calculateBoneLengths();

            // 更新占位符显示（隐藏占位符）
            this.updatePlaceholderVisibility();

            this.render();
        }
    }

    updatePlaceholderVisibility() {
        const placeholder = document.getElementById('previewPlaceholder');
        if (!placeholder) return;

        if (this.currentPoseData) {
            // 有骨骼数据，隐藏占位符
            placeholder.style.display = 'none';
        } else {
            // 没有骨骼数据，显示占位符
            placeholder.style.display = 'block';
        }
    }

    loadDefaultPose() {
        this.currentPoseData = this.getPresetPose('standing');

        // 加载预设姿势后也要锁定长度
        this.calculateBoneLengths();

        this.updatePlaceholderVisibility();
        this.render();
    }

    getPresetPose(presetName) {
        const cx = 0.5, cy = 0.12;
        const shoulderWidth = 0.28;
        const torsoLength = 0.3;
        const armLength = 0.45;
        const legLength = 0.55;
        const hipWidth = 0.16;
        const eyeOffsetX = 0.12;
        const eyeOffsetY = 0.08;

        return [
            { x: cx, y: cy, z: 0 },           // 0: 鼻子
            { x: cx - eyeOffsetX * 0.3, y: cy - eyeOffsetY * 0.4, z: 0 }, // 1: 左眼内
            { x: cx - eyeOffsetX, y: cy - eyeOffsetY, z: 0 }, // 2: 左眼外
            { x: cx + eyeOffsetX * 0.3, y: cy - eyeOffsetY * 0.4, z: 0 }, // 3: 右眼内
            { x: cx + eyeOffsetX, y: cy - eyeOffsetY, z: 0 }, // 4: 右眼外
            { x: cx - shoulderWidth / 2, y: cy + 0.12, z: 0 }, // 5: 左肩
            { x: cx - shoulderWidth / 2 - 0.02, y: cy + 0.12 + armLength * 0.5, z: 0 }, // 6: 左肘
            { x: cx - shoulderWidth / 2 + 0.02, y: cy + 0.12 + armLength, z: 0 }, // 7: 左手腕
            { x: cx + shoulderWidth / 2, y: cy + 0.12, z: 0 }, // 8: 右肩
            { x: cx + shoulderWidth / 2 + 0.02, y: cy + 0.12 + armLength * 0.5, z: 0 }, // 9: 右肘
            { x: cx + shoulderWidth / 2 - 0.02, y: cy + 0.12 + armLength, z: 0 }, // 10: 右手腕
            { x: cx - hipWidth / 2, y: cy + 0.12 + torsoLength, z: 0 }, // 11: 左髋
            { x: cx - hipWidth / 2 + 0.01, y: cy + 0.12 + torsoLength + legLength * 0.5, z: 0 }, // 12: 左膝
            { x: cx - hipWidth / 2 - 0.02, y: cy + 0.12 + torsoLength + legLength, z: 0 }, // 13: 左脚踝
            { x: cx + hipWidth / 2, y: cy + 0.12 + torsoLength, z: 0 }, // 14: 右髋
            { x: cx + hipWidth / 2 - 0.01, y: cy + 0.12 + torsoLength + legLength * 0.5, z: 0 }, // 15: 右膝
            { x: cx + hipWidth / 2 + 0.02, y: cy + 0.12 + torsoLength + legLength, z: 0 }, // 16: 右脚踝
            { x: cx, y: cy + 0.12, z: 0 }, // 17: 脖子
            { x: cx, y: cy + 0.12 + torsoLength, z: 0 } // 18: 骨盆
        ].map(p => ({ ...p, visibility: 1 }));
    }

    onMouseDown(e) {
        const rect = this.mainCanvas.getBoundingClientRect();
        this.selectedPoint = null;
        if (!this.currentPoseData) return;

        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        for (let i = 0; i < this.currentPoseData.length; i++) {
            const p = this.currentPoseData[i];
            let sx, sy;

            if (this.lastImageInfo) {
                const { offsetX, offsetY, drawWidth, drawHeight } = this.lastImageInfo;
                sx = offsetX + p.x * drawWidth;
                sy = offsetY + p.y * drawHeight;
            } else {
                const scale = Math.min(this.mainCanvasWidth, this.mainCanvasHeight) * this.zoom * 0.5;
                const centerX = this.mainCanvasWidth / 2;
                const centerY = this.mainCanvasHeight / 2;
                sx = centerX + (p.x - 0.5) * scale;
                sy = centerY + (p.y - 0.35) * scale;
            }

            const dist = Math.sqrt((mouseX - sx) ** 2 + (mouseY - sy) ** 2);
            if (dist < 20) {
                this.selectedPoint = i;
                break;
            }
        }
    }

    onMouseMove(e) {
        const rect = this.mainCanvas.getBoundingClientRect();
        if (this.selectedPoint !== null && this.currentPoseData) {
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            let targetX, targetY;

            if (this.lastImageInfo) {
                const { offsetX, offsetY, drawWidth, drawHeight } = this.lastImageInfo;
                targetX = (mouseX - offsetX) / drawWidth;
                targetY = (mouseY - offsetY) / drawHeight;
            } else {
                const scale = Math.min(this.mainCanvasWidth, this.mainCanvasHeight) * this.zoom * 0.5;
                const centerX = this.mainCanvasWidth / 2;
                const centerY = this.mainCanvasHeight / 2;
                targetX = (mouseX - centerX) / scale + 0.5;
                targetY = (mouseY - centerY) / scale + 0.35;
            }

            // 【核心变化】：不再粗暴地直接赋值 p.x 和 p.y
            // 而是把目标位置丢给 IK 算法去计算联动
            this.solveIK(this.selectedPoint, targetX, targetY);

            this.render();
            this.mainCanvas.style.cursor = 'grabbing';
        } else {
            this.mainCanvas.style.cursor = 'default';
        }
    }

    onMouseUp() {
        this.selectedPoint = null;
        this.mainCanvas.style.cursor = 'default';
    }

    // ========== 3D 变换相关方法 ==========

    getThemeColors() {
        // 严格遵循 ControlNet / OpenPose 的标准 RGB 规范，不要使用自定义颜色
        return [
            'rgb(255, 0, 0)',      // 0: 鼻子 (Nose)
            'rgb(255, 0, 255)',    // 1: 左眼 (L-Eye)
            'rgb(255, 0, 255)',    // 2: 右眼 (R-Eye)
            'rgb(255, 0, 85)',     // 3: 左耳 (L-Ear)
            'rgb(255, 0, 170)',    // 4: 右耳 (R-Ear)
            'rgb(255, 85, 0)',     // 5: 左肩 (L-Sho)
            'rgb(255, 170, 0)',    // 6: 左肘 (L-Elb)
            'rgb(255, 255, 0)',    // 7: 左手腕 (L-Wri)
            'rgb(170, 255, 0)',    // 8: 右肩 (R-Sho)
            'rgb(85, 255, 0)',     // 9: 右肘 (R-Elb)
            'rgb(0, 255, 0)',      // 10: 右手腕 (R-Wri)
            'rgb(0, 255, 85)',     // 11: 左髋 (L-Hip)
            'rgb(0, 255, 170)',    // 12: 左膝 (L-Knee)
            'rgb(0, 255, 255)',    // 13: 左脚踝 (L-Ank)
            'rgb(0, 170, 255)',    // 14: 右髋 (R-Hip)
            'rgb(0, 85, 255)',     // 15: 右膝 (R-Knee)
            'rgb(0, 0, 255)',      // 16: 右脚踝 (R-Ank)
            'rgb(255, 85, 255)',   // 17: 脖子 (Neck)
            'rgb(255, 255, 255)'   // 18: 骨盆 (标准 OpenPose 不绘制点，可设为白/黑)
        ];
    }

    render() {
        // 更新占位符显示状态，确保与 currentPoseData 同步
        this.updatePlaceholderVisibility();
        // 渲染主画布（左侧）
        this.renderMainCanvas();
        // 渲染预览画布（右侧）
        this.renderPreviewCanvas();
    }

    renderMainCanvas() {
        const ctx = this.mainCtx;
        const width = this.mainCanvasWidth;
        const height = this.mainCanvasHeight;

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);

        let imageInfo = null;

        // 如果有上传的图片，先绘制图片
        if (this.uploadedImage) {
            imageInfo = this.drawImageCentered(ctx, this.uploadedImage, width, height);
            this.lastImageInfo = imageInfo;
        } else {
            // 绘制网格
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
            ctx.lineWidth = 1;
            const gridSize = 40 * this.zoom;
            for (let x = 0; x < width; x += gridSize) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                ctx.stroke();
            }
            for (let y = 0; y < height; y += gridSize) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();
            }
        }

        if (this.currentPoseData) {
            this.drawSkeleton(ctx, this.currentPoseData, width, height, true, true, imageInfo);
        }
    }

    drawImageCentered(ctx, img, canvasWidth, canvasHeight) {
        const imgRatio = img.width / img.height;
        const canvasRatio = canvasWidth / canvasHeight;

        let drawWidth, drawHeight, offsetX, offsetY;

        if (imgRatio > canvasRatio) {
            drawWidth = canvasWidth;
            drawHeight = canvasWidth / imgRatio;
            offsetX = 0;
            offsetY = (canvasHeight - drawHeight) / 2;
        } else {
            drawHeight = canvasHeight;
            drawWidth = canvasHeight * imgRatio;
            offsetX = (canvasWidth - drawWidth) / 2;
            offsetY = 0;
        }

        ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

        return { offsetX, offsetY, drawWidth, drawHeight };
    }

    renderPreviewCanvas() {
        const ctx = this.previewCtx;
        const width = this.previewCanvasWidth;
        const height = this.previewCanvasHeight;

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, width, height);

        if (this.currentPoseData) {
            this.drawPreviewSkeleton(ctx, this.currentPoseData, width, height);
        }
    }

    drawSkeleton(ctx, landmarks, width, height, interactive, useFullSize, imageInfo) {
        let getPos;

        if (imageInfo) {
            const { offsetX, offsetY, drawWidth, drawHeight } = imageInfo;
            getPos = (lm) => ({
                x: offsetX + lm.x * drawWidth,
                y: offsetY + lm.y * drawHeight
            });
        } else {
            const scaleFactor = useFullSize ? 0.5 : 0.6;
            const scale = Math.min(width, height) * this.zoom * scaleFactor;
            const centerX = width / 2;
            const centerY = height / 2;
            getPos = (lm) => ({
                x: centerX + (lm.x - 0.5) * scale,
                y: centerY + (lm.y - 0.35) * scale
            });
        }

        const joints = {
            nose: 0, leftEyeIn: 1, leftEyeOut: 2,
            rightEyeIn: 3, rightEyeOut: 4,
            leftShoulder: 5, leftElbow: 6, leftWrist: 7,
            rightShoulder: 8, rightElbow: 9, rightWrist: 10,
            leftHip: 11, leftKnee: 12, leftAnkle: 13,
            rightHip: 14, rightKnee: 15, rightAnkle: 16,
            neck: 17, pelvis: 18
        };

        // 使用主题颜色
        const stickmanColors = this.getThemeColors();

        // 严格遵循 OpenPose 标准拓扑连接与属性连线颜色
        const connections = [
            // [颜色RGB, 起点, 终点]
            [stickmanColors[17], joints.nose, joints.neck],           // 鼻子 → 脖子
            [stickmanColors[5], joints.neck, joints.leftShoulder],     // 脖子 → 左肩
            [stickmanColors[8], joints.neck, joints.rightShoulder],    // 脖子 → 右肩
            [stickmanColors[6], joints.leftShoulder, joints.leftElbow], // 左臂：肩 → 肘
            [stickmanColors[7], joints.leftElbow, joints.leftWrist],   // 左臂：肘 → 手腕
            [stickmanColors[9], joints.rightShoulder, joints.rightElbow], // 右臂：肩 → 肘
            [stickmanColors[10], joints.rightElbow, joints.rightWrist], // 右臂：肘 → 手腕
            [stickmanColors[17], joints.leftShoulder, joints.rightShoulder], // 左肩 → 右肩（躯干上部）
            [stickmanColors[11], joints.leftShoulder, joints.leftHip],  // 左肩 → 左髋
            [stickmanColors[14], joints.rightShoulder, joints.rightHip], // 右肩 → 右髋
            [stickmanColors[11], joints.leftHip, joints.rightHip],      // 左髋 → 右髋（躯干下部）
            [stickmanColors[12], joints.leftHip, joints.leftKnee],      // 左腿：髋 → 膝
            [stickmanColors[13], joints.leftKnee, joints.leftAnkle],    // 左腿：膝 → 脚踝
            [stickmanColors[15], joints.rightHip, joints.rightKnee],    // 右腿：髋 → 膝
            [stickmanColors[16], joints.rightKnee, joints.rightAnkle],  // 右腿：膝 → 脚踝
        ];

        // 绘制连线（OpenPose 标准风格：更粗的线条）
        for (const [color, a, b] of connections) {
            const p1 = landmarks[a];
            const p2 = landmarks[b];
            if (p1 && p2) {
                const pos1 = getPos(p1);
                const pos2 = getPos(p2);
                ctx.strokeStyle = color;
                ctx.lineWidth = Math.max(10, this.lineThickness * 2.0);
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(pos1.x, pos1.y);
                ctx.lineTo(pos2.x, pos2.y);
                ctx.stroke();
            }
        }

        // 绘制关节点（OpenPose 标准风格：更大的圆点）
        for (let i = 0; i < landmarks.length; i++) {
            const lm = landmarks[i];
            if (!lm) continue;
            // 跳过头部除了鼻子以外的节点 (1-4: 眼睛、耳朵)
            if (i >= 1 && i <= 4) continue;

            const pos = getPos(lm);
            const isSelected = interactive && this.selectedPoint === i;

            // OpenPose 标准风格：适中的圆点，鼻子节点放大作为头部
            let baseRadius = Math.max(4, this.lineThickness * 0.6);
            if (i === 0) { // 鼻子节点放大
                baseRadius = baseRadius * 2.5;
            }
            const radius = isSelected ? baseRadius + 3 : baseRadius;

            ctx.beginPath();
            ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = isSelected ? '#ffd700' : stickmanColors[i];
            ctx.fill();

            // 选中时加高亮边框
            if (isSelected) {
                ctx.strokeStyle = '#ffaa00';
                ctx.lineWidth = 3;
                ctx.stroke();
            }
        }
    }

    drawPreviewSkeleton(ctx, landmarks, width, height, isExport = false) {
        let getPos;

        if (isExport) {
            // 导出时：坐标已归一化到 [0, 1]，直接乘以宽高
            getPos = (lm) => ({
                x: lm.x * width,
                y: lm.y * height
            });
        } else if (this.lastImageInfo && this.uploadedImage) {
            // UI 预览状态下且有原图，映射到预览框居中
            const { offsetX, offsetY, drawWidth, drawHeight } = this.lastImageInfo;

            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;
            for (const lm of landmarks) {
                if (lm) {
                    const px = offsetX + lm.x * drawWidth;
                    const py = offsetY + lm.y * drawHeight;
                    minX = Math.min(minX, px);
                    maxX = Math.max(maxX, px);
                    minY = Math.min(minY, py);
                    maxY = Math.max(maxY, py);
                }
            }

            const boneWidth = maxX - minX;
            const boneHeight = maxY - minY;
            const boneCenterX = (minX + maxX) / 2;
            const boneCenterY = (minY + maxY) / 2;

            const previewScale = Math.min(width / (boneWidth * 1.4), height / (boneHeight * 1.4));
            const previewCenterX = width / 2;
            const previewCenterY = height / 2;

            getPos = (lm) => {
                const originalX = offsetX + lm.x * drawWidth;
                const originalY = offsetY + lm.y * drawHeight;
                return {
                    x: previewCenterX + (originalX - boneCenterX) * previewScale,
                    y: previewCenterY + (originalY - boneCenterY) * previewScale
                };
            };
        } else {
            // UI 预览状态下，没有原图时使用通用路径
            const scale = Math.min(width, height) * 0.6;
            const centerX = width / 2;
            const centerY = height / 2;
            getPos = (lm) => ({
                x: centerX + (lm.x - 0.5) * scale,
                y: centerY + (lm.y - 0.35) * scale
            });
        }

        const joints = {
            nose: 0, leftEyeIn: 1, leftEyeOut: 2,
            rightEyeIn: 3, rightEyeOut: 4,
            leftShoulder: 5, leftElbow: 6, leftWrist: 7,
            rightShoulder: 8, rightElbow: 9, rightWrist: 10,
            leftHip: 11, leftKnee: 12, leftAnkle: 13,
            rightHip: 14, rightKnee: 15, rightAnkle: 16,
            neck: 17, pelvis: 18
        };

        // 使用主题颜色
        const stickmanColors = this.getThemeColors();

        // OpenPose 连接方式 - V形头部，与主画布一致
        const connections = [
            // 严格遵循 OpenPose 标准拓扑连接与属性连线颜色
            [stickmanColors[17], joints.nose, joints.neck],           // 鼻子 → 脖子
            [stickmanColors[5], joints.neck, joints.leftShoulder],     // 脖子 → 左肩
            [stickmanColors[8], joints.neck, joints.rightShoulder],    // 脖子 → 右肩
            [stickmanColors[6], joints.leftShoulder, joints.leftElbow], // 左臂：肩 → 肘
            [stickmanColors[7], joints.leftElbow, joints.leftWrist],   // 左臂：肘 → 手腕
            [stickmanColors[9], joints.rightShoulder, joints.rightElbow], // 右臂：肩 → 肘
            [stickmanColors[10], joints.rightElbow, joints.rightWrist], // 右臂：肘 → 手腕
            [stickmanColors[17], joints.leftShoulder, joints.rightShoulder], // 左肩 → 右肩（躯干上部）
            [stickmanColors[11], joints.leftShoulder, joints.leftHip],  // 左肩 → 左髋
            [stickmanColors[14], joints.rightShoulder, joints.rightHip], // 右肩 → 右髋
            [stickmanColors[11], joints.leftHip, joints.rightHip],      // 左髋 → 右髋（躯干下部）
            [stickmanColors[12], joints.leftHip, joints.leftKnee],      // 左腿：髋 → 膝
            [stickmanColors[13], joints.leftKnee, joints.leftAnkle],    // 左腿：膝 → 脚踝
            [stickmanColors[15], joints.rightHip, joints.rightKnee],    // 右腿：髋 → 膝
            [stickmanColors[16], joints.rightKnee, joints.rightAnkle],  // 右腿：膝 → 脚踝
        ];

        // OpenPose 标准风格：更粗的线条和适中的关节点
        const baseThickness = isExport ? Math.max(10, width * 0.02) : Math.max(10, this.lineThickness * 1.0);
        const basePointRadius = isExport ? Math.max(5, width * 0.008) : Math.max(5, this.lineThickness * 0.4);

        // 绘制连接线（火柴人风格）
        for (const [color, a, b] of connections) {
            const p1 = landmarks[a];
            const p2 = landmarks[b];
            if (p1 && p2) {
                const pos1 = getPos(p1);
                const pos2 = getPos(p2);
                ctx.strokeStyle = color;
                ctx.lineWidth = baseThickness;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(pos1.x, pos1.y);
                ctx.lineTo(pos2.x, pos2.y);
                ctx.stroke();
            }
        }

        // 绘制关节节点（火柴人风格：小圆点）
        for (let i = 0; i < landmarks.length; i++) {
            const lm = landmarks[i];
            if (!lm) continue;
            // 跳过头部除了鼻子以外的节点 (1-4: 眼睛、耳朵)
            if (i >= 1 && i <= 4) continue;

            const pos = getPos(lm);
            const color = stickmanColors[i] || '#ffffff';

            // 鼻子节点放大作为头部
            let radius = basePointRadius;
            if (i === 0) {
                radius = basePointRadius * 2.5;
            }

            ctx.beginPath();
            ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
        }
    }

    // 1. 计算并记录当前姿势的初始四肢长度
    calculateBoneLengths() {
        if (!this.currentPoseData) return;

        // 两点之间距离公式
        const dist = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const p = this.currentPoseData;

        // OpenPose 20点索引: 5=左肩,6=左肘,7=左手腕; 8=右肩,9=右肘,10=右手腕;
        //                   11=左髋,12=左膝,13=左脚踝; 14=右髋,15=右膝,16=右脚踝; 17=脖子,18=骨盆
        //                   0=鼻子,1=左眼内,2=左眼外,3=右眼内,4=右眼外
        this.boneLengths = {
            leftUpperArm: dist(p[5], p[6]),    // 左大臂 (左肩->左肘)
            leftLowerArm: dist(p[6], p[7]),    // 左小臂 (左肘->左手腕)
            rightUpperArm: dist(p[8], p[9]),   // 右大臂 (右肩->右肘)
            rightLowerArm: dist(p[9], p[10]),   // 右小臂 (右肘->右手腕)
            leftUpperLeg: dist(p[11], p[12]),   // 左大腿 (左髋->左膝)
            leftLowerLeg: dist(p[12], p[13]),  // 左小腿 (左膝->左脚踝)
            rightUpperLeg: dist(p[14], p[15]), // 右大腿 (右髋->右膝)
            rightLowerLeg: dist(p[15], p[16]), // 右小腿 (右膝->右脚踝)
            // 眼部骨骼长度
            leftEyeInnerOuter: dist(p[1], p[2]),  // 左眼内->左眼外
            rightEyeInnerOuter: dist(p[3], p[4]), // 右眼内->右眼外
            noseLeftEye: dist(p[0], p[1]),         // 鼻子->左眼内
            noseRightEye: dist(p[0], p[3]),        // 鼻子->右眼内
            // 脖子相关长度
            noseNeck: dist(p[0], p[17]),      // 鼻子->脖子
            neckLeftShoulder: dist(p[17], p[5]), // 脖子->左肩
            neckRightShoulder: dist(p[17], p[8]), // 脖子->右肩
            neckPelvis: dist(p[17], p[18])       // 脖子->骨盆
        };
    }

    // 2. 轻量级 FABRIK 逆向运动学求解器
    solveIK(index, targetX, targetY) {
        const p = this.currentPoseData;
        const dist = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const bl = this.boneLengths;

        // 如果还没有记录长度，直接赋值并返回
        if (!bl) {
            p[index].x = targetX;
            p[index].y = targetY;
            return;
        }

        // 内部辅助函数：解算两个骨架的联动 (比如 肩 -> 肘 -> 腕)
        const solve2Bone = (rootIdx, midIdx, endIdx, len1, len2, tx, ty) => {
            const root = p[rootIdx];
            let end = { x: tx, y: ty };
            const maxLen = len1 + len2;
            let dRootEnd = Math.max(0.0001, dist(root, end));

            // 限制 1：最大伸展距离限制（防拉长）
            if (dRootEnd > maxLen) {
                end.x = root.x + (end.x - root.x) * (maxLen / dRootEnd);
                end.y = root.y + (end.y - root.y) * (maxLen / dRootEnd);
            }

            // 前向传递 (把末端拉到鼠标位置，推算关节)
            let dEndMid = Math.max(0.0001, dist(end, p[midIdx]));
            let newMidX = end.x + (p[midIdx].x - end.x) * (len2 / dEndMid);
            let newMidY = end.y + (p[midIdx].y - end.y) * (len2 / dEndMid);

            // 反向传递 (把根部固定死，推算正确的关节位置)
            let dRootMid = Math.max(0.0001, dist(root, {x: newMidX, y: newMidY}));
            p[midIdx].x = root.x + (newMidX - root.x) * (len1 / dRootMid);
            p[midIdx].y = root.y + (newMidY - root.y) * (len1 / dRootMid);

            // 最终定位末端 (手腕/脚踝)
            let dMidEnd = Math.max(0.0001, dist(p[midIdx], end));
            p[endIdx].x = p[midIdx].x + (end.x - p[midIdx].x) * (len2 / dMidEnd);
            p[endIdx].y = p[midIdx].y + (end.y - p[midIdx].y) * (len2 / dMidEnd);
        };

        // 内部辅助函数：解算单个骨架，带弹性限制 (比如只拖拽手肘时)
        // stretchFactor: 允许拉伸的最大倍数（1.5 = 允许拉长到1.5倍）
        const solve1BoneWithFlex = (rootIdx, endIdx, len, tx, ty, stretchFactor = 1.5) => {
            const root = p[rootIdx];
            const target = { x: tx, y: ty };
            const d = Math.max(0.0001, dist(root, target));
            const maxLen = len * stretchFactor;

            if (d <= maxLen) {
                // 在允许范围内，直接移动
                p[endIdx].x = tx;
                p[endIdx].y = ty;
            } else {
                // 超过限制，固定在最大长度处
                p[endIdx].x = root.x + (tx - root.x) * (maxLen / d);
                p[endIdx].y = root.y + (ty - root.y) * (maxLen / d);
            }
        };

        // 内部辅助函数：严格限制（无弹性，用于四肢）
        const solve1BoneStrict = (rootIdx, endIdx, len, tx, ty) => {
            const root = p[rootIdx];
            const d = Math.max(0.0001, dist(root, {x: tx, y: ty}));
            p[endIdx].x = root.x + (tx - root.x) * (len / d);
            p[endIdx].y = root.y + (ty - root.y) * (len / d);
        };

        // 根据你鼠标拖拽的是哪个点，调用对应的联动逻辑 (OpenPose 20点索引)
        if (index === 7) { solve2Bone(5, 6, 7, bl.leftUpperArm, bl.leftLowerArm, targetX, targetY); }       // 左手腕
        else if (index === 6) { solve1BoneStrict(5, 6, bl.leftUpperArm, targetX, targetY); solve1BoneStrict(6, 7, bl.leftLowerArm, p[7].x, p[7].y); } // 左肘
        else if (index === 10) { solve2Bone(8, 9, 10, bl.rightUpperArm, bl.rightLowerArm, targetX, targetY); }      // 右手腕
        else if (index === 9) { solve1BoneStrict(8, 9, bl.rightUpperArm, targetX, targetY); solve1BoneStrict(9, 10, bl.rightLowerArm, p[10].x, p[10].y); } // 右肘
        else if (index === 13) { solve2Bone(11, 12, 13, bl.leftUpperLeg, bl.leftLowerLeg, targetX, targetY); }   // 左脚踝
        else if (index === 12) { solve1BoneStrict(11, 12, bl.leftUpperLeg, targetX, targetY); solve1BoneStrict(12, 13, bl.leftLowerLeg, p[13].x, p[13].y); } // 左膝
        else if (index === 16) { solve2Bone(14, 15, 16, bl.rightUpperLeg, bl.rightLowerLeg, targetX, targetY); } // 右脚踝
        else if (index === 15) { solve1BoneStrict(14, 15, bl.rightUpperLeg, targetX, targetY); solve1BoneStrict(15, 16, bl.rightLowerLeg, p[16].x, p[16].y); } // 右膝
        // 鼻子节点处理 - 以脖子为根节点，限制鼻子不能离脖子太远（允许2.0倍拉伸）
        else if (index === 0 && bl.noseNeck && bl.noseLeftEye && bl.noseRightEye && bl.leftEyeInnerOuter && bl.rightEyeInnerOuter) {
            // 限制鼻子相对脖子的距离
            solve1BoneWithFlex(17, 0, bl.noseNeck, targetX, targetY, 2.0);
            // 联动调整眼睛相对鼻子的位置
            solve1BoneWithFlex(0, 1, bl.noseLeftEye, p[1].x, p[1].y, 2.0);
            solve1BoneWithFlex(0, 3, bl.noseRightEye, p[3].x, p[3].y, 2.0);
            solve1BoneWithFlex(1, 2, bl.leftEyeInnerOuter, p[2].x, p[2].y, 2.0);
            solve1BoneWithFlex(3, 4, bl.rightEyeInnerOuter, p[4].x, p[4].y, 2.0);
        }
        // 眼部节点处理 - 带弹性限制（允许4.0倍拉伸，更宽松）
        else if (index === 2 && bl.leftEyeInnerOuter) { solve1BoneWithFlex(1, 2, bl.leftEyeInnerOuter, targetX, targetY, 4.0); }                          // 左眼外
        else if (index === 4 && bl.rightEyeInnerOuter) { solve1BoneWithFlex(3, 4, bl.rightEyeInnerOuter, targetX, targetY, 4.0); }                         // 右眼外
        else if (index === 1 && bl.noseLeftEye && bl.leftEyeInnerOuter) {                                                                                          // 左眼内
            solve1BoneWithFlex(0, 1, bl.noseLeftEye, targetX, targetY, 4.0);
            solve1BoneWithFlex(1, 2, bl.leftEyeInnerOuter, p[2].x, p[2].y, 4.0);
        }
        else if (index === 3 && bl.noseRightEye && bl.rightEyeInnerOuter) {                                                                                          // 右眼内
            solve1BoneWithFlex(0, 3, bl.noseRightEye, targetX, targetY, 4.0);
            solve1BoneWithFlex(3, 4, bl.rightEyeInnerOuter, p[4].x, p[4].y, 4.0);
        }
        // 脖子节点处理 - 带弹性限制（允许2.0倍拉伸）
        else if (index === 17 && bl.noseNeck && bl.neckLeftShoulder && bl.neckRightShoulder && bl.neckPelvis) {
            // 先移动脖子到目标位置（带弹性限制，以骨盆为根？或以肩膀为根？这里选择更自由：可以拉着整个上半身动）
            // 注意：脖子是连接点，我们限制它相对骨盆的距离，同时保持肩膀相对脖子的距离
            solve1BoneWithFlex(18, 17, bl.neckPelvis, targetX, targetY, 2.0);
            // 然后调整左肩、右肩、鼻子相对脖子的位置
            solve1BoneWithFlex(17, 5, bl.neckLeftShoulder, p[5].x, p[5].y, 2.0);
            solve1BoneWithFlex(17, 8, bl.neckRightShoulder, p[8].x, p[8].y, 2.0);
            solve1BoneWithFlex(17, 0, bl.noseNeck, p[0].x, p[0].y, 2.0);
        }
        else {
            // 如果拖拽的是肩膀、骨盆等躯干节点，直接移动，并重新计算保存全身比例
            p[index].x = targetX;
            p[index].y = targetY;
            this.calculateBoneLengths();
        }
    }

    resetPose() {
        if (this.originalPoseData) {
            this.currentPoseData = this.originalPoseData.map(p => ({ ...p }));

            // 重置姿势后也要锁定长度
            this.calculateBoneLengths();

            this.render();
        }
    }

    exportImage() {
        const tempCanvas = document.createElement('canvas');

        // 1. 确定导出画幅
        if (this.uploadedImage) {
            // 如果有原图，严格保持原图分辨率，确保导入 AI 后 1:1 对齐
            tempCanvas.width = this.uploadedImage.width;
            tempCanvas.height = this.uploadedImage.height;
        } else {
            // 如果没有原图，使用默认竖屏比例 3:4
            tempCanvas.width = 768;
            tempCanvas.height = 1024;
        }

        const tempCtx = tempCanvas.getContext('2d');

        // 填充纯黑背景 (ControlNet 必须)
        tempCtx.fillStyle = '#000000';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

        // 2. 绘制骨骼 (传入 isExport=true 标志)
        if (this.currentPoseData) {
            this.drawPreviewSkeleton(tempCtx, this.currentPoseData, tempCanvas.width, tempCanvas.height, true);
        }

        const link = document.createElement('a');
        link.download = 'anypose_controlnet.png';
        link.href = tempCanvas.toDataURL('image/png');
        link.click();
    }

    // =======================================
    // AI生成相关功能
    // =======================================

    handleAIGenerate() {
        // 检查是否正在生成中
        if (this.isGenerating) {
            this.showToast('正在生成中，请稍候...', 'info');
            return;
        }

        // 检查必要条件
        if (!this.currentPoseData) {
            this.showToast('请先加载或创建骨骼姿势', 'error');
            return;
        }

        // 聚焦到提示词输入框
        const promptInput = document.getElementById('promptInput');
        if (promptInput) {
            promptInput.focus();
        }

        this.showToast('请在下方输入提示词，然后点击「开始生成」', 'info');
    }

    confirmPromptAndGenerate() {
        // 检查是否正在生成中
        if (this.isGenerating) {
            this.showToast('正在生成中，请稍候...', 'info');
            return;
        }

        const promptInput = document.getElementById('promptInput');
        const prompt = promptInput ? promptInput.value.trim() : '';

        if (!prompt) {
            this.showToast('请输入生成提示词', 'error');
            return;
        }

        if (!this.currentPoseData) {
            this.showToast('请先加载或创建骨骼姿势', 'error');
            return;
        }

        if (prompt.length > MAX_PROMPT_LENGTH) {
            this.showToast(`提示词过长，请控制在${MAX_PROMPT_LENGTH}字符以内`, 'error');
            return;
        }

        this.startAIGeneration(prompt);
    }

    startAIGeneration(prompt) {
        // 准备图像数据
        this.showLoadingState(true);

        try {
            const { originalImageBase64, skeletonImage } = this.prepareImagesForAI();
            this.callAIGenerationAPI(originalImageBase64, skeletonImage, prompt);
        } catch (error) {
            console.error('AI生成准备失败:', error);
            this.showToast('图像准备失败: ' + error.message, 'error');
            this.showLoadingState(false);
        }
    }

    prepareImagesForAI() {
        console.log('=== prepareImagesForAI() 开始 ===');

        // 创建骨骼图
        const skeletonCanvas = document.createElement('canvas');
        const skeletonCtx = skeletonCanvas.getContext('2d');

        // 设置骨骼图尺寸
        let skeletonWidth, skeletonHeight;
        if (this.uploadedImage) {
            skeletonWidth = this.uploadedImage.width;
            skeletonHeight = this.uploadedImage.height;
        } else {
            skeletonWidth = 512;
            skeletonHeight = 768;
        }

        skeletonCanvas.width = skeletonWidth;
        skeletonCanvas.height = skeletonHeight;

        console.log('骨骼图尺寸:', skeletonWidth, 'x', skeletonHeight);
        console.log('有原图:', !!this.uploadedImage);
        console.log('有骨骼数据:', !!this.currentPoseData);
        console.log('lastImageInfo:', this.lastImageInfo);

        // 填充黑色背景
        skeletonCtx.fillStyle = '#000000';
        skeletonCtx.fillRect(0, 0, skeletonWidth, skeletonHeight);

        // 绘制骨骼
        if (this.currentPoseData) {
            const landmarks = this.currentPoseData;
            let getPos;

            console.log('关键点数量:', landmarks.filter(lm => lm).length, '/', landmarks.length);

            // 骨骼图画布尺寸 = 原图尺寸，直接使用归一化坐标乘以画布尺寸
            console.log('使用直接坐标映射: skeletonWidth=', skeletonWidth, 'skeletonHeight=', skeletonHeight);
            getPos = (lm) => ({
                x: lm.x * skeletonWidth,
                y: lm.y * skeletonHeight
            });

            const joints = {
                nose: 0, leftEyeIn: 1, leftEyeOut: 2,
                rightEyeIn: 3, rightEyeOut: 4,
                leftShoulder: 5, leftElbow: 6, leftWrist: 7,
                rightShoulder: 8, rightElbow: 9, rightWrist: 10,
                leftHip: 11, leftKnee: 12, leftAnkle: 13,
                rightHip: 14, rightKnee: 15, rightAnkle: 16,
                neck: 17, pelvis: 18
            };

            const stickmanColors = this.getThemeColors();

            const connections = [
                // 严格遵循 OpenPose 标准拓扑连接与属性连线颜色
                [stickmanColors[17], joints.nose, joints.neck],           // 鼻子 → 脖子
                [stickmanColors[5], joints.neck, joints.leftShoulder],     // 脖子 → 左肩
                [stickmanColors[8], joints.neck, joints.rightShoulder],    // 脖子 → 右肩
                [stickmanColors[6], joints.leftShoulder, joints.leftElbow], // 左臂：肩 → 肘
                [stickmanColors[7], joints.leftElbow, joints.leftWrist],   // 左臂：肘 → 手腕
                [stickmanColors[9], joints.rightShoulder, joints.rightElbow], // 右臂：肩 → 肘
                [stickmanColors[10], joints.rightElbow, joints.rightWrist], // 右臂：肘 → 手腕
                [stickmanColors[17], joints.leftShoulder, joints.rightShoulder], // 左肩 → 右肩（躯干上部）
                [stickmanColors[11], joints.leftShoulder, joints.leftHip],  // 左肩 → 左髋
                [stickmanColors[14], joints.rightShoulder, joints.rightHip], // 右肩 → 右髋
                [stickmanColors[11], joints.leftHip, joints.rightHip],      // 左髋 → 右髋（躯干下部）
                [stickmanColors[12], joints.leftHip, joints.leftKnee],      // 左腿：髋 → 膝
                [stickmanColors[13], joints.leftKnee, joints.leftAnkle],    // 左腿：膝 → 脚踝
                [stickmanColors[15], joints.rightHip, joints.rightKnee],    // 右腿：髋 → 膝
                [stickmanColors[16], joints.rightKnee, joints.rightAnkle],  // 右腿：膝 → 脚踝
            ];

            const baseThickness = skeletonWidth * 0.015;
            const basePointRadius = skeletonWidth * 0.008;

            console.log('线条粗细:', baseThickness, '节点半径:', basePointRadius);

            let linesDrawn = 0;
            for (const [color, a, b] of connections) {
                const p1 = landmarks[a];
                const p2 = landmarks[b];
                if (p1 && p2) {
                    const pos1 = getPos(p1);
                    const pos2 = getPos(p2);
                    skeletonCtx.strokeStyle = color;
                    skeletonCtx.lineWidth = baseThickness;
                    skeletonCtx.lineCap = 'round';
                    skeletonCtx.beginPath();
                    skeletonCtx.moveTo(pos1.x, pos1.y);
                    skeletonCtx.lineTo(pos2.x, pos2.y);
                    skeletonCtx.stroke();
                    linesDrawn++;
                }
            }
            console.log('绘制骨骼线条数:', linesDrawn);

            let pointsDrawn = 0;
            for (let i = 0; i < landmarks.length; i++) {
                const lm = landmarks[i];
                if (!lm) continue;
                // 跳过头部除了鼻子以外的节点 (1-4: 眼睛、耳朵)
                if (i >= 1 && i <= 4) continue;

                const pos = getPos(lm);
                const color = stickmanColors[i] || '#ffffff';
                // 鼻子节点放大作为头部
                let radius = basePointRadius;
                if (i === 0) {
                    radius = basePointRadius * 2.5;
                }
                skeletonCtx.beginPath();
                skeletonCtx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
                skeletonCtx.fillStyle = color;
                skeletonCtx.fill();
                pointsDrawn++;
            }
            console.log('绘制骨骼节点数:', pointsDrawn);
        }

        // 准备原图 base64
        let originalImageBase64 = null;
        if (this.uploadedImage) {
            const originalCanvas = document.createElement('canvas');
            const originalCtx = originalCanvas.getContext('2d');
            originalCanvas.width = this.uploadedImage.width;
            originalCanvas.height = this.uploadedImage.height;
            originalCtx.drawImage(this.uploadedImage, 0, 0);
            originalImageBase64 = originalCanvas.toDataURL('image/png').split(',')[1];
            console.log('原图 Base64 长度:', originalImageBase64 ? originalImageBase64.length : 0);
        }

        const skeletonImageBase64 = skeletonCanvas.toDataURL('image/png').split(',')[1];
        console.log('骨骼图 Base64 长度:', skeletonImageBase64 ? skeletonImageBase64.length : 0);
        console.log('=== prepareImagesForAI() 完成 ===');

        return {
            originalImageBase64: originalImageBase64,
            skeletonImage: skeletonImageBase64
        };
    }

    previewSkeletonForAI() {
        console.log('=== 预览骨骼图 ===');

        if (!this.currentPoseData) {
            this.showToast('请先上传图片并识别骨骼', 'warning');
            return;
        }

        try {
            const { originalImageBase64, skeletonImage } = this.prepareImagesForAI();

            const modal = document.getElementById('skeletonPreviewModal');
            const skeletonImg = document.getElementById('previewSkeletonImage');
            const skeletonPlaceholder = document.getElementById('previewSkeletonPlaceholder');
            const originalImg = document.getElementById('previewOriginalImage');
            const originalPlaceholder = document.getElementById('previewOriginalPlaceholder');
            const overlayCanvas = document.getElementById('previewOverlayCanvas');
            const overlayPlaceholder = document.getElementById('previewOverlayPlaceholder');
            const debugInfo = document.getElementById('debugInfo');

            // 显示骨骼图
            if (skeletonImage) {
                skeletonImg.src = 'data:image/png;base64,' + skeletonImage;
                skeletonImg.style.display = 'block';
                skeletonPlaceholder.style.display = 'none';
            } else {
                skeletonImg.style.display = 'none';
                skeletonPlaceholder.style.display = 'block';
            }

            // 显示原图
            if (originalImageBase64) {
                originalImg.src = 'data:image/png;base64,' + originalImageBase64;
                originalImg.style.display = 'block';
                originalPlaceholder.style.display = 'none';
            } else {
                originalImg.style.display = 'none';
                originalPlaceholder.style.display = 'block';
            }

            // 绘制叠加对比图
            if (originalImageBase64 && skeletonImage) {
                overlayCanvas.style.display = 'block';
                overlayPlaceholder.style.display = 'none';

                const tempImg1 = new Image();
                tempImg1.onload = () => {
                    overlayCanvas.width = tempImg1.width;
                    overlayCanvas.height = tempImg1.height;
                    const ctx = overlayCanvas.getContext('2d');

                    // 先画原图（完全不透明）
                    ctx.globalAlpha = 1.0;
                    ctx.drawImage(tempImg1, 0, 0);

                    // 再画骨骼图，去掉黑色背景
                    const tempImg2 = new Image();
                    tempImg2.onload = () => {
                        // 创建临时 canvas 处理骨骼图
                        const tempCanvas = document.createElement('canvas');
                        tempCanvas.width = tempImg2.width;
                        tempCanvas.height = tempImg2.height;
                        const tempCtx = tempCanvas.getContext('2d');
                        tempCtx.drawImage(tempImg2, 0, 0);

                        // 获取像素数据，把黑色变成透明
                        const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
                        const data = imageData.data;
                        for (let i = 0; i < data.length; i += 4) {
                            const r = data[i];
                            const g = data[i + 1];
                            const b = data[i + 2];
                            // 如果是黑色（或接近黑色），设为透明
                            if (r < 30 && g < 30 && b < 30) {
                                data[i + 3] = 0;
                            }
                        }
                        tempCtx.putImageData(imageData, 0, 0);

                        // 画处理后的骨骼图
                        ctx.globalAlpha = 1.0;
                        ctx.drawImage(tempCanvas, 0, 0);
                    };
                    tempImg2.src = 'data:image/png;base64,' + skeletonImage;
                };
                tempImg1.src = 'data:image/png;base64,' + originalImageBase64;
            } else {
                overlayCanvas.style.display = 'none';
                overlayPlaceholder.style.display = 'block';
            }

            // 更新调试信息
            const landmarks = this.currentPoseData;
            debugInfo.innerHTML = `
                <strong>调试信息:</strong><br>
                骨骼图尺寸: ${this.uploadedImage ? this.uploadedImage.width + 'x' + this.uploadedImage.height : '512x768'}<br>
                关键点数量: ${landmarks.filter(lm => lm).length} / ${landmarks.length}<br>
                有原图: ${!!this.uploadedImage}<br>
                骨骼图数据: ${skeletonImage ? skeletonImage.length + ' bytes' : '无'}<br>
                原图数据: ${originalImageBase64 ? originalImageBase64.length + ' bytes' : '无'}<br>
                图一: 骨骼图 (姿势参考)<br>
                图二: 原图 (人物参考)
            `;

            modal.style.display = 'flex';
            console.log('骨骼图预览已显示');

        } catch (error) {
            console.error('预览骨骼图失败:', error);
            this.showToast('预览失败: ' + error.message, 'error');
        }
    }

    closeSkeletonPreview() {
        const modal = document.getElementById('skeletonPreviewModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    async callAIGenerationAPI(originalImageBase64, skeletonImage, prompt) {
        const currentConfig = this.config[this.config.provider];

        // 检查API密钥
        if (!currentConfig.apiKey) {
            this.showToast(`请配置${this.getProviderDisplayName(this.config.provider)} API密钥`, 'error');
            this.showLoadingState(false);
            return;
        }

        try {
            // 根据服务商构建不同的请求体
            let requestBody, endpoint, headers;

            if (this.config.provider === 'doubao') {
                // 豆包AI请求 - 姿态迁移模式
                const imageArray = [];
                // 先添加骨骼图（作为姿势参考）
                if (skeletonImage) {
                    imageArray.push('data:image/png;base64,' + skeletonImage);
                }
                // 再添加原图（如果有，作为人物特征参考）
                if (originalImageBase64) {
                    imageArray.push('data:image/png;base64,' + originalImageBase64);
                }

                // 构建提示词：自动添加图一图二说明
                let finalPrompt = prompt;
                if (imageArray.length > 0) {
                    let prefix = '';
                    if (skeletonImage && originalImageBase64) {
                        prefix = '图一是骨骼姿势参考图，图二是人物参考图。';
                    } else if (skeletonImage) {
                        prefix = '图一是骨骼姿势参考图，请严格按照图一的骨骼姿势生成。';
                    }
                    if (prefix) {
                        finalPrompt = prefix + ' ' + prompt;
                    }
                }

                requestBody = {
                    model: currentConfig.model,
                    prompt: finalPrompt,
                    image: imageArray,
                    sequential_image_generation: 'disabled',
                    response_format: 'url',
                    size: '2K',
                    stream: false,
                    watermark: true
                };

                endpoint = currentConfig.endpoint;
                headers = {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentConfig.apiKey}`
                };

                console.log('=== AI生成请求 (姿态迁移) ===');
                console.log('Provider: 豆包AI');
                console.log('Endpoint:', endpoint);
                console.log('Model:', currentConfig.model);
                console.log('User Prompt:', prompt);
                console.log('Final Prompt:', finalPrompt);
                console.log('Has original image:', !!originalImageBase64);
                console.log('Has skeleton image:', !!skeletonImage);
                console.log('Image count:', imageArray.length);
                imageArray.forEach((img, idx) => {
                    console.log(`  Image ${idx + 1} length:`, img ? img.length : 0, 'prefix:', img ? img.substring(0, 50) + '...' : 'none');
                });
                console.log('Request body:', JSON.stringify({
                    ...requestBody,
                    image: requestBody.image ? requestBody.image.map(() => '[IMAGE_DATA]') : []
                }, null, 2));

            } else if (this.config.provider === 'qwen') {
                // 千问AI请求 - 多模态生成格式
                // 千问 API 文档: https://help.aliyun.com/zh/dashscope/developer-reference/
                const content = [];

                // 先添加骨骼图（作为姿势参考 - 图一）
                if (skeletonImage) {
                    content.push({
                        image: 'data:image/png;base64,' + skeletonImage
                    });
                }

                // 再添加原图（如果有，作为人物参考 - 图二）
                if (originalImageBase64) {
                    content.push({
                        image: 'data:image/png;base64,' + originalImageBase64
                    });
                }

                // 直接使用用户输入的提示词
                content.push({
                    text: prompt
                });

                // 千问的多模态请求格式
                requestBody = {
                    model: currentConfig.model,
                    input: {
                        messages: [
                            {
                                role: 'user',
                                content: content
                            }
                        ]
                    },
                    parameters: {
                        n: 1,
                        negative_prompt: '',
                        prompt_extend: true,
                        watermark: false,
                        size: '2048*2048'
                    }
                };

                endpoint = currentConfig.endpoint;
                headers = {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentConfig.apiKey}`
                };

                console.log('=== AI生成请求 (千问AI) ===');
                console.log('Provider: 千问AI');
                console.log('Endpoint:', endpoint);
                console.log('Model:', currentConfig.model);
                console.log('Text Prompt:', prompt);
                console.log('Has original image:', !!originalImageBase64);
                console.log('Has skeleton image:', !!skeletonImage);
                console.log('Content items:', content.length);
                console.log('Request body:', JSON.stringify({
                    ...requestBody,
                    input: {
                        messages: requestBody.input.messages.map(msg => ({
                            ...msg,
                            content: msg.content.map(c => c.image ? '[IMAGE_DATA]' : c)
                        }))
                    }
                }, null, 2));

            } else if (this.config.provider === 'openai') {
                // OpenAI DALL-E请求
                requestBody = {
                    model: currentConfig.model,
                    prompt: prompt,
                    n: 1,
                    size: '1024x1024'
                };

                endpoint = currentConfig.endpoint;
                headers = {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentConfig.apiKey}`
                };

                console.log('=== AI生成请求 ===');
                console.log('Provider: OpenAI');
                console.log('Endpoint:', endpoint);
                console.log('Model:', currentConfig.model);
                console.log('Prompt:', prompt);

            } else if (this.config.provider === 'stability') {
                // Stability AI请求
                requestBody = {
                    text_prompts: [
                        {
                            text: prompt,
                            weight: 1
                        }
                    ],
                    cfg_scale: DEFAULT_GENERATION_PARAMS.guidance_scale,
                    steps: DEFAULT_GENERATION_PARAMS.num_inference_steps,
                    seed: DEFAULT_GENERATION_PARAMS.seed === -1 ? 0 : DEFAULT_GENERATION_PARAMS.seed
                };

                endpoint = currentConfig.endpoint;
                headers = {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentConfig.apiKey}`,
                    'Accept': 'application/json'
                };

                console.log('=== AI生成请求 ===');
                console.log('Provider: Stability AI');
                console.log('Endpoint:', endpoint);
                console.log('Prompt:', prompt);
            }

            // 千问始终使用同域代理（解决CORS问题）
            if (this.config.provider === 'qwen') {
                console.log('使用本地代理服务器（同域）');
                // 通过同域代理发送
                const proxyRequestBody = {
                    apiKey: currentConfig.apiKey,
                    body: requestBody
                };
                endpoint = `/api/proxy/qwen`;
                headers = {
                    'Content-Type': 'application/json'
                };
                requestBody = proxyRequestBody;
            }

            // 发送API请求
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(requestBody),
                signal: AbortSignal.timeout(120000) // 2分钟超时
            });

            console.log('=== AI生成响应 ===');
            console.log('Status:', response.status, response.statusText);

            if (!response.ok) {
                // 尝试读取错误响应体
                let errorDetail = '';
                let errorMessage = '';
                try {
                    const errorResult = await response.clone().json();
                    console.log('Error response:', errorResult);
                    errorDetail = JSON.stringify(errorResult);
                    // 千问API特定错误信息提取
                    if (this.config.provider === 'qwen') {
                        if (errorResult.message) {
                            errorMessage = errorResult.message;
                        } else if (errorResult.Code) {
                            errorMessage = `错误码: ${errorResult.Code}`;
                        } else if (errorResult.code) {
                            errorMessage = `错误码: ${errorResult.code}`;
                        }
                    }
                } catch (e) {
                    const errorText = await response.clone().text();
                    console.log('Error response (text):', errorText);
                    errorDetail = errorText;
                }
                if (errorMessage) {
                    throw new Error(`千问API错误: ${errorMessage} (${response.status})`);
                } else {
                    throw new Error(`API请求失败: ${response.status} ${response.statusText} - ${errorDetail}`);
                }
            }

            const result = await response.json();
            console.log('Success response:', result);
            this.handleGenerationResponse(result);

        } catch (error) {
            console.error('AI生成API调用失败:', error);

            if (error.name === 'TimeoutError') {
                this.showToast('生成超时，请重试', 'error');
            } else if (error.message.includes('401')) {
                this.showToast('API密钥无效，请检查配置', 'error');
            } else if (error.message.includes('429')) {
                this.showToast('API调用频率超限，请稍后再试', 'error');
            } else if (error.message.includes('404')) {
                this.showToast('API端点不存在，请检查配置', 'error');
            } else {
                this.showToast('生成失败: ' + error.message, 'error');
            }

            this.showLoadingState(false);
        }
    }

    async imageToBase64(image) {
        return new Promise((resolve, reject) => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = image.width;
                canvas.height = image.height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(image, 0, 0);

                const dataURL = canvas.toDataURL('image/png');
                resolve(dataURL.split(',')[1]);
            } catch (error) {
                reject(error);
            }
        });
    }

    handleGenerationResponse(response) {
        this.showLoadingState(false);

        let imageUrl = null;

        try {
            // 根据服务商解析不同的响应格式
            if (this.config.provider === 'doubao') {
                // 豆包API响应格式
                if (response.data && response.data.length > 0) {
                    imageUrl = response.data[0].url || response.data[0].b64_json;
                    // 如果是base64数据，需要转换
                    if (imageUrl && !imageUrl.startsWith('http')) {
                        imageUrl = 'data:image/png;base64,' + imageUrl;
                    }
                }
            } else if (this.config.provider === 'qwen') {
                // 千问多模态API响应格式
                console.log('千问完整响应:', JSON.stringify(response, null, 2));

                // 尝试多种可能的响应格式
                if (response.output && response.output.choices && response.output.choices.length > 0) {
                    // 正确格式：output.choices[0].message.content[0].image
                    const choice = response.output.choices[0];
                    console.log('千问 choice:', choice);
                    if (choice.message && choice.message.content && choice.message.content.length > 0) {
                        const content = choice.message.content[0];
                        if (content.image) {
                            imageUrl = content.image;
                        } else if (content.text) {
                            console.log('千问返回文本而非图片:', content.text);
                        }
                    }
                } else if (response.output && response.output.results && response.output.results.length > 0) {
                    // 备用格式
                    const result = response.output.results[0];
                    if (result.url) {
                        imageUrl = result.url;
                    } else if (result.image) {
                        imageUrl = result.image.startsWith('data:') ? result.image : 'data:image/png;base64,' + result.image;
                    }
                } else if (response.data && response.data.length > 0) {
                    // 兼容 OpenAI 格式的响应
                    imageUrl = response.data[0].url || response.data[0].b64_json;
                    if (imageUrl && !imageUrl.startsWith('http') && !imageUrl.startsWith('data:')) {
                        imageUrl = 'data:image/png;base64,' + imageUrl;
                    }
                }
            } else if (this.config.provider === 'openai') {
                // OpenAI DALL-E 响应格式
                if (response.data && response.data.length > 0) {
                    imageUrl = response.data[0].url || response.data[0].b64_json;
                    if (imageUrl && !imageUrl.startsWith('http') && !imageUrl.startsWith('data:')) {
                        imageUrl = 'data:image/png;base64,' + imageUrl;
                    }
                }
            } else if (this.config.provider === 'stability') {
                // Stability AI 响应格式
                if (response.artifacts && response.artifacts.length > 0) {
                    const base64 = response.artifacts[0].base64;
                    imageUrl = 'data:image/png;base64,' + base64;
                }
            }

            if (imageUrl) {
                this.displayGenerationResult(imageUrl);
                this.showToast('生成成功！', 'success');
            } else {
                console.error('无法解析的响应格式:', response);
                this.showToast('生成结果解析失败', 'error');
            }
        } catch (error) {
            console.error('解析响应时出错:', error);
            this.showToast('解析响应失败: ' + error.message, 'error');
        }
    }

    displayGenerationResult(imageUrl) {
        const resultContainer = document.getElementById('generationResult');
        const resultImage = document.getElementById('resultImage');
        const resultPlaceholder = document.getElementById('resultPlaceholder');
        const downloadBtn = document.getElementById('downloadResult');
        const promptInput = document.getElementById('promptInput');

        if (resultContainer && resultImage && downloadBtn) {
            // 显示结果容器
            resultContainer.style.display = 'block';

            // 隐藏占位符，显示结果图片
            if (resultPlaceholder) resultPlaceholder.style.display = 'none';
            resultImage.src = imageUrl;
            resultImage.style.display = 'block';

            // 启用下载按钮
            downloadBtn.style.display = 'block';
            downloadBtn.onclick = () => this.downloadImage(imageUrl, 'ai_generated.png');

            // 保存生成结果
            this.lastGenerationResult = imageUrl;

            // 保存到历史记录
            const prompt = promptInput ? promptInput.value.trim() : '';
            this.saveToHistory(imageUrl, prompt);

            console.log('AI生成成功，结果已显示');
        }
    }

    // =======================================
    // 历史记录功能
    // =======================================

    saveToHistory(imageUrl, prompt) {
        const item = {
            id: Date.now(),
            imageUrl: imageUrl,
            prompt: prompt,
            timestamp: new Date().toLocaleString('zh-CN')
        };

        this.history.unshift(item);

        // 限制历史记录数量
        if (this.history.length > this.MAX_HISTORY) {
            this.history = this.history.slice(0, this.MAX_HISTORY);
        }

        // 保存到 localStorage
        try {
            localStorage.setItem(this.HISTORY_KEY, JSON.stringify(this.history));
        } catch (e) {
            console.warn('无法保存历史记录到 localStorage:', e);
        }

        this.renderHistory();
    }

    loadHistory() {
        try {
            const saved = localStorage.getItem(this.HISTORY_KEY);
            if (saved) {
                this.history = JSON.parse(saved);
            }
        } catch (e) {
            console.warn('无法加载历史记录:', e);
            this.history = [];
        }
    }

    renderHistory() {
        const historyList = document.getElementById('historyList');

        if (!historyList) return;

        if (this.history.length === 0) {
            historyList.innerHTML = '<div id="historyPlaceholder" style="grid-column: 1/-1; text-align: center; color: #888; font-size: 12px; padding: 20px;">暂无历史记录</div>';
            return;
        }

        historyList.innerHTML = this.history.map((item, index) => `
            <div class="history-item" data-index="${index}" title="${item.prompt || '无提示词'}">
                <button class="delete-btn" data-index="${index}" title="删除">
                    <svg viewBox="0 0 24 24">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
                <img src="${item.imageUrl}" alt="历史记录 ${index + 1}">
                <span class="history-time">${item.timestamp}</span>
            </div>
        `).join('');

        // 绑定点击事件 - 查看大图
        historyList.querySelectorAll('.history-item').forEach((el, index) => {
            el.addEventListener('click', (e) => {
                if (!e.target.closest('.delete-btn')) {
                    this.showHistoryItem(index);
                }
            });
        });

        // 绑定删除按钮事件
        historyList.querySelectorAll('.delete-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.index);
                this.deleteHistoryItem(index);
            });
        });
    }

    deleteHistoryItem(index) {
        if (confirm('确定要删除这条历史记录吗？')) {
            this.history.splice(index, 1);
            try {
                localStorage.setItem(this.HISTORY_KEY, JSON.stringify(this.history));
            } catch (e) {
                console.warn('无法保存历史记录:', e);
            }
            this.renderHistory();
            this.showToast('已删除', 'success');
        }
    }

    showHistoryItem(index) {
        const item = this.history[index];
        if (!item) return;

        const resultContainer = document.getElementById('generationResult');
        const resultImage = document.getElementById('resultImage');
        const resultPlaceholder = document.getElementById('resultPlaceholder');
        const downloadBtn = document.getElementById('downloadResult');

        if (resultContainer && resultImage && downloadBtn) {
            resultContainer.style.display = 'block';
            if (resultPlaceholder) resultPlaceholder.style.display = 'none';
            resultImage.src = item.imageUrl;
            resultImage.style.display = 'block';
            downloadBtn.style.display = 'block';
            downloadBtn.onclick = () => this.downloadImage(item.imageUrl, `history_${item.id}.png`);

            this.lastGenerationResult = item.imageUrl;
        }
    }

    clearHistory() {
        if (this.history.length === 0) return;

        if (confirm('确定要清空所有历史记录吗？')) {
            this.history = [];
            try {
                localStorage.removeItem(this.HISTORY_KEY);
            } catch (e) {
                console.warn('无法清除历史记录:', e);
            }
            this.renderHistory();
            this.showToast('历史记录已清空', 'success');
        }
    }

    downloadImage(url, filename) {
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    showLoadingState(show) {
        const statusEl = document.getElementById('generationStatus');
        const generateBtn = document.getElementById('startGenerateBtn');

        if (statusEl && generateBtn) {
            if (show) {
                statusEl.style.display = 'flex';
                generateBtn.disabled = true;
                generateBtn.style.opacity = '0.6';
                generateBtn.style.cursor = 'not-allowed';
                this.isGenerating = true;
            } else {
                statusEl.style.display = 'none';
                generateBtn.disabled = false;
                generateBtn.style.opacity = '1';
                generateBtn.style.cursor = 'pointer';
                this.isGenerating = false;
            }
        }
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;

        // 添加样式
        Object.assign(toast.style, {
            padding: '12px 20px',
            borderRadius: '8px',
            marginBottom: '10px',
            color: '#fff',
            fontSize: '14px',
            maxWidth: '300px',
            wordWrap: 'break-word',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            transform: 'translateX(100%)',
            transition: 'transform 0.3s ease',
            zIndex: '9999'
        });

        // 设置不同类型的背景色
        const colors = {
            success: '#52c41a',
            error: '#ff4d4f',
            warning: '#faad14',
            info: '#1890ff'
        };
        toast.style.backgroundColor = colors[type] || colors.info;

        container.appendChild(toast);

        // 动画进入
        setTimeout(() => {
            toast.style.transform = 'translateX(0)';
        }, 10);

        // 自动移除
        setTimeout(() => {
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, 3000);

        console.log(`[${type.toUpperCase()}]`, message);
    }

    showError(message) {
        this.showToast(message, 'error');
    }

    // =======================================
    // API设置相关功能
    // =======================================

    showApiSettings() {
        const modal = document.getElementById('apiSettingsModal');
        const apiKeyInput = document.getElementById('apiKeyInput');
        const providerSelect = document.getElementById('providerSelect');

        if (modal && apiKeyInput) {
            // 更新所有配置UI显示
            this.updateConfigUI();

            // 显示模态框
            modal.style.display = 'flex';
            apiKeyInput.focus();
        }
    }

    hideApiSettings() {
        const modal = document.getElementById('apiSettingsModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    saveConfigToStorage() {
        try {
            localStorage.setItem('anypose_config', JSON.stringify(this.config));
        } catch (e) {
            console.warn('无法保存到 localStorage:', e);
        }
    }

    loadConfigFromStorage() {
        try {
            const saved = localStorage.getItem('anypose_config');
            if (saved) {
                const loadedConfig = JSON.parse(saved);
                // 合并配置，保持默认结构
                this.config = {
                    ...this.config,
                    ...loadedConfig,
                    doubao: { ...this.config.doubao, ...loadedConfig.doubao },
                    qwen: { ...this.config.qwen, ...loadedConfig.qwen },
                    openai: { ...this.config.openai, ...loadedConfig.openai },
                    stability: { ...this.config.stability, ...loadedConfig.stability }
                };
                // 更新当前使用的API密钥
                this.updateCurrentApiKey();
            }
        } catch (e) {
            console.warn('无法从 localStorage 加载配置:', e);
        }
    }

    saveApiKey() {
        const apiKeyInput = document.getElementById('apiKeyInput');
        const providerSelect = document.getElementById('providerSelect');
        const endpointInput = document.getElementById('endpointInput');
        const modelInput = document.getElementById('modelInput');

        if (apiKeyInput && providerSelect) {
            const apiKey = apiKeyInput.value.trim();
            const provider = providerSelect.value;
            const endpoint = endpointInput ? endpointInput.value.trim() : '';
            const model = modelInput ? modelInput.value.trim() : '';

            if (apiKey) {
                // 保存到配置
                this.config[provider].apiKey = apiKey;
                this.config[provider].endpoint = endpoint || this.config[provider].endpoint;
                this.config[provider].model = model || this.config[provider].model;
                this.config.provider = provider;

                // 保存到 localStorage
                this.saveConfigToStorage();

                // 更新当前使用的API密钥
                this.updateCurrentApiKey();

                // 更新UI显示
                this.updateConfigUI();

                // 隐藏模态框
                this.hideApiSettings();

                // 显示成功提示
                this.showSuccess(`${this.getProviderDisplayName(provider)} API配置已保存`);
            } else {
                this.showError('请输入有效的API密钥');
            }
        }
    }

    updateCurrentApiKey() {
        // 更新当前使用的API密钥
        this.apiKey = this.config[this.config.provider].apiKey;
    }

    testApiConnection() {
        const provider = this.config.provider;
        const config = this.config[provider];

        if (!config.apiKey) {
            this.showError('请先配置API密钥');
            return;
        }

        // 显示测试状态
        this.showLoadingState(true);

        // 根据不同服务商构建测试请求
        let testRequest;

        if (provider === 'doubao') {
            testRequest = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`
                },
                body: JSON.stringify({
                    model: config.model,
                    prompt: 'a simple test image',
                    ...DEFAULT_GENERATION_PARAMS
                })
            };
        } else if (provider === 'openai') {
            testRequest = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`
                },
                body: JSON.stringify({
                    model: config.model,
                    prompt: 'a simple test image',
                    n: 1,
                    size: '256x256'
                })
            };
        } else if (provider === 'stability') {
            testRequest = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`
                },
                body: JSON.stringify({
                    text_prompts: [{ text: 'a simple test image' }],
                    width: 512,
                    height: 512
                })
            };
        }

        fetch(config.endpoint, testRequest)
            .then(response => {
                this.showLoadingState(false);
                if (response.ok) {
                    this.showSuccess('API连接测试成功');
                } else {
                    this.showError(`API连接失败: ${response.status}`);
                }
            })
            .catch(error => {
                this.showLoadingState(false);
                this.showError('API连接测试失败: ' + error.message);
            });
    }

    showSuccess(message) {
        this.showToast(message, 'success');
    }

    // =======================================
    // 配置中心相关功能
    // =======================================

    switchProvider(provider) {
        this.config.provider = provider;
        this.updateCurrentApiKey();
        this.saveConfigToStorage();
        this.updateConfigUI();
    }

    updateConfig(key, value) {
        const currentConfig = this.config[this.config.provider];
        if (key === 'endpoint') {
            currentConfig.endpoint = value;
        } else if (key === 'model') {
            currentConfig.model = value;
        }
        this.saveConfigToStorage();
    }

    updateConfigUI() {
        const currentConfig = this.config[this.config.provider];
        const providerSelect = document.getElementById('providerSelect');
        const apiKeyInput = document.getElementById('apiKeyInput');
        const endpointInput = document.getElementById('endpointInput');
        const modelInput = document.getElementById('modelInput');
        const currentProviderSpan = document.getElementById('currentProvider');
        const currentModelSpan = document.getElementById('currentModel');
        const configStatusSpan = document.getElementById('configStatus');

        if (providerSelect) providerSelect.value = this.config.provider;
        if (apiKeyInput) apiKeyInput.value = currentConfig.apiKey;
        if (endpointInput) endpointInput.value = currentConfig.endpoint;

        // 动态更新模型选择列表
        if (modelInput) {
            const models = this.getModelsForProvider(this.config.provider);
            modelInput.innerHTML = '';
            models.forEach(model => {
                const option = document.createElement('option');
                option.value = model.value;
                option.textContent = model.label;
                modelInput.appendChild(option);
            });
            modelInput.value = currentConfig.model;
        }

        if (currentProviderSpan) currentProviderSpan.textContent = this.getProviderDisplayName(this.config.provider);
        if (currentModelSpan) currentModelSpan.textContent = currentConfig.model;

        // 更新配置状态
        if (configStatusSpan) {
            if (currentConfig.apiKey) {
                configStatusSpan.textContent = '已配置';
                configStatusSpan.className = 'status-indicator configured';
            } else {
                configStatusSpan.textContent = '未配置';
                configStatusSpan.className = 'status-indicator';
            }
        }
    }

    getModelsForProvider(provider) {
        const modelMap = {
            'doubao': [
                { value: 'doubao-seedream-5-0-260128', label: 'doubao-seedream-5-0-260128' },
                { value: 'doubao-seedream-4-5-251128', label: 'doubao-seedream-4-5-251128' }
            ],
            'qwen': [
                { value: 'qwen-image-2.0-pro', label: 'qwen-image-2.0-pro' },
                { value: 'qwen-image-2.0', label: 'qwen-image-2.0' },
                { value: 'qwen-image-plus', label: 'qwen-image-plus' },
                { value: 'qwen-image-flash', label: 'qwen-image-flash' }
            ],
            'openai': [
                { value: 'dall-e-3', label: 'dall-e-3' },
                { value: 'dall-e-2', label: 'dall-e-2' }
            ],
            'stability': [
                { value: 'stable-diffusion-v1-6', label: 'stable-diffusion-v1-6' },
                { value: 'stable-diffusion-xl', label: 'stable-diffusion-xl' }
            ]
        };
        return modelMap[provider] || [];
    }

    getProviderDisplayName(provider) {
        const names = {
            'doubao': '豆包AI',
            'qwen': '千问AI',
            'openai': 'OpenAI',
            'stability': 'Stability AI'
        };
        return names[provider] || provider;
    }

    // 初始化配置UI
    initConfigUI() {
        this.updateConfigUI();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    try {
        new AnyPoseApp();
        console.log('AnyPose: 初始化成功');
    } catch (error) {
        console.error('AnyPose: 初始化失败:', error);
    }
});
