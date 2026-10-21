import assert from 'node:assert/strict';
import {groupBlessingEffects, mechanicsItems, browsingRelations} from '../web/client.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createStaticServer } from './serve.mjs';
import { verifyStaticPackage } from '../src/static/verify.mjs';

const REQUIRED_KINDS = ['skill', 'mechanics', 'weapon', 'mark', 'blessing', 'variant'];
const LIST_PAGES = [
  { route: '/skills/', title: '技能', entryKind: 'skill' },
  { route: '/weapons/', title: '武器', entryKind: 'weapon' },
  { route: '/blessings/', title: '祝福', entryKind: 'blessing' }
];
const ARCHETYPE_LABELS = {
  veteran: '老兵', zealot: '狂信徒', psyker: '靈能者', ogryn: '歐格林', arbites: '法務官',
  scum: '巢都渣滓', skitarii: '護教軍'
};

function entryKey(entry) {
  return entry.kind + ':' + entry.id;
}

function expectedEntryName(entry) {
  return typeof entry.name_zh_tw === 'string' && entry.name_zh_tw.trim()
    ? entry.name_zh_tw
    : '名稱待確認（' + entry.id + '）';
}

function isGamesLanternUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      (url.hostname.toLowerCase() === 'gameslantern.com' ||
        url.hostname.toLowerCase().endsWith('.gameslantern.com'));
  } catch {
    return false;
  }
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(label + ' could not be read from the verified artifact', { cause: error });
  }
}

async function readVerifiedData(distPath, verification) {
  const revisionDirectory = path.join(distPath, 'data', verification.data_revision);
  const catalog = await readJson(path.join(revisionDirectory, 'catalog.json'), 'Versioned catalog');
  assert.equal(catalog.schema_version, 2, 'browser smoke requires a schema 2 catalog');
  assert.ok(Array.isArray(catalog.entries), 'verified catalog has no entry array');

  const details = new Map();
  let hasGamesLanternAsset = false;
  for (const entry of catalog.entries) {
    const detail = await readJson(
      path.join(revisionDirectory, ...entry.detail_path.split('/')),
      'Detail ' + entry.kind + ':' + entry.id
    );
    details.set(entryKey(entry), detail);
    if (detail.assets.some(asset =>
      isGamesLanternUrl(asset.source_url) || isGamesLanternUrl(asset.attribution?.href))) {
      hasGamesLanternAsset = true;
    }
  }

  const representatives = new Map();
  for (const kind of REQUIRED_KINDS) {
    const entry = catalog.entries.find(row => row.kind === kind);
    assert.ok(entry, 'verified catalog has no representative ' + kind + ' entry');
    representatives.set(kind, entry);
  }

  const talentTrees = [];
  if (verification.package_kind === 'published') {
    assert.ok(Array.isArray(catalog.talent_trees), 'published catalog must include talent-tree metadata');
    assert.equal(catalog.talent_trees.length, 7, 'published package must include all seven talent trees');
  }
  if (catalog.talent_trees !== undefined) {
    assert.ok(Array.isArray(catalog.talent_trees), 'catalog talent_trees must be an array when present');
    for (const metadata of catalog.talent_trees) {
      assert.equal(typeof metadata.tree_path, 'string', 'talent-tree metadata must include a data path');
      assert.ok(!metadata.tree_path.split('/').includes('..'), 'talent-tree path must stay inside its data revision');
      const tree = await readJson(
        path.join(revisionDirectory, ...metadata.tree_path.split('/')),
        'Talent tree ' + metadata.archetype
      );
      assert.equal(tree.archetype, metadata.archetype, 'talent-tree file archetype does not match its catalog metadata');
      assert.equal(tree.version, metadata.version, 'talent-tree file version does not match its catalog metadata');
      assert.ok(Array.isArray(tree.nodes), 'talent-tree file has no node array');
      assert.equal(tree.nodes.length, metadata.node_count, 'talent-tree node count does not match its catalog metadata');
      assert.ok(Array.isArray(tree.details), 'talent-tree file has no detail array');
      talentTrees.push({ metadata, tree });
    }
  }

  return { catalog, details, representatives, hasGamesLanternAsset, talentTrees };
}

function assertInitialCredit(html, required) {
  const creditCount = (html.match(/class="asset-credit"/g) ?? []).length;
  if (!required) {
    assert.equal(creditCount, 0, 'initial HTML must not claim unused Games Lantern credit');
    assert.doesNotMatch(html, /Games Lantern|darktide\.gameslantern\.com/i);
    return;
  }

  assert.equal(creditCount, 1, 'initial HTML must contain one Games Lantern credit');
  assert.match(html, /本網站部分圖片素材經/);
  const anchor = /<a\b[^>]*href="https:\/\/darktide\.gameslantern\.com\/"[^>]*>Games Lantern<\/a>/i.exec(html);
  assert.ok(anchor, 'initial credit must link directly to Games Lantern');
  assert.doesNotMatch(anchor[0], /\brel=["'][^"']*\b(?:nofollow|ugc|sponsored)\b/i);
}

async function openDocument(page, origin, route) {
  const response = await page.goto(new URL(route, origin).href, { waitUntil: 'domcontentloaded' });
  assert.ok(response, 'browser did not receive a document response for ' + route);
  assert.equal(response.status(), 200, 'document route failed: ' + route);
}

async function expectListPage(page, origin, definition, entry) {
  await openDocument(page, origin, definition.route);
  const directoryHeading = page.locator('main .page-intro h1');
  await directoryHeading.waitFor({ state: 'visible' });
  assert.equal((await directoryHeading.innerText()).trim(), definition.title,
    definition.route + ' rendered the wrong directory title');

  let filteredRoute;
  let filteredTitle = definition.title;
  if (definition.entryKind === 'skill') {
    const archetype = entry.id.split('/')[0];
    const archetypeRoute = '/skills/' + archetype + '/';
    const directoryRoutes = await page.locator('main a[href]').evaluateAll(links =>
      links.map(link => new URL(link.href, window.location.href).pathname)
    );
    assert.ok(directoryRoutes.includes(archetypeRoute),
      '/skills/ did not render the verified archetype route ' + archetypeRoute);
    filteredRoute = archetypeRoute + '?q=' + encodeURIComponent(entry.id);
    filteredTitle = ARCHETYPE_LABELS[archetype] ?? ('職業：' + archetype);
  } else {
    const filteredUrl = new URL(definition.route, origin);
    filteredUrl.searchParams.set('q', entry.id);
    filteredRoute = filteredUrl.pathname + filteredUrl.search;
  }

  await openDocument(page, origin, filteredRoute);
  const heading = page.locator('main .page-intro h1');
  await heading.waitFor({ state: 'visible' });
  assert.equal((await heading.innerText()).trim(), filteredTitle,
    filteredRoute + ' rendered the wrong filtered-list title');

  const routes = await page.locator('main a[href]').evaluateAll(links =>
    links.map(link => new URL(link.href, window.location.href).pathname)
  );
  assert.ok(routes.includes(entry.route),
    filteredRoute + ' did not render verified entry ' + entry.kind + ':' + entry.id);
}
async function expectDetailPage(page, entry, detail) {
  const heading = page.locator('main .detail-heading h1');
  await heading.waitFor({ state: 'visible' });
  assert.equal((await heading.innerText()).trim(), expectedEntryName(entry),
    'detail route did not render the verified catalog name for ' + entry.kind + ':' + entry.id);

  const expectedCredits = detail.assets
    .map(asset => {
      const href = asset.attribution?.href ?? asset.source_url;
      if (typeof href !== 'string' || !href.startsWith('https://')) return null;
      return { href, text: asset.attribution?.text ?? '圖片來源' };
    })
    .filter(Boolean);
  const actualCredits = await page.locator('.asset-grid .asset-credit').evaluateAll(links =>
    links.map(link => ({
      href: new URL(link.href, window.location.href).href,
      text: link.textContent.trim(),
      rel: link.rel
    }))
  );
  assert.equal(actualCredits.length, expectedCredits.length,
    'detail page has the wrong number of visible asset credits for ' + entry.kind + ':' + entry.id);
  for (const expected of expectedCredits) {
    assert.ok(actualCredits.some(actual => actual.href === expected.href && actual.text === expected.text),
      'detail page is missing its direct visible asset credit ' + expected.href);
  }
  for (const actual of actualCredits) {
    assert.doesNotMatch(actual.rel, /\b(?:nofollow|ugc|sponsored)\b/i,
      'asset attribution must remain a follow link');
  }
  if (['weapon', 'blessing'].includes(entry.kind)) {
    const expected = browsingRelations(entry.kind, detail.relations).map(row => row.route);
    const actual = await page.locator('main .relation-list a').evaluateAll(links => links.map(link => new URL(link.href).pathname));
    assert.deepEqual(actual, expected, entry.kind + ' must show unique main-weapon/blessing links only');
  }
  if (entry.kind === 'skill') await expectMechanicsLines(page.locator('main .detail-grid .detail-column').first(), detail.record.effect_zh_tw, 'skill effect '+entry.id);
  if (entry.kind === 'mechanics') {
    await expectMechanicsLines(page.locator('main'), (detail.record.mechanics_zh_tw ?? detail.record.effect_zh_tw),
      'mechanics detail ' + entry.id);
  }
}

function normalizeMechanicsText(value) {
  return typeof value === 'string' ? value.replace(/\s+/gu, '') : '';
}

function mechanicsBoundaryOffsets(value) {
  const offsets = new Set();
  let offset = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '\r') {
      if (value[index + 1] === '\n') index += 1;
      offsets.add(offset);
    } else if (character === '\n') {
      offsets.add(offset);
    } else if (!/\s/u.test(character)) {
      offset += character.length;
      if (character === '。' || character === '；') offsets.add(offset);
    }
  }
  return offsets;
}

async function expectMechanicsLines(container, value, context) {
  const expected = normalizeMechanicsText(value);
  const list = container.locator('.mechanics-list');
  if (!expected.length) {
    assert.equal(await list.count(), 0, context + ' should not render an empty mechanics list');
    return;
  }
  assert.equal(await list.count(), 1, context + ' must render one mechanics list');
  const actual = (await list.locator('li').allInnerTexts())
    .map(line => normalizeMechanicsText(line.trim()));
  assert.ok(actual.length && actual.every(line => line.length > 0),
    context + ' must render only non-empty mechanics items');
  assert.equal(actual.join(''), expected, context + ' items must preserve the complete source text');
  const allowedBoundaries = mechanicsBoundaryOffsets(value);
  let offset = 0;
  for (const [index, line] of actual.entries()) {
    offset += line.length;
    if (index < actual.length - 1) {
      assert.ok(allowedBoundaries.has(offset),
        context + ' item boundaries must follow source newlines or complete Chinese sentences');
    }
  }
}

function tierClaimsFor(record, tier) {
  return record.tier_claims?.find(row => row.tier === tier)?.claims ?? [];
}

function claimValueMatches(actual, claim) {
  if (claim.state === 'unknown') return actual === '尚未確認';
  const value = String(claim.value);
  if (!actual.startsWith(value)) return false;
  const nextCharacter = actual.slice(value.length, value.length + 1);
  return !/[0-9.]/.test(nextCharacter);
}

async function expectBlessingLevels(page, detail, catalog, details) {
  const levels=detail.record.variant_ids.map(id=>details.get('variant:'+id));
  const groups=groupBlessingEffects(levels,catalog);
  const card=page.locator('.blessing-levels .level-card');await card.waitFor({state:'visible'});
  assert.equal(await card.count(),1,'blessing shows one selected/shared effect, never duplicate weapon cards');
  const select=page.locator('#blessing-weapon');
  assert.equal(await select.count(),groups.length>1?1:0,'weapon selector only for meaningful differences');
  if(groups.length>1) assert.equal(await select.locator('option').count(),levels.length,'all weapons must be selectable');
  for(const group of groups) {
    for(const level of group.levels) {
      if(groups.length>1) await select.selectOption(level.record.variant_id);
      assert.equal(await card.getAttribute('data-weapon-id'),groups.length>1?level.record.weapon_id:group.record.weapon_id);
      assert.equal(await card.getAttribute('data-variant-ids'),group.levels.map(d=>d.record.variant_id).join(' '));
      const actual=await card.locator('.mechanics-list li').allInnerTexts();
      if(group.effect?.trim() !== detail.record.effect_zh_tw?.trim()) assert.deepEqual(actual,mechanicsItems(group.effect));
      else assert.deepEqual(actual,[],'do not repeat the common effect');
      const headers=await card.locator('thead th').allInnerTexts();
      const knownIds=[...new Set(group.record.tier_claims.flatMap(t=>t.claims.filter(c=>c.state==='known').map(c=>c.claim_id)))];
      if(knownIds.length) {
        assert.deepEqual(headers,['效果',...group.record.defined_tiers.map(t=>'等級 '+t)]);
        const cells=await card.locator('tbody td').allInnerTexts();
        const expected=knownIds.flatMap(id=>group.record.defined_tiers.map(t=>tierClaimsFor(group.record,t).find(c=>c.claim_id===id&&c.state==='known')));
        assert.equal(cells.length,expected.length);
        for(let i=0;i<cells.length;i++) if(expected[i]) assert.ok(claimValueMatches(cells[i],expected[i]),'selected weapon must show its own verified tier values');else assert.equal(cells[i],'未收錄');
      }
      const unknown=group.record.tier_claims.some(t=>t.claims.some(c=>c.state!=='known'));
      assert.equal(await card.locator('.data-limitations').count(),unknown?1:0,'real missing evidence remains disclosed');
      // Scenario: The displayed source-defined levels have no confirmed obtainability for an applicable weapon.
      // Purpose: Keep this limitation visible beside the numerical table, including after weapon selection.
      const unknownAvailability=group.levels.some(d=>!Array.isArray(d.record.available_tiers));
      const availabilityNote=card.locator('.tier-availability');
      assert.equal(await availabilityNote.count(),unknownAvailability?1:0,'unverified tier obtainability must be disclosed');
      if(unknownAvailability) assert.equal(await availabilityNote.innerText(),'以下為來源定義的等級與數值；各等級在遊戲內是否可取得，尚未核實。');
      assert.ok(!(await page.locator('main').innerText()).includes('觸發條件：尚未確認'));
      assert.ok(!(await page.locator('main').innerText()).includes('可用等級：尚未確認'));
    }
  }
}

async function clickRelation(page, source, target) {
  const relationLink = page.locator('main .relation-list a[href="' + target.route + '"]');
  assert.equal(await relationLink.count(), 1,
    source.kind + ':' + source.id + ' must link to related ' + target.kind + ':' + target.id);
  await Promise.all([
    page.waitForURL(url => url.pathname === target.route),
    relationLink.click()
  ]);
}

async function checkNoHorizontalOverflow(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth
  }));
  assert.equal(dimensions.viewport, width, 'browser did not apply the requested mobile viewport');
  assert.ok(dimensions.document <= width && dimensions.body <= width,
    'horizontal overflow at ' + width + 'px: document=' + dimensions.document + ', body=' + dimensions.body);
}

async function assertTalentTreeDom(page, tree, context) {
  await page.locator('.tree-viewport').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.talent-node').evaluateAll(nodes => nodes.some(node => node.textContent.trim())), false,
    context + ' nodes use icons rather than visible skill text');
  const expectedIcons = tree.nodes.filter(node => tree.details.some(detail => detail.record.skill_id === node.skill_id && detail.assets.length)).length;
  assert.equal(await page.locator('.talent-node img').count(), expectedIcons, context + ' all source-backed icons must be attached');
  assert.equal(await page.locator('.talent-node img[loading="lazy"]').count(), 0, context + ' hidden icons must not wait for intersection');
  await page.waitForFunction(() => [...document.querySelectorAll('.talent-node img')].every(image => image.complete), null, { timeout: 20000 });
  const failedIcons = await page.locator('.talent-node img').evaluateAll(images => images.filter(image => !image.naturalWidth || image.hidden).map(image => image.src));
  assert.deepEqual(failedIcons, [], context + ' all original source icons must actually load');

  // Scenario: Original talent artwork is loaded on nodes of different gameplay types.
  // Purpose: Preserve its native silhouette instead of forcing a circle or square mask.
  assert.equal(await page.locator('.talent-node:has(img:not([hidden]))').evaluateAll(nodes => nodes.every(node => {
    const style = getComputedStyle(node);
    return style.overflow === 'visible' && style.borderTopColor === 'rgba(0, 0, 0, 0)' && style.backgroundColor === 'rgba(0, 0, 0, 0)' && style.boxShadow === 'none' && getComputedStyle(node.querySelector('img')).pointerEvents === 'none';
  })), true, context + ' original artwork must remain unmasked and unframed');

  // Scenario: Open a tree at its default scale on desktop or a narrow phone.
  // Purpose: Keep skill icons readable and clickable without overlapping adjacent nodes.
  assert.equal(await page.locator('#tree-zoom').inputValue(), '100', context + ' opens at readable scale');
  const boxes = await page.locator('.talent-node').evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect();
    return { type: node.dataset.nodeType, left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width };
  }));
  assert.ok(boxes.filter(box => !['stat', 'start'].includes(box.type)).every(box => box.width >= 70),
    context + ' skill targets must be at least 70 CSS pixels at default scale');
  for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
    const first = boxes[a], second = boxes[b];
    assert.ok(first.right <= second.left || second.right <= first.left || first.bottom <= second.top || second.bottom <= first.top,
      context + ' enlarged targets must not overlap');
  }

  const actualNodes = await page.locator('.talent-node').evaluateAll(buttons => buttons.map(button => ({
    id: button.dataset.nodeId,
    type: button.dataset.nodeType,
    left: Number.parseFloat(button.style.left),
    top: Number.parseFloat(button.style.top)
  })));
  const expectedNodes = tree.nodes.map(node => ({ id: node.node_id, type: node.type }))
    .sort((left, right) => left.id.localeCompare(right.id));
  assert.deepEqual(
    actualNodes.map(node => ({ id: node.id, type: node.type }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    expectedNodes,
    context + ' DOM nodes must match the verified tree data'
  );

  // Apply uniform display spacing while preserving every source coordinate and edge.
  const zoom = Number(await page.locator('#tree-zoom').inputValue()) / 100 * 1.25;
  const minX = Math.min(...tree.nodes.map(node => node.x)) - 80;
  const minY = Math.min(...tree.nodes.map(node => node.y)) - 80;
  for (const node of tree.nodes) {
    const actual = actualNodes.find(row => row.id === node.node_id);
    assert.ok(Math.abs(actual.left - (node.x - minX) * zoom) < 0.01,
      context + ' node ' + node.node_id + ' must keep its source x coordinate');
    assert.ok(Math.abs(actual.top - (node.y - minY) * zoom) < 0.01,
      context + ' node ' + node.node_id + ' must keep its source y coordinate');
  }

  const expectedEdges = tree.nodes.flatMap(node =>
    node.children.map(childId => ({ source: node.node_id, target: childId }))
  );
  const actualEdges = await page.locator('.tree-lines line').evaluateAll(lines => lines.map(line => ({
    source: line.dataset.sourceNode,
    target: line.dataset.targetNode,
    x1: Number(line.getAttribute('x1')),
    y1: Number(line.getAttribute('y1')),
    x2: Number(line.getAttribute('x2')),
    y2: Number(line.getAttribute('y2'))
  })));
  const edgeKey = edge => edge.source + '>' + edge.target;
  assert.deepEqual(actualEdges.map(edgeKey).sort(), expectedEdges.map(edgeKey).sort(),
    context + ' SVG edges must match every source node child relation');
  const nodeById = new Map(tree.nodes.map(node => [node.node_id, node]));
  for (const edge of expectedEdges) {
    const actual = actualEdges.find(row => row.source === edge.source && row.target === edge.target);
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    assert.ok(Math.abs(actual.x1 - (source.x - minX) * zoom) < 0.01 &&
      Math.abs(actual.y1 - (source.y - minY) * zoom) < 0.01 &&
      Math.abs(actual.x2 - (target.x - minX) * zoom) < 0.01 &&
      Math.abs(actual.y2 - (target.y - minY) * zoom) < 0.01,
    context + ' SVG edge ' + edgeKey(edge) + ' must connect the source coordinates');
  }
}

async function expectTalentTree(page, origin, catalog, item) {
  const { metadata, tree } = item;
  const route = '/skills/' + metadata.archetype + '/';
  const context = 'talent tree ' + metadata.archetype;
  await openDocument(page, origin, route);
  await assertTalentTreeDom(page, tree, context);

  const mappedNode = tree.nodes.find(node =>
    node.skill_id && tree.details.some(detail => detail.record.skill_id === node.skill_id) &&
    catalog.entries.some(entry => entry.kind === 'skill' &&
      entry.id === metadata.archetype + '/' + node.skill_id)
  );
  assert.ok(mappedNode, context + ' must contain a node mapped to verified skill detail');
  const skillEntry = catalog.entries.find(entry => entry.kind === 'skill' &&
    entry.id === metadata.archetype + '/' + mappedNode.skill_id);
  const skillDetail = tree.details.find(detail => detail.record.skill_id === mappedNode.skill_id);
  assert.ok(skillEntry && skillDetail, context + ' mapped node must have catalog entry and detail');
  const nodeButton = page.locator('.talent-node[data-node-id="' + mappedNode.node_id + '"]');
  assert.equal(await nodeButton.count(), 1, context + ' mapped node must be uniquely selectable');
  await nodeButton.click();
  if (skillDetail.assets.length) {
    // Scenario: Select a node whose original artwork is available.
    // Purpose: Retain a visible selection cue without adding a type-shaped frame.
    await page.locator('main .page-intro h1').click(); // Move hover and focus away from the selected node.
    assert.notEqual(await nodeButton.locator('img').evaluate(image => getComputedStyle(image).filter), 'none',
      context + ' selected original artwork must have a visible highlight');
    assert.equal(await nodeButton.evaluate(node => getComputedStyle(node).boxShadow), 'none',
      context + ' selection must not restore the artificial frame');
  }

  const panel = page.locator('#tree-detail-panel');
  await panel.waitFor({ state: 'visible' });
  const expectedSkillName = typeof skillEntry.name_zh_tw === 'string' && skillEntry.name_zh_tw.trim()
    ? skillEntry.name_zh_tw : '名稱待確認（' + mappedNode.skill_id + '）';
  assert.equal((await panel.locator('h2').first().innerText()).trim(), expectedSkillName,
    context + ' selected node must show the verified skill name');
  const sectionHeadings = (await panel.locator('h3').allInnerTexts()).map(text => text.trim());
  assert.deepEqual(sectionHeadings, skillDetail.record.mechanics_zh_tw ? ['技能效果', '機制說明'] : ['技能效果'],
    context + ' selected node must show effect and mechanics headings');
  const effectText = (await panel.locator('h3').first().evaluate(heading =>
    heading.nextElementSibling.textContent.trim()));
  assert.equal(normalizeMechanicsText(effectText), normalizeMechanicsText(skillDetail.record.effect_zh_tw),
    context + ' selected node must show the verified skill effect');
  const effectItems=await panel.locator('h3').first().evaluate(h=>[...h.nextElementSibling.querySelectorAll('li')].map(li=>li.textContent));
  assert.deepEqual(effectItems,mechanicsItems(skillDetail.record.effect_zh_tw));
  if(skillDetail.record.mechanics_zh_tw) {
    const mechanismItems=await panel.locator('h3').nth(1).evaluate(h=>[...h.nextElementSibling.querySelectorAll('li')].map(li=>li.textContent));
    assert.deepEqual(mechanismItems,mechanicsItems(skillDetail.record.mechanics_zh_tw));
  }
  assert.equal(await panel.locator('a[href="' + skillEntry.route + '"]').count(), 1,
    context + ' selected node must link to its canonical skill detail');

  await checkNoHorizontalOverflow(page, 320);
  const refreshed = await page.reload({ waitUntil: 'domcontentloaded' });
  assert.ok(refreshed, context + ' refresh returned no document response');
  assert.equal(refreshed.status(), 200, context + ' direct refresh failed');
  assert.equal(new URL(page.url()).searchParams.get('view'), null,
    context + ' refresh must preserve tree mode in the URL');
  await assertTalentTreeDom(page, tree, context + ' after refresh');

  const listLink = page.locator('.view-switch a').filter({ hasText: '清單' });
  await Promise.all([
    page.waitForURL(url => url.pathname === '/skills/' + metadata.archetype + '/' &&
      url.searchParams.get('view') === 'list'),
    listLink.click()
  ]);
  assert.equal(await page.locator('.talent-node').count(), 0,
    context + ' list toggle must return to the skill listing');
  const listHeading = page.locator('main .page-intro h1');
  await listHeading.waitFor({ state: 'visible' });
  assert.equal((await listHeading.innerText()).trim(),
    ARCHETYPE_LABELS[metadata.archetype] ?? ('職業：' + metadata.archetype),
    context + ' list toggle must show the archetype listing');
  assert.equal(await listLink.getAttribute('aria-current'), 'page',
    context + ' list toggle must mark the list view as current');
  await expectSkillListImages(page,catalog);
  const treeLink = page.locator('.view-switch a[href*=\"view=tree\"]');
  await Promise.all([
    page.waitForURL(url => url.pathname === '/skills/' + metadata.archetype + '/' &&
      url.searchParams.get('view') === 'tree'),
    treeLink.click()
  ]);
  await assertTalentTreeDom(page, tree, context + ' after list/tree toggle');
  await checkNoHorizontalOverflow(page, 320);
  await page.setViewportSize({ width: 1280, height: 900 });
}

async function expectSkillListImages(page, catalog) {
  await page.locator('.entry-card').first().waitFor({state:'visible'});
  const cards=await page.locator('.entry-card').count();
  assert.equal(await page.locator('.entry-card .entry-icon').count(),cards,'each skill card must have a visual icon');
  await page.waitForFunction(()=>[...document.querySelectorAll('.entry-card')].every(card=>['loaded','generic'].includes(card.dataset.iconState)),null,{timeout:20000});
  const rows=await page.locator('.entry-card').evaluateAll(cards=>cards.map(card=>({href:card.querySelector('a[href^="/skills/"]').getAttribute('href'),state:card.dataset.iconState,source:card.querySelector('img')?.src,width:card.querySelector('img')?.naturalWidth,alt:card.querySelector('img')?.alt,credit:card.querySelector('.entry-icon-credit')?.textContent})));
  for(const row of rows){const entry=catalog.entries.find(e=>e.route===row.href);assert.ok(entry,'icon must belong to displayed skill');if(entry.asset_ids.length){assert.equal(row.state,'loaded');assert.ok(row.width>0,'source image must decode');assert.equal(row.alt,expectedEntryName(entry));assert.equal(row.credit,'圖示 © Games Lantern');}else assert.equal(row.state,'generic');}
}

// Scenario: UI files change while the catalog revision stays the same.
// Purpose: Refresh the document during internal navigation and retain list/page state.
async function expectFrontendUpdateReload(page, origin, distPath, catalog) {
  const version = await readJson(path.join(distPath, 'version.json'), 'version.json');
  const updated = { ...version, build_id: version.build_id === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64) };
  await page.route('**/version.json', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(updated)
  }), { times: 1 });
  const destination = new URL('/skills/ogryn/?view=list&page=2', origin).href;
  const documentResponse = await Promise.all([
    page.waitForResponse(response => response.request().isNavigationRequest() && response.url() === destination),
    page.getByRole('link', { name: '2', exact: true }).click()
  ]);
  assert.ok(documentResponse[0], 'UI update must trigger document navigation');
  assert.equal(documentResponse[0].status(), 200);
  assert.equal(page.url(), destination, 'reload must preserve list mode and page');
  await expectSkillListImages(page, catalog);
}
async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function run(distArgument) {
  const distPath = path.resolve(distArgument);
  const verification = await verifyStaticPackage(distPath);
  const { catalog, details, representatives, hasGamesLanternAsset, talentTrees } =
    await readVerifiedData(distPath, verification);

  let server;
  let browser;
  try {
    server = await createStaticServer({ distPath });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object', 'static server did not bind an ephemeral TCP port');
    const origin = 'http://127.0.0.1:' + address.port;

    const htmlResponse = await fetch(origin + '/');
    assert.equal(htmlResponse.status, 200, 'static server did not return index.html');
    assertInitialCredit(await htmlResponse.text(), hasGamesLanternAsset);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(15000);

    const pageErrors = [];
    const localDataFailures = [];
    const localOrigin = new URL(origin).origin;
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.origin === localOrigin && url.pathname.startsWith('/data/') &&
          url.pathname.endsWith('.json') && response.status() >= 400) {
        localDataFailures.push(url.pathname + ' returned ' + response.status());
      }
    });

    for (const definition of LIST_PAGES) {
      await expectListPage(page, origin, definition, representatives.get(definition.entryKind));
    }

    if(talentTrees.length){await openDocument(page,origin,'/skills/ogryn/?view=list');await expectSkillListImages(page,catalog);await expectFrontendUpdateReload(page,origin,distPath,catalog);}

    for (const kind of REQUIRED_KINDS) {
      const entry = representatives.get(kind);
      await openDocument(page, origin, entry.route);
      await expectDetailPage(page, entry, details.get(entryKey(entry)));
    }

    const mechanics = catalog.entries.find(entry => entry.kind === 'mechanics' &&
      normalizeMechanicsText(details.get(entryKey(entry)).record.mechanics_zh_tw).length > 0);
    assert.ok(mechanics, 'verified data has no mechanics entry with text lines');
    const skill = catalog.entries.find(entry => entry.kind === 'skill' && entry.id === mechanics.id);
    assert.ok(skill, 'representative mechanics entry has no paired skill entry');
    const skillDetail = details.get(entryKey(skill));
    const mechanicsDetail = details.get(entryKey(mechanics));
    assert.ok(skillDetail.relations.some(relation =>
      relation.kind === mechanics.kind && relation.id === mechanics.id && relation.route === mechanics.route),
    'skill detail is missing its mechanics relation');
    assert.ok(mechanicsDetail.relations.some(relation =>
      relation.kind === skill.kind && relation.id === skill.id && relation.route === skill.route),
    'mechanics detail is missing its reciprocal skill relation');

    await openDocument(page, origin, skill.route);
    await expectDetailPage(page, skill, skillDetail);
    await clickRelation(page, skill, mechanics);
    await expectDetailPage(page, mechanics, mechanicsDetail);
    await clickRelation(page, mechanics, skill);
    await expectDetailPage(page, skill, skillDetail);

    const blessing = catalog.entries
      .filter(entry => entry.kind === 'blessing')
      .sort((left, right) =>
        details.get(entryKey(right)).relations.filter(relation => relation.kind === 'variant').length -
        details.get(entryKey(left)).relations.filter(relation => relation.kind === 'variant').length)[0];
    assert.ok(blessing, 'verified catalog has no blessing entry');
    const blessingDetail = details.get(entryKey(blessing));
    await openDocument(page, origin, blessing.route);
    await expectDetailPage(page, blessing, blessingDetail);
    await expectBlessingLevels(page, blessingDetail, catalog, details);

    for (const id of ['charmed-reload','speedload','hammerblow']) {
      const entry=catalog.entries.find(e=>e.kind==='blessing'&&e.id===id);
      await openDocument(page,origin,entry.route);
      await expectDetailPage(page,entry,details.get(entryKey(entry)));
      await expectBlessingLevels(page,details.get(entryKey(entry)),catalog,details);
    }
    for (const entry of catalog.entries.filter(e=>e.kind==='skill')) {
      await openDocument(page,origin,entry.route);
      await page.locator('main .detail-heading h1').waitFor({state:'visible'});
      await expectMechanicsLines(page.locator('main .detail-grid .detail-column').first(),details.get(entryKey(entry)).record.effect_zh_tw,'skill effect '+entry.id);
    }
    for (const item of talentTrees) {
      await expectTalentTree(page, origin, catalog, item);
    }

    const variant = representatives.get('variant');
    await openDocument(page, origin, variant.route);
    await expectDetailPage(page, variant, details.get(entryKey(variant)));
    const refreshed = await page.reload({ waitUntil: 'domcontentloaded' });
    assert.ok(refreshed, 'direct detail refresh returned no document response');
    assert.equal(refreshed.status(), 200, 'direct detail refresh failed');
    await expectDetailPage(page, variant, details.get(entryKey(variant)));
    await checkNoHorizontalOverflow(page, 320);
    await checkNoHorizontalOverflow(page, 390);

    assert.deepEqual(pageErrors, [], 'browser page raised uncaught runtime errors');
    assert.deepEqual(localDataFailures, [], 'browser could not load same-revision local JSON');
    process.stdout.write(
      'Browser smoke passed: ' + verification.package_kind + ' package, ' +
      catalog.entries.length + ' catalog entries, all 646 skill effects as lists, shared/selectable blessing tiers, ' +
      talentTrees.length + ' talent trees, reciprocal skill/mechanics navigation, direct refresh, ' +
      'skill list images, UI update reload preserving list/page state, and 320/390px layouts.\n'
    );
  } finally {
    if (browser) await browser.close();
    await closeServer(server);
  }
}

const args = process.argv.slice(2);
if (args.length !== 1) {
  process.stderr.write('Usage: node scripts/browser-smoke.mjs <verified-dist-directory>\n');
  process.exitCode = 2;
} else {
  try {
    await run(args[0]);
  } catch (error) {
    process.stderr.write('Browser smoke failed: ' + (error?.message ?? String(error)) + '\n');
    process.exitCode = 1;
  }
}
