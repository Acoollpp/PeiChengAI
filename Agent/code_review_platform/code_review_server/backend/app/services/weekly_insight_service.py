import re
import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from app.models import (
    ReviewTask,
    ReviewTaskReportFeedback,
    ReviewTaskWeeklyCategoryStatsPublic,
    ReviewTaskWeeklyDailyPointPublic,
    ReviewTaskWeeklyDepartmentStatsPublic,
    ReviewTaskWeeklyInsightsPublic,
    ReviewTaskWeeklyRepresentativeIssuePublic,
)

WEEKLY_INSIGHT_TIMEZONE = ZoneInfo("Asia/Shanghai")
TAXONOMY_VERSION = "fixed-audit-taxonomy-v1"

CATEGORY_STRUCTURE: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "日常提交审核",
        (
            "变更点审核",
            "编码规范审核",
            "基础逻辑审核",
            "测试补充审核",
            "自检项检查",
        ),
    ),
    ("品质风险审核", ("客诉高频问题",)),
    ("重点项目发布审核", ("全规则审核",)),
    (
        "协议专项审核",
        (
            "通讯协议内容审核",
            "异常通信审核",
            "超时重发审核",
            "缓冲区大小检查",
        ),
    ),
    ("驱动专项审核", ("MCU驱动审核", "AFE驱动审核", "Flash操作审核")),
    (
        "控制逻辑专项审核",
        ("状态机审核", "保护策略审核", "控制闭环审核", "故障恢复审核"),
    ),
)

_NUMBERED_ITEM_RE = re.compile(r"(?:^|\n)\s*\d+[.、]\s*")
_PLACEHOLDER_RE = re.compile(
    r"^\d*\s*(?:已确认的?)?(?:高|中|低)?风险(?:待验证)?问题$"
)


@dataclass(frozen=True)
class ClassifiedIssue:
    task_id: uuid.UUID
    task_date: date
    department_name: str
    description: str
    category: str
    subcategory: str
    risk_level: str


def previous_complete_week_bounds(
    now: datetime,
) -> tuple[date, date, datetime, datetime]:
    current = now.astimezone(WEEKLY_INSIGHT_TIMEZONE)
    current_week_start = current.date() - timedelta(days=current.weekday())
    period_start = current_week_start - timedelta(days=7)
    period_end_exclusive = current_week_start
    local_start = datetime.combine(
        period_start,
        time.min,
        tzinfo=WEEKLY_INSIGHT_TIMEZONE,
    )
    local_end = datetime.combine(
        period_end_exclusive,
        time.min,
        tzinfo=WEEKLY_INSIGHT_TIMEZONE,
    )
    return (
        period_start,
        period_end_exclusive,
        local_start.astimezone(timezone.utc).replace(tzinfo=None),
        local_end.astimezone(timezone.utc).replace(tzinfo=None),
    )


def split_useful_issues(value: str | None) -> list[str]:
    if not value or not value.strip():
        return []
    normalized = value.replace("\r", "").strip()
    normalized = re.sub(r"\s*\|\s*(?=\d+[.、]\s*)", "\n", normalized)
    normalized = re.sub(r"\s+(?=\d+[.、]\s+)", "\n", normalized)
    parts = [part.strip() for part in _NUMBERED_ITEM_RE.split(normalized)]
    return [part for part in parts if part]


def is_meaningful_issue(value: str) -> bool:
    normalized = value.strip()
    if not normalized or _PLACEHOLDER_RE.fullmatch(normalized):
        return False
    compact = re.sub(r"[\s\d.,，。:：;；\-]", "", normalized)
    return len(compact) >= 6


def classify_risk_level(value: str) -> str:
    if re.search(r"高风险|风险级别\s*[：:]\s*高|(?:^|[·\s])高\s*[-：:·]", value):
        return "high"
    if re.search(r"中风险|风险级别\s*[：:]\s*中|(?:^|[·\s])中\s*[-：:·]", value):
        return "medium"
    if re.search(r"低风险|风险级别\s*[：:]\s*低|(?:^|[·\s])低\s*[-：:·]", value):
        return "low"
    if re.search(r"建议|自检项结果|检查项", value):
        return "recommendation"
    return "unspecified"


def _contains(value: str, pattern: str) -> bool:
    return re.search(pattern, value, flags=re.IGNORECASE) is not None


def classify_issue(
    value: str,
    *,
    context: str = "",
) -> tuple[str, str]:
    combined = f"{value}\n{context}"

    if _contains(combined, r"重点项目|全规则"):
        return "重点项目发布审核", "全规则审核"
    if _contains(combined, r"客诉|客户投诉|现场高频|高频问题|历史问题复现"):
        return "品质风险审核", "客诉高频问题"

    communication_context = _contains(
        combined,
        r"协议|CAN|UART|Modbus|PYLON|RS[- ]?485|485|通讯|通信|报文|数据包|分帧|组包|回包|应答|端序|字节序|寄存器|命令|DLC|CRC|上位机|云平台|铁塔",
    )
    if communication_context and _contains(combined, r"超时|重发|重传|重试"):
        return "协议专项审核", "超时重发审核"
    if communication_context and _contains(
        combined,
        r"缓冲区|buffer|rxbuffer|txbuffer|帧长|data_len|数据长度|收发长度|回包长度|报文长度|数组越界|越界读取|越界写入|越界复制|截断",
    ):
        return "协议专项审核", "缓冲区大小检查"
    if communication_context and _contains(
        combined,
        r"通讯故障|通信故障|离线|掉线|丢帧|误码|校验失败|链路异常|连接异常",
    ):
        return "协议专项审核", "异常通信审核"
    if communication_context:
        return "协议专项审核", "通讯协议内容审核"

    if _contains(combined, r"Flash|闪存|OTA|BootLoader|擦除|写地址|写入地址"):
        return "驱动专项审核", "Flash操作审核"
    if _contains(combined, r"AFE|模拟前端|采样芯片|均衡芯片|BMU采样"):
        return "驱动专项审核", "AFE驱动审核"
    if _contains(
        combined,
        r"MCU|GPIO|ADC|DMA|SPI|I2C|IIC|中断|定时器|看门狗|引脚|外设驱动",
    ):
        return "驱动专项审核", "MCU驱动审核"

    if _contains(combined, r"故障恢复|恢复条件|恢复分支|复位链路|重启恢复|异常恢复"):
        return "控制逻辑专项审核", "故障恢复审核"
    if _contains(
        combined,
        r"保护|过流|过压|欠压|低压|SOC|MOS|DFET|CFET|告警|限流|禁充|禁放",
    ):
        return "控制逻辑专项审核", "保护策略审核"
    if _contains(combined, r"状态机|状态切换|状态迁移|STOP2|运行状态|状态覆盖"):
        return "控制逻辑专项审核", "状态机审核"
    if _contains(combined, r"控制闭环|闭环|反馈控制|继电器控制|加热控制|空调控制"):
        return "控制逻辑专项审核", "控制闭环审核"

    if _contains(combined, r"自检|检查项|工程配置|部门专项检查"):
        return "日常提交审核", "自检项检查"
    if _contains(combined, r"测试|用例|覆盖率|验证范围|回归验证"):
        return "日常提交审核", "测试补充审核"
    if _contains(
        combined,
        r"编码规范|魔鬼数字|命名|未使用|注释|宏名|重复调用|代码规范",
    ):
        return "日常提交审核", "编码规范审核"
    if _contains(combined, r"新增|删除|修改|变更|差异|同步调用点|影响范围"):
        return "日常提交审核", "变更点审核"
    return "日常提交审核", "基础逻辑审核"


def _shanghai_date(value: datetime | None) -> date | None:
    if value is None:
        return None
    aware = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    return aware.astimezone(WEEKLY_INSIGHT_TIMEZONE).date()


def _risk_count_template() -> dict[str, int]:
    return {
        "high": 0,
        "medium": 0,
        "low": 0,
        "recommendation": 0,
        "unspecified": 0,
    }


def build_weekly_insights(
    *,
    rows: list[tuple[ReviewTask, ReviewTaskReportFeedback | None]],
    period_start: date,
    period_end_exclusive: date,
    generated_at: datetime,
    scope_label: str,
) -> ReviewTaskWeeklyInsightsPublic:
    daily_counts: dict[date, dict[str, int]] = {}
    current_day = period_start
    while current_day < period_end_exclusive:
        daily_counts[current_day] = {
            "success": 0,
            "helpful": 0,
            "not_helpful": 0,
            "no_feedback": 0,
        }
        current_day += timedelta(days=1)

    department_counts: dict[str, dict[str, int]] = {}
    category_counts = {
        (category, subcategory): {
            "useful_count": 0,
            "high_risk_count": 0,
            "medium_risk_count": 0,
            "low_risk_count": 0,
        }
        for category, subcategories in CATEGORY_STRUCTURE
        for subcategory in subcategories
    }
    risk_counts = _risk_count_template()
    classified_issues: list[ClassifiedIssue] = []
    valid_issue_task_ids: set[uuid.UUID] = set()
    helpful_task_ids: set[uuid.UUID] = set()

    helpful = 0
    not_helpful = 0
    no_feedback = 0

    for task, feedback in rows:
        task_date = _shanghai_date(task.created_at)
        if task_date is None or task_date not in daily_counts:
            continue

        daily_counts[task_date]["success"] += 1
        department_name = task.department_name or "未标注部门"
        department = department_counts.setdefault(
            department_name,
            {
                "success": 0,
                "helpful": 0,
                "not_helpful": 0,
                "no_feedback": 0,
            },
        )
        department["success"] += 1

        if feedback is None:
            no_feedback += 1
            daily_counts[task_date]["no_feedback"] += 1
            department["no_feedback"] += 1
            continue
        if not feedback.helpful:
            not_helpful += 1
            daily_counts[task_date]["not_helpful"] += 1
            department["not_helpful"] += 1
            continue

        helpful += 1
        helpful_task_ids.add(task.id)
        daily_counts[task_date]["helpful"] += 1
        department["helpful"] += 1
        context = "\n".join(
            value
            for value in (task.skill_name, task.focus_direction_snapshot)
            if value
        )
        for issue_text in split_useful_issues(feedback.useful_issues_text):
            if not is_meaningful_issue(issue_text):
                continue
            category, subcategory = classify_issue(issue_text, context=context)
            risk_level = classify_risk_level(issue_text)
            category_stat = category_counts[(category, subcategory)]
            category_stat["useful_count"] += 1
            if risk_level == "high":
                category_stat["high_risk_count"] += 1
            elif risk_level == "medium":
                category_stat["medium_risk_count"] += 1
            elif risk_level == "low":
                category_stat["low_risk_count"] += 1
            risk_counts[risk_level] += 1
            valid_issue_task_ids.add(task.id)
            classified_issues.append(
                ClassifiedIssue(
                    task_id=task.id,
                    task_date=task_date,
                    department_name=department_name,
                    description=issue_text,
                    category=category,
                    subcategory=subcategory,
                    risk_level=risk_level,
                )
            )

    success_tasks = len(rows)
    feedback_count = helpful + not_helpful
    valid_issue_count = len(classified_issues)
    categories = [
        ReviewTaskWeeklyCategoryStatsPublic(
            category=category,
            subcategory=subcategory,
            **category_counts[(category, subcategory)],
        )
        for category, subcategories in CATEGORY_STRUCTURE
        for subcategory in subcategories
    ]
    departments = sorted(
        (
            ReviewTaskWeeklyDepartmentStatsPublic(
                department_name=department_name,
                **counts,
            )
            for department_name, counts in department_counts.items()
        ),
        key=lambda item: (-item.success, item.department_name),
    )
    daily = [
        ReviewTaskWeeklyDailyPointPublic(date=day, **counts)
        for day, counts in daily_counts.items()
    ]

    category_rank = sorted(
        (item for item in categories if item.useful_count > 0),
        key=lambda item: (-item.useful_count, -item.high_risk_count, item.subcategory),
    )
    representative_issues: list[ReviewTaskWeeklyRepresentativeIssuePublic] = []
    selected_descriptions: set[str] = set()
    for category_item in category_rank:
        candidate = next(
            (
                issue
                for issue in classified_issues
                if issue.subcategory == category_item.subcategory
                and issue.risk_level == "high"
                and issue.description not in selected_descriptions
            ),
            None,
        )
        if candidate is None:
            continue
        representative_issues.append(
            ReviewTaskWeeklyRepresentativeIssuePublic(**candidate.__dict__)
        )
        selected_descriptions.add(candidate.description)
        if len(representative_issues) >= 8:
            break

    for issue in classified_issues:
        if len(representative_issues) >= 8:
            break
        if issue.risk_level != "high" or issue.description in selected_descriptions:
            continue
        representative_issues.append(
            ReviewTaskWeeklyRepresentativeIssuePublic(**issue.__dict__)
        )
        selected_descriptions.add(issue.description)

    feedback_coverage_rate = feedback_count / success_tasks if success_tasks else 0
    explicit_useful_rate = helpful / feedback_count if feedback_count else 0
    top_summary = "、".join(
        f"{item.subcategory} {item.useful_count} 条" for item in category_rank[:3]
    ) or "暂无可归类的有用信息"
    attention_points = [
        f"上周完成 {success_tasks} 个成功任务，反馈覆盖率 {feedback_coverage_rate:.1%}；仍有 {no_feedback} 个任务未反馈。",
        f"已反馈任务中 {helpful} 个被确认有帮助，明确有用率 {explicit_useful_rate:.1%}；没帮助任务 {not_helpful} 个。",
        f"{len(valid_issue_task_ids)} 个任务包含可分析描述，共归类 {valid_issue_count} 条有效信息，其中高风险 {risk_counts['high']} 条。",
        f"有用信息主要集中在：{top_summary}。",
    ]

    return ReviewTaskWeeklyInsightsPublic(
        period_start=period_start,
        period_end=period_end_exclusive - timedelta(days=1),
        generated_at=generated_at,
        scope_label=scope_label,
        taxonomy_version=TAXONOMY_VERSION,
        success_tasks=success_tasks,
        helpful=helpful,
        not_helpful=not_helpful,
        no_feedback=no_feedback,
        feedback_coverage_rate=feedback_coverage_rate,
        explicit_useful_rate=explicit_useful_rate,
        valid_useful_tasks=len(valid_issue_task_ids),
        cleaning_tasks=len(helpful_task_ids - valid_issue_task_ids),
        valid_issue_count=valid_issue_count,
        risk_counts=risk_counts,
        attention_points=attention_points,
        daily=daily,
        categories=categories,
        departments=departments,
        representative_issues=representative_issues,
    )
