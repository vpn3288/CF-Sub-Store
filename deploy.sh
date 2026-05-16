#!/bin/bash
# 自动化部署脚本 v2.0 - 增强版

set -e

echo "🚀 开始部署 Sub-Store 到 Cloudflare Pages"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. 检查依赖
echo -e "${YELLOW}📦 检查依赖...${NC}"
if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}❌ wrangler 未安装，正在安装...${NC}"
    npm install -g wrangler
fi

if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js 未安装，请先安装 Node.js${NC}"
    exit 1
fi

# 2. 检查 wrangler.toml 配置
echo -e "${YELLOW}🔍 检查配置文件...${NC}"
if grep -q "YOUR_KV_NAMESPACE_ID" wrangler.toml; then
    echo -e "${RED}❌ 请先配置 wrangler.toml 中的 KV Namespace ID${NC}"
    echo -e "${YELLOW}运行: wrangler kv:namespace create \"SUB_STORE_KV\"${NC}"
    echo -e "${YELLOW}然后将输出的 id 替换到 wrangler.toml 中${NC}"
    exit 1
fi

if grep -q "YOUR_SECURE_TOKEN_HERE" wrangler.toml; then
    echo -e "${RED}❌ 请先修改 wrangler.toml 中的 SUB_STORE_API_TOKEN${NC}"
    echo -e "${YELLOW}建议使用 32 位以上随机字符串${NC}"
    exit 1
fi

# 3. 安装依赖
echo -e "${YELLOW}📦 安装项目依赖...${NC}"
npm install

# 4. 克隆 Sub-Store 源码（如果不存在）
if [ ! -d "../sub-store" ]; then
    echo -e "${YELLOW}📥 克隆 Sub-Store 源码...${NC}"
    git clone --depth 1 https://github.com/sub-store-org/Sub-Store.git ../sub-store
    
    # 安装 Sub-Store 依赖
    echo -e "${YELLOW}📦 安装 Sub-Store 依赖...${NC}"
    cd ../sub-store/backend
    npm install
    cd ../../$(basename "$PWD")
else
    echo -e "${GREEN}✅ Sub-Store 源码已存在${NC}"
fi

# 5. 构建
echo -e "${YELLOW}🔨 构建项目...${NC}"
npm run build

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ 构建失败，请检查错误信息${NC}"
    exit 1
fi

# 6. 验证构建产物
echo -e "${YELLOW}🔍 验证构建产物...${NC}"
if [ ! -f "dist/sub-store.bundle.js" ]; then
    echo -e "${RED}❌ 构建产物不存在: dist/sub-store.bundle.js${NC}"
    exit 1
fi

BUNDLE_SIZE=$(du -h dist/sub-store.bundle.js | cut -f1)
echo -e "${GREEN}✅ 构建产物大小: ${BUNDLE_SIZE}${NC}"

# 7. 部署前确认
echo -e "${YELLOW}📋 部署信息:${NC}"
echo -e "  - 项目名称: $(grep 'name =' wrangler.toml | cut -d'"' -f2)"
echo -e "  - 构建产物: dist/sub-store.bundle.js (${BUNDLE_SIZE})"
echo -e "  - KV 命名空间: $(grep 'id =' wrangler.toml | cut -d'"' -f2)"
echo ""
read -p "确认部署? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}⚠️  部署已取消${NC}"
    exit 0
fi

# 8. 部署
echo -e "${YELLOW}☁️  部署到 Cloudflare Pages...${NC}"
npm run deploy

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ 部署完成！${NC}"
    echo ""
    echo -e "${GREEN}📝 下一步:${NC}"
    echo -e "  1. 访问 Cloudflare Dashboard 获取部署 URL"
    echo -e "  2. 测试 API: ${YELLOW}curl https://your-project.pages.dev/api/utils/env?token=YOUR_TOKEN${NC}"
    echo -e "  3. 配置前端访问地址"
    echo ""
    echo -e "${YELLOW}⚠️  安全提醒:${NC}"
    echo -e "  - 立即修改默认 Token 为强密码"
    echo -e "  - 启用 Cloudflare Access 进行二次鉴权"
    echo -e "  - 定期备份 KV 数据"
else
    echo -e "${RED}❌ 部署失败，请检查错误信息${NC}"
    exit 1
fi
