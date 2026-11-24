#!/usr/bin/env node
// Official Darktide announcement intake: scan the Fatshark forum, capture first posts,
// build the typed block model from Traditional Chinese Markdown, and run the quality gate.
// See docs/workflows/announcements.md.
import { mkdir, readFile, readdir, writeFile, appendFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const FORUM_ORIGIN = 'https://forums.fatsharkgames.com';
export const CATEGORY_ID = 70;
export const ANNOUNCEMENT_ROOT = 'content/authoring/v2/official-announcements';
export const POLICY_FILE = `${ANNOUNCEMENT_ROOT}/intake-policy.json`;
const USER_AGENT = 'darktide-zh-tw-announcement-intake (+https://darktide.tw-syuan.com/)';
const LICENSE = {
  identifier: 'CC-BY-NC-SA-3.0', termsUrl: 'https://forums.fatsharkgames.com/tos',
  licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/3.0/',
  scope: 'Forum contribution text; not a repository-wide license or a blanket license to trademarks',
  translationNoteRequired: true
};
export const LICENSE_FOOTER_PREFIX = '**來源與授權：**';

export const sha256 = buf => createHash('sha256').update(buf).digest('hex');
export const toLf = text => String(text).replace(/\r\n/g, '\n');

// ---------- forum access ----------

async function getJson(url, fetchImpl = fetch) {
  const res = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, redirect: 'follow' });
  if (res.status !== 200) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

export async function fetchCategoryTopics(fetchImpl = fetch, stopBefore = null) {
  const cutoff = stopBefore === null ? null : Date.parse(stopBefore);
  if (cutoff !== null && Number.isNaN(cutoff)) throw new Error(`invalid stopBefore timestamp: ${stopBefore}`);
  const topics = new Map();
  let url = `${FORUM_ORIGIN}/c/${CATEGORY_ID}/l/latest.json`;
  for (let page = 0; page < 10; page++) {
    const list = await getJson(url, fetchImpl);
    const pageTopics = list.topic_list?.topics ?? [];
    for (const t of pageTopics) {
      if (!topics.has(t.id)) topics.set(t.id, {
        id: t.id, title: t.title, slug: t.slug, createdAt: t.created_at, categoryId: t.category_id,
        pinned: Boolean(t.pinned), visible: t.visible !== false
      });
    }
    if (!pageTopics.length) break;
    const nonPinned = pageTopics.filter(t => !t.pinned);
    if (cutoff !== null && nonPinned.every(t => Date.parse(t.created_at) <= cutoff)) break;
    const more = list.topic_list?.more_topics_url;
    if (!more) break;
    const next = new URL(more, FORUM_ORIGIN);
    if (next.origin !== FORUM_ORIGIN) throw new Error(`more_topics_url must use the same origin as ${FORUM_ORIGIN}`);
    if (!next.pathname.endsWith('.json')) next.pathname += '.json';
    next.hash = '';
    url = next.href;
  }
  return [...topics.values()];
}

export async function fetchTopic(id, fetchImpl = fetch) {
  return getJson(`${FORUM_ORIGIN}/t/${id}.json`, fetchImpl);
}

// ---------- repository state ----------

async function exists(p) { try { await stat(p); return true; } catch { return false; } }

export async function listBatchDirs(root) {
  const dir = path.join(root, ANNOUNCEMENT_ROOT);
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter(e => e.isDirectory() && /^\d{8}$/.test(e.name)).map(e => e.name).sort();
}

export async function knownTopicIds(root) {
  const files = ['content/authoring/v2/w15/announcement-candidate.json'];
  for (const batch of await listBatchDirs(root)) {
    files.push(`${ANNOUNCEMENT_ROOT}/${batch}/announcements.json`);
    files.push(`${ANNOUNCEMENT_ROOT}/${batch}/source-snapshots/source-manifest.json`);
  }
  const ids = new Set();
  for (const rel of files) {
    const file = path.join(root, rel);
    if (!(await exists(file))) continue;
    const text = await readFile(file, 'utf8');
    const document = JSON.parse(text);
    // W15 has related forum topics tracked as evidence inside its legacy records.
    if (rel.startsWith('content/authoring/v2/w15/')) {
      for (const match of text.matchAll(/forums\.fatsharkgames\.com\/t\/[^"/\s]+\/(\d+)/g)) ids.add(Number(match[1]));
    }
    for (const post of document.posts ?? []) ids.add(post.topicId);
    for (const article of document.announcements ?? []) {
      const id = /^https:\/\/forums\.fatsharkgames\.com\/t\/(?:[^/]+\/)?(\d+)(?:$|[/?#])/.exec(article.source?.locator);
      if (id) ids.add(Number(id[1]));
    }
  }
  return ids;
}

export async function readPolicy(root) {
  return JSON.parse(await readFile(path.join(root, POLICY_FILE), 'utf8'));
}

// New = in category 70, visible, not pinned, created after the policy baseline, not yet in the repository,
// and not explicitly ignored. Sorted by created_at ascending.
export function selectNewTopics(topics, known, policy) {
  const baseline = Date.parse(policy.baselineCreatedAt);
  const ignored = new Set((policy.ignoredTopicIds ?? []).map(Number));
  return topics
    .filter(t => t.categoryId === CATEGORY_ID && t.visible && !t.pinned)
    .filter(t => Date.parse(t.createdAt) > baseline && !known.has(t.id) && !ignored.has(t.id))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id - b.id);
}

// ---------- source analysis ----------

const decodeEntities = s => s
  .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&rsquo;|&lsquo;/g, "'")
  .replace(/&ldquo;|&rdquo;/g, '"').replace(/&hellip;/g, '…').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attr = (tag, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return m ? decodeEntities(m[1]) : null; };
const hasClass = (tag, name) => (attr(tag, 'class') ?? '').split(/\s+/).includes(name);
const stripTags = s => decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

export function normalizeUrl(u) {
  try {
    const url = new URL(decodeEntities(u));
    if (/(^|\.)youtube\.com$/.test(url.hostname) && url.searchParams.get('v')) return `youtube:${url.searchParams.get('v')}`;
    if (url.hostname === 'youtu.be') return `youtube:${url.pathname.slice(1)}`;
    const m = /^\/embed\/([^/?]+)/.exec(url.pathname);
    if (/(^|\.)youtube\.com$/.test(url.hostname) && m) return `youtube:${m[1]}`;
    return `${url.hostname}${url.pathname.replace(/\/+$/, '')}${url.search}${url.hash}`;
  } catch { return String(u); }
}

// Structural facts of a Discourse "cooked" first post used by the quality gate.
export function analyzeSource(cooked) {
  let html = toLf(cooked);
  const oneboxes = [];
  // A onebox is generated preview chrome. Its destination represents the whole
  // card, including its duplicate links, preview heading, site icon and thumbnail.
  html = html.replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/g, card => {
    const tag = card.slice(0, card.indexOf('>') + 1);
    if (!hasClass(tag, 'onebox')) return card;
    const src = attr(tag, 'data-onebox-src'); if (src) oneboxes.push(src); return '';
  });
  const videos = [], widgets = [];
  html = html.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/g, tag => {
    const src = attr(tag, 'src') ?? '';
    const n = normalizeUrl(src);
    if (n.startsWith('youtube:')) videos.push(n); else widgets.push(src);
    return '';
  });
  html = html.replace(/<div\b[^>]*>/g, tag => {
    const id = attr(tag, 'data-video-id');
    if (hasClass(tag, 'lazy-video-container') && id && attr(tag, 'data-provider-name') === 'youtube') videos.push(`youtube:${id}`);
    return tag;
  });
  // Player thumbnails (including display:none), emoji glyphs and forum UI
  // icons are generated decorations. Preserve the actual video via its link.
  html = html.replace(/<img\b[^>]*>/g, tag =>
    ['youtube-thumbnail', 'emoji', 'site-icon', 'avatar'].some(cls => hasClass(tag, cls)) ? '' : tag);
  const images = [...html.matchAll(/<img\b[^>]*>/g)].map(m => attr(m[0], 'src'));
  const headingTags = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)];
  const headings = headingTags.map(m => stripTags(m[2]));
  const listItems = [...html.matchAll(/<li\b/g)].length;
  const embeddedVideos = [...videos];
  const links = [];
  for (const m of html.matchAll(/<a\b[^>]*>/g)) {
    const href = attr(m[0], 'href');
    // Lightbox links operate the image UI. Heading anchors are navigation within the post.
    if (!href || href.startsWith('#') || hasClass(m[0], 'lightbox') || hasClass(m[0], 'anchor')) continue;
    const destination = new URL(href, FORUM_ORIGIN);
    if (!/^https?:$/.test(destination.protocol)) continue;
    const url = destination.href;
    if (normalizeUrl(url).startsWith('youtube:')) videos.push(normalizeUrl(url));
    else links.push(url);
  }
  const textOnly = html.replace(/<div class="lightbox-wrapper">[\s\S]*?<\/a><\/div>/g, '');
  // Discourse wraps loose list items in <p>. Their text is already represented by the list.
  const outsideLists = textOnly.replace(/<li\b[^>]*>[\s\S]*?<\/li>/g, '');
  const paragraphs = [...outsideLists.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map(m => stripTags(m[1])).filter(Boolean);
  const listSignoff = /<li>\s*(?:<p>)?\s*The Darktide Team\s*(?:<\/p>)?\s*<\/li>/.test(html);
  return { images, headings, listItems, links, videos: [...new Set(videos)], widgets, oneboxes,
    embeddedVideos, headingLevels: headingTags.map(m => Number(m[1])), listSignoff, paragraphs: paragraphs.length,
    text: stripTags(textOnly.replace(/<\/?(?:p|li|h[1-6])\b[^>]*>/g, ' ')) };
}

// Plain outline the translator works from (not committed).
export function sourceOutline(topic) {
  const post = topic.post_stream.posts[0];
  const outline = toLf(post.cooked)
    .replace(/<aside class="onebox[^"]*"[^>]*data-onebox-src="([^"]+)"[\s\S]*?<\/aside>/g, '\n[ONEBOX $1]\n')
    .replace(/<iframe\b[^>]*src="([^"]+)"[\s\S]*?<\/iframe>/g, '\n[IFRAME $1]\n')
    .replace(/<img\b[^>]*class="[^"]*(?:youtube-thumbnail|emoji|site-icon)[^"]*"[^>]*>/g, '')
    .replace(/<div class="lightbox-wrapper"><a class="lightbox" href="([^"]+)"[^>]*data-download-href="([^"]+)"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"[\s\S]*?<\/a><\/div>/g,
      (m, orig, dl, src, alt) => `\n[IMG ${src} | alt=${alt} | original=${orig} | download=${FORUM_ORIGIN}${dl}]\n`)
    .replace(/<img\b[^>]*src="([^"]+)"[^>]*alt="([^"]*)"[^>]*>/g, '\n[IMG $1 | alt=$2]\n')
    .replace(/<img\b[^>]*src="([^"]+)"[^>]*>/g, '\n[IMG $1]\n')
    .replace(/<a\b[^>]*class="anchor"[^>]*><\/a>/g, '')
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, '[$2]($1)')
    .replace(/<h(\d)[^>]*>/g, (m, n) => '\n' + '#'.repeat(+n) + ' ').replace(/<\/h\d>/g, '\n')
    .replace(/<li>/g, '\n- ').replace(/<\/?(strong|b)>/g, '**').replace(/<\/?(em|i)>/g, '*')
    .replace(/<blockquote>/g, '\n> ').replace(/<br\s*\/?>/g, '\n').replace(/<\/p>/g, '\n')
    .replace(/<[^>]+>/g, '');
  return `# ${topic.title}\n\n- topic: ${topic.id}\n- author: ${post.username}\n- created_at: ${post.created_at}\n- url: ${FORUM_ORIGIN}/t/${topic.slug}/${topic.id}\n\n${decodeEntities(outline).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

// ---------- Markdown -> typed blocks ----------

export function parseInline(s) {
  const out = [];
  const re = /\*\*\*([^*]+)\*\*\*|\*\*([^*]*?)\*\*|\*(\[[^\]]+\]\([^)]+\)|[^*]+)\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0, m;
  const push = (kind, text, extra = {}) => { if (text) out.push({ kind, text, ...extra }); };
  while ((m = re.exec(s))) {
    push('text', s.slice(last, m.index));
    if (m[1] !== undefined) push('strong', m[1]);
    else if (m[2] !== undefined) push('strong', m[2]);
    else if (m[3] !== undefined) {
      const l = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(m[3]);
      if (l) push('link', l[1], { href: l[2] }); else push('emphasis', m[3]);
    } else push('link', m[4], { href: m[5] });
    last = re.lastIndex;
  }
  push('text', s.slice(last));
  const merged = [];
  for (const x of out) { const p = merged.at(-1); if (p && p.kind === 'text' && x.kind === 'text') p.text += x.text; else merged.push(x); }
  return merged;
}
const plain = inline => inline.map(x => x.text).join('');

const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)]+)\)$/;
const LIST_LINE = /^- /;
const HEADING_LINE = /^(#{1,4}) (.+)$/;
const LEFTOVER_MARKDOWN = /\*|`|\]\(|!\[|~~|^\s*(?:#{1,6}\s|\d+[.)]\s|[+>-]\s)|__|(?:^|\s)_\S/;

function hasLeftoverMarkdown(inline) {
  return inline.some(part => LEFTOVER_MARKDOWN.test(part.text));
}

// Converts one translation into blocks/assets. `pin(uri)` resolves image metadata.
export async function markdownToRecord(md, { announcementId, topicId, pin }) {
  let n = 0; const bid = () => `${announcementId}:block:${++n}`;
  const blocks = [], assets = [], assetIds = new Map();
  let title = null;
  const lines = toLf(md).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    let m;
    if ((m = HEADING_LINE.exec(line))) {
      const inline = parseInline(m[2]);
      if (m[1].length === 1 && title === null) title = plain(inline);
      blocks.push({ blockId: bid(), kind: 'heading', text: plain(inline), inline, level: m[1].length });
    } else if ((m = IMAGE_LINE.exec(line))) {
      const [, alt, uri] = m;
      let assetId = assetIds.get(uri);
      if (!assetId) {
        const p = await pin(uri);
        const key = /43a25bcb|cb8bd9b5/.test(uri) ? 'divider' : (assets.length === 0 ? 'hero' : `image-${assets.length}`);
        assetId = `official:darktide:announcement:asset:${topicId}-${key}`;
        if (assets.some(a => a.assetId === assetId)) assetId = `${assetId}-${assets.length}`;
        assetIds.set(uri, assetId);
        assets.push({ assetId, mediaType: p.mediaType, alt, sourceUri: uri, sha256: p.sha256, sizeBytes: p.sizeBytes });
      }
      blocks.push({ blockId: bid(), kind: 'image', assetRef: { assetId }, alt });
    } else if (line.startsWith('> ')) {
      const inline = parseInline(line.slice(2));
      const paragraph = { blockId: bid(), kind: 'paragraph', text: plain(inline), inline };
      blocks.push({ blockId: bid(), kind: 'quote', blocks: [paragraph] });
    } else if (LIST_LINE.test(line)) {
      const items = [];
      while (i < lines.length && LIST_LINE.test(lines[i])) {
        const inline = parseInline(lines[i].slice(2));
        items.push({ blockId: bid(), text: plain(inline), inline, children: [] });
        i++;
      }
      i--;
      blocks.push({ blockId: bid(), kind: 'list', ordered: false, items });
    } else {
      const inline = parseInline(line);
      blocks.push({ blockId: bid(), kind: 'paragraph', text: plain(inline), inline });
    }
  }
  const hasLeftovers = block => hasLeftoverMarkdown(block.inline ?? [])
    || block.blocks?.some(hasLeftovers) || block.items?.some(hasLeftovers);
  if (blocks.some(hasLeftovers)) throw new Error(`${announcementId}: unparsed Markdown markers`);
  if (!title) throw new Error(`${announcementId}: missing "# " title line`);
  return { title, blocks, assets };
}

export function makeImagePinner(fetchImpl = fetch) {
  const cache = new Map();
  return async uri => {
    if (cache.has(uri)) return cache.get(uri);
    const res = await fetchImpl(uri, { headers: { 'user-agent': USER_AGENT } });
    if (res.status !== 200) throw new Error(`GET ${uri} -> ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const pin = {
      sourceUri: uri, finalUri: res.url || uri, status: res.status,
      mediaType: (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0],
      contentLengthHeader: Number(res.headers.get('content-length')) || null,
      sizeBytes: buf.length, sha256: sha256(buf), bytesStored: false
    };
    cache.set(uri, pin);
    return pin;
  };
}

// ---------- translation analysis + quality gate ----------

export function analyzeTranslation(md) {
  const lines = toLf(md).split('\n').filter(l => l.trim());
  const titleIndex = lines.findIndex(l => l.startsWith('# '));
  const title = lines[titleIndex];
  const headings = lines.filter((l, i) => HEADING_LINE.test(l) && i !== titleIndex);
  const images = lines.filter(l => IMAGE_LINE.test(l)).map(l => IMAGE_LINE.exec(l)[2]);
  const listItems = lines.filter(l => LIST_LINE.test(l)).length;
  const links = [...toLf(md).matchAll(/(?<!!)\[[^\]]+\]\(([^)]+)\)/g)].map(m => m[1]);
  const footer = lines.filter(l => l.startsWith(LICENSE_FOOTER_PREFIX));
  const paragraphs = lines.filter(l => !HEADING_LINE.test(l) && !IMAGE_LINE.test(l) && !LIST_LINE.test(l) &&
    !l.startsWith(LICENSE_FOOTER_PREFIX) && !LIGHTBOX_LINKS.test(l)).length;
  return { title, headings, images, listItems, links, footer, paragraphs, lines };
}

const CJK = /[㐀-鿿]/;
// The optional pair is an image affordance added by the translator, with no prose equivalent.
const LIGHTBOX_LINKS = /^\[原圖\]\([^)]+\) · \[下載原圖\]\([^)]+\)$/;
const SINGLE_LINK = /^\[([^\]]+)\]\(([^)]+)\)$/;
const TEAM_SIGNOFF = /^——Darktide 團隊$/;

function embedDestination(uri) {
  return normalizeUrl(uri).replace(/^store\.steampowered\.com\/widget\/(\d+)$/, 'store.steampowered.com/app/$1');
}

export async function loadTermRules(root) {
  return JSON.parse(await readFile(path.join(root, ANNOUNCEMENT_ROOT, 'term-rules.json'), 'utf8'));
}

// Returns { errors, warnings } for one article.
export function checkArticle({ cooked, md, post, termRules }) {
  const errors = [], warnings = [];
  const src = analyzeSource(cooked);
  const tr = analyzeTranslation(md);
  if (!tr.title) errors.push('missing "# " title line');
  else if (!CJK.test(tr.title)) errors.push('title is not translated');
  // Markdown reserves level 1 for the article title. Compare body headings after shifting down one level.
  const levels = tr.headings.map(l => HEADING_LINE.exec(l)[1].length);
  if (levels.length !== src.headings.length) errors.push(`heading count ${levels.length} != source ${src.headings.length}`);
  else if (levels.some((level, i) => level !== Math.min(src.headingLevels[i] + 1, 4))) errors.push('heading levels differ from source');
  if (tr.images.length !== src.images.length) errors.push(`image count ${tr.images.length} != source ${src.images.length}`);
  else if (tr.images.some((uri, i) => uri !== src.images[i])) errors.push('image occurrences differ from source order');
  const srcImages = new Set(src.images);
  for (const uri of tr.images) if (!srcImages.has(uri)) errors.push(`image not in source: ${uri}`);
  const embeds = new Set([...src.oneboxes, ...src.widgets].map(embedDestination));
  // A card becomes a plain link or a link-only bullet. Neither creates source prose or a list item.
  const cardBullets = tr.lines.filter(l => LIST_LINE.test(l) && embeds.has(embedDestination(SINGLE_LINK.exec(l.slice(2))?.[2] ?? ''))).length;
  // The single-item team signature is sometimes translated as a conventional dash sign-off.
  const signoffs = src.listSignoff ? tr.lines.filter(l => TEAM_SIGNOFF.test(l)).length : 0;
  const listItems = tr.listItems - cardBullets + signoffs;
  if (listItems !== src.listItems) errors.push(`list item count ${listItems} != source ${src.listItems}`);
  const trLinks = new Set(tr.links.map(normalizeUrl));
  for (const href of src.links) if (!trLinks.has(normalizeUrl(href))) errors.push(`source link missing: ${href}`);
  for (const v of src.videos) if (!trLinks.has(v)) errors.push(`video link missing: ${v}`);
  for (const o of src.oneboxes) if (!trLinks.has(normalizeUrl(o))) errors.push(`onebox link missing: ${o}`);
  // The legacy announcement leaves out interactive Steam widgets. Report their
  // absence without treating generated widget chrome as authored hyperlinks.
  for (const w of src.widgets) if (!trLinks.has(embedDestination(w))) warnings.push(`embedded widget dropped: ${w}`);
  const auxiliaryLinks = tr.lines.filter(l => {
    const link = SINGLE_LINK.exec(l);
    if (!link) return false;
    const uri = normalizeUrl(link[2]);
    return embeds.has(uri) || src.embeddedVideos.includes(uri);
  }).length;
  const paragraphs = tr.paragraphs - auxiliaryLinks - signoffs;
  const diff = Math.abs(paragraphs - src.paragraphs);
  if (diff > Math.max(1, Math.round(src.paragraphs * 0.15))) errors.push(`paragraph count ${paragraphs} differs from source ${src.paragraphs}`);
  else if (diff) warnings.push(`paragraph count ${paragraphs} vs source ${src.paragraphs}`);
  if (tr.footer.length !== 1) errors.push('exactly one license footer line is required');
  else {
    const f = tr.footer[0];
    if (post && !f.startsWith(`${LICENSE_FOOTER_PREFIX}原文作者 ${post.author}，`)) errors.push(`license footer must name the author ${post.author}`);
    if (post && !f.includes(`首帖發布於 ${post.createdAt.slice(0, 10)}`)) errors.push(`license footer must carry the publication date ${post.createdAt.slice(0, 10)}`);
    if (!parseInline(f).some(part => part.kind === 'link' && part.href === LICENSE.licenseUrl)) errors.push('license footer must link CC BY-NC-SA 3.0');
  }
  for (const l of tr.lines) {
    if (/<\/?[a-z][\w:-]*(?=[\s/>])[^>]*>|<!--|<!doctype\b/i.test(l)) errors.push(`raw HTML line: ${l.slice(0, 60)}`);
    if (IMAGE_LINE.test(l)) continue;
    const inline = parseInline(l.replace(/^(?:#{1,4} |[- >] )/, ''));
    if (hasLeftoverMarkdown(inline)) errors.push(`unparsed Markdown markers: ${l.slice(0, 60)}`);
    const prose = plain(inline);
    const latinWords = (prose.match(/\b[A-Za-z]+\b/g) ?? []).length;
    if (!CJK.test(prose) && latinWords >= 2) errors.push(`untranslated line: ${l.slice(0, 80)}`);
  }
  const body = tr.lines.filter(l => !IMAGE_LINE.test(l) && !l.startsWith(LICENSE_FOOTER_PREFIX)).map(l => plain(parseInline(l))).join('\n');
  const headingPairs = [[post?.title ?? '', tr.title], ...src.headings.map((heading, i) => [heading, tr.headings[i]])];
  for (const rule of termRules.required ?? []) {
    const sourceText = `${post?.title ?? ''}\n${src.text}`;
    const sourceCount = [...sourceText.matchAll(new RegExp(rule.source, 'g'))].length;
    const escapedZh = rule.zh.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const zhCount = [...body.matchAll(new RegExp(escapedZh, 'g'))].length;
    if (sourceCount && zhCount === 0) {
      errors.push(`term "${rule.en}" must be rendered as ${rule.zh}`);
    } else if (zhCount < sourceCount) {
      errors.push(`term "${rule.en}" has ${sourceCount} source occurrences but only ${zhCount} occurrences of ${rule.zh}`);
    } else if (levels.length === src.headings.length &&
        headingPairs.some(([source, translated]) => translated && new RegExp(rule.source).test(source) && !plain(parseInline(translated)).includes(rule.zh))) {
      errors.push(`term "${rule.en}" in title or heading must be rendered as ${rule.zh}`);
    }
  }
  for (const rule of termRules.forbidden ?? []) {
    if (new RegExp(rule.pattern, rule.flags ?? '').test(body)) errors.push(`forbidden wording /${rule.pattern}/: ${rule.reason}`);
  }
  return { errors, warnings };
}

// Articles of a batch: from batch-plan.json (automated batches) or source-intake.json (earlier manual batch).
export async function batchArticles(batchDir) {
  const plan = path.join(batchDir, 'batch-plan.json');
  if (await exists(plan)) return JSON.parse(await readFile(plan, 'utf8')).articles;
  const intake = JSON.parse(await readFile(path.join(batchDir, 'source-intake.json'), 'utf8'));
  return (intake.articles ?? intake.announcements).map(a => ({
    topicId: a.topicId, translation: a.translation ?? a.translationSnapshot.path, announcementId: a.announcementId
  }));
}

export async function checkBatch(root, batchDir, rulesRoot = root) {
  const termRules = await loadTermRules(rulesRoot);
  const manifestText = await readLf(path.join(batchDir, 'source-snapshots/source-manifest.json'));
  const manifest = JSON.parse(manifestText);
  const articles = await batchArticles(batchDir);
  if (!articles.length || articles.length !== manifest.posts.length ||
      new Set(articles.map(a => a.topicId)).size !== articles.length ||
      new Set(articles.map(a => a.translation)).size !== articles.length) {
    throw new Error('batch must cover every captured post exactly once with distinct records and translations');
  }
  const automated = await exists(path.join(batchDir, 'batch-plan.json'));
  const recordsFile = path.join(batchDir, 'announcements.json');
  const intakeFile = path.join(batchDir, 'source-intake.json');
  const generated = automated && await exists(recordsFile) && await exists(intakeFile);
  const records = generated ? JSON.parse(await readLf(recordsFile)).announcements : null;
  const intake = generated ? JSON.parse(await readLf(intakeFile)) : null;
  const pins = new Map(intake?.imageVerification.pins.map(p => [p.sourceUri, p]));
  if (automated && new Set(articles.map(a => a.announcementId)).size !== articles.length) {
    throw new Error('batch must use a distinct announcement ID for each topic');
  }
  if (generated && (records.length !== articles.length || intake.articles.length !== articles.length ||
      intake.sourceCaptureManifest.sha256 !== sha256(manifestText))) {
    throw new Error('generated batch metadata differs from its captured inputs; run build');
  }
  const results = [];
  for (const [index, a] of articles.entries()) {
    const post = manifest.posts.find(p => p.topicId === a.topicId);
    if (!post) { results.push({ topicId: a.topicId, errors: ['topic missing from source-manifest.json'], warnings: [] }); continue; }
    if (!/^translations\/[\w.-]+\.md$/.test(a.translation) || post.bodyFile !== `${a.topicId}.first-post.html`) {
      throw new Error(`topic ${a.topicId}: invalid snapshot or translation path`);
    }
    const cooked = await readLf(path.join(batchDir, 'source-snapshots', post.bodyFile));
    const mdPath = path.join(batchDir, a.translation);
    if (!(await exists(mdPath))) { results.push({ topicId: a.topicId, errors: [`translation missing: ${a.translation}`], warnings: [] }); continue; }
    const md = await readLf(mdPath);
    const result = checkArticle({ cooked, md, post, termRules });
    if (automated) {
      if (sha256(cooked) !== post.bodySha256 || Buffer.byteLength(cooked) !== post.bodyByteLength) {
        result.errors.push('snapshot does not match the manifest hash and length');
      }
      // Keep article diagnostics available even if an invalid translation blocked build.
      if (generated && intake.articles[index].translationSha256 !== sha256(md)) result.errors.push('translation hash differs; run build');
      if (!result.errors.length) {
        try {
          if (!generated) throw new Error('generated batch files are missing; run build');
          const pin = uri => {
            const p = pins.get(uri);
            if (!p || !/^image\//.test(p.mediaType) || !/^[a-f0-9]{64}$/.test(p.sha256) ||
                !Number.isSafeInteger(p.sizeBytes) || p.sizeBytes <= 0) throw new Error(`invalid image pin: ${uri}`);
            return p;
          };
          const converted = await markdownToRecord(md, { ...a, pin });
          if (!isDeepStrictEqual(records[index], announcementRecord(a, post, converted))) {
            result.errors.push('generated record differs from the translation, manifest or image pins; run build');
          }
        } catch (error) { result.errors.push(error.message); }
      }
    }
    results.push({ topicId: a.topicId, translation: a.translation, ...result });
  }
  return results;
}

// ---------- capture / build ----------

export function slugify(title) {
  return title.normalize('NFKD').toLowerCase().replace(/[\p{M}'’]/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
}

export async function capture({ root, batch, topics, outlineDir, fetchImpl = fetch }) {
  if (!/^\d{8}$/.test(batch)) throw new Error('--batch YYYYMMDD is required');
  if (!topics.length || new Set(topics).size !== topics.length || topics.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('capture needs distinct positive topic IDs');
  }
  const batchDir = path.join(root, ANNOUNCEMENT_ROOT, batch);
  if (await exists(batchDir)) throw new Error(`batch directory already exists: ${batchDir}`);
  const captured = [];
  for (const id of topics) {
    const topic = await fetchTopic(id, fetchImpl);
    if (topic.category_id !== CATEGORY_ID) throw new Error(`topic ${id} is not in category ${CATEGORY_ID}`);
    if (topic.post_stream.posts[0]?.post_number !== 1) throw new Error(`topic ${id}: first post missing`);
    captured.push({ id, topic });
  }
  await mkdir(path.dirname(batchDir), { recursive: true });
  await mkdir(batchDir);
  await mkdir(path.join(batchDir, 'source-snapshots'), { recursive: true });
  await mkdir(path.join(batchDir, 'translations'), { recursive: true });
  if (outlineDir) await mkdir(outlineDir, { recursive: true });
  const posts = [], articles = [];
  for (const { id, topic } of captured) {
    const p = topic.post_stream.posts[0];
    const body = Buffer.from(toLf(p.cooked), 'utf8');
    const bodyFile = `${id}.first-post.html`;
    await writeFile(path.join(batchDir, 'source-snapshots', bodyFile), body);
    posts.push({
      topicId: id, postId: p.id, postNumber: p.post_number, title: topic.title, author: p.username,
      createdAt: p.created_at, updatedAt: p.updated_at, version: p.version,
      url: `${FORUM_ORIGIN}/t/${topic.slug}/${id}`, bodyFile, bodyByteLength: body.length, bodySha256: sha256(body),
      capturedAt: new Date().toISOString(), license: LICENSE
    });
    const date = p.created_at.slice(0, 10);
    const slug = `${date}-${slugify(topic.title)}`;
    articles.push({ topicId: id, slug, announcementId: `official:darktide:announcement:${slug}`, translation: `translations/${slug}.md` });
    if (outlineDir) await writeFile(path.join(outlineDir, `outline-${id}.md`), sourceOutline(topic));
  }
  const manifest = { schema: 'official-announcement-first-post-capture/1', posts };
  await writeFile(path.join(batchDir, 'source-snapshots', 'source-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(path.join(batchDir, 'batch-plan.json'), JSON.stringify({ schema: 'official-announcement-batch-plan/1', batchId: `official-announcements-${batch}`, articles }, null, 2) + '\n');
  return { batchDir, articles };
}

const readLf = async file => toLf(await readFile(file, 'utf8'));

function announcementRecord(article, post, { title, blocks, assets }) {
  return {
    announcementId: article.announcementId, scope: 'official-document', title, publishedOn: post.createdAt.slice(0, 10), revision: 1,
    source: { kind: 'official-game-source', locator: post.url, sha256: post.bodySha256 }, blocks, assets
  };
}

export async function build({ root, batch, pin = makeImagePinner() }) {
  if (!/^\d{8}$/.test(batch)) throw new Error('--batch YYYYMMDD is required');
  const batchDir = path.join(root, ANNOUNCEMENT_ROOT, batch);
  const manifestBuf = Buffer.from(toLf(await readFile(path.join(batchDir, 'source-snapshots/source-manifest.json'), 'utf8')), 'utf8');
  const manifest = JSON.parse(manifestBuf);
  const plan = JSON.parse(await readFile(path.join(batchDir, 'batch-plan.json'), 'utf8'));
  const records = [], intake = [], pins = new Map();
  let occurrences = 0;
  const recordingPin = async uri => { const p = await pin(uri); pins.set(uri, p); return p; };
  for (const a of plan.articles) {
    const md = toLf(await readFile(path.join(batchDir, a.translation), 'utf8'));
    const post = manifest.posts.find(p => p.topicId === a.topicId);
    const { title, blocks, assets } = await markdownToRecord(md, { announcementId: a.announcementId, topicId: a.topicId, pin: recordingPin });
    const imageOccurrences = blocks.filter(b => b.kind === 'image').length;
    occurrences += imageOccurrences;
    records.push(announcementRecord(a, post, { title, blocks, assets }));
    intake.push({
      announcementId: a.announcementId, topicId: a.topicId, sourceUrl: post.url, sourceSnapshot: `source-snapshots/${post.bodyFile}`,
      sourceSha256: post.bodySha256, translation: a.translation, translationSha256: sha256(Buffer.from(md, 'utf8')), imageOccurrences
    });
  }
  const batchDoc = {
    schemaVersion: '1.0.0', contractKind: 'official-announcement-record-batch/1', fixtureOnly: false,
    candidateOnly: true, publicationEligible: false, reviewState: 'pending', approvalReceipts: [], announcements: records
  };
  await writeFile(path.join(batchDir, 'announcements.json'), JSON.stringify(batchDoc, null, 2) + '\n');
  const intakeDoc = {
    schema: 'official-announcement-content-intake/1', batchId: plan.batchId,
    scope: 'Official first posts only; no replies or forum list last-reply dates are used as publication facts.',
    sourceCaptureManifest: { path: 'source-snapshots/source-manifest.json', sha256: sha256(manifestBuf), sourceSchema: manifest.schema },
    licensePolicy: 'CC-BY-NC-SA-3.0 applies to the respective forum contributions only; it is not a repository-wide license or a blanket license to game trademarks. Each translated article carries author, source link, publication date, license, and translation/adaptation notice.',
    imageVerification: { method: 'ordinary HTTPS GET; response bytes hashed in memory; no binaries written', uniqueCount: pins.size, occurrenceCount: occurrences, bytesStored: false, pins: [...pins.values()] },
    videoPolicy: 'YouTube embeds and Steam store cards are kept as plain links; no remote players are embedded.',
    articles: intake
  };
  await writeFile(path.join(batchDir, 'source-intake.json'), JSON.stringify(intakeDoc, null, 2) + '\n');
  return records;
}

// ---------- CLI ----------

function parseArgs(argv) {
  const [command, ...rest] = argv; const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const k = rest[i];
    if (!k.startsWith('--')) throw new Error(`unexpected argument ${k}`);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) opts[k.slice(2)] = true; else { opts[k.slice(2)] = next; i++; }
  }
  return { command, opts };
}

async function githubOutput(opts, values) {
  const file = opts['github-output'] === true ? process.env.GITHUB_OUTPUT : opts['github-output'];
  if (!file) return;
  await appendFile(file, Object.entries(values).map(([k, v]) => `${k}=${v}\n`).join(''));
}

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));
  const root = path.resolve(opts.root ?? '.');
  if (command === 'scan') {
    const policy = await readPolicy(root);
    const [topics, known] = await Promise.all([fetchCategoryTopics(undefined, policy.baselineCreatedAt), knownTopicIds(root)]);
    const fresh = selectNewTopics(topics, known, policy);
    const staleHours = opts['stale-hours'] ? Number(opts['stale-hours']) : null;
    const stale = staleHours === null ? [] : fresh.filter(t => Date.now() - Date.parse(t.createdAt) > staleHours * 3600e3);
    const result = { newCount: fresh.length, topics: fresh, staleCount: stale.length, stale };
    await githubOutput(opts, { new_count: fresh.length, stale_count: stale.length, topic_ids: fresh.map(t => t.id).join(','),
      stale_topics: JSON.stringify(stale.map(({ id, createdAt }) => ({ id, createdAt }))) });
    console.log(opts.json ? JSON.stringify(result, null, 2) : (fresh.length ? fresh.map(t => `${t.id}\t${t.createdAt}\t${t.title}`).join('\n') : 'No new announcements.'));
    return;
  }
  if (command === 'capture') {
    if (!/^\d{8}$/.test(opts.batch ?? '')) throw new Error('--batch YYYYMMDD is required');
    let ids = typeof opts.topics === 'string' ? opts.topics.split(',').map(Number) : null;
    if (!ids) {
      const policy = await readPolicy(root);
      ids = selectNewTopics(await fetchCategoryTopics(undefined, policy.baselineCreatedAt), await knownTopicIds(root), policy).map(t => t.id);
    }
    if (!ids.length) { console.log('No new announcements; nothing captured.'); return; }
    const { articles } = await capture({ root, batch: opts.batch, topics: ids, outlineDir: typeof opts['outline-dir'] === 'string' ? opts['outline-dir'] : null });
    console.log(articles.map(a => `${a.topicId}\t${a.translation}`).join('\n'));
    return;
  }
  if (command === 'build') {
    const records = await build({ root, batch: opts.batch });
    console.log(records.map(r => `${r.publishedOn} ${r.title} blocks=${r.blocks.length} assets=${r.assets.length}`).join('\n'));
    return;
  }
  if (command === 'check') {
    if (opts.batch !== undefined && !/^\d{8}$/.test(opts.batch)) throw new Error('--batch must be YYYYMMDD');
    const batches = typeof opts.batch === 'string' ? [opts.batch] : await listBatchDirs(root);
    const rulesRoot = fileURLToPath(new URL('../../', import.meta.url));
    const policy = await readPolicy(rulesRoot);
    let failed = false;
    for (const batch of batches) {
      const exemption = policy.checkExemptBatches?.find(entry => entry.batch === batch);
      if (exemption && opts.batch === undefined) {
        console.log(`SKIP  ${batch}: ${exemption.reason}`);
        continue;
      }
      const dir = path.join(root, ANNOUNCEMENT_ROOT, batch);
      for (const r of await checkBatch(root, dir, rulesRoot)) {
        for (const w of r.warnings) console.log(`WARN  ${batch}/${r.topicId}: ${w}`);
        for (const e of r.errors) { console.log(`ERROR ${batch}/${r.topicId}: ${e}`); failed = true; }
        if (!r.errors.length) console.log(`OK    ${batch}/${r.topicId} ${r.translation ?? ''}`);
      }
    }
    if (failed) process.exitCode = 1;
    return;
  }
  throw new Error('usage: announcements-intake.mjs scan|capture|build|check [--root dir] [--batch YYYYMMDD] [--topics id,id] [--outline-dir dir] [--json] [--stale-hours N] [--github-output [file]]');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err.message); process.exitCode = 1; });
}
