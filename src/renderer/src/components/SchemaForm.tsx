import { coerceValues, initialValues, type Field } from '@core/json-schema-form'

/**
 * A form drawn from a JSON Schema.
 *
 * Shared by the two places a schema has to be filled in: running a tool by hand
 * from the panel, and answering a server that asked for something. Values are
 * held as text by the caller and converted with `coerceValues` on submit, so
 * what is typed is never silently reinterpreted while it is being typed.
 */
export function SchemaForm({
  fields,
  values,
  errors,
  onChange,
  idPrefix
}: {
  fields: Field[]
  values: Record<string, string>
  errors: Record<string, string>
  onChange(name: string, value: string): void
  idPrefix: string
}): React.JSX.Element | null {
  if (fields.length === 0) return null

  return (
    <div className="schema-form">
      {fields.map((field) => {
        const id = `${idPrefix}-${field.name}`
        const error = errors[field.name]
        return (
          <div className="schema-form__row" key={field.name}>
            <label className="schema-form__label" htmlFor={id}>
              {field.label}
              {field.required && <span className="schema-form__required"> required</span>}
            </label>
            {field.description && <p className="schema-form__hint">{field.description}</p>}

            {field.kind === 'boolean' ? (
              <label className="schema-form__check">
                <input
                  id={id}
                  type="checkbox"
                  checked={values[field.name] === 'true'}
                  onChange={(e) => onChange(field.name, String(e.target.checked))}
                />
                <span>{field.label}</span>
              </label>
            ) : field.kind === 'enum' ? (
              <select
                id={id}
                className="schema-form__input"
                value={values[field.name] ?? ''}
                onChange={(e) => onChange(field.name, e.target.value)}
              >
                <option value="">{field.required ? 'Choose…' : 'Not set'}</option>
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : field.kind === 'json' ? (
              <textarea
                id={id}
                className="schema-form__input schema-form__input--json"
                rows={3}
                spellCheck={false}
                placeholder={field.placeholder}
                value={values[field.name] ?? ''}
                onChange={(e) => onChange(field.name, e.target.value)}
              />
            ) : (
              <input
                id={id}
                className="schema-form__input"
                type={field.kind === 'string' ? 'text' : 'number'}
                placeholder={field.placeholder}
                value={values[field.name] ?? ''}
                onChange={(e) => onChange(field.name, e.target.value)}
              />
            )}

            {error && <p className="schema-form__error">{error}</p>}
          </div>
        )
      })}
    </div>
  )
}

export { coerceValues, initialValues }
