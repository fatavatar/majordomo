/**
 * A clicked monster's or item's Edit, in the Reference panel (2026-10-20):
 * this character's own row for it, in the same editor the Combat and Loot
 * pages draw, with what the realm's table already says shown above it.
 *
 * The character's own row and never the realm's: the realm's table is every
 * character's who plays there, and a click in one character's console
 * should not change what another does. A row is laid over the realm's field
 * by field (`mergeMonsterRules`), so an unset field here keeps the realm's.
 */
import { useEffect, useState } from 'react';

import { ItemRuleChips, ItemRuleEditor } from './ItemRules';
import { MonsterRuleChips, MonsterRuleEditor } from './MonsterRules';
import { t } from '../lib/i18n';
import { itemKey, itemSaysAnything, type ItemRule } from '@shared/itemRules';
import { saysAnything, type MonsterRule } from '@shared/monsterRules';
import { mobKey } from '@shared/world';

/** A character's rows of one kind: the realm's table and its own, and the write. */
export interface RuleStore<R> {
  rules(): Promise<{ realm: R[]; own: R[] }>;
  /** The own rows, written whole. Why not, or null. */
  save(own: R[]): Promise<string | null>;
}

export interface ReferenceRules {
  monsters: RuleStore<MonsterRule>;
  items: RuleStore<ItemRule>;
}

/** What the two kinds differ in: how a row is keyed, and whether it says anything. */
interface Kind<R> {
  key(name: string): string;
  keyOf(row: R): string;
  blank(key: string): R;
  says(row: R): boolean;
}

const MONSTER: Kind<MonsterRule> = {
  key: mobKey,
  keyOf: (row) => row.mob,
  blank: (mob) => ({ mob }),
  says: saysAnything
};

const ITEM: Kind<ItemRule> = {
  key: itemKey,
  keyOf: (row) => row.item,
  blank: (item) => ({ item }),
  says: itemSaysAnything
};

interface Loaded<R> {
  realm: R | null;
  own: R[];
  draft: R;
  /** Whether the character's file already has a row for it. */
  had: boolean;
}

function useRow<R>(kind: Kind<R>, store: RuleStore<R>, name: string) {
  const [loaded, setLoaded] = useState<Loaded<R> | null | 'failed'>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const key = kind.key(name);

  useEffect(() => {
    let live = true;
    setLoaded(null);
    void store
      .rules()
      .then(({ realm, own }) => {
        if (!live) return;
        const mine = own.find((row) => kind.keyOf(row) === key);
        setLoaded({
          realm: realm.find((row) => kind.keyOf(row) === key) ?? null,
          own,
          draft: mine === undefined ? kind.blank(key) : { ...mine },
          had: mine !== undefined
        });
      })
      .catch(() => {
        if (live) setLoaded('failed');
      });
    return () => {
      live = false;
    };
  }, [kind, store, key]);

  const write = async (rows: R[], done: () => void): Promise<void> => {
    const answer = await store.save(rows);
    if (answer !== null) {
      setRefusal(answer);
      return;
    }
    done();
  };

  return {
    loaded,
    refusal,
    setDraft: (draft: R) =>
      setLoaded((was) => (was === null || was === 'failed' ? was : { ...was, draft })),
    /** The own rows with this one put in its place, or dropped where it says nothing. */
    save: (done: () => void) => {
      if (loaded === null || loaded === 'failed') return;
      const rest = loaded.own.filter((row) => kind.keyOf(row) !== key);
      const placed = loaded.had
        ? loaded.own.flatMap((row) =>
            kind.keyOf(row) !== key ? [row] : kind.says(loaded.draft) ? [loaded.draft] : []
          )
        : kind.says(loaded.draft)
          ? [...rest, loaded.draft]
          : rest;
      void write(placed, done);
    },
    remove: (done: () => void) => {
      if (loaded === null || loaded === 'failed') return;
      void write(
        loaded.own.filter((row) => kind.keyOf(row) !== key),
        done
      );
    }
  };
}

interface EditProps<R> {
  name: string;
  store: RuleStore<R>;
  /** Closes the editor; `saved` says whether anything was written. */
  onDone(saved: boolean): void;
}

function Shell({
  realmChips,
  refusal,
  children
}: {
  realmChips: React.ReactNode | null;
  refusal: string | null;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section
      className="reference-rule-edit settings-form"
      aria-label={t('cards.reference.edit.heading')}
    >
      <h3 className="reference-rule-heading">{t('cards.reference.edit.heading')}</h3>
      <p className="reference-rule-realm">
        {realmChips === null ? (
          t('cards.reference.edit.realmNone')
        ) : (
          <>
            <span>{t('cards.reference.edit.realmSays')}</span>
            {realmChips}
          </>
        )}
      </p>
      {children}
      {refusal !== null && (
        <p className="messages-status bad" role="status">
          {refusal}
        </p>
      )}
    </section>
  );
}

export function MonsterRuleEdit({
  name,
  store,
  onDone
}: EditProps<MonsterRule>): React.JSX.Element {
  const row = useRow(MONSTER, store, name);
  if (row.loaded === null) return <div className="empty">{t('cards.reference.edit.loading')}</div>;
  if (row.loaded === 'failed')
    return <div className="empty">{t('cards.reference.edit.failed')}</div>;
  const { realm, draft, had } = row.loaded;
  return (
    <Shell
      realmChips={realm !== null && saysAnything(realm) ? <MonsterRuleChips row={realm} /> : null}
      refusal={row.refusal}
    >
      <MonsterRuleEditor
        draft={draft}
        named={false}
        namePrefix="reference-monster"
        onCancel={() => onDone(false)}
        onDraft={row.setDraft}
        onRemove={had ? () => row.remove(() => onDone(true)) : null}
        onSave={() => row.save(() => onDone(true))}
        removeLabel={t('cards.reference.edit.clear')}
      />
    </Shell>
  );
}

export function ItemRuleEdit({ name, store, onDone }: EditProps<ItemRule>): React.JSX.Element {
  const row = useRow(ITEM, store, name);
  if (row.loaded === null) return <div className="empty">{t('cards.reference.edit.loading')}</div>;
  if (row.loaded === 'failed')
    return <div className="empty">{t('cards.reference.edit.failed')}</div>;
  const { realm, draft, had } = row.loaded;
  return (
    <Shell
      realmChips={realm !== null && itemSaysAnything(realm) ? <ItemRuleChips row={realm} /> : null}
      refusal={row.refusal}
    >
      <ItemRuleEditor
        draft={draft}
        named={false}
        namePrefix="reference-item"
        onCancel={() => onDone(false)}
        onDraft={row.setDraft}
        onRemove={had ? () => row.remove(() => onDone(true)) : null}
        onSave={() => row.save(() => onDone(true))}
        removeLabel={t('cards.reference.edit.clear')}
      />
    </Shell>
  );
}
