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
  return 5 + Math.log2(count + 1) * 1.8;
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
      const radius = 4 + ring * 3.5;
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

/** Keep semantic document matches and the code nodes directly attached to them. */
export function graphSearchNodeIds(
  graph: Pick<ViewGraph, 'edges' | 'nodes'>,
  documentPaths: ReadonlySet<string>,
): Set<string> {
  const documentIds = new Set(
    graph.nodes
      .filter(
        (node) =>
          node.kind === 'document' &&
          node.documentPath &&
          documentPaths.has(node.documentPath),
      )
      .map((node) => node.id),
  );
  const matches = new Set(documentIds);
  const nodeKinds = new Map(graph.nodes.map((node) => [node.id, node.kind]));
  for (const edge of graph.edges) {
    if (documentIds.has(edge.from) && nodeKinds.get(edge.to) !== 'document') {
      matches.add(edge.to);
    }
    if (documentIds.has(edge.to) && nodeKinds.get(edge.from) !== 'document') {
      matches.add(edge.from);
    }
  }
  return matches;
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
