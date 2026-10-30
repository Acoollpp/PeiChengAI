# 线束图语义对比与交互批注 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有线束图 ZIP/RAR 任务中增加 PDF/OCR 文字识别、语义差异报告、红蓝批注 PDF/PNG 和左右联动 HTML 审阅页。

**Architecture:** 保留现有任务 API、任务目录和解压安全逻辑。将文本提取、差异匹配、批注绘制、HTML 报告分别放入可测试的后端模块；任务服务负责编排并打包结果，React 页面只增加结果入口和统计信息。语义比对采用本地规则/相似度引擎作为稳定兜底，并预留可替换的语义模型接口。

**Tech Stack:** FastAPI, SQLModel, Alembic, PyMuPDF, Pillow, Python 标准库, React, TypeScript, Vite, pytest。

---

## 文件地图

- Create: `backend/app/services/wire_harness_semantic_compare.py`，文本块、差异记录和语义匹配。
- Create: `backend/app/services/wire_harness_annotation.py`，PDF/PNG 批注和左右审阅 HTML 生成。
- Modify: `backend/app/services/wire_harness_compare_task_service.py`，调用新模块并扩展结果 ZIP。
- Modify: `backend/app/api/routes/wire_harness_compare_tasks.py`，提供交互报告预览/下载入口。
- Modify: `backend/app/models.py`，增加语义统计和结果类型字段。
- Create: `backend/app/alembic/versions/20260817_add_wire_harness_semantic_compare_fields.py`，兼容旧任务的数据库迁移。
- Modify: `frontend/src/components/WireHarnessCompare/WireHarnessComparePage.tsx`，显示语义统计和打开交互报告按钮。
- Create: `backend/tests/services/test_wire_harness_semantic_compare.py`，文本提取、匹配和分类测试。
- Create: `backend/tests/services/test_wire_harness_annotation.py`，批注和 HTML 数据一致性测试。
- Modify: `backend/tests/test_wire_harness_compare_service.py`，保留旧 ZIP/RAR 和并排图回归测试。

## Task 1: 建立差异数据契约和 PDF 文本提取

**Files:**

- Create: `backend/app/services/wire_harness_semantic_compare.py`
- Create: `backend/tests/services/test_wire_harness_semantic_compare.py`

- [ ] **Step 1: 写失败测试，锁定文本块和差异数据结构**

```python
def test_extract_text_blocks_keeps_page_and_bbox(tmp_path):
    pdf = make_pdf(tmp_path / "图纸.pdf", "端子 J-01  长度 120 mm")
    blocks = extract_text_blocks(pdf)
    assert blocks[0].page == 1
    assert blocks[0].source == "pdf_text"
    assert blocks[0].bbox[2] > blocks[0].bbox[0]

def test_compare_text_blocks_classifies_modified_value():
    old = [TextBlock("长度 120 mm", 1, (10, 10, 100, 30), "pdf_text", 1.0)]
    new = [TextBlock("长度 150 mm", 1, (10, 10, 100, 30), "pdf_text", 1.0)]
    differences = compare_text_blocks(old, new)
    assert differences[0].kind == "dimension_changed"
    assert differences[0].old_text == "长度 120 mm"
    assert differences[0].new_text == "长度 150 mm"
```

- [ ] **Step 2: 运行测试确认当前失败**

Run: `pytest backend/tests/services/test_wire_harness_semantic_compare.py -q`

Expected: FAIL because `TextBlock`, `extract_text_blocks`, and `compare_text_blocks` do not exist.

- [ ] **Step 3: 实现最小数据契约和内置文字提取**

实现不可变的 `TextBlock` 和 `DifferenceRecord` 数据类。`extract_text_blocks(pdf_path)` 使用 `pymupdf.open()` 和 `page.get_text("dict")`，过滤空文本，保存 1-based 页码、`bbox`、`source="pdf_text"` 和置信度 1.0。文件打开、页面读取异常转换为带文件名的 `RuntimeError`。

- [ ] **Step 4: 实现归一化和基础匹配**

实现 `normalize_text()`：压缩空白、统一安全的全角空格和换行，保留数字、单位、料号、正负号。实现 `compare_text_blocks(old, new)`：先按页码和中心点距离生成候选，再按归一化文本精确匹配；未匹配的文本生成 added/removed，候选文本不同则生成 modified，并根据数字/单位、料号、版本关键字分类为 `dimension_changed`、`part_number_changed` 或 `revision_changed`。

- [ ] **Step 5: 运行测试确认通过并提交**

Run: `pytest backend/tests/services/test_wire_harness_semantic_compare.py -q`

Expected: PASS。

Commit: `git add backend/app/services/wire_harness_semantic_compare.py backend/tests/services/test_wire_harness_semantic_compare.py && git commit -m "feat: add wire harness semantic diff contract"`。

## Task 2: 增加 OCR fallback 和差异置信度

**Files:**

- Modify: `backend/app/services/wire_harness_semantic_compare.py`
- Modify: `backend/pyproject.toml` 或运行环境依赖配置（仅在 OCR 包已存在性检查确认后）
- Modify: `backend/tests/services/test_wire_harness_semantic_compare.py`

- [ ] **Step 1: 写失败测试，覆盖 OCR fallback 的适配器契约**

```python
def test_ocr_fallback_is_used_when_pdf_text_is_empty(monkeypatch, tmp_path):
    pdf = make_image_only_pdf(tmp_path / "扫描图.pdf")
    monkeypatch.setattr(ocr_adapter, "recognize", lambda image: [("线号 A01", (12, 20, 80, 35), 0.91)])
    blocks = extract_text_blocks(pdf, ocr=ocr_adapter)
    assert blocks[0].source == "ocr"
    assert blocks[0].confidence == 0.91
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest backend/tests/services/test_wire_harness_semantic_compare.py::test_ocr_fallback_is_used_when_pdf_text_is_empty -q`

Expected: FAIL because `ocr` argument and fallback adapter are not implemented.

- [ ] **Step 3: 实现可替换 OCR 适配器**

增加 `OcrAdapter` 协议，输入页面图片返回文字、框和置信度。页面内置文字为空或覆盖率低于阈值时才渲染页面并调用适配器；OCR 失败记录页面级警告，不吞掉已有 PDF 文字。默认适配器在运行环境缺少 OCR 引擎时返回明确的“未安装 OCR”错误，测试使用 monkeypatch，不依赖外部模型。

- [ ] **Step 4: 去重并补齐低置信度字段**

对 OCR 与 PDF 文本按归一化文字、页码和框重叠率去重；将低于 0.75 的 OCR 文本及无法空间匹配的记录标记 `needs_review=True`。差异记录保留识别来源和置信度。

- [ ] **Step 5: 运行聚焦测试并提交**

Run: `pytest backend/tests/services/test_wire_harness_semantic_compare.py -q`

Expected: PASS；若本机没有 OCR 引擎，默认适配器缺失测试必须验证明确错误信息，而不是假装识别成功。

Commit: `git add backend/app/services/wire_harness_semantic_compare.py backend/tests/services/test_wire_harness_semantic_compare.py backend/pyproject.toml && git commit -m "feat: add OCR fallback for wire harness drawings"`。

## Task 3: 实现红蓝批注、PDF/PNG 输出和离线 HTML 报告

**Files:**

- Create: `backend/app/services/wire_harness_annotation.py`
- Create: `backend/tests/services/test_wire_harness_annotation.py`

- [ ] **Step 1: 写失败测试，验证编号和颜色契约**

```python
def test_build_annotation_assets_writes_red_old_and_blue_new(tmp_path):
    result = build_annotation_assets(old_pdf, new_pdf, differences, tmp_path)
    assert result.old_pdf.name == "旧图纸_红色批注.pdf"
    assert result.new_pdf.name == "新图纸_蓝色批注.pdf"
    assert result.old_png.is_file() and result.new_png.is_file()
    assert result.marker_count == len(differences)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest backend/tests/services/test_wire_harness_annotation.py -q`

Expected: FAIL because annotation builder does not exist.

- [ ] **Step 3: 实现批注绘制**

使用 PyMuPDF 在 PDF 副本对应页的 `bbox` 位置绘制红色/蓝色圆形编号，并使用 Pillow 生成同尺寸页面 PNG。旧图只绘制红色标记，新图只绘制蓝色标记；编号来自 `DifferenceRecord.number`，同一差异在两侧使用相同数字。原 PDF 只读打开，输出写入结果目录。

- [ ] **Step 4: 实现离线 HTML 报告**

报告内嵌差异 JSON 和本地 PNG 相对路径。页面使用左右两栏，差异按钮和两侧标记绑定同一编号；点击后更新当前差异、滚动两侧到页码和坐标、展示旧文本/新文本/类型/置信度。页面不加载 CDN，不执行任意用户输入脚本；文字使用 HTML 转义。

- [ ] **Step 5: 验证生成文件和报告数据一致性**

测试用 `zipfile` 或临时目录检查报告包含每个差异编号、旧/新文本和标记颜色字符串；重新打开生成 PDF 并检查页数不变。使用 PyMuPDF 渲染首个页面，验证输出图片非空且尺寸大于 0。

- [ ] **Step 6: 运行测试并提交**

Run: `pytest backend/tests/services/test_wire_harness_annotation.py -q`

Expected: PASS。

Commit: `git add backend/app/services/wire_harness_annotation.py backend/tests/services/test_wire_harness_annotation.py && git commit -m "feat: generate interactive wire harness annotations"`。

## Task 4: 接入任务编排、数据库字段和结果 ZIP

**Files:**

- Modify: `backend/app/services/wire_harness_compare_task_service.py`
- Modify: `backend/app/models.py`
- Modify: `backend/app/api/routes/wire_harness_compare_tasks.py`
- Create: `backend/app/alembic/versions/20260817_add_wire_harness_semantic_compare_fields.py`
- Modify: `backend/tests/test_wire_harness_compare_service.py`

- [ ] **Step 1: 写任务服务回归测试**

增加测试断言：`run_task()` 结果同时包含并排 PNG、差异报告 HTML、Markdown、JSON、红色旧图和蓝色新图；RAR/ZIP 解压和旧输出目录仍然可用；单套失败不会阻塞其他套。

- [ ] **Step 2: 扩展任务模型和迁移**

在 `WireHarnessCompareTask` 增加 `semantic_diff_count`、`review_required_count`、`ocr_page_count` 和 `report_entry`/结果类型元数据字段，默认值为 0 或空，确保现有行可迁移。公开模型同步增加字段。Alembic 迁移使用 `ADD COLUMN IF NOT EXISTS` 或等价可重复执行写法。

- [ ] **Step 3: 接入任务服务**

保留 `_extract_archive()`、`_find_pdf_pairs()` 和当前文件安全校验。每套图纸先提取/比对文字，再调用批注生成器，最后继续生成旧并排 PNG 作为兼容输出。结果 ZIP 采用每套图纸独立目录，根目录写入汇总 JSON；任务服务返回完整 `result_files` 和四项统计。

- [ ] **Step 4: 增加报告访问接口**

增加 `GET /{task_id}/interactive-report`，复用现有权限检查，只允许成功任务返回报告 HTML；HTML 内部资源通过受控报告文件接口读取，禁止根据请求路径访问任务目录外文件。现有 `/report` 继续下载 ZIP。

- [ ] **Step 5: 运行后端测试和迁移检查**

Run: `pytest backend/tests/test_wire_harness_compare_service.py backend/tests/services/test_wire_harness_semantic_compare.py backend/tests/services/test_wire_harness_annotation.py -q`

Expected: PASS。然后运行项目既有 Alembic upgrade 流程，确认迁移成功，旧任务查询不报错。

- [ ] **Step 6: 提交后端集成**

Commit: `git add backend/app/services/wire_harness_compare_task_service.py backend/app/models.py backend/app/api/routes/wire_harness_compare_tasks.py backend/app/alembic/versions/20260817_add_wire_harness_semantic_compare_fields.py backend/tests && git commit -m "feat: integrate semantic wire harness comparison task"`。

## Task 5: 更新 React 任务页和交互报告入口

**Files:**

- Modify: `frontend/src/components/WireHarnessCompare/WireHarnessComparePage.tsx`
- Modify: `frontend/src/routes/_layout/tasks.wire-harness-compare.tsx` only if route metadata requires it
- Modify: generated client/types only if this repository generates them for the new public fields

- [ ] **Step 1: 写前端回归测试或最小可验证交互**

覆盖成功任务显示“打开交互报告”按钮、无报告时按钮禁用、语义差异和待确认数量显示；下载按钮仍下载 ZIP。若当前组件测试基础设施不覆盖该页，使用 Playwright 页面测试通过已登录测试账户验证 DOM 文本和链接。

- [ ] **Step 2: 实现结果入口**

在任务类型增加新字段；对成功任务调用受保护的报告 URL，在新标签页打开 HTML；保留下载图标按钮并增加 `aria-label`。任务列表显示“差异 N 条 / 待确认 M 条 / OCR 页面 K 页”，避免把语义差异数与套数混为一项。

- [ ] **Step 3: 运行前端构建和测试**

Run: `npm run build` from `frontend`。

Expected: PASS，无 TypeScript 类型错误。

Run: `npm run test -- --run` if the repository exposes the frontend test command。

Expected: PASS；若没有该脚本，记录为未执行并使用构建和浏览器冒烟验证替代。

- [ ] **Step 4: 提交前端变更**

Commit: `git add frontend/src/components/WireHarnessCompare frontend/src/routes/_layout/tasks.wire-harness-compare.tsx && git commit -m "feat: add semantic comparison report entry"`。

## Task 6: 端到端视觉验证和交付

**Files:**

- Modify: `docs/superpowers/specs/2026-08-17-wire-harness-semantic-compare-design.md` only for verified implementation notes
- Create: `docs/线束图语义对比使用说明.md`，记录输入结构、输出文件和低置信度含义

- [ ] **Step 1: 准备最小样例**

创建两页测试 PDF：旧图包含“端子 J-01、长度 120 mm”，新图包含“端子 J-02、长度 150 mm”，另加入一处纯图形变化；放入两个子目录并分别打成 ZIP 和 RAR（本机有 WinRAR/UnRAR 时）。

- [ ] **Step 2: 运行真实任务**

启动后端和前端，上传样例压缩包，等待任务成功；确认任务列表显示套数、语义差异数、OCR 页数和报告入口。

- [ ] **Step 3: 验证 HTML 交互**

打开交互报告，点击旧图红色编号和新图蓝色编号，确认两侧同步跳转到同一差异，详情显示旧值和新值；用 Playwright 截取桌面和窄屏截图，检查没有重叠或裁切。

- [ ] **Step 4: 验证 PDF/PNG 输出**

使用 PyMuPDF 重新渲染两份批注 PDF，检查旧图红色、新图蓝色、编号配对一致，关键文字没有被大面积遮挡，报告 ZIP 可正常解压。

- [ ] **Step 5: 运行完整验证**

Run: `pytest backend/tests -q`。

Run: `npm run build` from `frontend`。

Expected: 后端测试通过、前端构建通过；RAR 环境缺失时明确记录“RAR 真实包未执行”，但必须通过解压命令缺失和 ZIP 回归测试。

- [ ] **Step 6: 提交使用说明并汇总结果**

Commit: `git add docs/线束图语义对比使用说明.md && git commit -m "docs: add wire harness semantic comparison guide"`。

交付时报告实际执行的测试、服务地址、输出包位置以及任何未验证的 OCR/RAR 环节，不把模拟测试描述成真实验证。
