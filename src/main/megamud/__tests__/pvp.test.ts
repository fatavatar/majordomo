import { describe, expect, it } from 'vitest';

import { newPlayer } from '../data';
import { combatEventLine, knownPlayer, pvpAttack } from '../combat/events';
import { comingsLine } from '../room/comings';
import { partyIndex } from '../room/checkNames';
import { addMember, partyRefresh } from '../party/members';
import { newEntity } from '../Session';
import { grantPlayers, setPlayerStance, stanceName } from '../character';
import { session } from './fixture';

/* `0x42b8f0`, `0x472d10` and `0x4816b0`, read 2026-10-14. */

function inGame() {
  const fixture = session();
  const { s, clock } = fixture;
  s.inGame = 1;
  s.online = 1;
  s.hp = 100;
  s.Player_MaxHP = 100;
  s.Player_Name = 'Skinny';
  s.now = clock.now;
  return fixture;
}

describe('a player attacking (0x42b8f0)', () => {
  it('is a player only where the room, who or the known players say so', () => {
    const { s } = inGame();
    expect(knownPlayer(s, 'Nobody')).toBe(0);
    newPlayer(s.data, s.now).name = 'Bob';
    expect(knownPlayer(s, 'Bob')).toBe(1);
    s.room = [Object.assign(newEntity(), { type: 2, name: 'Rat' })];
    expect(knownPlayer(s, 'Rat')).toBe(0);
  });

  it('hangs up by default, marks them an enemy and takes their remote control', () => {
    const { s, out } = inGame();
    const bob = newPlayer(s.data, s.now);
    Object.assign(bob, { name: 'Bob', remote: 0x200, kind: 3 });
    s.PvP_PvpAction = 0;
    pvpAttack(s, 'Bob', 1);
    expect(out.trace.join('')).toContain('[PVP detected!');
    expect(s.skipRedialOnce).toBe(1);
    expect(bob.kind).toBe(4);
    expect(bob.remote).toBe(0);
    expect(s.room.some((e) => e.name === 'Bob' && e.player === bob)).toBe(true);
  });

  /* The Player flyout's relationship (2026-11-10): the mark a blow made, taken back. */
  it('clears the mark from the flyout, in the room too, and applies a stance a grant holds', () => {
    const { s } = inGame();
    const bob = newPlayer(s.data, s.now);
    Object.assign(bob, { name: 'Bob', remote: 0x200, kind: 3 });
    s.PvP_PvpAction = 0;
    pvpAttack(s, 'Bob', 1);
    expect(stanceName(bob.kind)).toBe('enemy');
    setPlayerStance(s, 'bob', 'unknown');
    expect([bob.kind, stanceName(bob.kind)]).toEqual([3, 'unknown']);
    expect(s.room.find((e) => e.name === 'Bob')?.kind).toBe(3);
    // A grant's stance stands over the engine's, and its remote control comes back.
    grantPlayers(s, { bob: { allow: ['health'], deny: [], stance: 'hangup' } });
    expect([stanceName(bob.kind), s.room.find((e) => e.name === 'Bob')?.kind]).toEqual([
      'hangup',
      6
    ]);
    expect(bob.remote).not.toBe(0);
    // None leaves the engine's own reading alone.
    setPlayerStance(s, 'Bob', 'friend');
    grantPlayers(s, { bob: { allow: [], deny: [] } });
    expect(stanceName(bob.kind)).toBe('friend');
  });

  it('runs and marks them one to flee with PvpAction 2', () => {
    const { s } = inGame();
    newPlayer(s.data, s.now).name = 'Bob';
    s.PvP_PvpAction = 2;
    s.PvP_FleeRooms = 7;
    pvpAttack(s, 'Bob', 1);
    expect(s.runCount).toBe(7);
    expect(s.skipRedialOnce).toBe(0);
    expect(s.room.find((e) => e.name === 'Bob')?.kind).toBe(5);
  });

  it('forgives a party member still in the party', () => {
    const { s, out } = inGame();
    const fatty = newPlayer(s.data, s.now);
    Object.assign(fatty, { name: 'Fatty', kind: 2 });
    addMember(s, 'Skinny', 0);
    addMember(s, 'Fatty', 0);
    pvpAttack(s, 'Fatty', 1);
    expect(out.sent.join('')).toBe('@OI!\r.forgive Fatty\r');
  });

  it('does nothing with PvpAction 5, and ignores a monster', () => {
    const { s, out } = inGame();
    newPlayer(s.data, s.now).name = 'Bob';
    s.PvP_PvpAction = 5;
    pvpAttack(s, 'Bob', 1);
    s.PvP_PvpAction = 0;
    s.data.monsters.push({ name: 'Orc' } as never);
    pvpAttack(s, 'Orc', 1);
    expect(out.trace).toEqual([]);
    expect(s.skipRedialOnce).toBe(0);
  });
});

/*
 * The Ethereal Prison's exits all lead back into it (2026-11-09): Skinny,
 * following Fatty, left and walked in again at every step, and MegaMUD,
 * leading, drops a member it sees leave (`0x4739f9`). His next room spell was
 * taken for PvP and Fatty hung up. The client's own party listing still had
 * him, and is asked before a member's attack is taken for a stranger's.
 */
describe('a member dropped for leaving the room, still in the party', () => {
  function leading(inParty: boolean) {
    const fixture = inGame();
    const { s } = fixture;
    s.Player_Name = 'Fatty';
    s.leaderName = 'Fatty';
    s.PvP_PvpAction = 0;
    newPlayer(s.data, s.now).name = 'Skinny';
    addMember(s, 'Fatty', 1);
    addMember(s, 'Skinny', 0);
    s.host.inParty = (name) => inParty && name === 'Skinny';
    comingsLine(s, 'Skinny just left to the east.');
    return fixture;
  }

  it('is a member again when the listing has them, and their room spell no PvP', () => {
    const { s, out } = leading(true);
    expect(partyIndex(s, 'Skinny')).toBe(-1);
    combatEventLine(s, 'Skinny moves to attack everyone in the room.');
    expect(out.trace.join('')).not.toContain('[PVP detected!');
    expect(s.skipRedialOnce).toBe(0);
    expect(s.party.slice(0, s.partySize).map((m) => m.name)).toEqual(['Fatty', 'Skinny']);
  });

  it('is still taken for PvP when the listing does not have them', () => {
    const { s, out } = leading(false);
    combatEventLine(s, 'Skinny moves to attack everyone in the room.');
    expect(out.trace.join('')).toContain('[PVP detected!');
    expect(s.skipRedialOnce).toBe(1);
  });
});

describe('the party refreshed (0x4816b0)', () => {
  it('waits, leading, for a member hurt, and gives up after PartyWaitMax minutes', () => {
    const { s, out } = inGame();
    s.leaderName = 'Skinny';
    addMember(s, 'Skinny', 0);
    addMember(s, 'Fatty', 0);
    const fatty = s.party.find((m) => m.name === 'Fatty')!;
    Object.assign(fatty, { hp: 30, maxHp: 100, flags28: 0x20 });
    partyRefresh(s, 1);
    expect(s.partyWait).toBe(1);
    expect(fatty.hpPct).toBe(30);
    fatty.hp = 90;
    s.now += s.Party_PartyWaitMax * 60;
    partyRefresh(s, 1);
    expect(out.shown.some((line) => line.startsWith('[Waiting timed out'))).toBe(true);
    expect(s.partyWait).toBe(0);
  });
});
