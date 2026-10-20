# W08 候選檢查

此目錄是待人類工程驗收、明確不可發布的共用資料候選。W07 已驗收，詳見 compiler-delivery.md；正式 field receipts 仍為零。四域共用一份 manifest，沒有 Extension 副本、version.json 或 active pointer。

固定 compiler commit：`cd0d9ab88e9014ce303312f8f0bb0b043be90e7e`；Source：`f22b4ae2e1d3b4887f3741464e3c9bf507399db6`；authoring：`40c477835353bd9513f202d6b82609a580afeabd`。最終 Web 完整 SHA 由同輪 Jira 交付留言固定，`git log --diff-filter=A -1 --format=%H -- docs/contracts/w08/compiler-delivery.md` 可取得本交付 commit。

在本 checkout 根目錄執行（Node 22+；Root 實測 Node 24.19）：

```powershell
node scripts/content/contract-w08-build.mjs
node scripts/content/contract-w08-build.mjs --check-gate docs/contracts/w08/candidate-r1
```

第一個命令 exit 0 且不寫檔；第二個命令應 exit 2，因為真內容尚未批准且精確 Steam build 未核實。工程驗收不應修改 receipts 或把 gate 改成可發布。

重建到兩個不存在、已有父目錄的明確路徑：

```powershell
node scripts/content/contract-w08-build.mjs --out-root C:/Users/carsu/AppData/Local/Temp/w08-check-a
node scripts/content/contract-w08-build.mjs --out-root C:/Users/carsu/AppData/Local/Temp/w08-check-b
```

若目錄已存在，改用其他新名稱；不要刪除既有候選。核對 candidate.json 指向 `/data/<revision>/manifest.json`，其四個 domains/*.json 的大小／SHA-256 應和 review-matrix-r1.json／artifact-hashes.json 相符。`validateW08CandidateDirectory` 預設會以固定 repo inputs 完整重建並比對 bytes；單獨 `validateW08Candidate` 不帶 expectedInputs 只驗結構／內部一致性，不當作來源認證。完整回復命令見 compiler-delivery.md。停 W08，不進 W09、不合併／正式發布／部署、不清理 Mods、不記工時。
