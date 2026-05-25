/************************************************************
协议名：264-CANADIANSOLAR CAN V1.0.1.pdf

源文件名: Can_CanadianSolar_V101.c

英文名: CANADIANSOLAR_V101

中文名：阿特斯阳光_V101

枚举值：Can_CanadianSolar_V101 = 130

变更：
2025.11.11  //程昊
1、初版发布
***********************************************************/


#include "CAN_Comm.h"

static uint8_t CanadianSolar_Res_OK_3=0;

static uint8_t CanadianSolar_Res_OK_4=0;

static uint8_t CanadianSolar_Res_OK_5=0;
/*************************************************

Function:	CanadianSolar_CheckProtectFlag()

Description:

*************************************************/
static uint16_t CanadianSolar_CheckProtectFlag(void)
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

    //short circuit
    if(InverterData.Status1 & BIT6)
    {
        wtmp |= BIT6;
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

Function:	CanadianSolar_CheckWarningFlag()

Description:

*************************************************/
static uint16_t CanadianSolar_CheckWarningFlag(void)
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
    
    //Internal Communication Fail
    if(0)
    {
       wtmp |= BIT11;
    }
    return wtmp;
}

/*************************************************

Function:	CanadianSolar_35AFlag1()

Description:

*************************************************/
static uint16_t CanadianSolar_35AFlag1(void)
{
    uint16_t wtmp = 0;

    //General Alarm
    if (CanadianSolar_CheckWarningFlag())
    {
        wtmp |= BIT0;  
    }
    else
    {
        wtmp |= BIT1;
    }
    //过压
    if(InverterData.Status1 & (BIT0|BIT2))
    {
        wtmp |= BIT2;
    }
    else
    {
        wtmp |= BIT3;
    }
    //低压
    if(InverterData.Status1 & (BIT1|BIT3))
    {
        wtmp |= BIT4;
    }
    else
    {
        wtmp |= BIT5;
    }
    //放电过温
    if(InverterData.Status2 & BIT1)
    {
        wtmp |= BIT6;
    }
    else
    {
        wtmp |= BIT7;
    }
    //放电低温
    if(InverterData.Status2 & BIT3)
    {
        wtmp |= BIT8;
    }
    else
    {
        wtmp |= BIT9;
    }
    //充电过温
    if(InverterData.Status2 & BIT0)
    {
        wtmp |= BIT10;
    }
    else
    {
        wtmp |= BIT11;
    }
    //充电低温
    if(InverterData.Status2 & BIT2)
    {
        wtmp |= BIT12;
    }
    else
    {
        wtmp |= BIT13;
    }
    //放电过流
    if(InverterData.Status1 & BIT5)
    {
        wtmp |= BIT14;
    }
    else
    {
        wtmp |= BIT15;
    }

    return wtmp;
}
/*************************************************

Function:	CanadianSolar_35AFlag2()

Description:

*************************************************/
static uint16_t CanadianSolar_35AFlag2(void)
{
    uint16_t wtmp = 0;
    
    //充电过流
    if(InverterData.Status1 & BIT4)
    {
        wtmp |= BIT0;
    }
    else
    {
        wtmp |= BIT1;
    }
    //MOSFET
    if(InverterData.Status5 & (BIT0|BIT1))
    {
        wtmp |= BIT2;
    }
    else
    {
        wtmp |= BIT3;
    }
    //短路
    if(InverterData.Status1 & BIT6)
    {
        wtmp |= BIT4;
    }
    else
    {
        wtmp |= BIT5;
    }
    //BMS保护
    if(InverterData.Status1 ||InverterData.Status2)
    {
        wtmp |= BIT6;
    }
    else
    {
        wtmp |= BIT7;
    }
    //电池不平衡
    if(InverterData.Status6 ||InverterData.Status7)
    {
        wtmp |= BIT8;
    }
    else
    {
        wtmp |= BIT9;
    }
    return wtmp;
}
/*************************************************

Function:	CanComPn_SendCycleMsg()

Description:

*************************************************/
static void CanadianSolar_SendCycleMsg(void)
{
    static uint8_t SendMsgIndex = 0,tmp = 0;
    uint16_t wtmp = 0;
    uint32_t lwtmp = 0;
    Can_msg_Tx.DLC = 8;
    Can_msg_Tx.IDE = CAN_ID_STD;
    Can_msg_Tx.RTR = CAN_RTRQ_DATA;

    switch(SendMsgIndex)
    {
        case 0:
        {
            Can_msg_Tx.StdId = 0x351;

            Can_msg_Tx.Data[0] = (uint8_t)(InverterData.ChargeV & 0x00FF);
            Can_msg_Tx.Data[1] = (uint8_t)((InverterData.ChargeV >> 8) & 0x00FF);

            Can_msg_Tx.Data[2] = (uint8_t)((InverterData.ChargeI)&0x00FF);
            Can_msg_Tx.Data[3] = (uint8_t)((InverterData.ChargeI>>8)&0x00FF);

            Can_msg_Tx.Data[4] = (uint8_t)(InverterData.DisChargeI&0x00FF);
            Can_msg_Tx.Data[5] = (uint8_t)((InverterData.DisChargeI>>8)&0x00FF);

            Can_msg_Tx.Data[6] = InverterData.DisChargeV;
            Can_msg_Tx.Data[7] = InverterData.DisChargeV>>8;

            SendMsgIndex++;

            break;
        }

        case 1:
        {
            Can_msg_Tx.StdId = 0x355;

            Can_msg_Tx.Data[0] = InverterData.Soc;
            Can_msg_Tx.Data[1] = 0;
            Can_msg_Tx.Data[2] = InverterData.Soh;
            Can_msg_Tx.Data[3] = 0;
            //循环次数
            Can_msg_Tx.Data[4] = SocData.BatteryCycle;
            Can_msg_Tx.Data[5] = 0;
            //电芯串数
            Can_msg_Tx.Data[6] = SocDataInput.Cells_Num;
            Can_msg_Tx.Data[7] = 0;

            SendMsgIndex++;

            break;
        }

        case 2:
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
        case 3:
        {
            Can_msg_Tx.StdId = 0x359;

            wtmp = CanadianSolar_CheckProtectFlag();
            Can_msg_Tx.Data[0] = (uint8_t)(wtmp & 0x00FF);
            Can_msg_Tx.Data[1] = (uint8_t)((wtmp >> 8) & 0x00FF);

            wtmp = CanadianSolar_CheckWarningFlag();
            Can_msg_Tx.Data[2] = (uint8_t)(wtmp & 0x00FF);
            Can_msg_Tx.Data[3] = (uint8_t)((wtmp >> 8) & 0x00FF);

            Can_msg_Tx.Data[4] = InverterData.PackNum;
            Can_msg_Tx.Data[5] = 0x50;
            Can_msg_Tx.Data[6] = 0x4E;
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

            Can_msg_Tx.Data[0] = 'C';
            Can_msg_Tx.Data[1] = 'S';
            Can_msg_Tx.Data[2] = 'I';
            Can_msg_Tx.Data[3] = ' ';
            Can_msg_Tx.Data[4] = ' ';
            Can_msg_Tx.Data[5] = ' ';
            Can_msg_Tx.Data[6] = ' ';
            Can_msg_Tx.Data[7] = ' ';

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

static uint16_t CanadianSolar_Get_Status(void)
{
    uint16_t wtmp = 0;

    if(InverterData.Status1 & (BIT1|BIT3))
    {
        wtmp |= BIT0;
    }

    if(InverterData.Status1 & (BIT0|BIT2))
    {
        wtmp |= BIT1;
    }
    
    if(InverterData.Status2 & (BIT2|BIT3|BIT6))
    {
        wtmp |= BIT2;
    }

    if(InverterData.Status2 & (BIT0|BIT1|BIT4|BIT5))
    {
        wtmp |= BIT3;
    }

    if(InverterData.Status1 & BIT4)
    {
        wtmp |= BIT4;
    }

    if(InverterData.Status1 & BIT5)
    {
        wtmp |= BIT5;
    }

    if(InverterData.Status5 || InverterData.Status8)
    {
        wtmp |= BIT7;
    }
    //警告
    if(InverterData.Warning1 & (BIT0|BIT2))
    {
        wtmp |= BIT8;
    }

    if(InverterData.Warning1 & (BIT1|BIT3))
    {
        wtmp |= BIT9;
    }

    if(InverterData.Warning2 & (BIT0|BIT1|BIT4|BIT6))
    {
        wtmp |= BIT10;
    }

    if(InverterData.Warning2 & (BIT2|BIT3|BIT5))
    {
        wtmp |= BIT11;
    }

    if(InverterData.Warning1 & BIT4)
    {
        wtmp |= BIT12;
    }
    //放电过流和短路
    if(InverterData.Warning1 & BIT5||InverterData.Status1 & BIT6)
    {
        wtmp |= BIT13;
    }
    
    //禁充||禁放
    if(!(InverterData.ForceCHG_Cmd & BIT7) || !(InverterData.ForceCHG_Cmd & BIT6))
    {
        wtmp |= BIT14;
    }
    return wtmp;
}

static uint16_t CanadianSolar_Get_Flag(void)
{
    uint16_t wtmp = 0;  
    
    if((InverterData.ForceCHG_Cmd & BIT4)||(InverterData.ForceCHG_Cmd & BIT5))//增加强充的上报
	{
		wtmp |= BIT0;//触发强充
	}

    //满充标记
    if(SocDataOut.Status.FullCharge_Flag)
    {
        wtmp |= BIT1;
    }
    //不平衡
    if(InverterData.Status6 || InverterData.Status7)
    {
        wtmp |= BIT2;
    }
    //压差
    if(InverterData.Status5 & BIT4)
    {
        wtmp |= BIT2;
    }

    //放电Mos
    if(InverterData.Status5 & BIT1)
    {
        wtmp |= BIT3;
    }

    //充电Mos
    if(InverterData.Status5 & BIT0)
    {
        wtmp |= BIT4;
    }
    
    return wtmp;
}
static void CAN_CanadianSolar_Respond_3(void)
{
    static uint8_t SendMsgIndex = 0,tmp = 0;
    uint16_t wtmp = 0;
    uint32_t lwtmp = 0;
    Can_msg_Tx.DLC = 8;
    Can_msg_Tx.IDE = CAN_ID_STD;
    Can_msg_Tx.RTR = CAN_RTRQ_DATA;
    
    switch(SendMsgIndex)
    {
        case 0:
        {
            Can_msg_Tx.StdId = 0x35A;
            wtmp = CanadianSolar_35AFlag1();
            Can_msg_Tx.Data[0] = (uint8_t)(wtmp);
            Can_msg_Tx.Data[1] = (uint8_t)(wtmp >> 8);
            
            wtmp = CanadianSolar_35AFlag2();
            Can_msg_Tx.Data[2] = (uint8_t)(wtmp);
            Can_msg_Tx.Data[3] = (uint8_t)(wtmp >> 8);
            
            Can_msg_Tx.Data[4] = 0;
            Can_msg_Tx.Data[5] = 0;
            Can_msg_Tx.Data[6] = 0;
            Can_msg_Tx.Data[7] = 0;
            
            SendMsgIndex++;
            break;
        }
        case 1:
        {
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
        }
        case 2:
        {
            Can_msg_Tx.StdId = 0x373;

            Can_msg_Tx.Data[0] = (uint8_t)(InverterData.Gmin);
            Can_msg_Tx.Data[1] = (uint8_t)(InverterData.Gmin) >> 8;
            Can_msg_Tx.Data[2] = (uint8_t)(InverterData.Gmax);
            Can_msg_Tx.Data[3] = (uint8_t)(InverterData.Gmax) >> 8;
            //1Kelvin
            Can_msg_Tx.Data[4] = (uint8_t)(InverterData.Tmin - 0) / 10;
            Can_msg_Tx.Data[5] = (uint8_t)((InverterData.Tmin - 0) / 10) >> 8;
            Can_msg_Tx.Data[6] = (uint8_t)(InverterData.Tmax - 0) / 10;
            Can_msg_Tx.Data[7] = (uint8_t)((InverterData.Tmax - 0) / 10) >> 8;
            
            SendMsgIndex++;
            break;
        }
        case 3:
        {
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
        }

        case 4:
        {
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
        }

        case 5:
        {
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
        }

        case 6:
        {
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
        }
        case 7:
        {
            Can_msg_Tx.StdId = 0x379;

            lwtmp = (uint32_t)DesignCapacity / 100 * InverterData.PackNum;
            Can_msg_Tx.Data[0] = (uint8_t)lwtmp;
            Can_msg_Tx.Data[1] = (uint8_t)(lwtmp >> 8);
            Can_msg_Tx.Data[2] = (uint8_t)(lwtmp >> 16);
            Can_msg_Tx.Data[3] = (uint8_t)(lwtmp >> 24);
            Can_msg_Tx.Data[4] = 0;
            Can_msg_Tx.Data[5] = 0;
            Can_msg_Tx.Data[6] = 0;
            Can_msg_Tx.Data[7] = 0;
            SendMsgIndex = 0;
            CanadianSolar_Res_OK_3 = 0;
            break;
        }
        default:
        {
            SendMsgIndex = 0;
            CanadianSolar_Res_OK_3 = 0;
            break;
        }
    }

    Can_TransmitData(&Can_msg_Tx);

}    
static void CAN_CanadianSolar_Respond_4(void)
{
    static uint8_t SendMsgIndex = 0;
    uint32_t lwtmp;
    uint8_t tmp = 0;
    
    Can_msg_Tx.DLC = 8;
    Can_msg_Tx.IDE = CAN_ID_EXT;
    Can_msg_Tx.RTR = CAN_RTRQ_Data;
    switch(SendMsgIndex)
    {
    case 0:        
        Can_msg_Tx.ExtId = 0x4000001;
            
        
        Can_msg_Tx.Data[0] = (uint8_t)(InverterData.Gmin);
        Can_msg_Tx.Data[1] = (uint8_t)(InverterData.Gmin >> 8);  

        Can_msg_Tx.Data[2] = (uint8_t)(InverterData.Gmax);
        Can_msg_Tx.Data[3] = (uint8_t)(InverterData.Gmax >> 8);
    
  
        Can_msg_Tx.Data[4] = (uint8_t)(InverterData.Current/10);//0.1A
        Can_msg_Tx.Data[5] = (uint8_t)((InverterData.Current/10) >> 8);                
        Can_msg_Tx.Data[6] = (uint8_t)(InverterData.Vsum/10);//0.01V
        Can_msg_Tx.Data[7] = (uint8_t)((InverterData.Vsum/10) >> 8);
        SendMsgIndex++;
        break;
     
    case 1:
        Can_msg_Tx.ExtId = 0x4000002;

        Can_msg_Tx.Data[0] = (uint8_t)(InverterData.Tmax-2730);//0.1℃
        Can_msg_Tx.Data[1] = (uint8_t)(InverterData.Tmax-2730)>> 8;

        Can_msg_Tx.Data[2] = (uint8_t)(InverterData.Tmin-2730);
        Can_msg_Tx.Data[3] = (uint8_t)(InverterData.Tmin-2730) >> 8;

        Can_msg_Tx.Data[4] = (uint8_t)(InverterData.MosT-2730);
        Can_msg_Tx.Data[5] = (uint8_t)(InverterData.MosT-2730) >> 8;

        Can_msg_Tx.Data[6] = (uint8_t)(InverterData.BatteryTemp-2730);
        Can_msg_Tx.Data[7] = (uint8_t)(InverterData.BatteryTemp-2730) >> 8;
        SendMsgIndex++;
        break;    
    
    case 2:
        Can_msg_Tx.ExtId = 0x4000003;

        Can_msg_Tx.Data[0] = 0;
        Can_msg_Tx.Data[1] = 0;
        
        Can_msg_Tx.Data[2] = (uint8_t)(InverterData.Soc);
        Can_msg_Tx.Data[3] = (uint8_t)(InverterData.Soc >> 8);
        
        Can_msg_Tx.Data[4] = (uint8_t)(InverterData.Soh);
        Can_msg_Tx.Data[5] = (uint8_t)((InverterData.Soh) >> 8);
        
        Can_msg_Tx.Data[6] = (uint8_t)(InverterData.DesignCap / 100);
        Can_msg_Tx.Data[7] = (uint8_t)((InverterData.DesignCap / 100) >> 8);
        SendMsgIndex++;
        break;  
        
    case 3:
        Can_msg_Tx.ExtId = 0x4000004;
        lwtmp = CanadianSolar_Get_Status();
        Can_msg_Tx.Data[0] = (uint8_t)lwtmp;
        Can_msg_Tx.Data[1] = (uint8_t)lwtmp>>8;
        lwtmp = CanadianSolar_Get_Flag();
        Can_msg_Tx.Data[2] = (uint8_t)lwtmp;
        Can_msg_Tx.Data[3] = (uint8_t)lwtmp>> 8;
        
        Can_msg_Tx.Data[4] = 0;
        Can_msg_Tx.Data[5] = 0;
        
        Can_msg_Tx.Data[6] = 0;
        Can_msg_Tx.Data[7] = 0;
      
    
        SendMsgIndex = 0;
        CanadianSolar_Res_OK_4 = 0;
    default:
        SendMsgIndex = 0;
        CanadianSolar_Res_OK_4 = 0;
        break;
    }
              
    Can_TransmitData(&Can_msg_Tx);    
}

static void CAN_CanadianSolar_Respond_5(void)
{
    CanadianSolar_Res_OK_5 = 0;
}
/*************************************************

Function:	CanadianSolar_SendCycleMsg()
*************************************************/
void CanComCanadianSolar_V101_Init(CanRate_t baudrate)
{
    Current_Can_Rate = baudrate;
    CAN_Config(Current_Can_Rate);
    Set_Timer(CANCOMPNTIMER, 1);
}
/*************************************************

Function:	CanadianSolar_SendCycleMsg()

Description:

*************************************************/
void CanComCanadianSolar_V101_MainCall(void)
{   
    if(Timer[CANCOMPNTIMER].Flag)
    {
        Set_Timer(CANCOMPNTIMER, 8);

        if (CanadianSolar_Res_OK_3)
        {
            CAN_CanadianSolar_Respond_3();
        }
        else if(CanadianSolar_Res_OK_4)
        {
            CAN_CanadianSolar_Respond_4();
        }
        else if(CanadianSolar_Res_OK_5)
        {
            CAN_CanadianSolar_Respond_5();
        }
        else
        {
            CanadianSolar_SendCycleMsg(); 
        }
    }
   
}

void CanComCanadianSolar_V101_ReceiveIRQ(const CanRxMessage *msg)
{
    uint32_t PS_Addr = 0;
    
    // 首先判断帧类型
    if(msg->IDE == CAN_ID_STD)
    {
        // 标准帧处理
        PS_Addr = msg->StdId;
        
        if((PS_Addr == 0x305) || (PS_Addr == 0x307))
        {
            CanadianSolar_Res_OK_3 = 1;
            CAN_CanadianSolar_Respond_3();
        }
    }
    else if(msg->IDE == CAN_ID_EXT)
    {
        // 扩展帧处理
        if(msg->ExtId == 0x4000000)
        {
            CanadianSolar_Res_OK_4 = 1;
            CAN_CanadianSolar_Respond_4();
        }
        else if(msg->ExtId == 0x5000000)
        {
            CanadianSolar_Res_OK_5 = 1;
            CAN_CanadianSolar_Respond_5();
        }
    }
}
