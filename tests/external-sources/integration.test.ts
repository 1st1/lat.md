import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { plainStyler, type CmdContext } from '../../src/context.js';
import { checkAllCommand } from '../../src/cli/check.js';
import { expandCommand } from '../../src/cli/expand.js';
import {
  externalAddCommand,
  externalListCommand,
  externalShowCommand,
} from '../../src/cli/external.js';
import { ensureLatLocalConfigIgnored } from '../../src/cli/init.js';
import { refsCommand } from '../../src/cli/refs.js';
import { sectionCommand } from '../../src/cli/section.js';
import { externalCachePaths } from '../../src/external-sources.js';
import {
  createExternalGitFixture,
  createExternalProject,
  TEST_CERT_PATH,
  type ExternalGitFixture,
} from './support.js';
import { rmDirBestEffort } from '../util.js';

describe.sequential('external source commands', () => {
  let fixture: ExternalGitFixture;
  let project: ReturnType<typeof createExternalProject>;
  let ctx: CmdContext;
  const roots: string[] = [];
  const previousCa = process.env.GIT_SSL_CAINFO;

  beforeAll(async () => {
    fixture = await createExternalGitFixture();
    process.env.GIT_SSL_CAINFO = TEST_CERT_PATH;
    project = createExternalProject(fixture, {
      strategy: 'fetch',
      commit: fixture.commit2,
      localPath: fixture.checkout,
      defaultFileExtension: 'md',
      body: 'See [[upstream:guide#Navigation]] for the contract.',
    });
    roots.push(project.root);
    writeFileSync(
      join(project.root, 'app.ts'),
      '// ' + '@lat: [[upstream:guide#Navigation]]\nexport const app = true;\n',
    );
    ctx = {
      latDir: project.latDir,
      projectRoot: project.root,
      styler: plainStyler,
      mode: 'cli',
    };
  }, 30_000);

  afterAll(async () => {
    if (previousCa === undefined) delete process.env.GIT_SSL_CAINFO;
    else process.env.GIT_SSL_CAINFO = previousCa;
    for (const root of roots) rmDirBestEffort(root);
    await fixture.close();
  });

  // @lat: [[tests/external-tests#External Sources#Commands and MCP#Content commands and MCP]]
  it('supports observational management and existing content commands', async () => {
    const cache = externalCachePaths(project.latDir, 'upstream');
    const list = await externalListCommand(ctx, true);
    expect(list.isError).not.toBe(true);
    expect(JSON.parse(list.output)[0]).toMatchObject({
      handle: 'upstream',
      defaultFileExtension: 'md',
      effectiveStrategy: 'local',
      cache: null,
    });
    expect(existsSync(cache.metadata)).toBe(false);

    const show = await externalShowCommand(
      ctx,
      'upstream:guide.md#Navigation',
      false,
    );
    expect(show.output).toContain('Target: upstream:guide#Navigation');
    expect(show.output).toContain('Repository path: docs/guide.md');
    expect(existsSync(cache.metadata)).toBe(false);

    const section = await sectionCommand(ctx, 'upstream:guide#Navigation');
    expect(section.isError).not.toBe(true);
    expect(section.output).toContain('Second version navigation.');
    expect(section.output).toContain('Referenced by Markdown');
    expect(section.output).toContain('Referenced by code');

    const expanded = await expandCommand(
      ctx,
      'Explain [[upstream:guide#Navigation]]',
    );
    expect(expanded.output).toContain('<lat-context>');
    expect(expanded.output).toContain('Second version navigation.');

    const refs = await refsCommand(
      ctx,
      'upstream:guide.md#Navigation',
      'md+code',
    );
    expect(refs.output).toContain('lat.md/lat#Project');
    expect(refs.output).toContain('app.ts:1');

    const checked = await checkAllCommand(ctx, { profile: true });
    expect(checked.isError, checked.output).not.toBe(true);
    expect(checked.output).toContain('parsed external document cache hit');

    await ensureLatLocalConfigIgnored(project.latDir);
    expect(readFileSync(join(project.latDir, '.gitignore'), 'utf8')).toBe(
      'config.local.yaml\n',
    );

    const addProject = createExternalProject(fixture, {
      strategy: 'checkout',
      commit: fixture.commit2,
    });
    roots.push(addProject.root);
    writeFileSync(
      join(addProject.latDir, 'lat.md'),
      '# Add Project\n\nProject before adding a source.\n',
    );
    const add = await externalAddCommand(
      {
        latDir: addProject.latDir,
        projectRoot: addProject.root,
        styler: plainStyler,
        mode: 'cli',
      },
      'added',
      fixture.repoUrl,
      {
        commit: 'v2',
        strategy: 'checkout',
        prefix: 'docs',
        defaultFileExtension: 'md',
      },
    );
    expect(add.isError).not.toBe(true);
    expect(readFileSync(join(addProject.latDir, 'lat.md'), 'utf8')).toBe(
      `---\nlat:\n  external-sources:\n    added:\n      repo: ${fixture.repoUrl}\n      commit: ${fixture.commit2}\n      prefix: docs\n      default-file-extension: md\n      strategy: checkout\n---\n# Add Project\n\nProject before adding a source.\n`,
    );
  }, 30_000);

  it('exposes external metadata and content through MCP', async () => {
    const cliPath = join(
      import.meta.dirname,
      '..',
      '..',
      'dist',
      'src',
      'cli',
      'index.js',
    );
    const transport = new StdioClientTransport({
      command: 'node',
      args: [cliPath, 'mcp'],
      cwd: project.root,
    });
    const client = new Client({ name: 'external-test', version: '0.1' });
    await client.connect(transport);
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names).toContain('lat_external_list');
      expect(names).toContain('lat_external_show');
      const shown = await client.callTool({
        name: 'lat_external_show',
        arguments: { source: 'upstream' },
      });
      expect(
        (shown.content as { type: string; text: string }[])[0].text,
      ).toContain('upstream');
      const section = await client.callTool({
        name: 'lat_section',
        arguments: { query: 'upstream:guide#Navigation' },
      });
      expect(
        (section.content as { type: string; text: string }[])[0].text,
      ).toContain('Second version navigation.');
    } finally {
      await client.close();
    }
  }, 30_000);
});
