/**
 * The BBS set-up (`<DataDir>\BBS\<name>\BBS.INI`, read by `0x41bcf0`,
 * 2026-10-13): the game menu's prompt, the log-off and relog commands, the
 * speech and broadcast prefixes, the BBS's own talk lines, and its limits.
 * The session starts at the loader's defaults; a realm with its own file
 * has it read over them. The log-on prompts and replies it also holds are
 * the login automator's (ours).
 */
import type { Session } from './Session';

/** `0x41bcf0`, the part the engine reads; `read` gives a key's text, undefined when the file has none. */
export function bbsSetup(s: Session, read: (key: string) => string | undefined): void {
  const str = (key: string, size: number, fallback: string): string => {
    return (read(key) ?? fallback).slice(0, size - 1);
  };
  const int = (key: string, fallback: number): number => {
    // `0x4475d0`: atol of what is there.
    const v = read(key);
    return v === undefined ? fallback : parseInt(v, 10) || 0;
  };
  s.s_7cb9 = str('MenuPrompt', 0x29, '[MAJORMUD]:');
  s.logoffCmd = str('LogoffCmd', 0x15, '');
  s.s_7cf7 = str('RelogCmd', 0x15, ';relog');
  s.ansiCmd = str('AnsiCmd', 0x15, '=a');
  s.s_7d21 = str('SpeechPrefix', 5, '.');
  s.broadcastPrefix = str('BroadcastPrefix', 5, "'");
  s.bbsTalk.chat = [str('LogonMsg', 0x29, 'logs ON'), str('LogoffMsg', 0x29, 'logs OFF')];
  s.s_7d7d = str('ShutDownMsg', 0x29, 'Please finish up and log off');
  s.bbsTalk.broadcast = str('BroadcastMsg', 0x29, 'Broadcast');
  s.bbsTalk.notices = [1, 2, 3].map((n) => ({
    text: str(`Global${n}Msg`, 0x29, '--Unused--'),
    more: int(`Global${n}Two`, 0)
  }));
  s.maxInput = int('MaxInputSize', 0x7f);
  s.pvpLevel = int('PvpLevel', 99);
  s.maxHours = int('MaxHrsPerDay', 0x18);
  s.runicName = str('RunicName', 0x1f, 'runic coin');
}
