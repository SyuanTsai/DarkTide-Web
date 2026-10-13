export const previewAssets = {
  html: `<!doctype html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow, noarchive">
  <meta name="referrer" content="no-referrer">
  <title>Darktide 資料隔離預覽</title>
  <link rel="stylesheet" href="/preview.css">
  <script type="module" src="/preview.js"></script>
</head>
<body>
  <header class="site-header">
    <p class="eyebrow">SYP-311 · W01 隔離預覽</p>
    <h1>Darktide 繁體中文資料預覽</h1>
    <p class="warning" role="note">此頁只供 schema 與資料連結驗證。內容皆為 fixture／待審資料，不是已核准的遊戲事實或正式公告。</p>
  </header>
  <main id="main" aria-labelledby="content-heading">
    <section class="announcement" aria-labelledby="announcement-heading">
      <h2 id="announcement-heading">預覽公告</h2>
      <div id="announcement-content"></div>
    </section>
    <section aria-labelledby="content-heading">
      <h2 id="content-heading">繁體中文資料樣本</h2>
      <p id="status" role="status" aria-live="polite">正在載入隔離預覽資料…</p>
      <div id="content" class="cards"></div>
    </section>
    <section aria-labelledby="changes-heading">
      <h2 id="changes-heading">遊戲變更識別樣本</h2>
      <div id="changes-content"></div>
    </section>
    <section aria-labelledby="terms-heading">
      <h2 id="terms-heading">術語連結樣本</h2>
      <div id="terms-content"></div>
    </section>
    <p id="revision" class="revision"></p>
  </main>
  <footer>資料來源與內容狀態以同源 version.json、manifest 及五個共享資料域為準。</footer>
</body>
</html>
`,
  css: `:root {
  color-scheme: light;
  font-family: system-ui, "Noto Sans TC", "Microsoft JhengHei", sans-serif;
  color: #f3eee7;
  background: #141719;
  font-synthesis: none;
}

* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; }
.site-header, main, footer { width: min(100% - 2rem, 68rem); margin-inline: auto; }
.site-header { padding-block: 2rem 1.4rem; }
.eyebrow { color: #d8aa68; font-size: .8rem; font-weight: 700; letter-spacing: .08em; }
h1, h2, h3, p { line-height: 1.55; }
h1 { margin-block: .4rem 1rem; font-size: clamp(1.8rem, 5vw, 3rem); }
h2 { margin-top: 0; font-size: 1.35rem; }
.warning { padding: 1rem; border: 1px solid #d8aa68; border-left-width: .35rem; background: #332a1e; color: #fff4df; }
main { display: grid; gap: 1.4rem; padding-bottom: 2.5rem; }
main > section { padding: 1.25rem; border: 1px solid #414749; border-radius: .5rem; background: #1c2123; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr)); gap: 1rem; }
.card, .term, .announcement-card { padding: 1rem; border-radius: .4rem; background: #252c2e; }
.card h3, .term h3, .announcement-card h3, .game-change h3 { margin-top: 0; color: #e5c18d; }
.official-label, .errata-label { color: #d8aa68; font-weight: 700; }
.errata { padding: .8rem; border-inline-start: .25rem solid #d8aa68; background: #332a1e; white-space: pre-wrap; }
.game-change { padding: 1rem; border-radius: .4rem; background: #252c2e; }
.card dl { display: grid; grid-template-columns: minmax(5.4rem, .35fr) 1fr; gap: .45rem .8rem; }
.card dt { color: #d8aa68; font-weight: 700; }
.card dd { margin: 0; white-space: pre-wrap; }
#status[data-state="error"] { color: #ffb8a8; }
.revision, footer { color: #bac1c1; font-size: .85rem; }
footer { padding-block: 1rem 2rem; }
`,
  js: `const domainKinds = ["skills", "blessings", "weapons", "terms", "game-changes"];
const contentVersionPattern = /^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$/;
const detailLabels = {
  effects: "效果",
  conditions: "條件",
  calculation: "計算",
  notes: "補充說明",
  extra: "額外說明"
};
const byId = id => document.getElementById(id);

async function fetchBytes(url) {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) throw new Error("讀取隔離預覽資料失敗。");
  return new Uint8Array(await response.arrayBuffer());
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(label + " 格式無效。");
  }
}

async function checkedJson(url, expectedHash, label) {
  const bytes = await fetchBytes(url);
  if (await sha256(bytes) !== expectedHash) throw new Error(label + " 雜湊不符。");
  return parseJson(bytes, label);
}

function appendText(parent, tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function renderErrata(official, errata, article) {
  for (const erratum of errata) {
    const segment = official.segments.find(item => item.segmentId === erratum.anchor.segmentId);
    if (!segment || segment.sha256 !== erratum.anchor.sourceTextDigest) throw new Error("勘誤未綁定目前的官方文字片段。");
    appendText(article, "p", "errata-label", "勘誤（待審）");
    appendText(article, "p", "errata", erratum.text);
  }
}

function renderPresentation(record, parent, termsById) {
  const payload = record.payload;
  if (record.owner !== "web" || record.kind !== "presentation" || record.locale !== "zh-TW") {
    throw new Error("繁體中文呈現記錄無效，預覽不會套用其他語言。");
  }
  const article = document.createElement("article");
  article.className = "card";
  article.setAttribute("aria-labelledby", record.recordId.replaceAll(":", "-"));
  appendText(article, "h3", "", payload.name).id = record.recordId.replaceAll(":", "-");
  if (payload.official) {
    const localized = payload.official.localizations?.["zh-TW"];
    if (!localized || localized.origin !== "faithful-translation") throw new Error("官方文字缺少繁體中文忠實翻譯。");
    appendText(article, "p", "official-label", "官方原句（忠實翻譯）");
    appendText(article, "p", "official-text", localized.text);
    renderErrata(payload.official, payload.errata ?? [], article);
  }
  const list = document.createElement("dl");
  for (const [key, label] of Object.entries(detailLabels)) {
    const items = payload.detailSections?.[key];
    if (!Array.isArray(items)) throw new Error("繁體中文呈現缺少五節資料。");
    if (items.length === 0) continue;
    appendText(list, "dt", "", label);
    for (const item of items) {
      const detail = document.createElement("dd");
      if (typeof item.text === "string") appendText(detail, "span", "", item.text);
      if (item.termRef) {
        const term = termsById.get(item.termRef);
        if (!term) throw new Error("術語參照缺少繁體中文資料。");
        appendText(detail, "strong", "", term.label + "：");
        appendText(detail, "span", "", term.definition);
      }
      list.append(detail);
    }
  }
  article.append(list);
  parent.append(article);
}

function formatValue(value) {
  if (value?.status === "known" && typeof value.decimal === "string") return value.decimal + (value.unit ? " " + value.unit : "");
  if (value?.status === "known" && typeof value.min === "string" && typeof value.max === "string") return value.min + "–" + value.max + (value.unit ? " " + value.unit : "");
  if (value?.status === "unknown") return "未知（尚未核實）";
  if (value?.status === "not-applicable") return "不適用";
  return "未提供";
}

function renderGameChange(record, parent) {
  const payload = record.payload;
  if (record.owner !== "source" || record.kind !== "game-change" || payload.changeId !== record.recordId) {
    throw new Error("遊戲變更識別記錄無效。");
  }
  const article = document.createElement("article");
  article.className = "game-change";
  appendText(article, "h3", "", "Source 變更樣本");
  appendText(article, "p", "", "變更識別：" + payload.changeId);
  for (const field of payload.changedFields) {
    const label = field.field === "value" ? "數值" : "其他欄位";
    appendText(article, "p", "change-row", label + "：" + formatValue(field.before) + " → " + formatValue(field.after));
  }
  parent.append(article);
}

async function loadPreview() {
  const status = byId("status");
  try {
    const version = parseJson(await fetchBytes("/version.json"), "version.json");
    if (version.schema_version !== 2 || version.package_kind !== "fixture" || !Array.isArray(version.game_releases) || version.game_releases.length !== 1) {
      throw new Error("這不是隔離 fixture 預覽套件。");
    }
    const release = version.game_releases[0];
    if (typeof release.content_version !== "string" || !contentVersionPattern.test(release.content_version) ||
        release.data_revision !== version.data_revision || !release.manifest_path.startsWith("/data/")) {
      throw new Error("資料版本入口無效。");
    }
    const manifestUrl = new URL(release.manifest_path, location.origin + "/");
    if (manifestUrl.origin !== location.origin) throw new Error("資料必須來自同一來源。");
    const manifest = await checkedJson(manifestUrl, release.manifest_sha256, "manifest");
    if (manifest.schemaVersion !== "2.0.0" || manifest.compatibility?.dataContractMajor !== 2 ||
        !manifest.compatibility.requiredFeatures.includes("official-errata-details-v1") ||
        manifest.fixtureOnly !== true || manifest.publicationEligible !== false || manifest.dataRevision !== version.data_revision ||
        manifest.contentVersion !== release.content_version) {
      throw new Error("預覽套件狀態不符，已停止載入。");
    }
    const fileByKind = new Map(manifest.files.map(file => [file.kind, file]));
    if (domainKinds.some(kind => !fileByKind.has(kind)) || fileByKind.size !== domainKinds.length) {
      throw new Error("共享資料域不完整。");
    }
    const domains = new Map();
    for (const kind of domainKinds) {
      const file = fileByKind.get(kind);
      const url = new URL(file.path, manifestUrl);
      if (url.origin !== location.origin) throw new Error("資料必須來自同一來源。");
      const domain = await checkedJson(url, file.sha256, kind);
      if (domain.fixtureOnly !== true || domain.publicationEligible !== false) throw new Error("資料域不再是隔離 fixture。");
      domains.set(kind, domain);
    }

    const terms = domains.get("terms").records.filter(record => record.kind === "term-localization");
    if (terms.some(record => record.owner !== "web" || record.locale !== "zh-TW")) throw new Error("繁體中文術語記錄無效。");
    const termsById = new Map(terms.map(record => [record.entityRef, record.payload]));
    if (termsById.size === 0) throw new Error("沒有可顯示的繁體中文術語記錄。");
    const termsContent = byId("terms-content");
    for (const term of terms) {
      const article = document.createElement("article");
      article.className = "term";
      appendText(article, "h3", "", term.payload.label);
      appendText(article, "p", "", term.payload.definition);
      termsContent.append(article);
    }

    const presentationRecords = [];
    for (const kind of ["skills", "blessings", "weapons"]) {
      presentationRecords.push(...domains.get(kind).records.filter(record => record.kind === "presentation"));
    }
    if (presentationRecords.length === 0) throw new Error("沒有可顯示的繁體中文呈現記錄。");
    const content = byId("content");
    for (const record of presentationRecords) renderPresentation(record, content, termsById);

    const changes = domains.get("game-changes").records.filter(record => record.kind === "game-change");
    if (changes.length === 0) throw new Error("沒有可顯示的遊戲變更識別記錄。");
    const changesContent = byId("changes-content");
    for (const change of changes) renderGameChange(change, changesContent);

    const preview = parseJson(await fetchBytes("/preview.json"), "preview.json");
    if (preview.fixtureOnly !== true || preview.publicationEligible !== false) throw new Error("預覽公告狀態不符。");
    const announcementRoot = byId("announcement-content");
    for (const announcement of preview.announcements) {
      if (announcement.owner !== "web" || announcement.kind !== "announcement" || announcement.locale !== "zh-TW") {
        throw new Error("預覽公告記錄無效。");
      }
      const article = document.createElement("article");
      article.className = "announcement-card";
      appendText(article, "h3", "", announcement.payload.title);
      for (const block of announcement.payload.blocks) {
        if (block.type === "heading") appendText(article, "h4", "", block.text);
        else if (block.type === "paragraph") appendText(article, "p", "", block.text);
        else throw new Error("預覽公告區塊類型無效。");
      }
      announcementRoot.append(article);
    }
    byId("revision").textContent = "資料版本：" + version.game_version + " · 內容版本：" + release.content_version + " · 資料修訂：" + version.data_revision;
    status.textContent = "已載入隔離 fixture 預覽；內容尚未核准發布。";
  } catch (error) {
    status.dataset.state = "error";
    status.textContent = error instanceof Error ? error.message : "隔離預覽載入失敗。";
  }
}

await loadPreview();
`
};
