import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import type { Section } from './lattice.js';
import {
  Parser,
  Language,
  type Node as SyntaxNode,
  type Tree,
} from 'web-tree-sitter';

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

/** Extension → tree-sitter WASM grammar mapping. This is the single source of
 *  truth for which source file extensions lat supports. */
const grammarMap: Record<string, string> = {
  '.ts': 'tree-sitter-typescript.wasm',
  '.tsx': 'tree-sitter-tsx.wasm',
  '.js': 'tree-sitter-javascript.wasm',
  '.jsx': 'tree-sitter-javascript.wasm',
  '.py': 'tree-sitter-python.wasm',
  '.rs': 'tree-sitter-rust.wasm',
  '.go': 'tree-sitter-go.wasm',
  '.c': 'tree-sitter-c.wasm',
  '.h': 'tree-sitter-c.wasm',
  '.rb': 'tree-sitter-ruby.wasm',
};

/** All source file extensions that lat can parse (derived from grammarMap). */
export const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set(
  Object.keys(grammarMap),
);

async function getLanguage(ext: string): Promise<Language | null> {
  const wasmFile = grammarMap[ext];
  if (!wasmFile) return null;

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

function extractRubySymbols(tree: Tree): SourceSymbol[] {
  const symbols: SourceSymbol[] = [];
  const root = tree.rootNode;

  for (let i = 0; i < root.childCount; i++) {
    const node = root.child(i)!;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    if (node.type === 'method') {
      const name = node.childForFieldName('name')?.text;
      if (name) {
        symbols.push({
          name,
          kind: 'function',
          startLine,
          endLine,
          signature: firstLine(node.text),
        });
      }
    } else if (node.type === 'singleton_method') {
      const name = node.childForFieldName('name')?.text;
      if (name) {
        symbols.push({
          name,
          kind: 'function',
          startLine,
          endLine,
          signature: firstLine(node.text),
        });
      }
    } else if (node.type === 'class') {
      const name = node.childForFieldName('name')?.text;
      if (name) {
        symbols.push({
          name,
          kind: 'class',
          startLine,
          endLine,
          signature: firstLine(node.text),
        });
        const body = node.childForFieldName('body');
        if (body) {
          extractRubyMethods(body, name, symbols);
        }
      }
    } else if (node.type === 'module') {
      const name = node.childForFieldName('name')?.text;
      if (name) {
        symbols.push({
          name,
          kind: 'class',
          startLine,
          endLine,
          signature: firstLine(node.text),
        });
        const body = node.childForFieldName('body');
        if (body) {
          extractRubyMethods(body, name, symbols);
        }
      }
    } else if (node.type === 'assignment') {
      const left = node.childForFieldName('left');
      if (left && left.type === 'constant') {
        symbols.push({
          name: left.text,
          kind: 'const',
          startLine,
          endLine,
          signature: firstLine(node.text),
        });
      }
    }
  }

  return symbols;
}

function extractRubyMethods(
  body: SyntaxNode,
  className: string,
  symbols: SourceSymbol[],
): void {
  for (let i = 0; i < body.namedChildCount; i++) {
    const member = body.namedChild(i)!;
    if (member.type === 'method') {
      const name = member.childForFieldName('name')?.text;
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
    } else if (member.type === 'singleton_method') {
      const name = member.childForFieldName('name')?.text;
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

export async function parseSourceSymbols(
  filePath: string,
  content: string,
): Promise<SourceSymbol[]> {
  const ext = filePath.match(/\.[^.]+$/)?.[0] ?? '';
  const lang = await getLanguage(ext);
  if (!lang) return [];

  const p = await ensureParser();
  p.setLanguage(lang);
  const tree = p.parse(content);
  if (!tree) return [];

  try {
    if (ext === '.py') {
      return extractPySymbols(tree);
    }
    if (ext === '.rs') {
      return extractRustSymbols(tree);
    }
    if (ext === '.go') {
      return extractGoSymbols(tree);
    }
    if (ext === '.c' || ext === '.h') {
      return extractCSymbols(tree);
    }
    if (ext === '.rb') {
      return extractRubySymbols(tree);
    }
    return extractTsSymbols(tree);
  } finally {
    tree.delete();
  }
}

// Per-invocation cache for parsed source symbols, keyed by absolute file path.
// Prevents re-parsing the same file when multiple wiki links reference it
// (e.g. 20+ links to quickjs.c would otherwise parse a 60K-line file 20 times).
const symbolCache = new Map<
  string,
  { symbols: SourceSymbol[]; error?: string }
>();

/** Clear the symbol cache. Call between top-level operations. */
export function clearSymbolCache(): void {
  symbolCache.clear();
}

/**
 * Check whether a source file path (relative to projectRoot) has a given symbol.
 * Used by lat check to validate source code wiki links lazily.
 */
export async function resolveSourceSymbol(
  filePath: string,
  symbolPath: string,
  projectRoot: string,
): Promise<{ found: boolean; symbols: SourceSymbol[]; error?: string }> {
  const absPath = join(projectRoot, filePath);

  let cached = symbolCache.get(absPath);
  if (!cached) {
    let content: string;
    try {
      content = readFileSync(absPath, 'utf-8');
    } catch {
      cached = { symbols: [] };
      symbolCache.set(absPath, cached);
      return { found: false, symbols: [] };
    }

    try {
      const symbols = await parseSourceSymbols(filePath, content);
      cached = { symbols };
    } catch (err) {
      cached = {
        symbols: [],
        error: `failed to parse "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    symbolCache.set(absPath, cached);
  }

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

    if (sym.kind === 'class') {
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
