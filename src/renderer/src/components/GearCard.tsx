import { memo, useEffect, useMemo, useState } from 'react';

import BentoCard, { type CardChrome } from './BentoCard';
import { keepFocus } from '../lib/focus';
import { t } from '../lib/i18n';
import {
  asGearOptions,
  DEFAULT_GEAR_OPTIONS,
  type ExplorerKind,
  type GearBoard,
  type GearOptions,
  type GearPick,
  type GearSlot
} from '@shared/explorer';

/**
 * What this character could wear instead (2026-10-18): MMUD Explorer's Find
 * Best for the character as it is, by one of MME's criteria, each slot's
 * best set against what is worn there, with Buy and Buy + Wear beside an
 * upgrade and its name opening the Explorer on it. MME's own rule, worked
 * out in main (`main/mme/Explorer.ts`, `explorerGear`); the compact half of
 * the Explorer, as the plan has it.
 *
 * Put away by default, like Stats: it answers a question asked between
 * evenings, not one watched through one.
 */
export interface GearCardProps extends CardChrome {
  /** Changes when the board answers for something else: the class, the level, what is worn. */
  characterKey: string;
  load(options: GearOptions): Promise<GearBoard>;
  /** Why not, or null where the character is on its way. */
  buy(item: number, wear: boolean): Promise<string | null>;
  /** The Explorer on this item; null for a character not shown, whose Explorer it is not. */
  explore: ((kind: ExplorerKind, item: number) => void) | null;
}

/** MME's weapon slot (`EQ_SLOTS`); every other is armour's. */
const WEAPON_SLOT = 16;

/** Where the criterion and the two filters are kept between sessions. */
const KEPT = 'mudengine.gear.options';

function recall(): GearOptions {
  try {
    const kept = localStorage.getItem(KEPT);
    return kept === null ? DEFAULT_GEAR_OPTIONS : asGearOptions(JSON.parse(kept));
  } catch {
    return DEFAULT_GEAR_OPTIONS;
  }
}

function keep(options: GearOptions): void {
  try {
    localStorage.setItem(KEPT, JSON.stringify(options));
  } catch {
    // A browser that keeps nothing starts from the default next time.
  }
}

/**
 * Whether Find Best's choice beats what is worn by the criterion. A tie is
 * no upgrade here, though MME's rule names the lighter of two (`findBest`
 * prefers the better encumbrance at an equal value): a purchase for no gain
 * is not one the card offers (2026-10-18, Skinny's earrings).
 */
const upgrade = (slot: GearSlot): boolean =>
  slot.best !== null &&
  slot.best.number !== slot.worn?.number &&
  slot.best.value > (slot.worn?.value ?? 0);

function Pick({ pick }: { pick: GearPick }) {
  return (
    <>
      {pick.name} <span className="gear-value">{pick.value}</span>
    </>
  );
}

function GearCard({ characterKey, load, buy, explore, ...chrome }: GearCardProps) {
  const [options, setOptions] = useState<GearOptions>(recall);
  const [board, setBoard] = useState<GearBoard | null>(null);
  const [said, setSaid] = useState<{ text: string; ok: boolean } | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => keep(options), [options]);
  useEffect(() => {
    let live = true;
    void load(options).then((found) => {
      if (live) setBoard(found);
    });
    return () => {
      live = false;
    };
  }, [load, options, characterKey]);

  const set = (change: Partial<GearOptions>): void => setOptions((was) => ({ ...was, ...change }));
  const press = (item: number, wear: boolean): void => {
    setSending(true);
    void buy(item, wear)
      .then((why) =>
        setSaid(why === null ? { text: t('cards.gear.sent'), ok: true } : { text: why, ok: false })
      )
      .finally(() => setSending(false));
  };
  // MME's menu in its groups, each keeping its place in the flat list the options name.
  const groups = useMemo(() => {
    const out: Array<{ group: string; entries: Array<{ index: number; label: string }> }> = [];
    (board?.criteria ?? []).forEach(([group, label], index) => {
      const last = out.at(-1);
      if (last?.group === group) last.entries.push({ index, label });
      else out.push({ group, entries: [{ index, label }] });
    });
    return out;
  }, [board?.criteria]);
  const upgrades = board?.slots.filter(upgrade).length ?? 0;

  return (
    <BentoCard
      {...chrome}
      badge={
        upgrades === 0 ? undefined : (
          <span className="chip">
            {upgrades === 1
              ? t('cards.gear.badge.one', { count: upgrades })
              : t('cards.gear.badge.many', { count: upgrades })}
          </span>
        )
      }
      className="gear-card"
      title={t('cards.gear.title')}
    >
      {board === null ? (
        <div className="aside">{t('cards.gear.loading')}</div>
      ) : !board.supported ? (
        <div className="aside">{board.reason ?? t('cards.gear.unsupported')}</div>
      ) : (
        <>
          <div className="gear-controls">
            {/* No `keepFocus` on a select: its default is the popup opening (see NavigationCard). */}
            <select
              aria-label={t('cards.gear.criterion')}
              className="gear-picker"
              onChange={(event) => {
                set({ criterion: Number(event.target.value) });
                chrome.returnFocus?.();
              }}
              value={options.criterion}
            >
              {groups.map(({ group, entries }) => (
                <optgroup key={group} label={group}>
                  {entries.map(({ index, label }) => (
                    <option key={index} value={index}>
                      {label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <label className="gear-check">
              <input
                checked={options.soldOnly}
                onChange={(event) => set({ soldOnly: event.target.checked })}
                type="checkbox"
              />
              {t('cards.gear.soldOnly')}
            </label>
            <label className="gear-check">
              <input
                checked={options.noLimited}
                onChange={(event) => set({ noLimited: event.target.checked })}
                type="checkbox"
              />
              {t('cards.gear.noLimited')}
            </label>
          </div>
          {board.slots.length === 0 ? (
            <div className="aside">{t('cards.gear.none')}</div>
          ) : (
            <ol className="gear-list">
              {board.slots.map((slot) => {
                const best = slot.best;
                const better = upgrade(slot);
                const gain = (best?.value ?? 0) - (slot.worn?.value ?? 0);
                return (
                  <li
                    className="gear-row"
                    data-upgrade={better ? 'true' : undefined}
                    key={slot.slot}
                  >
                    <span className="gear-slot">{slot.label}</span>
                    <span className="gear-best">
                      {best === null ? (
                        <span className="quiet-note">{t('cards.gear.leaveEmpty')}</span>
                      ) : !better ? (
                        <Pick pick={slot.worn ?? best} />
                      ) : (
                        <>
                          {explore === null ? (
                            <Pick pick={best} />
                          ) : (
                            <button
                              className="gear-item"
                              onClick={() =>
                                explore(
                                  slot.slot === WEAPON_SLOT ? 'weapons' : 'armour',
                                  best.number
                                )
                              }
                              onMouseDown={keepFocus}
                              title={t('cards.gear.explore', { item: best.name })}
                              type="button"
                            >
                              <Pick pick={best} />
                            </button>
                          )}{' '}
                          <span className="gear-gain">{gain >= 0 ? `+${gain}` : String(gain)}</span>
                        </>
                      )}
                    </span>
                    <span className="gear-actions">
                      {better && best !== null && (
                        <>
                          <button
                            className="gear-buy"
                            disabled={sending}
                            onClick={() => press(best.number, false)}
                            onMouseDown={keepFocus}
                            title={t('cards.gear.buyTitle', { item: best.name })}
                            type="button"
                          >
                            {t('cards.gear.buy')}
                          </button>
                          <button
                            className="gear-buy"
                            disabled={sending}
                            onClick={() => press(best.number, true)}
                            onMouseDown={keepFocus}
                            title={t('cards.gear.buyWearTitle', { item: best.name })}
                            type="button"
                          >
                            {t('cards.gear.wear')}
                          </button>
                        </>
                      )}
                    </span>
                    <span className="gear-worn">
                      {better || best === null
                        ? slot.worn === null
                          ? t('cards.gear.wornNothing')
                          : t('cards.gear.wornNow', {
                              item: slot.worn.name,
                              value: slot.worn.value
                            })
                        : t('cards.gear.already')}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          {said !== null && (
            <div className="aside" data-tone={said.ok ? 'ok' : 'danger'}>
              {said.text}
            </div>
          )}
        </>
      )}
    </BentoCard>
  );
}

export default memo(GearCard);
