import type { Feature, FeatureCollection, GeoJsonObject } from 'geojson';

type ActiveCheck = () => boolean;
type Cleanup = () => void;
type CleanupRegistration = (cleanup: Cleanup) => void;

const MAP_SOURCE_SELECTOR = [
  '.markdown-geojson-source:not([data-render-status])',
  '.markdown-topojson-source:not([data-render-status])',
].join(',');

let mermaidModule: Promise<typeof import('mermaid').default> | null = null;
let mermaidDiagramId = 0;

async function getMermaid(): Promise<typeof import('mermaid').default> {
  if (!mermaidModule) {
    mermaidModule = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        maxTextSize: 50_000,
        securityLevel: 'strict',
        startOnLoad: false,
        suppressErrorRendering: true,
        theme: 'neutral',
      });
      return mermaid;
    });
  }
  return mermaidModule;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function showFenceError(
  source: HTMLElement,
  label: string,
  reason: unknown,
): void {
  source.dataset.renderStatus = 'error';
  const message = document.createElement('div');
  message.className = 'markdown-diagram-error';
  message.setAttribute('role', 'alert');
  message.textContent = `Could not render ${label}: ${errorMessage(reason)}`;
  source.before(message);
}

/** Replace GitHub-style Mermaid fence fallbacks with rendered diagrams. */
export async function renderMermaidDiagrams(
  root: ParentNode,
  isActive: ActiveCheck = () => true,
): Promise<void> {
  const sources = Array.from(
    root.querySelectorAll<HTMLElement>(
      '.markdown-mermaid-source:not([data-render-status])',
    ),
  );
  if (sources.length === 0) return;

  let mermaid: typeof import('mermaid').default;
  try {
    mermaid = await getMermaid();
  } catch (reason) {
    if (!isActive()) return;
    for (const source of sources) {
      source.dataset.renderStatus = 'error';
      source.title = `Could not load Mermaid: ${errorMessage(reason)}`;
    }
    return;
  }
  if (!isActive()) return;

  for (const source of sources) {
    source.dataset.renderStatus = 'loading';
    try {
      const id = `lat-mermaid-${mermaidDiagramId++}`;
      const rendered = await mermaid.render(id, source.textContent ?? '');
      if (!isActive()) return;
      const diagram = document.createElement('div');
      diagram.className = 'markdown-diagram markdown-mermaid';
      diagram.setAttribute('aria-label', 'Mermaid diagram');
      diagram.setAttribute('role', 'img');
      diagram.innerHTML = rendered.svg;
      source.replaceWith(diagram);
      rendered.bindFunctions?.(diagram);
    } catch (reason) {
      if (!isActive()) return;
      showFenceError(source, 'Mermaid diagram', reason);
    }
  }
}

export function parseGeoJson(source: string): GeoJsonObject {
  const value = JSON.parse(source) as unknown;
  if (
    !value ||
    typeof value !== 'object' ||
    !('type' in value) ||
    typeof value.type !== 'string'
  ) {
    throw new Error('expected a GeoJSON object with a type');
  }
  return value as GeoJsonObject;
}

export function parseTopoJson(
  source: string,
  topojson: typeof import('topojson-client'),
): GeoJsonObject {
  const value = JSON.parse(source) as {
    objects?: Record<string, unknown>;
    type?: unknown;
  };
  if (value.type !== 'Topology' || !value.objects) {
    throw new Error('expected a TopoJSON Topology with objects');
  }

  const topology = value as Parameters<typeof topojson.feature>[0];
  const features: Feature[] = [];
  for (const object of Object.values(value.objects)) {
    const converted = topojson.feature(
      topology,
      object as Parameters<typeof topojson.feature>[1],
    );
    if (converted.type === 'FeatureCollection') {
      features.push(...converted.features);
    } else {
      features.push(converted);
    }
  }
  return { type: 'FeatureCollection', features } as FeatureCollection;
}

/** Replace GitHub-style GeoJSON and TopoJSON fallbacks with offline maps. */
export async function renderMapDiagrams(
  root: ParentNode,
  isActive: ActiveCheck = () => true,
  registerCleanup: CleanupRegistration = () => {},
): Promise<void> {
  const sources = Array.from(
    root.querySelectorAll<HTMLElement>(MAP_SOURCE_SELECTOR),
  );
  if (sources.length === 0) return;

  let leaflet: typeof import('leaflet');
  let topojson: typeof import('topojson-client');
  try {
    [leaflet, topojson] = await Promise.all([
      import('leaflet'),
      import('topojson-client'),
    ]);
  } catch (reason) {
    if (!isActive()) return;
    for (const source of sources) {
      source.dataset.renderStatus = 'error';
      source.title = `Could not load map renderer: ${errorMessage(reason)}`;
    }
    return;
  }
  if (!isActive()) return;

  for (const source of sources) {
    source.dataset.renderStatus = 'loading';
    const topo = source.classList.contains('markdown-topojson-source');
    const label = topo ? 'TopoJSON map' : 'GeoJSON map';
    let figure: HTMLElement | null = null;
    let map: ReturnType<typeof leaflet.map> | null = null;
    try {
      const data = topo
        ? parseTopoJson(source.textContent ?? '', topojson)
        : parseGeoJson(source.textContent ?? '');
      figure = document.createElement('figure');
      figure.className = 'markdown-diagram markdown-map';
      figure.setAttribute('aria-label', label);
      const canvas = document.createElement('div');
      canvas.className = 'markdown-map-canvas';
      figure.append(canvas);
      source.replaceWith(figure);

      const color =
        getComputedStyle(figure).getPropertyValue('--accent').trim() ||
        '#0969da';
      map = leaflet.map(canvas, {
        attributionControl: false,
        scrollWheelZoom: false,
      });
      const layer = leaflet
        .geoJSON(data, {
          pointToLayer: (_feature, latLng) =>
            leaflet.circleMarker(latLng, {
              color,
              fillColor: color,
              fillOpacity: 0.72,
              radius: 6,
              weight: 2,
            }),
          style: {
            color,
            fillColor: color,
            fillOpacity: 0.22,
            weight: 2,
          },
        })
        .addTo(map);
      const bounds = layer.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds.pad(0.12), { maxZoom: 12 });
      } else {
        map.setView([0, 0], 1);
      }
      const renderedMap = map;
      registerCleanup(() => renderedMap.remove());
    } catch (reason) {
      if (!isActive()) return;
      map?.remove();
      figure?.replaceWith(source);
      showFenceError(source, label, reason);
    }
  }
}

/** Render rich GitHub fence formats found beneath a Markdown container. */
export async function renderMarkdownRichFences(
  root: ParentNode,
  isActive: ActiveCheck = () => true,
  registerCleanup: CleanupRegistration = () => {},
): Promise<void> {
  await Promise.all([
    renderMermaidDiagrams(root, isActive),
    renderMapDiagrams(root, isActive, registerCleanup),
  ]);
}
