# BOM电子档修改 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a platform task that modifies one or more BOM Excel files from a single uploaded archive containing an engineering change notice, material master workbook, and `变更BOM` folder.

**Architecture:** Add an isolated FastAPI/SQLModel task module, a deterministic openpyxl processor, and a React task page that follows the existing BOM task pattern. Store all files in task-scoped folders and return a zip bundle of modified BOM workbooks as the downloadable result.

**Tech Stack:** FastAPI, SQLModel, PostgreSQL/Alembic, openpyxl, React, Vite, TanStack Query, shadcn-style UI components.

---

### File Structure

- Create `backend/app/services/bom_electronic_edit_processor.py`: pure Excel parsing, validation, modification, report generation, and quantity formatting.
- Create `backend/app/services/bom_electronic_edit_task_service.py`: task storage, archive extraction, `变更BOM` classification, processor invocation, zip result metadata, cleanup.
- Modify `backend/app/models.py`: status enum, task table, public schemas, stats schema.
- Create `backend/app/api/routes/bom_electronic_edit_tasks.py`: task CRUD, stats, download, background runner.
- Modify `backend/app/api/main.py`: register router.
- Create `backend/app/alembic/versions/20260730_add_bom_electronic_edit_tasks.py`: DB migration.
- Create `backend/tests/services/test_bom_electronic_edit_processor.py`: processor tests with synthetic workbooks.
- Create `backend/tests/api/routes/test_bom_electronic_edit_tasks.py`: API behavior tests.
- Create `frontend/src/components/BomElectronicEditTasks/BomElectronicEditTasksPage.tsx`: user and management pages.
- Create `frontend/src/routes/_layout/tasks.bom-electronic-edit.tsx` and `frontend/src/routes/_layout/tasks.bom-electronic-edit-manage.tsx`.
- Modify `frontend/src/components/Sidebar/AppSidebar.tsx`: sidebar entries.
- Regenerate or update route tree with the existing frontend route tooling.

### Task 1: Excel Processor

- [ ] Write tests for quantity formatting, material master lookup, normal `位号` group replacement, `/` group replacement, and mismatch failures.
- [ ] Implement processor functions: `format_quantity`, `load_material_master`, `parse_change_notice`, `process_bom_workbook`.
- [ ] Verify with `python -m uv run pytest tests/services/test_bom_electronic_edit_processor.py -q`.

### Task 2: Backend Task Module

- [ ] Add model, schemas, migration, storage service, and route module.
- [ ] Implement task creation with one `project_archive_upload` file containing one change notice, one material master workbook, and a `变更BOM` folder.
- [ ] Implement background execution that calls the processor and records `modified_count` and `abnormal_count`.
- [ ] Implement list, stats, detail, download, and delete APIs.
- [ ] Verify with `python -m uv run pytest tests/api/routes/test_bom_electronic_edit_tasks.py -q`.

### Task 3: Frontend Task Page

- [ ] Add page component with task form, stats cards, task table, status badge, duration, download, and delete.
- [ ] Add route files and sidebar links.
- [ ] Regenerate route tree if the existing tool requires it.
- [ ] Verify with `npm run build`.

### Task 4: End-to-End Smoke

- [ ] Run the focused backend tests.
- [ ] Run frontend build.
- [ ] If services are available, submit one expected-success or expected-failure task and download the workbook.
