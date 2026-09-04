import type { ViewGraph, ViewGraphNode } from '../../src/view/protocol';

export type GraphPosition = { x: number; y: number };

export function graphDisplayLabel(
  node: Pick<ViewGraphNode, 'breadcrumbs' | 'kind' | 'label' | 'sourcePath'>,
): string {
  if (node.kind === 'code-reference') {
    const path = node.sourcePath?.split('/') ?? [];
    const parent = path.at(-2);
    return parent ? `${parent} › ${node.label}` : node.label;
  }

  const breadcrumbs = node.breadcrumbs.filter(Boolean);
  const label = node.label.trim();
  const last = breadcrumbs.at(-1)?.trim();
  if (!last) return label;
  const labelIsLast =
    last.localeCompare(label, undefined, {
      sensitivity: 'accent',
    }) === 0;
  const context = labelIsLast ? breadcrumbs.at(-2)?.trim() : last;
  return context && context !== label ? `${context} › ${label}` : label;
}

export function graphNodeSize(backlinks: number): number {
  const count = Number.isFinite(backlinks) ? Math.max(0, backlinks) : 0;
  return 5 + Math.log2(count + 1) * 3;
}

function polarPosition(angle: number, radius: number): GraphPosition {
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

/** Place code around its strongest document neighbor without an animated layout. */
export function staticGraphPositions(
  graph: Pick<ViewGraph, 'edges' | 'nodes'>,
): Map<string, GraphPosition> {
  const documents = graph.nodes
    .filter((node) => node.kind === 'document')
    .sort((left, right) => left.id.localeCompare(right.id));
  const codeNodes = graph.nodes
    .filter((node) => node.kind !== 'document')
    .sort((left, right) => left.id.localeCompare(right.id));
  const documentIds = new Set(documents.map((node) => node.id));
  const codeIds = new Set(codeNodes.map((node) => node.id));
  const positions = new Map<string, GraphPosition>();
  const documentRadius =
    documents.length > 1 ? Math.max(14, documents.length * 2.5) : 0;

  documents.forEach((node, index) => {
    const angle =
      -Math.PI / 2 + (index / Math.max(1, documents.length)) * Math.PI * 2;
    positions.set(node.id, polarPosition(angle, documentRadius));
  });

  const affinity = new Map<string, Map<string, number>>();
  for (const edge of graph.edges) {
    const documentId = documentIds.has(edge.from)
      ? edge.from
      : documentIds.has(edge.to)
        ? edge.to
        : '';
    const codeId = codeIds.has(edge.from)
      ? edge.from
      : codeIds.has(edge.to)
        ? edge.to
        : '';
    if (!documentId || !codeId) continue;
    const weights = affinity.get(codeId) ?? new Map<string, number>();
    weights.set(documentId, (weights.get(documentId) ?? 0) + edge.weight);
    affinity.set(codeId, weights);
  }

  const groups = new Map<string, string[]>();
  const unassigned: string[] = [];
  for (const node of codeNodes) {
    const nearest = [...(affinity.get(node.id) ?? [])].sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )[0]?.[0];
    if (!nearest) {
      unassigned.push(node.id);
      continue;
    }
    const group = groups.get(nearest) ?? [];
    group.push(node.id);
    groups.set(nearest, group);
  }

  for (const [documentId, nodeIds] of groups) {
    const center = positions.get(documentId) ?? { x: 0, y: 0 };
    const baseAngle = Math.atan2(center.y, center.x);
    let offset = 0;
    let ring = 0;
    while (offset < nodeIds.length) {
      const count = Math.min(12 + ring * 4, nodeIds.length - offset);
      const radius = 6.4 + ring * 5.6;
      for (let index = 0; index < count; index++) {
        const angle = baseAngle + ring * 0.31 + (index / count) * Math.PI * 2;
        const relative = polarPosition(angle, radius);
        positions.set(nodeIds[offset + index], {
          x: center.x + relative.x,
          y: center.y + relative.y,
        });
      }
      offset += count;
      ring++;
    }
  }

  const outerRadius = documentRadius + 16;
  unassigned.forEach((nodeId, index) => {
    const angle = (index / Math.max(1, unassigned.length)) * Math.PI * 2;
    positions.set(nodeId, polarPosition(angle, outerRadius));
  });

  return positions;
}

/** Give semantic document matches and their attached code nodes a relevance score. */
export function graphSearchNodeScores(
  graph: Pick<ViewGraph, 'edges' | 'nodes'>,
  documentScores: ReadonlyMap<string, number>,
): Map<string, number> {
  const documentNodeScores = new Map(
    graph.nodes.flatMap((node) => {
      if (node.kind !== 'document' || !node.documentPath) return [];
      const score = documentScores.get(node.documentPath);
      return score === undefined || !Number.isFinite(score)
        ? []
        : [[node.id, score] as const];
    }),
  );
  const matches = new Map(documentNodeScores);
  const nodeKinds = new Map(graph.nodes.map((node) => [node.id, node.kind]));
  for (const edge of graph.edges) {
    const fromScore = documentNodeScores.get(edge.from);
    if (fromScore !== undefined && nodeKinds.get(edge.to) !== 'document') {
      matches.set(
        edge.to,
        Math.max(matches.get(edge.to) ?? -Infinity, fromScore),
      );
    }
    const toScore = documentNodeScores.get(edge.to);
    if (toScore !== undefined && nodeKinds.get(edge.from) !== 'document') {
      matches.set(
        edge.from,
        Math.max(matches.get(edge.from) ?? -Infinity, toScore),
      );
    }
  }
  return matches;
}

/** Stretch the current result scores across a legible node-size range. */
export function graphSearchNodeSizes(
  scores: ReadonlyMap<string, number>,
): Map<string, number> {
  const values = [...scores.values()].filter(Number.isFinite);
  if (values.length === 0) return new Map();
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const sizeMinimum = 5;
  const sizeMaximum = 14;
  const spread = maximum - minimum;

  return new Map(
    [...scores].flatMap(([nodeId, score]) => {
      if (!Number.isFinite(score)) return [];
      const relevance = spread === 0 ? 1 : (score - minimum) / spread;
      return [
        [
          nodeId,
          sizeMinimum + relevance * (sizeMaximum - sizeMinimum),
        ] as const,
      ];
    }),
  );
}

export function deterministicGraphPosition(id: string): GraphPosition {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const angle = ((hash >>> 0) / 0xffffffff) * Math.PI * 2;
  const radius = 1 + (((hash >>> 8) & 0xff) / 255) * 2;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

export function validGraphPosition(
  position: GraphPosition | undefined,
): position is GraphPosition {
  return Boolean(
    position && Number.isFinite(position.x) && Number.isFinite(position.y),
  );
}
