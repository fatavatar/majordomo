import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';

import BentoCard, { type CardAction, type CardChrome } from './BentoCard';
import Icon from './Icon';
import { FindField } from './CardTable';
import { keepFocus } from '../lib/focus';
import { groupWeights, PACK_GROUPS, packRows, type PackGroup, type PackRow } from '../lib/pack';
import { entityNumber } from '@shared/entities';
import {
  equip,
  equipVerdict,
  UNKNOWN_WEARER,
  type EquipVerdict,
  type GearAction,
  type Wearer
} from '@shared/gear';
import type { ItemFacts } from '@shared/explorer';
import { t } from '../lib/i18n';
import { coinText } from '../lib/coins';
import { type CarriedItem, type CharacterState, type Coins } from '@shared/character';
import { countedList } from '@shared/items';
import type { SessionId } from '@shared/ipc';
import type { WorldItem } from '@shared/world';

/**
 * The purse: the coins, then what the realm says they come to.
 *
 * The total is the server's own `Wealth:` figure and is not computed here —
 * `Wealth:` **is** a normalised total in copper, confirmed against the wire
 * (`51 gold crowns, 7 copper farthings` → `Wealth: 5107`) and seven more times
 * in the capture corpus. Like every maintained listing it is the number from
 * the last one until the next, so it can lag a coin picked up; the counts
 * beside it are what move.
 */
function Purse({ coins, wealth }: { coins: Coins; wealth: number | null }): React.JSX.Element {
  const value = useRef<HTMLElement>(null);
  const [tier, setTier] = useState(0);
  const full = coinText(coins, 0);

  /*
   * Which tier fits is *measured*, never guessed at.
   *
   * No pixel constant may exist in this path: the card is resizable, it can be
   * docked, floated or railed, and `App.tsx` overwrites the typography tokens at
   * runtime from the config — so a width decided at build time is wrong for
   * somebody. This renders the longest form, asks the laid-out element whether
   * it overflowed, and steps down until it does not.
   */
  useLayoutEffect(() => {
    const node = value.current;
    if (node === null) return;
    const observer = new ResizeObserver(() => setTier(0));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Back to the longest form whenever what is drawn changes, so a row that
  // shrank for a long count grows again when the count gets shorter.
  useLayoutEffect(() => setTier(0), [full]);

  useLayoutEffect(() => {
    const node = value.current;
    if (node === null || tier >= 2) return;
    if (node.scrollWidth > node.clientWidth) setTier(tier + 1);
  });

  return (
    <dd className="purse" ref={value}>
      {full.length > 0 && <span className="coins">{coinText(coins, tier)}</span>}
      {/* Thousands separated, because this is the one number on the card
          somebody reads as a quantity rather than as an identifier. */}
      {wealth !== null && <span className="total">({wealth.toLocaleString()})</span>}
    </dd>
  );
}

export interface InventoryCardProps extends CardChrome {
  character: CharacterState;
  /** Which character's pack this is, so its filters and its sort are remembered per character. */
  session: SessionId;
  /** Opens the realm's answer beside a clicked item name. */
  inspect?(name: string, anchor: HTMLElement): void;
  /**
   * Asks the realm what it knows about these item names.
   *
   * A callback, like the Shop and Reference cards take, rather than a prop
   * the whole app threads down: the answer is a fact about *this character's*
   * realm, and the query is addressed for the same reason every other world
   * query is.
   */
  load?(names: string[]): Promise<Record<string, WorldItem>>;
  /**
   * Who this character is, in the realm's own row ids, for deciding what may
   * go on. Addressed like `load`, and for the same reason.
   *
   * Its own query rather than a field of the item answers: it changes when a
   * stat sheet prints, and the items change when the pack does.
   */
  loadWearer?(): Promise<Wearer>;
  /**
   * MMUD Explorer's facts for what is carried (2026-10-24): its weight, where
   * it is worn, its value at this character's charm, and whether this
   * character can use it, which the equip control follows. Absent keeps the
   * realm's own.
   */
  loadItemFacts?: ((numbers: number[]) => Promise<ItemFacts[]>) | null;
  /** Changes when MME's answers do: the class, the level, what is worn. */
  characterKey?: string;
  /**
   * A gear button: put one item on, put on everything the realm says can be
   * worn, or put the whole pack on the floor.
   *
   * A callback rather than the commands themselves, for the reason every other
   * action on a card is: **main decides**. It holds the pack, the remembered
   * loadout and the realm's own word on what is wearable, and an
   * unrecognised command on this server is said out loud in the room — so the
   * card names an action from a closed list and never composes one. Absent on
   * a surface with nowhere to send it, and then no button is drawn, which is
   * what this client does with every control bound to nowhere.
   */
  gear?(action: GearAction, item?: string): void;
}

/**
 * What the character is carrying.
 *
 * Read from the `i` block the client already parses, so this asks the server
 * for nothing — the card appears when an inventory has been seen and says so
 * plainly when one has not, rather than showing an empty bag that looks like a
 * fact.
 *
 * Encumbrance is the number worth a meter: it is a fraction of a maximum, which
 * is the one shape this app draws as a bar, and being over it is a condition a
 * player acts on rather than a total they read.
 */
function InventoryCard({
  character,
  inspect,
  load,
  loadWearer,
  loadItemFacts,
  characterKey,
  gear,
  session,
  ...chrome
}: InventoryCardProps) {
  const { items, encumbrance, encumbranceMax } = character.inventory;
  void load;
  const [finding, setFinding] = useState(false);

  /*
   * The two bulk gear controls, in the action column where every card puts
   * what it can do. *Drop all* is `danger`-toned: it is the one here that
   * costs something, and on this realm a floor is not a container — anybody
   * standing there can pick the lot up.
   *
   * Absent rather than greyed when there is nothing in the pack. The
   * greyed-not-absent rule is about controls whose availability flickers while
   * somebody reaches for them; an empty pack is a card that is saying so in
   * words above them.
   */
  const actions: CardAction[] = [findAction(finding, setFinding, chrome.returnFocus)];
  if (gear && items.length > 0) {
    actions.push({
      id: 'equip-all',
      label: t('cards.inventory.equipAll'),
      icon: 'shirt',
      run: () => gear('equip-all')
    });
    actions.push({
      id: 'drop-all',
      label: t('cards.inventory.dropAll'),
      icon: 'trash',
      danger: true,
      run: () => gear('drop-all')
    });
  }

  return (
    <BentoCard
      badge={
        /*
         * What it weighs against what it can (2026-11-01), in the colour the
         * server would grade it -- the figure the split meter below is a
         * picture of. A count where the server has not said its limit.
         */
        encumbrance !== null && encumbranceMax !== null && encumbranceMax > 0 ? (
          <span
            className="chip off pack-badge"
            data-level={
              encumbrance / encumbranceMax >= 0.9
                ? 'critical'
                : encumbrance / encumbranceMax >= 0.7
                  ? 'caution'
                  : 'ok'
            }
          >
            {t('cards.inventory.loadBadge', {
              carried: encumbrance.toLocaleString(),
              max: encumbranceMax.toLocaleString()
            })}
          </span>
        ) : items.length > 0 ? (
          <span className="chip off">
            {t('cards.inventory.carriedBadge', { count: items.length })}
          </span>
        ) : undefined
      }
      actions={actions}
      className="inventory-card"
      {...chrome}
      copyText={() => packCopyText(character)}
      paned
      title={t('cards.inventory.title')}
    >
      <InventoryBody
        character={character}
        finding={finding}
        gear={gear}
        inspect={inspect}
        characterKey={characterKey}
        loadItemFacts={loadItemFacts}
        loadWearer={loadWearer}
        onFindDismiss={() => setFinding(false)}
        returnFocus={chrome.returnFocus}
        session={session}
      />
    </BentoCard>
  );
}

/**
 * One item per line, worn things marked, for pasting to somebody who asked
 * "what have you got". The weight and the meter stay on the card: a paste
 * is a list, not a readout.
 */
function packCopyText(character: CharacterState): string {
  const { items, keys, wealth, coins } = character.inventory;
  const coinLine = coinText(coins, 0);
  const hasPurse = wealth !== null || coinLine.length > 0;
  return [
    // The same sentence the card shows, at the longest tier: a paste has no
    // width to run out of, and `48 p` in somebody else's chat window is not
    // what the card said.
    ...(hasPurse
      ? [
          t('cards.inventory.copy.wealthPrefix', {
            amountText: [coinLine, wealth === null ? '' : `(${wealth.toLocaleString()})`]
              .filter((part) => part.length > 0)
              .join(' ')
          })
        ]
      : []),
    ...(keys.length > 0
      ? [t('cards.inventory.copy.keysPrefix', { keyList: countedList(keys).join(', ') })]
      : []),
    ...items.map((item) =>
      item.slot !== null
        ? `${item.name} (${item.slot})`
        : item.equipped
          ? `${item.name} (${t('cards.inventory.inUseStatus')})`
          : item.name
    )
  ].join('\n');
}

/**
 * The search glyph for a pack, and what it does.
 *
 * The Talk card's arrangement, and now the pack's: a find field standing open
 * above a listing spends a whole row on a question nobody is asking, and this
 * listing is the one whose rows are worth the most — a pack is read to find one
 * thing in it. Behind the glyph the row appears when it is asked for, takes the
 * caret, and clears itself on the way out.
 *
 * Written once because two cards draw the same pack: the Inventory card in its
 * own action column, the Self card on its PACK face's. Two copies would drift.
 */
export function findAction(
  finding: boolean,
  setFinding: (open: boolean) => void,
  returnFocus?: () => void
): CardAction {
  return {
    id: 'find',
    label: t('cards.inventory.findPlaceholder'),
    icon: 'search',
    run: () => {
      if (!finding) {
        setFinding(true);
        return;
      }
      setFinding(false);
      returnFocus?.();
    }
  };
}

export interface InventoryBodyProps {
  character: CharacterState;
  session: SessionId;
  inspect?: InventoryCardProps['inspect'];
  gear?: InventoryCardProps['gear'];
  loadWearer?: InventoryCardProps['loadWearer'];
  loadItemFacts?: InventoryCardProps['loadItemFacts'];
  characterKey?: string;
  returnFocus?: () => void;
  /**
   * Whether the find row is out. Driven from the search glyph in the action
   * column — the card's, or the Self card's PACK face's — because a whole row
   * spent on a question nobody is asking is a row this listing needs for its
   * own contents. See `CardTableProps.findOpen`.
   */
  finding?: boolean;
  onFindDismiss?(): void;
}

/**
 * The pack itself — the meter, the purse and the table — without a card
 * around it, so the Self card can draw the same listing on its PACK face.
 * One component rather than two listings, because two would drift.
 */
export function InventoryBody({
  character,
  session,
  inspect,
  gear,
  loadWearer,
  loadItemFacts,
  characterKey = '',
  returnFocus,
  finding,
  onFindDismiss
}: InventoryBodyProps) {
  const { items, keys, wealth, coins, encumbrance, encumbranceMax } = character.inventory;
  const facts = useItemFacts(loadItemFacts, items, characterKey);
  const factsOf = (item: CarriedItem): ItemFacts | undefined => {
    const n = entityNumber(item);
    return n === null ? undefined : facts.get(n);
  };
  /**
   * Who the realm thinks this character is.
   *
   * `UNKNOWN_WEARER` until asked, and unknown never refuses — a pack greyed
   * out because a stat sheet has not printed yet would hide wearable kit
   * behind a reason the client cannot state.
   */
  const [wearer, setWearer] = useState<Wearer>(UNKNOWN_WEARER);

  /*
   * Asked again when the *names* change, not when the listing object does.
   *
   * The tracker rebuilds `inventory.items` on every equip and every slot
   * change, and none of those change what an item weighs. Keying on the joined
   * names is what keeps a fight — where items go in and out of use — from
   * asking the realm the same question once a round.
   */
  /*
   * What the realm knows about each item is **on the item**.
   *
   * This was a `useEffect` making an `itemsKnown` round trip keyed on the
   * joined names, with a loading state and a failure branch — the same four
   * facts (weight, price, kind, slot) that main already held the moment the
   * listing was parsed. `CharacterTracker.replayPack` joins them there now, so
   * the weight column and the kind chips draw on the first paint instead of
   * appearing a tick later.
   */

  /*
   * Asked when the *facts that decide it* move, not on every character push.
   *
   * Race, class and level arrive together off the stat sheet and change a
   * handful of times in a session; the character object is replaced on every
   * status line. Keying on the three words is what keeps this from asking main
   * the same question several times a second in a fight.
   */
  const identity = `${character.race ?? ''}\u0000${character.className ?? ''}\u0000${character.progress.level ?? ''}\u0000${character.progress.strength ?? ''}`;
  useEffect(() => {
    if (!loadWearer) {
      setWearer(UNKNOWN_WEARER);
      return;
    }
    let live = true;
    void loadWearer()
      .then((found) => {
        if (live) setWearer(found);
      })
      .catch((error: unknown) => {
        // Unknown, loudly — and unknown is the answer that refuses nothing.
        if (live) {
          console.error('wearer lookup failed', error);
          setWearer(UNKNOWN_WEARER);
        }
      });
    return () => {
      live = false;
    };
  }, [loadWearer, identity]);
  const seen = items.length > 0 || keys.length > 0 || wealth !== null || encumbrance !== null;

  // Computed once per render: the copy guard, the copy line and the readout's
  // wealth-row guard all ask the same question of the same coins.
  const coinLine = coinText(coins, 0);
  const hasPurse = wealth !== null || coinLine.length > 0;

  // Null is not zero: an unknown maximum draws no bar rather than a full one.
  const carried =
    encumbrance !== null && encumbranceMax !== null && encumbranceMax > 0
      ? Math.min(1, encumbrance / encumbranceMax)
      : null;

  const weightOf = (item: CarriedItem): number | null =>
    factsOf(item)?.enc ?? item.encumbrance ?? null;
  const rows = packRows(items, weightOf);
  const weights = groupWeights(rows);
  // Each row's bar is a share of the heaviest row, so the one worth dropping
  // stands out down the whole list rather than within its group.
  const heaviest = Math.max(1, ...rows.map((row) => row.weight ?? 0));
  const weighed = PACK_GROUPS.reduce((sum, group) => sum + weights[group], 0);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (finding === false) setQuery('');
  }, [finding]);
  const wanted = query.trim().toLowerCase();
  const shown =
    wanted === ''
      ? rows
      : rows.filter(
          (row) =>
            row.item.name.toLowerCase().includes(wanted) ||
            String(entityNumber(row.item) ?? '').includes(wanted)
        );

  return (
    <>
      {!seen ? (
        <div className="empty">{t('cards.inventory.emptyUnseen')}</div>
      ) : (
        <>
          {/*
            The load, split by what carries it (2026-11-01): a share of the
            meter per group, in the group's colour, and what the realm cannot
            weigh as what is left of the server's own figure. The level the
            server would grade it at is the figures' colour, not the fill's.
          */}
          {encumbranceMax !== null && encumbranceMax > 0 && (
            <div
              className="pack-load"
              data-level={
                carried === null
                  ? 'ok'
                  : carried >= 0.9
                    ? 'critical'
                    : carried >= 0.7
                      ? 'caution'
                      : 'ok'
              }
            >
              <span className="pack-meter">
                {PACK_GROUPS.map((group) =>
                  weights[group] > 0 ? (
                    <span
                      className="pack-share"
                      data-group={group}
                      key={group}
                      style={{
                        width: `${Math.min(100, (weights[group] / encumbranceMax) * 100)}%`
                      }}
                    />
                  ) : null
                )}
                {encumbrance !== null && encumbrance > weighed && (
                  <span
                    className="pack-share"
                    data-group="unweighed"
                    style={{
                      width: `${Math.min(100, ((encumbrance - weighed) / encumbranceMax) * 100)}%`
                    }}
                    title={t('cards.inventory.unweighedTooltip')}
                  />
                )}
              </span>
              <span className="pack-legend">
                {PACK_GROUPS.filter((group) => weights[group] > 0).map((group) => (
                  <span data-group={group} key={group}>
                    <i />
                    {groupLabel(group)} <b>{weights[group]}</b>
                  </span>
                ))}
              </span>
            </div>
          )}

          {(hasPurse || keys.length > 0) && (
            <dl className="readout">
              {hasPurse && (
                <>
                  <dt>{t('cards.inventory.wealthLabel')}</dt>
                  <Purse coins={coins} wealth={wealth} />
                </>
              )}
              {keys.length > 0 && (
                <>
                  {/* Keys stay a row rather than joining the pack: they are not
                  carried things the listing counts. */}
                  <dt>{t('cards.inventory.keysLabel')}</dt>
                  <dd>{countedList(keys).join(', ')}</dd>
                </>
              )}
            </dl>
          )}

          {finding === true && (
            <FindField
              autoFocus
              label={t('cards.inventory.findPlaceholder')}
              onChange={setQuery}
              onDismiss={onFindDismiss}
              query={query}
              returnFocus={returnFocus}
            />
          )}

          <div
            className="scroller pack-list"
            role="list"
            aria-label={t('cards.inventory.tableCaption')}
          >
            {shown.length === 0 && (
              <div className="empty">
                {rows.length === 0 ? t('cards.inventory.tableEmpty') : t('cards.inventory.noMatch')}
              </div>
            )}
            {PACK_GROUPS.map((group) => {
              const mine = shown.filter((row) => row.group === group);
              if (mine.length === 0) return null;
              return (
                <section className="pack-group" data-group={group} key={group}>
                  <h3>
                    {groupLabel(group)}
                    {weights[group] > 0 && <span>{weights[group]}</span>}
                  </h3>
                  {mine.map((row) => (
                    <PackLine
                      gear={gear}
                      heaviest={heaviest}
                      inspect={inspect}
                      key={row.key}
                      row={row}
                      slot={slotOf(row.item, factsOf(row.item))}
                      verdict={mmeVerdict(
                        equipVerdict(row.item, wearer, t),
                        row.item,
                        factsOf(row.item)
                      )}
                    />
                  ))}
                </section>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

/** A group's heading, one literal key per group for the dictionary's coverage test. */
function groupLabel(group: PackGroup): string {
  switch (group) {
    case 'worn':
      return t('cards.inventory.group.worn');
    case 'kit':
      return t('cards.inventory.group.kit');
    case 'supplies':
      return t('cards.inventory.group.supplies');
    case 'other':
      return t('cards.inventory.group.other');
  }
}

/**
 * Where a worn thing sits, and where the word came from: the slot the game
 * named, else MME's word for it, else the realm file's -- each saying so on
 * hover, as it is not the server's -- or "in use" where nothing names one.
 */
function slotOf(
  item: CarriedItem,
  facts: ItemFacts | undefined
): { word: string; tooltip?: string } | null {
  if (!item.equipped) return null;
  if (item.slot !== null && item.slotSource !== 'realm') return { word: item.slot };
  const mme = mmeSlot(facts);
  if (mme !== null) return { word: mme, tooltip: t('cards.inventory.mmeSlotTooltip') };
  if (item.slot !== null)
    return { word: item.slot, tooltip: t('cards.inventory.realmSlotTooltip') };
  return { word: t('cards.inventory.inUseStatus'), tooltip: t('cards.inventory.inUseTooltip') };
}

/**
 * One row: the name (which opens the Reference card), how many, where it is
 * worn, its weight as a bar against the heaviest row and as a figure, and two
 * glyphs at the end -- put on or take off, and drop.
 *
 * The glyphs keep two fixed places, empty where the row has nothing to do
 * there, so they line up down the list. A worn thing has no Drop: it comes
 * off by its own glyph first rather than going to a floor anybody standing
 * there can pick it up from. Drop takes one; Shift takes every spare of the
 * name, which main sends a `drop` at a time -- the server takes no count for
 * an item, only for coins.
 */
function PackLine({
  row,
  slot,
  verdict,
  heaviest,
  gear,
  inspect
}: {
  row: PackRow;
  slot: { word: string; tooltip?: string } | null;
  verdict: EquipVerdict;
  heaviest: number;
  gear?: InventoryBodyProps['gear'];
  inspect?: InventoryBodyProps['inspect'];
}) {
  const { item, count, weight } = row;
  return (
    <div className="pack-row" data-group={row.group} role="listitem">
      <span className="pack-name">
        {inspect ? (
          <button
            className="what lookup"
            onClick={(event) => inspect(item.name, event.currentTarget)}
            onMouseDown={keepFocus}
            title={t('cards.room.itemLookupTooltip')}
            type="button"
          >
            {item.name}
          </button>
        ) : (
          <span className="what">{item.name}</span>
        )}
        {count > 1 && <span className="pack-count">×{count}</span>}
        {slot !== null && (
          <span className="pack-slot" title={slot.tooltip}>
            {slot.word}
          </span>
        )}
        {verdict.state === 'blocked' && (
          <span className="pack-note" title={verdict.label}>
            {t('cards.inventory.cantUse')}
          </span>
        )}
      </span>
      <span className="pack-bar" aria-hidden="true">
        {weight !== null && <i style={{ width: `${Math.max(3, (weight / heaviest) * 100)}%` }} />}
      </span>
      <span className="pack-weight">{weight}</span>
      <span className="pack-actions">
        {gear && verdict.state === 'worn' ? (
          <button
            aria-label={verdict.label}
            className="row-action worn"
            onClick={() => gear('remove', item.name)}
            onMouseDown={keepFocus}
            title={verdict.label}
            type="button"
          >
            <Icon name="shirtOff" />
          </button>
        ) : gear && verdict.state === 'wearable' ? (
          <button
            aria-label={verdict.label}
            className="row-action"
            onClick={() => gear('equip', item.name)}
            onMouseDown={keepFocus}
            title={verdict.label}
            type="button"
          >
            <Icon name="shirt" />
          </button>
        ) : (
          <span />
        )}
        {gear && row.group !== 'worn' ? (
          <button
            aria-label={
              count > 1
                ? t('cards.inventory.dropStackTooltip', { item: item.name, count })
                : t('cards.inventory.dropTooltip', { item: item.name })
            }
            className="row-action drop"
            onClick={(event) => gear(event.shiftKey ? 'drop-stack' : 'drop', item.name)}
            onMouseDown={keepFocus}
            title={
              count > 1
                ? t('cards.inventory.dropStackTooltip', { item: item.name, count })
                : t('cards.inventory.dropTooltip', { item: item.name })
            }
            type="button"
          >
            <Icon name="drop" />
          </button>
        ) : (
          <span />
        )}
      </span>
    </div>
  );
}

export default memo(InventoryCard);

/** Where MME says a thing is worn, or null for nowhere (or no answer). */
function mmeSlot(facts: ItemFacts | undefined): string | null {
  return facts === undefined || facts.worn === 'Nowhere' ? null : facts.worn;
}

/**
 * The equip control as MMUD Explorer rules it (2026-10-24): worn stays worn;
 * a thing worn nowhere has no control; one this character cannot use is
 * refused, with the realm's own reason where it gives one; the rest can be
 * put on.
 */
function mmeVerdict(
  verdict: EquipVerdict,
  item: CarriedItem,
  facts: ItemFacts | undefined
): EquipVerdict {
  if (facts === undefined || verdict.state === 'worn') return verdict;
  if (facts.worn === 'Nowhere') return { state: 'none', label: '', command: null };
  if (!facts.usable) {
    return {
      state: 'blocked',
      label:
        verdict.state === 'blocked'
          ? verdict.label
          : t('cards.inventory.mmeCantUse', { item: item.name }),
      command: null
    };
  }
  return {
    state: 'wearable',
    label: t('cards.inventory.equipTooltip', { item: item.name }),
    command: equip(item.name)
  };
}

/** MME's facts for what is carried, by the realm's number, asked again as the pack or the character changes. */
function useItemFacts(
  load: ((numbers: number[]) => Promise<ItemFacts[]>) | null | undefined,
  items: readonly CarriedItem[],
  characterKey: string
): ReadonlyMap<number, ItemFacts> {
  const numbers = [
    ...new Set(
      items.flatMap((item) => {
        const n = entityNumber(item);
        return n === null ? [] : [n];
      })
    )
  ].sort((a, b) => a - b);
  const asked = numbers.join(',');
  const key = `${asked}:${characterKey}`;
  const [answer, setAnswer] = useState<{ key: string; facts: ReadonlyMap<number, ItemFacts> }>({
    key: '',
    facts: new Map()
  });
  useEffect(() => {
    if (!load || asked === '') return;
    let live = true;
    void load(asked.split(',').map(Number)).then(
      (found) => live && setAnswer({ key, facts: new Map(found.map((f) => [f.number, f])) }),
      () => {}
    );
    return () => {
      live = false;
    };
  }, [load, asked, key]);
  return answer.facts;
}
