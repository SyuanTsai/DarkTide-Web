import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANNOUNCEMENT_ROOT, FORUM_ORIGIN, LICENSE_FOOTER_PREFIX, build, capture, checkArticle, checkBatch,
  fetchCategoryTopics, knownTopicIds, listBatchDirs, loadTermRules, markdownToRecord, readPolicy,
  renderTranslationPrompt, selectNewTopics, slugify, sourceOutline, toLf, writeBatchReadme
} from '../scripts/content/announcements-intake.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const batch = '20261125';
const goldenDir = path.join(root, ANNOUNCEMENT_ROOT, batch);
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const manifest = await readJson(path.join(goldenDir, 'source-snapshots/source-manifest.json'));
const intake = await readJson(path.join(goldenDir, 'source-intake.json'));
const termRules = await loadTermRules(root);

async function tempRoot(t) {
  const directory = await mkdtemp(path.join(root, '.announcement-intake-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

const categoryTopic = (id, createdAt, overrides = {}) => ({
  id, title: `Topic ${id}`, slug: `topic-${id}`, created_at: createdAt, category_id: 70,
  pinned: false, visible: true, ...overrides
});

// Scenario: The newest page contains no eligible topic, while page two contains a topic after the policy baseline.
// Purpose: protect manual backlog discovery when an eligible topic has moved beyond the first Discourse page.
test('UnitT10_fetchCategoryTopics_follows_pagination_to_find_a_backlog_topic', async () => {
  const policy = await readPolicy(root);
  const pages = new Map([
    [`${FORUM_ORIGIN}/c/70/l/latest.json`, {
      topic_list: { topics: [categoryTopic(1, '2026-11-25T00:00:00Z')],
        more_topics_url: '/c/darktide/darktide-announcements/70/l/latest?page=1' }
    }],
    [`${FORUM_ORIGIN}/c/darktide/darktide-announcements/70/l/latest.json?page=1`, {
      topic_list: { topics: [categoryTopic(2, '2026-11-20T00:00:00Z')] }
    }]
  ]);
  const requests = [];
  const topics = await fetchCategoryTopics(async input => {
    requests.push(input);
    assert.ok(pages.has(input), input);
    return { status: 200, json: async () => pages.get(input) };
  });
  assert.deepEqual(requests, [...pages.keys()]);
  assert.deepEqual(selectNewTopics(topics, new Set([1]), policy).map(topic => topic.id), [2]);
});

// Scenario: Every non-pinned topic on the first page is at or before the supplied policy baseline.
// Purpose: keep normal scheduled scans to one request once pagination has reached ineligible history.
test('UnitT20_fetchCategoryTopics_stops_at_the_policy_baseline', async () => {
  let requests = 0;
  const topics = await fetchCategoryTopics(async () => {
    requests++;
    return { status: 200, json: async () => ({ topic_list: {
      topics: [categoryTopic(3, '2026-11-19T16:17:33.781Z'), categoryTopic(4, '2026-11-18T00:00:00Z')],
      more_topics_url: '/c/70/l/latest?page=1'
    } }) };
  }, '2026-11-19T16:17:33.781Z');
  assert.equal(requests, 1);
  assert.deepEqual(topics.map(topic => topic.id), [3, 4]);
});

// Scenario: Discourse repeats a topic at the page boundary.
// Purpose: prevent duplicate topic IDs from propagating into selection and capture.
test('UnitT30_fetchCategoryTopics_deduplicates_topics_by_id', async () => {
  const pages = [
    { topic_list: { topics: [categoryTopic(5, '2026-11-25T00:00:00Z')], more_topics_url: '/c/70/l/latest?page=1' } },
    { topic_list: { topics: [categoryTopic(5, '2026-11-25T00:00:00Z'), categoryTopic(6, '2026-11-24T00:00:00Z')] } }
  ];
  const topics = await fetchCategoryTopics(async () => ({ status: 200, json: async () => pages.shift() }));
  assert.deepEqual(topics.map(topic => topic.id), [5, 6]);
});

// Scenario: A category response supplies an absolute pagination URL on another origin.
// Purpose: prevent forum-controlled pagination from turning the intake fetch into a cross-origin request.
test('UnitT40_fetchCategoryTopics_rejects_cross_origin_pagination', async () => {
  await assert.rejects(fetchCategoryTopics(async () => ({ status: 200, json: async () => ({ topic_list: {
    topics: [categoryTopic(7, '2026-11-25T00:00:00Z')],
    more_topics_url: 'https://example.test/c/70/l/latest?page=1'
  } }) })), /same origin/i);
});

test('selects only new visible unpinned category 70 topics, oldest first', async () => {
  const policy = { ...await readPolicy(root), ignoredTopicIds: [7] };
  const entry = (id, overrides = {}) => ({
    id, categoryId: 70, visible: true, pinned: false, createdAt: '2026-11-21T00:00:00Z', ...overrides
  });
  const topics = [entry(1), entry(2, { createdAt: policy.baselineCreatedAt }), entry(3), entry(4, { pinned: true }),
    entry(5, { visible: false }), entry(6, { categoryId: 71 }), entry(7),
    entry(8, { createdAt: '2026-11-20T00:00:00Z' }), entry(9, { createdAt: '2026-11-19T16:17:33.780Z' }),
    entry(10, { createdAt: '2026-11-19T16:17:33.782Z' })];
  assert.deepEqual(selectNewTopics(topics, new Set([3]), policy).map(t => t.id), [10, 8, 1]);
});

test('recognizes published topic IDs and lists only dated directories', async () => {
  const ids = await knownTopicIds(root);
  assert.ok(ids.has(121374));
  assert.ok(ids.has(127701));
  const batches = await listBatchDirs(root);
  assert.ok(batches.includes(batch));
  assert.ok(batches.every(name => /^\d{8}$/.test(name)));
});

test('the six 20261125 translations pass the gate', async () => {
  const results = await checkBatch(root, goldenDir);
  assert.equal(results.length, 6);
  assert.deepEqual(results.flatMap(r => r.errors), []);
});

async function article(topicId) {
  const post = manifest.posts.find(p => p.topicId === topicId);
  const { translation } = intake.articles.find(a => a.topicId === topicId);
  return { post, termRules,
    cooked: await readFile(path.join(goldenDir, 'source-snapshots', post.bodyFile), 'utf8'),
    md: toLf(await readFile(path.join(goldenDir, translation), 'utf8')) };
}

const mutations = [
  ['removed image', 127701, md => md.replace(/^!\[.*\n/m, ''), /image count/],
  ['foreign image', 127701, md => md.replace(/^(!\[[^\]]*\]\()[^)]*/m, '$1https://example.test/image.png'), /image not in source/],
  ['removed heading', 127701, md => md.replace(/^## .*\n/m, ''), /heading count/],
  ['removed ordered source item', 127701, md => md.replace(/^- 突擊鏈鋸劍\n/m, ''), /list item count/],
  ['removed unordered source sign-off', 127701, md => md.replace(/^——Darktide 團隊\n/m, ''), /list item count/],
  ['removed source hyperlink', 127701, md => md.replace(/\[([^\]]+)\]\(https:\/\/forums\.fatsharkgames\.com\/t\/[^)]+\)/, '$1'), /source link missing/],
  ['removed YouTube iframe link', 127339, md => md.replace(/^\[.*youtube.*\n/m, ''), /video link missing/],
  ['removed lazy YouTube link', 127701, md => md.replace(/^\[.*yY1Aa7um_bM.*\n/m, ''), /video link missing/],
  ['untranslated paragraph', 127190, md => md.replace(/(?<=\n\n)[^#!/[\n][^\n]+/, 'Stay tuned.'), /untranslated line/],
  ['missing footer', 127190, md => md.slice(0, md.indexOf(LICENSE_FOOTER_PREFIX)), /exactly one license footer/],
  ['duplicate footer', 127190, md => md + md.slice(md.indexOf(LICENSE_FOOTER_PREFIX)), /exactly one license footer/],
  ['missing author', 127190, md => md.replace('FatsharkQuickpaw', ''), /footer must name the author/],
  ['missing date', 127190, md => md.replace('首帖發布於 2026-11-05', ''), /footer must carry the publication date/],
  ['missing license link', 127190, md => md.replace(/\[CC BY-NC-SA 3\.0\]\([^)]+\)/, 'CC BY-NC-SA 3.0'), /footer must link/],
  ['incorrect required term', 127190, md => md.replaceAll('打擊小隊', '打擊部隊'), /Warband.*打擊小隊/],
  ['incorrect required title term with another correct instance', 127190, md => md.replace('# 遠征', '# 探險'), /Expeditions.*title or heading/],
  ['forbidden wording', 127190, md => md.replace('打擊小隊', '戰幫'), /forbidden wording/],
  ['inline raw HTML', 127190, md => md.replace('打擊小隊', '<em>打擊小隊</em>'), /raw HTML/],
  ['leftover Markdown', 127190, md => md.replace('打擊小隊', '**打擊小隊'), /unparsed Markdown markers/]
];

for (const [name, topicId, mutate, expected] of mutations) {
  test(`rejects ${name}`, async () => {
    const input = await article(topicId);
    const md = mutate(input.md);
    assert.notEqual(md, input.md, 'mutation must change the golden translation');
    assert.match(checkArticle({ ...input, md }).errors.join('\n'), expected);
  });
}

// Scenario: Topic 127190 keeps the correct Warband heading but mistranslates the second body occurrence.
// Purpose: catch partial required-term coverage that the former at-least-once check allowed.
test('UnitT50_checkArticle_rejects_a_partially_translated_required_term', async () => {
  const input = await article(127190);
  const md = input.md.replace('除了打擊小隊中最強悍的成員之外', '除了普通隊伍中最強悍的成員之外');
  assert.notEqual(md, input.md, 'mutation must change the golden translation');
  assert.match(checkArticle({ ...input, md }).errors.join('\n'), /Warband.*2.*1|Warband.*occurrence/i);
});

// Scenario: A translated Markdown link uses a forum-relative URL.
// Purpose: reject output which the site link checker cannot consume before generated files reach it.
test('UnitT55_checkArticle_rejects_a_relative_markdown_link', async () => {
  const input = await article(127190);
  const md = `${input.md}\n[相對連結](/uploads/short-url/example.jpeg?dl=1)\n`;
  assert.match(checkArticle({ ...input, md }).errors.join('\n'),
    /link must be absolute https: \/uploads\/short-url\/example\.jpeg\?dl=1/);
});

// Scenario: The source first post links to a forum-relative path and its translation uses the resolved HTTPS URL.
// Purpose: preserve source-link matching while requiring publishable translation URLs.
test('UnitT60_checkArticle_matches_a_resolved_forum_relative_source_link', () => {
  const result = checkArticle({
    cooked: '<p><a href="/uploads/short-url/example.jpeg?dl=1">來源</a></p>',
    md: '# 測試\n\n[連結](https://forums.fatsharkgames.com/uploads/short-url/example.jpeg?dl=1)\n',
    termRules: { required: [], forbidden: [] }
  });
  assert.ok(!result.errors.some(error => error.startsWith('source link missing:')),
    result.errors.join('\n'));
});

// Scenario: A captured first post contains a forum-relative anchor.
// Purpose: give translators a directly reusable absolute URL instead of a path that later fails validation.
test('UnitT70_sourceOutline_resolves_a_forum_relative_href', () => {
  const outline = sourceOutline({ id: 1, slug: 'test', title: 'Test', post_stream: { posts: [{
    username: 'author', created_at: '2026-11-25T00:00:00Z',
    cooked: '<p><a href="/uploads/short-url/example.jpeg?dl=1">source</a></p>'
  }] } });
  assert.match(outline, /\[source\]\(https:\/\/forums\.fatsharkgames\.com\/uploads\/short-url\/example\.jpeg\?dl=1\)/);
});

test('build rejects leftover Markdown instead of emitting it into blocks', async () => {
  await assert.rejects(markdownToRecord('# 標題\n\n這是 **未關閉的標記\n', {
    announcementId: 'test', topicId: 1, pin: () => assert.fail('unexpected pin')
  }), /unparsed Markdown markers/);
});

test('build reproduces all committed 20261125 records with the recorded image pins', async t => {
  const fixtureRoot = await tempRoot(t);
  const dir = path.join(fixtureRoot, ANNOUNCEMENT_ROOT, batch);
  await mkdir(dir, { recursive: true });
  await cp(path.join(goldenDir, 'translations'), path.join(dir, 'translations'), { recursive: true });
  await cp(path.join(goldenDir, 'source-snapshots'), path.join(dir, 'source-snapshots'), { recursive: true });
  const articles = intake.articles.map(({ topicId, announcementId, translation }) => ({ topicId, announcementId, translation }));
  await writeFile(path.join(dir, 'batch-plan.json'), JSON.stringify({ batchId: intake.batchId, articles }));
  const pins = new Map(intake.imageVerification.pins.map(p => [p.sourceUri, p]));
  const records = await build({ root: fixtureRoot, batch, pin: uri => {
    assert.ok(pins.has(uri), uri);
    return pins.get(uri);
  } });
  const generated = await readJson(path.join(dir, 'announcements.json'));
  const committed = await readJson(path.join(goldenDir, 'announcements.json'));
  assert.deepEqual(records, committed.announcements);
  assert.deepEqual(generated.announcements, committed.announcements);
  const generatedIntake = await readJson(path.join(dir, 'source-intake.json'));
  assert.equal(generatedIntake.sourceCaptureManifest.sha256, intake.sourceCaptureManifest.sha256);
  assert.deepEqual(generatedIntake.articles, intake.articles);
  assert.deepEqual((await checkBatch(fixtureRoot, dir, root)).flatMap(r => r.errors), []);
  generated.announcements[0].title = '改過的標題';
  await writeFile(path.join(dir, 'announcements.json'), JSON.stringify(generated));
  assert.match((await checkBatch(fixtureRoot, dir, root))[0].errors.join('\n'), /generated record differs/);
  await rm(path.join(dir, 'announcements.json'));
  const firstTranslation = path.join(dir, articles[0].translation);
  const original = await readFile(firstTranslation, 'utf8');
  await writeFile(firstTranslation, original.replace('打擊小隊', '**打擊小隊'));
  const failedBuildResults = await checkBatch(fixtureRoot, dir, root);
  assert.match(failedBuildResults[0].errors.join('\n'), /unparsed Markdown markers/);
  assert.match(failedBuildResults[1].errors.join('\n'), /generated batch files are missing/);
});

test('capture uses injected fetch, pins LF snapshot bytes, and refuses to overwrite', async t => {
  const fixtureRoot = await tempRoot(t);
  const createdAt = '2026-11-25T09:00:00Z';
  const url = `${FORUM_ORIGIN}/t/987654.json`;
  const html = '<p>First line</p>\r\n<p>Second line</p>\r\n';
  const topic = { id: 987654, slug: 'test-title', title: 'Test Title!', category_id: 70,
    post_stream: { posts: [{ id: 1, post_number: 1, username: 'test-user', created_at: createdAt,
      updated_at: createdAt, version: 1, cooked: html }] } };
  let requests = 0;
  const args = { root: fixtureRoot, batch, topics: [topic.id], fetchImpl: async input => {
    requests++;
    assert.equal(input, url);
    return { status: 200, json: async () => topic };
  } };
  const { batchDir, articles } = await capture(args);
  const snapshots = path.join(batchDir, 'source-snapshots');
  const bytes = await readFile(path.join(snapshots, '987654.first-post.html'));
  assert.deepEqual(bytes, Buffer.from('<p>First line</p>\n<p>Second line</p>\n'));
  const captureManifest = await readJson(path.join(snapshots, 'source-manifest.json'));
  assert.equal(captureManifest.posts[0].bodySha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(captureManifest.posts[0].bodyByteLength, bytes.length);
  assert.equal(captureManifest.posts[0].url, `${FORUM_ORIGIN}/t/test-title/987654`);
  const planFile = path.join(batchDir, 'batch-plan.json');
  assert.deepEqual(await readJson(planFile), {
    schema: 'official-announcement-batch-plan/1', batchId: `official-announcements-${batch}`,
    articles: [{ topicId: topic.id, slug: '2026-11-25-test-title', announcementId: 'official:darktide:announcement:2026-11-25-test-title',
      translation: 'translations/2026-11-25-test-title.md' }]
  });
  assert.deepEqual((await readJson(planFile)).articles, articles);
  for (const file of [planFile, path.join(snapshots, 'source-manifest.json')]) {
    const json = await readFile(file, 'utf8');
    assert.ok(json.endsWith('\n'));
    assert.ok(!json.includes('\r'));
  }
  await assert.rejects(capture(args), /batch directory already exists/);
  assert.equal(requests, 1);
});

// Scenario: A captured batch is rendered with caller-supplied Linux paths and gate errors for a repair round.
// Purpose: keep the cloud translator prompt byte-compatible with the local runner's placeholder contract.
test('UnitT80_renderTranslationPrompt_replaces_every_placeholder_from_the_captured_batch', async t => {
  const fixtureRoot = await tempRoot(t);
  const topic = { id: 987655, slug: 'prompt-title', title: 'Prompt Title\nOne Line', category_id: 70,
    post_stream: { posts: [{ id: 2, post_number: 1, username: 'prompt-author',
      created_at: '2026-11-25T09:00:00.123Z', updated_at: '2026-11-25T09:00:00.123Z', version: 1,
      cooked: '<p>Prompt source</p>' }] } };
  await capture({ root: fixtureRoot, batch, topics: [topic.id], outlineDir: path.join(fixtureRoot, 'outlines'),
    fetchImpl: async () => ({ status: 200, json: async () => topic }) });
  const errorsFile = path.join(fixtureRoot, 'gate-errors.txt');
  await writeFile(errorsFile, 'ERROR first failure\nERROR second failure\n');

  const promptText = await renderTranslationPrompt({
    root: fixtureRoot, batch, outlineDir: '/tmp/outlines', glossaryPath: '/tmp/Translation.md', errorsFile
  });

  assert.doesNotMatch(promptText, /\{\{[A-Z_]+\}\}/);
  assert.match(promptText, /content\/authoring\/v2\/official-announcements\/20261125/);
  assert.match(promptText, /\/tmp\/outlines/);
  assert.match(promptText, /\/tmp\/Translation\.md/);
  assert.match(promptText, /- 987655 \| Prompt Title One Line \| 2026-11-25T09:00:00\.123Z \| content\/authoring\/v2\/official-announcements\/20261125\/translations\/2026-11-25-prompt-title-one-line\.md/);
  assert.match(promptText, /ERROR first failure\nERROR second failure/);
});

// Scenario: A captured title contains Markdown punctuation and a newline before the cloud workflow writes its notes.
// Purpose: preserve the local runner's README table, escaping rules, explanatory bullets, and producer attribution.
test('UnitT90_writeBatchReadme_ports_the_runner_notes_and_escapes_titles', async t => {
  const fixtureRoot = await tempRoot(t);
  const topic = { id: 987656, slug: 'readme-title', title: 'Title *with* [Markdown] | table\nnext', category_id: 70,
    post_stream: { posts: [{ id: 3, post_number: 1, username: 'readme-author',
      created_at: '2026-11-24T23:00:00Z', updated_at: '2026-11-24T23:00:00Z', version: 1,
      cooked: '<p>README source</p>' }] } };
  const { batchDir } = await capture({ root: fixtureRoot, batch, topics: [topic.id],
    fetchImpl: async () => ({ status: 200, json: async () => topic }) });

  await writeBatchReadme({ root: fixtureRoot, batch });
  const readme = await readFile(path.join(batchDir, 'README.md'), 'utf8');

  assert.match(readme, /^# 2026-11-25 official announcement batch \(auto\)$/m);
  assert.match(readme, /\| Date \| Topic \| Record \|\n\|---\|---\|---\|/);
  assert.match(readme, /\| 2026-11-24 \| Title \\\*with\\\* \\\[Markdown\\\] \\\| table next \(987656\) \| `2026-11-24-title-with-markdown-table-next` \|/);
  assert.match(readme, /source-snapshots\/[\s\S]*translations\//);
  assert.match(readme, /Produced by `\.github\/workflows\/announcements-intake\.yml` or `scripts\/content\/announcements-daily\.ps1`\./);
  assert.ok(readme.endsWith('\n'));
});

test('slugify normalizes punctuation, apostrophes, accents and length', () => {
  assert.equal(slugify("Special Live Event: The Grandfather's Gifts!"), 'special-live-event-the-grandfathers-gifts');
  assert.equal(slugify('Élite — 1.13.4 (Warband’s update)'), 'elite-1-13-4-warbands-update');
  assert.equal(slugify('A'.repeat(59) + ' B'), 'a'.repeat(59));
});
