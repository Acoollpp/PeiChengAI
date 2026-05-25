/************************************************************
协议名：{PROTOCOL_DOC_NAME}

源文件名: Can_{ProtocolName}.c

英文名: {PROTOCOL_EN}

中文名：{PROTOCOL_CN}

枚举值：Can_{ProtocolName} = {ENUM_VAL}

变更：
{DATE}  //{AUTHOR}
1、初版发布

***********************************************************/
#include "CAN_Comm.h"

/*************************************************
Function:    CanCom{Name}_CheckProtectFlag()
Description: 检查保护标志位
             根据状态数据生成保护标志位组合
Return:      uint16_t - 保护标志位（各 BIT 含义见协议文档）
*************************************************/
static uint16_t CanCom{Name}_CheckProtectFlag(void)
{
    uint16_t wtmp = 0;

    /* TODO: 根据协议文档填充保护位逻辑 */
    /* 示例：if(InverterData.StatusX & BITX)  wtmp |= BITX;  // 含义说明 */

    return wtmp;
}

/*************************************************
Function:    CanCom{Name}_CheckWarningFlag()
Description: 检查告警标志位
Return:      uint16_t - 告警标志位
*************************************************/
static uint16_t CanCom{Name}_CheckWarningFlag(void)
{
    uint16_t wtmp = 0;

    /* TODO: 根据协议文档填充告警位逻辑 */

    return wtmp;
}

/*************************************************
Function:    CanCom{Name}_ForceCHG_Flag()
Description: 充放电控制标志位处理
Return:      uint8_t - 控制标志位
*************************************************/
static uint8_t CanCom{Name}_ForceCHG_Flag(void)
{
    uint8_t ForceCHG_Cmd_t = 0;

    /* TODO: 根据协议文档填充控制位逻辑 */

    return ForceCHG_Cmd_t;
}

/*************************************************
Function:    CanCom{Name}_SendCycleMsg()
Description: 周期性发送 CAN 报文
             {N} 条报文轮询，每条间隔 {INTERVAL}ms，总周期 {TOTAL}ms
Note:        发送顺序：
             case 0: 0x{ID0} - {DESC0}
             case 1: 0x{ID1} - {DESC1}
             ...（按协议填充）
*************************************************/
static void CanCom{Name}_SendCycleMsg(void)
{
    static uint8_t SendMsgIndex = 0;
    uint16_t wtmp = 0;

    Can_msg_Tx.DLC = 8;
    Can_msg_Tx.IDE = CAN_ID_STD;
    Can_msg_Tx.RTR = CAN_RTRQ_Data;

    switch(SendMsgIndex)
    {
        case 0:
        {
            Can_msg_Tx.StdId = 0x{ID0};
            /* TODO: 填充 Data[0]~Data[7] */
            SendMsgIndex++;
            break;
        }
        /* TODO: 按协议报文数量添加 case */
        case {N_MINUS_1}:  /* 最后一条报文 */
        {
            Can_msg_Tx.StdId = 0x{IDN};
            /* TODO: 填充 Data[0]~Data[7] */
            SendMsgIndex = 0;  /* 末尾重置 */
            break;
        }
        default:
        {
            SendMsgIndex = 0;
            break;
        }
    }

    Can_TransmitData(&Can_msg_Tx);
}

/*************************************************
Function:    CanCom{Name}_Init()
Description: {ProtocolName} CAN 协议初始化
Parameters:  baudrate - CAN 总线波特率
*************************************************/
void CanCom{Name}_Init(CanRate_t baudrate)
{
    Current_Can_Rate = baudrate;
    CAN_Config(Current_Can_Rate);
    Set_Timer(CANCOM{NAME_UPPER}TIMER, 1);
}

/*************************************************
Function:    CanCom{Name}_MainCall()
Description: 主循环调用，{INTERVAL}ms 定时触发发送
Note:        {N} 条报文轮询，总周期 {TOTAL}ms
*************************************************/
void CanCom{Name}_MainCall(void)
{
    if(Timer[CANCOM{NAME_UPPER}TIMER].Flag)
    {
        Set_Timer(CANCOM{NAME_UPPER}TIMER, {TIMER_TICKS});  /* {INTERVAL}ms = {TIMER_TICKS} × 25ms tick */
        CanCom{Name}_SendCycleMsg();
    }
}

/*************************************************
Function:    CanCom{Name}_ReceiveIRQ()
Description: 接收中断处理
Parameters:  msg - 接收到的 CAN 消息指针
Note:        标准帧范围 0x{STD_MIN}~0x{STD_MAX}
             扩展帧范围 0x{EXT_MIN}~0x{EXT_MAX}（无则删除此段）
*************************************************/
void CanCom{Name}_ReceiveIRQ(const CanRxMessage *msg)
{
    if(msg->IDE == CAN_ID_EXT)
    {
        if((msg->ExtId >= 0x{EXT_MIN}) && (msg->ExtId <= 0x{EXT_MAX}))
        {
            /* TODO: 扩展帧处理 */
        }
    }
    else if(msg->IDE == CAN_ID_STD)
    {
        if((msg->StdId >= 0x{STD_MIN}) && (msg->StdId <= 0x{STD_MAX}))
        {
            /* TODO: 标准帧处理，按 ID switch 分发 */
        }
    }
}
