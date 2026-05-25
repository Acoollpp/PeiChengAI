/************************************************************
协议名：001-PYLON_CAN_Inverter_EMS.pdf

源文件名: Can_Pylon.c

英文名: PYLON

中文名：派能

枚举值：Can_Pylon = 1

变更：
2025.10.28  //程昊
1、初版发布      
     
***********************************************************/
#include "CAN_Comm.h"

/*************************************************
Function:    CanComPylon_CheckProtectFlag()
Description: 检查保护标志位函数
             根据逆变器状态数据检查各种保护条件，并返回对应的保护标志位
Return:      uint16_t - 保护标志位组合
             BIT1: 过压保护
             BIT2: 欠压保护  
             BIT3: 过温保护
             BIT4: 欠温保护
             BIT7: 放电过流保护
             BIT8: 充电过流保护
             BIT11: 系统错误保护
*************************************************/
static uint16_t CanComPylon_CheckProtectFlag(void)
{
    uint16_t wtmp = 0;

    if(InverterData.Status1 & (BIT0 | BIT2))  wtmp |= BIT1;   // 过压：单体+总压
    if(InverterData.Status1 & (BIT1 | BIT3))  wtmp |= BIT2;   // 欠压：单体+总压
    if(InverterData.Status2 & (BIT0 | BIT1))  wtmp |= BIT3;   // 过温：充放电高温
    if(InverterData.Status2 & (BIT2 | BIT3))  wtmp |= BIT4;   // 欠温：充放电低温
    if(InverterData.Status1 & BIT5)           wtmp |= BIT7;   // 放电过流
    if(InverterData.Status1 & BIT4)           wtmp |= BIT8;   // 充电过流
    if(InverterData.Status5 & 0x3F)           wtmp |= BIT11;  // 系统错误

    return wtmp;
}

/*************************************************
Function:    CanComPylon_CheckWarningFlag()
Description: 检查警告标志位函数
Return:      uint16_t - 警告标志位组合
             BIT1: 过压警告  BIT2: 欠压警告
             BIT3: 过温警告  BIT4: 欠温警告
             BIT7: 放电过流警告  BIT8: 充电过流警告
*************************************************/
static uint16_t CanComPylon_CheckWarningFlag(void)
{
    uint16_t wtmp = 0;

    if(InverterData.Warning1 & (BIT0 | BIT2))  wtmp |= BIT1;
    if(InverterData.Warning1 & (BIT1 | BIT3))  wtmp |= BIT2;
    if(InverterData.Warning2 & (BIT0 | BIT1))  wtmp |= BIT3;
    if(InverterData.Warning2 & (BIT2 | BIT3))  wtmp |= BIT4;
    if(InverterData.Warning1 & BIT5)           wtmp |= BIT7;
    if(InverterData.Warning1 & BIT4)           wtmp |= BIT8;

    return wtmp;
}

/*************************************************
Function:    CanComPylon_ForceCHG_Flag()
Description: 强制充放电标志位处理函数
Return:      uint8_t - 充放电控制标志位组合
             BIT7: 充电使能  BIT6: 放电使能
             BIT5: 强充1     BIT4: 强充2
             BIT3: 满充标志
*************************************************/
static uint8_t CanComPylon_ForceCHG_Flag(void)
{
    uint8_t ForceCHG_Cmd_t = 0;

    if(InverterData.ForceCHG_Cmd & BIT7)  ForceCHG_Cmd_t |= BIT7;  // 充电使能
    if(InverterData.ForceCHG_Cmd & BIT6)  ForceCHG_Cmd_t |= BIT6;  // 放电使能
    if(InverterData.ForceCHG_Cmd & BIT5)  ForceCHG_Cmd_t |= BIT5;  // 强充1
    if(InverterData.ForceCHG_Cmd & BIT4)  ForceCHG_Cmd_t |= BIT4;  // 强充2
    if(SocDataOut.Status.FullCharge_Flag) ForceCHG_Cmd_t |= BIT3;  // 满充

    return ForceCHG_Cmd_t;
}

/*************************************************
Function:    CanComPylon_SendCycleMsg()
Description: 周期性发送CAN消息函数
             8条报文轮询，每200ms发送一条，总周期1600ms
Note:        发送顺序：
             case 0: 0x359 - 保护警告信息
             case 1: 0x351 - 充放电电压电流
             case 2: 0x355 - SOC/SOH
             case 3: 0x356 - 电压电流温度
             case 4: 0x35C - 强制充放电控制
             case 5: 0x35E - 设备标识
             case 6: 0x373 - 单体电压温度极值
             case 7: 0x379 - 电池容量
*************************************************/
static void CanComPylon_SendCycleMsg(void)
{
    static uint8_t SendMsgIndex = 0;
    uint16_t wtmp = 0;

    Can_msg_Tx.DLC = 8;
    Can_msg_Tx.IDE = CAN_ID_STD;
    Can_msg_Tx.RTR = CAN_RTRQ_Data;

    switch(SendMsgIndex)
    {
        case 0:  // 0x359 保护警告
        {
            Can_msg_Tx.StdId = 0x359;
            wtmp = CanComPylon_CheckProtectFlag();
            Can_msg_Tx.Data[0] = (uint8_t)(wtmp);
            Can_msg_Tx.Data[1] = (uint8_t)((wtmp >> 8));
            wtmp = CanComPylon_CheckWarningFlag();
            Can_msg_Tx.Data[2] = (uint8_t)(wtmp);
            Can_msg_Tx.Data[3] = (uint8_t)((wtmp >> 8));
            Can_msg_Tx.Data[4] = (uint8_t)(InverterData.PackNum);
            Can_msg_Tx.Data[5] = 'p';
            Can_msg_Tx.Data[6] = 'N';
            Can_msg_Tx.Data[7] = 0;
            SendMsgIndex++;
            break;
        }
        case 1:  // 0x351 充放电限值
        {
            Can_msg_Tx.StdId = 0x351;
            Can_msg_Tx.Data[0] = (uint8_t)(InverterData.ChargeV);
            Can_msg_Tx.Data[1] = (uint8_t)((InverterData.ChargeV >> 8));
            Can_msg_Tx.Data[2] = (uint8_t)(InverterData.ChargeI);
            Can_msg_Tx.Data[3] = (uint8_t)((InverterData.ChargeI >> 8));
            Can_msg_Tx.Data[4] = (uint8_t)(InverterData.DisChargeI);
            Can_msg_Tx.Data[5] = (uint8_t)((InverterData.DisChargeI >> 8));
            Can_msg_Tx.Data[6] = (uint8_t)(InverterData.DisChargeV);
            Can_msg_Tx.Data[7] = (uint8_t)(InverterData.DisChargeV >> 8);
            SendMsgIndex++;
            break;
        }
        case 2:  // 0x355 SOC/SOH
        {
            Can_msg_Tx.StdId = 0x355;
            Can_msg_Tx.Data[0] = (uint8_t)(InverterData.Soc);
            Can_msg_Tx.Data[1] = 0;
            Can_msg_Tx.Data[2] = (uint8_t)(InverterData.Soh);
            Can_msg_Tx.Data[3] = 0;
            Can_msg_Tx.Data[4] = Can_msg_Tx.Data[5] = 0;
            Can_msg_Tx.Data[6] = Can_msg_Tx.Data[7] = 0;
            SendMsgIndex++;
            break;
        }
        case 3:  // 0x356 模拟量
        {
            Can_msg_Tx.StdId = 0x356;
            Can_msg_Tx.Data[0] = (uint8_t)(InverterData.VsumAvg / 10);           // 0.01V
            Can_msg_Tx.Data[1] = (uint8_t)((InverterData.VsumAvg / 10) >> 8);
            Can_msg_Tx.Data[2] = (uint8_t)(InverterData.Current / 10);            // 0.1A
            Can_msg_Tx.Data[3] = (uint8_t)((InverterData.Current / 10) >> 8);
            Can_msg_Tx.Data[4] = (uint8_t)(InverterData.BatteryTemp - 2730);      // 0.1°C（K→℃）
            Can_msg_Tx.Data[5] = (uint8_t)((InverterData.BatteryTemp - 2730) >> 8);
            Can_msg_Tx.Data[6] = 0;
            Can_msg_Tx.Data[7] = 0;
            SendMsgIndex++;
            break;
        }
        case 4:  // 0x35C 控制请求
        {
            Can_msg_Tx.StdId = 0x35C;
            Can_msg_Tx.Data[0] = CanComPylon_ForceCHG_Flag();
            Can_msg_Tx.Data[1] = Can_msg_Tx.Data[2] = Can_msg_Tx.Data[3] = 0;
            Can_msg_Tx.Data[4] = Can_msg_Tx.Data[5] = Can_msg_Tx.Data[6] = Can_msg_Tx.Data[7] = 0;
            SendMsgIndex++;
            break;
        }
        case 5:  // 0x35E 品牌标识
        {
            Can_msg_Tx.StdId = 0x35E;
            Can_msg_Tx.Data[0] = 'P';
            Can_msg_Tx.Data[1] = 'Y';
            Can_msg_Tx.Data[2] = 'L';
            Can_msg_Tx.Data[3] = 'O';
            Can_msg_Tx.Data[4] = 'N';
            Can_msg_Tx.Data[5] = 0;
            Can_msg_Tx.Data[6] = 0;
            Can_msg_Tx.Data[7] = 0;
            SendMsgIndex++;
            break;
        }
        case 6:  // 0x373 单芯极值
        {
            Can_msg_Tx.StdId = 0x373;
            Can_msg_Tx.Data[0] = (uint8_t)(InverterData.Gmin);             // 0.001V
            Can_msg_Tx.Data[1] = (uint8_t)(InverterData.Gmin >> 8);
            Can_msg_Tx.Data[2] = (uint8_t)(InverterData.Gmax);
            Can_msg_Tx.Data[3] = (uint8_t)(InverterData.Gmax >> 8);
            Can_msg_Tx.Data[4] = (uint8_t)(InverterData.Tmin / 10);        // 1K
            Can_msg_Tx.Data[5] = (uint8_t)((InverterData.Tmin / 10) >> 8);
            Can_msg_Tx.Data[6] = (uint8_t)(InverterData.Tmax / 10);
            Can_msg_Tx.Data[7] = (uint8_t)((InverterData.Tmax / 10) >> 8);
            SendMsgIndex++;
            break;
        }
        case 7:  // 0x379 装机总容量
        {
            Can_msg_Tx.StdId = 0x379;
            Can_msg_Tx.Data[0] = (uint8_t)(InverterData.FccAll / 100);          // Ah
            Can_msg_Tx.Data[1] = (uint8_t)((InverterData.FccAll / 100) >> 8);
            Can_msg_Tx.Data[2] = (uint8_t)((InverterData.FccAll / 100) >> 16);
            Can_msg_Tx.Data[3] = (uint8_t)((InverterData.FccAll / 100) >> 24);
            Can_msg_Tx.Data[4] = 0;
            Can_msg_Tx.Data[5] = 0;
            Can_msg_Tx.Data[6] = 0;
            Can_msg_Tx.Data[7] = 0;
            SendMsgIndex = 0;  // 重置，开始下一轮
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
Function:    CanComPylon_Init()
Description: 派能CAN协议初始化函数
Parameters:  CanRate_t baudrate - CAN总线波特率
*************************************************/
void CanComPylon_Init(CanRate_t baudrate)
{
    Current_Can_Rate = baudrate;
    CAN_Config(Current_Can_Rate);
    Set_Timer(CANCOMPNTIMER, 1);
}

/*************************************************
Function:    CanComPylon_MainCall()
Description: 主循环调用函数，200ms定时触发发送
Note:        8条报文轮询，总周期1600ms
*************************************************/
void CanComPylon_MainCall(void)
{
    if(Timer[CANCOMPNTIMER].Flag)
    {
        Set_Timer(CANCOMPNTIMER, 8);        // 200ms = 8 × 25ms tick
        CanComPylon_SendCycleMsg();
    }
}

/*************************************************
Function:    CanComPylon_ReceiveIRQ()
Description: 接收中断处理函数
Parameters:  const CanRxMessage *msg - 接收消息指针
Note:        标准帧范围 0x305~0x3FF
             扩展帧范围 0x4000000~0x5200000
*************************************************/
void CanComPylon_ReceiveIRQ(const CanRxMessage *msg)
{
    if(msg->IDE == CAN_ID_EXT)
    {
        if((msg->ExtId >= 0x4000000) && (msg->ExtId <= 0x5200000))
        {
            // TODO: Can_ReceiveFunc.RxHandlerExt(msg);
        }
    }
    else if(msg->IDE == CAN_ID_STD)
    {
        if((msg->StdId >= 0x305) && (msg->StdId <= 0x3FF))
        {
            // TODO: Can_ReceiveFunc.RxHandlerStd(msg);
        }
    }
}
