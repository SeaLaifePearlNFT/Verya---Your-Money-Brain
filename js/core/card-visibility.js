(function() {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────
  // Card registry.
  //
  // Each card entry has:
  //   key      – stable localStorage key (also used as drag data)
  //   label    – shown in the popover
  //   getEls() – returns live DOM elements to hide/show
  //
  // Groups are collapsible sections in the popover.
  // Within each group, cards can be reordered via drag-and-drop;
  // the order is persisted in localStorage independently of visibility.
  // ─────────────────────────────────────────────────────────────────────────
  let GROUPS = [
    {
      id:    'kpi',
      label: 'KPI Cards',
      cards: [
        { key: 'kpi_bank',    label: 'Bank Account',          getEls: function() { return qsAll('#summaryCards [data-kpi-key="kpi_bank"]'); } },
        { key: 'kpi_noncash', label: 'Non-Cash Balance',       getEls: function() { return qsAll('#summaryCards [data-kpi-key="kpi_noncash"]'); } },
        { key: 'kpi_real',    label: 'Real Daily Budget',      getEls: function() { return qsAll('#summaryCards [data-kpi-key="kpi_real"]'); } },
        { key: 'kpi_target',  label: 'Target Daily Budget',    getEls: function() { return qsAll('#summaryCards [data-kpi-key="kpi_target"]'); } },
        { key: 'kpi_shift',   label: 'Biggest Category Shift', getEls: function() { return qsAll('#summaryCards [data-kpi-key="kpi_shift"]'); } }
      ]
    },
    {
      id:    'overview',
      label: 'Budget Overview',
      cards: [
        { key: 'ov_chart', label: 'Budget Distribution Chart', getEls: function() { return qsAll('.overview-chart-card'); } },
        { key: 'ov_alloc', label: 'Budget Allocation Table',   getEls: function() { return qsAll('.overview-allocation-card'); } }
      ]
    },
    {
      id:    'insights',
      label: 'Smart Insights',
      cards: [
        { key: 'ins_forecast',     label: 'Monthly Forecast',         getEls: function() { return qsAll('#insightGrid .forecast-card'); } },
        { key: 'ins_guidance',     label: 'Budget Guidance',     getEls: function() { return qsAll('#insightGrid .guidance-card'); } },
        { key: 'ins_evolution',    label: 'Spending Trends',        getEls: function() { return qsAll('#insightGrid .evolution-card'); } },
        { key: 'ins_realloc',      label: 'Adjustment Advisor',        getEls: function() { return qsAll('#insightGrid .reallocation-card'); } },
        { key: 'ins_mix_behavior', label: 'Mix & Behaviour (card)',    getEls: function() { return qsAll('#insightGrid .mix-behavior-card'); } },
        { key: 'ins_mix',          label: '↳ Budget Mix',              getEls: function() { return qsAll('#insightGrid .mix-behavior-card .ig-sub-section[data-sub-key="ins_mix"]'); } },
        { key: 'ins_behavior',     label: '↳ Behaviour Insights',      getEls: function() { return qsAll('#insightGrid .mix-behavior-card .ig-sub-section[data-sub-key="ins_behavior"]'); } },
        { key: 'ins_burn_subs',    label: 'Burn & Subscriptions (card)', getEls: function() { return qsAll('#insightGrid .burn-subs-card'); } },
        { key: 'ins_burn',         label: '↳ Burn Rate',               getEls: function() { return qsAll('#insightGrid .burn-subs-card .ig-sub-section[data-sub-key="ins_burn"]'); } },
        { key: 'ins_subs',         label: '↳ Subscription Burden',     getEls: function() { return qsAll('#insightGrid .burn-subs-card .ig-sub-section[data-sub-key="ins_subs"]'); } }
      ]
    },
    {
      id:    'planning',
      label: 'Planning Tools',
      cards: [
        { key: 'plan_goals', label: 'Financial Goals', getEls: function() { return qsAll('[data-view="financial-goals"] .financial-goals-panel-card'); } }
      ]
    }
  ];

  // ── Storage keys ──────────────────────────────────────────────────────────
  let STORAGE_KEY       = 'budgetDashboard_cardVisibilityV2';
  let STORAGE_ORDER_KEY = 'budgetDashboard_cardOrderV1';
  let KPI_ORDER_KEY     = 'budgetDashboard_kpiOrder';

  // ── Helpers ───────────────────────────────────────────────────────────────
  function loadMap() {
    try { let r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : {}; }
    catch(e) { return {}; }
  }
  function saveMap(map) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch(e) {}
  }
  function loadOrder() {
    try { let r = localStorage.getItem(STORAGE_ORDER_KEY); return r ? JSON.parse(r) : {}; }
    catch(e) { return {}; }
  }
  function saveOrder(order) {
    try { localStorage.setItem(STORAGE_ORDER_KEY, JSON.stringify(order)); } catch(e) {}
  }
  function loadKpiOrder() {
    try { let r = localStorage.getItem(KPI_ORDER_KEY); return r ? JSON.parse(r) : null; }
    catch(e) { return null; }
  }
  function saveKpiOrder(arr) {
    try { localStorage.setItem(KPI_ORDER_KEY, JSON.stringify(arr)); } catch(e) {}
  }

  // nth child of a CSS parent (1-based)
  function nthCards(parentSel, n) {
    let parent = document.querySelector(parentSel);
    if (!parent) return [];
    let children = parent.children;
    if (children.length < n) return [];
    return [children[n - 1]];
  }

  function qsAll(sel) {
    return Array.prototype.slice.call(document.querySelectorAll(sel));
  }

  function allCards() {
    let cards = [];
    GROUPS.forEach(function(g) { g.cards.forEach(function(c) { cards.push(c); }); });
    return cards;
  }

  // Return cards for a group in persisted order (falls back to default)
  function orderedCards(group, order) {
    let keys = order[group.id];
    if (!keys || !keys.length) return group.cards.slice();
    let map = {};
    group.cards.forEach(function(c) { map[c.key] = c; });
    let sorted = [];
    keys.forEach(function(k) { if (map[k]) { sorted.push(map[k]); delete map[k]; } });
    // append any new cards not yet in saved order
    group.cards.forEach(function(c) { if (map[c.key]) sorted.push(c); });
    return sorted;
  }

  // ── Core: apply visibility ────────────────────────────────────────────────
  function applyMap(map) {
    allCards().forEach(function(card) {
      let hide = map[card.key] === false;
      card.getEls().forEach(function(el) {
        if (hide) {
          el.style.setProperty('display', 'none', 'important');
        } else {
          el.style.removeProperty('display');
        }
      });
    });
  }

  // ── MutationObserver ──────────────────────────────────────────────────────
  let _observer = null;
  function startObserver() {
    if (_observer) _observer.disconnect();
    let map = loadMap();
    let hasHidden = allCards().some(function(c) { return map[c.key] === false; });
    if (!hasHidden) { _observer = null; return; }
    let targets = [document.querySelector('[data-view="overview"]')].filter(Boolean);
    if (!targets.length) return;
    _observer = new MutationObserver(function() { applyMap(loadMap()); });
    targets.forEach(function(t) { _observer.observe(t, { childList: true, subtree: true }); });
  }

  // ── Toggle widget ─────────────────────────────────────────────────────────
  function makeToggle(key, checked, onChange) {
    let lbl = document.createElement('label');
    lbl.className = 'cv-toggle';
    let input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', function() { onChange(this.checked); });
    let track = document.createElement('span');
    track.className = 'cv-toggle-track';
    lbl.appendChild(input);
    lbl.appendChild(track);
    return lbl;
  }

  // ── Drag-to-reorder ───────────────────────────────────────────────────────
  // State shared across all drag event handlers within a group build
  let _drag = { key: null, groupId: null };

  function makeDragHandle() {
    let handle = document.createElement('span');
    handle.className = 'cvp-drag-handle';
    handle.setAttribute('aria-hidden', 'true');
    handle.title = 'Drag to reorder';
    let svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 8 14');
    svg.setAttribute('width', '8');
    svg.setAttribute('height', '14');
    svg.setAttribute('fill', 'currentColor');
    // Two columns of three dots (⠿ style)
    [[1,1],[5,1],[1,5],[5,5],[1,9],[5,9]].forEach(function(pos) {
      let c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', pos[0]); c.setAttribute('cy', pos[1]); c.setAttribute('r', '1.2');
      svg.appendChild(c);
    });
    handle.appendChild(svg);
    return handle;
  }

  function wireDragRow(row, card, group, itemsEl, countBadge) {
    // Make the whole row draggable via the handle
    let handle = row.querySelector('.cvp-drag-handle');
    if (!handle) return;

    handle.addEventListener('mousedown', function() {
      row.setAttribute('draggable', 'true');
    });
    handle.addEventListener('mouseup', function() {
      // draggable attribute stays until dragend cleans it up
    });

    row.addEventListener('dragstart', function(e) {
      _drag.key     = card.key;
      _drag.groupId = group.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.key);
      // Defer class add so ghost image captures un-dimmed row
      setTimeout(function() { row.classList.add('is-dragging'); }, 0);
    });

    row.addEventListener('dragend', function() {
      row.setAttribute('draggable', 'false');
      row.classList.remove('is-dragging');
      _drag.key = null;
      _drag.groupId = null;
      // Clear all indicators
      let siblings = itemsEl.querySelectorAll('.cvp-item');
      siblings.forEach(function(s) { s.classList.remove('drag-over-above', 'drag-over-below'); });
    });

    row.addEventListener('dragover', function(e) {
      if (_drag.groupId !== group.id || _drag.key === card.key) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      // Determine above/below by cursor position within row
      let rect = row.getBoundingClientRect();
      let mid  = rect.top + rect.height / 2;
      let siblings = itemsEl.querySelectorAll('.cvp-item');
      siblings.forEach(function(s) { s.classList.remove('drag-over-above', 'drag-over-below'); });
      row.classList.add(e.clientY < mid ? 'drag-over-above' : 'drag-over-below');
    });

    row.addEventListener('dragleave', function() {
      row.classList.remove('drag-over-above', 'drag-over-below');
    });

    row.addEventListener('drop', function(e) {
      e.preventDefault();
      if (_drag.groupId !== group.id || _drag.key === card.key) return;
      row.classList.remove('drag-over-above', 'drag-over-below');

      // Rebuild key order from current DOM order, then splice dragged key in
      let rows    = Array.prototype.slice.call(itemsEl.querySelectorAll('.cvp-item'));
      let keys    = rows.map(function(r) { return r.dataset.cardKey; });
      let fromIdx = keys.indexOf(_drag.key);
      let toIdx   = keys.indexOf(card.key);
      if (fromIdx === -1 || toIdx === -1) return;

      // Determine insert position
      let rect = row.getBoundingClientRect();
      let insertBefore = e.clientY < rect.top + rect.height / 2;
      let insertIdx    = insertBefore ? toIdx : toIdx + 1;

      keys.splice(fromIdx, 1);
      if (insertIdx > fromIdx) insertIdx--;
      keys.splice(insertIdx, 0, _drag.key);

      // Persist new order for this group
      let order = loadOrder();
      order[group.id] = keys;
      saveOrder(order);

      // Rebuild only this group's items in new order without full popover rebuild
      rebuildGroupItems(group, itemsEl, countBadge, loadMap(), order);
    });
  }

  // Rebuild just the items list for one group (used after drag-drop)
  function rebuildGroupItems(group, itemsEl, countBadge, map, order) {
    itemsEl.innerHTML = '';
    let cards = orderedCards(group, order);
    cards.forEach(function(card) {
      let row = buildItemRow(card, group, itemsEl, countBadge, map, order);
      itemsEl.appendChild(row);
    });
  }

  function buildItemRow(card, group, itemsEl, countBadge, map, order) {
    let visible = map[card.key] !== false;
    let row     = document.createElement('div');
    row.className       = 'cvp-item';
    row.dataset.cardKey = card.key;

    let handle = makeDragHandle();

    let lbl = document.createElement('span');
    lbl.className   = 'cvp-item-label' + (visible ? '' : ' is-hidden');
    lbl.textContent = card.label;

    let toggle = makeToggle(card.key, visible, function(checked) {
      let currentMap = loadMap();
      currentMap[card.key] = checked;
      saveMap(currentMap);
      applyMap(currentMap);
      lbl.classList.toggle('is-hidden', !checked);
      let nowHidden = group.cards.filter(function(c) { return currentMap[c.key] === false; }).length;
      countBadge.textContent = nowHidden > 0
        ? (group.cards.length - nowHidden) + '/' + group.cards.length
        : 'all';
      startObserver();
    });

    row.appendChild(handle);
    row.appendChild(lbl);
    row.appendChild(toggle);

    wireDragRow(row, card, group, itemsEl, countBadge);
    return row;
  }

  // ── Popover builder ───────────────────────────────────────────────────────
  function buildPopover(map) {
    let container = document.getElementById('cardVisibilityList');
    if (!container) return;
    container.innerHTML = '';

    let order = loadOrder();

    GROUPS.forEach(function(group) {
      let groupEl = document.createElement('div');
      groupEl.className = 'cvp-group is-open';

      // ── Group header ──
      let header = document.createElement('div');
      header.className = 'cvp-group-header';

      let chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      chevron.setAttribute('viewBox', '0 0 10 10');
      chevron.classList.add('cvp-group-chevron');
      let path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M3 2l4 3-4 3');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-linecap', 'round');
      chevron.appendChild(path);

      let titleSpan = document.createElement('span');
      titleSpan.className = 'cvp-group-title';
      titleSpan.textContent = group.label;

      let hiddenCount = group.cards.filter(function(c) { return map[c.key] === false; }).length;
      let countBadge  = document.createElement('span');
      countBadge.className   = 'cvp-group-count';
      countBadge.textContent = hiddenCount > 0
        ? (group.cards.length - hiddenCount) + '/' + group.cards.length
        : 'all';

      header.appendChild(chevron);
      header.appendChild(titleSpan);
      header.appendChild(countBadge);
      header.addEventListener('click', function() { groupEl.classList.toggle('is-open'); });

      // ── Items ──
      let itemsEl = document.createElement('div');
      itemsEl.className = 'cvp-group-items';

      rebuildGroupItems(group, itemsEl, countBadge, map, order);

      groupEl.appendChild(header);
      groupEl.appendChild(itemsEl);
      container.appendChild(groupEl);
    });

    // Footer hint
    let footer = document.createElement('div');
    footer.className   = 'cvp-footer-note';
    footer.textContent = 'Drag ⠿ to reorder within a section';
    container.appendChild(footer);
  }

  // ── KPI row: page-level drag-to-reorder ─────────────────────────────────
  // Cards are already rendered with draggable="true" and data-kpi-key by
  // renderSummary. We wire events on the container (event delegation) so
  // they survive every innerHTML re-render without re-wiring.
  let _kpiDrag = { key: null };

  function wireKpiDrag() {
    let el = document.getElementById('summaryCards');
    if (!el || el.dataset.kpiDragWired) return;
    el.dataset.kpiDragWired = '1';

    el.addEventListener('dragstart', function(e) {
      let card = e.target.closest('[data-kpi-key]');
      if (!card) return;
      _kpiDrag.key = card.dataset.kpiKey;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', _kpiDrag.key);
      setTimeout(function() { card.classList.add('kpi-dragging'); }, 0);
    });

    el.addEventListener('dragend', function(e) {
      let card = e.target.closest('[data-kpi-key]');
      if (card) card.classList.remove('kpi-dragging');
      clearKpiDropIndicators();
      _kpiDrag.key = null;
    });

    el.addEventListener('dragover', function(e) {
      if (!_kpiDrag.key) return;
      let card = e.target.closest('[data-kpi-key]');
      if (!card || card.dataset.kpiKey === _kpiDrag.key) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clearKpiDropIndicators();
      card.classList.add('kpi-drop-target');
    });

    el.addEventListener('dragleave', function(e) {
      if (!el.contains(e.relatedTarget)) clearKpiDropIndicators();
    });

    el.addEventListener('drop', function(e) {
      e.preventDefault();
      let targetCard = e.target.closest('[data-kpi-key]');
      if (!targetCard || !_kpiDrag.key || targetCard.dataset.kpiKey === _kpiDrag.key) {
        clearKpiDropIndicators();
        return;
      }

      // Read current DOM order of keys
      let cards   = Array.prototype.slice.call(el.querySelectorAll('[data-kpi-key]'));
      let keys    = cards.map(function(c) { return c.dataset.kpiKey; });
      let fromIdx = keys.indexOf(_kpiDrag.key);
      let toIdx   = keys.indexOf(targetCard.dataset.kpiKey);
      if (fromIdx === -1 || toIdx === -1) { clearKpiDropIndicators(); return; }

      // Swap the two positions directly
      let tmp = keys[fromIdx];
      keys[fromIdx] = keys[toIdx];
      keys[toIdx] = tmp;

      saveKpiOrder(keys);
      clearKpiDropIndicators();

      // Re-order cards in the DOM immediately
      keys.forEach(function(k) {
        let c = el.querySelector('[data-kpi-key="' + k + '"]');
        if (c) el.appendChild(c);
      });
    });
  }

  function clearKpiDropIndicators() {
    let cards = document.querySelectorAll('#summaryCards .kpi-drop-target');
    cards.forEach(function(c) { c.classList.remove('kpi-drop-target'); });
  }


  // ── Smart Insights Card Registry: canonical card metadata ────────────────
  // Card identity, labels, spans, ordering, and DOM stamping live in one
  // reusable registry instead of scattered layout constants.
  // layout constants. Rendering still uses the proven v1295 card markup, while
  // order/reset/drag metadata is now registry-driven.
  (function installSmartInsightsCardRegistry(){
    if (window.SmartInsightsCardRegistry && window.SmartInsightsCardRegistry.__phase4Registry) return;

    const cards = [
      {
        key: 'forecast',
        label: 'Monthly Forecast',
        description: 'Projected month-end outcome and its main drivers.',
        group: 'forecasting',
        span: 1,
        selector: '[data-insight-key="forecast"], .forecast-card',
        defaultVisible: true
      },
      {
        key: 'guidance',
        label: 'Budget Guidance',
        description: 'Main budget takeaway and spending pace guidance.',
        group: 'guidance',
        span: 1,
        selector: '[data-insight-key="guidance"], .guidance-card',
        defaultVisible: true
      },
      {
        key: 'mix-behavior',
        label: 'Budget Mix & Behavior',
        description: 'Budget composition and behavior-based spending signals.',
        group: 'behavior',
        span: 1,
        selector: '[data-insight-key="mix-behavior"], .mix-behavior-card',
        defaultVisible: true,
        subCards: [
          { key: 'ins_mix', label: 'Budget Mix', selector: '[data-sub-key="ins_mix"]' },
          { key: 'ins_behavior', label: 'Behavior Insights', selector: '[data-sub-key="ins_behavior"]' }
        ]
      },
      {
        key: 'evolution',
        label: 'Spending Trends',
        description: 'Category movement and recent spending evolution.',
        group: 'trends',
        span: 1,
        selector: '[data-insight-key="evolution"], .evolution-card',
        defaultVisible: true
      },
      {
        key: 'reallocation',
        label: 'Adjustment Advisor',
        description: 'Suggested budget adjustments when categories show pressure or opportunity.',
        group: 'planning',
        span: 1,
        selector: '[data-insight-key="reallocation"], .reallocation-card',
        defaultVisible: true
      },
      {
        key: 'burn-subs',
        label: 'Pace & Subscriptions',
        description: 'Spending pace and recurring subscription burden.',
        group: 'pressure',
        span: 1,
        selector: '[data-insight-key="burn-subs"], .burn-subs-card',
        defaultVisible: true,
        subCards: [
          { key: 'ins_burn', label: 'Spending Pace', selector: '[data-sub-key="ins_burn"]' },
          { key: 'ins_subs', label: 'Subscription Burden', selector: '[data-sub-key="ins_subs"]' }
        ]
      }
    ];

    const byKey = Object.create(null);
    cards.forEach(function(card){ byKey[card.key] = card; });

    function normalizeKey(key){
      const raw = String(key || '').trim();
      if (raw === 'mix_behavior') return 'mix-behavior';
      if (raw === 'burn_subs') return 'burn-subs';
      return raw;
    }
    function all(){ return cards.slice(); }
    function get(key){ return byKey[normalizeKey(key)] || null; }
    function defaultOrder(){ return cards.filter(function(card){ return card.defaultVisible !== false; }).map(function(card){ return card.key; }); }
    function spans(){
      return cards.reduce(function(map, card){ map[card.key] = Number(card.span || 1); return map; }, {});
    }
    function applyToGrid(grid){
      if (!grid) return;
      cards.forEach(function(card){
        let el = grid.querySelector(card.selector);
        if (!el) return;
        el.setAttribute('data-insight-key', card.key);
        el.setAttribute('data-card-key', card.key);
        el.setAttribute('data-insight-card-label', card.label);
        el.setAttribute('data-insight-card-group', card.group || 'general');
        if (card.description) {
          el.setAttribute('data-insight-card-description', card.description);
          el.setAttribute('title', card.description);
        }
        el.setAttribute('data-insight-span', String(Number(card.span || 1)));
        el.setAttribute('draggable', 'true');
        if (Array.isArray(card.subCards)) {
          card.subCards.forEach(function(sub){
            let subEl = el.querySelector(sub.selector);
            if (!subEl) return;
            subEl.setAttribute('data-sub-key', sub.key);
            subEl.setAttribute('data-card-key', sub.key);
            subEl.setAttribute('data-insight-card-label', sub.label);
            if (sub.label) subEl.setAttribute('title', sub.label);
          });
        }
      });
      grid.setAttribute('data-insight-registry-version', 'phase4');
    }
    window.SmartInsightsCardRegistry = {
      __phase4Registry: true,
      all: all,
      get: get,
      defaultOrder: defaultOrder,
      spans: spans,
      applyToGrid: applyToGrid
    };
  })();

  // ── Unified CardLayoutManager: reusable drag/order foundation ──────────────
  // Phase 3 cleanup: Smart Insights now uses the same generic layout manager
  // pattern that can later be reused by Overview, planner cards, and future tabs.
  (function installCardLayoutManager(){
    if (window.CardLayoutManager && window.CardLayoutManager.__phase3Unified) return;

    const STORAGE_KEY = 'budgetDashboard_cardOrderV1';
    const LEGACY_SMART_INSIGHTS_KEY = 'budgetDashboard_insightOrder';

    const registry = {
      smartInsights: {
        storageKey: 'smartInsights',
        legacyKeys: ['insights', 'smart_insights'],
        legacyLocalStorageKeys: [LEGACY_SMART_INSIGHTS_KEY],
        gridSelector: '#insightGrid',
        itemSelector: '[data-insight-key]',
        keyAttributes: ['data-insight-key', 'data-card-key', 'data-insight-card', 'data-card-id'],
        draggingClass: 'ig-dragging',
        dropTargetClass: 'ig-drop-target',
        customAttribute: 'data-ig-custom',
        defaultOrder: (window.SmartInsightsCardRegistry && window.SmartInsightsCardRegistry.defaultOrder ? window.SmartInsightsCardRegistry.defaultOrder() : ['forecast', 'guidance', 'mix-behavior', 'evolution', 'reallocation', 'burn-subs']),
        aliases: {
          'mix_behavior': 'mix-behavior',
          'burn_subs': 'burn-subs'
        },
        spans: (window.SmartInsightsCardRegistry && window.SmartInsightsCardRegistry.spans ? window.SmartInsightsCardRegistry.spans() : {
          'forecast': 1,
          'guidance': 1,
          'mix-behavior': 1,
          'evolution': 1,
          'reallocation': 1,
          'burn-subs': 1
        })
      }
    };

    const dragState = Object.create(null);

    function config(name){ return registry[name] || null; }
    function grid(name){
      const cfg = config(name);
      return cfg ? document.querySelector(cfg.gridSelector) : null;
    }
    function safeParse(raw){
      try { return raw ? JSON.parse(raw) : null; }
      catch(e) { return null; }
    }
    function readStore(){
      const parsed = safeParse(localStorage.getItem(STORAGE_KEY));
      return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    }
    function writeStore(store){
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store || {})); }
      catch(e) {}
    }
    function normalizeKey(name, key){
      const cfg = config(name);
      if (!cfg || key == null) return '';
      const raw = String(key).trim();
      return cfg.aliases && cfg.aliases[raw] ? cfg.aliases[raw] : raw;
    }
    function stampKey(name, item, fallbackIndex){
      const cfg = config(name);
      if (!cfg || !item) return '';
      let key = '';
      for (let i = 0; i < cfg.keyAttributes.length; i++) {
        key = item.getAttribute(cfg.keyAttributes[i]) || '';
        if (key) break;
      }
      key = normalizeKey(name, key || ('card_' + fallbackIndex));
      if (cfg.keyAttributes.indexOf('data-insight-key') !== -1) item.setAttribute('data-insight-key', key);
      item.setAttribute('data-card-key', key);
      return key;
    }
    function items(name){
      const cfg = config(name);
      const g = grid(name);
      if (!cfg || !g) return [];
      return Array.prototype.slice.call(g.querySelectorAll(':scope > ' + cfg.itemSelector));
    }
    function currentOrder(name){
      return items(name).map(function(item, index){ return stampKey(name, item, index); }).filter(Boolean);
    }
    function uniqueValidOrder(name, order){
      const cfg = config(name);
      if (!cfg || !Array.isArray(order)) return [];
      const seen = Object.create(null);
      return order.map(function(k){ return normalizeKey(name, k); }).filter(function(k){
        if (!k || seen[k]) return false;
        seen[k] = true;
        return true;
      });
    }
    function readOrder(name){
      const cfg = config(name);
      if (!cfg) return [];
      const store = readStore();
      let order = uniqueValidOrder(name, store[cfg.storageKey]);
      if (order.length) return order;
      for (let i = 0; i < (cfg.legacyKeys || []).length; i++) {
        order = uniqueValidOrder(name, store[cfg.legacyKeys[i]]);
        if (order.length) return order;
      }
      for (let j = 0; j < (cfg.legacyLocalStorageKeys || []).length; j++) {
        order = uniqueValidOrder(name, safeParse(localStorage.getItem(cfg.legacyLocalStorageKeys[j])));
        if (order.length) return order;
      }
      return [];
    }
    function saveOrder(name, order){
      const cfg = config(name);
      const clean = uniqueValidOrder(name, order);
      if (!cfg || !clean.length) return;
      const store = readStore();
      store[cfg.storageKey] = clean;
      (cfg.legacyKeys || []).forEach(function(k){ store[k] = clean; });
      writeStore(store);
      (cfg.legacyLocalStorageKeys || []).forEach(function(k){
        try { localStorage.setItem(k, JSON.stringify(clean)); } catch(e) {}
      });
    }
    function clearOrder(name){
      const cfg = config(name);
      if (!cfg) return;
      const store = readStore();
      delete store[cfg.storageKey];
      (cfg.legacyKeys || []).forEach(function(k){ delete store[k]; });
      writeStore(store);
      (cfg.legacyLocalStorageKeys || []).forEach(function(k){
        try { localStorage.removeItem(k); } catch(e) {}
      });
    }
    function applyOrder(name, preferredOrder, options){
      const cfg = config(name);
      const g = grid(name);
      if (!cfg || !g) return;
      const all = items(name);
      if (!all.length) return;

      const byKey = Object.create(null);
      all.forEach(function(item, index){ byKey[stampKey(name, item, index)] = item; });

      let order = uniqueValidOrder(name, preferredOrder || []);
      if (!order.length) order = readOrder(name);
      const forceDefault = options && options.forceDefault;
      if (forceDefault) order = cfg.defaultOrder.slice();

      if (!order.length && !forceDefault) {
        g.removeAttribute(cfg.customAttribute);
        return;
      }

      g.setAttribute(cfg.customAttribute, '1');
      const fragment = document.createDocumentFragment();
      const used = new Set();
      order.forEach(function(key){
        const item = byKey[normalizeKey(name, key)];
        if (!item || used.has(item)) return;
        if (cfg.spans && cfg.spans[key]) item.setAttribute('data-insight-span', String(cfg.spans[key]));
        fragment.appendChild(item);
        used.add(item);
      });
      all.forEach(function(item){ if (!used.has(item)) fragment.appendChild(item); });
      g.appendChild(fragment);

      if (order.length || forceDefault) saveOrder(name, currentOrder(name));
    }
    function reset(name){
      const cfg = config(name);
      if (!cfg) return;
      clearOrder(name);
      applyOrder(name, cfg.defaultOrder.slice(), { forceDefault: true });
    }
    function clearIndicators(name){
      const cfg = config(name);
      const g = grid(name);
      if (!cfg || !g) return;
      g.querySelectorAll('.' + cfg.dropTargetClass).forEach(function(item){ item.classList.remove(cfg.dropTargetClass); });
    }
    function wire(name){
      const cfg = config(name);
      const g = grid(name);
      if (!cfg || !g || g.dataset.cardLayoutManagerWired === name) return;
      g.dataset.cardLayoutManagerWired = name;
      g.dataset.igDragWired = 'phase3';
      dragState[name] = dragState[name] || { key: null };

      g.addEventListener('dragstart', function(e){
        const item = e.target.closest(cfg.itemSelector);
        if (!item || !g.contains(item)) return;
        const key = stampKey(name, item, 0);
        dragState[name].key = key;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', key);
        setTimeout(function(){ item.classList.add(cfg.draggingClass); }, 0);
      });
      g.addEventListener('dragend', function(e){
        const item = e.target.closest(cfg.itemSelector);
        if (item) item.classList.remove(cfg.draggingClass);
        clearIndicators(name);
        dragState[name].key = null;
        saveOrder(name, currentOrder(name));
      });
      g.addEventListener('dragover', function(e){
        if (!dragState[name].key) return;
        const item = e.target.closest(cfg.itemSelector);
        if (!item || !g.contains(item) || stampKey(name, item, 0) === dragState[name].key) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        clearIndicators(name);
        item.classList.add(cfg.dropTargetClass);
      });
      g.addEventListener('dragleave', function(e){
        if (!g.contains(e.relatedTarget)) clearIndicators(name);
      });
      g.addEventListener('drop', function(e){
        e.preventDefault();
        const target = e.target.closest(cfg.itemSelector);
        const sourceKey = dragState[name].key;
        const targetKey = target ? stampKey(name, target, 0) : '';
        if (!target || !g.contains(target) || !sourceKey || targetKey === sourceKey) {
          clearIndicators(name);
          return;
        }
        const order = currentOrder(name);
        const from = order.indexOf(sourceKey);
        const to = order.indexOf(targetKey);
        if (from === -1 || to === -1) { clearIndicators(name); return; }
        const tmp = order[from];
        order[from] = order[to];
        order[to] = tmp;
        saveOrder(name, order);
        clearIndicators(name);
        applyOrder(name, order);
      });
    }
    function ensure(name){
      const g = grid(name);
      if (name === 'smartInsights' && g && window.SmartInsightsCardRegistry && typeof window.SmartInsightsCardRegistry.applyToGrid === 'function') {
        window.SmartInsightsCardRegistry.applyToGrid(g);
      }
      currentOrder(name);
      wire(name);
      applyOrder(name);
    }

    window.CardLayoutManager = {
      __phase3Unified: true,
      ensure: ensure,
      applyOrder: applyOrder,
      reset: reset,
      readOrder: readOrder,
      saveOrder: saveOrder,
      clearOrder: clearOrder,
      currentOrder: currentOrder
    };
  })();

  function applyInsightOrder() {
    if (window.CardLayoutManager) window.CardLayoutManager.applyOrder('smartInsights');
  }

  function wireInsightDrag() {
    if (window.CardLayoutManager) window.CardLayoutManager.ensure('smartInsights');
  }

  function clearIgDropIndicators() {
    let cards = document.querySelectorAll('#insightGrid .ig-drop-target');
    cards.forEach(function(c) { c.classList.remove('ig-drop-target'); });
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function initCardVisibilityPopover() {
    let btn     = document.getElementById('customizeCardsBtn');
    let popover = document.getElementById('cardVisibilityPopover');
    let anchor  = document.getElementById('customizeCardsAnchor');
    if (!btn || !popover || !anchor) return;

    // Render the customiser as a body-level modal so the sticky sidebar cannot
    // clip it or place it behind the main workspace.
    if (popover.parentElement !== document.body) {
      document.body.appendChild(popover);
    }

    let backdrop = document.getElementById('cardVisibilityPopoverBackdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'cardVisibilityPopoverBackdrop';
      backdrop.className = 'card-visibility-popover-backdrop';
      document.body.appendChild(backdrop);
    }

    function setPopoverOpen(open) {
      popover.classList.toggle('is-open', !!open);
      backdrop.classList.toggle('is-open', !!open);
      document.body.classList.toggle('cvp-modal-open', !!open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) buildPopover(loadMap());
    }

    // Inject reset button once
    let head = popover.querySelector('.cvp-head');
    if (head && !head.querySelector('.cvp-reset-btn')) {
      let resetBtn       = document.createElement('button');
      resetBtn.className = 'cvp-reset-btn';
      resetBtn.type      = 'button';
      resetBtn.textContent = 'Reset all';
      resetBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        saveMap({});
        saveOrder({});
        saveKpiOrder(null);
        saveIgOrder(null);
        try { localStorage.removeItem(KPI_ORDER_KEY); } catch(e2) {}
        try { localStorage.removeItem(IG_ORDER_KEY); } catch(e3) {}
        // Remove custom-mode attribute so named-area default layout restores
        let ig = document.getElementById('insightGrid');
        if (ig) ig.removeAttribute('data-ig-custom');
        applyMap({});
        buildPopover({});
        startObserver();
        // Re-render restores both KPI and insight default order
        if (typeof render === 'function') render('overview');
      });
      head.appendChild(resetBtn);
    }

    let map = loadMap();
    applyMap(map);
    buildPopover(map);
    startObserver();
    wireKpiDrag();
    applyInsightOrder();
    wireInsightDrag();

    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      setPopoverOpen(!popover.classList.contains('is-open'));
    });

    backdrop.addEventListener('click', function() {
      setPopoverOpen(false);
    });

    document.addEventListener('click', function(e) {
      if (!popover.classList.contains('is-open')) return;
      if (!anchor.contains(e.target) && !popover.contains(e.target)) {
        setPopoverOpen(false);
      }
    });

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') setPopoverOpen(false);
    });

    // Keep the customiser available as a sidebar modal.
    // The controls affect overview cards; opening it rebuilds from saved state.
    let viewNav = document.getElementById('viewNav');
    if (viewNav) {
      viewNav.addEventListener('click', function() {
        setTimeout(function() { applyMap(loadMap()); }, 30);
      });
    }

    // Re-apply after month switch.
    // Both summaryCards and insightGrid innerHTML are fully replaced on month
    // switch, so wire-guard flags must be cleared and drag re-wired each time.
    let monthList = document.querySelector('.month-list');
    if (monthList) {
      monthList.addEventListener('click', function(e) {
        if (e.target.closest('.month-btn')) {
          setTimeout(function() {
            applyMap(loadMap());
            startObserver();
            let sc = document.getElementById('summaryCards');
            if (sc) delete sc.dataset.kpiDragWired;
            wireKpiDrag();
            let ig = document.getElementById('insightGrid');
            if (ig) delete ig.dataset.igDragWired;
            applyInsightOrder();
            wireInsightDrag();
          }, 60);
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCardVisibilityPopover, { once: true });
  } else {
    initCardVisibilityPopover();
  }
})();
