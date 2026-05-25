# Gate 5 DOCX compatibility evidence templates

这些文件只用于复制填写。模板文件不是通过证据，runner 默认不会把本目录下的 `.template.json` 当作真实证据读取。

补 Word/WPS/LibreOffice 人工证据时：

1. 从 `manual-compatibility-results.template.json` 复制对应结果行。
2. 写入 `fixtures/docx/manual-compatibility-results.json` 的 `results` 数组。
3. 保留并核对 `exportArtifact`、`artifactByteLength`、`artifactSha256`。
4. 把 `result`、`editable`、`repairPrompt`、`mainVisualDifference`、`blockingIssue`、`evidence` 改成人工打开、编辑、保存、重开后的真实观察。

补 Open XML validator 证据时：

1. 从 `openxml-validation-results.template.json` 复制对应结果行。
2. 写入 `fixtures/docx/openxml-validation-results.json` 的 `results` 数组。
3. 保留并核对 `exportArtifact`、`artifactByteLength`、`artifactSha256`。
4. 把 `evidence` 改成 validator 版本、命令、机器和日期，把 `diagnostics` 改成转换后的真实诊断数组。

如果 artifact 任一绑定字段缺失或不匹配，runner 会把外部结论降级为 pending，并在 evidenceRequests 中标记缺失或 stale 状态。
