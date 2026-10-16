export const previewAssets = {
  html: `<!doctype html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, noarchive">
  <meta name="referrer" content="no-referrer">
  <title>Darktide 繁體中文資料</title>
  <link rel="stylesheet" href="/preview.css">
  <script type="module" src="/preview.js"></script>
</head>
<body>
  <header class="site-header">
    <h1>Darktide 繁體中文資料</h1>
    <p id="package-warning" class="warning" role="note">此頁僅供資料預覽，內容尚未核准，不代表已確認的遊戲內容。</p>
  </header>
  <main id="main" aria-labelledby="content-heading">
    <section class="announcement" aria-labelledby="announcement-heading">
      <h2 id="announcement-heading">公告</h2>
      <div id="announcement-content"></div>
    </section>
    <section aria-labelledby="content-heading">
      <h2 id="content-heading">技能、祝福與武器</h2>
      <p id="status" role="status" aria-live="polite">正在載入隔離預覽資料…</p>
      <div id="content" class="cards"></div>
    </section>
    <section aria-labelledby="changes-heading">
      <h2 id="changes-heading">遊戲更新</h2>
      <div id="changes-content"></div>
    </section>
    <section aria-labelledby="terms-heading">
      <h2 id="terms-heading">名詞說明</h2>
      <div id="terms-content"></div>
    </section>
    <p id="revision" class="revision"></p>
  </main>
  <footer>目前顯示的內容尚待審核。</footer>
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
.cards > .card:has(.chainaxe-view) { grid-column: 1 / -1; }
.card, .term, .announcement-card { padding: 1rem; border-radius: .4rem; background: #252c2e; }
.card h3, .term h3, .announcement-card h3, .game-change h3 { margin-top: 0; color: #e5c18d; }
.official-label, .errata-label { color: #d8aa68; font-weight: 700; }
.errata { padding: .8rem; border-inline-start: .25rem solid #d8aa68; background: #332a1e; white-space: pre-wrap; }
.game-change { padding: 1rem; border-radius: .4rem; background: #252c2e; }
.record-image { display: flex; flex-direction: column; align-items: center; gap: .35rem; max-width: 100%; margin: 0 0 1rem; }
.record-image img { width: 8rem; height: 8rem; max-width: 100%; object-fit: contain; border-radius: .35rem; background: #141719; }
.record-image figcaption { color: #bac1c1; font-size: .75rem; line-height: 1.3; }
.record-image a { color: #e5c18d; }
.tier-selector-label { display: flex; align-items: center; gap: .6rem; margin-block: .8rem; }
.tier-selector-label select { min-height: 2.5rem; padding-inline: .6rem; color: inherit; background: #141719; border: 1px solid #747d7e; border-radius: .3rem; font: inherit; }
.detail-section h4 { margin: .9rem 0 .35rem; color: #d8aa68; }
.detail-section ul { margin: 0; padding-inline-start: 1.35rem; }
.detail-section li { margin-block: .25rem; white-space: pre-wrap; }
.chainaxe-view { margin-block: 1rem; padding-top: .8rem; border-top: 1px solid #414749; }
.chainaxe-view h4, .chainaxe-stat-section h5 { margin: .6rem 0 .35rem; color: #d8aa68; }
.chainaxe-attack-modes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .65rem; }
.chainaxe-attack-mode { min-width: 0; padding: .65rem; border-radius: .35rem; background: #1c2123; }
.chainaxe-attack-mode h5 { margin: 0 0 .45rem; }
.chainaxe-attack-segments { display: flex; flex-wrap: wrap; gap: .35rem; }
.chainaxe-attack-segment { padding: .2rem .45rem; border: 1px solid #596365; border-radius: 999px; color: #f3eee7; font-size: .85rem; }
.chainaxe-stat-section { margin-top: .75rem; }
.chainaxe-stat-rows { display: grid; gap: .35rem; margin: 0; padding: 0; list-style: none; }
.chainaxe-stat-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .4rem .75rem; padding: .4rem .5rem; border-radius: .3rem; background: #252c2e; }
.chainaxe-stat-value { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
.chainaxe-view-note { margin: .75rem 0 0; color: #bac1c1; font-size: .9rem; }
.official-text { white-space: pre-wrap; }
#status[data-state="error"] { color: #ffb8a8; }
.revision, footer { color: #bac1c1; font-size: .85rem; }
footer { padding-block: 1rem 2rem; }
@media (max-width: 420px) {
  .chainaxe-attack-modes { grid-template-columns: 1fr; }
  .chainaxe-stat-row { grid-template-columns: 1fr; }
  .chainaxe-stat-value { text-align: left; white-space: normal; }
}
`,
  js: `const domainKinds = ["skills", "blessings", "weapons", "terms", "game-changes"];
const contentVersionPattern = /^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$/;
const blessingTierFeature = "blessing-tier-presentations-v1";
const detailLabels = {
  effects: "效果",
  conditions: "條件",
  calculation: "計算",
  notes: "補充說明",
  extra: "額外說明"
};
const imageByRecordId = new Map([
  ["web:presentation:psyker-brain-burst-improved", {
    src: "https://github.com/user-attachments/assets/215cb557-8544-4d05-876a-871e70dc093a",
    alt: "顱腦崩裂圖片"
  }],
  ["web:presentation:chainaxe-p1-movement-speed", {
    src: "https://github.com/user-attachments/assets/8a6ba0a3-cdaf-403f-a87b-3743b3fcfe97",
    alt: "提速圖片"
  }]
]);
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

function renderImage(record, article) {
  const asset = imageByRecordId.get(record.recordId);
  if (!asset) return;
  const figure = document.createElement("figure");
  figure.className = "record-image";
  const image = document.createElement("img");
  image.setAttribute("src", asset.src);
  image.setAttribute("alt", asset.alt);
  image.setAttribute("width", "128");
  image.setAttribute("height", "128");
  image.setAttribute("loading", "lazy");
  image.setAttribute("decoding", "async");
  figure.append(image);
  const caption = document.createElement("figcaption");
  const credit = document.createElement("a");
  credit.setAttribute("href", "https://darktide.gameslantern.com");
  credit.setAttribute("aria-label", "圖示來源：Games Lantern");
  credit.setAttribute("title", "圖示來源：Games Lantern");
  credit.textContent = "圖示來源：Games Lantern";
  caption.append(credit);
  figure.append(caption);
  article.append(figure);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function ratioAsPercentDecimal(decimal) {
  if (typeof decimal !== "string" || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(decimal)) throw new Error("階級數值來源無效。");
  const [whole, fraction = ""] = decimal.split(".");
  const digits = whole + fraction;
  const shiftedPosition = whole.length + 2;
  const shifted = shiftedPosition >= digits.length
    ? digits + "0".repeat(shiftedPosition - digits.length)
    : digits.slice(0, shiftedPosition) + "." + digits.slice(shiftedPosition);
  const [integerPart, fractionalPart] = shifted.split(".");
  const normalizedInteger = integerPart.replace(/^0+(?=[0-9])/, "");
  const normalizedFraction = fractionalPart?.replace(/0+$/, "");
  return normalizedFraction ? normalizedInteger + "." + normalizedFraction : normalizedInteger;
}

function identityOf(entry) {
  return {
    sourceRef: entry.sourceRef, sourceLocale: entry.sourceLocale, resource: entry.resource,
    sourceHash: entry.sourceHash, key: entry.key, occurrence: entry.occurrence,
    sourceText: entry.sourceText, sourceTextSha256: entry.sourceTextSha256, segments: entry.segments
  };
}

function validateTierPresentations(record, recordsById) {
  const tiered = record.payload.tierPresentations;
  if (!tiered || Object.keys(tiered).sort().join(",") !== "defaultTier,options,variantRef" ||
      typeof tiered.variantRef !== "string" || tiered.defaultTier !== 4 || !Array.isArray(tiered.options) || tiered.options.length !== 4) {
    throw new Error("祝福階級資料無效。");
  }
  const blessing = recordsById.get(record.entityRef);
  const variant = recordsById.get(tiered.variantRef);
  if (record.owner !== "web" || record.kind !== "presentation" || blessing?.kind !== "blessing" ||
      variant?.kind !== "blessing-variant" || variant.payload?.blessingRef !== record.entityRef ||
      !blessing.payload?.variantRefs?.includes(tiered.variantRef) ||
      !sameJson(variant.payload.definedTiers, [1, 2, 3, 4])) {
    throw new Error("祝福階級與來源資料不一致。");
  }
  if (!sameJson(record.payload.official, tiered.options[3]?.official) ||
      !sameJson(record.payload.detailSections, tiered.options[3]?.detailSections)) {
    throw new Error("預設階級與祝福內容不一致。");
  }
  const rootEnglishIdentity = identityOf(record.payload.official);
  const rootChineseIdentity = identityOf(record.payload.official.localizations?.["zh-TW"] ?? {});
  let timeParamAtDefault;
  for (const [index, option] of tiered.options.entries()) {
    const tier = index + 1;
    if (!option || Object.keys(option).sort().join(",") !== "detailSections,official,tier" || option.tier !== tier ||
        !option.official || !option.detailSections ||
        option.official.sourceLocale !== "en" ||
        option.official.localizations?.["zh-TW"]?.origin !== "official" ||
        !sameJson(identityOf(option.official), rootEnglishIdentity) ||
        !sameJson(identityOf(option.official.localizations["zh-TW"]), rootChineseIdentity)) {
      throw new Error("祝福階級缺少相同的英文與繁體中文官方文字來源。");
    }
    const chinese = option.official.localizations["zh-TW"];
    const movementParam = option.official.params?.find(param => param.name === "movement_speed");
    const chineseMovementParam = chinese.params?.find(param => param.name === "movement_speed");
    const timeParam = option.official.params?.find(param => param.name === "time");
    const chineseTimeParam = chinese.params?.find(param => param.name === "time");
    const expectedClaimId = "darktide:claim:" + tiered.variantRef.replace(/^darktide:blessing-variant:/, "") + "-tier" + tier + "-display-percent";
    const claim = recordsById.get(expectedClaimId);
    const ratio = variant.payload.tierValues?.find(item => item.tier === tier)?.value;
    const expectedProperty = "description.format_values.movement_speed.defined_tier_" + tier + "_display_percent";
    const displayDecimal = claim?.payload?.value?.decimal;
    const isZeroDisplay = typeof displayDecimal === "string" && /^-?0(?:\.0+)?$/.test(displayDecimal);
    const expectedResolvedValue = typeof displayDecimal !== "string"
      ? null
      : (displayDecimal.startsWith("-") || isZeroDisplay ? "" : "+") + displayDecimal + "%";
    if (!movementParam || !chineseMovementParam || movementParam.bindingRef !== expectedClaimId ||
        chineseMovementParam.bindingRef !== expectedClaimId || movementParam.format !== "signed-percent" ||
        movementParam.resolvedValue !== expectedResolvedValue || chineseMovementParam.format !== "signed-percent" ||
        chineseMovementParam.resolvedValue !== movementParam.resolvedValue) {
      throw new Error("祝福階級官方文字未綁定同一階級數值。");
    }
    if (!claim || claim.kind !== "claim" || claim.payload?.targetRef !== tiered.variantRef || claim.payload?.property !== expectedProperty ||
        claim.payload?.basis !== "code-derived" || !sameJson(claim.payload?.context, {}) ||
        claim.payload?.value?.status !== "known" || claim.payload?.value?.unit !== "percent" ||
        claim.payload.value.decimal !== ratioAsPercentDecimal(ratio?.decimal)) {
      throw new Error("祝福階級數值與來源主張不一致。");
    }
    if (!timeParam || !chineseTimeParam || !sameJson(option.official.params, chinese.params) || timeParam.bindingRef !== chineseTimeParam.bindingRef ||
        timeParam.resolvedValue !== chineseTimeParam.resolvedValue || timeParam.format !== "plain-number") {
      throw new Error("祝福階級的持續時間資料不一致。");
    }
    if (index === 0) timeParamAtDefault = timeParam;
    else if (!sameJson(timeParamAtDefault, timeParam)) throw new Error("祝福階級不得改變持續時間來源。");
    for (const section of ["effects", "conditions", "calculation", "notes", "extra"]) {
      if (!Array.isArray(option.detailSections[section])) throw new Error("祝福階級缺少完整的繁體中文說明。");
    }
  }
}

function formatChainaxeDisplay(value, omitStaminaUnit = false) {
  if (!value || value.displayValue?.status !== "known" || typeof value.displayValue.decimal !== "string" ||
      !["fixed-2", "fixed-2-signed", "percentage-fixed-2", "multiplier-percent-fixed-2-signed", "floor-fixed-2"].includes(value.displayFormat)) {
    throw new Error("鏈斧素質顯示值無效。");
  }
  let decimal = value.displayValue.decimal;
  if (["fixed-2-signed", "multiplier-percent-fixed-2-signed"].includes(value.displayFormat) && !decimal.startsWith("-")) decimal = "+" + decimal;
  const suffixByUnit = {
    "attack-power-point": "",
    "percent": "%",
    "stamina-point": " 耐力",
    "stamina-point-per-second": " 耐力／秒",
    "dodge-count": " 次",
    "ratio": ""
  };
  if (!Object.hasOwn(suffixByUnit, value.displayValue.unit)) throw new Error("鏈斧素質單位無效。");
  const suffix = omitStaminaUnit && value.displayValue.unit === "stamina-point" ? "" : suffixByUnit[value.displayValue.unit];
  return decimal + suffix;
}

function renderChainaxeWeaponView(view, parent) {
  const exactKeys = (value, keys) => value && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
  if (!exactKeys(view, ["markLabel", "attackHeading", "comparisonHeading", "note", "attackModes", "statSections"]) ||
      !["Mk IV", "Mk XII"].includes(view.markLabel) || !Array.isArray(view.attackModes) || !Array.isArray(view.statSections)) {
    throw new Error("鏈斧武器資料無效。");
  }
  const expectedRoles = view.markLabel === "Mk IV"
    ? [{ mode: "light", targetRole: "single-target", count: 4 }, { mode: "heavy", targetRole: "multi-target-cleave", count: 2 }]
    : [{ mode: "light", targetRole: "multi-target-cleave", count: 2 }, { mode: "heavy", targetRole: "single-target", count: 2 }];
  if (view.attackModes.length !== expectedRoles.length || view.attackModes.some((mode, index) =>
    !exactKeys(mode, ["mode", "segments"]) || mode.mode !== expectedRoles[index].mode || !Array.isArray(mode.segments) ||
    mode.segments.length !== expectedRoles[index].count || mode.segments.some((segment, segmentIndex) =>
      !exactKeys(segment, ["index", "targetRole"]) || segment.index !== segmentIndex + 1 || segment.targetRole !== expectedRoles[index].targetRole))) {
    throw new Error("鏈斧攻擊段定位資料無效。");
  }
  const expectedStats = [
    ["chainaxe_dps_stat", "傷害"], ["chainaxe_armor_pierce_stat", "護甲穿透"], ["chainaxe_defence_stat", "防禦"],
    ["chainaxe_sawing_stat", "鏈鋸"], ["chainaxe_mobility_stat", "移動性"]
  ];
  const expectedCounts = view.markLabel === "Mk IV" ? [2, 5, 3, 5, 4] : [2, 6, 3, 4, 4];
  if (view.statSections.length !== expectedStats.length || view.statSections.some((section, index) =>
    !exactKeys(section, ["sourceStat", "label", "rows"]) || section.sourceStat !== expectedStats[index][0] ||
    section.label !== expectedStats[index][1] || !Array.isArray(section.rows) || section.rows.length !== expectedCounts[index])) {
    throw new Error("鏈斧素質比較資料不完整。");
  }
  if (view.statSections.reduce((count, section) => count + section.rows.length, 0) !== 19) throw new Error("鏈斧素質比較資料不完整。");
  const armorRows = view.statSections[1].rows;
  const requiredArmorNames = view.markLabel === "Mk IV" ? ["防彈護甲", "甲殼護甲", "不屈"] : ["防彈護甲", "甲殼護甲", "不屈", "被感染"];
  if (requiredArmorNames.some(name => !armorRows.some(row => row.label.includes(name)))) throw new Error("鏈斧護甲對照資料不完整。");
  const banned = /smiter|linesman|tank|resistant|disgustingly_resilient|chainaxe_|Source|claim|ratio|point|review|provenance|coverage|status/i;
  const viewText = [view.attackHeading, view.comparisonHeading, view.note, ...view.statSections.flatMap(section => [section.label, ...section.rows.map(row => row.label)])].join(" ");
  if (banned.test(viewText)) throw new Error("鏈斧玩家文字含有不支援的欄位名稱。");

  const section = document.createElement("section");
  section.className = "chainaxe-view";
  appendText(section, "h4", "", view.markLabel);
  appendText(section, "p", "chainaxe-view-heading", view.attackHeading);
  const modes = document.createElement("div");
  modes.className = "chainaxe-attack-modes";
  const roleLabels = { "single-target": "單體", "multi-target-cleave": "群體（順劈）" };
  for (const mode of view.attackModes) {
    const modeCard = document.createElement("div");
    modeCard.className = "chainaxe-attack-mode";
    appendText(modeCard, "h5", "", mode.mode === "light" ? "輕攻擊" : "重攻擊");
    const segments = document.createElement("div");
    segments.className = "chainaxe-attack-segments";
    for (const segment of mode.segments) {
      const roleLabel = roleLabels[segment.targetRole];
      if (!roleLabel) throw new Error("鏈斧攻擊段定位類型無效。");
      appendText(segments, "span", "chainaxe-attack-segment", "第 " + segment.index + " 段・" + roleLabel);
    }
    modeCard.append(segments);
    modes.append(modeCard);
  }
  section.append(modes);
  appendText(section, "h4", "", view.comparisonHeading);
  for (const stat of view.statSections) {
    const statSection = document.createElement("section");
    statSection.className = "chainaxe-stat-section";
    appendText(statSection, "h5", "", stat.label);
    const rows = document.createElement("ul");
    rows.className = "chainaxe-stat-rows";
    for (const row of stat.rows) {
      if (typeof row.label !== "string" || !Array.isArray(row.claimRefs) || row.claimRefs.length !== 2 ||
          !Array.isArray(row.values) || row.values.length !== 2 || row.values.some((value, index) =>
            value.claimRef !== row.claimRefs[index] || value.comparisonStat?.status !== "known" || value.comparisonStat.unit !== "percent" ||
            value.comparisonStat.decimal !== (index === 0 ? "60" : "80"))) {
        throw new Error("鏈斧素質列未綁定 60% 與 80% 比較值。");
      }
      const item = document.createElement("li");
      item.className = "chainaxe-stat-row";
      appendText(item, "span", "chainaxe-stat-label", row.label);
      const omitStaminaUnit = row.label === "耐力";
      appendText(item, "span", "chainaxe-stat-value", "60%：" + formatChainaxeDisplay(row.values[0], omitStaminaUnit) + " → 80%：" + formatChainaxeDisplay(row.values[1], omitStaminaUnit));
      rows.append(item);
    }
    statSection.append(rows);
    section.append(statSection);
  }
  appendText(section, "p", "chainaxe-view-note", view.note);
  parent.append(section);
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
  renderImage(record, article);
  let tierSelect;
  if (payload.tierPresentations) {
    const selectorLabel = document.createElement("label");
    selectorLabel.className = "tier-selector-label";
    selectorLabel.textContent = "選擇階級：";
    tierSelect = document.createElement("select");
    tierSelect.setAttribute("aria-label", "選擇階級");
    for (const option of payload.tierPresentations.options) {
      const element = document.createElement("option");
      element.setAttribute("value", String(option.tier));
      element.value = String(option.tier);
      element.textContent = "第 " + option.tier + " 階級";
      tierSelect.append(element);
    }
    tierSelect.value = String(payload.tierPresentations.defaultTier);
    selectorLabel.append(tierSelect);
    article.append(selectorLabel);
  }
  const presentationBody = document.createElement("div");
  presentationBody.className = "presentation-body";
  const renderBody = selectedOption => {
    presentationBody.replaceChildren();
    const displayedPayload = selectedOption
      ? { ...payload, official: selectedOption.official, detailSections: selectedOption.detailSections }
      : payload;
    if (displayedPayload.official && !displayedPayload.weaponView) {
      const localized = displayedPayload.official.localizations?.["zh-TW"];
      if (!localized) throw new Error("官方文字缺少繁體中文內容，預覽不會以英文回退。");
      if (localized.origin === "faithful-translation") {
        if (typeof localized.text !== "string" || typeof localized.sha256 !== "string") throw new Error("繁體中文忠實翻譯資料無效。");
        appendText(presentationBody, "p", "official-label", "官方原句（忠實翻譯）");
      } else if (localized.origin === "official") {
        if (localized.sourceLocale !== "zh-TW" || !/^[a-f0-9]{8}$/.test(localized.sourceHash) ||
            localized.key !== null && typeof localized.key !== "string" ||
            typeof localized.sourceText !== "string" || typeof localized.resolvedText !== "string" ||
            localized.text !== localized.resolvedText || localized.sha256 !== localized.resolvedTextSha256 ||
            !/^[a-f0-9]{64}$/.test(localized.sourceTextSha256) || !/^[a-f0-9]{64}$/.test(localized.resolvedTextSha256) ||
            !Array.isArray(localized.segments) || localized.segments.some(segment => !["literal", "template-placeholder"].includes(segment.kind)) ||
            localized.segments.map(segment => segment.text).join("") !== localized.sourceText || /\\{[a-z][a-z0-9_]*:%s\\}/.test(localized.text)) {
          throw new Error("繁體中文官方原文身分或解析結果無效。");
        }
        appendText(presentationBody, "p", "official-label", "繁體中文官方原文（待審）");
      } else {
        throw new Error("繁體中文官方文字來源類型無效。");
      }
      appendText(presentationBody, "p", "official-text", localized.text);
      renderErrata(displayedPayload.official, payload.errata ?? [], presentationBody);
    }
    if (displayedPayload.weaponView) renderChainaxeWeaponView(displayedPayload.weaponView, presentationBody);
  for (const [key, label] of Object.entries(detailLabels)) {
    const items = displayedPayload.detailSections?.[key];
    if (!Array.isArray(items)) throw new Error("繁體中文呈現缺少五節資料。");
    if (items.length === 0) continue;
    const section = document.createElement("section");
    section.className = "detail-section";
    appendText(section, "h4", "", label);
    const list = document.createElement("ul");
    for (const item of items) {
      const detail = document.createElement("li");
      if (typeof item.text === "string") appendText(detail, "span", "", item.text);
      if (item.termRef) {
        const term = termsById.get(item.termRef);
        if (!term) throw new Error("術語參照缺少繁體中文資料。");
        appendText(detail, "strong", "", term.label + "：");
        appendText(detail, "span", "", term.definition);
      }
      list.append(detail);
    }
    section.append(list);
    presentationBody.append(section);
  }
  };
  const initialOption = payload.tierPresentations?.options.find(option => option.tier === payload.tierPresentations.defaultTier);
  renderBody(initialOption);
  if (tierSelect) {
    tierSelect.addEventListener("change", () => {
      const selectedTier = payload.tierPresentations.options.find(option => String(option.tier) === tierSelect.value);
      if (!selectedTier) throw new Error("選擇的祝福階級不存在。");
      renderBody(selectedTier);
    });
  }
  article.append(presentationBody);
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
  appendText(article, "h3", "", "遊戲內容變更");
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
    const isFixturePackage = version.package_kind === "fixture";
    const isPendingPreview = version.package_kind === "pending-preview";
    if (version.schema_version !== 2 || (!isFixturePackage && !isPendingPreview) || !Array.isArray(version.game_releases) || version.game_releases.length !== 1) {
      throw new Error("這不是隔離 fixture 或待審候選預覽套件。");
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
        !Array.isArray(manifest.compatibility.requiredFeatures) ||
        !manifest.compatibility.requiredFeatures.includes("official-errata-details-v1") ||
        manifest.compatibility.requiredFeatures.some(feature => !["official-errata-details-v1", "official-native-localizations-v1", blessingTierFeature].includes(feature)) ||
        manifest.fixtureOnly !== isFixturePackage || manifest.publicationEligible !== false || manifest.dataRevision !== version.data_revision ||
        manifest.contentVersion !== release.content_version) {
      throw new Error("預覽套件狀態不符，已停止載入。");
    }
    const fileByKind = new Map(manifest.files.map(file => [file.kind, file]));
    if (domainKinds.some(kind => !fileByKind.has(kind)) || fileByKind.size !== domainKinds.length) {
      throw new Error("共享資料域不完整。");
    }
    const domainEntries = await Promise.all(domainKinds.map(async kind => {
      const file = fileByKind.get(kind);
      const url = new URL(file.path, manifestUrl);
      if (url.origin !== location.origin) throw new Error("資料必須來自同一來源。");
      const domain = await checkedJson(url, file.sha256, kind);
      if (domain.fixtureOnly !== isFixturePackage || domain.publicationEligible !== false) throw new Error("資料域狀態與隔離預覽套件不符。");
      return [kind, domain];
    }));
    const domains = new Map(domainEntries);
    const hasNativeOfficialLocalizations = [...domains.values()].some(domain => domain.records.some(record =>
      record.payload?.official?.localizations?.["zh-TW"]?.origin === "official"));
    if (hasNativeOfficialLocalizations !== manifest.compatibility.requiredFeatures.includes("official-native-localizations-v1")) {
      throw new Error("官方繁體中文資料與套件功能標記不一致。");
    }

    const presentationRecords = [];
    for (const kind of ["skills", "blessings", "weapons"]) {
      presentationRecords.push(...domains.get(kind).records.filter(record => record.kind === "presentation"));
    }
    if (presentationRecords.length === 0) throw new Error("沒有可顯示的繁體中文呈現記錄。");
    const recordsById = new Map([...domains.values()].flatMap(domain => domain.records.map(record => [record.recordId, record])));
    const hasBlessingTierPresentations = presentationRecords.some(record => Object.hasOwn(record.payload ?? {}, "tierPresentations"));
    if (hasBlessingTierPresentations !== manifest.compatibility.requiredFeatures.includes(blessingTierFeature)) {
      throw new Error("祝福階級資料與套件功能標記不一致。");
    }
    for (const record of presentationRecords) if (record.payload?.tierPresentations) validateTierPresentations(record, recordsById);
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
    const content = byId("content");
    for (const record of presentationRecords) renderPresentation(record, content, termsById);

    const changes = domains.get("game-changes").records.filter(record => record.kind === "game-change");
    const changesContent = byId("changes-content");
    if (changes.length === 0) {
      if (!isPendingPreview) throw new Error("隔離 fixture 預覽缺少遊戲變更識別記錄。");
      appendText(changesContent, "p", "change-empty", "此預覽尚未收錄遊戲更新內容。");
    } else {
      for (const change of changes) renderGameChange(change, changesContent);
    }

    const preview = parseJson(await fetchBytes("/preview.json"), "preview.json");
    if (preview.fixtureOnly !== isFixturePackage || preview.publicationEligible !== false ||
        isPendingPreview && preview.candidatePreviewOnly !== true ||
        isFixturePackage && Object.hasOwn(preview, "candidatePreviewOnly") && preview.candidatePreviewOnly !== false) {
      throw new Error("預覽公告狀態不符。");
    }
    if (isPendingPreview) {
      if (typeof preview.warningText !== "string" || preview.warningText.length === 0) throw new Error("待審候選缺少繁體中文風險提示。");
      byId("package-warning").textContent = "說明文字與遊戲版本尚未核對，內容仍待審核。";
    }
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
    status.textContent = "資料已載入，內容仍待審核。";
    byId("revision").textContent = "";
  } catch (error) {
    status.dataset.state = "error";
    status.textContent = error instanceof Error ? error.message : "隔離預覽載入失敗。";
  }
}

await loadPreview();
`
};
