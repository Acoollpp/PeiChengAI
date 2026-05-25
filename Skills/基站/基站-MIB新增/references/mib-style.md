# MIB 风格参考

当需要根据协议表、截图或现有模板生成项目专用 SNMP MIB 时，使用这份参考。

## 常见整体结构

目标 MIB 文件通常包含以下部分：

1. 头部注释
2. `<MODULE-NAME> DEFINITIONS ::= BEGIN`
3. `IMPORTS`
4. 节点定义区
5. trap 对应的 `NOTIFICATION-TYPE`
6. 普通协议项对应的 `OBJECT-TYPE`
7. `END`

## 节点区写法模式

节点定义常见写法如下：

```mib
        -- 1.3.3
        node1 OBJECT IDENTIFIER ::= { org 3 }
```

之后会逐级展开节点树，通常最后落到类似 `node6`，然后继续分出：

```mib
        trapOid OBJECT IDENTIFIER ::= { node6 0 }
        pack0 OBJECT IDENTIFIER ::= { node6 0 }
        pack1 OBJECT IDENTIFIER ::= { node6 1 }
```

如果现有模板里已经存在 `trapOid` 和 `pack0` 共用同一个数字节点的写法，不要擅自改掉，保持原模板风格。

## Trap 项写法模式

```mib
        -- <full oid>
        cellVolHW NOTIFICATION-TYPE
            STATUS current
            DESCRIPTION
                "High voltage alarm for cell.
                Value means the address of the device."
            ::= { trapOid 501 }
```

trap 一般有这些特点：

- 固定 `STATUS current`
- 没有 `SYNTAX`
- 描述通常保留英文
- 经常会有第二句说明返回值或载荷含义

## 普通对象写法模式

```mib
        --  <full oid>
        basicData OBJECT-TYPE
            SYNTAX OCTET STRING
            MAX-ACCESS read-only
            STATUS current
            DESCRIPTION
                "Basic data "
            ::= { pack0 1 }
```

普通对象通常遵循这些规则：

- `SYNTAX OCTET STRING`
- `STATUS current`
- `MAX-ACCESS` 为 `read-only` 或 `read-write`
- `DESCRIPTION` 通常是一句简短英文说明

## 读写属性推断规则

只有在协议文档没有明确写读写属性时，才使用下面的经验规则：

- 遥测、状态、测量值、版本/信息查询：`read-only`
- 设置、配置、控制、复位、网络参数：`read-write`

## pack 复制规则

很多电池类 MIB 会把同一组对象重复挂在多个 pack 节点下，例如：

- `pack0`
- `pack1`
- ...
- `pack16`

如果模板 MIB 使用了这种复制方式，那么新增对象时也必须按每个 pack 全部生成，除非协议文档明确说明该对象只属于单一根节点。

## 命名风格

常见对象名风格示例：

- `basicData`
- `bmsStatus`
- `packVol`
- `packCur`
- `SOC`
- `SOH`
- `protoVer`
- `packSn`
- `trapConfig`
- `IPSet`
- `StorageInterval`
- `LimitCurrent`

优先使用简洁 camelCase，或者直接沿用现有项目里已经存在的大小写风格。不要为了“统一”而把整份旧 MIB 的命名全改掉。

## 复合对象补充规则

如果协议截图或参数表里多个字段共用同一个 OID，而且示例数据是组合形式，例如：

- `1-0`
- `192-168-1-10-255-255-255-0`

这类情况通常应处理为一个复合 `OBJECT-TYPE`，而不是多个独立对象。

处理原则：

- 用一个 `OBJECT-TYPE` 表示整个参数
- `SYNTAX` 通常仍为 `OCTET STRING`
- `DESCRIPTION` 里注明格式，例如 `format: function-status`
- 在协议代码里通过 `String/Cut` 完成拆分与拼接

## 校验清单

在完成 `.mib` 生成或补充之前，至少检查这些内容：

- 模块名是否符合文件用途
- 根节点定义是否完整
- 每个对象在其父节点下的 `subid` 是否唯一
- trap 在 `trapOid` 下的编号是否唯一
- 注释里的完整 OID 是否与实际 `::=` 一致
- 每个 `OBJECT-TYPE` 是否都有 `MAX-ACCESS`
- 如果模板用了 pack 复制，新增对象是否已全部复制
- 文件结尾是否仍然保留 `END`
