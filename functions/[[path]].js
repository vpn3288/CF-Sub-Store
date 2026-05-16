/**
 * Cloudflare Pages Functions Entry Point
 * 处理所有路由：静态资源 + API + 订阅生成
 */

import { injectKVAdapter } from '../kv-adapter.js';

// 高熵 User-Agent 池（防 WAF）
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
];

function getRandomUA() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// 生成浏览器指纹请求头
function getBrowserHeaders(originalHeaders = {}) {
    return {
        'User-Agent': getRandomUA(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
        ...originalHeaders
    };
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

// 劫持 Sub-Store 的 HTTP 模块
function createHTTPProxy(env) {
    return {
        get: async (options) => {
            const headers = getBrowserHeaders(options.headers || {});
            
            const response = await fetch(options.url, {
                method: 'GET',
                headers,
                cf: {
                    cacheTtl: 300,
                    cacheEverything: true
                }
            });

            return {
                status: response.status,
                headers: Object.fromEntries(response.headers),
                body: await response.text()
            };
        },
        post: async (options) => {
            const headers = getBrowserHeaders(options.headers || {});
            
            const response = await fetch(options.url, {
                method: 'POST',
                headers,
                body: options.body
            });

            return {
                status: response.status,
                headers: Object.fromEntries(response.headers),
                body: await response.text()
            };
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
