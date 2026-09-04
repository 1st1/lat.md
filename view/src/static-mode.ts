import { documentUrl } from '../../src/view/document-route';

type LatStaticViewConfig = {
  basePath: string;
  entry?: string;
  searchApi?: string;
};

const STATIC_VIEW_META_NAME = 'lat-static-view';

function staticViewConfig(): LatStaticViewConfig | null {
  if (typeof document === 'undefined') return null;
  const content = document.querySelector<HTMLMetaElement>(
    `meta[name="${STATIC_VIEW_META_NAME}"]`,
  )?.content;
  if (!content) return null;
  try {
    const value = JSON.parse(decodeURIComponent(content)) as unknown;
    if (
      !value ||
      typeof value !== 'object' ||
      !('basePath' in value) ||
      typeof value.basePath !== 'string' ||
      !value.basePath.startsWith('/') ||
      !value.basePath.endsWith('/') ||
      ('entry' in value &&
        value.entry !== undefined &&
        (typeof value.entry !== 'string' || !value.entry)) ||
      ('searchApi' in value &&
        value.searchApi !== undefined &&
        typeof value.searchApi !== 'string')
    ) {
      return null;
    }
    return value as LatStaticViewConfig;
  } catch {
    return null;
  }
}

export function staticViewBasePath(): string | null {
  return staticViewConfig()?.basePath ?? null;
}

export function isStaticView(): boolean {
  return staticViewBasePath() !== null;
}

/** Resolve the homepage in both a live shell and a portable snapshot. */
export function viewEntryPath(): string | null {
  const config = staticViewConfig();
  if (config) return config.entry ?? null;
  if (typeof document === 'undefined') return null;
  const entry = document.querySelector<HTMLMetaElement>(
    'meta[name="lat-live-entry"]',
  )?.content;
  try {
    return entry ? decodeURIComponent(entry) : null;
  } catch {
    return null;
  }
}

/** Return the optional dynamic search endpoint attached to a static build. */
export function staticViewSearchApi(): string | null {
  return staticViewConfig()?.searchApi ?? null;
}

/** Prefix a bundled root asset with the static deployment base path. */
export function staticViewAssetUrl(
  assetUrl: string,
  basePath: string | null = staticViewBasePath(),
): string {
  if (!basePath || !assetUrl.startsWith('/assets/')) {
    return assetUrl;
  }
  return `${basePath}${assetUrl.slice(1)}`;
}

/** Strip the configured deployment prefix and static route trailing slash. */
export function viewPathname(pathname: string): string {
  const config = staticViewConfig();
  if (!config) {
    const entry = viewEntryPath();
    if (pathname === '/' && entry) return documentUrl(entry);
    return pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  }
  const { basePath } = config;
  const prefix = basePath === '/' ? '' : basePath.slice(0, -1);
  const unprefixed =
    prefix && (pathname === prefix || pathname.startsWith(`${prefix}/`))
      ? pathname.slice(prefix.length) || '/'
      : pathname;
  const route =
    unprefixed.length > 1 && unprefixed.endsWith('/')
      ? unprefixed.slice(0, -1)
      : unprefixed;
  return config.entry && (route === '/' || route === '/index.html')
    ? documentUrl(config.entry)
    : route;
}

export function staticViewRoute(path: string): string | null {
  const config = staticViewConfig();
  if (!config) return null;
  const route = path.replace(/^\//, '');
  if (config.entry && route === documentUrl(config.entry).slice(1)) {
    return config.basePath;
  }
  return `${config.basePath}${route}`;
}
