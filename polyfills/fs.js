
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
