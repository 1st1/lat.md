import {
  createElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  addMapGeometry,
  fallbackMapStyle,
  frameMap,
  geoJsonBounds,
  getMapLibre,
  getMermaid,
  getThreeModules,
  getTopoJson,
  nextMermaidDiagramId,
  OPENFREEMAP_STYLE_URL,
  parseGeoJson,
  parseStl,
  parseTopoJson,
  richFenceErrorMessage,
  type ThreeModules,
} from './markdown-rich-fences';

export type MarkdownRichFenceKind = 'geojson' | 'mermaid' | 'stl' | 'topojson';

type RichFenceProps = {
  fallback: ReactNode;
  kind: MarkdownRichFenceKind;
  source: string;
};

type SvgNode =
  | { type: 'text'; value: string }
  | {
      type: 'element';
      tagName: string;
      properties: Record<string, unknown>;
      children: SvgNode[];
    };

const SVG_ELEMENTS = new Set([
  'a',
  'circle',
  'clipPath',
  'defs',
  'desc',
  'div',
  'ellipse',
  'feBlend',
  'feColorMatrix',
  'feComposite',
  'feDropShadow',
  'feFlood',
  'feGaussianBlur',
  'feMerge',
  'feMergeNode',
  'feOffset',
  'filter',
  'foreignObject',
  'g',
  'image',
  'line',
  'linearGradient',
  'marker',
  'mask',
  'p',
  'path',
  'pattern',
  'polygon',
  'polyline',
  'radialGradient',
  'rect',
  'small',
  'span',
  'stop',
  'style',
  'svg',
  'text',
  'title',
  'tspan',
  'use',
]);

function cssPropertyName(name: string): string {
  if (name.startsWith('--')) return name;
  if (name.startsWith('-ms-')) name = name.slice(1);
  return name.replace(/-([a-z])/g, (_match, letter: string) =>
    letter.toUpperCase(),
  );
}

function svgStyle(element: Element): CSSProperties {
  const declaration = (element as SVGElement).style;
  const result: Record<string, string> = {};
  for (let index = 0; index < declaration.length; index++) {
    const name = declaration.item(index);
    result[cssPropertyName(name)] = declaration.getPropertyValue(name);
  }
  return result as CSSProperties;
}

function svgPropertyName(name: string): string {
  if (name === 'class') return 'className';
  if (name === 'for') return 'htmlFor';
  if (name === 'tabindex') return 'tabIndex';
  if (name === 'xlink:href') return 'xlinkHref';
  if (name === 'xml:space') return 'xmlSpace';
  if (name.startsWith('aria-') || name.startsWith('data-')) return name;
  return name.replace(/[-:]([a-z])/g, (_match, letter: string) =>
    letter.toUpperCase(),
  );
}

function safeSvgUrl(value: string): boolean {
  return !/^\s*(?:javascript|vbscript|data):/i.test(value);
}

function svgNode(node: Node): SvgNode | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return { type: 'text', value: node.textContent ?? '' };
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const element = node as Element;
  const tagName = element.localName;
  if (!SVG_ELEMENTS.has(tagName)) return null;

  const properties: Record<string, unknown> = {};
  for (const attribute of Array.from(element.attributes)) {
    const name = svgPropertyName(attribute.name);
    if (/^on/i.test(name)) continue;
    if (
      (name === 'href' || name === 'xlinkHref') &&
      !safeSvgUrl(attribute.value)
    ) {
      continue;
    }
    properties[name] = name === 'style' ? svgStyle(element) : attribute.value;
  }
  return {
    type: 'element',
    tagName,
    properties,
    children: Array.from(element.childNodes)
      .map(svgNode)
      .filter((child): child is SvgNode => child !== null),
  };
}

export function parseMermaidSvg(source: string): SvgNode {
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
  const error = parsed.querySelector('parsererror');
  if (error) throw new Error('Mermaid returned invalid SVG');
  const root = svgNode(parsed.documentElement);
  if (!root || root.type !== 'element' || root.tagName !== 'svg') {
    throw new Error('Mermaid did not return an SVG document');
  }
  return root;
}

function renderSvgNode(node: SvgNode, key: string): ReactNode {
  if (node.type === 'text') return node.value;
  return createElement(
    node.tagName,
    { ...node.properties, key },
    node.children.map((child, index) =>
      renderSvgNode(child, `${key}.${index}`),
    ),
  );
}

function FenceError({
  fallback,
  label,
  message,
  onRetry,
}: {
  fallback: ReactNode;
  label: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <>
      <div className="markdown-diagram-error markdown-map-error" role="alert">
        <span>
          Could not render {label}: {message}
        </span>
        <button
          className="markdown-diagram-retry"
          onClick={onRetry}
          type="button"
        >
          Retry
        </button>
      </div>
      {fallback}
    </>
  );
}

function MermaidFence({ fallback, source }: Omit<RichFenceProps, 'kind'>) {
  const container = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [rendered, setRendered] = useState<{
    bind?: (element: Element) => void;
    root: SvgNode;
  } | null>(null);

  useEffect(() => {
    let active = true;
    setError('');
    setRendered(null);
    void getMermaid()
      .then((mermaid) => mermaid.render(nextMermaidDiagramId(), source))
      .then((result) => {
        if (!active) return;
        setRendered({
          root: parseMermaidSvg(result.svg),
          bind: result.bindFunctions,
        });
      })
      .catch((reason: unknown) => {
        if (active) setError(richFenceErrorMessage(reason));
      });
    return () => {
      active = false;
    };
  }, [attempt, source]);

  useLayoutEffect(() => {
    if (rendered?.bind && container.current) rendered.bind(container.current);
  }, [rendered]);

  if (error) {
    return (
      <FenceError
        fallback={fallback}
        label="Mermaid diagram"
        message={error}
        onRetry={() => setAttempt((value) => value + 1)}
      />
    );
  }
  if (!rendered) return fallback;
  return (
    <div
      aria-label="Mermaid diagram"
      className="markdown-diagram markdown-mermaid"
      ref={container}
      role="img"
    >
      {renderSvgNode(rendered.root, 'svg')}
    </div>
  );
}

function MapFence({
  fallback,
  kind,
  source,
}: RichFenceProps & { kind: 'geojson' | 'topojson' }) {
  const canvas = useRef<HTMLDivElement>(null);
  const figure = useRef<HTMLElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<'fallback' | 'loading' | 'ready'>(
    'loading',
  );
  const label = kind === 'topojson' ? 'TopoJSON map' : 'GeoJSON map';

  useLayoutEffect(() => {
    let active = true;
    let fallbackTimer: number | null = null;
    let map: import('maplibre-gl').Map | null = null;
    setError('');
    setStatus('loading');

    void Promise.all([
      getMapLibre(),
      kind === 'topojson' ? getTopoJson() : Promise.resolve(null),
    ])
      .then(([maplibre, topojson]) => {
        if (!active || !canvas.current || !figure.current) return;
        const data =
          kind === 'topojson'
            ? parseTopoJson(source, topojson!)
            : parseGeoJson(source);
        const color =
          getComputedStyle(figure.current).getPropertyValue('--link').trim() ||
          '#0969da';
        map = new maplibre.Map({
          attributionControl: { compact: false },
          container: canvas.current,
          scrollZoom: false,
          style: OPENFREEMAP_STYLE_URL,
        });
        map.addControl(
          new maplibre.NavigationControl({ showCompass: false }),
          'top-left',
        );
        frameMap(map, geoJsonBounds(data));

        let styleLoaded = false;
        let usingFallback = false;
        const fail = (reason: unknown) => {
          if (active) setError(richFenceErrorMessage(reason));
        };
        const activateFallback = (reason: unknown) => {
          if (!active || styleLoaded || usingFallback || !map) return;
          usingFallback = true;
          setStatus('fallback');
          figure.current?.setAttribute(
            'title',
            `Basemap unavailable; showing supplied geometry only: ${richFenceErrorMessage(reason)}`,
          );
          map.setStyle(fallbackMapStyle(), { diff: false });
        };
        fallbackTimer = window.setTimeout(
          () => activateFallback(new Error('OpenFreeMap request timed out')),
          10_000,
        );
        map.on('style.load', () => {
          if (!active || !map) return;
          try {
            addMapGeometry(map, data, color);
            styleLoaded = true;
            if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
            fallbackTimer = null;
            setStatus(usingFallback ? 'fallback' : 'ready');
            if (!usingFallback) figure.current?.removeAttribute('title');
          } catch (reason) {
            fail(reason);
          }
        });
        map.on('error', (event) => activateFallback(event.error));
      })
      .catch((reason: unknown) => {
        if (active) setError(richFenceErrorMessage(reason));
      });

    return () => {
      active = false;
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      map?.remove();
    };
  }, [attempt, kind, source]);

  if (error) {
    return (
      <FenceError
        fallback={fallback}
        label={label}
        message={error}
        onRetry={() => setAttempt((value) => value + 1)}
      />
    );
  }
  return (
    <figure
      aria-busy={status === 'loading'}
      aria-label={label}
      className="markdown-diagram markdown-map"
      data-basemap-status={status}
      ref={figure}
    >
      <div className="markdown-map-canvas" ref={canvas} />
      {status === 'loading' && (
        <div className="markdown-map-status" role="status">
          Loading {label}…
        </div>
      )}
    </figure>
  );
}

function StlCanvas({
  modules,
  onError,
  source,
}: {
  modules: ThreeModules;
  onError: (reason: unknown) => void;
  source: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!canvas.current || !viewport.current) return;
    const disposers: Array<() => void> = [];
    try {
      const { OrbitControls, STLLoader, three } = modules;
      const geometry = parseStl(source, STLLoader);
      disposers.push(() => geometry.dispose());
      geometry.computeBoundingBox();
      const center = geometry.boundingBox!.getCenter(new three.Vector3());
      geometry.translate(-center.x, -center.y, -center.z);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const radius = Math.max(geometry.boundingSphere?.radius ?? 0, 0.001);

      const scene = new three.Scene();
      const camera = new three.PerspectiveCamera(
        42,
        1,
        radius / 100,
        radius * 100,
      );
      const distance = radius * 3.2;
      camera.position.set(distance, distance * 0.72, distance);
      camera.lookAt(0, 0, 0);

      const renderer = new three.WebGLRenderer({
        antialias: true,
        alpha: true,
        canvas: canvas.current,
      });
      disposers.push(() => renderer.dispose());
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

      const figure = canvas.current.closest<HTMLElement>('.markdown-stl');
      const color =
        (figure &&
          getComputedStyle(figure).getPropertyValue('--link').trim()) ||
        '#0070f3';
      const material = new three.MeshStandardMaterial({
        color: new three.Color().setStyle(color),
        metalness: 0.08,
        roughness: 0.72,
      });
      disposers.push(() => material.dispose());
      scene.add(new three.Mesh(geometry, material));
      scene.add(new three.HemisphereLight(0xffffff, 0x777777, 2.25));
      const keyLight = new three.DirectionalLight(0xffffff, 2.5);
      keyLight.position.set(distance, distance * 1.5, distance);
      scene.add(keyLight);

      const grid = new three.GridHelper(radius * 4, 12, 0x777777, 0xaaaaaa);
      disposers.push(() => {
        grid.geometry.dispose();
        if (Array.isArray(grid.material)) {
          for (const material of grid.material) material.dispose();
        } else {
          grid.material.dispose();
        }
      });
      grid.position.y = geometry.boundingBox?.min.y ?? -radius;
      scene.add(grid);

      const controls = new OrbitControls(camera, canvas.current);
      controls.target.set(0, 0, 0);
      controls.enableDamping = false;
      controls.maxDistance = radius * 12;
      controls.minDistance = radius * 1.1;
      controls.listenToKeyEvents(canvas.current);
      controls.update();
      disposers.push(() => {
        controls.stopListenToKeyEvents();
        controls.dispose();
      });

      const render = () => renderer.render(scene, camera);
      const resize = () => {
        if (!viewport.current) return;
        const width = Math.max(viewport.current.clientWidth, 1);
        const height = Math.max(viewport.current.clientHeight, 1);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        render();
      };
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(viewport.current);
      disposers.push(() => resizeObserver.disconnect());
      controls.addEventListener('change', render);
      disposers.push(() => controls.removeEventListener('change', render));
      resize();
    } catch (reason) {
      for (const dispose of disposers.splice(0).reverse()) dispose();
      onError(reason);
    }
    return () => {
      for (const dispose of disposers.splice(0).reverse()) dispose();
    };
  }, [modules, onError, source]);

  return (
    <div className="markdown-stl-viewport" ref={viewport}>
      <canvas
        aria-label="Interactive 3D model. Drag to rotate and scroll to zoom."
        ref={canvas}
        tabIndex={0}
      />
    </div>
  );
}

function StlFence({ fallback, source }: Omit<RichFenceProps, 'kind'>) {
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [modules, setModules] = useState<ThreeModules | null>(null);

  useEffect(() => {
    let active = true;
    setError('');
    setModules(null);
    void getThreeModules()
      .then((value) => {
        if (active) setModules(value);
      })
      .catch((reason: unknown) => {
        if (active) setError(richFenceErrorMessage(reason));
      });
    return () => {
      active = false;
    };
  }, [attempt, source]);

  const fail = useCallback((reason: unknown) => {
    setError(richFenceErrorMessage(reason));
  }, []);

  if (error) {
    return (
      <FenceError
        fallback={fallback}
        label="ASCII STL model"
        message={error}
        onRetry={() => setAttempt((value) => value + 1)}
      />
    );
  }
  if (!modules) return fallback;
  return (
    <figure
      aria-label="ASCII STL 3D model"
      className="markdown-diagram markdown-stl"
    >
      <StlCanvas modules={modules} onError={fail} source={source} />
      <figcaption className="markdown-stl-caption">
        Drag to rotate · Scroll to zoom
      </figcaption>
    </figure>
  );
}

/** Render a rich Markdown fence as a React-owned browser component. */
export function MarkdownRichFence(props: RichFenceProps) {
  switch (props.kind) {
    case 'mermaid':
      return <MermaidFence fallback={props.fallback} source={props.source} />;
    case 'geojson':
    case 'topojson':
      return <MapFence {...props} kind={props.kind} />;
    case 'stl':
      return <StlFence fallback={props.fallback} source={props.source} />;
  }
}
