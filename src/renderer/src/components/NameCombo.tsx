import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';

import { useListNavigation } from '../hooks/useListNavigation';

/**
 * A free-text field with a themed list of known names under it.
 *
 * `SpellCombo` in the general case, extracted for the item pickers (todo 00).
 * The potion rules' name field was a native `<datalist>`, which the browser
 * draws in its **own** chrome — white rows in a dark client, in the browser's
 * font, capped at a length the page does not choose and unscrollable past it.
 * A control the client cannot style is a control the client cannot make part
 * of itself, which is the whole of what was wrong with it.
 *
 * Free text first, always: a derivative realm holds items the shipped data
 * does not, and a list is a help rather than a gate. The interaction is
 * `useListNavigation`'s, like every filtered list here, and Escape closes the
 * list and goes no further while it is open — the settings dialog owns its own
 * Escape and one press must not do both.
 */
export interface NameComboProps {
  name: string;
  value: string;
  onChange(value: string): void;
  /** What to offer. Empty offers nothing, and typing still works. */
  options: readonly string[];
  /**
   * What an option is, shown beside it and matched as well: a spell's name
   * beside the short command a box takes, so `minor` finds `mend`.
   */
  notes?: ReadonlyMap<string, string>;
  /** The input's own class. */
  className?: string;
  /** The whole's class and place beside `spell-picker`'s: a MegaMUD page places each box. */
  boxClassName?: string;
  style?: CSSProperties;
  maxLength?: number;
  title?: string;
  /** Enter with no list showing: the field's own act (save the row, add the name). */
  onSubmit?(): void;
  ariaLabel?: string;
  describedBy?: string;
  disabled?: boolean;
  placeholder?: string;
  /**
   * A list in one field, such as `avoid`'s comma-separated names: suggest for
   * the name being typed after the last separator, leave out the ones already
   * written before it, and put a choice in that name's place.
   */
  separator?: string;
}

/**
 * How many suggestions are worth showing under a field.
 *
 * Deliberately larger than the spell picker's fourteen: a realm names far more
 * items than a character knows spells, and the list scrolls (`.spell-options`
 * is capped at 240px and scrolls past it), so the ceiling is about how much
 * scrolling is useful rather than about how much fits.
 */
const MOST = 60;

/**
 * The names worth offering for what has been typed, best first.
 *
 * A prefix outranks a match anywhere — typing `heal` means `healing potion`
 * before `greater healing draught` — which is the rule the spell picker and
 * the Reference card's search both follow. A match in an option's note comes
 * after both.
 */
function matches(
  options: readonly string[],
  value: string,
  notes?: ReadonlyMap<string, string>
): string[] {
  const needle = value.trim().toLowerCase();
  if (needle.length === 0) return options.slice(0, MOST);
  const ranked: Array<{ name: string; rank: number }> = [];
  for (const name of options) {
    const lower = name.toLowerCase();
    const rank = lower.startsWith(needle)
      ? 0
      : lower.includes(needle)
        ? 1
        : notes?.get(name)?.toLowerCase().includes(needle) === true
          ? 2
          : -1;
    if (rank < 0) continue;
    ranked.push({ name, rank });
  }
  return ranked
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
    .slice(0, MOST)
    .map((hit) => hit.name);
}

/**
 * What to suggest for a field's value, and what choosing one makes it.
 *
 * With a separator the field is a list: the name being typed is the text after
 * the last separator, the names written before it are not offered again, and
 * a choice replaces only the name being typed. Pure, so the list behaviour is
 * testable without a document.
 */
export function comboFor(
  options: readonly string[],
  value: string,
  separator?: string,
  notes?: ReadonlyMap<string, string>
): { suggestions: string[]; choose(chosen: string): string } {
  const cut = separator === undefined ? -1 : value.lastIndexOf(separator);
  const head = cut === -1 ? '' : value.slice(0, cut + 1);
  const typing = cut === -1 ? value : value.slice(cut + 1);
  let offered = options;
  if (separator !== undefined && head.length > 0) {
    const written = new Set(
      head
        .split(separator)
        .map((part) => part.trim().toLowerCase())
        .filter((part) => part.length > 0)
    );
    offered = options.filter((option) => !written.has(option.toLowerCase()));
  }
  return {
    suggestions: matches(offered, typing, notes),
    choose: (chosen) => (head.length === 0 ? chosen : `${head} ${chosen}`)
  };
}

export default function NameCombo({
  name,
  value,
  onChange,
  options,
  notes,
  className,
  boxClassName,
  style,
  maxLength,
  title,
  onSubmit,
  ariaLabel,
  describedBy,
  disabled,
  placeholder,
  separator
}: NameComboProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const combo = useMemo(
    () => comboFor(options, value, separator, notes),
    [options, value, separator, notes]
  );
  const shownOptions = combo.suggestions;
  const shown = open && !disabled && shownOptions.length > 0;

  /** The field's value with `chosen` in place of the name being typed. */
  const choose = (chosen: string): void => {
    onChange(combo.choose(chosen));
    setOpen(false);
  };

  const navigation = useListNavigation<string>({
    items: shown ? shownOptions : [],
    onChoose: choose
  });

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      // Only while the list is showing: a closed picker leaves Escape to the
      // dialog, and an open one spends the press on the list alone.
      if (shown) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
      return;
    }
    if (event.key === 'Enter' && !shown) {
      // Never the form's implicit submission — the enclosing form saves the
      // whole character, and Enter in a name field is not that.
      event.preventDefault();
      onSubmit?.();
      return;
    }
    navigation.onKeyDown(event);
  };

  return (
    <span
      className={boxClassName === undefined ? 'spell-picker' : `spell-picker ${boxClassName}`}
      data-open={shown ? 'true' : 'false'}
      style={style}
      title={title}
    >
      <input
        aria-autocomplete="list"
        aria-describedby={describedBy}
        aria-expanded={shown}
        aria-label={ariaLabel}
        className={className}
        disabled={disabled}
        maxLength={maxLength}
        name={name}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        ref={inputRef}
        role="combobox"
        spellCheck={false}
        value={value}
        onKeyDown={onKeyDown}
      />
      {shown && (
        <ul className="spell-options" ref={navigation.listRef} role="listbox">
          {shownOptions.map((option, index) => (
            <li
              aria-selected={navigation.isActive(index)}
              data-active={navigation.isActive(index) ? 'true' : 'false'}
              key={option}
              // Before the input's blur, or the click would close the list out
              // from under itself and choose nothing.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(option);
              }}
              onMouseEnter={() => navigation.point(index)}
              role="option"
            >
              <span>{option}</span>
              {notes?.get(option) !== undefined && (
                <span className="spell-short">{notes.get(option)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
