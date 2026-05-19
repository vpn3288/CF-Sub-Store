import { version as substoreVersion } from '../../../Sub-Store/backend/package.json';
import { ENV } from '@/vendor/open-api';

const {
    isNode,
    isQX,
    isLoon,
    isSurge,
    isStash,
    isShadowRocket,
    isLanceX,
    isEgern,
    isGUIforCores,
    isWorker,
} = ENV();

let backend = 'Workers';

let meta = {
    worker: {
        runtime: 'Cloudflare Workers',
    },
};
let feature = {};

const envObj = {
    backend,
    version: substoreVersion,
    feature,
    meta,
    isNode,
    isQX,
    isLoon,
    isSurge,
    isStash,
    isShadowRocket,
    isLanceX,
    isEgern,
    isGUIforCores,
    isWorker,
};

// 注入 SUB_STORE_* 环境变量到 meta.worker.env，供前端读取自定义名称和图标
Object.defineProperty(meta, 'worker', {
    get() {
        const workerEnv = globalThis.__workerEnv || {};
        const subStoreVars = {};
        for (const key in workerEnv) {
            if (typeof workerEnv[key] === 'string' && /^SUB_STORE_/.test(key)) {
                subStoreVars[key] = workerEnv[key];
            }
        }
        return {
            runtime: 'Cloudflare Workers',
            env: subStoreVars,
        };
    },
    enumerable: true,
    configurable: true,
});

export default envObj;
