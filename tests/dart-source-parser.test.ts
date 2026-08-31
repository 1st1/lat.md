import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Language, Parser } from 'web-tree-sitter';

describe('Dart source grammar', () => {
  // @lat: [[tests/check-md#Passes with valid links#Accepts Dart dot shorthand]]
  it('parses Dart 3.7 dot shorthand without syntax errors', async () => {
    const require = createRequire(import.meta.url);
    const packagePath =
      require.resolve('@repomix/tree-sitter-wasms/package.json');
    await Parser.init();
    const language = await Language.load(
      join(dirname(packagePath), 'out', 'tree-sitter-dart.wasm'),
    );
    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse(
      'enum Color { red }\nclass DotShorthand { Color pick() => .red; }\n',
    );

    expect(tree).not.toBeNull();
    expect(tree?.rootNode.hasError).toBe(false);
    tree?.delete();
  });
});
