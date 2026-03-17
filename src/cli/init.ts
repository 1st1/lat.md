import {
  existsSync,
  cpSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import chalk from 'chalk';
import { findTemplatesDir } from './templates.js';
import { readAgentsTemplate, readCursorRulesTemplate } from './gen.js';
import {
  getLlmKey,
  getConfigPath,
  readConfig,
  writeConfig,
} from '../config.js';
import { writeInitMeta, readFileHash, contentHash } from '../init-version.js';

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

// ── Claude Code helpers ──────────────────────────────────────────────

/** Derive the hook command prefix from the currently running binary. */
function latHookCommand(event: string): string {
  return `lat hook claude ${event}`;
}

type HookEntry = { hooks?: { type?: string; command?: string }[] };

/** True if any command in this entry looks like it was installed by lat. */
function isLatHookEntry(entry: HookEntry): boolean {
  return (
    entry.hooks?.some(
      (h) => typeof h.command === 'string' && /\blat\b/.test(h.command),
    ) ?? false
  );
}

/**
 * Remove all lat-owned hook entries from settings, then add fresh ones.
 * Preserves any non-lat hooks the user may have configured.
 */
function syncLatHooks(settingsPath: string): void {
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
      hooks: [{ type: 'command', command: latHookCommand(event) }],
    });
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
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
 * starts the same binary.
 */
function mcpCommand(): { command: string; args: string[] } {
  return { command: resolve(process.argv[1]), args: ['mcp'] };
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

function addMcpServer(configPath: string, key: string): void {
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

  cfg[key].lat = mcpCommand();

  mkdirSync(join(configPath, '..'), { recursive: true });
  writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n');
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
  genTarget: string,
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
    chalk.dim(`${indent}Kept existing file.`) +
      ' Run ' +
      chalk.cyan(`lat gen ${genTarget}`) +
      ' to see the latest template.',
  );
  return null;
}

// ── Per-agent setup ──────────────────────────────────────────────────

async function setupAgentsMd(
  root: string,
  latDir: string,
  template: string,
  hashes: Record<string, string>,
  ask: (message: string) => Promise<boolean>,
): Promise<void> {
  const hash = await writeTemplateFile(
    root,
    latDir,
    'AGENTS.md',
    template,
    'agents.md',
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
): Promise<void> {
  // CLAUDE.md — written directly (not a symlink)
  const hash = await writeTemplateFile(
    root,
    latDir,
    'CLAUDE.md',
    template,
    'claude.md',
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
  syncLatHooks(settingsPath);
  console.log(chalk.green('  Hooks') + ' synced (UserPromptSubmit + Stop)');

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
    addMcpServer(mcpPath, 'mcpServers');
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
    addMcpServer(mcpPath, 'mcpServers');
    console.log(
      chalk.green('  MCP server') + ' registered in .cursor/mcp.json',
    );
  }

  // Ensure .cursor/mcp.json is gitignored (it contains local absolute paths)
  ensureGitignored(root, '.cursor/mcp.json');

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
): Promise<void> {
  // .github/copilot-instructions.md
  const hash = await writeTemplateFile(
    root,
    latDir,
    '.github/copilot-instructions.md',
    readAgentsTemplate(),
    'agents.md',
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
    addMcpServer(mcpPath, 'servers');
    console.log(
      chalk.green('  MCP server') + ' registered in .vscode/mcp.json',
    );
  }
}

// ── LLM key setup ───────────────────────────────────────────────────

async function setupLlmKey(
  rl: ReturnType<typeof createInterface> | null,
): Promise<void> {
  // Check env var first
  const envKey = process.env.LAT_LLM_KEY;
  if (envKey) {
    console.log('');
    console.log(
      chalk.green('Semantic search') + ' — LAT_LLM_KEY is set. Ready.',
    );
    return;
  }

  // Check existing config
  const config = readConfig();
  const configPath = getConfigPath();
  if (config.llm_key) {
    console.log('');
    console.log(
      chalk.green('Semantic search') +
        ' — LLM key configured in ' +
        chalk.dim(configPath),
    );
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
  const updatedConfig = { ...config, llm_key: key };
  writeConfig(updatedConfig);
  console.log(chalk.green('  Key saved') + ' to ' + chalk.dim(configPath));
}

// ── Main init flow ───────────────────────────────────────────────────

export async function initCmd(targetDir?: string): Promise<void> {
  const root = resolve(targetDir ?? process.cwd());
  const latDir = join(root, 'lat.md');

  const interactive = process.stdin.isTTY ?? false;
  const rl = interactive
    ? createInterface({ input: process.stdin, output: process.stdout })
    : null;

  const ask = async (message: string): Promise<boolean> => {
    if (!rl) return true;
    return confirm(rl, message);
  };

  try {
    // Step 1: lat.md/ directory
    if (existsSync(latDir)) {
      console.log(chalk.green('lat.md/') + ' already exists');
    } else {
      if (!(await ask('Create lat.md/ directory?'))) {
        console.log('Aborted.');
        return;
      }
      const templateDir = join(findTemplatesDir(), 'init');
      mkdirSync(latDir, { recursive: true });
      cpSync(templateDir, latDir, { recursive: true });
      console.log(chalk.green('Created lat.md/'));
    }

    // Step 2: Which coding agents do you use?
    console.log('');
    console.log(chalk.bold('Which coding agents do you use?'));
    console.log('');

    const useClaudeCode = await ask('  Claude Code?');
    const useCursor = await ask('  Cursor?');
    const useCopilot = await ask('  VS Code Copilot?');
    const useCodex = await ask('  Codex / OpenCode?');

    const anySelected = useClaudeCode || useCursor || useCopilot || useCodex;

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
    const needsAgentsMd = useCursor || useCopilot || useCodex;
    if (needsAgentsMd) {
      await setupAgentsMd(root, latDir, template, fileHashes, ask);
    }

    // Step 4: Per-agent setup
    if (useClaudeCode) {
      console.log('');
      console.log(chalk.bold('Setting up Claude Code...'));
      await setupClaudeCode(root, latDir, template, fileHashes, ask);
    }

    if (useCursor) {
      console.log('');
      console.log(chalk.bold('Setting up Cursor...'));
      await setupCursor(root, latDir, fileHashes, ask);
    }

    if (useCopilot) {
      console.log('');
      console.log(chalk.bold('Setting up VS Code Copilot...'));
      await setupCopilot(root, latDir, fileHashes, ask);
    }

    if (useCodex) {
      console.log('');
      console.log(
        chalk.bold('Codex / OpenCode') +
          ' — uses AGENTS.md (already created). No additional setup needed.',
      );
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
  } finally {
    rl?.close();
  }
}
