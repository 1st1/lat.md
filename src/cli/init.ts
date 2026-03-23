import {
  existsSync,
  cpSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import chalk from 'chalk';
import { findTemplatesDir } from './templates.js';
import {
  readAgentsTemplate,
  readCursorRulesTemplate,
  readPiExtensionTemplate,
  readOpenCodePluginTemplate,
  readSkillTemplate,
} from './gen.js';
import {
  getLlmKey,
  getConfigPath,
  readConfig,
  writeConfig,
} from '../config.js';
import { writeInitMeta, readFileHash, contentHash } from '../init-version.js';
import { getLocalVersion, fetchLatestVersion } from '../version.js';
import { selectMenu, type SelectOption } from './select-menu.js';
import { checklistMenu } from './checklist-menu.js';

async function confirm(
  rl: ReturnType<typeof createInterface>,
  message: string,
): Promise<boolean> {
  while (true) {
    let answer: string;
    try {
      answer = await rl.question(`${message} ${chalk.dim('[Y/n]')} `);
    } catch {
      // Ctrl+C or closed stdin — abort
      console.log('');
      process.exit(130);
    }
    const val = answer.trim().toLowerCase();
    if (val === '' || val === 'y' || val === 'yes') return true;
    if (val === 'n' || val === 'no') return false;
    console.log(chalk.yellow('  Please answer Y or n.'));
  }
}

async function prompt(
  rl: ReturnType<typeof createInterface>,
  message: string,
): Promise<string> {
  try {
    const answer = await rl.question(message);
    return answer.trim();
  } catch {
    console.log('');
    process.exit(130);
  }
}

// ── Binary resolution ────────────────────────────────────────────────

/**
 * Return the loader-related flags from `process.execArgv`, stripping
 * `--eval`/`-e`/`--print`/`-p` and their value arguments (those only
 * appear when the process was started with `node -e`/`-p`).
 */
function loaderExecArgs(): string[] {
  const raw = process.execArgv;
  const args: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (
      raw[i] === '--eval' ||
      raw[i] === '-e' ||
      raw[i] === '--print' ||
      raw[i] === '-p'
    ) {
      i++; // skip the value argument
    } else {
      args.push(raw[i]);
    }
  }
  return args;
}

/**
 * Reconstruct the command prefix used to invoke this process.
 *
 * When running via a compiled JS entry point (e.g. the global `lat` binary),
 * `process.argv[1]` is enough (e.g. `/usr/local/bin/lat`).
 *
 * When running via a TypeScript loader like tsx, the script itself can't be
 * executed directly — we need to replay the same node flags that loaded tsx.
 * We detect this by checking `process.execArgv` for tsx's `--import` loader
 * and reconstruct: `node <execArgv...> <script>`.
 */
function resolveLatBin(): string {
  const script = resolve(process.argv[1]);

  // Not a .ts file — compiled JS or a wrapper script, use as-is.
  if (!script.endsWith('.ts')) return script;

  // Running a .ts file: reconstruct `node <execArgv> <script>` so the
  // same loader (tsx, ts-node, etc.) is used when the command is replayed.
  const node = process.argv[0];
  const execArgs = loaderExecArgs();
  if (execArgs.length > 0) {
    return [node, ...execArgs, script]
      .map((a) => (a.includes(' ') ? `"${a}"` : a))
      .join(' ');
  }

  // .ts file but no special loader flags — best-effort, just return the path
  return script;
}

// ── Command style ───────────────────────────────────────────────────

type LatCommandStyle = 'global' | 'local' | 'npx';

/** Return the lat binary string for the given command style. */
function latBinString(style: LatCommandStyle): string {
  if (style === 'global') return 'lat';
  if (style === 'npx') return 'npx lat.md@latest';
  return resolveLatBin();
}

/** Return the MCP server command descriptor for the given command style. */
function styledMcpCommand(style: LatCommandStyle): {
  command: string;
  args: string[];
} {
  if (style === 'global') return { command: 'lat', args: ['mcp'] };
  if (style === 'npx')
    return { command: 'npx', args: ['lat.md@latest', 'mcp'] };
  return mcpCommand();
}

// ── Claude Code helpers ──────────────────────────────────────────────

/** Derive the hook command prefix for the given command style. */
function latHookCommand(
  style: LatCommandStyle,
  agent: 'claude' | 'cursor',
  event: string,
): string {
  return `${latBinString(style)} hook ${agent} ${event}`;
}

type HookEntry = { hooks?: { type?: string; command?: string }[] };

/** True if any command in this entry looks like it was installed by lat. */
function isLatHookEntry(entry: HookEntry): boolean {
  const bin = resolve(process.argv[1]);
  return (
    entry.hooks?.some(
      (h) =>
        typeof h.command === 'string' &&
        (/\blat\b/.test(h.command) ||
          h.command.includes('hook claude ') ||
          h.command.startsWith(bin + ' ')),
    ) ?? false
  );
}

/**
 * Remove all lat-owned hook entries from settings, then add fresh ones.
 * Preserves any non-lat hooks the user may have configured.
 */
function syncLatHooks(settingsPath: string, style: LatCommandStyle): void {
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    const raw = readFileSync(settingsPath, 'utf-8');
    try {
      settings = JSON.parse(raw);
    } catch (e) {
      throw new Error(`Cannot parse ${settingsPath}: ${(e as Error).message}`);
    }
  }

  if (!settings.hooks || typeof settings.hooks !== 'object') {
    settings.hooks = {};
  }
  const hooks = settings.hooks as Record<string, unknown>;

  // Strip lat-owned entries from ALL event types (cleans up stale events too)
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    const filtered = entries.filter(
      (entry: HookEntry) => !isLatHookEntry(entry),
    );
    if (filtered.length > 0) {
      hooks[event] = filtered;
    } else {
      delete hooks[event];
    }
  }

  // Add fresh hooks for current events
  for (const event of ['UserPromptSubmit', 'Stop']) {
    if (!Array.isArray(hooks[event])) {
      hooks[event] = [];
    }
    (hooks[event] as unknown[]).push({
      hooks: [
        { type: 'command', command: latHookCommand(style, 'claude', event) },
      ],
    });
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
}

function cursorHooksTemplate(style: LatCommandStyle): string {
  return (
    JSON.stringify(
      {
        version: 1,
        hooks: {
          stop: [{ command: latHookCommand(style, 'cursor', 'stop') }],
        },
      },
      null,
      2,
    ) + '\n'
  );
}

// ── Gitignore helper ─────────────────────────────────────────────────

function ensureGitignored(root: string, entry: string): void {
  const gitignorePath = join(root, '.gitignore');
  const gitDir = join(root, '.git');

  // Check if already ignored
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, 'utf-8');
    const lines = content.split('\n').map((l) => l.trim());
    if (lines.includes(entry)) {
      console.log(chalk.green(`  ${entry}`) + ' already in .gitignore');
      return;
    }
  }

  // Skip if the entry is already tracked in git — adding it to .gitignore
  // would have no effect and confuse the user.
  if (existsSync(gitDir)) {
    try {
      const result = execSync(`git ls-files "${entry}"`, {
        cwd: root,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (result.trim().length > 0) {
        console.log(
          chalk.yellow(`  ${entry}`) +
            ' is already checked in to git — skipping .gitignore',
        );
        return;
      }
    } catch {
      console.log(
        chalk.yellow(`  Warning:`) + ' git ls-files failed — skipping check',
      );
    }
  }

  if (existsSync(gitignorePath)) {
    // Append to existing .gitignore
    let content = readFileSync(gitignorePath, 'utf-8');
    if (!content.endsWith('\n')) content += '\n';
    writeFileSync(gitignorePath, content + entry + '\n');
    console.log(chalk.green(`  Added ${entry}`) + ' to .gitignore');
  } else if (existsSync(gitDir)) {
    // Create .gitignore with the entry
    writeFileSync(gitignorePath, entry + '\n');
    console.log(chalk.green(`  Created .gitignore`) + ` with ${entry}`);
  } else {
    console.log(
      chalk.yellow(`  Warning:`) +
        ` could not add ${entry} to .gitignore (not a git repository)`,
    );
  }
}

// ── MCP command detection ────────────────────────────────────────────

/**
 * Derive the MCP server command from the currently running binary.
 * If `lat init` was invoked as `/path/to/lat`, we emit
 * `{ command: "/path/to/lat", args: ["mcp"] }` so the MCP client
 * starts the same binary. When running via tsx, emits
 * `{ command: "node", args: ["--import", "tsx/loader", ..., "script.ts", "mcp"] }`.
 */
function mcpCommand(): { command: string; args: string[] } {
  const script = resolve(process.argv[1]);
  if (!script.endsWith('.ts')) {
    return { command: script, args: ['mcp'] };
  }
  const raw = process.execArgv;
  const execArgs: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (
      raw[i] === '--eval' ||
      raw[i] === '-e' ||
      raw[i] === '--print' ||
      raw[i] === '-p'
    ) {
      i++;
    } else {
      execArgs.push(raw[i]);
    }
  }
  if (execArgs.length > 0) {
    return { command: process.argv[0], args: [...execArgs, script, 'mcp'] };
  }
  return { command: script, args: ['mcp'] };
}

// ── MCP config helpers ───────────────────────────────────────────────

type McpConfig = Record<
  string,
  Record<string, { command: string; args: string[] }>
>;

function hasMcpServer(configPath: string, key: string): boolean {
  if (!existsSync(configPath)) return false;
  try {
    const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
    return !!cfg?.[key]?.lat;
  } catch (err) {
    process.stderr.write(
      `Warning: failed to parse ${configPath}: ${(err as Error).message}\n`,
    );
    return false;
  }
}

function addMcpServer(
  configPath: string,
  key: string,
  style: LatCommandStyle,
): void {
  let cfg: McpConfig = { [key]: {} };
  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf-8');
    try {
      cfg = JSON.parse(raw);
      if (!cfg[key]) cfg[key] = {};
    } catch (e) {
      throw new Error(`Cannot parse ${configPath}: ${(e as Error).message}`);
    }
  }

  cfg[key].lat = styledMcpCommand(style);

  mkdirSync(join(configPath, '..'), { recursive: true });
  writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n');
}

// ── Codex TOML MCP helpers ────────────────────────────────────────────

/**
 * Check whether `.codex/config.toml` already contains an `[mcp_servers.lat]`
 * table.  We use a simple regex match — no TOML parser needed.
 */
function hasCodexMcpServer(configPath: string): boolean {
  if (!existsSync(configPath)) return false;
  try {
    const content = readFileSync(configPath, 'utf-8');
    return /^\[mcp_servers\.lat\]/m.test(content);
  } catch {
    return false;
  }
}

/**
 * Append an `[mcp_servers.lat]` table to `.codex/config.toml`.
 *
 * If the file exists, the block is appended (preserving existing content).
 * If the file doesn't exist, it is created with just the MCP block.
 *
 * The TOML format is intentionally simple — Codex expects:
 *
 * ```toml
 * [mcp_servers.lat]
 * command = "lat"
 * args = ["mcp"]
 * ```
 */
function addCodexMcpServer(configPath: string, style: LatCommandStyle): void {
  const cmd = styledMcpCommand(style);

  // Format args as a TOML inline array of quoted strings
  const argsToml = '[' + cmd.args.map((a) => `"${a}"`).join(', ') + ']';
  const block = `[mcp_servers.lat]\ncommand = "${cmd.command}"\nargs = ${argsToml}\n`;

  mkdirSync(join(configPath, '..'), { recursive: true });

  if (existsSync(configPath)) {
    let content = readFileSync(configPath, 'utf-8');
    if (!content.endsWith('\n')) content += '\n';
    content += '\n' + block;
    writeFileSync(configPath, content);
  } else {
    writeFileSync(configPath, block);
  }
}

// ── Template file helpers ─────────────────────────────────────────────

/**
 * Write a template-generated file, using stored hashes to decide whether
 * to overwrite or prompt the user about local modifications.
 *
 * Returns the hash of the written content, or null if the file was skipped.
 */
async function writeTemplateFile(
  root: string,
  latDir: string,
  relPath: string,
  template: string,
  genTarget: string | null,
  label: string,
  indent: string,
  ask: (message: string) => Promise<boolean>,
): Promise<string | null> {
  const absPath = join(root, relPath);
  const templateHash = contentHash(template);

  if (!existsSync(absPath)) {
    mkdirSync(join(absPath, '..'), { recursive: true });
    writeFileSync(absPath, template);
    console.log(chalk.green(`${indent}Created ${label}`));
    return templateHash;
  }

  // File exists — check if user has modified it
  const currentContent = readFileSync(absPath, 'utf-8');
  const currentHash = contentHash(currentContent);
  const storedHash = readFileHash(latDir, relPath);

  if (currentHash === templateHash) {
    // Already matches the latest template
    console.log(chalk.green(`${indent}${label}`) + ' already up to date');
    return templateHash;
  }

  if (storedHash && currentHash === storedHash) {
    // Unmodified by user — safe to overwrite with new template
    writeFileSync(absPath, template);
    console.log(chalk.green(`${indent}Updated ${label}`));
    return templateHash;
  }

  // User has modified the file — ask whether to overwrite
  console.log(
    chalk.yellow(`${indent}${label}`) +
      ' exists and may contain your own content.',
  );
  if (await ask(`${indent}Overwrite with latest lat template?`)) {
    writeFileSync(absPath, template);
    console.log(chalk.green(`${indent}Updated ${label}`));
    return templateHash;
  }

  console.log(
    genTarget
      ? chalk.dim(`${indent}Kept existing file.`) +
          ' Run ' +
          chalk.cyan(`lat gen ${genTarget}`) +
          ' to see the latest template.'
      : chalk.dim(`${indent}Kept existing file.`) +
          ' Re-run ' +
          chalk.cyan('lat init') +
          ' to regenerate this file.',
  );
  return null;
}

// ── Marker-based append for shared files ─────────────────────────────

const MARKER_BEGIN = '%% lat:begin %%';
const MARKER_END = '%% lat:end %%';

/**
 * Extract the content between lat markers in a file's text.
 * Returns null if markers are not found.
 */
function extractMarkerSection(content: string): string | null {
  const beginIdx = content.indexOf(MARKER_BEGIN);
  const endIdx = content.indexOf(MARKER_END);
  if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) return null;
  return content.slice(beginIdx + MARKER_BEGIN.length + 1, endIdx);
}

/**
 * Wrap template content with lat markers.
 */
function wrapWithMarkers(template: string): string {
  return `${MARKER_BEGIN}\n${template}${template.endsWith('\n') ? '' : '\n'}${MARKER_END}\n`;
}

/**
 * Write a template into a marker-fenced section of a file, preserving
 * any user content outside the markers.
 *
 * Returns the hash of the written template content, or null if skipped.
 */
async function appendTemplateSection(
  root: string,
  latDir: string,
  relPath: string,
  template: string,
  label: string,
  indent: string,
  ask: (message: string) => Promise<boolean>,
): Promise<string | null> {
  const absPath = join(root, relPath);
  const templateHash = contentHash(template);
  const wrapped = wrapWithMarkers(template);

  if (!existsSync(absPath)) {
    mkdirSync(join(absPath, '..'), { recursive: true });
    writeFileSync(absPath, wrapped);
    console.log(chalk.green(`${indent}Created ${label}`));
    return templateHash;
  }

  const currentContent = readFileSync(absPath, 'utf-8');
  const existingSection = extractMarkerSection(currentContent);

  if (existingSection !== null) {
    // File has markers — compare the section content
    const existingSectionHash = contentHash(existingSection);

    if (existingSectionHash === templateHash) {
      console.log(chalk.green(`${indent}${label}`) + ' already up to date');
      return templateHash;
    }

    // Check if section matches stored hash (unmodified by user)
    const storedHash = readFileHash(latDir, relPath);
    if (storedHash && existingSectionHash === storedHash) {
      // User hasn't edited the section — safe to replace
      const beginIdx = currentContent.indexOf(MARKER_BEGIN);
      const endIdx = currentContent.indexOf(MARKER_END) + MARKER_END.length;
      // Include trailing newline if present
      const endWithNl = currentContent[endIdx] === '\n' ? endIdx + 1 : endIdx;
      const updated =
        currentContent.slice(0, beginIdx) +
        wrapped +
        currentContent.slice(endWithNl);
      writeFileSync(absPath, updated);
      console.log(chalk.green(`${indent}Updated ${label}`));
      return templateHash;
    }

    // User edited the section — ask before replacing
    console.log(
      chalk.yellow(`${indent}${label}`) + ' lat section has been modified.',
    );
    if (await ask(`${indent}Replace lat section with latest template?`)) {
      const beginIdx = currentContent.indexOf(MARKER_BEGIN);
      const endIdx = currentContent.indexOf(MARKER_END) + MARKER_END.length;
      const endWithNl = currentContent[endIdx] === '\n' ? endIdx + 1 : endIdx;
      const updated =
        currentContent.slice(0, beginIdx) +
        wrapped +
        currentContent.slice(endWithNl);
      writeFileSync(absPath, updated);
      console.log(chalk.green(`${indent}Updated ${label}`));
      return templateHash;
    }

    console.log(chalk.dim(`${indent}Kept existing section.`));
    return null;
  }

  // No markers — file exists from old init or user-created
  // Check if full file matches stored hash (old full-overwrite init, unedited)
  const currentHash = contentHash(currentContent);
  const storedHash = readFileHash(latDir, relPath);

  if (storedHash && currentHash === storedHash) {
    // Unmodified old-style file — migrate: wrap existing content with markers
    writeFileSync(absPath, wrapWithMarkers(currentContent));
    console.log(
      chalk.green(`${indent}Migrated ${label}`) + ' to marker format',
    );
    // Return hash of what's now in the section (the old content)
    return currentHash;
  }

  // File has user content and no markers — append section
  let content = currentContent;
  if (!content.endsWith('\n')) content += '\n';
  content += '\n' + wrapped;
  writeFileSync(absPath, content);
  console.log(chalk.green(`${indent}Appended lat section to ${label}`));
  return templateHash;
}

// ── Shared skill setup ───────────────────────────────────────────────

async function writeAgentsSkill(
  root: string,
  latDir: string,
  hashes: Record<string, string>,
  ask: (message: string) => Promise<boolean>,
): Promise<void> {
  console.log('');
  console.log(
    chalk.dim(
      '  The lat-md skill teaches the agent how to write and maintain lat.md/ files.',
    ),
  );

  const skillTemplate = readSkillTemplate();
  const skillHash = await writeTemplateFile(
    root,
    latDir,
    '.agents/skills/lat-md/SKILL.md',
    skillTemplate,
    'skill.md',
    'Skill (.agents/skills/lat-md/SKILL.md)',
    '  ',
    ask,
  );
  if (skillHash) hashes['.agents/skills/lat-md/SKILL.md'] = skillHash;
}

// ── Per-agent setup ──────────────────────────────────────────────────

async function setupAgentsMd(
  root: string,
  latDir: string,
  template: string,
  hashes: Record<string, string>,
  ask: (message: string) => Promise<boolean>,
): Promise<void> {
  const hash = await appendTemplateSection(
    root,
    latDir,
    'AGENTS.md',
    template,
    'AGENTS.md',
    '',
    ask,
  );
  if (hash) hashes['AGENTS.md'] = hash;
}

async function setupClaudeCode(
  root: string,
  latDir: string,
  template: string,
  hashes: Record<string, string>,
  ask: (message: string) => Promise<boolean>,
  style: LatCommandStyle,
): Promise<void> {
  // CLAUDE.md — append-mode with markers (preserves user content)
  const hash = await appendTemplateSection(
    root,
    latDir,
    'CLAUDE.md',
    template,
    'CLAUDE.md',
    '  ',
    ask,
  );
  if (hash) hashes['CLAUDE.md'] = hash;

  // Hooks — UserPromptSubmit (lat.md reminders + [[ref]] expansion) and Stop (update reminder)
  console.log('');
  console.log(
    chalk.dim(
      '  Hooks inject lat.md workflow reminders into every prompt and remind',
    ),
  );
  console.log(chalk.dim('  the agent to update lat.md/ before finishing.'));

  const claudeDir = join(root, '.claude');
  const settingsPath = join(claudeDir, 'settings.json');

  mkdirSync(claudeDir, { recursive: true });
  syncLatHooks(settingsPath, style);
  console.log(chalk.green('  Hooks') + ' synced (UserPromptSubmit + Stop)');

  // .claude/skills/lat-md/SKILL.md — skill for authoring lat.md files
  console.log('');
  console.log(
    chalk.dim(
      '  The lat-md skill teaches the agent how to write and maintain lat.md/ files.',
    ),
  );

  const skillTemplate = readSkillTemplate();
  const skillHash = await writeTemplateFile(
    root,
    latDir,
    '.claude/skills/lat-md/SKILL.md',
    skillTemplate,
    'skill.md',
    'Skill (.claude/skills/lat-md/SKILL.md)',
    '  ',
    ask,
  );
  if (skillHash) hashes['.claude/skills/lat-md/SKILL.md'] = skillHash;

  // Ensure .claude is gitignored (settings contain local absolute paths)
  ensureGitignored(root, '.claude');

  // MCP server → .mcp.json at project root
  console.log('');
  console.log(
    chalk.dim(
      '  Agents can call `lat` from the command line, but an MCP server gives lat',
    ),
  );
  console.log(
    chalk.dim(
      '  more visibility and makes agents more likely to use it proactively.',
    ),
  );

  const mcpPath = join(root, '.mcp.json');
  if (hasMcpServer(mcpPath, 'mcpServers')) {
    console.log(chalk.green('  MCP server') + ' already configured');
  } else {
    addMcpServer(mcpPath, 'mcpServers', style);
    console.log(chalk.green('  MCP server') + ' registered in .mcp.json');
  }

  // Ensure .mcp.json is gitignored (it contains local absolute paths)
  ensureGitignored(root, '.mcp.json');
}

async function setupCursor(
  root: string,
  latDir: string,
  hashes: Record<string, string>,
  ask: (message: string) => Promise<boolean>,
  style: LatCommandStyle,
): Promise<void> {
  // .cursor/rules/lat.md
  const hash = await writeTemplateFile(
    root,
    latDir,
    '.cursor/rules/lat.md',
    readCursorRulesTemplate(),
    'cursor-rules.md',
    'Rules (.cursor/rules/lat.md)',
    '  ',
    ask,
  );
  if (hash) hashes['.cursor/rules/lat.md'] = hash;

  // .cursor/hooks.json
  console.log('');
  console.log(
    chalk.dim(
      '  Cursor hooks can enforce the lat.md/ stop check, while prompt guidance',
    ),
  );
  console.log(
    chalk.dim(
      '  stays in rules + MCP because Cursor cannot reliably inject prompt-specific context.',
    ),
  );

  const hooksHash = await writeTemplateFile(
    root,
    latDir,
    '.cursor/hooks.json',
    cursorHooksTemplate(style),
    null,
    'Hooks (.cursor/hooks.json)',
    '  ',
    ask,
  );
  if (hooksHash) hashes['.cursor/hooks.json'] = hooksHash;

  // .cursor/mcp.json
  console.log('');
  console.log(
    chalk.dim(
      '  Agents can call `lat` from the command line, but an MCP server gives lat',
    ),
  );
  console.log(
    chalk.dim(
      '  more visibility and makes agents more likely to use it proactively.',
    ),
  );

  const mcpPath = join(root, '.cursor', 'mcp.json');
  if (hasMcpServer(mcpPath, 'mcpServers')) {
    console.log(chalk.green('  MCP server') + ' already configured');
  } else {
    addMcpServer(mcpPath, 'mcpServers', style);
    console.log(
      chalk.green('  MCP server') + ' registered in .cursor/mcp.json',
    );
  }

  // Ensure .cursor is gitignored (hooks and MCP config may contain local paths)
  ensureGitignored(root, '.cursor');

  // .agents/skills/lat-md/SKILL.md — skill for authoring lat.md files
  await writeAgentsSkill(root, latDir, hashes, ask);

  console.log('');
  console.log(
    chalk.yellow('  Note:') +
      ' Enable MCP in Cursor: Settings → Features → MCP → check "Enable MCP"',
  );
}

async function setupCopilot(
  root: string,
  latDir: string,
  hashes: Record<string, string>,
  ask: (message: string) => Promise<boolean>,
  style: LatCommandStyle,
): Promise<void> {
  // .github/copilot-instructions.md — append-mode with markers
  const hash = await appendTemplateSection(
    root,
    latDir,
    '.github/copilot-instructions.md',
    readAgentsTemplate(),
    'Instructions (.github/copilot-instructions.md)',
    '  ',
    ask,
  );
  if (hash) hashes['.github/copilot-instructions.md'] = hash;

  // .vscode/mcp.json
  console.log('');
  console.log(
    chalk.dim(
      '  Agents can call `lat` from the command line, but an MCP server gives lat',
    ),
  );
  console.log(
    chalk.dim(
      '  more visibility and makes agents more likely to use it proactively.',
    ),
  );

  const mcpPath = join(root, '.vscode', 'mcp.json');
  if (hasMcpServer(mcpPath, 'servers')) {
    console.log(chalk.green('  MCP server') + ' already configured');
  } else {
    addMcpServer(mcpPath, 'servers', style);
    console.log(
      chalk.green('  MCP server') + ' registered in .vscode/mcp.json',
    );
  }

  // .agents/skills/lat-md/SKILL.md — skill for authoring lat.md files
  await writeAgentsSkill(root, latDir, hashes, ask);
}

async function setupPi(
  root: string,
  latDir: string,
  hashes: Record<string, string>,
  ask: (message: string) => Promise<boolean>,
  style: LatCommandStyle,
): Promise<void> {
  // AGENTS.md — Pi reads this natively
  // (already created in the shared step if any non-Claude agent is selected)

  // .pi/extensions/lat.ts — extension that registers tools + lifecycle hooks
  console.log('');
  console.log(
    chalk.dim(
      '  The Pi extension registers lat tools and hooks into the agent lifecycle',
    ),
  );
  console.log(
    chalk.dim(
      '  to inject search context and validate lat.md/ before finishing.',
    ),
  );

  const template = readPiExtensionTemplate().replace(
    '__LAT_BIN__',
    latBinString(style),
  );

  const hash = await writeTemplateFile(
    root,
    latDir,
    '.pi/extensions/lat.ts',
    template,
    'pi-extension.ts',
    'Extension (.pi/extensions/lat.ts)',
    '  ',
    ask,
  );
  if (hash) hashes['.pi/extensions/lat.ts'] = hash;

  // .pi/skills/lat-md/SKILL.md — skill for authoring lat.md files
  console.log('');
  console.log(
    chalk.dim(
      '  The lat-md skill teaches the agent how to write and maintain lat.md/ files.',
    ),
  );

  const skillTemplate = readSkillTemplate();
  const skillHash = await writeTemplateFile(
    root,
    latDir,
    '.pi/skills/lat-md/SKILL.md',
    skillTemplate,
    'skill.md',
    'Skill (.pi/skills/lat-md/SKILL.md)',
    '  ',
    ask,
  );
  if (skillHash) hashes['.pi/skills/lat-md/SKILL.md'] = skillHash;

  // Ensure .pi is gitignored (extension contains local absolute paths)
  ensureGitignored(root, '.pi');
}

async function setupOpenCode(
  root: string,
  latDir: string,
  hashes: Record<string, string>,
  ask: (message: string) => Promise<boolean>,
  style: LatCommandStyle,
): Promise<void> {
  // AGENTS.md — OpenCode reads this natively
  // (already created in the shared step if any non-Claude agent is selected)

  // .opencode/plugins/lat.ts — plugin that registers tools + lifecycle hooks
  console.log('');
  console.log(
    chalk.dim(
      '  The OpenCode plugin registers lat tools and hooks into the session',
    ),
  );
  console.log(
    chalk.dim('  lifecycle to validate lat.md/ when the agent finishes.'),
  );

  const template = readOpenCodePluginTemplate().replace(
    '__LAT_BIN__',
    latBinString(style),
  );

  const hash = await writeTemplateFile(
    root,
    latDir,
    '.opencode/plugins/lat.ts',
    template,
    'opencode-plugin.ts',
    'Plugin (.opencode/plugins/lat.ts)',
    '  ',
    ask,
  );
  if (hash) hashes['.opencode/plugins/lat.ts'] = hash;

  // .agents/skills/lat-md/SKILL.md — skill for authoring lat.md files
  await writeAgentsSkill(root, latDir, hashes, ask);

  // Ensure .opencode is gitignored (plugin contains local absolute paths)
  ensureGitignored(root, '.opencode');
}

async function setupCodex(
  root: string,
  latDir: string,
  hashes: Record<string, string>,
  ask: (message: string) => Promise<boolean>,
  style: LatCommandStyle,
): Promise<void> {
  // AGENTS.md — Codex reads this natively
  // (already created in the shared step if any non-Claude agent is selected)

  // .codex/config.toml — MCP server registration
  console.log('');
  console.log(
    chalk.dim(
      '  Agents can call `lat` from the command line, but an MCP server gives lat',
    ),
  );
  console.log(
    chalk.dim(
      '  more visibility and makes agents more likely to use it proactively.',
    ),
  );

  const mcpPath = join(root, '.codex', 'config.toml');
  if (hasCodexMcpServer(mcpPath)) {
    console.log(chalk.green('  MCP server') + ' already configured');
  } else {
    addCodexMcpServer(mcpPath, style);
    console.log(
      chalk.green('  MCP server') + ' registered in .codex/config.toml',
    );
  }

  // Ensure .codex is gitignored (config contains local absolute paths)
  ensureGitignored(root, '.codex');

  // .agents/skills/lat-md/SKILL.md — skill for authoring lat.md files
  await writeAgentsSkill(root, latDir, hashes, ask);

  // .codex/skills/lat-md/SKILL.md — Codex-specific skills directory
  console.log('');
  console.log(
    chalk.dim(
      '  The lat-md skill teaches the agent how to write and maintain lat.md/ files.',
    ),
  );

  const skillTemplate = readSkillTemplate();
  const skillHash = await writeTemplateFile(
    root,
    latDir,
    '.codex/skills/lat-md/SKILL.md',
    skillTemplate,
    'skill.md',
    'Skill (.codex/skills/lat-md/SKILL.md)',
    '  ',
    ask,
  );
  if (skillHash) hashes['.codex/skills/lat-md/SKILL.md'] = skillHash;
}

// ── LLM key setup ───────────────────────────────────────────────────

async function setupLlmKey(
  rl: ReturnType<typeof createInterface> | null,
): Promise<void> {
  // Use the centralized key resolution (env var → file → helper → config)
  const existingKey = getLlmKey();
  if (existingKey) {
    console.log('');
    console.log(chalk.green('Semantic search') + ' — LLM key found. Ready.');
    return;
  }

  // No key found — explain what semantic search is and prompt
  console.log('');
  console.log(chalk.bold('Semantic search'));
  console.log('');
  console.log(
    '  lat.md includes semantic search (' +
      chalk.cyan('lat search') +
      ') that lets agents find',
  );
  console.log(
    '  relevant documentation by meaning, not just keywords. This requires an',
  );
  console.log(
    '  embedding API key (OpenAI or Vercel AI Gateway). Without it, agents can still',
  );
  console.log(
    '  use ' +
      chalk.cyan('lat locate') +
      ' for exact lookups, but will miss semantic matches.',
  );
  console.log('');

  // Interactive prompt
  if (!rl) {
    console.log(
      chalk.yellow('  No LLM key found.') +
        ' Set LAT_LLM_KEY env var or run ' +
        chalk.cyan('lat init') +
        ' interactively.',
    );
    return;
  }

  console.log(
    '  You can provide a key now, or skip and set ' +
      chalk.cyan('LAT_LLM_KEY') +
      ' env var later.',
  );
  console.log(
    '  Supported: OpenAI (' +
      chalk.dim('sk-...') +
      ') or Vercel AI Gateway (' +
      chalk.dim('vck_...') +
      ')',
  );
  console.log('');

  const key = await prompt(rl, `  Paste your key (or press Enter to skip): `);

  if (!key) {
    console.log(
      chalk.dim('  Skipped.') +
        ' You can set ' +
        chalk.cyan('LAT_LLM_KEY') +
        ' later or re-run ' +
        chalk.cyan('lat init') +
        '.',
    );
    return;
  }

  // Validate prefix
  if (key.startsWith('sk-ant-')) {
    console.log(
      chalk.red('  That looks like an Anthropic key.') +
        " Anthropic doesn't offer embeddings.",
    );
    console.log(
      '  lat.md needs an OpenAI (' +
        chalk.dim('sk-...') +
        ') or Vercel AI Gateway (' +
        chalk.dim('vck_...') +
        ') key.',
    );
    return;
  }

  if (!key.startsWith('sk-') && !key.startsWith('vck_')) {
    console.log(
      chalk.yellow('  Unrecognized key prefix.') +
        ' Expected sk-... (OpenAI) or vck_... (Vercel AI Gateway).',
    );
    console.log('  Saving anyway — you can update it later.');
  }

  // Save to config
  const updatedConfig = { ...readConfig(), llm_key: key };
  writeConfig(updatedConfig);
  console.log(chalk.green('  Key saved') + ' to ' + chalk.dim(getConfigPath()));
}

// ── Post-onboarding guidance ─────────────────────────────────────────

const NEXT_STEP_PROMPT =
  'Read through this codebase and set up lat.md/ to document its architecture, key design decisions, and domain concepts. Run `lat check` when done.';

function printNextSteps(selectedAgents: string[]): void {
  const hasClaudeCode = selectedAgents.includes('claude');
  const ideAgents = selectedAgents.filter((a) => a !== 'claude');

  const ideLabels: Record<string, string> = {
    cursor: 'Cursor',
    copilot: 'VS Code Copilot',
    pi: 'Pi',
    opencode: 'OpenCode',
    codex: 'Codex',
  };

  if (!hasClaudeCode && ideAgents.length === 0) return;

  console.log('');
  console.log(
    chalk.bold('Next step') + ' — have your agent document this codebase:',
  );

  if (hasClaudeCode) {
    console.log('');
    console.log('  ' + chalk.bold('Claude Code:'));
    console.log('    ' + chalk.cyan(`claude "${NEXT_STEP_PROMPT}"`));
  }

  if (ideAgents.length > 0) {
    const names = ideAgents.map((a) => ideLabels[a] || a).join(' / ');
    console.log('');
    console.log('  ' + chalk.bold(`${names}`) + ' — paste into agent chat:');
    console.log('    ' + chalk.cyan(NEXT_STEP_PROMPT));
  }
}

// ── Main init flow ───────────────────────────────────────────────────

export function readLogo(): string {
  return readFileSync(join(findTemplatesDir(), 'logo.txt'), 'utf-8');
}

export async function initCmd(targetDir?: string): Promise<void> {
  console.log(chalk.cyan(readLogo()));

  // Upfront version check — let the user upgrade before proceeding
  process.stdout.write(chalk.dim('Checking latest version...'));
  const latest = await fetchLatestVersion();
  const local = getLocalVersion();
  if (latest && latest !== local) {
    console.log(
      ' ' +
        chalk.yellow('update available:') +
        ' ' +
        local +
        ' → ' +
        chalk.green(latest) +
        ' — run ' +
        chalk.cyan('npm install -g lat.md') +
        ' to update.',
    );
    console.log('');
  } else {
    console.log(' ' + chalk.green(`latest version is used (${local})`));
  }

  const root = resolve(targetDir ?? process.cwd());
  const latDir = join(root, 'lat.md');

  const interactive = process.stdin.isTTY ?? false;

  // Readline is created AFTER the selectMenu loop below.
  // selectMenu puts stdin into raw mode with its own 'data' listener;
  // if readline is already attached it receives those raw keypresses,
  // corrupting its internal state and causing rl.question() to hang/exit.
  let rl: ReturnType<typeof createInterface> | null = null;

  const ask = async (message: string): Promise<boolean> => {
    if (!rl) return true;
    return confirm(rl, message);
  };

  try {
    // Step 1: lat.md/ directory
    if (existsSync(latDir)) {
      console.log(chalk.green('lat.md/') + ' already exists');
    } else {
      // No rl yet — selectMenu hasn't run, so use a one-off confirm
      if (interactive) {
        const tmpRl = createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        try {
          if (!(await confirm(tmpRl, 'Create lat.md/ directory?'))) {
            console.log('Aborted.');
            return;
          }
        } finally {
          tmpRl.close();
        }
      }
      const templateDir = join(findTemplatesDir(), 'init');
      mkdirSync(latDir, { recursive: true });
      cpSync(templateDir, latDir, { recursive: true });
      console.log(chalk.green('Created lat.md/'));
    }

    // Step 2: Which coding agents do you use? (interactive select menu)
    console.log('');

    const allAgents = [
      { label: 'Claude Code', value: 'claude' },
      { label: 'Pi', value: 'pi' },
      { label: 'Cursor', value: 'cursor' },
      { label: 'VS Code Copilot', value: 'copilot' },
      { label: 'OpenCode', value: 'opencode' },
      { label: 'Codex', value: 'codex' },
    ];

    const selectedAgents = await checklistMenu(
      allAgents,
      'Which coding agents do you use?',
    );

    const useClaudeCode = selectedAgents.includes('claude');
    const usePi = selectedAgents.includes('pi');
    const useCursor = selectedAgents.includes('cursor');
    const useCopilot = selectedAgents.includes('copilot');
    const useOpenCode = selectedAgents.includes('opencode');
    const useCodex = selectedAgents.includes('codex');

    const anySelected = selectedAgents.length > 0;
    const needsLatCommand =
      useClaudeCode ||
      usePi ||
      useCursor ||
      useCopilot ||
      useOpenCode ||
      useCodex;

    // Step 2b: How should agents run lat?
    let commandStyle: LatCommandStyle = 'local';
    if (anySelected && needsLatCommand && interactive) {
      console.log('');
      const localBin = resolveLatBin();
      const styleOptions: SelectOption[] = [
        { label: 'lat', value: 'global' },
        { label: localBin, value: 'local' },
        { label: 'npx lat.md@latest', value: 'npx' },
      ];
      const styleChoice = await selectMenu(
        styleOptions,
        'How should agents run lat?',
        0,
      );
      if (!styleChoice) {
        console.log('Aborted.');
        return;
      }
      commandStyle = styleChoice as LatCommandStyle;
    }

    // Now that selectMenu is done, it's safe to create the readline interface.
    // selectMenu has restored stdin to its original state (paused, non-raw).
    if (interactive) {
      rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
    }

    if (!anySelected) {
      console.log('');
      console.log(
        chalk.dim('No agents selected. You can re-run') +
          ' lat init ' +
          chalk.dim('later.'),
      );
      return;
    }

    console.log('');
    const template = readAgentsTemplate();
    const fileHashes: Record<string, string> = {};

    // Step 3: AGENTS.md (shared by non-Claude agents)
    const needsAgentsMd =
      usePi || useCursor || useCopilot || useOpenCode || useCodex;
    if (needsAgentsMd) {
      await setupAgentsMd(root, latDir, template, fileHashes, ask);
    }

    // Step 4: Per-agent setup
    if (useClaudeCode) {
      console.log('');
      console.log(chalk.bold('Setting up Claude Code...'));
      await setupClaudeCode(
        root,
        latDir,
        template,
        fileHashes,
        ask,
        commandStyle,
      );
    }

    if (usePi) {
      console.log('');
      console.log(chalk.bold('Setting up Pi...'));
      await setupPi(root, latDir, fileHashes, ask, commandStyle);
    }

    if (useCursor) {
      console.log('');
      console.log(chalk.bold('Setting up Cursor...'));
      await setupCursor(root, latDir, fileHashes, ask, commandStyle);
    }

    if (useCopilot) {
      console.log('');
      console.log(chalk.bold('Setting up VS Code Copilot...'));
      await setupCopilot(root, latDir, fileHashes, ask, commandStyle);
    }

    if (useOpenCode) {
      console.log('');
      console.log(chalk.bold('Setting up OpenCode...'));
      await setupOpenCode(root, latDir, fileHashes, ask, commandStyle);
    }

    if (useCodex) {
      console.log('');
      console.log(chalk.bold('Setting up Codex...'));
      await setupCodex(root, latDir, fileHashes, ask, commandStyle);
    }

    // Step 5: LLM key setup
    await setupLlmKey(rl);

    // Record init version and file hashes so `lat check` can detect stale setups
    writeInitMeta(latDir, fileHashes);

    console.log('');
    console.log(
      chalk.green('Done!') +
        ' Run ' +
        chalk.cyan('lat check') +
        ' to validate your setup.',
    );

    // Suggest ripgrep if not available
    const { hasRipgrep } = await import('../code-refs.js');
    if (!(await hasRipgrep())) {
      console.log('');
      console.log(
        chalk.yellow('Tip:') +
          ' Install ' +
          chalk.cyan('ripgrep') +
          ' (rg) for faster code scanning.' +
          ' See ' +
          chalk.underline('https://github.com/BurntSushi/ripgrep#installation'),
      );
    }

    // Post-onboarding: suggest having the agent document the codebase
    printNextSteps(selectedAgents);
  } finally {
    rl?.close();
  }
}
