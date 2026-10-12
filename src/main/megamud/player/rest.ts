/**
 * Lines about resting, meditating, light, tracking and being looked for
 * (`0x47a7e0`). Read 2026-10-12.
 *
 * `You are now resting` and `You are now meditating` confirm a sit-down asked
 * for (state 2 or 4 becomes 3 or 5), and with automation on send the
 * pre-rest or pre-meditate command, then `rest` again (or the meditation
 * command, `0x54b010`). Waking from meditation sends the post-meditate one.
 */
import { findEntity } from '../room/entities';
import { directionOf } from '../move/exits';
import { findPlayer, hangupAllowed } from '../room/checkNames';
import { unkeepAll } from '../room/entities';
import { hangUp } from '../script/game';
import { send } from '../script/send';
import { setState } from '../script/state';
import type { Session } from '../Session';
import { indexFrom, indexOf } from '../cstr';
import { postMeditate, preMeditate, preRest } from '../health/prepost';

/** `0x54b010`: what MegaMUD sends after `You are now meditating` when it owes the pre-meditate command. */
export const MEDITATE = 'med\r';

export function restLine(s: Session, line: string): number {
  if (indexOf(line, 'You are now resting') !== -1) {
    s.resting = 1;
    s.meditating = 0;
    s.hidden = 0;
    s.sneaking = 0;
    if (s.state === 2 || s.state === 4) setState(s, 3);
    if (s.f_a32c === 0 && s.MegaMud_AutoHeal !== 0 && preRest(s, 0) !== 0) send(s, 'rest\r');
    return 1;
  }
  if (indexOf(line, 'You are now meditating') !== -1) {
    s.resting = 0;
    s.meditating = 1;
    s.hidden = 0;
    s.sneaking = 0;
    if (s.state === 2 || s.state === 4) setState(s, 5);
    if (
      s.f_a32c === 0 &&
      s.MegaMud_AutoHeal !== 0 &&
      s.Health_UseMeditate !== 0 &&
      preMeditate(s, 0) !== 0
    ) {
      send(s, MEDITATE);
    }
    return 1;
  }
  if (indexOf(line, 'You awake from deep meditation feeling stronger') !== -1) {
    s.resting = 0;
    s.meditating = 0;
    s.hidden = 0;
    s.sneaking = 0;
    if (s.state === 5) setState(s, 0);
    postMeditate(s, 0);
    return 1;
  }
  if (s.BBS_GreaterMUD !== 0 && line.startsWith('Typing STAT')) {
    s.f_e2a0 = 1;
    s.waitPrompt = 1;
    s.waitLines = 6;
    return 1;
  }
  if (indexOf(line, 'Your search revealed nothing') !== -1) {
    s.hidden = 0;
    s.sneaking = 0;
    setState(s, 0);
    return 1;
  }
  if (indexOf(line, ' hiding in the shadows') !== -1) {
    s.f_e290 = 1;
    return 1;
  }
  if (
    indexOf(line, 'Your lamp runs out of oil') !== -1 ||
    indexOf(line, 'Your torch flickers and ') !== -1
  ) {
    s.f_8468 = 0;
    return 1;
  }
  if (
    indexOf(line, 'The room is barely visible') !== -1 ||
    indexOf(line, 'The room is dimly lit') !== -1
  ) {
    s.darkness = 1;
    return 1;
  }
  if (
    indexOf(line, 'The room is pitch black') !== -1 ||
    indexOf(line, 'The room is very dark') !== -1
  ) {
    if (s.darkness < 2) s.darkness = 2;
    if (s.f_e294 !== 0 || s.state === 0x2b) s.waitLines = 0;
    if (s.state === 0x16) {
      s.f_e290 = 0;
      s.f_e294 = 0;
      const expected = s.f_8138;
      const was = s.f_8130;
      if (
        s.f_e184 !== 0 &&
        s.following === 0 &&
        s.f_e41c !== 0 &&
        expected !== 0 &&
        expected !== was
      ) {
        // Walking blind: the room is taken to be the one the path expected.
        s.f_8130 = expected;
        s.roomNameHash = expected;
        s.roomRecord = s.data.rooms?.find((r) => r.signature === expected) ?? null;
        if (s.roomRecord) s.roomName = s.roomRecord.name.slice(0, 0x34);
        if (s.inCombat === 0 && s.f_8130 !== was) unkeepAll(s);
        s.f_db74 = 0;
        s.f_db78 = 0;
      }
      s.f_8138 = 0;
    }
    if (s.state !== 0x16 && s.state !== 0x2b) return 1;
    setState(s, 0);
    return 1;
  }
  if (indexOf(line, 'Your tracking skills fail you') !== -1) {
    s.chaseTarget = '';
    setState(s, 0);
    return 1;
  }
  const went = indexOf(line, ' went ');
  if (went !== -1 && indexFrom(line, went, ' from here') !== -1) {
    if (s.f_a32c === 0) {
      const n = Math.min(went, 10);
      s.chaseTarget = line.slice(0, n);
      if (s.runDirection === -1) s.runDirection = directionOf(line.slice(n + 6));
    }
    setState(s, 0);
    return 1;
  }
  if (indexOf(line, 'You just paid ') !== -1) {
    s.f_8468 = 0;
    return 1;
  }
  const searching = indexOf(line, ' is searching the area');
  if (searching !== -1) {
    if (s.hidden !== 0) {
      s.hidden = 0;
      s.f_e1d0 = 1;
    }
    const who = line.slice(0, Math.min(searching, 10));
    if (!findEntity(s, who, 0)) s.f_e290 = 1;
    return 1;
  }
  const peeks = indexOf(line, ' peeks in from ');
  if (peeks !== -1) {
    const p = findPlayer(s, line.slice(0, Math.min(peeks, 10)));
    if (!p || p.kind !== 6 || s.f_8130 === 0x67110001 || hangupAllowed(s) === 0) return 1;
    s.host.trace('[Hangup player/monster detected]');
    s.f_30de8 = 1;
    s.f_30de4 = 1;
    hangUp(s, 1);
    return 1;
  }
  if (indexOf(line, 'too far to the evil side') !== -1) {
    s.inCombat = 0;
    setState(s, 0);
    s.f_e290 = 1;
    if (s.BBS_IsMudop === 0 || s.f_a32c !== 0) return 1;
    send(s, 'sys god ');
    send(s, s.Player_Name);
    send(s, ' add evil -100\r');
    return 1;
  }
  if (indexOf(line, 'You swallow some of the scummy') !== -1) {
    if (s.state === 0) s.runCount += 1;
    return 1;
  }
  if (indexOf(line, 'You may not telepath') !== -1) {
    if (s.f_a32c === 0) send(s, 'set tele on\r');
    return 1;
  }
  return indexOf(line, 'You row ') !== -1 ? 1 : 0;
}
