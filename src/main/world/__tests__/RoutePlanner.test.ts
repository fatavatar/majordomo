import { describe, expect, it, vi } from 'vitest';

import { planRoute } from '../RoutePlanner';
import type { WorldGraph } from '../WorldGraph';

/* Planned on main's thread, the console stood still for it (2026-10-14). */
describe('planning a route', () => {
  it('answers later, with the graph’s own route, when there is no worker', async () => {
    const route = { steps: [], cost: 3, blocked: false };
    const world = { file: undefined, route: vi.fn(() => route) } as unknown as WorldGraph;
    const asked = planRoute(world, '1/1', '1/2', { level: 3 }, { alternatives: true });
    expect(world.route).not.toHaveBeenCalled();
    await expect(asked).resolves.toBe(route);
    expect(world.route).toHaveBeenCalledWith('1/1', '1/2', { level: 3 }, { alternatives: true });
  });

  it('passes on what the graph throws', async () => {
    const world = {
      file: undefined,
      route: () => {
        throw new Error('no such room');
      }
    } as unknown as WorldGraph;
    await expect(planRoute(world, '1/1', '1/2')).rejects.toThrow('no such room');
  });

  /* `lairCost` could not be cloned to the worker (2026-10-14). */
  it('plans here a traveller with callbacks, which cannot be sent to the worker', async () => {
    const route = { steps: [], cost: 1, blocked: false };
    const world = { file: '/nowhere.jsonl.gz', route: vi.fn(() => route) } as unknown as WorldGraph;
    const danger = (): number | null => null;
    await expect(planRoute(world, '1/1', '1/2', { danger })).resolves.toBe(route);
  });
});
