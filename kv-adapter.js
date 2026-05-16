/**
 * Cloudflare KV Adapter for Sub-Store
 * 劫持所有 fs 操作，重定向到 KV 存储
 */

export class KVAdapter {
    constructor(kvNamespace) {
        this.kv = kvNamespace;
        this.cache = new Map();
        this.writeLocks = new Map();
    }

    // 原子化写入锁
    async acquireLock(key) {
        while (this.writeLocks.get(key)) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        this.writeLocks.set(key, true);
    }

    releaseLock(key) {
        this.writeLocks.delete(key);
    }

    // 模拟 fs.existsSync
    async existsSync(path) {
        const key = this.pathToKey(path);
        const cached = this.cache.get(key);
        if (cached !== undefined) return true;
        
        const value = await this.kv.get(key);
        return value !== null;
    }

    // 模拟 fs.readFileSync
    async readFileSync(path, encoding = 'utf-8') {
        const key = this.pathToKey(path);
        
        // 优先从缓存读取
        if (this.cache.has(key)) {
            return this.cache.get(key);
        }

        const value = await this.kv.get(key, 'text');
        if (value === null) {
            throw new Error(`ENOENT: no such file or directory, open '${path}'`);
        }

        this.cache.set(key, value);
        return value;
    }

    // 模拟 fs.writeFileSync (原子化)
    async writeFileSync(path, data, options = {}) {
        const key = this.pathToKey(path);
        
        await this.acquireLock(key);
        try {
            const content = typeof data === 'string' ? data : JSON.stringify(data);
            
            // 写入 KV
            await this.kv.put(key, content, {
                expirationTtl: 31536000, // 1年过期
                metadata: {
                    timestamp: Date.now(),
                    encoding: options.encoding || 'utf-8'
                }
            });

            // 更新缓存
            this.cache.set(key, content);
        } finally {
            this.releaseLock(key);
        }
    }

    // 模拟 fs.copyFileSync
    async copyFileSync(src, dest) {
        const content = await this.readFileSync(src);
        await this.writeFileSync(dest, content);
    }

    // 路径转 KV Key
    pathToKey(path) {
        return path
            .replace(/^\.\//, '')
            .replace(/\//g, ':')
            .replace(/\.json$/, '');
    }

    // 批量预加载（启动时调用）
    async preload() {
        const list = await this.kv.list();
        const promises = list.keys.map(async ({ name }) => {
            const value = await this.kv.get(name, 'text');
            this.cache.set(name, value);
        });
        await Promise.all(promises);
    }
}

// 注入到全局 $ 对象
export function injectKVAdapter(kvNamespace) {
    const adapter = new KVAdapter(kvNamespace);
    
    return {
        fs: {
            existsSync: (path) => adapter.existsSync(path),
            readFileSync: (path, encoding) => adapter.readFileSync(path, encoding),
            writeFileSync: (path, data, options) => adapter.writeFileSync(path, data, options),
            copyFileSync: (src, dest) => adapter.copyFileSync(src, dest),
        },
        adapter
    };
}
