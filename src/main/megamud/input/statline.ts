/**
 * The prompt: `[HP=120/MA=40]:` and its `(Resting)`/`(Meditating)` marks,
 * read by `0x47b070`, and the `Location:` line (`0x47a430`). Read 2026-10-12.
 *
 * The status handler takes the prompt off the front of the line (and off its
 * colours), so whatever the server printed after it on the same line goes on
 * to the other handlers. A prompt is what lets the scheduler run: it sets
 * bit 0 of the line flags once nothing more is waited for.
 *
 * Left out: the party and rest-timer windows it refreshes, and the 50 ms it
 * sleeps in a fight waiting for more data. The port's chunks are whole, so
 * there is never more to wait for.
 */
import { abilityPrompt } from '../abilities/monitors';
import { combatOff } from '../combat/engaged';
import { castWatchdog, combatRoundEnd, resetCombat } from '../combat/rounds';
import { f_426ab0 } from '../combat/casts';
import { atoi, dropFirst, indexFrom, idiv } from '../cstr';
import { belowLogoff, fluxMonitor } from '../health/flux';
import { unkeepAll } from '../room/entities';
import { enterGame, hangUp } from '../script/game';
import { queue, send } from '../script/send';
import { forgetAwaited, setState } from '../script/state';
import type { LineBuf, Session } from '../Session';
import { refreshStatus } from '../status';

/** `0x47b070`: a prompt at the front of the line, if there is one. */
export function statusLine(s: Session, buf: LineBuf, complete: number): number {
  const line = buf.text;
  let from = 0;
  let promptStart = 0;
  let end = 0;
  let sawPrompt = false;
  if (indexFrom(line, 0, '[HP=') === 0) {
    for (;;) {
      end = from;
      if (indexFrom(line, from, ']:') === -1 || indexFrom(line, from, '<CE-') !== -1) break;
      if (s.inGame === 0 && complete === 1) return 0;
      s.hpPrev = s.hp;
      sawPrompt = true;
      let hp = atoi(line.slice(from + 4));
      if (s.f_e170 === 1) {
        if (belowLogoff(s, hp) === 0) {
          s.f_e144 = 0;
        } else if (s.f_e144 === 0) {
          s.f_e144 = 1;
          if (hp >= 0) {
            hp = s.hp;
            s.f_e290 = 1;
          }
        }
      }
      s.hp = hp;
      if (s.Player_MaxHP > 0 && hp < s.f_32538) s.f_32538 = hp;
      const ma = indexFrom(line, from, 'MA=');
      if (ma !== -1) {
        s.manaPrev = s.mana;
        s.mana = atoi(line.slice(ma + 3));
      }
      const kai = indexFrom(line, from, 'KAI=');
      if (kai !== -1) {
        s.manaPrev = s.mana;
        s.mana = atoi(line.slice(kai + 4));
      }
      if (s.Player_MaxMana > 0) {
        if (s.mana < s.f_3253c) s.f_3253c = s.mana;
        fluxMonitor(s);
      }
      promptStart = from;
      end = indexFrom(line, from, ']:') + 2;
      while (line[end] === ' ') end += 1;
      s.mana = Math.min(s.mana, s.Player_MaxMana);
      // MegaMUD refreshes its window while minimised here; nothing to do.
      if (s.restHpToFull === 0 || s.Player_MaxHP < 1) {
        if (s.hpFullAt > 0 && s.hp < s.hpFullAt) {
          s.hpFullAt = 0;
          if (s.debug !== 0) s.host.trace('{hp-r2}');
        }
      } else if (idiv(s.Health_HpFullPct * s.Player_MaxHP, 100) <= s.hp) {
        s.restHpToFull = 0;
        s.hpFullAt = s.hp;
        if (s.debug !== 0) s.host.trace(`{hp-${s.hp}}`);
      }
      if (s.restManaToFull === 0 || s.Player_MaxMana < 1) {
        if (s.manaFullAt > 0) {
          const pct = Math.max(s.Health_ManaFullPct, s.Health_ManaRestPct);
          if (s.mana < idiv(pct * s.manaFullAt, 100)) {
            s.manaFullAt = 0;
            if (s.debug !== 0) s.host.trace('{ma-r2}');
          }
        }
      } else if (idiv(s.Health_ManaFullPct * s.Player_MaxMana, 100) <= s.mana) {
        s.restManaToFull = 0;
        s.manaFullAt = s.mana;
        if (s.debug !== 0) s.host.trace(`{ma-${s.mana}}`);
      }
      from = end;
      if (indexFrom(line, end, '[HP=') !== end) break;
    }
  }

  const resting = indexFrom(line, promptStart, '(Resting) ');
  const meditating = indexFrom(line, promptStart, '(Meditating) ');
  let restMark = false;
  if (resting >= promptStart && resting <= end) {
    s.resting = 1;
    s.meditating = 0;
    if (end <= resting + 10) end = resting + 10;
    if (s.state !== 0x16 || s.now - s.f_32320 > s.Comms_LagWait + 4) setState(s, 3);
    restMark = true;
  } else if (meditating >= promptStart && meditating <= end) {
    s.resting = 0;
    s.meditating = 1;
    if (end <= meditating + 0xd) end = meditating + 0xd;
    if (s.state !== 0x16 || s.now - s.f_32320 > s.Comms_LagWait + 4) setState(s, 5);
    restMark = true;
  } else if (sawPrompt && complete === 0) {
    s.resting = 0;
    s.meditating = 0;
    if (s.state === 3 || s.state === 5) setState(s, 0);
  }
  if (restMark) sawPrompt = true;
  // Every whole line counts one off the lines waited for, prompt or not.
  if (complete !== 0 && s.waitLines > 0) {
    s.waitLines = Math.max(0, s.waitLines - 1);
    if (s.debug !== 0) s.lastPromptTrace = '';
  }

  let flags: number;
  if (sawPrompt) {
    buf.text = dropFirst(buf.text, end);
    buf.attr = buf.attr.slice(Math.min(end, buf.attr.length));
    flags = s.lineFlags | 2;
    if (s.waitPrompt > 0) {
      s.waitPrompt = Math.max(0, s.waitPrompt - 1);
      if (s.debug !== 0) s.lastPromptTrace = '';
    }
  } else {
    flags = s.lineFlags;
    if ((flags & 2) === 0) return 0;
  }
  s.lineFlags = flags & ~1;
  if (complete === 0) {
    if (buf.text.length === 0 && s.waitLines === 0 && s.waitPrompt === 0) {
      s.f_e2a0 = 0;
      s.lineFlags = (flags & ~3) | 1;
    }
    if ((s.lineFlags & 3) !== 0) {
      if (s.inCombat === 0 && f_426ab0(s, 0) === 0) {
        if (s.waitLines < 2 && s.waitPrompt === 0) {
          s.f_e2a0 = 0;
          s.lineFlags = (s.lineFlags & ~2) | 1;
        }
      } else if (buf.text.length === 0) {
        if (s.waitPrompt === 0) {
          s.f_e2a0 = 0;
          s.lineFlags = (s.lineFlags & ~2) | 1;
        }
        const roundSeen = s.f_32604;
        combatRoundEnd(s);
        if (
          (roundSeen !== 0 || (f_426ab0(s, 0) !== 0 && s.f_a448 === s.state && s.f_a450 !== 0)) &&
          (castWatchdog(s), roundSeen !== 0)
        ) {
          resetCombat(s);
        }
      }
    }
  }
  if (s.f_e144 !== 0) {
    s.f_e2a0 = 0;
    s.lineFlags = (s.lineFlags & ~2) | 1;
  }
  if (s.hp < 0) {
    forgetAwaited(s, s.state);
    setState(s, 0);
    s.inCombat = 0;
  }
  refreshStatus(s);
  return lowHpAndEntry(s, complete);
}

/** The rest of `0x47b070`: the critical-HP response, and entering the game on the first prompt. */
function lowHpAndEntry(s: Session, complete: number): number {
  const critical = s.f_e170 === 1 && belowLogoff(s, s.hp) !== 0;
  let hangup = s.inGame !== 0 && critical;
  if (s.f_a32c !== 0 && s.Other_HangupAllOff === 0) hangup = false;
  if (s.active === 0 && s.Other_HangupNotAfk === 0) hangup = false;
  if (s.f_8130 === 0x67110001 || s.state === 7 || s.state === 8) hangup = false;

  if (!(s.state === 0x2a && s.hp > 0) && s.MegaMud_NoHangup === 0 && hangup) {
    if (s.f_8890 !== 0) {
      s.host.show('[Party leader aborting!]');
      s.f_8890 = 0;
    } else {
      s.host.trace('[HPs critically low!]');
    }
    return criticalHp(s);
  }
  if (s.f_8890 !== 0) {
    s.host.show('[Party leader aborting!]');
    s.f_8890 = 0;
    return criticalHp(s);
  }
  if ((s.lineFlags & 1) !== 0) {
    if (s.f_2390 !== 0 || s.f_23b4 !== 0) abilityPrompt(s);
    let st = s.state;
    const done = (): void => {
      forgetAwaited(s, st);
      setState(s, 0);
    };
    if (st === 0x26 || st === 0x27 || st === 0x22 || st === 0x1a || st === 0x1e) done();
    else if (st === 0x15 && s.f_a5f8 === 0) done();
    else if (st === 0x10 && s.f_a5f8 === 0) done();
    else if (st === 0x2c || st === 0x2f) done();
    else if ((st === 0x2d || st === 0x2e) && s.f_a5f8 === 0 && s.waitPrompt === 0) done();
    st = s.state;
    if (st === 0x20) {
      if (s.inCombat === 0 && f_426ab0(s, 0) === 0) {
        forgetAwaited(s, st);
        setState(s, 0);
      } else {
        setState(s, s.stateBefore);
      }
    }
    if (s.Player_MaxHP <= s.hp) {
      s.f_e23c = 0;
      if (s.state === 0x2a) setState(s, 0);
    }
  }
  if (s.inGame === 0) {
    if (s.state === 7 || s.state === 8) return 1;
    enterGame(s);
  }
  if ((s.lineFlags & 1) === 0) return 0;
  return complete === 0 ? 1 : 0;
}

/** `0x47b070`'s answer to HP under `HpLogoff%`: panic to the party, `sys goto` as a MUD op, else hang up. */
function criticalHp(s: Session): number {
  s.f_e170 = 0;
  if (
    s.f_a32c === 0 &&
    s.Party_SendPanic !== 0 &&
    s.partySize > 0 &&
    s.leaderName === s.Player_Name
  ) {
    send(s, `${s.s_7d21}@panic!\r`);
  }
  if (s.BBS_IsMudop !== 0 && s.hp > 0 && s.BBS_SysGoto !== '') {
    send(s, 'break\r');
    s.inCombat = 0;
    send(s, 'sys goto ');
    send(s, s.BBS_SysGoto);
    send(s, '\r');
    send(s, 'rest\r');
    setState(s, 0x2a);
    s.restReason = "resting HP's to full";
    s.f_e23c = 1;
    s.runCount = 0;
    combatOff(s);
    if (s.following !== 0) queue(s, `/${s.leaderName} @forget\r`);
    s.partySize = 0;
    s.following = 0;
    unkeepAll(s);
    s.f_e290 = 1;
    s.f_8468 = 0;
    if (s.hp >= 0) {
      s.host.alert?.('lowHp');
      return 0;
    }
  }
  s.f_30de4 = 1;
  s.f_30de8 = 1;
  s.f_e184 = 0;
  hangUp(s, 1);
  s.host.alert?.('lowHp');
  return 0;
}

/** `0x47a430`: `Location: x,y` (for the map), when `0xe164`'s neighbour asks for it. Map only. */
export function locationLine(_s: Session, _line: string): number {
  return 0;
}
