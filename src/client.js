// dsh-plugin-vault-memory — 浏览器半身（知识库悬浮球 + 中央面板 + 灵动岛集成）
//
// 架构（对齐 @local/dsh-astock-quotes 的三件套模式）：
//   1. sidebar.panellist 图标（id `vault-memory`，islandStandalone: true）——
//      点击打开中央面板；拖出侧栏即在该处撕成悬浮球；原生拖到灵动岛上
//      会收纳一个启动芯片（Plugin Island DnD 协议）。
//   2. main 中央面板（key `vault-memory`）——概览/捕获/配置/审查四个标签页。
//   3. shell.overlay 悬浮球（id `vault-memory-widget`）——纯图标圆球（不显示
//      文本），可在全屏自由拖动并记忆位置；点击展开成悬浮卡片，卡片标题栏
//      可拖拽、可收起；拖球回侧栏或灵动岛即停靠（球体折叠，侧栏图标仍在）；
//      从灵动岛拖出（plugin-island:eject）会在落点重新浮出。
//
// 数据：沿用宿主同源路由 /vault-memory/*（health / settings / capture / review），
// 健康轮询收敛为模块级单例 store（一个定时器，多实例订阅）。
// 悬浮球/卡片 DOM 为零依赖纯 DOM（自旧版胶囊原样迁移），React 只做壳。

window.__ModuleLoader__.load({
  id: "dsh-plugin-vault-memory",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    // ---- React（宿主模块加载器提供）----
    const React = require("react");
    const h = React.createElement;
    const { useState, useEffect, useRef, useCallback } = React;

    const NAME = "dsh-plugin-vault-memory";
    const PANEL_ID = "vault-memory";
    const WIDGET_ID = "vault-memory-widget";
    const HEALTH_PATH = "/vault-memory/health";
    const SETTINGS_PATH = "/vault-memory/settings";
    const CAPTURE_PREVIEW = "/vault-memory/capture/preview";
    const CAPTURE_COMMIT = "/vault-memory/capture/commit";
    const REVIEW_PATH = "/vault-memory/review";
    const POLL_MS = 20000;
    const ATTR = "data-vm";

    // Plugin Island 拖放协议
    const ISLAND_MIME = "application/x-dsh-plugin-island";

    // localStorage 状态键
    const SHELL_KEY = "dsh-plugin-vault-memory:shell:v1"; // 'sidebar' | 'floating'
    const MODE_KEY = "dsh-plugin-vault-memory:mode:v1"; // 'ball' | 'card'
    const POS_KEY = "dsh-plugin-vault-memory:pos:v1"; // {x,y}
    const LEGACY_HIDE_KEY = "dsh-plugin-vault-memory:hidden"; // 旧版胶囊隐藏键
    const SYNC_EVENT = "dsh-plugin-vault-memory:changed";

    const BALL = 46; // 悬浮球边长（与 astock 圆点一致）
    const CARD_W = 400; // 悬浮卡片宽度

    /* ================================================================== *
     * 通用工具                                                             *
     * ================================================================== */

    function el(tag, props, children) {
      var node = document.createElement(tag);
      if (props) for (var k in props) node.setAttribute(k, props[k]);
      (children || []).forEach(function (c) {
        if (typeof c === "string") node.appendChild(document.createTextNode(c));
        else if (c) node.appendChild(c);
      });
      return node;
    }

    function fetchJson(path, method, body) {
      var opt = { method: method || "GET", cache: "no-store", headers: {} };
      if (body) {
        opt.headers["content-type"] = "application/json";
        opt.body = JSON.stringify(body);
      }
      return fetch(path, opt).then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) {
            var err = new Error((j && j.error && j.error.message) || "HTTP " + r.status);
            err.code = j && j.error && j.error.code;
            throw err;
          }
          return j;
        });
      });
    }

    function readStoredJson(key) {
      try {
        var raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    }

    function writeStoredJson(key, val) {
      try {
        window.localStorage.setItem(key, JSON.stringify(val));
      } catch (e) {}
    }

    function notifyVmState() {
      try {
        window.dispatchEvent(new Event(SYNC_EVENT));
      } catch (e) {}
    }

    function clampPoint(x, y, width, height) {
      var viewW = typeof window === "undefined" ? 1200 : window.innerWidth;
      var viewH = typeof window === "undefined" ? 800 : window.innerHeight;
      return {
        x: Math.min(Math.max(x, 8), Math.max(8, viewW - width - 8)),
        y: Math.min(Math.max(y, 8), Math.max(8, viewH - height - 8)),
      };
    }

    function elementAtPoint(x, y) {
      try {
        return document.elementFromPoint(x, y);
      } catch (e) {
        return null;
      }
    }

    /** 灵动岛（Plugin Island）覆盖层根节点，若坐标在其上。 */
    function islandRootAt(x, y) {
      var node = elementAtPoint(x, y);
      if (node && node.closest) {
        var root = node.closest(".dsw-pli-root") || node.closest('[class*="plugin-island"]');
        if (root) return root;
      }
      return null;
    }

    /** 真正的左侧栏：贴左边缘的高窄区域（避免误匹配内容区的嵌套 nav）。 */
    function findSidebarRoot() {
      try {
        var nodes = document.querySelectorAll('aside, nav, [class*="idebar"], [class*="Sidebar"]');
        for (var i = 0; i < nodes.length; i++) {
          var rect = nodes[i].getBoundingClientRect();
          if (rect.width >= 30 && rect.height >= 200 && rect.left < 120 && rect.right <= window.innerWidth * 0.5) {
            return nodes[i];
          }
        }
      } catch (e) {}
      return null;
    }

    function isOverSidebar(x, y) {
      var root = findSidebarRoot();
      if (!root) return false;
      try {
        if (typeof document.elementsFromPoint === "function") {
          var stack = document.elementsFromPoint(x, y);
          for (var i = 0; i < stack.length; i++) {
            if (stack[i] === root || root.contains(stack[i])) return true;
          }
          return false;
        }
      } catch (e) {}
      var node = elementAtPoint(x, y);
      return !!(node && (node === root || root.contains(node)));
    }

    /* ================================================================== *
     * 健康状态单例（一个轮询器，多实例订阅）                                *
     * ================================================================== */

    function countErrors(data) {
      var vaults = (data && data.vaults) || [];
      var n = 0;
      vaults.forEach(function (v) {
        if (v.error) n++; // 只统计真实错误；索引重建（!ready）属临时状态，不告警
      });
      return n;
    }

    const healthStore = {
      data: { enabled: true, vaults: [] },
      errors: 0,
      listeners: new Set(),
      timer: 0,
      fetching: false,
      refresh() {
        if (this.fetching) return;
        this.fetching = true;
        var self = this;
        var settle = function (d) {
          self.fetching = false;
          if (d) {
            self.data = d;
            self.errors = countErrors(d);
          }
          self.emit();
        };
        fetchJson(HEALTH_PATH).then(
          function (j) { settle(j); },
          function () { settle(null); },
        );
      },
      emit() {
        var fns = Array.from(this.listeners);
        for (var i = 0; i < fns.length; i++) {
          try { fns[i](); } catch (e) {}
        }
      },
      subscribe(fn) {
        this.listeners.add(fn);
        if (!this.timer) {
          this.refresh();
          this.timer = setInterval(() => this.refresh(), POLL_MS);
        }
        var self = this;
        return function () {
          self.listeners.delete(fn);
          if (self.listeners.size === 0 && self.timer) {
            clearInterval(self.timer);
            self.timer = 0;
          }
        };
      },
    };

    /* ================================================================== *
     * 标签页 DOM 工厂（自旧版胶囊原样迁移：概览/捕获/配置/审查）             *
     * ================================================================== */

    var TAB_CSS = [
      "[" + ATTR + "] { font-size:12px; }",
      "[" + ATTR + "] * { box-sizing: border-box; }",
      "[" + ATTR + "] .vm-btn { cursor:pointer; border:1px solid rgba(255,255,255,.16); background:rgba(255,255,255,.08); color:inherit; border-radius:8px; padding:5px 10px; font-size:12px; }",
      "[" + ATTR + "] .vm-btn:hover { background:rgba(255,255,255,.18); }",
      "[" + ATTR + "] .vm-btn:disabled { opacity:.45; cursor:default; }",
      "[" + ATTR + "] .vm-btn.vm-primary { background:rgba(70,130,220,.55); }",
      "[" + ATTR + "] .vm-btn.vm-danger { background:rgba(200,70,70,.4); }",
      "[" + ATTR + "] input, [" + ATTR + "] textarea, [" + ATTR + "] select { width:100%; background:rgba(0,0,0,.22); border:1px solid rgba(255,255,255,.14); color:inherit; border-radius:6px; padding:5px 7px; font-size:12px; font-family:inherit; }",
      "[" + ATTR + "] input[type='checkbox'] { width:auto; flex:0 0 auto; margin-right:4px; }",
      "[" + ATTR + "] textarea { min-height:70px; resize:vertical; }",
      "[" + ATTR + "] .vm-row { display:flex; gap:6px; align-items:center; margin:6px 0; flex-wrap:nowrap; justify-content:flex-start; }",
      "[" + ATTR + "] .vm-row > span, [" + ATTR + "] .vm-row > label { white-space:nowrap; flex:0 0 auto; margin:0 !important; }",
      "[" + ATTR + "] .vm-row input:not([type='checkbox']) { width:auto; flex:0 1 auto; min-width:0; }",
      "[" + ATTR + "] .vm-row input[type='checkbox'] { width:14px; height:14px; flex:0 0 14px; margin:0 4px 0 0 !important; padding:0; }",
      "[" + ATTR + "] .vm-row .vm-num { width:44px; flex:0 0 44px; }",
      "[" + ATTR + "] .vm-sec { margin:10px 0 2px; font-weight:700; font-size:12px; }",
      "[" + ATTR + "] .vm-label { font-size:10px; opacity:.7; margin-top:8px; display:block; }",
      "[" + ATTR + "] .vm-note { white-space:pre-wrap; font-size:11px; opacity:.85; background:rgba(0,0,0,.25); border-radius:8px; padding:8px; max-height:180px; overflow:auto; }",
      "[" + ATTR + "] .vm-tab { cursor:pointer; padding:5px 10px; border-radius:8px 8px 0 0; font-size:12px; opacity:.6; }",
      "[" + ATTR + "] .vm-tab.vm-on { opacity:1; background:rgba(255,255,255,.1); }",
      "[" + ATTR + "] .vm-item { font-size:12px; padding:4px 0; border-bottom:1px dashed rgba(255,255,255,.08); word-break:break-all; }",
    ].join("\n");

    /**
     * 创建标签页 UI（纯 DOM）。返回 { root, dispose }。
     * root = 标签栏 + 内容体（概览/捕获/配置/审查），可挂到中央面板或悬浮卡片。
     */
    function createPanelDom() {
      var lastHealth = healthStore.data;

      var root = el("div", {
        "data-vm": "panel",
        style: "font-family:system-ui,'Segoe UI','Microsoft YaHei',sans-serif;color:var(--dsw-alias-label-primary,#E8EBF2);",
      });

      var tabsBar = el("div", { style: "display:flex;border-bottom:1px solid rgba(255,255,255,.1);padding:6px 8px 0;gap:4px;" });
      var tabOverview = el("div", { "data-vm": "tab", class: "vm-tab vm-on" }, ["概览"]);
      var tabCapture = el("div", { "data-vm": "tab", class: "vm-tab" }, ["捕获"]);
      var tabConfig = el("div", { "data-vm": "tab", class: "vm-tab" }, ["配置"]);
      var tabReview = el("div", { "data-vm": "tab", class: "vm-tab" }, ["审查"]);
      tabsBar.append(tabOverview, tabCapture, tabConfig, tabReview);
      root.appendChild(tabsBar);

      var bodyBox = el("div", { style: "padding:10px 12px 14px;max-height:60vh;overflow:auto;" });
      root.appendChild(bodyBox);

      // ================= 概览 =================
      var healthBox = el("div", null, []);
      bodyBox.appendChild(healthBox);

      function renderHealth() {
        healthBox.textContent = "";
        if (!lastHealth.enabled) {
          healthBox.appendChild(el("div", { class: "vm-item" }, ["插件未启用（配置里打开 enabled）"]));
          return;
        }
        if (!lastHealth.vaults || lastHealth.vaults.length === 0) {
          healthBox.appendChild(el("div", { class: "vm-item" }, ["未配置任何 vault：切到「配置」标签添加库路径。"]));
          return;
        }
        lastHealth.vaults.forEach(function (v) {
          var head = el("div", { style: "font-weight:700;margin:6px 0 2px;" }, [v.label + " — " + v.path]);
          healthBox.appendChild(head);
          if (v.error || !v.ready) {
            healthBox.appendChild(el("div", { class: "vm-item" }, ["⚠ " + (v.error || "索引未就绪")]));
            return;
          }
          var line = "已索引 " + v.notes + " 篇笔记";
          if (v.brokenLinks > 0) line += " · 断链 " + v.brokenLinks;
          if (v.reviewOpen > 0) line += " · 待审 " + v.reviewOpen;
          if (v.recent && v.recent.length) line += " · 近 7 天 " + v.recent.length + " 篇更新";
          healthBox.appendChild(el("div", { class: "vm-item" }, [line]));
          if (v.trend && v.trend.length > 1) {
            var trend = v.trend.slice().reverse().map(function (s) {
              return s.metrics && s.metrics.open !== undefined ? s.metrics.open : "-";
            });
            healthBox.appendChild(el("div", { class: "vm-item", style: "font-size:11px;opacity:.7;" }, ["待审趋势: " + trend.join(" → ")]));
          }
          if (v.embed && v.embed.available) {
            healthBox.appendChild(el("div", { class: "vm-item", style: "font-size:11px;opacity:.7;" }, ["语义检索就绪（" + v.embed.model + " · " + v.embed.coveredNotes + " 篇已嵌入）"]));
          } else if (v.embed && v.embed.error) {
            healthBox.appendChild(el("div", { class: "vm-item", style: "font-size:11px;opacity:.7;" }, ["语义不可用: " + v.embed.error]));
          }
          (v.recent || []).slice(0, 5).forEach(function (r) {
            healthBox.appendChild(el("div", { class: "vm-item", style: "padding-left:12px;font-size:11px;opacity:.75;" }, [r.path]));
          });
        });
      }

      var offHealth = healthStore.subscribe(function () {
        lastHealth = healthStore.data;
        renderHealth();
      });
      renderHealth();

      // ================= 捕获 =================
      var capBox = el("div", null, []);
      var capTitle = el("input", { placeholder: "标题（将作为文件名）" });
      var capFolder = el("input", { placeholder: "目录（留空用默认 Captures）" });
      var capBody = el("textarea", { placeholder: "markdown 正文…" });
      var capTagInput = el("input", { placeholder: "标签，逗号分隔（可选）" });
      var capOut = el("div", {});
      var capSave = el("button", { class: "vm-btn vm-primary", disabled: "" }, ["保存到库"]);

      function selectedVault() {
        var first = lastHealth.vaults && lastHealth.vaults.length ? lastHealth.vaults[0] : null;
        return first ? first.label : undefined;
      }
      function capPayload() {
        return {
          vault: selectedVault(),
          title: capTitle.value,
          body: capBody.value,
          folder: capFolder.value.trim() || undefined,
          tags: capTagInput.value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean),
        };
      }
      capSave.addEventListener("click", function () {
        capOut.textContent = "保存中…";
        capSave.disabled = true;
        fetchJson(CAPTURE_COMMIT, "POST", capPayload())
          .then(function (j) {
            capOut.textContent = "";
            capOut.appendChild(el("div", { class: "vm-item", style: "border:none;" }, ["已保存：" + j.path]));
            // 在 Obsidian 打开（vault 显示名 = 库目录名）
            var vb = (lastHealth.vaults || []).find(function (x) { return x.label === j.vault; });
            var vaultName = vb ? vb.path.replace(/\\+$/g, "").split(/[\\/]/).pop() : "";
            if (vaultName) {
              var uri = "obsidian://open?vault=" + encodeURIComponent(vaultName) + "&file=" + encodeURIComponent(j.path.replace(/\.md$/i, ""));
              var open = el("a", { href: uri, target: "_blank", class: "vm-btn", style: "display:inline-block;text-decoration:none;margin-top:6px;" }, ["在 Obsidian 打开 ↗"]);
              capOut.appendChild(open);
            }
            healthStore.refresh();
          })
          .catch(function (e) {
            capOut.textContent = "保存失败：" + e.message;
          })
          .finally(function () {
            capSave.disabled = false;
          });
      });

      capBody.addEventListener("input", function () {
        capOut.textContent = "";
      });
      capTitle.addEventListener("input", function () {
        capOut.textContent = "";
      });

      function showPreview() {
        capOut.textContent = "预览中…";
        capSave.disabled = true;
        fetchJson(CAPTURE_PREVIEW, "POST", capPayload())
          .then(function (j) {
            var pre = el("div", { class: "vm-note" });
            pre.appendChild(document.createTextNode("路径: " + j.path + "\n\n" + j.note));
            capOut.textContent = "";
            capOut.appendChild(pre);
            capSave.disabled = false;
          })
          .catch(function (e) {
            capOut.textContent = "预览失败：" + e.message + (e.code === "NOTE_EXISTS" ? "（同名笔记已存在，请换标题或目录）" : "");
          });
      }

      capBox.appendChild(el("label", { class: "vm-label" }, ["标题 *"]));
      capBox.appendChild(capTitle);
      capBox.appendChild(el("label", { class: "vm-label" }, ["目录（vault 内相对路径）"]));
      capBox.appendChild(capFolder);
      capBox.appendChild(el("label", { class: "vm-label" }, ["正文 markdown *"]));
      capBox.appendChild(capBody);
      capBox.appendChild(el("label", { class: "vm-label" }, ["标签"]));
      capBox.appendChild(capTagInput);
      var capRow = el("div", { class: "vm-row", style: "margin-top:10px;" });
      var capPreview = el("button", { class: "vm-btn" }, ["预览"]);
      capPreview.addEventListener("click", showPreview);
      capRow.append(capPreview, capSave);
      capBox.appendChild(capRow);
      capBox.appendChild(capOut);

      // ================= 配置 =================
      var cfgBox = el("div", null, []);
      var cfgList = el("div", {}, []);
      var cfgEnabled = el("input", { type: "checkbox" });
      var cfgPath = el("input", { placeholder: "vault 绝对路径，如 D:\\...\\my-vault" });
      var cfgLabel = el("input", { placeholder: "标签（可选）" });
      var cfgMsg = el("div", {}, []);
      var cfgSave = el("button", { class: "vm-btn vm-primary" }, ["保存配置"]);

      // 语义检索（Ollama，可选）
      var embedEnable = el("input", { type: "checkbox" });
      var embedBaseUrl = el("input", { placeholder: "如 http://127.0.0.1:11434" });
      var embedModel = el("input", { placeholder: "如 bge-m3（ollama pull bge-m3）" });
      var embedHint = el("div", { class: "vm-item", style: "border:none;font-size:11px;opacity:.75;" }, ["可选：不开也能用关键词检索；开了才有语义搜索与 3 条高级巡检规则。"]);
      // 巡检
      var reviewEnable = el("input", { type: "checkbox" });
      var reviewHour = el("input", { class: "vm-num", maxlength: "2" });
      // 会话记忆
      var memEnable = el("input", { type: "checkbox" });

      function renderConfig(cfg) {
        cfgList.textContent = "";
        (cfg.vaults || []).forEach(function (v) {
          var row = el("div", { class: "vm-row" });
          row.appendChild(el("span", { class: "vm-item", style: "flex:1;border:none;" }, [v.path + (v.label ? "（" + v.label + "）" : "") + (v.error ? " ⚠ " + v.error : "")]));
          var del = el("button", { class: "vm-btn vm-danger" }, ["移除"]);
          del.addEventListener("click", function () {
            var list = (runtimeConfig.vaults || []).filter(function (x) { return x.path !== v.path; });
            runtimeConfig.vaults = list;
            renderConfig(runtimeConfig);
          });
          row.appendChild(del);
          cfgList.appendChild(row);
        });
        embedEnable.checked = !!(cfg.embed && cfg.embed.enabled);
        if (cfg.embed) embedBaseUrl.value = cfg.embed.baseUrl || "http://127.0.0.1:11434";
        if (cfg.embed) embedModel.value = cfg.embed.model || "bge-m3";
        reviewEnable.checked = !!(cfg.review && cfg.review.enabled);
        if (cfg.review) reviewHour.value = String(cfg.review.hour);
        memEnable.checked = !!(cfg.memory && cfg.memory.injectEnabled);
      }
      var runtimeConfig = { enabled: true, vaults: [], embed: {}, review: {}, memory: {} };

      function loadConfig() {
        cfgMsg.textContent = "";
        fetchJson(SETTINGS_PATH)
          .then(function (j) {
            runtimeConfig = j.config;
            cfgEnabled.checked = runtimeConfig.enabled !== false;
            renderConfig(runtimeConfig);
          })
          .catch(function (e) {
            cfgMsg.textContent = "读取配置失败：" + e.message;
          });
      }

      cfgSave.addEventListener("click", function () {
        cfgSave.disabled = true;
        var hour = parseInt(reviewHour.value, 10);
        fetchJson(SETTINGS_PATH, "POST", {
          enabled: cfgEnabled.checked,
          vaults: runtimeConfig.vaults,
          embed: { enabled: embedEnable.checked, baseUrl: embedBaseUrl.value.trim() || undefined, model: embedModel.value.trim() || undefined },
          review: { enabled: reviewEnable.checked, hour: Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : runtimeConfig.review.hour },
          memory: { injectEnabled: memEnable.checked },
        })
          .then(function (j) {
            cfgMsg.textContent = "已保存并生效。";
            runtimeConfig = j.config;
            renderConfig(runtimeConfig);
            healthStore.refresh();
            loadConfig();
          })
          .catch(function (e) {
            cfgMsg.textContent = "保存失败：" + e.message;
          })
          .finally(function () {
            cfgSave.disabled = false;
          });
      });

      var addBtn = el("button", { class: "vm-btn" }, ["添加"]);
      addBtn.addEventListener("click", function () {
        var p = cfgPath.value.trim();
        if (!p) {
          cfgMsg.textContent = "请输入 vault 路径";
          return;
        }
        var dup = (runtimeConfig.vaults || []).some(function (v) { return v.path === p; });
        if (dup) {
          cfgMsg.textContent = "该路径已存在";
          return;
        }
        runtimeConfig.vaults.push({ path: p, label: cfgLabel.value.trim() || undefined });
        cfgPath.value = "";
        cfgLabel.value = "";
        cfgMsg.textContent = "";
        renderConfig(runtimeConfig);
      });

      cfgBox.appendChild(el("div", { class: "vm-item", style: "border-bottom:none;" }, ["修改立即写入 settings.yaml 并重建索引。"]));
      var enRow = el("div", { class: "vm-row" });
      enRow.append(cfgEnabled, el("span", null, ["启用插件"]));
      cfgBox.appendChild(enRow);
      cfgBox.appendChild(cfgList);
      cfgBox.appendChild(el("label", { class: "vm-label" }, ["新增库"]));
      cfgBox.appendChild(cfgPath);
      cfgBox.appendChild(cfgLabel);
      var addRow = el("div", { class: "vm-row" });
      addRow.append(addBtn, cfgSave);
      cfgBox.appendChild(addRow);

      // 语义检索（可选）
      cfgBox.appendChild(el("div", { class: "vm-sec" }, ["语义检索（可选）"]));
      cfgBox.appendChild(embedHint);
      var embEn = el("div", { class: "vm-row" });
      embEn.append(embedEnable, el("span", null, ["启用（需本机 Ollama）"]));
      cfgBox.appendChild(embEn);
      cfgBox.appendChild(el("label", { class: "vm-label" }, ["Ollama 地址"]));
      cfgBox.appendChild(embedBaseUrl);
      cfgBox.appendChild(el("label", { class: "vm-label" }, ["嵌入模型"]));
      cfgBox.appendChild(embedModel);
      // 巡检 + 记忆
      cfgBox.appendChild(el("div", { class: "vm-sec" }, ["巡检与记忆"]));
      var revEn = el("div", { class: "vm-row" });
      revEn.append(reviewEnable, el("span", null, ["每日自动巡检"]), el("label", { style: "margin:0 4px 0 8px;font-size:11px;" }, ["小时"]), reviewHour);
      cfgBox.appendChild(revEn);
      var memEn = el("div", { class: "vm-row" });
      memEn.append(memEnable, el("span", null, ["新会话注入记忆快照"]));
      cfgBox.appendChild(memEn);
      cfgBox.appendChild(cfgMsg);
      loadConfig();

      // ================= 审查 =================
      var reviewBox = el("div", null, []);
      var reviewMsg = el("div", {}, []);
      var reviewList = el("div", null, []);

      function actionReview(id, action, extra) {
        var payload = { action: action, id: id };
        if (extra) for (var k in extra) payload[k] = extra[k];
        return fetchJson(REVIEW_PATH, "POST", payload);
      }

      function renderReview(items) {
        reviewList.textContent = "";
        if (!items.length) {
          reviewList.appendChild(el("div", { class: "vm-item" }, ["暂无待审建议——点上方「立即巡检」扫描孤儿/断链/缺目录总览等。"]));
          return;
        }
        items.forEach(function (s) {
          var card = el("div", { style: "border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:8px;margin:6px 0;" });
          card.appendChild(el("div", { class: "vm-item", style: "border:none;font-weight:700;" }, ["[" + s.kind + "] " + s.target + "（" + s.vault + "）"]));
          card.appendChild(el("div", { class: "vm-item", style: "border:none;font-size:11px;opacity:.8;" }, [s.reason]));

          // kind 相关候选控件
          var extra = {};
          var sel = null;
          var collectLinks = null;
          var choiceBox = el("div", { class: "vm-item", style: "border:none;" });
          if (s.kind === "orphan") {
            var proposed = (s.payload && s.payload.proposedLinks || []).slice(0, 3);
            var checked = [];
            proposed.forEach(function (p) {
              var box = el("input", { type: "checkbox", style: "width:auto;", checked: "" });
              var row = el("div", { class: "vm-row", style: "margin:2px 0;" });
              row.append(box, el("span", null, [p.path + "（" + (p.why || "") + "）"]));
              choiceBox.appendChild(row);
              checked.push({ box: box, path: p.path });
            });
            collectLinks = function () {
              return checked.filter(function (c) { return c.box.checked; }).map(function (c) { return c.path; });
            };
            if (checked.length) {
              checked.forEach(function (c) {
                c.box.addEventListener("change", function () { extra.links = collectLinks(); });
              });
              extra.links = collectLinks();
            }
          } else if (s.kind === "broken_link") {
            var candidates = (s.payload && s.payload.candidates || []).slice(0, 3);
            if (candidates.length > 0) {
              sel = el("select", { style: "width:100%;background:rgba(0,0,0,.22);color:inherit;border:1px solid rgba(255,255,255,.14);border-radius:6px;padding:4px;" });
              candidates.forEach(function (c) {
                var opt = el("option", { value: c }, [c]);
                sel.appendChild(opt);
              });
              extra.target = candidates[0];
              sel.addEventListener("change", function () { extra.target = sel.value; });
              choiceBox.appendChild(el("label", { class: "vm-label", style: "margin-top:0;" }, ["修复为:"]));
              choiceBox.appendChild(sel);
            } else {
              choiceBox.appendChild(el("div", { style: "font-size:11px;opacity:.6;" }, ["库内无近似候选，需人工确认目标后再处理"]));
            }
          }
          if (choiceBox.childNodes.length > 0) card.appendChild(choiceBox);

          var btnRow = el("div", { class: "vm-row", style: "margin-top:6px;" });
          var approve = el("button", { class: "vm-btn vm-primary" }, ["批准"]);
          approve.addEventListener("click", function () {
            var opts = {};
            if (s.kind === "orphan") {
              opts.links = collectLinks ? collectLinks() : [];
              if (!opts.links.length) {
                reviewMsg.textContent = "请至少勾选一条要关联的笔记";
                return;
              }
            } else if (s.kind === "broken_link") {
              if (sel && sel.value) opts.target = sel.value;
            }
            approve.disabled = true;
            actionReview(s.id, "approve", opts)
              .then(function () { reviewMsg.textContent = "已批准并写回。"; loadReview(); })
              .catch(function (e) { reviewMsg.textContent = "批准失败：" + e.message; approve.disabled = false; });
          });
          if (s.kind === "broken_link" && !(s.payload && s.payload.candidates && s.payload.candidates.length)) {
            approve.disabled = true;
            approve.title = "无候选目标";
          }
          var dismiss = el("button", { class: "vm-btn" }, ["忽略"]);
          dismiss.addEventListener("click", function () {
            actionReview(s.id, "dismiss")
              .then(function () { reviewMsg.textContent = "已忽略。"; loadReview(); })
              .catch(function (e) { reviewMsg.textContent = "忽略失败：" + e.message; });
          });
          btnRow.append(approve, dismiss);
          card.appendChild(btnRow);
          reviewList.appendChild(card);
        });
      }

      function loadReview() {
        fetchJson(REVIEW_PATH)
          .then(function (j) {
            renderReview(j.items || []);
          })
          .catch(function (e) {
            reviewList.textContent = "";
            reviewList.appendChild(el("div", { class: "vm-item" }, ["读取失败：" + e.message]));
          });
      }

      var reviewRunBtn = el("button", { class: "vm-btn vm-primary" }, ["立即巡检"]);
      reviewRunBtn.addEventListener("click", function () {
        reviewRunBtn.disabled = true;
        fetchJson(REVIEW_PATH, "POST", { action: "run" })
          .then(function (j) {
            var sum = (j.results || []).map(function (r) {
              return r.vault + (r.error ? " 出错" : " +" + r.inserted);
            }).join("、");
            reviewMsg.textContent = "巡检完成：" + (sum || "无");
            loadReview();
          })
          .catch(function (e) { reviewMsg.textContent = "巡检失败：" + e.message; })
          .finally(function () { reviewRunBtn.disabled = false; });
      });
      var reviewTop = el("div", { class: "vm-row", style: "align-items:center;gap:8px;" });
      reviewTop.append(reviewRunBtn);
      reviewBox.appendChild(reviewTop);
      reviewBox.appendChild(reviewMsg);
      reviewBox.appendChild(reviewList);

      // ================= tab 切换 =================
      bodyBox.appendChild(capBox);
      bodyBox.appendChild(cfgBox);
      bodyBox.appendChild(reviewBox);
      capBox.style.display = "none";
      cfgBox.style.display = "none";
      reviewBox.style.display = "none";

      function showTab(which) {
        tabOverview.classList.toggle("vm-on", which === "overview");
        tabCapture.classList.toggle("vm-on", which === "capture");
        tabConfig.classList.toggle("vm-on", which === "config");
        tabReview.classList.toggle("vm-on", which === "review");
        capBox.style.display = which === "capture" ? "" : "none";
        cfgBox.style.display = which === "config" ? "" : "none";
        reviewBox.style.display = which === "review" ? "" : "none";
        healthBox.style.display = which === "overview" ? "" : "none";
        if (which === "capture") healthStore.refresh();
        if (which === "config") loadConfig();
        if (which === "review") loadReview();
      }
      tabOverview.addEventListener("click", function () { showTab("overview"); });
      tabCapture.addEventListener("click", function () { showTab("capture"); });
      tabConfig.addEventListener("click", function () { showTab("config"); });
      tabReview.addEventListener("click", function () { showTab("review"); });

      return {
        root: root,
        dispose: function () {
          offHealth();
        },
      };
    }

    /* ================================================================== *
     * React 侧：图标 / 中央面板 / 悬浮球挂件                                *
     * ================================================================== */

    /** 书本图标（Feather book，MIT）。描边跟随 currentColor。 */
    function BookGlyph(props) {
      const size = typeof (props && props.size) === "number" ? props.size : 20;
      return h(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          "stroke-width": 1.7,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          "aria-hidden": true,
          style: { display: "block" },
        },
        h("path", { d: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20" }),
        h("path", { d: "M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" }),
      );
    }

    /** 头部折叠按钮（对齐 astock CollapseIconButton）：点按收起为悬浮球，按住拖动移动卡片。 */
    function CollapseIconButton(props) {
      const [hover, setHover] = useState(false);
      return h(
        "button",
        {
          type: "button",
          title: props.title,
          "aria-label": props.title,
          onPointerDown: (event) => {
            // 阻止头部拖拽抢占指针：本按钮持有手势——点按折叠，拖动移动
            event.stopPropagation();
            props.beginDrag(event, props.onToggle);
          },
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          style: {
            width: 40,
            height: 34,
            borderRadius: 10,
            border: hover ? "1px solid var(--dsw-alias-border-l2)" : "1px solid transparent",
            background: hover ? "var(--dsw-alias-bg-layer-3)" : "var(--dsw-alias-bg-layer-1)",
            color: hover ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-secondary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            padding: 0,
            flexShrink: 0,
            fontFamily: "inherit",
            touchAction: "none",
            transition: "background 140ms ease, color 140ms ease",
          },
        },
        BookGlyph({ size: 20 }),
      );
    }

    // ---- 悬浮壳状态读写 ----

    function readShellMode() {
      return readStoredJson(SHELL_KEY) === "sidebar" ? "sidebar" : "floating";
    }

    function readWidgetMode() {
      var v = readStoredJson(MODE_KEY);
      if (v === "ball" || v === "card") return v;
      return "ball"; // 默认纯图标圆球
    }

    function readWidgetPos() {
      var p = readStoredJson(POS_KEY);
      if (p && typeof p.x === "number" && typeof p.y === "number") return p;
      return {
        x: Math.max(8, (typeof window === "undefined" ? 1200 : window.innerWidth) - BALL - 16),
        y: Math.max(8, (typeof window === "undefined" ? 800 : window.innerHeight) - BALL - 16),
      };
    }

    function dockToSidebar() {
      writeStoredJson(SHELL_KEY, "sidebar");
      notifyVmState();
    }

    /** 在屏幕坐标 (x, y) 处撕出悬浮卡片（展开形态，对齐 astock 的 tear-off）。 */
    function tearOffAt(x, y) {
      writeStoredJson(POS_KEY, clampPoint(x - BALL / 2, y - BALL / 2, BALL, BALL));
      writeStoredJson(MODE_KEY, "card");
      writeStoredJson(SHELL_KEY, "floating");
      notifyVmState();
    }

    function setWidgetMode(next) {
      if (next === "card") {
        // 展开时把位置按卡片尺寸重新夹紧，避免卡片出屏
        var p = readStoredJson(POS_KEY) || readWidgetPos();
        writeStoredJson(POS_KEY, clampPoint(p.x, p.y, CARD_W, 360));
      }
      writeStoredJson(MODE_KEY, next);
      notifyVmState();
    }

    function readSnapshot() {
      return {
        shell: readShellMode(),
        mode: readWidgetMode(),
        pos: readWidgetPos(),
        errors: healthStore.errors,
      };
    }

    /** 悬浮球状态订阅：本页事件 + 跨窗口 storage + 健康徽标。 */
    function useVmWidgetState() {
      const [snap, setSnap] = useState(readSnapshot);
      useEffect(() => {
        const check = () => setSnap(readSnapshot());
        window.addEventListener(SYNC_EVENT, check);
        window.addEventListener("storage", check);
        window.addEventListener("focus", check);
        const offHealth = healthStore.subscribe(check);
        return () => {
          window.removeEventListener(SYNC_EVENT, check);
          window.removeEventListener("storage", check);
          window.removeEventListener("focus", check);
          offHealth();
        };
      }, []);
      return snap;
    }

    // ---- 侧栏图标（点击开面板 / 拖出撕成悬浮球 / 原生拖到灵动岛收纳） ----

    function makeSidebarIcon() {
      return function SidebarIcon(props) {
        const size = typeof props.size === "number" ? props.size : 20;
        const payload = JSON.stringify({ from: "palette", id: PANEL_ID });

        const beginTearoff = (event) => {
          if (event.pointerType === "mouse" && event.button !== 0) return;
          const handle = event.currentTarget;
          const startX = event.clientX;
          const startY = event.clientY;
          let moved = false;
          let last = null;
          try {
            handle.setPointerCapture(event.pointerId);
          } catch (e) {}
          const move = (moveEvent) => {
            if (Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY) > 8) moved = true;
            last = { x: moveEvent.clientX, y: moveEvent.clientY };
          };
          const finish = (finishEvent) => {
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("pointerup", finish);
            handle.removeEventListener("pointercancel", finish);
            try {
              if (finishEvent && finishEvent.pointerId !== undefined) handle.releasePointerCapture(finishEvent.pointerId);
            } catch (e) {}
            if (!moved || !last) return;
            if (islandRootAt(last.x, last.y)) return; // 原生拖放路径 / 灵动岛自己处理
            if (isOverSidebar(last.x, last.y)) return;
            tearOffAt(last.x, last.y);
          };
          handle.addEventListener("pointermove", move);
          handle.addEventListener("pointerup", finish);
          handle.addEventListener("pointercancel", finish);
        };

        return h(
          "div",
          {
            draggable: true,
            title: "拖出成悬浮球 / 点击打开面板",
            style: { display: "flex", alignItems: "center", justifyContent: "center", touchAction: "none" },
            onPointerDown: beginTearoff,
            onDragStart(event) {
              event.dataTransfer.setData(ISLAND_MIME, payload);
              event.dataTransfer.setData("text/plain", payload);
              event.dataTransfer.effectAllowed = "copyMove";
            },
            onDragEnd(event) {
              // 原生拖放会触发 pointercancel，指针路径已让位，在这里处理落点
              if (event.clientX === 0 && event.clientY === 0) return;
              if (islandRootAt(event.clientX, event.clientY)) return; // 灵动岛收纳芯片
              if (isOverSidebar(event.clientX, event.clientY)) return;
              tearOffAt(event.clientX, event.clientY);
            },
          },
          BookGlyph({ size }),
        );
      };
    }

    // ---- 中央面板（main 槽位）----

    function makeMainPanel() {
      return function MainPanel() {
        const [panel] = useState(() => {
          try { return createPanelDom(); } catch (e) {
            try { console.error("[vault-memory] createPanelDom failed:", e); } catch (_) {}
            const box = document.createElement("div");
            box.setAttribute("data-vm", "panel-error");
            box.style.cssText = "padding:10px 12px;font-size:12px;color:#e88;";
            box.textContent = "面板构建失败：" + (e && e.message ? e.message : String(e));
            return { root: box, dispose: function () {} };
          }
        });
        const containerRef = useRef(null);
        // callback ref：commit 阶段直接挂载，不依赖 effect 时序
        const attachContainer = useCallback((node) => {
          containerRef.current = node;
          if (node && panel && panel.root && panel.root.parentNode !== node) {
            node.appendChild(panel.root);
          }
        }, [panel]);

        useEffect(() => () => panel.dispose(), [panel]);

        return h(
          "div",
          {
            style: {
              height: "100%",
              overflowY: "auto",
              background: "var(--dsw-alias-bg-base)",
              color: "var(--dsw-alias-label-primary)",
            },
          },
          h(
            "div",
            { style: { maxWidth: 720, margin: "0 auto", padding: "26px 24px 48px" } },
            h("div", { style: { fontSize: 20, fontWeight: 650, letterSpacing: 0.2, marginBottom: 4 } }, "知识库"),
            h(
              "div",
              { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)", marginBottom: 14 } },
              "本地 Obsidian 库 · 概览 / 捕获 / 配置 / 审查",
            ),
            h("div", {
              ref: attachContainer,
              style: {
                border: "1px solid var(--dsw-alias-border-l1)",
                borderRadius: 14,
                overflow: "hidden",
                background: "var(--dsw-alias-bg-overlay)",
              },
            }),
          ),
        );
      };
    }

    // ---- 悬浮球 + 悬浮卡片（shell.overlay 槽位）----

    var WIDGET_CSS = [
      ".vmw-shell{position:fixed;z-index:5;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:0 10px 32px rgba(0,0,0,.24);pointer-events:auto;transition:width .22s cubic-bezier(.2,.8,.2,1),height .22s cubic-bezier(.2,.8,.2,1),border-radius .22s cubic-bezier(.2,.8,.2,1);}",
      ".vmw-layer{position:absolute;top:0;left:0;transition:opacity .16s ease,transform .22s cubic-bezier(.2,.8,.2,1);}",
      ".vmw-ball-inner{width:100%;height:100%;display:flex;align-items:center;justify-content:center;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;color:var(--dsw-alias-label-primary);transition:transform .16s ease;}",
      ".vmw-ball-inner:hover{transform:scale(1.06);}",
      ".vmw-ball-inner:active{cursor:grabbing;transform:scale(.97);}",
      ".vmw-badge{position:absolute;top:2px;right:2px;min-width:14px;height:14px;padding:0 4px;border-radius:7px;background:var(--dsw-alias-state-error-primary,#c0392b);border:1px solid rgba(0,0,0,.25);color:#fff;font-size:9px;line-height:12px;text-align:center;font-variant-numeric:tabular-nums;box-shadow:0 1px 3px rgba(0,0,0,.4);}",
      ".vmw-card-sizer{display:flex;flex-direction:column;min-height:64px;}",
      ".vmw-card-head{display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--dsw-alias-bg-layer-3);cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;flex:none;}",
      ".vmw-card-head:active{cursor:grabbing;}",
      ".vmw-card-title{font-size:12.5px;font-weight:650;white-space:nowrap;}",
      ".vmw-head-btn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:7px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:15px;line-height:1;cursor:pointer;padding:0;}",
      ".vmw-head-btn:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);}",
      ".vmw-card-body{flex:1;min-height:220px;overflow:auto;}",
    ].join("\n");

    function makeWidget() {
      return function Widget() {
        const snap = useVmWidgetState();
        const [livePos, setLivePos] = useState(null);
        const sizerRef = useRef(null);
        const [contentHeight, setContentHeight] = useState(340);
        const [panel] = useState(() => {
          try { return createPanelDom(); } catch (e) {
            try { console.error("[vault-memory] createPanelDom failed:", e); } catch (_) {}
            const box = document.createElement("div");
            box.setAttribute("data-vm", "panel-error");
            box.style.cssText = "padding:10px 12px;font-size:12px;color:#e88;";
            box.textContent = "面板构建失败：" + (e && e.message ? e.message : String(e));
            return { root: box, dispose: function () {} };
          }
        });
        const cardBodyRef = useRef(null);
        // callback ref：commit 阶段直接挂载，不依赖 effect 时序
        const attachBody = useCallback((node) => {
          cardBodyRef.current = node;
          if (node && panel && panel.root && panel.root.parentNode !== node) {
            node.appendChild(panel.root);
            try { console.info("[vault-memory] 卡片正文已挂载, 面板子节点:", panel.root.children.length); } catch (_) {}
          }
        }, [panel]);

        // 卡片实际高度（offsetHeight 不受 scale 影响）；下限 220 防塌陷
        useEffect(() => {
          const node = sizerRef.current;
          if (!node) return undefined;
          const measure = () =>
            setContentHeight((prev) => {
              const next = Math.max(220, node.offsetHeight);
              return Number.isFinite(next) && Math.abs(next - prev) >= 1 ? next : prev;
            });
          measure();
          if (typeof ResizeObserver === "undefined") {
            const timer = setInterval(measure, 500);
            return () => clearInterval(timer);
          }
          const ro = new ResizeObserver(measure);
          ro.observe(node);
          return () => ro.disconnect();
        }, []);

        useEffect(() => () => panel.dispose(), [panel]);

        // 从灵动岛拖出 → 在落点重新浮出
        useEffect(() => {
          const onEject = (event) => {
            const detail = event && event.detail;
            if (!detail || detail.id !== PANEL_ID) return;
            tearOffAt(detail.x, detail.y);
          };
          window.addEventListener("plugin-island:eject", onEject);
          return () => window.removeEventListener("plugin-island:eject", onEject);
        }, []);

        if (snap.shell !== "floating") return null;

        const pos = livePos || snap.pos;
        const isBall = snap.mode === "ball";
        const box = isBall
          ? { w: BALL, h: BALL, r: BALL / 2 }
          : { w: CARD_W, h: Math.max(contentHeight, 64), r: 16 };

        const layerStyle = (active) => ({
          opacity: active ? 1 : 0,
          transform: active ? "scale(1)" : "scale(0.85)",
          transformOrigin: "top left",
          pointerEvents: active ? "auto" : "none",
        });

        /** 卡片标题栏指针拖拽：移动整卡；落到侧栏上则停靠；点按（onTap）折叠。 */
        const beginCardDrag = (event, onTap) => {
          if (event.pointerType === "mouse" && event.button !== 0) return;
          const handle = event.currentTarget;
          const shell = handle.closest(".vmw-shell");
          if (!shell) return;
          const rect = shell.getBoundingClientRect();
          const offsetX = event.clientX - rect.left;
          const offsetY = event.clientY - rect.top;
          const startX = event.clientX;
          const startY = event.clientY;
          let moved = false;
          let last = { x: rect.left, y: rect.top };
          try {
            handle.setPointerCapture(event.pointerId);
          } catch (e) {}
          document.body.style.userSelect = "none";
          const move = (moveEvent) => {
            if (Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY) > 4) moved = true;
            last = clampPoint(moveEvent.clientX - offsetX, moveEvent.clientY - offsetY, shell.offsetWidth, shell.offsetHeight);
            setLivePos(last);
          };
          const finish = (finishEvent) => {
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("pointerup", finish);
            handle.removeEventListener("pointercancel", finish);
            try {
              if (finishEvent && finishEvent.pointerId !== undefined) handle.releasePointerCapture(finishEvent.pointerId);
            } catch (e) {}
            document.body.style.userSelect = "";
            writeStoredJson(POS_KEY, last);
            setLivePos(null);
            notifyVmState();
            if (moved && isOverSidebar(finishEvent.clientX, finishEvent.clientY)) {
              dockToSidebar();
              return;
            }
            // 几乎未移动 = 点按（对齐 astock beginDrag 语义）
            if (!moved && onTap) onTap();
          };
          handle.addEventListener("pointermove", move);
          handle.addEventListener("pointerup", finish);
          handle.addEventListener("pointercancel", finish);
        };

        /** 球体原生拖放（灵动岛协议）：拖到灵动岛/侧栏停靠，拖到别处移动。 */
        const ballPayload = JSON.stringify({ from: "palette", id: PANEL_ID });
        const ballDragStart = (event) => {
          event.dataTransfer.setData(ISLAND_MIME, ballPayload);
          event.dataTransfer.setData("text/plain", ballPayload);
          event.dataTransfer.effectAllowed = "copyMove";
        };
        const ballDragEnd = (event) => {
          if (event.clientX === 0 && event.clientY === 0) return;
          const x = event.clientX;
          const y = event.clientY;
          if (islandRootAt(x, y)) {
            // 落到灵动岛：岛收纳启动芯片，独立球体折叠
            dockToSidebar();
            return;
          }
          if (isOverSidebar(x, y)) {
            dockToSidebar();
            return;
          }
          const point = clampPoint(x - BALL / 2, y - BALL / 2, BALL, BALL);
          writeStoredJson(POS_KEY, point);
          notifyVmState();
        };

        return h(
          "div",
          {
            className: "vmw-shell",
            style: { left: pos.x, top: pos.y, width: box.w, height: box.h, borderRadius: box.r, position: "fixed" },
          },
          // --- 卡片层 ---
          h(
            "div",
            { className: "vmw-layer", style: { ...layerStyle(!isBall), width: CARD_W, height: "100%" } },
            h(
              "div",
              { ref: sizerRef, className: "vmw-card-sizer", style: { width: CARD_W } },
              h(
                "div",
                { className: "vmw-card-head", onPointerDown: beginCardDrag, title: "拖动移动 · 拖回左侧栏停靠" },
                h(CollapseIconButton, { title: "点击收起", onToggle: () => setWidgetMode("ball"), beginDrag: beginCardDrag }),
                h("span", { className: "vmw-card-title" }, "知识库"),
                h("span", { style: { flex: 1 } }),
              ),
              h("div", { ref: attachBody, className: "vmw-card-body", style: { maxWidth: "calc(100vw - 40px)" } }),
            ),
          ),
          // --- 悬浮球层（纯图标，无文本）---
          h(
            "div",
            {
              className: "vmw-layer",
              style: { ...layerStyle(isBall), width: BALL, height: BALL },
            },
            h(
              "div",
              {
                className: "vmw-ball-inner",
                title: "知识库 · 点击展开，拖动移动，拖到灵动岛或侧栏停靠",
                role: "button",
                tabIndex: 0,
                draggable: isBall,
                onDragStart: ballDragStart,
                onDragEnd: ballDragEnd,
                onClick() {
                  setWidgetMode("card");
                },
                onKeyDown(event) {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setWidgetMode("card");
                  }
                },
              },
              h(BookGlyph, { size: 22 }),
              snap.errors > 0 ? h("span", { className: "vmw-badge" }, snap.errors > 9 ? "9+" : String(snap.errors)) : null,
            ),
          ),
        );
      };
    }

    /* ================================================================== *
     * 模块装配                                                             *
     * ================================================================== */

    let styleEl = null;

    function ensureStyles() {
      if (styleEl && styleEl.isConnected) return;
      styleEl = document.createElement("style");
      styleEl.setAttribute("data-vm", "widget-css");
      styleEl.textContent = TAB_CSS + "\n" + WIDGET_CSS;
      document.head.appendChild(styleEl);
    }

    module.exports = {
      inject: ["slots"],
      apply(ctx) {
        ensureStyles();

        const SidebarIcon = makeSidebarIcon();
        const MainPanel = makeMainPanel();
        const Widget = makeWidget();

        const offs = [];
        try {
          offs.push(
            ctx.slots.inject("sidebar.panellist", () => {
              // islandStandalone 告诉灵动岛本面板支持「拖出成独立悬浮挂件」；
              // 该键为可选，注册失败时退回普通注册。
              try {
                return ctx.slots.register(
                  {
                    name: "sidebar.panellist",
                    id: PANEL_ID,
                    order: 25,
                    label: () => "知识库",
                    islandStandalone: true,
                  },
                  SidebarIcon,
                );
              } catch (e) {
                return ctx.slots.register(
                  { name: "sidebar.panellist", id: PANEL_ID, order: 25, label: () => "知识库" },
                  SidebarIcon,
                );
              }
            }),
          );
        } catch (e) {}
        try {
          offs.push(
            ctx.slots.inject("main", () =>
              ctx.slots.register({ name: "main", key: PANEL_ID }, MainPanel)),
          );
        } catch (e) {}
        try {
          offs.push(
            ctx.slots.inject("shell.overlay", () =>
              ctx.slots.register(
                { name: "shell.overlay", id: WIDGET_ID, order: 25, label: () => "知识库悬浮球" },
                Widget,
              )),
          );
        } catch (e) {}

        return function dispose() {
          for (const off of offs) {
            try {
              if (typeof off === "function") off();
            } catch (e) {}
          }
          if (styleEl) {
            styleEl.remove();
            styleEl = null;
          }
        };
      },
    };

    return module.exports;
  },
});
