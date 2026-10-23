// Coin Converter maths (frmCoinConvert). Pure functions.

import { vbRound } from './vb.js';

// frmCoinConvert eCoins: value of one coin, in copper.
export const COINS = Object.freeze({ copper: 1, silver: 10, gold: 100, platinum: 10000, runic: 1000000 });
export const COIN_NAMES = ['copper', 'silver', 'gold', 'platinum', 'runic'];   // optCoinTop/Bottom(0..4)

// VB6 Round(x, digits): banker's rounding, from vb.js.
export { vbRound };

// frmCoinConvert.ConvertCoin: coins of one kind in another, capped at
// 9,999,999,999 copper and rounded to 8 places.
export function convertCoin(n, from, to) {
  let copper = n * from;
  if (copper > 9999999999) copper = 9999999999;
  return vbRound(copper / to, 8);
}

// frmCoinConvert.txtCoin_Change: 3 coins weigh 1.
export const coinWeight = n => (n > 0 ? Math.trunc(n / 3) : null);

// frmCoinConvert.RefreshCharmButton: the charm price modifier as a percentage
// (e.g. 95 = 5% discount) and its caption; pct 0 means no effect. MME only
// offers it with the global filter on and a charm other than 0 or 50.
export function charmModifier(charm, filterOn = true) {
  if (!filterOn || !charm || charm === 50) return { pct: 0, label: 'No Charm Effect' };
  const mod = 1 - ((Math.trunc(charm / 5) - 10) / 100);
  const cur = vbRound(mod, 4);                                // CCur
  const pct = vbRound(cur * 100, 4);
  if (mod > 1) return { pct, label: `${vbRound(Math.abs(1 - cur) * 100, 4)}% Markup` };
  if (mod < 1) return { pct, label: `${vbRound((1 - cur) * 100, 4)}% Discount` };
  return { pct: 0, label: 'No Charm Effect' };
}

// frmCoinConvert.cmdCharm_Click: apply the charm modifier to an amount of
// `coin`, returning the new amount (1..999,999,999). null when MME does
// nothing (amount below 1).
export function applyCharm(amount, coin, pct) {
  if (amount < 1) return null;
  let copper = convertCoin(amount, coin, COINS.copper);
  copper = vbRound(copper * (pct / 100), 8);
  let out = convertCoin(copper, COINS.copper, coin);
  if (out < 1) out = 1;
  if (out > 999999999) out = 999999999;
  return out;
}
