/**
 * Cloudflare Pages Functions Entry Point
 * 处理所有路由：静态资源 + API + 订阅生成
 */

import { injectKVAdapter } from '../kv-adapter.js';

// 高熵 User-Agent 池（防 WAF）- 扩展版
const USER_AGENTS = [
    // Chrome Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    // Chrome macOS
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    // Chrome Linux
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    // Firefox Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
    // Firefox macOS
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
    // Safari macOS
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    // Edge Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    // Mobile Chrome
    'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    // Mobile Safari
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1'
];

// 加权随机选择（桌面浏览器权重更高）
function getRandomUA() {
    const weights = [3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 1, 1]; // 桌面:移动 = 10:2
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let random = Math.random() * totalWeight;
    
    for (let i = 0; i < USER_AGENTS.length; i++) {
        random -= weights[i];
        if (random <= 0) return USER_AGENTS[i];
    }
    
    return USER_AGENTS[0];
}

// 生成浏览器指纹请求头（增强版）
function getBrowserHeaders(url, originalHeaders = {}) {
    const ua = getRandomUA();
    const isChrome = ua.includes('Chrome') && !ua.includes('Edg');
    const isFirefox = ua.includes('Firefox');
    const isSafari = ua.includes('Safari') && !ua.includes('Chrome');
    const isEdge = ua.includes('Edg');
    
    // 基础请求头
    const headers = {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
    };
    
    // Chrome/Edge 特有请求头
    if (isChrome || isEdge) {
        headers['sec-ch-ua'] = isEdge 
            ? '"Microsoft Edge";v="120", "Chromium";v="120", "Not=A?Brand";v="99"'
            : '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"';
        headers['sec-ch-ua-mobile'] = '?0';
        headers['sec-ch-ua-platform'] = ua.includes('Windows') ? '"Windows"' : 
                                        ua.includes('Macintosh') ? '"macOS"' : '"Linux"';
        headers['Sec-Fetch-Dest'] = 'document';
        headers['Sec-Fetch-Mode'] = 'navigate';
        headers['Sec-Fetch-Site'] = 'none';
        headers['Sec-Fetch-User'] = '?1';
    }
    
    // Firefox 特有请求头
    if (isFirefox) {
        headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
        headers['Sec-Fetch-Dest'] = 'document';
        headers['Sec-Fetch-Mode'] = 'navigate';
        headers['Sec-Fetch-Site'] = 'none';
        headers['Sec-Fetch-User'] = '?1';
        headers['TE'] = 'trailers';
    }
    
    // Safari 特有请求头
    if (isSafari) {
        headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
        delete headers['DNT']; // Safari 不发送 DNT
    }
    
    // 添加 Referer（模拟从搜索引擎来）
    if (Math.random() > 0.5) {
        const referers = [
            'https://www.google.com/',
            'https://www.bing.com/',
            'https://duckduckgo.com/'
        ];
        headers['Referer'] = referers[Math.floor(Math.random() * referers.length)];
    }
    
    return { ...headers, ...originalHeaders };
}

// 密码鉴权中间件
function requireAuth(request, env) {
    const authHeader = request.headers.get('Authorization');
    const urlParams = new URL(request.url).searchParams;
    const token = urlParams.get('token') || authHeader?.replace('Bearer ', '');
    
    const validToken = env.SUB_STORE_API_TOKEN || 'changeme';
    
    if (token !== validToken) {
        return new Response(JSON.stringify({ 
            error: 'Unauthorized',
            message: 'Invalid or missing token'
        }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    
    return null;
}

// 劫持 Sub-Store 的 HTTP 模块（增强版：重试 + 超时 + 错误处理）
function createHTTPProxy(env) {
    const MAX_RETRY = 3;
    const TIMEOUT = 30000; // 30秒超时
    
    async function fetchWithRetry(url, options, retries = 0) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);
        
        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            // 5xx 错误重试
            if (response.status >= 500 && retries < MAX_RETRY) {
                console.warn(`[HTTP Proxy] Server error ${response.status}, retrying (${retries + 1}/${MAX_RETRY})`);
                await new Promise(resolve => setTimeout(resolve, 1000 * (retries + 1)));
                return fetchWithRetry(url, options, retries + 1);
            }
            
            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            
            // 网络错误重试
            if (retries < MAX_RETRY && (error.name === 'AbortError' || error.message.includes('fetch'))) {
                console.warn(`[HTTP Proxy] Network error, retrying (${retries + 1}/${MAX_RETRY}): ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, 1000 * (retries + 1)));
                return fetchWithRetry(url, options, retries + 1);
            }
            
            throw error;
        }
    }
    
    return {
        get: async (options) => {
            const headers = getBrowserHeaders(options.url, options.headers || {});
            
            try {
                const response = await fetchWithRetry(options.url, {
                    method: 'GET',
                    headers,
                    cf: {
                        cacheTtl: 300,
                        cacheEverything: true,
                        mirage: true, // 图片优化
                        polish: 'lossy' // 图片压缩
                    }
                });

                return {
                    status: response.status,
                    statusCode: response.status, // 兼容性
                    headers: Object.fromEntries(response.headers),
                    body: await response.text()
                };
            } catch (error) {
                console.error(`[HTTP Proxy] GET failed: ${options.url}`, error);
                return {
                    status: 500,
                    statusCode: 500,
                    headers: {},
                    body: JSON.stringify({ error: error.message })
                };
            }
        },
        
        post: async (options) => {
            const headers = getBrowserHeaders(options.url, options.headers || {});
            
            try {
                const response = await fetchWithRetry(options.url, {
                    method: 'POST',
                    headers,
                    body: options.body
                });

                return {
                    status: response.status,
                    statusCode: response.status,
                    headers: Object.fromEntries(response.headers),
                    body: await response.text()
                };
            } catch (error) {
                console.error(`[HTTP Proxy] POST failed: ${options.url}`, error);
                return {
                    status: 500,
                    statusCode: 500,
                    headers: {},
                    body: JSON.stringify({ error: error.message })
                };
            }
        }
    };
}

// 初始化 Sub-Store 环境
async function initSubStore(env) {
    const { fs, adapter } = injectKVAdapter(env.SUB_STORE_KV);
    
    // 预加载 KV 数据到内存
    await adapter.preload();
    
    // 构造伪 Node.js 环境
    const mockNode = {
        fs,
        process: {
            env: {
                SUB_STORE_DATA_BASE_PATH: '.',
                SUB_STORE_BACKEND_API_PORT: 3000,
                SUB_STORE_BACKEND_API_HOST: '0.0.0.0'
            }
        }
    };

    // 劫持全局对象
    globalThis.process = mockNode.process;
    globalThis.require = (module) => {
        if (module === 'fs') return fs;
        if (module === 'path') return {
            join: (...args) => args.join('/').replace(/\/+/g, '/'),
            resolve: (...args) => args.join('/').replace(/\/+/g, '/')
        };
        if (module === 'dotenv') return { config: () => {} };
        throw new Error(`Module not found: ${module}`);
    };

    return { adapter, http: createHTTPProxy(env) };
}

// 主路由处理器
export async function onRequest(context) {
    const { request, env, params } = context;
    const url = new URL(request.url);
    const path = url.pathname;

    // API 路由鉴权
    if (path.startsWith('/api/')) {
        const authError = requireAuth(request, env);
        if (authError) return authError;

        try {
            // 初始化 Sub-Store
            const { adapter, http } = await initSubStore(env);

            // 动态加载 Sub-Store 核心（需要预先打包到 /dist）
            const SubStore = await import('../dist/sub-store.bundle.js');
            
            // 注入劫持的模块
            SubStore.$.node = { fs: adapter.fs };
            SubStore.$.http = http;

            // 处理 API 请求
            const response = await SubStore.handleRequest(request);
            return response;

        } catch (error) {
            return new Response(JSON.stringify({
                error: 'Internal Server Error',
                message: error.message,
                stack: error.stack
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    // 订阅下载路由（公开访问）
    if (path.startsWith('/download/') || path.startsWith('/share/')) {
        try {
            const { adapter, http } = await initSubStore(env);
            const SubStore = await import('../dist/sub-store.bundle.js');
            
            SubStore.$.node = { fs: adapter.fs };
            SubStore.$.http = http;

            const response = await SubStore.handleRequest(request);
            return response;

        } catch (error) {
            return new Response(JSON.stringify({
                error: 'Subscription Error',
                message: error.message
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    // 静态资源（前端）
    return env.ASSETS.fetch(request);
}
