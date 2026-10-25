import { useEffect, useRef, useState } from 'react';

import { Runs, type Follow } from './ExplorerDetailParts';
import { keepFocus } from '../lib/focus';
import { writeClipboard } from '../lib/clipboard';
import { readStored, writeStored } from '../lib/storage';
import { t } from '../lib/i18n';
import {
  TEXTBLOCK_MODES,
  type ExplorerSegment,
  type ExplorerTextblock,
  type TextblockMode,
  type TextblockNode,
  type TextblockRequest
} from '@shared/explorer';

/**
 * A textblock as MME's frmResults shows it (2026-10-24, mudtool
 * `tabs/rooms.js` `showTextblock`): the block it links on to and where it is
 * called from, its three readings, what it does and what runs it as trees,
 * and its raw text. Drawn by the Explorer's Rooms tab and by the cards'
 * textblock panel, so the two read the same.
 */
export interface TextblockViewProps {
  tb: ExplorerTextblock | null;
  mode: TextblockMode;
  onMode(mode: TextblockMode): void;
  hideTB: boolean;
  onHideTB(hide: boolean): void;
  /** Where a reference in it leads; none leaves them as text. */
  follow?: Follow;
}

/** Where Hide textblocks is kept between visits, as mudtool keeps `st.hideTB`. */
const HIDE_KEY = 'mudengine.explorer.hideTextblocks';

/**
 * A textblock asked for and the reader's choices about it: the reading, which
 * starts as the one the realm reads each block as (a monster's greeting, a
 * room's commands, otherwise plain) until the reader picks another, and Hide
 * textblocks, which is kept.
 */
export function useTextblock(
  ask: (request: TextblockRequest) => Promise<ExplorerTextblock>,
  n: number | null,
  defaultMap: number
): Pick<TextblockViewProps, 'tb' | 'mode' | 'onMode' | 'hideTB' | 'onHideTB'> {
  // Null until the reader picks one: the realm's own reading, which the answer names.
  const [mode, setMode] = useState<TextblockMode | null>(null);
  const [hideTB, setHideTB] = useState(() =>
    readStored(
      HIDE_KEY,
      (stored) => stored === 'true',
      () => false
    )
  );
  const [answer, setAnswer] = useState<{ key: string; tb: ExplorerTextblock } | null>(null);
  useEffect(() => setMode(null), [n]);
  const key = `${n}:${mode}:${hideTB}:${defaultMap}`;
  useEffect(() => {
    if (n === null) return;
    let live = true;
    void ask({ n, mode, hideTB, defaultMap }).then((tb) => live && setAnswer({ key, tb }));
    return () => {
      live = false;
    };
  }, [ask, n, mode, hideTB, defaultMap, key]);
  const tb = answer?.key === key ? answer.tb : null;
  return {
    tb,
    mode: mode ?? tb?.mode ?? 'plain',
    onMode: setMode,
    hideTB,
    onHideTB: (hide) => {
      setHideTB(hide);
      writeStored(HIDE_KEY, String(hide));
    }
  };
}

/** MME's tree icons, as mudtool draws them. */
const ICON: Record<string, string> = {
  STAR: '✶',
  ARROW: '➜',
  PAPER: '▤',
  MONSTER: '☻',
  ROOM: '⌂',
  BOLT: 'ϟ',
  MONEY: '¤',
  ITEM: '◆',
  REDARROW: '➜'
};

/** One literal `t()` per reading, for `i18n-coverage.test.ts`. */
const MODE_WORD: Record<TextblockMode, () => string> = {
  plain: () => t('explorer.textblock.modes.plain'),
  room: () => t('explorer.textblock.modes.room'),
  greet: () => t('explorer.textblock.modes.greet')
};

const plainText = (runs: readonly ExplorerSegment[]): string => runs.map((r) => r.text).join('');

function Label({ node, follow }: { node: TextblockNode; follow: Follow | undefined }) {
  const place = node.place;
  return (
    <span className="tb-label" data-bold={node.bold ? 'true' : undefined}>
      <span className={`tb-icon tb-${node.icon.toLowerCase()}`}>{ICON[node.icon] ?? '•'}</span>{' '}
      {place !== null && follow !== undefined ? (
        <button
          className="ex-link ex-ref"
          onClick={(event) => follow(place, plainText(node.text), event.currentTarget)}
          onMouseDown={keepFocus}
          type="button"
        >
          {plainText(node.text)}
        </button>
      ) : (
        <Runs follow={follow} runs={node.text} />
      )}
    </span>
  );
}

function Branch({ node, follow }: { node: TextblockNode; follow: Follow | undefined }) {
  if (node.kids.length === 0) {
    return (
      <li>
        <Label follow={follow} node={node} />
      </li>
    );
  }
  return (
    <li>
      <details open>
        <summary>
          <Label follow={follow} node={node} />
        </summary>
        <ul className="tb-tree">
          {node.kids.map((kid, i) => (
            <Branch follow={follow} key={i} node={kid} />
          ))}
        </ul>
      </details>
    </li>
  );
}

export default function TextblockView({
  tb,
  mode,
  onMode,
  hideTB,
  onHideTB,
  follow
}: TextblockViewProps) {
  const trees = useRef<HTMLDivElement>(null);
  const expand = (open: boolean): void => {
    for (const d of trees.current?.querySelectorAll('details') ?? []) d.open = open;
  };
  if (tb === null) return <div className="ex-empty">{t('explorer.loading')}</div>;
  if (!tb.supported) return <div className="ex-empty">{tb.reason ?? ''}</div>;
  if (!tb.found) {
    return <div className="ex-empty">{t('explorer.textblock.notFound', { n: tb.number })}</div>;
  }
  const linkTo = tb.linkTo;
  return (
    <div className="tb-view">
      {linkTo !== null && (
        <p className="ex-sub">
          {t('explorer.textblock.linksTo')}{' '}
          <Runs
            follow={follow}
            runs={[
              {
                kind: 'textblock',
                n: linkTo,
                text: t('explorer.textblock.title', { n: linkTo }),
                tab: 'textblock'
              }
            ]}
          />
        </p>
      )}
      {tb.calledFrom !== null && (
        <p className="tb-refs">
          <span className="tb-field">{t('explorer.textblock.calledFrom')}</span>{' '}
          <Runs follow={follow} runs={tb.calledFrom} />
        </p>
      )}
      {tb.commands !== null && (
        <p className="tb-refs">
          <span className="tb-field">{t('explorer.textblock.commands')}</span> {tb.commands}
        </p>
      )}
      <div className="ex-seg tb-modes" role="group">
        {TEXTBLOCK_MODES.map((m) => (
          <button
            aria-pressed={m === mode}
            className="ex-btn"
            key={m}
            onClick={() => onMode(m)}
            onMouseDown={keepFocus}
            type="button"
          >
            {MODE_WORD[m]()}
          </button>
        ))}
      </div>
      <div className="tb-actions">
        <label>
          <input
            checked={hideTB}
            onChange={(event) => onHideTB(event.target.checked)}
            type="checkbox"
          />
          {t('explorer.textblock.hide')}
        </label>
        <button
          className="ex-btn"
          onClick={() => expand(true)}
          onMouseDown={keepFocus}
          type="button"
        >
          {t('explorer.textblock.expand')}
        </button>
        <button
          className="ex-btn"
          onClick={() => expand(false)}
          onMouseDown={keepFocus}
          type="button"
        >
          {t('explorer.textblock.collapse')}
        </button>
        {tb.raw !== '' && (
          <button
            className="ex-btn"
            onClick={() =>
              void writeClipboard(
                t('explorer.textblock.copied', { n: tb.number, raw: tb.raw })
              ).catch(() => {})
            }
            onMouseDown={keepFocus}
            type="button"
          >
            {t('explorer.textblock.copyRaw')}
          </button>
        )}
      </div>
      <div className="tb-trees" ref={trees}>
        <section className="tb-col">
          <h3 className="ex-heading">{plainText(tb.command.text)}</h3>
          <ul className="tb-tree tb-root">
            {tb.command.kids.map((kid, i) => (
              <Branch follow={follow} key={i} node={kid} />
            ))}
          </ul>
        </section>
        <section className="tb-col">
          <h3 className="ex-heading">{plainText(tb.executed.text)}</h3>
          <ul className="tb-tree tb-root">
            {tb.executed.kids.length === 0 ? (
              <li className="ex-empty">{t('explorer.textblock.nothing')}</li>
            ) : (
              tb.executed.kids.map((kid, i) => <Branch follow={follow} key={i} node={kid} />)
            )}
          </ul>
        </section>
      </div>
      {tb.raw !== '' ? (
        <details className="tb-raw">
          <summary>{t('explorer.textblock.raw')}</summary>
          <pre>{tb.raw}</pre>
        </details>
      ) : (
        <p className="ex-empty">{t('explorer.textblock.dialog')}</p>
      )}
    </div>
  );
}
