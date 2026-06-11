# 首页意见统计 Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a home-page `意见统计` tab that summarizes existing feedback data for 今日、昨日、累计 without changing database schema.

**Architecture:** Add a server-side `GET /api/v1/feedback/stats` endpoint that aggregates existing `Feedback` rows under the same permission rules as the feedback list. Add a focused `FeedbackStatsPanel` component and wrap the home stats area in Tabs so the existing task stats remain the default.

**Tech Stack:** FastAPI, SQLModel, PostgreSQL, React, TanStack Query, TanStack Router, shadcn/Radix Tabs, Playwright.

---

## File Structure

- Modify `code_review_server/backend/app/models.py`
  - Add `FeedbackStatsRange`, `FeedbackTrendPointPublic`, `FeedbackUserStatsPublic`, and `FeedbackStatsPublic`.
- Modify `code_review_server/backend/app/api/routes/feedback.py`
  - Add helper functions for time range boundaries, status counts, trend buckets, average resolution time, and user ranking.
  - Add `GET /feedback/stats` before dynamic `/{feedback_id}` routes.
- Modify `code_review_server/backend/tests/api/routes/test_feedback.py`
  - Add route tests for normal-user scope, admin scope, ranges, zero-filled statuses, user ranking, and average resolution time.
- Modify generated frontend client files by running `npm run generate-client` in `code_review_server/frontend`
  - Expected changes: `src/client/types.gen.ts`, `src/client/sdk.gen.ts`, `src/client/schemas.gen.ts`.
- Create `code_review_server/frontend/src/components/Home/FeedbackStatsPanel.tsx`
  - Fetch and render feedback stats, range selector, summary cards, status distribution, trend, admin ranking, and processing overview.
- Modify `code_review_server/frontend/src/routes/_layout/index.tsx`
  - Add `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`; default to `任务统计`.
- Modify `code_review_server/frontend/tests/home.spec.ts`
  - Add E2E coverage for home tabs, range switching, admin ranking, and normal-user ranking visibility.

---

### Task 1: Backend Stats API Contract and Tests

**Files:**
- Modify: `code_review_server/backend/tests/api/routes/test_feedback.py`
- Modify: `code_review_server/backend/app/models.py`
- Modify: `code_review_server/backend/app/api/routes/feedback.py`

- [ ] **Step 1: Add test imports**

In `code_review_server/backend/tests/api/routes/test_feedback.py`, update the top imports:

```python
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session
from sqlmodel import select

from app.core.config import settings
from app.models import Feedback, FeedbackScreenshot, FeedbackStatus, User, UserRole
from app.services import feedback_service
from tests.utils.user import authentication_token_from_key, create_key_user
```

- [ ] **Step 2: Add backend helper functions to the test file**

Add these helpers after `_headers_for_new_user`:

```python
def _admin_headers(client: TestClient, db: Session) -> dict[str, str]:
    admin, admin_api_key = create_key_user(db)
    admin.role = UserRole.admin
    db.add(admin)
    db.commit()
    return authentication_token_from_key(client=client, key=admin_api_key.key, db=db)


def _create_feedback_row(
    db: Session,
    *,
    user_id,
    description: str,
    status: FeedbackStatus = FeedbackStatus.pending,
    created_at: datetime | None = None,
    updated_at: datetime | None = None,
) -> Feedback:
    feedback = Feedback(
        user_id=user_id,
        description=description,
        status=status,
        created_at=created_at or datetime.now(timezone.utc),
        updated_at=updated_at or created_at or datetime.now(timezone.utc),
    )
    db.add(feedback)
    db.commit()
    db.refresh(feedback)
    return feedback
```

- [ ] **Step 3: Write failing tests for feedback stats**

Append these tests near the existing list/stat-permission tests in `code_review_server/backend/tests/api/routes/test_feedback.py`:

```python
def test_normal_user_feedback_stats_only_count_own_feedback(
    client: TestClient,
    db: Session,
) -> None:
    own_user, own_api_key = create_key_user(db)
    own_headers = authentication_token_from_key(
        client=client, key=own_api_key.key, db=db
    )
    other_user, _ = create_key_user(db)
    now = datetime.now(timezone.utc)
    _create_feedback_row(
        db,
        user_id=own_user.id,
        description="自己的待处理意见",
        status=FeedbackStatus.pending,
        created_at=now - timedelta(minutes=30),
    )
    _create_feedback_row(
        db,
        user_id=own_user.id,
        description="自己的已解决意见",
        status=FeedbackStatus.resolved,
        created_at=now - timedelta(hours=2),
        updated_at=now - timedelta(hours=1),
    )
    _create_feedback_row(
        db,
        user_id=other_user.id,
        description="其他人的处理中意见",
        status=FeedbackStatus.processing,
        created_at=now - timedelta(minutes=20),
    )

    response = client.get(
        f"{settings.API_V1_STR}/feedback/stats",
        headers=own_headers,
        params={"range": "today"},
    )

    assert response.status_code == 200
    content = response.json()
    assert content["range"] == "today"
    assert content["total"] == 2
    assert content["pending"] == 1
    assert content["processing"] == 0
    assert content["resolved"] == 1
    assert content["unresolved"] == 1
    assert content["resolution_rate"] == 0.5
    assert content["average_resolution_seconds"] == 3600
    assert content["by_status"] == {
        "pending": 1,
        "processing": 0,
        "resolved": 1,
    }
    assert content["feedback_by_user"] == []


def test_admin_feedback_stats_count_all_feedback_and_user_ranking(
    client: TestClient,
    db: Session,
) -> None:
    first_user, _ = create_key_user(db)
    first_user.full_name = "意见用户 A"
    first_user.svn_username = "feedback-a"
    second_user, _ = create_key_user(db)
    second_user.full_name = "意见用户 B"
    second_user.svn_username = "feedback-b"
    db.add(first_user)
    db.add(second_user)
    db.commit()
    now = datetime.now(timezone.utc)
    for index in range(3):
        _create_feedback_row(
            db,
            user_id=first_user.id,
            description=f"A 用户意见 {index}",
            status=FeedbackStatus.pending,
            created_at=now - timedelta(minutes=index + 1),
        )
    _create_feedback_row(
        db,
        user_id=second_user.id,
        description="B 用户已解决意见",
        status=FeedbackStatus.resolved,
        created_at=now - timedelta(hours=3),
        updated_at=now - timedelta(hours=1),
    )
    admin_headers = _admin_headers(client, db)

    response = client.get(
        f"{settings.API_V1_STR}/feedback/stats",
        headers=admin_headers,
        params={"range": "today"},
    )

    assert response.status_code == 200
    content = response.json()
    assert content["total"] == 4
    assert content["pending"] == 3
    assert content["processing"] == 0
    assert content["resolved"] == 1
    assert content["feedback_by_user"][:2] == [
        {
            "user_name": "意见用户 A",
            "svn_username": "feedback-a",
            "feedback_count": 3,
        },
        {
            "user_name": "意见用户 B",
            "svn_username": "feedback-b",
            "feedback_count": 1,
        },
    ]


def test_feedback_stats_support_yesterday_and_all_ranges(
    client: TestClient,
    db: Session,
) -> None:
    user, api_key = create_key_user(db)
    headers = authentication_token_from_key(client=client, key=api_key.key, db=db)
    now = datetime.now(timezone.utc)
    _create_feedback_row(
        db,
        user_id=user.id,
        description="今天的意见",
        status=FeedbackStatus.pending,
        created_at=now - timedelta(hours=1),
    )
    _create_feedback_row(
        db,
        user_id=user.id,
        description="昨天的意见",
        status=FeedbackStatus.processing,
        created_at=now - timedelta(days=1, hours=1),
    )
    _create_feedback_row(
        db,
        user_id=user.id,
        description="历史意见",
        status=FeedbackStatus.resolved,
        created_at=now - timedelta(days=10),
        updated_at=now - timedelta(days=9),
    )

    yesterday_response = client.get(
        f"{settings.API_V1_STR}/feedback/stats",
        headers=headers,
        params={"range": "yesterday"},
    )
    all_response = client.get(
        f"{settings.API_V1_STR}/feedback/stats",
        headers=headers,
        params={"range": "all"},
    )

    assert yesterday_response.status_code == 200
    yesterday = yesterday_response.json()
    assert yesterday["range"] == "yesterday"
    assert yesterday["total"] == 1
    assert yesterday["processing"] == 1

    assert all_response.status_code == 200
    all_stats = all_response.json()
    assert all_stats["range"] == "all"
    assert all_stats["total"] == 3
    assert all_stats["pending"] == 1
    assert all_stats["processing"] == 1
    assert all_stats["resolved"] == 1


def test_feedback_stats_include_zero_statuses_and_trend_points(
    client: TestClient,
    db: Session,
) -> None:
    user, api_key = create_key_user(db)
    headers = authentication_token_from_key(client=client, key=api_key.key, db=db)

    response = client.get(
        f"{settings.API_V1_STR}/feedback/stats",
        headers=headers,
        params={"range": "today"},
    )

    assert response.status_code == 200
    content = response.json()
    assert content["total"] == 0
    assert content["pending"] == 0
    assert content["processing"] == 0
    assert content["resolved"] == 0
    assert content["unresolved"] == 0
    assert content["resolution_rate"] == 0
    assert content["average_resolution_seconds"] is None
    assert content["by_status"] == {
        "pending": 0,
        "processing": 0,
        "resolved": 0,
    }
    assert len(content["trend"]) == 24
    assert all(point["count"] == 0 for point in content["trend"])
```

- [ ] **Step 4: Run tests to verify they fail**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/backend
uv run pytest tests/api/routes/test_feedback.py -k "feedback_stats" -q
```

Expected: FAIL because `/api/v1/feedback/stats` is currently parsed by the dynamic `/{feedback_id}` route or not implemented.

- [ ] **Step 5: Add response models**

In `code_review_server/backend/app/models.py`, after `class FeedbackStatus(str, Enum):`, add:

```python
class FeedbackStatsRange(str, Enum):
    today = "today"
    yesterday = "yesterday"
    all = "all"
```

After `class FeedbackStatusUpdate(SQLModel):`, add:

```python
class FeedbackTrendPointPublic(SQLModel):
    label: str
    count: int


class FeedbackUserStatsPublic(SQLModel):
    user_name: str | None = None
    svn_username: str | None = None
    feedback_count: int


class FeedbackStatsPublic(SQLModel):
    range: FeedbackStatsRange
    total: int
    pending: int
    processing: int
    resolved: int
    unresolved: int
    resolution_rate: float
    average_resolution_seconds: int | None = None
    by_status: dict[FeedbackStatus, int]
    trend: list[FeedbackTrendPointPublic] = Field(default_factory=list)
    feedback_by_user: list[FeedbackUserStatsPublic] = Field(default_factory=list)
```

- [ ] **Step 6: Import stats models and timezone helpers in feedback route**

In `code_review_server/backend/app/api/routes/feedback.py`, update imports:

```python
import uuid
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import selectinload
from sqlmodel import col, func, select
```

Update model imports to include:

```python
    FeedbackStatsPublic,
    FeedbackStatsRange,
    FeedbackTrendPointPublic,
    FeedbackUserStatsPublic,
```

- [ ] **Step 7: Add backend stats helper functions**

In `code_review_server/backend/app/api/routes/feedback.py`, add after `router = APIRouter(...)`:

```python
FEEDBACK_STATS_TIMEZONE = ZoneInfo("Asia/Shanghai")
```

Add after `_utcnow()`:

```python
def _feedback_scope_filters(current_user: CurrentUser) -> list[Any]:
    if has_admin_privileges(current_user):
        return []
    return [Feedback.user_id == current_user.id]


def _range_bounds(
    stats_range: FeedbackStatsRange,
    now: datetime | None = None,
) -> tuple[datetime | None, datetime | None]:
    if stats_range == FeedbackStatsRange.all:
        return None, None

    current = (now or _utcnow()).astimezone(FEEDBACK_STATS_TIMEZONE)
    today_start = datetime.combine(
        current.date(),
        time.min,
        tzinfo=FEEDBACK_STATS_TIMEZONE,
    )
    if stats_range == FeedbackStatsRange.today:
        start = today_start
        end = current
    else:
        start = today_start - timedelta(days=1)
        end = today_start

    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def _range_filters(
    stats_range: FeedbackStatsRange,
) -> list[Any]:
    start, end = _range_bounds(stats_range)
    filters: list[Any] = []
    if start is not None:
        filters.append(Feedback.created_at >= start)
    if end is not None:
        filters.append(Feedback.created_at < end)
    return filters


def _trend_points(
    *,
    session: SessionDep,
    filters: list[Any],
    stats_range: FeedbackStatsRange,
) -> list[FeedbackTrendPointPublic]:
    rows = session.exec(
        select(Feedback.created_at).where(*filters).order_by(col(Feedback.created_at))
    ).all()

    if stats_range in {FeedbackStatsRange.today, FeedbackStatsRange.yesterday}:
        counts = dict.fromkeys(range(24), 0)
        for created_at in rows:
            if created_at is None:
                continue
            hour = created_at.astimezone(FEEDBACK_STATS_TIMEZONE).hour
            counts[hour] += 1
        return [
            FeedbackTrendPointPublic(label=f"{hour:02d}:00", count=count)
            for hour, count in counts.items()
        ]

    counts_by_date: dict[str, int] = {}
    for created_at in rows:
        if created_at is None:
            continue
        label = created_at.astimezone(FEEDBACK_STATS_TIMEZONE).date().isoformat()
        counts_by_date[label] = counts_by_date.get(label, 0) + 1
    return [
        FeedbackTrendPointPublic(label=label, count=count)
        for label, count in list(counts_by_date.items())[-30:]
    ]
```

- [ ] **Step 8: Add the stats route before `/{feedback_id}`**

In `code_review_server/backend/app/api/routes/feedback.py`, add this route after `read_feedback` and before `@router.get("/{feedback_id}", ...)`:

```python
@router.get("/stats", response_model=FeedbackStatsPublic)
def read_feedback_stats(
    session: SessionDep,
    current_user: CurrentUser,
    range: FeedbackStatsRange = FeedbackStatsRange.today,
) -> Any:
    filters = [
        *_feedback_scope_filters(current_user),
        *_range_filters(range),
    ]

    rows = session.exec(
        select(Feedback.status, func.count()).where(*filters).group_by(Feedback.status)
    ).all()
    by_status = dict.fromkeys(FeedbackStatus, 0)
    for status, count in rows:
        by_status[status] = count

    total = sum(by_status.values())
    resolved = by_status[FeedbackStatus.resolved]
    unresolved = by_status[FeedbackStatus.pending] + by_status[FeedbackStatus.processing]
    resolution_rate = resolved / total if total else 0

    resolved_rows = session.exec(
        select(Feedback.created_at, Feedback.updated_at).where(
            *filters,
            Feedback.status == FeedbackStatus.resolved,
            Feedback.created_at.is_not(None),
            Feedback.updated_at.is_not(None),
        )
    ).all()
    durations = [
        int((updated_at - created_at).total_seconds())
        for created_at, updated_at in resolved_rows
        if created_at is not None and updated_at is not None and updated_at >= created_at
    ]
    average_resolution_seconds = (
        int(sum(durations) / len(durations)) if durations else None
    )

    feedback_by_user: list[FeedbackUserStatsPublic] = []
    if has_admin_privileges(current_user):
        feedback_count = func.count(Feedback.id)
        user_rows = session.exec(
            select(User.full_name, User.svn_username, feedback_count)
            .join(User, Feedback.user_id == User.id)
            .where(*filters)
            .group_by(User.id, User.full_name, User.svn_username)
            .order_by(feedback_count.desc(), User.full_name)
            .limit(10)
        ).all()
        feedback_by_user = [
            FeedbackUserStatsPublic(
                user_name=user_name,
                svn_username=svn_username,
                feedback_count=count,
            )
            for user_name, svn_username, count in user_rows
        ]

    return FeedbackStatsPublic(
        range=range,
        total=total,
        pending=by_status[FeedbackStatus.pending],
        processing=by_status[FeedbackStatus.processing],
        resolved=resolved,
        unresolved=unresolved,
        resolution_rate=resolution_rate,
        average_resolution_seconds=average_resolution_seconds,
        by_status=by_status,
        trend=_trend_points(session=session, filters=filters, stats_range=range),
        feedback_by_user=feedback_by_user,
    )
```

- [ ] **Step 9: Run backend feedback stats tests**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/backend
uv run pytest tests/api/routes/test_feedback.py -k "feedback_stats" -q
```

Expected: PASS.

- [ ] **Step 10: Run full feedback route tests**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/backend
uv run pytest tests/api/routes/test_feedback.py -q
```

Expected: PASS.

- [ ] **Step 11: Commit backend stats API**

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform
git add code_review_server/backend/app/models.py code_review_server/backend/app/api/routes/feedback.py code_review_server/backend/tests/api/routes/test_feedback.py
git commit -m "新增意见统计接口"
```

---

### Task 2: Generate Frontend Client Types

**Files:**
- Modify: `code_review_server/frontend/src/client/types.gen.ts`
- Modify: `code_review_server/frontend/src/client/sdk.gen.ts`
- Modify: `code_review_server/frontend/src/client/schemas.gen.ts`

- [ ] **Step 1: Generate the OpenAPI client**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/frontend
npm run generate-client
```

Expected: generated client files include `FeedbackReadFeedbackStatsData`, `FeedbackReadFeedbackStatsResponse`, `FeedbackStatsPublic`, `FeedbackStatsRange`, `FeedbackTrendPointPublic`, and `FeedbackUserStatsPublic`.

- [ ] **Step 2: Confirm generated stats service exists**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform
rg -n "readFeedbackStats|FeedbackStatsPublic|FeedbackStatsRange" code_review_server/frontend/src/client
```

Expected: matches in `types.gen.ts`, `schemas.gen.ts`, and `sdk.gen.ts`.

- [ ] **Step 3: Commit generated client updates**

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform
git add code_review_server/frontend/src/client/types.gen.ts code_review_server/frontend/src/client/sdk.gen.ts code_review_server/frontend/src/client/schemas.gen.ts
git commit -m "更新意见统计前端客户端"
```

---

### Task 3: Feedback Stats Panel Component

**Files:**
- Create: `code_review_server/frontend/src/components/Home/FeedbackStatsPanel.tsx`
- Test: `code_review_server/frontend/tests/home.spec.ts`

- [ ] **Step 1: Add frontend test data and route stubs**

In `code_review_server/frontend/tests/home.spec.ts`, first update the Playwright import:

```ts
import { expect, test, type Page } from "@playwright/test"
```

Then add after imports:

```ts
const feedbackStatsByRange = {
  today: {
    range: "today",
    total: 6,
    pending: 2,
    processing: 1,
    resolved: 3,
    unresolved: 3,
    resolution_rate: 0.5,
    average_resolution_seconds: 5760,
    by_status: {
      pending: 2,
      processing: 1,
      resolved: 3,
    },
    trend: [
      { label: "09:00", count: 1 },
      { label: "10:00", count: 2 },
      { label: "11:00", count: 3 },
    ],
    feedback_by_user: [
      {
        user_name: "汪思雨",
        svn_username: "wangsiyu",
        feedback_count: 3,
      },
      {
        user_name: "朱正寒",
        svn_username: "zhuzhenghan",
        feedback_count: 2,
      },
    ],
  },
  yesterday: {
    range: "yesterday",
    total: 4,
    pending: 1,
    processing: 1,
    resolved: 2,
    unresolved: 2,
    resolution_rate: 0.5,
    average_resolution_seconds: 7200,
    by_status: {
      pending: 1,
      processing: 1,
      resolved: 2,
    },
    trend: [{ label: "14:00", count: 4 }],
    feedback_by_user: [],
  },
  all: {
    range: "all",
    total: 42,
    pending: 9,
    processing: 6,
    resolved: 27,
    unresolved: 15,
    resolution_rate: 0.6428571428571429,
    average_resolution_seconds: 207360,
    by_status: {
      pending: 9,
      processing: 6,
      resolved: 27,
    },
    trend: [{ label: "2026-06-11", count: 42 }],
    feedback_by_user: [],
  },
}

async function mockFeedbackStats(page: Page, options?: { includeUsers?: boolean }) {
  const requestedRanges: string[] = []
  await page.route("**/api/v1/feedback/stats?**", async (route) => {
    const url = new URL(route.request().url())
    const range = url.searchParams.get("range") || "today"
    requestedRanges.push(range)
    const stats =
      feedbackStatsByRange[range as keyof typeof feedbackStatsByRange] ??
      feedbackStatsByRange.today
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...stats,
        feedback_by_user: options?.includeUsers ? stats.feedback_by_user : [],
      },
    })
  })
  return requestedRanges
}
```

- [ ] **Step 2: Add failing frontend tests**

In `code_review_server/frontend/tests/home.spec.ts`, add tests:

```ts
test("Home page can switch to feedback statistics", async ({ page }) => {
  const requestedRanges = await mockFeedbackStats(page, { includeUsers: true })
  await page.goto("/")

  await expect(page.getByRole("tab", { name: "任务统计" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "意见统计" })).toBeVisible()
  await expect(page.getByText("总任务数")).toBeVisible()

  await page.getByRole("tab", { name: "意见统计" }).click()
  await expect(page.getByRole("heading", { name: "意见统计" })).toBeVisible()
  await expect(page.getByText("当前权限范围内的意见反馈处理情况。")).toBeVisible()
  await expect(page.getByText("总意见数")).toBeVisible()
  await expect(page.getByText("待处理")).toBeVisible()
  await expect(page.getByText("处理中")).toBeVisible()
  await expect(page.getByText("已解决")).toBeVisible()
  await expect(page.getByText("状态分布")).toBeVisible()
  await expect(page.getByText("提交趋势")).toBeVisible()
  await expect(page.getByText("处理概览")).toBeVisible()
  await expect(page.getByText("提交人排行")).toBeVisible()
  await expect(page.getByText("汪思雨")).toBeVisible()
  expect(requestedRanges).toContain("today")
})

test("Feedback statistics supports today yesterday and all ranges", async ({
  page,
}) => {
  const requestedRanges = await mockFeedbackStats(page, { includeUsers: true })
  await page.goto("/")
  await page.getByRole("tab", { name: "意见统计" }).click()

  await expect(page.getByText("6")).toBeVisible()
  await page.getByRole("button", { name: "昨日" }).click()
  await expect(page.getByText("4")).toBeVisible()
  await page.getByRole("button", { name: "累计" }).click()
  await expect(page.getByText("42")).toBeVisible()

  expect(requestedRanges).toContain("today")
  expect(requestedRanges).toContain("yesterday")
  expect(requestedRanges).toContain("all")
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/frontend
npm run test -- tests/home.spec.ts
```

Expected: FAIL because the home page does not have an `意见统计` tab yet.

- [ ] **Step 4: Create `FeedbackStatsPanel.tsx`**

Create `code_review_server/frontend/src/components/Home/FeedbackStatsPanel.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query"
import {
  CheckCircle2,
  CircleHelp,
  Clock3,
  MessageSquareText,
} from "lucide-react"
import { useState } from "react"

import {
  FeedbackService,
  type FeedbackStatsRange,
} from "@/client"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import useAuth from "@/hooks/useAuth"
import { hasAdminPrivileges } from "@/lib/authz"
import { cn } from "@/lib/utils"

const statusLabels = [
  { key: "pending", label: "待处理", className: "bg-red-500" },
  { key: "processing", label: "处理中", className: "bg-blue-500" },
  { key: "resolved", label: "已解决", className: "bg-emerald-500" },
] as const

const rangeOptions: Array<{ value: FeedbackStatsRange; label: string }> = [
  { value: "today", label: "今日" },
  { value: "yesterday", label: "昨日" },
  { value: "all", label: "累计" },
]

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

function formatDuration(seconds: number | null | undefined) {
  if (!seconds) {
    return "-"
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)} 分钟`
  }
  if (seconds < 86400) {
    return `${(seconds / 3600).toFixed(1)} 小时`
  }
  return `${(seconds / 86400).toFixed(1)} 天`
}

function maxCount(values: number[]) {
  return Math.max(1, ...values)
}

export function FeedbackStatsPanel() {
  const { user: currentUser } = useAuth()
  const [range, setRange] = useState<FeedbackStatsRange>("today")
  const {
    data: stats,
    isError,
    isLoading,
  } = useQuery({
    enabled: Boolean(currentUser),
    queryFn: () => FeedbackService.readFeedbackStats({ range }),
    queryKey: ["feedback-stats", currentUser?.id, currentUser?.role, range],
  })
  const isAdmin = hasAdminPrivileges(currentUser)

  if (!currentUser || isLoading) {
    return (
      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">意见统计</h2>
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            正在加载意见统计...
          </CardContent>
        </Card>
      </section>
    )
  }

  if (isError || !stats) {
    return (
      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">意见统计</h2>
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            意见统计加载失败，请稍后重试。
          </CardContent>
        </Card>
      </section>
    )
  }

  const summaryItems = [
    {
      icon: MessageSquareText,
      label: "总意见数",
      value: stats.total,
    },
    {
      icon: CircleHelp,
      label: "待处理",
      value: stats.pending,
      iconClassName: "text-red-600",
    },
    {
      icon: Clock3,
      label: "处理中",
      value: stats.processing,
      iconClassName: "text-blue-600",
    },
    {
      icon: CheckCircle2,
      label: "已解决",
      value: stats.resolved,
      iconClassName: "text-emerald-600",
    },
  ]
  const maxStatusCount = maxCount(
    statusLabels.map(({ key }) => stats.by_status[key] ?? 0),
  )
  const maxTrendCount = maxCount(stats.trend.map((item) => item.count))
  const maxUserCount = maxCount(
    stats.feedback_by_user.map((item) => item.feedback_count),
  )

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">意见统计</h2>
          <p className="text-sm text-muted-foreground">
            当前权限范围内的意见反馈处理情况。
          </p>
        </div>
        <div className="inline-flex w-fit rounded-md bg-muted p-1">
          {rangeOptions.map((option) => (
            <Button
              key={option.value}
              size="sm"
              type="button"
              variant={range === option.value ? "secondary" : "ghost"}
              onClick={() => setRange(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summaryItems.map((item) => (
          <Card key={item.label} className="gap-3 py-5">
            <CardContent className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{item.label}</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">
                  {item.value}
                </p>
              </div>
              <item.icon
                className={cn(
                  "size-5 shrink-0 text-muted-foreground",
                  item.iconClassName,
                )}
                aria-hidden="true"
              />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>状态分布</CardTitle>
            <CardDescription>按所选时间范围内的当前状态统计。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {statusLabels.map(({ key, label, className }) => {
              const count = stats.by_status[key] ?? 0
              const width = `${(count / maxStatusCount) * 100}%`

              return (
                <div
                  key={key}
                  className="grid grid-cols-[minmax(4.5rem,max-content)_minmax(0,1fr)_3rem] items-center gap-3 text-sm"
                >
                  <span className="text-muted-foreground">{label}</span>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full", className)}
                      style={{ width }}
                    />
                  </div>
                  <span className="text-right font-medium tabular-nums">
                    {count}
                  </span>
                </div>
              )
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>提交趋势</CardTitle>
            <CardDescription>
              今日/昨日按小时展示，累计按日期展示。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {stats.trend.some((item) => item.count > 0) ? (
              <div className="overflow-x-auto pb-2">
                <div className="flex h-48 min-w-max items-end gap-3">
                  {stats.trend.map((item) => (
                    <div
                      key={item.label}
                      className="flex h-full w-12 shrink-0 flex-col items-center justify-end gap-2 text-xs"
                    >
                      <span className="font-medium tabular-nums">
                        {item.count}
                      </span>
                      <div className="flex h-32 w-full items-end rounded-md bg-muted/60 px-2 py-1">
                        <div
                          className="w-full rounded-t-md bg-teal-500"
                          style={{
                            height: `${(item.count / maxTrendCount) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="w-full truncate text-center text-muted-foreground">
                        {item.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">暂无提交趋势。</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className={cn("grid gap-4", isAdmin && "xl:grid-cols-[1.2fr_0.8fr]")}>
        {isAdmin ? (
          <Card>
            <CardHeader>
              <CardTitle>提交人排行</CardTitle>
              <CardDescription>按所选时间范围统计前 10 名。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {stats.feedback_by_user.length > 0 ? (
                stats.feedback_by_user.map((item) => {
                  const displayName =
                    item.user_name || item.svn_username || "未命名用户"
                  const width = `${(item.feedback_count / maxUserCount) * 100}%`

                  return (
                    <div
                      key={`${displayName}-${item.svn_username ?? ""}`}
                      className="grid grid-cols-[minmax(5rem,max-content)_minmax(0,1fr)_3rem] items-center gap-3 text-sm"
                    >
                      <span className="truncate text-muted-foreground">
                        {displayName}
                      </span>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-indigo-500"
                          style={{ width }}
                        />
                      </div>
                      <span className="text-right font-medium tabular-nums">
                        {item.feedback_count}
                      </span>
                    </div>
                  )
                })
              ) : (
                <p className="text-sm text-muted-foreground">暂无提交人数据。</p>
              )}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>处理概览</CardTitle>
            <CardDescription>解决率、未解决数和平均解决耗时。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">解决率</span>
              <span className="font-medium tabular-nums">
                {formatPercent(stats.resolution_rate)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">未解决数</span>
              <span className="font-medium tabular-nums">{stats.unresolved}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">平均解决耗时</span>
              <span className="font-medium tabular-nums">
                {formatDuration(stats.average_resolution_seconds)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
```

- [ ] **Step 5: Run TypeScript check to expose missing client type issues**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/frontend
npm run build
```

Expected: PASS if Task 2 generated client files correctly; otherwise fix generated client before continuing.

- [ ] **Step 6: Commit component and tests**

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform
git add code_review_server/frontend/src/components/Home/FeedbackStatsPanel.tsx code_review_server/frontend/tests/home.spec.ts
git commit -m "新增首页意见统计面板"
```

---

### Task 4: Home Page Tabs Integration

**Files:**
- Modify: `code_review_server/frontend/src/routes/_layout/index.tsx`
- Test: `code_review_server/frontend/tests/home.spec.ts`

- [ ] **Step 1: Update home route imports**

Modify `code_review_server/frontend/src/routes/_layout/index.tsx` imports:

```tsx
import { createFileRoute } from "@tanstack/react-router"

import { FeedbackStatsPanel } from "@/components/Home/FeedbackStatsPanel"
import { TaskStatsPanel } from "@/components/Home/TaskStatsPanel"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import useAuth from "@/hooks/useAuth"
```

- [ ] **Step 2: Replace direct `TaskStatsPanel` rendering with Tabs**

Replace:

```tsx
      <TaskStatsPanel />
```

with:

```tsx
      <Tabs defaultValue="tasks" className="gap-4">
        <TabsList>
          <TabsTrigger value="tasks">任务统计</TabsTrigger>
          <TabsTrigger value="feedback">意见统计</TabsTrigger>
        </TabsList>
        <TabsContent value="tasks">
          <TaskStatsPanel />
        </TabsContent>
        <TabsContent value="feedback">
          <FeedbackStatsPanel />
        </TabsContent>
      </Tabs>
```

- [ ] **Step 3: Run home E2E tests**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/frontend
npm run test -- tests/home.spec.ts
```

Expected: PASS. Existing tests should still see task stats by default; new tests should pass after switching tabs.

- [ ] **Step 4: Run frontend build**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/frontend
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit home tab integration**

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform
git add code_review_server/frontend/src/routes/_layout/index.tsx code_review_server/frontend/tests/home.spec.ts
git commit -m "首页接入意见统计Tab"
```

---

### Task 5: Final Verification and Review

**Files:**
- Verify working tree and test output.

- [ ] **Step 1: Run backend focused tests**

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/backend
uv run pytest tests/api/routes/test_feedback.py tests/api/routes/test_review_tasks.py -q
```

Expected: PASS.

- [ ] **Step 2: Run frontend home E2E**

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/frontend
npm run test -- tests/home.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run frontend build**

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/frontend
npm run build
```

Expected: PASS.

- [ ] **Step 4: Confirm no database migration was created**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform
git status --short code_review_server/backend/app/alembic/versions
```

Expected: no output.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform
git status --short
git log --oneline -5
```

Expected: only intentional committed changes for this feature, plus any pre-existing unrelated local changes left untouched.

- [ ] **Step 6: Commit any missed verification-only fixes**

If verification required small fixes, commit them:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform
git add <fixed-files>
git commit -m "修正首页意见统计细节"
```

Expected: clean feature diff except unrelated pre-existing local changes.

---

## Self-Review

- Spec coverage: The plan covers the home Tab, feedback stats API, no database migration, 今日/昨日/累计 ranges, removal of screenshot metrics, normal/admin permission scope, admin ranking, processing overview, loading/error/empty states, and tests.
- Placeholder scan: No unfinished-work marker words remain. Every code-changing step includes concrete code or exact commands.
- Type consistency: Backend model names (`FeedbackStatsRange`, `FeedbackStatsPublic`, `FeedbackTrendPointPublic`, `FeedbackUserStatsPublic`) match the generated frontend client names expected by the component. Route name `read_feedback_stats` should generate `FeedbackService.readFeedbackStats`.
