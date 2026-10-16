/**
 * `0x4118f0` (D31): leaving the game, read 2026-10-12: for a BBS shutdown
 * (`exitForShutdown`; rested to full HP first), a timed logoff (`exitForLogoff`), or a relog
 * or hang-up (`exitForRelog`), once no monster is here: task `0x13`, the exit
 * command (`Other.ExitCmd`) and `x`.
 */
import { enemiesHere } from '../room/entities';
import type { Session } from '../Session';
import { expandMacros, send } from './send';
import { forgetAwaited, setState } from './state';
import { setTask, Task } from './task';
import { State } from '../states';

export function exitStep(s: Session): number {
  if (s.exitForShutdown === 0 && s.exitForLogoff === 0 && s.exitForRelog === 0) return 0;
  if (enemiesHere(s, 0) !== 0) return 0;
  if (s.task === Task.Exiting) return 1;
  if (s.exitForShutdown !== 0) {
    if (s.hp < s.Player_MaxHP) {
      s.restHpToFull = 1;
      s.hpFullAt = 0;
      s.manaFullAt = 0;
      return 0;
    }
    s.host.activity('Exiting because BBS is being shutdown');
  }
  if (s.exitForLogoff !== 0) s.host.activity('Exiting because of timed logoff');
  if (s.exitForRelog !== 0) s.host.activity('Exiting because we need to relog or hangup');
  if (s.hp <= 0) return 0;
  leaveGame(s);
  return 1;
}

/** Task `0x13`, the exit command (`Other.ExitCmd`) and `x`. */
export function leaveGame(s: Session): void {
  setTask(s, Task.Exiting);
  forgetAwaited(s, s.state);
  setState(s, State.Nothing);
  if (s.Other_ExitCmd !== '') {
    let text = expandMacros(s, s.Other_ExitCmd);
    if (!text.endsWith('\r')) text += '\r';
    send(s, text);
  }
  send(s, 'x\r');
}
