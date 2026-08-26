import { MultiDirectedGraph } from 'graphology';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import Sigma from 'sigma';
import {
  createEdgeArrowProgram,
  type NodeLabelDrawingFunction,
} from 'sigma/rendering';
import type {
  ViewDocument,
  ViewGraph,
  ViewGraphNode,
  ViewGraphNodeKind,
  ViewSearchResponse,
  ViewSourceDocument,
} from '../../src/view/protocol';
import { fetchViewJson } from './data-source';
import { renderSectionBackReferences } from './section-back-references';
import { SourceView } from './SourceView';
import {
  deterministicGraphPosition,
  graphDisplayLabel,
  graphNodeSize,
  graphSearchNodeScores,
  graphSearchNodeSizes,
  staticGraphPositions,
  validGraphPosition,
} from './graph-layout';

type GraphNodeAttributes = {
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
  backlinks: number;
};

type GraphEdgeAttributes = {
  color: string;
  size: number;
  type: string;
  weight: number;
};

type GraphCategory = 'document' | 'code';

const positionCache = new Map<string, { x: number; y: number }>();
let cameraCache: { x: number; y: number; angle: number; ratio: number } | null =
  null;
let cachedViewGraph: ViewGraph | null = null;
let viewGraphRequest: Promise<ViewGraph> | null = null;
const GRAPH_SEARCH_DEBOUNCE_MS = 220;

function nodeCategory(kind: ViewGraphNodeKind): GraphCategory {
  return kind === 'document' ? 'document' : 'code';
}

function colorValue(
  styles: CSSStyleDeclaration,
  name: string,
  fallback: string,
): string {
  return styles.getPropertyValue(name).trim() || fallback;
}

function withAlpha(color: string, alpha: string): string {
  return /^#[\da-f]{6}$/i.test(color) ? `${color}${alpha}` : color;
}

const drawGraphNodeLabel: NodeLabelDrawingFunction<
  GraphNodeAttributes,
  GraphEdgeAttributes
> = (context, data, settings) => {
  if (!data.label) return;
  const fontSize = settings.labelSize;
  const labelX = data.x + data.size + 4;
  const baselineY = data.y + fontSize / 3;
  const horizontalPadding = 5;
  const verticalPadding = 3;

  context.save();
  context.font = `${settings.labelWeight} ${fontSize}px ${settings.labelFont}`;
  const metrics = context.measureText(data.label);
  const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.8;
  const descent = metrics.actualBoundingBoxDescent || fontSize * 0.2;
  const plateX = labelX - horizontalPadding;
  const plateY = baselineY - ascent - verticalPadding;
  const plateWidth = metrics.width + horizontalPadding * 2;
  const plateHeight = ascent + descent + verticalPadding * 2;
  const radius = 3;

  context.fillStyle = 'rgba(0, 0, 0, 0.8)';
  context.beginPath();
  context.moveTo(plateX + radius, plateY);
  context.lineTo(plateX + plateWidth - radius, plateY);
  context.quadraticCurveTo(
    plateX + plateWidth,
    plateY,
    plateX + plateWidth,
    plateY + radius,
  );
  context.lineTo(plateX + plateWidth, plateY + plateHeight - radius);
  context.quadraticCurveTo(
    plateX + plateWidth,
    plateY + plateHeight,
    plateX + plateWidth - radius,
    plateY + plateHeight,
  );
  context.lineTo(plateX + radius, plateY + plateHeight);
  context.quadraticCurveTo(
    plateX,
    plateY + plateHeight,
    plateX,
    plateY + plateHeight - radius,
  );
  context.lineTo(plateX, plateY + radius);
  context.quadraticCurveTo(plateX, plateY, plateX + radius, plateY);
  context.closePath();
  context.fill();

  context.fillStyle = '#fff';
  context.shadowColor = 'rgba(0, 0, 0, 0.95)';
  context.shadowBlur = 5;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 1;
  context.fillText(data.label, labelX, baselineY);
  context.restore();
};

function GraphCanvas({
  graph: viewGraph,
  onSelect,
  searchNodeSizes,
  selectedNodeId,
  visibleNodes,
}: {
  graph: ViewGraph;
  onSelect: (nodeId: string) => void;
  searchNodeSizes: ReadonlyMap<string, number> | null;
  selectedNodeId: string;
  visibleNodes: ReadonlySet<string>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const renderer = useRef<Sigma<
    GraphNodeAttributes,
    GraphEdgeAttributes
  > | null>(null);
  const selected = useRef(selectedNodeId);
  const searchSizes = useRef(searchNodeSizes);
  const visible = useRef(visibleNodes);
  const onSelectRef = useRef(onSelect);

  useLayoutEffect(() => {
    selected.current = selectedNodeId;
    renderer.current?.refresh();
  }, [selectedNodeId]);

  useEffect(() => {
    visible.current = visibleNodes;
    renderer.current?.refresh();
  }, [visibleNodes]);

  useEffect(() => {
    searchSizes.current = searchNodeSizes;
    renderer.current?.refresh();
  }, [searchNodeSizes]);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const target = container.current;
    if (!target) return;
    const styles = window.getComputedStyle(target);
    const colors: Record<GraphCategory, string> = {
      document: colorValue(styles, '--accent', '#7357d9'),
      code: colorValue(styles, '--warning', '#a87000'),
    };
    const text = colorValue(styles, '--text', '#25231f');
    const muted = colorValue(styles, '--muted', '#777268');
    const edgeColor = colorValue(styles, '--panel-border', '#dedbd1');
    const graph = new MultiDirectedGraph<
      GraphNodeAttributes,
      GraphEdgeAttributes
    >();
    const staticPositions = staticGraphPositions(viewGraph);

    for (const node of viewGraph.nodes) {
      const cachedPosition = positionCache.get(node.id);
      const position = validGraphPosition(cachedPosition)
        ? cachedPosition
        : (staticPositions.get(node.id) ?? deterministicGraphPosition(node.id));
      const backlinks = node.inDegree;
      graph.addNode(node.id, {
        ...position,
        label: graphDisplayLabel(node),
        backlinks,
        size: graphNodeSize(backlinks),
        color: colors[nodeCategory(node.kind)],
      });
    }
    for (const edge of viewGraph.edges) {
      if (!graph.hasNode(edge.from) || !graph.hasNode(edge.to)) continue;
      graph.addDirectedEdgeWithKey(edge.id, edge.from, edge.to, {
        color: edgeColor,
        size: 0.6 + Math.log2(edge.weight + 1) * 0.45,
        type: 'arrow',
        weight: edge.weight,
      });
    }

    const savePositions = () => {
      graph.forEachNode((node, attributes) => {
        const position = { x: attributes.x, y: attributes.y };
        if (validGraphPosition(position)) positionCache.set(node, position);
        else positionCache.delete(node);
      });
    };
    savePositions();

    let hoveredNode = '';
    const sigma = new Sigma<GraphNodeAttributes, GraphEdgeAttributes>(
      graph,
      target,
      {
        defaultEdgeColor: edgeColor,
        defaultEdgeType: 'arrow',
        defaultDrawNodeHover: drawGraphNodeLabel,
        defaultDrawNodeLabel: drawGraphNodeLabel,
        edgeProgramClasses: {
          arrow: createEdgeArrowProgram<
            GraphNodeAttributes,
            GraphEdgeAttributes
          >(),
        },
        hideEdgesOnMove: true,
        labelColor: { color: '#fff' },
        labelDensity: 0.12,
        labelFont:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
        labelRenderedSizeThreshold: 6,
        labelSize: 11,
        labelWeight: '600',
        minCameraRatio: 0.08,
        maxCameraRatio: 8,
        renderEdgeLabels: false,
        stagePadding: 40,
        zIndex: true,
        nodeReducer: (node, data) => {
          if (!visible.current.has(node)) return { ...data, hidden: true };
          const searchSize = searchSizes.current?.get(node);
          const renderedData =
            searchSize === undefined ? data : { ...data, size: searchSize };
          const focus = hoveredNode || selected.current;
          if (focus && node !== focus && !graph.areNeighbors(node, focus)) {
            return {
              ...renderedData,
              color: withAlpha(muted, '48'),
              label: null,
              zIndex: 0,
            };
          }
          if (node === focus) {
            return {
              ...renderedData,
              forceLabel: true,
              highlighted: true,
              size: renderedData.size + 2.5,
              zIndex: 3,
            };
          }
          return {
            ...renderedData,
            forceLabel: data.backlinks >= 4,
            zIndex: data.backlinks >= 4 ? 2 : 1,
          };
        },
        edgeReducer: (edge, data) => {
          const [from, to] = graph.extremities(edge);
          if (!visible.current.has(from) || !visible.current.has(to)) {
            return { ...data, hidden: true };
          }
          const focus = hoveredNode || selected.current;
          if (focus && from !== focus && to !== focus) {
            return {
              ...data,
              color: withAlpha(edgeColor, '24'),
              size: 0.35,
            };
          }
          return focus
            ? {
                ...data,
                color: withAlpha(text, '70'),
                size: data.size + 0.4,
              }
            : data;
        },
      },
    );
    renderer.current = sigma;
    if (cameraCache) sigma.getCamera().setState(cameraCache);

    sigma.on('enterNode', ({ node }) => {
      hoveredNode = node;
      sigma.refresh();
    });
    sigma.on('leaveNode', () => {
      hoveredNode = '';
      sigma.refresh();
    });
    sigma.on('clickNode', ({ node }) => onSelectRef.current(node));

    let draggedNode = '';
    let dragged = false;

    sigma.on('downNode', ({ node, preventSigmaDefault }) => {
      draggedNode = node;
      dragged = false;
      preventSigmaDefault();
    });
    const mouse = sigma.getMouseCaptor();
    mouse.on('mousemovebody', (event) => {
      if (!draggedNode) return;
      dragged = true;
      event.preventSigmaDefault();
      const position = sigma.viewportToGraph(event);
      graph.mergeNodeAttributes(draggedNode, position);
    });
    mouse.on('mouseup', () => {
      if (!draggedNode) return;
      positionCache.set(draggedNode, graph.getNodeAttributes(draggedNode));
      draggedNode = '';
      if (dragged) sigma.refresh();
    });

    return () => {
      savePositions();
      cameraCache = sigma.getCamera().getState();
      sigma.kill();
      renderer.current = null;
    };
  }, [viewGraph]);

  return (
    <div className="graph-canvas-shell">
      <div
        aria-label="Interactive Lat reference graph"
        className="graph-canvas"
        ref={container}
      />
      <button
        className="graph-fit"
        onClick={() => void renderer.current?.getCamera().animatedReset()}
        title="Fit graph"
        type="button"
      >
        Fit
      </button>
    </div>
  );
}

/** Warm the immutable graph projection so switching views does not wait on I/O. */
export function preloadViewGraph(minimumGeneration = 0): Promise<ViewGraph> {
  if (cachedViewGraph && cachedViewGraph.generation >= minimumGeneration) {
    return Promise.resolve(cachedViewGraph);
  }
  if (viewGraphRequest) {
    return viewGraphRequest.then((graph) =>
      graph.generation >= minimumGeneration
        ? graph
        : preloadViewGraph(minimumGeneration),
    );
  }
  const request = fetchViewJson<ViewGraph>('/api/graph').then((graph) => {
    cachedViewGraph = graph;
    return graph;
  });
  viewGraphRequest = request;
  void request.then(
    () => {
      if (viewGraphRequest === request) viewGraphRequest = null;
    },
    () => {
      if (viewGraphRequest === request) viewGraphRequest = null;
    },
  );
  return request;
}

function routeKey(url: URL, includeSearch: boolean): string {
  return `${url.pathname}${includeSearch ? url.search : ''}${url.hash}`;
}

function graphNodeForUrl(graph: ViewGraph, url: URL): ViewGraphNode | null {
  const exact = routeKey(url, true);
  const route = routeKey(url, false);
  return (
    graph.nodes.find((node) => node.url === exact) ??
    graph.nodes.find((node) => {
      const nodeUrl = new URL(node.url, window.location.origin);
      return routeKey(nodeUrl, false) === route;
    }) ??
    null
  );
}

function GraphInspector({
  gitEnabled,
  graph,
  node,
  onNavigate,
  onSelect,
}: {
  gitEnabled: boolean;
  graph: ViewGraph;
  node: ViewGraphNode | null;
  onNavigate: (url: URL) => void;
  onSelect: (nodeId: string) => void;
}) {
  const [content, setContent] = useState<
    | { kind: 'markdown'; document: ViewDocument }
    | { kind: 'source'; source: ViewSourceDocument }
    | null
  >(null);
  const [error, setError] = useState('');
  const inspector = useRef<HTMLDivElement>(null);
  const documentHtml = useMemo(
    () =>
      content?.kind === 'markdown'
        ? renderSectionBackReferences(
            gitEnabled && content.document.gitHtml
              ? content.document.gitHtml
              : content.document.html,
            content.document.backReferences,
          )
        : '',
    [content, gitEnabled],
  );

  useEffect(() => {
    const controller = new AbortController();
    setContent(null);
    setError('');
    if (!node) return () => controller.abort();
    const request =
      node.kind === 'document'
        ? fetchViewJson<ViewDocument>(
            `/api/document?path=${encodeURIComponent(node.documentPath ?? '')}`,
            controller.signal,
          ).then((document) => setContent({ kind: 'markdown', document }))
        : fetchViewJson<ViewSourceDocument>(
            `/api/source?path=${encodeURIComponent(node.sourcePath ?? '')}&symbol=${encodeURIComponent(node.symbol ?? '')}&at=${node.line ?? 0}`,
            controller.signal,
          ).then((source) => setContent({ kind: 'source', source }));
    request.catch((reason: Error) => {
      if (reason.name !== 'AbortError') setError(reason.message);
    });
    return () => controller.abort();
  }, [graph.generation, node]);

  useLayoutEffect(() => {
    const container = inspector.current;
    if (!container || !node || !content) return;
    container.scrollTop = 0;
    if (content.kind !== 'markdown') return;
    const hash = new URL(node.url, window.location.origin).hash.slice(1);
    if (!hash) return;
    let id = hash;
    try {
      id = decodeURIComponent(hash);
    } catch {
      // A malformed fragment simply leaves the document at its start.
    }
    container.querySelector<HTMLElement>(`#${CSS.escape(id)}`)?.scrollIntoView({
      block: 'start',
      behavior: 'instant',
    });
  }, [content, node]);

  function onContentClick(event: MouseEvent<HTMLElement>): void {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const target = event.target;
    const toggle =
      target instanceof Element
        ? target.closest<HTMLButtonElement>('[data-section-back-references]')
        : null;
    if (toggle) {
      const panelId = toggle.getAttribute('aria-controls');
      const panel = panelId ? window.document.getElementById(panelId) : null;
      if (panel) {
        const open = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!open));
        panel.hidden = open;
      }
      return;
    }
    const anchor =
      target instanceof Element ? target.closest<HTMLAnchorElement>('a') : null;
    if (!anchor || anchor.target || anchor.hasAttribute('download')) return;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    event.preventDefault();
    const represented = graphNodeForUrl(graph, url);
    if (represented) onSelect(represented.id);
    else onNavigate(url);
  }

  if (!node) {
    return (
      <div className="graph-inspector-empty">
        Choose a document or code reference in the graph.
      </div>
    );
  }

  return (
    <div className="graph-inspector-scroll" ref={inspector}>
      {error ? (
        <div className="state error" role="alert">
          <strong>Could not open this node</strong>
          <span>{error}</span>
        </div>
      ) : content?.kind === 'markdown' ? (
        <div className="graph-inspector-document" onClick={onContentClick}>
          <div className="document-metadata">
            <div className="document-path">{content.document.path}</div>
            {content.document.frontmatter.requireCodeMention && (
              <div className="document-flag">Code mentions required</div>
            )}
            {content.document.errors.length > 0 && (
              <div className="document-error-toggle">
                {content.document.errors.length}{' '}
                {content.document.errors.length === 1 ? 'error' : 'errors'}
              </div>
            )}
          </div>
          <article
            className="markdown"
            dangerouslySetInnerHTML={{ __html: documentHtml }}
          />
        </div>
      ) : content?.kind === 'source' ? (
        <div className="graph-inspector-source">
          <SourceView
            key={`${content.source.path}#${content.source.focus?.symbol ?? ''}@${content.source.focus?.startLine ?? 0}`}
            onContentClick={onContentClick}
            source={content.source}
          />
        </div>
      ) : (
        <div className="state">Loading node…</div>
      )}
    </div>
  );
}

export default function GraphView({
  generation,
  gitEnabled,
  header,
  markdownGeneration,
  onNavigate,
  onSelect,
  searchEnabled,
  selectedNodeId,
}: {
  generation: number;
  gitEnabled: boolean;
  header: (selectedNode: ViewGraphNode | null) => ReactNode;
  markdownGeneration: number;
  onNavigate: (url: URL) => void;
  onSelect: (nodeId: string) => void;
  searchEnabled: boolean;
  selectedNodeId: string;
}) {
  const [graph, setGraph] = useState<ViewGraph | null>(cachedViewGraph);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [searchMatch, setSearchMatch] = useState<{
    pathScores: Map<string, number>;
    query: string;
  } | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [categories, setCategories] = useState<Record<GraphCategory, boolean>>({
    document: true,
    code: true,
  });

  useEffect(() => {
    let cancelled = false;
    setError('');
    void preloadViewGraph(generation)
      .then((nextGraph) => {
        if (!cancelled) setGraph(nextGraph);
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      });
    return () => {
      cancelled = true;
    };
  }, [generation]);

  const normalizedQuery = searchEnabled ? query.trim() : '';
  useEffect(() => {
    const controller = new AbortController();
    setSearchError('');
    setSearching(Boolean(normalizedQuery));
    if (!normalizedQuery) {
      setSearchMatch(null);
      return () => controller.abort();
    }

    const timeout = window.setTimeout(() => {
      void fetchViewJson<ViewSearchResponse>(
        `/api/search?query=${encodeURIComponent(normalizedQuery)}`,
        controller.signal,
      )
        .then((response) => {
          const pathScores = new Map<string, number>();
          for (const result of response.results) {
            pathScores.set(
              result.path,
              Math.max(pathScores.get(result.path) ?? -Infinity, result.score),
            );
          }
          setSearchMatch({
            pathScores,
            query: normalizedQuery,
          });
        })
        .catch((reason: Error) => {
          if (reason.name !== 'AbortError') setSearchError(reason.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, GRAPH_SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [markdownGeneration, normalizedQuery]);

  const semanticNodeScores = useMemo(() => {
    if (!graph || !normalizedQuery || searchMatch?.query !== normalizedQuery) {
      return null;
    }
    return graphSearchNodeScores(graph, searchMatch.pathScores);
  }, [graph, normalizedQuery, searchMatch]);
  const searchNodeSizes = useMemo(
    () =>
      semanticNodeScores ? graphSearchNodeSizes(semanticNodeScores) : null,
    [semanticNodeScores],
  );

  const visibleNodes = useMemo(
    () =>
      new Set(
        (graph?.nodes ?? [])
          .filter(
            (node) =>
              categories[nodeCategory(node.kind)] &&
              (!semanticNodeScores || semanticNodeScores.has(node.id)),
          )
          .map((node) => node.id),
      ),
    [categories, graph, semanticNodeScores],
  );
  const selectedNode =
    graph?.nodes.find((node) => node.id === selectedNodeId) ?? null;

  useEffect(() => {
    if (graph && selectedNodeId && !selectedNode) onSelect('');
  }, [graph, onSelect, selectedNode, selectedNodeId]);

  return (
    <>
      <div className="graph-topbar">
        <div className="graph-topbar-graph">
          {header(selectedNode)}
          <div className="graph-tools">
            {searchEnabled ? (
              <label className="graph-filter">
                <span className="visually-hidden">
                  Search graph with embeddings
                </span>
                <input
                  autoComplete="off"
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  placeholder="Search graph…"
                  spellCheck="false"
                  type="search"
                  value={query}
                />
                <span aria-live="polite" className="graph-node-count">
                  {searching
                    ? 'Searching…'
                    : `${visibleNodes.size} ${visibleNodes.size === 1 ? 'node' : 'nodes'}`}
                </span>
              </label>
            ) : (
              <span className="graph-node-count">
                {visibleNodes.size} {visibleNodes.size === 1 ? 'node' : 'nodes'}
              </span>
            )}
          </div>
        </div>
      </div>
      {error ? (
        <div className="state error graph-state" role="alert">
          <strong>Could not build the graph</strong>
          <span>{error}</span>
        </div>
      ) : !graph ? (
        <div className="state graph-state">Loading graph…</div>
      ) : (
        <div className="graph-workspace">
          <section className="graph-pane">
            <GraphCanvas
              graph={graph}
              onSelect={onSelect}
              searchNodeSizes={searchNodeSizes}
              selectedNodeId={selectedNodeId}
              visibleNodes={visibleNodes}
            />
            <div
              aria-label="Graph node kinds"
              className="graph-kind-filters graph-legend"
            >
              {(['document', 'code'] as const).map((category) => (
                <label className={category} key={category}>
                  <input
                    checked={categories[category]}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setCategories((current) => ({
                        ...current,
                        [category]: checked,
                      }));
                    }}
                    type="checkbox"
                  />
                  <span>{category}</span>
                </label>
              ))}
            </div>
            {searchError ? (
              <div className="graph-no-results">{searchError}</div>
            ) : (
              !searching &&
              visibleNodes.size === 0 && (
                <div className="graph-no-results">
                  No nodes match this search.
                </div>
              )
            )}
          </section>
          <aside className="graph-inspector">
            <div aria-live="polite" className="visually-hidden">
              {selectedNode
                ? `Selected ${selectedNode.label}`
                : 'No node selected'}
            </div>
            <GraphInspector
              gitEnabled={gitEnabled}
              graph={graph}
              node={selectedNode}
              onNavigate={onNavigate}
              onSelect={onSelect}
            />
          </aside>
        </div>
      )}
    </>
  );
}
