# Sub-Store Cloudflare Pages 部署方案

基于 Cloudflare Pages + KV 的 Sub-Store 完整重构版本，解决 Node.js 模块在 Edge 环境的兼容性问题。

## 🎯 核心特性

- **文件系统劫持**: 完整的 KV Adapter，拦截所有 `fs` 操作重定向到 Cloudflare KV
- **原子化写入**: 防并发冲突的锁机制（带超时保护），确保数据一致性
- **请求指纹优化**: 13 种高熵 User-Agent + 浏览器特征模拟（Chrome/Firefox/Safari/Edge），防 WAF 拦截
- **零 Node.js 依赖**: 纯 V8 引擎运行，无需 Node.js 原生模块
- **强制鉴权**: API 路由密码保护，订阅链接支持 Token 验证
- **错误降级**: KV 读写失败自动降级到缓存，25MB 限制检查
- **自动重试**: HTTP 请求 3 次重试 + 30 秒超时保护

## 📁 项目结构

```
CF-Sub-Store/
├── kv-adapter.js           # KV 适配层（核心）v1.1.0
│   ├── 死锁保护（5秒超时）
│   ├── 错误降级（缓存回退）
│   ├── 批量操作优化（分页加载）
│   └── 统计接口（缓存监控）
├── functions/
│   └── [[path]].js         # Cloudflare Pages Functions 入口
│       ├── 13 种 UA 池（加权随机）
│       ├── 浏览器指纹模拟（sec-ch-ua）
│       ├── HTTP 重试机制（3 次）
│       └── 超时保护（30 秒）
├── build.js                # 构建脚本 v2.0（完整 polyfill）
├── wrangler.toml           # Cloudflare 配置
├── MODIFICATIONS.js        # Sub-Store 源码修改指南
└── deploy.sh               # 一键部署脚本 v2.0（增强版）
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
SUB_STORE_API_TOKEN = "your-super-secure-token-here"  # 修改为强密码（建议 32 位以上）
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
# 获取环境信息
curl "https://your-project.pages.dev/api/utils/env?token=YOUR_TOKEN"

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
3. **定期备份 KV 数据**: 
   ```bash
   wrangler kv:key list --binding=SUB_STORE_KV
   wrangler kv:key get <key> --binding=SUB_STORE_KV
   ```
4. **限制 API 访问频率**: 在 Cloudflare 中配置 Rate Limiting
5. **启用 WAF 规则**: 防止恶意请求

## 🛠️ 本地开发

```bash
npm install
npm run dev
```

访问 `http://localhost:8788`

## 📊 性能优化

- **KV 预加载**: 启动时批量加载所有配置到内存（分页加载，每批 50 个）
- **请求缓存**: 订阅源请求自动缓存 5 分钟
- **边缘计算**: 全球 300+ 节点就近响应
- **死锁保护**: 5 秒锁超时自动释放
- **错误降级**: KV 读写失败自动回退到缓存
- **HTTP 重试**: 3 次重试 + 指数退避

## ⚠️ 已知限制

- **KV 写入延迟**: 全球同步需要 60 秒（最终一致性）
- **单个 KV 值上限**: 25 MB（已自动检查）
- **免费版 KV 读取**: 100,000 次/天
- **Workers 脚本大小**: 1 MB（免费版），10 MB（付费版）

## 🔍 故障排查

### 1. API 返回 500 错误
- 检查 Cloudflare Workers 日志
- 验证 KV 命名空间绑定是否正确
- 查看 `[KV Adapter]` 日志输出

### 2. KV 读写失败
- 确认 `wrangler.toml` 中的 KV ID 正确
- 检查 KV 命名空间是否已创建
- 查看是否超过免费版配额

### 3. 订阅拉取失败
- 检查 `[HTTP Proxy]` 日志
- 验证订阅源 URL 是否可访问
- 查看是否被 WAF 拦截（检查 User-Agent）

### 4. 构建失败
- 确认 Sub-Store 源码已克隆到 `../sub-store`
- 检查 Node.js 版本（建议 18+）
- 查看 esbuild 错误信息

## 📈 监控与调试

### 查看 KV 统计
在 Functions 中调用：
```javascript
const stats = adapter.getStats();
console.log(stats);
// { cacheSize: 10, activeLocks: 0, cacheKeys: [...] }
```

### 清理过期数据
```javascript
await adapter.cleanup('backup_.*'); // 清理所有备份文件
```

### 查看 Cloudflare 日志
```bash
wrangler pages deployment tail
```

## 🤝 贡献

欢迎提交 Issue 和 PR。

## 📄 License

MIT License - 基于 [Sub-Store](https://github.com/sub-store-org/Sub-Store) 项目

---

## 🎯 技术亮点

### KV Adapter v1.1.0
- ✅ 死锁保护（5 秒超时 + 强制释放）
- ✅ 错误降级（KV 失败 → 缓存 → 空对象）
- ✅ 批量操作（分页加载 1000 条/次，分批处理 50 条/批）
- ✅ 大小检查（25MB 限制自动拦截）
- ✅ 写入重试（3 次重试 + 指数退避）

### HTTP Proxy 增强版
- ✅ 13 种 UA 池（Chrome/Firefox/Safari/Edge，桌面/移动）
- ✅ 浏览器指纹完整模拟（sec-ch-ua, Sec-Fetch-*, Referer）
- ✅ 自动重试（5xx 错误 + 网络超时）
- ✅ 30 秒超时保护（AbortController）
- ✅ Cloudflare 优化（mirage, polish）

### 构建脚本 v2.0
- ✅ 完整 polyfill（fs, path, dotenv）
- ✅ 构建验证（大小检查 + 1MB 警告）
- ✅ 错误处理（友好的错误提示）
- ✅ 元数据输出（构建统计）

### 部署脚本 v2.0
- ✅ 依赖检查（wrangler, node）
- ✅ 配置验证（KV ID, Token）
- ✅ 构建验证（产物存在性检查）
- ✅ 部署确认（交互式提示）
- ✅ 彩色输出（错误/警告/成功）
