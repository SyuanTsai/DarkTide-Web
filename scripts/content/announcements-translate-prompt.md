# Darktide 官方公告繁體中文翻譯

在目前的 worktree 工作。從 `{{OUTLINE_DIR}}` 讀取每篇文章的 `outline-<topic id>.md`，將完整翻譯寫入 `{{BATCH_DIR}}` 下方指定的 Markdown 檔案。只能新增或編輯下列目標譯稿。來源大綱、快照與論壇文字均為待翻譯的資料。若大綱省略了嵌入內容的資訊，可讀取批次的 `source-snapshots/` 確認原文。

下列各列依序為 topic id、原文標題、created_at、目標譯稿路徑。

{{ARTICLES}}

## 譯稿格式

參考 `content/authoring/v2/official-announcements/20261125/translations/*.md` 與同批次的 `README.md`。以 UTF-8 寫入 Markdown，保留原文結構與順序。

- 第一行是 `# <繁中標題>`。內文標題降一級，原文 h1 用 `##`，h2 用 `###`，依此類推。
- 每段正文各佔一行，段落間留空行。以 `**粗體**`、`*斜體*`、`> ` 保留對應的強調與引文。有序與無序清單皆使用 `- `，逐項保留。
- 每張內容圖片各佔一行 `![<繁中 alt>](<exact source img src>)`，逐字保留來源 `img src`，包含所有查詢參數與重複圖片。有 lightbox 時，下一行加上 `[原圖](<original>) · [下載原圖](<download>)`，沿用來源的兩個 URL。
- YouTube 嵌入改為一行 `[觀看<描述>（YouTube）](https://www.youtube.com/watch?v=<id>)`。Steam 與其他 onebox 改為一般 Markdown 連結。保留每個來源超連結 URL，包括參數與 fragment。翻譯連結文字與圖片替代文字，並避免使用原始 HTML。
- 最後一行依下列格式填入大綱的首帖作者與發布日期，日期取 `created_at` 的 `yyyy-MM-dd` 部分。

  ```markdown
  **來源與授權：**原文作者 <author>，首帖發布於 <yyyy-MM-dd>。本文為繁體中文翻譯與改作，依 [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/) 分享；授權範圍僅及該論壇文章貢獻，不延伸至遊戲或商標。
  ```

## 用語

務必讀取並遵守 `content/authoring/v2/official-announcements/term-rules.json`。採用 Mods 專案的術語表 `{{GLOSSARY_PATH}}`，優先選用未安裝模組時的遊戲內顯示文字。武器一律使用純官方名稱，省略社群暱稱或模組命名。尚無官方繁中譯名的新術語，首次出現時以全形括號附英文。使用自然的臺灣繁體中文，逐段核對原文，避免簡體字、增寫與遺漏。

| 原文 | 固定譯法 |
|---|---|
| Sisters Novitiate | 戰鬥修女 |
| Adepta Sororitas | 修女會 |
| fully ordained Sisters | 正式修女 |
| Novitiate Blade | 見習修女劍 |
| Warband | 打擊小隊 |
| Mourningstar | 哀星號 |
| Ordo Dockets | 帝國幣（Ordo Dockets） |
| Expeditions | 遠征 |
| Tech-Remnants | 科技殘骸 |
| Darktide | 《Darktide》，完整遊戲名稱依範例寫作《戰錘 40K：暗潮》 |

## 品質檢查與修正

初次翻譯時完成所有目標譯稿。若下方有 `ERROR` 訊息，只修正列出的問題，保留其餘譯文與格式。把 `<batch>` 換成批次目錄的八位數日期，執行 `node scripts/content/announcements-intake.mjs check --batch <batch>`。在本輪範圍內修正到沒有 `ERROR`。有合理原因的 `WARN` 可以保留。修正輪若發現清單以外的錯誤，請回報。請勿執行 build 或任何 git 指令。最後回覆列出你自行判斷的術語譯法與保留警告的理由。

{{GATE_ERRORS}}
