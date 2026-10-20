/**
 * The Item Manager's flags as the character's item rules (2026-10-19): MME's
 * Flag column words (`imFlagText`), its actions (`imSetAction`) as what each
 * makes of the rule, and its game commands (`imCommands`) from the rules.
 * The Lists tab's (`components/ExplorerLists.tsx`).
 */
import type { ItemRule } from '@shared/itemRules';

/** What a rule says, as MME's Flag column words it. */
export function flagText(rule: ItemRule | undefined): string {
  if (rule === undefined) return '';
  const parts: string[] = [];
  if (rule.buy === true) parts.push(rule.keep === undefined ? 'BUY' : `BUY x${rule.keep}`);
  if (rule.sell === true) parts.push('SELL');
  if (rule.discard === true) parts.push('DROP');
  if (rule.collect === true)
    parts.push(rule.most === undefined ? 'PICKUP' : `PICKUP x${rule.most}`);
  if (rule.equip === true) parts.push('EQUIP');
  return parts.join(' · ');
}

/** MME's actions, as the rule each makes of what the item's rule says now. */
export type Action = 'sell' | 'drop' | 'pickup' | 'minus' | 'plus' | 'clear';

export function acted(
  rule: ItemRule | undefined,
  action: Action,
  carried: number
): Partial<ItemRule> | null {
  const now = rule ?? { item: '' };
  switch (action) {
    case 'sell':
      if (now.sell === true)
        return { sell: false, buy: true, keep: Math.max(1, now.keep ?? carried) };
      if (now.buy === true) return { sell: false, buy: false };
      return { sell: true, buy: false };
    case 'drop':
      return { discard: now.discard !== true };
    case 'pickup':
      if (now.collect === true) return { collect: false, equip: true };
      if (now.equip === true) return { collect: false, equip: false };
      return { collect: true };
    case 'minus':
    case 'plus': {
      const step = action === 'plus' ? 1 : -1;
      if (now.buy === true) return { keep: Math.max(1, (now.keep ?? 1) + step) };
      if (now.collect === true) return { most: Math.max(1, (now.most ?? 1) + step) };
      return null;
    }
    case 'clear':
      return {
        collect: false,
        discard: false,
        equip: false,
        buy: false,
        sell: false,
        keep: undefined,
        most: undefined
      };
  }
}

/** MME's `imCommands`, from the rules: what each says to do, as many times as it says. */
export function commandsOf(
  rows: ReadonlyArray<{ name: string; carried: number; rule?: ItemRule }>
): string {
  const out: string[] = [];
  for (const row of rows) {
    const rule = row.rule;
    if (rule === undefined) continue;
    const times = (n: number): number => Math.max(1, n);
    const push = (command: string, n: number): void => {
      for (let k = 0; k < times(n); k++) out.push(`${command} ${row.name}`);
    };
    if (rule.discard === true) push('drop', row.carried);
    if (rule.sell === true) push('sell', row.carried);
    if (rule.buy === true) push('buy', (rule.keep ?? 1) - row.carried);
    if (rule.collect === true) push('get', (rule.most ?? 1) - row.carried);
    if (rule.equip === true) push('equip', 1);
  }
  return out.join('\r\n');
}
