import { describe, expect, it } from 'vitest';

import type { Route, RouteStep } from '../../../shared/world';
import { lapWithTrips } from '../sideTrips';

/** A way of plain steps through `rooms`, or through a portal that wants `item` lying in its room. */
function way(rooms: string[], gatedAt: number | null = null, item = 'flaming portal'): Route {
  const steps = rooms.slice(1).map(
    (to, at) =>
      ({
        from: rooms[at]!,
        to,
        direction: at === gatedAt ? 'portal' : 'n',
        command: at === gatedAt ? 'enter flaming portal' : 'n',
        name: to,
        requirement:
          at === gatedAt
            ? { kind: 'text', raw: '', unread: ['nomonsters', `roomitem ${item}`] }
            : null,
        dark: false
      }) as RouteStep
  );
  return { steps, cost: steps.length, blocked: false };
}

/*
 * The Granite Caverns loop with the Flame Pit put in after 2/8602: the pit
 * through the portal the Greater Glabrezu drops, and out of it only through
 * the one its summoned twin drops — so the stop after it is reached through a
 * gate from the pit, and not from 2/8602.
 */
const WAYS: Record<string, Route> = {
  '2/8601>2/8602': way(['2/8601', '2/8602']),
  '2/8602>16/5066': way(['2/8602', '16/5066'], 0),
  '16/5066>2/8603': way(['16/5066', '16/5057', '2/8603'], 0),
  '2/8602>2/8603': way(['2/8602', '2/8603']),
  '2/8603>2/8601': way(['2/8603', '2/8601']),
  '2/8600>16/5066': way(['2/8600', '2/8602', '16/5066'], 1),
  '2/8602>16/5057': way(['2/8602', '16/5066', '16/5057'], 0),
  '16/5057>2/8603': way(['16/5057', '2/8603'])
};
const ask = (from: string, to: string): Route | string => WAYS[`${from}>${to}`] ?? 'no way';

describe('a loop’s lap and its side trips', () => {
  it('walks past a stop behind an item gate, and back to the stop after it', () => {
    const plan = lapWithTrips(['2/8601', '2/8602', '16/5066', '2/8603'], ask);
    expect(plan).toEqual({
      lap: [
        { room: '2/8601', stop: 0 },
        { room: '2/8602', stop: 1 },
        { room: '2/8603', stop: 3 }
      ],
      trips: [{ at: 1, items: ['flaming portal'], stops: [2], rejoin: 3 }]
    });
  });

  it('puts the gate’s room in when the way passes it between two stops', () => {
    const plan = lapWithTrips(['2/8600', '16/5066', '2/8603'], (from, to) =>
      from === '2/8602' && to === '2/8603' ? WAYS['2/8602>2/8603']! : ask(from, to)
    );
    expect(plan).toMatchObject({
      lap: [
        { room: '2/8600', stop: 0 },
        { room: '2/8602', stop: null },
        { room: '2/8603', stop: 2 }
      ],
      trips: [{ at: 1, stops: [1], rejoin: 2 }]
    });
  });

  it('takes every stop only the gate leads to into the one trip', () => {
    const plan = lapWithTrips(['2/8601', '2/8602', '16/5066', '16/5057', '2/8603'], ask);
    expect(plan).toMatchObject({
      lap: [
        { room: '2/8601', stop: 0 },
        { room: '2/8602', stop: 1 },
        { room: '2/8603', stop: 4 }
      ],
      trips: [{ at: 1, stops: [2, 3], rejoin: 4 }]
    });
  });

  it('ends a trip at the start when nothing after it is reached another way', () => {
    const plan = lapWithTrips(['2/8601', '2/8602', '16/5066'], ask);
    expect(plan).toMatchObject({ trips: [{ stops: [2], rejoin: 3 }] });
  });

  it('is the stops themselves where no way has a gate, and waits on a way being planned', () => {
    expect(lapWithTrips(['2/8602', '2/8603'], ask)).toEqual({
      lap: [
        { room: '2/8602', stop: 0 },
        { room: '2/8603', stop: 1 }
      ],
      trips: []
    });
    expect(lapWithTrips(['2/8602', '2/8603'], () => 'pending')).toBe('pending');
  });
});
