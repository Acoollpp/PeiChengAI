/**
 * @file    can_types.h
 * @brief   CAN 代码基础类型定义（当目标工程无 stdint.h 时使用）
 * @note    若工程已包含 stdint.h，删除此文件，改用 #include <stdint.h>
 */

#ifndef CAN_TYPES_H
#define CAN_TYPES_H

/* ========== 无符号整型 ========== */
typedef unsigned char       uint8_t;
typedef unsigned short      uint16_t;
typedef unsigned long       uint32_t;
typedef unsigned long long  uint64_t;

/* ========== 有符号整型 ========== */
typedef signed char         int8_t;
typedef signed short        int16_t;
typedef signed long         int32_t;
typedef signed long long    int64_t;

/* ========== 布尔类型 ========== */
#ifndef __cplusplus
typedef unsigned char bool;
#define true  (1U)
#define false (0U)
#endif

/* ========== NULL 定义 ========== */
#ifndef NULL
#define NULL ((void*)0)
#endif

#endif /* CAN_TYPES_H */
