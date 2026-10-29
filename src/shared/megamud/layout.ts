/**
 * Where this client draws a tab of MegaMUD's settings dialog differently from
 * `settingsTabs.ts`, which is generated from `MegaRes.dll`'s templates and not
 * edited (2026-10-22): rows added for settings of this client's own, and
 * columns lifted into the space that controls not drawn here left
 * (`MegaMudEditors`'s `NOT_HERE`).
 *
 * A row is added at a height of the tab's own layout, in dialog units, and
 * everything at or below that height moves down by the row's height. A frame
 * or a list that the row falls inside grows by it, so the row is drawn within
 * the frame it belongs to. A MegaMUD player finds every box in the order it
 * always was, with the new rows among them.
 */
import type { ChecklistRow, SettingsTab, TabControl } from './settingsTabs';

/** One row added to a tab. */
export interface AddedRow {
  /** The height in the tab's own layout the row goes in at. */
  at: number;
  /** How far it moves what is below it. */
  height: number;
  /**
   * Its controls, `y` measured from the row's top. Their ids are this
   * client's own, above any the templates use (`OWN_IDS_FROM`); a label is
   * drawn with this client's words (`MegaMudEditors`).
   */
  controls: readonly TabControl[];
}

/** The lowest id a control of this client's own takes; MegaRes.dll's go up to 5230. */
export const OWN_IDS_FROM = 9000;

/** The rows added to each tab, by its title. */
export const ADDED_ROWS: Readonly<Record<string, readonly AddedRow[]>> = {
  /*
   * The opening attack and its weapon (`Combat.OpenCmd`, `Combat.OpenWeapon`,
   * asked for 2026-10-22), each under the box of MegaMUD's it stands in for
   * at the opening: the attack under the normal attack, the weapon under the
   * backstab weapon, with the same picker of carried weapons beside it.
   */
  Combat: [
    {
      at: 28,
      height: 14,
      controls: [
        { id: 9001, kind: 'label', text: '', x: 10, y: 2, w: 52, h: 8 },
        {
          id: 9002,
          kind: 'edit',
          text: '',
          x: 63,
          y: 0,
          w: 46,
          h: 12,
          bind: { section: 'Combat', key: 'OpenCmd', as: 'text' }
        }
      ]
    },
    {
      at: 42,
      height: 14,
      controls: [
        { id: 9003, kind: 'label', text: '', x: 10, y: 2, w: 52, h: 8 },
        {
          id: 9004,
          kind: 'combo',
          text: '',
          x: 63,
          y: 0,
          w: 70,
          h: 100,
          bind: { section: 'Combat', key: 'OpenWeapon', as: 'text' }
        },
        { id: 9005, kind: 'button', text: '', x: 135, y: 2, w: 8, h: 8 }
      ]
    }
  ]
};

/** A row added to a tab's checklist, below the row of the setting `after` names. */
export interface AddedListRow {
  after: string;
  row: ChecklistRow;
}

/** The checklist rows added to each tab, by its title. */
export const ADDED_LIST_ROWS: Readonly<Record<string, readonly AddedListRow[]>> = {
  /*
   * Ignore disease (`Other.IgnoreDisease`, asked for 2026-10-28) with
   * MegaMUD's Ignore poison, blindness and confusion.
   */
  Other: [
    {
      after: 'IgnoreConfusion',
      row: { label: 'Ignore disease', kind: 'check', section: 'Other', key: 'IgnoreDisease' }
    }
  ]
};

/**
 * Part of a column moved up: every control from `left` to before `right`
 * across, at or below `from` down, by `by` dialog units. A frame there that
 * reaches below `from` shrinks with it.
 */
export interface Lift {
  left: number;
  right: number;
  from: number;
  by: number;
}

/** The lifts on each tab, by its title. */
export const LIFTS: Readonly<Record<string, readonly Lift[]>> = {
  /*
   * Miscellaneous's last three rows up under Run distance, into the gap the
   * back-scroll buffer and the command splitter (the console's own) leave.
   */
  Other: [{ left: 148, right: 271, from: 130, by: 47 }]
};

/** A column of `tab` lifted, as `Lift` says. */
function lifted(controls: readonly TabControl[], lift: Lift): TabControl[] {
  return controls.map((c) => {
    if (c.x < lift.left || c.x >= lift.right) return c;
    if (c.y >= lift.from) return { ...c, y: c.y - lift.by };
    if (stretches(c) && c.y + c.h > lift.from) return { ...c, h: c.h - lift.by };
    return c;
  });
}

/** A frame or a list grows with a row added inside it; anything else only moves. */
function stretches(c: TabControl): boolean {
  return c.kind === 'group' || c.kind === 'list';
}

/** `tab` as this client draws it: MegaMUD's layout, lifted, with this client's rows added. */
export function tabAsDrawn(tab: SettingsTab): SettingsTab {
  const lifts = LIFTS[tab.title] ?? [];
  const base =
    lifts.length === 0
      ? tab
      : { ...tab, controls: lifts.reduce<TabControl[]>(lifted, [...tab.controls]) };
  return withRows(withListRows(base));
}

/** `tab` with this client's checklist rows added, each below its setting's. */
function withListRows(tab: SettingsTab): SettingsTab {
  const added = ADDED_LIST_ROWS[tab.title];
  if (added === undefined || added.length === 0) return tab;
  const controls = tab.controls.map((c) => {
    if (c.rows === undefined) return c;
    const rows = [...c.rows];
    for (const { after, row } of added) {
      const at = rows.findIndex((r) => r.key === after);
      if (at !== -1) rows.splice(at + 1, 0, row);
    }
    return rows.length === c.rows.length ? c : { ...c, rows };
  });
  return { ...tab, controls };
}

/** `tab` with this client's rows added. */
function withRows(tab: SettingsTab): SettingsTab {
  const added = ADDED_ROWS[tab.title];
  if (added === undefined || added.length === 0) return tab;
  /** How far a height of MegaMUD's layout moves: every row added at or above it. */
  const down = (y: number): number =>
    added.reduce((by, row) => (row.at <= y ? by + row.height : by), 0);
  /** Where a row added at `at` starts: below every row added above it. */
  const startOf = (at: number): number =>
    at + added.reduce((by, row) => (row.at < at ? by + row.height : by), 0);
  const moved = tab.controls.map((c): TabControl => {
    const y = c.y + down(c.y);
    if (!stretches(c)) return y === c.y ? c : { ...c, y };
    const bottom = c.y + c.h;
    return { ...c, y, h: bottom + down(bottom) - y };
  });
  // Each row's controls go in before the first of MegaMUD's that it moved,
  // so the order through the page is the order down it.
  const controls = [...moved];
  for (const row of [...added].sort((a, b) => b.at - a.at)) {
    const top = startOf(row.at);
    const own = row.controls.map((c) => ({ ...c, y: top + c.y }));
    const before = tab.controls.findIndex((c) => c.y >= row.at);
    controls.splice(before === -1 ? controls.length : before, 0, ...own);
  }
  const total = added.reduce((by, row) => by + row.height, 0);
  return { ...tab, h: tab.h + total, controls };
}
