// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { parseMermaidSvg } from '../view/src/MarkdownRichFence.js';

describe('Markdown rich fences', () => {
  it('reflects Mermaid SVG without executable nodes or properties', () => {
    const tree = parseMermaidSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" onclick="alert(1)">
        <a href="javascript:alert(2)"><text>safe</text></a>
        <script>alert(3)</script>
        <path d="M0 0L1 1" />
      </svg>
    `);

    expect(tree).toMatchObject({
      type: 'element',
      tagName: 'svg',
      properties: { xmlns: 'http://www.w3.org/2000/svg' },
    });
    expect(JSON.stringify(tree)).not.toContain('onclick');
    expect(JSON.stringify(tree)).not.toContain('javascript:');
    expect(JSON.stringify(tree)).not.toContain('script');
    expect(JSON.stringify(tree)).toContain('M0 0L1 1');
  });
});
