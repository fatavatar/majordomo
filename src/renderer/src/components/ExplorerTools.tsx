import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { keepFocus } from '../lib/focus';
import { t } from '../lib/i18n';
import type { ExplorerPlace } from '@shared/explorer';
import {
  TOOL_COINS,
  TOOL_NAMES,
  type AttackSimInput,
  type AttackSimOutput,
  type BackstabOutput,
  type HitOutput,
  type SpellBookRow,
  type SwingInput,
  type SwingOutput,
  type ToolAnswer,
  type ToolMonster,
  type ToolName,
  type ToolRequest,
  type ToolsStart
} from '@shared/explorerTools';

/**
 * MMUD Explorer's Tools tab (2026-10-19), mudtool's `tabs/tools.js` and its
 * pages (`js/tools/*.js`): the Swing, Hit and Backstab calculators, the Exp
 * calculator, the coin converter, the spell book, the monster attack
 * simulator and the notepad, each opening on the character as the game
 * reports it, its sums main's (`ExplorerTools.ts`).
 *
 * Where mudtool asks for MegaMUD's statistics pasted in, the Swing
 * calculator's true average takes this character's own Combat Stats
 * (`fromStats`); the spell book marks what the character's book holds.
 */
export interface ExplorerToolsProps {
  session: string;
  /** Changes when the character does. */
  characterKey: string;
  tool<R extends ToolRequest>(request: R): Promise<ToolAnswer<R> | null>;
  /** The Combat Stats card's Hit, Crit and Weapon (MegaMUD's Extra) as % and average. */
  fromStats: SwingInput['tru'] | null;
  copy(text: string): void;
  follow(place: ExplorerPlace): void;
}

type Tool = ExplorerToolsProps['tool'];

const LABEL: Record<ToolName, () => string> = {
  swing: () => t('explorer.tools.swing'),
  hit: () => t('explorer.tools.hit'),
  backstab: () => t('explorer.tools.backstab'),
  exp: () => t('explorer.tools.exp'),
  coin: () => t('explorer.tools.coin'),
  spellbook: () => t('explorer.tools.spellbook'),
  attacksim: () => t('explorer.tools.attacksim'),
  notepad: () => t('explorer.tools.notepad')
};

/** A figure, recalculated as it is typed (MME recalculates on KeyUp). */
function Num({
  label,
  value,
  onChange,
  disabled,
  step
}: {
  label: string;
  value: number;
  onChange(value: number): void;
  disabled?: boolean;
  step?: number;
}) {
  return (
    <label className="tl-field" data-off={disabled === true ? 'true' : undefined}>
      <span className="tl-label">{label}</span>
      <input
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
        step={step}
        type="number"
        value={String(value)}
      />
    </label>
  );
}

function Tick({
  label,
  checked,
  onChange,
  disabled
}: {
  label: string;
  checked: boolean;
  onChange(on: boolean): void;
  disabled?: boolean;
}) {
  return (
    <label className="ex-check" data-off={disabled === true ? 'true' : undefined}>
      <input
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      {label}
    </label>
  );
}

function Radios<V extends number>({
  name,
  options,
  value,
  onChange
}: {
  name: string;
  options: ReadonlyArray<[V, string, boolean?]>;
  value: V;
  onChange(value: V): void;
}) {
  return (
    <div className="tl-radios">
      {options.map(([v, label, disabled]) => (
        <label className="ex-check" key={v}>
          <input
            checked={value === v}
            disabled={disabled === true}
            name={name}
            onChange={() => onChange(v)}
            type="radio"
          />
          {label}
        </label>
      ))}
    </div>
  );
}

/** mudtool's `picker`: a box offering `name (n)` as typed. */
function Pick({
  rows,
  value,
  onPick,
  disabled
}: {
  rows: ReadonlyArray<[number, string]>;
  value: number;
  onPick(n: number): void;
  disabled?: boolean;
}) {
  const label = (n: number): string => {
    const row = rows.find(([m]) => m === n);
    return row === undefined ? '' : `${row[1]} (${row[0]})`;
  };
  const [typed, setTyped] = useState(() => label(value));
  useEffect(() => setTyped(label(value)), [value, rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const id = useMemo(() => `tl-pick-${Math.random().toString(36).slice(2)}`, []);
  return (
    <span>
      <input
        className="tl-pick"
        disabled={disabled}
        list={id}
        onChange={(event) => {
          setTyped(event.target.value);
          const m = /\((\d+)\)\s*$/.exec(event.target.value);
          if (m !== null && rows.some(([n]) => n === Number(m[1]))) onPick(Number(m[1]));
        }}
        placeholder={t('explorer.tools.typeToSearch')}
        value={typed}
      />
      <datalist id={id}>
        {rows.map(([n, name]) => (
          <option key={n} value={`${name} (${n})`} />
        ))}
      </datalist>
    </span>
  );
}

function Card({ title, children, wide }: { title?: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className="tl-card" data-wide={wide === true ? 'true' : undefined}>
      {title !== undefined && <h3>{title}</h3>}
      {children}
    </section>
  );
}

/** Asks main, again whenever what it is asked changes. */
function useAnswer<R extends ToolRequest>(
  tool: Tool,
  request: R | null,
  key: string
): ToolAnswer<R> | null {
  const [answer, setAnswer] = useState<ToolAnswer<R> | null>(null);
  const asked = JSON.stringify(request);
  useEffect(() => {
    if (request === null) return;
    let live = true;
    void tool(request).then((found) => {
      if (live) setAnswer(found);
    });
    return () => {
      live = false;
    };
  }, [tool, asked, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return answer;
}

/** The class's combat rating, 1 to 5 (`frmSwingCalc`'s). */
const COMBAT = (): string[] => [
  t('explorer.tools.combat1'),
  t('explorer.tools.combat2'),
  t('explorer.tools.combat3'),
  t('explorer.tools.combat4'),
  t('explorer.tools.combat5')
];
/** MME's coins, by name. */
const COIN_LABEL: Record<string, () => string> = {
  copper: () => t('explorer.tools.copper'),
  silver: () => t('explorer.tools.silver'),
  gold: () => t('explorer.tools.gold'),
  platinum: () => t('explorer.tools.platinum'),
  runic: () => t('explorer.tools.runic')
};

/** frmSwingCalc. */
function Swing({
  start,
  tool,
  fromStats,
  copy,
  follow
}: { start: ToolsStart } & Pick<ExplorerToolsProps, 'tool' | 'fromStats' | 'copy' | 'follow'>) {
  const p = start.profile;
  const or = (v: number, d: number): number => (v > 0 ? v : d);
  const [s, setS] = useState<SwingInput>(() => ({
    weapon: p.weapon || start.weapons[0]?.[0] || 0,
    combat: p.cls ? p.combat : 3,
    level: or(p.level, 60),
    agi: or(p.agi, 100),
    str: or(p.str, 100),
    encum: or(p.encum, 1000),
    maxEncum: p.str > 0 ? p.maxEncum : 4800,
    speed: 1,
    customSpeed: 100,
    slow: false,
    bash: false,
    tru: { hitP: 0, hitA: 0, extraP: 0, extraA: 0, critP: 0, critA: 0 },
    swings: null
  }));
  const set = (change: Partial<SwingInput>): void => setS((was) => ({ ...was, ...change }));
  const out = useAnswer(tool, { tool: 'swing', input: s }, '') as SwingOutput | null;
  const TRU: Array<[keyof SwingInput['tru'], string]> = [
    ['hitP', t('explorer.tools.hitPct')],
    ['hitA', t('explorer.tools.hitAvg')],
    ['extraP', t('explorer.tools.extraPct')],
    ['extraA', t('explorer.tools.extraAvg')],
    ['critP', t('explorer.tools.critPct')],
    ['critA', t('explorer.tools.critAvg')]
  ];
  const weaponName = start.weapons.find(([n]) => n === s.weapon)?.[1] ?? '';
  const copyOut = (kind: 0 | 1 | 2): void => {
    if (out === null || !out.found) return;
    let text = `Swings: ${out.rounds.map((r) => r.swings).join('/')}`;
    if (kind === 1) return copy(`${text} (Raw: ${out.rawSwings})`);
    const tru =
      out.trueAverage > 0
        ? `True Average: ${out.trueAverage} (${TRU.map(([k, l]) => `${l}-${s.tru[k]}`).join(', ')}, Swings-${s.swings ?? out.rawSwings})`
        : '';
    if (kind === 2) return tru === '' ? undefined : copy(tru);
    const speed = [
      'Speed: Fast (85)',
      'Speed: Normal (100)',
      'Speed: Slow (125)',
      `Speed: Custom (${s.customSpeed})`
    ][s.speed];
    text =
      `Weapon: ${weaponName} (${s.weapon})\n${text}\nEnergy Remaining: ${out.rounds.map((r) => r.energyLeft).join('/')}` +
      `\nEnergy per swing: ${out.energy}, Raw swing: ${out.rawSwings}, QND Crits: ${out.qnd > 0 ? out.qnd : 'None'}` +
      `\nCombat: ${COMBAT()[s.combat - 1]}, Level: ${s.level}, Agility: ${s.agi}, Strength: ${s.str}, ` +
      `Encumbrance: ${s.encum}/${s.maxEncum} (${out.encPct}%), ${speed}` +
      (s.slow ? ' +Slowness Ability' : '') +
      (s.bash ? ' (Bashing)' : '') +
      (tru === '' ? '' : `\n${tru}`);
    copy(text);
  };
  return (
    <>
      <div className="tl-row">
        <span className="tl-label">{t('explorer.tools.weapon')}</span>
        <Pick
          onPick={(weapon) => set({ weapon, swings: null })}
          rows={start.weapons}
          value={s.weapon}
        />
        {s.weapon > 0 && (
          <button
            className="ex-link"
            onClick={() => follow({ tab: 'weapons', n: s.weapon })}
            onMouseDown={keepFocus}
            type="button"
          >
            {t('explorer.tools.goWeapon')}
          </button>
        )}
      </div>
      <div className="tl-cols">
        <Card title={t('explorer.tools.stats')}>
          <div className="tl-grid">
            <label className="tl-field">
              <span className="tl-label">{t('explorer.tools.combat')}</span>
              <select
                onChange={(event) => set({ combat: Number(event.target.value) })}
                value={s.combat}
              >
                {COMBAT().map((label, i) => (
                  <option key={label} value={i + 1}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <Num
              label={t('explorer.tools.level')}
              onChange={(level) => set({ level })}
              value={s.level}
            />
            <Num
              label={t('explorer.tools.agility')}
              onChange={(agi) => set({ agi })}
              value={s.agi}
            />
            <Num
              label={t('explorer.tools.strength')}
              onChange={(str) => set({ str })}
              value={s.str}
            />
            <Num
              label={t('explorer.tools.encum')}
              onChange={(encum) => set({ encum })}
              step={25}
              value={s.encum}
            />
            <Num
              label={t('explorer.tools.maxEncum')}
              onChange={(maxEncum) => set({ maxEncum })}
              value={s.maxEncum}
            />
          </div>
          <h3>{t('explorer.tools.speed')}</h3>
          <Radios
            name="tl-speed"
            onChange={(speed) => set({ speed, slow: speed === 2 })}
            options={[
              [0, t('explorer.tools.fast')],
              [1, t('explorer.tools.normal')],
              [2, t('explorer.tools.slow')],
              [3, t('explorer.tools.custom')]
            ]}
            value={s.speed}
          />
          <div className="tl-grid">
            <Num
              disabled={s.speed !== 3}
              label={t('explorer.tools.custom')}
              onChange={(customSpeed) => set({ customSpeed })}
              value={s.customSpeed}
            />
          </div>
          <Tick
            checked={s.slow}
            label={t('explorer.tools.slowness')}
            onChange={(slow) => set({ slow })}
          />
          <Tick
            checked={s.bash}
            label={t('explorer.tools.bashing')}
            onChange={(bash) => set({ bash })}
          />
        </Card>
        <Card title={t('explorer.tools.swingsLeft')}>
          {out !== null && out.found && (
            <>
              <table className="tl-swings">
                <tbody>
                  <tr>
                    <th>{t('explorer.tools.round')}</th>
                    {out.rounds.map((_, i) => (
                      <th key={i}>{i + 1}</th>
                    ))}
                  </tr>
                  <tr>
                    <th>{t('explorer.tools.swings')}</th>
                    {out.rounds.map((r, i) => (
                      <td key={i}>{r.swings}</td>
                    ))}
                  </tr>
                  <tr>
                    <th>{t('explorer.tools.euLeft')}</th>
                    {out.rounds.map((r, i) => (
                      <td key={i}>{r.energyLeft}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
              <div className="tl-lines">
                <div>{t('explorer.tools.energyPerSwing', { energy: out.energy })}</div>
                <div>
                  {t('explorer.tools.encumbrance', { percent: out.encPct })}
                  <span className="eq-hint"> {t('explorer.tools.qndEncum')}</span>
                </div>
                <div>{t('explorer.tools.rawSwing', { swings: out.rawSwings })}</div>
                <div>
                  {t('explorer.tools.qnd', {
                    crits: out.qnd > 0 ? out.qnd : t('explorer.tools.none')
                  })}
                </div>
                {out.strengthShort !== null && (
                  <div className="tl-warn">
                    {t('explorer.tools.strengthShort', { strength: out.strengthShort })}
                  </div>
                )}
              </div>
              <h3>{t('explorer.tools.averageRound')}</h3>
              <div className="tl-big">{out.roundTotal}</div>
              <div className="eq-hint">{t('explorer.tools.averageNote')}</div>
            </>
          )}
          <div className="tl-btns">
            <button className="ex-btn" onClick={() => copyOut(0)} type="button">
              {t('explorer.tools.copy')}
            </button>
            <button className="ex-btn" onClick={() => copyOut(1)} type="button">
              {t('explorer.tools.copySwings')}
            </button>
            <button className="ex-btn" onClick={() => copyOut(2)} type="button">
              {t('explorer.tools.copyTrue')}
            </button>
          </div>
        </Card>
        <Card title={t('explorer.tools.trueAverage')}>
          <div className="tl-grid">
            {TRU.map(([k, label]) => (
              <Num
                key={k}
                label={label}
                onChange={(v) => set({ tru: { ...s.tru, [k]: v } })}
                value={s.tru[k]}
              />
            ))}
            <Num
              label={t('explorer.tools.swings')}
              onChange={(swings) => set({ swings })}
              step={0.0001}
              value={s.swings ?? out?.rawSwings ?? 0}
            />
          </div>
          <div className="tl-big">
            {t('explorer.tools.trueAverageIs', {
              average: out !== null && out.trueAverage > 0 ? out.trueAverage : '—'
            })}
          </div>
          <button
            className="ex-btn"
            disabled={fromStats === null}
            onClick={() => fromStats !== null && set({ tru: fromStats })}
            title={t('explorer.tools.fromStatsTitle')}
            type="button"
          >
            {t('explorer.tools.fromStats')}
          </button>
        </Card>
      </div>
    </>
  );
}

/** frmHitCalc: the attack, who makes it and who takes it, and the hit rate. */
function Hit({
  start,
  tool,
  follow
}: { start: ToolsStart } & Pick<ExplorerToolsProps, 'tool' | 'follow'>) {
  const p = start.profile;
  const [type, setType] = useState<0 | 1>(0);
  const [attacker, setAttacker] = useState<0 | 1 | 2>(0);
  const [defender, setDefender] = useState<0 | 1 | 2 | 3>(1);
  const [monster, setMonster] = useState(start.monsters[0]?.[0] ?? 0);
  const [f, setF] = useState({
    accy: 0,
    ac: 0,
    dodge: 0,
    protEv: 0,
    perception: 0,
    shadow: false,
    seeHidden: false
  });
  const mob = useAnswer(tool, { tool: 'monster', monster }, '') as ToolMonster | null;
  const set = (change: Partial<typeof f>): void => setF((was) => ({ ...was, ...change }));
  // SetHitCalcVals: what each side's choice fills in.
  useEffect(() => {
    const next: Partial<typeof f> = {};
    if (type === 1 && attacker === 0) next.accy = p.bsAccuracy;
    else if (type === 0 && attacker === 0) next.accy = p.accuracy;
    else if (type === 0 && attacker === 1 && mob !== null) next.accy = mob.accy;
    if (defender === 1 && mob !== null)
      Object.assign(next, {
        ac: mob.ac,
        dodge: mob.dodge,
        protEv: 0,
        perception: mob.bsDefense,
        shadow: false,
        seeHidden: mob.seeHidden
      });
    else if (defender === 0)
      Object.assign(next, {
        ac: Math.trunc(p.ac),
        dodge: p.dodge,
        protEv: p.protEvil,
        seeHidden: false
      });
    else if (defender === 2) Object.assign(next, { seeHidden: false });
    set(next);
  }, [type, attacker, defender, mob]); // eslint-disable-line react-hooks/exhaustive-deps
  const bs = type === 1;
  const vsMob = defender === 1;
  const vsManual = defender === 3;
  const mobAtk = attacker === 1;
  const on =
    vsMob || bs
      ? { protEv: false, perception: bs, seeHidden: bs, shadow: false }
      : {
          protEv: !(mobAtk && mob !== null && !mob.evil),
          perception: bs && vsManual,
          seeHidden: bs && vsManual,
          shadow: true
        };
  const perceptionLabel = vsMob
    ? t('explorer.tools.vsBsDefense')
    : defender === 0 || defender === 2
      ? bs
        ? t('explorer.tools.vsPerception')
        : t('explorer.tools.notApplicable')
      : bs
        ? t('explorer.tools.vsBsDefense')
        : t('explorer.tools.notApplicable');
  const out = useAnswer(
    tool,
    {
      tool: 'hit',
      input: {
        backstab: bs,
        accy: f.accy,
        ac: f.ac,
        dodge: f.dodge,
        protEv: on.protEv ? f.protEv : 0,
        vileWard: 0,
        perception: on.perception ? f.perception : 0,
        evil: 0,
        shadow: on.shadow && f.shadow,
        seeHidden: on.seeHidden && f.seeHidden,
        vsPlayer: defender === 0 || defender === 2,
        cls: defender === 0 ? p.cls : 0
      }
    },
    ''
  ) as HitOutput | null;
  return (
    <div className="tl-cols">
      <Card title={t('explorer.tools.attack')}>
        <Radios
          name="tl-hit-type"
          onChange={(v) => {
            setType(v);
            if (v === 1 && attacker === 1) setAttacker(2);
          }}
          options={[
            [0, t('explorer.tools.normalAttack')],
            [1, t('explorer.tools.backstabAttack')]
          ]}
          value={type}
        />
        <h3>{t('explorer.tools.attacker')}</h3>
        <Radios
          name="tl-hit-att"
          onChange={(v) => setAttacker(v as 0 | 1 | 2)}
          options={[
            [0, t('explorer.tools.currentChar')],
            [1, t('explorer.tools.monster'), bs],
            [2, t('explorer.tools.manual')]
          ]}
          value={attacker}
        />
        <h3>{t('explorer.tools.defender')}</h3>
        <Radios
          name="tl-hit-def"
          onChange={(v) => setDefender(v as 0 | 1 | 2 | 3)}
          options={[
            [0, t('explorer.tools.vsChar')],
            [1, t('explorer.tools.vsMob')],
            [2, t('explorer.tools.vsPlayer')],
            [3, t('explorer.tools.manual')]
          ]}
          value={defender}
        />
        <h3>{t('explorer.tools.monster')}</h3>
        <Pick
          disabled={!(mobAtk || vsMob)}
          onPick={setMonster}
          rows={start.monsters}
          value={monster}
        />
        {monster > 0 && (
          <button
            className="ex-link"
            onClick={() => follow({ tab: 'monsters', n: monster })}
            onMouseDown={keepFocus}
            type="button"
          >
            {t('explorer.tools.goMonster')}
          </button>
        )}
        <p className="eq-hint">{t('explorer.tools.hitHint')}</p>
      </Card>
      <Card>
        <div className="tl-grid">
          <Num
            label={t('explorer.tools.attackerAccuracy')}
            onChange={(accy) => set({ accy })}
            value={f.accy}
          />
          <Num label={t('explorer.tools.vsAC')} onChange={(ac) => set({ ac })} value={f.ac} />
          <Num
            label={t('explorer.tools.vsDodge')}
            onChange={(dodge) => set({ dodge })}
            value={f.dodge}
          />
          <Num
            disabled={!on.protEv}
            label={t('explorer.tools.vsProtEvil')}
            onChange={(protEv) => set({ protEv })}
            value={f.protEv}
          />
          <Num
            disabled={!on.perception}
            label={perceptionLabel}
            onChange={(perception) => set({ perception })}
            value={f.perception}
          />
        </div>
        <div className="tl-btns">
          <Tick
            checked={f.shadow}
            disabled={!on.shadow}
            label={t('explorer.tools.shadow')}
            onChange={(shadow) => set({ shadow })}
          />
          <Tick
            checked={f.seeHidden}
            disabled={!on.seeHidden}
            label={t('explorer.tools.seeHidden')}
            onChange={(seeHidden) => set({ seeHidden })}
          />
        </div>
      </Card>
      <Card title={t('explorer.tools.hitRate')}>
        {out !== null && (
          <>
            <div className="tl-big">
              <div>{t('explorer.tools.hitIs', { hit: out.hit })}</div>
              <div>{t('explorer.tools.dodgeIs', { dodge: out.dodge })}</div>
              <div>{t('explorer.tools.overallIs', { overall: out.overall })}</div>
            </div>
            <div className="eq-hint">
              {t('explorer.tools.hitMinCap')}{' '}
              {out.minHit !== out.baseMinHit ? <b>*{out.minHit}%*</b> : `${out.minHit}%`} -{' '}
              {out.maxHit}%
            </div>
            <div className="eq-hint">
              {out.dodgeSoftCap === null
                ? t('explorer.tools.dodgeCap', { cap: out.dodgeCap })
                : t('explorer.tools.dodgeSoftCap', { soft: out.dodgeSoftCap, cap: out.dodgeCap })}
            </div>
            {mobAtk && mob !== null && !mob.evil && (
              <div className="eq-hint">{t('explorer.tools.mobNotEvil')}</div>
            )}
            {bs && attacker === 0 && <div className="eq-hint">{t('explorer.tools.bsForChar')}</div>}
          </>
        )}
      </Card>
    </div>
  );
}

/** frmBSCalc. */
function Backstab({
  start,
  tool,
  copy,
  follow
}: { start: ToolsStart } & Pick<ExplorerToolsProps, 'tool' | 'copy' | 'follow'>) {
  const p = start.profile;
  const reset = () => ({
    weapon: start.bsWeapons.some(([n]) => n === p.weapon)
      ? p.weapon
      : (start.bsWeapons[0]?.[0] ?? 0),
    level: p.level > 0 ? p.level : 50,
    stealth: p.stealth || 100,
    maxDmg: p.plusMaxDamage,
    bsMin: p.bsMin,
    bsMax: p.bsMax,
    str: p.str > 0 ? p.str : 100,
    classStealth: p.classStealth
  });
  const [s, setS] = useState(reset);
  const set = (change: Partial<typeof s>): void => setS((was) => ({ ...was, ...change }));
  const out = useAnswer(tool, { tool: 'backstab', input: s }, '') as BackstabOutput | null;
  const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? String(n) : '');
  const name = start.bsWeapons.find(([n]) => n === s.weapon)?.[1] ?? '';
  const copyOut = (): void => {
    if (out === null || out.noBS) return;
    let text = `BS Damage: ${out.min} - ${out.max} (AVG: ${out.avg})\n${name}: ${out.weaponMin} - ${out.weaponMax}\nStrength: ${s.str}`;
    if (s.maxDmg) text += `\nMax Damage: ${signed(s.maxDmg)}`;
    if (s.bsMin) text += `\nMinBS: ${signed(s.bsMin)}`;
    if (s.bsMax) text += (s.bsMin ? ', ' : '\n') + `MaxBS: ${signed(s.bsMax)}`;
    text += `\nLevel: ${s.level}, Stealth: ${s.stealth}\nClass Stealth: ${s.classStealth ? 'Yes' : 'No'}`;
    copy(text);
  };
  const adj = out?.adj;
  const bits =
    adj === undefined
      ? []
      : [
          adj.maxDmg ? `max ${signed(adj.maxDmg)}` : '',
          adj.bsMin ? `BS min ${signed(adj.bsMin)}` : '',
          adj.bsMax ? `BS max ${signed(adj.bsMax)}` : '',
          adj.stealth ? `stealth ${signed(adj.stealth)}` : ''
        ].filter((bit) => bit !== '');
  return (
    <div className="tl-cols">
      <Card title={t('explorer.tools.weapon')}>
        <Pick onPick={(weapon) => set({ weapon })} rows={start.bsWeapons} value={s.weapon} />
        {s.weapon > 0 && (
          <button
            className="ex-link"
            onClick={() => follow({ tab: 'weapons', n: s.weapon })}
            onMouseDown={keepFocus}
            type="button"
          >
            {t('explorer.tools.goWeapon')}
          </button>
        )}
        <h3>{t('explorer.tools.stats')}</h3>
        <div className="tl-grid">
          <Num
            label={t('explorer.tools.level')}
            onChange={(level) => set({ level })}
            value={s.level}
          />
          <Num
            label={t('explorer.tools.stealth')}
            onChange={(stealth) => set({ stealth })}
            value={s.stealth}
          />
          <Num
            label={t('explorer.tools.maxDamage')}
            onChange={(maxDmg) => set({ maxDmg })}
            value={s.maxDmg}
          />
          <Num
            label={t('explorer.tools.bsMin')}
            onChange={(bsMin) => set({ bsMin })}
            value={s.bsMin}
          />
          <Num
            label={t('explorer.tools.bsMax')}
            onChange={(bsMax) => set({ bsMax })}
            value={s.bsMax}
          />
          <Num
            label={t('explorer.tools.strength')}
            onChange={(str) => set({ str })}
            value={s.str}
          />
        </div>
        <Tick
          checked={s.classStealth}
          label={t('explorer.tools.classStealth')}
          onChange={(classStealth) => set({ classStealth })}
        />
      </Card>
      <Card title={t('explorer.tools.bsDamage')}>
        <div className="tl-big">
          {out === null
            ? ''
            : out.noBS
              ? t('explorer.tools.noBS')
              : t('explorer.tools.bsRange', { min: out.min, max: out.max, avg: out.avg })}
        </div>
        {bits.length > 0 && (
          <div className="eq-hint">{t('explorer.tools.fromWeapon', { bits: bits.join(', ') })}</div>
        )}
        <div className="tl-btns">
          <button className="ex-btn" onClick={copyOut} type="button">
            {t('explorer.tools.copy')}
          </button>
          <button className="ex-btn" onClick={() => setS(reset())} type="button">
            {t('explorer.tools.reset')}
          </button>
        </div>
        <p className="eq-hint">{t('explorer.tools.bsHint')}</p>
      </Card>
    </div>
  );
}

/** frmExpCalc. */
function Exp({
  start,
  tool,
  copy
}: { start: ToolsStart } & Pick<ExplorerToolsProps, 'tool' | 'copy'>) {
  const p = start.profile;
  const [cls, setCls] = useState(p.cls);
  const [race, setRace] = useState(p.race);
  const [chart, setChart] = useState(p.chart);
  const [range, setRange] = useState({ start: 2, end: start.maxLevel || 75 });
  const [asked, setAsked] = useState({ start: 2, end: start.maxLevel || 75, chart: p.chart });
  const rows = useAnswer(tool, { tool: 'exp', ...asked }, '');
  const pickChart = async (c: number, r: number): Promise<void> => {
    const found = await tool({ tool: 'expChart', cls: c, race: r });
    if (found !== null) setChart(found);
  };
  const fmt = (n: number): string => n.toLocaleString('en-US');
  return (
    <div className="tl-exp">
      <div className="tl-row">
        <label className="tl-field">
          <span className="tl-label">{t('explorer.tools.class')}</span>
          <select
            onChange={(event) => {
              const c = Number(event.target.value);
              setCls(c);
              void pickChart(c, race);
            }}
            value={cls}
          >
            <option value={0}>{t('explorer.tools.customChart')}</option>
            {start.classes.map(([n, name]) => (
              <option key={n} value={n}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="tl-field">
          <span className="tl-label">{t('explorer.tools.race')}</span>
          <select
            onChange={(event) => {
              const r = Number(event.target.value);
              setRace(r);
              void pickChart(cls, r);
            }}
            value={race}
          >
            <option value={0}>{t('explorer.tools.customChart')}</option>
            {start.races.map(([n, name]) => (
              <option key={n} value={n}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <Num
          label={t('explorer.tools.expTable')}
          onChange={(v) => {
            setChart(v);
            setCls(0);
            setRace(0);
          }}
          value={chart}
        />
        <Num
          label={t('explorer.tools.fromLevel')}
          onChange={(v) => setRange({ ...range, start: v })}
          value={range.start}
        />
        <Num
          label={t('explorer.tools.toLevel')}
          onChange={(v) => setRange({ ...range, end: v })}
          value={range.end}
        />
        <button className="ex-btn" onClick={() => setAsked({ ...range, chart })} type="button">
          {t('explorer.tools.calc')}
        </button>
        <button
          className="ex-btn"
          onClick={() =>
            rows !== null &&
            copy(
              [
                'LVL\tExperience\tNeeded',
                ...rows.rows.map((r) => `${r.level}\t${fmt(r.exp)}\t${fmt(r.needed)}`)
              ].join('\n')
            )
          }
          type="button"
        >
          {t('explorer.tools.copy')}
        </button>
        <span className="eq-hint">{t('explorer.tools.chartIs', { chart: asked.chart })}</span>
      </div>
      {rows !== null && (
        <table className="lists-table tl-exp-table">
          <thead>
            <tr>
              <th data-numeric="true">{t('explorer.tools.lvl')}</th>
              <th data-numeric="true">{t('explorer.tools.experience')}</th>
              <th data-numeric="true">{t('explorer.tools.needed')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.rows.map((r) => (
              <tr data-selected={r.level === p.level + 1 ? 'true' : undefined} key={r.level}>
                <td data-numeric="true">{r.level}</td>
                <td data-numeric="true">{fmt(r.exp)}</td>
                <td data-numeric="true">{fmt(r.needed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** frmCoinConvert: two amounts, each in a coin, and the charm button. */
function Coin({ start, tool }: { start: ToolsStart } & Pick<ExplorerToolsProps, 'tool'>) {
  const [amount, setAmount] = useState<[string, string]>(['1', '100']);
  const [coin, setCoin] = useState<[number, number]>([100, 1]);
  const [weight, setWeight] = useState<[number | null, number | null]>([0, 33]);
  const [charm, setCharm] = useState(start.profile.charm);
  const modifier = useAnswer(tool, { tool: 'charm', charm }, '');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const convert = async (src: 0 | 1, value: string, coins: [number, number]): Promise<void> => {
    const dst = src === 0 ? 1 : 0;
    const found = await tool({
      tool: 'coin',
      amount: Number(value) || 0,
      from: coins[src],
      to: coins[dst]
    });
    if (found === null) return;
    const own = await tool({
      tool: 'coin',
      amount: Number(value) || 0,
      from: coins[src],
      to: coins[src]
    });
    setAmount((was) => {
      const next: [string, string] = [...was];
      next[dst] = String(Number(found.amount.toFixed(8)));
      return next;
    });
    setWeight((was) => {
      const next: [number | null, number | null] = [...was];
      next[dst] = found.weight;
      next[src] = own?.weight ?? null;
      return next;
    });
  };
  const typed = (i: 0 | 1, value: string): void => {
    const clean = value.replace(/[^0-9.]/g, '');
    setAmount((was) => (i === 0 ? [clean, was[1]] : [was[0], clean]));
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => void convert(i, clean, coin), 300);
  };
  const recoin = async (i: 0 | 1, to: number): Promise<void> => {
    const found = await tool({ tool: 'coin', amount: Number(amount[i]) || 0, from: coin[i], to });
    const next: [number, number] = i === 0 ? [to, coin[1]] : [coin[0], to];
    setCoin(next);
    if (found === null) return;
    setAmount((was) => {
      const n: [string, string] = [...was];
      n[i] = String(Number(found.amount.toFixed(8)));
      return n;
    });
  };
  const row = (i: 0 | 1) => (
    <div className="tl-coin-row">
      <input
        className="tl-coin-amt"
        inputMode="decimal"
        onChange={(event) => typed(i, event.target.value)}
        value={amount[i]}
      />
      <Radios
        name={`tl-coin-${i}`}
        onChange={(to) => void recoin(i, to)}
        options={TOOL_COINS.map(
          ([name, copper]) => [copper, COIN_LABEL[name]!()] as [number, string]
        )}
        value={coin[i]}
      />
      <span className="eq-hint">
        {weight[i] === null ? '' : t('explorer.tools.weight', { weight: weight[i] })}
      </span>
    </div>
  );
  return (
    <div className="tl-coin">
      {row(0)}
      <div className="tl-coin-mid">{t('explorer.tools.convert')}</div>
      {row(1)}
      <div className="tl-row">
        <button
          className="ex-btn"
          disabled={modifier === null || !modifier.pct}
          onClick={async () => {
            if (modifier === null) return;
            const v = await tool({
              tool: 'applyCharm',
              amount: Number(amount[1]) || 0,
              coin: coin[1],
              pct: modifier.pct
            });
            if (v !== null && v !== undefined) setAmount([amount[0], String(v)]);
          }}
          type="button"
        >
          {modifier === null ? '' : modifier.pct ? `Apply ${modifier.label}` : modifier.label}
        </button>
        <Num label={t('explorer.tools.charm')} onChange={setCharm} value={charm} />
      </div>
      <pre className="tl-rates">{t('explorer.tools.rates')}</pre>
    </div>
  );
}

/** frmSpellBook: what a class learns to a level, the character's book marked. */
function SpellBook({
  start,
  tool,
  follow,
  characterKey
}: { start: ToolsStart } & Pick<ExplorerToolsProps, 'tool' | 'follow' | 'characterKey'>) {
  const p = start.profile;
  const [s, setS] = useState({ cls: p.cls, level: p.level > 0 ? p.level : 999, align: 0 });
  const [asked, setAsked] = useState(s);
  const rows = useAnswer(tool, { tool: 'spellbook', ...asked }, characterKey) as
    SpellBookRow[] | null;
  const sorted = useMemo(
    () => [...(rows ?? [])].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)),
    [rows]
  );
  return (
    <div className="tl-exp">
      <div className="tl-row">
        <label className="tl-field">
          <span className="tl-label">{t('explorer.tools.class')}</span>
          <select
            onChange={(event) => setS({ ...s, cls: Number(event.target.value) })}
            value={s.cls}
          >
            <option value={0}>{t('explorer.tools.noClass')}</option>
            {start.classes.map(([n, name]) => (
              <option key={n} value={n}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="tl-field">
          <span className="tl-label">{t('explorer.tools.align')}</span>
          <select
            onChange={(event) => setS({ ...s, align: Number(event.target.value) })}
            value={s.align}
          >
            {start.alignments.map((name, i) => (
              <option key={name} value={i}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <Num
          label={t('explorer.tools.charLevel')}
          onChange={(level) => setS({ ...s, level })}
          value={s.level}
        />
        <button className="ex-btn" onClick={() => setAsked(s)} type="button">
          {t('explorer.tools.listSpells')}
        </button>
        <span className="eq-hint">{t('explorer.tools.spellCount', { count: sorted.length })}</span>
      </div>
      <table className="lists-table">
        <thead>
          <tr>
            {BOOK_COLUMNS.map(([h, numeric]) => (
              <th data-numeric={numeric ? 'true' : undefined} key={h}>
                {h === '#' ? '#' : BOOK_LABEL[h]!()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr data-learned={r.learned ? 'true' : undefined} key={r.number}>
              <td data-numeric="true">{r.number}</td>
              <td>
                <button
                  className="ex-link"
                  onClick={() => follow({ tab: 'spells', n: r.number })}
                  onMouseDown={keepFocus}
                  type="button"
                >
                  {r.name}
                </button>
              </td>
              <td>{r.short}</td>
              <td>{r.magery}</td>
              <td data-numeric="true">{r.level}</td>
              <td data-numeric="true">{r.mana}</td>
              <td data-numeric="true">{r.diff}</td>
              <td data-numeric="true">{r.dmg}</td>
              <td data-numeric="true">{r.dmgPerMana}</td>
              <td data-numeric="true">{r.heal}</td>
              <td data-numeric="true">{r.healPerMana}</td>
              <td className="tl-detail">{r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="eq-hint">{t('explorer.tools.learnedKey')}</p>
    </div>
  );
}

/** The Spell Book's columns (`frmSpellBook`'s), and whether each holds figures. */
const BOOK_COLUMNS: Array<[string, boolean]> = [
  ['#', true],
  ['name', false],
  ['short', false],
  ['magery', false],
  ['level', true],
  ['mana', true],
  ['diff', true],
  ['dmg', true],
  ['dmgPerMana', true],
  ['heal', true],
  ['healPerMana', true],
  ['detail', false]
];
const BOOK_LABEL: Record<string, () => string> = {
  name: () => t('explorer.columns.name'),
  short: () => t('explorer.columns.short'),
  magery: () => t('explorer.columns.magery'),
  level: () => t('explorer.tools.lvl'),
  mana: () => t('explorer.columns.mana'),
  diff: () => t('explorer.tools.diff'),
  dmg: () => t('explorer.columns.dmg'),
  dmgPerMana: () => t('explorer.tools.dmgPerMana'),
  heal: () => t('explorer.columns.heal'),
  healPerMana: () => t('explorer.tools.healPerMana'),
  detail: () => t('explorer.columns.detail')
};
/** The simulator's per-attack table. */
const SIM_COLUMNS: Array<() => string> = [
  () => t('explorer.tools.simAttack'),
  () => t('explorer.tools.simTrueChance'),
  () => t('explorer.tools.simAvgHit'),
  () => t('explorer.tools.simHitPct'),
  () => t('explorer.tools.simResisted'),
  () => t('explorer.tools.simDodged')
];

const DEF_KEYS: Array<[keyof AttackSimInput['def'], () => string]> = [
  ['ac', () => t('explorer.tools.ac')],
  ['dr', () => t('explorer.tools.dr')],
  ['mr', () => t('explorer.columns.mr')],
  ['dodge', () => t('explorer.columns.dodge')],
  ['protEvil', () => t('explorer.tools.protEvil')],
  ['rsto', () => t('explorer.tools.resStone')],
  ['rcol', () => t('explorer.tools.resCold')],
  ['rwat', () => t('explorer.tools.resWater')],
  ['rfir', () => t('explorer.tools.resFire')],
  ['rlit', () => t('explorer.tools.resLightning')]
];

/** frmMonsterAttackSim. */
function AttackSim({
  start,
  tool,
  follow
}: { start: ToolsStart } & Pick<ExplorerToolsProps, 'tool' | 'follow'>) {
  const p = start.profile;
  const charDefs = (): AttackSimInput['def'] => ({
    ac: Math.round(p.ac),
    dr: Math.round(p.dr),
    mr: p.mr > 0 ? Math.round(p.mr) : 50,
    dodge: Math.max(0, Math.round(p.dodge)),
    protEvil: p.protEvil,
    rsto: 0,
    rcol: 0,
    rwat: 0,
    rfir: 0,
    rlit: 0
  });
  const [s, setS] = useState<AttackSimInput>(() => ({
    monster: start.monsters[0]?.[0] ?? 0,
    rounds: 1000,
    dynamic: false,
    maxRoundOnly: true,
    hideEnergy: false,
    def: charDefs(),
    antiMagic: p.antiMagic,
    megaDodge: false
  }));
  const [out, setOut] = useState<AttackSimOutput | null>(null);
  const [running, setRunning] = useState(false);
  const set = (change: Partial<AttackSimInput>): void => setS((was) => ({ ...was, ...change }));
  const run = async (): Promise<void> => {
    if (!(s.monster > 0)) return;
    setRunning(true);
    setOut(await tool({ tool: 'attacksim', input: s }));
    setRunning(false);
  };
  return (
    <>
      <div className="tl-row">
        <span className="tl-label">{t('explorer.tools.chooseMonster')}</span>
        <Pick
          onPick={(monster) => {
            set({ monster });
            setOut(null);
          }}
          rows={start.monsters}
          value={s.monster}
        />
        {s.monster > 0 && (
          <button
            className="ex-link"
            onClick={() => follow({ tab: 'monsters', n: s.monster })}
            onMouseDown={keepFocus}
            type="button"
          >
            {t('explorer.tools.goMonster')}
          </button>
        )}
      </div>
      <div className="tl-cols">
        <Card title={t('explorer.tools.defenses')}>
          <div className="tl-grid">
            {DEF_KEYS.map(([k, label]) => (
              <Num
                key={k}
                label={k === 'dodge' && s.megaDodge ? t('explorer.tools.dodgePct') : label()}
                onChange={(v) => set({ def: { ...s.def, [k]: v } })}
                value={s.def[k]}
              />
            ))}
          </div>
          <div className="tl-btns">
            <Tick
              checked={s.antiMagic}
              label={t('explorer.tools.antiMagic')}
              onChange={(antiMagic) => set({ antiMagic })}
            />
            <Tick
              checked={s.megaDodge}
              label={t('explorer.tools.megaDodge')}
              onChange={(megaDodge) => set({ megaDodge })}
            />
          </div>
          <div className="tl-btns">
            <button
              className="ex-btn"
              onClick={() =>
                set({
                  megaDodge: false,
                  antiMagic: false,
                  def: { ...charDefs(), ac: 0, dr: 0, mr: 50, dodge: 0, protEvil: 0 }
                })
              }
              type="button"
            >
              {t('explorer.tools.reset')}
            </button>
            <button
              className="ex-btn"
              onClick={() => set({ megaDodge: false, def: charDefs(), antiMagic: p.antiMagic })}
              type="button"
            >
              {t('explorer.tools.reload')}
            </button>
          </div>
          <p className="eq-hint">{t('explorer.tools.simHint')}</p>
        </Card>
        <Card>
          <div className="tl-grid">
            <Num
              disabled={s.dynamic}
              label={t('explorer.tools.simRounds')}
              onChange={(rounds) => set({ rounds })}
              value={s.rounds}
            />
          </div>
          <Tick
            checked={s.dynamic}
            label={t('explorer.tools.dynamic')}
            onChange={(dynamic) => set({ dynamic })}
          />
          <Tick
            checked={s.maxRoundOnly}
            label={t('explorer.tools.maxRoundOnly')}
            onChange={(maxRoundOnly) => set({ maxRoundOnly })}
          />
          <Tick
            checked={s.hideEnergy}
            label={t('explorer.tools.hideEnergy')}
            onChange={(hideEnergy) => set({ hideEnergy })}
          />
          <div className="tl-btns">
            <button
              className="ex-btn"
              data-primary="true"
              disabled={running}
              onClick={() => void run()}
              type="button"
            >
              {running ? t('explorer.tools.running') : t('explorer.tools.runSim')}
            </button>
          </div>
          <h3>{t('explorer.tools.results')}</h3>
          {out !== null &&
            (out.ran ? (
              <>
                <div className="tl-big">
                  {t('explorer.tools.simAverage', { average: out.average })}
                </div>
                <div>{t('explorer.tools.simMax', { max: out.max, seen: out.maxSeen })}</div>
                <div className="eq-hint">
                  {t('explorer.tools.simSplit', { physical: out.physical, spell: out.spell })}
                </div>
                {s.dynamic && (
                  <div className="eq-hint">
                    {t('explorer.tools.simRoundsRun', { rounds: out.rounds.toLocaleString() })}
                  </div>
                )}
              </>
            ) : (
              <div className="eq-hint">{t('explorer.tools.nothingToSim')}</div>
            ))}
          <table className="lists-table">
            <thead>
              <tr>
                {SIM_COLUMNS.map((label, i) => (
                  <th key={i}>{label()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 5 }, (_, x) => {
                const a = out?.attacks[x] ?? null;
                return (
                  <tr key={x}>
                    <td>{a?.name ?? `${x + 1}.`}</td>
                    <td data-numeric="true">{a?.trueChance ?? ''}</td>
                    <td data-numeric="true">{a?.avgHit ?? ''}</td>
                    <td data-numeric="true">{a?.hitPct ?? ''}</td>
                    <td data-numeric="true">{a?.dmgResistPct ?? ''}</td>
                    <td data-numeric="true">{a?.resistDodgePct ?? ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>
      <Card title={t('explorer.tools.combatLog')} wide>
        <pre className="tl-log">{out?.log ?? ''}</pre>
      </Card>
    </>
  );
}

const notepadKey = (session: string): string => `mudengine.explorer.notepad.${session}`;

/** frmNotepad: a scratch text, kept per character, and Copy. */
function Notepad({ session, copy }: Pick<ExplorerToolsProps, 'session' | 'copy'>) {
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(notepadKey(session)) ?? '';
    } catch {
      return '';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(notepadKey(session), text);
    } catch {
      // Storage refused: the text lasts this visit.
    }
  }, [session, text]);
  const area = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="tl-notepad">
      <div className="tl-row">
        <button
          className="ex-btn"
          onClick={() => {
            const box = area.current;
            const [a, b] = box === null ? [0, 0] : [box.selectionStart, box.selectionEnd];
            copy(a === b ? text : text.slice(a, b));
          }}
          type="button"
        >
          {t('explorer.tools.copy')}
        </button>
      </div>
      <textarea
        onChange={(event) => setText(event.target.value)}
        ref={area}
        spellCheck={false}
        value={text}
      />
    </div>
  );
}

export default function ExplorerTools(props: ExplorerToolsProps) {
  const { tool, characterKey } = props;
  const [page, setPage] = useState<ToolName>('swing');
  const start = useAnswer(tool, { tool: 'start' }, characterKey) as ToolsStart | null;
  return (
    <div className="lists-page">
      <nav className="lists-nav">
        {TOOL_NAMES.map((name) => (
          <button
            aria-selected={page === name}
            className="ex-tab"
            key={name}
            onClick={() => setPage(name)}
            onMouseDown={keepFocus}
            type="button"
          >
            {LABEL[name]()}
          </button>
        ))}
      </nav>
      <div className="tl-body">
        <h2 className="ex-name">{LABEL[page]()}</h2>
        {page === 'notepad' ? (
          <Notepad copy={props.copy} session={props.session} />
        ) : start === null ? (
          <div className="ex-empty">{t('explorer.loading')}</div>
        ) : !start.supported ? (
          <div className="ex-empty">{start.reason ?? t('explorer.unsupported')}</div>
        ) : page === 'swing' ? (
          <Swing
            copy={props.copy}
            follow={props.follow}
            fromStats={props.fromStats}
            start={start}
            tool={tool}
          />
        ) : page === 'hit' ? (
          <Hit follow={props.follow} start={start} tool={tool} />
        ) : page === 'backstab' ? (
          <Backstab copy={props.copy} follow={props.follow} start={start} tool={tool} />
        ) : page === 'exp' ? (
          <Exp copy={props.copy} start={start} tool={tool} />
        ) : page === 'coin' ? (
          <Coin start={start} tool={tool} />
        ) : page === 'spellbook' ? (
          <SpellBook characterKey={characterKey} follow={props.follow} start={start} tool={tool} />
        ) : (
          <AttackSim follow={props.follow} start={start} tool={tool} />
        )}
      </div>
    </div>
  );
}
