import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import type { Section } from './lattice-model.js';
import {
  PARSER_CACHE_VERSION,
  hashParserContent,
  parsedCachePath,
  parserCacheIdentity,
  readParsedCache,
  writeParsedCache,
  type ParsedCacheEntry,
} from './parser-cache.js';
import {
  Parser,
  Language,
  type Node as SyntaxNode,
  type Tree,
} from 'web-tree-sitter';
import {
  sourceFileExtension,
  type SourceFileExtension,
} from './source-formats.js';

export type SourceSymbol = {
  name: string;
  kind:
    | 'function'
    | 'class'
    | 'const'
    | 'type'
    | 'interface'
    | 'method'
    | 'variable';
  parent?: string;
  startLine: number;
  endLine: number;
  signature: string;
};

export type SourceAnalysisCacheStatus = 'disabled' | 'hit' | 'miss';

export type SourceAnalysisTimings = {
  readMs: number;
  hashMs: number;
  cacheReadMs: number;
  cacheWriteMs: number;
  parseMs: number;
  cacheStatus: SourceAnalysisCacheStatus;
};

export type SourceFileAnalysis = {
  path: string;
  symbols: SourceSymbol[];
  timings: SourceAnalysisTimings;
};

export type AnalyzeSourceSymbolsOptions = {
  identity?: string;
  cache?: boolean;
  readMs?: number;
  runtime?: SourceParserRuntime;
};

export type ResolveSourceSymbolOptions = {
  latDir?: string;
  cache?: boolean;
  onFileAnalyzed?: (analysis: SourceFileAnalysis) => void;
  runtime?: SourceParserRuntime;
};

// Lazy singleton for the parser
let parserReady: Promise<void> | null = null;
let parserInstance: Parser | null = null;

const languages = new Map<string, Language>();

function wasmDir(): string {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve('@repomix/tree-sitter-wasms/package.json');
  return join(dirname(pkgPath), 'out');
}

async function ensureParser(): Promise<Parser> {
  if (!parserReady) {
    parserReady = Parser.init();
  }
  await parserReady;
  if (!parserInstance) {
    parserInstance = new Parser();
  }
  return parserInstance;
}

/** Every supported source extension must declare a tree-sitter grammar. */
const grammarMap = {
  '.c': 'tree-sitter-c.wasm',
  '.dart': 'tree-sitter-dart.wasm',
  '.go': 'tree-sitter-go.wasm',
  '.h': 'tree-sitter-c.wasm',
  '.js': 'tree-sitter-javascript.wasm',
  '.jsx': 'tree-sitter-javascript.wasm',
  '.py': 'tree-sitter-python.wasm',
  '.rs': 'tree-sitter-rust.wasm',
  '.ts': 'tree-sitter-typescript.wasm',
  '.tsx': 'tree-sitter-tsx.wasm',
} satisfies Record<SourceFileExtension, string>;

async function getLanguage(ext: SourceFileExtension): Promise<Language> {
  const wasmFile = grammarMap[ext];

  // Ensure WASM runtime is initialized before loading languages
  await ensureParser();

  if (!languages.has(wasmFile)) {
    const wasmPath = join(wasmDir(), wasmFile);
    const lang = await Language.load(wasmPath);
    languages.set(wasmFile, lang);
  }
  return languages.get(wasmFile)!;
}

function extractName(node: SyntaxNode): string | null {
  const nameNode = node.childForFieldName('name');
  return nameNode ? nameNode.text : null;
}

function extractTsSymbols(tree: Tree): SourceSymbol[] {
  const symbols: SourceSymbol[] = [];
  const root = tree.rootNode;

  for (let i = 0; i < root.childCount; i++) {
    let node = root.child(i)!;

    // Unwrap export_statement to get the inner declaration
    const isExport = node.type === 'export_statement';
    if (isExport) {
      const inner = node.namedChildren.find(
        (c) =>
          c.type === 'function_declaration' ||
          c.type === 'class_declaration' ||
          c.type === 'lexical_declaration' ||
          c.type === 'type_alias_declaration' ||
          c.type === 'interface_declaration' ||
          c.type === 'abstract_class_declaration',
      );
      if (inner) node = inner;
    }

    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    if (
      node.type === 'function_declaration' ||
      node.type === 'generator_function_declaration'
    ) {
      const name = extractName(node);
      if (name) {
        symbols.push({
          name,
          kind: 'function',
          startLine,
          endLine,
          signature: firstLine(node.text),
        });
      }
    } else if (
      node.type === 'class_declaration' ||
      node.type === 'abstract_class_declaration'
    ) {
      const name = extractName(node);
      if (name) {
        symbols.push({
          name,
          kind: 'class',
          startLine,
          endLine,
          signature: firstLine(node.text),
        });
        // Extract methods
        const body = node.childForFieldName('body');
        if (body) {
          extractClassMethods(body, name, symbols);
        }
      }
    } else if (node.type === 'lexical_declaration') {
      // const/let declarations
      for (const decl of node.namedChildren) {
        if (decl.type === 'variable_declarator') {
          const name = extractName(decl);
          if (name) {
            symbols.push({
              name,
              kind: 'const',
              startLine,
              endLine,
              signature: firstLine(node.text),
            });
          }
        }
      }
    } else if (node.type === 'type_alias_declaration') {
      const name = extractName(node);
      if (name) {
        symbols.push({
          name,
          kind: 'type',
          startLine,
          endLine,
          signature: firstLine(node.text),
        });
      }
    } else if (node.type === 'interface_declaration') {
      const name = extractName(node);
      if (name) {
        symbols.push({
          name,
          kind: 'interface',
          startLine,
          endLine,
          signature: firstLine(node.text),
        });
      }
    }
  }

  return symbols;
}

function extractClassMethods(
  body: SyntaxNode,
  className: string,
  symbols: SourceSymbol[],
): void {
  for (let i = 0; i < body.namedChildCount; i++) {
    const member = body.namedChild(i)!;
    if (
      member.type === 'method_definition' ||
      member.type === 'public_field_definition'
    ) {
      const name = extractName(member);
      if (name) {
        symbols.push({
          name,
          kind: 'method',
          parent: className,
          startLine: member.startPosition.row + 1,
          endLine: member.endPosition.row + 1,
          signature: firstLine(member.text),
        });
      }
    }
  }
}

function extractPySymbols(tree: Tree): SourceSymbol[] {
  const symbols: SourceSymbol[] = [];
  const root = tree.rootNode;

  for (let i = 0; i < root.childCount; i++) {
    const node = root.child(i)!;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    // Unwrap decorated_definition to get the inner function/class
    const inner =
      node.type === 'decorated_definition'
        ? node.childForFieldName('definition')
        : node;
    if (!inner) continue;

    if (inner.type === 'function_definition') {
      const name = extractName(inner);
      if (name) {
        symbols.push({
          name,
          kind: 'function',
          startLine,
          endLine,
          signature: firstLine(inner.text),
        });
      }
    } else if (inner.type === 'class_definition') {
      const name = extractName(inner);
      if (name) {
        symbols.push({
          name,
          kind: 'class',
          startLine,
          endLine,
          signature: firstLine(inner.text),
        });
        // Extract methods
        const body = inner.childForFieldName('body');
        if (body) {
          for (let j = 0; j < body.namedChildCount; j++) {
            let member = body.namedChild(j)!;
            // Unwrap decorated methods
            if (member.type === 'decorated_definition') {
              member = member.childForFieldName('definition') ?? member;
            }
            if (member.type === 'function_definition') {
              const methodName = extractName(member);
              if (methodName) {
                symbols.push({
                  name: methodName,
                  kind: 'method',
                  parent: name,
                  startLine: member.startPosition.row + 1,
                  endLine: member.endPosition.row + 1,
                  signature: firstLine(member.text),
                });
              }
            }
          }
        }
      }
    } else if (
      inner.type === 'expression_statement' &&
      inner.namedChildCount === 1 &&
      inner.namedChild(0)!.type === 'assignment'
    ) {
      // Top-level assignment: FOO = ...
      const assign = inner.namedChild(0)!;
      const left = assign.childForFieldName('left');
      if (left && left.type === 'identifier') {
        symbols.push({
          name: left.text,
          kind: 'variable',
          startLine,
          endLine,
          signature: firstLine(node.text),
        });
      }
    }
  }

  return symbols;
}

function dartDirectChild(node: SyntaxNode, type: string): SyntaxNode | null {
  return node.namedChildren.find((child) => child.type === type) ?? null;
}

function dartDefinitionName(node: SyntaxNode): string | null {
  const fieldName = extractName(node);
  if (fieldName) return fieldName;

  if (node.type === 'class_definition') {
    const alias = dartDirectChild(node, 'mixin_application_class');
    return alias ? (dartDirectChild(alias, 'identifier')?.text ?? null) : null;
  }
  if (node.type === 'type_alias') {
    return dartDirectChild(node, 'type_identifier')?.text ?? null;
  }
  return dartDirectChild(node, 'identifier')?.text ?? null;
}

function dartCallableNode(node: SyntaxNode): SyntaxNode | null {
  if (node.type !== 'method_signature' && node.type !== 'declaration') {
    return node;
  }
  return (
    node.namedChildren.find((child) =>
      [
        'constructor_signature',
        'factory_constructor_signature',
        'function_signature',
        'getter_signature',
        'operator_signature',
        'redirecting_factory_constructor_signature',
        'setter_signature',
      ].includes(child.type),
    ) ?? null
  );
}

function dartCallableName(node: SyntaxNode, parent?: string): string | null {
  const callable = dartCallableNode(node);
  if (!callable) return null;

  if (callable.type === 'operator_signature') {
    const operator = callable.namedChildren.find((child) =>
      child.type.endsWith('_operator'),
    );
    return operator ? `operator ${operator.text}` : null;
  }

  if (
    callable.type === 'constructor_signature' ||
    callable.type === 'factory_constructor_signature' ||
    callable.type === 'redirecting_factory_constructor_signature'
  ) {
    const names = callable.namedChildren
      .filter((child) => child.type === 'identifier')
      .map((child) => child.text);
    if (names.length === 0) return null;
    if (names.length === 1) return names[0];
    return names[0] === parent ? names[1] : names.at(-1)!;
  }

  return extractName(callable);
}

function dartAnnotatedStart(
  siblings: readonly SyntaxNode[],
  index: number,
): SyntaxNode {
  let start = siblings[index];
  for (let i = index - 1; i >= 0 && siblings[i].type === 'annotation'; i--) {
    start = siblings[i];
  }
  return start;
}

function dartDefinitionEnd(
  siblings: readonly SyntaxNode[],
  index: number,
): SyntaxNode {
  return siblings[index + 1]?.type === 'function_body'
    ? siblings[index + 1]
    : siblings[index];
}

function dartSignature(
  sourceLines: readonly string[],
  node: SyntaxNode,
): string {
  return sourceLines[node.startPosition.row]?.trim() ?? '';
}

function pushDartSymbol(
  sourceLines: readonly string[],
  symbols: SourceSymbol[],
  name: string,
  kind: SourceSymbol['kind'],
  node: SyntaxNode,
  options: {
    parent?: string;
    start?: SyntaxNode;
    end?: SyntaxNode;
  } = {},
): void {
  symbols.push({
    name,
    kind,
    ...(options.parent ? { parent: options.parent } : {}),
    startLine: (options.start ?? node).startPosition.row + 1,
    endLine: (options.end ?? node).endPosition.row + 1,
    signature: dartSignature(sourceLines, node),
  });
}

function dartVariableKind(
  siblings: readonly SyntaxNode[],
  index: number,
  container?: SyntaxNode,
): SourceSymbol['kind'] {
  if (
    container?.namedChildren.some((child) => child.type === 'const_builtin')
  ) {
    return 'const';
  }
  const row = siblings[index].startPosition.row;
  for (let i = index - 1; i >= 0 && siblings[i].endPosition.row === row; i--) {
    if (siblings[i].type === 'const_builtin') return 'const';
  }
  return 'variable';
}

function extractDartVariables(
  sourceLines: readonly string[],
  symbols: SourceSymbol[],
  node: SyntaxNode,
  kind: SourceSymbol['kind'],
  parent?: string,
): void {
  const lists =
    node.type === 'initialized_identifier_list' ||
    node.type === 'static_final_declaration_list'
      ? [node]
      : node.namedChildren.filter(
          (child) =>
            child.type === 'initialized_identifier_list' ||
            child.type === 'static_final_declaration_list',
        );

  for (const list of lists) {
    for (const declaration of list.namedChildren) {
      if (
        declaration.type !== 'initialized_identifier' &&
        declaration.type !== 'static_final_declaration'
      ) {
        continue;
      }
      const name = dartDirectChild(declaration, 'identifier')?.text;
      if (name) {
        pushDartSymbol(sourceLines, symbols, name, kind, node, { parent });
      }
    }
  }
}

function extractDartMembers(
  sourceLines: readonly string[],
  body: SyntaxNode,
  parent: string,
  symbols: SourceSymbol[],
): void {
  const children = body.namedChildren;
  for (let i = 0; i < children.length; i++) {
    const node = children[i];

    if (node.type === 'method_signature') {
      const name = dartCallableName(node, parent);
      if (name) {
        pushDartSymbol(sourceLines, symbols, name, 'method', node, {
          parent,
          start: dartAnnotatedStart(children, i),
          end: dartDefinitionEnd(children, i),
        });
      }
    } else if (node.type === 'declaration') {
      const name = dartCallableName(node, parent);
      if (name) {
        pushDartSymbol(sourceLines, symbols, name, 'method', node, { parent });
      }
      extractDartVariables(
        sourceLines,
        symbols,
        node,
        dartVariableKind(children, i, node),
        parent,
      );
    } else if (node.type === 'enum_constant') {
      const name = extractName(node);
      if (name) {
        pushDartSymbol(sourceLines, symbols, name, 'const', node, { parent });
      }
    }
  }
}

function extractDartSymbols(tree: Tree): SourceSymbol[] {
  const symbols: SourceSymbol[] = [];
  const children = tree.rootNode.namedChildren;
  const sourceLines = tree.rootNode.text.split('\n');

  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    const start = dartAnnotatedStart(children, i);

    if (
      node.type === 'function_signature' ||
      node.type === 'getter_signature' ||
      node.type === 'setter_signature'
    ) {
      const name = dartCallableName(node);
      if (name) {
        pushDartSymbol(sourceLines, symbols, name, 'function', node, {
          start,
          end: dartDefinitionEnd(children, i),
        });
      }
    } else if (node.type === 'class_definition') {
      const name = dartDefinitionName(node);
      if (!name) continue;
      pushDartSymbol(sourceLines, symbols, name, 'class', node, { start });
      const body = node.childForFieldName('body');
      if (body) extractDartMembers(sourceLines, body, name, symbols);
    } else if (node.type === 'mixin_declaration') {
      const name = dartDefinitionName(node);
      if (!name) continue;
      pushDartSymbol(sourceLines, symbols, name, 'interface', node, { start });
      const body = dartDirectChild(node, 'class_body');
      if (body) extractDartMembers(sourceLines, body, name, symbols);
    } else if (node.type === 'extension_declaration') {
      const name = extractName(node);
      if (!name) continue;
      pushDartSymbol(sourceLines, symbols, name, 'class', node, { start });
      const body = node.childForFieldName('body');
      if (body) extractDartMembers(sourceLines, body, name, symbols);
    } else if (node.type === 'enum_declaration') {
      const name = extractName(node);
      if (!name) continue;
      pushDartSymbol(sourceLines, symbols, name, 'class', node, { start });
      const body = node.childForFieldName('body');
      if (body) extractDartMembers(sourceLines, body, name, symbols);
    } else if (node.type === 'extension_type_declaration') {
      const name = extractName(node);
      if (!name) continue;
      pushDartSymbol(sourceLines, symbols, name, 'type', node, { start });
      const representation = node.childForFieldName('representation');
      const representationName = representation?.childForFieldName('name');
      if (representation && representationName) {
        pushDartSymbol(
          sourceLines,
          symbols,
          representationName.text,
          'variable',
          representation,
          { parent: name },
        );
      }
      const body = node.childForFieldName('body');
      if (body) extractDartMembers(sourceLines, body, name, symbols);
    } else if (node.type === 'type_alias') {
      const name = dartDefinitionName(node);
      if (name) {
        pushDartSymbol(sourceLines, symbols, name, 'type', node, { start });
      }
    } else if (
      node.type === 'initialized_identifier_list' ||
      node.type === 'static_final_declaration_list'
    ) {
      extractDartVariables(
        sourceLines,
        symbols,
        node,
        dartVariableKind(children, i),
      );
    }
  }

  return symbols;
}

function extractRustSymbols(tree: Tree): SourceSymbol[] {
  const symbols: SourceSymbol[] = [];
  const root = tree.rootNode;

  for (let i = 0; i < root.childCount; i++) {
    const node = root.child(i)!;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    if (node.type === 'function_item') {
      const name = extractName(node);
      if (name) {
        symbols.push({
          name,
          kind: 'function',
          startLine,
          endLine,
          signature: firstLine(node.text),
        });
      }
    } else if (node.type === 'struct_item') {
      const name = extractName(node);
      if (name) {
        symbols.push({
          name,
          kind: 'class',
          startLine,
          endLine,
          signature: firstLine(node.text),
        });
      }
    } else if (node.type === 'enum_item') {
      const name = extractName(node);
      if (name) {
        symbols.push({
          name,
          kind: 'class',
          startLine,
          endLine,
          signature: firstLine(node.text),
        });
      }
    } else if (node.type === 'trait_item') {
      const name = extractName(node);
      if (name) {
        symbols.push({
          name,
          kind: 'interface',
          startLine,
          endLine,
          signature: firstLine(node.text),
        });
      }
    } else if (node.type === 'impl_item') {
      // impl Type { ... } or impl Trait for Type { ... }
      const typeName = node.childForFieldName('type')?.text;
      if (!typeName) continue;
      const body = node.childForFieldName('body');
      if (!body) continue;
      for (let j = 0; j < body.namedChildCount; j++) {
        const member = body.namedChild(j)!;
        if (member.type === 'function_item') {
          const name = extractName(member);
          if (name) {
            symbols.push({
              name,
              kind: 'method',
              parent: typeName,
              startLine: member.startPosition.row + 1,
              endLine: member.endPosition.row + 1,
              signature: firstLine(member.text),
            });
          }
        }
      }
    } else if (node.type === 'const_item') {
      const name = extractName(node);
      if (name) {
        symbols.push({
          name,
          kind: 'const',
          startLine,
          endLine,
          signature: firstLine(node.text),
        });
      }
    } else if (node.type === 'static_item') {
      const name = extractName(node);
      if (name) {
        symbols.push({
          name,
          kind: 'variable',
          startLine,
          endLine,
          signature: firstLine(node.text),
        });
      }
    } else if (node.type === 'type_item') {
      const name = extractName(node);
      if (name) {
        symbols.push({
          name,
          kind: 'type',
          startLine,
          endLine,
          signature: firstLine(node.text),
        });
      }
    }
  }

  return symbols;
}

/**
 * Extract the receiver type name from a Go method declaration's receiver node.
 * Handles both value receivers (Greeter) and pointer receivers (*Greeter).
 */
function goReceiverType(receiverNode: SyntaxNode): string | null {
  const param = receiverNode.namedChild(0);
  if (!param) return null;
  const typeNode = param.childForFieldName('type');
  if (!typeNode) return null;
  // pointer_type -> child is the actual type name
  if (typeNode.type === 'pointer_type') {
    return typeNode.namedChild(0)?.text ?? null;
  }
  return typeNode.text;
}

function extractGoSymbols(tree: Tree): SourceSymbol[] {
  const symbols: SourceSymbol[] = [];
  const root = tree.rootNode;

  for (let i = 0; i < root.childCount; i++) {
    const node = root.child(i)!;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    if (node.type === 'function_declaration') {
      const name = extractName(node);
      if (name) {
        symbols.push({
          name,
          kind: 'function',
          startLine,
          endLine,
          signature: firstLine(node.text),
        });
      }
    } else if (node.type === 'method_declaration') {
      const name = extractName(node);
      const receiver = node.childForFieldName('receiver');
      const typeName = receiver ? goReceiverType(receiver) : null;
      if (name && typeName) {
        symbols.push({
          name,
          kind: 'method',
          parent: typeName,
          startLine,
          endLine,
          signature: firstLine(node.text),
        });
      }
    } else if (node.type === 'type_declaration') {
      for (let j = 0; j < node.namedChildCount; j++) {
        const spec = node.namedChild(j)!;
        if (spec.type !== 'type_spec') continue;
        const name = spec.childForFieldName('name')?.text;
        if (!name) continue;
        const typeNode = spec.childForFieldName('type');
        const kind =
          typeNode?.type === 'interface_type' ? 'interface' : 'class';
        symbols.push({
          name,
          kind,
          startLine: spec.startPosition.row + 1,
          endLine: spec.endPosition.row + 1,
          signature: firstLine(node.text),
        });
      }
    } else if (node.type === 'const_declaration') {
      for (let j = 0; j < node.namedChildCount; j++) {
        const spec = node.namedChild(j)!;
        if (spec.type !== 'const_spec') continue;
        const name = spec.childForFieldName('name')?.text;
        if (name) {
          symbols.push({
            name,
            kind: 'const',
            startLine: spec.startPosition.row + 1,
            endLine: spec.endPosition.row + 1,
            signature: firstLine(node.text),
          });
        }
      }
    } else if (node.type === 'var_declaration') {
      for (let j = 0; j < node.namedChildCount; j++) {
        const spec = node.namedChild(j)!;
        if (spec.type !== 'var_spec') continue;
        const name = spec.childForFieldName('name')?.text;
        if (name) {
          symbols.push({
            name,
            kind: 'variable',
            startLine: spec.startPosition.row + 1,
            endLine: spec.endPosition.row + 1,
            signature: firstLine(node.text),
          });
        }
      }
    }
  }

  return symbols;
}

/**
 * Extract the declarator name from a C function_declarator node.
 * Handles plain identifiers and pointer declarators (*name).
 */
function cFuncName(declarator: SyntaxNode): string | null {
  // Unwrap pointer_declarator layers (for functions returning pointers,
  // e.g. `JSRuntime *JS_NewRuntime(void)` → pointer_declarator > function_declarator)
  let node = declarator;
  while (node.type === 'pointer_declarator') {
    const child = node.childForFieldName('declarator');
    if (!child) return null;
    node = child;
  }
  if (node.type === 'function_declarator') {
    const inner = node.childForFieldName('declarator');
    if (!inner) return null;
    if (inner.type === 'identifier') return inner.text;
    if (inner.type === 'pointer_declarator') {
      // *name — dig through pointer layers
      let cur = inner;
      while (cur.type === 'pointer_declarator') {
        const child = cur.childForFieldName('declarator');
        if (!child) return null;
        cur = child;
      }
      return cur.type === 'identifier' ? cur.text : null;
    }
  }
  return null;
}

/**
 * Extract the variable name from a C init_declarator or plain declarator.
 * Handles pointers like `*DEFAULT_NAME = "World"`.
 */
function cVarName(declarator: SyntaxNode): string | null {
  let node = declarator;
  // Unwrap init_declarator to get the declarator part
  if (node.type === 'init_declarator') {
    const inner = node.childForFieldName('declarator');
    if (!inner) return null;
    node = inner;
  }
  // Unwrap array_declarator (e.g. `char js_version[]`)
  if (node.type === 'array_declarator') {
    const inner = node.childForFieldName('declarator');
    if (!inner) return null;
    node = inner;
  }
  if (node.type === 'identifier') return node.text;
  if (node.type === 'pointer_declarator') {
    let cur = node;
    while (cur.type === 'pointer_declarator') {
      const child = cur.childForFieldName('declarator');
      if (!child) return null;
      cur = child;
    }
    return cur.type === 'identifier' ? cur.text : null;
  }
  return null;
}

function extractCSymbols(tree: Tree): SourceSymbol[] {
  const symbols: SourceSymbol[] = [];
  collectCNodes(tree.rootNode, symbols);
  return symbols;
}

/**
 * Walk C AST nodes, collecting symbols. Recurses into preprocessor
 * conditional blocks (ifdef/ifndef/if), linkage specifications
 * (extern "C" { ... }), and declaration lists so that include guards
 * and conditional compilation don't hide declarations.
 *
 * For #if/#ifdef/#ifndef, only the "then" branch is traversed —
 * preproc_else and preproc_elif children are skipped.
 */
function collectCNodes(parent: SyntaxNode, symbols: SourceSymbol[]): void {
  for (let i = 0; i < parent.childCount; i++) {
    const node = parent.child(i)!;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    if (node.type === 'function_definition') {
      const declarator = node.childForFieldName('declarator');
      const name = declarator ? cFuncName(declarator) : null;
      if (name) {
        symbols.push({
          name,
          kind: 'function',
          startLine,
          endLine,
          signature: firstLine(node.text),
        });
      }
    } else if (node.type === 'struct_specifier') {
      const name = extractName(node);
      if (name) {
        symbols.push({
          name,
          kind: 'class',
          startLine,
          endLine,
          signature: firstLine(node.text),
        });
        collectCStructFields(node, name, symbols);
      }
    } else if (node.type === 'enum_specifier') {
      const name = extractName(node);
      if (name) {
        symbols.push({
          name,
          kind: 'class',
          startLine,
          endLine,
          signature: firstLine(node.text),
        });
      }
      collectCEnumMembers(node, symbols, name ?? undefined);
    } else if (node.type === 'type_definition') {
      let declarator = node.childForFieldName('declarator');
      // Unwrap pointer_declarator for pointer typedefs
      // e.g. `typedef struct __JSValue *JSValue;`
      while (declarator?.type === 'pointer_declarator') {
        declarator = declarator.childForFieldName('declarator') ?? null;
      }
      const name =
        declarator?.type === 'type_identifier' ? declarator.text : null;
      if (name) {
        symbols.push({
          name,
          kind: 'type',
          startLine,
          endLine,
          signature: firstLine(node.text),
        });
      }
      for (const child of node.namedChildren) {
        if (child.type === 'enum_specifier') {
          collectCEnumMembers(
            child,
            symbols,
            name ?? extractName(child) ?? undefined,
          );
        } else if (child.type === 'struct_specifier' && name) {
          collectCStructFields(child, name, symbols);
        }
      }
    } else if (node.type === 'declaration') {
      const declarator = node.childForFieldName('declarator');
      // Try as function declaration first (e.g. `void greet(const char *name);`
      // in headers), then fall back to variable.
      const funcName = declarator ? cFuncName(declarator) : null;
      if (funcName) {
        symbols.push({
          name: funcName,
          kind: 'function',
          startLine,
          endLine,
          signature: firstLine(node.text),
        });
      } else {
        const name = declarator ? cVarName(declarator) : null;
        if (name) {
          symbols.push({
            name,
            kind: 'variable',
            startLine,
            endLine,
            signature: firstLine(node.text),
          });
        }
      }
    } else if (
      node.type === 'preproc_def' ||
      node.type === 'preproc_function_def'
    ) {
      const name = extractName(node);
      if (name) {
        symbols.push({
          name,
          kind: 'const',
          startLine,
          endLine,
          signature: firstLine(node.text),
        });
      }
    } else if (
      node.type === 'preproc_ifdef' ||
      node.type === 'preproc_ifndef' ||
      node.type === 'preproc_if'
    ) {
      // Recurse into conditional blocks (then-branch only).
      // preproc_else / preproc_elif children are skipped.
      collectCNodes(node, symbols);
    } else if (
      node.type === 'linkage_specification' ||
      node.type === 'declaration_list'
    ) {
      // extern "C" { ... } wraps declarations in linkage_specification
      // containing a declaration_list — recurse through both.
      collectCNodes(node, symbols);
    } else if (node.type === 'preproc_else' || node.type === 'preproc_elif') {
      // Skip else/elif branches of preprocessor conditionals.
    }
  }
}

function collectCEnumMembers(
  enumSpecifier: SyntaxNode,
  symbols: SourceSymbol[],
  enumName?: string,
): void {
  for (const child of enumSpecifier.namedChildren) {
    if (child.type !== 'enumerator_list') continue;
    for (const enumerator of child.namedChildren) {
      if (enumerator.type !== 'enumerator') continue;
      const name = extractName(enumerator);
      if (!name) continue;
      const sym: SourceSymbol = {
        name,
        kind: 'const',
        startLine: enumerator.startPosition.row + 1,
        endLine: enumerator.endPosition.row + 1,
        signature: firstLine(enumerator.text),
      };
      // Emit without parent (standalone lookup like #GREEN)
      symbols.push(sym);
      // Also emit with parent so #Color#GREEN works
      if (enumName) {
        symbols.push({ ...sym, parent: enumName });
      }
    }
  }
}

/**
 * Extract struct field/member names from a struct_specifier and emit
 * them as symbols with `parent` set to the struct name.
 * Handles plain identifiers, pointers, arrays, bitfields, and
 * anonymous union/struct members (recurses into them).
 */
function collectCStructFields(
  structNode: SyntaxNode,
  structName: string,
  symbols: SourceSymbol[],
): void {
  for (const child of structNode.namedChildren) {
    if (child.type !== 'field_declaration_list') continue;
    collectFieldsFromList(child, structName, symbols);
  }
}

function collectFieldsFromList(
  fieldList: SyntaxNode,
  structName: string,
  symbols: SourceSymbol[],
): void {
  for (const field of fieldList.namedChildren) {
    if (field.type !== 'field_declaration') continue;
    const declarator = field.childForFieldName('declarator');
    if (declarator) {
      const name = cFieldName(declarator);
      if (!name) continue;
      symbols.push({
        name,
        kind: 'variable',
        parent: structName,
        startLine: field.startPosition.row + 1,
        endLine: field.endPosition.row + 1,
        signature: firstLine(field.text),
      });
    } else {
      // Anonymous union/struct member — recurse into its field list
      for (const inner of field.namedChildren) {
        if (
          (inner.type === 'union_specifier' ||
            inner.type === 'struct_specifier') &&
          !extractName(inner)
        ) {
          for (const sub of inner.namedChildren) {
            if (sub.type === 'field_declaration_list') {
              collectFieldsFromList(sub, structName, symbols);
            }
          }
        }
      }
    }
  }
}

/**
 * Extract the field name from a C struct field declarator.
 * Handles field_identifier, pointer_declarator, array_declarator,
 * and bitfield_clause (e.g. `uint8_t extensible : 1`).
 */
function cFieldName(declarator: SyntaxNode): string | null {
  let node = declarator;
  // Unwrap pointer_declarator layers (e.g. `JSShape *shape`)
  while (node.type === 'pointer_declarator') {
    const child = node.childForFieldName('declarator');
    if (!child) return null;
    node = child;
  }
  // Unwrap array_declarator (e.g. `char name[32]`)
  if (node.type === 'array_declarator') {
    const inner = node.childForFieldName('declarator');
    if (!inner) return null;
    node = inner;
  }
  if (node.type === 'field_identifier') return node.text;
  return null;
}

function firstLine(text: string): string {
  const nl = text.indexOf('\n');
  return nl === -1 ? text : text.slice(0, nl);
}

/** Every supported source extension must declare a symbol extractor. */
const symbolExtractors = {
  '.c': extractCSymbols,
  '.dart': extractDartSymbols,
  '.go': extractGoSymbols,
  '.h': extractCSymbols,
  '.js': extractTsSymbols,
  '.jsx': extractTsSymbols,
  '.py': extractPySymbols,
  '.rs': extractRustSymbols,
  '.ts': extractTsSymbols,
  '.tsx': extractTsSymbols,
} satisfies Record<SourceFileExtension, (tree: Tree) => SourceSymbol[]>;

export async function parseSourceSymbols(
  filePath: string,
  content: string,
): Promise<SourceSymbol[]> {
  const ext = sourceFileExtension(filePath);
  if (!ext) return [];
  const lang = await getLanguage(ext);

  const p = await ensureParser();
  p.setLanguage(lang);
  const tree = p.parse(content);
  if (!tree) return [];

  try {
    return symbolExtractors[ext](tree);
  } finally {
    tree.delete();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const sourceSymbolKinds = new Set<SourceSymbol['kind']>([
  'function',
  'class',
  'const',
  'type',
  'interface',
  'method',
  'variable',
]);

function isSourceSymbol(value: unknown): value is SourceSymbol {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === 'string' &&
    typeof value.kind === 'string' &&
    sourceSymbolKinds.has(value.kind as SourceSymbol['kind']) &&
    (value.parent === undefined || typeof value.parent === 'string') &&
    Number.isInteger(value.startLine) &&
    (value.startLine as number) > 0 &&
    Number.isInteger(value.endLine) &&
    (value.endLine as number) >= (value.startLine as number) &&
    typeof value.signature === 'string'
  );
}

function cachedSourceAnalysis(
  entry: ParsedCacheEntry | null,
  contentHash: string,
  identity: string,
  timings: Omit<SourceAnalysisTimings, 'cacheWriteMs' | 'parseMs'>,
): SourceFileAnalysis | null {
  if (
    !entry ||
    entry.version !== PARSER_CACHE_VERSION ||
    entry.contentHash !== contentHash ||
    !isRecord(entry.value) ||
    entry.value.path !== identity ||
    !Array.isArray(entry.value.symbols) ||
    !entry.value.symbols.every(isSourceSymbol)
  ) {
    return null;
  }
  return {
    path: identity,
    symbols: entry.value.symbols,
    timings: {
      ...timings,
      cacheStatus: 'hit',
      cacheWriteMs: 0,
      parseMs: 0,
    },
  };
}

type ResolvedSourceCacheEntry = {
  symbols: SourceSymbol[];
  analysis?: SourceFileAnalysis;
  error?: string;
};

/** Request-scoped owner for in-flight and completed source parser work. */
export class SourceParserRuntime {
  readonly analyses = new Map<string, Promise<SourceFileAnalysis>>();
  readonly symbols = new Map<string, Promise<ResolvedSourceCacheEntry>>();

  clear(): void {
    this.analyses.clear();
    this.symbols.clear();
  }
}

const defaultSourceParserRuntime = new SourceParserRuntime();

/** Return the parser cache path for one project source file. */
export function sourceAnalysisCachePath(
  latDir: string,
  projectRoot: string,
  absolutePath: string,
): string {
  return parsedCachePath(
    latDir,
    parserCacheIdentity(absolutePath, projectRoot),
  );
}

/** Analyze source content through the shared versioned persistent cache. */
export async function analyzeSourceSymbols(
  filePath: string,
  content: string,
  latDir: string,
  options: AnalyzeSourceSymbolsOptions = {},
): Promise<SourceFileAnalysis> {
  const identity = (options.identity ?? filePath)
    .replaceAll('\\', '/')
    .normalize('NFC');
  const hashStarted = performance.now();
  const contentHash = hashParserContent(content);
  const hashMs = performance.now() - hashStarted;
  const cache = options.cache !== false;
  const cachePath = parsedCachePath(latDir, identity);
  const promiseKey = `${cache ? 'cache' : 'direct'}\0${cachePath}\0${contentHash}`;
  const runtime = options.runtime ?? defaultSourceParserRuntime;
  let analysis = runtime.analyses.get(promiseKey);
  if (!analysis) {
    analysis = (async () => {
      const cacheStarted = performance.now();
      const entry = cache ? await readParsedCache(cachePath) : null;
      const cacheReadMs = cache ? performance.now() - cacheStarted : 0;
      const timings = {
        readMs: options.readMs ?? 0,
        hashMs,
        cacheReadMs,
        cacheStatus: cache ? ('miss' as const) : ('disabled' as const),
      };
      const cached = cache
        ? cachedSourceAnalysis(entry, contentHash, identity, timings)
        : null;
      if (cached) return cached;

      const parseStarted = performance.now();
      const symbols = await parseSourceSymbols(filePath, content);
      const result: SourceFileAnalysis = {
        path: identity,
        symbols,
        timings: {
          ...timings,
          cacheWriteMs: 0,
          parseMs: performance.now() - parseStarted,
        },
      };
      if (!cache) return result;

      const writeStarted = performance.now();
      try {
        await writeParsedCache(cachePath, contentHash, result);
      } catch {
        // The cache is a disposable optimization; parsing must work read-only.
      }
      result.timings.cacheWriteMs = performance.now() - writeStarted;
      return result;
    })();
    runtime.analyses.set(promiseKey, analysis);
  }
  return analysis;
}

/** Clear the symbol cache. Call between top-level operations. */
export function clearSymbolCache(): void {
  defaultSourceParserRuntime.clear();
}

/**
 * Check whether a source file path (relative to projectRoot) has a given symbol.
 * Used by lat check to validate source code wiki links lazily.
 */
export async function resolveSourceSymbol(
  filePath: string,
  symbolPath: string,
  projectRoot: string,
  options: ResolveSourceSymbolOptions = {},
): Promise<{ found: boolean; symbols: SourceSymbol[]; error?: string }> {
  const absPath = join(projectRoot, filePath);
  const latDir = options.latDir ?? join(projectRoot, 'lat.md');
  const cacheKey = `${latDir}\0${absPath}`;
  const runtime = options.runtime ?? defaultSourceParserRuntime;
  let cachedPromise = runtime.symbols.get(cacheKey);
  const created = !cachedPromise;
  if (!cachedPromise) {
    cachedPromise = (async () => {
      const readStarted = performance.now();
      let content: string;
      try {
        content = await readFile(absPath, 'utf-8');
      } catch {
        return { symbols: [] };
      }
      const readMs = performance.now() - readStarted;

      try {
        const analysis = await analyzeSourceSymbols(filePath, content, latDir, {
          cache: options.cache,
          identity: parserCacheIdentity(absPath, projectRoot),
          readMs,
          runtime,
        });
        return { symbols: analysis.symbols, analysis };
      } catch (err) {
        return {
          symbols: [],
          error: `failed to parse "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    })();
    runtime.symbols.set(cacheKey, cachedPromise);
  }
  const cached = await cachedPromise;
  if (created && cached.analysis) options.onFileAnalyzed?.(cached.analysis);

  if (cached.error) {
    return { found: false, symbols: cached.symbols, error: cached.error };
  }

  const { symbols } = cached;
  const parts = symbolPath.split('#');

  if (parts.length === 1) {
    // Simple symbol: getConfigDir
    const found = symbols.some((s) => s.name === parts[0] && !s.parent);
    return { found, symbols };
  }

  if (parts.length === 2) {
    // Nested symbol: MyClass#myMethod
    const found = symbols.some(
      (s) => s.name === parts[1] && s.parent === parts[0],
    );
    return { found, symbols };
  }

  return { found: false, symbols };
}

/**
 * Convert source symbols to Section objects for uniform handling.
 */
export function sourceSymbolsToSections(
  symbols: SourceSymbol[],
  filePath: string,
): Section[] {
  const sections: Section[] = [];
  const classMap = new Map<string, Section>();
  const parentNames = new Set(
    symbols.flatMap((symbol) => (symbol.parent ? [symbol.parent] : [])),
  );

  for (const sym of symbols) {
    if (sym.parent) continue; // Handle methods after their class

    const section: Section = {
      id: `${filePath}#${sym.name}`,
      heading: sym.name,
      depth: 1,
      file: filePath,
      filePath,
      children: [],
      startLine: sym.startLine,
      endLine: sym.endLine,
      firstParagraph: sym.signature,
    };
    sections.push(section);

    if (parentNames.has(sym.name)) {
      classMap.set(sym.name, section);
    }
  }

  // Add methods as children
  for (const sym of symbols) {
    if (!sym.parent) continue;

    const parentSection = classMap.get(sym.parent);
    if (!parentSection) continue;

    const section: Section = {
      id: `${filePath}#${sym.parent}#${sym.name}`,
      heading: sym.name,
      depth: 2,
      file: filePath,
      filePath,
      children: [],
      startLine: sym.startLine,
      endLine: sym.endLine,
      firstParagraph: sym.signature,
    };
    parentSection.children.push(section);
  }

  return sections;
}
