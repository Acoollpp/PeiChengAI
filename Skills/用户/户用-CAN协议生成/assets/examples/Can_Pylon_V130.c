/************************************************************
协议名：001-PYLON_CAN_LV_V1_3-2019_07_02.pdf

源文件名: Can_Pylon_V130.c

英文名: Pylon_V130

中文名：派能_V130

枚举值：Can_Pylon_V130 = N,//程昊

变更：
2026.03.30  //程昊
1、初版发布，基于 PYLON CANBUS Protocol V1.3（2019/07/02）

***********************************************************/
#include "CAN_Comm.h"

/*************************************************
Function:    CanComPylon_V130_CheckProtectFlag()
Description: 检查保护标志位
             Byte0(Table1): 过压/欠压/过温/欠温/放电过流
             Byte1(Table2): 充电过流/系统错误
Return:      uint16_t - 低字节=Byte0，高字节=Byte1
*************************************************/
static uint16_t CanComPylon_V130_CheckProtectFlag(void)
{
    uint16_t wtmp = 0;

    //Byte0(Table1)
    if(InverterData.Status1 & (BIT0 | BIT2))
    {
        wtmp |= BIT1;  //over voltage
    }
    if(InverterData.Status1 & (BIT1 | BIT3))
    {
        wtmp |= BIT2;  //under voltage
    }
    if(InverterData.Status2 & (BIT0 | BIT1))
    {
        wtmp |= BIT3;  //cell over temperature
    }
    if(InverterData.Status2 & (BIT2 | BIT3))
    {
        wtmp |= BIT4;  //cell under temperature
    }
    if(InverterData.Status1 & BIT5)
    {
        wtmp |= BIT7;  //discharge over current
    }

    //Byte1(Table2)
    if(InverterData.Status1 & BIT4)
    {
        wtmp |= BIT8;   //charge over current
    }
    if(InverterData.Status5 & (BIT0|BIT1|BIT2|BIT3|BIT4|BIT5))
    {
        wtmp |= BIT11;  //system error
    }

    return wtmp;
}

/*************************************************
Function:    CanComPylon_V130_CheckWarningFlag()
Description: 检查告警标志位
             Byte2(Table3): 高压/低压/高温/低温/放电大电流
             Byte3(Table4): 充电大电流/内部通信失败
Return:      uint16_t - 低字节=Byte2，高字节=Byte3
*************************************************/
static uint16_t CanComPylon_V130_CheckWarningFlag(void)
{
    uint16_t wtmp = 0;

    //Byte2(Table3)
    if(InverterData.Warning1 & (BIT0 | BIT2))
    {
        wtmp |= BIT1;  //cell or module high voltage
    }
    if(InverterData.Warning1 & (BIT1 | BIT3))
    {
        wtmp |= BIT2;  //cell or module low voltage
    }
    if(InverterData.Warning2 & (BIT0 | BIT1))
    {
        wtmp |= BIT3;  //cell high temperature
    }
    if(InverterData.Warning2 & (BIT2 | BIT3))
    {
        wtmp |= BIT4;  //cell low temperature
    }
    if(InverterData.Warning1 & BIT5)
    {
        wtmp |= BIT7;  //discharge high current
    }

    //Byte3(Table4)
    if(InverterData.Warning1 & BIT4)
    {
        wtmp |= BIT8;  //charge high current
    }
    /* TODO[未实现]: internal communication fail (Byte3-Bit3)
     * 协议来源: 0x359 Table4 Bit3
     * 原因: InverterData 中无对应字段（Warning1/2均无此位），待确认数据源
     */

    return wtmp;
}

/*************************************************
Function:    CanComPylon_V130_ForceCHG_Flag()
Description: 生成充放电控制标志位（0x35C Byte0 Table5）
Return:      uint8_t - Bit7=充电使能 Bit6=放电使能
                       Bit5=强充1 Bit4=强充2 Bit3=满充
*************************************************/
static uint8_t CanComPylon_V130_ForceCHG_Flag(void)
{
    uint8_t ForceCHG_Cmd_t = 0;

    if(InverterData.ForceCHG_Cmd & BIT7)
    {
        ForceCHG_Cmd_t |= BIT7;  //charge enable
    }
    if(InverterData.ForceCHG_Cmd & BIT6)
    {
        ForceCHG_Cmd_t |= BIT6;  //discharge enable
    }
    if(InverterData.ForceCHG_Cmd & BIT5)
    {
        ForceCHG_Cmd_t |= BIT5;  //request force charge I
    }
    if(InverterData.ForceCHG_Cmd & BIT4)
    {
        ForceCHG_Cmd_t |= BIT4;  //request force charge II
    }
    /* TODO[未实现]: request full charge (Bit3)
     * 协议来源: 0x35C Table5 Bit3
     * 原因: InverterData 中无满充标志字段，待确认数据源
     */

    return ForceCHG_Cmd_t;
}

/*************************************************
Function:    CanComPylon_V130_SendCycleMsg()
Description: 周期发送CAN报文，6条轮询，总周期1.2s
Note:        消息发送顺序：
             case 0: 0x359 - 保护告警信息
             case 1: 0x351 - 充放电电压电流
             case 2: 0x355 - SOC/SOH信息
             case 3: 0x356 - 电压电流温度
             case 4: 0x35C - 充放电控制
             case 5: 0x35E - 设备标识
*************************************************/
static void CanComPylon_V130_SendCycleMsg(void)
{
    static uint8_t SendMsgIndex = 0;

    Can_msg_Tx.DLC = 8;
    Can_msg_Tx.IDE = CAN_ID_STD;
    Can_msg_Tx.RTR = CAN_RTRQ_Data;

    switch(SendMsgIndex)
    {
        case 0:  //0x359 保护告警
        {
            uint16_t protect = CanComPylon_V130_CheckProtectFlag();
            uint16_t warning = CanComPylon_V130_CheckWarningFlag();

            Can_msg_Tx.StdId   = 0x359;
            Can_msg_Tx.Data[0] = (uint8_t)(protect);        //Protection Table1
            Can_msg_Tx.Data[1] = (uint8_t)(protect >> 8);   //Protection Table2
            Can_msg_Tx.Data[2] = (uint8_t)(warning);        //Alarm Table3
            Can_msg_Tx.Data[3] = (uint8_t)(warning >> 8);   //Alarm Table4
            Can_msg_Tx.Data[4] = (uint8_t)(InverterData.PackNum);  //Module numbers
            Can_msg_Tx.Data[5] = 'P';
            Can_msg_Tx.Data[6] = 'N';
            Can_msg_Tx.Data[7] = 0;

            SendMsgIndex++;
            break;
        }

        case 1:  //0x351 充放电限值
        {
            Can_msg_Tx.StdId   = 0x351;
            Can_msg_Tx.Data[0] = (uint8_t)(InverterData.ChargeV);               //充电电压 0.1V uint16
            Can_msg_Tx.Data[1] = (uint8_t)(InverterData.ChargeV >> 8);
            Can_msg_Tx.Data[2] = (uint8_t)((int16_t)InverterData.ChargeI);      //充电限流 0.1A int16
            Can_msg_Tx.Data[3] = (uint8_t)((int16_t)InverterData.ChargeI >> 8);
            Can_msg_Tx.Data[4] = (uint8_t)((int16_t)InverterData.DisChargeI);   //放电限流 0.1A int16
            Can_msg_Tx.Data[5] = (uint8_t)((int16_t)InverterData.DisChargeI >> 8);
            Can_msg_Tx.Data[6] = (uint8_t)((int16_t)InverterData.DisChargeV);   //放电电压 0.1V int16
            Can_msg_Tx.Data[7] = (uint8_t)((int16_t)InverterData.DisChargeV >> 8);

            SendMsgIndex++;
            break;
        }

        case 2:  //0x355 SOC/SOH
        {
            //Soc/Soh 为 uint8_t，协议要求 16bit，高字节补0
            Can_msg_Tx.StdId   = 0x355;
            Can_msg_Tx.Data[0] = (uint8_t)(InverterData.Soc);   //SOC 1% low byte
            Can_msg_Tx.Data[1] = 0;                              //SOC high byte
            Can_msg_Tx.Data[2] = (uint8_t)(InverterData.Soh);   //SOH 1% low byte
            Can_msg_Tx.Data[3] = 0;                              //SOH high byte
            Can_msg_Tx.Data[4] = 0;
            Can_msg_Tx.Data[5] = 0;
            Can_msg_Tx.Data[6] = 0;
            Can_msg_Tx.Data[7] = 0;

            SendMsgIndex++;
            break;
        }

        case 3:  //0x356 模拟量
        {
            //Current: 内部单位10mA，协议单位0.1A，换算：/10 → 单位变为100mA=0.1A
            //BatteryTemp: 内部单位0.1K，协议单位0.1°C，换算：- 2730（单位相同，仅做零点偏移）
            int16_t current_01A  = (int16_t)(InverterData.Current / 10);
            int16_t temp_01degC  = (int16_t)(InverterData.BatteryTemp - 2730);

            Can_msg_Tx.StdId   = 0x356;
            Can_msg_Tx.Data[0] = (uint8_t)((int16_t)(InverterData.VsumAvg / 10));       //电压 0.01V int16（内部mV /10）
            Can_msg_Tx.Data[1] = (uint8_t)((int16_t)(InverterData.VsumAvg / 10) >> 8);
            Can_msg_Tx.Data[2] = (uint8_t)(current_01A);                                 //电流 0.1A int16
            Can_msg_Tx.Data[3] = (uint8_t)(current_01A >> 8);
            Can_msg_Tx.Data[4] = (uint8_t)(temp_01degC);                                 //温度 0.1°C int16
            Can_msg_Tx.Data[5] = (uint8_t)(temp_01degC >> 8);
            Can_msg_Tx.Data[6] = 0;
            Can_msg_Tx.Data[7] = 0;

            SendMsgIndex++;
            break;
        }

        case 4:  //0x35C 充放电控制
        {
            Can_msg_Tx.StdId   = 0x35C;
            Can_msg_Tx.Data[0] = CanComPylon_V130_ForceCHG_Flag();
            Can_msg_Tx.Data[1] = 0;
            Can_msg_Tx.Data[2] = 0;
            Can_msg_Tx.Data[3] = 0;
            Can_msg_Tx.Data[4] = 0;
            Can_msg_Tx.Data[5] = 0;
            Can_msg_Tx.Data[6] = 0;
            Can_msg_Tx.Data[7] = 0;

            SendMsgIndex++;
            break;
        }

        case 5:  //0x35E 设备标识
        {
            Can_msg_Tx.StdId   = 0x35E;
            Can_msg_Tx.Data[0] = 'P';
            Can_msg_Tx.Data[1] = 'Y';
            Can_msg_Tx.Data[2] = 0;
            Can_msg_Tx.Data[3] = 0;
            Can_msg_Tx.Data[4] = 0;
            Can_msg_Tx.Data[5] = 0;
            Can_msg_Tx.Data[6] = 0;
            Can_msg_Tx.Data[7] = 0;

            SendMsgIndex = 0;
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
Function:    CanComPylon_V130_Init()
Description: 派能 V1.3协议初始化
Parameters:  baudrate - CAN总线波特率
*************************************************/
void CanComPylon_V130_Init(CanRate_t baudrate)
{
    Current_Can_Rate = baudrate;
    CAN_Config(Current_Can_Rate);
    Set_Timer(CANCOMPNTIMER, 1);
}

/*************************************************
Function:    CanComPylon_V130_MainCall()
Description: 主循环调用，6条报文轮询，总周期1.2s
Note:        200ms = 8 x 25ms tick
*************************************************/
void CanComPylon_V130_MainCall(void)
{
    if(Timer[CANCOMPNTIMER].Flag)
    {
        Set_Timer(CANCOMPNTIMER, 8);
        CanComPylon_V130_SendCycleMsg();
    }
}

/*************************************************
Function:    CanComPylon_V130_ReceiveIRQ()
Description: 接收中断处理
Parameters:  msg - 接收到的CAN消息指针
Note:        0x305 逆变器每秒回复，8字节全0，无需处理
             0x1001 逆变器握手心跳，可选功能，见TODO
*************************************************/
void CanComPylon_V130_ReceiveIRQ(const CanRxMessage *msg)
{
    if(msg->IDE == CAN_ID_STD)
    {
        switch(msg->StdId)
        {
            case 0x305:
            {
                break;
            }
            case 0x1001:
            {
                /* TODO[未实现]: 逆变器握手心跳超时关机
                 * 协议来源: 0x1001，PYLON LV V1.3 p.5
                 * 原因: 需上层提供5分钟看门狗接口，当前未实现
                 */
                break;
            }
            default:
            {
                break;
            }
        }
    }
}
