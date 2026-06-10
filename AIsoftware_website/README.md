# AIsoftware_website

## 项目说明

`AIsoftware_website` 是软件部 AI 应用展示平台的网站项目，用于在公司内网集中展示 AI 应用、智能体应用、Skills 能力、使用文档和需求对接入口。

平台采用静态前端方式建设，页面内容主要通过 `frontend/data/site-data.js` 和 `frontend/data/platform-urls.js` 统一维护，便于后续新增应用、更新 Skill 信息和调整平台访问地址。

## 目录结构

```text
AIsoftware_website/
├─ frontend/                    # 网站前端页面和静态资源
│  ├─ index.html                # 首页
│  ├─ platform.html             # 智能体应用页面
│  ├─ skills.html               # Skills 库页面
│  ├─ skill-detail.html         # Skill 详情页面
│  ├─ contact.html              # 需求对接页面
│  ├─ data/                     # 应用、Skills 和平台地址配置
│  ├─ docs/                     # 各智能体应用使用文档
│  └─ assets/                   # 图片、截图、名片等静态资源
│
├─ tests/                       # 页面内容和数据校验脚本
├─ start-mac-preview.sh         # 本地预览脚本
└─ README.md                    # 项目说明
```

## 本地预览

在项目目录下执行：

```bash
./start-mac-preview.sh
```

也可以直接进入 `frontend` 目录，通过静态服务预览页面。

## 内容维护

常用维护文件：

| 文件 | 说明 |
| --- | --- |
| `frontend/data/site-data.js` | 维护智能体应用、Skills、需求流程等展示数据 |
| `frontend/data/platform-urls.js` | 维护 AI 应用中心、API 管理平台、Openclaw、GPT 账号管理等访问地址 |
| `frontend/docs/*.html` | 维护各智能体应用的使用文档页面 |
| `frontend/assets/` | 存放页面图片、平台截图和联系人名片等资源 |

## 跨电脑使用

该项目是静态网站。换到其他电脑后，拉取仓库并进入项目目录：

```bash
cd AIsoftware_website
./start-mac-preview.sh
```

即可通过本地浏览器访问网站。

如果不需要脚本，也可以直接打开 `frontend/index.html`，或在 `frontend` 目录下使用任意静态文件服务。

## 注意事项

- 不提交运行日志、系统缓存文件、大型安装包和本机专用发布服务配置。
- 如需更新平台访问地址，优先修改 `frontend/data/platform-urls.js`。
- 如需新增智能体应用，需同步补充应用数据、访问入口和使用文档。
- 修改页面后建议运行 `tests/` 下相关校验脚本。
