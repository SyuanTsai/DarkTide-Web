// SYP-388 option A: this standalone module uses only Node built-ins so it can
// later move unchanged to the Source-Data pipeline (option B).
const CATEGORIES = ['blessings', 'skills', 'terms', 'weapons'];
const FIELDS = ['name', 'official', 'values', 'explanation', 'errata'];
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function fieldChanges(previous, current, path, result) {
  if (Array.isArray(previous) && Array.isArray(current)) {
    for (let index = 0; index < Math.max(previous.length, current.length); index++) {
      fieldChanges(previous[index], current[index], `${path}.${index}`, result);
    }
  } else if (object(previous) && object(current)) {
    for (const key of [...new Set([...Object.keys(previous), ...Object.keys(current)])].sort(compare)) {
      fieldChanges(previous[key], current[key], `${path}.${key}`, result);
    }
  } else if (JSON.stringify(previous) !== JSON.stringify(current)) {
    result.push({ path, previous: previous ?? null, current: current ?? null });
  }
}

export function diffGameVersions({ previous, current }) {
  const result = [];
  for (const category of CATEGORIES) {
    const before = new Map(previous[category].items.map(item => [item.id, item]));
    const after = new Map(current[category].items.map(item => [item.id, item]));
    for (const id of [...new Set([...before.keys(), ...after.keys()])].sort(compare)) {
      const oldItem = before.get(id), newItem = after.get(id);
      if (!oldItem) result.push({ category, id, type: 'added', current: newItem });
      else if (!newItem) result.push({ category, id, type: 'removed', previous: oldItem });
      else {
        const fields = [];
        for (const field of FIELDS) fieldChanges(oldItem[field], newItem[field], field, fields);
        fields.sort((a, b) => compare(a.path, b.path));
        if (fields.length) result.push({ category, id, type: 'changed', name: newItem.name, fields });
      }
    }
  }
  return result;
}

export function buildGameChangesDomain({ versions, dataByVersion, gameVersion, frozen }) {
  const index = versions.indexOf(gameVersion);
  if (index < 0) throw new Error(`Unknown game version: ${gameVersion}`);
  if (index === 0) return frozen ?? null;
  const previousGameVersion = versions[index - 1];
  return { gameVersion, previousGameVersion, changes: diffGameVersions({ previous: dataByVersion[previousGameVersion], current: dataByVersion[gameVersion] }) };
}
