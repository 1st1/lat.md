import { describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uiBuildServerCommand } from '../src/cli/ui-build-server.js';
import { plainStyler, type CmdContext } from '../src/context.js';
import { buildVercelOutput } from '../src/view/vercel-build.js';
import { buildVercelServerView } from '../src/view/vercel-server-build.js';

function testContext(projectRoot = process.cwd()): CmdContext {
  return {
    latDir: join(projectRoot, 'lat.md'),
    projectRoot,
    styler: plainStyler,
    mode: 'cli',
  };
}

describe('Vercel UI builds', () => {
  // @lat: [[lat.md/view/specs#View Tests#Selects server deployment targets]]
  it('selects node and Vercel server build targets', async () => {
    const buildNode = vi.fn(async (_ctx: CmdContext, output: string) => ({
      documents: 2,
      outputDir: output,
      sources: 3,
    }));
    const buildVercel = vi.fn(async (_ctx: CmdContext, output: string) => ({
      documents: 5,
      outputDir: output,
      sources: 7,
    }));
    const dependencies = { buildNode, buildVercel };

    await expect(
      uiBuildServerCommand(testContext(), undefined, {}, dependencies),
    ).resolves.toEqual({
      output:
        'Built 2 documents and 3 source views for node at .lat-build/server',
    });
    expect(buildNode).toHaveBeenCalledWith(
      expect.anything(),
      '.lat-build/server',
      {},
    );
    expect(buildVercel).not.toHaveBeenCalled();

    await expect(
      uiBuildServerCommand(
        testContext(),
        undefined,
        { target: 'vercel' },
        dependencies,
      ),
    ).resolves.toEqual({
      output:
        'Built 5 documents and 7 source views for vercel at .vercel/output',
    });
    expect(buildVercel).toHaveBeenCalledWith(
      expect.anything(),
      '.vercel/output',
      {},
    );
  });

  // @lat: [[lat.md/view/specs#View Tests#Builds Vercel output directly]]
  it('separates CDN files from the traced Vercel search function', async () => {
    const buildRoot = mkdtempSync(join(tmpdir(), 'lat-ui-vercel-test-'));
    const artifactDir = join(buildRoot, 'web');
    const outputDir = join(buildRoot, '.vercel', 'output');
    const publicDir = join(artifactDir, 'public', 'project');
    const dataDir = join(artifactDir, 'server-data');
    const dependencyFile = join(
      artifactDir,
      'node_modules',
      'example',
      'index.js',
    );
    mkdirSync(publicDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(artifactDir, 'node_modules', 'example'), {
      recursive: true,
    });
    writeFileSync(join(publicDir, 'index.html'), 'project shell');
    writeFileSync(join(artifactDir, 'public', 'index.html'), 'root shell');
    writeFileSync(join(artifactDir, 'app.mjs'), 'export default () => {}');
    writeFileSync(
      join(dataDir, 'server.json'),
      JSON.stringify({ version: 1, basePath: '/project/', sections: [] }),
    );
    writeFileSync(join(dataDir, 'search-fixture.db'), 'vectors');
    writeFileSync(
      join(dataDir, 'search-index.json'),
      JSON.stringify({ version: 1, file: 'search-fixture.db' }),
    );
    writeFileSync(dependencyFile, 'export default true');

    const traced = [
      'app.mjs',
      'server-data/server.json',
      'node_modules/example/index.js',
    ];
    try {
      const result = await buildVercelOutput(
        artifactDir,
        outputDir,
        {},
        {
          async traceFiles(files, options) {
            expect(files).toEqual([join(artifactDir, 'app.mjs')]);
            expect(options).toMatchObject({
              base: artifactDir,
              processCwd: artifactDir,
              exportsOnly: true,
              conditions: ['node', 'production'],
            });
            return { fileList: new Set(traced), warnings: new Set() };
          },
        },
      );
      expect(result.files).toBe(traced.length + 2);
      expect(result.functionPath).toBe(
        join('functions', 'project', 'api', 'search.func'),
      );
      expect(
        readFileSync(
          join(outputDir, 'static', 'project', 'index.html'),
          'utf8',
        ),
      ).toBe('project shell');
      expect(existsSync(join(outputDir, 'static', 'index.html'))).toBe(true);

      const functionDir = join(outputDir, result.functionPath);
      expect(readFileSync(join(functionDir, 'app.mjs'), 'utf8')).toContain(
        'export default',
      );
      expect(
        readFileSync(
          join(functionDir, 'server-data', 'search-fixture.db'),
          'utf8',
        ),
      ).toBe('vectors');
      expect(
        readFileSync(
          join(functionDir, 'node_modules', 'example', 'index.js'),
          'utf8',
        ),
      ).toContain('export default true');
      expect(
        JSON.parse(
          readFileSync(
            join(functionDir, 'server-data', 'search-index.json'),
            'utf8',
          ),
        ),
      ).toEqual({ version: 1, file: 'search-fixture.db' });
      expect(existsSync(join(functionDir, 'public'))).toBe(false);
      expect(
        JSON.parse(readFileSync(join(functionDir, '.vc-config.json'), 'utf8')),
      ).toEqual({
        runtime: 'nodejs22.x',
        handler: 'app.mjs',
        launcherType: 'Nodejs',
        shouldAddHelpers: true,
      });

      const config = JSON.parse(
        readFileSync(join(outputDir, 'config.json'), 'utf8'),
      ) as { version: number; routes: unknown[] };
      expect(config.version).toBe(3);
      expect(config.routes).toContainEqual({ handle: 'filesystem' });
      expect(config.routes).toContainEqual({
        src: '/',
        dest: '/index.html',
      });
      expect(config.routes).toContainEqual({
        src: '/(?:.*?/)?assets/.*',
        headers: {
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
        continue: true,
      });

      const targetOutput = join(buildRoot, 'target-output');
      let nodeArtifact = '';
      const targetResult = await buildVercelServerView(
        {
          ...testContext(),
          projectRoot: buildRoot,
          latDir: join(buildRoot, 'lat.md'),
        },
        targetOutput,
        { basePath: '/project' },
        {
          async buildNode(_ctx, output, options) {
            nodeArtifact = output;
            expect(options).toMatchObject({
              basePath: '/project',
              force: false,
            });
            mkdirSync(output, { recursive: true });
            writeFileSync(join(output, 'app.mjs'), 'portable app');
            return { documents: 4, outputDir: output, sources: 6 };
          },
          async installDependencies(artifact) {
            expect(artifact).toBe(nodeArtifact);
            mkdirSync(join(artifact, 'node_modules'), { recursive: true });
            writeFileSync(join(artifact, 'node_modules', 'installed'), 'yes');
          },
          async buildOutput(artifact, output, options) {
            expect(artifact).toBe(nodeArtifact);
            expect(
              readFileSync(join(artifact, 'node_modules', 'installed'), 'utf8'),
            ).toBe('yes');
            expect(output).toBe(targetOutput);
            expect(options.force).toBeUndefined();
            mkdirSync(output, { recursive: true });
            writeFileSync(join(output, 'config.json'), '{"version":3}');
            return {
              files: 10,
              functionPath: join('functions', 'api', 'search.func'),
              outputDir: output,
            };
          },
        },
      );
      expect(targetResult).toEqual({
        documents: 4,
        outputDir: targetOutput,
        sources: 6,
      });
      expect(existsSync(join(targetOutput, 'config.json'))).toBe(true);
      expect(existsSync(nodeArtifact)).toBe(false);
      expect(
        readdirSync(buildRoot).some((name) =>
          name.startsWith('.lat-vercel-server-'),
        ),
      ).toBe(false);

      await expect(
        buildVercelOutput(
          artifactDir,
          outputDir,
          {},
          {
            async traceFiles() {
              throw new Error('existing output should fail before tracing');
            },
          },
        ),
      ).rejects.toThrow(
        `Vercel build output already exists: ${outputDir}. Use force to replace it.`,
      );
      rmSync(join(dataDir, 'search-fixture.db'));
      await expect(
        buildVercelOutput(
          artifactDir,
          outputDir,
          { force: true },
          {
            async traceFiles() {
              return { fileList: new Set(traced), warnings: new Set() };
            },
          },
        ),
      ).rejects.toThrow(/ENOENT/);
      expect(
        existsSync(join(functionDir, 'server-data', 'search-fixture.db')),
      ).toBe(true);
    } finally {
      rmSync(buildRoot, { recursive: true, force: true });
    }
  });
});
