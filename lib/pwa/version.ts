/** Bump when deploying changes that require a service-worker cache refresh. Keep public/sw.js CACHE_NAME in sync. */
export const PWA_VERSION = 12;

export const PWA_CACHE_NAME = `illam-v${PWA_VERSION}` as const;
