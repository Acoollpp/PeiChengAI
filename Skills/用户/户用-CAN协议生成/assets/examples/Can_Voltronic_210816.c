/************************************************************
协议名：003-Voltronic CAN 2021.08.16.pdf

源文件名: Can_Voltronic_210816.c

英文名: VOLTRONIC_210816

中文名：日月元_210816

枚举值：Can_Voltronic_210816 = 38

变更：
2025.10.30  //程昊
1、初版发布      
     
***********************************************************/
#include "CAN_Comm.h"
#include "Inverter_Data.h"
#include "Data_Init.h"

static uint8_t Voltronic_cmd = 0;
static uint8_t pack_id = 0;
uint8_t Protocol_version = 1;

static void Voltronic_0x0CF10100(uint8_t Pack_num)
{
    if(Pack_num > 0x0F)return;
    
    Can_msg_Tx.DLC = 8;
    Can_msg_Tx.IDE = CAN_ID_EXT;
    Can_msg_Tx.RTR = CAN_RTRQ_DATA;
    Can_msg_Tx.ExtId = 0x0CF20100 + Pack_num;
    
    Can_msg_Tx.Data[0] = 0;
    Can_msg_Tx.Data[1] = 0;
    Can_msg_Tx.Data[2] = 0;
    Can_msg_Tx.Data[3] = 0;
    Can_msg_Tx.Data[4] = 0;
    Can_msg_Tx.Data[5] = 0;
    Can_msg_Tx.Data[6] = 0;
    Can_msg_Tx.Data[7] = 0;
    Can_TransmitData(&Can_msg_Tx);
//    CAN0_TransmitData(&Can_msg_Tx);
}

static void Voltronic_0x0CF10110(uint8_t Pack_num)
{
    if(Pack_num > 0x0F)return;
    
    Can_msg_Tx.DLC = 8;
    Can_msg_Tx.IDE = CAN_ID_EXT;
    Can_msg_Tx.RTR = CAN_RTRQ_DATA;
    Can_msg_Tx.ExtId = 0x0CF20110 + Pack_num;
    
    Can_msg_Tx.Data[0] = 0;//SoftWare_Ver[15];
    Can_msg_Tx.Data[1] = 0;//SoftWare_Ver[16];
    Can_msg_Tx.Data[2] = 0;//SoftWare_Ver[17];
    Can_msg_Tx.Data[3] = 0;//SoftWare_Ver[18];
    Can_msg_Tx.Data[4] = 0;//HardWare_Ver[4];
    Can_msg_Tx.Data[5] = 0;//HardWare_Ver[5];
    Can_msg_Tx.Data[6] = 0;//HardWare_Ver[6];
    Can_msg_Tx.Data[7] = 0;//HardWare_Ver[7];
    Can_TransmitData(&Can_msg_Tx);
//    CAN0_TransmitData(&Can_msg_Tx);
}

static void Voltronic_0x0CF10200(uint8_t Pack_num)
{
    uint16_t Vmax_t = 0,Vmin_t = 0xffff,Tmax_t = 0,Tmin_t = 0xffff,j = 0;
    if(Pack_num > 0x0F)return;
    
    Can_msg_Tx.DLC = 8;
    Can_msg_Tx.IDE = CAN_ID_EXT;
    Can_msg_Tx.RTR = CAN_RTRQ_DATA;
    Can_msg_Tx.ExtId = 0x0CF20200 + Pack_num;
    
    if(Pack_num == 0 || InverterData.PackNum < Pack_num)
    {
        Can_msg_Tx.Data[0] = 0;
        Can_msg_Tx.Data[1] = 0;
        Can_msg_Tx.Data[2] = 0;
        Can_msg_Tx.Data[3] = 0;
        Can_msg_Tx.Data[4] = 0;
        Can_msg_Tx.Data[5] = 0;
        Can_msg_Tx.Data[6] = 0;
        Can_msg_Tx.Data[7] = 0;
    }
    else
    {
        /* �����ѹ ȡ�����С�����ѹ����λ�� */
        for(j = 0; j < Pack_Cells_Num; j++)
        {
            if(PackData[Pack_num-1].Vol[j] >= Vmax_t)
            {
                Vmax_t = PackData[Pack_num-1].Vol[j];
            }
            
            if(PackData[Pack_num-1].Vol[j] <= Vmin_t)
            {
                Vmin_t = PackData[Pack_num-1].Vol[j];
            }
        }
          
        /* ����¶� ȡ�������¶ȼ��������е���¶� */
        for(j = 0; j < Pack_Temps_Num - 2; j++)
        {
            if(PackData[Pack_num-1].Temp[j] >= Tmax_t)
            {
                Tmax_t = PackData[Pack_num-1].Temp[j]; 
            }
            
            if(PackData[Pack_num-1].Temp[j] <= Tmin_t)
            {
                Tmin_t = PackData[Pack_num-1].Temp[j];
            }
        }
        
        Can_msg_Tx.Data[0] = (uint8_t)(Vmax_t/100);
        Can_msg_Tx.Data[1] = (uint8_t)(Vmax_t/100 >> 8);
        Can_msg_Tx.Data[2] = (uint8_t)(Vmin_t/100);
        Can_msg_Tx.Data[3] = (uint8_t)(Vmin_t/100 >> 8);
        Can_msg_Tx.Data[4] = (uint8_t)Tmax_t;
        Can_msg_Tx.Data[5] = (uint8_t)(Tmax_t >> 8);
        Can_msg_Tx.Data[6] = (uint8_t)Tmin_t;
        Can_msg_Tx.Data[7] = (uint8_t)(Tmin_t >> 8);
    }
    Can_TransmitData(&Can_msg_Tx);
//    CAN0_TransmitData(&Can_msg_Tx);
}

static void Voltronic_0x0CF10210(uint8_t Pack_num)
{
    if(Pack_num > 0x0F)return;
    
    Can_msg_Tx.DLC = 8;
    Can_msg_Tx.IDE = CAN_ID_EXT;
    Can_msg_Tx.RTR = CAN_RTRQ_DATA;
    Can_msg_Tx.ExtId = 0x0CF20210 + Pack_num;
    
    if(Pack_num == 0 || InverterData.PackNum < Pack_num)
    {
        Can_msg_Tx.Data[0] = 0;
        Can_msg_Tx.Data[1] = 0;
        Can_msg_Tx.Data[2] = 0;
        Can_msg_Tx.Data[3] = 0;
        Can_msg_Tx.Data[4] = 0;
        Can_msg_Tx.Data[5] = 0;
        Can_msg_Tx.Data[6] = 0;
        Can_msg_Tx.Data[7] = 0;
    }
    else
    {
        if(PackData[Pack_num-1].Current > 0)
        {
            Can_msg_Tx.Data[0] = (uint8_t)(PackData[Pack_num-1].Current/10);
            Can_msg_Tx.Data[1] = (uint8_t)(PackData[Pack_num-1].Current/10 >> 8);
            Can_msg_Tx.Data[2] = 0;
            Can_msg_Tx.Data[3] = 0;
        }
        else if(PackData[Pack_num-1].Current < 0)
        {
            Can_msg_Tx.Data[0] = 0;
            Can_msg_Tx.Data[1] = 0;
            Can_msg_Tx.Data[2] = (uint8_t)(0 - PackData[Pack_num-1].Current/10);
            Can_msg_Tx.Data[3] = (uint8_t)((0 - PackData[Pack_num-1].Current/10) >> 8);
        }
        else
        {
            Can_msg_Tx.Data[0] = 0;
            Can_msg_Tx.Data[1] = 0;
            Can_msg_Tx.Data[2] = 0;
            Can_msg_Tx.Data[3] = 0;
        }
        Can_msg_Tx.Data[4] = (uint8_t)(PackData[Pack_num-1].Vsum/100);
        Can_msg_Tx.Data[5] = (uint8_t)(PackData[Pack_num-1].Vsum/100 >> 8);
        Can_msg_Tx.Data[6] = 0;
        Can_msg_Tx.Data[7] = 0;
    }
    Can_TransmitData(&Can_msg_Tx);
//    CAN0_TransmitData(&Can_msg_Tx);
}

static void Voltronic_0x0CF10220(uint8_t Pack_num)
{
    if(Pack_num > 0x0F)return;
    
    Can_msg_Tx.DLC = 8;
    Can_msg_Tx.IDE = CAN_ID_EXT;
    Can_msg_Tx.RTR = CAN_RTRQ_DATA;
    Can_msg_Tx.ExtId = 0x0CF20220 + Pack_num;
    
    if(Pack_num == 0 || InverterData.PackNum < Pack_num)
    {
        Can_msg_Tx.Data[0] = 0;
        Can_msg_Tx.Data[1] = 0;
        Can_msg_Tx.Data[2] = 0;
        Can_msg_Tx.Data[3] = 0;
        Can_msg_Tx.Data[4] = 0;
        Can_msg_Tx.Data[5] = 0;
        Can_msg_Tx.Data[6] = 0;
        Can_msg_Tx.Data[7] = 0;
    }
    else
    {
        Can_msg_Tx.Data[0] = PackData[Pack_num-1].Soc;
        Can_msg_Tx.Data[1] = 0;
        Can_msg_Tx.Data[2] = (uint8_t)(PackData[Pack_num-1].Rm*10);
        Can_msg_Tx.Data[3] = (uint8_t)(PackData[Pack_num-1].Rm*10 >> 8);
        Can_msg_Tx.Data[4] = (uint8_t)(PackData[Pack_num-1].Rm*10 >> 16);
        Can_msg_Tx.Data[5] = (uint8_t)(PackData[Pack_num-1].Rm*10 >> 32);
        Can_msg_Tx.Data[6] = 0;
        Can_msg_Tx.Data[7] = 0;
    }
    Can_TransmitData(&Can_msg_Tx);
//    CAN0_TransmitData(&Can_msg_Tx);
}

static void Voltronic_0x0CF10300(uint8_t Pack_num)
{
    uint8_t tmp8 = 0;
    if(Pack_num > 0x0F)return;
    
    Can_msg_Tx.DLC = 8;
    Can_msg_Tx.IDE = CAN_ID_EXT;
    Can_msg_Tx.RTR = CAN_RTRQ_DATA;
    Can_msg_Tx.ExtId = 0x0CF20300 + Pack_num;
    
    if(Pack_num == 0 || InverterData.PackNum < Pack_num)
    {
        Can_msg_Tx.Data[0] = 0;
        Can_msg_Tx.Data[1] = 0;
        Can_msg_Tx.Data[2] = 0;
        Can_msg_Tx.Data[3] = 0;
        Can_msg_Tx.Data[4] = 0;
        Can_msg_Tx.Data[5] = 0;
        Can_msg_Tx.Data[6] = 0;
        Can_msg_Tx.Data[7] = 0;
    }
    else
    {
        if(PackData[Pack_num-1].Status1&BIT3)
        {
            tmp8 = 1;
        }
        else if(PackData[Pack_num-1].Status1&BIT2)
        {
            tmp8 = 2;
        }
        else
        {
            tmp8 = 0;
        }
        Can_msg_Tx.Data[0] = tmp8;
        Can_msg_Tx.Data[1] = 0;
        Can_msg_Tx.Data[2] = tmp8;
        Can_msg_Tx.Data[3] = 0;
        if(PackData[Pack_num-1].Status1&BIT1)
        {
            tmp8 = 1;
        }
        else if(PackData[Pack_num-1].Status1&BIT0)
        {
            tmp8 = 2;
        }
        else
        {
            tmp8 = 0;
        }
        Can_msg_Tx.Data[4] = tmp8;
        Can_msg_Tx.Data[5] = 0;
        Can_msg_Tx.Data[6] = tmp8;
        Can_msg_Tx.Data[7] = 0;
    }
    Can_TransmitData(&Can_msg_Tx);
//    CAN0_TransmitData(&Can_msg_Tx);
}

static void Voltronic_0x0CF10310(uint8_t Pack_num)
{
    uint8_t tmp8 = 0;
    if(Pack_num > 0x0F)return;
    
    Can_msg_Tx.DLC = 8;
    Can_msg_Tx.IDE = CAN_ID_EXT;
    Can_msg_Tx.RTR = CAN_RTRQ_DATA;
    Can_msg_Tx.ExtId = 0x0CF20310 + Pack_num;
    
    if(Pack_num == 0 || InverterData.PackNum < Pack_num)
    {
        Can_msg_Tx.Data[0] = 0;
        Can_msg_Tx.Data[1] = 0;
        Can_msg_Tx.Data[2] = 0;
        Can_msg_Tx.Data[3] = 0;
        Can_msg_Tx.Data[4] = 0;
        Can_msg_Tx.Data[5] = 0;
        Can_msg_Tx.Data[6] = 0;
        Can_msg_Tx.Data[7] = 0;
    }
    else
    {

        if(PackData[Pack_num-1].Status1&BIT4)
        {
            tmp8 = 2;
        }
        else
        {
            tmp8 = 0;
        }
        Can_msg_Tx.Data[0] = tmp8;
        Can_msg_Tx.Data[1] = 0;
        if(PackData[Pack_num-1].Status1&BIT5)
        {
            tmp8 = 2;
        }
        else
        {
            tmp8 = 0;
        }
        Can_msg_Tx.Data[2] = tmp8;
        Can_msg_Tx.Data[3] = 0;
        if(PackData[Pack_num-1].Status2&BIT2)
        {
            tmp8 = 1;
        }
        else if(PackData[Pack_num-1].Status1&BIT0)
        {
            tmp8 = 2;
        }
        else
        {
            tmp8 = 0;
        }
        Can_msg_Tx.Data[4] = tmp8;
        Can_msg_Tx.Data[5] = 0;
        if(PackData[Pack_num-1].Status2&BIT3)
        {
            tmp8 = 1;
        }
        else if(PackData[Pack_num-1].Status1&BIT1)
        {
            tmp8 = 2;
        }
        else
        {
            tmp8 = 0;
        }
        Can_msg_Tx.Data[6] = tmp8;
        Can_msg_Tx.Data[7] = 0;
    }
    Can_TransmitData(&Can_msg_Tx);
//    CAN0_TransmitData(&Can_msg_Tx);
}

static void Voltronic_0x0CF10320(uint8_t Pack_num)
{
    uint8_t tmp8 = 0;
    if(Pack_num > 0x0F)return;
    
    Can_msg_Tx.DLC = 8;
    Can_msg_Tx.IDE = CAN_ID_EXT;
    Can_msg_Tx.RTR = CAN_RTRQ_DATA;
    Can_msg_Tx.ExtId = 0x0CF20320 + Pack_num;
    
    if(Pack_num == 0 || InverterData.PackNum < Pack_num)
    {
        Can_msg_Tx.Data[0] = 0;
        Can_msg_Tx.Data[1] = 0;
        Can_msg_Tx.Data[2] = 0;
        Can_msg_Tx.Data[3] = 0;
        Can_msg_Tx.Data[4] = 0;
        Can_msg_Tx.Data[5] = 0;
        Can_msg_Tx.Data[6] = 0;
        Can_msg_Tx.Data[7] = 0;
    }
    else
    {

        if(PackData[Pack_num-1].Status2&BIT2)
        {
            tmp8 = 1;
        }
        else if(PackData[Pack_num-1].Status2&BIT0)
        {
            tmp8 = 2;
        }
        else
        {
            tmp8 = 0;
        }
        Can_msg_Tx.Data[0] = tmp8;
        Can_msg_Tx.Data[1] = 0;
        if(PackData[Pack_num-1].Status2&BIT3)
        {
            tmp8 = 1;
        }
        else if(PackData[Pack_num-1].Status2&BIT1)
        {
            tmp8 = 2;
        }
        else
        {
            tmp8 = 0;
        }
        Can_msg_Tx.Data[2] = tmp8;
        Can_msg_Tx.Data[3] = 0;
        Can_msg_Tx.Data[4] = 0;
        Can_msg_Tx.Data[5] = 0;
        Can_msg_Tx.Data[6] = 0;
        Can_msg_Tx.Data[7] = 0;
    }
    Can_TransmitData(&Can_msg_Tx);
//    CAN0_TransmitData(&Can_msg_Tx);
}

static void Voltronic_0x0CF10400(uint8_t Pack_num)
{
    if(Pack_num > 0x0F)return;
    
    Can_msg_Tx.DLC = 8;
    Can_msg_Tx.IDE = CAN_ID_EXT;
    Can_msg_Tx.RTR = CAN_RTRQ_DATA;
    Can_msg_Tx.ExtId = 0x0CF20400 + Pack_num;
    
    if(Pack_num == 0 || InverterData.PackNum < Pack_num)
    {
        Can_msg_Tx.Data[0] = 0;
        Can_msg_Tx.Data[1] = 0;
        Can_msg_Tx.Data[2] = 0;
        Can_msg_Tx.Data[3] = 0;
        Can_msg_Tx.Data[4] = 0;
        Can_msg_Tx.Data[5] = 0;
        Can_msg_Tx.Data[6] = 0;
        Can_msg_Tx.Data[7] = 0;
    }
    else
    {
        Can_msg_Tx.Data[0] = (uint8_t)(InverterData.ChargeV);
        Can_msg_Tx.Data[1] = (uint8_t)(InverterData.ChargeV >> 8);
        Can_msg_Tx.Data[2] = (uint8_t)(InverterData.DisChargeV);
        Can_msg_Tx.Data[3] = (uint8_t)(InverterData.DisChargeV >> 8);
        Can_msg_Tx.Data[4] = (uint8_t)(InverterData.ChargeI/InverterData.PackNum);
        Can_msg_Tx.Data[5] = (uint8_t)(InverterData.ChargeI/InverterData.PackNum >> 8);
        Can_msg_Tx.Data[6] = (uint8_t)(InverterData.DisChargeI/InverterData.PackNum);
        Can_msg_Tx.Data[7] = (uint8_t)(InverterData.DisChargeI/InverterData.PackNum >> 8);
    }
    Can_TransmitData(&Can_msg_Tx);
//    CAN0_TransmitData(&Can_msg_Tx);
}

/*************************************************

Function:	CanComPn_CheckWarningFlag()

Description: ��ȡ��ŵ�ʹ������

*************************************************/
static uint8_t Voltronic_GetChgDsgCmd(void)
{
    uint8_t byte = 0;

    //charge enable
    if(InverterData.ForceCHG_Cmd & BIT7)
    {
        byte |= BIT7;
    }

    //discharge enable
    if(InverterData.ForceCHG_Cmd & BIT6)
    {
        byte |= BIT6;
    }

//    //Request full chargr
//    if((InverterData.ForceCHG_Cmd & 0x0003) == 0x0003)
//    {
//        byte |= 0x08;
//    }
    else if(InverterData.ForceCHG_Cmd & BIT5)
    {
        byte |= BIT5;
    }
    else if(InverterData.ForceCHG_Cmd & BIT4)
    {
        byte |= BIT4;
    }     
    return byte;
}

static void Voltronic_0x0CF10410(uint8_t Pack_num)
{
    if(Pack_num > 0x0F)return;
    
    Can_msg_Tx.DLC = 8;
    Can_msg_Tx.IDE = CAN_ID_EXT;
    Can_msg_Tx.RTR = CAN_RTRQ_DATA;
    Can_msg_Tx.ExtId = 0x0CF20410 + Pack_num;
    
    if(Pack_num == 0 || InverterData.PackNum < Pack_num)
    {
        Can_msg_Tx.Data[0] = 0;
        Can_msg_Tx.Data[1] = 0;
        Can_msg_Tx.Data[2] = 0;
        Can_msg_Tx.Data[3] = 0;
        Can_msg_Tx.Data[4] = 0;
        Can_msg_Tx.Data[5] = 0;
        Can_msg_Tx.Data[6] = 0;
        Can_msg_Tx.Data[7] = 0;
    }
    else
    {
        Can_msg_Tx.Data[0] = 0;
        Can_msg_Tx.Data[1] = Voltronic_GetChgDsgCmd();
        Can_msg_Tx.Data[2] = 0;
        Can_msg_Tx.Data[3] = 0;
        Can_msg_Tx.Data[4] = 0;
        Can_msg_Tx.Data[5] = 0;
        Can_msg_Tx.Data[6] = 0;
        Can_msg_Tx.Data[7] = 0;
    }
    Can_TransmitData(&Can_msg_Tx);
//    CAN0_TransmitData(&Can_msg_Tx);
}

void CanComVoltronic_210816_ReceiveIRQ(const CanRxMessage *msg)
{
    Voltronic_cmd = (uint8_t)(msg->ExtId >> 4);
    pack_id = (uint8_t)(msg->ExtId & 0x0F);
}

void CanComVoltronic_210816_MainCall(void)
{
    // if(0 == Get_CAN_Change_InitFlag())    //�˴���Э���л�ʱ������һ�Σ����³�ʼ��������
    // {
    //     Set_CAN_Change_InitFlag(1);
    //     Current_Can_Rate = Rate500k;
    //     CAN_Config(Current_Can_Rate);
    //     Set_Timer(CANCOMPNTIMER, 1);
    // }

    if(Timer[CANCOMPNTIMER].Flag)
    {
        Set_Timer(CANCOMPNTIMER, 8);
        switch(Voltronic_cmd)
        {
            case 0x10:
              Voltronic_0x0CF10100(pack_id);
              Voltronic_cmd = 0;
              break;
            case 0x11:
              Voltronic_0x0CF10110(pack_id);
              Voltronic_cmd = 0;
              break;
            case 0x20:
              Voltronic_0x0CF10200(pack_id);
              Voltronic_cmd = 0;
              break;
            case 0x21:
              Voltronic_0x0CF10210(pack_id);
              Voltronic_cmd = 0;
              break;
            case 0x22:
              Voltronic_0x0CF10220(pack_id);
              Voltronic_cmd = 0;
              break;
            case 0x30:
              Voltronic_0x0CF10300(pack_id);
              Voltronic_cmd = 0;
              break;
            case 0x31:
              Voltronic_0x0CF10310(pack_id);
              Voltronic_cmd = 0;
              break;
            case 0x32:
              Voltronic_0x0CF10320(pack_id);
              Voltronic_cmd = 0;
              break;
            case 0x40:
              Voltronic_0x0CF10400(pack_id);
              Voltronic_cmd = 0;
              break;
            case 0x41:
              Voltronic_0x0CF10410(pack_id);
              Voltronic_cmd = 0;
              break;
            default:
              break;
        }
    }
}

//Rate500k
void CanComVoltronic_210816_Init(CanRate_t baudrate)
{
    Current_Can_Rate = baudrate;
    CAN_Config(Current_Can_Rate);
	Set_Timer(CANCOMPNTIMER, 1);
}