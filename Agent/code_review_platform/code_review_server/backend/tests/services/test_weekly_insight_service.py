from datetime import datetime, timezone

import pytest

from app.services.weekly_insight_service import (
    classify_issue,
    is_meaningful_issue,
    previous_complete_week_bounds,
    split_useful_issues,
)


@pytest.mark.parametrize(
    ("description", "expected"),
    [
        ("新增接口后未同步调用点", ("日常提交审核", "变更点审核")),
        ("编码规范检查发现大量魔鬼数字", ("日常提交审核", "编码规范审核")),
        ("条件分支顺序错误导致结果不一致", ("日常提交审核", "基础逻辑审核")),
        ("缺少边界测试用例和回归验证", ("日常提交审核", "测试补充审核")),
        ("部门自检项未执行", ("日常提交审核", "自检项检查")),
        ("历史客诉高频问题再次出现", ("品质风险审核", "客诉高频问题")),
        ("重点项目需要执行全规则审核", ("重点项目发布审核", "全规则审核")),
        ("Modbus 寄存器响应字段错误", ("协议专项审核", "通讯协议内容审核")),
        ("CAN 通讯故障会被离线状态掩盖", ("协议专项审核", "异常通信审核")),
        ("CAN 超时后未执行重发", ("协议专项审核", "超时重发审核")),
        ("UART 接收缓冲区小于报文长度", ("协议专项审核", "缓冲区大小检查")),
        ("序列号应答按 8 字节分帧但每帧只能承载 6 字节", ("协议专项审核", "通讯协议内容审核")),
        ("RS485 协议名称回包长度可由外部报文驱动越界复制", ("协议专项审核", "缓冲区大小检查")),
        ("MCU GPIO 引脚初始化方向错误", ("驱动专项审核", "MCU驱动审核")),
        ("AFE 采样芯片异常计数被覆盖", ("驱动专项审核", "AFE驱动审核")),
        ("Flash 写入地址未校验", ("驱动专项审核", "Flash操作审核")),
        ("STOP2 状态切换未进入唤醒链路", ("控制逻辑专项审核", "状态机审核")),
        ("充电过流保护恢复条件错误", ("控制逻辑专项审核", "故障恢复审核")),
        ("空调控制闭环使用了陈旧反馈", ("控制逻辑专项审核", "控制闭环审核")),
        ("低压保护未关闭 DFET", ("控制逻辑专项审核", "保护策略审核")),
    ],
)
def test_classify_issue_uses_fixed_taxonomy(
    description: str,
    expected: tuple[str, str],
) -> None:
    assert classify_issue(description) == expected


def test_split_and_clean_useful_issues() -> None:
    content = "1. 高风险：CAN 超时未重发\n2. 1\n3. 中风险：Flash 写入失败"

    issues = split_useful_issues(content)

    assert issues == [
        "高风险：CAN 超时未重发",
        "1",
        "中风险：Flash 写入失败",
    ]
    assert is_meaningful_issue(issues[0]) is True
    assert is_meaningful_issue(issues[1]) is False


def test_previous_complete_week_uses_shanghai_calendar() -> None:
    period_start, period_end, start_utc, end_utc = previous_complete_week_bounds(
        datetime(2026, 7, 27, 9, tzinfo=timezone.utc)
    )

    assert period_start.isoformat() == "2026-07-20"
    assert period_end.isoformat() == "2026-07-27"
    assert start_utc.isoformat() == "2026-07-19T16:00:00"
    assert end_utc.isoformat() == "2026-07-26T16:00:00"
