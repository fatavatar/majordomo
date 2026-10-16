/**
 * The prompt: `[HP=120/MA=40]:` and its `(Resting)`/`(Meditating)` marks,
 * read by `0x47b070`. Read 2026-10-12.
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
import { inAttackCast } from '../combat/casts';
import { atoi, dropFirst, indexFrom, idiv } from '../cstr';
import { belowLogoff, fluxMonitor } from '../health/flux';
import { unkeepAll } from '../room/entities';
import { enterGame, hangUp } from '../script/game';
import { echoAwaited, queue, send } from '../script/send';
import { forgetAwaited, setState } from '../script/state';
import { ARENA, type LineBuf, type Session } from '../Session';
import { refreshStatus } from '../status';
import { partyRefresh } from '../party/members';
import { State } from '../states';
import { LineFlag, PROMPT_SEEN } from '../flags';

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
      if (s.lowHpArmed === 1) {
        if (belowLogoff(s, hp) === 0) {
          s.lowHpHeld = 0;
        } else if (s.lowHpHeld === 0) {
          s.lowHpHeld = 1;
          if (hp >= 0) {
            hp = s.hp;
            s.lookDue = 1;
          }
        }
      }
      s.hp = hp;
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
        fluxMonitor(s);
      }
      promptStart = from;
      end = indexFrom(line, from, ']:') + 2;
      while (line[end] === ' ') end += 1;
      s.mana = Math.min(s.mana, s.Player_MaxMana);
      // `0x47b070`: the party window refreshed when the HP or mana moved.
      const moved = s.hp !== s.hpPrev || ((ma !== -1 || kai !== -1) && s.mana !== s.manaPrev);
      if (moved && (s.partySize > 0 || s.Display_AlwaysShowPartyWindow !== 0)) partyRefresh(s, 1);
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
      // Ours: a rest mark between stacked prompts (`[HP=…]: (Resting) [HP=…]:`)
      // stopped `0x47b070` at the first, and the rest reached the message rows
      // with a prompt in front: Fatty's sandstorm never ended (2026-10-16).
      for (const mark of ['(Resting) ', '(Meditating) ']) {
        if (
          line.startsWith(mark, end) &&
          indexFrom(line, end + mark.length, '[HP=') === end + mark.length
        ) {
          end += mark.length;
          from = end;
        }
      }
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
    if (s.state !== State.Moving || s.now - s.movedAt > s.Comms_LagWait + 4)
      setState(s, State.Resting);
    restMark = true;
  } else if (meditating >= promptStart && meditating <= end) {
    s.resting = 0;
    s.meditating = 1;
    if (end <= meditating + 0xd) end = meditating + 0xd;
    if (s.state !== State.Moving || s.now - s.movedAt > s.Comms_LagWait + 4)
      setState(s, State.Meditating);
    restMark = true;
  } else if (sawPrompt && complete === 0) {
    s.resting = 0;
    s.meditating = 0;
    if (s.state === State.Resting || s.state === State.Meditating) setState(s, State.Nothing);
  }
  if (restMark) sawPrompt = true;
  // Ours: nothing after a command answers it before its echo (`echoAwaited`).
  const awaiting = echoAwaited(s, sawPrompt ? line.slice(end) : line);
  // Every whole line counts one off the lines waited for, prompt or not.
  if (complete !== 0 && s.waitLines > 0 && !awaiting) {
    s.waitLines = Math.max(0, s.waitLines - 1);
    if (s.debug !== 0) s.lastPromptTrace = '';
  }

  let flags: number;
  if (sawPrompt) {
    buf.text = dropFirst(buf.text, end);
    buf.attr = buf.attr.slice(Math.min(end, buf.attr.length));
    flags = s.lineFlags | LineFlag.PromptUnsettled;
    if (s.waitPrompt > 0) {
      s.waitPrompt = Math.max(0, s.waitPrompt - 1);
      if (s.debug !== 0) s.lastPromptTrace = '';
    }
  } else {
    flags = s.lineFlags;
    if ((flags & LineFlag.PromptUnsettled) === 0) return 0;
  }
  s.lineFlags = flags & ~LineFlag.Prompted;
  if (complete === 0) {
    if (buf.text.length === 0 && s.waitLines === 0 && s.waitPrompt === 0 && !awaiting) {
      s.statPagerUp = 0;
      s.lineFlags = (flags & ~PROMPT_SEEN) | LineFlag.Prompted;
    }
    if ((s.lineFlags & PROMPT_SEEN) !== 0) {
      if (s.inCombat === 0 && inAttackCast(s, 0) === 0) {
        if (s.waitLines < 2 && s.waitPrompt === 0 && !awaiting) {
          s.statPagerUp = 0;
          s.lineFlags = (s.lineFlags & ~LineFlag.PromptUnsettled) | LineFlag.Prompted;
        }
      } else if (buf.text.length === 0) {
        if (s.waitPrompt === 0 && !awaiting) {
          s.statPagerUp = 0;
          s.lineFlags = (s.lineFlags & ~LineFlag.PromptUnsettled) | LineFlag.Prompted;
        }
        const roundSeen = s.roundBlowSeen;
        combatRoundEnd(s);
        if (
          (roundSeen !== 0 ||
            (inAttackCast(s, 0) !== 0 && s.castMode === s.state && s.castJustBegun !== 0)) &&
          (castWatchdog(s), roundSeen !== 0)
        ) {
          resetCombat(s);
        }
      }
    }
  }
  if (s.lowHpHeld !== 0) {
    s.statPagerUp = 0;
    s.lineFlags = (s.lineFlags & ~LineFlag.PromptUnsettled) | LineFlag.Prompted;
  }
  if (s.hp < 0) {
    forgetAwaited(s, s.state);
    setState(s, State.Nothing);
    s.inCombat = 0;
  }
  refreshStatus(s);
  return lowHpAndEntry(s, complete);
}

/** The rest of `0x47b070`: the critical-HP response, and entering the game on the first prompt. */
function lowHpAndEntry(s: Session, complete: number): number {
  const critical = s.lowHpArmed === 1 && belowLogoff(s, s.hp) !== 0;
  let hangup = s.inGame !== 0 && critical;
  if (s.allOff !== 0 && s.Other_HangupAllOff === 0) hangup = false;
  if (s.active === 0 && s.Other_HangupNotAfk === 0) hangup = false;
  if (s.roomSignature === ARENA || s.state === State.Hanging || s.state === State.Relogging)
    hangup = false;

  if (!(s.state === State.Teleported && s.hp > 0) && s.MegaMud_NoHangup === 0 && hangup) {
    if (s.panicAsked !== 0) {
      s.host.show('[Party leader aborting!]');
      s.panicAsked = 0;
    } else {
      s.host.trace('[HPs critically low!]');
    }
    return criticalHp(s);
  }
  if (s.panicAsked !== 0) {
    s.host.show('[Party leader aborting!]');
    s.panicAsked = 0;
    return criticalHp(s);
  }
  if ((s.lineFlags & LineFlag.Prompted) !== 0) {
    if (s.abilAsking !== 0 || s.abilUnasked !== 0) abilityPrompt(s);
    let st = s.state;
    const done = (): void => {
      forgetAwaited(s, st);
      setState(s, State.Nothing);
    };
    if (
      st === State.Depositing ||
      st === State.Withdrawing ||
      st === State.Tracking ||
      st === State.Opening ||
      st === State.Stashing
    )
      done();
    else if (st === State.Casting && s.equipsPending === 0) done();
    else if (st === State.Blessing && s.equipsPending === 0) done();
    else if (st === State.Training || st === State.Recovering) done();
    else if (
      (st === State.PendingCmd || st === State.Other) &&
      s.equipsPending === 0 &&
      s.waitPrompt === 0
    )
      done();
    st = s.state;
    if (st === State.Looking) {
      if (s.inCombat === 0 && inAttackCast(s, 0) === 0) {
        forgetAwaited(s, st);
        setState(s, State.Nothing);
      } else {
        setState(s, s.stateBefore);
      }
    }
    if (s.Player_MaxHP <= s.hp) {
      s.healthFirst = 0;
      if (s.state === State.Teleported) setState(s, State.Nothing);
    }
  }
  if (s.inGame === 0) {
    if (s.state === State.Hanging || s.state === State.Relogging) return 1;
    enterGame(s);
  }
  if ((s.lineFlags & LineFlag.Prompted) === 0) return 0;
  return complete === 0 ? 1 : 0;
}

/** `0x47b070`'s answer to HP under `HpLogoff%`: panic to the party, `sys goto` as a MUD op, else hang up. */
function criticalHp(s: Session): number {
  s.lowHpArmed = 0;
  if (
    s.allOff === 0 &&
    s.Party_SendPanic !== 0 &&
    s.partySize > 0 &&
    s.leaderName === s.Player_Name
  ) {
    send(s, `${s.speechPrefix}@panic!\r`);
  }
  if (s.BBS_IsMudop !== 0 && s.hp > 0 && s.BBS_SysGoto !== '') {
    send(s, 'break\r');
    s.inCombat = 0;
    send(s, 'sys goto ');
    send(s, s.BBS_SysGoto);
    send(s, '\r');
    send(s, 'rest\r');
    setState(s, State.Teleported);
    s.restReason = "resting HP's to full";
    s.healthFirst = 1;
    s.runCount = 0;
    combatOff(s);
    if (s.following !== 0) queue(s, `/${s.leaderName} @forget\r`);
    s.partySize = 0;
    s.following = 0;
    unkeepAll(s);
    s.lookDue = 1;
    s.weightMax = 0;
    if (s.hp >= 0) {
      s.host.alert?.('lowHp');
      return 0;
    }
  }
  s.skipRedialOnce = 1;
  s.noRedial = 1;
  s.walking = 0;
  hangUp(s, 1);
  s.host.alert?.('lowHp');
  return 0;
}
