/**
 * `0x497b40`: recovering one's own corpse (GreaterMUD), read 2026-10-12:
 * `You begin to pick through the corpse of <me>...` (started), `The corpse
 * of <me> remains.` / `Syntax: RECOVER` (can't: given up), `You have
 * recovered the corpse of <me>.` (the corpse gone from the room). Each ends
 * the recovery (state `0x2f`).
 */
import { send } from '../script/send';
import { forgetAwaited, setState } from '../script/state';
import type { RoomEntity, Session } from '../Session';
import { removeEntity } from '../room/entities';

/** The one row of the table at `0x54d230`. */
const CORPSE = {
  mark: 0x8000,
  one: 'corpse of %s',
  many: 'corpses of %s',
  begin: 'You begin to pick through the corpse of %s...',
  remains: 'The corpse of %s remains.',
  recovered: 'You have recovered the corpse of %s.'
};

function fill(text: string, name: string): string {
  return text.replace('%s', name);
}

/** `0x4979f0`: the recovery is over. */
function recoveryDone(s: Session): void {
  s.f_8558 = 0;
  s.f_8468 = 0;
  forgetAwaited(s, 0x2f);
  setState(s, 0);
}

/** `0x497df0`: this item is the corpse (marked as one, and named for this character). */
function isMyCorpse(s: Session, e: RoomEntity): boolean {
  if ((e.flags & CORPSE.mark) === 0) return false;
  const name = e.name.slice(0, 0x1e).toLowerCase();
  return (
    name === fill(CORPSE.one, s.Player_Name).slice(0, 0x1e).toLowerCase() ||
    name === fill(CORPSE.many, s.Player_Name).slice(0, 0x1e).toLowerCase()
  );
}

export function corpseLine(s: Session, line: string): number {
  if (s.BBS_GreaterMUD === 0 || s.Player_Name === '' || s.Player_Name.startsWith('*')) return 0;
  const lower = line.toLowerCase();
  if (!['you begin to ', 'you have ', 'the ', 'syntax: '].some((p) => lower.startsWith(p)))
    return 0;
  const done = (tag: string): number => {
    if (tag === 'rc-p') s.f_e1e4 = 1;
    recoveryDone(s);
    if (s.debug !== 0) s.host.trace(`{${tag}}`);
    return 1;
  };
  if (s.f_8558 !== 0 && (line.includes('Syntax: RECOVER') || line.includes('Syntax: COLLECT'))) {
    return done('rc-p');
  }
  const starts = (text: string): boolean =>
    line.toLowerCase().startsWith(fill(text, s.Player_Name).toLowerCase());
  if (starts(CORPSE.begin)) {
    s.f_8560 = s.now;
    if (s.debug !== 0) s.host.trace('{rc-o0}');
    return 1;
  }
  if (starts(CORPSE.remains)) return done('rc-p');
  if (starts(CORPSE.recovered)) {
    const e = s.room.find((x) => x.type === 3 && isMyCorpse(s, x));
    if (e) {
      e.count -= 1;
      if (e.count < 1) removeEntity(s, s.room.indexOf(e));
    }
    return done('rc-ok');
  }
  return 0;
}

/**
 * `0x497840` (D51): with `MegaMud.AutoGet` and `Cash.AutoRecoverCorpse`, this
 * character's corpse here (a corpse-marked item, `0x18000`) recovered
 * (`recover corpse of <me>`, state `0x2f`). GreaterMUD only.
 */
export function recoverCorpse(s: Session): number {
  if (s.hp <= 0 || s.f_a32c !== 0 || s.MegaMud_AutoGet === 0 || s.BBS_GreaterMUD === 0) return 0;
  if (s.f_8558 !== 0 || s.f_e1e4 !== 0 || s.darkness === 2) return 0;
  if (s.Player_Name === '' || s.Player_Name.startsWith('*')) return 0;
  for (const e of s.room) {
    if (e.type !== 3 || (e.flags & 0x18000) === 0) continue;
    // `0x497dd0`: the row's setting (row 1, `Cash.AutoRecoverCorpse`).
    if (s.Cash_AutoRecoverCorpse === 0 || !isMyCorpse(s, e)) continue;
    s.f_8558 = 1;
    s.f_8560 = s.now;
    s.waitLines = 2;
    setState(s, 0x2f);
    s.host.activity(`Recovering ${e.name}`);
    send(s, `recover corpse of ${s.Player_Name}\r`);
    if (s.debug !== 0) s.host.trace('{rc-go0}');
    return 1;
  }
  return 0;
}
