/**
 * The window's buttons (`0x462d20`'s commands), read 2026-10-13: Go/Stop
 * (`0x803`), Roam (`0x808`), AFK (`0x809`), Step Back (`0x869`) and the
 * toolbar's toggles (`shared/megamud/toggles.ts`). The app's buttons and the
 * remote `@stop`/`@rego` call these. Each toggle ends as MegaMUD's do, by
 * waking the scheduler (`0x42e0e0`); the window's redraw (`0x460d50`) is
 * ours, when the engine reports its toggles changed.
 */
import { goOnline, hangUp } from '../script/game';
import { modeDefaults, reEngage } from '../script/modes';
import { send, wake } from '../script/send';
import { setState } from '../script/state';
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

/**
 * `0x7d4` online: the player's Disconnect (its "Are you sure" is the app's).
 * Hung up on purpose (`0x30de4`), so the close that follows is not redialled
 * as a lost carrier; walking and following stopped, out of the game.
 */
export function disconnect(s: Session): void {
  s.f_30de8 = 0;
  s.f_30de4 = 1;
  s.walking = 0;
  s.following = 0;
  hangUp(s, 0);
  s.inGame = 0;
  goOnline(s, 0);
  setTask(s, 0xb);
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

/** `0x4aa740`: back to idle, unless waiting on one of the states above `0x14`. */
function settle(s: Session): void {
  if (s.state <= 0x14) setState(s, 0);
}

/** `0x7d3`: auto-combat. On, a run is called off. */
function autoCombat(s: Session): void {
  const was = s.MegaMud_AutoCombat;
  s.MegaMud_AutoCombat = was === 0 ? 1 : 0;
  if (s.detourCombat === -1) s.idleCombat = s.MegaMud_AutoCombat;
  else if (was === 0) s.idleCombat = 1;
  if (s.inCombat !== 0) settle(s);
  if (s.MegaMud_AutoCombat !== 0) {
    s.runCount = 0;
    s.f_907c = 0;
  }
  wake(s);
}

/** `0x7dc`: auto-heal. Off, any resting it had begun is called off. */
function autoHeal(s: Session): void {
  const was = s.MegaMud_AutoHeal;
  s.MegaMud_AutoHeal = was === 0 ? 1 : 0;
  if (was !== 0) {
    s.resting = 0;
    s.restHpToFull = 0;
    s.restManaToFull = 0;
    s.hpFullAt = 0;
    s.manaFullAt = 0;
  }
  settle(s);
  wake(s);
}

/** `0x821`: all off. Back on outside the game, a return is sent to wake it. */
function allOff(s: Session): void {
  const was = s.f_a32c;
  s.f_e398 = 0;
  s.f_a32c = was === 0 ? 1 : 0;
  if (was !== 0 && s.inGame === 0) {
    s.f_7ed4 = 0;
    send(s, '\r');
  }
  wake(s);
}

type Toggled =
  | 'MegaMud_AutoGet'
  | 'MegaMud_AutoSearch'
  | 'MegaMud_AutoSneak'
  | 'MegaMud_AutoTrack'
  | 'MegaMud_AutoHide'
  | 'MegaMud_AutoCash'
  | 'MegaMud_AutoBless'
  | 'MegaMud_AutoLight'
  | 'MegaMud_AutoPreAttack'
  | 'MegaMud_AutoNuke'
  | 'f_8be8';

/**
 * The plain toggles: flipped, and then idle again — always (`0x82a` bless,
 * `0x870` light), only in a fight (`0x829` pre-attack, `0x86a` nuke,
 * `0x8a4` melee), or not at all (the rest).
 */
const PLAIN: Record<number, [Toggled, 'always' | 'fighting' | 'never']> = {
  0x7d9: ['MegaMud_AutoGet', 'never'],
  0x7f2: ['MegaMud_AutoSearch', 'never'],
  0x801: ['MegaMud_AutoSneak', 'never'],
  0x804: ['MegaMud_AutoTrack', 'never'],
  0x815: ['MegaMud_AutoHide', 'never'],
  0x823: ['MegaMud_AutoCash', 'never'],
  0x82a: ['MegaMud_AutoBless', 'always'],
  0x870: ['MegaMud_AutoLight', 'always'],
  0x829: ['MegaMud_AutoPreAttack', 'fighting'],
  0x86a: ['MegaMud_AutoNuke', 'fighting'],
  0x8a4: ['f_8be8', 'fighting']
};

/** A window command posted (`0x460b90`) and run now: the ones the engine has. */
export function menuCommand(s: Session, command: number): void {
  if (command === 0x803) goStop(s);
  else if (command === 0x808) roam(s);
  else if (command === 0x809) afk(s);
  else if (command === 0x869) stepBack(s);
  else if (command === 0x7d3) autoCombat(s);
  else if (command === 0x7dc) autoHeal(s);
  else if (command === 0x821) allOff(s);
  else if (command === 0x82f) s.MegaMud_NoHangup = s.MegaMud_NoHangup === 0 ? 1 : 0;
  else {
    const plain = PLAIN[command];
    if (!plain) return;
    const [field, idle] = plain;
    s[field] = s[field] === 0 ? 1 : 0;
    if (idle === 'always' || (idle === 'fighting' && s.inCombat !== 0)) settle(s);
    wake(s);
  }
}
