/**
 * Cloudflare KV Adapter for Sub-Store
 * 劫持所有 fs 操作，重定向到 KV 存储
 * v1.1.0 - 增强版：死锁保护 + 错误降级 + 批量操作优化
 */

export class KVAdapter {
    constructor(kvNamespace) {
        this.kv = kvNamespace;
        this.cache = new Map();
        this.writeLocks = new Map();
        this.lockTimeouts = new Map(); // 锁超时时间戳
        this.LOCK_TIMEOUT = 5000; // 5秒超时，防死锁
        this.MAX_RETRY = 3; // 最大重试次数
    }

    // 原子化写入锁（带超时保护）
    async acquireLock(key) {
        let retries = 0;
        while (retries < this.MAX_RETRY) {
            const lockTime = this.lockTimeouts.get(key);
            
            // 检查锁是否超时
            if (lockTime && Date.now() - lockTime > this.LOCK_TIMEOUT) {
                console.warn(`[KV Adapter] Lock timeout for key: ${key}, force releasing`);
                this.releaseLock(key);
            }
            
            if (!this.writeLocks.get(key)) {
                this.writeLocks.set(key, true);
                this.lockTimeouts.set(key, Date.now());
                return;
            }
            
            await new Promise(resolve => setTimeout(resolve, 50));
            retries++;
        }
        
        // 超过重试次数，强制获取锁
        console.error(`[KV Adapter] Force acquire lock for key: ${key} after ${this.MAX_RETRY} retries`);
        this.writeLocks.set(key, true);
        this.lockTimeouts.set(key, Date.now());
    }

    releaseLock(key) {
        this.writeLocks.delete(key);
        this.lockTimeouts.delete(key);
    }

    // 模拟 fs.existsSync
    async existsSync(path) {
        const key = this.pathToKey(path);
        const cached = this.cache.get(key);
        if (cached !== undefined) return true;
        
        const value = await this.kv.get(key);
        return value !== null;
    }

    // 模拟 fs.readFileSync（带错误降级）
    async readFileSync(path, encoding = 'utf-8') {
        const key = this.pathToKey(path);
        
        // 优先从缓存读取
        if (this.cache.has(key)) {
            return this.cache.get(key);
        }

        try {
            const value = await this.kv.get(key, 'text');
            if (value === null) {
                // 特殊处理：root.json 和主配置文件不存在时返回空对象
                if (key.includes('root') || key.includes('sub-store')) {
                    console.warn(`[KV Adapter] File not found, returning empty object: ${path}`);
                    const emptyObj = '{}';
                    this.cache.set(key, emptyObj);
                    return emptyObj;
                }
                throw new Error(`ENOENT: no such file or directory, open '${path}'`);
            }

            this.cache.set(key, value);
            return value;
        } catch (error) {
            // KV 读取失败降级：返回缓存或空对象
            if (this.cache.has(key)) {
                console.warn(`[KV Adapter] KV read failed, using cache: ${path}`);
                return this.cache.get(key);
            }
            throw error;
        }
    }

    // 模拟 fs.writeFileSync (原子化 + 大小检查)
    async writeFileSync(path, data, options = {}) {
        const key = this.pathToKey(path);
        
        await this.acquireLock(key);
        try {
            const content = typeof data === 'string' ? data : JSON.stringify(data);
            
            // KV 25MB 限制检查
            const sizeInMB = new Blob([content]).size / (1024 * 1024);
            if (sizeInMB > 25) {
                throw new Error(`[KV Adapter] File size exceeds 25MB limit: ${path} (${sizeInMB.toFixed(2)}MB)`);
            }
            
            // 写入 KV（带重试）
            let retries = 0;
            while (retries < this.MAX_RETRY) {
                try {
                    await this.kv.put(key, content, {
                        expirationTtl: 31536000, // 1年过期
                        metadata: {
                            timestamp: Date.now(),
                            encoding: options.encoding || 'utf-8',
                            size: content.length
                        }
                    });
                    break;
                } catch (error) {
                    retries++;
                    if (retries >= this.MAX_RETRY) {
                        console.error(`[KV Adapter] Write failed after ${this.MAX_RETRY} retries: ${path}`);
                        throw error;
                    }
                    await new Promise(resolve => setTimeout(resolve, 100 * retries));
                }
            }

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

    // 批量预加载（启动时调用，带分页）
    async preload() {
        let cursor = null;
        let totalKeys = 0;
        
        do {
            const list = await this.kv.list({ cursor, limit: 1000 });
            
            // 分批加载，避免内存溢出
            const batchSize = 50;
            for (let i = 0; i < list.keys.length; i += batchSize) {
                const batch = list.keys.slice(i, i + batchSize);
                const promises = batch.map(async ({ name }) => {
                    try {
                        const value = await this.kv.get(name, 'text');
                        if (value !== null) {
                            this.cache.set(name, value);
                        }
                    } catch (error) {
                        console.error(`[KV Adapter] Preload failed for key: ${name}`, error);
                    }
                });
                await Promise.all(promises);
            }
            
            totalKeys += list.keys.length;
            cursor = list.list_complete ? null : list.cursor;
        } while (cursor);
        
        console.log(`[KV Adapter] Preloaded ${totalKeys} keys into cache`);
    }

    // 批量删除（清理过期数据）
    async cleanup(pattern) {
        const list = await this.kv.list();
        const keysToDelete = list.keys
            .filter(({ name }) => new RegExp(pattern).test(name))
            .map(({ name }) => name);
        
        for (const key of keysToDelete) {
            await this.kv.delete(key);
            this.cache.delete(key);
        }
        
        console.log(`[KV Adapter] Cleaned up ${keysToDelete.length} keys matching pattern: ${pattern}`);
    }

    // 获取缓存统计
    getStats() {
        return {
            cacheSize: this.cache.size,
            activeLocks: this.writeLocks.size,
            cacheKeys: Array.from(this.cache.keys())
        };
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
