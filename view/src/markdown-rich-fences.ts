import type { Feature, FeatureCollection, GeoJSON } from 'geojson';

type ActiveCheck = () => boolean;
type Cleanup = () => void;
type CleanupRegistration = (cleanup: Cleanup) => void;
type ThreeModules = {
  OrbitControls: typeof import('three/addons/controls/OrbitControls.js').OrbitControls;
  STLLoader: typeof import('three/addons/loaders/STLLoader.js').STLLoader;
  three: typeof import('three');
};
type MapLibreModule = typeof import('maplibre-gl');
type MapLibreMap = import('maplibre-gl').Map;
type TopoJsonModule = typeof import('topojson-client');

export type GeoJsonBounds = [
  southwest: [longitude: number, latitude: number],
  northeast: [longitude: number, latitude: number],
];

export const OPENFREEMAP_STYLE_URL =
  'https://tiles.openfreemap.org/styles/liberty';

const MAP_SOURCE_ID = 'lat-document-geometry';
const MAP_FILL_LAYER_ID = 'lat-document-geometry-fill';
const MAP_LINE_LAYER_ID = 'lat-document-geometry-line';
const MAP_POINT_LAYER_ID = 'lat-document-geometry-point';

const MAP_SOURCE_SELECTOR = [
  '.markdown-geojson-source:not([data-render-status])',
  '.markdown-topojson-source:not([data-render-status])',
].join(',');

let mermaidModule: Promise<typeof import('mermaid').default> | null = null;
let mermaidDiagramId = 0;
let threeModules: Promise<ThreeModules> | null = null;

/** Cache concurrent lazy loads while allowing a rejected load to be retried. */
export function recoverableLazyImport<T>(
  load: () => Promise<T>,
): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (!pending) {
      const attempt = load();
      const recoverable = attempt.catch((reason) => {
        if (pending === recoverable) pending = null;
        throw reason;
      });
      pending = recoverable;
    }
    return pending;
  };
}

const getMapLibre = recoverableLazyImport<MapLibreModule>(
  () => import('maplibre-gl'),
);
const getTopoJson = recoverableLazyImport<TopoJsonModule>(
  () => import('topojson-client'),
);

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

async function getThreeModules(): Promise<ThreeModules> {
  if (!threeModules) {
    threeModules = Promise.all([
      import('three'),
      import('three/addons/controls/OrbitControls.js'),
      import('three/addons/loaders/STLLoader.js'),
    ]).then(([three, { OrbitControls }, { STLLoader }]) => ({
      OrbitControls,
      STLLoader,
      three,
    }));
  }
  return threeModules;
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

export function parseGeoJson(source: string): GeoJSON {
  const value = JSON.parse(source) as unknown;
  if (
    !value ||
    typeof value !== 'object' ||
    !('type' in value) ||
    typeof value.type !== 'string'
  ) {
    throw new Error('expected a GeoJSON object with a type');
  }
  return value as GeoJSON;
}

export function parseTopoJson(
  source: string,
  topojson: typeof import('topojson-client'),
): GeoJSON {
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

/** Return the geographic bounds of all finite coordinates in GeoJSON. */
export function geoJsonBounds(data: GeoJSON): GeoJsonBounds | null {
  let minimumLongitude = Number.POSITIVE_INFINITY;
  let minimumLatitude = Number.POSITIVE_INFINITY;
  let maximumLongitude = Number.NEGATIVE_INFINITY;
  let maximumLatitude = Number.NEGATIVE_INFINITY;

  const visitCoordinates = (coordinates: unknown): void => {
    if (!Array.isArray(coordinates)) return;
    if (
      coordinates.length >= 2 &&
      typeof coordinates[0] === 'number' &&
      typeof coordinates[1] === 'number'
    ) {
      const [longitude, latitude] = coordinates;
      if (Number.isFinite(longitude) && Number.isFinite(latitude)) {
        minimumLongitude = Math.min(minimumLongitude, longitude);
        minimumLatitude = Math.min(minimumLatitude, latitude);
        maximumLongitude = Math.max(maximumLongitude, longitude);
        maximumLatitude = Math.max(maximumLatitude, latitude);
      }
      return;
    }
    for (const coordinate of coordinates) visitCoordinates(coordinate);
  };

  const visitObject = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const object = value as {
      coordinates?: unknown;
      features?: unknown[];
      geometries?: unknown[];
      geometry?: unknown;
      type?: unknown;
    };
    if (object.type === 'FeatureCollection') {
      for (const feature of object.features ?? []) visitObject(feature);
    } else if (object.type === 'Feature') {
      visitObject(object.geometry);
    } else if (object.type === 'GeometryCollection') {
      for (const geometry of object.geometries ?? []) visitObject(geometry);
    } else {
      visitCoordinates(object.coordinates);
    }
  };

  visitObject(data);
  if (!Number.isFinite(minimumLongitude)) return null;
  return [
    [minimumLongitude, minimumLatitude],
    [maximumLongitude, maximumLatitude],
  ];
}

function fallbackMapStyle(): import('maplibre-gl').StyleSpecification {
  return { version: 8, sources: {}, layers: [] };
}

function addMapGeometry(map: MapLibreMap, data: GeoJSON, color: string): void {
  if (map.getSource(MAP_SOURCE_ID)) return;
  map.addSource(MAP_SOURCE_ID, { type: 'geojson', data });
  map.addLayer({
    id: MAP_FILL_LAYER_ID,
    type: 'fill',
    source: MAP_SOURCE_ID,
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: {
      'fill-color': color,
      'fill-opacity': 0.24,
    },
  });
  map.addLayer({
    id: MAP_LINE_LAYER_ID,
    type: 'line',
    source: MAP_SOURCE_ID,
    filter: [
      'any',
      ['==', ['geometry-type'], 'LineString'],
      ['==', ['geometry-type'], 'Polygon'],
    ],
    paint: {
      'line-color': color,
      'line-opacity': 0.94,
      'line-width': 3,
    },
  });
  map.addLayer({
    id: MAP_POINT_LAYER_ID,
    type: 'circle',
    source: MAP_SOURCE_ID,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-color': color,
      'circle-opacity': 0.9,
      'circle-radius': 6,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  });
}

function frameMap(map: MapLibreMap, bounds: GeoJsonBounds | null): void {
  if (!bounds) {
    map.jumpTo({ center: [0, 0], zoom: 1 });
    return;
  }
  const [[west, south], [east, north]] = bounds;
  if (west === east && south === north) {
    map.jumpTo({ center: [west, south], zoom: 12 });
    return;
  }
  map.fitBounds(bounds, { duration: 0, maxZoom: 12, padding: 36 });
}

type PreparedMapDiagram = {
  canvas: HTMLElement;
  disposed: boolean;
  error: HTMLElement | null;
  failed: boolean;
  fallbackTimer: number | null;
  figure: HTMLElement;
  label: string;
  map: MapLibreMap | null;
  source: HTMLElement;
  status: HTMLElement;
  topo: boolean;
};

function destroyPreparedMap(prepared: PreparedMapDiagram): void {
  if (prepared.fallbackTimer !== null) {
    window.clearTimeout(prepared.fallbackTimer);
    prepared.fallbackTimer = null;
  }
  prepared.map?.remove();
  prepared.map = null;
}

function prepareMapDiagram(
  source: HTMLElement,
  registerCleanup: CleanupRegistration,
): PreparedMapDiagram {
  const document = source.ownerDocument;
  const topo = source.classList.contains('markdown-topojson-source');
  const label = topo ? 'TopoJSON map' : 'GeoJSON map';
  const figure = document.createElement('figure');
  figure.className = 'markdown-diagram markdown-map';
  figure.setAttribute('aria-busy', 'true');
  figure.setAttribute('aria-label', label);
  figure.dataset.basemapStatus = 'loading';

  const canvas = document.createElement('div');
  canvas.className = 'markdown-map-canvas';
  const status = document.createElement('div');
  status.className = 'markdown-map-status';
  status.setAttribute('role', 'status');
  status.textContent = `Loading ${label}…`;
  figure.append(canvas, status);

  source.dataset.renderStatus = 'loading';
  source.replaceWith(figure);

  const prepared: PreparedMapDiagram = {
    canvas,
    disposed: false,
    error: null,
    failed: false,
    fallbackTimer: null,
    figure,
    label,
    map: null,
    source,
    status,
    topo,
  };
  registerCleanup(() => {
    if (prepared.disposed) return;
    prepared.disposed = true;
    destroyPreparedMap(prepared);
    prepared.error?.remove();
    delete source.dataset.renderStatus;
    if (figure.isConnected) figure.replaceWith(source);
  });
  return prepared;
}

function showMapError(
  prepared: PreparedMapDiagram,
  reason: unknown,
  isActive: ActiveCheck,
  registerCleanup: CleanupRegistration,
  reloadOnRetry = false,
): void {
  if (!isActive() || prepared.disposed || prepared.failed) return;
  prepared.failed = true;
  destroyPreparedMap(prepared);

  const { figure, label, source } = prepared;
  const document = source.ownerDocument;
  source.dataset.renderStatus = 'error';
  source.removeAttribute('title');

  const error = document.createElement('div');
  error.className = 'markdown-diagram-error markdown-map-error';
  error.setAttribute('role', 'alert');
  const message = document.createElement('span');
  message.textContent = `Could not render ${label}: ${errorMessage(reason)}`;
  const retry = document.createElement('button');
  retry.className = 'markdown-diagram-retry';
  retry.type = 'button';
  retry.textContent = reloadOnRetry ? 'Reload to retry' : 'Retry';
  error.append(message, retry);
  prepared.error = error;

  if (figure.isConnected) figure.replaceWith(error, source);
  else if (source.isConnected) source.before(error);
  else return;

  retry.addEventListener('click', () => {
    if (!isActive() || prepared.disposed) return;
    if (reloadOnRetry) {
      document.defaultView?.location.reload();
      return;
    }
    const root = source.parentNode;
    if (!root) return;
    prepared.disposed = true;
    error.remove();
    delete source.dataset.renderStatus;
    void renderMapDiagrams(root, isActive, registerCleanup);
  });
}

/** Replace map source before paint, then lazily initialize its renderer. */
export async function renderMapDiagrams(
  root: ParentNode,
  isActive: ActiveCheck = () => true,
  registerCleanup: CleanupRegistration = () => {},
): Promise<void> {
  const sources = Array.from(
    root.querySelectorAll<HTMLElement>(MAP_SOURCE_SELECTOR),
  );
  if (sources.length === 0) return;

  const prepared = sources.map((source) =>
    prepareMapDiagram(source, registerCleanup),
  );
  let maplibre: MapLibreModule;
  let topojson: TopoJsonModule | null;
  try {
    [maplibre, topojson] = await Promise.all([
      getMapLibre(),
      prepared.some(({ topo }) => topo) ? getTopoJson() : Promise.resolve(null),
    ]);
  } catch (reason) {
    if (!isActive()) return;
    for (const diagram of prepared) {
      showMapError(diagram, reason, isActive, registerCleanup, true);
    }
    return;
  }
  if (!isActive()) return;

  for (const diagram of prepared) {
    if (diagram.disposed) continue;
    const { canvas, figure, source, status, topo } = diagram;
    try {
      const data = topo
        ? parseTopoJson(source.textContent ?? '', topojson!)
        : parseGeoJson(source.textContent ?? '');
      const color =
        getComputedStyle(figure).getPropertyValue('--link').trim() || '#0969da';
      const renderedMap = new maplibre.Map({
        attributionControl: { compact: false },
        container: canvas,
        scrollZoom: false,
        style: OPENFREEMAP_STYLE_URL,
      });
      diagram.map = renderedMap;

      renderedMap.addControl(
        new maplibre.NavigationControl({ showCompass: false }),
        'top-left',
      );
      frameMap(renderedMap, geoJsonBounds(data));

      let usingFallback = false;
      let styleLoaded = false;
      const activateFallback = (reason: unknown) => {
        if (
          !isActive() ||
          diagram.disposed ||
          diagram.failed ||
          styleLoaded ||
          usingFallback
        ) {
          return;
        }
        usingFallback = true;
        figure.dataset.basemapStatus = 'fallback';
        figure.title = `Basemap unavailable; showing supplied geometry only: ${errorMessage(reason)}`;
        renderedMap.setStyle(fallbackMapStyle(), { diff: false });
      };
      diagram.fallbackTimer = window.setTimeout(
        () => activateFallback(new Error('OpenFreeMap request timed out')),
        10_000,
      );
      renderedMap.on('style.load', () => {
        if (!isActive() || diagram.disposed || diagram.failed) return;
        try {
          addMapGeometry(renderedMap, data, color);
          styleLoaded = true;
          if (diagram.fallbackTimer !== null) {
            window.clearTimeout(diagram.fallbackTimer);
            diagram.fallbackTimer = null;
          }
          figure.dataset.basemapStatus = usingFallback ? 'fallback' : 'ready';
          figure.setAttribute('aria-busy', 'false');
          status.remove();
          if (!usingFallback) figure.removeAttribute('title');
        } catch (reason) {
          showMapError(diagram, reason, isActive, registerCleanup);
        }
      });
      renderedMap.on('error', (event) => {
        activateFallback(event.error);
      });
    } catch (reason) {
      showMapError(diagram, reason, isActive, registerCleanup);
    }
  }
}

export function parseStl(
  source: string,
  STLLoader: ThreeModules['STLLoader'],
): import('three').BufferGeometry {
  if (
    !/^\s*solid(?:\s|$)/i.test(source) ||
    !/\bfacet\s+normal\b/i.test(source)
  ) {
    throw new Error('expected an ASCII STL solid with facets');
  }
  const geometry = new STLLoader().parse(source);
  if (geometry.getAttribute('position').count < 3) {
    geometry.dispose();
    throw new Error('the STL model has no triangles');
  }
  return geometry;
}

/** Replace GitHub-style ASCII STL fallbacks with interactive 3D models. */
export async function renderStlModels(
  root: ParentNode,
  isActive: ActiveCheck = () => true,
  registerCleanup: CleanupRegistration = () => {},
): Promise<void> {
  const sources = Array.from(
    root.querySelectorAll<HTMLElement>(
      '.markdown-stl-source:not([data-render-status])',
    ),
  );
  if (sources.length === 0) return;

  let modules: ThreeModules;
  try {
    modules = await getThreeModules();
  } catch (reason) {
    if (!isActive()) return;
    for (const source of sources) {
      source.dataset.renderStatus = 'error';
      source.title = `Could not load STL renderer: ${errorMessage(reason)}`;
    }
    return;
  }
  if (!isActive()) return;

  const { OrbitControls, STLLoader, three } = modules;
  for (const source of sources) {
    source.dataset.renderStatus = 'loading';
    let cleanup: Cleanup | null = null;
    let figure: HTMLElement | null = null;
    const disposers: Cleanup[] = [];
    try {
      const geometry = parseStl(source.textContent ?? '', STLLoader);
      disposers.push(() => geometry.dispose());
      geometry.computeBoundingBox();
      const center = geometry.boundingBox!.getCenter(new three.Vector3());
      geometry.translate(-center.x, -center.y, -center.z);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const radius = Math.max(geometry.boundingSphere?.radius ?? 0, 0.001);

      figure = document.createElement('figure');
      figure.className = 'markdown-diagram markdown-stl';
      figure.setAttribute('aria-label', 'ASCII STL 3D model');
      const viewport = document.createElement('div');
      viewport.className = 'markdown-stl-viewport';
      const caption = document.createElement('figcaption');
      caption.className = 'markdown-stl-caption';
      caption.textContent = 'Drag to rotate · Scroll to zoom';
      figure.append(viewport, caption);
      source.replaceWith(figure);

      const scene = new three.Scene();
      const camera = new three.PerspectiveCamera(
        42,
        1,
        radius / 100,
        radius * 100,
      );
      const distance = radius * 3.2;
      camera.position.set(distance, distance * 0.72, distance);

      const renderer = new three.WebGLRenderer({
        antialias: true,
        alpha: true,
      });
      disposers.push(() => {
        renderer.dispose();
        renderer.forceContextLoss();
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.domElement.setAttribute(
        'aria-label',
        'Interactive 3D model. Drag to rotate and scroll to zoom.',
      );
      renderer.domElement.tabIndex = 0;
      viewport.append(renderer.domElement);

      const color =
        getComputedStyle(figure).getPropertyValue('--link').trim() || '#0070f3';
      const material = new three.MeshStandardMaterial({
        color: new three.Color().setStyle(color),
        metalness: 0.08,
        roughness: 0.72,
      });
      disposers.push(() => material.dispose());
      const mesh = new three.Mesh(geometry, material);
      scene.add(mesh);
      scene.add(new three.HemisphereLight(0xffffff, 0x777777, 2.25));
      const keyLight = new three.DirectionalLight(0xffffff, 2.5);
      keyLight.position.set(distance, distance * 1.5, distance);
      scene.add(keyLight);

      const grid = new three.GridHelper(radius * 4, 12, 0x777777, 0xaaaaaa);
      disposers.push(() => {
        grid.geometry.dispose();
        if (Array.isArray(grid.material)) {
          for (const gridMaterial of grid.material) gridMaterial.dispose();
        } else {
          grid.material.dispose();
        }
      });
      grid.position.y = geometry.boundingBox?.min.y ?? -radius;
      scene.add(grid);

      const controls = new OrbitControls(camera, renderer.domElement);
      disposers.push(() => {
        controls.stopListenToKeyEvents();
        controls.dispose();
      });
      controls.enableDamping = false;
      controls.maxDistance = radius * 12;
      controls.minDistance = radius * 1.1;
      controls.listenToKeyEvents(renderer.domElement);
      controls.update();

      const render = () => renderer.render(scene, camera);
      const resize = () => {
        const width = Math.max(viewport.clientWidth, 1);
        const height = Math.max(viewport.clientHeight, 1);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        render();
      };
      const resizeObserver = new ResizeObserver(resize);
      disposers.push(() => resizeObserver.disconnect());
      resizeObserver.observe(viewport);
      controls.addEventListener('change', render);
      disposers.push(() => controls.removeEventListener('change', render));
      resize();

      cleanup = () => {
        for (const dispose of disposers.splice(0).reverse()) dispose();
      };
      registerCleanup(cleanup);
    } catch (reason) {
      if (cleanup) cleanup();
      else for (const dispose of disposers.reverse()) dispose();
      if (!isActive()) return;
      figure?.replaceWith(source);
      showFenceError(source, 'ASCII STL model', reason);
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
    renderMapDiagrams(root, isActive, registerCleanup),
    renderMermaidDiagrams(root, isActive),
    renderStlModels(root, isActive, registerCleanup),
  ]);
}
