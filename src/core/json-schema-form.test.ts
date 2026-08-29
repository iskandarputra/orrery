import { describe, expect, it } from 'vitest'
import { coerceValues, fieldsForSchema, initialValues } from './json-schema-form'

const schema = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Where to look' },
    depth: { type: 'integer', default: 2 },
    ratio: { type: 'number' },
    recursive: { type: 'boolean' },
    mode: { type: 'string', enum: ['fast', 'thorough'] },
    filters: { type: 'array', items: { type: 'string' } }
  },
  required: ['path']
}

describe('fieldsForSchema', () => {
  it('reads each property, in the order the schema lists them', () => {
    expect(fieldsForSchema(schema).map((f) => [f.name, f.kind])).toEqual([
      ['path', 'string'],
      ['depth', 'integer'],
      ['ratio', 'number'],
      ['recursive', 'boolean'],
      ['mode', 'enum'],
      ['filters', 'json']
    ])
  })

  it('knows which fields are required', () => {
    const required = fieldsForSchema(schema).filter((f) => f.required)
    expect(required.map((f) => f.name)).toEqual(['path'])
  })

  it('carries the description and default through to the form', () => {
    const fields = fieldsForSchema(schema)
    expect(fields[0]?.description).toBe('Where to look')
    expect(fields[1]?.placeholder).toBe('2')
  })

  it('has nothing to draw for a tool that takes no arguments', () => {
    expect(fieldsForSchema({ type: 'object' })).toEqual([])
    expect(fieldsForSchema(undefined)).toEqual([])
    expect(fieldsForSchema('nonsense')).toEqual([])
  })
})

describe('coerceValues', () => {
  const fields = fieldsForSchema(schema)

  it('parses each field to the type the schema asked for', () => {
    const { values, errors } = coerceValues(fields, {
      path: '/notes',
      depth: '3',
      ratio: '0.5',
      recursive: 'true',
      mode: 'fast',
      filters: '["*.md"]'
    })
    expect(errors).toEqual({})
    expect(values).toEqual({
      path: '/notes',
      depth: 3,
      ratio: 0.5,
      recursive: true,
      mode: 'fast',
      filters: ['*.md']
    })
  })

  it('leaves an empty optional field out instead of sending an empty string', () => {
    // A tool given {"ratio": ""} looks for something called nothing and blames
    // the vault.
    const { values } = coerceValues(fields, { path: '/notes' })
    expect(values).toEqual({ path: '/notes' })
    expect('ratio' in values).toBe(false)
  })

  it('reports a required field left blank', () => {
    expect(coerceValues(fields, { path: '  ' }).errors).toEqual({ path: 'Required' })
  })

  it('refuses text where a number belongs', () => {
    expect(coerceValues(fields, { path: '/x', ratio: 'soon' }).errors).toEqual({
      ratio: 'Must be a number'
    })
  })

  it('refuses a fraction where a whole number belongs', () => {
    expect(coerceValues(fields, { path: '/x', depth: '2.5' }).errors).toEqual({
      depth: 'Must be a whole number'
    })
  })

  it('refuses JSON that is not', () => {
    expect(coerceValues(fields, { path: '/x', filters: '[oops' }).errors).toEqual({
      filters: 'Must be valid JSON'
    })
  })

  it('refuses a choice that is not on offer', () => {
    expect(coerceValues(fields, { path: '/x', mode: 'sideways' }).errors).toEqual({
      mode: 'Not one of the choices'
    })
  })

  it('sends an unticked optional checkbox only when it has a default to override', () => {
    const withDefault = fieldsForSchema({
      type: 'object',
      properties: { loud: { type: 'boolean', default: true } }
    })
    expect(coerceValues(withDefault, { loud: 'false' }).values).toEqual({ loud: false })

    const plain = fieldsForSchema({ type: 'object', properties: { loud: { type: 'boolean' } } })
    expect(coerceValues(plain, { loud: 'false' }).values).toEqual({})
    expect(coerceValues(plain, { loud: 'true' }).values).toEqual({ loud: true })
  })

  it('collects every problem rather than stopping at the first', () => {
    const { errors } = coerceValues(fields, { ratio: 'x', depth: 'y' })
    expect(Object.keys(errors).sort()).toEqual(['depth', 'path', 'ratio'])
  })
})

describe('initialValues', () => {
  it('starts the boxes at the schema defaults', () => {
    expect(initialValues(fieldsForSchema(schema))).toEqual({
      path: '',
      depth: '2',
      ratio: '',
      recursive: 'false',
      mode: '',
      filters: ''
    })
  })

  it('writes a default that is a list as the JSON it is', () => {
    const fields = fieldsForSchema({
      type: 'object',
      properties: { tags: { type: 'array', default: ['a', 'b'] } }
    })
    expect(initialValues(fields)).toEqual({ tags: '["a","b"]' })
  })
})
