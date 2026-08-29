import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeMarkdownFile } from '../src/markdown-analysis.js';
import {
  analyzeMarkdownProject,
  MarkdownProjectSession,
} from '../src/project-analysis.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function projectWithFiles(count: number): Promise<{
  root: string;
  latDir: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'lat-analysis-'));
  temporaryRoots.push(root);
  const latDir = join(root, 'lat.md');
  await mkdir(latDir);
  for (let index = 0; index < count; index++) {
    const name = index === 0 ? 'lat' : `file-${index}`;
    const next = index + 1 < count ? `file-${index + 1}` : 'lat';
    await writeFile(
      join(latDir, `${name}.md`),
      `# Section ${index}\n\nSummary ${index} links to [[${next}#Section ${
        index + 1 < count ? index + 1 : 0
      }]].\n`,
    );
  }
  return { root, latDir };
}

function semanticFiles(
  project: Awaited<ReturnType<typeof analyzeMarkdownProject>>,
) {
  return [...project.files].map(([path, file]) => [
    path,
    { ...file, timings: undefined },
  ]);
}

describe('Markdown analysis', () => {
  // @lat: [[tests/analysis-tests#Returns serializable file facts]]
  it('returns all file facts without retaining the AST', () => {
    const content = `---
lat:
  require-code-mention: true
---
# Overview

See [[other#Details]], [guide](guide.md), and [missing][nowhere].
`;
    const file = analyzeMarkdownFile(
      '/project/lat.md/lat.md',
      content,
      '/project/lat.md',
      '/project',
    );

    expect(file).not.toHaveProperty('tree');
    expect(() => JSON.stringify(file)).not.toThrow();
    expect(file.frontmatter.requireCodeMention).toBe(true);
    expect(file.sections[0].id).toBe('lat.md/lat#Overview');
    expect(file.wikiRefs.map((ref) => ref.target)).toEqual(['other#Details']);
    expect(file.markdownLinks).toContainEqual({
      kind: 'link',
      line: 7,
      url: 'guide.md',
    });
    expect(file.diagnostics).toContainEqual(
      expect.objectContaining({ rule: 'markdown-reference-definition' }),
    );
  });

  // @lat: [[tests/analysis-tests#Produces equivalent inline and worker snapshots]]
  it('produces equivalent inline and worker snapshots', async () => {
    const { root, latDir } = await projectWithFiles(8);
    const inline = await analyzeMarkdownProject(latDir, root, {
      executor: 'inline',
    });
    const workers = await analyzeMarkdownProject(latDir, root, {
      executor: 'workers',
      maxWorkers: 2,
    });

    expect(semanticFiles(workers)).toEqual(semanticFiles(inline));
    expect([...workers.sectionById]).toEqual([...inline.sectionById]);
    expect([...workers.incomingRefsBySection]).toEqual([
      ...inline.incomingRefsBySection,
    ]);
  });

  // @lat: [[tests/analysis-tests#Reuses one command session snapshot]]
  it('reuses one project snapshot within a command session', async () => {
    const { root, latDir } = await projectWithFiles(2);
    const session = new MarkdownProjectSession(latDir, root, {
      executor: 'inline',
    });

    const first = await session.analysis();
    expect(await session.analysis()).toBe(first);
  });
});
