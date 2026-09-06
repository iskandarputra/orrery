import { createContext, useContext, useId } from 'react'

/** Form primitives for the settings dialog — one visual language everywhere. */

/**
 * The id of the label a row is drawn with, for the control sitting in it.
 *
 * A switch here is a `<button>` holding nothing but a coloured pill, so it has
 * no text to be named by and screen readers announced three of them as
 * "switch". The words are already on screen: they are the row's own label, two
 * elements away and not associated with anything. Passing the id down the tree
 * associates them without every call site having to repeat the label it just
 * wrote, and it does the same for any control put in a row later.
 */
const RowLabelId = createContext<string | undefined>(undefined)

export function SettingRow({
  label,
  description,
  children
}: {
  label: string
  description?: string
  children: React.ReactNode
}): React.JSX.Element {
  const labelId = useId()
  return (
    <div className="set-row">
      <div className="set-row__text">
        <div className="set-row__label" id={labelId}>
          {label}
        </div>
        {description && <div className="set-row__desc">{description}</div>}
      </div>
      <div className="set-row__control">
        <RowLabelId.Provider value={labelId}>{children}</RowLabelId.Provider>
      </div>
    </div>
  )
}

export function Toggle({
  checked,
  onChange
}: {
  checked: boolean
  onChange(next: boolean): void
}): React.JSX.Element {
  const labelId = useContext(RowLabelId)
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      className={`toggle${checked ? ' toggle--on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle__thumb" />
    </button>
  )
}

export function NumberField({
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange
}: {
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  onChange(next: number): void
}): React.JSX.Element {
  return (
    <span className="numfield">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const next = Number(e.target.value)
          if (!Number.isNaN(next)) onChange(Math.min(max, Math.max(min, next)))
        }}
      />
      {suffix && <span className="numfield__suffix">{suffix}</span>}
    </span>
  )
}

export function TextField({
  value,
  placeholder,
  onChange
}: {
  value: string
  placeholder?: string
  onChange(next: string): void
}): React.JSX.Element {
  return (
    <input
      className="textfield"
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: React.ReactNode }[]
  onChange(next: T): void
}): React.JSX.Element {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((opt) => (
        <button
          key={opt.value}
          role="radio"
          aria-checked={value === opt.value}
          className={`segmented__item${value === opt.value ? ' segmented__item--active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
