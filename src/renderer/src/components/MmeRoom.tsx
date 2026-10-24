import { Fragment, useEffect, useState } from 'react';

import EntityNumber from './EntityNumber';
import { Runs, type Follow } from './ExplorerDetailParts';
import { clockText } from './LairList';
import { keepFocus } from '../lib/focus';
import { t } from '../lib/i18n';
import type { Alignment } from '@shared/character';
import { attacksOnSight, DISPOSITION_WORD } from '@shared/mobs';
import type { ExplorerLair, ExplorerRoomFacts } from '@shared/explorer';

/**
 * What MMUD Explorer says a room holds, on the cards (2026-10-24): the room
 * panel's facts and the Room card's Lair face, where they drew the realm's
 * own. The realm's stay where MME has no answer (a realm it does not read, a
 * character not connected).
 */

/**
 * MME's facts for a room: undefined while asked, null where it has none.
 * Asked again when the room or what the answer turns on changes.
 */
export function useMmeRoom(
  load: ((map: number, room: number) => Promise<ExplorerRoomFacts>) | null | undefined,
  map: number | null,
  room: number | null,
  characterKey = ''
): ExplorerRoomFacts | null | undefined {
  const [answer, setAnswer] = useState<{ key: string; facts: ExplorerRoomFacts | null } | null>(
    null
  );
  const key = `${map}/${room}:${characterKey}`;
  useEffect(() => {
    if (!load || map === null || room === null) return;
    let live = true;
    void load(map, room).then(
      (facts) => live && setAnswer({ key, facts: facts.found ? facts : null }),
      () => live && setAnswer({ key, facts: null })
    );
    return () => {
      live = false;
    };
  }, [load, map, room, key]);
  if (!load || map === null || room === null) return null;
  return answer?.key === key ? answer.facts : undefined;
}

/** The room panel's facts in MME's words: its references, each a link, and its text. */
export function MmeRoomFacts({ facts, follow }: { facts: ExplorerRoomFacts; follow?: Follow }) {
  return (
    <div className="mme-room">
      {facts.refs.length > 0 && (
        <ul className="mme-room-refs">
          {facts.refs.map((line, i) => (
            <li key={i}>
              <Runs follow={follow} runs={line.text} />
            </li>
          ))}
        </ul>
      )}
      <pre className="rm-info">{facts.info}</pre>
    </div>
  );
}

/**
 * The Room card's Lair face in MME's figures: how many are up at once and
 * how often, what the lair is worth and what it does to the character, and
 * each monster with its own health, experience and temper.
 */
export function MmeLairList({
  lair,
  mine,
  inspect
}: {
  lair: ExplorerLair;
  /** How the realm ranks the reader; null reads as unknown, never harmless. */
  mine: Alignment | null;
  inspect?(name: string, anchor: HTMLElement): void;
}) {
  if (lair.monsters.length === 0) {
    return <div className="empty">{t('cards.room.lair.unnamed')}</div>;
  }
  return (
    <>
      <div className="chip-row">
        <span className="chip quiet">
          {lair.max === 1
            ? t('cards.room.lair.upTo.one')
            : t('cards.room.lair.upTo.many', { max: lair.max })}
        </span>
        {lair.regen !== null && <span className="chip quiet">{lair.regen}</span>}
      </div>
      {(lair.exp !== null || lair.damage !== null) && (
        <div className="aside">
          {lair.exp !== null &&
            lair.hp !== null &&
            t('cards.room.lair.worth', {
              exp: lair.exp.toLocaleString(),
              hp: lair.hp.toLocaleString()
            })}
          {lair.damage !== null && <> · {lair.damage}</>}
        </div>
      )}
      <dl className="readout lair-list">
        {lair.monsters.map((mob) => {
          const sure = attacksOnSight(mob.disposition, mine);
          return (
            <Fragment key={mob.n}>
              <dt>
                {inspect ? (
                  <button
                    className="occupant mob lookup"
                    onClick={(event) => inspect(mob.name, event.currentTarget)}
                    onMouseDown={keepFocus}
                    title={t('cards.room.itemLookupTooltip')}
                    type="button"
                  >
                    {mob.name}
                  </button>
                ) : (
                  <span className="occupant mob">{mob.name}</span>
                )}
                <EntityNumber of={{ id: mob.n }} />
              </dt>
              <dd>
                {t('cards.room.lair.healthExp', { hp: mob.hp, exp: mob.exp.toLocaleString() })}
                {sure === true && (
                  <span className="chip warn">{t('cards.realm.facet.hostile')}</span>
                )}
                {sure !== true && (
                  <span className="chip quiet">{DISPOSITION_WORD[mob.disposition]}</span>
                )}
                {mob.costsAlignment && (
                  <span className="chip quiet">{t('cards.room.occupant.alignCostChip')}</span>
                )}
                {mob.regenHours > 0 && (
                  <span className="chip quiet" title={t('cards.room.lair.mobRespawnHint')}>
                    {t('cards.room.lair.respawn', { clock: clockText(mob.regenHours * 3600) })}
                  </span>
                )}
              </dd>
            </Fragment>
          );
        })}
      </dl>
      <div className="aside">{t('cards.room.lair.aside')}</div>
    </>
  );
}

/** The Lair face as text, for its copy: MME's lines. */
export function mmeLairCopyText(lair: ExplorerLair): string {
  return [
    t('cards.room.tabs.lair'),
    ...lair.monsters.map((mob) => `${mob.name} #${mob.n} — ${mob.hp} hp, ${mob.exp} exp`)
  ].join('\n');
}
