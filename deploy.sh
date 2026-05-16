#!/bin/bash
# 自动化部署脚本

set -e

echo "🚀 开始部署 Sub-Store 到 Cloudflare Pages"

# 1. 检查依赖
if ! command -v wrangler &> /dev/null; then
    echo "❌ wrangler 未安装，正在安装..."
    npm install -g wrangler
fi

# 2. 检查 wrangler.toml 配置
if grep -q "YOUR_KV_NAMESPACE_ID" wrangler.toml; then
    echo "❌ 请先配置 wrangler.toml 中的 KV Namespace ID"
    echo "运行: wrangler kv:namespace create \"SUB_STORE_KV\""
    exit 1
fi

if grep -q "YOUR_SECURE_TOKEN_HERE" wrangler.toml; then
    echo "❌ 请先修改 wrangler.toml 中的 SUB_STORE_API_TOKEN"
    exit 1
fi

# 3. 安装依赖
echo "📦 安装依赖..."
npm install

# 4. 克隆 Sub-Store 源码（如果不存在）
if [ ! -d "../sub-store" ]; then
    echo "📥 克隆 Sub-Store 源码..."
    git clone https://github.com/sub-store-org/Sub-Store.git ../sub-store
fi

# 5. 构建
echo "🔨 构建项目..."
npm run build

# 6. 部署
echo "☁️  部署到 Cloudflare Pages..."
npm run deploy

echo "✅ 部署完成！"
echo ""
echo "📝 下一步："
echo "1. 访问 Cloudflare Dashboard 获取部署 URL"
echo "2. 测试 API: curl https://your-project.pages.dev/api/utils/env?token=YOUR_TOKEN"
echo "3. 配置前端访问地址"
