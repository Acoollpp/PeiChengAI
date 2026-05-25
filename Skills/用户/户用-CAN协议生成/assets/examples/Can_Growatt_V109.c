/************************************************************
协议名：002-Growatt CAN LV V1.09-2020.10.22.pdf

源文件名: Can_Growatt_V109.c

英文名: GROWATT_V109

中文名：古瑞瓦特_V109

枚举值：Can_Growatt_V109 = 17

变更：
2025.10.29  //程昊
1、初版发布      
     
***********************************************************/
#include "CAN_Comm.h"


extern WARNING_DataTypeDef WarningPara;

static uint16_t Growatt_GetStatus(void)
{
	uint16_t wtmp = 0;

	if(IDLEMODE == BatteryMode)
	{
		wtmp |= BIT0;
	}
	else if(CHARGEMODE == BatteryMode)
	{
		wtmp |= BIT1;
	}
	else if(DISCHARGEMODE == BatteryMode)
	{
		wtmp |= (BIT0 | BIT1);
	}

    /* BIT2-- Error bit flag */
    if(InverterData.Status5 & ~BIT7 || InverterData.Status8 & ~BIT7)//增加故障状态的判断
    {
        wtmp |= BIT2;
    }
	

    /* 均衡状态 */
 	if(InverterData.Status6 || InverterData.Status7)
	{
		wtmp |= BIT3;
	}

	if(Sleep_Active_Flag)//休眠前置位
	{
		wtmp |= BIT4;
	}

    /* Output Discharge status 放电使能*/ 
    if(InverterData.ForceCHG_Cmd & BIT6)
    {
	    wtmp |= BIT5;//放电使能
    }

	/* Output Charge status 充电使能*/
    if(InverterData.ForceCHG_Cmd & BIT7)
    {
        wtmp |= BIT6;//充电使能
    }
	

	/* BIT7 -- Battery terminal status */

	if(InverterData.PackNum > 1)
	{
		wtmp |= BIT8;
	}

    if((InverterData.ForceCHG_Cmd & BIT4)||(InverterData.ForceCHG_Cmd & BIT5))//增加强充的上报
	{
		wtmp |= BIT9;//触发强充
	}

    /* SP Status */
	/*
	if(InverterData.Current > 500)
	{
	    wtmp |= 0x0800;
	}
	else if(InverterData.Current < -500)
	{
	    wtmp |= 0x0C00;
	}
	else
	{
	    wtmp |= 0x0400;
	}
	*/
	return wtmp;
}

static uint16_t Growatt_GetProtectStatus(void)
{
    uint16_t wtmp = 0;

	/* 总体欠压 */
	if(InverterData.Status1 & BIT3)
    {
       wtmp |= BIT1;
    }

	/* 总体过压 */
    if(InverterData.Status1 & BIT2)
    {
        wtmp |= BIT2;
    }

    /* 单体欠压 */
	if(InverterData.Status1 & BIT1)
	{
	    wtmp |= BIT3;
	}

    /* 单体过压 */
	if(InverterData.Status1 & BIT0)
    {
        wtmp |= BIT4;
    }

	/* 短路 */
	if(InverterData.Status1 & BIT6)
    {
        wtmp |= BIT5;
    }

    /* 充电过流 */
	if(InverterData.Status1 & BIT4)
    {
        wtmp |= BIT6;
    }

    /* 放电过流 */
	if(InverterData.Status1 & BIT5)
	{
	    wtmp |= BIT7;
	}

	/* 压差过大 */
    if(InverterData.Status5 & BIT4)
    {
        wtmp |= BIT10;
    }

    /* 系统故障 */
	if(InverterData.Status5 || InverterData.Status8)
	{
	    wtmp |= BIT11;
	}

	/* 充电低温 */
    if(InverterData.Status2 & BIT2)
    {
        wtmp |= BIT12;
    }

    /* 放电低温 */
	if(InverterData.Status2 & BIT3)
    {
        wtmp |= BIT13;
    }

	/* 充电过温 */
	if(InverterData.Status2 & BIT0)
	{
	    wtmp |= BIT14;
	}

    /* 放电过温 */
	if(InverterData.Status2 & BIT1)
    {
        wtmp |= BIT15;
    }

    return wtmp;
}

static uint16_t Growatt_GetWarningStatus(void)
{
    uint16_t wtmp = 0;

	/* 总压过低 */
	if(InverterData.Warning1 & BIT3)
    {
        wtmp |= BIT1;
    }

	/* 总压过高 */
    if(InverterData.Warning1 & BIT2)
    {
        wtmp |= BIT2;
    }

	/* 单体过低 */
    if(InverterData.Warning1 & BIT1)
    {
        wtmp |= BIT3;
    }

	/* 单体过高 */
    if(InverterData.Warning1 & BIT0)
    {
        wtmp |= BIT4;
    }

	/* 充电过流 */
    if(InverterData.Warning1 & BIT4)
    {
        wtmp |= BIT6;
    }

	/* 放电过流 */
    if(InverterData.Warning1 & BIT5)
    {
        wtmp |= BIT7;
    }

    if(Sleep_Active_Flag)//关机前告警
    {
        wtmp |= BIT9;
    }

	/* 充电低温 */
    if(InverterData.Warning2 & BIT2)
    {
        wtmp |= BIT12;
    }

	/* 放电低温 */
    if(InverterData.Warning2 & BIT3)
    {
        wtmp |= BIT13;
    }

	/* 充电高温 */
    if(InverterData.Warning2 & BIT0)
    {
        wtmp |= BIT14;
    }

	/* 放电高温 */
    if(InverterData.Warning2 & BIT1)
    {
        wtmp |= BIT15;
    }

	return wtmp;
}

unsigned char BmsProtect3(void)
{
    unsigned char temp=0;

    if(Can_Growatt_v109.IsCommBreakFlag)
    {
        temp |= BIT2;
    }
    if(InverterData.Status5 & ~(BIT3 | BIT4))//0xe7 
    {
        temp |= BIT4;
    }
    if(InverterData.Status5 & BIT5)
    {
        temp |= BIT7;
    }
    return temp;
}
unsigned char BmsProtect4(void)
{
    unsigned char temp=0;

    if(InverterData.Status3 & BIT4)
    {
        temp |= BIT3;
    }
    if(InverterData.Status1 & (BIT0 | BIT2))
    {
        temp |= BIT4;
    }
    if(InverterData.Status1 & (BIT4 | BIT5))
    {
        temp |= BIT5;
    } 
    if(InverterData.Status5 & BIT4)
    {
        temp |= BIT7;
    }
    return temp;
}
unsigned char BmsProtect5(void)
{
    unsigned char temp=0;
    
    if(InverterData.Status1 & BIT5)
    {
        temp |= BIT0;
    }
    if(InverterData.Status1 & BIT4)
    {
        temp |= BIT1;
    }
   
    return temp;
}
unsigned char BmsWarning3(void)
{
    unsigned char temp=0;

    if(InverterData.Warning1 & BIT4)
    {
        temp |= BIT2;
    }
    if(InverterData.Warning1 & BIT5)
    {
        temp |= BIT3;
    }
    return temp;
    
}



static uint8_t PackReqData(void)
{
    uint8_t temp=0;

#ifdef NMC_BAT_TYPE 
    temp |= BIT0;//电芯类型为三元
#endif
    
    if(InverterData.ForceCHG_Cmd & BIT4)
    {
        temp |= BIT4;//触发强充2
    }

    if(InverterData.ForceCHG_Cmd & BIT5)
    {
        temp |= BIT5;//触发强充1
    }

    if(InverterData.ForceCHG_Cmd & BIT6)
    {
        temp |= BIT6;//放电使能
    }

    if(InverterData.ForceCHG_Cmd & BIT7)
    {
        temp |= BIT7;//充电使能
    }
    
    return temp;
}

static void Growatt_SendCycleMsg(void)
{
    static uint8_t Growatt_MsgIndex = 0;
    int16_t  Iwtmp;
    uint16_t wtmp;
    //uint32_t lwtmp;

    Can_msg_Tx.IDE = CAN_ID_STD; 
    Can_msg_Tx.RTR = CAN_RTRQ_Data; 
    Can_msg_Tx.DLC = 8;
          
	switch(Growatt_MsgIndex)
	{
	    case 0:
		{
	        Can_msg_Tx.StdId = 0x311;

	        Can_msg_Tx.Data[0] = (uint8_t)((InverterData.ChargeV >> 8) & 0x00FF);
	        Can_msg_Tx.Data[1] = (uint8_t)(InverterData.ChargeV & 0x00FF);

	        Can_msg_Tx.Data[2] = (uint8_t)((InverterData.ChargeI >> 8) & 0x00FF);
	        Can_msg_Tx.Data[3] = (uint8_t)(InverterData.ChargeI & 0x00FF);

	        Can_msg_Tx.Data[4] = (uint8_t)((InverterData.DisChargeI >> 8) & 0x00FF);
	        Can_msg_Tx.Data[5] = (uint8_t)(InverterData.DisChargeI & 0x00FF);

            wtmp = Growatt_GetStatus();
	        Can_msg_Tx.Data[6] = (uint8_t)((wtmp >> 8) & 0x00FF);
	        Can_msg_Tx.Data[7] = (uint8_t)(wtmp & 0x00FF);

			Growatt_MsgIndex++;
	        break;
		}

	    case 1:
		{
	        Can_msg_Tx.StdId = 0x312;

			wtmp = Growatt_GetProtectStatus();
	        Can_msg_Tx.Data[0] = (uint8_t)(wtmp & 0x00FF);
            Can_msg_Tx.Data[1] = (uint8_t)((wtmp >> 8) & 0x00FF);

            wtmp = Growatt_GetWarningStatus();
	        Can_msg_Tx.Data[2] = (uint8_t)(wtmp & 0x00FF);
            Can_msg_Tx.Data[3] = (uint8_t)((wtmp >>8) & 0x00FF);

	        Can_msg_Tx.Data[4] = InverterData.PackNum;

	        Can_msg_Tx.Data[5] =0;//电池降功率的原因
	        Can_msg_Tx.Data[6] =0;

	        Can_msg_Tx.Data[7] = 0;//预留

			Growatt_MsgIndex++;
	        break;
		}

	    case 2:
		{
	        Can_msg_Tx.StdId = 0x313;

	        Can_msg_Tx.Data[0] = (uint8_t)(((InverterData.Vsum / 10) >> 8) & 0x00FF);
	        Can_msg_Tx.Data[1] = (uint8_t)((InverterData.Vsum / 10) & 0x00FF);

	        Can_msg_Tx.Data[2] = (uint8_t)(((InverterData.Current / 10) >> 8) & 0x00FF);
	        Can_msg_Tx.Data[3] = (uint8_t)((InverterData.Current / 10) & 0x00FF);

			Iwtmp = (int16_t)InverterData.BatteryTemp - 2730;//改为平均温度

	        Can_msg_Tx.Data[4] = (uint8_t)((Iwtmp >> 8) & 0x00FF);
	        Can_msg_Tx.Data[5] = (uint8_t)(Iwtmp & 0x00FF);

	        Can_msg_Tx.Data[6] = (uint8_t)InverterData.SocAvg;//平均SOC
	        Can_msg_Tx.Data[7] = (uint8_t)InverterData.Soh;

			Growatt_MsgIndex++;
	        break;
		}

	    case 3:
		{
	        Can_msg_Tx.StdId = 0x314;

	        Can_msg_Tx.Data[0] = (uint8_t)((InverterData.RmAll >> 8) & 0x00FF);
	        Can_msg_Tx.Data[1] = (uint8_t)(InverterData.RmAll & 0x00FF);

	        Can_msg_Tx.Data[2] = (uint8_t)((InverterData.FccAll >> 8) & 0x00FF);
	        Can_msg_Tx.Data[3] = (uint8_t)(InverterData.FccAll & 0x00FF);

	        Can_msg_Tx.Data[4] = (uint8_t)((InverterData.DeltaV >> 8) & 0x00FF);
	        Can_msg_Tx.Data[5] = (uint8_t)(InverterData.DeltaV & 0x00FF);

	        Can_msg_Tx.Data[6] = (uint8_t)((InverterData.Cycle >> 8) & 0x00FF);
	        Can_msg_Tx.Data[7] = (uint8_t)(InverterData.Cycle & 0x00FF);

			Growatt_MsgIndex++;
	        break;
	    }

	    case 4:
	    {
			Can_msg_Tx.StdId = 0x319;

	        Can_msg_Tx.Data[0] = (uint8_t)(PackReqData());

	        Can_msg_Tx.Data[1] = (uint8_t)((InverterData.Gmax >> 8) & 0x00FF);
	        Can_msg_Tx.Data[2] = (uint8_t)(InverterData.Gmax & 0x00FF);

	        Can_msg_Tx.Data[3] = (uint8_t)((InverterData.Gmin >> 8) & 0x00FF);
	        Can_msg_Tx.Data[4] = (uint8_t)(InverterData.Gmin & 0x00FF);

	        Can_msg_Tx.Data[5] = InverterData.GmaxAddr;
	        Can_msg_Tx.Data[6] = InverterData.GminAddr;

	        Can_msg_Tx.Data[7] = InverterData.FaultID;

			Growatt_MsgIndex++;
	        break;
		}

	    case 5:
		{
	        Can_msg_Tx.StdId = 0x320;
#if 0
	        lwtmp = Date_To_Decimal(Current_Date.Year);
	        lwtmp <<= 4;
	        lwtmp += Date_To_Decimal(Current_Date.Month);
	        lwtmp <<= 5;
	        lwtmp += Date_To_Decimal(Current_Date.Day);
	        lwtmp <<= 5;
	        lwtmp += Date_To_Decimal(Current_Date.Hour);
	        lwtmp <<= 6;
	        lwtmp += Date_To_Decimal(Current_Date.Minute);
	        lwtmp <<= 6;
	        lwtmp += Date_To_Decimal(Current_Date.Second);
            
            Can_msg_Tx.Data[4] = (uint8_t)(lwtmp & 0x00FF);
	        Can_msg_Tx.Data[5] = (uint8_t)((lwtmp >> 8) & 0x00FF);
	        Can_msg_Tx.Data[6] = (uint8_t)((lwtmp >> 16) & 0x00FF);
	        Can_msg_Tx.Data[7] = (uint8_t)((lwtmp >> 24) & 0x00FF);
#endif
	        Can_msg_Tx.Data[0] = 'G';
	        Can_msg_Tx.Data[1] = 'T';

	        Can_msg_Tx.Data[2] = 0x01;
	        Can_msg_Tx.Data[3] = 0x01;

	        Can_msg_Tx.Data[4] = 0;
	        Can_msg_Tx.Data[5] = 0;
	        Can_msg_Tx.Data[6] = 0;
	        Can_msg_Tx.Data[7] = 0;
            
            Growatt_MsgIndex++;
	        break;
		}
        case 6:
            Can_msg_Tx.StdId = 0x322;
            
            Can_msg_Tx.Data[0] = (uint8_t)(((InverterData.Tmax - 2730)>>8)&0xFF);
	        Can_msg_Tx.Data[1] = (uint8_t)((InverterData.Tmax - 2730)&0xFF);

	        Can_msg_Tx.Data[2] = (uint8_t)(((InverterData.Tmin -2730) >>8)&0xFF);
	        Can_msg_Tx.Data[3] = (uint8_t)((InverterData.Tmin - 2730)&0xFF);

            Can_msg_Tx.Data[4] = (uint8_t)(InverterData.TmaxAddr&0xFF);
	        Can_msg_Tx.Data[5] = (uint8_t)(InverterData.TminAddr&0xFF);

	        Can_msg_Tx.Data[6] = InverterData.SysMaxSoc;
	        Can_msg_Tx.Data[7] = InverterData.SysMinSoc;
            
            Growatt_MsgIndex++;
        break;
        case 7:
            Can_msg_Tx.StdId = 0x323;
            
            Can_msg_Tx.Data[0] = InverterData.PackNum * Pack_Cells_Num;
            Can_msg_Tx.Data[1] = (uint8_t)((WarningPara.HighBatVol>>8)&0xFF);
	        Can_msg_Tx.Data[2] = (uint8_t)(WarningPara.HighBatVol&0xFF);
            
	        Can_msg_Tx.Data[3] = 0;

            Can_msg_Tx.Data[4] = BmsProtect3();
	        Can_msg_Tx.Data[5] = BmsProtect4();

	        Can_msg_Tx.Data[6] = BmsProtect5();
	        Can_msg_Tx.Data[7] = BmsWarning3();
            
           if(1 == InverterData.PackNum)
			{
				Growatt_MsgIndex++;
			}
			else
			{
				Growatt_MsgIndex = 0;
			}
        break;
	    case 8:
		{
	        Can_msg_Tx.StdId = 0x315;

	        Can_msg_Tx.Data[0] =  (uint8_t)(PackData[0].Vol[0]>>8&0xFF);
	        Can_msg_Tx.Data[1] = (uint8_t)(PackData[0].Vol[0]&0xFF);

	        Can_msg_Tx.Data[2] = (uint8_t)(PackData[0].Vol[1]>>8&0xFF);
	        Can_msg_Tx.Data[3] = (uint8_t)(PackData[0].Vol[1]&0xFF);

            Can_msg_Tx.Data[4] = (uint8_t)(PackData[0].Vol[2]>>8&0xFF);
	        Can_msg_Tx.Data[5] = (uint8_t)(PackData[0].Vol[2]&0xFF);

	        Can_msg_Tx.Data[6] = (uint8_t)(PackData[0].Vol[3]>>8&0xFF);
	        Can_msg_Tx.Data[7] = (uint8_t)(PackData[0].Vol[3]&0xFF);
            
            Growatt_MsgIndex++;
	        break;
		}

		case 9:
		{
	        Can_msg_Tx.StdId = 0x316;

	        Can_msg_Tx.Data[0] =  (uint8_t)(PackData[0].Vol[4]>>8&0xFF);
	        Can_msg_Tx.Data[1] = (uint8_t)(PackData[0].Vol[4]&0xFF);

            Can_msg_Tx.Data[2] = (uint8_t)(PackData[0].Vol[5]>>8&0xFF);
	        Can_msg_Tx.Data[3] = (uint8_t)(PackData[0].Vol[5]&0xFF);

	        Can_msg_Tx.Data[4] = (uint8_t)(PackData[0].Vol[6]>>8&0xFF);
	        Can_msg_Tx.Data[5] = (uint8_t)(PackData[0].Vol[6]&0xFF);

	        Can_msg_Tx.Data[6] = (uint8_t)(PackData[0].Vol[7]>>8&0xFF);
	        Can_msg_Tx.Data[7] = (uint8_t)(PackData[0].Vol[7]&0xFF);
            
            Growatt_MsgIndex++;
	        break;
		}

	    case 10:
		{
	        Can_msg_Tx.StdId = 0x317;

	        Can_msg_Tx.Data[0] =  (uint8_t)(PackData[0].Vol[8]>>8&0xFF);
	        Can_msg_Tx.Data[1] = (uint8_t)(PackData[0].Vol[8]&0xFF);

	        Can_msg_Tx.Data[2] = (uint8_t)(PackData[0].Vol[9]>>8&0xFF);
	        Can_msg_Tx.Data[3] = (uint8_t)(PackData[0].Vol[9]&0xFF);

	        Can_msg_Tx.Data[4] = (uint8_t)(PackData[0].Vol[10]>>8&0xFF);
	        Can_msg_Tx.Data[5] = (uint8_t)(PackData[0].Vol[10]&0xFF);

	        Can_msg_Tx.Data[6] = (uint8_t)(PackData[0].Vol[11]>>8&0xFF);
	        Can_msg_Tx.Data[7] = (uint8_t)(PackData[0].Vol[11]&0xFF);
            
            Growatt_MsgIndex++;
	        break;
		}

	    case 11:
	    {
		    Can_msg_Tx.StdId = 0x318;

	        Can_msg_Tx.Data[0] =  (uint8_t)(PackData[0].Vol[12]>>8&0xFF);
	        Can_msg_Tx.Data[1] = (uint8_t)(PackData[0].Vol[12]&0xFF);

	        Can_msg_Tx.Data[2] = (uint8_t)(PackData[0].Vol[13]>>8&0xFF);
	        Can_msg_Tx.Data[3] = (uint8_t)(PackData[0].Vol[13]&0xFF);

	        Can_msg_Tx.Data[4] = (uint8_t)(PackData[0].Vol[14]>>8&0xFF);
	        Can_msg_Tx.Data[5] = (uint8_t)(PackData[0].Vol[14]&0xFF);

	        Can_msg_Tx.Data[6] = (uint8_t)(PackData[0].Vol[15]>>8&0xFF);
	        Can_msg_Tx.Data[7] = (uint8_t)(PackData[0].Vol[15]&0xFF);
            
            Growatt_MsgIndex = 0;
	        break;
		}

	    default:
		{
	        Growatt_MsgIndex = 0;
	        break;
		}

	}

    Can_TransmitData(&Can_msg_Tx);
}
//Rate500k
void CanComGrowatt_V109_Init(CanRate_t baudrate)
{
    Current_Can_Rate = baudrate;
    CAN_Config(Current_Can_Rate);
	Set_Timer(CANCOMPNTIMER, 1);
}

void CanComGrowatt_V109_MainCall(void)
{

	if(Timer[CANCOMPNTIMER].Flag)
	{
		Set_Timer(CANCOMPNTIMER, 8);
		Growatt_SendCycleMsg();
	}
}

/*************************************************

Function:	  Delay_ms()

Description:	16MHZ

*************************************************/
static void Can_Delay_ms(uint16_t nms)
{
    uint8_t us, n_10us;
    
    while(nms--)
    {
        n_10us = 70;
        while(n_10us--)
        {
            us = 50;
            while(us--);
        }
    }
}

static void IsCommBreak()
{
    #define  HEART_ERR_TIME     3000
    static unsigned long timecnt=0;
    static unsigned short last_value=0;
    
    if(last_value != Can_Growatt_v109.HeartValue)
    {
        last_value = Can_Growatt_v109.HeartValue;
        Can_Growatt_v109.IsCommBreakFlag = 0;
        timecnt = 0;
    }
    else
    {
        Can_Delay_ms(1);
        timecnt++;
    }
    
    if(timecnt >= HEART_ERR_TIME)     //3s都没有心跳，就报错
    {
        Can_Growatt_v109.IsCommBreakFlag = 1;
        if(timecnt >= 0xffffffff)    //溢出处理
        {
            timecnt = HEART_ERR_TIME;
        }
    }
}

void Can_Heart_0x301(CanRxMessage *msg)
{
    static unsigned short last_value=0;
    unsigned short temp=0;
    
    temp = (msg->Data[0]<<8)|msg->Data[1];
    if(temp != last_value)
    {
        last_value = temp;
        Can_Growatt_v109.HeartValue = last_value;
    }
}

void Can_Respond_0x324(unsigned char frameNumber, unsigned char *buf, unsigned char totalframe, unsigned char offset)
{
    Can_msg_Tx.StdId = 0x324;
    Can_msg_Tx.DLC = 8;
    Can_msg_Tx.IDE = CAN_ID_STD;
    
    for(unsigned char i=0;i<8;i++)
    {
        Can_msg_Tx.Data[i]= 0;
    }
    
    if(((frameNumber+1)==totalframe)&&(offset))
    {
        for(unsigned char i=0;i<offset;i++)
        {
            Can_msg_Tx.Data[0] = frameNumber;
            Can_msg_Tx.Data[1] = LocalAddr;
            Can_msg_Tx.Data[i+2] = buf[i];
        }
    }
    else
    {
        Can_msg_Tx.Data[0] = frameNumber;
        Can_msg_Tx.Data[1] = LocalAddr;
        Can_msg_Tx.Data[2] = buf[0];
        Can_msg_Tx.Data[3] = buf[1];
        Can_msg_Tx.Data[4] = buf[2];
        Can_msg_Tx.Data[5] = buf[3];
        Can_msg_Tx.Data[6] = buf[4];
        Can_msg_Tx.Data[7] = buf[5];
    }
    Can_TransmitData(&Can_msg_Tx);
}

void CanComGrowatt_V109_ReceiveIRQ(const CanRxMessage *msg)
{
    if(msg->StdId == 0x211)
    {
          Current_Date.Year = Decimal_To_Date(msg->Data[1]);
          Current_Date.Month = Decimal_To_Date(msg->Data[2]);
          Current_Date.Day = Decimal_To_Date(msg->Data[3]);
          Current_Date.Hour = Decimal_To_Date(msg->Data[4]);
          Current_Date.Minute = Decimal_To_Date(msg->Data[5]);
          Current_Date.Second = Decimal_To_Date(msg->Data[6]);
          
          if(WriteDate_BL5372() == 0)
          {
              
          }
    }
    else if(msg->StdId == 0x212)
    {   
        if(msg->Data[0]==1)     //电池参数查询使能，1；电池序列号，2：保留，3：保留
        {
            unsigned char i=0, j=0, frameNumber=0, *pbuf=0;
            for(i=0; Product_Code[i]!='\0';i++)
            {
                j++;
            }
            frameNumber = j/8 + ((j%8)?1:0);
            pbuf = Product_Code;
            for(i=0; i<frameNumber;i++)
            {
                Can_Respond_0x324(i, pbuf, frameNumber, j%8);
                pbuf+=8;
            }
        }
    }
}

Can_Growatt_v109_s Can_Growatt_v109 =
{
    IsCommBreak,
    Can_Heart_0x301,
    CanComGrowatt_V109_ReceiveIRQ,
    0,
    0,
};
