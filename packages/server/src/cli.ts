#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runLatServer, type LatServerApp } from './index.js';

const entry = process.argv[2];
if (!entry) throw new Error('Usage: lat-ui-server <app-module>');
const module = (await import(pathToFileURL(resolve(entry)).href)) as {
  default?: LatServerApp;
  close?: () => void | Promise<void>;
};
if (typeof module.default !== 'function') {
  throw new Error(`${entry} must default-export an Express app`);
}
await runLatServer(module.default, { close: module.close });
