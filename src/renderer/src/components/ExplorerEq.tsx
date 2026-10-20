import { useCallback, useEffect, useMemo, useState } from 'react';

import { keepFocus } from '../lib/focus';
import { t } from '../lib/i18n';
import {
  DEFAULT_EQ_PLAN,
  EQ_SLOT_COUNT,
  asEqPlan,
  type EqAttack,
  type EqFind,
  type EqFound,
  type EqPlan,
  type EqStat,
  type EqView,
  type ExplorerPlace
} from '@shared/explorer';

/**
 * MMUD Explorer's EQ tab (2026-10-19), mudtool's `tabs/eq.js` and MME's
 * equipment page: the twenty slots with their Hold boxes, the stat panel
 * `CalcCharacterStats` works out with what adds to every figure and its
 * manual adjustments, Find Best and Next Best, and the copies.
 *
 * The character is the one the game reports: the slots open on what it
 * wears, the pack is its inventory, and the weight beyond is the reported
 * encumbrance. A slot picked otherwise is the *plan*, kept per character;
 * *Wear the plan* puts on what the pack holds, and an item it does not hold
 * is bought and worn (`ExplorerBuy`), where MME could only copy commands.
 */
export interface ExplorerEqProps {
  session: string;
  /** Changes when what the page answers for does: the gear, the pack, the blessings up. */
  characterKey: string;
  view(plan: EqPlan): Promise<EqView>;
  best(plan: EqPlan, find: EqFind): Promise<EqFound>;
  wear(
    plan: EqPlan
  ): Promise<{ refusal: string | null; buy: Array<{ number: number; name: string }> }>;
  buy(item: number, wear: boolean): Promise<string | null>;
  copy(text: string): void;
  follow(place: ExplorerPlace): void;
  /** MME's Add all to compare: the loadout's items onto the Lists tab's weapons and armour. */
  addCompare(items: Array<{ kind: 'weapons' | 'armour'; n: number }>): void;
}

/** The martial arts grid's rows, as MME's picture heads them. */
const MARTIAL_ROWS: Array<() => string> = [
  () => t('explorer.eq.maDamage'),
  () => t('explorer.eq.maSkill'),
  () => t('explorer.eq.maAccuracy')
];

/** The weapon's slot, which the Weapons tab shows; every other slot's item is armour's. */
const WEAPON_SLOT = 16;
/** AC and DR are kept in tenths, as MME keeps them, and typed in whole points. */
const TENTHS = new Set([2, 3]);

const keyOf = (session: string): string => `mudengine.explorer.eq.${session}`;

function recall(session: string): EqPlan {
  try {
    const kept = localStorage.getItem(keyOf(session));
    return kept === null ? DEFAULT_EQ_PLAN : asEqPlan(JSON.parse(kept));
  } catch {
    return DEFAULT_EQ_PLAN;
  }
}

function keep(session: string, plan: EqPlan): void {
  try {
    localStorage.setItem(keyOf(session), JSON.stringify(plan));
  } catch {
    // Storage refused: the plan lasts this visit.
  }
}

export default function ExplorerEq({
  session,
  characterKey,
  view,
  best,
  wear,
  buy,
  copy,
  follow,
  addCompare
}: ExplorerEqProps) {
  const [plan, setPlan] = useState<EqPlan>(() => recall(session));
  useEffect(() => setPlan(recall(session)), [session]);
  useEffect(() => keep(session, plan), [session, plan]);
  const [page, setPage] = useState<EqView | null>(null);
  const [criterion, setCriterion] = useState(0);
  const [noLimited, setNoLimited] = useState(false);
  const [said, setSaid] = useState<{ text: string; ok: boolean } | null>(null);
  const [tip, setTip] = useState<{ label: string; lines: string[] } | null>(null);
  const [adjusting, setAdjusting] = useState<EqStat | null>(null);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    let live = true;
    void view(plan).then((answer) => {
      if (live) setPage(answer);
    });
    return () => {
      live = false;
    };
  }, [view, plan, characterKey]);

  const change = useCallback(
    (next: Partial<EqPlan>) => setPlan((was) => ({ ...was, ...next })),
    []
  );
  /** The loadout as the page shows it, so a first pick starts from what is worn. */
  const loadout = useMemo(
    () =>
      plan.equipped ?? page?.slots.map((slot) => slot.chosen) ?? new Array(EQ_SLOT_COUNT).fill(0),
    [plan.equipped, page]
  );
  const pick = (slot: number, item: number): void =>
    change({ equipped: loadout.map((n, x) => (x === slot ? item : n)) });
  const runFind = (next: boolean): void => {
    void best({ ...plan, equipped: loadout }, { criterion, next, noLimited }).then((found) => {
      setSaid(found.found ? null : { text: t('explorer.eq.nothingFound'), ok: false });
      change({ equipped: found.equipped });
    });
  };
  const wearPlan = (): void => {
    void wear({ ...plan, equipped: loadout }).then((answer) => {
      const rest =
        answer.buy.length === 0
          ? ''
          : ` ${t('explorer.eq.toBuy', { items: answer.buy.map((item) => item.name).join(', ') })}`;
      setSaid(
        answer.refusal === null
          ? { text: `${t('explorer.buy.sent')}${rest}`, ok: true }
          : { text: `${answer.refusal}${rest}`, ok: false }
      );
    });
  };
  const buyWear = (item: number): void => {
    void buy(item, true).then((refusal) =>
      setSaid(
        refusal === null ? { text: t('explorer.buy.sent'), ok: true } : { text: refusal, ok: false }
      )
    );
  };
  const adjust = (stat: EqStat): void => {
    const now = plan.adjustments[stat.i] ?? 0;
    setAdjusting(stat);
    setTyped(String(TENTHS.has(stat.i) ? now / 10 : now));
  };
  const applyAdjust = (): void => {
    if (adjusting === null) return;
    const value = Math.max(-999, Math.min(9999, Number(typed) || 0));
    const stored = TENTHS.has(adjusting.i) ? Math.round(value * 10) : Math.trunc(value);
    change({ adjustments: plan.adjustments.map((v, i) => (i === adjusting.i ? stored : v)) });
    setAdjusting(null);
  };
  const setAttack = (next: Partial<EqAttack>): void =>
    change({ attack: { ...plan.attack, ...next } });

  if (page === null) return <div className="ex-empty">{t('explorer.loading')}</div>;
  if (!page.supported)
    return <div className="ex-empty">{page.reason ?? t('explorer.unsupported')}</div>;

  const cell = (stat: EqStat) => (
    <button
      className="eq-stat"
      data-adjusted={stat.adjusted ? 'true' : undefined}
      key={stat.i}
      onClick={() => adjust(stat)}
      onFocus={() => setTip({ label: stat.label, lines: stat.tips })}
      onMouseDown={keepFocus}
      onMouseEnter={() => setTip({ label: stat.label, lines: stat.tips })}
      type="button"
    >
      <span className="eq-lbl">{stat.label}:</span>
      <span className="eq-val" data-tone={stat.tone || undefined}>
        {stat.text}
      </span>
    </button>
  );
  const groups = [...new Set(page.criteria.map(([group]) => group))];

  return (
    <div className="eq-page">
      <div className="eq-col">
        <section className="eq-card">
          <h3>{t('explorer.eq.equipped', { who: page.who })}</h3>
          <div className="eq-slots">
            {page.slots.map((slot) => {
              const planned = slot.chosen !== slot.worn;
              const known = new Set(slot.options.map(([n]) => n));
              const wornName = slot.worn === 0 ? t('explorer.eq.none') : null;
              return (
                <div
                  className="eq-slot"
                  data-held={plan.holds[slot.slot] ? 'true' : undefined}
                  data-warn={slot.warn !== '' ? 'true' : undefined}
                  key={slot.slot}
                >
                  <label className="eq-slot-name" title={t('explorer.eq.holdTitle')}>
                    <input
                      checked={plan.holds[slot.slot] ?? false}
                      onChange={(event) =>
                        change({
                          holds: plan.holds.map((held, x) =>
                            x === slot.slot ? event.target.checked : held
                          )
                        })
                      }
                      type="checkbox"
                    />
                    {slot.label}
                  </label>
                  <select
                    disabled={slot.disabled === true}
                    onChange={(event) => pick(slot.slot, Number(event.target.value))}
                    title={[slot.tip, slot.warn].filter((part) => part !== '').join('\n')}
                    value={String(slot.chosen)}
                  >
                    <option value="0">{t('explorer.eq.none')}</option>
                    {/* What is worn stays offered, though the lists would leave it out. */}
                    {slot.worn > 0 && !known.has(slot.worn) && (
                      <option value={slot.worn}>#{slot.worn}</option>
                    )}
                    {slot.chosen > 0 && slot.chosen !== slot.worn && !known.has(slot.chosen) && (
                      <option value={slot.chosen}>#{slot.chosen}</option>
                    )}
                    {slot.options.map(([n, name]) => (
                      <option key={n} value={n}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <span className="eq-go">
                    {slot.chosen > 0 && (
                      <button
                        className="ex-link"
                        onClick={() =>
                          follow({
                            tab: slot.slot === WEAPON_SLOT ? 'weapons' : 'armour',
                            n: slot.chosen
                          })
                        }
                        onMouseDown={keepFocus}
                        type="button"
                      >
                        →
                      </button>
                    )}
                    {slot.chosen > 0 && !slot.carried && (
                      <button
                        className="ex-btn eq-buy"
                        onClick={() => buyWear(slot.chosen)}
                        onMouseDown={keepFocus}
                        title={t('explorer.eq.buyWearTitle', {
                          item: slot.options.find(([n]) => n === slot.chosen)?.[1] ?? slot.chosen
                        })}
                        type="button"
                      >
                        {t('explorer.eq.buyWear')}
                      </button>
                    )}
                  </span>
                  {/* Under the picker, so the picker keeps the row's width. */}
                  {planned && (
                    <span className="eq-was">
                      {t('explorer.eq.worn', {
                        item:
                          wornName ??
                          slot.options.find(([n]) => n === slot.worn)?.[1] ??
                          `#${slot.worn}`
                      })}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="eq-card">
          <h3>{t('explorer.eq.title')}</h3>
          <div className="eq-find">
            <select
              onChange={(event) => setCriterion(Number(event.target.value))}
              value={criterion}
            >
              {groups.map((group) => (
                <optgroup key={group} label={group}>
                  {page.criteria.map(([g, label], i) =>
                    g === group ? (
                      <option key={i} value={i}>
                        {label}
                      </option>
                    ) : null
                  )}
                </optgroup>
              ))}
            </select>
            <button
              className="ex-btn"
              data-primary="true"
              onClick={() => runFind(false)}
              type="button"
            >
              {t('explorer.eq.findBest')}
            </button>
            <button className="ex-btn" onClick={() => runFind(true)} type="button">
              {t('explorer.eq.nextBest')}
            </button>
          </div>
          <label className="ex-check">
            <input
              checked={noLimited}
              onChange={(event) => setNoLimited(event.target.checked)}
              type="checkbox"
            />
            {t('explorer.eq.skipLimited')}
          </label>
          <p className="eq-hint">{t('explorer.eq.findBestHint')}</p>
        </section>

        <section className="eq-card">
          <h3>{t('explorer.eq.weight')}</h3>
          <p className="eq-hint">
            {page.packWeight === null
              ? t('explorer.eq.packUnreported')
              : t('explorer.eq.packWeight', { weight: page.packWeight })}
          </p>
        </section>
      </div>

      <div className="eq-col">
        <section className="eq-panel">
          <div className="eq-head">
            <span
              onMouseEnter={() =>
                setTip({ label: t('explorer.eq.encumbrance'), lines: page.encumbrance.tips })
              }
            >
              {t('explorer.eq.encumbrance')}:{' '}
              <b>
                {page.encumbrance.now}/{page.encumbrance.max}
              </b>{' '}
              {page.encumbrance.level} ({page.encumbrance.percent}%)
            </span>
            <span
              onMouseEnter={() =>
                setTip({
                  label: t('explorer.columns.ac'),
                  lines: [...page.armour.ac, '', ...page.armour.dr]
                })
              }
            >
              {t('explorer.eq.armourClass')} <b>{page.armour.text}</b>
            </span>
          </div>
          <div className="eq-grid">
            <div>{page.left.map(cell)}</div>
            <div>{page.right.map(cell)}</div>
          </div>
          <div className="eq-martial">
            <span />
            <span className="eq-lbl">{t('explorer.eq.punch')}</span>
            <span className="eq-lbl">{t('explorer.eq.kick')}</span>
            <span className="eq-lbl">{t('explorer.eq.jumpkick')}</span>
            {page.martial.map((row, r) => [
              <span className="eq-lbl" key={`l${r}`}>
                {MARTIAL_ROWS[r]!()}
              </span>,
              ...row.map((stat) => (
                <button
                  className="eq-val eq-ma"
                  data-tone={stat.tone || undefined}
                  key={stat.i}
                  onClick={() => adjust(stat)}
                  onMouseDown={keepFocus}
                  onMouseEnter={() => setTip({ label: stat.label, lines: stat.tips })}
                  type="button"
                >
                  {stat.text}
                </button>
              ))
            ])}
          </div>
          <div className="eq-grid">
            <div>
              <span
                className="eq-stat"
                onMouseEnter={() => setTip({ label: 'Attk', lines: page.attk.tips })}
              >
                <span className="eq-lbl">Attk:</span>
                <span className="eq-val" data-tone={page.attk.tone || undefined}>
                  {page.attk.text}
                </span>
              </span>
            </div>
          </div>
          <details className="eq-attack">
            <summary className="ex-btn">
              {t('explorer.eq.attack', { name: page.attackName })}
            </summary>
            <div className="eq-attack-body">
              {(
                [
                  ['oneshot', t('explorer.eq.attackOneshot')],
                  ['weapon', t('explorer.eq.attackWeapon')],
                  ['bash', t('explorer.eq.attackBash')],
                  ['smash', t('explorer.eq.attackSmash')],
                  ['martial', t('explorer.eq.attackMartial')],
                  ['spell', t('explorer.eq.attackSpell')]
                ] as Array<[EqAttack['type'], string]>
              ).map(([type, label]) => (
                <label className="ex-check" key={type}>
                  <input
                    checked={plan.attack.type === type}
                    name={`eq-attack-${session}`}
                    onChange={() =>
                      setAttack(
                        type === 'spell' && plan.attack.spell === 0
                          ? { type, spell: page.attackSpells[0]?.[0] ?? 0 }
                          : { type }
                      )
                    }
                    type="radio"
                  />
                  {label}
                  {type === 'martial' && plan.attack.type === 'martial' && (
                    <select
                      onChange={(event) => setAttack({ ma: Number(event.target.value) })}
                      value={plan.attack.ma}
                    >
                      <option value={1}>{t('explorer.eq.punch')}</option>
                      <option value={2}>{t('explorer.eq.kick')}</option>
                      <option value={3}>{t('explorer.eq.jumpkick')}</option>
                    </select>
                  )}
                  {type === 'spell' &&
                    plan.attack.type === 'spell' &&
                    (page.attackSpells.length === 0 ? (
                      <span className="eq-hint">{t('explorer.eq.attackNoSpells')}</span>
                    ) : (
                      <select
                        onChange={(event) => setAttack({ spell: Number(event.target.value) })}
                        value={plan.attack.spell}
                      >
                        {page.attackSpells.map(([n, name]) => (
                          <option key={n} value={n}>
                            {name}
                          </option>
                        ))}
                      </select>
                    ))}
                </label>
              ))}
              <label className="ex-check">
                <input
                  checked={plan.attack.backstab}
                  onChange={(event) => setAttack({ backstab: event.target.checked })}
                  type="checkbox"
                />
                {t('explorer.eq.attackBackstab')}
              </label>
            </div>
          </details>
          {page.notes.map((note) => (
            <p className="eq-hint" key={note}>
              {note}
            </p>
          ))}
          <div className="eq-tip">
            {adjusting !== null ? (
              <div className="eq-adjust">
                <b>{t('explorer.eq.adjust', { stat: adjusting.label })}</b>
                <span className="eq-hint">
                  {adjusting.i === 10
                    ? t('explorer.eq.adjustAccuracy')
                    : t('explorer.eq.adjustHint')}
                </span>
                <span className="eq-adjust-row">
                  <input
                    autoFocus
                    inputMode="decimal"
                    onChange={(event) => setTyped(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') applyAdjust();
                      if (event.key === 'Escape') {
                        event.stopPropagation();
                        setAdjusting(null);
                      }
                    }}
                    style={{ width: '6em' }}
                    value={typed}
                  />
                  <button className="ex-btn" onClick={applyAdjust} type="button">
                    {t('explorer.eq.attackApply')}
                  </button>
                </span>
              </div>
            ) : tip === null ? (
              t('explorer.eq.pointAt')
            ) : (
              <>
                <b>{tip.label}</b>
                {'\n'}
                {tip.lines.length === 0 ? '—' : tip.lines.join('\n')}
              </>
            )}
          </div>
        </section>

        <div className="eq-actions">
          <button
            className="ex-btn"
            data-primary="true"
            disabled={plan.equipped === null}
            onClick={wearPlan}
            onMouseDown={keepFocus}
            title={t('explorer.eq.wearTitle')}
            type="button"
          >
            {t('explorer.eq.wear')}
          </button>
          <button
            className="ex-btn"
            disabled={plan.equipped === null}
            onClick={() => change({ equipped: null })}
            type="button"
          >
            {t('explorer.eq.resetWorn')}
          </button>
          <button className="ex-btn" onClick={() => copy(page.copyText)} type="button">
            {t('explorer.eq.copyStats')}
          </button>
          <button className="ex-btn" onClick={() => copy(page.commands)} type="button">
            {t('explorer.eq.copyCommands')}
          </button>
          <button
            className="ex-btn"
            onClick={() =>
              addCompare(
                loadout.flatMap((n, x) =>
                  n > 0
                    ? [{ kind: x === WEAPON_SLOT ? ('weapons' as const) : ('armour' as const), n }]
                    : []
                )
              )
            }
            type="button"
          >
            {t('explorer.eq.addCompare')}
          </button>
          <button
            className="ex-btn"
            onClick={() => change({ holds: plan.holds.map(() => true) })}
            type="button"
          >
            {t('explorer.eq.holdAll')}
          </button>
          <button
            className="ex-btn"
            onClick={() => change({ holds: plan.holds.map(() => false) })}
            type="button"
          >
            {t('explorer.eq.releaseAll')}
          </button>
          <button
            className="ex-btn"
            onClick={() => change({ equipped: loadout.map((n, x) => (plan.holds[x] ? n : 0)) })}
            type="button"
          >
            {t('explorer.eq.unequipAll')}
          </button>
          <button
            className="ex-btn"
            disabled={plan.adjustments.every((v) => v === 0)}
            onClick={() => change({ adjustments: plan.adjustments.map(() => 0) })}
            type="button"
          >
            {t('explorer.eq.clearAdjustments')}
          </button>
          <label className="ex-check">
            <input
              checked={plan.itemsOnly}
              onChange={(event) => change({ itemsOnly: event.target.checked })}
              type="checkbox"
            />
            {t('explorer.eq.itemsOnly')}
          </label>
          {said !== null && (
            <span className="ex-buy-said" data-tone={said.ok ? 'ok' : 'danger'}>
              {said.text}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
