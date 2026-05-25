#!/usr/bin/env python
# -*- coding: utf-8 -*-

import argparse
from dataclasses import dataclass


@dataclass
class Field:
    name: str
    ctype: str


def to_lower_camel(name: str) -> str:
    if not name:
        return name
    return name[0].lower() + name[1:]


def parse_fields(raw: str) -> list[Field]:
    fields: list[Field] = []
    if not raw:
        return fields
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        if ":" not in item:
            raise ValueError(f"字段格式错误: {item}，应为 name:type")
        name, ctype = item.split(":", 1)
        fields.append(Field(name=name.strip(), ctype=ctype.strip()))
    return fields


def parse_exprs(raw: str) -> list[str]:
    if not raw:
        return []
    return [x.strip() for x in raw.split(",") if x.strip()]


def build_struct(fields: list[Field], struct_name: str) -> str:
    if not fields:
        return ""
    lines = [f"typedef struct _{struct_name}", "{"]
    for field in fields:
        lines.append(f"    {field.ctype:<12} {field.name};")
    lines.append(f"}} {struct_name};")
    return "\n".join(lines)


def build_member(struct_name: str, member: str) -> str:
    return f"{struct_name:<28} {member};"


def build_prototypes(func_base: str, access: str) -> str:
    lines = [
        f"Snmp_Err_Type Get_{func_base}(Snmp_Bms_Para_Type* pBmsPara);",
        f"Snmp_Err_Type String_{func_base}(uint8_t *buf, uint8_t *pDataType, uint8_t *pDataLen, Snmp_Bms_Para_Type* pBmsPara);",
    ]
    if access == "read-write":
        lines.append(f"Snmp_Err_Type Cut_{func_base}(uint8_t *buf, uint8_t dataSize, Snmp_Bms_Para_Type* pBmsPara);")
        lines.append(f"Snmp_Err_Type Set_{func_base}(Snmp_Bms_Para_Type *pBmsPara);")
    return "\n".join(lines)


def build_get(func_base: str, member: str, fields: list[Field]) -> str:
    lines = [
        f"Snmp_Err_Type Get_{func_base}(Snmp_Bms_Para_Type* pBmsPara)",
        "{",
        "    if(pBmsPara == NULL) return GEN_ERR;",
        "",
    ]
    if fields:
        for field in fields:
            lines.append(f"    /* TODO: 从真实数据源填充 pBmsPara->{member}.{field.name} */")
    else:
        lines.append(f"    /* TODO: 从真实数据源填充 pBmsPara->{member} */")
    lines.extend([
        "",
        "    return NO_ERR;",
        "}",
    ])
    return "\n".join(lines)


def build_string(func_base: str, member: str, fmt: str, exprs: list[str]) -> str:
    args = ""
    if exprs:
        args = ",\n                        " + ",\n                        ".join(exprs)
    elif fmt != "%d":
        args = f",\n                        pBmsPara->{member}"
    else:
        args = f", pBmsPara->{member}"

    return "\n".join([
        f"Snmp_Err_Type String_{func_base}(uint8_t *buf, uint8_t *pDataType, uint8_t *pDataLen, Snmp_Bms_Para_Type* pBmsPara)",
        "{",
        "    uint16_t dataSize = 0;",
        "    uint8_t *ptr = buf;",
        "",
        "    if(pBmsPara->pdu == (uint8_t)SNMP_SET)",
        "    {",
        "        *pDataType = (uint8_t)SNMP_NULL;",
        "        *pDataLen  = 0;",
        "        return NO_ERR;",
        "    }",
        "",
        "    if((pBmsPara == NULL) || (pDataLen == NULL) || (pDataType == NULL) || (buf == NULL)) return GEN_ERR;",
        "    *pDataType = (uint8_t)SNMP_OCTET_STRING;",
        "",
        f"    dataSize = snprintf((char *)ptr, SNMP_MAX_DATA_SIZE, \"{fmt}\"{args});",
        "",
        "    *pDataLen = dataSize;",
        "    return((dataSize >= SNMP_MAX_DATA_SIZE)?  TOO_BIG : NO_ERR);",
        "}",
    ])


def build_cut(func_base: str, member: str, fields: list[Field]) -> str:
    lines = [
        f"Snmp_Err_Type Cut_{func_base}(uint8_t *buf, uint8_t dataSize, Snmp_Bms_Para_Type* pBmsPara)",
        "{",
        "    char *ptr = (char *)buf;",
        "",
        "    (void)dataSize;",
        "    if((ptr == NULL) || (pBmsPara == NULL)) return BAD_VALUE;",
        "",
    ]
    if not fields:
        lines.extend([
            f"    pBmsPara->{member} = (uint8_t)Snmp_String_To_Int(ptr);",
        ])
    else:
        first = True
        for field in fields:
            if first:
                lines.append("    strtok(ptr, \"-\");")
                lines.append("    if(ptr == NULL) return BAD_VALUE;")
                lines.append(f"    pBmsPara->{member}.{field.name} = ({field.ctype})Snmp_String_To_Int(ptr);")
                first = False
            else:
                lines.append("")
                lines.append("    ptr = strtok(NULL, \"-\");")
                lines.append("    if(ptr == NULL) return BAD_VALUE;")
                lines.append(f"    pBmsPara->{member}.{field.name} = ({field.ctype})Snmp_String_To_Int(ptr);")
    lines.extend([
        "",
        "    return NO_ERR;",
        "}",
    ])
    return "\n".join(lines)


def build_set(func_base: str, member: str, fields: list[Field]) -> str:
    lines = [
        f"Snmp_Err_Type Set_{func_base}(Snmp_Bms_Para_Type *pBmsPara)",
        "{",
        "    if(pBmsPara == NULL) return GEN_ERR;",
        "",
    ]
    if fields:
        for field in fields:
            lines.append(f"    /* TODO: 将 pBmsPara->{member}.{field.name} 写回真实变量 */")
    else:
        lines.append(f"    /* TODO: 将 pBmsPara->{member} 写回真实变量 */")
    lines.extend([
        "",
        "    /* TODO: 如有需要，补持久化或副作用，例如 Snmp_Storage_SysConfig(); */",
        "    return NO_ERR;",
        "}",
    ])
    return "\n".join(lines)


def build_dispatch(cmd_macro: str, func_base: str, access: str) -> str:
    if access == "read-write":
        return f"{{{cmd_macro}, Get_{func_base}, String_{func_base}, Cut_{func_base}, Set_{func_base}}},"
    return f"{{{cmd_macro}, Get_{func_base}, String_{func_base}, NULL, NULL}},"


def build_mib(mib_name: str, cmd_id: int, access: str, mib_description: str) -> str:
    if not mib_description:
        mib_description = mib_name
    max_access = "read-only" if access == "read-only" else "read-write"
    return "\n".join([
        f"--  1.3.3.1.4.1.0.0.0.{cmd_id}",
        f"{mib_name} OBJECT-TYPE",
        "    SYNTAX OCTET STRING",
        f"    MAX-ACCESS {max_access}",
        "    STATUS current",
        "    DESCRIPTION",
        f"        \"{mib_description}\"",
        f"    ::= {{ pack0 {cmd_id} }}",
    ])


def main() -> None:
    parser = argparse.ArgumentParser(description="生成动力组 SNMP 协议骨架代码片段")
    parser.add_argument("--name", required=True, help="对象基名，例如 DHCPConfig")
    parser.add_argument("--cmd-macro", required=True, help="命令宏，例如 SNMP_DHCP_CONFIG")
    parser.add_argument("--cmd-id", required=True, type=int, help="命令号，例如 75")
    parser.add_argument("--member", required=True, help="Snmp_Bms_Para_Type 中的成员名")
    parser.add_argument("--struct", required=True, help="结构体类型名，例如 Snmp_DHCP_Config_Type")
    parser.add_argument("--func-base", default="", help="函数基名，例如 DHCP_Config 或 Native_IP")
    parser.add_argument("--mib-name", default="", help="MIB 对象名，例如 DHCPConfig")
    parser.add_argument("--access", choices=["read-only", "read-write"], default="read-write")
    parser.add_argument("--fields", default="", help="字段列表，例如 enable:uint8_t,state:uint8_t")
    parser.add_argument("--format", default="%d", help="String_Xxx 使用的 snprintf 格式串")
    parser.add_argument("--exprs", default="", help="与 format 对应的表达式列表，用逗号分隔")
    parser.add_argument("--mib-description", default="", help="可选，MIB 描述")
    args = parser.parse_args()

    fields = parse_fields(args.fields)
    exprs = parse_exprs(args.exprs)
    func_base = args.func_base or args.name
    mib_name = args.mib_name or to_lower_camel(args.name)

    print("/* ===== 头文件宏 ===== */")
    print(f"#define {args.cmd_macro} {args.cmd_id}")
    print()

    if fields:
        print("/* ===== 结构体定义 ===== */")
        print(build_struct(fields, args.struct))
        print()

    print("/* ===== Snmp_Bms_Para_Type 成员 ===== */")
    print(build_member(args.struct, args.member))
    print()

    print("/* ===== 函数声明 ===== */")
    print(build_prototypes(func_base, args.access))
    print()

    print("/* ===== Get ===== */")
    print(build_get(func_base, args.member, fields))
    print()

    print("/* ===== String ===== */")
    print(build_string(func_base, args.member, args.format, exprs))
    print()

    if args.access == "read-write":
        print("/* ===== Cut ===== */")
        print(build_cut(func_base, args.member, fields))
        print()

        print("/* ===== Set ===== */")
        print(build_set(func_base, args.member, fields))
        print()

    print("/* ===== 分发表 ===== */")
    print(build_dispatch(args.cmd_macro, func_base, args.access))
    print()

    print("/* ===== MIB 片段 ===== */")
    print(build_mib(mib_name, args.cmd_id, args.access, args.mib_description))


if __name__ == "__main__":
    main()
