import type {
  ViewCodeBackReference,
  ViewMarkdownBackReference,
  ViewSectionBackReferences,
} from '../../src/view/protocol';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function codeLanguage(path: string): { className: string; label: string } {
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
  switch (extension) {
    case '.ts':
    case '.tsx':
      return { className: 'code-language-ts', label: 'TS' };
    case '.js':
    case '.jsx':
      return { className: 'code-language-js', label: 'JS' };
    case '.py':
      return { className: 'code-language-py', label: 'PY' };
    case '.rs':
      return { className: 'code-language-rs', label: 'RS' };
    case '.go':
      return { className: 'code-language-go', label: 'GO' };
    case '.c':
    case '.h':
      return { className: 'code-language-c', label: 'C' };
    default:
      return { className: '', label: '&lt;/&gt;' };
  }
}

function breadcrumbs(reference: ViewMarkdownBackReference): string {
  return reference.breadcrumbs
    .map(
      (part, index) =>
        `<span class="section-back-reference-breadcrumb">${
          index > 0 ? '<span aria-hidden="true">›</span>' : ''
        }<span class="section-back-reference-breadcrumb-label">${escapeHtml(part)}</span></span>`,
    )
    .join('');
}

function markdownReference(reference: ViewMarkdownBackReference): string {
  return `<div class="section-back-reference-item section-back-reference-markdown">
    <a class="section-back-reference-location" href="${escapeHtml(reference.url)}">${breadcrumbs(reference)}</a>
    <div class="section-back-reference-paragraph">${reference.paragraphHtml}</div>
  </div>`;
}

function codeReference(reference: ViewCodeBackReference): string {
  const language = codeLanguage(reference.path);
  const languageClass = language.className ? ` ${language.className}` : '';
  return `<div class="section-back-reference-item section-back-reference-code">
    <a class="section-back-reference-location" href="${escapeHtml(reference.url)}">
      <span class="code-link-language${languageClass}" aria-hidden="true">${language.label}</span>
      <span>${escapeHtml(reference.path)}:${reference.line}</span>
    </a>
    <code>${escapeHtml(reference.snippet)}</code>
  </div>`;
}

function backReferenceMarkup(
  section: ViewSectionBackReferences,
  index: number,
  sectionOutputEnabled: boolean,
): { button: string; panel: string } {
  const count = section.references.length;
  const panelId = `section-back-references-${index}`;
  const countLabel = count === 1 ? '1 reference' : `${count} references`;
  const button = `<button class="section-back-reference-toggle" type="button" aria-label="Section menu${count > 0 ? `, ${countLabel}` : ''}" aria-controls="${panelId}" aria-expanded="false" data-section-back-references>
    <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" /></svg>${count > 0 ? `<span class="section-back-reference-count">${count}</span>` : ''}
  </button>`;
  const items = section.references
    .map((reference) =>
      reference.kind === 'markdown'
        ? markdownReference(reference)
        : codeReference(reference),
    )
    .join('');
  const references =
    count > 0
      ? `<div class="section-back-reference-header">Referenced from</div>
    <div class="section-back-reference-list">${items}</div>`
      : '<div class="section-back-reference-empty">No references to this section</div>';
  const panel = `<section class="section-back-reference-panel" id="${panelId}" aria-label="References to ${escapeHtml(section.sectionId)}" hidden>
    ${references}
    <div class="section-back-reference-actions">
      <button class="section-back-reference-action" type="button" data-copy-section-link="${escapeHtml(section.headingId)}">Copy link to the section</button>
      <button class="section-back-reference-action" type="button" data-copy-section-id="${escapeHtml(section.sectionId)}">Copy section ID</button>
      ${sectionOutputEnabled ? `<button class="section-back-reference-action" type="button" data-show-section-output="${escapeHtml(section.sectionId)}">Show <code>lat section</code> output</button>` : ''}
    </div>
  </section>`;
  return { button, panel };
}

type ClipboardWriter = Pick<Clipboard, 'writeText'>;

/** Copy the canonical ID accepted by `lat section`. */
export function copySectionId(
  sectionId: string,
  clipboard?: ClipboardWriter,
): string {
  if (clipboard) void clipboard.writeText(sectionId).catch(() => {});
  return sectionId;
}

/** Build the live endpoint that runs `lat section` for one canonical ID. */
export function sectionOutputRequestUrl(sectionId: string): string {
  return `/api/section?query=${encodeURIComponent(sectionId)}`;
}

/** Navigate to one rendered section and copy its absolute browser URL. */
export function navigateAndCopySectionLink(
  currentHref: string,
  headingId: string,
  navigate: (url: URL) => void,
  clipboard?: ClipboardWriter,
): URL {
  const url = new URL(currentHref);
  url.hash = headingId;
  navigate(url);
  if (clipboard) void clipboard.writeText(url.href).catch(() => {});
  return url;
}

/** Add interactive backlink controls beside the matching rendered headings. */
export function renderSectionBackReferences(
  html: string,
  sections: ViewSectionBackReferences[],
  options: { sectionOutputEnabled?: boolean } = {},
): string {
  return sections.reduce((rendered, section, index) => {
    if (!section.headingId) return rendered;
    const encodedId = escapeHtml(section.headingId);
    const heading = new RegExp(
      `<h([1-6])([^>]*)\\bid="${escapeRegExp(encodedId)}"([^>]*)>([\\s\\S]*?)</h\\1>`,
    );
    const markup = backReferenceMarkup(
      section,
      index,
      options.sectionOutputEnabled !== false,
    );
    return rendered.replace(heading, (match, level: string) => {
      const closing = `</h${level}>`;
      return `${match.slice(0, -closing.length)}${markup.button}${closing}${markup.panel}`;
    });
  }, html);
}
