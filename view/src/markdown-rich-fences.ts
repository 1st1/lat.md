import type { Feature, FeatureCollection, GeoJsonObject } from 'geojson';

type ActiveCheck = () => boolean;
type Cleanup = () => void;
type CleanupRegistration = (cleanup: Cleanup) => void;
type ThreeModules = {
  OrbitControls: typeof import('three/addons/controls/OrbitControls.js').OrbitControls;
  STLLoader: typeof import('three/addons/loaders/STLLoader.js').STLLoader;
  three: typeof import('three');
};

const MAP_SOURCE_SELECTOR = [
  '.markdown-geojson-source:not([data-render-status])',
  '.markdown-topojson-source:not([data-render-status])',
].join(',');

let mermaidModule: Promise<typeof import('mermaid').default> | null = null;
let mermaidDiagramId = 0;
let threeModules: Promise<ThreeModules> | null = null;

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
    renderMermaidDiagrams(root, isActive),
    renderMapDiagrams(root, isActive, registerCleanup),
    renderStlModels(root, isActive, registerCleanup),
  ]);
}
