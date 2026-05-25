/************************************************************
协议名：062-AISWEI CAN HV V1.0.pdf

源文件名: Can_Aiswei_V100.c

英文名: AISWEI_V100

中文名：爱士惟_V100

枚举值：Can_Aiswei_V100 = 49

变更：
2025.11.7  //程昊
1、初版发布
***********************************************************/

#include "CAN_Comm.h"

/*************************************************

Function:	CanComAiswei_CheckProtectFlag()

Description:

*************************************************/
static uint16_t CanComAiswei_CheckProtectFlag(void)
{
    uint16_t wtmp = 0;

    //over voltage
    if(InverterData.Status1 & (BIT0 | BIT2))
    {
        wtmp |= BIT1;
    }

    //under voltage
    if(InverterData.Status1 & (BIT1 | BIT3))
    {
        wtmp |= BIT2;
    }

    //cell over temp
    if(InverterData.Status2 & (BIT0 | BIT1))
    {
        wtmp |= BIT3;
    }

    //cell under temp
    if(InverterData.Status2 & (BIT2 | BIT3))
    {
        wtmp |= BIT4;
    }

    //dsg over curr
    if(InverterData.Status1 & BIT5)
    {
        wtmp |= BIT7;
    }

    //chg over curr
    if(InverterData.Status1 & BIT4)
    {
        wtmp |= BIT8;
    }

    //system error
    if(InverterData.Status5 & 0x3F)
    {
        wtmp |= BIT11;
    }

    return wtmp;
}

/*************************************************

Function:	CanComAiswei_CheckWarningFlag()

Description:

*************************************************/
static uint16_t CanComAiswei_CheckWarningFlag(void)
{
    uint16_t wtmp = 0;

    //over voltage
    if(InverterData.Warning1 & (BIT0 | BIT2))
    {
        wtmp |= BIT1;
    }

    //under voltage
    if(InverterData.Warning1 & (BIT1 | BIT3))
    {
        wtmp |= BIT2;
    }

    //cell over temp
    if(InverterData.Warning2 & (BIT0 | BIT1))
    {
        wtmp |= BIT3;
    }

    //cell under temp
    if(InverterData.Warning2 & (BIT2 | BIT3))
    {
        wtmp |= BIT4;
    }

    //dsg over curr
    if(InverterData.Warning1 & BIT5)
    {
        wtmp |= BIT7;
    }

    //chg over curr
    if(InverterData.Warning1 & BIT4)
    {
        wtmp |= BIT8;
    }

    return wtmp;
}

/*************************************************

Function:	CanComAiswei_SendCycleMsg()

Description:

*************************************************/
static void CanComAiswei_SendCycleMsg(void)
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
            Can_msg_Tx.StdId = 0x359;

            wtmp = CanComAiswei_CheckProtectFlag();
            Can_msg_Tx.Data[0] = (uint8_t)(wtmp & 0x00FF);
            Can_msg_Tx.Data[1] = (uint8_t)((wtmp >> 8) & 0x00FF);

            wtmp = CanComAiswei_CheckWarningFlag();
            Can_msg_Tx.Data[2] = (uint8_t)(wtmp & 0x00FF);
            Can_msg_Tx.Data[3] = (uint8_t)((wtmp >> 8) & 0x00FF);

            Can_msg_Tx.Data[4] = InverterData.PackNum;
            Can_msg_Tx.Data[5] = 0x50;
            Can_msg_Tx.Data[6] = 0x4E;
            Can_msg_Tx.Data[7] = 0;

            SendMsgIndex++;
            break;
        }

        case 1:
        {
            Can_msg_Tx.StdId = 0x351;

            Can_msg_Tx.Data[0] = (uint8_t)(InverterData.ChargeV & 0x00FF);
            Can_msg_Tx.Data[1] = (uint8_t)((InverterData.ChargeV >> 8) & 0x00FF);

            Can_msg_Tx.Data[2] = (uint8_t)((InverterData.ChargeI)&0x00FF);
            Can_msg_Tx.Data[3] = (uint8_t)((InverterData.ChargeI>>8)&0x00FF);

            Can_msg_Tx.Data[4] = (uint8_t)(InverterData.DisChargeI&0x00FF);
            Can_msg_Tx.Data[5] = (uint8_t)((InverterData.DisChargeI>>8)&0x00FF);

            //Soc上下限
            Can_msg_Tx.Data[6] = InverterData.DisChargeV;
            Can_msg_Tx.Data[7] = InverterData.DisChargeV>>8;

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
            Can_msg_Tx.Data[4] = 0;
            Can_msg_Tx.Data[5] = 0;
            
            Can_msg_Tx.Data[6] = 0;
            Can_msg_Tx.Data[7] = 0;

            SendMsgIndex++;

            break;
        }

        case 3:
        {
            Can_msg_Tx.StdId = 0x356;

            Can_msg_Tx.Data[0] = (uint8_t)((InverterData.Vsum / 10) & 0x00FF);        //0.01V
            Can_msg_Tx.Data[1] = (uint8_t)(((InverterData.Vsum / 10) >> 8) & 0x00FF);

            Can_msg_Tx.Data[2] = (uint8_t)((InverterData.Current / 10) & 0x00FF);            //0.1A
            Can_msg_Tx.Data[3] = (uint8_t)(((InverterData.Current / 10) >> 8) & 0x00FF);

            Can_msg_Tx.Data[4] = (uint8_t)(InverterData.BatteryTemp-2730 & 0x00FF);
            Can_msg_Tx.Data[5] = (uint8_t)((InverterData.BatteryTemp-2730 >> 8) & 0x00FF);
            Can_msg_Tx.Data[6] = 0;
            Can_msg_Tx.Data[7] = 0;

            SendMsgIndex++;

            break;
        }

        case 4:
        {
            Can_msg_Tx.StdId = 0x35C;

            Can_msg_Tx.Data[0] = InverterData.ForceCHG_Cmd;
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

        case 5:
        {
            Can_msg_Tx.StdId = 0x35E;

            Can_msg_Tx.Data[0] = 'A';
            Can_msg_Tx.Data[1] = 'I';
            Can_msg_Tx.Data[2] = 'S';
            Can_msg_Tx.Data[3] = 'W';
            Can_msg_Tx.Data[4] = 'E';
            Can_msg_Tx.Data[5] = 'I';
            Can_msg_Tx.Data[6] = ' ';
            Can_msg_Tx.Data[7] = ' ';

            SendMsgIndex++;

            break;
        }
        case 6:
        Can_msg_Tx.StdId = 0x373;

        Can_msg_Tx.Data[0] = (uint8_t)(InverterData.Gmin);
        Can_msg_Tx.Data[1] = (uint8_t)(InverterData.Gmin >> 8);
        
        Can_msg_Tx.Data[2] = (uint8_t)(InverterData.Gmax);
        Can_msg_Tx.Data[3] = (uint8_t)(InverterData.Gmax >> 8);
        
        Can_msg_Tx.Data[4] = (uint8_t)((InverterData.Tmin-2730));
        Can_msg_Tx.Data[5] = (uint8_t)((InverterData.Tmin-2730) >> 8);
        
        Can_msg_Tx.Data[6] = (uint8_t)(InverterData.Tmax-2730);
        Can_msg_Tx.Data[7] = (uint8_t)((InverterData.Tmax-2730) >> 8);
        SendMsgIndex++;
        break;  

        case 7:
        Can_msg_Tx.StdId = 0x374;

        Can_msg_Tx.Data[0] = (uint8_t)(InverterData.GminAddr);
        Can_msg_Tx.Data[1] = (uint8_t)(InverterData.GminAddr >> 8);
        
        Can_msg_Tx.Data[2] = (uint8_t)(InverterData.GmaxAddr);
        Can_msg_Tx.Data[3] = (uint8_t)(InverterData.GmaxAddr >> 8);
        
        Can_msg_Tx.Data[4] = (uint8_t)((InverterData.TminAddr));
        Can_msg_Tx.Data[5] = (uint8_t)((InverterData.TminAddr) >> 8);
        
        Can_msg_Tx.Data[6] = (uint8_t)(InverterData.TmaxAddr);
        Can_msg_Tx.Data[7] = (uint8_t)((InverterData.TmaxAddr) >> 8);
        SendMsgIndex++;
        break;  

        case 8:
        Can_msg_Tx.StdId = 0x375;

        Can_msg_Tx.Data[0] = 0;
        Can_msg_Tx.Data[1] = 0;
        
        Can_msg_Tx.Data[2] = 0;
        Can_msg_Tx.Data[3] = 0;
        
        Can_msg_Tx.Data[4] = 0;
        Can_msg_Tx.Data[5] = 0;
        
        Can_msg_Tx.Data[6] = 0;
        Can_msg_Tx.Data[7] = 0;
        SendMsgIndex++;
        break;  

        case 9:
        Can_msg_Tx.StdId = 0x379;

        Can_msg_Tx.Data[0] = (InverterData.FccAll/100)&0xff;	//Ah
        Can_msg_Tx.Data[1] = ((InverterData.FccAll/100)>>8)&0xff;
        //Total online number
        Can_msg_Tx.Data[2] =  InverterData.PackNum-InverterData.ProtectChargNum-InverterData.ProtectDisChargNum;
        Can_msg_Tx.Data[3] = 0;
   
        Can_msg_Tx.Data[4] = 0;
        Can_msg_Tx.Data[5] = 0;
        
        Can_msg_Tx.Data[6] = 0;
        Can_msg_Tx.Data[7] = 0;

        SendMsgIndex = 0;
        break;  

        default:
        {
            SendMsgIndex = 0;

            break;
        }
    }

    Can_TransmitData(&Can_msg_Tx);
}

/*************************************************

Function:	CanComAiswei_SendCycleMsg()

Description:

*************************************************/

//Rate100k
void CanComAiswei_V100_Init(CanRate_t baudrate)
{
    Current_Can_Rate = baudrate;
    CAN_Config(Current_Can_Rate);
    Set_Timer(CANCOMPNTIMER, 1);
}
/*************************************************

Function:	CanComAiswei_V100_MainCall()

Description:

*************************************************/
void CanComAiswei_V100_MainCall(void)
{   
    if(Timer[CANCOMPNTIMER].Flag)
    {
        Set_Timer(CANCOMPNTIMER, 8);
        CanComAiswei_SendCycleMsg();
    }
}
