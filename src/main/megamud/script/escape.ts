/**
 * `0x40dc20`: the MUD op's escape, read 2026-10-12. A character that is a MUD
 * op (`BBS.IsMudop`) with a `SysGoto` room, whose HP fall below the hang-up
 * level (`0x40db40`) where hanging up is allowed, breaks off, `sys goto`es
 * there and rests to full, leaving the party. Scheduler step D30 (with
 * monsters here), and on `*Combat Engaged*` and each blow taken.
 */
import { combatOff } from '../combat/engaged';
import { belowLogoff } from '../health/flux';
import { unkeepAll } from '../room/entities';
import { ARENA, type Session } from '../Session';
import { queue, send } from './send';
import { setState } from './state';
import { State } from '../states';

/** The rest the escape leaves behind it: HP to full, nothing to run from. */
function restAfter(s: Session): void {
  s.restHpToFull = 1;
  s.healthFirst = 1;
  s.mustRest = 1;
  s.runCount = 0;
  s.rescueCount = 0;
}

export function escapeCheck(s: Session, why: string): number {
  if (s.BBS_IsMudop === 0 || s.hp < 1 || s.BBS_SysGoto === '') return 0;
  if (belowLogoff(s, s.hp) === 0 || s.inGame === 0) return 0;
  if (s.allOff !== 0 && s.Other_HangupAllOff === 0) return 0;
  if (s.active === 0 && s.Other_HangupNotAfk === 0) return 0;
  if (s.roomSignature === ARENA || s.state === State.Hanging || s.state === State.Relogging)
    return 0;
  if (s.MegaMud_NoHangup !== 0) return 0;
  const wait = Math.max(s.Comms_LagWait + 2, 2);
  if (
    (s.state === State.Teleported || s.stateBefore === State.Teleported) &&
    s.now - s.stateSince < wait
  ) {
    s.lowHpArmed = 0;
    s.inCombat = 0;
    s.attackDue = 0;
    restAfter(s);
    s.waitLines = 2;
    s.host.activity('Waiting to retry low-HP MudOp escape');
    return 0;
  }
  s.host.trace(
    why !== '' ? `[HPs critical; mudop escape: ${why}]` : '[HPs critical; mudop escape]'
  );
  s.lowHpArmed = 0;
  s.inCombat = 0;
  s.attackDue = 0;
  send(s, 'break\r');
  send(s, 'sys goto ');
  send(s, s.BBS_SysGoto);
  send(s, '\r');
  send(s, 'rest\r');
  setState(s, State.Teleported);
  s.stateSince = s.now;
  s.restReason = "resting HP's to full";
  restAfter(s);
  s.hpFullAt = 0;
  s.waitLines = 2;
  combatOff(s);
  if (s.following !== 0) queue(s, `/${s.leaderName} @forget\r`);
  s.partySize = 0;
  s.following = 0;
  unkeepAll(s);
  s.lookDue = 1;
  s.weightMax = 0;
  return 1;
}
