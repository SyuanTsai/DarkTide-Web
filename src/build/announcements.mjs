import { readFile } from 'node:fs/promises';
import path from 'node:path';
export async function loadAnnouncements(root) {
  const items = [];
  for (const relative of ['content/authoring/v2/w15/announcement-candidate.json', 'content/authoring/v2/official-announcements/20261030/announcements.json']) {
    const batch = JSON.parse(await readFile(path.join(root, relative), 'utf8'));
    for (const item of batch.announcements) items.push(Object.fromEntries(
      ['announcementId', 'scope', 'title', 'publishedOn', 'revision', 'source', 'blocks', 'assets'].map(key => [key, item[key]])));
  }
  items.sort((a, b) => a.announcementId < b.announcementId ? -1 : 1);
  if (new Set(items.map(x => x.announcementId)).size !== items.length) throw new Error('duplicate announcement id');
  return { category: 'announcements', items };
}
