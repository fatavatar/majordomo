/**
 * MegaMUD's connection: its dialling thread (`0x45a6b0`) and its BBS logon
 * (`0x45ad00`, the BBS.INI prompts answered). Both are ours: the host dials
 * and the realm's own login script logs on, so while connecting (tasks 1 to
 * 10, `0x12`, `0x13`) the engine reads nothing further of a line.
 */
import type { Session } from '../Session';

/** `0x45a6b0`, the host's. */
export function connectThreadLine(_s: Session): number {
  return 0;
}

/** `0x45ad00`, the login script's. */
export function bbsLine(_s: Session, _line: string, _complete: number): number {
  return 0;
}
