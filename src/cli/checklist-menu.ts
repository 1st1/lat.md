import chalk from 'chalk';

export interface ChecklistOption {
  label: string;
  value: string;
}

/**
 * Display an interactive multi-select checklist with arrow-key navigation.
 * Returns an array of checked values.
 *
 * Keys: Up/Down (j/k) to move, Space to toggle, Enter to confirm, Ctrl+C to exit.
 * Non-TTY fallback: returns [].
 */
export async function checklistMenu(
  options: ChecklistOption[],
  prompt?: string,
): Promise<string[]> {
  if (options.length === 0) return [];
  if (!process.stdin.isTTY) return [];

  return new Promise((resolve) => {
    let cursor = 0;
    const checked = new Set<number>();
    const stdin = process.stdin;

    const wasRaw = stdin.isRaw;

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf-8');

    function render() {
      process.stdout.write('\x1B[?25l'); // hide cursor

      const lines: string[] = [];
      if (prompt) {
        lines.push(chalk.bold(prompt));
      }
      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        const selected = i === cursor;
        const box = checked.has(i) ? '[x]' : '[ ]';
        if (selected) {
          lines.push(`  ${box} ${chalk.bgCyan.black.bold(` ${opt.label} `)}`);
        } else {
          lines.push(`  ${box} ${chalk.dim(opt.label)}`);
        }
      }
      lines.push('');
      lines.push(chalk.dim('  space: toggle  enter: confirm'));
      process.stdout.write(lines.join('\n') + '\n');
    }

    function clearRender() {
      const totalLines = options.length + (prompt ? 1 : 0) + 2; // +2 for blank line + hint
      for (let i = 0; i < totalLines; i++) {
        process.stdout.write('\x1B[A\x1B[2K');
      }
    }

    function cleanup() {
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      process.stdout.write('\x1B[?25h'); // show cursor
      stdin.removeListener('data', onData);
    }

    function onData(data: string | Buffer) {
      const key = data.toString();

      // Ctrl+C
      if (key === '\x03') {
        clearRender();
        cleanup();
        console.log('');
        process.exit(130);
      }

      // Enter — confirm
      if (key === '\r' || key === '\n') {
        clearRender();
        cleanup();
        const result = [...checked].sort().map((i) => options[i].value);
        // Print summary
        if (prompt) {
          const labels = [...checked]
            .sort()
            .map((i) => options[i].label)
            .join(', ');
          console.log(
            chalk.bold(prompt) +
              ' ' +
              (labels ? chalk.green(labels) : chalk.dim('None')),
          );
        }
        resolve(result);
        return;
      }

      // Space — toggle
      if (key === ' ') {
        clearRender();
        if (checked.has(cursor)) {
          checked.delete(cursor);
        } else {
          checked.add(cursor);
        }
        render();
        return;
      }

      // Arrow keys
      if (key === '\x1B[A' || key === 'k') {
        // Up
        clearRender();
        cursor = (cursor - 1 + options.length) % options.length;
        render();
      } else if (key === '\x1B[B' || key === 'j') {
        // Down
        clearRender();
        cursor = (cursor + 1) % options.length;
        render();
      }
    }

    stdin.on('data', onData);
    render();
  });
}
