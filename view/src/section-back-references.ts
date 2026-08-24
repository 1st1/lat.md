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
        `${index > 0 ? '<span aria-hidden="true">›</span>' : ''}<span>${escapeHtml(part)}</span>`,
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
): { button: string; panel: string } {
  const count = section.references.length;
  const panelId = `section-back-references-${index}`;
  const button = `<button class="section-back-reference-toggle" type="button" aria-controls="${panelId}" aria-expanded="false" data-section-back-references>
    <span>References</span><span class="section-back-reference-count">${count}</span>
  </button>`;
  const items = section.references
    .map((reference) =>
      reference.kind === 'markdown'
        ? markdownReference(reference)
        : codeReference(reference),
    )
    .join('');
  const panel = `<section class="section-back-reference-panel" id="${panelId}" aria-label="References to ${escapeHtml(section.sectionId)}" hidden>
    <div class="section-back-reference-header">Referenced from</div>
    <div class="section-back-reference-list">${items}</div>
  </section>`;
  return { button, panel };
}

/** Add interactive backlink controls beside the matching rendered headings. */
export function renderSectionBackReferences(
  html: string,
  sections: ViewSectionBackReferences[],
): string {
  return sections.reduce((rendered, section, index) => {
    if (!section.headingId || section.references.length === 0) return rendered;
    const encodedId = escapeHtml(section.headingId);
    const heading = new RegExp(
      `<h([1-6]) id="${escapeRegExp(encodedId)}">([\\s\\S]*?)</h\\1>`,
    );
    const markup = backReferenceMarkup(section, index);
    return rendered.replace(heading, (match, level: string) => {
      const closing = `</h${level}>`;
      return `${match.slice(0, -closing.length)}${markup.button}${closing}${markup.panel}`;
    });
  }, html);
}
