/************************************************************
协议名：010-Victron CAN_Freedom_Won 2023.04.18.docx

源文件名: Can_Victron_230418.c

英文名: VICTRON_230418

中文名：维克多_V230418

枚举值：Can_Victron_230418 = 106

变更：
2025.11.3  //程昊
1、初版发布

***********************************************************/

#include "CAN_Comm.h"

static uint8_t VE_name[8]="Victron";
/*************************************************

Function:	CanComVictron_CheckProtectFlag()

Description:

*************************************************/
static uint8_t Victron_CheckProtectFlag0(void)
{
    uint8_t wtmp = 0;

    //over voltage
    if (InverterData.Status1 & (BIT0 | BIT2))
    {
        wtmp |= BIT2;
    }
    else
    {
        wtmp |= BIT3;
    }

    //under voltage
    if (InverterData.Status1 & (BIT1 | BIT3))
    {
        wtmp |= BIT4;
    }
    else
    {
        wtmp |= BIT5;
    }

    //放电cell over temp
    if (InverterData.Status2 & BIT1)
    {
        wtmp |= BIT6;
    }
    else
    {
        wtmp |= BIT7;
    }
    return wtmp;
}
static uint8_t Victron_CheckProtectFlag1(void)
{
    uint8_t wtmp = 0;

    //放电cell under temp
    if (InverterData.Status2 & BIT3)
    {
        wtmp |= BIT0;
    }
    else
    {
        wtmp |= BIT1;
    }
    //充电cell over temp
    if (InverterData.Status2 & BIT0)
    {
        wtmp |= BIT2;
    }
    else
    {
        wtmp |= BIT3;
    }
    //充电cell under temp
    if (InverterData.Status2 & BIT2)
    {
        wtmp |= BIT4;
    }
    else
    {
        wtmp |= BIT5;
    }
    //dsg over curr
    if (InverterData.Status1 & BIT5)
    {
        wtmp |= BIT6;
    }
    else
    {
        wtmp |= BIT7;
    }
    return wtmp;
}
static uint8_t Victron_CheckProtectFlag2(void)
{
    uint8_t wtmp = 0;
    //chg over curr
    if (InverterData.Status1 & BIT4)
    {
        wtmp |= BIT0;
    }
    else
    {
        wtmp |= BIT1;
    }

    if (InverterData.Status1 & BIT6)
    {
        wtmp |= BIT4;
    }
    else
    {
        wtmp |= BIT5;
    }

    if (InverterData.Status5 & (BIT4 | BIT5))
    {
        wtmp |= BIT6;
    }
    else
    {
        wtmp |= BIT7;
    }
    return wtmp;
}
static uint8_t Victron_CheckProtectFlag3(void)
{
    uint8_t wtmp = 0;
    //不平衡告警
    if (InverterData.Status6 || InverterData.Status7)
    {
        wtmp |= BIT0;
    }
    else
    {
        wtmp |= BIT1;
    }
    return wtmp;
}
/*************************************************

Function:	CanComVictron_CheckWarningFlag()

Description:

*************************************************/
static uint8_t Victron_CheckWarningFlag0(void)
{
    uint8_t wtmp = 0;

    //over voltage
    if (InverterData.Warning1 & (BIT0|BIT2))
    {
        wtmp |= BIT2;
    }
   else
    {
        wtmp |= BIT3;
    }

    //under voltage
   if (InverterData.Warning1 & (BIT1|BIT3))
   {
       wtmp |= BIT4;
   }
   else
    {
        wtmp |= BIT5;
    }

    //放电cell over temp
   if (InverterData.Warning2 & BIT1)
   {
       wtmp |= BIT6;
   }
   else
    {
        wtmp |= BIT7;
    }
    return wtmp;
}
static uint8_t Victron_CheckWarningFlag1(void)
{
    uint8_t wtmp = 0;

    //放电cell under temp
    if (InverterData.Warning2 & BIT3)
    {
        wtmp |= BIT0;
    }
    else
    {
        wtmp |= BIT1;
    }
    //充电cell over temp
    if (InverterData.Warning2 & BIT0)
    {
        wtmp |= BIT2;
    }
    else
    {
        wtmp |= BIT3;
    }
    //充电cell under temp
    if (InverterData.Warning2 & BIT2)
    {
        wtmp |= BIT4;
    }
    else
    {
        wtmp |= BIT5;
    }
    //dsg over curr
    if (InverterData.Warning1 & BIT5)
    {
        wtmp |= BIT6;
    }
    else
    {
        wtmp |= BIT7;
    }
    return wtmp;
}
static uint8_t Victron_CheckWarningFlag2(void)
{
    uint8_t wtmp = 0;
    //chg over curr
    if (InverterData.Warning1 & BIT4)
    {
        wtmp |= BIT0;
    }
    else
    {
        wtmp |= BIT1;
    }
    return wtmp;

    if (InverterData.Status1 & BIT6)
    {
        wtmp |= BIT4;
    }
    else
    {
        wtmp |= BIT5;
    }

    if (InverterData.Status5 & (BIT4 | BIT5))
    {
        wtmp |= BIT6;
    }
    else
    {
        wtmp |= BIT7;
    }
}
static uint8_t Victron_CheckWarningFlag3(void)
{
    uint8_t wtmp = 0;
    //不平衡告警
    if (InverterData.Status6 || InverterData.Status7)
    {
        wtmp |= BIT0;
    }
    else
    {
        wtmp |= BIT1;
    }
    return wtmp;
}
/*************************************************

Function:	CanComVictron_SendCycleMsg()

Description:

*************************************************/
static void Victron_SendCycleMsg(void)
{
    static uint8_t SendMsgIndex = 0;
    uint8_t tmp;
    Can_msg_Tx.DLC = 8;
    Can_msg_Tx.IDE = CAN_ID_STD;
    Can_msg_Tx.RTR = CAN_RTRQ_Data;

    switch (SendMsgIndex)
    {
    case 0:
    {
        Can_msg_Tx.StdId = 0x35A;

        Can_msg_Tx.Data[0] = Victron_CheckProtectFlag0();
        Can_msg_Tx.Data[1] = Victron_CheckProtectFlag1();
        Can_msg_Tx.Data[2] = Victron_CheckProtectFlag2();
        Can_msg_Tx.Data[3] = Victron_CheckProtectFlag3();

        Can_msg_Tx.Data[4] = Victron_CheckWarningFlag0();
        Can_msg_Tx.Data[5] = Victron_CheckWarningFlag1();
        Can_msg_Tx.Data[6] = Victron_CheckWarningFlag2();
        Can_msg_Tx.Data[7] = Victron_CheckWarningFlag3();

        SendMsgIndex++;
        break;
    }

    case 1:
    {
        Can_msg_Tx.StdId = 0x351;

        Can_msg_Tx.Data[0] = (uint8_t)(InverterData.ChargeV & 0x00FF);        //(uint8_t)(InverterData.ChargeV & 0x00FF);
        Can_msg_Tx.Data[1] = (uint8_t)((InverterData.ChargeV >> 8) & 0x00FF); //(uint8_t)((InverterData.ChargeV >> 8) & 0x00FF);

        Can_msg_Tx.Data[2] = (uint8_t)((InverterData.ChargeI) & 0x00FF);      //(uint8_t)(InverterData.ChargeI & 0x00FF);
        Can_msg_Tx.Data[3] = (uint8_t)((InverterData.ChargeI >> 8) & 0x00FF); //(uint8_t)((InverterData.ChargeI >> 8) & 0x00FF);

        Can_msg_Tx.Data[4] = (uint8_t)((InverterData.DisChargeI) & 0x00FF);      //(uint8_t)(InverterData.DisChargeI & 0x00FF);
        Can_msg_Tx.Data[5] = (uint8_t)((InverterData.DisChargeI >> 8) & 0x00FF); //(uint8_t)((InverterData.DisChargeI >> 8) & 0x00FF);

        Can_msg_Tx.Data[6] = InverterData.DisChargeV;
        Can_msg_Tx.Data[7] = InverterData.DisChargeV >> 8;

        SendMsgIndex++;

        break;
    }

    case 2:
    {
        Can_msg_Tx.StdId = 0x355;

        Can_msg_Tx.Data[0] = InverterData.Soc;
        Can_msg_Tx.Data[1] = 0;
        Can_msg_Tx.Data[2] = InverterData.Soh;
        Can_msg_Tx.Data[3] = 0;
        Can_msg_Tx.Data[4] = (uint8_t)((uint16_t)InverterData.Soc * 100);
        Can_msg_Tx.Data[5] = (uint8_t)((uint16_t)(InverterData.Soc * 100) >> 8);

        Can_msg_Tx.Data[6] = 0;
        Can_msg_Tx.Data[7] = 0;

        SendMsgIndex++;

        break;
    }

    case 3:
    {
        Can_msg_Tx.StdId = 0x356;

        Can_msg_Tx.Data[0] = (uint8_t)((InverterData.Vsum / 10) & 0x00FF); //0.01V
        Can_msg_Tx.Data[1] = (uint8_t)(((InverterData.Vsum / 10) >> 8) & 0x00FF);

        Can_msg_Tx.Data[2] = (uint8_t)((InverterData.Current / 10) & 0x00FF); //0.1A
        Can_msg_Tx.Data[3] = (uint8_t)(((InverterData.Current / 10) >> 8) & 0x00FF);

        Can_msg_Tx.Data[4] = (uint8_t)((InverterData.BatteryTemp - 2730) & 0x00FF);
        Can_msg_Tx.Data[5] = (uint8_t)(((InverterData.BatteryTemp - 2730) >> 8) & 0x00FF);
        Can_msg_Tx.Data[6] = 0;
        Can_msg_Tx.Data[7] = 0;

        SendMsgIndex++;

        break;
    }
    case 4:
        Can_msg_Tx.StdId = 0x370;
        
        Can_msg_Tx.Data[0] = VE_name[0];
        Can_msg_Tx.Data[1] = VE_name[1];
        Can_msg_Tx.Data[2] = VE_name[2];
        Can_msg_Tx.Data[3] = VE_name[3];
        Can_msg_Tx.Data[4] = VE_name[4];
        Can_msg_Tx.Data[5] = VE_name[5];
        Can_msg_Tx.Data[6] = VE_name[6];
        Can_msg_Tx.Data[7] = VE_name[7];
        SendMsgIndex++;
        break;
    case 5:
        Can_msg_Tx.StdId = 0x372;

        Can_msg_Tx.Data[0] = InverterData.PackNum - InverterData.ProtectChargNum - InverterData.ProtectDisChargNum;
        Can_msg_Tx.Data[1] = 0;
        Can_msg_Tx.Data[2] = InverterData.ProtectChargNum;
        Can_msg_Tx.Data[3] = 0;
        Can_msg_Tx.Data[4] = InverterData.ProtectDisChargNum;
        Can_msg_Tx.Data[5] = 0;
        Can_msg_Tx.Data[6] = InverterData.ProtectChargNum + InverterData.ProtectDisChargNum;
        Can_msg_Tx.Data[7] = 0;
        SendMsgIndex++;
        break;

    case 6:
        Can_msg_Tx.StdId = 0x373;

        Can_msg_Tx.Data[0] = (InverterData.Gmin);
        Can_msg_Tx.Data[1] = (InverterData.Gmin) >> 8;
        Can_msg_Tx.Data[2] = (InverterData.Gmax);
        Can_msg_Tx.Data[3] = (InverterData.Gmax) >> 8;
        Can_msg_Tx.Data[4] = (InverterData.Tmin - 0) / 10;
        Can_msg_Tx.Data[5] = ((InverterData.Tmin - 0) / 10) >> 8;
        Can_msg_Tx.Data[6] = (InverterData.Tmax - 0) / 10;
        Can_msg_Tx.Data[7] = ((InverterData.Tmax - 0) / 10) >> 8;
        SendMsgIndex++;
        break;

    case 7:
        Can_msg_Tx.StdId = 0x379;

        Can_msg_Tx.Data[0] = DesignCapacity / 100 * InverterData.PackNum;
        Can_msg_Tx.Data[1] = (DesignCapacity / 100 * InverterData.PackNum) >> 8;
        Can_msg_Tx.Data[2] = 0;
        Can_msg_Tx.Data[3] = 0;
        Can_msg_Tx.Data[4] = 0;
        Can_msg_Tx.Data[5] = 0;
        Can_msg_Tx.Data[6] = 0;
        Can_msg_Tx.Data[7] = 0;
        SendMsgIndex++;
        break;

    case 8:
        Can_msg_Tx.StdId = 0x374;
        tmp = (InverterData.GminAddr-1) / Pack_Cells_Num + 1;
        if (tmp < 10)
        {
            Can_msg_Tx.Data[0] = '0' + tmp;
            Can_msg_Tx.Data[1] = ' ';
        }
        else
        {
            Can_msg_Tx.Data[0] = '1';
            Can_msg_Tx.Data[1] = '0' + tmp % 10;
        }
        Can_msg_Tx.Data[2] = ':';
        Can_msg_Tx.Data[3] = ':';
        tmp = (InverterData.GminAddr-1) % Pack_Cells_Num + 1;
        if (tmp < 10)
        {
            Can_msg_Tx.Data[4] = '0' + tmp;
            Can_msg_Tx.Data[5] = ' ';
        }
        else
        {
            Can_msg_Tx.Data[4] = '1';
            Can_msg_Tx.Data[5] = '0' + tmp % 10;
        }
        Can_msg_Tx.Data[6] = 0;
        Can_msg_Tx.Data[7] = 0;
        SendMsgIndex++;
        break;

    case 9:
        Can_msg_Tx.StdId = 0x375;

        tmp = (InverterData.GmaxAddr-1) / Pack_Cells_Num + 1;
        if (tmp < 10)
        {
            Can_msg_Tx.Data[0] = '0' + tmp;
            Can_msg_Tx.Data[1] = ' ';
        }
        else
        {
            Can_msg_Tx.Data[0] = '1';
            Can_msg_Tx.Data[1] = '0' + tmp % 10;
        }
        Can_msg_Tx.Data[2] = ':';
        Can_msg_Tx.Data[3] = ':';
        tmp = (InverterData.GmaxAddr-1) % Pack_Cells_Num + 1;
        if (tmp < 10)
        {
            Can_msg_Tx.Data[4] = '0' + tmp;
            Can_msg_Tx.Data[5] = ' ';
        }
        else
        {
            Can_msg_Tx.Data[4] = '1';
            Can_msg_Tx.Data[5] = '0' + tmp % 10;
        }
        Can_msg_Tx.Data[6] = 0;
        Can_msg_Tx.Data[7] = 0;
        SendMsgIndex++;
        break;

    case 10:
        Can_msg_Tx.StdId = 0x376;

        tmp = (InverterData.TminAddr-1) / Pack_Temps_Num + 1;
        if (tmp < 10)
        {
            Can_msg_Tx.Data[0] = '0' + tmp;
            Can_msg_Tx.Data[1] = ' ';
        }
        else
        {
            Can_msg_Tx.Data[0] = '1';
            Can_msg_Tx.Data[1] = '0' + tmp % 10;
        }
        Can_msg_Tx.Data[2] = ':';
        Can_msg_Tx.Data[3] = ':';
        tmp = (InverterData.TminAddr-1) % Pack_Temps_Num + 1;
        if (tmp < 10)
        {
            Can_msg_Tx.Data[4] = '0' + tmp;
            Can_msg_Tx.Data[5] = ' ';
        }
        else
        {
            Can_msg_Tx.Data[4] = '1';
            Can_msg_Tx.Data[5] = '0' + tmp % 10;
        }
        Can_msg_Tx.Data[6] = 0;
        Can_msg_Tx.Data[7] = 0;
        SendMsgIndex++;
        break;

    case 11:
        Can_msg_Tx.StdId = 0x377;

        tmp = (InverterData.TmaxAddr-1) / Pack_Temps_Num + 1;
        if (tmp < 10)
        {
            Can_msg_Tx.Data[0] = '0' + tmp;
            Can_msg_Tx.Data[1] = ' ';
        }
        else
        {
            Can_msg_Tx.Data[0] = '1';
            Can_msg_Tx.Data[1] = '0' + tmp % 10;
        }
        Can_msg_Tx.Data[2] = ':';
        Can_msg_Tx.Data[3] = ':';
        tmp = (InverterData.TmaxAddr-1) % Pack_Temps_Num + 1;
        if (tmp < 10)
        {
            Can_msg_Tx.Data[4] = '0' + tmp;
            Can_msg_Tx.Data[5] = ' ';
        }
        else
        {
            Can_msg_Tx.Data[4] = '1';
            Can_msg_Tx.Data[5] = '0' + tmp % 10;
        }
        Can_msg_Tx.Data[6] = 0;
        Can_msg_Tx.Data[7] = 0;
        SendMsgIndex++;
        break;

    case 12:
        Can_msg_Tx.StdId = 0x35E;

        Can_msg_Tx.Data[0] = VE_name[0];
        Can_msg_Tx.Data[1] = VE_name[1];
        Can_msg_Tx.Data[2] = VE_name[2];
        Can_msg_Tx.Data[3] = VE_name[3];
        Can_msg_Tx.Data[4] = VE_name[4];
        Can_msg_Tx.Data[5] = VE_name[5];
        Can_msg_Tx.Data[6] = VE_name[6];
        Can_msg_Tx.Data[7] = VE_name[7];
        SendMsgIndex++;
        break;
    case 13:
        Can_msg_Tx.StdId = 0x35F;

        Can_msg_Tx.Data[0] = 0;
        Can_msg_Tx.Data[1] = BatteryMode;
        Can_msg_Tx.Data[2] = 0;
        Can_msg_Tx.Data[3] = 0;
        Can_msg_Tx.Data[4] = 0;
        Can_msg_Tx.Data[5] = 0;
        Can_msg_Tx.Data[6] = 0;
        Can_msg_Tx.Data[7] = 0;
        SendMsgIndex = 0;
        break;
    default:
        SendMsgIndex = 0;
        break;
    }

    Can_TransmitData(&Can_msg_Tx);
}
// Rate500k
void CanComVictron_230418_Init(CanRate_t baudrate)
{
    Current_Can_Rate = baudrate;
    CAN_Config(Current_Can_Rate);
    Set_Timer(CANCOMPNTIMER, 1);
}
/*************************************************

Function:	CanComVictron_SendCycleMsg()

Description:

*************************************************/
void CanComVictron_230418_MainCall(void)
{

    if (Timer[CANCOMPNTIMER].Flag)
    {
        Set_Timer(CANCOMPNTIMER, 8);
        Victron_SendCycleMsg();
    }
}
