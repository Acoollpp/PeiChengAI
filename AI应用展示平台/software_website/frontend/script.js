(function () {
  var data = window.siteData || {
    projects: [],
    services: [],
  };

  var statusClassMap = {
    knowledge: "knowledge",
    skills: "skills",
    platform: "platform",
  };

  function getStatusClass(status) {
    return statusClassMap[status] || "";
  }

  function renderProjectList(gridId, status) {
    var projectGrid = document.querySelector(gridId);
    var html = "";

    if (!projectGrid) {
      return;
    }

    data.projects.forEach(function (item) {
      if (item.status !== status) {
        return;
      }

      var actionsHtml = "";

      if (item.link || item.docLink) {
        actionsHtml = '<div class="project-actions">';

        if (item.link) {
          actionsHtml +=
            '<a href="' +
            item.link +
            '" target="_blank" rel="noopener noreferrer">访问平台</a>';
        }

        if (item.docLink) {
          actionsHtml +=
            '<a href="' +
            item.docLink +
            '" target="_blank" rel="noopener noreferrer">使用文档</a>';
        }

        actionsHtml += "</div>";
      }

      html +=
        '<article class="project-card" data-status="' +
        item.status +
        '">' +
        '<div class="card-meta">' +
        '<span class="tag ' +
        getStatusClass(item.status) +
        '">' +
        item.statusText +
        "</span>" +
        '<span class="stage">' +
        item.stage +
        "</span>" +
        "</div>" +
        "<h3>" +
        item.title +
        "</h3>" +
        actionsHtml +
        "<p>" +
        item.description +
        "</p>" +
        "<dl>" +
        "<div><dt>适用部门</dt><dd>" +
        item.department +
        "</dd></div>" +
        "</dl>" +
        "</article>";
    });

    projectGrid.innerHTML = html;
  }

  function renderProjects() {
    renderProjectList("#platformGrid", "platform");
    renderProjectList("#skillsGrid", "skills");
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
        item.number +
        "</span>" +
        "<h3>" +
        item.title +
        "</h3>" +
        "<p>" +
        item.description +
        "</p>" +
        "</article>";
    });

    serviceGrid.innerHTML = html;
  }

  renderProjects();
  renderServices();
})();
