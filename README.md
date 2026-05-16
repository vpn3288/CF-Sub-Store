# Sub-Store Cloudflare Pages 部署方案

基于 Cloudflare Pages + KV 的 Sub-Store 完整重构版本，解决 Node.js 模块在 Edge 环境的兼容性问题。

## 🎯 核心特性

- **文件系统劫持**: 完整的 KV Adapter，拦截所有 `fs` 操作重定向到 Cloudflare KV
- **原子化写入**: 防并发冲突的锁机制，确保数据一致性
- **请求指纹优化**: 高熵 User-Agent 轮换 + 浏览器指纹模拟，防 WAF 拦截
- **零 Node.js 依赖**: 纯 V8 引擎运行，无需 Node.js 原生模块
- **强制鉴权**: API 路由密码保护，订阅链接支持 Token 验证

## 📁 项目结构

```
CF-Sub-Store/
├── kv-adapter.js           # KV 适配层（核心）
├── functions/
│   └── [[path]].js         # Cloudflare Pages Functions 入口
├── build.js                # 构建脚本（打包 Sub-Store 核心）
├── wrangler.toml           # Cloudflare 配置
├── MODIFICATIONS.js        # Sub-Store 源码修改指南
└── deploy.sh               # 一键部署脚本
```

## 🚀 快速部署

### 1. 创建 KV 命名空间

```bash
wrangler kv:namespace create "SUB_STORE_KV"
```

复制输出的 `id`，替换 `wrangler.toml` 中的 `YOUR_KV_NAMESPACE_ID`

### 2. 配置 API Token

编辑 `wrangler.toml`：

```toml
[env.production.vars]
SUB_STORE_API_TOKEN = "your-super-secure-token-here"  # 修改为强密码
```

### 3. 执行部署

```bash
chmod +x deploy.sh
./deploy.sh
```

或手动执行：

```bash
npm install
npm run build
npm run deploy
```

## 🔧 Sub-Store 源码修改

需要对原版 Sub-Store 进行以下关键修改（详见 `MODIFICATIONS.js`）：

### 修改点 1: `backend/src/vendor/open-api.js` (第 57-67 行)

```javascript
// 劫持 Node.js 环境检测
this.node = (() => {
    if (isNode) {
        if (typeof globalThis.__KV_ADAPTER__ !== 'undefined') {
            return { fs: globalThis.__KV_ADAPTER__.fs };
        }
        const fs = eval("require('fs')");
        return { fs };
    }
    return null;
})();
```

### 修改点 2: 异步化所有 fs 操作

将 `initCache()`, `persistCache()`, `write()`, `read()`, `delete()` 改为 `async` 方法，所有 `fs` 调用前加 `await`。

### 修改点 3: `backend/src/main.js` (第 25 行)

```javascript
(async () => {
    await migrate();
    await serve();
})();
```

## 📡 API 使用

### 管理 API（需要 Token）

```bash
# 获取订阅列表
curl "https://your-project.pages.dev/api/sub?token=YOUR_TOKEN"

# 创建订阅
curl -X POST "https://your-project.pages.dev/api/sub?token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"my-sub","url":"https://example.com/sub"}'
```

### 订阅下载（公开访问）

```
https://your-project.pages.dev/download/sub-name?target=Clash
https://your-project.pages.dev/share/sub/sub-name?token=SHARE_TOKEN
```

## 🔒 安全建议

1. **立即修改默认 Token**: 使用 32 位以上随机字符串
2. **启用 Cloudflare Access**: 在 Pages 设置中配置二次鉴权
3. **定期备份 KV 数据**: 使用 `wrangler kv:key list` 导出
4. **限制 API 访问频率**: 在 Cloudflare 中配置 Rate Limiting

## 🛠️ 本地开发

```bash
npm install
npm run dev
```

访问 `http://localhost:8788`

## 📊 性能优化

- **KV 预加载**: 启动时批量加载所有配置到内存
- **请求缓存**: 订阅源请求自动缓存 5 分钟
- **边缘计算**: 全球 300+ 节点就近响应

## ⚠️ 已知限制

- KV 写入延迟: 全球同步需要 60 秒（最终一致性）
- 单个 KV 值上限: 25 MB
- 免费版 KV 读取: 100,000 次/天

## 🤝 贡献

欢迎提交 Issue 和 PR。

## 📄 License

MIT License - 基于 [Sub-Store](https://github.com/sub-store-org/Sub-Store) 项目
