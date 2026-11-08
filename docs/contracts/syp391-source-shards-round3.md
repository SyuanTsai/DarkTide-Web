# Source-Data 分片驗收原則

正式傳輸契約與容量上限維護於 [WP5 Source-Data 驗收契約](wp5-source-data-acceptance.md)。

建置驗證須逐位元組比對重組資料與來源，並檢查每片及總雜湊。靜態產物驗證須檢查檔案閉包及所有輸出檔的大小；部署驗證與監控須先驗證 transport manifest，再下載所宣告的資料並核對雜湊。監控僅在 manifest 回傳 404 時回退至舊單檔。超過單檔輸出上限時，部署驗證以 HEAD 確認舊單檔 URL 回傳 404。
