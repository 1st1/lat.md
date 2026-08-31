import {
  flattenSections,
  type LatFrontmatter,
  type MdLink,
  type Ref,
  type Section,
  type SectionSlugIndex,
} from '../lattice-model.js';
import { scanCodeRefs, type ScanResult } from '../code-refs.js';
import {
  SourceParserRuntime,
  type ResolveSourceSymbolOptions,
  type SourceFileAnalysis,
} from '../source-parser.js';
import {
  createExternalResolver,
  type ExternalResolver,
  type ResolvedExternalContent,
} from '../external-sources.js';
import type { Profiler } from '../profiler.js';
import {
  analyzeMarkdownProject,
  type MarkdownAnalysisExecutor,
  type MarkdownProjectAnalysis,
} from '../project-analysis.js';
import type { MarkdownFileAnalysis } from '../markdown-analysis.js';
import { analyzeMarkdownPath } from '../markdown-analysis-cache.js';
import type { LocalMarkdownDiagnostic } from '../markdown-validation.js';
import type { ExternalDocumentFileAnalysis } from '../external-documents.js';
import type { ParserImportEvent } from '../parser-import.js';

export type CheckSectionIndex = {
  sectionIds: Set<string>;
  fileIndex: Map<string, string[]>;
  slugIndex: SectionSlugIndex;
};

/** Lazy, command-scoped cache shared by every validator in one check run. */
export class CheckRunContext {
  private projectPromise?: Promise<MarkdownProjectAnalysis>;
  private codeRefsPromise?: Promise<ScanResult>;
  private externalResolverPromise?: Promise<ExternalResolver>;
  private reconciledExternalPromise?: Promise<void>;
  private sourceSymbolCacheCleared = false;
  private readonly sourceParserRuntime = new SourceParserRuntime();

  private readonly headingPromises = new Map<string, Promise<Set<string>>>();
  private readonly externalContentPromises = new Map<
    string,
    Promise<ResolvedExternalContent>
  >();
  private readonly sourceLinkErrorPromises = new Map<
    string,
    Promise<string | null>
  >();
  private readonly auxiliaryFilePromises = new Map<
    string,
    Promise<MarkdownFileAnalysis>
  >();

  constructor(
    readonly latticeDir: string,
    readonly projectRoot: string,
    readonly profile?: Profiler,
    readonly executor: MarkdownAnalysisExecutor = 'auto',
  ) {}

  private time<T>(
    label: string,
    work: () => Promise<T>,
    detail?: string,
  ): Promise<T> {
    return this.profile ? this.profile.time(label, work, detail) : work();
  }

  private timeSync<T>(label: string, work: () => T, detail?: string): T {
    return this.profile ? this.profile.timeSync(label, work, detail) : work();
  }

  private recordAnalysis(analysis: MarkdownFileAnalysis): void {
    if (!this.profile) return;
    const detail = analysis.path;
    const timings = analysis.timings;
    this.profile.record('read Markdown file', timings.readMs, detail);
    this.profile.record('hash Markdown file', timings.hashMs, detail);
    if (timings.cacheStatus !== 'disabled') {
      this.profile.record(
        'read parsed Markdown cache',
        timings.cacheReadMs,
        detail,
      );
      this.profile.record(`parsed Markdown cache ${timings.cacheStatus}`, 0);
    }
    if (timings.cacheStatus === 'hit') return;
    this.profile.record('parse Markdown AST', timings.parseMs, detail);
    this.profile.record(
      'extract Markdown sections',
      timings.sectionsMs,
      detail,
    );
    this.profile.record('extract wiki links', timings.refsMs, detail);
    this.profile.record('extract relative links', timings.linksMs, detail);
    this.profile.record(
      'extract Markdown presentation facts',
      timings.paragraphsMs,
      detail,
    );
    this.profile.record(
      'parse code-mention frontmatter',
      timings.frontmatterMs,
      detail,
    );
    this.profile.record(
      'extract directory-index entries',
      timings.indexEntriesMs,
      detail,
    );
    this.profile.record(
      'validate local Markdown facts',
      timings.diagnosticsMs,
      detail,
    );
    if (timings.cacheStatus === 'miss') {
      this.profile.record(
        'write parsed Markdown cache',
        timings.cacheWriteMs,
        detail,
      );
    }
  }

  private recordParserImport(event: ParserImportEvent): void {
    if (!this.profile) return;
    this.profile.record(
      event.imported ? `import ${event.parser}` : `skip ${event.parser} import`,
      event.durationMs,
      event.detail,
    );
  }

  private recordSourceAnalysis(analysis: SourceFileAnalysis): void {
    if (!this.profile) return;
    const detail = analysis.path;
    const timings = analysis.timings;
    this.profile.record('read source file', timings.readMs, detail);
    this.profile.record('hash source file', timings.hashMs, detail);
    if (timings.cacheStatus !== 'disabled') {
      this.profile.record(
        'read parsed source cache',
        timings.cacheReadMs,
        detail,
      );
      this.profile.record(`parsed source cache ${timings.cacheStatus}`, 0);
    }
    if (timings.cacheStatus === 'hit') return;
    this.profile.record('parse source symbols', timings.parseMs, detail);
    if (timings.cacheStatus === 'miss') {
      this.profile.record(
        'write parsed source cache',
        timings.cacheWriteMs,
        detail,
      );
    }
  }

  private recordExternalDocumentAnalysis(
    analysis: ExternalDocumentFileAnalysis,
  ): void {
    if (!this.profile) return;
    const detail = analysis.path;
    const timings = analysis.timings;
    this.profile.record('hash external document', timings.hashMs, detail);
    if (timings.cacheStatus !== 'disabled') {
      this.profile.record(
        'read parsed external document cache',
        timings.cacheReadMs,
        detail,
      );
      this.profile.record(
        `parsed external document cache ${timings.cacheStatus}`,
        0,
      );
    }
    if (timings.cacheStatus === 'hit') return;
    this.profile.record('parse external document', timings.parseMs, detail);
    if (timings.cacheStatus === 'miss') {
      this.profile.record(
        'write parsed external document cache',
        timings.cacheWriteMs,
        detail,
      );
    }
  }

  sourceSymbolOptions(): ResolveSourceSymbolOptions {
    return {
      latDir: this.latticeDir,
      runtime: this.sourceParserRuntime,
      onFileAnalyzed: (analysis) => this.recordSourceAnalysis(analysis),
    };
  }

  clearSourceSymbolCache(): void {
    if (this.sourceSymbolCacheCleared) return;
    this.sourceSymbolCacheCleared = true;
    this.timeSync('clear source-symbol cache', () =>
      this.sourceParserRuntime.clear(),
    );
  }

  project(): Promise<MarkdownProjectAnalysis> {
    this.projectPromise ??= this.time('analyze Markdown project', () =>
      analyzeMarkdownProject(this.latticeDir, this.projectRoot, {
        executor: this.executor,
        onFileAnalyzed: (analysis) => this.recordAnalysis(analysis),
        onParserImport: (event) => this.recordParserImport(event),
      }),
    );
    return this.projectPromise;
  }

  async entries(): Promise<string[]> {
    return (await this.project()).entries;
  }

  async markdownFiles(): Promise<string[]> {
    return (await this.project()).markdownFiles;
  }

  private async file(file: string): Promise<MarkdownFileAnalysis> {
    const analysis = (await this.project()).filesByAbsolutePath.get(file);
    if (analysis) return analysis;

    let auxiliary = this.auxiliaryFilePromises.get(file);
    if (!auxiliary) {
      auxiliary = (async () => {
        const result = await analyzeMarkdownPath(
          file,
          this.latticeDir,
          this.projectRoot,
          true,
          (event) => this.recordParserImport(event),
        );
        this.recordAnalysis(result);
        return result;
      })();
      this.auxiliaryFilePromises.set(file, auxiliary);
    }
    return auxiliary;
  }

  async content(file: string): Promise<string> {
    return (await this.file(file)).content;
  }

  async sections(file: string): Promise<Section[]> {
    return (await this.file(file)).sections;
  }

  async refs(file: string): Promise<Ref[]> {
    return (await this.file(file)).wikiRefs;
  }

  async links(file: string): Promise<MdLink[]> {
    return (await this.file(file)).validationLinks;
  }

  async frontmatter(file: string): Promise<LatFrontmatter> {
    return (await this.file(file)).frontmatter;
  }

  async diagnostics(file: string): Promise<LocalMarkdownDiagnostic[]> {
    return (await this.file(file)).diagnostics;
  }

  async allSections(): Promise<Section[]> {
    return (await this.project()).allSections;
  }

  async sectionIndex(): Promise<CheckSectionIndex> {
    const project = await this.project();
    return {
      sectionIds: new Set(project.sectionIds),
      fileIndex: project.fileIndex,
      slugIndex: project.slugIndex,
    };
  }

  headings(file: string): Promise<Set<string>> {
    let headings = this.headingPromises.get(file);
    if (!headings) {
      headings = (async () => {
        const sections = await this.sections(file);
        return this.timeSync(
          'collect Markdown headings',
          () =>
            new Set(
              flattenSections(sections).map((section) => section.githubSlug!),
            ),
          (await this.file(file)).path,
        );
      })();
      this.headingPromises.set(file, headings);
    }
    return headings;
  }

  codeRefs(): Promise<ScanResult> {
    this.codeRefsPromise ??= this.time(
      'scan project files for @lat references',
      () => scanCodeRefs(this.projectRoot, this.profile),
    );
    return this.codeRefsPromise;
  }

  private loadExternalResolver(): Promise<ExternalResolver> {
    this.externalResolverPromise ??= this.time(
      'load external-source configuration',
      () =>
        createExternalResolver(this.latticeDir, this.projectRoot, {
          onDocumentAnalyzed: (analysis) =>
            this.recordExternalDocumentAnalysis(analysis),
          onParserImport: (event) => this.recordParserImport(event),
        }),
    );
    return this.externalResolverPromise;
  }

  async externalResolver(): Promise<ExternalResolver> {
    const resolver = await this.loadExternalResolver();
    this.reconciledExternalPromise ??= this.time(
      'reconcile external cache',
      () => resolver.reconcile(),
    );
    await this.reconciledExternalPromise;
    return resolver;
  }

  resolveExternal(target: string): Promise<ResolvedExternalContent> {
    let content = this.externalContentPromises.get(target);
    if (!content) {
      content = this.time(
        'resolve external reference',
        async () => (await this.externalResolver()).resolve(target),
        target,
      );
      this.externalContentPromises.set(target, content);
    }
    return content;
  }

  resolveSourceLink(
    target: string,
    resolveLink: () => Promise<string | null>,
  ): Promise<string | null> {
    let error = this.sourceLinkErrorPromises.get(target);
    if (!error) {
      error = this.time('resolve source-code wiki link', resolveLink, target);
      this.sourceLinkErrorPromises.set(target, error);
    }
    return error;
  }
}
