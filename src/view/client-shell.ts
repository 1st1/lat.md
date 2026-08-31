/** Point Vite's entry assets at the route-independent deployment prefix. */
export function rewriteClientAssetUrls(html: string, basePath: string): string {
  const normalizedBase = basePath.endsWith('/') ? basePath : `${basePath}/`;
  return html.replace(
    /(["'])(?:\.\/|\/)assets\//g,
    (_match, quote: string) => `${quote}${normalizedBase}assets/`,
  );
}
