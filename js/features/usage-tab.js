(function() {
  'use strict';

  /* ── Constants ─────────────────────────────────────────────────────── */
  let CHECKIN_INTERVALS = { daily: 1, weekly: 7, monthly: 30 };
  let WARN_SOFT_DAYS    = 30;
  let WARN_MEDIUM_DAYS  = 60;
  let WARN_STRONG_DAYS  = 90;
  let MAX_INSIGHTS_ROWS = 3;

  /* ── Carousel state ─────────────────────────────────────────────────── */

  /* ── State helpers ─────────────────────────────────────────────────── */

  function ensureUsageItems(rootState) {
    if (!rootState || typeof rootState !== 'object') return [];
    if (!Array.isArray(rootState.usageItems)) rootState.usageItems = [];
    return rootState.usageItems;
  }

  function getUsageItems() {
    return ensureUsageItems(window.state);
  }

  function saveUsageItems() {
    if (typeof window.saveState === 'function') window.saveState(window.state);
  }

  function generateUsageId() {
    return 'usage-' + Date.now() + '-' + Math.floor(Math.random() * 9999);
  }

  function normalizeUsageItem(item) {
    if (!item || typeof item !== 'object') return null;
    return {
      id:               item.id || generateUsageId(),
      linkedSubscriptionId: String(item.linkedSubscriptionId || '').trim(),
      source:           String(item.source || '').trim(),
      billingStartMonth: /^\d{4}-\d{2}$/.test(String(item.billingStartMonth || item.subscriptionStartMonth || '')) ? String(item.billingStartMonth || item.subscriptionStartMonth) : '',
      subscriptionStartMonth: /^\d{4}-\d{2}$/.test(String(item.subscriptionStartMonth || item.billingStartMonth || '')) ? String(item.subscriptionStartMonth || item.billingStartMonth) : '',
      subscriptionEndMonth: /^\d{4}-\d{2}$/.test(String(item.subscriptionEndMonth || '')) ? String(item.subscriptionEndMonth) : '',
      subscriptionCadence: ['monthly','quarterly','yearly'].includes(String(item.subscriptionCadence || '').toLowerCase()) ? String(item.subscriptionCadence).toLowerCase() : '',
      name:             String(item.name || '').trim(),
      price:            Number(item.price) || 0,
      billingFrequency: item.billingFrequency === 'yearly' ? 'yearly' : 'monthly',
      checkInFrequency: ['daily','weekly','monthly'].includes(item.checkInFrequency) ? item.checkInFrequency : 'weekly',
      category:         String(item.category || '').trim(),
      notes:            String(item.notes || '').trim(),
      createdAt:        item.createdAt || new Date().toISOString(),
      lastCheckInAt:    item.lastCheckInAt || null,
      lastUsedAt:       item.lastUsedAt || null,
      /* IMPROVEMENT 1:
         history entries now carry a `period` key (YYYY-MM or YYYY-WW or YYYY-DDD)
         so each check-in is scoped to its period and new periods don't overwrite old ones.
         A new check-in for an already-answered period replaces that period's entry.  */
      history:          Array.isArray(item.history) ? item.history : []
    };
  }

  /* ── Period key helpers (IMPROVEMENT 1) ─────────────────────────────── */
  // Each check-in is stamped with a period key so responses are stored per-period,
  // not per-timestamp. When a new period opens the item is "due" again automatically.

  function periodKey(freq, date) {
    let d = date ? new Date(date) : new Date();
    let y = d.getFullYear();
    if (freq === 'daily') {
      // YYYY-DDD (day of year)
      let start = new Date(y, 0, 0);
      let diff  = d - start;
      let day   = Math.floor(diff / 86400000);
      return y + '-D' + String(day).padStart(3, '0');
    }
    if (freq === 'monthly') {
      return y + '-M' + String(d.getMonth() + 1).padStart(2, '0');
    }
    // weekly — ISO week number
    let jan4  = new Date(y, 0, 4);
    let dayNum = (d - jan4) / 86400000;
    let week   = Math.ceil((dayNum + jan4.getDay() + 1) / 7);
    return y + '-W' + String(week).padStart(2, '0');
  }

  function usageReferenceDate() {
    try {
      if (typeof getActiveMonth === 'function' && typeof parseMonthYear === 'function') {
        let activeMonth = getActiveMonth();
        let parsed = parseMonthYear(activeMonth && activeMonth.name);
        if (parsed && Number.isFinite(parsed.year) && Number.isFinite(parsed.monthIndex)) {
          return new Date(parsed.year, parsed.monthIndex, 15, 12, 0, 0, 0);
        }
      }
    } catch(e) {}
    return new Date();
  }


  function usageMonthKey(refDate) {
    let d = refDate instanceof Date && !isNaN(refDate.getTime()) ? refDate : usageReferenceDate();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function currentCalendarMonthKey() {
    let d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function monthLabelFromUsageKey(monthKey) {
    let match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
    if (!match) return String(monthKey || '');
    return new Date(Number(match[1]), Number(match[2]) - 1, 1)
      .toLocaleDateString('en-BE', { month: 'short', year: 'numeric' });
  }

  function isEditableUsageMonth(refDate) {
    return usageMonthKey(refDate) === currentCalendarMonthKey();
  }

  function monthKeyDelta(fromMonthKey, toMonthKey) {
    let from = String(fromMonthKey || '').split('-').map(Number);
    let to = String(toMonthKey || '').split('-').map(Number);
    if (from.length !== 2 || to.length !== 2 || !Number.isFinite(from[0]) || !Number.isFinite(from[1]) || !Number.isFinite(to[0]) || !Number.isFinite(to[1])) return NaN;
    return ((to[0] - from[0]) * 12) + ((to[1] - 1) - (from[1] - 1));
  }

  function usageItemExistsInMonth(item, monthKey) {
    if (!item || !/^\d{4}-\d{2}$/.test(String(monthKey || ''))) return false;
    let startMonth = String(item.subscriptionStartMonth || item.billingStartMonth || '').trim();
    if (!/^\d{4}-\d{2}$/.test(startMonth) && item.createdAt) startMonth = usageMonthKey(new Date(item.createdAt));
    if (!/^\d{4}-\d{2}$/.test(startMonth)) return true;
    let afterStart = monthKeyDelta(startMonth, monthKey);
    if (!Number.isFinite(afterStart) || afterStart < 0) return false;
    let endMonth = String(item.subscriptionEndMonth || '').trim();
    if (/^\d{4}-\d{2}$/.test(endMonth)) {
      let beforeEnd = monthKeyDelta(monthKey, endMonth);
      if (!Number.isFinite(beforeEnd) || beforeEnd < 0) return false;
    }
    return true;
  }

  function dateFromUsagePeriod(period) {
    let raw = String(period || '');
    let monthly = raw.match(/^(\d{4})-M(\d{2})$/);
    if (monthly) return new Date(Number(monthly[1]), Number(monthly[2]) - 1, 15, 12, 0, 0, 0);
    let daily = raw.match(/^(\d{4})-D(\d{3})$/);
    if (daily) return new Date(Number(daily[1]), 0, Number(daily[2]), 12, 0, 0, 0);
    let weekly = raw.match(/^(\d{4})-W(\d{2})$/);
    if (weekly) return new Date(Number(weekly[1]), 0, 1 + ((Number(weekly[2]) - 1) * 7), 12, 0, 0, 0);
    return null;
  }

  function usageEntryMonthKey(entry) {
    if (!entry) return '';
    let d = entry.date ? new Date(entry.date) : dateFromUsagePeriod(entry.period);
    return d && !isNaN(d.getTime()) ? usageMonthKey(d) : '';
  }

  function usageEntriesForMonth(item, monthKey) {
    if (!item || !Array.isArray(item.history)) return [];
    return item.history.filter(function(entry) { return usageEntryMonthKey(entry) === monthKey; });
  }

  function latestUsageEntryForMonth(item, monthKey) {
    let entries = usageEntriesForMonth(item, monthKey).filter(function(entry) { return entry && entry.response; });
    entries.sort(function(a, b) { return String(a.date || '') < String(b.date || '') ? -1 : 1; });
    return entries.length ? entries[entries.length - 1] : null;
  }

  function usageCountForMonth(item, monthKey) {
    let total = 0;
    let found = false;
    usageEntriesForMonth(item, monthKey).forEach(function(entry) {
      if (entry && entry.usageCount != null) {
        total += Number(entry.usageCount) || 0;
        found = true;
      }
    });
    return found ? total : null;
  }

  function visibleUsageItemsForReference(items, refDate) {
    let monthKey = usageMonthKey(refDate);
    return (items || []).filter(function(item) {
      // A usage card belongs in a viewed month when the linked subscription or
      // standalone usage tracker existed in that month. Closed months are
      // read-only, but they must still show the historical card shell even when
      // no check-in was saved for that month; the card itself then displays a
      // clear "no saved check-in" state instead of leaking the latest month.
      return usageItemExistsInMonth(item, monthKey);
    });
  }

  function sameCalendarMonth(a, b) {
    return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
  }

  function checkinTimestampForReference(refDate) {
    let now = new Date();
    let ref = refDate instanceof Date && !isNaN(refDate.getTime()) ? refDate : usageReferenceDate();
    return sameCalendarMonth(now, ref) ? now.toISOString() : new Date(ref.getFullYear(), ref.getMonth(), 15, 12, 0, 0, 0).toISOString();
  }

  function currentPeriodKey(item, refDate) {
    return periodKey(item.checkInFrequency, refDate || usageReferenceDate());
  }

  function lastHistoryEntry(item) {
    if (!item.history || !item.history.length) return null;
    return item.history[item.history.length - 1];
  }

  function entryForCurrentPeriod(item, refDate) {
    let key = currentPeriodKey(item, refDate);
    // Search backwards — most recent first
    for (let i = item.history.length - 1; i >= 0; i--) {
      if (item.history[i].period === key) return item.history[i];
    }
    return null;
  }

  function currentResponse(item, refDate) {
    let cur = entryForCurrentPeriod(item, refDate);
    return cur ? cur.response : null;
  }

  function currentUsageCount(item, refDate) {
    let cur = entryForCurrentPeriod(item, refDate);
    return (cur && cur.usageCount != null) ? cur.usageCount : null;
  }

  function responseDisplayLabel(resp) {
    if (resp === 'yes') return 'Yes';
    if (resp === 'little') return 'A little';
    if (resp === 'no') return 'No';
    return '—';
  }

  /* ── Core logic ────────────────────────────────────────────────────── */

  function monthlyCost(item) {
    return item.billingFrequency === 'yearly' ? item.price / 12 : item.price;
  }

  function isCheckInDue(item, refDate) {
    return entryForCurrentPeriod(item, refDate) === null;
  }

  function daysSince(isoString) {
    if (!isoString) return Infinity;
    return (Date.now() - new Date(isoString).getTime()) / (24 * 60 * 60 * 1000);
  }

  function warningLevel(item) {
    let days = daysSince(item.lastUsedAt);
    if (days === Infinity) days = daysSince(item.createdAt);
    if (days >= WARN_STRONG_DAYS) return 'strong';
    if (days >= WARN_MEDIUM_DAYS) return 'medium';
    if (days >= WARN_SOFT_DAYS)   return 'soft';
    return 'none';
  }

  function lastResponse(item, refDate) {
    let cur = entryForCurrentPeriod(item, refDate);
    if (cur) return cur.response;
    let last = lastHistoryEntry(item);
    return last ? last.response : null;
  }

  function lastUsageCount(item, refDate) {
    let cur = entryForCurrentPeriod(item, refDate);
    if (cur && cur.usageCount != null) return cur.usageCount;
    let last = lastHistoryEntry(item);
    return (last && last.usageCount != null) ? last.usageCount : null;
  }

  // ── Phase 2b: Billing-cycle-aware aggregation ─────────────────────────
  //
  // billingCycleWindow(item) returns { start: Date, end: Date } representing
  // the current billing cycle, anchored to billingStartMonth (from the linked
  // subscription's startMonth) or createdAt as fallback.
  //
  // Monthly  → current calendar month (1st → last day)
  // Yearly   → 12-month window from the anchor month in the current or most
  //            recent past cycle year (e.g. anchor=March → Mar 2025–Feb 2026)
  // Daily    → current calendar day (for completeness)

  function billingCycleWindow(item, refDate) {
    let now    = refDate instanceof Date && !isNaN(refDate.getTime()) ? refDate : usageReferenceDate();
    let nowY   = now.getFullYear();
    let nowM   = now.getMonth(); // 0-based

    if (item.billingFrequency === 'monthly') {
      // Calendar month containing today
      let start = new Date(nowY, nowM, 1, 0, 0, 0, 0);
      let end   = new Date(nowY, nowM + 1, 0, 23, 59, 59, 999);
      return { start: start, end: end };
    }

    if (item.billingFrequency === 'yearly') {
      // Anchor: billingStartMonth (YYYY-MM) → fallback to createdAt month
      let anchor = item.billingStartMonth || item.createdAt;
      let anchorDate = anchor
        ? (/^\d{4}-\d{2}$/.test(String(anchor))
            ? new Date(parseInt(anchor.slice(0,4),10), parseInt(anchor.slice(5,7),10)-1, 1)
            : new Date(anchor))
        : new Date(nowY - 1, nowM, 1);

      let aY = anchorDate.getFullYear();
      let aM = anchorDate.getMonth(); // 0-based

      // Find the most recent cycle start that is <= today
      // Cycle starts on aM each year; find which year puts us in the window
      let cycleStartYear = nowY;
      // If this year's anchor month is in the future, step back one year
      if (nowM < aM || (nowM === aM && now.getDate() < 1)) {
        cycleStartYear = nowY - 1;
      }
      // Also handle case where anchor year itself is later than nowY
      if (aY > cycleStartYear) cycleStartYear = aY;

      let start = new Date(cycleStartYear, aM, 1, 0, 0, 0, 0);
      let end   = new Date(cycleStartYear + 1, aM, 0, 23, 59, 59, 999);
      return { start: start, end: end };
    }

    // Daily — just today
    let start = new Date(nowY, nowM, now.getDate(), 0, 0, 0, 0);
    let end   = new Date(nowY, nowM, now.getDate(), 23, 59, 59, 999);
    return { start: start, end: end };
  }

  // Sum all usageCounts from history entries whose date falls within the
  // current billing cycle window. Returns null if no counts exist in window.
  function cycleUsageCount(item, refDate) {
    if (!item.history || !item.history.length) return null;
    let win   = billingCycleWindow(item, refDate);
    let total = 0;
    let found = false;
    for (let i = 0; i < item.history.length; i++) {
      let entry = item.history[i];
      if (!entry.date || entry.usageCount == null) continue;
      let d = new Date(entry.date);
      if (d >= win.start && d <= win.end) {
        total += entry.usageCount;
        found  = true;
      }
    }
    return found ? total : null;
  }

  // Cost per use, calculated over the full billing cycle
  function costPerUse(item, refDate) {
    let cnt = cycleUsageCount(item, refDate);
    if (cnt == null || cnt === 0) return null;
    // For yearly: use full annual cost; for monthly: monthly cost
    let cost = item.billingFrequency === 'yearly' ? item.price : monthlyCost(item);
    return cost / cnt;
  }

  // How far through the current billing cycle are we? (0–1)
  // Used to contextualise cost/use: "8 uses so far, 3 months into the year"
  function cycleFraction(item, refDate) {
    let win     = billingCycleWindow(item, refDate);
    let total   = win.end.getTime() - win.start.getTime();
    let elapsed = Date.now() - win.start.getTime();
    if (total <= 0) return 1;
    return Math.min(1, Math.max(0, elapsed / total));
  }

  // Human-readable cycle progress label, e.g. "Apr 2026" or "Mar 2025 – Feb 2026"
  function cycleWindowLabel(item, refDate) {
    let win = billingCycleWindow(item, refDate);
    let opts = { month: 'short', year: 'numeric' };
    if (item.billingFrequency === 'monthly') {
      return win.start.toLocaleDateString('en-BE', opts);
    }
    if (item.billingFrequency === 'yearly') {
      return win.start.toLocaleDateString('en-BE', opts)
        + ' – '
        + new Date(win.end.getFullYear(), win.end.getMonth(), 1)
            .toLocaleDateString('en-BE', opts);
    }
    return win.start.toLocaleDateString('en-BE', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* ══════════════════════════════════════════════════════════════════
     VALUE SCORE ENGINE — v728  (spec §2A, §2B, §3)
     ══════════════════════════════════════════════════════════════════ */

  // §2A — Response → points
  function responseScore(resp) {
    if (resp === 'yes')    return 100;
    if (resp === 'little') return 45;
    if (resp === 'no')     return 0;
    return null; // unknown
  }

  // §2A — Count → points
  function countScore(cnt) {
    if (cnt == null) return null;
    if (cnt === 0) return 0;
    if (cnt === 1) return 30;
    if (cnt === 2) return 55;
    if (cnt === 3) return 75;
    return 100; // 4+
  }

  // §2A — Usage Quality Score with recency weighting over last 3 check-ins
  function usageQualityScore(item) {
    let history = item.history || [];
    let cnt     = lastUsageCount(item);
    let cntPts  = countScore(cnt);

    // Build recency-weighted response score from up to 3 most recent responses
    let respEntries = [];
    for (let i = history.length - 1; i >= 0 && respEntries.length < 3; i--) {
      if (history[i].response) respEntries.push(history[i].response);
    }

    let respPts = null;
    if (respEntries.length >= 3) {
      respPts = Math.round(
        responseScore(respEntries[0]) * 0.50 +
        responseScore(respEntries[1]) * 0.30 +
        responseScore(respEntries[2]) * 0.20
      );
    } else if (respEntries.length > 0) {
      respPts = responseScore(respEntries[0]);
    }

    // Combine
    if (respPts !== null && cntPts !== null) {
      return Math.round(respPts * 0.6 + cntPts * 0.4);
    }
    if (respPts !== null) return respPts;
    if (cntPts !== null)  return cntPts;
    return 50; // neutral insufficient-data baseline
  }

  // §2B — Base cost tier score
  function baseCostTierScore(mc) {
    if (mc <= 5)    return 100;
    if (mc <= 10)   return 85;
    if (mc <= 20)   return 65;
    if (mc <= 35)   return 45;
    if (mc <= 60)   return 25;
    return 10;
  }

  // §2B — Cost Efficiency Score
  function costEfficiencyScore(mc, uqs) {
    let base = baseCostTierScore(mc);
    let adj  = 0;
    if (uqs >= 75)      adj = +10;
    else if (uqs >= 50) adj = 0;
    else if (uqs >= 25) adj = -10;
    else                adj = -20;
    return Math.max(0, Math.min(100, base + adj));
  }

  // §2 Final Value Score (0–100)
  function computeValueScore(item) {
    let mc  = monthlyCost(item);
    let uqs = usageQualityScore(item);
    let ces = costEfficiencyScore(mc, uqs);
    return Math.max(0, Math.min(100, Math.round(uqs * 0.70 + ces * 0.30)));
  }

  // §3 — Map score to label
  function scoreTier(n) {
    if (n >= 75) return { label: 'High value',  key: 'high',     cls: 'vs-high' };
    if (n >= 50) return { label: 'Moderate',    key: 'moderate', cls: 'vs-moderate' };
    if (n >= 25) return { label: 'Low value',   key: 'low',      cls: 'vs-low' };
    return           { label: 'Waste',         key: 'waste',    cls: 'vs-waste' };
  }

  // Public entry point — returns { n, label, key, cls }
  function valueScore(item) {
    let n    = computeValueScore(item);
    let tier = scoreTier(n);
    return { n: n, label: tier.label, key: tier.key, cls: tier.cls };
  }

  function dueCount() {
    let refDate = usageReferenceDate();
    if (!isEditableUsageMonth(refDate)) return 0;
    return visibleUsageItemsForReference(getUsageItems(), refDate).filter(function(item) { return isCheckInDue(item, refDate); }).length;
  }

  /* ── Formatting helpers ──────────────────────────────────────────────── */

  function fmt(val) {
    if (typeof window.formatCurrency === 'function') return window.formatCurrency(val);
    return '€' + Number(val || 0).toFixed(2);
  }

  function fmtDate(isoString) {
    if (!isoString) return '—';
    try { return new Date(isoString).toLocaleDateString('en-BE', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch(e) { return isoString; }
  }

  function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Resolve the category colour for a usage item.
  // Tries: 1) getCategoryColor global (custom + palette)
  //        2) categoryPaletteColor (palette only)
  //        3) fallback slate
  function getUsageItemCategoryColor(item) {
    let cat = (item.category || '').trim();
    if (!cat) return null; // no category — no colour applied
    if (typeof cleanGroupName === 'function') cat = cleanGroupName(cat) || cat;
    try {
      if (typeof getCategoryColor === 'function') {
        return getCategoryColor('expense', cat);
      }
      if (typeof categoryPaletteColor === 'function') {
        return categoryPaletteColor(cat);
      }
    } catch(e) {}
    return '#6f879a'; // fallback slate
  }

  // Convert a hex colour to rgba string
  function hexToRgbaUsage(hex, alpha) {
    let raw = String(hex || '').replace('#', '');
    if (raw.length === 3) raw = raw[0]+raw[0]+raw[1]+raw[1]+raw[2]+raw[2];
    if (raw.length !== 6) return 'rgba(111,135,154,' + alpha + ')';
    let r = parseInt(raw.slice(0,2), 16);
    let g = parseInt(raw.slice(2,4), 16);
    let b = parseInt(raw.slice(4,6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  /* ── Pill update ─────────────────────────────────────────────────────── */

  function updateUsageDuePill() {
    let pill = document.getElementById('usageDuePill');
    if (!pill) return;
    let n = dueCount();
    if (n > 0) { pill.textContent = n; pill.style.display = ''; }
    else pill.style.display = 'none';
  }

  /* ── Sorted items for carousel ──────────────────────────────────────── */

  function sortedItems() {
    // Keep the user's saved item order stable. Check-in state is now highlighted
    // visually on the card instead of reordering the workspace.
    return getUsageItems().slice();
  }

  /* ══════════════════════════════════════════════════════════════════
     BEHAVIOR LOGIC — v728 (updated for new Value Score system)
     Stage A: per-item evaluation
     Stage B: aggregate KPI metrics
     Stage C: confidence filtering + UI routing
     ══════════════════════════════════════════════════════════════════ */

  // Stage A ─ evaluate one item
  function evaluateItem(item) {
    let mc  = monthlyCost(item);
    let vs  = valueScore(item);
    let warn = warningLevel(item);
    let resp = lastResponse(item);
    let cpu  = costPerUse(item);
    let history = item.history || [];

    let recentLowResponses = 0;
    let checkedPeriods     = 0;
    for (let hi = history.length - 1; hi >= 0 && checkedPeriods < 6; hi--) {
      let e = history[hi];
      if (!e.response) continue;
      checkedPeriods++;
      if (e.response === 'no' || e.response === 'little') recentLowResponses++;
    }

    return {
      item: item, mc: mc,
      annual: item.billingFrequency === 'yearly' ? item.price : mc * 12,
      vs: vs, vsn: vs.n,
      warn: warn, resp: resp, cpu: cpu,
      recentLowResponses: recentLowResponses, checkedPeriods: checkedPeriods,
      isActive:    vs.n >= 50,
      isLowValue:  vs.n < 50,
      isWaste:     vs.n < 25,
      isUnderused: vs.n < 50
    };
  }

  // Stage B ─ KPI: Used vs Owned (§6A)
  function kpiUsedRatio(evals) {
    if (!evals.length) return null;
    let used = evals.filter(function(ev) { return ev.isActive; }).length;
    return { used: used, total: evals.length, pct: Math.round((used / evals.length) * 100) };
  }

  // Stage B ─ KPI: Wasted Spend (§6B)
  function kpiWastedSpend(evals) {
    let wasted = 0;
    evals.forEach(function(ev) {
      if (ev.vsn < 25)      wasted += ev.mc;
      else if (ev.vsn < 50) wasted += ev.mc * 0.5;
    });
    return { monthly: Math.round(wasted), annual: Math.round(wasted * 12) };
  }

  // Stage B ─ KPI: Subscription Stacking (§6C)
  function kpiStacking(evals) {
    let groups = {};
    evals.forEach(function(ev) {
      let cat = (ev.item.category || '').trim().toLowerCase();
      if (!cat) return;
      if (!groups[cat]) groups[cat] = { evals: [], displayCat: ev.item.category || cat };
      groups[cat].evals.push(ev);
    });
    let best = null;
    Object.keys(groups).forEach(function(cat) {
      let g = groups[cat];
      if (g.evals.length < 3) return;
      let active   = g.evals.filter(function(ev) { return ev.isActive; }).length;
      let inactive = g.evals.length - active;
      if (inactive < 1) return;
      let totalMc = g.evals.reduce(function(s, ev) { return s + ev.mc; }, 0);
      if (!best || inactive > best.inactive || (inactive === best.inactive && totalMc > best.totalMc)) {
        best = { displayCat: g.displayCat, total: g.evals.length,
                 active: active, inactive: inactive, totalMc: totalMc };
      }
    });
    return best;
  }

  // Stage C ─ cancel eligibility using Value Score (§8)
  let CANCEL_MIN_MONTHLY_COST   = 8;
  let CANCEL_MOD_MONTHLY_COST   = 15;
  let CANCEL_LOW_RESP_THRESHOLD = 2;

  function isCancelCandidate(ev) {
    if (ev.vsn < 25 && ev.mc > CANCEL_MIN_MONTHLY_COST) return 'strong';
    if (ev.vsn < 40 && ev.mc > CANCEL_MOD_MONTHLY_COST && ev.recentLowResponses >= CANCEL_LOW_RESP_THRESHOLD) return 'moderate';
    return null;
  }

  // Stage C ─ lowest value items for highlight (§4) — already excluded if in cancel suggestions
  function lowestValueItems(evals, candidateIds) {
    return evals
      .filter(function(ev) { return ev.vsn < 50 && !candidateIds[ev.item.id]; })
      .sort(function(a, b) { return a.vsn - b.vsn; })
      .slice(0, 2);
  }

  // Run full evaluation
  function runBehaviorEval(items) {
    let evals = items.map(evaluateItem);
    let candidatePool = [];
    evals.forEach(function(ev) {
      let strength = isCancelCandidate(ev);
      if (strength) candidatePool.push({ strength: strength, ev: ev });
    });
    candidatePool.sort(function(a, b) { return a.ev.vsn - b.ev.vsn || b.ev.mc - a.ev.mc; });
    let candidates = candidatePool.slice(0, 2).map(function(c) { return c.ev; });
    let candidateIds = {};
    candidates.forEach(function(ev) { candidateIds[ev.item.id] = true; });
    let savingsMonthly = candidates.reduce(function(s, ev) { return s + ev.mc; }, 0);

    return {
      evals: evals,
      lowPool: evals.filter(function(ev) { return ev.isUnderused; }),
      candidates: candidates,
      candidateIds: candidateIds,
      savingsMonthly: savingsMonthly,
      savingsAnnual: savingsMonthly * 12,
      lowest: lowestValueItems(evals, candidateIds),
      kpiRatio:  kpiUsedRatio(evals),
      kpiWasted: kpiWastedSpend(evals),
      kpiStack:  kpiStacking(evals)
    };
  }

  // Stage C ─ annualized cost hint text
  function annualHintText(price, billing) {
    price = parseFloat(price) || 0;
    if (price <= 0) return '';
    if (billing === 'monthly') return fmt(price) + '/mo → ' + fmt(price * 12) + '/yr';
    if (billing === 'yearly')  return fmt(price) + '/yr (' + fmt(price / 12) + '/mo)';
    return '';
  }

  // Stage C ─ friction warning text for Add modal (only)
  let FRICTION_THRESHOLD = 2;
  function frictionWarningText(items) {
    let lowCount = items.map(evaluateItem).filter(function(ev) { return ev.isUnderused; }).length;
    if (lowCount < FRICTION_THRESHOLD) return '';
    if (lowCount === 2) return 'You already have 2 subscriptions with low or limited usage.';
    return 'You already have ' + lowCount + ' subscriptions showing low or limited usage.';
  }

  // Stage C ─ no longer needed (replaced by Value Score badge) — kept as no-op for safety
  function actionHintLabel(score) { return score; }

  // Stage C ─ update modal behavior hints (called on open + input change)
  function updateModalBehaviorHints(isAdd) {
    let priceEl   = document.getElementById('usageFormPrice');
    let billingEl = document.getElementById('usageFormBilling');
    let hintEl    = document.getElementById('usageModalAnnualHint');
    if (priceEl && billingEl && hintEl) {
      hintEl.textContent = annualHintText(priceEl.value, billingEl.value);
    }
    let frictionEl = document.getElementById('usageModalFriction');
    if (frictionEl) {
      if (isAdd) {
        let msg = frictionWarningText(getUsageItems());
        if (msg) {
          frictionEl.style.display = '';
          frictionEl.innerHTML = '<div class="usage-modal-friction">'
            + '<span class="usage-modal-friction-icon">⚑</span>'
            + '<span>' + esc(msg) + '</span></div>';
        } else {
          frictionEl.style.display = 'none';
          frictionEl.innerHTML = '';
        }
      } else {
        frictionEl.style.display = 'none';
        frictionEl.innerHTML = '';
      }
    }
  }

  /* ── Card renderer ───────────────────────────────────────────────────── */

  function renderUsageCard(item, index, total) {
    let refDate  = usageReferenceDate();
    let monthKey = usageMonthKey(refDate);
    let editableMonth = isEditableUsageMonth(refDate);
    let monthEntry = latestUsageEntryForMonth(item, monthKey);
    let curPeriod = editableMonth ? entryForCurrentPeriod(item, refDate) : monthEntry;
    let due      = editableMonth && isCheckInDue(item, refDate);
    let warn     = warningLevel(item);
    let vs       = valueScore(item);       // { n, label, key, cls }
    let resp     = editableMonth ? currentResponse(item, refDate) : (monthEntry ? monthEntry.response : null);
    let mc       = monthlyCost(item);
    let cnt      = editableMonth ? currentUsageCount(item, refDate) : usageCountForMonth(item, monthKey);
    let cycleCnt = editableMonth ? cycleUsageCount(item, refDate) : cnt;
    let cpu      = cycleCnt == null || cycleCnt === 0 ? null : mc / cycleCnt;
    let cycleLabel = editableMonth ? cycleWindowLabel(item, refDate) : monthLabelFromUsageKey(monthKey);

    // Cost detail is shown in the stats row for every billing cadence.
    // The card header stays focused on cadence, category, link status, and check-in state.

    let checkinFreq = String(item.checkInFrequency || 'weekly').toLowerCase();
    let checkinLabel = checkinFreq.charAt(0).toUpperCase() + checkinFreq.slice(1) + ' check-in';
    let checkinPillClass = checkinFreq === 'monthly'
      ? ' checkin-monthly'
      : (checkinFreq === 'daily' ? ' checkin-daily' : ' checkin-weekly');

    // Category colour
    let catColor    = getUsageItemCategoryColor(item);
    let accentStyle = catColor
      ? ' style="--usage-card-accent:' + catColor
        + ';--usage-card-tint:' + hexToRgbaUsage(catColor, 0.10)
        + ';--usage-card-bg-top:' + hexToRgbaUsage(catColor, 0.075)
        + ';--usage-card-bg-bottom:' + hexToRgbaUsage(catColor, 0.030)
        + ';--usage-card-border:' + hexToRgbaUsage(catColor, 0.22)
        + ';--usage-card-surface:' + hexToRgbaUsage(catColor, 0.085)
        + ';--usage-card-surface-soft:' + hexToRgbaUsage(catColor, 0.035)
        + ';--usage-card-surface-border:' + hexToRgbaUsage(catColor, 0.18)
        + ';"'
      : '';

    // Value Score badge — primary quality signal (§1)
    let vsBadge = '<span class="usage-vs-badge ' + vs.cls + '">'
      + '<span class="usage-vs-number">' + vs.n + '</span>'
      + '<span class="usage-vs-sep">/100</span>'
      + '<span class="usage-vs-label">' + esc(vs.label) + '</span>'
      + '</span>';

    // Review badge — Waste tier only (§5)
    let reviewBadge = vs.n < 25
      ? '<span class="usage-review-badge">Review</span>'
      : '';

    // Warning badge — only show if score doesn't already capture it (reduce duplication §9)
    // Only show strong warning for context that score can't convey (last-used date)
    let warnHtml = '';
    if (warn === 'strong' && vs.n >= 25) {
      warnHtml = '<span class="usage-warning-msg medium">⚑ Not used 3+ months</span>';
    }

    // Stats row
    let statsHtml = '';
    let checkedAt = editableMonth ? item.lastCheckInAt : (monthEntry && monthEntry.date);
    statsHtml += '<div class="usage-stat"><div class="usage-stat-label">Checked</div><div class="usage-stat-value muted">' + esc(fmtDate(checkedAt)) + '</div></div>';
    statsHtml += '<div class="usage-stat"><div class="usage-stat-label">Annual cost</div><div class="usage-stat-value">' + esc(fmt(item.billingFrequency === 'yearly' ? item.price : mc * 12)) + '</div></div>';
    statsHtml += '<div class="usage-stat"><div class="usage-stat-label">Monthly avg.</div><div class="usage-stat-value">' + esc(fmt(mc)) + '</div></div>';
    statsHtml += '<div class="usage-stat"><div class="usage-stat-label">Uses</div><div class="usage-stat-value' + (cycleCnt == null ? ' muted' : '') + '">' + esc(cycleCnt == null ? '—' : String(cycleCnt)) + '</div></div>';
    statsHtml += '<div class="usage-stat"><div class="usage-stat-label">Per use</div><div class="usage-stat-value' + (cpu == null ? ' muted' : '') + '">' + esc(cpu == null ? '—' : fmt(cpu)) + '</div></div>';
    statsHtml += '<div class="usage-stat"><div class="usage-stat-label">Cycle</div><div class="usage-stat-value muted" style="font-family:var(--font-ui);font-size:0.63rem;">' + esc(cycleLabel) + '</div></div>';

    let selectedYes    = resp === 'yes'    ? ' selected-yes'    : '';
    let selectedLittle = resp === 'little' ? ' selected-little' : '';
    let selectedNo     = resp === 'no'     ? ' selected-no'     : '';
    let countDisabled  = (resp === 'no');
    let dueBadge = due
      ? '<span class="usage-meta-pill usage-due-pill">Due</span>'
      : '';
    let notesHtml = item.notes
      ? '<div style="font-size:0.63rem;color:var(--muted);font-style:italic;padding:0 14px 8px;">' + esc(item.notes) + '</div>'
      : '';
    let periodLabel = editableMonth ? (curPeriod ? 'Saved' : 'This ' + item.checkInFrequency + ' period') : 'Closed month';
    let previousAnswerNote = '';
    let checkinHtml = editableMonth ? [
        '<div class="usage-checkin">',
          '<div class="usage-checkin-prompt" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">',
            '<span>Used this in this period?</span>',
            '<span class="usage-checkin-status-actions">'
              + '<span class="usage-checkin-period-state">' + esc(periodLabel) + '</span>'
              + (curPeriod ? '<button class="checkin-undo-btn usage-checkin-undo-btn" data-undo-checkin-id="' + esc(item.id) + '" type="button">Undo</button>' : '')
            + '</span>',
          '</div>',
          previousAnswerNote,
          '<div class="usage-checkin-btns">',
            '<button class="usage-response-btn' + selectedYes    + '" data-response="yes"    data-id="' + esc(item.id) + '" type="button">Yes</button>',
            '<button class="usage-response-btn' + selectedLittle + '" data-response="little" data-id="' + esc(item.id) + '" type="button">A bit</button>',
            '<button class="usage-response-btn' + selectedNo     + '" data-response="no"     data-id="' + esc(item.id) + '" type="button">No</button>',
          '</div>',
          '<div class="usage-count-row">',
            '<span class="usage-count-label">Uses:</span>',
            '<button class="usage-count-chip' + (cnt === 1 ? ' selected' : '') + '" data-chip-count="1" data-id="' + esc(item.id) + '" type="button"' + (countDisabled ? ' disabled' : '') + '>1</button>',
            '<button class="usage-count-chip' + (cnt === 2 ? ' selected' : '') + '" data-chip-count="2" data-id="' + esc(item.id) + '" type="button"' + (countDisabled ? ' disabled' : '') + '>2</button>',
            '<button class="usage-count-chip' + (cnt === 3 ? ' selected' : '') + '" data-chip-count="3" data-id="' + esc(item.id) + '" type="button"' + (countDisabled ? ' disabled' : '') + '>3</button>',
            '<input class="usage-count-field' + (cnt != null && cnt > 3 ? ' selected' : '') + '" type="number" min="1" max="99" step="1" placeholder="__"',
            '  value="' + (cnt != null && cnt > 3 ? esc(String(cnt)) : '') + '"',
            '  data-count-id="' + esc(item.id) + '"',
            '  ' + (countDisabled ? 'disabled ' : '') + 'aria-label="Custom count (4+)" />',
          '</div>',
        '</div>'
      ].join('') : '<div class="usage-checkin"><div class="usage-checkin-prompt" style="display:flex;align-items:center;justify-content:space-between;gap:8px;"><span>' + esc(monthEntry ? 'Usage recorded for this month' : 'No saved check-in for this month') + '</span><span class="usage-checkin-period-state">' + esc(monthEntry ? responseDisplayLabel(resp) : 'Closed month') + '</span></div></div>';

    return [
      '<div class="usage-card ui-3d-panel ui-3d-usage-card' + (due ? ' is-due' : '') + (warn === 'strong' ? ' warn-strong' : warn === 'medium' ? ' warn-medium' : warn === 'soft' ? ' warn-soft' : '') + '" data-usage-id="' + esc(item.id) + '"' + accentStyle + '>',
        '<div class="usage-card-header">',
          '<div>',
            '<div class="usage-card-name">' + esc(item.name) + '</div>',
            '<div class="usage-card-meta">',
              '<span class="usage-meta-pill' + checkinPillClass + '">' + esc(checkinLabel) + '</span>',
              item.category ? '<span class="usage-meta-pill">'
                + (catColor ? '<span class="usage-cat-dot" style="background:' + esc(catColor) + '"></span>' : '')
                + esc(item.category) + '</span>' : '',
              item.linkedSubscriptionId ? '<span class="usage-linked-badge">⇄ Subscription</span>' : '',
              dueBadge,
            '</div>',
          '</div>',
          '<div class="usage-card-badges">',
            vsBadge,
            reviewBadge,
            warnHtml,
          '</div>',
        '</div>',
        '<div class="usage-card-body">',
          '<div class="usage-stats-row">' + statsHtml + '</div>',
        '</div>',
        notesHtml,
        checkinHtml,
        '<div class="usage-card-actions">',
          '<button class="usage-action-btn" data-edit-id="' + esc(item.id) + '" type="button">Edit</button>',
          '<button class="usage-action-btn danger" data-delete-id="' + esc(item.id) + '" type="button">Delete</button>',
        '</div>',
      '</div>'
    ].join('');
  }

  /* ── Usage tile grid renderer ─────────────────────────────────────── */

  function renderUsageGrid(items) {
    if (!items.length) return '';
    return [
      '<div class="usage-list usage-tile-grid">',
        items.map(function(item, index) {
          return renderUsageCard(item, index, items.length);
        }).join(''),
      '</div>'
    ].join('');
  }

  /* ── Usage KPI board ─────────────────────────────────────────────── */

  function renderUsageKpiBoard(items) {
    let beh = runBehaviorEval(items);
    let subCount = items.length;
    if (!subCount) return '';

    let r = beh.kpiRatio;
    let w = beh.kpiWasted;
    let s = beh.kpiStack;

    let howToCell = '<div class="usage-kpi-cell ui-3d-panel ui-3d-usage-kpi kpi-howto">'
        + '<span class="usage-kpi-label">How to Use</span>'
        + '<div class="usage-howto-list">'
          + '<div class="usage-howto-item">Activate “Track Use” in your Subscription Manager</div>'
          + '<div class="usage-howto-item">Create standalone Usage trackers in the Usage Workspace</div>'
        + '</div>'
      + '</div>';

    let ratioCell = r
      ? '<div class="usage-kpi-cell ui-3d-panel ui-3d-usage-kpi kpi-used">'
          + '<span class="usage-kpi-label">Actively used</span>'
          + '<span class="usage-kpi-value' + (r.pct < 50 ? ' kpi-warn' : '') + '">' + r.pct + '%</span>'
          + '<span class="usage-kpi-sub">' + r.used + ' of ' + r.total + ' subscriptions</span>'
        + '</div>'
      : '';

    let wastedCell = '<div class="usage-kpi-cell ui-3d-panel ui-3d-usage-kpi kpi-wasted">'
        + '<span class="usage-kpi-label">Wasted spend</span>'
        + '<span class="usage-kpi-value' + (w.monthly > 0 ? ' kpi-bad' : '') + '">'
          + (w.monthly > 0 ? fmt(w.monthly) + '/mo' : '—')
        + '</span>'
        + (w.monthly > 0 ? '<span class="usage-kpi-sub">' + fmt(w.annual) + '/yr est.</span>' : '<span class="usage-kpi-sub">No current waste detected</span>')
      + '</div>';

    let stackCell = s
      ? '<div class="usage-kpi-cell ui-3d-panel ui-3d-usage-kpi kpi-stacking">'
          + '<span class="usage-kpi-label">Stacking</span>'
          + '<span class="usage-kpi-value kpi-warn">' + s.total + ' owned · ' + s.active + ' used</span>'
          + '<span class="usage-kpi-sub">' + esc(s.displayCat) + '</span>'
        + '</div>'
      : '<div class="usage-kpi-cell ui-3d-panel ui-3d-usage-kpi kpi-stacking">'
          + '<span class="usage-kpi-label">Stacking</span>'
          + '<span class="usage-kpi-value">—</span>'
          + '<span class="usage-kpi-sub">No overlap detected</span>'
        + '</div>';

    return '<div class="usage-kpi-board usage-summary-card ui-3d-panel">'
      + '<div class="usage-summary-head"><div><div class="usage-summary-title">Usage Health</div><div class="usage-summary-sub">Current usage signals across tracked subscriptions.</div></div></div>'
      + '<div class="usage-kpi-row ui-3d-usage-kpi-row">' + howToCell + ratioCell + wastedCell + stackCell + '</div></div>';
  }

  function renderUsageInsightsPanel(items) {
    let beh = runBehaviorEval(items);
    let byCpu = items
      .map(function(i) { let refDate = usageReferenceDate(); return { item: i, cpu: costPerUse(i, refDate), cnt: cycleUsageCount(i, refDate) }; })
      .filter(function(x) { return x.cpu != null; })
      .sort(function(a,b) { return b.cpu - a.cpu; });

    function colHtml(title, rows) {
      let key = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      let html = '<div class="usage-insight-col usage-insight-tile insight-' + esc(key) + '">';
      html += '<div class="usage-insight-col-title">' + esc(title) + '</div>';
      if (!rows.length) {
        for (let p = 0; p < MAX_INSIGHTS_ROWS; p++) {
          html += '<div class="usage-insight-entry is-placeholder"><span class="usage-insight-entry-name">—</span><span class="usage-insight-entry-val">—</span></div>';
        }
      } else {
        for (let i = 0; i < MAX_INSIGHTS_ROWS; i++) {
          if (i < rows.length) {
            html += '<div class="usage-insight-entry">'
              + '<span class="usage-insight-entry-name" title="' + esc(rows[i].name) + '">' + esc(rows[i].name) + '</span>'
              + '<span class="usage-insight-entry-val">' + esc(rows[i].val) + '</span>'
              + '</div>';
          } else {
            html += '<div class="usage-insight-entry is-placeholder"><span class="usage-insight-entry-name">—</span><span class="usage-insight-entry-val">—</span></div>';
          }
        }
      }
      return html + '</div>';
    }

    return [
      '<div class="usage-insights-panel ui-3d-panel ui-3d-usage-insights">',
        '<div class="usage-insights-grid">',
          colHtml('Lowest score', beh.evals.slice().sort(function(a,b){ return a.vsn - b.vsn; }).slice(0, MAX_INSIGHTS_ROWS).map(function(ev) {
            return { name: ev.item.name, val: ev.vsn + '/100' };
          })),
          colHtml('Wasted Spend', beh.lowPool.slice().sort(function(a,b){ return b.mc - a.mc; }).slice(0, MAX_INSIGHTS_ROWS).map(function(ev) {
            return { name: ev.item.name, val: fmt(ev.mc) + '/mo' };
          })),
          colHtml('Consider cutting', beh.candidates.slice(0, MAX_INSIGHTS_ROWS).map(function(ev) {
            return { name: ev.item.name, val: fmt(ev.mc) + '/mo' };
          })),
        '</div>',
      '</div>'
    ].join('');
  }

  /* ── Workspace render helpers ─────────────────────────────────────────── */

  function usageWorkspaceScrollTop() {
    let body = document.querySelector('#usageManagerOverlay .usage-manager-body');
    return body ? body.scrollTop : 0;
  }

  function restoreUsageWorkspaceScroll(top) {
    if (top == null) return;
    window.requestAnimationFrame(function() {
      let body = document.querySelector('#usageManagerOverlay .usage-manager-body');
      if (body) body.scrollTop = top;
    });
  }

  function usageWorkspaceRenderOptions(options) {
    let config = options || {};
    return {
      scrollTop: config.preserveScroll ? usageWorkspaceScrollTop() : 0
    };
  }

  /* ── Main render ──────────────────────────────────────────────────────── */

  function renderUsageWorkspaceModal(items, options) {
    let overlay = document.getElementById('usageManagerOverlay');
    if (!overlay || !overlay.classList.contains('cbm-open')) return;
    let renderState = usageWorkspaceRenderOptions(options);
    let refDate = usageReferenceDate();
    let visibleItems = visibleUsageItemsForReference(items, refDate);
    let orderedItems = visibleUsageItemsForReference(sortedItems(), refDate);
    let visibleLabel = isEditableUsageMonth(refDate) ? 'tracked item' : 'historical item';
    overlay.innerHTML = [
      '<div class="cbm-modal usage-manager-modal" role="dialog" aria-modal="true" aria-label="Usage Workspace">',
        '<div class="cbm-header usage-manager-header">',
          '<div>',
            '<div class="cbm-title">Usage Workspace</div>',
            '<div class="cbm-sub">Review usage cards, check-ins, value scores, and service actions.</div>',
          '</div>',
          '<button class="cbm-close-btn" id="usageManagerCloseBtn" type="button" aria-label="Close Usage Workspace">✕</button>',
        '</div>',
        '<div class="usage-manager-toolbar">',
          '<button class="feature-action-btn is-primary" id="usageWorkspaceAddBtn" type="button">Add App / Service</button>',
          '<span class="usage-manager-count">' + esc(visibleItems.length + ' ' + visibleLabel + (visibleItems.length === 1 ? '' : 's')) + '</span>',
        '</div>',
        '<div class="cbm-body usage-manager-body">',
          visibleItems.length ? renderUsageGrid(orderedItems) : '<div class="usage-empty ui-3d-panel ui-3d-usage-empty"><div class="usage-empty-icon">📱</div><div class="usage-empty-title">No usage trackers for this month</div><div class="usage-empty-sub">Closed months only show usage trackers that existed during that month.</div></div>',
        '</div>',
      '</div>'
    ].join('');
    let closeBtn = document.getElementById('usageManagerCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeUsageWorkspace);
    let addBtn = document.getElementById('usageWorkspaceAddBtn');
    if (addBtn) addBtn.addEventListener('click', openAddModal);
    let body = overlay.querySelector('.usage-manager-body');
    if (body) wireCardEvents(body);
    restoreUsageWorkspaceScroll(renderState.scrollTop);
  }

  function openUsageWorkspace() {
    let overlay = document.getElementById('usageManagerOverlay');
    if (!overlay) return;
    overlay.classList.add('cbm-open');
    overlay.setAttribute('aria-hidden', 'false');
    renderUsageWorkspaceModal(getUsageItems());
  }

  function closeUsageWorkspace() {
    let overlay = document.getElementById('usageManagerOverlay');
    if (!overlay) return;
    overlay.classList.remove('cbm-open');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = '';
  }

  /* ── Main render ──────────────────────────────────────────────────────── */

  window.renderUsageTab = function renderUsageTab() {
    let container = document.getElementById('usageTabLayout');
    if (!container) return;

    let items = visibleUsageItemsForReference(getUsageItems(), usageReferenceDate());
    let beh = runBehaviorEval(items);
    let total = items.length;
    let due = items.filter(function(item) { return isCheckInDue(item, usageReferenceDate()); }).length;
    let activelyUsed = beh && beh.kpiRatio ? Number(beh.kpiRatio.used || 0) : items.filter(function(item) {
      let resp = currentResponse(item, usageReferenceDate());
      return resp === 'yes' || resp === 'little';
    }).length;
    let activePct = total ? Math.round((activelyUsed / Math.max(total, 1)) * 100) : 0;
    let wastedMonthly = beh && beh.kpiWasted ? Number(beh.kpiWasted.monthly || 0) : 0;
    let lowest = beh && beh.evals && beh.evals.length ? beh.evals.slice().sort(function(a,b){ return a.vsn - b.vsn; })[0] : null;
    let highestCpu = items.map(function(item) {
      return { item: item, cpu: costPerUse(item, usageReferenceDate()) };
    }).filter(function(row) {
      return row.cpu != null;
    }).sort(function(a,b) {
      return b.cpu - a.cpu;
    })[0] || null;

    let insightRows = [];
    if (lowest) {
      insightRows.push('<article class="phase4-usage-insight"><div><div class="phase4-usage-insight-label">Lowest value score</div><div class="phase4-usage-insight-title">' + esc(lowest.item.name || 'Tracked item') + '</div><div class="phase4-usage-insight-sub">' + lowest.vsn + '/100 · review usage value</div></div></article>');
    }
    if (highestCpu) {
      insightRows.push('<article class="phase4-usage-insight"><div><div class="phase4-usage-insight-label">Highest cost per use</div><div class="phase4-usage-insight-title">' + esc(highestCpu.item.name || 'Tracked item') + '</div><div class="phase4-usage-insight-sub">' + esc(fmt(highestCpu.cpu)) + ' per use</div></div></article>');
    }
    if (beh && beh.kpiStack) {
      insightRows.push('<article class="phase4-usage-insight"><div><div class="phase4-usage-insight-label">Stacking risk</div><div class="phase4-usage-insight-title">' + esc(beh.kpiStack.displayCat || 'Overlapping category') + '</div><div class="phase4-usage-insight-sub">' + beh.kpiStack.total + ' owned · ' + beh.kpiStack.active + ' used</div></div></article>');
    }

    let html = [];
    html.push(
      '<section class="phase4-usage-hero">' +
        '<div class="phase4-usage-kpi primary"><div class="phase4-usage-kpi-label">Usage health</div><div class="phase4-usage-kpi-value">' + activePct + '%</div><div class="phase4-usage-kpi-sub">' + activelyUsed + ' of ' + total + ' actively used</div></div>' +
        '<div class="phase4-usage-kpi"><div class="phase4-usage-kpi-label">Check-ins due</div><div class="phase4-usage-kpi-value">' + due + '</div><div class="phase4-usage-kpi-sub">' + total + ' tracked app' + (total === 1 ? '' : 's') + ' / services</div></div>' +
        '<div class="phase4-usage-kpi"><div class="phase4-usage-kpi-label">Wasted spend</div><div class="phase4-usage-kpi-value">' + (wastedMonthly > 0 ? esc(fmt(wastedMonthly)) : '—') + '</div><div class="phase4-usage-kpi-sub">' + (wastedMonthly > 0 ? esc(fmt(wastedMonthly * 12)) + ' annual estimate' : 'No current waste detected') + '</div></div>' +
      '<div class="phase4-usage-kpi howto"><div class="phase4-usage-kpi-label">How to use</div><div class="phase4-usage-howto-list"><div>Activate “Track Use” in Subscription Manager</div><div>Create standalone trackers in Usage Workspace</div></div></div>' +
      '</section>'
    );

    html.push(
      '<section class="phase4-usage-board">' +
        '<div class="phase4-usage-board-head">' +
          '<div><h3 class="phase4-usage-board-title">Usage Intelligence</h3><div class="phase4-usage-board-sub">Review value, waste, and check-in signals for your recurring tools.</div></div>' +
          '<div class="phase4-usage-board-actions"><button class="feature-action-btn is-primary" id="usageOpenWorkspaceBtn" type="button">Usage Workspace</button></div>' +
        '</div>' +
        (items.length ? '<div class="phase4-usage-insight-grid">' + (insightRows.length ? insightRows.join('') : '<article class="phase4-usage-insight"><div><div class="phase4-usage-insight-label">Status</div><div class="phase4-usage-insight-title">No issues detected</div><div class="phase4-usage-insight-sub">Your usage signals look stable.</div></div></article>') + '</div>' : '<div class="phase4-usage-empty"><div class="usage-empty-icon">📱</div><div class="usage-empty-title">No apps or services yet</div><div class="usage-empty-sub">Start tracking what you really use.</div></div>') +
      '</section>'
    );

    container.innerHTML = html.join('');
    wireUsageWorkspaceButtons(container);
    updateUsageDuePill();
    renderUsageWorkspaceModal(items, { preserveScroll: true });
  };

  /* ── Card event wiring ───────────────────────────────────────────────── */

  function wireCardEvents(container) {
    if (!container || container.__usageCardEventsWired) return;
    container.__usageCardEventsWired = true;

    container.addEventListener('click', function(event) {
      let responseBtn = event.target.closest('.usage-response-btn[data-response][data-id]');
      if (responseBtn && container.contains(responseBtn)) {
        event.preventDefault();
        event.stopPropagation();
        handleCheckIn(responseBtn.dataset.id, responseBtn.dataset.response);
        return;
      }

      let undoBtn = event.target.closest('[data-undo-checkin-id]');
      if (undoBtn && container.contains(undoBtn)) {
        event.preventDefault();
        event.stopPropagation();
        handleUndoCheckIn(undoBtn.dataset.undoCheckinId);
        return;
      }

      let countBtn = event.target.closest('[data-chip-count][data-id]');
      if (countBtn && container.contains(countBtn)) {
        event.preventDefault();
        let id  = countBtn.dataset.id;
        let val = parseInt(countBtn.dataset.chipCount, 10);
        let cur = currentUsageCountById(id);
        let next = (cur === val) ? null : val;
        let field = container.querySelector('[data-count-id="' + id + '"]');
        if (field && next != null) field.value = '';
        handleCountInput(id, next);
        window.renderUsageTab();
        return;
      }

      let editBtn = event.target.closest('[data-edit-id]');
      if (editBtn && container.contains(editBtn)) {
        event.preventDefault();
        openEditModal(editBtn.dataset.editId);
        return;
      }

      let deleteBtn = event.target.closest('[data-delete-id]');
      if (deleteBtn && container.contains(deleteBtn)) {
        event.preventDefault();
        let deleteId = deleteBtn.dataset.deleteId;
        let items = getUsageItems();
        let item = items.find(function(i) { return i.id === deleteId; });
        if (!item) return;
        if (!confirm('Delete "' + item.name + '"? This cannot be undone.')) return;
        applyUsageMutation(function() {
          window.state.usageItems = items.filter(function(i) { return i.id !== deleteId; });
          saveUsageItems();
        }, { render: true, save: false });
      }
    });

    container.addEventListener('input', function(event) {
      let input = event.target.closest('[data-count-id]');
      if (!input || !container.contains(input)) return;
      let id  = input.dataset.countId;
      let val = parseInt(input.value, 10);
      if (isNaN(val) || val < 1) val = null;
      if (val != null && val > 99) { val = 99; input.value = 99; }
      handleCountInputSilent(id, val);
    });

    container.addEventListener('focusout', function(event) {
      let input = event.target.closest('[data-count-id]');
      if (!input || !container.contains(input)) return;
      window.renderUsageTab();
    });

    container.addEventListener('keydown', function(event) {
      let input = event.target.closest('[data-count-id]');
      if (!input || !container.contains(input)) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
      }
    });
  }

  function wireUsageWorkspaceButtons(scope) {
    let root = scope || document;
    let headerBtn = document.getElementById('usageOpenWorkspaceBtn');
    if (headerBtn && !headerBtn.__usageWorkspaceWired) {
      headerBtn.__usageWorkspaceWired = true;
      headerBtn.addEventListener('click', openUsageWorkspace);
    }
  }

  /* ── Check-in handlers (IMPROVEMENT 1) ───────────────────────────────── */
  // Each response is stored under the period key; a new period = new entry.
  // Re-answering within the same period replaces that period's entry.

  function applyUsageMutation(mutator, options) {
    let config = options || {};
    if (typeof window.withUserMutation === 'function') {
      let committed = window.withUserMutation(mutator, Object.assign({}, config, { render: false }));
      if (committed === false) return false;
      if (config.render !== false && typeof window.renderUsageTab === 'function') window.renderUsageTab();
      return committed;
    }
    let result = mutator();
    if (result === false) return false;
    saveUsageItems();
    if (config.render !== false) window.renderUsageTab();
    return result;
  }

  function syncUsageItemLastSignals(item) {
    let latestCheck = null;
    let latestUsed = null;
    if (!item || !Array.isArray(item.history)) return;
    item.history.forEach(function(entry) {
      if (!entry || !entry.date || !entry.response) return;
      if (!latestCheck || new Date(entry.date) > new Date(latestCheck)) latestCheck = entry.date;
      if ((entry.response === 'yes' || entry.response === 'little') && (!latestUsed || new Date(entry.date) > new Date(latestUsed))) {
        latestUsed = entry.date;
      }
    });
    item.lastCheckInAt = latestCheck || null;
    item.lastUsedAt = latestUsed || null;
  }

  function handleUndoCheckIn(id) {
    applyUsageMutation(function() {
      let items = getUsageItems();
      let item  = items.find(function(i) { return i.id === id; });
      if (!item || !Array.isArray(item.history)) return false;
      let key = currentPeriodKey(item, usageReferenceDate());
      let nextHistory = item.history.filter(function(entry) { return entry.period !== key; });
      if (nextHistory.length === item.history.length) return false;
      item.history = nextHistory;
      syncUsageItemLastSignals(item);
      saveUsageItems();
      updateUsageDuePill();
    }, { render: true, preserveScroll: true, save: false });
  }

  function handleCheckIn(id, response) {
    applyUsageMutation(function() {
      let items = getUsageItems();
      let item  = items.find(function(i) { return i.id === id; });
      if (!item) return false;

      let refDate = usageReferenceDate();
      let now = checkinTimestampForReference(refDate);
      let key = currentPeriodKey(item, refDate);

      // Find or create entry for this period
      let entry = null;
      for (let i = 0; i < item.history.length; i++) {
        if (item.history[i].period === key) { entry = item.history[i]; break; }
      }
      if (!entry) {
        entry = { period: key, date: now, response: null, usageCount: null };
        item.history.push(entry);
        if (item.history.length > 200) item.history.shift();
      }

      entry.response    = response;
      entry.date        = now;
      item.lastCheckInAt = now;
      if (response === 'yes' || response === 'little') item.lastUsedAt = now;
      else if (response === 'no' && entry.usageCount == null) entry.usageCount = null;
    }, { render: true });
  }

  // Persist count without triggering a full re-render (used while typing)
  function handleCountInputSilent(id, count) {
    applyUsageMutation(function() {
      let items = getUsageItems();
      let item  = items.find(function(i) { return i.id === id; });
      if (!item) return false;
      let key = currentPeriodKey(item, usageReferenceDate());
      let entry = null;
      for (let i = 0; i < item.history.length; i++) {
        if (item.history[i].period === key) { entry = item.history[i]; break; }
      }
      if (!entry) return false;
      entry.usageCount = count;
      saveUsageItems();
      updateUsageDuePill();
    }, { render: false, save: false });
  }

  function currentUsageCountById(id) {
    let item = getUsageItems().find(function(i) { return i.id === id; });
    return item ? currentUsageCount(item, usageReferenceDate()) : null;
  }

  function handleCountInput(id, count) {
    applyUsageMutation(function() {
      let items = getUsageItems();
      let item  = items.find(function(i) { return i.id === id; });
      if (!item) return false;

      let key = currentPeriodKey(item, usageReferenceDate());
      let entry = null;
      for (let i = 0; i < item.history.length; i++) {
        if (item.history[i].period === key) { entry = item.history[i]; break; }
      }
      if (!entry) return false; // no check-in yet, can't store count without response
      entry.usageCount = count;

      saveUsageItems();
      updateUsageDuePill();
      let ip = document.querySelector('.usage-insights-panel');
      if (ip) {
        let fresh = document.createElement('div');
        fresh.innerHTML = renderUsageInsightsPanel(getUsageItems());
        ip.parentNode.replaceChild(fresh.firstChild, ip);
      }
    }, { render: false, save: false });
  }

  /* ── Modal category dropdown ─────────────────────────────────────────── */

  function getUsageCategoryDropdownOptions(selectedValue) {
    let currentValue = String(selectedValue || '').trim();
    let options = [];
    if (typeof subscriptionCategoryOptions === 'function') {
      try {
        options = subscriptionCategoryOptions(getActiveMonth()).map(function(option) {
          return { value: String(option && option.key || '').trim(), label: String(option && option.label || '').trim() };
        });
      } catch (error) {
        options = [];
      }
    }
    let seen = Object.create(null);
    let normalized = [];
    options.forEach(function(option) {
      let value = String(option && option.value || '').trim();
      let label = String(option && option.label || value).trim();
      if (!value || seen[value]) return;
      seen[value] = true;
      normalized.push({ value: value, label: label });
    });
    if (currentValue && !seen[currentValue]) {
      normalized.push({ value: currentValue, label: currentValue });
    }
    normalized.sort(function(a, b) { return a.label.localeCompare(b.label); });
    return normalized;
  }

  function renderUsageCategoryDropdown(selectedValue) {
    let currentValue = String(selectedValue || '').trim();
    let options = getUsageCategoryDropdownOptions(currentValue);
    let placeholder = options.length ? 'Select category' : 'Add expense categories first';
    return ['<option value="">' + esc(placeholder) + '</option>'].concat(options.map(function(option) {
      return '<option value="' + esc(option.value) + '"' + (option.value === currentValue ? ' selected' : '') + '>' + esc(option.label) + '</option>';
    })).join('');
  }

  function populateUsageCategoryDropdown(selectedValue) {
    let select = document.getElementById('usageFormCategory');
    if (!select) return;
    select.innerHTML = renderUsageCategoryDropdown(selectedValue);
    select.value = String(selectedValue || '').trim();
  }

  /* ── Modal ────────────────────────────────────────────────────────────── */
  let _editingId = null;

  function openAddModal() {
    _editingId = null;
    document.getElementById('usageModalTitle').textContent        = 'Add App / Service';
    document.getElementById('usageFormName').value                = '';
    document.getElementById('usageFormPrice').value               = '';
    document.getElementById('usageFormBilling').value             = 'monthly';
    document.getElementById('usageFormCheckinFreq').value         = 'weekly';
    populateUsageCategoryDropdown('');
    document.getElementById('usageFormNotes').value               = '';
    document.getElementById('usageModalOverlay').classList.remove('is-hidden');
    updateModalBehaviorHints(true);
    setTimeout(function() { document.getElementById('usageFormName').focus(); }, 50);
  }

  function openEditModal(id) {
    let items = getUsageItems();
    let item  = items.find(function(i) { return i.id === id; });
    if (!item) return;
    _editingId = id;
    document.getElementById('usageModalTitle').textContent        = 'Edit ' + item.name;
    document.getElementById('usageFormName').value                = item.name;
    document.getElementById('usageFormPrice').value               = item.price;
    document.getElementById('usageFormBilling').value             = item.billingFrequency;
    document.getElementById('usageFormCheckinFreq').value         = item.checkInFrequency;
    populateUsageCategoryDropdown(item.category);
    document.getElementById('usageFormNotes').value               = item.notes;
    document.getElementById('usageModalOverlay').classList.remove('is-hidden');
    updateModalBehaviorHints(false);
    setTimeout(function() { document.getElementById('usageFormName').focus(); }, 50);
  }

  function closeUsageModal() {
    document.getElementById('usageModalOverlay').classList.add('is-hidden');
    _editingId = null;
  }

  function saveModal() {
    let name = document.getElementById('usageFormName').value.trim();
    if (!name) { document.getElementById('usageFormName').focus(); return; }

    let price   = parseFloat(document.getElementById('usageFormPrice').value) || 0;
    let billing = document.getElementById('usageFormBilling').value;
    let freq    = document.getElementById('usageFormCheckinFreq').value;
    let cat     = document.getElementById('usageFormCategory').value.trim();
    let notes   = document.getElementById('usageFormNotes').value.trim();

    applyUsageMutation(function() {
      ensureUsageItems(window.state);

      if (_editingId) {
        let existing = window.state.usageItems.find(function(i) { return i.id === _editingId; });
        if (existing) {
          existing.name             = name;
          existing.price            = price;
          existing.billingFrequency = billing;
          existing.checkInFrequency = freq;
          existing.category         = cat;
          existing.notes            = notes;
        }
      } else {
        window.state.usageItems.push(normalizeUsageItem({
          id: generateUsageId(), name: name, price: price,
          billingFrequency: billing, checkInFrequency: freq,
          category: cat, notes: notes, createdAt: new Date().toISOString()
        }));
      }

      saveUsageItems();
    }, { render: false, save: false });
    closeUsageModal();
    window.renderUsageTab();
  }

  /* ── Wire modal ──────────────────────────────────────────────────────── */

  function wireModal() {
    let overlay   = document.getElementById('usageModalOverlay');
    let closeBtn  = document.getElementById('usageModalClose');
    let cancelBtn = document.getElementById('usageModalCancel');
    let saveBtn   = document.getElementById('usageModalSave');

    if (closeBtn)  closeBtn.addEventListener('click', closeUsageModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeUsageModal);
    if (saveBtn)   saveBtn.addEventListener('click', saveModal);

    if (overlay) {
      overlay.addEventListener('click', function(e) {
        if (e.target === overlay) closeUsageModal();
      });
    }
    let workspaceOverlay = document.getElementById('usageManagerOverlay');
    if (workspaceOverlay && !workspaceOverlay.__usageWorkspaceOverlayWired) {
      workspaceOverlay.__usageWorkspaceOverlayWired = true;
      workspaceOverlay.addEventListener('click', function(e) {
        if (e.target === workspaceOverlay) closeUsageWorkspace();
      });
    }
    wireUsageWorkspaceButtons(document);

    // Live annual-hint update when price or billing changes
    let priceEl   = document.getElementById('usageFormPrice');
    let billingEl = document.getElementById('usageFormBilling');
    function refreshHints() { updateModalBehaviorHints(_editingId === null); }
    if (priceEl)   priceEl.addEventListener('input',  refreshHints);
    if (billingEl) billingEl.addEventListener('change', refreshHints);

    ['usageFormName','usageFormPrice','usageFormCategory','usageFormNotes'].forEach(function(id) {
      let el = document.getElementById(id);
      if (el) {
        el.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') saveModal();
          if (e.key === 'Escape') closeUsageModal();
        });
      }
    });
  }

  /* ── Init ────────────────────────────────────────────────────────────── */

  function initUsageModule() {
    wireModal();
    if (window.state) ensureUsageItems(window.state);
    // Sync subscription-linked usage items on load
    if (typeof syncUsageItemsFromSubscriptions === 'function') syncUsageItemsFromSubscriptions();
    updateUsageDuePill();
    if (window.activeView === 'usage') window.renderUsageTab();
    window.updateUsageDuePill = updateUsageDuePill;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUsageModule, { once: true });
  } else {
    initUsageModule();
  }

})();
