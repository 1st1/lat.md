import {
  existsSync,
  cpSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  chmodSync,
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

async function confirm(
  rl: ReturnType<typeof createInterface>,
  message: string,
): Promise<boolean> {
  try {
    const answer = await rl.question(`${message} ${chalk.dim('[Y/n]')} `);
    return answer.trim().toLowerCase() !== 'n';
  } catch {
    // Ctrl+C or closed stdin — abort
    console.log('');
    process.exit(130);
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

const HOOK_COMMAND = '.claude/hooks/lat-prompt-hook.sh';

function hasLatHook(settingsPath: string): boolean {
  if (!existsSync(settingsPath)) return false;
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const entries = settings?.hooks?.UserPromptSubmit;
    if (!Array.isArray(entries)) return false;
    return entries.some((entry: { hooks?: { command?: string }[] }) =>
      entry.hooks?.some((h) => h.command === HOOK_COMMAND),
    );
  } catch {
    return false;
  }
}

function addLatHook(settingsPath: string): void {
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

  if (!Array.isArray(hooks.UserPromptSubmit)) {
    hooks.UserPromptSubmit = [];
  }

  (hooks.UserPromptSubmit as unknown[]).push({
    hooks: [{ type: 'command', command: HOOK_COMMAND }],
  });

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
  } catch {
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

// ── Per-agent setup ──────────────────────────────────────────────────

function setupAgentsMd(root: string, template: string): void {
  const agentsPath = join(root, 'AGENTS.md');
  if (!existsSync(agentsPath)) {
    writeFileSync(agentsPath, template);
    console.log(chalk.green('Created AGENTS.md'));
  } else {
    console.log(chalk.green('AGENTS.md') + ' already exists');
  }
}

async function setupClaudeCode(
  root: string,
  template: string,
): Promise<string[]> {
  const created: string[] = [];

  // CLAUDE.md — written directly (not a symlink)
  const claudePath = join(root, 'CLAUDE.md');
  if (!existsSync(claudePath)) {
    writeFileSync(claudePath, template);
    console.log(chalk.green('  Created CLAUDE.md'));
    created.push('CLAUDE.md');
  } else {
    console.log(chalk.green('  CLAUDE.md') + ' already exists');
  }

  // Prompt hook
  console.log('');
  console.log(
    chalk.dim(
      "  Claude Code doesn't reliably follow CLAUDE.md for per-prompt actions,",
    ),
  );
  console.log(
    chalk.dim(
      '  so we install a hook that injects lat.md workflow reminders into every prompt.',
    ),
  );

  const claudeDir = join(root, '.claude');
  const hooksDir = join(claudeDir, 'hooks');
  const hookPath = join(hooksDir, 'lat-prompt-hook.sh');
  const settingsPath = join(claudeDir, 'settings.json');

  if (hasLatHook(settingsPath)) {
    console.log(chalk.green('  Prompt hook') + ' already configured');
  } else {
    mkdirSync(hooksDir, { recursive: true });
    const templateHook = join(findTemplatesDir(), 'lat-prompt-hook.sh');
    copyFileSync(templateHook, hookPath);
    chmodSync(hookPath, 0o755);
    addLatHook(settingsPath);
    console.log(chalk.green('  Prompt hook') + ' installed');
    created.push('.claude/hooks/lat-prompt-hook.sh');
  }

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
    created.push('.mcp.json');
  }

  // Ensure .mcp.json is gitignored (it contains local absolute paths)
  ensureGitignored(root, '.mcp.json');

  return created;
}

async function setupCursor(root: string): Promise<string[]> {
  const created: string[] = [];

  // .cursor/rules/lat.md
  const rulesDir = join(root, '.cursor', 'rules');
  const rulesPath = join(rulesDir, 'lat.md');
  if (!existsSync(rulesPath)) {
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(rulesPath, readCursorRulesTemplate());
    console.log(chalk.green('  Rules') + ' created at .cursor/rules/lat.md');
    created.push('.cursor/rules/lat.md');
  } else {
    console.log(chalk.green('  Rules') + ' already exist');
  }

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
    created.push('.cursor/mcp.json');
  }

  // Ensure .cursor/mcp.json is gitignored (it contains local absolute paths)
  ensureGitignored(root, '.cursor/mcp.json');

  console.log('');
  console.log(
    chalk.yellow('  Note:') +
      ' Enable MCP in Cursor: Settings → Features → MCP → check "Enable MCP"',
  );

  return created;
}

async function setupCopilot(root: string): Promise<string[]> {
  const created: string[] = [];

  // .github/copilot-instructions.md
  const githubDir = join(root, '.github');
  const instructionsPath = join(githubDir, 'copilot-instructions.md');
  if (!existsSync(instructionsPath)) {
    mkdirSync(githubDir, { recursive: true });
    writeFileSync(instructionsPath, readAgentsTemplate());
    console.log(
      chalk.green('  Instructions') +
        ' created at .github/copilot-instructions.md',
    );
    created.push('.github/copilot-instructions.md');
  } else {
    console.log(chalk.green('  Instructions') + ' already exist');
  }

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
    created.push('.vscode/mcp.json');
  }

  return created;
}

// ── LLM key setup ───────────────────────────────────────────────────

async function setupLlmKey(
  rl: ReturnType<typeof createInterface> | null,
): Promise<void> {
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

  // Check env var first
  const envKey = process.env.LAT_LLM_KEY;
  if (envKey) {
    console.log(
      chalk.green('  LAT_LLM_KEY') +
        ' is set in your environment. Semantic search is ready.',
    );
    return;
  }

  // Check existing config
  const config = readConfig();
  const configPath = getConfigPath();
  if (config.llm_key) {
    console.log(
      chalk.green('  LLM key') +
        ' already configured in ' +
        chalk.dim(configPath),
    );
    return;
  }

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

    // Step 3: AGENTS.md (shared by non-Claude agents)
    const needsAgentsMd = useCursor || useCopilot || useCodex;
    if (needsAgentsMd) {
      setupAgentsMd(root, template);
    }

    // Step 4: Per-agent setup
    if (useClaudeCode) {
      console.log('');
      console.log(chalk.bold('Setting up Claude Code...'));
      await setupClaudeCode(root, template);
    }

    if (useCursor) {
      console.log('');
      console.log(chalk.bold('Setting up Cursor...'));
      await setupCursor(root);
    }

    if (useCopilot) {
      console.log('');
      console.log(chalk.bold('Setting up VS Code Copilot...'));
      await setupCopilot(root);
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
