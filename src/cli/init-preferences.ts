import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMap, parseDocument } from 'yaml';

function readPreferences(latDir: string) {
  const path = join(latDir, 'config.local.yaml');
  const document = parseDocument(
    existsSync(path) ? readFileSync(path, 'utf8') : '',
  );
  if (document.errors.length > 0) {
    throw new Error(`Cannot parse ${path}: ${document.errors[0].message}`);
  }
  if (document.contents !== null && !isMap(document.contents)) {
    throw new Error(`${path} must be a mapping`);
  }
  if (document.has('init') && !isMap(document.get('init', true))) {
    throw new Error(`${path}: init must be a mapping`);
  }
  return { path, document };
}

/** Read machine-local checklist defaults without inferring installed agents. */
export function readInitAgents(latDir: string): string[] {
  const { path, document } = readPreferences(latDir);
  const agents: unknown = document.toJS()?.init?.agents;
  if (agents === undefined) return [];
  if (
    !Array.isArray(agents) ||
    agents.some((agent) => typeof agent !== 'string')
  ) {
    throw new Error(`${path}: init.agents must be a list of strings`);
  }
  return agents;
}

/** Update just the confirmed selection, preserving other YAML and comments. */
export function writeInitAgents(latDir: string, agents: string[]): void {
  const { path, document } = readPreferences(latDir);
  document.setIn(['init', 'agents'], agents);
  writeFileSync(path, document.toString());
}
