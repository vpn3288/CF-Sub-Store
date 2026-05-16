
// path polyfill for Cloudflare Workers
export const join = (...args) => args.join('/').replace(/\/+/g, '/');
export const resolve = (...args) => args.join('/').replace(/\/+/g, '/');
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
