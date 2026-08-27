type LatStaticViewConfig = {
  basePath: string;
};

declare global {
  interface Window {
    __LAT_STATIC_VIEW__?: LatStaticViewConfig;
  }
}

export function staticViewBasePath(): string | null {
  if (typeof window === 'undefined') return null;
  return window.__LAT_STATIC_VIEW__?.basePath ?? null;
}

export function isStaticView(): boolean {
  return staticViewBasePath() !== null;
}

/** Prefix a Vite-emitted root asset with the static deployment base path. */
export function staticViewAssetUrl(
  assetUrl: string,
  basePath: string | null = staticViewBasePath(),
): string {
  if (!basePath || !assetUrl.startsWith('/assets/')) return assetUrl;
  return `${basePath}${assetUrl.slice(1)}`;
}

/** Strip the configured deployment prefix and static route trailing slash. */
export function viewPathname(pathname: string): string {
  const basePath = staticViewBasePath();
  if (!basePath) return pathname;
  const prefix = basePath === '/' ? '' : basePath.slice(0, -1);
  const unprefixed =
    prefix && pathname.startsWith(prefix)
      ? pathname.slice(prefix.length) || '/'
      : pathname;
  return unprefixed.length > 1 && unprefixed.endsWith('/')
    ? unprefixed.slice(0, -1)
    : unprefixed;
}

export function staticViewRoute(path: string): string | null {
  const basePath = staticViewBasePath();
  if (!basePath) return null;
  return `${basePath}${path.replace(/^\//, '')}`;
}
