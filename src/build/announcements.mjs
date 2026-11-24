import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
export async function loadAnnouncements(root) {
  const batchRoot = path.join(root, 'content/authoring/v2/official-announcements');
  const batches = (await readdir(batchRoot, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && /^\d{8}$/.test(entry.name))
    .map(entry => entry.name).sort();
  const files = [path.join(root, 'content/authoring/v2/w15/announcement-candidate.json'),
    ...batches.map(batch => path.join(batchRoot, batch, 'announcements.json'))];
  const items = [];
  for (const file of files) {
    const batch = JSON.parse(await readFile(file, 'utf8'));
    for (const item of batch.announcements) items.push(Object.fromEntries(
      ['announcementId', 'scope', 'title', 'publishedOn', 'revision', 'source', 'blocks', 'assets'].map(key => [key, item[key]])));
  }
  items.sort((a, b) => a.announcementId < b.announcementId ? -1 : 1);
  if (new Set(items.map(x => x.announcementId)).size !== items.length) throw new Error('duplicate announcement id');
  return { category: 'announcements', items };
}
