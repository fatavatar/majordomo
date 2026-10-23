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
import { ARENA, type Session } from '../Session';
import { indexFrom, indexOf } from '../cstr';
import { postMeditate, preMeditate, preRest } from '../health/prepost';
import { State } from '../states';
import { Darkness, Stance } from '../flags';

/** `0x54b010`: what MegaMUD sends after `You are now meditating` when it owes the pre-meditate command. */
const MEDITATE = 'med\r';

export function restLine(s: Session, line: string): number {
  if (indexOf(line, 'You are now resting') !== -1) {
    s.resting = 1;
    s.meditating = 0;
    s.hidden = 0;
    s.sneaking = 0;
    if (s.state === State.RestAsked || s.state === State.MeditateAsked) setState(s, State.Resting);
    if (s.allOff === 0 && s.MegaMud_AutoHeal !== 0 && preRest(s, 0) !== 0) send(s, 'rest\r');
    return 1;
  }
  if (indexOf(line, 'You are now meditating') !== -1) {
    s.resting = 0;
    s.meditating = 1;
    s.hidden = 0;
    s.sneaking = 0;
    if (s.state === State.RestAsked || s.state === State.MeditateAsked)
      setState(s, State.Meditating);
    if (
      s.allOff === 0 &&
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
    if (s.state === State.Meditating) setState(s, State.Nothing);
    postMeditate(s, 0);
    return 1;
  }
  if (s.BBS_GreaterMUD !== 0 && line.startsWith('Typing STAT')) {
    s.statPagerUp = 1;
    s.waitPrompt = 1;
    s.waitLines = 6;
    return 1;
  }
  if (indexOf(line, 'Your search revealed nothing') !== -1) {
    s.hidden = 0;
    s.sneaking = 0;
    setState(s, State.Nothing);
    return 1;
  }
  if (indexOf(line, ' hiding in the shadows') !== -1) {
    s.lookDue = 1;
    return 1;
  }
  if (
    indexOf(line, 'Your lamp runs out of oil') !== -1 ||
    indexOf(line, 'Your torch flickers and ') !== -1
  ) {
    s.weightMax = 0;
    return 1;
  }
  if (
    indexOf(line, 'The room is barely visible') !== -1 ||
    indexOf(line, 'The room is dimly lit') !== -1
  ) {
    s.darkness = Darkness.Dim;
    return 1;
  }
  if (
    indexOf(line, 'The room is pitch black') !== -1 ||
    indexOf(line, 'The room is very dark') !== -1
  ) {
    if (s.darkness < Darkness.Dark) s.darkness = Darkness.Dark;
    if (s.redisplayDue !== 0 || s.state === State.GetExits) s.waitLines = 0;
    if (s.state === State.Moving) {
      s.lookDue = 0;
      s.redisplayDue = 0;
      const expected = s.expectedRoom;
      const was = s.roomSignature;
      if (
        s.walking !== 0 &&
        s.following === 0 &&
        s.path.steps !== null &&
        expected !== 0 &&
        expected !== was
      ) {
        // Walking blind: the room is taken to be the one the path expected.
        s.roomSignature = expected;
        s.roomNameHash = expected;
        s.roomRecord = s.data.rooms?.find((r) => r.signature === expected) ?? null;
        if (s.roomRecord) s.roomName = s.roomRecord.name.slice(0, 0x34);
        if (s.inCombat === 0 && s.roomSignature !== was) unkeepAll(s);
        s.darkMisses = 0;
        s.darkTries = 0;
      }
      s.expectedRoom = 0;
    }
    if (s.state !== State.Moving && s.state !== State.GetExits) return 1;
    setState(s, State.Nothing);
    return 1;
  }
  if (indexOf(line, 'Your tracking skills fail you') !== -1) {
    s.chaseTarget = '';
    setState(s, State.Nothing);
    return 1;
  }
  const went = indexOf(line, ' went ');
  if (went !== -1 && indexFrom(line, went, ' from here') !== -1) {
    if (s.allOff === 0) {
      const n = Math.min(went, 10);
      s.chaseTarget = line.slice(0, n);
      if (s.runDirection === -1) s.runDirection = directionOf(line.slice(n + 6));
    }
    setState(s, State.Nothing);
    return 1;
  }
  if (indexOf(line, 'You just paid ') !== -1) {
    s.weightMax = 0;
    return 1;
  }
  const searching = indexOf(line, ' is searching the area');
  if (searching !== -1) {
    if (s.hidden !== 0) {
      s.hidden = 0;
      s.hideAgain = 1;
    }
    const who = line.slice(0, Math.min(searching, 10));
    if (!findEntity(s, who, 0)) s.lookDue = 1;
    return 1;
  }
  const peeks = indexOf(line, ' peeks in from ');
  if (peeks !== -1) {
    const p = findPlayer(s, line.slice(0, Math.min(peeks, 10)));
    if (!p || p.kind !== Stance.Hangup || s.roomSignature === ARENA || hangupAllowed(s) === 0)
      return 1;
    s.host.trace('[Hangup player/monster detected]');
    s.noRedial = 1;
    s.skipRedialOnce = 1;
    hangUp(s, 1);
    return 1;
  }
  if (indexOf(line, 'too far to the evil side') !== -1) {
    s.inCombat = 0;
    setState(s, State.Nothing);
    s.lookDue = 1;
    if (s.BBS_IsMudop === 0 || s.allOff !== 0) return 1;
    send(s, 'sys god ');
    send(s, s.Player_Name);
    send(s, ' add evil -100\r');
    return 1;
  }
  if (indexOf(line, 'You swallow some of the scummy') !== -1) {
    if (s.state === State.Nothing) s.runCount += 1;
    return 1;
  }
  if (indexOf(line, 'You may not telepath') !== -1) {
    if (s.allOff === 0) send(s, 'set tele on\r');
    return 1;
  }
  return indexOf(line, 'You row ') !== -1 ? 1 : 0;
}
