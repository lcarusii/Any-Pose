const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = 3000;

// 中间件
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 静态文件服务 - 提供前端页面
app.use(express.static(__dirname));

// 代理端点 - 转发到千问 API
app.post('/api/proxy/qwen', async (req, res) => {
    try {
        const { apiKey, body } = req.body;

        if (!apiKey) {
            return res.status(400).json({ error: '缺少 API Key' });
        }

        const qwenEndpoint = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

        console.log('转发请求到千问 API...');
        console.log('Model:', body.model);

        const response = await fetch(qwenEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(body),
            timeout: 120000
        });

        console.log('千问响应状态:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('千问错误响应:', errorText);
            return res.status(response.status).json({ error: errorText });
        }

        const result = await response.json();
        console.log('千问完整响应:', JSON.stringify(result, null, 2));
        console.log('千问响应成功');
        res.json(result);

    } catch (error) {
        console.error('代理请求失败:', error);
        res.status(500).json({ error: error.message });
    }
});

// 代理端点 - 转发到豆包 API（可选）
app.post('/api/proxy/doubao', async (req, res) => {
    try {
        const { apiKey, body, endpoint } = req.body;

        if (!apiKey) {
            return res.status(400).json({ error: '缺少 API Key' });
        }

        const doubaoEndpoint = endpoint || 'https://ark.cn-beijing.volces.com/api/v3/images/generations';

        console.log('转发请求到豆包 API...');

        const response = await fetch(doubaoEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(body),
            timeout: 120000
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('豆包错误响应:', errorText);
            return res.status(response.status).json({ error: errorText });
        }

        const result = await response.json();
        res.json(result);

    } catch (error) {
        console.error('代理请求失败:', error);
        res.status(500).json({ error: error.message });
    }
});

// 健康检查端点
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: '代理服务器运行正常' });
});

// 启动服务器
app.listen(PORT, () => {
    console.log('========================================');
    console.log('  AnyPose 代理服务器已启动');
    console.log('  访问: http://localhost:' + PORT);
    console.log('========================================');
});
