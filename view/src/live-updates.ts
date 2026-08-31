import type { ViewProjectChange } from '../../src/view/protocol';

/** Keep generations monotonic within one server, but trust a new server instance. */
export function mergeProjectChange(
  current: ViewProjectChange,
  incoming: ViewProjectChange,
): ViewProjectChange {
  if (current.instanceId !== incoming.instanceId) return incoming;
  const generation = Math.max(current.generation, incoming.generation);
  const markdownGeneration = Math.max(
    current.markdownGeneration,
    incoming.markdownGeneration,
  );
  return generation === current.generation &&
    markdownGeneration === current.markdownGeneration
    ? current
    : { ...current, generation, markdownGeneration };
}
