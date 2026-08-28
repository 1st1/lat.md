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

/** Replace GitHub-style Mermaid fence fallbacks with rendered diagrams. */
export async function renderMermaidDiagrams(root: ParentNode): Promise<void> {
  const sources = Array.from(
    root.querySelectorAll<HTMLElement>(
      '.markdown-mermaid-source:not([data-render-status])',
    ),
  );
  if (sources.length === 0) return;

  for (const source of sources) source.dataset.renderStatus = 'loading';

  let mermaid: typeof import('mermaid').default;
  try {
    mermaid = await getMermaid();
  } catch (reason) {
    for (const source of sources) {
      source.dataset.renderStatus = 'error';
      source.title = `Could not load Mermaid: ${errorMessage(reason)}`;
    }
    return;
  }

  for (const source of sources) {
    try {
      const id = `lat-mermaid-${mermaidDiagramId++}`;
      const rendered = await mermaid.render(id, source.textContent ?? '');
      const diagram = document.createElement('div');
      diagram.className = 'markdown-diagram markdown-mermaid';
      diagram.setAttribute('aria-label', 'Mermaid diagram');
      diagram.setAttribute('role', 'img');
      diagram.innerHTML = rendered.svg;
      source.replaceWith(diagram);
      rendered.bindFunctions?.(diagram);
    } catch (reason) {
      source.dataset.renderStatus = 'error';
      const message = document.createElement('div');
      message.className = 'markdown-diagram-error';
      message.setAttribute('role', 'alert');
      message.textContent = `Could not render Mermaid diagram: ${errorMessage(reason)}`;
      source.before(message);
    }
  }
}

/** Render rich GitHub fence formats found beneath a Markdown container. */
export async function renderMarkdownRichFences(
  root: ParentNode,
): Promise<void> {
  await renderMermaidDiagrams(root);
}
