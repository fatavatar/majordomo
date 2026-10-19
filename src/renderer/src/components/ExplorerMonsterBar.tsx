import { keepFocus } from '../lib/focus';
import { t } from '../lib/i18n';
import {
  DEFAULT_MONSTER_EXTRA,
  NO_LIMIT,
  type ExplorerFilters,
  type MonsterBar,
  type MonsterExtra
} from '../lib/explorer';
import { Check, Field, Figure } from './ExplorerFields';

/**
 * MMUD Explorer's Monsters bar (2026-10-18), mudtool's `tabs/monsters.js`:
 * by mob or by lair, regen, damage, HP, exp and magic, and `frmMonsterFilters`
 * as the *Extra filters* panel — coins, AC, DR, MR, BS defence, game limit,
 * lair exp and count, mobs a lair, dodge, attack accuracy, undead, standing,
 * poison, confusion, fear and three ability filters, AND'ed.
 */
export interface ExplorerMonsterBarProps {
  filters: ExplorerFilters;
  set(change: Partial<ExplorerFilters>): void;
  byLair: boolean;
  /** Whether the realm states lairs (NMR 1.83), without which there is no by-lair mode. */
  lairsStated: boolean;
  setByLair(byLair: boolean): void;
  abilityOptions: ReadonlyArray<[string, string]>;
}

/** The coin filter's choices, in `frmMonsterFilters`' order. */
const DROPS = (): string[] => [
  t('explorer.monsters.dropsNone'),
  t('explorer.monsters.dropsCopper'),
  t('explorer.monsters.dropsSilver'),
  t('explorer.monsters.dropsGold'),
  t('explorer.monsters.dropsPlatinum'),
  t('explorer.monsters.dropsRunic')
];

/** A limit box: empty is no limit (`frmMonsterFilters`' 9999, or the floor where it is a minimum). */
function Limit({
  label,
  value,
  off,
  onChange,
  width = '5em'
}: {
  label: string;
  value: number;
  off: number;
  onChange(value: number): void;
  width?: string;
}) {
  return (
    <Figure
      label={label}
      onChange={(v) => onChange(v === null || v === 0 ? off : v)}
      value={value === off ? null : value}
      width={width}
    />
  );
}

export default function ExplorerMonsterBar({
  filters,
  set,
  byLair,
  lairsStated,
  setByLair,
  abilityOptions
}: ExplorerMonsterBarProps) {
  const bar = filters.monster;
  const x = filters.extra;
  const setBar = (change: Partial<MonsterBar>): void => set({ monster: { ...bar, ...change } });
  const setX = (change: Partial<MonsterExtra>): void => set({ extra: { ...x, ...change } });
  const setAbil = (i: number, at: 0 | 1 | 2, value: number): void =>
    setX({
      abils: x.abils.map((row, k) =>
        k === i ? (row.map((v, j) => (j === at ? value : v)) as [number, number, number]) : row
      )
    });
  return (
    <>
      <div className="ex-seg" role="group">
        {[false, true].map((lair) => (
          <button
            aria-pressed={byLair === lair}
            className="ex-btn"
            disabled={lair && !lairsStated}
            key={String(lair)}
            onClick={() => setByLair(lair)}
            onMouseDown={keepFocus}
            type="button"
          >
            {lair ? t('explorer.monsters.byLair') : t('explorer.monsters.byMob')}
          </button>
        ))}
      </div>
      <Field label={t('explorer.monsters.regen')}>
        <select
          onChange={(event) => setBar({ regenOp: Number(event.target.value) })}
          value={String(bar.regenOp)}
        >
          <option value="0">&lt;=</option>
          <option value="1">&gt;=</option>
        </select>
        <input
          inputMode="numeric"
          onChange={(event) => setBar({ regen: Number.parseInt(event.target.value, 10) || 0 })}
          style={{ width: '4.5em' }}
          value={String(bar.regen)}
        />
      </Field>
      <Limit
        label={t('explorer.monsters.maxDamage')}
        off={99999}
        onChange={(maxDamage) => setBar({ maxDamage })}
        value={bar.maxDamage}
        width="5.5em"
      />
      <Limit
        label={t('explorer.monsters.maxHP')}
        off={99999}
        onChange={(maxHP) => setBar({ maxHP })}
        value={bar.maxHP}
        width="5.5em"
      />
      <Limit
        label={t('explorer.monsters.minExp')}
        off={0}
        onChange={(minExp) => setBar({ minExp })}
        value={bar.minExp}
        width="6em"
      />
      <div className="ex-checks">
        <Check
          checked={bar.magicOn}
          label={t('explorer.monsters.maxMagic')}
          onChange={(magicOn) => setBar({ magicOn })}
        />
      </div>
      {bar.magicOn && (
        <Figure
          label={t('explorer.monsters.magic')}
          onChange={(maxMagic) => setBar({ maxMagic: maxMagic ?? 0 })}
          value={bar.maxMagic}
          width="4em"
        />
      )}
      <details className="ex-extra">
        <summary className="ex-btn" data-on={x.enabled ? 'true' : undefined}>
          {t('explorer.monsters.extra')}
        </summary>
        <div className="ex-extra-panel">
          <div className="ex-checks">
            <Check
              checked={x.enabled}
              label={t('explorer.monsters.enabled')}
              onChange={(enabled) => setX({ enabled })}
            />
            <Check
              checked={x.showAll}
              label={t('explorer.monsters.showAll')}
              onChange={(showAll) => setX({ showAll })}
            />
          </div>
          <div className="ex-extra-grid">
            <Field label={t('explorer.monsters.drops')}>
              <select
                onChange={(event) => setX({ drops: Number(event.target.value) })}
                value={String(x.drops)}
              >
                {DROPS().map((label, i) => (
                  <option key={i} value={i}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Limit
              label={t('explorer.monsters.ac')}
              off={NO_LIMIT}
              onChange={(ac) => setX({ ac })}
              value={x.ac}
            />
            <Limit
              label={t('explorer.monsters.dr')}
              off={NO_LIMIT}
              onChange={(dr) => setX({ dr })}
              value={x.dr}
            />
            <Limit
              label={t('explorer.monsters.mr')}
              off={NO_LIMIT}
              onChange={(mr) => setX({ mr })}
              value={x.mr}
            />
            <Limit
              label={t('explorer.monsters.bsDef')}
              off={NO_LIMIT}
              onChange={(bsDef) => setX({ bsDef })}
              value={x.bsDef}
            />
            <Limit
              label={t('explorer.monsters.gameLimit')}
              off={NO_LIMIT}
              onChange={(gameLimit) => setX({ gameLimit })}
              value={x.gameLimit}
            />
            <Limit
              label={t('explorer.monsters.lairExp')}
              off={0}
              onChange={(lairExp) => setX({ lairExp })}
              value={x.lairExp}
              width="6em"
            />
            <Limit
              label={t('explorer.monsters.numLairs')}
              off={0}
              onChange={(numLairs) => setX({ numLairs })}
              value={x.numLairs}
            />
            <Limit
              label={t('explorer.monsters.mobsLTE')}
              off={NO_LIMIT}
              onChange={(mobsLTE) => setX({ mobsLTE })}
              value={x.mobsLTE}
            />
            <Limit
              label={t('explorer.monsters.mobsGTE')}
              off={0}
              onChange={(mobsGTE) => setX({ mobsGTE })}
              value={x.mobsGTE}
            />
            <Limit
              label={t('explorer.monsters.dodge')}
              off={NO_LIMIT}
              onChange={(dodge) => setX({ dodge })}
              value={x.dodge}
            />
            <Limit
              label={t('explorer.monsters.accMaj')}
              off={NO_LIMIT}
              onChange={(accMaj) => setX({ accMaj })}
              value={x.accMaj}
            />
            <Limit
              label={t('explorer.monsters.accMax')}
              off={NO_LIMIT}
              onChange={(accMax) => setX({ accMax })}
              value={x.accMax}
            />
          </div>
          <div className="ex-checks">
            <Check
              checked={x.undead}
              label={t('explorer.monsters.undead')}
              onChange={(undead) => setX({ undead })}
            />
            <Check
              checked={x.nonHostileEvil}
              label={t('explorer.monsters.nonHostileEvil')}
              onChange={(nonHostileEvil) => setX({ nonHostileEvil })}
            />
            <Check
              checked={x.nonHostileNG}
              label={t('explorer.monsters.nonHostileNG')}
              onChange={(nonHostileNG) => setX({ nonHostileNG })}
            />
            <Check
              checked={x.noPoison}
              label={t('explorer.monsters.noPoison')}
              onChange={(noPoison) => setX({ noPoison })}
            />
            <Check
              checked={x.noConfusion}
              label={t('explorer.monsters.noConfusion')}
              onChange={(noConfusion) => setX({ noConfusion })}
            />
            <Check
              checked={x.noFear}
              label={t('explorer.monsters.noFear')}
              onChange={(noFear) => setX({ noFear })}
            />
          </div>
          <span className="ex-field-label">{t('explorer.monsters.abilities')}</span>
          {x.abils.map(([abil, op, value], i) => (
            <div className="ex-field-row" key={i}>
              <select
                onChange={(event) => setAbil(i, 0, Number(event.target.value))}
                value={String(abil)}
              >
                <option value="0">{t('explorer.monsters.noAbility')}</option>
                {abilityOptions.map(([id, text]) => (
                  <option key={id} value={id}>
                    {text}
                  </option>
                ))}
              </select>
              <select
                onChange={(event) => setAbil(i, 1, Number(event.target.value))}
                value={String(op)}
              >
                <option value="0">&lt;=</option>
                <option value="1">&gt;=</option>
              </select>
              <input
                inputMode="numeric"
                onChange={(event) => setAbil(i, 2, Number.parseInt(event.target.value, 10) || 0)}
                style={{ width: '5em' }}
                value={String(value)}
              />
            </div>
          ))}
          <div className="ex-checks">
            <button
              className="ex-btn"
              onClick={() => set({ extra: DEFAULT_MONSTER_EXTRA })}
              onMouseDown={keepFocus}
              type="button"
            >
              {t('explorer.monsters.reset')}
            </button>
          </div>
        </div>
      </details>
    </>
  );
}
