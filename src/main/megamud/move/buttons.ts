/**
 * The window's buttons (`0x462d20`'s commands, `WindowCommand`), read
 * 2026-10-13: Go/Stop, Roam, AFK, Step Back and the
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
import { setTask, Task } from '../script/task';
import type { Session } from '../Session';
import { runBack } from './go';
import { State } from '../states';
import { WindowCommand } from '../../../shared/megamud/toggles';

/** `0x803`: walking on or off; on, the task is the path's (or nothing to walk to, off again). */
export function goStop(s: Session): void {
  if (s.walking !== 0 && s.dontAttackHere !== 0) {
    s.dontAttackHere = 0;
    s.host.show("[Don't attack flag cleared from room.]");
  }
  s.rescueCount = 0;
  s.movementHalted = 0;
  s.walking = s.walking === 0 ? 1 : 0;
  modeDefaults(s);
  if (s.walking === 0) {
    // `0x4c0980`: auto-combat back from a detour.
    if (s.detourCombat !== -1) reEngage(s);
    setTask(s, Task.InGame);
    return;
  }
  setTask(
    s,
    s.lost !== 0
      ? Task.Lost
      : s.looping !== 0
        ? Task.Looping
        : s.roaming !== 0
          ? Task.Roaming
          : Task.Walking
  );
  const task = s.task;
  if (
    (task === Task.Walking || task === Task.Looping || task === Task.Lost) &&
    s.detours[0]!.room === 0 &&
    s.detours[0]!.path === ''
  ) {
    s.walking = 0;
    setTask(s, Task.InGame);
  }
  if (s.task !== Task.InGame) {
    s.hidden = 0;
    wake(s);
  }
}

/**
 * `0x7d4` online: the player's Disconnect (its "Are you sure" is the app's).
 * Hung up on purpose (`skipRedialOnce`), so the close that follows is not redialled
 * as a lost carrier; walking and following stopped, out of the game.
 */
export function disconnect(s: Session): void {
  s.lastWindowCommandAt = s.now;
  s.noRedial = 0;
  s.skipRedialOnce = 1;
  s.walking = 0;
  s.following = 0;
  hangUp(s, 0);
  s.inGame = 0;
  goOnline(s, 0);
  setTask(s, Task.InGame);
}

/** `0x808`: roaming (and so walking) on or off; the loop let go. */
export function roam(s: Session): void {
  const was = s.roaming;
  s.looping = 0;
  s.movementHalted = 0;
  s.roaming = was === 0 ? 1 : 0;
  s.walking = s.roaming;
  if (was === 0) {
    s.hidden = 0;
    setTask(s, Task.Roaming);
    wake(s);
  } else {
    setTask(s, Task.InGame);
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
  s.movementHalted = 0;
  runBack(s, 1);
}

/** `0x4aa740`: back to idle, unless waiting on one of the states above `State.Unknown_14`. */
function settle(s: Session): void {
  if (s.state <= State.Unknown_14) setState(s, State.Nothing);
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
    s.runByChoice = 0;
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
  const was = s.allOff;
  s.movementHalted = 0;
  s.allOff = was === 0 ? 1 : 0;
  if (was !== 0 && s.inGame === 0) {
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
  | 'preferMelee';

/**
 * The plain toggles: flipped, and then idle again — always (bless, light),
 * only in a fight (pre-attack, nuke, melee), or not at all (the rest).
 */
const PLAIN: Record<number, [Toggled, 'always' | 'fighting' | 'never']> = {
  [WindowCommand.AutoGet]: ['MegaMud_AutoGet', 'never'],
  [WindowCommand.AutoSearch]: ['MegaMud_AutoSearch', 'never'],
  [WindowCommand.AutoSneak]: ['MegaMud_AutoSneak', 'never'],
  [WindowCommand.AutoTrack]: ['MegaMud_AutoTrack', 'never'],
  [WindowCommand.AutoHide]: ['MegaMud_AutoHide', 'never'],
  [WindowCommand.AutoCash]: ['MegaMud_AutoCash', 'never'],
  [WindowCommand.AutoBless]: ['MegaMud_AutoBless', 'always'],
  [WindowCommand.AutoLight]: ['MegaMud_AutoLight', 'always'],
  [WindowCommand.AutoPreAttack]: ['MegaMud_AutoPreAttack', 'fighting'],
  [WindowCommand.AutoNuke]: ['MegaMud_AutoNuke', 'fighting'],
  [WindowCommand.Melee]: ['preferMelee', 'fighting']
};

/**
 * A window command the player gave, rather than one the engine posted
 * (`0x462d20` with its `lParam` not -1): with User input cancels AFK mode
 * (`MegaMud.AutoAfkOff`), any but AFK itself ends AFK first, read 2026-10-16.
 */
export function playerCommand(s: Session, command: number): void {
  if (command !== WindowCommand.Afk && s.MegaMud_AutoAfkOff !== 0) setActive(s, 0);
  menuCommand(s, command);
}

/**
 * `0x4172b0`, `0x4b5150`: a key pressed in the terminal, or a line entered:
 * the idle clock the AFK check counts from stamped, and AFK, with User input
 * cancels AFK mode (`MegaMud.AutoAfkOff`), ended. Read 2026-10-16.
 */
export function playerKey(s: Session): void {
  s.now = s.host.clock();
  s.lastKeyAt = s.now;
  if (s.active === 1) {
    if (s.MegaMud_AutoAfkOff !== 0) setActive(s, 0);
    modeDefaults(s);
  }
}

/**
 * A window command posted (`0x460b90`) and run now: the ones the engine has.
 * Every one stamps the idle clock the AFK check counts from (`0x462d20`).
 */
export function menuCommand(s: Session, command: number): void {
  s.lastWindowCommandAt = s.now;
  if (command === WindowCommand.GoStop) goStop(s);
  else if (command === WindowCommand.Roam) roam(s);
  else if (command === WindowCommand.Afk) afk(s);
  else if (command === WindowCommand.StepBack) stepBack(s);
  else if (command === WindowCommand.AutoCombat) autoCombat(s);
  else if (command === WindowCommand.AutoHeal) autoHeal(s);
  else if (command === WindowCommand.AllOff) allOff(s);
  else if (command === WindowCommand.NoHangup)
    s.MegaMud_NoHangup = s.MegaMud_NoHangup === 0 ? 1 : 0;
  else {
    const plain = PLAIN[command];
    if (!plain) return;
    const [field, idle] = plain;
    s[field] = s[field] === 0 ? 1 : 0;
    if (idle === 'always' || (idle === 'fighting' && s.inCombat !== 0)) settle(s);
    wake(s);
  }
}
