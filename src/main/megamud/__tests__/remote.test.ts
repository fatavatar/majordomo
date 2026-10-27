import { describe, expect, it } from 'vitest';

import { grantPlayers } from '../character';
import { newPlayer } from '../data';
import { addMember } from '../party/members';
import { locationLine } from '../room/where';
import { remoteCommand } from '../talk/remote';
import { session } from './fixture';
import { PlayerFlag, PartyFlag, Exit } from '../flags';

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

  /* Skinny answered Fatty {HP=936/916} fifty-two times, unreadable to him (2026-10-04). */
  it('never answers @health with a figure over its maximum', () => {
    const { s } = remote();
    addMember(s, 'Skinny', 0);
    addMember(s, 'Fatty', 1);
    s.hp = 1470;
    s.Player_MaxHP = 1420;
    expect(remoteCommand(s, tele('@health'), 0x10)).toBe(1);
    expect(pending(s)).toEqual(['/Fatty {HP=1470/1470}\r']);
  });

  /* Our grants' Auto Invite when seen and Join When Invited, as MegaMUD's player flags (2026-10-15). */
  it('takes our grants’ party flags as MegaMUD’s', () => {
    const { s } = remote();
    grantPlayers(
      s,
      {
        fatty: { allow: ['join'], deny: [] },
        stranger: { allow: [], deny: [], autoInviteWhenSeen: true }
      },
      true
    );
    const flags = (name: string) =>
      s.data.players!.find((p) => p.name === name)!.flags &
      (PlayerFlag.InviteIfSeen | PlayerFlag.JoinIfInvited);
    expect([flags('Fatty'), flags('Stranger')]).toEqual([0x20, 0x10]);
    grantPlayers(s, { fatty: { allow: ['join'], deny: [] } }, false);
    expect(flags('Fatty')).toBe(0);
  });

  /* The Party card's roster leaves a member who said @forget out of Regroup (2026-10-27). */
  it('takes a member who says @forget out of the party, and says who to the host', () => {
    const { s } = remote();
    addMember(s, 'Fatty', 1);
    const forgot: string[] = [];
    s.host.partyForgot = (name) => forgot.push(name);
    remoteCommand(s, tele('@forget'), 0x10);
    expect(forgot).toEqual(['Fatty']);
    expect(s.party.slice(0, s.partySize).map((m) => m.name)).not.toContain('Fatty');
  });

  /* The Party card had this character do it itself: the leader's @party is not done again (2026-10-27). */
  it('leaves a leader’s @party the client already had it do, and does any other', () => {
    const { s } = remote(0x2000);
    s.leaderName = 'Fatty';
    addMember(s, 'Fatty', 1);
    const asked: string[] = [];
    s.host.partyAlreadyDone = (leader, command) => {
      asked.push(`${leader}: ${command}`);
      return command === 'sys goto kha';
    };
    remoteCommand(s, tele('@party sys goto kha'), 0x10);
    remoteCommand(s, tele('@party eq tabard'), 0x10);
    expect(asked).toEqual(['Fatty: sys goto kha', 'Fatty: eq tabard']);
    expect(pending(s)).toEqual(['eq tabard\r']);
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
    expect(s.party[0]!.flags28 & (PartyFlag.AskedToWait | PartyFlag.AskedForHeal)).toBe(0x20020);
    remoteCommand(s, tele('@ok'), 0x10);
    expect(s.partyWait).toBe(0);
    expect(s.party[0]!.hpPct).toBe(100);
  });

  it('marks a member asking for a cure', () => {
    const { s } = remote();
    addMember(s, 'Fatty', 1);
    remoteCommand(s, 'Fatty says "@held"', 1);
    expect(s.party[0]!.flags28 & PartyFlag.Held).toBe(0x8000);
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
    s.roomExits[0] = Exit.Open;
    s.roomExits[2] = Exit.Open;
    remoteCommand(s, tele('@where'), 0x10);
    expect(pending(s)).toEqual(['/Fatty {Town Square (Exits: N,E)}\r']);
    s.pending = [];
    s.Talk_WhereUseRm = 1;
    s.roomSignature = 0x1234;
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

/* The player's own commands others may ask for (2026-10-15). */
describe('bot commands', () => {
  const heal = {
    word: '@heal',
    send: 'mend {source}',
    reply: '{healing}',
    party: false,
    gang: false,
    anyone: false,
    players: ['stranger']
  };

  it('answers a named player with what it sends and its reply, the asker as {source}', () => {
    const { s } = remote();
    s.botCommands = [heal];
    remoteCommand(s, 'Stranger telepaths: @heal', 0x10);
    expect(pending(s)).toEqual(['mend Stranger\r', '/Stranger {healing}\r']);
  });

  it('answers nobody it does not name, and leaves a party member’s @heal to MegaMUD', () => {
    const { s } = remote();
    s.botCommands = [{ ...heal, players: [] }];
    addMember(s, 'Skinny', 0);
    addMember(s, 'Fatty', 1);
    remoteCommand(s, 'Stranger telepaths: @heal', 0x10);
    remoteCommand(s, tele('@heal'), 0x10);
    // MegaMUD's own refusal, as for any command the stranger may not use.
    expect(pending(s)).toEqual(['/Stranger {command invalid or not allowed}\r']);
    expect(s.party.find((m) => m.name === 'Fatty')!.flags28 & PartyFlag.AskedForHeal).toBe(0x20000);
  });

  it('answers anyone, a player it has no record of included, when it says so', () => {
    const { s } = remote();
    s.botCommands = [{ ...heal, players: [], anyone: true, reply: '' }];
    remoteCommand(s, 'Nobody telepaths: @heal', 0x10);
    expect(pending(s)).toEqual(['mend Nobody\r']);
  });
});
