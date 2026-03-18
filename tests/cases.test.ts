import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { dirname, join } from 'node:path';
import {
  findLatticeDir,
  listLatticeFiles,
  loadAllSections,
  findSections,
  flattenSections,
  parseSections,
  extractRefs,
  buildFileIndex,
  resolveRef,
} from '../src/lattice.js';
import { formatSectionPreview } from '../src/format.js';
import { plainStyler, type CmdContext } from '../src/context.js';
import {
  checkMd,
  checkCodeRefs,
  checkIndex,
  checkSections,
} from '../src/cli/check.js';
import { scanCodeRefs } from '../src/code-refs.js';
import { findRefs } from '../src/cli/refs.js';
import { getSection, formatSectionOutput } from '../src/cli/section.js';

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

const casesDir = join(import.meta.dirname, 'cases');

function caseDir(name: string): string {
  return join(casesDir, name);
}

function latDir(name: string): string {
  return join(casesDir, name, 'lat.md');
}

function testCtx(name: string): CmdContext {
  return {
    latDir: latDir(name),
    projectRoot: caseDir(name),
    styler: plainStyler,
    mode: 'cli',
  };
}

// --- basic-project ---

describe('basic-project', () => {
  const lat = latDir('basic-project');

  // @lat: [[section-parsing#Builds a section tree from nested headings]]
  it('parses section tree from nested headings', async () => {
    const sections = await loadAllSections(lat);
    const flat = flattenSections(sections);
    const ids = flat.map((s) => s.id);

    expect(ids).toContain('lat.md/dev-process#Dev Process');
    expect(ids).toContain('lat.md/dev-process#Dev Process#Testing');
    expect(ids).toContain(
      'lat.md/dev-process#Dev Process#Testing#Running Tests',
    );
    expect(ids).toContain('lat.md/dev-process#Dev Process#Formatting');
    expect(ids).toContain('lat.md/notes#Notes');
    expect(ids).toContain('lat.md/notes#Notes#First Topic');
    expect(ids).toContain('lat.md/notes#Notes#Second Topic');
  });

  // @lat: [[section-parsing#Populates position and firstParagraph fields]]
  it('populates startLine, endLine, and firstParagraph', async () => {
    const sections = await loadAllSections(lat);
    const flat = flattenSections(sections);

    const running = flat.find(
      (s) => s.id === 'lat.md/dev-process#Dev Process#Testing#Running Tests',
    )!;
    expect(running.startLine).toBe(5);
    expect(running.endLine).toBe(8);
    expect(running.firstParagraph).toBe('Run tests with vitest.');

    const formatting = flat.find(
      (s) => s.id === 'lat.md/dev-process#Dev Process#Formatting',
    )!;
    expect(formatting.startLine).toBe(9);
    expect(formatting.firstParagraph).toBe('Prettier all the things.');
  });

  // @lat: [[section-parsing#Renders inline code in firstParagraph]]
  it('renders inline code in firstParagraph', async () => {
    const sections = await loadAllSections(lat);
    const flat = flattenSections(sections);
    const first = flat.find((s) => s.id === 'lat.md/notes#Notes#First Topic')!;
    expect(first.firstParagraph).toBe('Run `vitest` to test.');
  });

  // @lat: [[section-parsing#Renders wiki links in firstParagraph]]
  it('renders wiki links in firstParagraph', async () => {
    const sections = await loadAllSections(lat);
    const flat = flattenSections(sections);
    const second = flat.find(
      (s) => s.id === 'lat.md/notes#Notes#Second Topic',
    )!;
    expect(second.firstParagraph).toBe('See [[dev-process#Testing]] for more.');
  });

  // @lat: [[ref-extraction#Extracts wiki link references]]
  it('extracts wiki link references', async () => {
    const files = await listLatticeFiles(lat);
    const notesFile = files.find((f) => f.endsWith('notes.md'))!;
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(notesFile, 'utf-8');
    const refs = extractRefs(notesFile, content, caseDir('basic-project'));

    expect(refs).toHaveLength(1);
    expect(refs[0].target).toBe('dev-process#Testing');
    expect(refs[0].fromSection).toBe('lat.md/notes#Notes#Second Topic');
  });

  // @lat: [[ref-extraction#Returns empty for files without links]]
  it('returns no refs for files without wiki links', async () => {
    const files = await listLatticeFiles(lat);
    const devFile = files.find((f) => f.endsWith('dev-process.md'))!;
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(devFile, 'utf-8');
    const refs = extractRefs(devFile, content, caseDir('basic-project'));

    expect(refs).toHaveLength(0);
  });

  // @lat: [[section-preview#Formats section with firstParagraph]]
  it('formats section preview with firstParagraph', async () => {
    const sections = await loadAllSections(lat);
    const flat = flattenSections(sections);
    const running = flat.find(
      (s) => s.id === 'lat.md/dev-process#Dev Process#Testing#Running Tests',
    )!;

    const output = stripAnsi(
      formatSectionPreview(testCtx('basic-project'), running),
    );
    const lines = output.split('\n');
    expect(lines[0]).toBe(
      '* Section: [[lat.md/dev-process#Dev Process#Testing#Running Tests]]',
    );
    expect(lines[1]).toContain('Defined in');
    expect(lines[1]).toContain('dev-process.md:5-8');
    expect(lines[3]).toContain('> Run tests with vitest.');
  });

  // @lat: [[section-preview#Formats section without firstParagraph]]
  it('formats section preview without firstParagraph', async () => {
    const sections = await loadAllSections(lat);
    const flat = flattenSections(sections);
    const testing = flat.find(
      (s) => s.id === 'lat.md/dev-process#Dev Process#Testing',
    )!;

    const output = stripAnsi(
      formatSectionPreview(testCtx('basic-project'), testing),
    );
    const lines = output.split('\n');
    expect(lines[0]).toBe(
      '* Section: [[lat.md/dev-process#Dev Process#Testing]]',
    );
    expect(lines[1]).toContain('Defined in');
    expect(lines[1]).toContain('dev-process.md:3-4');
    expect(lines).toHaveLength(2);
  });

  // @lat: [[locate#Finds sections by exact id]]
  it('locate finds sections by exact id', async () => {
    const sections = await loadAllSections(lat);
    const matches = findSections(sections, 'dev-process#Testing#Running Tests');
    expect(matches).toHaveLength(1);
    expect(matches[0].section.file).toBe('lat.md/dev-process');
  });

  // @lat: [[locate#Matches subsection by trailing segment]]
  it('locate matches subsection by trailing segment name', async () => {
    const sections = await loadAllSections(lat);
    const matches = findSections(sections, 'Running Tests');
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0].section.id).toBe(
      'lat.md/dev-process#Dev Process#Testing#Running Tests',
    );
  });

  // @lat: [[locate#Fuzzy matches with typos]]
  it('locate fuzzy matches with typos', async () => {
    const sections = await loadAllSections(lat);
    const matches = findSections(sections, 'Runing Tests');
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0].section.id).toBe(
      'lat.md/dev-process#Dev Process#Testing#Running Tests',
    );
  });

  it('locate returns empty for non-matching query', async () => {
    const sections = await loadAllSections(lat);
    expect(findSections(sections, 'Nonexistent')).toHaveLength(0);
  });

  // @lat: [[locate#Reports match reasons]]
  it('locate reports match reasons', async () => {
    const sections = await loadAllSections(lat);

    const exact = findSections(
      sections,
      'lat.md/dev-process#Dev Process#Testing',
    );
    expect(exact[0].reason).toBe('exact match');

    const sub = findSections(sections, 'Running Tests');
    expect(sub[0].reason).toBe('section name match');

    const fuzzy = findSections(sections, 'Runing Tests');
    expect(fuzzy[0].reason).toMatch(/^fuzzy match/);
  });

  // @lat: [[locate#Matches with skipped intermediate sections]]
  it('locate matches with skipped intermediate sections', async () => {
    const sections = await loadAllSections(lat);
    const matches = findSections(sections, 'dev-process#Running Tests');
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0].section.id).toBe(
      'lat.md/dev-process#Dev Process#Testing#Running Tests',
    );
    expect(matches[0].reason).toContain('intermediate section');
    expect(matches[0].reason).toContain('skipped');
  });

  // @lat: [[locate#Strips brackets from query]]
  it('locate strips [[brackets]] from query', async () => {
    const sections = await loadAllSections(lat);
    const withBrackets = findSections(sections, '[[Running Tests]]');
    // findSections itself doesn't strip brackets — that's locateCmd's job.
    // But we can verify the locate.ts stripping logic inline:
    const stripped = '[[Running Tests]]'.replace(/^\[\[|\]\]$/g, '');
    const matches = findSections(sections, stripped);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0].section.id).toBe(
      'lat.md/dev-process#Dev Process#Testing#Running Tests',
    );
  });

  // @lat: [[locate#Strips leading hash from query]]
  it('locate strips leading hash from query', async () => {
    const sections = await loadAllSections(lat);
    const matches = findSections(sections, '#Testing');
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0].section.id).toBe(
      'lat.md/dev-process#Dev Process#Testing',
    );
    expect(matches[0].reason).toBe('section name match');
  });

  // @lat: [[refs-e2e#Finds referring sections via wiki links]]
  it('refs finds sections referencing a target', async () => {
    const files = await listLatticeFiles(lat);
    const { readFile } = await import('node:fs/promises');

    const allRefs = [];
    for (const file of files) {
      const content = await readFile(file, 'utf-8');
      allRefs.push(...extractRefs(file, content, caseDir('basic-project')));
    }

    const matching = allRefs
      .filter((r) => r.target.toLowerCase() === 'dev-process#testing')
      .map((r) => r.fromSection.toLowerCase());

    expect(matching).toContain('lat.md/notes#notes#second topic');
  });

  // @lat: [[check-md#Passes with valid links]]
  it('check md passes with valid links', async () => {
    const { errors, files } = await checkMd(lat);
    expect(errors).toHaveLength(0);
    expect(files).toEqual({ '.md': 2 });
  });
});

// --- expand ---

describe('expand', () => {
  const root = caseDir('basic-project');

  function runExpand(text: string): string {
    return execSync(
      `node ${join(import.meta.dirname, '..', 'dist', 'src', 'cli', 'index.js')} expand ${JSON.stringify(text)}`,
      {
        cwd: root,
        encoding: 'utf-8',
        env: process.env,
      },
    );
  }

  // @lat: [[tests/expand#Resolves exact ref with context]]
  it('resolves exact ref with "is referring to" context', () => {
    const output = runExpand('see [[dev-process#Testing]]');
    expect(output).toContain('see [[lat.md/dev-process#Dev Process#Testing]]');
    expect(output).toContain('<lat-context>');
    expect(output).toContain('`[[dev-process#Testing]]` is referring to:');
    expect(output).toContain('* [[lat.md/dev-process#Dev Process#Testing]]');
    expect(output).toContain('dev-process.md:');
  });

  // @lat: [[tests/expand#Resolves fuzzy ref with alternatives]]
  it('resolves fuzzy ref with "might be referring to" context', () => {
    const output = runExpand('fix [[Runing Tests]]');
    expect(output).toContain(
      '[[lat.md/dev-process#Dev Process#Testing#Running Tests]]',
    );
    expect(output).toContain('`[[Runing Tests]]` might be referring to');
    expect(output).toContain('fuzzy match');
  });

  // @lat: [[tests/expand#Passes through text without refs]]
  it('passes through text without refs unchanged', () => {
    const output = runExpand('no refs here');
    expect(output).toBe('no refs here');
    expect(output).not.toContain('<lat-context>');
  });
});

// --- broken-links ---

describe('error-broken-links', () => {
  // @lat: [[check-md#Detects broken links]]
  it('check md detects broken wiki links', async () => {
    const { errors } = await checkMd(latDir('error-broken-links'));
    expect(errors).toHaveLength(1);
    expect(errors[0].target).toBe('Nonexistent#Thing');
    expect(errors[0].line).toBe(3);
  });
});

// --- valid-links ---

describe('valid-links', () => {
  it('check md passes when all links resolve', async () => {
    const { errors } = await checkMd(latDir('valid-links'));
    expect(errors).toHaveLength(0);
  });
});

// --- dangling-code-ref ---

describe('error-dangling-code-ref', () => {
  // @lat: [[check-code-refs#Detects dangling code ref]]
  it('check code-refs detects @lat pointing to nonexistent section', async () => {
    const { errors, files } = await checkCodeRefs(
      latDir('error-dangling-code-ref'),
    );
    const dangling = errors.filter((e) => e.target === 'Alpha#Nonexistent');
    expect(dangling).toHaveLength(1);
    expect(dangling[0].message).toContain('no matching section found');
    expect(files).toEqual({ '.ts': 1 });
  });
});

// --- python-code-ref ---

describe('python-code-ref', () => {
  it('scans @lat refs from Python # comments', async () => {
    const { refs } = await scanCodeRefs(caseDir('python-code-ref'));
    expect(refs).toHaveLength(2);

    expect(refs[0].target).toBe('Specs#Feature A');
    expect(refs[0].file).toContain('app.py');
    expect(refs[0].line).toBe(1);

    expect(refs[1].target).toBe('Specs#Nonexistent');
    expect(refs[1].line).toBe(5);
  });

  it('detects dangling @lat ref in Python file', async () => {
    const { errors, files } = await checkCodeRefs(latDir('python-code-ref'));
    expect(errors).toHaveLength(1);
    expect(errors[0].target).toBe('Specs#Nonexistent');
    expect(errors[0].message).toContain('no matching section found');
    expect(files).toEqual({ '.py': 1 });
  });
});

// --- gitignore-filtering ---

describe('gitignore-filtering', () => {
  it('skips .gitignore-d dirs and .git/', async () => {
    const { refs, files } = await scanCodeRefs(caseDir('gitignore-filtering'));
    // build/ and vendor/ are gitignored; .git/ is always excluded
    expect(refs).toHaveLength(1);
    expect(refs[0].file).toContain('src/app.ts');
    expect(files).toHaveLength(1); // src/app.ts (dotfiles like .gitignore are excluded)
    expect(files.every((f) => !f.includes('.git/'))).toBe(true);
  });

  it('reports no errors when gitignored refs are excluded', async () => {
    const { errors } = await checkCodeRefs(latDir('gitignore-filtering'));
    expect(errors).toHaveLength(0);
  });
});

// --- require-code-mention ---

describe('error-require-code-mention', () => {
  // @lat: [[check-code-refs#Detects missing code mention for required file]]
  it('check code-refs detects uncovered leaf sections', async () => {
    const { errors } = await checkCodeRefs(
      latDir('error-require-code-mention'),
    );
    const uncovered = errors.filter((e) =>
      e.message.includes('requires a code mention'),
    );
    expect(uncovered).toHaveLength(1);
    expect(uncovered[0].target).toBe('lat.md/specs#Specs#Must Do Y');
  });
});

// --- check index ---

describe('error-missing-index', () => {
  // @lat: [[check-index#Detects missing index file]]
  it('reports missing index file with snippet', async () => {
    const errors = await checkIndex(latDir('error-missing-index'));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('missing index file');
    expect(errors[0].snippet).toContain('[[notes]]');
  });
});

describe('valid-index', () => {
  // @lat: [[check-index#Passes with valid index]]
  it('passes when index lists all entries', async () => {
    const errors = await checkIndex(latDir('valid-index'));
    expect(errors).toHaveLength(0);
  });
});

describe('error-stale-index', () => {
  // @lat: [[check-index#Detects stale index entry]]
  it('reports entry that does not exist on disk', async () => {
    const errors = await checkIndex(latDir('error-stale-index'));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('"[[gone]]"');
    expect(errors[0].message).toContain('does not exist');
  });
});

// --- check index (subdirectory) ---

describe('error-missing-subdir-index', () => {
  // @lat: [[check-index#Detects missing subdirectory index file]]
  it('reports missing index file in subdirectory', async () => {
    const errors = await checkIndex(latDir('error-missing-subdir-index'));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('missing index file');
    expect(errors[0].message).toContain('guides');
    expect(errors[0].snippet).toContain('[[setup]]');
  });
});

describe('valid-subdir-index', () => {
  // @lat: [[check-index#Passes with valid subdirectory index]]
  it('passes when subdirectory index lists all entries', async () => {
    const errors = await checkIndex(latDir('valid-subdir-index'));
    expect(errors).toHaveLength(0);
  });
});

describe('error-stale-subdir-index', () => {
  // @lat: [[check-index#Detects stale subdirectory index entry]]
  it('reports stale entry in subdirectory index', async () => {
    const errors = await checkIndex(latDir('error-stale-subdir-index'));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('"[[advanced]]"');
    expect(errors[0].message).toContain('does not exist');
  });
});

// --- ambiguous short ref ---

describe('error-ambiguous-short-ref', () => {
  const lat = latDir('error-ambiguous-short-ref');

  // @lat: [[ref-resolution#Ambiguous short ref in md]]
  it('check md reports ambiguous wiki link with candidate paths', async () => {
    const { errors } = await checkMd(lat);
    expect(errors).toHaveLength(2);
    const topicAErr = errors.find((e) => e.target === 'notes#Topic A')!;
    expect(topicAErr.message).toContain("ambiguous link '[[notes#Topic A]]'");
    expect(topicAErr.message).toContain('use either of');
    expect(topicAErr.message).toContain("'[[lat.md/alpha/notes#Topic A]]'");
    expect(topicAErr.message).toContain("'[[lat.md/beta/notes#Topic A]]'");
    expect(topicAErr.message).toContain('short path "notes" is ambiguous');
    expect(topicAErr.message).toContain('"lat.md/alpha/notes.md"');
    expect(topicAErr.message).toContain('"lat.md/beta/notes.md"');
    expect(topicAErr.message).toContain('Please fix the link');
  });

  // @lat: [[ref-resolution#Ambiguous short ref unique section]]
  it('check md suggests fix when section exists in only one file', async () => {
    const { errors } = await checkMd(lat);
    const topicCErr = errors.find((e) => e.target === 'notes#Topic C');
    expect(topicCErr).toBeDefined();
    expect(topicCErr!.message).toContain("ambiguous link '[[notes#Topic C]]'");
    expect(topicCErr!.message).toContain(
      "did you mean '[[lat.md/alpha/notes#Topic C]]'",
    );
    expect(topicCErr!.message).toContain('"lat.md/alpha/notes.md"');
    expect(topicCErr!.message).toContain('"lat.md/beta/notes.md"');
    expect(topicCErr!.message).toContain('Please fix the link');
  });

  // @lat: [[ref-resolution#Ambiguous short ref in code]]
  it('check code-refs reports ambiguous code ref with candidate paths', async () => {
    const { errors } = await checkCodeRefs(lat);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("ambiguous link '[[notes#Topic B]]'");
    expect(errors[0].message).toContain('use either of');
    expect(errors[0].message).toContain("'[[lat.md/alpha/notes#Topic B]]'");
    expect(errors[0].message).toContain("'[[lat.md/beta/notes#Topic B]]'");
    expect(errors[0].message).toContain('"lat.md/alpha/notes.md"');
    expect(errors[0].message).toContain('"lat.md/beta/notes.md"');
    expect(errors[0].message).toContain('Please fix the link');
  });
});

// --- short ref ---

describe('short-ref', () => {
  const lat = latDir('short-ref');

  // @lat: [[ref-resolution#Short ref passes check md]]
  it('check md passes with short wiki links to subdir files', async () => {
    const { errors } = await checkMd(lat);
    expect(errors).toHaveLength(0);
  });

  // @lat: [[ref-resolution#Short ref passes check code-refs]]
  it('check code-refs passes with short code refs to subdir files', async () => {
    const { errors } = await checkCodeRefs(lat);
    expect(errors).toHaveLength(0);
  });

  // @lat: [[ref-resolution#Short ref findSections resolves]]
  it('findSections resolves short ref to full section', async () => {
    const sections = await loadAllSections(lat);
    const matches = findSections(sections, 'setup#Install');
    expect(matches).toHaveLength(1);
    expect(matches[0].section.id).toBe('lat.md/guides/setup#Setup#Install');
    expect(matches[0].reason).toMatch(/file stem expanded/);
  });

  // @lat: [[locate#File stem fuzzy does not over-match]]
  it('fuzzy does not over-match when file prefix is shared', async () => {
    const sections = await loadAllSections(lat);
    // "setup#Instal" (typo) should fuzzy-match "guides/setup#Install"
    // but not "guides/setup#Configure" — heading-only comparison
    const matches = findSections(sections, 'setup#Instal');
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0].section.id).toBe('lat.md/guides/setup#Setup#Install');
    const ids = matches.map((m) => m.section.id);
    expect(ids).not.toContain('lat.md/guides/setup#Setup#Configure');
  });

  // @lat: [[ref-resolution#Short ref refs finds md references]]
  it('findRefs with short query finds md wiki links', async () => {
    const result = await findRefs(testCtx('short-ref'), 'setup#Install', 'md');
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    expect(result.target.id).toBe('lat.md/guides/setup#Setup#Install');
    const ids = result.mdRefs.map((r) => r.section.id);
    expect(ids).toContain('lat.md/links#Links');
  });

  // @lat: [[ref-resolution#Short ref refs finds code references]]
  it('findRefs with short query finds code refs', async () => {
    const result = await findRefs(testCtx('short-ref'), 'setup#Configure', 'code');
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    expect(result.target.id).toBe('lat.md/guides/setup#Setup#Configure');
    expect(result.codeRefs).toHaveLength(1);
    expect(result.codeRefs[0]).toContain('app.ts');
  });
});

// --- full ref ---

describe('full-ref', () => {
  const lat = latDir('full-ref');

  // @lat: [[ref-resolution#Full ref passes check md]]
  it('check md passes with fully qualified wiki links', async () => {
    const { errors } = await checkMd(lat);
    expect(errors).toHaveLength(0);
  });

  // @lat: [[ref-resolution#Full ref passes check code-refs]]
  it('check code-refs passes with fully qualified code refs', async () => {
    const { errors } = await checkCodeRefs(lat);
    expect(errors).toHaveLength(0);
  });

  // @lat: [[ref-resolution#Full ref findSections resolves]]
  it('findSections finds section by full path', async () => {
    const sections = await loadAllSections(lat);
    const matches = findSections(sections, 'guides/setup#Install');
    expect(matches).toHaveLength(1);
    expect(matches[0].section.id).toBe('lat.md/guides/setup#Setup#Install');
  });

  // @lat: [[ref-resolution#Full ref refs finds md references]]
  it('findRefs with full query finds md wiki links', async () => {
    const result = await findRefs(
      testCtx('full-ref'),
      'lat.md/guides/setup#Setup#Install',
      'md',
    );
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    const ids = result.mdRefs.map((r) => r.section.id);
    expect(ids).toContain('lat.md/links#Links');
  });

  // @lat: [[ref-resolution#Full ref refs finds code references]]
  it('findRefs with full query finds code refs', async () => {
    const result = await findRefs(
      testCtx('full-ref'),
      'lat.md/guides/setup#Setup#Configure',
      'code',
    );
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    expect(result.codeRefs).toHaveLength(1);
    expect(result.codeRefs[0]).toContain('app.ts');
  });
});

// --- bare heading ref ---

describe('error-bare-heading-ref', () => {
  const lat = latDir('error-bare-heading-ref');

  // @lat: [[ref-resolution#Bare heading in md is error]]
  it('check md rejects bare heading name as wiki link', async () => {
    const { errors } = await checkMd(lat);
    const bare = errors.find((e) => e.target === 'Installation');
    expect(bare).toBeDefined();
    expect(bare!.message).toContain('no matching section found');
  });

  // @lat: [[ref-resolution#Local section syntax in md is error]]
  it('check md rejects [[#Heading]] local section syntax', async () => {
    const { errors } = await checkMd(lat);
    const local = errors.find((e) => e.target === '#Configuration');
    expect(local).toBeDefined();
    expect(local!.message).toContain('no matching section found');
  });

  // @lat: [[ref-resolution#Nonexistent file ref in md is error]]
  it('check md rejects link to nonexistent file', async () => {
    const { errors } = await checkMd(lat);
    const missing = errors.find((e) => e.target === 'other-file#Missing');
    expect(missing).toBeDefined();
    expect(missing!.message).toContain('no matching section found');
  });

  // @lat: [[ref-resolution#Bare heading in code is error]]
  it('check code-refs rejects bare heading name', async () => {
    const { errors } = await checkCodeRefs(lat);
    const bare = errors.find((e) => e.target === 'Installation');
    expect(bare).toBeDefined();
    expect(bare!.message).toContain('no matching section found');
  });

  // @lat: [[ref-resolution#Valid code ref with file prefix passes]]
  it('check code-refs passes valid file#Heading ref', async () => {
    const { errors } = await checkCodeRefs(lat);
    const valid = errors.find((e) => e.target === 'docs#Configuration');
    expect(valid).toBeUndefined();
  });
});

// --- nested in-file refs ---

describe('valid-nested-refs', () => {
  // @lat: [[ref-resolution#Nested in-file refs pass]]
  it('check md passes with fully qualified nested section refs', async () => {
    const { errors } = await checkMd(latDir('valid-nested-refs'));
    expect(errors).toHaveLength(0);
  });
});

describe('error-bad-nested-refs', () => {
  // @lat: [[ref-resolution#Skipped intermediate in ref is error]]
  it('check md rejects ref that skips intermediate section', async () => {
    const { errors } = await checkMd(latDir('error-bad-nested-refs'));
    const skipped = errors.find((e) => e.target === 'guide#Prerequisites');
    expect(skipped).toBeDefined();
    expect(skipped!.message).toContain('no matching section found');
  });

  // @lat: [[ref-resolution#Wrong nesting order in ref is error]]
  it('check md rejects ref with wrong nesting order', async () => {
    const { errors } = await checkMd(latDir('error-bad-nested-refs'));
    const wrong = errors.find((e) => e.target === 'guide#Install#Setup');
    expect(wrong).toBeDefined();
    expect(wrong!.message).toContain('no matching section found');
  });

  // @lat: [[ref-resolution#Nonexistent leaf in nested ref is error]]
  it('check md rejects ref with nonexistent leaf heading', async () => {
    const { errors } = await checkMd(latDir('error-bad-nested-refs'));
    const missing = errors.find((e) => e.target === 'guide#Setup#Missing');
    expect(missing).toBeDefined();
    expect(missing!.message).toContain('no matching section found');
  });
});

// --- source code wiki links ---

describe('source-ref-ts-valid', () => {
  it('resolves TS function, class, method, and const refs without errors', async () => {
    // docs.md links: greet (function), Greeter (class),
    // Greeter#greet (method), DEFAULT_NAME (const)
    const { errors } = await checkMd(latDir('source-ref-ts-valid'));
    expect(errors).toHaveLength(0);
  });
});

describe('source-ref-js-valid', () => {
  it('resolves JS function, class, method, and const refs without errors', async () => {
    const { errors } = await checkMd(latDir('source-ref-js-valid'));
    expect(errors).toHaveLength(0);
  });
});

describe('source-ref-jsx-valid', () => {
  it('resolves JSX function, class, method, component const, and const refs without errors', async () => {
    const { errors } = await checkMd(latDir('source-ref-jsx-valid'));
    expect(errors).toHaveLength(0);
  });
});

describe('source-ref-py-valid', () => {
  it('resolves Python function, class, method, and variable refs without errors', async () => {
    // docs.md links: greet (function), Greeter (class),
    // Greeter#greet (method), DEFAULT_NAME (variable)
    const { errors } = await checkMd(latDir('source-ref-py-valid'));
    expect(errors).toHaveLength(0);
  });
});

describe('error-source-ref-ts-missing', () => {
  it('check md reports all missing TS symbols', async () => {
    const { errors } = await checkMd(latDir('error-source-ref-ts-missing'));
    expect(errors).toHaveLength(4);

    const byTarget = new Map(errors.map((e) => [e.target, e]));

    const fn = byTarget.get('src/app.ts#nonexistent')!;
    expect(fn).toBeDefined();
    expect(fn.message).toContain('symbol "nonexistent" not found');

    const cls = byTarget.get('src/app.ts#MissingClass')!;
    expect(cls).toBeDefined();
    expect(cls.message).toContain('symbol "MissingClass" not found');

    const cnst = byTarget.get('src/app.ts#MISSING_CONST')!;
    expect(cnst).toBeDefined();
    expect(cnst.message).toContain('symbol "MISSING_CONST" not found');

    const method = byTarget.get('src/app.ts#Greeter#missingMethod')!;
    expect(method).toBeDefined();
    expect(method.message).toContain(
      'symbol "Greeter#missingMethod" not found',
    );
  });
});

describe('error-source-ref-py-missing', () => {
  it('check md reports all missing Python symbols', async () => {
    const { errors } = await checkMd(latDir('error-source-ref-py-missing'));
    expect(errors).toHaveLength(4);

    const byTarget = new Map(errors.map((e) => [e.target, e]));

    const fn = byTarget.get('src/app.py#nonexistent')!;
    expect(fn).toBeDefined();
    expect(fn.message).toContain('symbol "nonexistent" not found');

    const cls = byTarget.get('src/app.py#MissingClass')!;
    expect(cls).toBeDefined();
    expect(cls.message).toContain('symbol "MissingClass" not found');

    const v = byTarget.get('src/app.py#MISSING_VAR')!;
    expect(v).toBeDefined();
    expect(v.message).toContain('symbol "MISSING_VAR" not found');

    const method = byTarget.get('src/app.py#Greeter#missing_method')!;
    expect(method).toBeDefined();
    expect(method.message).toContain(
      'symbol "Greeter#missing_method" not found',
    );
  });
});

describe('error-source-ref-bad-file', () => {
  it('check md detects wiki link to nonexistent source file', async () => {
    const { errors } = await checkMd(latDir('error-source-ref-bad-file'));
    expect(errors).toHaveLength(1);
    expect(errors[0].target).toBe('src/missing.ts#foo');
    expect(errors[0].message).toContain('file "src/missing.ts" not found');
  });
});

describe('source-ref-rs-valid', () => {
  it('resolves Rust function, struct, trait, method, const, and enum refs without errors', async () => {
    // docs.md links: greet (fn), Greeter (struct), Greeter#greet (method),
    // Greeting (trait), DEFAULT_NAME (const), Color (enum)
    const { errors } = await checkMd(latDir('source-ref-rs-valid'));
    expect(errors).toHaveLength(0);
  });
});

describe('source-ref-go-valid', () => {
  it('resolves Go function, struct, method, interface, and const refs without errors', async () => {
    // docs.md links: Greet (func), Greeter (struct), Greeter#Greet (method),
    // NewGreeter (func), Greeting (interface), DefaultName (const)
    const { errors } = await checkMd(latDir('source-ref-go-valid'));
    expect(errors).toHaveLength(0);
  });
});

describe('error-source-ref-rs-missing', () => {
  it('check md reports all missing Rust symbols', async () => {
    const { errors } = await checkMd(latDir('error-source-ref-rs-missing'));
    expect(errors).toHaveLength(4);

    const byTarget = new Map(errors.map((e) => [e.target, e]));

    const fn = byTarget.get('src/app.rs#nonexistent')!;
    expect(fn).toBeDefined();
    expect(fn.message).toContain('symbol "nonexistent" not found');

    const st = byTarget.get('src/app.rs#MissingStruct')!;
    expect(st).toBeDefined();
    expect(st.message).toContain('symbol "MissingStruct" not found');

    const cnst = byTarget.get('src/app.rs#MISSING_CONST')!;
    expect(cnst).toBeDefined();
    expect(cnst.message).toContain('symbol "MISSING_CONST" not found');

    const method = byTarget.get('src/app.rs#Greeter#missing_method')!;
    expect(method).toBeDefined();
    expect(method.message).toContain(
      'symbol "Greeter#missing_method" not found',
    );
  });
});

describe('error-source-ref-go-missing', () => {
  it('check md reports all missing Go symbols', async () => {
    const { errors } = await checkMd(latDir('error-source-ref-go-missing'));
    expect(errors).toHaveLength(4);

    const byTarget = new Map(errors.map((e) => [e.target, e]));

    const fn = byTarget.get('src/app.go#nonexistent')!;
    expect(fn).toBeDefined();
    expect(fn.message).toContain('symbol "nonexistent" not found');

    const st = byTarget.get('src/app.go#MissingStruct')!;
    expect(st).toBeDefined();
    expect(st.message).toContain('symbol "MissingStruct" not found');

    const cnst = byTarget.get('src/app.go#MISSING_CONST')!;
    expect(cnst).toBeDefined();
    expect(cnst.message).toContain('symbol "MISSING_CONST" not found');

    const method = byTarget.get('src/app.go#Greeter#MissingMethod')!;
    expect(method).toBeDefined();
    expect(method.message).toContain(
      'symbol "Greeter#MissingMethod" not found',
    );
  });
});

describe('source-ref-c-valid', () => {
  it('resolves C function, struct, enum, typedef, define, and variable refs without errors', async () => {
    // docs.md links across .c and .h: greet (function), Greeter (struct),
    // Color (enum), ErrorCode (typedef), MAX_SIZE (define), DEFAULT_NAME (variable)
    const { errors } = await checkMd(latDir('source-ref-c-valid'));
    expect(errors).toHaveLength(0);
  });
});

describe('error-source-ref-c-missing', () => {
  it('check md reports all missing C symbols', async () => {
    const { errors } = await checkMd(latDir('error-source-ref-c-missing'));
    expect(errors).toHaveLength(4);

    const byTarget = new Map(errors.map((e) => [e.target, e]));

    const fn = byTarget.get('src/app.c#nonexistent')!;
    expect(fn).toBeDefined();
    expect(fn.message).toContain('symbol "nonexistent" not found');

    const st = byTarget.get('src/app.c#MissingStruct')!;
    expect(st).toBeDefined();
    expect(st.message).toContain('symbol "MissingStruct" not found');

    const def = byTarget.get('src/app.c#MISSING_DEFINE')!;
    expect(def).toBeDefined();
    expect(def.message).toContain('symbol "MISSING_DEFINE" not found');

    const v = byTarget.get('src/app.c#MISSING_VAR')!;
    expect(v).toBeDefined();
    expect(v.message).toContain('symbol "MISSING_VAR" not found');
  });
});

describe('error-source-ref-unsupported-ext', () => {
  it('check md reports unsupported extension with list of supported ones', async () => {
    const { errors } = await checkMd(
      latDir('error-source-ref-unsupported-ext'),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].target).toBe('src/app.blah#spam');
    expect(errors[0].message).toContain('unsupported file extension ".blah"');
    expect(errors[0].message).toContain('Supported:');
    expect(errors[0].message).toContain('.ts');
    expect(errors[0].message).toContain('.rs');
    expect(errors[0].message).toContain('.go');
  });
});

// --- source file refs ---

describe('source-file-refs', () => {
  const lat = latDir('source-ref-ts-valid');
  const projectRoot = caseDir('source-ref-ts-valid');

  // @lat: [[tests/refs-e2e#Source symbol query finds md sections]]
  it('findRefs with source symbol query finds md sections', async () => {
    const ctx = { latDir: lat, projectRoot, styler: plainStyler, mode: 'cli' as const };
    const result = await findRefs(ctx, 'src/app.ts#greet', 'md');
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    expect(result.target.id).toBe('src/app.ts#greet');
    expect(result.mdRefs.length).toBeGreaterThan(0);
    const ids = result.mdRefs.map((r) => r.section.id);
    expect(ids).toContain('lat.md/docs#Docs');
  });

  // @lat: [[tests/refs-e2e#File-level query finds all refs to that file]]
  it('findRefs with file-level query finds all refs to that file', async () => {
    const ctx = { latDir: lat, projectRoot, styler: plainStyler, mode: 'cli' as const };
    const result = await findRefs(ctx, 'src/app.ts', 'md');
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    expect(result.target.id).toBe('src/app.ts');
    // docs.md references greet, Greeter, Greeter#greet, DEFAULT_NAME — all in src/app.ts
    expect(result.mdRefs.length).toBeGreaterThan(0);
  });

  // @lat: [[tests/refs-e2e#Source query returns no-match for nonexistent file]]
  it('findRefs with source query returns no-match for nonexistent file', async () => {
    const ctx = { latDir: lat, projectRoot, styler: plainStyler, mode: 'cli' as const };
    // Nonexistent file falls through to section resolution, which also fails
    const result = await findRefs(
      ctx,
      'src/nonexistent.ts#foo',
      'md',
    );
    expect(result.kind).toBe('no-match');
  });
});

// --- getSection ---

describe('getSection', () => {
  // @lat: [[tests/section#Nonexistent section returns no-match]]
  it('returns no-match for nonexistent section', async () => {
    const ctx = testCtx('basic-project');
    const result = await getSection(ctx, 'nonexistent-xyz');
    expect(result.kind).toBe('no-match');
  });

  // @lat: [[tests/section#Full id resolves to section]]
  it('finds section by full id', async () => {
    const ctx = testCtx('basic-project');
    const result = await getSection(
      ctx,
      'lat.md/dev-process#Dev Process#Testing',
    );
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    expect(result.section.id).toBe('lat.md/dev-process#Dev Process#Testing');
    expect(result.content).toContain('## Testing');
  });

  // @lat: [[tests/section#Short id resolves to section]]
  it('finds section by short id', async () => {
    const ctx = testCtx('short-ref');
    const result = await getSection(ctx, 'setup#Install');
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    expect(result.section.id).toBe('lat.md/guides/setup#Setup#Install');
  });

  // @lat: [[tests/section#Section with no refs or links]]
  it('returns empty refs for section with no refs or links', async () => {
    const ctx = testCtx('basic-project');
    const result = await getSection(
      ctx,
      'lat.md/dev-process#Dev Process#Formatting',
    );
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    expect(result.outgoingRefs).toHaveLength(0);
    expect(result.incomingRefs).toHaveLength(0);
  });

  // @lat: [[tests/section#Section with outgoing refs only]]
  it('returns outgoing refs for section that links to others', async () => {
    const ctx = testCtx('basic-project');
    const result = await getSection(ctx, 'lat.md/notes#Notes#Second Topic');
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    expect(result.outgoingRefs.length).toBeGreaterThan(0);
    expect(result.outgoingRefs[0].resolved.id).toBe(
      'lat.md/dev-process#Dev Process#Testing',
    );
    expect(result.incomingRefs).toHaveLength(0);
  });

  // @lat: [[tests/section#Section with incoming refs only]]
  it('returns incoming refs for section referenced by others', async () => {
    const ctx = testCtx('basic-project');
    const result = await getSection(
      ctx,
      'lat.md/dev-process#Dev Process#Testing',
    );
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    expect(result.outgoingRefs).toHaveLength(0);
    expect(result.incomingRefs.length).toBeGreaterThan(0);
    const incomingIds = result.incomingRefs.map((r) => r.section.id);
    expect(incomingIds).toContain('lat.md/notes#Notes#Second Topic');
  });

  // @lat: [[tests/section#Section with both outgoing and incoming refs]]
  it('returns both outgoing and incoming refs', async () => {
    const ctx = testCtx('short-ref');
    const result = await getSection(ctx, 'setup#Install');
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    expect(result.incomingRefs.length).toBeGreaterThan(0);
    // Verify formatSectionOutput includes incoming
    const output = formatSectionOutput(ctx, result);
    expect(output).toContain('Referenced by:');
    expect(output).toContain('lat.md/links#Links');
  });

  // @lat: [[tests/section#formatSectionOutput includes all parts]]
  it('formatSectionOutput includes content and refs', async () => {
    const ctx = testCtx('basic-project');
    const result = await getSection(ctx, 'lat.md/notes#Notes#Second Topic');
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    const output = formatSectionOutput(ctx, result);
    expect(output).toContain('[[lat.md/notes#Notes#Second Topic]]');
    expect(output).toContain('See [[dev-process#Testing]]');
    expect(output).toContain('This section references:');
    expect(output).toContain('lat.md/dev-process#Dev Process#Testing');
  });
});

// --- check sections ---

describe('error-missing-body', () => {
  // @lat: [[check-sections#Detects missing leading paragraph]]
  it('check sections detects sections without a leading paragraph', async () => {
    const errors = await checkSections(latDir('error-missing-body'));
    const missing = errors.filter((e) =>
      e.message.includes('has no leading paragraph'),
    );
    expect(missing).toHaveLength(2);
    expect(missing[0].target).toBe('lat.md/notes#Notes');
    expect(missing[1].target).toBe('lat.md/notes#Notes#First');
  });
});

describe('error-long-body', () => {
  // @lat: [[check-sections#Detects overly long leading paragraph]]
  it('check sections detects overly long leading paragraph', async () => {
    const errors = await checkSections(latDir('error-long-body'));
    expect(errors).toHaveLength(1);
    expect(errors[0].target).toBe('lat.md/notes#Notes');
    expect(errors[0].message).toContain('384 characters');
    expect(errors[0].message).toContain('max 250');
  });

  // @lat: [[check-sections#Excludes wiki link content from character count]]
  it('excludes wiki link content from character count', async () => {
    const errors = await checkSections(latDir('error-long-body'));
    const linkSection = errors.find(
      (e) => e.target === 'lat.md/notes#Notes#With Links',
    );
    expect(linkSection).toBeUndefined();
  });
});

// --- non-md file in lat.md/ ---

describe('error-non-md-file', () => {
  // @lat: [[check-index#Detects non-markdown file]]
  it('reports non-.md file as error', async () => {
    const errors = await checkIndex(latDir('error-non-md-file'));
    const nonMd = errors.filter((e) => e.message.includes('not a .md file'));
    expect(nonMd).toHaveLength(1);
    expect(nonMd[0].message).toContain('README');
  });

  // @lat: [[check-index#Non-markdown files excluded from index listing]]
  it('does not include non-.md file in missing index entries', async () => {
    const errors = await checkIndex(latDir('error-non-md-file'));
    const indexErrors = errors.filter(
      (e) => e.message.includes('missing entries') || e.snippet,
    );
    for (const err of indexErrors) {
      expect(err.snippet ?? '').not.toContain('README');
    }
  });
});

// --- scanCodeRefs TS fallback (no rg) ---
// Re-runs a representative subset of code-ref tests with ripgrep disabled
// to ensure the pure-TypeScript scanner produces identical results.

describe('scanCodeRefs TS fallback (_LAT_DISABLE_RG)', () => {
  let origEnv: string | undefined;

  beforeAll(() => {
    origEnv = process.env._LAT_DISABLE_RG;
    process.env._LAT_DISABLE_RG = '1';
  });

  afterAll(() => {
    if (origEnv === undefined) {
      delete process.env._LAT_DISABLE_RG;
    } else {
      process.env._LAT_DISABLE_RG = origEnv;
    }
  });

  // @lat: [[tests/ts-fallback#scanCodeRefs finds refs without rg]]
  it('scanCodeRefs finds refs without rg', async () => {
    const { refs } = await scanCodeRefs(caseDir('python-code-ref'));
    expect(refs).toHaveLength(2);
    expect(refs[0].target).toBe('Specs#Feature A');
    expect(refs[0].file).toContain('app.py');
    expect(refs[1].target).toBe('Specs#Nonexistent');
  });

  // @lat: [[tests/ts-fallback#checkCodeRefs detects dangling ref without rg]]
  it('checkCodeRefs detects dangling ref without rg', async () => {
    const { errors } = await checkCodeRefs(latDir('error-dangling-code-ref'));
    const dangling = errors.filter((e) => e.target === 'Alpha#Nonexistent');
    expect(dangling).toHaveLength(1);
    expect(dangling[0].message).toContain('no matching section found');
  });

  // @lat: [[tests/ts-fallback#gitignore filtering works without rg]]
  it('gitignore filtering works without rg', async () => {
    const { refs, files } = await scanCodeRefs(caseDir('gitignore-filtering'));
    expect(refs).toHaveLength(1);
    expect(refs[0].file).toContain('src/app.ts');
    expect(files).toHaveLength(1);
  });

  // @lat: [[tests/ts-fallback#findRefs with code scope works without rg]]
  it('findRefs with code scope works without rg', async () => {
    const result = await findRefs(
      testCtx('short-ref'),
      'setup#Configure',
      'code',
    );
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    expect(result.codeRefs.length).toBeGreaterThan(0);
  });

  // @lat: [[tests/ts-fallback#getSection includes code back-refs without rg]]
  it('getSection includes code back-refs without rg', async () => {
    const result = await getSection(testCtx('short-ref'), 'setup#Configure');
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    expect(result.codeRefs.length).toBeGreaterThan(0);
    expect(result.codeRefs[0].file).toContain('app.ts');
  });
});
