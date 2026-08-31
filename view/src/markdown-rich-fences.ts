import type { Feature, FeatureCollection, GeoJSON } from 'geojson';

export type ThreeModules = {
  OrbitControls: typeof import('three/addons/controls/OrbitControls.js').OrbitControls;
  STLLoader: typeof import('three/addons/loaders/STLLoader.js').STLLoader;
  three: typeof import('three');
};

export type MapLibreModule = typeof import('maplibre-gl');
export type MapLibreMap = import('maplibre-gl').Map;
export type TopoJsonModule = typeof import('topojson-client');

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

let mermaidDiagramId = 0;

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

export const getMapLibre = recoverableLazyImport<MapLibreModule>(
  () => import('maplibre-gl'),
);

export const getTopoJson = recoverableLazyImport<TopoJsonModule>(
  () => import('topojson-client'),
);

export const getMermaid = recoverableLazyImport(async () => {
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({
    maxTextSize: 50_000,
    securityLevel: 'strict',
    startOnLoad: false,
    suppressErrorRendering: true,
    theme: 'neutral',
  });
  return mermaid;
});

export const getThreeModules = recoverableLazyImport<ThreeModules>(async () => {
  const [three, { OrbitControls }, { STLLoader }] = await Promise.all([
    import('three'),
    import('three/addons/controls/OrbitControls.js'),
    import('three/addons/loaders/STLLoader.js'),
  ]);
  return { OrbitControls, STLLoader, three };
});

export function nextMermaidDiagramId(): string {
  return `lat-mermaid-${mermaidDiagramId++}`;
}

export function richFenceErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
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
  topojson: TopoJsonModule,
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

export function fallbackMapStyle(): import('maplibre-gl').StyleSpecification {
  return { version: 8, sources: {}, layers: [] };
}

export function addMapGeometry(
  map: MapLibreMap,
  data: GeoJSON,
  color: string,
): void {
  if (map.getSource(MAP_SOURCE_ID)) return;
  map.addSource(MAP_SOURCE_ID, { type: 'geojson', data });
  map.addLayer({
    id: MAP_FILL_LAYER_ID,
    type: 'fill',
    source: MAP_SOURCE_ID,
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': color, 'fill-opacity': 0.24 },
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

export function frameMap(map: MapLibreMap, bounds: GeoJsonBounds | null): void {
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
