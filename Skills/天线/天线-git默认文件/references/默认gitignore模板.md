# 默认 `.gitignore` 模板

这个模板用于在当前项目根目录生成默认 `.gitignore`，内容按并集规则融合自：

- `ql-application/threadx/project_general/.gitignore`
- `ql-application/threadx/project_general/User/bms_protocol_V109/.gitignore`

## 建议生成内容

```gitignore
*.diff
*.patch
*.orig
*.rej

*~
.#*
*#

*.flt
*.gmo
*.info
*.la
*.lo
*.o
*.pyc
*.swp
*.tmp
*.log

*.IAB
*.IAD
*.IMB
*.IMD
*.PFI
*.PO
*.PR
*.PRI
*.PS
*.WK3
*.SearchResults
*.bin
*.json

.deps
.libs
out
out_arm
build
Debug
settings
threadx/build
EWSTM32
.gdbinit
.gdb_history
.gitignore
# ignore core files, but not java/net/protocol/core/
core
!core/

lost+found
threadx/ota_tool/a/customer_app.bin
```

## 模板说明

- 最终模板必须是两份来源文件的并集。
- 文件1里有的规则要保留，文件2里有的规则也要保留。
- 只允许去掉完全重复项，不允许裁剪任何一边独有规则。
- `*.bin`、`*.json`、`threadx/ota_tool/a/customer_app.bin` 来自工程根目录规则。
- `out_arm`、`Debug`、`settings`、`EWSTM32` 来自 V109 局部规则。
- `core` 与 `!core/` 必须保留成对关系。
- 如果用户没有特别说明，默认就在当前项目根目录生成这一份 `.gitignore`。
