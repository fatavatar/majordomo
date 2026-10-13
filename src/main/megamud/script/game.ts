/**
 * Entering and leaving the game: the first prompt's set-up (`0x47b070`'s
 * tail and `0x42de00` with 1), and hanging up (`0x42d510`). Not ported yet.
 */
import type { Session } from '../Session';
import { unported } from '../unported';
import { nextEvent } from './events';
import { setState } from './state';
import { setTask } from './task';

/** The first prompt in the game. Not ported yet: marks the session in the game. */
export function enterGame(s: Session): void {
  unported('42de00');
  s.inGame = 1;
}

/** `0x42d510`: drop the connection. */
export function hangUp(_s: Session, _how: number): void {
  unported('42d510');
}

/**
 * `0x42d3f0`: the connection given up on (no BBS response, no log-on
 * progress): hung up, out of the game, and redialled after
 * `Comms.RedialPause` with `Comms.RedialNoResponse`.
 */
export function dropConnection(s: Session): void {
  s.f_30de4 = 1;
  hangUp(s, 0);
  s.host.alert?.('hangup');
  s.inGame = 0;
  s.inCombat = 0;
  s.lastTickAt = 0;
  s.f_d82c = 0;
  s.f_d820 = 0;
  s.f_d824 = 0;
  unported('42de00');
  setTask(s, 0x14);
  setState(s, 0);
  s.eventNext = nextEvent(s);
  if (s.Comms_RedialNoResponse !== 0 && s.f_30de8 === 0) {
    s.now = s.host.clock();
    s.f_e544 = 3;
    s.f_32298 = s.now + s.Comms_RedialPause;
    s.f_30dc8 = 0;
    s.f_30de4 = 0;
    unported('42de00');
    setTask(s, 9);
    s.eventNext = nextEvent(s);
  }
}
