# W09 r5 main整合與剩餘接線

r4三項修補已獨立複驗21/0/0，過時的等待複驗狀態已於SYP-341/12073更正。本輪只整合最新main，不重新批准內容或宣告W09整包完成。固定父版本、未變內容候選、最小剩餘矩陣與hash見[integration-r5](integration-r5/matrix.md)。

main9e9e2ec導入既有availability/operations成果；唯一text conflict static-ci保留兩側發布防護。新legacy restore與W09 owner state的直接衝突已修：selected存在或owner active/pending時，publish=true會在接觸CF secret前拒絕，查詢失敗fail closed；使用shared-release完整CAS回復。隔離restore不變。UnitT25先Red後Green；Reviewer只讀關閉finding。

42項受影響client/blessing/operations測試與5項workflow/state/gate測試通過（其中2項重疊，不相加）；sandbox原37pass/5fixture git init權限失敗保留，原命令受准環境42/0/0。r4 Source146、Web520+15skip、W01 535均沿用；本輪自然PR CI由最終commit的Jira/交付收據另核，不在本commit預告成功。

沒有設定token或擴權，沒有真release/dispatch/deploy、沒有main merge或W10。WEB_HANDOFF_TOKEN、workflow PR policy及main啟用需owner裁定；正式內容與HTTPS promote/production rollback未驗。Source固定55379ec不變，舊r1–r4資料保留。

## 精確工程恢復

本補件為第一parent=r4 Web9d8686507111fa951856db0f61d9b8a65ada8d13、第二parent=main9e9e2ec26b71e296a8a4165fcf81fe2ad45fec63的merge commit。實際完整merge SHA及獨立恢復收據記入最終Jira與本機delivery-report；不要以未驗版本執行。

在新隔離恢復分支上對該merge執行git revert --no-commit -m 1 <verified-r5-merge-SHA>，staged tree必須等於r4的5a06aeb2de77b525481bccbdc37e7dad9da8d9a1；Source不revert。真實checkout未回復。這僅停用本輪main整合與restore guard，不能替代production整組rollback，也不能據此部署。保留無關/未追蹤資料，不reset/clean/force push。
