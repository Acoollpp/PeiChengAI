# 代码生成规则参考

> 本文件只保留“协议字段如何落到项目风格单协议 `.c` 文件中”的基础技术规则。
> 目的不是生成通用 `pack/unpack` 代码库，而是为单协议 `.c` 文件中的字段拆分、位操作、符号处理、换算提供依据。

---

## 1. 位操作规则（Intel 字节序 / 小端）

Intel 字节序中，`start_bit` 表示 LSB 在整字节数组中的绝对位编号。

```c
absolute_bit = byte_index * 8 + bit_index_in_byte;
```

**提取示例（无符号，Intel，`start_bit = 4`，`length = 12`）：**

```c
uint16_t raw = ((uint16_t)pData[0] >> 4) | ((uint16_t)pData[1] << 4);
raw &= 0x0FFFu;
```

**位段写入参考（Intel，供单协议 `.c` 文件内部使用）：**

```c
static void write_signal_intel(uint8_t *pData, uint64_t value,
                               uint8_t start_bit, uint8_t length)
{
    uint8_t byte_pos = start_bit / 8u;
    uint8_t bit_pos  = start_bit % 8u;
    uint8_t bits_left = length;
    uint8_t shift = bit_pos;

    while(bits_left > 0u)
    {
        uint8_t bits_this_byte = (8u - shift < bits_left) ? (8u - shift) : bits_left;
        uint8_t mask = (uint8_t)(((1u << bits_this_byte) - 1u) << shift);
        pData[byte_pos] &= (uint8_t)(~mask);
        pData[byte_pos] |= (uint8_t)((value << shift) & mask);
        value >>= bits_this_byte;
        bits_left -= bits_this_byte;
        byte_pos++;
        shift = 0u;
    }
}
```

---

## 2. Motorola 字节序（大端）

Motorola 字节序中，`start_bit` 表示 MSB 位的绝对位编号。

```c
byte_index = start_bit / 8;
bit_in_byte = 7 - (start_bit % 8);
```

生成代码前必须确认协议文档使用的是 Intel 还是 Motorola；不能默认按某一类外推。

---

## 3. 有符号信号处理

```c
if(raw & (1u << (length - 1u)))
{
    raw |= ~((1u << length) - 1u);
}

int32_t signed_val = (int32_t)raw;
```

若协议字段本身就是有符号量，发送时也应保持对应的有符号拆分方式。

---

## 4. Factor / Offset 换算

```c
float phys = (float)raw * factor + offset;
uint32_t raw = (uint32_t)((phys - offset) / factor);
```

注意：若 `factor == 1` 且 `offset == 0`，不要生成多余换算代码，直接使用原始值。

---

## 5. 代码风格要求

- 本文件只定义底层技术规则；具体命名、注释、临时变量、ASCII 写法等项目风格，以 `coding-style.md` 为准。
- 所有函数参数指针按需要添加 `const` 限定。
- 不使用标准库，不额外引入 `stdio.h`、`stdlib.h` 一类头文件。
- 类型统一使用 `uint8_t`、`uint16_t`、`uint32_t`、`int16_t` 等项目既有风格。
- 每个信号操作可根据需要补注释标明位域范围，例如 `/* bits[7:4] */`。
- 若当前任务只生成单协议 `.c` 文件，则不需要额外引出通用 `pack/unpack` 头文件结构。
