import { t } from '../lib/i18n';
import type { WardRule } from '@shared/world';

/**
 * The realm's own rows of the same list: *use this item where that spell is
 * cast* (todo 02).
 *
 * Read-only, because nobody wrote them. The realm says which spell stops a
 * room's own effect and which item's use casts it, so there is nothing to
 * type — but a switch over rules nobody can read is the invisible setting
 * this project refuses everywhere else, and the desert is 945 rooms of a
 * realm somebody is about to walk into. So they are drawn: the item, the
 * room spell it answers, and how many rooms cast it.
 *
 * Nothing at all where the realm names none, which is also the answer for a
 * client with no world loaded. The switch above still says what it does.
 */
export function WardRules({ rules }: { rules: readonly WardRule[] }) {
  if (rules.length === 0) return null;
  return (
    <ul className="ward-rules">
      {rules.map((rule) => (
        <li key={`${rule.item}/${rule.hazard}`}>
          <span className="ward-item">{rule.item}</span>
          <span className="ward-because">
            {/* Two literal calls, as every plural pair here is. */}
            {rule.rooms === 1
              ? t('settings.health.wardRow.one', { hazard: rule.hazard, rooms: rule.rooms })
              : t('settings.health.wardRow.many', { hazard: rule.hazard, rooms: rule.rooms })}
          </span>
        </li>
      ))}
    </ul>
  );
}
