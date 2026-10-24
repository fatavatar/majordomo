import { useEffect, useMemo, useState } from 'react';

import {
  BuyBox,
  Chest,
  Runs,
  Stock,
  type BuyPlanOf,
  type BuyPress,
  type Follow,
  type LearnPress
} from './ExplorerDetailParts';
import type { ReferenceEntry } from './ReferenceDetail';
import { keepFocus } from '../lib/focus';
import { t } from '../lib/i18n';
import { entityNumber } from '@shared/entities';
import {
  DEFAULT_EXPLORER_OPTIONS,
  EXPLORER_KINDS,
  type ExplorerDetail,
  type ExplorerKind,
  type ExplorerOptions,
  type ExplorerTab
} from '@shared/explorer';
import type { SessionId } from '@shared/ipc';

/**
 * MMUD Explorer's detail on the cards (2026-10-24): the Reference card and
 * the slide-out show MME's own words for an item, monster, spell, race or
 * class in place of the realm figures they drew themselves, so one thing
 * reads the same here as on the Explorer screen. What only this client
 * knows (the verdict, what was learned and fought, where it lives, the
 * supplies) stays beside it, and a realm MME does not read keeps the old
 * figures.
 */

/** What a card asks MME, for one character. */
export interface ExplorerCalls {
  detail(kind: ExplorerKind, n: number, options: ExplorerOptions): Promise<ExplorerDetail | null>;
  buyPlan: BuyPlanOf;
  buy: BuyPress;
  learnPlan: BuyPlanOf;
  learn: LearnPress;
}

/** The calls bound to a character, built once per character so a card's memo holds. */
export function explorerCalls(
  session: SessionId,
  api: {
    explorerDetail(
      session: SessionId,
      kind: ExplorerKind,
      n: number,
      options: ExplorerOptions
    ): Promise<ExplorerDetail | null>;
    explorerBuyPlan(session: SessionId, item: number): ReturnType<BuyPlanOf>;
    explorerBuy(session: SessionId, item: number, wear: boolean): ReturnType<BuyPress>;
    explorerLearnPlan(session: SessionId, spell: number): ReturnType<BuyPlanOf>;
    explorerLearn(session: SessionId, item: number): ReturnType<LearnPress>;
  }
): ExplorerCalls {
  return {
    detail: (kind, n, options) => api.explorerDetail(session, kind, n, options),
    buyPlan: (item) => api.explorerBuyPlan(session, item),
    buy: (item, wear) => api.explorerBuy(session, item, wear),
    learnPlan: (spell) => api.explorerLearnPlan(session, spell),
    learn: (item) => api.explorerLearn(session, item)
  };
}

/** A card's link to MME for the character it shows. */
export interface ExplorerLink {
  calls: ExplorerCalls;
  /** Changes when the detail answers for something else: the class, the level, what is worn. */
  characterKey: string;
  /** Changes when what Buy would do might: the purse, the room, a bank's balance. */
  purseKey: string;
  /** The Explorer screen on a record; null for a character not shown, whose Explorer it is not. */
  explore: ((kind: ExplorerKind, n: number) => void) | null;
  /** A room's panel beside the link that named it, `map/room`; null where there is none to open. */
  openRoom: ((room: string, anchor: HTMLElement) => void) | null;
}

/** What a card is handed to link its detail to MME; a card without them draws the realm figures. */
export interface ExplorerLinkProps {
  /** MME's calls for the character the card shows; null for none. */
  explorer?: ExplorerCalls | null;
  characterKey?: string;
  purseKey?: string;
  /** The Explorer screen on a record; null for a character not shown. */
  explore?: ((kind: ExplorerKind, n: number) => void) | null;
  /** A room's panel beside the link that named it; null for a character not shown. */
  openRoom?: ((room: string, anchor: HTMLElement) => void) | null;
}

/** The link a card's detail is drawn with, kept while nothing in it changes. */
export function useExplorerLink({
  explorer = null,
  characterKey = '',
  purseKey = '',
  explore = null,
  openRoom = null
}: ExplorerLinkProps): ExplorerLink | null {
  return useMemo(
    () =>
      explorer === null ? null : { calls: explorer, characterKey, purseKey, explore, openRoom },
    [explorer, characterKey, purseKey, explore, openRoom]
  );
}

/**
 * Which of MME's lists an entry is on, and its number there; null where no
 * single row answers (a monster name several rows share, with nothing to
 * settle which). An item is on mudtool's `itemTab`: a weapon, a worn piece
 * of armour, and everything else on Sundry.
 */
export function explorerPlace(entry: ReferenceEntry): { kind: ExplorerKind; n: number } | null {
  switch (entry.kind) {
    case 'mob': {
      const n = entityNumber(entry.mob);
      return n === null ? null : { kind: 'monsters', n };
    }
    case 'item':
      return {
        kind:
          entry.item.kind === 'weapon'
            ? 'weapons'
            : entry.item.kind === 'armour' && entry.item.slot !== undefined
              ? 'armour'
              : 'sundry',
        n: entry.item.id
      };
    case 'spell':
      return { kind: 'spells', n: entry.spell.id };
    case 'race':
      return { kind: 'races', n: entry.race.id };
    case 'class':
      return { kind: 'classes', n: entry.className.id };
  }
}

/**
 * MME's detail for an entry: undefined while it is asked, null where MME has
 * none (no link, a realm it does not read, a row it cannot settle).
 */
export function useExplorerDetail(
  link: ExplorerLink | null,
  entry: ReferenceEntry
): ExplorerDetail | null | undefined {
  const place = link === null ? null : explorerPlace(entry);
  const kind = place?.kind ?? null;
  const n = place?.n ?? null;
  const calls = link?.calls ?? null;
  const characterKey = link?.characterKey ?? '';
  const [answer, setAnswer] = useState<{ asked: string; detail: ExplorerDetail | null } | null>(
    null
  );
  const asked = `${kind}:${n}:${characterKey}`;
  useEffect(() => {
    if (calls === null || kind === null || n === null) return;
    let live = true;
    void calls.detail(kind, n, DEFAULT_EXPLORER_OPTIONS).then(
      (detail) => live && setAnswer({ asked, detail }),
      () => live && setAnswer({ asked, detail: null })
    );
    return () => {
      live = false;
    };
  }, [calls, kind, n, asked]);
  if (calls === null || kind === null || n === null) return null;
  return answer?.asked === asked ? answer.detail : undefined;
}

/** The lists whose records the slide-out answers by name: everything but a shop. */
const NAMED: ReadonlySet<ExplorerTab> = new Set<ExplorerTab>([
  'weapons',
  'armour',
  'sundry',
  'spells',
  'monsters',
  'classes',
  'races'
]);

function isKind(tab: ExplorerTab): tab is ExplorerKind {
  return (EXPLORER_KINDS as readonly ExplorerTab[]).includes(tab);
}

/**
 * Where a reference in MME's detail leads from a card: a name to the
 * slide-out beside it, a room to the room's panel with the way there on it,
 * a shop (which neither answers) to the Explorer on it; undefined where none
 * of them can be opened, which leaves the references as text.
 */
export function followFor(
  link: Pick<ExplorerLink, 'explore' | 'openRoom'>,
  onName: ((name: string, anchor: HTMLElement) => void) | null
): Follow | undefined {
  const { explore, openRoom } = link;
  if (onName === null && explore === null && openRoom === null) return undefined;
  return (place, text, anchor) => {
    if (place.tab === 'rooms') {
      if (openRoom !== null && typeof place.n === 'string') openRoom(place.n, anchor);
    } else if (NAMED.has(place.tab)) {
      onName?.(text, anchor);
    } else if (explore !== null && isKind(place.tab) && typeof place.n === 'number') {
      explore(place.tab, place.n);
    }
  };
}

/**
 * MME's detail drawn on a card: its text, a monster's or a class's table, a
 * shop's shelf or a chest's contents, Buy (or Buy + Learn) for an item or a
 * spell, and where it comes from. A name in it opens the slide-out beside
 * it, a room the room's panel with the way there on it, and a shop, which
 * neither answers, the Explorer on it.
 */
export function ExplorerFacts({
  detail,
  kind,
  link,
  onName
}: {
  detail: ExplorerDetail;
  kind: ExplorerKind;
  link: ExplorerLink;
  onName: ((name: string, anchor: HTMLElement) => void) | null;
}) {
  const { explore } = link;
  const follow = followFor(link, onName);
  const item = kind === 'weapons' || kind === 'armour' || kind === 'sundry';
  return (
    <div className="reference-explorer">
      <p className="ex-text">
        <Runs follow={follow} runs={detail.text} />
      </p>
      {detail.note !== undefined && <p className="ex-note">{detail.note}</p>}
      {detail.table !== undefined && (
        <table className="ex-mon">
          <tbody>
            {detail.table.map((row, i) => (
              <tr data-cls={row.cls} key={i}>
                <th>
                  <Runs follow={follow} runs={row.label} />
                </th>
                <td>
                  <Runs follow={follow} runs={row.text} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {detail.stock !== undefined && detail.stock.rows.length > 0 && follow !== undefined && (
        <Stock follow={follow} stock={detail.stock} />
      )}
      {detail.chest !== undefined && follow !== undefined && (
        <Chest chest={detail.chest} follow={follow} />
      )}
      {item && (
        <BuyBox
          buy={link.calls.buy}
          buyPlan={link.calls.buyPlan}
          characterKey={link.characterKey}
          item={detail.number}
          purseKey={link.purseKey}
        />
      )}
      {kind === 'spells' && (
        <BuyBox
          buy={link.calls.buy}
          buyPlan={link.calls.buyPlan}
          characterKey={link.characterKey}
          item={detail.number}
          learn={{ plan: link.calls.learnPlan, press: link.calls.learn, refused: null }}
          purseKey={link.purseKey}
        />
      )}
      {detail.refs.length > 0 && (
        <>
          <h3 className="ex-heading">{detail.refsTitle ?? t('explorer.references')}</h3>
          <table className="ex-refs">
            <tbody>
              {detail.refs.map((ref, i) => (
                <tr key={i}>
                  <td className="ex-pct">{ref.pct === undefined ? '' : `${ref.pct}%`}</td>
                  <td>
                    <Runs follow={follow} runs={ref.text} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {explore !== null && (
        <button
          className="ex-link reference-explore"
          onClick={() => explore(kind, detail.number)}
          onMouseDown={keepFocus}
          type="button"
        >
          {t('cards.reference.openInExplorer')}
        </button>
      )}
    </div>
  );
}
