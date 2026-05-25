/************************************************************
协议名：{PROTOCOL_DOC_NAME}

源文件名: {PROTOCOL_FILE_NAME}

英文名: {PROTOCOL_EN}

中文名：{PROTOCOL_CN}

枚举值：{PROTOCOL_NAME} = {ENUM_VAL}

变更：
{DATE}  //{AUTHOR}
1、初版发布
2、文件头注释固定放在文件最顶部
***********************************************************/

#include <stdint.h>
#include "Inverter_Data.h"
#include "Analog_Sample.h"
#include "Balance_Ctrl.h"
#include "Status_Create.h"
#include "System_Ctrl.h"
#include "modbus_common.h"
#include "modbus_ctrl.h"
#include "Uart_User485.h"

// 寄存器区域映射定义，OFFSET相关的宏不用修改，其余地址按照协议文档进行修改，多余的可以删除
#define ONLY_READ_REG_REGION_1_OFFSET  0
#define ONLY_READ_REG_REGION_1_START   {ONLY_READ_REG_REGION_1_START}
#define ONLY_READ_REG_REGION_1_END     {ONLY_READ_REG_REGION_1_END}
#define ONLY_READ_REG_REGION_1_NUM     (ONLY_READ_REG_REGION_1_END - ONLY_READ_REG_REGION_1_START + 1)

/* TODO[未实现]: 按协议需要继续补 ONLY_READ_REG_REGION_2/3... */
/* TODO[未实现]: 若协议支持写寄存器，补 READ_WRITE_REG_REGION_X_* 宏 */

#define ALL_REG_NUM (ONLY_READ_REG_REGION_1_OFFSET + ONLY_READ_REG_REGION_1_NUM)

// 寄存器功能地址定义，宏名不固定，根据协议文档和使用需求进行内容定义
/* TODO[未实现]: 补充功能寄存器地址宏 */

/*************************************************
 * @brief 参数拼接函数，在寄存器更新时会被调用。根据具体协议文档要求进行编写，可以没有
 * @brief 注释部分为示例代码，根据协议文档进行修改
 * @return uint16_t: 参数值
 *************************************************/
static uint16_t get_status_value(void)
{
    uint16_t temp = 0;

    /* TODO[未实现]: 根据协议文档和真实数据源填充状态位逻辑 */

    return temp;
}

/*************************************************
 * @brief 更新只读寄存器区1，函数名不可修改。注释部分为示例代码，根据协议文档进行修改
 * @brief 具体内容根据协议文档寄存器定义进行填充，预留的寄存器可以直接填0，或者跳过
 * @param[in] reg: 寄存器数组指针，直接传寄存器数组起始地址，不需要偏移。偏移会根据函数功能在内部实现
 * @param[in] reg_num: 寄存器数量
 * @param[out] reg: 寄存器数组指针
 * @return void
 *************************************************/
static void updata_onlyRead_region_1(uint16_t *reg, uint16_t reg_num)
{
    uint16_t idx = ONLY_READ_REG_REGION_1_OFFSET;

    reg[idx++] = get_status_value();
    /* TODO[未实现]: 按协议继续填充只读寄存器区1 */

    return;
}

/*************************************************
 * @brief 更新所有可读寄存器区，函数名不可修改。函数内容根据定义的寄存器区域个数进行适配。
 * @brief 作为寄存器数据读取更新的总入口函数，会在帧处理流程中被调用。
 * @param[in] reg: 寄存器数组指针，直接传寄存器数组起始地址
 * @param[in] reg_num: 寄存器数量
 * @param[out] reg: 寄存器数组指针
 * @return void
 *************************************************/
void {PROTOCOL_NAME}_updata_all_reg(uint16_t *reg, uint16_t reg_num)
{
    if (reg_num < ALL_REG_NUM) {
        return;
    }

    updata_onlyRead_region_1(reg, reg_num);
    /* TODO[未实现]: 若定义了更多寄存器区，在这里继续调用 */

    return;
}

/*************************************************
 * @brief 设置寄存器参数。函数定义和结构不可修改。只需根据前面编写的功能寄存器设置函数，修改case内容。
 * @brief 作为寄存器数据设置总接口，根据帧内容，进行对应的寄存器内容设置。注释部分为示例代码，根据协议文档进行修改
 * @param[in] frame_info: 协议帧信息指针
 * @return void
 *************************************************/
void {PROTOCOL_NAME}_set_reg(Modbus_frame_info_s *frame_info)
{
    switch (frame_info->reg_start_addr) {
        /* TODO[未实现]: 按协议补写寄存器处理 */
        default:
            break;
    }

    return;
}

/*************************************************
 * @brief 协议对外数据接口。供协议栈解析调用。
 * @brief 根据协议帧内容，和前面定义的寄存器区间进行填充。
 * @brief 回调函数部分无需修改
 *************************************************/
static Modbus_protocol_info_s g_modbus_{PROTOCOL_EN} = {
    .dev_addr_start = {DEV_ADDR_START},
    .onlyRead_reg_region = {
        {ONLY_READ_REG_REGION_1_OFFSET, ONLY_READ_REG_REGION_1_START, ONLY_READ_REG_REGION_1_END},
        /* TODO[未实现]: 若有更多只读区，在此继续补 */
    },
    .onlyRead_region_num = {ONLY_READ_REGION_NUM},
    .readWrite_reg_region = {NULL},
    .readWrite_region_num = {READ_WRITE_REGION_NUM},
    .reg_update_callback = {PROTOCOL_NAME}_updata_all_reg,
    .reg_set_callback = {PROTOCOL_NAME}_set_reg,
};

/*************************************************
 * @brief 协议初始化函数。内容无需修改
 * @brief 对固定的通信口进行初始化，若需要更换通信口，则需要同步修改通信口初始化函数
 * @param[in] baudrate: 波特率
 * @return void
 *************************************************/
void {PROTOCOL_NAME}_Init(uint32_t baudrate)
{
    InverterUart_Init(baudrate);
    g_485Modbus_ctrl.protocol = &g_modbus_{PROTOCOL_EN};
    MODBUS_comm_init(&g_485Modbus_ctrl);

    return;
}

/*************************************************
 * @brief 协议帧接收函数。内容无需修改
 * @brief 对配置的通信口接收数据处理中调用该函数，将接收到的数据传入协议栈解析接收
 * @param[in] Buffer: 接收到的数据
 * @return void
 *************************************************/
void {PROTOCOL_NAME}_ReceiveIQR(uint8_t Buffer)
{
    MODBUS_frame_receive(Buffer, &g_485Modbus_ctrl);

    return;
}

/*************************************************
 * @brief 协议帧处理函数。内容无需修改
 * @return void
 *************************************************/
void {PROTOCOL_NAME}_DataRespond(void)
{
    MODBUS_frame_handle(&g_485Modbus_ctrl);

    return;
}
