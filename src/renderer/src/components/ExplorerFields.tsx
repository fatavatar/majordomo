/**
 * The Explorer's filter-bar fields, as mudtool draws them (`.field`, its
 * dropdowns, number boxes and ticks), shared by every list's bar.
 */
import type { ReactNode } from 'react';

/** A labelled field on the filter bar, as mudtool's `.field`. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="ex-field">
      <span className="ex-field-label">{label}</span>
      <span className="ex-field-row">{children}</span>
    </label>
  );
}

/** A dropdown of `Any` and then the values given. */
export function Choice({
  label,
  any,
  value,
  options,
  onChange
}: {
  label: string;
  any: string;
  value: string;
  options: ReadonlyArray<string | [string, string]>;
  onChange(value: string): void;
}) {
  return (
    <Field label={label}>
      <select onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">{any}</option>
        {options.map((option) => {
          const [id, text] = typeof option === 'string' ? [option, option] : option;
          return (
            <option key={id} value={id}>
              {text}
            </option>
          );
        })}
      </select>
    </Field>
  );
}

/** One of the Spells bar's numbered choices: its place in `labels` is the filter's value. */
export function Pick({
  label,
  labels,
  value,
  onChange
}: {
  label: string;
  labels: readonly string[];
  value: number;
  onChange(value: number): void;
}) {
  return (
    <Field label={label}>
      <select onChange={(event) => onChange(Number(event.target.value))} value={String(value)}>
        {labels.map((text, i) => (
          <option key={i} value={i}>
            {text}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** A figure, or blank for none; committed as typed. */
export function Figure({
  label,
  value,
  onChange,
  width = '5em'
}: {
  label: string;
  value: number | null;
  onChange(value: number | null): void;
  width?: string;
}) {
  return (
    <Field label={label}>
      <input
        inputMode="numeric"
        onChange={(event) => {
          const text = event.target.value.trim();
          const n = Number.parseInt(text, 10);
          onChange(text === '' || Number.isNaN(n) ? null : n);
        }}
        style={{ width }}
        value={value === null ? '' : String(value)}
      />
    </Field>
  );
}

/** A filter's tick, as mudtool draws one. */
export function Check({
  label,
  checked,
  onChange
}: {
  label: string;
  checked: boolean;
  onChange(on: boolean): void;
}) {
  return (
    <label className="ex-check">
      <input
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      {label}
    </label>
  );
}
