/**
 * A JSON Schema, as a form.
 *
 * MCP describes a tool's arguments with JSON Schema, and both halves of this
 * feature need to render one: the panel where a tool is run by hand, and the
 * elicitation dialog a server raises when it needs something from the user.
 * Neither wants a schema validator — the server validates for real — they want
 * to know what to draw.
 *
 * The rule that earns this module its tests is what happens to a field left
 * empty. An optional argument that is not filled in must not be sent at all: a
 * tool given `{"path": ""}` will look for a file called nothing, report
 * something unhelpful, and the person who left the box alone will be told their
 * vault is missing.
 */

export type FieldKind = 'string' | 'number' | 'integer' | 'boolean' | 'enum' | 'json'

export interface Field {
  name: string
  label: string
  description: string
  kind: FieldKind
  required: boolean
  /** Choices, for `enum`. */
  options: string[]
  default?: unknown
  /** Shown in the empty box: the default, or the shape expected. */
  placeholder: string
}

interface RawSchema {
  type?: unknown
  properties?: Record<string, RawSchema>
  required?: unknown
  enum?: unknown
  description?: string
  title?: string
  default?: unknown
  items?: RawSchema
}

const asRecord = (value: unknown): RawSchema | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as RawSchema) : null

function kindOf(schema: RawSchema): FieldKind {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return 'enum'
  switch (schema.type) {
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'integer':
      return 'integer'
    case 'boolean':
      return 'boolean'
    default:
      // Arrays, objects, unions and anything undeclared: a JSON box, which is
      // honest about asking for more than a word.
      return 'json'
  }
}

/** The fields a schema asks for, in the order the schema lists them. */
export function fieldsForSchema(schema: unknown): Field[] {
  const root = asRecord(schema)
  const properties = root?.properties
  if (!properties || typeof properties !== 'object') return []

  const required = new Set(
    Array.isArray(root?.required)
      ? root.required.filter((n): n is string => typeof n === 'string')
      : []
  )

  return Object.entries(properties).map(([name, raw]) => {
    const property = asRecord(raw) ?? {}
    const kind = kindOf(property)
    return {
      name,
      label: typeof property.title === 'string' ? property.title : name,
      description: typeof property.description === 'string' ? property.description : '',
      kind,
      required: required.has(name),
      options:
        kind === 'enum' && Array.isArray(property.enum) ? property.enum.map((v) => String(v)) : [],
      default: property.default,
      placeholder:
        property.default !== undefined ? String(property.default) : kind === 'json' ? 'JSON' : ''
    }
  })
}

export interface Coerced {
  values: Record<string, unknown>
  /** Field name to the reason it cannot be used. Empty when it is all fine. */
  errors: Record<string, string>
}

/**
 * Turn what was typed into what the tool is given.
 *
 * Empty optional fields are left out entirely rather than sent as empty
 * strings, and a required one that is empty is an error rather than a silent
 * `""`. Everything else is parsed to the type the schema asked for, because a
 * server that wants a number and receives `"3"` is entitled to refuse.
 */
export function coerceValues(fields: readonly Field[], raw: Record<string, string>): Coerced {
  const values: Record<string, unknown> = {}
  const errors: Record<string, string> = {}

  for (const field of fields) {
    const text = (raw[field.name] ?? '').trim()

    if (field.kind === 'boolean') {
      // A checkbox always has an answer, but only a ticked one is worth sending
      // when the field is optional and the schema has its own default.
      const ticked = text === 'true'
      if (ticked || field.required || field.default !== undefined) values[field.name] = ticked
      continue
    }

    if (text === '') {
      if (field.required) errors[field.name] = 'Required'
      continue
    }

    switch (field.kind) {
      case 'number':
      case 'integer': {
        const parsed = Number(text)
        if (!Number.isFinite(parsed)) errors[field.name] = 'Must be a number'
        else if (field.kind === 'integer' && !Number.isInteger(parsed)) {
          errors[field.name] = 'Must be a whole number'
        } else values[field.name] = parsed
        break
      }
      case 'json': {
        try {
          values[field.name] = JSON.parse(text)
        } catch {
          errors[field.name] = 'Must be valid JSON'
        }
        break
      }
      case 'enum': {
        if (field.options.length > 0 && !field.options.includes(text)) {
          errors[field.name] = 'Not one of the choices'
        } else values[field.name] = text
        break
      }
      default:
        values[field.name] = text
    }
  }

  return { values, errors }
}

/** What the boxes start with: the schema's defaults, as text. */
export function initialValues(fields: readonly Field[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const field of fields) {
    if (field.default === undefined) {
      out[field.name] = field.kind === 'boolean' ? 'false' : ''
    } else if (field.kind === 'json') {
      out[field.name] = JSON.stringify(field.default)
    } else {
      out[field.name] = String(field.default)
    }
  }
  return out
}
