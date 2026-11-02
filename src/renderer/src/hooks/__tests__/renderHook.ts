import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

import type { ConnectionPhase } from '@shared/types';
import type { SessionSummary } from '@shared/ipc';

/**
 * A hook rendered on its own, for a test: React's own root in the document a
 * test file asks for with `// @vitest-environment happy-dom`, each render and
 * the unmount inside `act`, so effects have run by the time it returns.
 */
export interface RenderedHook<P, R> {
  /** What the hook returned on its latest render. */
  readonly current: R;
  rerender(props: P): void;
  unmount(): void;
}

export function renderHook<P, R>(hook: (props: P) => R, props: P): RenderedHook<P, R> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const latest: { value?: R } = {};
  function Probe({ with: given }: { with: P }): null {
    latest.value = hook(given);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  act(() => root.render(createElement(Probe, { with: props })));
  return {
    get current(): R {
      if (!('value' in latest)) throw new Error('the hook has not rendered');
      return latest.value as R;
    },
    rerender(next) {
      act(() => root.render(createElement(Probe, { with: next })));
    },
    unmount() {
      act(() => root.unmount());
    }
  };
}

/** Lets promises already resolved answer, inside `act`. */
export async function settle(): Promise<void> {
  await act(async () => {});
}

/** A character's tab as main summarises it, in the phase a test needs. */
export function summary(
  id: string,
  server: string,
  phase: ConnectionPhase = 'connected'
): SessionSummary {
  return {
    id,
    name: id,
    server,
    accent: '#888888',
    retrying: false,
    state: {
      phase,
      target: null,
      connectedAt: null,
      detail: null,
      endedBy: null,
      negotiated: {
        localEnabled: [],
        remoteEnabled: [],
        binary: false,
        suppressGoAhead: false,
        remoteEcho: false
      }
    }
  };
}
