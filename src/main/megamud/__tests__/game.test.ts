import { describe, expect, it } from 'vitest';

import { settingsFromIni } from '../../../shared/megamud/settings';
import { bbsSetup } from '../bbs';
import { grantPlayers, loadCharacter, remoteBits } from '../character';
import { newPath } from '../Session';
import {
  connected,
  connectionClosed,
  enterGame,
  goOnline,
  hangUp,
  sessionEnded
} from '../script/game';
import { expandMacros } from '../script/send';
import { session } from './fixture';

/* `0x42de00`, `0x47b070`'s tail, `0x42d510`, `0x4b6fe0`, `0x42c910`'s end, `0x4acc40` and `0x41bcf0`, read 2026-10-13. */

describe('macros (0x4acc40)', () => {
  it('puts in the target, the arguments and control characters', () => {
    const { s } = session();
    s.msgTarget = 'kobold';
    s.msgArgs[1] = 'two';
    expect(expandMacros(s, 'c mmis {target}^M')).toBe('c mmis kobold\r');
    expect(expandMacros(s, 'say {2}~ok')).toBe('say two\x01ok');
    s.f_327a4 = 99;
    expect(expandMacros(s, 'a~b')).toBe('a~b');
  });

  it('keeps the exe’s quirks: an empty user-id ends the text, a lone target leaves its brace', () => {
    const { s } = session();
    expect(expandMacros(s, 'x {userid} y')).toBe('x ');
    expect(expandMacros(s, 'kill {target}!')).toBe('kill {!');
    expect(expandMacros(s, 'a^^bc')).toBe('a^c');
  });

  it('gives the password only while logging on', () => {
    const { s } = session();
    s.BBS_Password = 'pw';
    s.task = 10;
    expect(expandMacros(s, '{pswd}^M')).toBe('pw\r');
    s.task = 0xb;
    expect(expandMacros(s, '{pswd}^M')).toBe('');
  });
});

describe('the BBS set-up (0x41bcf0)', () => {
  it('starts at the loader’s defaults and reads a file over them', () => {
    const { s } = session();
    expect(s.s_7d21).toBe('.');
    expect(s.pvpLevel).toBe(99);
    bbsSetup(s, (k) => ({ RelogCmd: '=x', PvpLevel: '5' })[k]);
    expect(s.s_7cf7).toBe('=x');
    expect(s.pvpLevel).toBe(5);
    expect(s.s_7cb9).toBe('[MAJORMUD]:');
  });
});

describe('the character’s settings (0x449aa0)', () => {
  it('fills the fields and reads [Schedule], [Rules] and [AbilMon]', () => {
    const { s } = session();
    const mega = settingsFromIni(
      '[Health]\nHpRest%=55\n[Schedule]\nEvent0=1:2:30:say hi\n[Rules]\nR1=1:2:3:text\n[AbilMon]\nMonitor0=0:7:0:0:5:1:1:30:0:0:0::cast shield\n'
    );
    loadCharacter(s, mega);
    expect(s.Health_HpRestPct).toBe(55);
    expect(s.events).toHaveLength(1);
    expect(s.rules).toHaveLength(1);
    expect(s.monitors).toHaveLength(1);
  });

  /*
   * MegaMUD reads a cast limit of 0 as none; ours is no limit, ruled
   * 13 October 2026 after Skinny's cleared limit turned his attack spell off.
   */
  it('takes a combat spell’s cast limit of 0 as no limit', () => {
    const { s } = session();
    loadCharacter(s, settingsFromIni('[Combat]\nMaxCastCnt=0\nMaxCastCnt2=3\n'));
    expect(s.Combat_MaxCastCnt).toBeGreaterThan(999);
    expect(s.Combat_MaxCastCnt2).toBe(3);
  });

  it('turns the app’s per-player grants into remote bits', () => {
    expect(remoteBits(['health', 'where', 'do'], [])).toBe(0x214);
    expect(remoteBits(['health', 'status'], ['status'])).toBe(0);
    const { s } = session();
    grantPlayers(s, { soul: { allow: ['stop'], deny: [] } });
    expect(s.data.players![0]!.name).toBe('Soul');
    expect(s.data.players![0]!.remote).toBe(0x100);
  });
});

describe('online and in the game (0x42de00, 0x47b070)', () => {
  it('enters the game: in, the entry command sent, then a return', () => {
    const { s, out } = session();
    s.Other_EntryCmd = 'stat';
    enterGame(s);
    expect(s.online).toBe(1);
    expect(s.inGame).toBe(1);
    expect(s.task).toBe(0xb);
    expect(out.sent).toEqual(['stat\r', '\r']);
  });

  it('starts roaming with StartTask 2', () => {
    const { s } = session();
    s.MegaMud_StartTask = 2;
    enterGame(s);
    expect(s.task).toBe(0x10);
    expect(s.walking).toBe(1);
    expect(s.roaming).toBe(1);
  });

  it('starts the default loop with StartTask 1', () => {
    const { s } = session();
    const loop = newPath();
    loop.name = 'Loop';
    loop.start = 0x1234;
    loop.end = 0x1234;
    loop.steps = [{ room: 0x1234, flags: 0, command: 'n' }];
    loop.count = 1;
    s.paths.push(loop);
    s.MegaMud_StartTask = 1;
    s.MegaMud_DefaultLoop = 'Loop';
    goOnline(s, 1);
    expect(s.loopPath.start).toBe(0x1234);
    // In the loop's room: taken up at once.
    s.f_8130 = 0x1234;
    enterGame(s);
    expect(s.looping).toBe(1);
    expect(s.task).toBe(0xf);
  });

  it('calls back a leader it was following, with StartTask 0', () => {
    const { s, out } = session();
    s.Player_Name = 'Me';
    s.leaderName = 'Lead';
    s.following = 1;
    enterGame(s);
    expect(s.following).toBe(0);
    expect(s.pending.map((p) => p.text)).toEqual(['/Lead @comeback\r']);
    expect(out.sent).toEqual(['\r']);
  });

  it('adds the time online when it goes offline', () => {
    const { s, clock } = session();
    goOnline(s, 1);
    s.now = clock.now + 60;
    goOnline(s, 0);
    expect(s.online).toBe(0);
    expect(s.f_32510).toBe(60);
  });
});

describe('hanging up (0x42d510, 0x4b6fe0)', () => {
  it('breaks off the fight, logs off the BBS and closes the socket', () => {
    const { s, out } = session();
    let closed = 0;
    (s.host as { hangUp?: () => void }).hangUp = () => (closed += 1);
    connected(s);
    s.inGame = 1;
    s.inCombat = 1;
    s.logoffCmd = '=x';
    hangUp(s, 0);
    expect(out.sent).toEqual(['break\r', '=x\r']);
    expect(closed).toBe(1);
    expect(s.inGame).toBe(0);
    // Once until the socket closes.
    hangUp(s, 0);
    expect(closed).toBe(1);
  });

  it('relogs instead, with Other.RelogInstead', () => {
    const { s, out } = session();
    connected(s);
    s.inGame = 1;
    s.Other_RelogInstead = 1;
    hangUp(s, 1);
    expect(out.sent).toEqual([';relog\r']);
    expect(s.state).toBe(8);
    expect(s.task).toBe(1);
  });

  it('does nothing with no connection', () => {
    const { s, out } = session();
    hangUp(s, 0);
    expect(out.sent).toEqual([]);
    sessionEnded(s);
  });
});

describe('the socket gone (0x42c910)', () => {
  it('is unexpected without a hang-up, and redials with Comms.RedialCarrier', () => {
    const { s, out, clock } = session();
    connected(s);
    goOnline(s, 1);
    s.inGame = 1;
    s.Comms_RedialCarrier = 1;
    s.Comms_RedialPause = 30;
    connectionClosed(s);
    expect(out.shown).toEqual(['Unexpected disconnection.']);
    expect(s.task).toBe(9);
    expect(s.f_32298).toBe(clock.now + 30);
    expect(s.inGame).toBe(0);
  });

  it('is plain after a hang-up, and lets the next one through', () => {
    const { s, out } = session();
    connected(s);
    goOnline(s, 1);
    hangUp(s, 0);
    connectionClosed(s);
    expect(out.shown).toEqual([]);
    expect(s.f_e158).toBe(0);
  });
});
