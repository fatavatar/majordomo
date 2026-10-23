// modMMudFunc.CalcCombatRounds lives in combat.js; this module re-exports it
// for the exp/hr code (phases 7a and 7b each ported it; one copy is kept).
export { calcCombatRounds, STOCK_MOB_HPREGEN_ROUNDS, GMUD_MOB_HPREGEN_ROUNDS } from './combat.js';
