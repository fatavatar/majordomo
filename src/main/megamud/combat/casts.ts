/**
 * The attack casts: the modes, their counters and the tests on them
 * (`0x425b60`–`0x426b00`). See docs/megamud/megamud-exe.md, *Attack casts*.
 */
import type { Session } from '../Session';
import { isCastState } from '../states';

/**
 * `0x426ab0`: whether the state (`which` 0) or the attack mode the fight is
 * engaged in (`a448`, any other `which`) is one of the attack casts, 9 to 15.
 */
export function f_426ab0(s: Session, which: number): number {
  const mode = which === 0 ? s.state : s.f_a448;
  return isCastState(mode) ? 1 : 0;
}

/** `0x425f70`: how many casts the mode has counted this fight (`0x15`: the plain cast's). */
export function castCount(s: Session, mode: number): number {
  switch (mode) {
    case 9:
      return s.f_a3e8;
    case 0xa:
      return s.f_a3ec;
    case 0xb:
      return s.f_a3f0;
    case 0xc:
      return s.f_a3f8;
    case 0xd:
      return s.f_a3f4;
    case 0xe:
      return s.f_a3fc;
    case 0xf:
      return s.f_a400;
    case 0x15:
      return s.f_a3e4;
    default:
      return 0;
  }
}
