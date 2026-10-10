import { validatePackage } from '../content/validate.mjs';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);
const list = items => `<ul class="link-list">${items.join('')}</ul>`;
const item = (href, label, note = '') => `<li><a href="${escapeHtml(href)}">${escapeHtml(label)}</a>${note ? `<span>${escapeHtml(note)}</span>` : ''}</li>`;

function assetMarkup(record, assets) {
  const icons = (record.asset_ids ?? []).map(id => assets.get(id));
  const images = icons.map(asset => `<img class="content-icon" src="${escapeHtml(asset.path)}" alt="${escapeHtml(asset.alt ?? '')}">`).join('');
  const notices = new Map();
  for (const asset of icons) {
    if (!asset.attribution) continue;
    const { href, text } = asset.attribution;
    notices.set(`${href}|${text}`, `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`);
  }
  return {
    images: images ? `<div class="icon-row">${images}</div>` : '',
    notices: [...notices.values()].map(link => `<p class="asset-credit">${link}</p>`).join('')
  };
}

function page(title, section, content, credits = '') {
  return `<!doctype html>
<html lang="zh-Hant-TW">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(title)}｜暗潮繁體資料庫示範</title>
  <link rel="stylesheet" href="/assets/site.css">
</head>
<body>
  <a class="skip" href="#main">跳到主要內容</a>
  <header class="site-header"><div class="shell header-inner"><a class="brand" href="/">暗潮<span>繁體資料庫</span></a><nav aria-label="主要導覽"><a href="/skills/"${section === 'skills' ? ' aria-current="page"' : ''}>技能</a><a href="/weapons/"${section === 'weapons' ? ' aria-current="page"' : ''}>武器</a><a href="/blessings/"${section === 'blessings' ? ' aria-current="page"' : ''}>祝福</a></nav></div></header>
  <main id="main" class="shell">${content}</main>
  <footer class="site-footer"><div class="shell"><p>虛構示範資料 · 僅用於網站結構與介面驗證</p>${credits}</div></footer>
</body>
</html>
`;
}

function intro(kicker, title, description) {
  return `<section class="intro"><p class="eyebrow">${escapeHtml(kicker)}</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></section>`;
}

function card(title, body) {
  return `<section class="card"><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

function routeFor(indexes, kind, id) {
  const route = [...indexes.routes.values()].find(row => row.content_kind === kind && row.content_key === id);
  return route.target_route;
}

function fileFor(route) { return `${route.slice(1)}index.html`; }

export function renderSite(data) {
  const indexes = validatePackage(data);
  const files = new Map();
  const skills = [...indexes.skills.values()];
  const weapons = [...indexes.weapons.values()];
  const blessings = [...indexes.blessings.values()];
  const skillLinks = list(skills.map(s => item(routeFor(indexes, 'skill', `${s.archetype}/${s.skill_id}`), s.name_zh_tw, s.category)));
  const weaponLinks = list(weapons.map(w => item(routeFor(indexes, 'weapon', w.weapon_id), w.name_zh_tw, w.kind)));
  const blessingLinks = list(blessings.map(b => item(routeFor(indexes, 'blessing', b.blessing_id), b.name_zh_tw)));
  const home = `<div class="hero"><p class="eyebrow">社群資料庫 · 繁體中文</p><h1>在技能、武器與祝福之間，找到清楚的路徑。</h1><p>這個版本使用虛構內容展示查閱方式；真實遊戲資料尚未發布。</p><div class="hero-links"><a href="/skills/">探索技能 ↗</a><a href="/weapons/">瀏覽武器 ↗</a><a href="/blessings/">查詢祝福 ↗</a></div></div>`;
  files.set('index.html', page('首頁', '', `${home}<div class="section-grid">${card('技能', skillLinks)}${card('武器', weaponLinks)}${card('祝福', blessingLinks)}</div>`));
  files.set('skills/index.html', page('技能', 'skills', intro('技能目錄', '技能', '依職業查閱技能。以下皆為虛構示範資料。') + card('技能列表', skillLinks)));
  files.set('weapons/index.html', page('武器', 'weapons', intro('武器目錄', '武器', '從武器追溯型號與祝福。以下皆為虛構示範資料。') + card('武器列表', weaponLinks)));
  files.set('blessings/index.html', page('祝福', 'blessings', intro('祝福目錄', '祝福', '從祝福反查適用武器。以下皆為虛構示範資料。') + card('祝福列表', blessingLinks)));

  for (const skill of skills) {
    const { images, notices } = assetMarkup(skill, indexes.assets);
    const path = fileFor(routeFor(indexes, 'skill', `${skill.archetype}/${skill.skill_id}`));
    files.set(path, page(skill.name_zh_tw, 'skills', `${intro(`技能 / ${skill.archetype}`, skill.name_zh_tw, '虛構示範資料')}${card('技能效果', `${images}<p>${escapeHtml(skill.effect_zh_tw)}</p><p class="muted">分類：${escapeHtml(skill.category)}</p>`)}`, notices));
  }
  for (const weapon of weapons) {
    const { images, notices } = assetMarkup(weapon, indexes.assets);
    const marks = weapon.mark_ids.map(id => indexes.marks.get(id));
    const related = data.bindings.filter(binding => binding.weapon_id === weapon.weapon_id).map(binding => indexes.blessings.get(binding.blessing_id));
    const markList = list(marks.map(mark => `<li>${escapeHtml(mark.name_zh_tw)}</li>`));
    const uniqueBlessings = [...new Map(related.map(b => [b.blessing_id, b])).values()];
    const relatedLinks = list(uniqueBlessings.map(b => item(routeFor(indexes, 'blessing', b.blessing_id), b.name_zh_tw)));
    const content = intro('武器', weapon.name_zh_tw, '虛構示範資料') + card('型號', images + markList) + card('可用祝福', relatedLinks);
    files.set(fileFor(routeFor(indexes, 'weapon', weapon.weapon_id)), page(weapon.name_zh_tw, 'weapons', content, notices));
  }
  for (const blessing of blessings) {
    const { images, notices } = assetMarkup(blessing, indexes.assets);
    const related = data.bindings.filter(binding => binding.blessing_id === blessing.blessing_id).map(binding => indexes.weapons.get(binding.weapon_id));
    const uniqueWeapons = [...new Map(related.map(w => [w.weapon_id, w])).values()];
    const relatedLinks = list(uniqueWeapons.map(w => item(routeFor(indexes, 'weapon', w.weapon_id), w.name_zh_tw)));
    const variantLinks = list(blessing.variant_ids.map(id => {
      const variant = indexes.variants.get(id);
      return item(routeFor(indexes, 'variant', id), `${blessing.name_zh_tw} · ${indexes.weapons.get(variant.weapon_id).name_zh_tw}`);
    }));
    const content = intro('祝福', blessing.name_zh_tw, '虛構示範資料') + card('祝福效果', `${images}<p>${escapeHtml(blessing.effect_zh_tw)}</p>`) + card('適用武器', relatedLinks) + card('變體', variantLinks);
    files.set(fileFor(routeFor(indexes, 'blessing', blessing.blessing_id)), page(blessing.name_zh_tw, 'blessings', content, notices));
  }
  for (const variant of indexes.variants.values()) {
    const blessing = indexes.blessings.get(variant.blessing_id);
    const weapon = indexes.weapons.get(variant.weapon_id);
    const { images, notices } = assetMarkup(variant, indexes.assets);
    const tiers = `${images}<p>定義階級：${escapeHtml(variant.defined_tiers.join('、'))}</p><p class="muted">可用階級：${variant.available_tiers == null ? '尚未確認' : escapeHtml(variant.available_tiers.join('、'))}</p>`;
    const links = list([item(routeFor(indexes, 'blessing', blessing.blessing_id), blessing.name_zh_tw), item(routeFor(indexes, 'weapon', weapon.weapon_id), weapon.name_zh_tw)]);
    const content = intro('祝福變體', `${blessing.name_zh_tw} · ${weapon.name_zh_tw}`, '虛構示範資料') + card('階級資訊', tiers) + card('關聯資料', links);
    files.set(fileFor(routeFor(indexes, 'variant', variant.variant_id)), page(`${blessing.name_zh_tw} · ${weapon.name_zh_tw}`, 'blessings', content, notices));
  }
  files.set('assets/site.css', `:root{color-scheme:dark;font-family:system-ui,"Noto Sans TC",sans-serif;background:#101719;color:#e4e8df}*{box-sizing:border-box}body{margin:0;line-height:1.65}a{color:#a9d8ba}a:hover{color:#e3f6cc}.shell{width:min(1100px,calc(100% - 36px));margin:auto}.skip{position:absolute;left:-9999px}.skip:focus{left:1rem;top:1rem;z-index:2}.site-header{border-bottom:1px solid #3d4d48;background:#15211f}.header-inner{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:18px 0}.brand{font-size:1.18rem;text-decoration:none;font-weight:800;color:#f0f0d9}.brand span{font-weight:400;color:#abc1ae;margin-left:.4rem}nav{display:flex;gap:1.3rem}nav a{text-decoration:none}nav a[aria-current]{color:#f7e5a1}.hero{padding:82px 0 62px;max-width:800px}.eyebrow{text-transform:uppercase;letter-spacing:.18em;color:#dfc987;font-size:.78rem;font-weight:800}.hero h1{font-size:clamp(2.3rem,5vw,4.4rem);line-height:1.18;margin:.3em 0}.hero p,.intro p{color:#b9c8c1}.hero-links{display:flex;flex-wrap:wrap;gap:1rem;margin-top:2rem}.hero-links a{background:#a9d8ba;color:#12201a;padding:.75rem 1rem;border-radius:4px;text-decoration:none;font-weight:800}.hero-links a:hover{background:#e3f6cc}.section-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;padding-bottom:80px}.card{background:#1b2926;border:1px solid #40564d;border-radius:6px;padding:24px;margin:18px 0}.card h2{margin-top:0;color:#f5e7b9}.card p{color:#c3d1c9}.intro{padding:54px 0 16px;max-width:750px}.intro h1{font-size:clamp(2rem,4vw,3.4rem);margin:0}.link-list{padding-left:1.2rem}.link-list li{margin:.6rem 0}.link-list span{color:#9fb4a9;margin-left:1rem}.muted{font-size:.9rem;color:#9fb4a9}.icon-row{display:flex;gap:1rem}.content-icon{width:72px;height:72px;object-fit:contain}.site-footer{border-top:1px solid #3d4d48;padding:25px 0 40px;color:#a6bbb0}.asset-credit a{color:#a9d8ba}@media(max-width:700px){.header-inner{align-items:flex-start;flex-direction:column}nav{gap:1rem}.section-grid{grid-template-columns:1fr}.hero{padding-top:48px}}\n`);
  return files;
}
