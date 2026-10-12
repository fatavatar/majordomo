import { describe, expect, it } from 'vitest';

import { newPlayer } from '../data';
import { addMember } from '../party/members';
import { locationLine } from '../room/where';
import { remoteCommand } from '../talk/remote';
import { session } from './fixture';

/* `0x4ae4a0` and `0x4b6600`, read 2026-10-12; the commands are MegaMUD's help's "Remote control". */

function remote(remoteBits = 0) {
  const r = session();
  const { s } = r;
  s.inGame = 1;
  s.Player_Name = 'Skinny';
  s.hp = 70;
  s.Player_MaxHP = 1182;
  for (const name of ['Fatty', 'Skinny', 'Stranger']) newPlayer(s.data, 0).name = name;
  s.data.players![0]!.remote = remoteBits;
  return r;
}

const pending = (s: { pending: { text: string }[] }): string[] => s.pending.map((p) => p.text);

const tele = (text: string): string => `Fatty telepaths: ${text}`;

describe('the remote commands (0x4ae4a0)', () => {
  it('answers @health to a party member, by telepath', () => {
    const { s } = remote();
    addMember(s, 'Skinny', 0);
    addMember(s, 'Fatty', 1);
    s.resting = 1;
    s.poisoned = 1;
    expect(remoteCommand(s, tele('@health'), 0x10)).toBe(1);
    expect(pending(s)).toEqual(['/Fatty {HP=70/1182, Resting, Poisoned}\r']);
  });

  it('gives a stranger nothing it is not allowed, with the command reply', () => {
    const { s } = remote();
    expect(remoteCommand(s, 'Stranger telepaths: @health', 0x10)).toBe(0);
    expect(pending(s)).toEqual(['/Stranger {command invalid or not allowed}\r']);
  });

  it("reads a member's {HP=} report", () => {
    const { s } = remote();
    addMember(s, 'Fatty', 1);
    remoteCommand(s, tele('{HP=300/400,MA=50/100, Resting}'), 0x10);
    const m = s.party[0]!;
    expect([m.hp, m.maxHp, m.hpPct, m.mana, m.maxMana, m.manaPct]).toEqual([
      300, 400, 75, 50, 100, 50
    ]);
  });

  it('waits for a member who asks, and goes on when all are rested', () => {
    const { s } = remote();
    addMember(s, 'Fatty', 0);
    addMember(s, 'Skinny', 1);
    s.leaderName = 'Skinny';
    expect(remoteCommand(s, tele("@wait (HP's too low)"), 0x10)).toBe(1);
    expect(s.partyWait).toBe(1);
    expect(s.party[0]!.flags28 & 0x20020).toBe(0x20020);
    remoteCommand(s, tele('@ok'), 0x10);
    expect(s.partyWait).toBe(0);
    expect(s.party[0]!.hpPct).toBe(100);
  });

  it('marks a member asking for a cure', () => {
    const { s } = remote();
    addMember(s, 'Fatty', 1);
    remoteCommand(s, 'Fatty says "@held"', 1);
    expect(s.party[0]!.flags28 & 0x8000).toBe(0x8000);
  });

  it('switches a setting for a player allowed to (0x800), in a say', () => {
    const { s } = remote(0x800);
    s.MegaMud_AutoCombat = 1;
    remoteCommand(s, 'Fatty says "@auto-combat off"', 1);
    expect(s.MegaMud_AutoCombat).toBe(0);
    expect(pending(s)).toEqual(['>Fatty {auto-combat now OFF}\r']);
  });

  it('lists the settings on and off', () => {
    const { s } = remote(0x800);
    s.MegaMud_AutoCombat = 0;
    remoteCommand(s, tele('@settings'), 0x10);
    const [on, off] = pending(s);
    expect(on!.startsWith('/Fatty {ON: Pre(attacks),')).toBe(true);
    expect(off!.startsWith('/Fatty {OFF: Combat')).toBe(true);
  });

  it('refuses a command that carries another, or mentions suicide', () => {
    const { s } = remote(0x200);
    remoteCommand(s, tele('@do say hi @do suicide'), 0x10);
    expect(pending(s)).toEqual(['/Fatty {command invalid or not allowed}\r']);
  });

  it('runs @do for a player allowed commands, but not a MUD op sys without 0x2000', () => {
    const { s } = remote(0x200);
    remoteCommand(s, tele('@do smile'), 0x10);
    expect(pending(s)).toEqual(['smile\r', '/Fatty {ok}\r']);
    s.pending = [];
    remoteCommand(s, tele('@do sys goto 1'), 0x10);
    expect(pending(s)).toEqual([]);
  });

  it("takes the leader's @party command", () => {
    const { s } = remote();
    addMember(s, 'Fatty', 1);
    addMember(s, 'Skinny', 0);
    s.leaderName = 'Fatty';
    s.following = 1;
    expect(remoteCommand(s, 'Fatty says "@party go hole"', 1)).toBe(1);
    expect(pending(s)).toEqual(['go hole\r']);
  });

  it('diverts talk to the first who asks, until they say it again', () => {
    const { s } = remote(0x1000);
    remoteCommand(s, tele('@divert'), 0x10);
    expect(s.divertTo).toBe('Fatty');
    remoteCommand(s, tele('@divert'), 0x10);
    expect(s.divertTo).toBe('');
    expect(pending(s)).toEqual(['/Fatty {ok}\r', '/Fatty {off}\r']);
  });

  it('answers @where with the room, or with its map numbers after an rm', () => {
    const { s } = remote(0x10);
    s.roomName = 'Town Square';
    s.roomExits[0] = 1;
    s.roomExits[2] = 1;
    remoteCommand(s, tele('@where'), 0x10);
    expect(pending(s)).toEqual(['/Fatty {Town Square (Exits: N,E)}\r']);
    s.pending = [];
    s.Talk_WhereUseRm = 1;
    s.f_8130 = 0x1234;
    remoteCommand(s, tele('@where'), 0x10);
    expect(pending(s)).toEqual(['rm\r']);
    locationLine(s, 'Location: 12,345');
    expect(pending(s)).toEqual(['rm\r', '/Fatty {Town Square (Exits: N,E) - 12/345}\r']);
  });

  it('pages back to the user ID', () => {
    const { s } = remote(4);
    s.data.players![0]!.userId = 'fatman';
    s.Player_Lives = 0;
    remoteCommand(s, 'fatman is paging you from the Main Menu: @lives', 0x20);
    expect(pending(s)).toEqual(['/p fatman {0 lives remaining}\r']);
  });

  it('gives the AFK reply to someone talking to this character', () => {
    const { s } = remote();
    s.active = 1;
    remoteCommand(s, 'Stranger says (to you) "hello"', 1);
    expect(pending(s)).toEqual(['>Stranger {AFK}\r']);
  });

  it('ignores its own lines and diverted ones', () => {
    const { s } = remote(0xffff);
    expect(remoteCommand(s, 'Skinny telepaths: @health', 0x10)).toBe(0);
    expect(remoteCommand(s, 'Fatty telepaths: {==> @health}', 0x10)).toBe(0);
    expect(pending(s)).toEqual([]);
  });
});
