import { useEffect, useState } from 'react';

import { keepFocus } from '../lib/focus';
import { t } from '../lib/i18n';
import { coinText } from '../lib/coins';
import { copperSpread } from '@shared/coins';
import type {
  ExplorerBuyPlan,
  ExplorerDetail,
  ExplorerPlace,
  ExplorerSegment
} from '@shared/explorer';

/**
 * The parts of an MMUD Explorer detail drawn wherever one is shown: the
 * Explorer's own pane and the Reference detail on the cards (2026-10-24),
 * so an item reads the same in both.
 */

/** What Buy (or Buy + Learn) would do for an item now; null where there is nothing to buy. */
export type BuyPlanOf = (item: number) => Promise<ExplorerBuyPlan | null>;
/** Buy, or Buy + Wear; why not, or null where the character is on its way. */
export type BuyPress = (item: number, wear: boolean) => Promise<string | null>;
/** Buy + Learn: buys the scroll and reads it; why not, or null. */
export type LearnPress = (item: number) => Promise<string | null>;
/** Where a reference leads, its words, and the element pressed, for a card to open beside it. */
export type Follow = (place: ExplorerPlace, text: string, anchor: HTMLElement) => void;

/**
 * A run of MME's text: a reference drawn as one, the rest as it is.
 *
 * Marked-up text: a reference a tab here shows is a link that opens it, as
 * mudtool's `a.xref` are; one no tab shows yet reads as a reference all the
 * same, and says what it names.
 */
export function Runs({ runs, follow }: { runs: readonly ExplorerSegment[]; follow?: Follow }) {
  return (
    <>
      {runs.map((run, i) =>
        !('kind' in run) ? (
          <span key={i}>{run.text}</span>
        ) : run.tab !== null && follow !== undefined ? (
          <button
            className="ex-link ex-ref"
            data-kind={run.kind}
            key={i}
            onClick={(event) => follow({ tab: run.tab!, n: run.n }, run.text, event.currentTarget)}
            onMouseDown={keepFocus}
            title={`${run.kind} #${run.n}`}
            type="button"
          >
            {run.text}
          </button>
        ) : (
          <span className="ex-ref" data-kind={run.kind} key={i} title={`${run.kind} #${run.n}`}>
            {run.text}
          </span>
        )
      )}
    </>
  );
}

/** A shop's shelf or a trainer's table (`PullShopDetail`'s list), its items links. */
export function Stock({
  stock,
  follow
}: {
  stock: NonNullable<ExplorerDetail['stock']>;
  follow: Follow;
}) {
  const rows = stock.trainer
    ? [...stock.rows].sort((a, b) => (a.level ?? 0) - (b.level ?? 0))
    : [...stock.rows].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  return (
    <table className="ex-stock">
      <thead>
        {stock.trainer ? (
          <tr>
            <th>{t('explorer.shops.level')}</th>
            <th>{t('explorer.shops.cost')}</th>
          </tr>
        ) : (
          <tr>
            <th>#</th>
            <th>{t('explorer.columns.name')}</th>
            <th>{t('explorer.shops.max')}</th>
            <th>{t('explorer.shops.regen')}</th>
            <th>{t('explorer.shops.cost')}</th>
          </tr>
        )}
      </thead>
      <tbody>
        {rows.map((row, i) =>
          stock.trainer ? (
            <tr key={i}>
              <td className="ex-num">{row.level}</td>
              <td>{row.cost}</td>
            </tr>
          ) : (
            <tr key={i}>
              <td className="ex-num">{row.item}</td>
              <td>
                {row.tab != null && row.item !== undefined ? (
                  <button
                    className="ex-link ex-ref"
                    onClick={(event) =>
                      follow({ tab: row.tab!, n: row.item! }, row.name ?? '', event.currentTarget)
                    }
                    onMouseDown={keepFocus}
                    type="button"
                  >
                    {row.name}
                  </button>
                ) : (
                  row.name
                )}
              </td>
              <td className="ex-num">{row.max}</td>
              <td>{row.regen}</td>
              <td>{row.cost}</td>
            </tr>
          )
        )}
      </tbody>
    </table>
  );
}

/** A container's contents and the chance of each, MME's *View Chest Contents*, each a link. */
export function Chest({
  chest,
  follow
}: {
  chest: NonNullable<ExplorerDetail['chest']>;
  follow: Follow;
}) {
  return (
    <>
      <h3 className="ex-heading">{t('explorer.sundry.chest')}</h3>
      <table className="ex-stock">
        <tbody>
          {chest.map((entry) => (
            <tr key={entry.item}>
              <td className="ex-num">{entry.pct}%</td>
              <td>
                {entry.tab === null ? (
                  entry.name
                ) : (
                  <button
                    className="ex-link ex-ref"
                    onClick={(event) =>
                      follow({ tab: entry.tab!, n: entry.item }, entry.name, event.currentTarget)
                    }
                    onMouseDown={keepFocus}
                    type="button"
                  >
                    {entry.name}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** A copper total as the coins it makes, as the purse is shown. */
const coins = (copper: number): string => coinText(copperSpread(copper), 1) || '0';

/**
 * Buy and Buy + Wear (2026-10-18): where the character would go and what it
 * would pay, the bank it draws the shortfall from first, or why it cannot;
 * then the press, which sends it. The plan is main's (`purchaseFor`), the one
 * the purchase acts on, asked again as the purse, the room or the gear change.
 */
export function BuyBox({
  item,
  purseKey,
  characterKey,
  buyPlan,
  buy,
  learn
}: {
  item: number;
  purseKey: string;
  characterKey: string;
  buyPlan: BuyPlanOf;
  buy: BuyPress;
  /**
   * A spell's box (2026-10-20): `item` is the spell, the plan is for the
   * scroll that teaches it, and the second button buys and reads it.
   */
  learn?: {
    plan: BuyPlanOf;
    press: LearnPress;
    /** The class may learn it (`spellUsableBy`); why not, where it may not. */
    refused: string | null;
  };
}) {
  const [plan, setPlan] = useState<{ asked: number; plan: ExplorerBuyPlan | null } | null>(null);
  const [said, setSaid] = useState<{ text: string; ok: boolean } | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => setSaid(null), [item]);
  const planOf = learn?.plan ?? buyPlan;
  useEffect(() => {
    let live = true;
    void planOf(item).then((found) => {
      if (live) setPlan({ asked: item, plan: found });
    });
    return () => {
      live = false;
    };
  }, [item, planOf, purseKey, characterKey]);
  if (plan === null || plan.asked !== item) return null;
  if (plan.plan === null) {
    return learn === undefined ? null : (
      <div className="ex-buy">
        <h3 className="ex-heading">{t('explorer.buy.learnHeading')}</h3>
        <div className="ex-buy-line">{t('explorer.buy.noScroll')}</div>
      </div>
    );
  }
  return (
    <BuyLines
      buy={buy}
      learn={learn}
      plan={plan.plan}
      said={said}
      sending={sending}
      setSaid={setSaid}
      setSending={setSending}
    />
  );
}

/** The Buy box's lines and buttons, for its plan. */
function BuyLines({
  plan,
  buy,
  learn,
  said,
  setSaid,
  sending,
  setSending
}: {
  plan: ExplorerBuyPlan;
  buy: BuyPress;
  learn: { press: LearnPress; refused: string | null } | undefined;
  said: { text: string; ok: boolean } | null;
  setSaid(said: { text: string; ok: boolean } | null): void;
  sending: boolean;
  setSending(sending: boolean): void;
}) {
  const item = plan.item;
  const press = (wear: boolean): void => {
    setSending(true);
    void (learn !== undefined && wear ? learn.press(item) : buy(item, wear))
      .then((why) =>
        setSaid(
          why === null ? { text: t('explorer.buy.sent'), ok: true } : { text: why, ok: false }
        )
      )
      .finally(() => setSending(false));
  };
  const shop = plan.shop;
  const blocked = plan.refusal !== undefined || sending;
  const removes = plan.wear.remove.join(', ');
  return (
    <div className="ex-buy">
      <h3 className="ex-heading">
        {learn === undefined
          ? t('explorer.buy.heading')
          : t('explorer.buy.learnFrom', { item: plan.name })}
      </h3>
      {shop !== undefined && (
        <div className="ex-buy-line">
          {t('explorer.buy.where', {
            shop: shop.name,
            room: shop.roomName,
            moves: shop.moves,
            price: plan.price === null ? t('explorer.buy.unpriced') : coins(plan.price)
          })}
        </div>
      )}
      {plan.refusal !== undefined ? (
        <div className="ex-buy-line" data-tone="danger">
          {plan.refusal}
        </div>
      ) : plan.bank !== undefined ? (
        <div className="ex-buy-line" data-tone="pending">
          {plan.bank.balance === null
            ? t('explorer.buy.bankUnread', {
                amount: coins(plan.bank.withdraw),
                bank: plan.bank.name,
                room: plan.bank.roomName
              })
            : t('explorer.buy.bankFirst', {
                amount: coins(plan.bank.withdraw),
                bank: plan.bank.name,
                room: plan.bank.roomName,
                balance: coins(plan.bank.balance)
              })}
        </div>
      ) : (
        <div className="ex-buy-line" data-tone="ok">
          {t('explorer.buy.onHand', { purse: plan.purse === null ? '?' : coins(plan.purse) })}
        </div>
      )}
      <div className="ex-buy-actions">
        <button
          className="ex-buy-button"
          disabled={blocked}
          onClick={() => press(false)}
          type="button"
        >
          {t('explorer.buy.buy')}
        </button>
        {learn !== undefined ? (
          <button
            className="ex-buy-button"
            disabled={blocked || learn.refused !== null}
            onClick={() => press(true)}
            title={learn.refused ?? t('explorer.buy.buyLearnTitle', { item: plan.name })}
            type="button"
          >
            {t('explorer.buy.buyLearn')}
          </button>
        ) : (
          <button
            className="ex-buy-button"
            disabled={blocked || !plan.wear.wearable}
            onClick={() => press(true)}
            title={
              !plan.wear.wearable
                ? t('explorer.buy.notWorn')
                : removes === ''
                  ? undefined
                  : t('explorer.buy.takesOff', { items: removes })
            }
            type="button"
          >
            {t('explorer.buy.buyWear')}
          </button>
        )}
        {said !== null && (
          <span className="ex-buy-said" data-tone={said.ok ? 'ok' : 'danger'}>
            {said.text}
          </span>
        )}
      </div>
    </div>
  );
}
