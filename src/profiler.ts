import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

export type Profiler = {
  time<T>(label: string, work: () => Promise<T>, detail?: string): Promise<T>;
  timeSync<T>(label: string, work: () => T, detail?: string): T;
  record(label: string, durationMs: number, detail?: string): void;
};

type ProfileNode = {
  label: string;
  calls: number;
  totalMs: number;
  maxMs: number;
  maxDetail?: string;
  children: Map<string, ProfileNode>;
};

export class TimingProfiler implements Profiler {
  private readonly root: ProfileNode = {
    label: '',
    calls: 0,
    totalMs: 0,
    maxMs: 0,
    children: new Map(),
  };
  private readonly activeNode = new AsyncLocalStorage<ProfileNode>();

  private node(label: string): ProfileNode {
    const parent = this.activeNode.getStore() ?? this.root;
    let node = parent.children.get(label);
    if (!node) {
      node = {
        label,
        calls: 0,
        totalMs: 0,
        maxMs: 0,
        children: new Map(),
      };
      parent.children.set(label, node);
    }
    return node;
  }

  async time<T>(
    label: string,
    work: () => Promise<T>,
    detail?: string,
  ): Promise<T> {
    const node = this.node(label);
    const start = performance.now();
    try {
      return await this.activeNode.run(node, work);
    } finally {
      this.recordNode(node, performance.now() - start, detail);
    }
  }

  timeSync<T>(label: string, work: () => T, detail?: string): T {
    const node = this.node(label);
    const start = performance.now();
    try {
      return this.activeNode.run(node, work);
    } finally {
      this.recordNode(node, performance.now() - start, detail);
    }
  }

  record(label: string, durationMs: number, detail?: string): void {
    this.recordNode(this.node(label), durationMs, detail);
  }

  private recordNode(
    node: ProfileNode,
    durationMs: number,
    detail?: string,
  ): void {
    node.calls++;
    node.totalMs += durationMs;
    if (durationMs > node.maxMs) {
      node.maxMs = durationMs;
      node.maxDetail = detail;
    }
  }

  format(totalMs: number): string[] {
    const lines = [`Profile (${totalMs.toFixed(1)}ms total):`];
    for (const node of this.root.children.values()) {
      this.formatNode(node, 1, lines);
    }
    return lines;
  }

  private formatNode(node: ProfileNode, depth: number, lines: string[]): void {
    const indent = '  '.repeat(depth);
    let summary = `${indent}${node.label}: ${node.totalMs.toFixed(1)}ms`;
    if (node.calls > 1) {
      summary +=
        ` total across ${node.calls} calls` +
        ` (${(node.totalMs / node.calls).toFixed(1)}ms avg,` +
        ` ${node.maxMs.toFixed(1)}ms max` +
        (node.maxDetail ? `: ${node.maxDetail}` : '') +
        ')';
    }
    lines.push(summary);
    for (const child of node.children.values()) {
      this.formatNode(child, depth + 1, lines);
    }
  }
}
