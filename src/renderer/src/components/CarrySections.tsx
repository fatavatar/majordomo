import { ItemRuleList } from './ItemRules';
import { t } from '../lib/i18n';
import type { LootConfig } from '@shared/config';

/**
 * MegaMUD's item details at this scope, laid over the realm's item table
 * field by field (`loot.itemDetails`). Part of the form's draft, so it saves
 * with it, as the monster rows do. Its own export for the Character page,
 * which keeps it under MegaMUD's Loot tab without the old automation's
 * looting beside it.
 */
export function ItemDetailsFieldset({
  rows,
  idPrefix,
  onChange
}: {
  rows: LootConfig['itemDetails'];
  idPrefix: string;
  onChange(rows: LootConfig['itemDetails']): void;
}): React.JSX.Element {
  return (
    <fieldset className="settings-menus" data-fieldset="item-details">
      <legend>{t('settings.movement.itemRowsLegend')}</legend>
      <p className="settings-note">{t('settings.movement.itemRowsNote')}</p>
      <div className="realm-messages">
        <ItemRuleList
          addLabel={t('settings.items.add')}
          emptyText={t('settings.movement.itemRowsNone')}
          namePrefix={`${idPrefix}item-row`}
          onChange={(next) => {
            onChange(next);
            return Promise.resolve(null);
          }}
          rows={rows}
        />
      </div>
    </fieldset>
  );
}
