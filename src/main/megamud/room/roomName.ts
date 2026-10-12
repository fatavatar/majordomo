/**
 * The room's name (`0x498a60`): a line drawn in bright yellow from its first
 * character, up to 52 characters, starting with a letter. MegaMUD keeps it
 * (`0x8091`) and its hash (`0x8134`), the top of the room's signature, until
 * the exits line confirms the room. The line still goes on to the other
 * handlers. Read 2026-10-12.
 */
import type { Session } from '../Session';

export function roomNameLine(s: Session, line: string): number {
  if (s.state !== 0x20 && s.line.attr[0] === 0x0e) {
    if (line.length > 0 && line.length < 0x35 && /^[A-Za-z]/.test(line)) {
      s.roomNameSeen = line.slice(0, 0x34);
      let hash = 0;
      for (let i = 0; i < line.length; i += 1)
        hash = (hash + (i + 1) * (line.charCodeAt(i) & 0xff)) | 0;
      s.roomNameHash = (hash << 20) | 0;
    }
  }
  return 0;
}

/** `0x426a60`: a new room: the monster fought last is forgotten. */
export function forgetLastTarget(s: Session): void {
  if (s.lastTarget !== '' && s.debug !== 0) s.host.trace('{W-inv}');
  s.lastTarget = '';
  s.f_dd10 = 0;
  s.s_dd14 = '';
}
