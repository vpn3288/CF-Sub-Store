/**
 * 构建脚本 v2.0：打包 Sub-Store 核心到 Cloudflare Workers 兼容格式
 * 增强版：完整的 polyfill + 错误处理 + 构建验证
 */

import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUB_STORE_SRC = path.resolve(__dirname, '../sub-store/backend/src');
const DIST_DIR = path.resolve(__dirname, 'dist');

console.log('🔨 开始构建 Sub-Store for Cloudflare Pages...\n');

// 清理输出目录
if (fs.existsSync(DIST_DIR)) {
    console.log('🧹 清理旧的构建产物...');
    fs.rmSync(DIST_DIR, { recursive: true });
}
fs.mkdirSync(DIST_DIR, { recursive: true });

// 检查 Sub-Store 源码是否存在
if (!fs.existsSync(SUB_STORE_SRC)) {
    console.error('❌ Sub-Store 源码不存在，请先克隆仓库:');
    console.error('   git clone https://github.com/sub-store-org/Sub-Store.git ../sub-store');
    process.exit(1);
}

console.log(`📂 Sub-Store 源码路径: ${SUB_STORE_SRC}`);

// 创建 polyfill 目录
const polyfillDir = path.join(__dirname, 'polyfills');
if (!fs.existsSync(polyfillDir)) {
    fs.mkdirSync(polyfillDir, { recursive: true });
}

// 生成 fs polyfill
fs.writeFileSync(path.join(polyfillDir, 'fs.js'), `
// fs polyfill for Cloudflare Workers
export const existsSync = () => {
    throw new Error('[fs polyfill] Use KV Adapter instead');
};
export const readFileSync = () => {
    throw new Error('[fs polyfill] Use KV Adapter instead');
};
export const writeFileSync = () => {
    throw new Error('[fs polyfill] Use KV Adapter instead');
};
export const copyFileSync = () => {
    throw new Error('[fs polyfill] Use KV Adapter instead');
};
export const mkdirSync = () => {};
export const rmSync = () => {};
export const accessSync = () => {};
`);

// 生成 path polyfill
fs.writeFileSync(path.join(polyfillDir, 'path.js'), `
// path polyfill for Cloudflare Workers
export const join = (...args) => args.join('/').replace(/\\/+/g, '/');
export const resolve = (...args) => args.join('/').replace(/\\/+/g, '/');
export const dirname = (p) => p.split('/').slice(0, -1).join('/') || '/';
export const basename = (p, ext) => {
    const base = p.split('/').pop() || '';
    return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
};
export const extname = (p) => {
    const parts = p.split('.');
    return parts.length > 1 ? '.' + parts.pop() : '';
};
export const sep = '/';
export const delimiter = ':';
`);

console.log('📦 开始打包...\n');

try {
    // 打包 Sub-Store 核心
    await esbuild.build({
        entryPoints: [path.join(SUB_STORE_SRC, 'main.js')],
        bundle: true,
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        outfile: path.join(DIST_DIR, 'sub-store.bundle.js'),
        external: ['crypto', 'http', 'https', 'net', 'tls', 'zlib', 'stream', 'buffer', 'util'],
        define: {
            'process.env.NODE_ENV': '"production"',
            'global': 'globalThis',
            '__dirname': '""',
            '__filename': '""'
        },
        alias: {
            '@': SUB_STORE_SRC,
            'fs': path.join(polyfillDir, 'fs.js'),
            'path': path.join(polyfillDir, 'path.js')
        },
        plugins: [
            {
                name: 'cloudflare-adapter',
                setup(build) {
                    // 拦截 Node.js 内置模块
                    build.onResolve({ filter: /^(crypto|http|https|net|tls|zlib|stream|buffer|util)$/ }, args => {
                        return { path: args.path, external: true };
                    });

                    // 拦截 dotenv
                    build.onResolve({ filter: /^dotenv$/ }, () => {
                        return { path: 'dotenv', namespace: 'stub' };
                    });

                    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => {
                        return {
                            contents: 'export const config = () => {};',
                            loader: 'js'
                        };
                    });
                }
            }
        ],
        minify: true,
        sourcemap: false,
        logLevel: 'info',
        metafile: true
    }).then(result => {
        // 输出构建统计
        const bundleSize = fs.statSync(path.join(DIST_DIR, 'sub-store.bundle.js')).size;
        console.log(`\n✅ Sub-Store 核心打包完成`);
        console.log(`   大小: ${(bundleSize / 1024).toFixed(2)} KB`);
        
        // 检查是否超过 Cloudflare Workers 限制（1MB 免费版）
        if (bundleSize > 1024 * 1024) {
            console.warn(`⚠️  警告: 构建产物超过 1MB，可能需要 Cloudflare Workers Paid 计划`);
        }
    });

    // 复制前端静态资源（如果存在）
    const frontendPath = path.resolve(__dirname, '../sub-store/web/dist');
    if (fs.existsSync(frontendPath)) {
        console.log('\n📋 复制前端资源...');
        fs.cpSync(frontendPath, path.join(DIST_DIR, 'public'), { recursive: true });
        console.log('✅ 前端资源复制完成');
    } else {
        console.warn('⚠️  前端资源不存在，跳过复制');
        console.warn('   如需前端，请先构建: cd ../sub-store/web && npm run build');
    }

    // 生成部署说明
    fs.writeFileSync(path.join(DIST_DIR, 'DEPLOY.md'), `
# Sub-Store Cloudflare 部署指南

## 1. 创建 KV 命名空间
\`\`\`bash
wrangler kv:namespace create "SUB_STORE_KV"
\`\`\`

复制输出的 ID，替换 wrangler.toml 中的 \`YOUR_KV_NAMESPACE_ID\`

## 2. 设置 API Token
编辑 wrangler.toml，修改 \`SUB_STORE_API_TOKEN\` 为强密码（建议 32 位以上）

## 3. 部署
\`\`\`bash
npm run deploy
\`\`\`

## 4. 访问
- 前端: https://your-project.pages.dev
- API: https://your-project.pages.dev/api/sub?token=YOUR_TOKEN

## 5. 测试
\`\`\`bash
# 测试环境信息
curl "https://your-project.pages.dev/api/utils/env?token=YOUR_TOKEN"

# 获取订阅列表
curl "https://your-project.pages.dev/api/sub?token=YOUR_TOKEN"
\`\`\`

## 安全建议
- ✅ 立即修改默认 Token
- ✅ 启用 Cloudflare Access 进行二次鉴权
- ✅ 定期备份 KV 数据: \`wrangler kv:key list --binding=SUB_STORE_KV\`
- ✅ 配置 Rate Limiting 防止滥用
- ✅ 启用 Cloudflare WAF 规则

## 故障排查
- 如果 API 返回 500，检查 Cloudflare Workers 日志
- 如果 KV 读写失败，检查命名空间绑定是否正确
- 如果订阅拉取失败，检查 HTTP Proxy 日志
`);

    console.log('\n✅ 构建完成！');
    console.log('\n📝 下一步:');
    console.log('   1. 配置 wrangler.toml 中的 KV Namespace ID 和 API Token');
    console.log('   2. 运行 npm run deploy 部署到 Cloudflare Pages');
    console.log('   3. 查看 dist/DEPLOY.md 了解详细部署步骤\n');

} catch (error) {
    console.error('\n❌ 构建失败:', error);
    process.exit(1);
}
