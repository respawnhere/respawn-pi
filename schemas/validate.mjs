/*
 * RespawnPack · schemas/validate.mjs — a deliberately SMALL JSON Schema validator.
 *
 * ⛔ WHY NOT A LIBRARY, AND WHY NOT A BIG ONE. The pack's runtime is zero-dependency on purpose, and
 * pulling a general-purpose schema engine into it to satisfy a documentation task would be paying a
 * permanent cost for a one-time need. These schemas are NORMATIVE DECLARATIONS verified in tests; the
 * procedural loaders in kernel/lib/ remain the production validators. Nothing here runs in a hook, in
 * the CLI, or on an installed target's critical path.
 *
 * ⛔ AND THE ONE RULE THAT MAKES A SMALL VALIDATOR HONEST: IT REFUSES WHAT IT DOES NOT IMPLEMENT.
 *
 * A validator that skips a keyword it does not understand is the most expensive kind of green there
 * is — every schema using that keyword silently becomes a check of nothing, and the schema file still
 * READS as if it constrains something. That is DF-007's shape (a check ran, found nothing, and was
 * reported as confirmation) relocated into the thing meant to prevent it. So `compile()` walks every
 * schema up front and THROWS on any keyword outside the supported set. A schema this validator cannot
 * fully enforce cannot be used at all.
 *
 * Supported, and nothing else:
 *   $schema $id title description $defs $ref(local) $comment
 *   type enum const
 *   properties required additionalProperties patternProperties propertyNames
 *   items minItems maxItems
 *   oneOf anyOf allOf not
 *   pattern minimum maximum
 */
const SUPPORTED = new Set([
  '$schema', '$id', 'title', 'description', '$defs', '$ref', '$comment',
  'type', 'enum', 'const',
  'properties', 'required', 'additionalProperties', 'patternProperties', 'propertyNames',
  'items', 'minItems', 'maxItems',
  'oneOf', 'anyOf', 'allOf', 'not',
  'pattern', 'minimum', 'maximum',
]);

const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v; // 'object' | 'string' | 'number' | 'boolean'
}

function matchesType(v, t) {
  if (t === 'number') return typeof v === 'number';
  if (t === 'integer') return Number.isInteger(v);
  return typeOf(v) === t;
}

/** Walk every subschema, rejecting any keyword this validator would silently ignore. */
export function compile(schema, where = '#') {
  if (typeof schema === 'boolean') return schema;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error(`${where}: a schema must be an object or a boolean`);
  }
  for (const k of Object.keys(schema)) {
    if (!SUPPORTED.has(k)) {
      throw new Error(
        `${where}: unsupported keyword "${k}". This validator refuses what it cannot enforce — `
        + 'silently ignoring it would turn this schema into a check of nothing.',
      );
    }
  }
  if (schema.type !== undefined) {
    for (const t of [].concat(schema.type)) {
      if (!TYPES.has(t)) throw new Error(`${where}/type: unknown type "${t}"`);
    }
  }
  for (const [k, sub] of Object.entries(schema.properties || {})) compile(sub, `${where}/properties/${k}`);
  for (const [k, sub] of Object.entries(schema.patternProperties || {})) compile(sub, `${where}/patternProperties/${k}`);
  for (const [k, sub] of Object.entries(schema.$defs || {})) compile(sub, `${where}/$defs/${k}`);
  if (schema.propertyNames !== undefined) compile(schema.propertyNames, `${where}/propertyNames`);
  if (schema.items !== undefined) compile(schema.items, `${where}/items`);
  if (typeof schema.additionalProperties === 'object') compile(schema.additionalProperties, `${where}/additionalProperties`);
  if (schema.not !== undefined) compile(schema.not, `${where}/not`);
  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    (schema[key] || []).forEach((sub, i) => compile(sub, `${where}/${key}/${i}`));
  }
  return true;
}

function resolveRef(ref, root, where) {
  if (!ref.startsWith('#/$defs/')) throw new Error(`${where}: only local #/$defs/ references are supported, got "${ref}"`);
  const name = ref.slice('#/$defs/'.length);
  const target = (root.$defs || {})[name];
  if (!target) throw new Error(`${where}: unresolved reference "${ref}"`);
  return target;
}

function check(value, schema, root, at, errors) {
  if (schema === true) return;
  if (schema === false) { errors.push(`${at}: nothing is valid here`); return; }
  if (schema.$ref) { check(value, resolveRef(schema.$ref, root, at), root, at, errors); return; }

  if (schema.type !== undefined) {
    const types = [].concat(schema.type);
    if (!types.some((t) => matchesType(value, t))) {
      errors.push(`${at}: expected ${types.join(' | ')}, got ${typeOf(value)}`);
      return; // every later keyword would report noise about a value of the wrong shape
    }
  }
  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    errors.push(`${at}: expected the constant ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  }
  if (schema.enum !== undefined && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    errors.push(`${at}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  }
  if (schema.pattern !== undefined && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) {
    errors.push(`${at}: ${JSON.stringify(value)} does not match /${schema.pattern}/`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at}: ${value} < minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at}: ${value} > maximum ${schema.maximum}`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${at}: ${value.length} item(s), minItems ${schema.minItems}`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${at}: ${value.length} item(s), maxItems ${schema.maxItems}`);
    if (schema.items !== undefined) value.forEach((v, i) => check(v, schema.items, root, `${at}[${i}]`, errors));
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const r of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, r)) errors.push(`${at}: missing required property "${r}"`);
    }
    const props = schema.properties || {};
    const patterns = Object.entries(schema.patternProperties || {}).map(([p, s]) => [new RegExp(p), s, p]);
    for (const [k, v] of Object.entries(value)) {
      if (schema.propertyNames !== undefined) check(k, schema.propertyNames, root, `${at}/<key ${JSON.stringify(k)}>`, errors);
      let handled = false;
      if (Object.prototype.hasOwnProperty.call(props, k)) { check(v, props[k], root, `${at}.${k}`, errors); handled = true; }
      for (const [re, sub] of patterns) if (re.test(k)) { check(v, sub, root, `${at}.${k}`, errors); handled = true; }
      if (!handled && schema.additionalProperties !== undefined) {
        if (schema.additionalProperties === false) errors.push(`${at}: unknown property "${k}" (additionalProperties is false)`);
        else check(v, schema.additionalProperties, root, `${at}.${k}`, errors);
      }
    }
  }

  if (schema.not !== undefined) {
    const sub = [];
    check(value, schema.not, root, at, sub);
    if (!sub.length) errors.push(`${at}: matched a schema it must not match`);
  }
  for (const sub of schema.allOf || []) check(value, sub, root, at, errors);
  if (schema.anyOf) {
    const branches = schema.anyOf.map((s) => { const e = []; check(value, s, root, at, e); return e; });
    if (branches.every((e) => e.length)) errors.push(`${at}: matched none of the anyOf branches — ${branches.map((e) => e[0]).join(' ; ')}`);
  }
  if (schema.oneOf) {
    const branches = schema.oneOf.map((s) => { const e = []; check(value, s, root, at, e); return e; });
    const ok = branches.filter((e) => !e.length).length;
    if (ok !== 1) errors.push(`${at}: matched ${ok} oneOf branches, expected exactly 1 — ${branches.map((e) => e[0] || 'ok').join(' ; ')}`);
  }
}

/** @returns {{valid: boolean, errors: string[]}} */
export function validate(value, schema) {
  compile(schema, schema.$id || '#');
  const errors = [];
  check(value, schema, schema, '$', errors);
  return { valid: errors.length === 0, errors };
}