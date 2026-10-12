/** The party list (`0x8918`, six records). Read 2026-10-12. */
import type { Session } from '../Session';
import { newMember } from '../Session';

/** `0x47dbf0`: member `i` leaves; a party of one is no party. */
export function removeMember(s: Session, i: number): number {
  if (i < 0 || i >= s.partySize) return 0;
  s.party.splice(i, 1);
  s.party.push(newMember());
  s.f_324a8 = 0;
  s.partySize -= 1;
  if (s.partySize === 1) s.partySize = 0;
  return 1;
}
