/**
 * The window's buttons (`0x462d20`'s commands), read 2026-10-13: Go/Stop
 * (`0x803`), Roam (`0x808`), AFK (`0x809`) and Step Back (`0x869`). The
 * app's buttons and the remote `@stop`/`@rego` call these.
 */
import { modeDefaults, reEngage } from '../script/modes';
import { wake } from '../script/send';
import { setActive } from '../script/timer';
import { setTask } from '../script/task';
import type { Session } from '../Session';
import { runBack } from './go';

/** `0x803`: walking on or off; on, the task is the path's (or nothing to walk to, off again). */
export function goStop(s: Session): void {
  if (s.walking !== 0 && s.f_e21c !== 0) {
    s.f_e21c = 0;
    s.host.show("[Don't attack flag cleared from room.]");
  }
  s.rescueCount = 0;
  s.f_e398 = 0;
  s.walking = s.walking === 0 ? 1 : 0;
  modeDefaults(s);
  if (s.walking === 0) {
    // `0x4c0980`: auto-combat back from a detour.
    if (s.detourCombat !== -1) reEngage(s);
    setTask(s, 0xb);
    return;
  }
  setTask(s, s.lost !== 0 ? 0x11 : s.looping !== 0 ? 0xf : s.roaming !== 0 ? 0x10 : 0xe);
  const task = s.task;
  if (
    (task === 0xe || task === 0xf || task === 0x11) &&
    s.detours[0]!.room === 0 &&
    s.detours[0]!.path === ''
  ) {
    s.walking = 0;
    setTask(s, 0xb);
  }
  if (s.task !== 0xb) {
    s.hidden = 0;
    wake(s);
  }
}

/** `0x808`: roaming (and so walking) on or off; the loop let go. */
export function roam(s: Session): void {
  const was = s.roaming;
  s.looping = 0;
  s.f_e398 = 0;
  s.roaming = was === 0 ? 1 : 0;
  s.walking = s.roaming;
  if (was === 0) {
    s.hidden = 0;
    setTask(s, 0x10);
    wake(s);
  } else {
    setTask(s, 0xb);
  }
  modeDefaults(s);
}

/** `0x809`: AFK on or off. */
export function afk(s: Session): void {
  setActive(s, s.active === 0 ? 1 : 0);
  modeDefaults(s);
  wake(s);
}

/** `0x869`: back a step along the path. */
export function stepBack(s: Session): void {
  s.f_e398 = 0;
  runBack(s, 1);
}

/** A window command posted (`0x460b90`) and run now: the ones the engine has. */
export function menuCommand(s: Session, command: number): void {
  if (command === 0x803) goStop(s);
  else if (command === 0x808) roam(s);
  else if (command === 0x809) afk(s);
  else if (command === 0x869) stepBack(s);
}
