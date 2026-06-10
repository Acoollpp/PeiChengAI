(function () {
  var data = window.siteData || {
    recentUpdates: [],
    efficiencyTools: [],
    projects: [],
    services: [],
  };

  var statusClassMap = {
    knowledge: "knowledge",
    skills: "skills",
    platform: "platform",
  };

  var localSkillPackages = {
    "通用-svn拉取": "通用-svn拉取.zip",
    "通用-项目资料获取": "通用-项目资料获取.zip",
    "通用-SOP文档编写": "通用-sop文档编写.zip",
    "通用-钉钉文档编写": "通用-钉钉文档编写.zip",
    "户用-协议文档识别": "户用-协议文档识别.zip",
    "户用-CAN协议生成": "户用-CAN协议生成.zip",
    "户用-485协议生成": "户用-485协议生成.zip",
    "户用-协议移植": "户用-协议移植.zip",
    "动力-CAN协议生成": "动力-CAN协议生成.zip",
    "基站-DHCP移植指导": "基站-DHCP移植指导.zip",
    "基站-MIB新增": "基站-MIB新增.zip",
    "基站-snmp协议移植": "基站-snmp协议移植.zip",
    "天线-4g电摩通用": "天线-4g电摩通用.zip",
    "天线-git默认文件": "天线-git默认文件.zip",
    "通用-代码变更审查": "通用-代码变更审查.zip",
    "户用-自检修复": "户用-自检修复.zip",
  };

  var superpowerSkills = {
    "brainstorming（头脑风暴）": {
      slug: "brainstorming",
      officialUrl: "https://github.com/obra/superpowers/tree/main/skills/brainstorming",
      feature:
        "用于在实施前澄清目标、约束、方案和验收标准，先形成设计共识，再进入计划和开发。",
    },
    "writing-plans（任务拆解）": {
      slug: "writing-plans",
      officialUrl: "https://github.com/obra/superpowers/tree/main/skills/writing-plans",
      feature:
        "用于把已确认的需求拆成可执行实施计划，明确文件、步骤、测试命令和交付检查点。",
    },
    "dispatching-parallel-agents（并行执行）": {
      slug: "dispatching-parallel-agents",
      officialUrl: "https://github.com/obra/superpowers/tree/main/skills/dispatching-parallel-agents",
      feature:
        "用于多个独立任务或问题可并行推进时，把任务分派给隔离上下文的子代理以节省等待时间。",
    },
    "subagent-driven-development（自动执行计划）": {
      slug: "subagent-driven-development",
      officialUrl: "https://github.com/obra/superpowers/tree/main/skills/subagent-driven-development",
      feature:
        "用于按实施计划逐项执行，每个任务由独立子代理完成，并经过规格符合性和代码质量两轮检查。",
    },
    "requesting-code-review（主动发起审查）": {
      slug: "requesting-code-review",
      officialUrl: "https://github.com/obra/superpowers/tree/main/skills/requesting-code-review",
      feature:
        "用于功能完成或合并前主动请求代码审查，提前识别需求偏差、风险和测试遗漏。",
    },
    "receiving-code-review（处理审查意见）": {
      slug: "receiving-code-review",
      officialUrl: "https://github.com/obra/superpowers/tree/main/skills/receiving-code-review",
      feature:
        "用于收到审查意见后先理解、验证再处理，避免未经判断就盲目修改代码。",
    },
    "systematic-debugging（系统化排Bug）": {
      slug: "systematic-debugging",
      officialUrl: "https://github.com/obra/superpowers/tree/main/skills/systematic-debugging",
      feature:
        "用于遇到 Bug、测试失败或异常行为时，先复现并定位根因，再制定修复方案。",
    },
    "verification-before-completion（完成前必验证）": {
      slug: "verification-before-completion",
      officialUrl: "https://github.com/obra/superpowers/tree/main/skills/verification-before-completion",
      feature:
        "用于交付前执行真实验证命令，用结果证明功能、测试或修复确实完成。",
    },
    "test-driven-development（先测试后编码）": {
      slug: "test-driven-development",
      officialUrl: "https://github.com/obra/superpowers/tree/main/skills/test-driven-development",
      feature:
        "用于新增功能、修复或重构时先写失败测试，再写最小实现并保持红绿重构节奏。",
    },
  };

  var githubOpenSkills = {
    "ppt-master（PPT生成）": {
      officialUrl: "https://github.com/hugohe3/ppt-master",
      sourceLabel: "GitHub 开源",
      kicker: "GitHub 开源 Skill",
      actionLabel: "查看项目仓库",
      feature: "基于文本内容生成可编辑 PPTX 初稿，辅助快速搭建汇报材料结构。",
      usageNotice:
        "该 Skill 只能作为初稿参考，生成内容仍需人工调整、排版润色和业务复核后再正式使用。",
      installLead:
        '该 Skill 来源于 GitHub 开源项目：<a href="https://github.com/hugohe3/ppt-master" target="_blank" rel="noopener noreferrer">hugohe3/ppt-master</a>，可先查看项目仓库了解安装、运行和使用方式。',
    },
  };

  var statusOrder = ["已上线", "试点中", "开发中", "规划中"];

  function slugify(value) {
    return encodeURIComponent(String(value || "").trim());
  }

  function getSkillPackageName(item) {
    return item.packageName || localSkillPackages[item.title] || "";
  }

  function getSkillPackageUrl(item, prefix) {
    var packageName = getSkillPackageName(item);
    return packageName ? (prefix || "") + "assets/skill-packages/" + packageName : "";
  }

  function getSuperpowerInfo(item) {
    return superpowerSkills[item.title] || null;
  }

  function getGithubOpenInfo(item) {
    return githubOpenSkills[item.title] || null;
  }

  function getStatusClass(status) {
    return statusClassMap[status] || "";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function hydratePlatformUrls() {
    var urls = window.platformUrls || {};

    Array.prototype.slice.call(document.querySelectorAll("[data-platform-url]")).forEach(function (element) {
      var key = element.getAttribute("data-platform-url");
      var url = urls[key];
      var label = element.getAttribute("data-platform-url-label");

      if (!url) {
        return;
      }

      if (element.tagName && element.tagName.toLowerCase() === "a") {
        element.setAttribute("href", url);
      }

      if (label === "url") {
        element.textContent = url;
      }
    });
  }

  function getProjectsByStatus(status) {
    return data.projects.filter(function (item) {
      return item.status === status;
    });
  }

  function getHomePlatformItems(items) {
    var preferredTitles = ["API 管理平台", "代码审查平台"];
    var preferred = [];

    preferredTitles.forEach(function (title) {
      var item = items.find(function (project) {
        return project.title === title;
      });
      if (item) {
        preferred.push(item);
      }
    });

    return preferred.length ? preferred : items.slice(0, 2);
  }

  function getUniqueCategories(items) {
    var seen = {};
    var categories = [];

    items.forEach(function (item) {
      var category = item.category || item.type || "其他";
      if (!seen[category]) {
        seen[category] = true;
        categories.push(category);
      }
    });

    return categories;
  }

  function getStatusSummary(items) {
    return statusOrder
      .map(function (stage) {
        return {
          label: stage,
          count: items.filter(function (item) {
            return item.stage === stage;
          }).length,
        };
      })
      .filter(function (item) {
        return item.count > 0;
      });
  }

  function buildActions(item, status) {
    var actionsHtml = "";
    var primaryLabel = status === "platform" ? "访问平台" : "查看详情";
    var hasSplitLinks = item.links && item.links.length;

    if (item.link || item.docLink) {
      actionsHtml = '<div class="project-actions' + (hasSplitLinks ? " split-actions" : "") + '">';

      if (hasSplitLinks) {
        actionsHtml += '<div class="project-action-group" aria-label="' + escapeHtml(item.title) + '访问入口">';
        item.links.forEach(function (linkItem) {
          actionsHtml +=
            '<a href="' +
            escapeHtml(linkItem.url) +
            '" class="project-action-button" target="_blank" rel="noopener noreferrer">' +
            escapeHtml(linkItem.label) +
            "</a>";
        });
        actionsHtml += "</div>";
      } else if (item.link) {
        actionsHtml +=
          '<a href="' +
          escapeHtml(item.link) +
          '" target="_blank" rel="noopener noreferrer">' +
          primaryLabel +
          "</a>";
      }

      if (item.docLink) {
        actionsHtml +=
          '<a href="' +
          escapeHtml(item.docLink) +
          '" class="' +
          (hasSplitLinks ? "project-doc-link" : "") +
          '" target="_blank" rel="noopener noreferrer">使用文档</a>';
      }

      actionsHtml += "</div>";
    }

    return actionsHtml;
  }

  function buildTags(item) {
    var tags = item.tags || [];
    if (!tags.length) {
      return "";
    }

    return (
      '<div class="asset-meta">' +
      tags
        .slice(0, 4)
        .map(function (tag) {
          return "<span>" + escapeHtml(tag) + "</span>";
        })
        .join("") +
      "</div>"
    );
  }

  function buildSkillTitle(title) {
    var titleText = String(title || "");
    var match = titleText.match(/^(.*?)(（[^）]+）)$/);

    if (!match) {
      return '<span class="skill-title-main">' + escapeHtml(titleText) + "</span>";
    }

    return (
      '<span class="skill-title-main">' +
      escapeHtml(match[1]) +
      "</span>" +
      '<span class="skill-title-paren">' +
      escapeHtml(match[2]) +
      "</span>"
    );
  }

  function buildProjectCard(item, status) {
    var filterValue = status === "platform" ? item.stage : item.category || item.type || "其他";
    var searchText = [
      item.title,
      item.stage,
      item.type,
      item.category,
      item.description,
      item.department,
      item.owner,
      item.result,
      (item.tags || []).join(" "),
    ]
      .join(" ")
      .toLowerCase();

    return (
      '<article class="project-card directory-card" data-category="' +
      escapeHtml(filterValue) +
      '" data-search="' +
      escapeHtml(searchText) +
      '">' +
      '<div class="card-meta">' +
      '<span class="tag ' +
      getStatusClass(item.status) +
      '">' +
      escapeHtml(item.statusText) +
      "</span>" +
      '<span class="stage">' +
      escapeHtml(item.stage) +
      "</span>" +
      "</div>" +
      "<h3>" +
      escapeHtml(item.title) +
      "</h3>" +
      buildActions(item, status) +
      "<p>" +
      escapeHtml(item.description) +
      "</p>" +
      '<div class="card-entry">' +
      escapeHtml(item.entry || item.result || "适合需要复用 AI 能力的业务场景") +
      "</div>" +
      buildTags(item) +
      "<dl>" +
      "<div><dt>适用部门</dt><dd>" +
      escapeHtml(item.department) +
      "</dd></div>" +
      "<div><dt>当前产出</dt><dd>" +
      escapeHtml(item.result) +
      "</dd></div>" +
      "</dl>" +
      "</article>"
    );
  }

  function buildSkillMarketCard(item) {
    var category = item.category || item.type || "其他";
    var packageName = getSkillPackageName(item);
    var isLocalPackage = !!packageName;
    var superpowerInfo = getSuperpowerInfo(item);
    var githubOpenInfo = getGithubOpenInfo(item);
    var detailUrl = "skill-detail.html?skill=" + slugify(item.title);
    var searchText = [
      item.title,
      item.stage,
      item.type,
      category,
      item.version,
      item.purpose,
      item.description,
      item.department,
      item.users,
      item.owner,
      item.result,
      item.entry,
      (item.tags || []).join(" "),
    ]
      .join(" ")
      .toLowerCase();
    var stage = item.stage || "已上线";
    var sourceLabel = isLocalPackage
      ? "本地安装包"
      : githubOpenInfo
        ? githubOpenInfo.sourceLabel
        : superpowerInfo
          ? "Superpowers 官方"
          : "Superpowers";

    return (
      '<a href="' +
      escapeHtml(detailUrl) +
      '" class="skill-market-card project-card ' +
      (isLocalPackage ? "is-downloadable" : "is-reference-only") +
      '" data-category="' +
      escapeHtml(category) +
      '" data-search="' +
      escapeHtml(searchText) +
      '">' +
      '<div class="skill-card-head">' +
      "<h3>" +
      '<span class="skill-title-category">' +
      escapeHtml(category) +
      "</span>" +
      buildSkillTitle(item.title) +
      "</h3>" +
      '<div class="skill-card-meta">' +
      '<span class="skill-version">v' +
      escapeHtml(item.version || "1.0") +
      "</span>" +
      '<span class="skill-state ' +
      (stage === "已上线" ? "verified" : "") +
      '">' +
      escapeHtml(stage) +
      "</span>" +
      '<span class="skill-purpose">' +
      escapeHtml(item.purpose || item.type || "能力复用") +
      "</span>" +
      "</div>" +
      "</div>" +
      "<p>" +
      escapeHtml(item.description) +
      "</p>" +
      '<div class="skill-card-foot">' +
      '<span class="skill-source-badge">' +
      escapeHtml(sourceLabel) +
      "</span>" +
      '<span class="skill-download-text">' +
      (isLocalPackage ? "查看安装教程" : "查看使用说明") +
      "</span>" +
      "</div>" +
      "</a>"
    );
  }

  function buildToolCard(item, isCompact) {
    var tags = item.tags || [];
    var searchText = [
      item.title,
      item.category,
      item.stage,
      item.format,
      item.description,
      item.users,
      item.usage,
      tags.join(" "),
    ]
      .join(" ")
      .toLowerCase();
    var toolAction = item.toolUrl
      ? '<a href="' + escapeHtml(item.toolUrl) + '" download>工具链接</a>'
      : '<span class="tool-action-disabled">工具链接待补充</span>';
    var docAction = item.docUrl
      ? '<a href="' + escapeHtml(item.docUrl) + '">使用文档</a>'
      : '<span class="tool-action-disabled">使用文档待补充</span>';

    return (
      '<article class="tool-card' +
      (isCompact ? " is-compact" : "") +
      '" data-category="' +
      escapeHtml(item.category || "其他") +
      '" data-search="' +
      escapeHtml(searchText) +
      '">' +
      '<div class="tool-card-rail" aria-hidden="true"></div>' +
      '<div class="tool-card-head">' +
      '<span class="tool-category">' +
      escapeHtml(item.category || "提效工具") +
      "</span>" +
      '<span class="tool-stage ' +
      (item.stage === "已上线" ? "verified" : "") +
      '">' +
      escapeHtml(item.stage || "规划中") +
      "</span>" +
      "</div>" +
      "<h3>" +
      escapeHtml(item.title) +
      "</h3>" +
      "<p>" +
      escapeHtml(item.description) +
      "</p>" +
      '<div class="tool-usage">' +
      escapeHtml(item.usage || "按工具说明使用。") +
      "</div>" +
      '<div class="tool-meta">' +
      '<span>格式：' +
      escapeHtml(item.format || "工具包") +
      "</span>" +
      '<span>适用：' +
      escapeHtml(item.users || "内部同事") +
      "</span>" +
      "</div>" +
      '<div class="tool-tags">' +
      tags
        .slice(0, 3)
        .map(function (tag) {
          return "<span>" + escapeHtml(tag) + "</span>";
        })
        .join("") +
      "</div>" +
      '<div class="tool-card-actions">' +
      '<div class="tool-action-group">' +
      toolAction +
      docAction +
      "</div>" +
      "</div>" +
      "</article>"
    );
  }

  function isDownloadUrl(url) {
    var normalized = String(url || "").split("?")[0].split("#")[0].toLowerCase();
    return normalized.endsWith(".rar") || normalized.endsWith(".zip");
  }

  function buildUpdateAction(url, label) {
    if (!url) {
      return "";
    }

    return (
      '<a href="' +
      escapeHtml(url) +
      '"' +
      (isDownloadUrl(url) ? " download" : "") +
      (isDownloadUrl(url) ? "" : ' target="_blank" rel="noopener noreferrer"') +
      ">" +
      escapeHtml(label || "查看") +
      "</a>"
    );
  }

  function buildRecentUpdateItem(item) {
    return (
      '<article class="update-ledger-item">' +
      '<div class="update-date">' +
      '<span>' +
      escapeHtml(item.date) +
      "</span>" +
      '<strong>' +
      escapeHtml(item.type || "文件") +
      "</strong>" +
      "</div>" +
      '<div class="update-main">' +
      '<div class="update-title-row">' +
      "<h3>" +
      escapeHtml(item.title) +
      "</h3>" +
      '<span class="update-version">' +
      escapeHtml(item.version || "当前版本") +
      "</span>" +
      "</div>" +
      "<p>" +
      escapeHtml(item.summary) +
      "</p>" +
      '<div class="update-actions">' +
      buildUpdateAction(item.fileUrl, item.fileLabel) +
      buildUpdateAction(item.docUrl, item.docLabel) +
      "</div>" +
      "</div>" +
      "</article>"
    );
  }

  function renderRecentUpdates() {
    var container = document.querySelector("#recentUpdatesList");
    var count = document.querySelector("#recentUpdatesCount");
    var items = (data.recentUpdates || []).slice(0, 10);

    if (!container) {
      return;
    }

    container.innerHTML = items.map(buildRecentUpdateItem).join("");

    if (count) {
      count.textContent = items.length + " 条更新";
    }
  }

  function getCurrentSkill() {
    var params;
    var skillTitle;
    var items = data.skillsCatalog || [];

    if (typeof URLSearchParams === "undefined" || !window.location) {
      return null;
    }

    params = new URLSearchParams(window.location.search);
    skillTitle = params.get("skill");

    if (!skillTitle) {
      return null;
    }

    return (
      items.find(function (item) {
        return item.title === skillTitle;
      }) || null
    );
  }

  function renderSkillDetail() {
    var container = document.querySelector("#skillDetail");
    var headerTitle = document.querySelector("#skillDetailTitle");
    var navTitle = document.querySelector("#skillDetailNavTitle");
    var pageTitle = document.querySelector("title");
    var skill = getCurrentSkill();
    var packageName;
    var packageUrl;
    var superpowerInfo;
    var githubOpenInfo;
    var isSuperpower;
    var detailSource;
    var actionUrl;
    var actionLabel;
    var featureText;
    var installIntro;

    if (!container) {
      return;
    }

    if (!skill) {
      container.innerHTML =
        '<section class="docs-hero">' +
        '<p class="section-kicker">未找到 Skill</p>' +
        "<h1>Skill 不存在或已下线</h1>" +
        "<p>请返回 Skills 库重新选择需要查看的 Skill。</p>" +
        '<div class="doc-action-row"><a class="button secondary" href="skills.html">返回 Skills 库</a></div>' +
        "</section>";
      return;
    }

    packageName = getSkillPackageName(skill);
    packageUrl = getSkillPackageUrl(skill, "");
    superpowerInfo = getSuperpowerInfo(skill);
    githubOpenInfo = getGithubOpenInfo(skill);
    isSuperpower = !packageName && !!superpowerInfo;
    detailSource = packageName
      ? "公司内部开发 Skill"
      : githubOpenInfo
        ? githubOpenInfo.kicker
        : "Superpowers 官方 Skill";
    actionUrl = githubOpenInfo
      ? githubOpenInfo.officialUrl
      : superpowerInfo
        ? superpowerInfo.officialUrl
        : "https://github.com/obra/superpowers";
    actionLabel = githubOpenInfo ? githubOpenInfo.actionLabel : "访问官方来源";
    featureText = githubOpenInfo
      ? githubOpenInfo.feature
      : isSuperpower
        ? superpowerInfo.feature
        : skill.purpose || "能力复用";
    installIntro = githubOpenInfo
      ? githubOpenInfo.installLead
      : '该 Skill 来源于 Superpowers 官方仓库：<a href="https://github.com/obra/superpowers" target="_blank" rel="noopener noreferrer">下载完整仓库</a>，也可以<a href="' +
        escapeHtml(superpowerInfo ? superpowerInfo.officialUrl : "https://github.com/obra/superpowers") +
        '" target="_blank" rel="noopener noreferrer">查看当前 Skill 页面</a>。';

    if (headerTitle) {
      headerTitle.textContent = skill.title + " 使用说明";
    }
    if (navTitle) {
      navTitle.textContent = skill.title;
    }
    if (pageTitle) {
      pageTitle.textContent = skill.title + " 使用说明";
    }

    container.innerHTML =
      '<section class="docs-hero" id="overview">' +
      '<p class="section-kicker">' +
      escapeHtml(detailSource) +
      "</p>" +
      "<h1>" +
      escapeHtml(skill.title) +
      "</h1>" +
      (githubOpenInfo
        ? '<div class="doc-callout warning"><strong>使用提示</strong><p>' +
          escapeHtml(githubOpenInfo.usageNotice) +
          "</p></div>"
        : "") +
      "<p>" +
      escapeHtml(skill.description) +
      "</p>" +
      '<div class="doc-action-row">' +
      (packageUrl
        ? '<a class="button primary" href="' +
          escapeHtml(packageUrl) +
          '" download="' +
          escapeHtml(packageName) +
          '">下载安装包</a>'
        : '<a class="button primary" href="' +
          escapeHtml(actionUrl) +
          '" target="_blank" rel="noopener noreferrer">' +
          escapeHtml(actionLabel) +
          "</a>") +
      '<a class="button secondary" href="skills.html">返回 Skills 库</a>' +
      "</div>" +
      "</section>" +
      '<section class="doc-grid-3" id="features" aria-label="功能概览">' +
      '<article><span>01</span><strong>能力定位</strong><p>' +
      escapeHtml(featureText) +
      "</p></article>" +
      '<article><span>02</span><strong>适用对象</strong><p>' +
      escapeHtml(skill.users || "公司内部相关团队") +
      "</p></article>" +
      '<article><span>03</span><strong>所属分类</strong><p>' +
      escapeHtml(skill.category || "通用") +
      " / v" +
      escapeHtml(skill.version || "1.0") +
      "</p></article>" +
      "</section>" +
      '<section id="install">' +
      "<h2>安装教程</h2>" +
      '<div class="doc-callout">' +
      "<strong>安装包</strong>" +
      "<p>" +
      (packageName
        ? '当前安装包：<a href="' +
          escapeHtml(packageUrl) +
          '" download="' +
          escapeHtml(packageName) +
          '">' +
          escapeHtml(packageName) +
          "</a>。"
        : installIntro) +
      "</p>" +
      "</div>" +
      '<div class="doc-flow">' +
      (packageName
        ? '<article><span>1</span><strong>点击下载安装包</strong><p>点击页面上方“下载安装包”按钮，浏览器会下载一个 zip 文件；如果弹出保存位置，建议保存到“下载”文件夹。</p></article>' +
          '<article><span>2</span><strong>解压 zip 文件</strong><p>在下载位置找到 zip 文件并解压，得到一个 Skill 文件夹；打开后应能看到 SKILL.md 文件。</p></article>' +
          '<article><span>3</span><strong>打开本机 Skills 目录</strong><p><span class="path-line">Mac 用户：<code>~/.codex/skills/</code></span><span class="path-line">Windows 用户：<code>C:\\Users\\你的用户名\\.codex\\skills</code></span><span class="path-line">没有 skills 文件夹就新建一个。</span></p></article>' +
          '<article><span>4</span><strong>复制 Skill 文件夹</strong><p>把解压出来的整个 Skill 文件夹复制到 skills 目录下，不要只复制 SKILL.md，也不要改动内部 references、scripts、assets、agents 等目录。</p></article>' +
          '<article><span>5</span><strong>重启并使用 Skill</strong><p>关闭并重新打开 Codex。使用时在对话框输入 /，再输入英文 Skill 名称进行选择，例如 /writing-plans；如果未出现，检查 Skill 文件夹是否直接放在 skills 目录下。</p></article>'
        : '<article><span>1</span><strong>下载官方仓库</strong><p>打开 Superpowers 官方仓库，点击 Code，再选择 Download ZIP 下载源码包。</p></article>' +
          '<article><span>2</span><strong>找到 Skill 目录</strong><p>解压后进入 superpowers-main/skills，找到当前页面对应的 Skill 文件夹，例如 ' +
          escapeHtml(superpowerInfo ? superpowerInfo.slug : "writing-plans") +
          '。</p></article>' +
          '<article><span>3</span><strong>复制到本机 Skills 目录</strong><p><span class="path-line">Mac 用户：<code>~/.codex/skills/</code></span><span class="path-line">Windows 用户：<code>C:\\Users\\你的用户名\\.codex\\skills</code></span><span class="path-line">没有 skills 文件夹就新建一个。</span></p></article>' +
          '<article><span>4</span><strong>重启并使用 Skill</strong><p>关闭并重新打开 Codex。使用时在对话框输入 /，再输入英文 Skill 名称进行选择，例如 /writing-plans；如果未出现，检查 Skill 文件夹是否直接放在 skills 目录下。</p></article>') +
      "</div>" +
      "</section>" +
      '<section id="security">' +
      "<h2>安全说明</h2>" +
      '<div class="doc-table-wrap"><table class="doc-table"><thead><tr><th>事项</th><th>说明</th></tr></thead><tbody>' +
      "<tr><td>使用范围</td><td>仅面向公司内部使用，不上传公开仓库或外部网盘。</td></tr>" +
      "<tr><td>资料安全</td><td>处理协议文档、项目代码、账号信息时，需遵守公司保密要求。</td></tr>" +
      "<tr><td>安装校验</td><td>安装前确认来源为本站下载包，解压后检查是否包含 SKILL.md。</td></tr>" +
      "<tr><td>知识库</td><td>完整规范、常见问题和更新记录见钉钉内部知识库。</td></tr>" +
      "<tr><td>结果复核</td><td>生成代码、配置或文档后，必须由相关负责人复核后再进入项目。</td></tr>" +
      "</tbody></table></div>" +
      "</section>";
  }

  function normalizeWrappedSkillTitles(scope) {
    var root = scope || document;

    Array.prototype.slice.call(root.querySelectorAll(".skill-market-card h3")).forEach(function (titleEl) {
      var paren = titleEl.querySelector(".skill-title-paren");
      var main = titleEl.querySelector(".skill-title-main");
      var category = titleEl.querySelector(".skill-title-category");
      var shouldSplit = false;

      titleEl.classList.remove("skill-title-wrap-paren");

      if (!paren || !main || !category) {
        return;
      }

      if (typeof window !== "undefined" && window.getComputedStyle) {
        var style = window.getComputedStyle(titleEl);
        var lineHeight = parseFloat(style.lineHeight) || 20;
        shouldSplit = titleEl.getBoundingClientRect().height > lineHeight * 1.35;
      } else if (paren.offsetTop > main.offsetTop || main.offsetTop > category.offsetTop) {
        shouldSplit = true;
      }

      if (shouldSplit) {
        titleEl.classList.add("skill-title-wrap-paren");
      }
    });
  }

  function equalizeSkillCardHeights(scope) {
    var root = scope || document;
    var cards = Array.prototype.slice.call(root.querySelectorAll(".skill-market-card"));
    var maxHeight = 0;

    cards.forEach(function (card) {
      card.style.minHeight = "";
    });

    cards.forEach(function (card) {
      maxHeight = Math.max(maxHeight, Math.ceil(card.getBoundingClientRect().height));
    });

    cards.forEach(function (card) {
      card.style.minHeight = maxHeight + "px";
    });
  }

  function buildPlatformFeatureCard(item, index) {
    return (
      '<article class="platform-feature is-secondary">' +
      '<div class="platform-feature-head">' +
      '<span class="stage">' +
      escapeHtml(item.stage) +
      "</span>" +
      '<span class="platform-type">' +
      escapeHtml(item.category || item.type || "平台应用") +
      "</span>" +
      "</div>" +
      "<h3>" +
      escapeHtml(item.title) +
      "</h3>" +
      "<p>" +
      escapeHtml(item.description) +
      "</p>" +
      '<div class="platform-feature-meta">' +
      "<span>" +
      escapeHtml(item.department) +
      "</span>" +
      "<span>" +
      escapeHtml(item.result) +
      "</span>" +
      "</div>" +
      buildActions(item, "platform") +
      "</article>"
    );
  }

  function buildPlatformVisualCarousel() {
    var slides = [
      {
        label: "AI 应用落地",
        title: "让 AI 应用真正落地",
        detail: "从想法到可用系统，一站式构建。",
        image: "assets/ai-home-landing.png",
      },
      {
        label: "智能体协同",
        title: "智能体协同自动化",
        detail: "让任务自动流转，让结果自动产生。",
        image: "assets/ai-home-agent.png",
      },
      {
        label: "业务增长",
        title: "AI 驱动业务增长",
        detail: "把数据、流程和团队连接起来。",
        image: "assets/ai-home-growth.png",
      },
    ];

    return (
      '<article class="platform-visual-card">' +
      '<div class="platform-carousel visual-only" data-carousel>' +
      '<div class="carousel-slides">' +
      slides
        .map(function (slide, slideIndex) {
          return (
            '<div class="carousel-slide visual-slide visual-' +
            slideIndex +
            " " +
            (slideIndex === 0 ? "active" : "") +
            '" data-slide="' +
            slideIndex +
            '">' +
            '<img src="' +
            escapeHtml(slide.image) +
            '" alt="' +
            escapeHtml(slide.title + "：" + slide.detail) +
            '" loading="' +
            (slideIndex === 0 ? "eager" : "lazy") +
            '" />' +
            "</div>"
          );
        })
        .join("") +
      "</div>" +
      '<div class="carousel-dots visual-carousel-controls">' +
      slides
        .map(function (_, slideIndex) {
          return (
            '<button type="button" class="' +
            (slideIndex === 0 ? "active" : "") +
            '" data-carousel-dot="' +
            slideIndex +
            '" aria-label="查看第 ' +
            (slideIndex + 1) +
            ' 张示意图"></button>'
          );
        })
        .join("") +
      "</div>" +
      "</div>" +
      "</article>"
    );
  }

  function buildSkillTableRow(item) {
    return (
      "<tr>" +
      '<td><span class="skill-module">' +
      escapeHtml(item.module || item.category || "通用") +
      "</span></td>" +
      "<td><strong>" +
      escapeHtml(item.title) +
      "</strong></td>" +
      "<td>" +
      escapeHtml(item.description) +
      "</td>" +
      '<td><span class="skill-state ' +
      (item.stage === "已上线" ? "verified" : "") +
      '">' +
      escapeHtml(item.stage) +
      "</span></td>" +
      "</tr>"
    );
  }

  function buildSkillOverviewCard(item) {
    var category = item.category || item.module || "通用";
    var stage = item.stage || "已上线";

    return (
      '<article class="skill-overview-card">' +
      '<span class="skill-module">' +
      escapeHtml(category) +
      "</span>" +
      "<h3>" +
      escapeHtml(item.title) +
      "</h3>" +
      "<p>" +
      escapeHtml(item.entry || item.description || item.purpose || "可复用 AI 能力") +
      "</p>" +
      '<strong class="skill-state ' +
      (stage === "已上线" ? "verified" : "") +
      '">' +
      escapeHtml(stage) +
      "</strong>" +
      "</article>"
    );
  }

  function renderProjectList(gridId, status, limit) {
    var projectGrid = document.querySelector(gridId);
    var countEl = document.querySelector(status === "platform" ? "#platformCount" : "#skillsCount");
    var html = "";
    var isIndexPage = !!document.querySelector(".hero");
    var items = status === "skills" && data.skillsCatalog ? data.skillsCatalog : getProjectsByStatus(status);
    var renderedItems = isIndexPage && status === "platform" ? getHomePlatformItems(items) : limit ? items.slice(0, limit) : items;

    if (!projectGrid) {
      return;
    }

    if (isIndexPage && status === "platform") {
      html += buildPlatformVisualCarousel();
      renderedItems.forEach(function (item, index) {
        html += buildPlatformFeatureCard(item, index);
      });
    } else if (isIndexPage && status === "skills") {
      renderedItems.forEach(function (item) {
        html += buildSkillOverviewCard(item);
      });
    } else {
      renderedItems.forEach(function (item) {
        html += status === "skills" ? buildSkillMarketCard(item) : buildProjectCard(item, status);
      });
    }

    projectGrid.innerHTML = html;
    if (countEl) {
      countEl.innerHTML = items.length + " 项";
    }
  }

  function getSkillsPerPage() {
    var width = window.innerWidth || 1180;

    if (width >= 900) {
      return 12;
    }

    if (width >= 640) {
      return 8;
    }

    return 4;
  }

  function renderSkillPagination(pagination, currentPage, pageCount, totalCount, pageItemsCount) {
    var html = "";
    var pageIndex;

    if (!pagination) {
      return;
    }

    if (!totalCount) {
      pagination.innerHTML = "";
      return;
    }

    html +=
      '<div class="skill-pagination-summary">第 ' +
      currentPage +
      " / " +
      pageCount +
      " 页 · 本页 " +
      pageItemsCount +
      " 个 · 共 " +
      totalCount +
      " 个 Skill</div>";

    if (pageCount > 1) {
      html += '<div class="skill-pagination-actions">';
      html +=
        '<button type="button" data-skill-page="' +
        Math.max(1, currentPage - 1) +
        '"' +
        (currentPage === 1 ? " disabled" : "") +
        ">上一页</button>";

      for (pageIndex = 1; pageIndex <= pageCount; pageIndex += 1) {
        html +=
          '<button type="button" class="' +
          (pageIndex === currentPage ? "active" : "") +
          '" data-skill-page="' +
          pageIndex +
          '" aria-label="第 ' +
          pageIndex +
          ' 页">' +
          pageIndex +
          "</button>";
      }

      html +=
        '<button type="button" data-skill-page="' +
        Math.min(pageCount, currentPage + 1) +
        '"' +
        (currentPage === pageCount ? " disabled" : "") +
        ">下一页</button>";
      html += "</div>";
    }

    pagination.innerHTML = html;
  }

  function renderPaginatedSkills(gridId, filterId, searchId, emptyId, paginationId) {
    var grid = document.querySelector(gridId);
    var filter = document.querySelector(filterId);
    var search = document.querySelector(searchId);
    var empty = document.querySelector(emptyId);
    var pagination = document.querySelector(paginationId);
    var items = data.skillsCatalog || getProjectsByStatus("skills");
    var activeCategory = "all";
    var keyword = "";
    var currentPage = 1;

    if (!grid) {
      return;
    }

    function getFilteredItems() {
      return items.filter(function (item) {
        var category = item.category || item.type || "其他";
        var searchText = [
          item.title,
          item.stage,
          item.type,
          category,
          item.version,
          item.purpose,
          item.description,
          item.department,
          item.users,
          item.owner,
          item.result,
          item.entry,
          (item.tags || []).join(" "),
        ]
          .join(" ")
          .toLowerCase();
        var matchCategory = activeCategory === "all" || category === activeCategory;
        var matchKeyword = !keyword || searchText.indexOf(keyword) > -1;

        return matchCategory && matchKeyword;
      });
    }

    function render() {
      var perPage = getSkillsPerPage();
      var filteredItems = getFilteredItems();
      var pageCount = Math.max(1, Math.ceil(filteredItems.length / perPage));
      var pageItems;

      currentPage = Math.min(Math.max(1, currentPage), pageCount);
      pageItems = filteredItems.slice((currentPage - 1) * perPage, currentPage * perPage);
      grid.innerHTML = pageItems.map(buildSkillMarketCard).join("");
      normalizeWrappedSkillTitles(grid);
      equalizeSkillCardHeights(grid);

      if (empty) {
        empty.classList.toggle("visible", filteredItems.length === 0);
      }

      renderSkillPagination(pagination, currentPage, pageCount, filteredItems.length, pageItems.length);
    }

    if (filter) {
      filter.addEventListener("click", function (event) {
        var button = event.target.closest("button");
        if (!button) {
          return;
        }

        activeCategory = button.getAttribute("data-filter") || "all";
        currentPage = 1;
        Array.prototype.slice.call(filter.querySelectorAll("button")).forEach(function (item) {
          item.classList.toggle("active", item === button);
        });
        render();
      });
    }

    if (search) {
      search.addEventListener("input", function () {
        keyword = search.value.trim().toLowerCase();
        currentPage = 1;
        render();
      });
    }

    if (pagination) {
      pagination.addEventListener("click", function (event) {
        var button = event.target.closest("button[data-skill-page]");
        var nextPage;

        if (!button || button.disabled) {
          return;
        }

        nextPage = Number(button.getAttribute("data-skill-page"));
        if (!nextPage) {
          return;
        }

        currentPage = nextPage;
        render();
        grid.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("resize", function () {
        normalizeWrappedSkillTitles(grid);
        equalizeSkillCardHeights(grid);
      });
    }

    render();
  }

  function renderStats(containerId, status) {
    var container = document.querySelector(containerId);
    var items = getProjectsByStatus(status);
    var categories = getUniqueCategories(items);
    var liveCount = items.filter(function (item) {
      return item.stage === "已上线";
    }).length;
    var summary = getStatusSummary(items);
    var html = "";

    if (!container) {
      return;
    }

    html +=
      '<article><strong>' +
      items.length +
      '</strong><span>总数</span></article>' +
      '<article><strong>' +
      liveCount +
      '</strong><span>已上线</span></article>' +
      '<article><strong>' +
      categories.length +
      '</strong><span>能力分类</span></article>';

    summary.forEach(function (item) {
      html +=
        '<article class="subtle-stat"><strong>' +
        item.count +
        '</strong><span>' +
        escapeHtml(item.label) +
        "</span></article>";
    });

    container.innerHTML = html;
  }

  function renderFilters(containerId, status) {
    var container = document.querySelector(containerId);
    var isIndexPage = !!document.querySelector(".hero");
    var items = status === "skills" && !isIndexPage && data.skillsCatalog ? data.skillsCatalog : getProjectsByStatus(status);
    var categories = status === "platform" ? ["已上线", "试点中", "开发中"] : getUniqueCategories(items);
    var html = '<button class="filter-chip active" type="button" data-filter="all">全部</button>';

    if (!container) {
      return;
    }

    categories
      .filter(function (category) {
        if (status !== "platform") {
          return true;
        }

        return items.some(function (item) {
          return item.stage === category;
        });
      })
      .forEach(function (category) {
      html +=
        '<button class="filter-chip" type="button" data-filter="' +
        escapeHtml(category) +
        '">' +
        escapeHtml(category) +
        "</button>";
      });

    container.innerHTML = html;
  }

  function bindDirectory(gridId, filterId, searchId, emptyId) {
    var grid = document.querySelector(gridId);
    var filter = document.querySelector(filterId);
    var search = document.querySelector(searchId);
    var empty = document.querySelector(emptyId);
    var activeCategory = "all";
    var keyword = "";

    if (!grid) {
      return;
    }

    function apply() {
      var cards = Array.prototype.slice.call(grid.querySelectorAll(".project-card"));
      var visibleCount = 0;

      cards.forEach(function (card) {
        var matchCategory = activeCategory === "all" || card.getAttribute("data-category") === activeCategory;
        var matchKeyword = !keyword || (card.getAttribute("data-search") || "").indexOf(keyword) > -1;
        var visible = matchCategory && matchKeyword;

        card.classList.toggle("hidden", !visible);
        if (visible) {
          visibleCount += 1;
        }
      });

      if (empty) {
        empty.classList.toggle("visible", visibleCount === 0);
      }
    }

    if (filter) {
      filter.addEventListener("click", function (event) {
        var button = event.target.closest("button");
        if (!button) {
          return;
        }

        activeCategory = button.getAttribute("data-filter") || "all";
        Array.prototype.slice.call(filter.querySelectorAll("button")).forEach(function (item) {
          item.classList.toggle("active", item === button);
        });
        apply();
      });
    }

    if (search) {
      search.addEventListener("input", function () {
        keyword = search.value.trim().toLowerCase();
        apply();
      });
    }

    apply();
  }

  function renderToolFilters(containerId, items) {
    var container = document.querySelector(containerId);
    var categories;
    var html = '<button class="filter-chip active" type="button" data-filter="all">全部</button>';

    if (!container) {
      return;
    }

    categories = getUniqueCategories(items);
    categories.forEach(function (category) {
      html +=
        '<button class="filter-chip" type="button" data-filter="' +
        escapeHtml(category) +
        '">' +
        escapeHtml(category) +
        "</button>";
    });
    container.innerHTML = html;
  }

  function renderEfficiencyTools() {
    var tools = data.efficiencyTools || [];
    var homeGrid = document.querySelector("#toolsHomeGrid");
    var directoryGrid = document.querySelector("#toolsGrid");
    var count = document.querySelector("#toolsCount");

    if (homeGrid) {
      homeGrid.innerHTML = tools
        .slice(0, 3)
        .map(function (item) {
          return buildToolCard(item, true);
        })
        .join("");
    }

    if (directoryGrid) {
      directoryGrid.innerHTML = tools.map(function (item) {
        return buildToolCard(item, false);
      }).join("");
      renderToolFilters("#toolsFilters", tools);
      bindDirectory("#toolsGrid", "#toolsFilters", "#toolsSearch", "#toolsEmpty");
    }

    if (count) {
      count.innerHTML = tools.length + " 个工具";
    }
  }

  function renderSkillsCategoryMap() {
    var container = document.querySelector("#skillsCategoryMap");
    var items = getProjectsByStatus("skills");
    var categories = getUniqueCategories(items);
    var html = "";

    if (!container) {
      return;
    }

    categories.forEach(function (category) {
      var count = items.filter(function (item) {
        return (item.category || item.type || "其他") === category;
      }).length;

      html +=
        '<article><strong>' +
        escapeHtml(category) +
        '</strong><span>' +
        count +
        " 个 Skill</span></article>";
    });

    container.innerHTML = html;
  }

  function renderProjects() {
    var isIndexPage = !!document.querySelector(".hero");
    var isSkillsDirectory = !isIndexPage && !!document.querySelector("#skillsPagination");
    renderProjectList("#platformGrid", "platform", isIndexPage ? 2 : 0);
    if (isSkillsDirectory) {
      renderPaginatedSkills("#skillsGrid", "#skillsFilters", "#skillsSearch", "#skillsEmpty", "#skillsPagination");
    } else {
      renderProjectList("#skillsGrid", "skills", isIndexPage ? 4 : 0);
    }
    renderStats("#platformStats", "platform");
    renderStats("#skillsStats", "skills");
    renderFilters("#platformFilters", "platform");
    renderFilters("#skillsFilters", "skills");
    renderSkillsCategoryMap();
    bindDirectory("#platformGrid", "#platformFilters", "#platformSearch", "#platformEmpty");
    if (!isSkillsDirectory) {
      bindDirectory("#skillsGrid", "#skillsFilters", "#skillsSearch", "#skillsEmpty");
    }
  }

  function bindCarousels() {
    var carousels = Array.prototype.slice.call(document.querySelectorAll("[data-carousel]"));

    carousels.forEach(function (carousel) {
      var slides = Array.prototype.slice.call(carousel.querySelectorAll(".carousel-slide"));
      var dots = Array.prototype.slice.call(carousel.querySelectorAll("[data-carousel-dot]"));
      var activeIndex = 0;

      if (slides.length <= 1) {
        return;
      }

      function show(index) {
        activeIndex = index % slides.length;
        slides.forEach(function (slide, slideIndex) {
          slide.classList.toggle("active", slideIndex === activeIndex);
        });
        dots.forEach(function (dot, dotIndex) {
          dot.classList.toggle("active", dotIndex === activeIndex);
        });
      }

      dots.forEach(function (dot, dotIndex) {
        dot.addEventListener("click", function () {
          show(dotIndex);
        });
      });

      window.setInterval(function () {
        show(activeIndex + 1);
      }, 3800);
    });
  }

  function renderServices() {
    var serviceGrid = document.querySelector("#serviceGrid");
    var html = "";

    if (!serviceGrid) {
      return;
    }

    data.services.forEach(function (item) {
      html +=
        "<article>" +
        "<span>" +
        escapeHtml(item.number) +
        "</span>" +
        "<h3>" +
        escapeHtml(item.title) +
        "</h3>" +
        "<p>" +
        escapeHtml(item.description) +
        "</p>" +
        "</article>";
    });

    serviceGrid.innerHTML = html;
  }

  function isDownloadLink(link) {
    var href = link && link.getAttribute ? link.getAttribute("href") || "" : "";
    var normalized = href.split("?")[0].split("#")[0].toLowerCase();

    return !!(link && (link.hasAttribute("download") || normalized.endsWith(".rar") || normalized.endsWith(".zip")));
  }

  function buildDownloadConfirmModal() {
    var backdrop = document.createElement("div");
    backdrop.className = "download-confirm-backdrop download-confirm-modal";
    backdrop.innerHTML =
      '<div class="download-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="downloadConfirmTitle">' +
      '<h2 id="downloadConfirmTitle">是否下载</h2>' +
      "<p>即将下载所选工具包，请确认是否继续。</p>" +
      '<div class="download-confirm-actions">' +
      '<button type="button" class="download-confirm-cancel">取消</button>' +
      '<button type="button" class="download-confirm-confirm">确认</button>' +
      "</div>" +
      "</div>";
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function triggerConfirmedDownload(sourceLink) {
    var confirmDownloadLink = document.createElement("a");
    confirmDownloadLink.href = sourceLink.href;
    confirmDownloadLink.setAttribute("download", sourceLink.getAttribute("download") || "");
    confirmDownloadLink.setAttribute("data-download-confirmed", "true");
    document.body.appendChild(confirmDownloadLink);
    confirmDownloadLink.click();
    confirmDownloadLink.remove();
  }

  function bindDownloadConfirmations() {
    var activeModal = null;
    var activeLink = null;

    if (!document.addEventListener || !document.body) {
      return;
    }

    document.addEventListener("click", function (event) {
      var link = event.target.closest ? event.target.closest("a") : null;

      if (!link || !isDownloadLink(link) || link.getAttribute("data-download-confirmed") === "true") {
        return;
      }

      event.preventDefault();
      activeLink = link;

      if (!activeModal) {
        activeModal = buildDownloadConfirmModal();
      }

      activeModal.classList.add("visible");
      activeModal.querySelector(".download-confirm-confirm").focus();
    });

    document.addEventListener("click", function (event) {
      if (!activeModal || !activeModal.classList.contains("visible")) {
        return;
      }

      if (event.target.closest(".download-confirm-cancel") || event.target === activeModal) {
        activeModal.classList.remove("visible");
        activeLink = null;
        return;
      }

      if (event.target.closest(".download-confirm-confirm") && activeLink) {
        activeModal.classList.remove("visible");
        triggerConfirmedDownload(activeLink);
        activeLink = null;
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && activeModal && activeModal.classList.contains("visible")) {
        activeModal.classList.remove("visible");
        activeLink = null;
      }
    });
  }

  renderProjects();
  renderRecentUpdates();
  renderEfficiencyTools();
  renderServices();
  renderSkillDetail();
  hydratePlatformUrls();
  bindCarousels();
  bindDownloadConfirmations();
})();
