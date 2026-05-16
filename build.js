/**
 * 构建脚本：打包 Sub-Store 核心到 Cloudflare Workers 兼容格式
 */

import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const SUB_STORE_SRC = '../sub-store/backend/src';

// 清理输出目录
if (fs.existsSync('dist')) {
    fs.rmSync('dist', { recursive: true });
}
fs.mkdirSync('dist', { recursive: true });

// 打包 Sub-Store 核心
await esbuild.build({
    entryPoints: [path.join(SUB_STORE_SRC, 'main.js')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    outfile: 'dist/sub-store.bundle.js',
    external: ['fs', 'path', 'crypto', 'http', 'https', 'net', 'tls', 'zlib'],
    define: {
        'process.env.NODE_ENV': '"production"',
        'global': 'globalThis'
    },
    alias: {
        '@': path.resolve(SUB_STORE_SRC),
        'fs': path.resolve('./polyfills/fs.js'),
        'path': path.resolve('./polyfills/path.js')
    },
    plugins: [
        {
            name: 'node-polyfill',
            setup(build) {
                // 拦截 Node.js 模块导入
                build.onResolve({ filter: /^(fs|path|crypto)$/ }, args => {
                    return { path: args.path, namespace: 'node-polyfill' };
                });

                build.onLoad({ filter: /.*/, namespace: 'node-polyfill' }, args => {
                    if (args.path === 'fs') {
                        return {
                            contents: `
                                export const existsSync = () => false;
                                export const readFileSync = () => { throw new Error('Use KV Adapter'); };
                                export const writeFileSync = () => { throw new Error('Use KV Adapter'); };
                                export const copyFileSync = () => { throw new Error('Use KV Adapter'); };
                            `,
                            loader: 'js'
                        };
                    }
                    if (args.path === 'path') {
                        return {
                            contents: `
                                export const join = (...args) => args.join('/').replace(/\\/+/g, '/');
                                export const resolve = (...args) => args.join('/').replace(/\\/+/g, '/');
                                export const dirname = (p) => p.split('/').slice(0, -1).join('/');
                                export const basename = (p) => p.split('/').pop();
                                export const extname = (p) => {
                                    const parts = p.split('.');
                                    return parts.length > 1 ? '.' + parts.pop() : '';
                                };
                            `,
                            loader: 'js'
                        };
                    }
                    return null;
                });
            }
        }
    ],
    minify: true,
    sourcemap: false,
    logLevel: 'info'
});

console.log('✅ Sub-Store 核心打包完成');

// 复制前端静态资源（如果存在）
const frontendPath = '../sub-store/web/dist';
if (fs.existsSync(frontendPath)) {
    fs.cpSync(frontendPath, 'dist/public', { recursive: true });
    console.log('✅ 前端资源复制完成');
} else {
    console.warn('⚠️  前端资源不存在，跳过复制');
}

// 生成部署说明
fs.writeFileSync('dist/DEPLOY.md', `
# Sub-Store Cloudflare 部署指南

## 1. 创建 KV 命名空间
\`\`\`bash
wrangler kv:namespace create "SUB_STORE_KV"
\`\`\`

复制输出的 ID，替换 wrangler.toml 中的 \`YOUR_KV_NAMESPACE_ID\`

## 2. 设置 API Token
编辑 wrangler.toml，修改 \`SUB_STORE_API_TOKEN\` 为强密码

## 3. 部署
\`\`\`bash
npm run deploy
\`\`\`

## 4. 访问
- 前端: https://your-project.pages.dev
- API: https://your-project.pages.dev/api/sub?token=YOUR_TOKEN

## 安全建议
- 立即修改默认 Token
- 启用 Cloudflare Access 进行二次鉴权
- 定期备份 KV 数据
`);

console.log('✅ 构建完成，运行 npm run deploy 部署');
