/**
 * Sub-Store 核心代码修改指南
 * 需要在原始代码中进行的关键修改
 */

// ============================================
// 文件: backend/src/vendor/open-api.js
// ============================================

// 【修改点 1】第 57-67 行：劫持 Node.js 环境检测
// 原代码：
/*
this.node = (() => {
    if (isNode) {
        const fs = eval("require('fs')");
        return { fs };
    } else {
        return null;
    }
})();
*/

// 修改为：
/*
this.node = (() => {
    if (isNode) {
        // Cloudflare Workers 环境：使用全局注入的 fs
        if (typeof globalThis.__KV_ADAPTER__ !== 'undefined') {
            return { fs: globalThis.__KV_ADAPTER__.fs };
        }
        const fs = eval("require('fs')");
        return { fs };
    } else {
        return null;
    }
})();
*/

// ============================================
// 【修改点 2】第 101-157 行：initCache() 方法
// ============================================
// 在 existsSync/readFileSync/writeFileSync 调用前添加 await
// 因为 KV 操作是异步的，需要改造为 async/await

// 原代码：
/*
if (this.node.fs.existsSync(rootPath)) {
    this.root = JSON.parse(this.node.fs.readFileSync(`${rootPath}`));
}
*/

// 修改为：
/*
if (await this.node.fs.existsSync(rootPath)) {
    this.root = JSON.parse(await this.node.fs.readFileSync(`${rootPath}`));
}
*/

// 同时修改 initCache() 方法签名为 async：
/*
async initCache() {
    // ... 原有代码，所有 fs 调用前加 await
}
*/

// ============================================
// 【修改点 3】第 161-183 行：persistCache() 方法
// ============================================
// 修改为异步方法

// 原代码：
/*
persistCache() {
    const data = JSON.stringify(this.cache, null, 2);
    if (isNode) {
        this.node.fs.writeFileSync(`${basePath}/${this.name}.json`, data, { flag: 'w' });
    }
}
*/

// 修改为：
/*
async persistCache() {
    const data = JSON.stringify(this.cache, null, 2);
    if (isNode) {
        await this.node.fs.writeFileSync(`${basePath}/${this.name}.json`, data, { flag: 'w' });
        await this.node.fs.writeFileSync(`${basePath}/root.json`, JSON.stringify(this.root, null, 2), { flag: 'w' });
    }
}
*/

// ============================================
// 【修改点 4】第 185-248 行：write/read/delete 方法
// ============================================
// 所有调用 persistCache() 的地方改为 await this.persistCache()

// 原代码：
/*
write(data, key) {
    this.cache[key] = data;
    this.persistCache();
}
*/

// 修改为：
/*
async write(data, key) {
    this.cache[key] = data;
    await this.persistCache();
}
*/

// ============================================
// 文件: backend/src/core/proxy-utils/index.js
// ============================================

// 【修改点 5】第 195 行：读取本地脚本文件
// 原代码：
/*
script = fs.readFileSync(url.split('#')[0], 'utf8');
*/

// 修改为：
/*
script = await $.node.fs.readFileSync(url.split('#')[0], 'utf8');
*/

// ============================================
// 文件: backend/src/restful/index.js
// ============================================

// 【修改点 6】第 102-110 行：静态文件检查
// 原代码：
/*
const fs_ = eval(`require("fs")`);
if (!fs_.existsSync(filePath)) {
    req.url = '/index.html';
}
*/

// 修改为：
/*
const fs_ = $.node.fs;
if (!(await fs_.existsSync(filePath))) {
    req.url = '/index.html';
}
*/

// ============================================
// 文件: backend/src/main.js
// ============================================

// 【修改点 7】第 25 行：初始化改为异步
// 原代码：
/*
migrate();
serve();
*/

// 修改为：
/*
(async () => {
    await migrate();
    await serve();
})();
*/

// ============================================
// 全局注入点（在 functions/[[path]].js 中）
// ============================================

/*
async function initSubStore(env) {
    const { fs, adapter } = injectKVAdapter(env.SUB_STORE_KV);
    
    // 注入到全局，让 Sub-Store 核心能访问
    globalThis.__KV_ADAPTER__ = { fs };
    
    // 预加载 KV 数据
    await adapter.preload();
    
    return { adapter };
}
*/

export default {
    modifications: [
        {
            file: 'backend/src/vendor/open-api.js',
            lines: '57-67, 101-157, 161-183, 185-248',
            type: 'async/await conversion + KV adapter injection'
        },
        {
            file: 'backend/src/core/proxy-utils/index.js',
            lines: '195',
            type: 'async fs.readFileSync'
        },
        {
            file: 'backend/src/restful/index.js',
            lines: '102-110',
            type: 'async fs.existsSync'
        },
        {
            file: 'backend/src/main.js',
            lines: '25',
            type: 'async initialization'
        }
    ]
};
