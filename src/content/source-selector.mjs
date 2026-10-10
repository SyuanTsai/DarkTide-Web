export function parseJsonSource(bytes, sourceId) {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`invalid JSON source bytes: ${sourceId}`);
  }
}

export function readJsonSelector(document, selector) {
  if (typeof selector !== 'string' || !selector.startsWith('json:/')) {
    throw new Error(`invalid JSON selector: ${selector}`);
  }
  let value = document;
  for (const encoded of selector.slice('json:/'.length).split('/')) {
    if (!encoded || /~(?![01])/.test(encoded)) throw new Error(`invalid JSON selector: ${selector}`);
    const key = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(value)) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) {
        throw new Error(`missing JSON selector: ${selector}`);
      }
    } else if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) {
      throw new Error(`missing JSON selector: ${selector}`);
    }
    value = value[key];
  }
  return value;
}
