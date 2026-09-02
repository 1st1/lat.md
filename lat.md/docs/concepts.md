# Concepts

Lat is a Markdown knowledge graph whose structure is explicit enough to validate and simple enough for humans and agents to edit directly.

## Vault and sections

A project's `lat.md/` directory is its vault, and every heading is a section with a stable hierarchical id such as `auth#Tokens#Rotation`.

Every directory has a same-named index document. Every section begins with a concise paragraph so search results and agent context always carry its essential meaning.

## Links

Wiki links connect knowledge, repository files, and supported source-code symbols.

```md
[[architecture#Request pipeline]]
[[schema.sql]]
[[src/server.ts#Server#listen]]
```

Ordinary Markdown links remain available for prose navigation and are also checked for broken local destinations.

## Code references and test specs

`@lat:` comments connect implementation back to a section, creating traceable references in both directions.

```ts
// @lat: [[auth#Refresh rotation]]
export function rotateToken() {}
```

Test-spec documents can require every leaf section to have a code reference, turning high-level coverage intent into an enforced invariant.

## Validation and discovery

`lat check` rejects broken links, missing symbols, malformed sections, stale indexes, and uncovered required specs.

`lat search` finds concepts semantically, while `lat locate`, `lat section`, `lat refs`, and [[browser|Lat UI]] provide exact navigation. Parsed Markdown and source facts are cached, so repeated checks remain fast on large repositories.
