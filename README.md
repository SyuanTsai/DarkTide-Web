# 暗潮繁體資料庫

目前是可在本機建置的網站底座，使用**完全虛構**的技能、武器與祝福資料。頁面與內容關係可以驗證；真實遊戲內容及圖示尚未加入，也尚未部署。

需要 Node.js 24 以上。在專案目錄執行：

```powershell
npm test
npm run build
python -m http.server 8000 -d dist
```

開啟 `http://localhost:8000/` 預覽。建置結果位於本機 `dist/`，其中 `build-manifest.json` 明確標示 `release_ready: false`。沒有套件安裝步驟或遠端抓取。

內容由 `fixtures/site.mjs` 輸入，`src/content/validate.mjs` 檢查 ID、武器／型號／祝福關係與 canonical route，`src/site/render.mjs` 產生繁體中文靜態頁面。若日後在某頁使用 Games Lantern 授權的祝福或天賦圖示，該圖示記錄需帶來源連結資訊，產生器會在使用頁放上可見的直接連結。本站不複製或翻譯 Games Lantern 的原創文字，也不以程式爬取其圖示。

`worker/index.mjs` 是私有 R2 讀取層：以 `ACTIVE_RELEASE` 指向 `CONTENT_BUCKET` 中 `releases/<id>/` 的固定版本，只服務其 manifest 列出的檔案，並核對版本 ID、來源鎖定 ID、逐檔雜湊格式及檔案／位元組總數。虛構建置的 `release_ready: false` 會被拒絕。因目前資產網址未帶版本號，Worker 對頁面和資產都使用短期快取，避免切換版本後沿用舊 CSS。現階段沒有 Cloudflare 資源、部署設定或正式 release；此模組以模擬 R2 的單元測試驗證。
