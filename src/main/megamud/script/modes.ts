/**
 * `0x4c0af0`: the defaults of the mode MegaMUD is in, read 2026-10-12. Going
 * idle (automation off) applies the `Def…1` set to the `Auto…` toggles, going
 * active the `Def…2` set, unless `NoModeDefs`. Auto-combat kept across a
 * detour (`0xa320`) is put back.
 */
import type { Session } from '../Session';

export function modeDefaults(s: Session): void {
  const active =
    (s.active !== 0 || s.walking !== 0 || s.roaming !== 0 || s.importing !== 0) && s.f_a32c === 0
      ? 1
      : 0;
  if (s.modeApplied !== -1 && s.modeApplied === active) return;
  s.modeApplied = active;
  if (s.MegaMud_NoModeDefs === 0) {
    if (active === 0) {
      s.MegaMud_AutoCombat = s.MegaMud_DefCombat1;
      s.MegaMud_AutoPreAttack = s.MegaMud_DefPreAttack1;
      s.MegaMud_AutoNuke = s.MegaMud_DefNuke1;
      s.MegaMud_AutoHeal = s.MegaMud_DefHeal1;
      s.MegaMud_AutoBless = s.MegaMud_DefBless1;
      s.MegaMud_AutoLight = s.MegaMud_DefLight1;
      s.MegaMud_AutoCash = s.MegaMud_DefCash1;
      s.MegaMud_AutoGet = s.MegaMud_DefGet1;
      s.MegaMud_AutoSneak = s.MegaMud_DefSneak1;
      s.MegaMud_AutoHide = s.MegaMud_DefHide1;
      s.MegaMud_AutoSearch = s.MegaMud_DefSearch1;
      s.MegaMud_AutoTrack = s.MegaMud_DefTrack1;
      s.f_8be8 = s.MegaMud_DefMelee1;
    } else {
      s.MegaMud_AutoCombat = s.MegaMud_DefCombat2;
      s.MegaMud_AutoPreAttack = s.MegaMud_DefPreAttack2;
      s.MegaMud_AutoNuke = s.MegaMud_DefNuke2;
      s.MegaMud_AutoHeal = s.MegaMud_DefHeal2;
      s.MegaMud_AutoBless = s.MegaMud_DefBless2;
      s.MegaMud_AutoLight = s.MegaMud_DefLight2;
      s.MegaMud_AutoCash = s.MegaMud_DefCash2;
      s.MegaMud_AutoGet = s.MegaMud_DefGet2;
      s.MegaMud_AutoSneak = s.MegaMud_DefSneak2;
      s.MegaMud_AutoHide = s.MegaMud_DefHide2;
      s.MegaMud_AutoSearch = s.MegaMud_DefSearch2;
      s.MegaMud_AutoTrack = s.MegaMud_DefTrack2;
      s.f_8be8 = s.MegaMud_DefMelee2;
    }
  }
  if (s.detourCombat === -1) return;
  if (active !== 0) s.MegaMud_AutoCombat = s.detourCombat;
  else if (s.MegaMud_NoModeDefs === 1) s.MegaMud_AutoCombat = s.idleCombat;
  if (s.detours[0]!.room === 0) s.detourCombat = -1;
}

/**
 * `0x4bfa20`: walking resumes: auto-combat and auto-heal come back on if they
 * would be (`AutoAutoCombat`, `AutoAutoHeal`, or a mode default), unless the
 * user has locked them off (`0x48fcc0`, the toolbar's lock: not kept here).
 */
export function reEngage(s: Session): void {
  if (s.MegaMud_AutoCombat === 0) {
    if (
      s.idleCombat !== 0 ||
      s.Other_AutoAutoCombat !== 0 ||
      (s.MegaMud_NoModeDefs === 0 && (s.MegaMud_DefCombat1 !== 0 || s.MegaMud_DefCombat2 !== 0))
    ) {
      s.MegaMud_AutoCombat = 1;
      s.host.show('[Auto-combat re-engaged]');
    }
  }
  if (s.MegaMud_AutoHeal === 0) {
    if (
      s.Other_AutoAutoHeal !== 0 ||
      (s.MegaMud_NoModeDefs === 0 && (s.MegaMud_DefHeal1 !== 0 || s.MegaMud_DefHeal2 !== 0))
    ) {
      s.MegaMud_AutoHeal = 1;
      s.host.show('[Auto-rest/heal re-engaged]');
    }
  }
  s.detourCombat = -1;
}
