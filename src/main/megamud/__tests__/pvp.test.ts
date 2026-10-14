import { describe, expect, it } from 'vitest';

import { newPlayer } from '../data';
import { knownPlayer, pvpAttack } from '../combat/events';
import { addMember, partyRefresh } from '../party/members';
import { newEntity } from '../Session';
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
    expect(s.f_30de4).toBe(1);
    expect(bob.kind).toBe(4);
    expect(bob.remote).toBe(0);
    expect(s.room.some((e) => e.name === 'Bob' && e.player === bob)).toBe(true);
  });

  it('runs and marks them one to flee with PvpAction 2', () => {
    const { s } = inGame();
    newPlayer(s.data, s.now).name = 'Bob';
    s.PvP_PvpAction = 2;
    s.PvP_FleeRooms = 7;
    pvpAttack(s, 'Bob', 1);
    expect(s.runCount).toBe(7);
    expect(s.f_30de4).toBe(0);
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
    expect(s.f_30de4).toBe(0);
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
