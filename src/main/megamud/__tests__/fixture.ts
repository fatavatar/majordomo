/** A session with a host that records what the engine does. */
import type { MegaData } from '../data';
import { Session, type SessionHost } from '../Session';

export interface Recorded {
  sent: string[];
  trace: string[];
  activity: string[];
  shown: string[];
  status: string[];
}

export function session(
  data: Partial<MegaData> = {},
  clock = { now: 1_000_000, ms: 5_000_000 }
): {
  s: Session;
  out: Recorded;
  clock: { now: number; ms: number };
} {
  const out: Recorded = { sent: [], trace: [], activity: [], shown: [], status: [] };
  const host: SessionHost = {
    write: (text) => out.sent.push(text),
    trace: (text) => out.trace.push(text),
    activity: (text) => out.activity.push(text),
    show: (text) => out.shown.push(text),
    status: (text) => out.status.push(text),
    clock: () => clock.now,
    tickMs: () => clock.ms
  };
  const s = new Session(host, { monsters: [], items: [], spells: [], ...data });
  return { s, out, clock };
}
