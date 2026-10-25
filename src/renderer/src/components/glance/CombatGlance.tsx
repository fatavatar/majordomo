import type { ReactNode } from 'react';

import { KitAside, KitBar, KitLine } from '../kit';
import type { CharacterState, TargetHealth } from '@shared/character';
import type { RoomVerdict } from '@shared/verdict';
import { woundBandFor } from '@shared/wounds';
import { t } from '../../lib/i18n';
import { tuning } from '../../lib/tuning';

type Level = 'unknown' | 'ok' | 'caution' | 'critical';

function levelOf(remaining: number | null): Level {
  if (remaining === null) return 'unknown';
  if (remaining < tuning().woundCritical) return 'critical';
  if (remaining < tuning().woundCaution) return 'caution';
  return 'ok';
}

/**
 * One bar for the whole fight: this character's damage, everybody else's,
 * and what is left of the monster, side by side in that order, with the
 * figures in the bar. A monster nothing puts a maximum on is drawn as the
 * split of what was dealt across the whole bar, and its realm word.
 */
function FightBar({ health }: { health: TargetHealth }) {
  const { max, damage, remaining } = health;
  const dealt = damage.mine + damage.others;
  const known = max !== null && max > 0 && remaining !== null;
  const scale = known ? max : Math.max(1, dealt);
  const mine = Math.min(100, (damage.mine / scale) * 100);
  const others = Math.min(100 - mine, (damage.others / scale) * 100);
  const left = known
    ? `${Math.round(remaining * max)} / ${max}`
    : (woundBandFor(remaining) ?? `−${dealt}`);
  return (
    <div className="glance-fight" data-level={levelOf(remaining)}>
      <i className="glance-fight-mine" style={{ width: `${mine}%` }} />
      <i className="glance-fight-others" style={{ left: `${mine}%`, width: `${others}%` }} />
      <span className="kit-bar-text">
        <span>
          {t('cards.combat.glance.you', { damage: damage.mine })}
          {damage.others > 0 && ` · ${t('cards.combat.glance.party', { damage: damage.others })}`}
        </span>
        <span className="glance-fight-left">{left}</span>
      </span>
    </div>
  );
}

export interface CombatGlanceProps {
  character: CharacterState;
  verdict: RoomVerdict;
  /** A name in the fight as the control that opens its card (`Combatant`). */
  name(name: string): ReactNode;
}

/**
 * The Combat card as `glance` lays it out (2026-10-25): what is being fought
 * on one line with its facts as chips beside it (what it absorbs, whether it
 * follows, what it casts dying, the round), one bar splitting the damage by
 * who dealt it, who is on the character in one line — red when it is more
 * than one — and the fight run, where it can be, as a bar of the share of
 * fights walked out of. Its drops close the card in a quiet line.
 */
export default function CombatGlance({ character, verdict, name }: CombatGlanceProps) {
  const { combat } = character;
  const survival = verdict.monsters.length > 0 ? verdict.survival : null;
  const entity = combat.targetEntity;
  const outnumbered = combat.attackers.length > 1;
  return (
    <>
      {survival !== null && (
        <KitBar
          fraction={survival.survives}
          label={t('cards.combat.survival.walkOut', {
            percent: Math.round(survival.survives * 100)
          })}
          level={
            survival.level === 'safe' ? 'ok' : survival.level === 'risky' ? 'caution' : 'critical'
          }
          tag={t('cards.combat.survival.roundsOnly', {
            rounds: Math.round(survival.rounds.value)
          })}
          title={t('cards.combat.survival.trials', { count: survival.trials })}
          tone="life"
          value={t('cards.combat.survival.walkOut', {
            percent: Math.round(survival.survives * 100)
          })}
        />
      )}
      {!combat.engaged && combat.attackers.length === 0 ? (
        survival === null && <div className="empty">{t('cards.combat.empty')}</div>
      ) : (
        <>
          <KitLine>
            {combat.health === null ? (
              <span className="hint">{t('cards.combat.noTarget')}</span>
            ) : (
              <span className="glance-target">{name(combat.health.name)}</span>
            )}
            {entity !== null &&
              (entity.armour !== undefined || entity.damageResist !== undefined) && (
                <span className="chip">
                  {t('cards.combat.glance.armour', {
                    ac: entity.armour ?? 0,
                    dr: entity.damageResist ?? 0
                  })}
                </span>
              )}
            {entity?.follows !== undefined && (
              <span className="chip">
                {t('cards.combat.glance.follows', { percent: entity.follows })}
              </span>
            )}
            {entity?.deathSpell !== undefined && (
              <span className="chip warn">{t('cards.combat.readout.onDeathCasts')}</span>
            )}
            {combat.health?.observed != null && (
              <span className="chip" title={t('cards.combat.readout.looked')}>
                {combat.health.observed}
              </span>
            )}
            <span className="kit-figure" data-push="true">
              <span>{t('cards.combat.glance.round')}</span> <b>{combat.blows}</b>
            </span>
          </KitLine>
          {combat.health !== null && <FightBar health={combat.health} />}
          {combat.attackers.length > 0 && (
            <KitLine>
              <span className={outnumbered ? 'glance-on-you many' : 'glance-on-you'}>
                {t('cards.combat.readout.onYou')}
              </span>
              {combat.attackers.map((attacker, index) => (
                <span key={attacker}>
                  {name(attacker)}
                  {index < combat.attackers.length - 1 && ','}
                </span>
              ))}
            </KitLine>
          )}
          {entity?.drops !== undefined && entity.drops.length > 0 && (
            <KitAside>
              {t('cards.combat.glance.drops', {
                drops: entity.drops.map((drop) => drop.name).join(', ')
              })}
            </KitAside>
          )}
        </>
      )}
    </>
  );
}
