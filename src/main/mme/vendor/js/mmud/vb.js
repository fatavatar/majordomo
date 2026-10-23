// VB6 arithmetic, so ported formulas round the way MME does.
//
//   Fix(x)        truncate toward zero                      -> fix(x)
//   Int(x)        floor                                     -> Math.floor(x)
//   Round(x, d)   banker's rounding (half to even)          -> vbRound(x, d)
//   a \ b         rounds both operands half-to-even to whole
//                 numbers, then divides and truncates      -> idiv(a, b)
//   CLng(x) / assigning a fractional value to a Long or
//   Integer variable: banker's rounding to a whole number  -> cint(x)
//   Currency: 4 decimal places, banker's rounded           -> cur(x)

const EPS = 1e-9;

export const fix = x => Math.trunc(x) + 0;

export function vbRound(x, digits = 0) {
  const m = 10 ** digits;
  const y = x * m;
  const f = Math.floor(y);
  const diff = y - f;
  // within float noise of .5 counts as an exact half (scaled for big values)
  const eps = EPS * Math.max(1, Math.abs(y));
  let r;
  if (Math.abs(diff - 0.5) <= eps) r = f % 2 === 0 ? f : f + 1;
  else r = diff > 0.5 ? f + 1 : f;
  return r / m + 0;
}

export const cint = x => vbRound(x, 0);
export const cur = x => vbRound(x, 4);

export function idiv(a, b) {
  const d = cint(b);
  if (d === 0) throw new RangeError('Division by zero');
  return fix(cint(a) / d);
}

// VB `Mod`: operands rounded like `\`, sign follows the dividend.
export const vbMod = (a, b) => cint(a) % cint(b) + 0;

// Val(): leading number of a string, 0 when there is none.
export function val(s) {
  if (typeof s === 'number') return s;
  const m = String(s ?? '').trim().match(/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i);
  return m ? Number(m[0]) : 0;
}
