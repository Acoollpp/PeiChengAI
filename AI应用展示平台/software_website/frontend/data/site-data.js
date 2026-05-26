window.siteData = {
  projects: [
    {
      title: "企业知识问答 Agent",
      status: "knowledge",
      statusText: "知识库",
      stage: "已上线",
      type: "知识问答",
      description:
        "面向制度、项目资料、技术文档的统一问答入口，支持来源追溯、权限隔离和多轮追问。",
      department: "研发 / 运营 / 职能",
      result: "减少重复咨询，提升资料检索效率",
    },
    {
      title: "流程处理 Agent",
      status: "skills",
      statusText: "Skills 库",
      stage: "试点中",
      type: "流程自动化",
      description:
        "围绕审批、工单、会议纪要和待办跟进，完成跨系统信息整理和流程节点提醒。",
      department: "项目 / 交付 / 运营",
      result: "试点部门反馈收集中",
    },
    {
      title: "OpenClaw 驱动钉钉协同办公",
      status: "platform",
      statusText: "智能体应用平台",
      stage: "已上线",
      type: "协同办公",
      description:
        "基于 OpenClaw 智能体能力连接钉钉办公场景，支持消息理解、任务流转、事项跟进和跨系统协同，帮助团队减少重复沟通并提升日常办公处理效率。",
      department: "软件部 / 项目团队 / 职能协作",
      result: "提供统一协同入口，支撑钉钉内任务处理与办公流程联动",
      docLink: "docs/openclaw-dingtalk.html",
      link: "http://172.23.17.169:9181/",
    },
    {
      title: "AI 账号管理平台",
      status: "platform",
      statusText: "智能体应用平台",
      stage: "已上线",
      type: "账号管理",
      description:
        "基于 Claude Code Hub 开源代码建设，集中管理 AI 账号、供应商、限额、用户权限和使用统计，帮助团队统一掌握账号消耗、可用性和分配情况。",
      department: "软件部 / 管理员 / AI 使用团队",
      result: "统一账号资源管理，支撑用量监控、成本统计和权限治理",
      docLink: "docs/ai-account-platform.html",
      link: "http://172.23.17.242:8080/",
    },
    {
      title: "文档生成工作台",
      status: "skills",
      statusText: "Skills 库",
      stage: "开发中",
      type: "文档生成",
      description:
        "沉淀模板、资料和写作规范，支持方案、通知、培训材料和报告初稿生成。",
      department: "市场 / 销售 / 培训",
      result: "原型设计与模板整理中",
    },
  ],
  services: [
    {
      number: "01",
      title: "可定制方向",
      description: "知识问答、流程自动化、数据分析、文档生成、系统集成等。",
    },
    {
      number: "02",
      title: "需求提交",
      description: "填写业务场景、当前痛点、预期目标、涉及系统和联系人。",
    },
    {
      number: "03",
      title: "评估流程",
      description: "软件部进行初步沟通、可行性评估、优先级判断和排期。",
    },
    {
      number: "04",
      title: "交付跟进",
      description: "通过原型试点、反馈优化、上线培训和持续迭代形成闭环。",
    },
  ],
  capabilities: [
    {
      title: "智能体开发",
      description: "Agent 编排 / 工具调用 / 多轮任务",
    },
    {
      title: "知识库问答",
      description: "RAG / 引用溯源 / 权限隔离",
    },
    {
      title: "流程自动化",
      description: "审批 / 工单 / 待办 / 通知",
    },
    {
      title: "安全治理",
      description: "脱敏 / 日志 / 审计 / 访问控制",
    },
  ],
};
