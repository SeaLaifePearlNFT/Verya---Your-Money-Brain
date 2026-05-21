(function() {
  'use strict';

  /* =====================================================================
     ACHIEVEMENTS TAB v749
     Changes from v737:
     A. Storage v5: month-scoped cadence locking, Sunday-based weekly schedule
     B. Weekly is progressive in-month (Sunday checkpoints), Monthly unchanged
     C. Cadence locked per month on first completion — not global
     D. History: Year → Month → Weekly tree (collapsible)
     E. KPI row: Monthly unchanged; Weekly shows delta vs previous weekly entry
     F. Achievement pill: month-aware, cadence-aware
     G. Migration: v4 → v5 with fallback safety
     ===================================================================== */

  let CHECKIN_STORAGE_KEY_V4 = 'budget_checkin_v4';
  let CHECKIN_STORAGE_KEY_V5 = 'budget_checkin_v5';
  // Tolerance for goal on-pace classification
  let GOAL_EPSILON_RATIO = 0.05;

  /* =====================================================================
     DATE / SCHEDULE HELPERS
     ===================================================================== */

  function monthKeyFromDate(d) {
    let dt = d ? new Date(d) : new Date();
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
  }

  function calMonthKey() { return monthKeyFromDate(new Date()); }

  // Returns the month key for a "month object" {name: "April 2026"}
  function monthKeyFromMonthObj(month) {
    if (!month || !month.name) return calMonthKey();
    let names = ['January','February','March','April','May','June',
                 'July','August','September','October','November','December'];
    let parts = String(month.name).split(' ');
    let mo = names.indexOf(parts[0]);
    let yr = parseInt(parts[1]);
    if (mo >= 0 && yr > 0) return yr + '-' + String(mo + 1).padStart(2, '0');
    return calMonthKey();
  }

  function monthLabelFromKey(mk) {
    let mm = mk.match(/^(\d{4})-(\d{2})$/);
    if (!mm) return mk;
    return new Date(parseInt(mm[1]), parseInt(mm[2]) - 1, 1)
      .toLocaleDateString('en-BE', { month: 'long', year: 'numeric' });
  }

  // All Sundays whose calendar date falls within the given YYYY-MM month
  function getMonthSundays(monthKey) {
    let mm = monthKey.match(/^(\d{4})-(\d{2})$/);
    if (!mm) return [];
    let yr = parseInt(mm[1]), mo = parseInt(mm[2]) - 1;
    let sundays = [];
    let d = new Date(yr, mo, 1);
    // Advance to first Sunday
    while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
    while (d.getMonth() === mo) {
      sundays.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
      d.setDate(d.getDate() + 7);
    }
    return sundays;
  }

  function isSundayReached(dueDateStr) {
    let now = new Date();
    let nowStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
    return dueDateStr <= nowStr;
  }

  function formatSundayLabel(dueDateStr) {
    let parts = dueDateStr.split('-');
    let d = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
    return d.toLocaleDateString('en-BE', { weekday: 'long', month: 'long', day: 'numeric' });
  }

  // Legacy helpers for Monthly (preserved for backward compat)
  function isoWeekKey(d) {
    let dt = d ? new Date(d) : new Date();
    let jan4 = new Date(dt.getFullYear(), 0, 4);
    let wk = Math.ceil(((dt - jan4) / 86400000 + jan4.getDay() + 1) / 7);
    return dt.getFullYear() + '-W' + String(wk).padStart(2, '0');
  }
  function labelFromKey(key) {
    let mm = key.match(/^(\d{4})-(\d{2})$/);
    if (mm) return new Date(parseInt(mm[1]), parseInt(mm[2]) - 1, 1)
      .toLocaleDateString('en-BE', { month: 'long', year: 'numeric' });
    let wm = key.match(/^(\d{4})-W(\d{2})$/);
    if (wm) return 'Week ' + parseInt(wm[2]) + ' \xb7 ' + wm[1];
    return key;
  }

  /* =====================================================================
     V5 STORAGE
     ===================================================================== */

  function loadV5State() {
    try {
      let raw = localStorage.getItem(CHECKIN_STORAGE_KEY_V5);
      if (raw) {
        let s = JSON.parse(raw);
        if (s && s.version === 5) return s;
      }
    } catch(e) {}
    return null;
  }

  function saveV5State(s) {
    try { localStorage.setItem(CHECKIN_STORAGE_KEY_V5, JSON.stringify(s)); } catch(e) {}
  }

  function emptyV5State() {
    return { version: 5, selectedCadenceDraft: 'monthly', years: {} };
  }

  function getOrCreateMonthRecord(state, monthKey) {
    let yr = monthKey.substring(0, 4);
    if (!state.years[yr]) state.years[yr] = { months: {} };
    if (!state.years[yr].months[monthKey]) {
      state.years[yr].months[monthKey] = {
        month_key: monthKey,
        month_label: monthLabelFromKey(monthKey),
        cadence_locked: null,
        cadence_locked_at: null,
        monthly: { snapshot: null },
        weekly: { entries: [] },
        ui: { month_history_collapsed: true, weekly_history_collapsed: true }
      };
    }
    return state.years[yr].months[monthKey];
  }

  // Like getOrCreateMonthRecord but does NOT create a new record — returns null if absent.
  // Use this during rendering so merely viewing a month doesn't leave a ghost in history.
  function peekMonthRecord(state, monthKey) {
    let yr = monthKey.substring(0, 4);
    return (state.years[yr] && state.years[yr].months[monthKey]) || null;
  }

  /* =====================================================================
     MIGRATION v4 → v5
     ===================================================================== */

  function migrateV4toV5() {
    let v5 = emptyV5State();
    try {
      let raw = localStorage.getItem(CHECKIN_STORAGE_KEY_V4);
      if (!raw) return v5;
      let v4 = JSON.parse(raw);
      if (!v4 || !Array.isArray(v4.snapshots)) return v5;

      // Group snapshots by month
      let byMonth = {};
      v4.snapshots.forEach(function(sn) {
        let mk = sn.month_key || sn.period_key;
        // For weekly period keys like "2026-W15", try to derive month
        if (mk && mk.match(/^\d{4}-W\d{2}$/)) {
          // Convert ISO week to approximate month key
          try {
            let wm = mk.match(/^(\d{4})-W(\d{2})$/);
            let yr = parseInt(wm[1]), wk = parseInt(wm[2]);
            let jan4 = new Date(yr, 0, 4);
            let dayOfYear = (wk - 1) * 7 + jan4.getDay();
            let d = new Date(yr, 0, dayOfYear);
            mk = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
          } catch(e) { mk = calMonthKey(); }
        }
        if (!mk || !mk.match(/^\d{4}-\d{2}$/)) mk = calMonthKey();
        if (!byMonth[mk]) byMonth[mk] = [];
        byMonth[mk].push(sn);
      });

      Object.keys(byMonth).forEach(function(mk) {
        let snaps = byMonth[mk];
        let rec = getOrCreateMonthRecord(v5, mk);

        // Determine cadence from earliest completed
        let completed = snaps.filter(function(s) { return s.completed_at; });
        completed.sort(function(a, b) { return (a.completed_at || '') < (b.completed_at || '') ? -1 : 1; });
        let firstCompleted = completed[0];
        if (firstCompleted) {
          rec.cadence_locked = firstCompleted.cadence || 'monthly';
          rec.cadence_locked_at = firstCompleted.completed_at;
        }

        // Map monthly snapshots
        let monthlySnaps = snaps.filter(function(s) { return s.cadence === 'monthly'; });
        if (monthlySnaps.length) {
          let ms = monthlySnaps[0];
          rec.monthly.snapshot = {
            id: ms.id,
            period_key: ms.period_key,
            period_label: ms.period_label || monthLabelFromKey(mk),
            check_in_status: ms.check_in_status || 'active',
            generated_at: ms.generated_at,
            completed_at: ms.completed_at || null,
            reviewed_income: !!ms.reviewed_income,
            reviewed_savings: !!ms.reviewed_savings,
            reviewed_expenses: !!ms.reviewed_expenses,
            reviewed_subscriptions: !!ms.reviewed_subscriptions,
            summary_sentence: ms.summary_sentence || '',
            selected_insights: ms.selected_insights || [],
            month_end_reference: ms.month_end_reference || null
          };
        }

        // Map weekly snapshots
        let weeklySnaps = snaps.filter(function(s) { return s.cadence === 'weekly'; });
        weeklySnaps.forEach(function(ws, idx) {
          rec.weekly.entries.push({
            entry_id: ws.id || (mk + '::weekly::' + idx),
            month_key: mk,
            sequence_in_month: idx + 1,
            due_date: ws.period_key || mk + '-07',
            status: ws.check_in_status === 'completed' ? 'completed' : ws.check_in_status === 'expired' ? 'expired' : 'available',
            opened_at: ws.generated_at || new Date().toISOString(),
            completed_at: ws.completed_at || null,
            review_flags: {
              reviewed_income: !!ws.reviewed_income,
              reviewed_savings: !!ws.reviewed_savings,
              reviewed_expenses: !!ws.reviewed_expenses,
              reviewed_subscriptions: !!ws.reviewed_subscriptions
            },
            snapshot_payload: {
              summary_sentence: ws.summary_sentence || '',
              selected_insights: ws.selected_insights || [],
              month_end_reference: ws.month_end_reference || null,
              cash: null, budget: null, goal: null
            }
          });
        });
      });
    } catch(e) {
      console.warn('[achievements v5] migration error:', e);
      return emptyV5State();
    }
    return v5;
  }

  function loadAchievementsState() {
    let s = loadV5State();
    if (!s) {
      s = migrateV4toV5();
      saveV5State(s);
    }
    return s;
  }

  /* =====================================================================
     CADENCE / LOCK HELPERS
     ===================================================================== */

  function getLockedCadence(rec) {
    return rec ? rec.cadence_locked : null;
  }

  function lockMonthCadence(rec, cadence) {
    if (!rec.cadence_locked) {
      rec.cadence_locked = cadence;
      rec.cadence_locked_at = new Date().toISOString();
    }
  }

  // Whether Monthly check-in can still start for this month
  function canStartMonthly(rec) {
    if (!rec) return true;
    let locked = getLockedCadence(rec);
    if (locked === 'weekly') return true; // monthly can be additional artifact
    if (locked === 'monthly') return true;
    return true; // not yet locked
  }

  // Whether Weekly can start for this month (month not already locked to Monthly)
  function canStartWeekly(rec, monthKey) {
    if (!rec) return false;
    let locked = getLockedCadence(rec);
    if (locked === 'monthly') return false; // already monthly
    // Need at least one Sunday in the past
    let sundays = getMonthSundays(monthKey);
    return sundays.some(function(s) { return isSundayReached(s); });
  }

  function getCadenceLockMessage(rec, monthKey) {
    let locked = getLockedCadence(rec);
    if (locked === 'monthly') {
      return 'This month is being tracked in Monthly mode. Weekly tracking can start next month.';
    }
    let sundays = getMonthSundays(monthKey);
    let nextSunday = sundays.find(function(s) { return !isSundayReached(s); });
    let firstSunday = sundays.find(function(s) { return true; });
    if (!firstSunday) return 'No Sundays available in this month for weekly tracking.';
    if (!isSundayReached(firstSunday)) {
      return 'Weekly tracking becomes available on the next Sunday for this month (' + formatSundayLabel(firstSunday) + ').';
    }
    return null;
  }

  /* =====================================================================
     WEEKLY ENTRY MANAGEMENT
     ===================================================================== */

  function ensureWeeklyEntriesForMonth(rec, monthKey) {
    let sundays = getMonthSundays(monthKey);
    sundays.forEach(function(due, idx) {
      let existing = rec.weekly.entries.find(function(e) { return e.due_date === due; });
      if (!existing) {
        rec.weekly.entries.push({
          entry_id: monthKey + '::weekly::' + due,
          month_key: monthKey,
          sequence_in_month: idx + 1,
          due_date: due,
          status: 'locked',
          opened_at: null,
          completed_at: null,
          review_flags: { reviewed_income: false, reviewed_savings: false, reviewed_expenses: false, reviewed_subscriptions: false },
          snapshot_payload: null
        });
      } else {
        // Fix sequence numbers to match calendar order
        existing.sequence_in_month = idx + 1;
      }
    });
    // Sort by due date
    rec.weekly.entries.sort(function(a, b) { return a.due_date < b.due_date ? -1 : 1; });
  }

  // Update status of all entries based on current date and completions
  function refreshWeeklyEntryStatuses(rec) {
    let entries = rec.weekly.entries;
    for (let i = 0; i < entries.length; i++) {
      let e = entries[i];
      if (e.status === 'completed') continue;
      let reached = isSundayReached(e.due_date);
      // An entry is available only if it's reached AND the previous entry (if any) is completed
      let prevCompleted = i === 0 || entries[i-1].status === 'completed';
      if (reached && prevCompleted) {
        e.status = 'available';
        if (!e.opened_at) e.opened_at = new Date().toISOString();
      } else {
        e.status = 'locked';
      }
    }
  }

  function getNextAvailableWeeklyEntry(rec) {
    return rec.weekly.entries.find(function(e) { return e.status === 'available'; }) || null;
  }

  function getCurrentWeeklyEntry(rec) {
    // Show available first, then most recent completed
    let avail = getNextAvailableWeeklyEntry(rec);
    if (avail) return avail;
    let completed = rec.weekly.entries.filter(function(e) { return e.status === 'completed'; });
    return completed.length ? completed[completed.length - 1] : null;
  }

  function getPreviousCompletedWeeklyEntry(rec, entry) {
    let idx = rec.weekly.entries.indexOf(entry);
    for (let i = idx - 1; i >= 0; i--) {
      if (rec.weekly.entries[i].status === 'completed') return rec.weekly.entries[i];
    }
    return null;
  }

  function completeWeeklyEntry(rec, entry, vm) {
    entry.status = 'completed';
    entry.completed_at = new Date().toISOString();
    entry.review_flags = { reviewed_income: true, reviewed_savings: true, reviewed_expenses: true, reviewed_subscriptions: true };
    entry.snapshot_payload = {
      summary_sentence: vm.summary,
      selected_insights: vm.insights,
      month_end_reference: vm.mer,
      cash: vm.cash,
      budget: vm.budget,
      goal: vm.goal ? { state: vm.goal.state, pct: vm.goal.pct, current: vm.goal.current, target: vm.goal.target } : null
    };
    lockMonthCadence(rec, 'weekly');
  }

  function undoWeeklyEntry(rec, entry) {
    entry.status = 'available';
    entry.completed_at = null;
    entry.review_flags = { reviewed_income: false, reviewed_savings: false, reviewed_expenses: false, reviewed_subscriptions: false };
    entry.snapshot_payload = null;
    // Release cadence lock if this was the only completed entry (user was just testing)
    let stillCompleted = rec.weekly.entries.filter(function(e) { return e.status === 'completed'; });
    if (stillCompleted.length === 0) {
      rec.cadence_locked = null;
      rec.cadence_locked_at = null;
    }
  }

  /* =====================================================================
     MONTHLY SNAPSHOT MANAGEMENT (ported from v4 with month-record backing)
     ===================================================================== */

  function ensureMonthlySnapshot(rec, monthKey) {
    if (!rec.monthly.snapshot) {
      rec.monthly.snapshot = {
        id: 'ci_monthly_' + monthKey,
        period_key: monthKey,
        period_label: monthLabelFromKey(monthKey),
        check_in_status: 'active',
        generated_at: new Date().toISOString(),
        completed_at: null,
        reviewed_income: false, reviewed_savings: false,
        reviewed_expenses: false, reviewed_subscriptions: false,
        summary_sentence: '', selected_insights: [], month_end_reference: null
      };
    }
    return rec.monthly.snapshot;
  }

  function completeMonthlySnapshot(rec, snap, vm) {
    snap.check_in_status = 'completed';
    snap.completed_at = new Date().toISOString();
    snap.reviewed_income = snap.reviewed_savings = snap.reviewed_expenses = snap.reviewed_subscriptions = true;
    snap.summary_sentence = vm.summary;
    snap.selected_insights = vm.insights;
    snap.month_end_reference = vm.mer;
    // Lock cadence to monthly only if not already locked to weekly
    if (!rec.cadence_locked) lockMonthCadence(rec, 'monthly');
  }

  function undoMonthlySnapshot(snap) {
    snap.check_in_status = 'active';
    snap.completed_at = null;
    snap.reviewed_income = snap.reviewed_savings = snap.reviewed_expenses = snap.reviewed_subscriptions = false;
  }

  /* =====================================================================
     MONTHLY AVAILABILITY (preserved from v4)
     ===================================================================== */

  function checkinAvailability(viewedMonth) {
    let now = new Date();
    let monthNames = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];
    let parts = viewedMonth ? String(viewedMonth.name || '').split(' ') : [];
    let mo = parts.length === 2 ? monthNames.indexOf(parts[0]) : now.getMonth();
    let yr = parts.length === 2 ? parseInt(parts[1]) : now.getFullYear();
    let lastDay  = new Date(yr, mo + 1, 0);
    let openDate = new Date(yr, mo, lastDay.getDate() - 4);
    openDate.setHours(0, 0, 0, 0);
    let available = now >= openDate;
    let openLabel = openDate.toLocaleDateString('en-BE', { month: 'long', day: 'numeric' });
    return { available: available, openDate: openDate, openLabel: openLabel };
  }

  /* =====================================================================
     NOTIFICATION PILL
     ===================================================================== */

  function updateAchievementsPill() {
    let pill = document.getElementById('achievementsPill');
    if (!pill) return;
    try {
      let state = loadAchievementsState();
      let now = new Date();
      let currentMonthKey = calMonthKey();
      let viewedMonth = null;
      try { if (typeof getActiveMonth === 'function') viewedMonth = getActiveMonth(); } catch(e) {}
      let mk = viewedMonth ? monthKeyFromMonthObj(viewedMonth) : currentMonthKey;

      let yr = mk.substring(0, 4);
      let rec = state.years[yr] && state.years[yr].months[mk] ? state.years[yr].months[mk] : null;
      let locked = rec ? getLockedCadence(rec) : null;
      let showPill = false;

      if (locked === 'weekly' || (!locked && canStartWeekly(rec || { cadence_locked: null }, mk))) {
        if (rec) {
          ensureWeeklyEntriesForMonth(rec, mk);
          refreshWeeklyEntryStatuses(rec);
          let avail = getNextAvailableWeeklyEntry(rec);
          if (avail) showPill = true;
        } else {
          // No record yet — check if any sunday passed
          showPill = getMonthSundays(mk).some(isSundayReached);
        }
      }
      if (!showPill && locked !== 'weekly') {
        // Monthly pill: only in last 5 days and not completed
        let avInfo = checkinAvailability(viewedMonth);
        if (avInfo.available) {
          let snap = rec && rec.monthly ? rec.monthly.snapshot : null;
          if (!snap || snap.check_in_status !== 'completed') showPill = true;
        }
      }
      pill.style.display = showPill ? '' : 'none';
    } catch(e) { pill.style.display = 'none'; }
  }
  window.updateAchievementsPill = updateAchievementsPill;

  // Called by the main delete-month handler so check-in records stay in sync with app state
  window.deleteCheckinDataForMonth = function(monthName) {
    try {
      let mk = monthKeyFromMonthObj({ name: monthName });
      let state = loadAchievementsState();
      let yr = mk.substring(0, 4);
      if (state.years[yr] && state.years[yr].months[mk]) {
        delete state.years[yr].months[mk];
        // Clean up empty year buckets
        if (!Object.keys(state.years[yr].months).length) delete state.years[yr];
        saveV5State(state);
      }
    } catch(e) { console.warn('[achievements v5] deleteCheckinDataForMonth error:', e); }
  };

  /* =====================================================================
     VIEW-MODEL ENGINE (shared for both cadences)
     ===================================================================== */

  function fmtC(n) {
    if (typeof window.formatCurrency === 'function') return window.formatCurrency(n);
    return '\u20ac' + Math.abs(Number(n || 0)).toFixed(2);
  }

  function badgeFmtC(n) {
    let value = Math.max(0, Number(n || 0));
    try {
      return new Intl.NumberFormat('en-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
    } catch (e) {}
    return '\u20ac' + Math.round(value);
  }

  function buildPeriodContext(month) {
    let isClosed = false, daysLeft = 0, dayOfMonth = 1, daysInMonth = 30, ratio = 0;
    try {
      if (month && typeof monthDayStats === 'function') {
        let ds = monthDayStats(month.name);
        daysLeft = Math.max(ds.daysLeft, 0); daysInMonth = ds.daysInMonth || 30;
        dayOfMonth = ds.dayOfMonth || 1; isClosed = daysLeft === 0;
        ratio = daysInMonth > 0 ? Math.min(dayOfMonth / daysInMonth, 1) : 0;
      }
    } catch(e) {}
    return { isClosed: isClosed, daysLeft: daysLeft, dayOfMonth: dayOfMonth, daysInMonth: daysInMonth, ratio: ratio };
  }

  function computeCashPosition(month, ctx) {
    try {
      let alloc = allocationRows(month);

      let spent = alloc.rows.reduce(function(s, r) { return s + Math.max(0, Number(r.actual || 0)); }, 0);
      let avail = alloc.availableFunds || 0, left = avail - spent;
      let safe = ctx.daysLeft > 0 ? left / ctx.daysLeft : 0;
      let plan = ctx.daysInMonth > 0 ? avail / ctx.daysInMonth : 0;
      let state = ctx.isClosed
        ? (left > 0 ? 'ended_positive' : left < 0 ? 'overspent' : 'ended_zero')
        : (left < 0 ? 'critical' : safe < plan * 0.85 ? 'critical' : safe < plan ? 'tight' : 'stable');
      return { moneyLeft: left, daysLeft: ctx.daysLeft, safeDailySpend: safe,
               plannedPace: plan, availableFunds: avail, totalSpent: spent, state: state, isClosed: ctx.isClosed };
    } catch(e) { return null; }
  }

  function computeBudgetControl(month, ctx) {
    try {
      let alloc = allocationRows(month), budget = alloc.availableFunds || 0;
      let spent = alloc.rows.reduce(function(s, r) { return s + Math.max(0, Number(r.actual || 0)); }, 0);
      let variance = spent - budget * ctx.ratio, pct = budget > 0 ? (variance / budget) * 100 : 0;
      let trend = 'stable';
      try {
        let idx = window.state.months.findIndex(function(m) { return m.name === month.name; });
        if (idx > 0) {
          let pm = window.state.months[idx - 1], pa = allocationRows(pm);
          let pb = pa.availableFunds || 0;
          let ps = pa.rows.reduce(function(s, r) { return s + Math.max(0, Number(r.actual || 0)); }, 0);
          let diff = (budget > 0 ? spent / budget : 0) - (pb > 0 ? ps / pb : 0);
          trend = diff < -0.03 ? 'improving' : diff > 0.03 ? 'worsening' : 'stable';
        }
      } catch(e2) {}
      let co = ctx.isClosed
        ? (variance < -budget * 0.01 ? 'under_plan' : variance > budget * 0.01 ? 'over_plan' : 'on_plan')
        : null;
      return { actualSpend: spent, expectedSpend: budget * ctx.ratio, varianceAmount: variance,
               variancePct: pct, trend: trend, closedOutcome: co, periodBudget: budget, isClosed: ctx.isClosed };
    } catch(e) { return null; }
  }

  function resolveActiveGoal(month) {
    let goals = month && Array.isArray(month.goals) ? month.goals : [];
    if (!goals.length) return null;
    let rolling = goals.filter(function(g) { return g.goalMode === 'rolling' && Number(g.goalAmount || 0) > 0; });
    if (rolling.length) return rolling[0];
    let best = goals.filter(function(g) { return Number(g.goalAmount || 0) > 0; });
    if (!best.length) return null;
    best.sort(function(a, b) { return Number(b.goalAmount || 0) - Number(a.goalAmount || 0); });
    return best[0];
  }

  function computeGoalProgress(month, goal, ctx) {
    if (!goal) return null;
    try {
      let resolved       = resolveGoalProgressForGoal(month, goal);
      let totalTarget    = Math.max(0, Number(goal.goalAmount || 0));
      let baseProgress   = Math.max(0, Number(goal.baseProgress || 0));
      let thisMonthSaved = resolved.currentMonthProgress;
      let totalSaved     = resolved.totalProgress;  // = baseProgress + thisMonthSaved (rolling)

      // Find monthIndex by locating the origin month — the first month where this
      // goal appears with baseProgress = 0.  Works even when the goal only lives
      // on the active month: the active month IS the origin if baseProgress = 0.
      let monthIndex = 1;
      try {
        let allMonths = window.state && window.state.months;
        if (allMonths && allMonths.length) {
          let matchId   = goal.id   || null;
          let matchName = goal.name || null;
          let currentIdx = allMonths.findIndex(function(m) { return m.name === month.name; });

          // Walk from start to current month, looking for this goal with baseProgress=0
          let originIdx = currentIdx; // default: this month is month 1
          for (let i = 0; i <= currentIdx; i++) {
            let mg = allMonths[i].goals || [];
            for (let j = 0; j < mg.length; j++) {
              let g = mg[j];
              let isMatch = (matchId && g.id === matchId) || (matchName && g.name === matchName);
              if (isMatch && Number(g.baseProgress || 0) === 0) {
                originIdx = i;
                break;
              }
            }
            if (originIdx < currentIdx) break;
          }
          monthIndex = Math.max(1, currentIdx - originIdx + 1);
        }
      } catch(e2) {}

      // perMonth: what each month should contribute.
      // Derived from baseProgress — the exact sum of all prior months:
      //   baseProgress = (monthIndex - 1) * perMonth
      //   → perMonth = baseProgress / (monthIndex - 1)   [for month 2+]
      //   For month 1 (baseProgress=0): perMonth = thisMonthSaved (first data point)
      //   which means month 1 is always on-pace — correct, there is no prior average to compare against.
      let perMonth;
      if (monthIndex === 1) {
        // First month of the goal — no prior average exists.
        // Any positive contribution is on-pace; only zero saved is behind.
        perMonth = thisMonthSaved > 0 ? thisMonthSaved : 1;
      } else {
        perMonth = baseProgress / (monthIndex - 1);
      }

      let delta = thisMonthSaved - perMonth;
      let state = delta > 0 ? 'ahead' : delta < 0 ? 'behind' : 'on-pace';
      let dailyRate = ctx.dayOfMonth > 0 ? totalSaved / ctx.dayOfMonth : 0;

      return {
        name:      goal.name || 'Goal',
        target:    totalTarget,
        current:   totalSaved,
        remaining: Math.max(0, totalTarget - totalSaved),
        pct:       totalTarget > 0 ? Math.min((totalSaved / totalTarget) * 100, 100) : 0,
        daysLeft:  ctx.daysLeft,
        projected: totalSaved + dailyRate * ctx.daysLeft,
        state:     state,
        isClosed:  ctx.isClosed
      };
    } catch(e) { return null; }
  }


  function buildSummarySentence(cash, budget, goal, ctx) {
    let parts = [];
    if (cash) {
      parts.push(ctx.isClosed
        ? (cash.state === 'ended_positive' ? 'month ended with funds remaining'
          : cash.state === 'overspent' ? 'month ended overspent' : 'month ended balanced')
        : (cash.state === 'stable' ? 'cash position is stable'
          : cash.state === 'tight' ? 'cash is getting tight' : 'cash position is critical'));
    }
    if (budget) {
      parts.push(ctx.isClosed
        ? (budget.closedOutcome === 'under_plan' ? 'spending finished under plan'
          : budget.closedOutcome === 'over_plan' ? 'spending finished over plan' : 'spending finished on plan')
        : (budget.trend === 'improving' ? 'spending is improving'
          : budget.trend === 'worsening' ? 'spending is above pace' : 'spending is on plan'));
    }
    if (goal) {
      // §1 — simplified labels, no "for month" suffix
      parts.push(goal.state === 'ahead'
        ? goal.name + (ctx.isClosed ? ' exceeded target' : ' is ahead of pace')
        : goal.state === 'behind'
        ? goal.name + (ctx.isClosed ? ' finished behind target' : ' is behind schedule')
        : goal.name + (ctx.isClosed ? ' was on target' : ' is on pace'));
    }
    if (!parts.length) return 'No activity recorded yet for this period.';
    let s = parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1];
    return s.charAt(0).toUpperCase() + s.slice(1) + '.';
  }

  function buildSummaryMeta(budget) {
    if (!budget || !budget.periodBudget) return '';
    return 'Spending is ' + fmtC(Math.abs(budget.varianceAmount))
      + (budget.varianceAmount >= 0 ? ' above' : ' below')
      + ' expected pace (' + Math.abs(budget.variancePct).toFixed(1) + '% vs plan).';
  }

  function buildInsightRows(cash, budget, goal, ctx) {
    let rows = [];
    if (budget && Math.abs(budget.varianceAmount) > 5)
      rows.push('Spending is ' + fmtC(Math.abs(budget.varianceAmount))
        + (budget.varianceAmount > 0 ? ' above' : ' below')
        + ' expected pace (' + Math.abs(budget.variancePct).toFixed(1) + '% vs plan)');
    if (goal && goal.state === 'behind')
      rows.push(goal.name + ' is behind pace \u2014 ' + fmtC(goal.remaining) + ' to go'
        + (ctx.daysLeft > 0 ? ' with ' + ctx.daysLeft + ' days left' : ''));
    else if (goal && goal.state === 'ahead')
      rows.push(goal.name + ' is ahead \u2014 ' + Math.round(goal.pct) + '% complete');
    if (cash && (cash.state === 'tight' || cash.state === 'critical') && !ctx.isClosed && rows.length < 2)
      rows.push('Safe daily spend (' + fmtC(cash.safeDailySpend) + '/day) is below planned pace');
    return rows.slice(0, 2);
  }

  /* =====================================================================
     FINANCIAL PROGRESS ENGINE — data derivation
     ===================================================================== */

  function getFinancialProgressSignals(viewedMonth, mode) {
    if (!viewedMonth) return null;
    try {
      let ctx  = buildPeriodContext(viewedMonth);
      let alloc = allocationRows(viewedMonth);
      let avail = alloc.availableFunds || 0;
      let rows  = alloc.rows || [];

      // Income / spending totals
      let spendingTotal = rows.reduce(function(s, r) {
        return r.key !== 'savings' ? s + Math.max(0, Number(r.actual || 0)) : s;
      }, 0);
      let savingsActual = rows.reduce(function(s, r) {
        return r.key === 'savings' ? s + Math.max(0, Number(r.actual || 0)) : s;
      }, 0);
      let incomeTotal = avail;
      let savingsRate  = incomeTotal > 0 ? savingsActual / incomeTotal : 0;
      let spendingRate = incomeTotal > 0 ? spendingTotal / incomeTotal : 0;

      // Category breakdown (non-savings)
      let byCategory = rows
        .filter(function(r) { return r.key !== 'savings'; })
        .map(function(r) { return { name: r.label, amount: Math.max(0, Number(r.actual || 0)) }; })
        .filter(function(c) { return c.amount > 0; })
        .sort(function(a, b) { return b.amount - a.amount; });

      // Previous period
      let prevSavingsRate = 0, prevSpendingRate = 0, prevByCategory = [];
      try {
        let months = window.state && window.state.months;
        if (months && months.length) {
          let idx = months.findIndex(function(m) { return m.name === viewedMonth.name; });
          if (idx > 0) {
            let pm = months[idx - 1];
            let pa = allocationRows(pm);
            let pAvail = pa.availableFunds || 0;
            let pRows  = pa.rows || [];
            let pSpend = pRows.reduce(function(s, r) {
              return r.key !== 'savings' ? s + Math.max(0, Number(r.actual || 0)) : s;
            }, 0);
            let pSav = pRows.reduce(function(s, r) {
              return r.key === 'savings' ? s + Math.max(0, Number(r.actual || 0)) : s;
            }, 0);
            prevSavingsRate  = pAvail > 0 ? pSav / pAvail : 0;
            prevSpendingRate = pAvail > 0 ? pSpend / pAvail : 0;
            prevByCategory = pRows
              .filter(function(r) { return r.key !== 'savings'; })
              .map(function(r) { return { name: r.label, amount: Math.max(0, Number(r.actual || 0)) }; });
          }
        }
      } catch(e2) {}

      // Rolling savings rates for benchmark (last 6 periods)
      let rollingRates = [];
      try {
        let months2 = window.state && window.state.months;
        if (months2 && months2.length) {
          let cur2 = months2.findIndex(function(m) { return m.name === viewedMonth.name; });
          for (let i = Math.max(0, cur2 - 5); i <= cur2; i++) {
            let rm = months2[i];
            let ra = allocationRows(rm);
            let rAv = ra.availableFunds || 0;
            let rS = (ra.rows || []).reduce(function(s, r) {
              return r.key === 'savings' ? s + Math.max(0, Number(r.actual || 0)) : s;
            }, 0);
            rollingRates.push(rAv > 0 ? rS / rAv : 0);
          }
        }
      } catch(e3) {}

      // Check-in streak from v5 state
      let streak = 0;
      try {
        let v5 = loadAchievementsState();
        let allMks = [];
        Object.keys(v5.years).forEach(function(y) {
          Object.keys(v5.years[y].months).forEach(function(m) { allMks.push(m); });
        });
        allMks.sort().reverse();
        let currentMk = monthKeyFromMonthObj(viewedMonth);
        for (let si = 0; si < allMks.length; si++) {
          let smk = allMks[si];
          let srec = v5.years[smk.substring(0,4)] && v5.years[smk.substring(0,4)].months[smk];
          if (!srec) break;
          let hasCompletion = (srec.monthly && srec.monthly.snapshot && srec.monthly.snapshot.completed_at)
            || (srec.weekly && srec.weekly.entries && srec.weekly.entries.some(function(e) { return e.status === 'completed'; }));
          if (!hasCompletion) break;
          streak++;
        }
      } catch(e4) {}

      // Goal data
      let goal = null;
      try { goal = computeGoalProgress(viewedMonth, resolveActiveGoal(viewedMonth), ctx); } catch(e5) {}

      return {
        mode: mode || 'monthly',
        incomeTotal: incomeTotal,
        spendingTotal: spendingTotal,
        savingsActual: savingsActual,
        savingsRate: savingsRate,
        spendingRate: spendingRate,
        prevSavingsRate: prevSavingsRate,
        prevSpendingRate: prevSpendingRate,
        savingsRateChange: savingsRate - prevSavingsRate,
        spendingRateChange: spendingRate - prevSpendingRate,
        byCategory: byCategory,
        prevByCategory: prevByCategory,
        rollingRates: rollingRates,
        goal: goal,
        streak: streak,
        ctx: ctx,
        periodLabel: viewedMonth.name
      };
    } catch(e) { return null; }
  }

  /* =====================================================================
     FINANCIAL PROGRESS ENGINE — signal-to-visual mapper
     ===================================================================== */

  function mapSignalsToProgressCard(sig) {
    if (!sig) return null;

    // ── Delta blocks
    let deltaBlocks = [];
    let SAV_THRESH = 0.05, SPD_THRESH = 0.05, CAT_THRESH = 0.08;

    if (Math.abs(sig.savingsRateChange) >= SAV_THRESH) {
      let sc = sig.savingsRateChange;
      deltaBlocks.push({
        label: 'Savings',
        value: (sc >= 0 ? '+' : '') + (sc * 100).toFixed(1) + '%',
        arrow: sc >= 0 ? '\u2191' : '\u2193',
        tone: sc >= 0 ? 'fp-pos' : 'fp-neg'
      });
    }
    if (Math.abs(sig.spendingRateChange) >= SPD_THRESH) {
      let spc = sig.spendingRateChange;
      // Spending going down is good
      deltaBlocks.push({
        label: 'Spending',
        value: (spc >= 0 ? '+' : '') + (spc * 100).toFixed(1) + '%',
        arrow: spc >= 0 ? '\u2191' : '\u2193',
        tone: spc <= 0 ? 'fp-pos' : 'fp-neg'
      });
    }
    // Top category change
    if (deltaBlocks.length < 3 && sig.byCategory.length && sig.prevByCategory.length) {
      let topCat = sig.byCategory[0];
      let prevCat = sig.prevByCategory.find(function(c) { return c.name === topCat.name; });
      let prevShare = prevCat && sig.spendingTotal > 0 ? prevCat.amount / (sig.prevByCategory.reduce(function(s,c){return s+c.amount;},0) || 1) : 0;
      let curShare  = sig.spendingTotal > 0 ? topCat.amount / sig.spendingTotal : 0;
      let catChange = curShare - prevShare;
      if (Math.abs(catChange) >= CAT_THRESH && curShare > 0.1) {
        deltaBlocks.push({
          label: topCat.name.length > 12 ? topCat.name.substring(0, 11) + '\u2026' : topCat.name,
          value: (catChange >= 0 ? '+' : '') + (catChange * 100).toFixed(1) + '%',
          arrow: catChange >= 0 ? '\u2191' : '\u2193',
          tone: catChange <= 0 ? 'fp-pos' : 'fp-warn'
        });
      }
    }
    deltaBlocks = deltaBlocks.slice(0, 3);

    // ── Goal block
    let goal = sig.goal;

    // ── Benchmark chip
    let benchmark = null;
    let rr = sig.rollingRates;
    if (rr.length >= 2) {
      let sorted = rr.slice().sort(function(a, b) { return b - a; });
      let rankPos = sorted.indexOf(sig.savingsRate) + 1;
      let n = rr.length;
      if (rankPos === 1 && n >= 3) {
        benchmark = { label: 'Top 1/' + n, cls: 'rank-top' };
      } else if (rankPos === n && n >= 3) {
        benchmark = { label: 'Bottom tier', cls: 'rank-bottom' };
      } else if (sig.savingsRateChange > SAV_THRESH && sig.prevSavingsRate < sig.savingsRate) {
        benchmark = { label: 'Recovered', cls: '' };
      } else {
        // Stability: low variance in last 3
        if (rr.length >= 3) {
          let last3 = rr.slice(-3);
          let mean3 = last3.reduce(function(s,v){return s+v;},0)/3;
          let variance3 = last3.reduce(function(s,v){return s+Math.pow(v-mean3,2);},0)/3;
          if (Math.sqrt(variance3) < 0.03) benchmark = { label: 'Stable trend', cls: '' };
        }
      }
    }

    // ── Highlight chip
    let highlight = null;
    if (goal) {
      let pct = Math.round(goal.pct);
      if (pct >= 50 && pct < 60) highlight = { label: '\uD83C\uDFAF 50% Goal' };
      else if (pct >= 75 && pct < 85) highlight = { label: '\uD83C\uDFAF 75% Goal' };
      else if (pct >= 90) highlight = { label: '\uD83C\uDFAF ' + pct + '% Goal' };
    }
    if (!highlight && sig.streak >= 3) {
      highlight = { label: '\uD83D\uDD25 ' + sig.streak + ' streak' };
    }
    if (!highlight && rr.length >= 2 && sig.savingsRate === Math.max.apply(null, rr)) {
      highlight = { label: '\uD83D\uDCC8 Best Month' };
    }

    // ── Primary state
    let primaryState = 'stable';

    if (goal) {
      if (goal.state === 'ahead') { primaryState = 'progress'; }
      else if (goal.state === 'behind') { primaryState = 'drift'; }
    }
    if (primaryState === 'stable') {
      if (sig.savingsRateChange >= SAV_THRESH || sig.spendingRateChange <= -SPD_THRESH) primaryState = 'progress';
      else if (sig.savingsRateChange <= -SAV_THRESH || sig.spendingRateChange >= SPD_THRESH) primaryState = 'drift';
    }

    return {
      primaryState: primaryState,
      deltaBlocks: deltaBlocks,
      goal: goal,
      benchmark: benchmark,
      highlight: highlight
    };
  }

  /* =====================================================================
     FINANCIAL PROGRESS ENGINE — renderer
     ===================================================================== */

  function renderFinancialProgressEngineCard(mapped) {
    // Always render all sections regardless of data — card height must never change.
    // Empty/no-data state uses dimmed placeholders.
    let noData = !mapped;
    let cls = 'financial-progress-card ui-3d-panel ui-3d-ach-progress state-' + (mapped ? mapped.primaryState : 'stable');
    let html = '<section class="' + cls + '">';

    // ── Top meta row
    let benchmarkHtml = (mapped && mapped.benchmark)
      ? '<span class="fp-benchmark-chip ' + (mapped.benchmark.cls || '') + '">' + mapped.benchmark.label + '</span>'
      : '';
    let highlightHtml = (mapped && mapped.highlight)
      ? '<span class="fp-highlight-chip">' + mapped.highlight.label + '</span>'
      : '';
    let topTitleState = mapped ? mapped.primaryState : 'stable';
    let topTitleLabel = noData
      ? 'Financial Progress'
      : (topTitleState === 'drift'
          ? 'Needs Attention'
          : (topTitleState === 'progress' ? 'On Track' : 'In Review'));
    let topTitleHtml = '<div class="fp-top-title state-' + topTitleState + '"><span class="fp-top-title-indicator"></span><span class="fp-top-title-label">' + topTitleLabel + '</span></div>';
    html += '<div class="fp-top-row">' + topTitleHtml + '<div class="fp-meta-row">' + benchmarkHtml + highlightHtml + '</div></div>';

    // ── Delta row (always 3 blocks — empty/dimmed if no data)
    html += '<div class="fp-delta-row" style="--fp-delta-cols:3;">';
    let dBlocks = (mapped && mapped.deltaBlocks && mapped.deltaBlocks.length)
      ? mapped.deltaBlocks
      : [];
    // Pad to exactly 3 slots
    let slots = [
      dBlocks[0] || null,
      dBlocks[1] || null,
      dBlocks[2] || null
    ];
    slots.forEach(function(b) {
      if (b) {
        html += '<div class="fp-delta-block">'
          + '<div class="fp-delta-label">' + b.label + '</div>'
          + '<div class="fp-delta-value ' + b.tone + '">' + b.arrow + ' ' + b.value + '</div>'
          + '</div>';
      } else {
        html += '<div class="fp-delta-block" style="opacity:0.3;">'
          + '<div class="fp-delta-label">–</div>'
          + '<div class="fp-delta-value" style="color:var(--muted);font-size:0.72rem;">No change</div>'
          + '</div>';
      }
    });
    html += '</div>';

    // ── Goal block (always — empty state if no goal)
    let g = mapped && mapped.goal ? mapped.goal : null;
    if (g) {
      let goalPct = Math.min(100, Math.max(0, g.pct));
      let chipCls   = g.state === 'ahead' ? 'chip-ahead' : g.state === 'behind' ? 'chip-behind' : 'chip-on-track';
      let chipLabel = g.state === 'ahead' ? 'Ahead' : g.state === 'behind' ? 'Behind' : 'On Track';
      let fillCls   = g.state === 'ahead' ? 'fill-ahead' : g.state === 'behind' ? 'fill-behind' : 'fill-on-track';
      let markerPct = Math.min(97, Math.max(3,
        g.state === 'ahead'  ? goalPct - 10 :
        g.state === 'behind' ? goalPct + 10 : goalPct));
      html += '<div class="fp-goal-block">'
        + '<div class="fp-goal-top">'
        + '<div class="fp-goal-title">'
        + '<span class="fp-goal-eyebrow">Goal</span>'
        + '<span class="fp-goal-name">' + g.name + '</span>'
        + '</div>'
        + '<span class="fp-goal-chip ' + chipCls + '">' + chipLabel + '</span>'
        + '</div>'
        + '<div class="fp-goal-bar-wrap"><div class="fp-goal-bar">'
        + '<div class="fp-goal-fill ' + fillCls + '" style="width:' + goalPct.toFixed(1) + '%"></div>'
        + '</div><div class="fp-goal-marker" style="left:' + markerPct.toFixed(1) + '%"></div></div>'
        + '<div class="fp-goal-meta">'
        + '<span class="fp-goal-meta-val"><strong>' + goalPct.toFixed(0) + '%</strong> done</span>'
        + '<span class="fp-goal-meta-val">' + fmtC(g.current) + ' / ' + fmtC(g.target) + '</span>'
        + '</div></div>';
    } else {
      // Empty goal block — same structure, dimmed
      html += '<div class="fp-goal-block" style="opacity:0.3;">'
        + '<div class="fp-goal-top">'
        + '<div class="fp-goal-title"><span class="fp-goal-eyebrow">Goal</span>'
        + '<span class="fp-goal-name">No active goal</span></div>'
        + '<span class="fp-goal-chip chip-on-track" style="visibility:hidden;">–</span>'
        + '</div>'
        + '<div class="fp-goal-bar-wrap"><div class="fp-goal-bar">'
        + '<div class="fp-goal-fill fill-on-track" style="width:0%"></div>'
        + '</div></div>'
        + '<div class="fp-goal-meta">'
        + '<span class="fp-goal-meta-val">Set a goal to track progress</span>'
        + '<span class="fp-goal-meta-val" style="visibility:hidden;">–</span>'
        + '</div></div>';
    }

    html += '</section>';
    return html;
  }


  function buildAchievementsViewModel(viewedMonth) {
    let ctx    = buildPeriodContext(viewedMonth);
    let cash   = viewedMonth ? computeCashPosition(viewedMonth, ctx)  : null;
    let budget = viewedMonth ? computeBudgetControl(viewedMonth, ctx) : null;
    let goal   = null;
    try { if (viewedMonth) goal = computeGoalProgress(viewedMonth, resolveActiveGoal(viewedMonth), ctx); } catch(e) {}
    let summary  = buildSummarySentence(cash, budget, goal, ctx);
    let insights = buildInsightRows(cash, budget, goal, ctx);
    let mer = {
      is_closed: ctx.isClosed,
      cash_state:           cash   ? cash.state : null,
      budget_state:         budget ? (ctx.isClosed ? budget.closedOutcome : budget.trend) : null,
      goal_state:           goal   ? goal.state : null,
      goal_progress_amount: goal   ? goal.current : 0,
      goal_target_amount:   goal   ? goal.target  : 0
    };
    return { summary: summary, meta: buildSummaryMeta(budget), cash: cash, budget: budget,
             goal: goal, insights: insights, ctx: ctx, mer: mer, hasMonth: !!viewedMonth };
  }


  function renderCashBlock(cash) {
    if (!cash) return '<div class="momentum-block ui-3d-panel ui-3d-ach-kpi mb-cash"><div class="momentum-block-title">Cash Position</div><div class="momentum-block-primary val-warn">\u2014</div></div>';
    let chipClass, chipLabel, pc;
    if (cash.isClosed) {
      chipClass = cash.state === 'ended_positive' ? 'chip-ended-positive'
        : cash.state === 'overspent' ? 'chip-overspent' : 'chip-ended-zero';
      chipLabel = cash.state === 'ended_positive' ? 'Ended positive'
        : cash.state === 'overspent' ? 'Overspent' : 'Ended balanced';
      pc = cash.state === 'ended_positive' ? 'val-good' : cash.state === 'overspent' ? 'val-bad' : '';
    } else {
      chipClass = cash.state === 'stable' ? 'chip-stable' : cash.state === 'tight' ? 'chip-tight' : 'chip-critical';
      chipLabel = cash.state === 'stable' ? 'Stable' : cash.state === 'tight' ? 'Tight' : 'Critical';
      pc = cash.state === 'stable' ? 'val-good' : cash.state === 'tight' ? 'val-warn' : 'val-bad';
    }
    return '<div class="momentum-block ui-3d-panel ui-3d-ach-kpi mb-cash"><div class="momentum-block-title">Cash Position</div>'
      + '<div class="momentum-block-primary ' + pc + '">' + fmtC(cash.moneyLeft) + '</div>'
      + '<div class="momentum-block-rows">'
      + (!cash.isClosed ? '<div class="momentum-block-row"><span class="momentum-block-row-label">Days left</span><span class="momentum-block-row-val">' + cash.daysLeft + '</span></div>' : '')
      + (cash.daysLeft > 0 && !cash.isClosed ? '<div class="momentum-block-row"><span class="momentum-block-row-label">Safe pace</span><span class="momentum-block-row-val">' + fmtC(cash.safeDailySpend) + '/day</span></div>' : '')
      + '</div><span class="momentum-state-chip ' + chipClass + '">' + chipLabel + '</span></div>';
  }

  function renderBudgetBlock(budget) {
    if (!budget) return '<div class="momentum-block ui-3d-panel ui-3d-ach-kpi mb-budget"><div class="momentum-block-title">Budget Control</div><div class="momentum-block-primary">\u2014</div></div>';
    let sign = budget.varianceAmount >= 0 ? '+' : '\u2212';
    let chipClass, chipLabel;
    if (budget.isClosed) {
      chipClass = budget.closedOutcome === 'under_plan' ? 'chip-under-plan'
        : budget.closedOutcome === 'over_plan' ? 'chip-over-plan' : 'chip-on-plan';
      chipLabel = budget.closedOutcome === 'under_plan' ? 'Finished under plan'
        : budget.closedOutcome === 'over_plan' ? 'Finished over plan' : 'Finished on plan';
    } else {
      chipClass = budget.trend === 'improving' ? 'chip-improving'
        : budget.trend === 'worsening' ? 'chip-worsening' : 'chip-neutral';
      chipLabel = budget.trend === 'improving' ? 'Improving'
        : budget.trend === 'worsening' ? 'Worsening' : 'Stable';
    }
    let pc = budget.varianceAmount > budget.periodBudget * 0.1 ? 'val-bad'
      : budget.varianceAmount > 0 ? 'val-warn' : 'val-good';
    return '<div class="momentum-block ui-3d-panel ui-3d-ach-kpi mb-budget"><div class="momentum-block-title">Budget Control</div>'
      + '<div class="momentum-block-primary ' + pc + '">' + sign + fmtC(Math.abs(budget.varianceAmount)) + '</div>'
      + '<div class="momentum-block-rows">'
      + '<div class="momentum-block-row"><span class="momentum-block-row-label">vs expected</span><span class="momentum-block-row-val">' + (budget.varianceAmount >= 0 ? '+' : '\u2212') + Math.abs(budget.variancePct).toFixed(1) + '%</span></div>'
      + '<div class="momentum-block-row"><span class="momentum-block-row-label">Spent</span><span class="momentum-block-row-val">' + fmtC(budget.actualSpend) + '</span></div>'
      + '</div><span class="momentum-state-chip ' + chipClass + '">' + chipLabel + '</span></div>';
  }

  function renderGoalBlock(goal) {
    if (!goal) return '<div class="momentum-block ui-3d-panel ui-3d-ach-kpi mb-goal"><div class="momentum-block-title">Goal Progress</div><div class="momentum-block-primary" style="font-size:0.72rem;font-family:var(--font-ui);color:var(--muted);">No active goal</div></div>';
    let chipClass = goal.state === 'ahead' ? 'chip-ahead' : goal.state === 'behind' ? 'chip-behind' : 'chip-on-pace';
    let chipLabel = goal.state === 'ahead' ? 'Ahead' : goal.state === 'behind' ? 'Behind' : 'On pace';
    let pc = goal.state === 'behind' ? 'val-warn' : goal.state === 'ahead' ? 'val-good' : '';
    return '<div class="momentum-block ui-3d-panel ui-3d-ach-kpi mb-goal"><div class="momentum-block-title">' + goal.name + '</div>'
      + '<div class="momentum-block-primary ' + pc + '">' + Math.round(goal.pct) + '%</div>'
      + '<div class="momentum-block-rows">'
      + '<div class="momentum-block-row"><span class="momentum-block-row-label">Progress</span><span class="momentum-block-row-val">' + fmtC(goal.current) + ' / ' + fmtC(goal.target) + '</span></div>'
      + '<div class="momentum-block-row"><span class="momentum-block-row-label">Remaining</span><span class="momentum-block-row-val">' + fmtC(goal.remaining) + '</span></div>'
      + '</div><span class="momentum-state-chip ' + chipClass + '">' + chipLabel + '</span></div>';
  }

  function renderMicroInsights(insights) {
    if (!insights || !insights.length) return '';
    return '<div class="micro-insights-section">'
      + insights.map(function(t) {
          return '<div class="micro-insight-row"><span class="micro-insight-dot"></span>' + t + '</div>';
        }).join('')
      + '</div>';
  }

  function renderKpiRow(vm) {
    return renderCashBlock(vm.cash)
      + renderBudgetBlock(vm.budget)
      + renderGoalBlock(vm.goal);
  }

  // Always renders all 3 KPI blocks. Before first check-in they show a dimmed empty state.
  function renderAlwaysOnKpiRow(vm, rec, cadence) {
    let hasData = false;
    if (cadence === 'weekly') {
      hasData = rec.weekly && rec.weekly.entries && rec.weekly.entries.some(function(e) { return e.status === 'completed'; });
    } else {
      hasData = !!(rec.monthly && rec.monthly.snapshot && rec.monthly.snapshot.completed_at);
    }

    if (hasData) {
      if (cadence === 'weekly') {
        let completedEntries = rec.weekly.entries.filter(function(e) { return e.status === 'completed'; });
        let shownEntry = completedEntries[completedEntries.length - 1];
        if (shownEntry) {
          let prevEntry = getPreviousCompletedWeeklyEntry(rec, shownEntry);
          if (prevEntry) {
            let delta = renderWeeklyKpiDelta(shownEntry, prevEntry);
            if (delta) return delta; // already bare blocks
          }
        }
      }
      return renderCashBlock(vm.cash) + renderBudgetBlock(vm.budget) + renderGoalBlock(vm.goal);
    }

    // Empty state tiles — same structure as full tiles, dimmed, so height never changes
    let emptyTile = function(title) {
      return '<div class="momentum-block ui-3d-panel ui-3d-ach-kpi" style="opacity:0.35;">'
        + '<div class="momentum-block-title">' + title + '</div>'
        + '<div class="momentum-block-primary" style="font-size:0.72rem;font-family:var(--font-ui);color:var(--muted);">–</div>'
        + '<div class="momentum-block-rows">'
        + '<div class="momentum-block-row"><span class="momentum-block-row-label" style="visibility:hidden;">–</span><span class="momentum-block-row-val" style="visibility:hidden;">–</span></div>'
        + '<div class="momentum-block-row"><span class="momentum-block-row-label" style="visibility:hidden;">–</span><span class="momentum-block-row-val" style="visibility:hidden;">–</span></div>'
        + '</div>'
        + '<span class="momentum-state-chip chip-neutral" style="visibility:hidden;">–</span>'
        + '</div>';
    };
    return emptyTile('Cash Position')
      + emptyTile('Budget Control')
      + emptyTile('Goal Progress');
  }


  /* =====================================================================
     CADENCE SELECTOR / STATUS AREA — v5
     ===================================================================== */

  // Build inline-info tooltip HTML using the same markup as the Overview tab.
  // inlineInfoTriggerHtml() lives in a different scope so we reproduce the markup
  // directly — the global event delegation picks it up automatically.
  function buildInlineInfoHtml(tooltipId, tooltipHtml, label) {
    let escape = typeof window.escapeHtml === 'function' ? window.escapeHtml : function(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    };
    let icon = '<svg class="inline-info-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 1.75a6.25 6.25 0 1 0 0 12.5a6.25 6.25 0 0 0 0-12.5Zm0 11a4.75 4.75 0 1 1 0-9.5a4.75 4.75 0 0 1 0 9.5Zm-.9-7.05a.9.9 0 1 1 1.8 0a.9.9 0 0 1-1.8 0Zm.2 2.05h1.4v3.75H7.3V7.75Z" fill="currentColor"></path></svg>';
    return '<span class="inline-info-wrap is-left" data-inline-info-id="' + escape(tooltipId) + '">'
      + '<button type="button" class="inline-info-trigger" aria-label="' + escape(label || 'More information') + '" aria-expanded="false" data-inline-info-trigger data-tooltip-html="' + escape(tooltipHtml) + '">' + icon + '</button></span>';
  }

  function renderCadenceSelectorV5(rec, monthKey, selectedCadence) {
    let locked = rec ? getLockedCadence(rec) : null;

    // Tooltip merges purpose + cadence explanation (replaces the old purpose banner + the old ⓘ title attr)
    let tooltipHtml = '<ul class="info-tooltip-list">'
      + '<li>Review that Income, Savings, Expenses, and Subscriptions are up to date, then confirm to mark this period as reviewed.</li>'
      + '<li><strong>Monthly:</strong> one check-in at the end of each month.</li>'
      + '<li><strong>Weekly:</strong> a check-in every Sunday within the month. The first completed check-in locks the cadence for that month.</li>'
      + '<li>Past months always keep the cadence they were originally tracked with.</li>'
      + '</ul>';
    let infoBtn = buildInlineInfoHtml('checkinCadenceTooltip', tooltipHtml, 'Check-in cadence info');

    if (locked) {
      let labelClass = locked === 'weekly' ? 'lock-weekly' : 'lock-monthly';
      let labelText  = locked === 'weekly'  ? 'Tracked Weekly' : 'Tracked Monthly';
      return '<div class="checkin-cadence-selector">'
        + '<span class="checkin-mode-label">Review cadence:</span>'
        + infoBtn
        + '<span class="checkin-cadence-locked-label ' + labelClass + '">' + labelText + '</span>'
        + '</div>';
    }

    // Not yet locked — immediate-change select, no Apply/Cancel needed
    let draft = selectedCadence || 'monthly';
    return '<div class="checkin-cadence-selector">'
      + '<span class="checkin-mode-label">Review cadence:</span>'
      + infoBtn
      + '<select class="checkin-cadence-select" id="checkinCadenceSelect">'
      + '<option value="monthly"' + (draft === 'monthly' ? ' selected' : '') + '>Monthly</option>'
      + '<option value="weekly"'  + (draft === 'weekly'  ? ' selected' : '') + '>Weekly</option>'
      + '</select>'
      + '</div>';
  }

  /* =====================================================================
     MONTHLY CHECK-IN CARD — unchanged UX from v737
     ===================================================================== */

  function renderConfirmChecklistFooter(snap, idPrefix) {
    idPrefix = idPrefix || '';
    let checkItems = [
      { key: 'reviewed_income',        label: 'Income reviewed' },
      { key: 'reviewed_savings',       label: 'Savings reviewed' },
      { key: 'reviewed_expenses',      label: 'Expenses reviewed' },
      { key: 'reviewed_subscriptions', label: 'Subscriptions reviewed' }
    ];
    let flags = snap.review_flags || snap; // support both weekly entry and monthly snapshot
    let anyChecked = checkItems.some(function(i) { return flags[i.key]; });
    let allChecked = checkItems.every(function(i) { return flags[i.key]; });

    if (anyChecked) {
      let listHtml = checkItems.map(function(item) {
        let chk = !!flags[item.key];
        return '<label class="checkin-confirm-item' + (chk ? ' is-checked' : '') + '" data-confirm-key="' + item.key + '">'
          + '<span class="checkin-confirm-checkbox">' + (chk ? '&#10003;' : '') + '</span>'
          + '<span class="checkin-confirm-item-label">' + item.label + '</span></label>';
      }).join('');
      return '<div class="checkin-confirm-panel" id="' + idPrefix + 'checkinConfirmPanel">'
        + '<div class="checkin-confirm-panel-title">Ready to save this review?</div>'
        + '<div class="checkin-confirm-list">' + listHtml + '</div>'
        + '<button class="checkin-confirm-btn" id="' + idPrefix + 'checkinConfirmSaveBtn" type="button"'
        + (allChecked ? '' : ' disabled') + '>Save review</button>'
        + '</div>';
    }
    return '<div class="checkin-footer">'
      + '<button class="checkin-cta-btn" id="' + idPrefix + 'checkinCompleteBtn" type="button">Mark all reviewed</button>'
      + '</div>';
  }

  function renderMonthlyCheckinCard(vm, snap, viewedMonth, cadenceHtml) {
    let completed = snap && snap.check_in_status === 'completed';
    let periodLabel = snap ? snap.period_label : (viewedMonth ? viewedMonth.name : 'This month');

    let avail = checkinAvailability(viewedMonth);

    let statusClass = vm.ctx.isClosed ? 'state-on-track'
      : (vm.cash && vm.cash.state === 'critical' ? 'state-overspend'
      : (vm.budget && vm.budget.trend === 'worsening' ? 'state-warning' : 'state-on-track'));

    let footerHtml;
    if (completed) {
      let at = snap.completed_at
        ? new Date(snap.completed_at).toLocaleDateString('en-BE', { month: 'short', day: 'numeric' }) : '';
      footerHtml = '<div class="checkin-footer" style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:rgba(16,185,129,0.05);border-top:1px solid rgba(16,185,129,0.18);">'
        + '<span style="font-size:0.70rem;font-weight:600;color:#065f46;">&#10003; Check-in completed' + (at ? ' \xb7 ' + at : '') + '</span>'
        + '<button class="checkin-undo-btn" id="checkinUndoBtn" type="button">Undo</button>'
        + '</div>';
    } else if (!avail.available) {
      footerHtml = '<div class="checkin-footer" style="display:flex;align-items:center;gap:8px;">'
        + '<span style="font-size:0.68rem;color:var(--muted);">&#128274; Available from ' + avail.openLabel + '</span>'
        + '</div>';
    } else {
      footerHtml = renderConfirmChecklistFooter(snap || { reviewed_income: false, reviewed_savings: false, reviewed_expenses: false, reviewed_subscriptions: false });
    }

    return '<div class="checkin-card ui-3d-panel ui-3d-ach-checkin"' + (!avail.available && !completed ? ' style="opacity:0.7;"' : '') + '>'
      + (cadenceHtml ? '<div class="checkin-cadence-inline">' + cadenceHtml + '</div>' : '')
      + '<div class="checkin-card-head">'
      + '<span class="checkin-card-title">Monthly Review</span>'
      + '<span class="checkin-period-badge">' + periodLabel + '</span>'
      + '</div>'
      + '<div class="checkin-status-line ' + statusClass + '">' + vm.summary + '</div>'
      + footerHtml
      + '</div>';
  }

  /* =====================================================================
     WEEKLY CHECK-IN CARD — new v5
     ===================================================================== */

  function renderWeeklyCheckinCard(entry, rec, vm, totalSundays, cadenceHtml) {
    if (!entry) {
      // No entry available yet — show locked placeholder
      let sundays = totalSundays || [];
      let nextLocked = sundays.find(function(s) { return !isSundayReached(s); });
      return '<div class="weekly-checkin-card ui-3d-panel ui-3d-ach-checkin is-locked">'
        + (cadenceHtml ? '<div class="checkin-cadence-inline">' + cadenceHtml + '</div>' : '')
        + '<div class="weekly-card-head">'
        + '<div><div class="weekly-card-title">Weekly Review</div></div>'
        + '</div>'
        + '<div class="weekly-card-due">&#128274; '
        + (nextLocked ? 'Next check-in available ' + formatSundayLabel(nextLocked) : 'No upcoming Sundays this month')
        + '</div>'
        + '</div>';
    }

    let isCompleted = entry.status === 'completed';
    let isLocked    = entry.status === 'locked';
    let seqLabel    = 'Week ' + entry.sequence_in_month + ' of ' + totalSundays.length;
    let dueLabel    = formatSundayLabel(entry.due_date);

    let cardClass = isCompleted ? 'weekly-checkin-card ui-3d-panel ui-3d-ach-checkin is-completed'
                  : isLocked   ? 'weekly-checkin-card ui-3d-panel ui-3d-ach-checkin is-locked'
                  : 'weekly-checkin-card ui-3d-panel ui-3d-ach-checkin';

    let bodyHtml = '';

    if (isCompleted) {
      let at = entry.completed_at
        ? new Date(entry.completed_at).toLocaleDateString('en-BE', { month: 'short', day: 'numeric' }) : '';
      bodyHtml = '<div class="checkin-footer" style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:rgba(16,185,129,0.05);border-top:1px solid rgba(16,185,129,0.18);">'
        + '<span style="font-size:0.70rem;font-weight:600;color:#065f46;">&#10003; Check-in completed' + (at ? ' \xb7 ' + at : '') + '</span>'
        + '<button class="checkin-undo-btn" id="weeklyUndoBtn" type="button">Undo</button>'
        + '</div>';
    } else if (isLocked) {
      bodyHtml = '<div class="checkin-footer" style="display:flex;align-items:center;gap:8px;">'
        + '<span style="font-size:0.68rem;color:var(--muted);">&#128274; Unlocks on ' + dueLabel + '</span>'
        + '</div>';
    } else {
      // Available
      let statusClass = vm.ctx.isClosed ? 'state-on-track'
        : (vm.cash && vm.cash.state === 'critical' ? 'state-overspend'
        : (vm.budget && vm.budget.trend === 'worsening' ? 'state-warning' : 'state-on-track'));
      bodyHtml = '<div class="checkin-status-line ' + statusClass + '" style="padding:0 14px 8px;">' + vm.summary + '</div>'
        + renderConfirmChecklistFooter(entry.review_flags || {}, 'weekly_');
    }

    return '<div class="' + cardClass + '">'
      + (cadenceHtml ? '<div class="checkin-cadence-inline">' + cadenceHtml + '</div>' : '')
      + '<div class="weekly-card-head">'
      + '<div>'
      + '<div class="weekly-card-title">' + seqLabel + '</div>'
      + '<div class="weekly-card-seq">Due ' + dueLabel + '</div>'
      + '</div>'
      + '</div>'
      + bodyHtml
      + '</div>';
  }

  /* =====================================================================
     WEEKLY KPI DELTA — compare snapshot vs previous entry
     ===================================================================== */

  function renderWeeklyKpiDelta(entry, prevEntry) {
    // First entry: show live KPI blocks (no prev to compare)
    // Subsequent entries: show delta vs prev snapshot
    if (!prevEntry || !prevEntry.snapshot_payload) return null; // caller will use live vm blocks
    let prev = prevEntry.snapshot_payload;
    let cur  = entry.snapshot_payload;
    if (!cur) return null;

    let rows = [];
    // Cash delta
    if (cur.cash && prev.cash) {
      let cashDelta = (cur.cash.moneyLeft || 0) - (prev.cash.moneyLeft || 0);
      let sign = cashDelta >= 0 ? '+' : '\u2212';
      rows.push('<div class="momentum-block ui-3d-panel ui-3d-ach-kpi mb-cash"><div class="momentum-block-title">Cash \u0394 vs last week</div>'
        + '<div class="momentum-block-primary ' + (cashDelta >= 0 ? 'val-good' : 'val-bad') + '">' + sign + fmtC(Math.abs(cashDelta)) + '</div>'
        + '<div class="momentum-block-rows"><div class="momentum-block-row"><span class="momentum-block-row-label">Now</span><span class="momentum-block-row-val">' + fmtC(cur.cash.moneyLeft) + '</span></div></div></div>');
    }
    // Budget delta
    if (cur.budget && prev.budget) {
      let budDelta = (prev.budget.varianceAmount || 0) - (cur.budget.varianceAmount || 0);
      rows.push('<div class="momentum-block ui-3d-panel ui-3d-ach-kpi mb-budget"><div class="momentum-block-title">Budget \u0394 vs last week</div>'
        + '<div class="momentum-block-primary ' + (budDelta >= 0 ? 'val-good' : 'val-bad') + '">' + (budDelta >= 0 ? '+' : '\u2212') + fmtC(Math.abs(budDelta)) + ' vs expected</div>'
        + '<div class="momentum-block-rows"><div class="momentum-block-row"><span class="momentum-block-row-label">Now</span><span class="momentum-block-row-val">' + fmtC(cur.budget.actualSpend) + ' spent</span></div></div></div>');
    }
    // Goal delta
    if (cur.goal && prev.goal) {
      let goalDelta = (cur.goal.pct || 0) - (prev.goal.pct || 0);
      rows.push('<div class="momentum-block ui-3d-panel ui-3d-ach-kpi mb-goal"><div class="momentum-block-title">Goal \u0394 vs last week</div>'
        + '<div class="momentum-block-primary ' + (goalDelta >= 0 ? 'val-good' : 'val-warn') + '">' + (goalDelta >= 0 ? '+' : '') + goalDelta.toFixed(1) + '%</div>'
        + '<div class="momentum-block-rows"><div class="momentum-block-row"><span class="momentum-block-row-label">Now</span><span class="momentum-block-row-val">' + Math.round(cur.goal.pct) + '%</span></div></div></div>');
    }
    if (!rows.length) return null;
    return rows.join('');
  }

  /* =====================================================================
     HISTORY TREE — Year → Month → Weekly
     ===================================================================== */

  function monthHasData(mRec) {
    if (!mRec) return false;
    if (mRec.cadence_locked) return true;
    if (mRec.monthly && mRec.monthly.snapshot && mRec.monthly.snapshot.completed_at) return true;
    if (mRec.weekly && mRec.weekly.entries && mRec.weekly.entries.some(function(e) { return e.status === 'completed'; })) return true;
    return false;
  }

  function buildHistoryTree(state) {
    let years = Object.keys(state.years).sort().reverse();
    let html = '<div class="achievements-section ui-3d-panel ui-3d-ach-section ui-3d-ach-history"><div class="achievements-section-head"><h4>History</h4><span class="achievements-section-sub">Year \u2192 Month \u2192 Weekly</span></div>';
    html += '<div class="history-tree" style="padding:0 12px 12px;">';

    years.forEach(function(yr) {
      let yearRec = state.years[yr];
      // Only show months that have real activity
      let months = Object.keys(yearRec.months)
        .filter(function(mk) { return monthHasData(yearRec.months[mk]); })
        .sort().reverse();
      if (!months.length) return; // skip years with no real data

      let trackedCount = months.length;
      // All year groups start collapsed — user actively expands them
      let expandedClass = '';

      html += '<div class="history-year-group ui-3d-panel ui-3d-ach-history-group' + expandedClass + '" data-year="' + yr + '">';
      html += '<div class="history-year-header">'
        + '<span class="history-year-label">' + yr + '</span>'
        + '<span class="history-year-meta">' + trackedCount + ' month' + (trackedCount !== 1 ? 's' : '') + ' tracked</span>'
        + '<span class="history-year-chevron">&#9660;</span>'
        + '</div>';

      html += '<div class="history-year-body">';
      months.forEach(function(mk) {
        let mRec = yearRec.months[mk];
        let locked = getLockedCadence(mRec);
        let badgeClass = locked === 'weekly' ? 'badge-weekly' : locked === 'monthly' ? 'badge-monthly' : '';
        let badgeLabel = locked === 'weekly' ? 'Tracked Weekly' : locked === 'monthly' ? 'Tracked Monthly' : 'Not tracked';

        // Month rows always collapsed by default
        html += '<div class="history-month-row" data-mk="' + mk + '">';
        html += '<div class="history-month-header">'
          + '<span class="history-month-label">' + mRec.month_label + '</span>'
          + (locked ? '<span class="history-month-badge ' + badgeClass + '">' + badgeLabel + '</span>' : '')
          + '<span class="history-month-chevron">&#9660;</span>'
          + '</div>';

        html += '<div class="history-month-body">';

        // Monthly summary if available
        let mSnap = mRec.monthly && mRec.monthly.snapshot;
        if (mSnap && mSnap.completed_at) {
          let mAt = new Date(mSnap.completed_at).toLocaleDateString('en-BE', { month: 'short', day: 'numeric' });
          html += '<div class="history-monthly-summary">'
            + '<div class="history-monthly-summary-label">Monthly Check-In \u00b7 ' + mAt + '</div>'
            + '<div class="history-monthly-summary-text">' + (mSnap.summary_sentence || 'Completed') + '</div>'
            + '</div>';
        }

        // Weekly subgroup
        let wEntries = mRec.weekly && mRec.weekly.entries ? mRec.weekly.entries.filter(function(e) { return e.status === 'completed'; }) : [];
        html += '<div class="history-weekly-subgroup" data-wk-mk="' + mk + '">';
        html += '<div class="history-weekly-subgroup-header">'
          + '<span class="history-weekly-subgroup-label">Weekly reviews (' + wEntries.length + ')</span>'
          + '<span class="history-weekly-subgroup-chevron">&#9660;</span>'
          + '</div>';
        html += '<div class="history-weekly-subgroup-body">';

        if (wEntries.length) {
          wEntries.forEach(function(e) {
            let eAt = e.completed_at ? new Date(e.completed_at).toLocaleDateString('en-BE', { month: 'short', day: 'numeric' }) : '';
            let summary = e.snapshot_payload && e.snapshot_payload.summary_sentence ? e.snapshot_payload.summary_sentence : 'Completed';
            html += '<div class="history-weekly-entry">'
              + '<div class="history-weekly-entry-icon" style="background:#10b981;">&#10003;</div>'
              + '<div class="history-weekly-entry-meta">'
              + '<div class="history-weekly-entry-label">Check-In ' + e.sequence_in_month + (eAt ? ' \u00b7 ' + eAt : '') + '</div>'
              + '<div class="history-weekly-entry-sub">' + summary + '</div>'
              + '</div></div>';
          });
        } else {
          html += '<div class="history-weekly-empty">No weekly check-ins completed this month yet.</div>';
        }

        html += '</div></div>'; // close subgroup-body, subgroup
        html += '</div>'; // close month-body
        html += '</div>'; // close month-row
      });

      html += '</div>'; // close year-body
      html += '</div>'; // close year-group
    });

    html += '</div></div>'; // close history-tree, achievements-section
    return html;
  }

  /* =====================================================================
     MAIN RENDER — v5
     ===================================================================== */

  window.renderAchievementsTab = function renderAchievementsTab(opts) {
    let container = document.getElementById('achievementsTabLayout');
    if (!container) return;

    let esc = typeof window.escapeHtml === 'function' ? window.escapeHtml : function(s) {
      return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    };

    opts = opts || {};
    let state = loadAchievementsState();

    let viewedMonth = null;
    try { if (typeof getActiveMonth === 'function') viewedMonth = getActiveMonth(); } catch(e) {}

    let mk = viewedMonth ? monthKeyFromMonthObj(viewedMonth) : calMonthKey();

    let rec = peekMonthRecord(state, mk) || {
      month_key: mk, month_label: monthLabelFromKey(mk),
      cadence_locked: null, cadence_locked_at: null,
      monthly: { snapshot: null }, weekly: { entries: [] },
      ui: { month_history_collapsed: true, weekly_history_collapsed: true }
    };
    let locked = getLockedCadence(rec);
    let selectedCadence = locked || (state.selectedCadenceDraft || 'monthly');

    let vm = buildAchievementsViewModel(viewedMonth);

    let mode = selectedCadence;
    let fpSignals = getFinancialProgressSignals(viewedMonth, mode);
    let fpMapped  = mapSignalsToProgressCard(fpSignals);
    let fpHtml    = renderFinancialProgressEngineCard(fpMapped);

    let cadenceHtml = renderCadenceSelectorV5(rec, mk, selectedCadence);
    let checkinHtml = '';
    if (selectedCadence === 'weekly') {
      ensureWeeklyEntriesForMonth(rec, mk);
      refreshWeeklyEntryStatuses(rec);
      let sundays = getMonthSundays(mk);
      let activeEntry = getCurrentWeeklyEntry(rec);
      if (locked === 'monthly') {
        checkinHtml = '<div class="checkin-lock-message checkin-lock-card ui-3d-panel ui-3d-ach-checkin">'
          + '<div class="checkin-cadence-inline">' + cadenceHtml + '</div>'
          + '<div class="checkin-lock-message-body">&#128274; <strong>This month is tracked Monthly.</strong> Weekly tracking can start next month.</div>'
          + '</div>';
      } else {
        let weeklyLockMsg = getCadenceLockMessage(rec, mk);
        if (weeklyLockMsg && !locked) {
          checkinHtml += '<div class="checkin-lock-message checkin-lock-card ui-3d-panel ui-3d-ach-checkin">'
            + '<div class="checkin-cadence-inline">' + cadenceHtml + '</div>'
            + '<div class="checkin-lock-message-body">' + weeklyLockMsg + '</div>'
            + '</div>';
        }
        checkinHtml += renderWeeklyCheckinCard(activeEntry, rec, vm, sundays, cadenceHtml);
      }
    } else {
      let mSnap = ensureMonthlySnapshot(rec, mk);
      checkinHtml = renderMonthlyCheckinCard(vm, mSnap, viewedMonth, cadenceHtml);
    }

    let kpiHtml = renderAlwaysOnKpiRow(vm, rec, selectedCadence);

    let bottomHtml = '';
    let hasHistory = Object.keys(state.years).some(function(y) {
      return Object.keys(state.years[y].months).some(function(m) {
        return m !== mk && monthHasData(state.years[y].months[m]);
      });
    });
    if (hasHistory) bottomHtml += buildHistoryTree(state);
    if (!bottomHtml) {
      bottomHtml = '<div class="achievements-section">'
        + '<div class="achievements-section-head"><h4>History</h4>'
        + '<span class="achievements-section-sub">Year \u2192 Month \u2192 Weekly</span></div>'
        + '<div style="padding:20px 16px;text-align:center;font-size:0.67rem;color:var(--muted);">Your review history will appear here.</div>'
        + '</div>';
    }

    let badgeHtml = renderBadgeSystem(viewedMonth, state, mk, selectedCadence);
    let payloadForProgress = syncBadgeState(viewedMonth, state, mk, selectedCadence);
    let badgeStateForProgress = payloadForProgress.state || {};
    let completedEntries = getCompletedBadgeEntriesUpToMonth(badgeStateForProgress, mk);
    let completedCount = completedEntries.length;
    let activeTargetCount = 0;
    if (payloadForProgress.saverStatus) activeTargetCount++;
    if (payloadForProgress.checkinStatus) activeTargetCount++;
    if (payloadForProgress.budgetMasterStatus) activeTargetCount++;
    activeTargetCount += (payloadForProgress.customStatuses || []).length;
    let totalAchievementSlots = Math.max(completedCount + activeTargetCount, 3);
    let progressPct = totalAchievementSlots ? Math.round((completedCount / Math.max(totalAchievementSlots, 1)) * 100) : 0;

    let monthlyCompleted = !!(rec.monthly && rec.monthly.snapshot && rec.monthly.snapshot.completed_at);
    let weeklyCompletedCount = rec.weekly && rec.weekly.entries ? rec.weekly.entries.filter(function(e) { return e.status === 'completed'; }).length : 0;
    let checkinComplete = selectedCadence === 'weekly' ? weeklyCompletedCount > 0 : monthlyCompleted;
    let nextRewardCount = Math.max(1, Math.max(activeTargetCount, 1) - completedCount + 1);
    let momentumTitle = vm && vm.summary ? vm.summary : 'Keep building momentum';
    let stateTitle = (vm && vm.cash && vm.cash.state === 'critical') ? 'Needs Attention' : 'On Track';

    let recentHtml = '';
    let recentEntries = completedEntries.slice(-4).reverse();
    if (recentEntries.length) {
      recentHtml = recentEntries.map(function(entry) {
        let formatted = formatCompletedBadgeEntry(entry, { compact: true });
        return '<article class="phase4-achievement-recent-card">'
          + '<div class="phase4-achievement-recent-icon">' + formatted.icon + '</div>'
          + '<div class="phase4-achievement-recent-copy"><div class="phase4-achievement-recent-title">' + badgeEsc(formatted.title) + '</div><div class="phase4-achievement-recent-sub">' + badgeEsc(formatted.subtitle || 'Unlocked achievement') + '</div></div>'
          + '<div class="phase4-achievement-xp">+' + (Number(entry.level || 1) * 25) + ' XP</div>'
          + '</article>';
      }).join('');
    } else {
      recentHtml = '<div class="phase4-achievement-empty">Complete an active target to show recent achievements here.</div>';
    }

    let html = ''
      + '<section class="phase4-achievement-hero">'
        + '<article class="phase4-achievement-kpi primary"><div class="phase4-achievement-kpi-label">Monthly momentum</div><div class="phase4-achievement-kpi-value text-value">' + esc(stateTitle) + '</div><div class="phase4-achievement-kpi-sub">' + esc(momentumTitle) + '</div><button class="phase4-achievement-link" type="button" data-ach-scroll="#achFinancialProgressPanel">View details →</button></article>'
        + '<article class="phase4-achievement-kpi"><div class="phase4-achievement-kpi-label">Check-in status</div><div class="phase4-achievement-kpi-value text-value">' + (checkinComplete ? 'Completed' : 'Open') + '</div><div class="phase4-achievement-kpi-sub">' + (selectedCadence === 'weekly' ? weeklyCompletedCount + ' weekly check-in' + (weeklyCompletedCount === 1 ? '' : 's') + ' completed' : (checkinComplete ? 'Monthly check-in completed' : 'Monthly review still open')) + '</div><button class="phase4-achievement-link" type="button" data-ach-scroll="#achCheckinPanel">Review check-in →</button></article>'
        + '<article class="phase4-achievement-kpi"><div class="phase4-achievement-kpi-label">Achievements earned</div><div class="phase4-achievement-kpi-value">' + completedCount + '</div><div class="phase4-achievement-kpi-sub">Achievements unlocked so far</div><button class="phase4-achievement-link" type="button" id="phase4CompletedBadgesHeroBtn">View all →</button></article>'
        + '<article class="phase4-achievement-kpi reward"><div class="phase4-achievement-kpi-label">Next reward</div><div class="phase4-achievement-kpi-value text-value">' + nextRewardCount + ' to go</div><div class="phase4-achievement-kpi-sub">You’re close to your next achievement</div><button class="phase4-achievement-link" type="button" data-ach-scroll="#achBadgeSection">See next reward →</button></article>'
      + '</section>'
      + '<section class="phase4-achievement-main-grid">'
        + '<article class="phase4-achievement-panel" id="achCheckinPanel"><div class="phase4-achievement-panel-head"><div><h3>Monthly Check-in</h3><p>Review your progress and get personalized insights.</p></div></div>' + checkinHtml + '<div class="phase4-achievement-help"><strong>Your check-in helps you:</strong><span>✓ Track financial habits</span><span>✓ Get personalized insights</span><span>✓ Unlock achievements</span></div></article>'
        + '<article class="phase4-achievement-panel progress-panel"><div class="phase4-achievement-panel-head"><div><h3>Achievement Progress</h3><p>Your progress towards unlocking all achievements.</p></div><strong>' + completedCount + ' / ' + totalAchievementSlots + '</strong></div><div class="phase4-achievement-progress-track"><span style="width:' + progressPct + '%"></span></div><div class="phase4-achievement-progress-meta"><div><strong>' + completedCount + '</strong><span>Unlocked</span></div><div><strong>' + activeTargetCount + '</strong><span>In Progress</span></div><div><strong>' + Math.max(totalAchievementSlots - completedCount - activeTargetCount, 0) + '</strong><span>Locked</span></div></div><button class="phase4-achievement-link standalone" id="phase4CompletedBadgesProgressBtn" type="button">View all achievements →</button></article>'
      + '</section>'
      + '<section class="phase4-achievement-panel recent-panel"><div class="phase4-achievement-panel-head"><div><h3>Recent Achievements</h3><p>Your latest unlocked achievements and active targets.</p></div><button class="phase4-achievement-link standalone" id="phase4CompletedBadgesRecentBtn" type="button">View all achievements →</button></div><div class="phase4-achievement-recent-grid">' + recentHtml + '</div><div class="phase4-achievement-targets-wrap">' + badgeHtml + '</div></section>'
      + '<section class="phase4-achievement-insight-strip"><strong>✦ Keep it up!</strong><span>You’re building stronger financial habits. Small consistent actions lead to big results.</span><button class="feature-action-btn" type="button" data-ach-scroll="#achFinancialProgressPanel">View Insights</button></section>'
      + '<section class="phase4-achievement-hidden-logic" id="achFinancialProgressPanel">' + fpHtml + '<div class="ach-kpi-row">' + kpiHtml + '</div>' + bottomHtml + '</section>';

    container.innerHTML = html;

    container.querySelectorAll('[data-ach-scroll]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        let selector = btn.getAttribute('data-ach-scroll');
        let target = selector ? container.querySelector(selector) : null;
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    ensureBadgeCustomizationOverlay(selectedCadence);
    wireBadgeSystemEvents(selectedCadence);

    // ── Wire cadence select — immediate change, no Apply/Cancel
    let selectEl = document.getElementById('checkinCadenceSelect');
    if (selectEl) {
      selectEl.addEventListener('change', function() {
        state.selectedCadenceDraft = selectEl.value;
        saveV5State(state);
        window.renderAchievementsTab();
      });
    }

    // Helper: get-or-create the real persisted rec at action time (not the transient render rec)
    function persistedRec() {
      return getOrCreateMonthRecord(state, mk);
    }

    // ── Wire confirm checkboxes
    container.querySelectorAll('[data-confirm-key]').forEach(function(label) {
      label.addEventListener('click', function() {
        let confirmKey = label.dataset.confirmKey;
        let inWeekly = !!label.closest('.weekly-checkin-card');
        let pRec = persistedRec();
        if (inWeekly) {
          ensureWeeklyEntriesForMonth(pRec, mk);
          refreshWeeklyEntryStatuses(pRec);
          let avEntry = getNextAvailableWeeklyEntry(pRec);
          if (avEntry) {
            if (!avEntry.review_flags) avEntry.review_flags = {};
            avEntry.review_flags[confirmKey] = !avEntry.review_flags[confirmKey];
            saveV5State(state);
            window.renderAchievementsTab();
          }
        } else {
          let mSnap = ensureMonthlySnapshot(pRec, mk);
          mSnap[confirmKey] = !mSnap[confirmKey];
          saveV5State(state);
          window.renderAchievementsTab();
        }
      });
    });

    // Monthly: "Complete check-in"
    let cBtn = document.getElementById('checkinCompleteBtn');
    if (cBtn) {
      cBtn.addEventListener('click', function() {
        let pRec = persistedRec();
        let mSnap = ensureMonthlySnapshot(pRec, mk);
        mSnap.reviewed_income = mSnap.reviewed_savings =
          mSnap.reviewed_expenses = mSnap.reviewed_subscriptions = true;
        saveV5State(state);
        window.renderAchievementsTab();
      });
    }

    // Monthly: "Confirm and save"
    let sBtn = document.getElementById('checkinConfirmSaveBtn');
    if (sBtn) {
      sBtn.addEventListener('click', function() {
        let pRec = persistedRec();
        let mSnap = ensureMonthlySnapshot(pRec, mk);
        if (mSnap) {
          completeMonthlySnapshot(pRec, mSnap, vm);
          saveV5State(state);
          updateAchievementsPill();
          window.renderAchievementsTab();
        }
      });
    }

    // Monthly: Undo
    let uBtn = document.getElementById('checkinUndoBtn');
    if (uBtn) {
      uBtn.addEventListener('click', function() {
        let pRec = persistedRec();
        let mSnap = pRec.monthly && pRec.monthly.snapshot;
        if (mSnap) {
          undoMonthlySnapshot(mSnap);
          saveV5State(state);
          updateAchievementsPill();
          window.renderAchievementsTab();
        }
      });
    }

    // Helper: get the available weekly entry from the real persisted rec, with entries hydrated
    function availableWeeklyEntry() {
      let pRec = persistedRec();
      ensureWeeklyEntriesForMonth(pRec, mk);
      refreshWeeklyEntryStatuses(pRec);
      return getNextAvailableWeeklyEntry(pRec);
    }

    // Weekly: "Complete check-in"
    let wcBtn = document.getElementById('weekly_checkinCompleteBtn');
    if (wcBtn) {
      wcBtn.addEventListener('click', function() {
        let avEntry = availableWeeklyEntry();
        if (avEntry) {
          if (!avEntry.review_flags) avEntry.review_flags = {};
          avEntry.review_flags.reviewed_income = avEntry.review_flags.reviewed_savings =
            avEntry.review_flags.reviewed_expenses = avEntry.review_flags.reviewed_subscriptions = true;
          saveV5State(state);
          window.renderAchievementsTab();
        }
      });
    }

    // Weekly: "Confirm and save"
    let wsBtn = document.getElementById('weekly_checkinConfirmSaveBtn');
    if (wsBtn) {
      wsBtn.addEventListener('click', function() {
        let avEntry = availableWeeklyEntry();
        if (avEntry) {
          completeWeeklyEntry(persistedRec(), avEntry, vm);
          saveV5State(state);
          updateAchievementsPill();
          window.renderAchievementsTab();
        }
      });
    }

    // Weekly: Undo
    let wuBtn = document.getElementById('weeklyUndoBtn');
    if (wuBtn) {
      wuBtn.addEventListener('click', function() {
        let pRec = persistedRec();
        ensureWeeklyEntriesForMonth(pRec, mk);
        let completedEntries = pRec.weekly.entries.filter(function(e) { return e.status === 'completed'; });
        if (completedEntries.length) {
          let lastCompleted = completedEntries[completedEntries.length - 1];
          undoWeeklyEntry(pRec, lastCompleted);
          saveV5State(state);
          updateAchievementsPill();
          window.renderAchievementsTab();
        }
      });
    }

    // ── Wire history tree collapsibles
    container.querySelectorAll('.history-year-header').forEach(function(h) {
      h.addEventListener('click', function() {
        let grp = h.closest('.history-year-group');
        if (!grp) return;
        grp.classList.toggle('is-expanded');
      });
    });
    container.querySelectorAll('.history-month-header').forEach(function(h) {
      h.addEventListener('click', function() {
        let row = h.closest('.history-month-row');
        if (!row) return;
        row.classList.toggle('is-expanded');
      });
    });
    container.querySelectorAll('.history-weekly-subgroup-header').forEach(function(h) {
      h.addEventListener('click', function(e) {
        e.stopPropagation();
        let grp = h.closest('.history-weekly-subgroup');
        if (!grp) return;
        grp.classList.toggle('is-expanded');
      });
    });
  
  };


  /* ══════════════════════════════════════════════════════
     BADGE SYSTEM ENGINE — v1000
     Preset targets:
       • The Saver
       • Check-In Streak
     ══════════════════════════════════════════════════════ */

  let BADGE_STORAGE_KEY = 'badge_system_v4';
  let LEGACY_BADGE_STORAGE_KEYS = ['badge_system_v3', 'badge_system_v2', 'badge_system_v1'];
  let MAX_PRESET_BADGE_SLOTS = 3;
  let MAX_CUSTOM_BADGE_SLOTS = 3;
  let BADGE_STATE_VERSION = 10;
  let badgeCustomizationDraft = null;
  let customTargetDraft = null;
  let SAVER_LEVELS = [200, 500, 1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000];
  let CHECKIN_LEVELS = {
    weekly:  [2, 4, 8, 14, 20, 30, 50, 75, 100, 150],
    monthly: [1, 2, 3, 5, 8, 12, 17, 23, 29, 37]
  };
  let BUDGET_MASTER_BASE_LEVELS = [1, 2, 3, 5, 8, 12, 17, 23, 29, 37];
  let BUDGET_MASTER_TOTAL_LABEL = '∞';
  let CUSTOM_TARGET_LEVEL_SETS = {
    '5': [1, 3, 6, 12, 24],
    '10': [1, 2, 3, 4, 6, 9, 12, 18, 24, 36],
    'unlimited': [1, 2, 3, 4, 6, 9, 12, 18, 24, 36]
  };
  let CUSTOM_TARGET_UNLIMITED_STEP = 12;
  let CUSTOM_TARGET_ICON_OPTIONS = ['🎯', '💸', '💰', '📈', '📊', '🧠', '🛒', '🏦'];
  let CUSTOM_TARGET_TYPE_META = {
    category_cap: { label: 'Category Spend Cap', operatorLabel: 'Stay at or below', operator: 'lte', unit: 'currency', defaultIcon: '💸', scopeLabel: 'Category' },
    savings_contribution: { label: 'Savings Contribution', operatorLabel: 'Reach at least', operator: 'gte', unit: 'currency', defaultIcon: '💰', scopeLabel: 'Savings scope' },
    income_floor: { label: 'Income Floor', operatorLabel: 'Reach at least', operator: 'gte', unit: 'currency', defaultIcon: '📈', scopeLabel: 'Income scope' },
    category_income_share: { label: 'Category % of Income', operatorLabel: 'Stay at or below', operator: 'lte', unit: 'percent', defaultIcon: '📊', scopeLabel: 'Category' }
  };

  function badgeEsc(str) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(str == null ? '' : String(str));
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function badgeMonthLabel(month, mk) {
    if (month && month.name) return month.name;
    return monthLabelFromKey(mk);
  }

  function compareMonthKeys(a, b) {
    let aa = String(a || '');
    let bb = String(b || '');
    if (!aa && !bb) return 0;
    if (!aa) return -1;
    if (!bb) return 1;
    return aa < bb ? -1 : (aa > bb ? 1 : 0);
  }

  function isTargetVisibleFromActivationMonth(activationMonthKey, mk) {
    if (!activationMonthKey) return true;
    return compareMonthKeys(mk, activationMonthKey) >= 0;
  }

  function getAllDashboardMonths() {
    return (window.state && Array.isArray(window.state.months)) ? window.state.months : [];
  }

  function getDashboardMonthKeysUpTo(mk) {
    return getAllDashboardMonths()
      .map(function(month) { return monthKeyFromMonthObj(month); })
      .filter(function(key) { return compareMonthKeys(key, mk) <= 0; })
      .sort(compareMonthKeys);
  }

  function sumSavingsActualForMonth(month) {
    if (!month || !Array.isArray(month.savings)) return 0;
    return month.savings.reduce(function(sum, row) { return sum + rowActual(row); }, 0);
  }

  function cumulativeSavingsBeforeMonth(mk) {
    let months = getAllDashboardMonths();
    let sum = 0;
    months.forEach(function(month) {
      let key = monthKeyFromMonthObj(month);
      if (compareMonthKeys(key, mk) < 0) sum += sumSavingsActualForMonth(month);
    });
    return Math.max(0, sum);
  }

  function getLiveBadgeMetrics(month) {
    let savingsPlanned = 0, savingsActual = 0;
    if (month) {
      savingsPlanned = (month.savings || []).reduce(function(sum, row) { return sum + Number(row.planned || 0); }, 0);
      savingsActual = sumSavingsActualForMonth(month);
    }
    let cumulativeSavingsActual = getAllDashboardMonths().reduce(function(sum, item) {
      return sum + sumSavingsActualForMonth(item);
    }, 0);
    return {
      savingsCommitted: Math.max(0, Math.max(savingsPlanned, savingsActual)),
      savingsPlanned: savingsPlanned,
      savingsActual: savingsActual,
      cumulativeSavingsActual: Math.max(0, cumulativeSavingsActual)
    };
  }

  function getSaverBadgeDef(levelIndex) {
    let idx = Math.max(0, Math.min(Number(levelIndex || 1) - 1, SAVER_LEVELS.length - 1));
    return {
      id: 'the_saver_l' + (idx + 1),
      series: 'the_saver',
      name: 'The Saver',
      icon: '💰',
      level: idx + 1,
      totalLevels: SAVER_LEVELS.length,
      target: SAVER_LEVELS[idx],
      description: 'Add ' + fmtC(SAVER_LEVELS[idx]) + ' to savings after activating this target.'
    };
  }

  function getCheckinThresholds(mode) {
    return CHECKIN_LEVELS[mode === 'weekly' ? 'weekly' : 'monthly'];
  }

  function getCheckinLevelFromCount(mode, count) {
    let thresholds = getCheckinThresholds(mode);
    let n = Math.max(0, Number(count || 0));
    let level = 0;
    thresholds.forEach(function(target, idx) {
      if (n >= Number(target || 0)) level = idx + 1;
    });
    return level;
  }

  function getCheckinTargetDef(mode, level) {
    let safeMode = mode === 'weekly' ? 'weekly' : 'monthly';
    let thresholds = getCheckinThresholds(safeMode);
    let safeBadge = Math.max(1, Math.min(Number(level || 1), thresholds.length));
    return {
      id: 'checkin_streak_' + safeMode + '_l' + safeBadge,
      series: 'checkin_streak',
      name: 'Check-In Streak',
      icon: safeMode === 'weekly' ? '📅' : '🗓️',
      mode: safeMode,
      level: safeBadge,
      totalLevels: getBudgetMasterTotalLabel(),
      target: Number(thresholds[safeBadge - 1] || 0)
    };
  }

  function getBudgetMasterThresholds() {
    return BUDGET_MASTER_BASE_LEVELS.slice();
  }

  function getBudgetMasterTotalLabel() {
    return BUDGET_MASTER_TOTAL_LABEL;
  }

  function getBudgetMasterThresholdForLevel(level) {
    let safeLevel = Math.max(1, Number(level || 1));
    let thresholds = getBudgetMasterThresholds();
    if (!thresholds.length) return safeLevel;
    if (safeLevel <= thresholds.length) return Number(thresholds[safeLevel - 1] || 0);
    let lastThreshold = Number(thresholds[thresholds.length - 1] || 0);
    return lastThreshold + (safeLevel - thresholds.length);
  }

  function getBudgetMasterLevelFromCount(count) {
    let thresholds = getBudgetMasterThresholds();
    let n = Math.max(0, Number(count || 0));
    if (!thresholds.length) return n;
    let lastThreshold = Number(thresholds[thresholds.length - 1] || 0);
    if (n <= lastThreshold) {
      let level = 0;
      thresholds.forEach(function(target, idx) {
        if (n >= Number(target || 0)) level = idx + 1;
      });
      return level;
    }
    return thresholds.length + Math.max(0, n - lastThreshold);
  }

  function getBudgetMasterTargetDef(level) {
    let safeBadge = Math.max(1, Number(level || 1));
    return {
      id: 'budget_master_l' + safeBadge,
      series: 'budget_master',
      name: 'Budget Master',
      icon: '🎯',
      level: safeBadge,
      totalLevels: getBudgetMasterTotalLabel(),
      target: getBudgetMasterThresholdForLevel(safeBadge)
    };
  }


  function buildDefaultCustomTargetDraft() {
    return {
      name: '',
      type: 'category_cap',
      scopeKey: '',
      threshold: '',
      mode: 'streak',
      levelMode: '10',
      icon: CUSTOM_TARGET_TYPE_META.category_cap.defaultIcon
    };
  }

  function cloneCustomTargetDraft(source) {
    let base = buildDefaultCustomTargetDraft();
    let next = Object.assign({}, base, source || {});
    if (!CUSTOM_TARGET_TYPE_META[next.type]) next.type = base.type;
    if (!next.icon) next.icon = getCustomTargetTypeMeta(next.type).defaultIcon;
    if (!isCustomTargetModeAllowed(next.type, next.mode)) next.mode = 'streak';
    if (['5', '10', 'unlimited'].indexOf(String(next.levelMode || '')) === -1) next.levelMode = '10';
    return next;
  }

  function getCustomTargetTypeMeta(type) {
    return CUSTOM_TARGET_TYPE_META[type] || CUSTOM_TARGET_TYPE_META.category_cap;
  }

  function isCustomTargetModeAllowed(type, mode) {
    let safeType = String(type || '');
    let safeMode = String(mode || 'streak');
    if (safeMode !== 'cumulative') return true;
    return safeType === 'savings_contribution' || safeType === 'income_floor';
  }

  function getCustomTargetLevelCount(levelMode) {
    if (String(levelMode || '') === '5') return 5;
    if (String(levelMode || '') === '10') return 10;
    return Infinity;
  }

  function getCustomTargetTotalLabel(levelMode) {
    if (String(levelMode || '') === '5' || String(levelMode || '') === '10') return String(levelMode);
    return '∞';
  }

  function getCustomTargetMilestoneRequirement(levelMode, level) {
    let safeLevel = Math.max(1, Number(level || 1));
    let safeMode = String(levelMode || '10');
    let base = (CUSTOM_TARGET_LEVEL_SETS[safeMode] || CUSTOM_TARGET_LEVEL_SETS['10']).slice();
    if (!base.length) return safeLevel;
    if (safeLevel <= base.length) return Number(base[safeLevel - 1] || safeLevel);
    if (safeMode !== 'unlimited') return Number(base[base.length - 1] || safeLevel);
    let last = Number(base[base.length - 1] || 0);
    return last + ((safeLevel - base.length) * CUSTOM_TARGET_UNLIMITED_STEP);
  }

  function getCustomTargetLevelFromValue(target, value) {
    let safeValue = Math.max(0, Number(value || 0));
    let levelMode = String(target && target.progression && target.progression.levelMode || '10');
    let mode = String(target && target.progression && target.progression.mode || 'streak');
    let threshold = Math.max(0, Number(target && target.definition && target.definition.threshold || 0));
    let level = 0;
    let maxLevels = getCustomTargetLevelCount(levelMode);
    let cursor = 1;
    while (cursor <= 200) {
      if (maxLevels !== Infinity && cursor > maxLevels) break;
      let requirement = getCustomTargetMilestoneRequirement(levelMode, cursor);
      if (mode === 'cumulative') requirement *= threshold;
      if (safeValue + 0.0001 >= requirement) level = cursor;
      else break;
      cursor += 1;
    }
    return level;
  }

  function getCustomTargetMetricRequirementForLevel(target, level) {
    let requirement = getCustomTargetMilestoneRequirement(String(target && target.progression && target.progression.levelMode || '10'), level);
    if (String(target && target.progression && target.progression.mode || 'streak') === 'cumulative') {
      requirement *= Math.max(0, Number(target && target.definition && target.definition.threshold || 0));
    }
    return requirement;
  }

  function getCustomTargetNextLevel(target, currentLevel) {
    let maxLevels = getCustomTargetLevelCount(target && target.progression && target.progression.levelMode);
    let nextLevel = Math.max(1, Number(currentLevel || 0) + 1);
    if (maxLevels !== Infinity) nextLevel = Math.min(nextLevel, maxLevels);
    return nextLevel;
  }

  function getExpenseCategoryOptionsForCustomTargets() {
    let seen = {};
    let out = [];
    getAllDashboardMonths().forEach(function(month) {
      (monthExpenseGroups(month) || []).forEach(function(group) {
        let key = cleanGroupName(group);
        if (!key || seen[key]) return;
        seen[key] = true;
        out.push({ value: key, label: key });
      });
    });
    return out.sort(function(a, b) { return String(a.label || '').localeCompare(String(b.label || '')); });
  }

  function getIncomeScopeOptionsForCustomTargets() {
    let seen = { total_income: true };
    let out = [{ value: 'total_income', label: 'Total Income' }];
    getAllDashboardMonths().forEach(function(month) {
      (month && month.income || []).forEach(function(row) {
        let key = cleanGroupName(row && row.group || row && row.name || '');
        if (!key || seen[key]) return;
        seen[key] = true;
        out.push({ value: key, label: key });
      });
    });
    return out.sort(function(a, b) {
      if (a.value === 'total_income') return -1;
      if (b.value === 'total_income') return 1;
      return String(a.label || '').localeCompare(String(b.label || ''));
    });
  }

  function getSavingsScopeOptionsForCustomTargets() {
    return [
      { value: 'all_savings', label: 'All Savings' },
      { value: 'cash_savings', label: 'Savings only' },
      { value: 'investments', label: 'Investments only' }
    ];
  }

  function getCustomTargetScopeOptions(type) {
    let safeType = String(type || '');
    if (safeType === 'category_cap' || safeType === 'category_income_share') return getExpenseCategoryOptionsForCustomTargets();
    if (safeType === 'income_floor') return getIncomeScopeOptionsForCustomTargets();
    if (safeType === 'savings_contribution') return getSavingsScopeOptionsForCustomTargets();
    return [];
  }

  function getCustomTargetScopeLabel(type, scopeKey) {
    let safeScope = String(scopeKey || '');
    let options = getCustomTargetScopeOptions(type);
    for (let i = 0; i < options.length; i++) {
      if (String(options[i].value || '') === safeScope) return options[i].label;
    }
    return safeScope || 'Selected scope';
  }

  function getCustomTargetSuggestedName(draft) {
    let safeDraft = cloneCustomTargetDraft(draft);
    let threshold = Number(safeDraft.threshold || 0);
    let scopeLabel = getCustomTargetScopeLabel(safeDraft.type, safeDraft.scopeKey);
    if (safeDraft.type === 'category_cap') return scopeLabel + ' under ' + fmtC(threshold || 0);
    if (safeDraft.type === 'savings_contribution') return scopeLabel + ' at least ' + fmtC(threshold || 0);
    if (safeDraft.type === 'income_floor') return scopeLabel + ' at least ' + fmtC(threshold || 0);
    if (safeDraft.type === 'category_income_share') return scopeLabel + ' below ' + (threshold || 0) + '%';
    return 'Custom Target';
  }

  function buildCustomTargetPreview(draft) {
    let safeDraft = cloneCustomTargetDraft(draft);
    let meta = getCustomTargetTypeMeta(safeDraft.type);
    let scopeLabel = getCustomTargetScopeLabel(safeDraft.type, safeDraft.scopeKey);
    let threshold = Number(safeDraft.threshold || 0);
    let seriesName = String(safeDraft.name || '').trim() || getCustomTargetSuggestedName(safeDraft);
    let sentence = '';
    if (safeDraft.type === 'category_cap') {
      sentence = 'Earn a badge each time ' + scopeLabel + ' stays at or below ' + fmtC(threshold || 0) + ' in a closed month.';
    } else if (safeDraft.type === 'savings_contribution') {
      sentence = (safeDraft.mode === 'cumulative' ? 'Build cumulative progress by adding ' : 'Build a streak by reaching ') + 'at least ' + fmtC(threshold || 0) + ' in ' + scopeLabel.toLowerCase() + ' for each closed month.';
    } else if (safeDraft.type === 'income_floor') {
      sentence = (safeDraft.mode === 'cumulative' ? 'Build cumulative progress by generating ' : 'Build a streak by reaching ') + 'at least ' + fmtC(threshold || 0) + ' in ' + scopeLabel.toLowerCase() + ' for each closed month.';
    } else {
      sentence = 'Track how often ' + scopeLabel + ' stays below ' + (threshold || 0) + '% of income in a closed month.';
    }
    return {
      name: seriesName,
      sentence: sentence,
      shortMeta: meta.label + ' · ' + (safeDraft.mode === 'cumulative' ? 'Cumulative' : 'Streak') + ' · ' + (safeDraft.levelMode === 'unlimited' ? 'Unlimited' : (safeDraft.levelMode + ' levels'))
    };
  }

  function validateCustomTargetDraft(draft, existingCount) {
    let safeDraft = cloneCustomTargetDraft(draft);
    if (Number(existingCount || 0) >= MAX_CUSTOM_BADGE_SLOTS) return 'All custom target slots are already in use.';
    if (!String(safeDraft.scopeKey || '').trim()) return 'Select what this target should track.';
    let threshold = Number(safeDraft.threshold || 0);
    if (!(threshold > 0)) return 'Enter a target threshold above zero.';
    if (!isCustomTargetModeAllowed(safeDraft.type, safeDraft.mode)) return 'This target type only supports streak mode.';
    return '';
  }

  function slugifyCustomTargetLabel(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  }

  function buildCustomTargetRecord(draft, monthKey, monthLabel) {
    let safeDraft = cloneCustomTargetDraft(draft);
    let threshold = Math.max(0, Number(safeDraft.threshold || 0));
    let typeMeta = getCustomTargetTypeMeta(safeDraft.type);
    let name = String(safeDraft.name || '').trim() || getCustomTargetSuggestedName(safeDraft);
    let id = 'custom_target_' + slugifyCustomTargetLabel(name) + '_' + Date.now();
    return {
      id: id,
      kind: 'custom',
      active: true,
      hidden: false,
      activatedAt: new Date().toISOString(),
      activatedMonthKey: monthKey,
      activatedMonthLabel: monthLabel,
      definition: {
        type: safeDraft.type,
        cadence: 'monthly',
        scopeKey: safeDraft.scopeKey,
        scopeLabel: getCustomTargetScopeLabel(safeDraft.type, safeDraft.scopeKey),
        operator: typeMeta.operator,
        threshold: threshold,
        unit: typeMeta.unit
      },
      progression: {
        mode: safeDraft.mode,
        levelMode: safeDraft.levelMode
      },
      presentation: {
        name: name,
        icon: safeDraft.icon || typeMeta.defaultIcon
      },
      stats: {
        currentValue: 0,
        bestValue: 0,
        currentLevel: 0,
        achievedMilestones: [],
        lastEvaluatedMonthKey: ''
      }
    };
  }

  function normalizeCustomTargetRecord(target) {
    let safe = target && typeof target === 'object' ? JSON.parse(JSON.stringify(target)) : {};
    if (!safe.id) safe.id = 'custom_target_' + Date.now();
    safe.kind = 'custom';
    safe.active = safe.active !== false;
    safe.hidden = !!safe.hidden;
    safe.activatedAt = safe.activatedAt || null;
    safe.activatedMonthKey = /^\d{4}-\d{2}$/.test(String(safe.activatedMonthKey || '')) ? String(safe.activatedMonthKey) : '';
    safe.activatedMonthLabel = safe.activatedMonthLabel || (safe.activatedMonthKey ? monthLabelFromKey(safe.activatedMonthKey) : '');
    if (!safe.definition || typeof safe.definition !== 'object') safe.definition = {};
    if (!CUSTOM_TARGET_TYPE_META[safe.definition.type]) safe.definition.type = 'category_cap';
    safe.definition.cadence = 'monthly';
    safe.definition.scopeKey = String(safe.definition.scopeKey || '');
    safe.definition.scopeLabel = String(safe.definition.scopeLabel || getCustomTargetScopeLabel(safe.definition.type, safe.definition.scopeKey));
    safe.definition.operator = getCustomTargetTypeMeta(safe.definition.type).operator;
    safe.definition.unit = getCustomTargetTypeMeta(safe.definition.type).unit;
    safe.definition.threshold = Math.max(0, Number(safe.definition.threshold || 0));
    if (!safe.progression || typeof safe.progression !== 'object') safe.progression = {};
    if (!isCustomTargetModeAllowed(safe.definition.type, safe.progression.mode)) safe.progression.mode = 'streak';
    else safe.progression.mode = safe.progression.mode === 'cumulative' ? 'cumulative' : 'streak';
    safe.progression.levelMode = ['5', '10', 'unlimited'].indexOf(String(safe.progression.levelMode || '')) >= 0 ? String(safe.progression.levelMode) : '10';
    if (!safe.presentation || typeof safe.presentation !== 'object') safe.presentation = {};
    safe.presentation.name = String(safe.presentation.name || '').trim() || getCustomTargetSuggestedName({
      type: safe.definition.type,
      scopeKey: safe.definition.scopeKey,
      threshold: safe.definition.threshold
    });
    safe.presentation.icon = safe.presentation.icon || getCustomTargetTypeMeta(safe.definition.type).defaultIcon;
    if (!safe.stats || typeof safe.stats !== 'object') safe.stats = {};
    safe.stats.currentValue = Math.max(0, Number(safe.stats.currentValue || 0));
    safe.stats.bestValue = Math.max(0, Number(safe.stats.bestValue || 0));
    safe.stats.currentLevel = Math.max(0, Number(safe.stats.currentLevel || 0));
    safe.stats.achievedMilestones = Array.isArray(safe.stats.achievedMilestones) ? safe.stats.achievedMilestones.map(function(v) {
      return Math.max(0, Number(v || 0));
    }).filter(function(v, idx, arr) { return v >= 1 && arr.indexOf(v) === idx; }).sort(function(a,b){ return a-b; }) : [];
    safe.stats.lastEvaluatedMonthKey = /^\d{4}-\d{2}$/.test(String(safe.stats.lastEvaluatedMonthKey || '')) ? String(safe.stats.lastEvaluatedMonthKey) : '';
    return safe;
  }

  function getCustomTargetAmountForSavingsScope(month, scopeKey) {
    let breakdown = savingsInvestmentBreakdown(month);
    if (scopeKey === 'cash_savings') return Math.max(0, Number(breakdown.cashSavings || 0));
    if (scopeKey === 'investments') return Math.max(0, Number(breakdown.investments || 0));
    return Math.max(0, Number(breakdown.total || 0));
  }

  function getCustomTargetAmountForIncomeScope(month, scopeKey) {
    let safeScope = String(scopeKey || 'total_income');
    if (safeScope === 'total_income') return Math.max(0, Number(liquidIncomeTotalForMonth(month) || 0));
    return Math.max(0, Number((month && month.income || []).reduce(function(sum, row) {
      return sum + (cleanGroupName(row && row.group || row && row.name || '') === safeScope ? rowActual(row) : 0);
    }, 0) || 0));
  }

  function getCustomTargetAmountForExpenseCategory(month, scopeKey) {
    let categoryKey = cleanGroupName(scopeKey);
    if (!month || !categoryKey) return 0;
    let subscriptionImpact = derivedSubscriptionImpactForMonth(month);
    let derivedActual = Number(subscriptionImpact.actualByGroup && subscriptionImpact.actualByGroup[categoryKey] || 0);
    return Math.max(0, Number(sumActualByGroup(month.expenses || [], categoryKey) || 0) + derivedActual);
  }

  function evaluateCustomTargetMonth(target, month) {
    if (!target || !month) return { eligible: false, success: false, metricValue: 0, summary: 'No month data available.' };
    let type = String(target.definition.type || '');
    let threshold = Math.max(0, Number(target.definition.threshold || 0));
    let closed = isClosedMonth(month);
    let metricValue = 0;
    let eligible = closed;
    let success = false;
    let summary = '';

    if (type === 'category_cap') {
      metricValue = getCustomTargetAmountForExpenseCategory(month, target.definition.scopeKey);
      success = closed && metricValue <= threshold + 0.009;
      summary = !closed ? ' — .' : (success ? 'Category stayed within the target.' : 'Category finished above the target.');
    } else if (type === 'savings_contribution') {
      metricValue = getCustomTargetAmountForSavingsScope(month, target.definition.scopeKey);
      success = closed && metricValue + 0.009 >= threshold;
      summary = !closed ? ' — .' : (success ? 'Savings target hit for the closed month.' : 'Savings target missed for the closed month.');
    } else if (type === 'income_floor') {
      metricValue = getCustomTargetAmountForIncomeScope(month, target.definition.scopeKey);
      success = closed && metricValue + 0.009 >= threshold;
      summary = !closed ? ' — .' : (success ? 'Income floor reached for the closed month.' : 'Income floor missed for the closed month.');
    } else if (type === 'category_income_share') {
      let incomeTotal = getCustomTargetAmountForIncomeScope(month, 'total_income');
      let categoryActual = getCustomTargetAmountForExpenseCategory(month, target.definition.scopeKey);
      metricValue = incomeTotal > 0 ? (categoryActual / incomeTotal) * 100 : 0;
      eligible = closed && incomeTotal > 0;
      success = eligible && metricValue <= threshold + 0.001;
      summary = !closed ? ' — .' : (!eligible ? 'No income logged for the month, so the share target could not be evaluated.' : (success ? 'Category share stayed within the target.' : 'Category share finished above the target.'));
    }

    return {
      eligible: eligible,
      success: success,
      metricValue: Math.max(0, Number(metricValue || 0)),
      summary: summary
    };
  }

  function getCustomTargetStatusesFromActivationMonth(target, mk) {
    let activationKey = String(target && target.activatedMonthKey || '');
    if (!activationKey) return [];
    return getDashboardMonthKeysUpTo(mk).filter(function(key) {
      return compareMonthKeys(key, activationKey) >= 0;
    }).map(function(key) {
      let month = getDashboardMonthByKey(key);
      let evaluation = evaluateCustomTargetMonth(target, month);
      return {
        key: key,
        month: month,
        evaluation: evaluation,
        status: !month || !isClosedMonth(month) ? 'pending' : (!evaluation.eligible ? 'skipped' : (evaluation.success ? 'completed' : 'missed'))
      };
    });
  }

  function getCustomTargetMetricsFromActivationMonth(target, mk) {
    let statuses = getCustomTargetStatusesFromActivationMonth(target, mk);
    let mode = String(target && target.progression && target.progression.mode || 'streak');
    let currentValue = 0;
    let bestValue = 0;
    if (mode === 'streak') {
      statuses.forEach(function(item) {
        if (item.status === 'completed') {
          currentValue += 1;
          bestValue = Math.max(bestValue, currentValue);
        } else if (item.status === 'missed') {
          currentValue = 0;
        }
      });
    } else {
      statuses.forEach(function(item) {
        if (item.evaluation && item.evaluation.eligible && item.evaluation.metricValue > 0) {
          currentValue += Number(item.evaluation.metricValue || 0);
        }
      });
      bestValue = currentValue;
    }
    let currentLevel = getCustomTargetLevelFromValue(target, currentValue);
    let bestLevel = getCustomTargetLevelFromValue(target, bestValue);
    return {
      statuses: statuses,
      currentValue: currentValue,
      bestValue: bestValue,
      currentLevel: currentLevel,
      bestLevel: bestLevel,
      latest: statuses.length ? statuses[statuses.length - 1] : null
    };
  }

  function upsertCustomTargetCompletedEntry(bs, target, level, value, mk) {
    if (!(level >= 1) || !bs || !target) return false;
    let entryId = 'custom_' + String(target.id || '') + '_l' + level;
    let existing = (bs.completedLog || []).find(function(entry) { return entry && entry.id === entryId; });
    let requirement = getCustomTargetMetricRequirementForLevel(target, level);
    let entry = {
      id: entryId,
      series: 'custom_target',
      targetId: target.id,
      title: target.presentation && target.presentation.name || 'Custom Target',
      icon: target.presentation && target.presentation.icon || '🎯',
      level: level,
      count: Math.max(0, Number(value || 0)),
      completedAt: new Date().toISOString(),
      monthKey: mk,
      monthLabel: monthLabelFromKey(mk),
      metricLabel: (target.progression && target.progression.mode === 'cumulative'
        ? 'Milestone ' + level + ' · ' + fmtC(requirement)
        : 'Badge ' + level + '/' + getCustomTargetTotalLabel(target.progression && target.progression.levelMode))
    };
    if (existing) return false;
    bs.completedLog.push(entry);
    return true;
  }

  function syncCustomTargetsState(bs, month, mk) {
    let statuses = [];
    let changed = false;
    let targets = Array.isArray(bs && bs.customTargets) ? bs.customTargets : [];
    targets.forEach(function(rawTarget) {
      let target = normalizeCustomTargetRecord(rawTarget);
      Object.assign(rawTarget, target);
      if (rawTarget.hidden || !rawTarget.activatedMonthKey || !isTargetVisibleFromActivationMonth(rawTarget.activatedMonthKey, mk)) return;
      let metrics = getCustomTargetMetricsFromActivationMonth(rawTarget, mk);
      let achieved = [];
      for (let lvl = 1; lvl <= metrics.bestLevel; lvl++) achieved.push(lvl);
      let prevAchieved = JSON.stringify(rawTarget.stats.achievedMilestones || []);
      let prevCurrentValue = Number(rawTarget.stats.currentValue || 0);
      let prevBestValue = Number(rawTarget.stats.bestValue || 0);
      let prevLevel = Number(rawTarget.stats.currentLevel || 0);
      rawTarget.stats.currentValue = metrics.currentValue;
      rawTarget.stats.bestValue = metrics.bestValue;
      rawTarget.stats.currentLevel = metrics.currentLevel;
      rawTarget.stats.lastEvaluatedMonthKey = mk;
      rawTarget.stats.achievedMilestones = achieved;
      if (prevAchieved !== JSON.stringify(achieved) || prevCurrentValue !== Number(metrics.currentValue || 0) || prevBestValue !== Number(metrics.bestValue || 0) || prevLevel !== Number(metrics.currentLevel || 0)) changed = true;
      achieved.forEach(function(level) {
        if (upsertCustomTargetCompletedEntry(bs, rawTarget, level, metrics.bestValue, mk)) changed = true;
      });
      statuses.push(buildCustomTargetStatus(rawTarget, month, mk, metrics));
    });
    return { changed: changed, statuses: statuses };
  }

  function buildCustomTargetStatus(target, month, mk, metrics) {
    let evaluation = evaluateCustomTargetMonth(target, month);
    let type = String(target.definition.type || '');
    let threshold = Math.max(0, Number(target.definition.threshold || 0));
    let mode = String(target.progression.mode || 'streak');
    let nextLevel = getCustomTargetNextLevel(target, metrics.bestLevel);
    let nextRequirement = getCustomTargetMetricRequirementForLevel(target, nextLevel);
    let totalLabel = getCustomTargetTotalLabel(target.progression.levelMode);
    let currentStatus = '';
    if (type === 'category_income_share') currentStatus = (Number(evaluation.metricValue || 0).toFixed(1)) + '%/' + threshold + '%';
    else currentStatus = badgeFmtC(evaluation.metricValue || 0) + '/' + (target.definition.unit === 'percent' ? (threshold + '%') : badgeFmtC(threshold));
    let visualProgress = threshold > 0 ? Math.max(0, Math.min(Number(evaluation.metricValue || 0) / threshold, 1)) : 0;
    return {
      id: target.id,
      series: 'custom_target',
      name: target.presentation.name,
      icon: target.presentation.icon,
      level: nextLevel,
      earnedLevel: metrics.bestLevel,
      totalLevels: totalLabel,
      target: nextRequirement,
      progress: visualProgress,
      progressCount: Math.max(0, Number(evaluation.metricValue || 0)),
      detail: 'Badge ' + nextLevel + (totalLabel === '∞' ? '' : '/' + totalLabel),
      meta: 'Current Status: ' + currentStatus,
      supportLine: '',
      footerLine: '',
      deleteId: target.id
    };
  }

  function renderCustomTargetEmptySlots(bs) {
    let count = Math.max(0, MAX_CUSTOM_BADGE_SLOTS - ((bs && bs.customTargets && bs.customTargets.length) || 0));
    let html = '';
    for (let i = 0; i < count; i++) {
      html += '<div class="badge-tile ui-3d-panel ui-3d-ach-badge badge-empty-slot badge-empty-slot-custom"><div class="badge-empty-icon">+</div><div class="badge-name">Open custom slot</div><div class="badge-meta-label">Build your own monthly target series.</div></div>';
    }
    return html;
  }

  function renderCustomTargetConfigItems(bs, draft) {
    let targets = Array.isArray(bs && bs.customTargets) ? bs.customTargets : [];
    let hiddenMap = (draft && draft.customTargetHiddenMap && typeof draft.customTargetHiddenMap === 'object') ? draft.customTargetHiddenMap : {};
    let deletedMap = (draft && draft.deletedCustomTargetIds && typeof draft.deletedCustomTargetIds === 'object') ? draft.deletedCustomTargetIds : {};
    let visibleTargets = targets.filter(function(rawTarget) {
      let normalized = normalizeCustomTargetRecord(rawTarget);
      return !deletedMap[String(normalized.id || '')];
    });
    if (!visibleTargets.length) {
      return '<div class="custom-target-slot-note">No custom targets yet. Use Create Target to fill the reserved custom slots.</div>';
    }
    let html = '<div class="custom-target-config-list">';
    visibleTargets.forEach(function(rawTarget) {
      let target = normalizeCustomTargetRecord(rawTarget);
      let typeMeta = getCustomTargetTypeMeta(target.definition.type);
      let isVisible = Object.prototype.hasOwnProperty.call(hiddenMap, String(target.id || '')) ? !hiddenMap[String(target.id || '')] : !target.hidden;
      html += '<div class="custom-target-config-item' + (isVisible ? '' : ' is-hidden') + '">' 
        + '<div class="custom-target-config-head">'
        + '<div class="custom-target-config-title"><span class="badge-config-icon">' + badgeEsc(target.presentation.icon || '🎯') + '</span><div class="custom-target-config-copy"><div class="custom-target-config-name">' + badgeEsc(target.presentation.name || 'Custom Target') + '</div><div class="custom-target-config-meta">' + badgeEsc(typeMeta.label + ' · ' + target.definition.scopeLabel) + '</div></div></div>'
        + '<div class="custom-target-config-actions"><label class="custom-target-visibility"><input type="checkbox" data-custom-target-hidden-toggle="' + badgeEsc(target.id) + '" ' + (isVisible ? 'checked' : '') + ' /> <span>Visible</span></label><button class="custom-target-delete-btn" type="button" data-delete-custom-target="' + badgeEsc(target.id) + '">Delete</button></div>'
        + '</div>'
        + '<div class="custom-target-config-meta">' + badgeEsc((target.progression.mode === 'cumulative' ? 'Cumulative' : 'Streak') + ' · ' + (target.progression.levelMode === 'unlimited' ? 'Unlimited' : (target.progression.levelMode + ' levels')) + ' · Threshold ' + (target.definition.unit === 'percent' ? (target.definition.threshold + '%') : fmtC(target.definition.threshold))) + '</div>'
        + '</div>';
    });
    html += '</div>';
    return html;
  }

  function getCustomTargetModeHelpText(draft) {
    let safeDraft = cloneCustomTargetDraft(draft);
    if (!isCustomTargetModeAllowed(safeDraft.type, 'cumulative')) {
      return 'This target type supports streak tracking only.';
    }
    return safeDraft.mode === 'cumulative'
      ? 'Cumulative mode keeps adding qualified monthly value instead of resetting on a miss.'
      : 'Streak mode increments on success and resets on a failed closed month.';
  }

  function renderCustomTargetPreviewMarkup(draft) {
    let preview = buildCustomTargetPreview(draft);
    return '<strong>' + badgeEsc(preview.name) + '</strong><br>' + badgeEsc(preview.sentence) + '<br><span style="color:var(--muted)">' + badgeEsc(preview.shortMeta) + '</span>';
  }

  function renderCustomTargetBuilderModal() {
    let bs = loadBadgeState();
    let draft = cloneCustomTargetDraft(customTargetDraft || buildDefaultCustomTargetDraft());
    customTargetDraft = draft;
    let existingCount = Array.isArray(bs.customTargets) ? bs.customTargets.length : 0;
    let typeMeta = getCustomTargetTypeMeta(draft.type);
    let options = getCustomTargetScopeOptions(draft.type);
    let currentError = validateCustomTargetDraft(draft, existingCount);
    let cumulativeAllowed = isCustomTargetModeAllowed(draft.type, 'cumulative');
    let html = '<div class="cbm-modal custom-target-builder-modal" role="dialog" aria-modal="true" aria-labelledby="customTargetBuilderTitle">'
      + '<div class="cbm-header"><div><div class="cbm-title" id="customTargetBuilderTitle">Create Custom Target</div><div class="cbm-sub">Build your own monthly target series</div></div><button class="cbm-close-btn" type="button" data-custom-target-close="1" aria-label="Close custom target builder">&#x2715;</button></div>'
      + '<div class="cbm-body custom-target-builder-body">'
      + '<div class="custom-target-builder-grid">'
      + '<div class="cbm-input-group"><label for="customTargetNameInput">Target name</label><div class="cbm-input-row"><input id="customTargetNameInput" data-custom-target-field="name" type="text" value="' + badgeEsc(draft.name || '') + '" placeholder="' + badgeEsc(getCustomTargetSuggestedName(draft)) + '" /></div></div>'
      + '<div class="cbm-input-group"><label for="customTargetTypeSelect">Target type</label><div class="cbm-input-row"><select id="customTargetTypeSelect" data-custom-target-field="type">';
    Object.keys(CUSTOM_TARGET_TYPE_META).forEach(function(key) {
      html += '<option value="' + badgeEsc(key) + '"' + (draft.type === key ? ' selected' : '') + '>' + badgeEsc(CUSTOM_TARGET_TYPE_META[key].label) + '</option>';
    });
    html += '</select></div></div>'
      + '<div class="cbm-input-group"><label for="customTargetScopeSelect" id="customTargetScopeLabel">' + badgeEsc(typeMeta.scopeLabel) + '</label><div class="cbm-input-row"><select id="customTargetScopeSelect" data-custom-target-field="scopeKey"><option value="">Select an option</option>';
    options.forEach(function(option) {
      html += '<option value="' + badgeEsc(option.value) + '"' + (String(draft.scopeKey || '') === String(option.value || '') ? ' selected' : '') + '>' + badgeEsc(option.label) + '</option>';
    });
    html += '</select></div></div>'
      + '<div class="cbm-input-group"><label for="customTargetThresholdInput" id="customTargetThresholdLabel">' + badgeEsc(typeMeta.operatorLabel) + '</label><div class="cbm-input-row"><input id="customTargetThresholdInput" data-custom-target-field="threshold" type="number" min="0" step="' + (typeMeta.unit === 'percent' ? '0.1' : '1') + '" value="' + badgeEsc(draft.threshold || '') + '" /><span class="cbm-unit" id="customTargetThresholdUnit">' + badgeEsc(typeMeta.unit === 'percent' ? '%' : 'EUR') + '</span></div></div>'
      + '<div class="cbm-input-group"><label for="customTargetModeSelect">Progression</label><div class="cbm-input-row"><select id="customTargetModeSelect" data-custom-target-field="mode"' + (cumulativeAllowed ? '' : ' disabled') + '>'
      + '<option value="streak"' + (draft.mode === 'streak' ? ' selected' : '') + '>Streak</option>'
      + (cumulativeAllowed ? ('<option value="cumulative"' + (draft.mode === 'cumulative' ? ' selected' : '') + '>Cumulative</option>') : '')
      + '</select></div><div class="custom-target-inline-help" id="customTargetModeHelp">' + badgeEsc(getCustomTargetModeHelpText(draft)) + '</div></div>'
      + '<div class="cbm-input-group"><label for="customTargetLevelsSelect">Levels</label><div class="cbm-input-row"><select id="customTargetLevelsSelect" data-custom-target-field="levelMode">'
      + '<option value="5"' + (draft.levelMode === '5' ? ' selected' : '') + '>5 levels</option>'
      + '<option value="10"' + (draft.levelMode === '10' ? ' selected' : '') + '>10 levels</option>'
      + '<option value="unlimited"' + (draft.levelMode === 'unlimited' ? ' selected' : '') + '>Unlimited</option>'
      + '</select></div></div>'
      + '<div class="cbm-input-group custom-target-icon-group"><label>Icon</label><div class="cbm-icon-picker">';
    CUSTOM_TARGET_ICON_OPTIONS.forEach(function(icon) {
      html += '<button class="cbm-icon-btn' + (draft.icon === icon ? ' cbm-icon-sel' : '') + '" type="button" data-custom-target-icon="' + badgeEsc(icon) + '" aria-label="Choose ' + badgeEsc(icon) + ' icon">' + badgeEsc(icon) + '</button>';
    });
    html += '</div></div>'
      + '<div class="custom-target-preview-block"><div class="custom-target-preview-label">Preview</div><div class="cbm-preview-text" id="customTargetPreviewText">' + renderCustomTargetPreviewMarkup(draft) + '</div></div>'
      + '<div class="cbm-error" id="customTargetBuilderError">' + badgeEsc(currentError) + '</div>'
      + '</div></div><div class="cbm-footer"><button class="cbm-btn-ghost" type="button" data-custom-target-close="1">Cancel</button><button class="cbm-btn-primary" type="button" id="customTargetCreateBtn"' + (currentError ? ' disabled' : '') + '>Create Target</button></div></div>';
    return html;
  }

  function ensureCustomTargetBuilderOverlay() {
    let existing = document.getElementById('customTargetBuilderOverlay');
    if (existing) {
      existing.innerHTML = renderCustomTargetBuilderModal();
      return existing;
    }
    let overlay = document.createElement('div');
    overlay.id = 'customTargetBuilderOverlay';
    overlay.className = 'cbm-overlay';
    overlay.setAttribute('data-modal-kind', 'custom-target');
    overlay.innerHTML = renderCustomTargetBuilderModal();
    document.body.appendChild(overlay);
    return overlay;
  }

  function refreshCustomTargetBuilderModal(preferredSelector) {
    let overlay = document.getElementById('customTargetBuilderOverlay');
    if (!overlay) return null;
    let restoreSelector = preferredSelector || '';
    let selectionStart = null;
    let selectionEnd = null;
    let activeEl = document.activeElement;
    if (!restoreSelector && activeEl && overlay.contains(activeEl)) {
      if (activeEl.id) restoreSelector = '#' + activeEl.id;
      else if (activeEl.getAttribute && activeEl.getAttribute('data-custom-target-field')) {
        restoreSelector = '[data-custom-target-field="' + activeEl.getAttribute('data-custom-target-field') + '"]';
      }
      if (typeof activeEl.selectionStart === 'number') {
        selectionStart = activeEl.selectionStart;
        selectionEnd = activeEl.selectionEnd;
      }
    }
    overlay.innerHTML = renderCustomTargetBuilderModal();
    overlay.classList.add('cbm-open');
    if (restoreSelector) {
      let nextField = overlay.querySelector(restoreSelector);
      if (nextField && typeof nextField.focus === 'function') {
        nextField.focus({ preventScroll: true });
        if (selectionStart != null && typeof nextField.setSelectionRange === 'function') {
          let maxLen = String(nextField.value || '').length;
          nextField.setSelectionRange(Math.min(selectionStart, maxLen), Math.min(selectionEnd == null ? selectionStart : selectionEnd, maxLen));
        }
      }
    }
    return overlay;
  }

  function updateCustomTargetBuilderDynamicState() {
    let overlay = document.getElementById('customTargetBuilderOverlay');
    if (!overlay) return;
    let bs = loadBadgeState();
    let draft = cloneCustomTargetDraft(customTargetDraft || buildDefaultCustomTargetDraft());
    customTargetDraft = draft;
    let error = validateCustomTargetDraft(draft, Array.isArray(bs.customTargets) ? bs.customTargets.length : 0);
    let previewEl = overlay.querySelector('#customTargetPreviewText');
    if (previewEl) previewEl.innerHTML = renderCustomTargetPreviewMarkup(draft);
    let errorEl = overlay.querySelector('#customTargetBuilderError');
    if (errorEl) errorEl.textContent = error;
    let createBtn = overlay.querySelector('#customTargetCreateBtn');
    if (createBtn) createBtn.disabled = !!error;
    let modeHelp = overlay.querySelector('#customTargetModeHelp');
    if (modeHelp) modeHelp.textContent = getCustomTargetModeHelpText(draft);
    let nameInput = overlay.querySelector('#customTargetNameInput');
    if (nameInput) nameInput.setAttribute('placeholder', getCustomTargetSuggestedName(draft));
  }

  function openCustomTargetBuilder() {
    customTargetDraft = cloneCustomTargetDraft(customTargetDraft || buildDefaultCustomTargetDraft());
    let overlay = ensureCustomTargetBuilderOverlay();
    overlay.classList.add('cbm-open');
    let initialField = overlay.querySelector('#customTargetNameInput');
    if (initialField && typeof initialField.focus === 'function') initialField.focus({ preventScroll: true });
    if (typeof wireBadgeSystemEvents === 'function') wireBadgeSystemEvents('monthly', calMonthKey());
  }

  function closeCustomTargetBuilder() {
    let overlay = document.getElementById('customTargetBuilderOverlay');
    if (overlay) overlay.classList.remove('cbm-open');
  }

  function syncCustomTargetDraftField(field, value) {
    if (!customTargetDraft || typeof customTargetDraft !== 'object') customTargetDraft = buildDefaultCustomTargetDraft();
    if (field === 'type') {
      customTargetDraft.type = String(value || 'category_cap');
      let typeMeta = getCustomTargetTypeMeta(customTargetDraft.type);
      customTargetDraft.scopeKey = '';
      customTargetDraft.icon = typeMeta.defaultIcon;
      if (!isCustomTargetModeAllowed(customTargetDraft.type, customTargetDraft.mode)) customTargetDraft.mode = 'streak';
      return;
    }
    if (field === 'threshold') {
      customTargetDraft.threshold = String(value || '');
      return;
    }
    if (field === 'name' || field === 'scopeKey' || field === 'mode' || field === 'levelMode') {
      customTargetDraft[field] = String(value || '');
    }
  }

  function saveCustomTargetFromDraft() {
    let bs = loadBadgeState();
    let draft = cloneCustomTargetDraft(customTargetDraft || buildDefaultCustomTargetDraft());
    let error = validateCustomTargetDraft(draft, (bs.customTargets || []).length);
    if (error) {
      let overlay = document.getElementById('customTargetBuilderOverlay');
      if (overlay) {
        refreshCustomTargetBuilderModal('#customTargetCreateBtn');
      }
      return;
    }
    let currentMonthKey = calMonthKey();
    let record = buildCustomTargetRecord(draft, currentMonthKey, monthLabelFromKey(currentMonthKey));
    bs.customTargets = Array.isArray(bs.customTargets) ? bs.customTargets : [];
    bs.customTargets.push(record);
    saveBadgeState(bs);
    closeCustomTargetBuilder();
    customTargetDraft = buildDefaultCustomTargetDraft();
    if (window.renderAchievementsTab) window.renderAchievementsTab();
  }

  function deleteCustomTargetById(targetId) {
    return runBadgeUndoableMutation(function() {
      let bs = loadBadgeState();
      let before = (bs.customTargets || []).length;
      bs.customTargets = (bs.customTargets || []).filter(function(target) {
        return String(target && target.id || '') !== String(targetId || '');
      });
      if (before === bs.customTargets.length) return false;
      saveBadgeState(bs);
      return true;
    });
  }

  function setCustomTargetHidden(targetId, hidden) {
    let bs = loadBadgeState();
    (bs.customTargets || []).forEach(function(target) {
      if (String(target && target.id || '') === String(targetId || '')) target.hidden = !!hidden;
    });
    saveBadgeState(bs);
    if (window.renderAchievementsTab) window.renderAchievementsTab();
  }

  function buildDefaultBadgeState() {
    return {
      version: BADGE_STATE_VERSION,
      saver: {
        unlockedBadge: 1,
        activeBadge: null,
        hidden: false,
        activationBaseline: null,
        activatedAt: null,
        activatedMonthKey: null,
        activatedMonthLabel: null,
        seriesBaseline: null
      },
      checkin: {
        active: false,
        mode: null,
        baselineCount: 0,
        activatedAt: null,
        activatedMonthKey: null,
        activatedPeriodLabel: null,
        bestWeeklyLevel: 0,
        bestMonthlyLevel: 0,
        draftMonthKey: '',
        drafts: {
          weekly: {
            enabled: false,
            baselineCount: 0,
            activatedAt: null,
            activatedMonthKey: null,
            activatedPeriodLabel: null
          },
          monthly: {
            enabled: false,
            baselineCount: 0,
            activatedAt: null,
            activatedMonthKey: null,
            activatedPeriodLabel: null
          }
        }
      },
      budgetMaster: {
        hidden: false,
        activatedAt: null,
        activatedMonthKey: null,
        activatedMonthLabel: null,
        bestLevel: 0
      },
      customTargets: [],
      completedLog: []
    };
  }

  function loadBadgeState() {
    let fallback = buildDefaultBadgeState();
    let state = null;
    try {
      let raw = localStorage.getItem(BADGE_STORAGE_KEY);
      if (raw) state = JSON.parse(raw);
      if (!state) {
        for (let i = 0; i < LEGACY_BADGE_STORAGE_KEYS.length; i++) {
          let legacyRaw = localStorage.getItem(LEGACY_BADGE_STORAGE_KEYS[i]);
          if (legacyRaw) {
            state = JSON.parse(legacyRaw);
            break;
          }
        }
      }
    } catch(e) {}

    if (!state || typeof state !== 'object') state = fallback;

    if (!state.saver || typeof state.saver !== 'object') state.saver = fallback.saver;
    if (!state.checkin || typeof state.checkin !== 'object') state.checkin = fallback.checkin;
    if (!state.budgetMaster || typeof state.budgetMaster !== 'object') state.budgetMaster = fallback.budgetMaster;
    if (!Array.isArray(state.customTargets)) state.customTargets = [];
    if (!Array.isArray(state.completedLog)) state.completedLog = [];

    if (state.saver.seriesBaseline == null || !isFinite(Number(state.saver.seriesBaseline))) state.saver.seriesBaseline = null;
    else state.saver.seriesBaseline = Math.max(0, Number(state.saver.seriesBaseline || 0));

    state.customTargets = state.customTargets.map(function(target) {
      return normalizeCustomTargetRecord(target);
    }).slice(0, MAX_CUSTOM_BADGE_SLOTS);

    state.completedLog = state.completedLog.filter(function(entry) {
      if (!entry || !entry.series) return false;
      if (entry.series === 'the_saver') {
        let lvl = Number(entry.level || 0);
        return lvl >= 1 && lvl <= SAVER_LEVELS.length;
      }
      if (entry.series === 'checkin_streak') {
        let mode = entry.mode === 'weekly' ? 'weekly' : 'monthly';
        let max = getCheckinThresholds(mode).length;
        let level = Number(entry.level || 0);
        return level >= 1 && level <= max;
      }
      if (entry.series === 'budget_master') {
        let budgetLevel = Number(entry.level || 0);
        return budgetLevel >= 1;
      }
      if (entry.series === 'custom_target') {
        return !!entry.targetId && Number(entry.level || 0) >= 1;
      }
      return false;
    });

    let highestCompleted = 0;
    state.completedLog.forEach(function(entry) {
      if (entry.series === 'the_saver') highestCompleted = Math.max(highestCompleted, Number(entry.level) || 0);
    });

    state.saver.unlockedBadge = Math.max(1, Math.min(Number(state.saver.unlockedBadge || 1), SAVER_LEVELS.length + 1));
    if (highestCompleted >= state.saver.unlockedBadge) {
      state.saver.unlockedBadge = Math.min(highestCompleted + 1, SAVER_LEVELS.length + 1);
    }
    state.saver.hidden = !!state.saver.hidden;

    let activeBadge = Number(state.saver.activeBadge || 0);
    if (!(activeBadge >= 1 && activeBadge <= SAVER_LEVELS.length)) {
      state.saver.activeBadge = null;
    } else if (activeBadge > state.saver.unlockedBadge || activeBadge <= highestCompleted) {
      state.saver.activeBadge = null;
      state.saver.activationBaseline = null;
      state.saver.activatedAt = null;
      state.saver.activatedMonthKey = null;
      state.saver.activatedMonthLabel = null;
    }

    state.checkin.active = !!state.checkin.active;
    state.checkin.mode = state.checkin.mode === 'weekly' ? 'weekly' : (state.checkin.mode === 'monthly' ? 'monthly' : null);
    state.checkin.baselineCount = Math.max(0, Number(state.checkin.baselineCount || 0));
    state.checkin.activatedAt = state.checkin.activatedAt || null;
    state.checkin.activatedMonthKey = /^\d{4}-\d{2}$/.test(String(state.checkin.activatedMonthKey || '')) ? String(state.checkin.activatedMonthKey) : '';
    state.checkin.activatedPeriodLabel = state.checkin.activatedPeriodLabel || '';
    state.checkin.bestWeeklyLevel = Math.max(0, Number(state.checkin.bestWeeklyLevel || 0));
    state.checkin.bestMonthlyLevel = Math.max(0, Number(state.checkin.bestMonthlyLevel || 0));
    ensureCheckinBadgeProfiles(state);

    state.budgetMaster.hidden = !!state.budgetMaster.hidden;
    state.budgetMaster.activatedAt = state.budgetMaster.activatedAt || null;
    state.budgetMaster.activatedMonthKey = /^\d{4}-\d{2}$/.test(String(state.budgetMaster.activatedMonthKey || '')) ? String(state.budgetMaster.activatedMonthKey) : '';
    state.budgetMaster.activatedMonthLabel = state.budgetMaster.activatedMonthLabel || '';
    state.budgetMaster.bestLevel = Math.max(0, Number(state.budgetMaster.bestLevel || 0));

    if (state.checkin.active && (!state.checkin.mode || !state.checkin.activatedMonthKey)) {
      clearActiveCheckinTarget(state);
    }
    syncActiveCheckinMirror(state);

    (state.completedLog || []).forEach(function(entry) {
      if (!(entry && entry.series === 'checkin_streak')) return;
      let lvl = Math.max(0, Number(entry.level || 0));
      if (entry.mode === 'weekly') state.checkin.bestWeeklyLevel = Math.max(state.checkin.bestWeeklyLevel, lvl);
      else state.checkin.bestMonthlyLevel = Math.max(state.checkin.bestMonthlyLevel, lvl);
    });

    (state.completedLog || []).forEach(function(entry) {
      if (!(entry && entry.series === 'budget_master')) return;
      state.budgetMaster.bestLevel = Math.max(state.budgetMaster.bestLevel, Math.max(0, Number(entry.level || 0)));
    });

    if (!state.version || Number(state.version) < BADGE_STATE_VERSION) state.version = BADGE_STATE_VERSION;
    return state;
  }

  function saveBadgeState(bs) {
    try {
      bs.version = BADGE_STATE_VERSION;
      localStorage.setItem(BADGE_STORAGE_KEY, JSON.stringify(bs));
      LEGACY_BADGE_STORAGE_KEYS.forEach(function(key) { localStorage.removeItem(key); });
    } catch(e) {}
  }

  function runBadgeUndoableMutation(mutator, after) {
    if (typeof mutator !== 'function') return false;
    let result = false;
    let runner = function() {
      result = mutator();
      return result !== false;
    };

    if (typeof window.withUserMutation === 'function') {
      let committed = window.withUserMutation(runner, { save: false, render: false });
      if (committed === false) return false;
    } else {
      runner();
    }

    if (result === false) return false;
    if (typeof after === 'function') after();
    if (typeof window.renderAchievementsTab === 'function') window.renderAchievementsTab();
    if (typeof updateAchievementsPill === 'function') updateAchievementsPill();
    return true;
  }


  function ensureCheckinBadgeProfiles(bs) {
    if (!bs || !bs.checkin) return;
    let currentMonthKey = calMonthKey();
    let storedDraftMonthKey = /^\d{4}-\d{2}$/.test(String(bs.checkin.draftMonthKey || '')) ? String(bs.checkin.draftMonthKey) : '';
    if (!bs.checkin.drafts || typeof bs.checkin.drafts !== 'object') bs.checkin.drafts = {};
    if (storedDraftMonthKey !== currentMonthKey) {
      bs.checkin.draftMonthKey = currentMonthKey;
      bs.checkin.drafts = {};
    }
    ['weekly', 'monthly'].forEach(function(mode) {
      let profile = bs.checkin.drafts[mode];
      if (!profile || typeof profile !== 'object') profile = {};
      profile.enabled = !!profile.enabled;
      profile.baselineCount = Math.max(0, Number(profile.baselineCount || 0));
      profile.activatedAt = profile.activatedAt || null;
      profile.activatedMonthKey = /^\d{4}-\d{2}$/.test(String(profile.activatedMonthKey || '')) ? String(profile.activatedMonthKey) : '';
      profile.activatedPeriodLabel = profile.activatedPeriodLabel || '';
      bs.checkin.drafts[mode] = profile;
    });
  }

  function getCheckinProfile(bs, mode) {
    if (!bs || !bs.checkin) return null;
    ensureCheckinBadgeProfiles(bs);
    return bs.checkin.drafts[mode === 'weekly' ? 'weekly' : 'monthly'];
  }

  function syncActiveCheckinMirror(bs) {
    if (!bs || !bs.checkin) return;
    ensureCheckinBadgeProfiles(bs);
    let activeMode = bs.checkin.mode === 'weekly' ? 'weekly' : (bs.checkin.mode === 'monthly' ? 'monthly' : null);
    if (!bs.checkin.active || !activeMode || !bs.checkin.activatedMonthKey) {
      clearActiveCheckinTarget(bs);
      return;
    }
    bs.checkin.active = true;
    bs.checkin.mode = activeMode;
    bs.checkin.baselineCount = Math.max(0, Number(bs.checkin.baselineCount || 0));
    bs.checkin.activatedAt = bs.checkin.activatedAt || null;
    bs.checkin.activatedMonthKey = /^\d{4}-\d{2}$/.test(String(bs.checkin.activatedMonthKey || '')) ? String(bs.checkin.activatedMonthKey) : '';
    bs.checkin.activatedPeriodLabel = bs.checkin.activatedPeriodLabel || '';
    if (!bs.checkin.activatedMonthKey) clearActiveCheckinTarget(bs);
  }

  function clearActiveCheckinTarget(bs) {
    if (!bs || !bs.checkin) return;
    bs.checkin.active = false;
    bs.checkin.mode = null;
    bs.checkin.baselineCount = 0;
    bs.checkin.activatedAt = null;
    bs.checkin.activatedMonthKey = null;
    bs.checkin.activatedPeriodLabel = null;
  }

  function clearCheckinDraftForMode(bs, mode) {
    let profile = getCheckinProfile(bs, mode);
    if (!profile) return;
    profile.enabled = false;
    profile.baselineCount = 0;
    profile.activatedAt = null;
    profile.activatedMonthKey = '';
    profile.activatedPeriodLabel = '';
  }

  function saveCheckinDraftForMode(bs, mode, monthKey) {
    if (!bs || !bs.checkin || !bs.checkin.active) return false;
    let safeMode = mode === 'weekly' ? 'weekly' : 'monthly';
    let safeMonthKey = /^\d{4}-\d{2}$/.test(String(monthKey || '')) ? String(monthKey) : calMonthKey();
    if (bs.checkin.mode !== safeMode) return false;
    ensureCheckinBadgeProfiles(bs);
    bs.checkin.draftMonthKey = safeMonthKey;
    let profile = getCheckinProfile(bs, safeMode);
    if (!profile) return false;
    profile.enabled = true;
    profile.baselineCount = Math.max(0, Number(bs.checkin.baselineCount || 0));
    profile.activatedAt = bs.checkin.activatedAt || null;
    profile.activatedMonthKey = String(bs.checkin.activatedMonthKey || safeMonthKey);
    profile.activatedPeriodLabel = bs.checkin.activatedPeriodLabel || monthLabelFromKey(profile.activatedMonthKey || safeMonthKey);
    return true;
  }

  function disableCheckinTargetForMode(bs, mode) {
    let safeMode = mode === 'weekly' ? 'weekly' : 'monthly';
    clearCheckinDraftForMode(bs, safeMode);
    if (bs && bs.checkin && bs.checkin.mode === safeMode) clearActiveCheckinTarget(bs);
  }

  function activateCheckinTarget(bs, mode, monthKey) {
    if (!bs || !bs.checkin) return;
    let safeMode = mode === 'weekly' ? 'weekly' : 'monthly';
    let safeMonthKey = /^\d{4}-\d{2}$/.test(String(monthKey || '')) ? String(monthKey) : calMonthKey();
    ensureCheckinBadgeProfiles(bs);
    bs.checkin.active = true;
    bs.checkin.mode = safeMode;
    bs.checkin.baselineCount = 0;
    bs.checkin.activatedAt = new Date().toISOString();
    bs.checkin.activatedMonthKey = safeMonthKey;
    bs.checkin.activatedPeriodLabel = monthLabelFromKey(safeMonthKey);
    clearCheckinDraftForMode(bs, safeMode);
    syncActiveCheckinMirror(bs);
  }

  function restoreCheckinTargetForMode(bs, mode, monthKey) {
    if (!bs || !bs.checkin) return false;
    let safeMode = mode === 'weekly' ? 'weekly' : 'monthly';
    let safeMonthKey = /^\d{4}-\d{2}$/.test(String(monthKey || '')) ? String(monthKey) : calMonthKey();
    ensureCheckinBadgeProfiles(bs);
    if (String(bs.checkin.draftMonthKey || '') !== safeMonthKey) return false;
    let profile = getCheckinProfile(bs, safeMode);
    if (!profile || !profile.enabled || !profile.activatedMonthKey) {
      clearActiveCheckinTarget(bs);
      return false;
    }
    bs.checkin.active = true;
    bs.checkin.mode = safeMode;
    bs.checkin.baselineCount = Math.max(0, Number(profile.baselineCount || 0));
    bs.checkin.activatedAt = profile.activatedAt || null;
    bs.checkin.activatedMonthKey = profile.activatedMonthKey || '';
    bs.checkin.activatedPeriodLabel = profile.activatedPeriodLabel || monthLabelFromKey(profile.activatedMonthKey || safeMonthKey);
    syncActiveCheckinMirror(bs);
    return true;
  }

  function clearAllCheckinDrafts(bs, monthKey) {
    if (!bs || !bs.checkin) return false;
    ensureCheckinBadgeProfiles(bs);
    let safeMonthKey = /^\d{4}-\d{2}$/.test(String(monthKey || '')) ? String(monthKey) : calMonthKey();
    if (String(bs.checkin.draftMonthKey || '') !== safeMonthKey) return false;
    let before = JSON.stringify(bs.checkin.drafts || {});
    clearCheckinDraftForMode(bs, 'weekly');
    clearCheckinDraftForMode(bs, 'monthly');
    return before !== JSON.stringify(bs.checkin.drafts || {});
  }

  function hasCurrentMonthCheckinDraft(bs, mode, monthKey) {
    let safeMode = mode === 'weekly' ? 'weekly' : 'monthly';
    let safeMonthKey = /^\d{4}-\d{2}$/.test(String(monthKey || '')) ? String(monthKey) : calMonthKey();
    if (!bs || !bs.checkin) return false;
    ensureCheckinBadgeProfiles(bs);
    if (String(bs.checkin.draftMonthKey || '') !== safeMonthKey) return false;
    let profile = getCheckinProfile(bs, safeMode);
    return !!(profile && profile.enabled && profile.activatedMonthKey);
  }

  function getAchievementMonthRecordByKey(state, mk) {
    let year = String(mk || '').slice(0, 4);
    return state && state.years && state.years[year] && state.years[year].months ? state.years[year].months[mk] || null : null;
  }

  function getDashboardMonthByKey(mk) {
    return getAllDashboardMonths().find(function(month) {
      return month && monthKeyFromMonthObj(month) === mk;
    }) || null;
  }

  function getCompletedSaverLevels(bs) {
    return (bs && Array.isArray(bs.completedLog) ? bs.completedLog : [])
      .filter(function(entry) { return entry && entry.series === 'the_saver'; })
      .slice()
      .sort(function(a, b) { return Number(a && a.level || 0) - Number(b && b.level || 0); });
  }

  function getSeriesPool(bs, live) {
    let baseline = Math.max(0, Number(bs && bs.saver && bs.saver.seriesBaseline || 0));
    let currentCumulative = Math.max(0, Number((live && live.cumulativeSavingsActual) || 0));
    return Math.max(0, currentCumulative - baseline);
  }

  function getConsumedTargetThroughLevel(level) {
    let upto = Math.max(0, Number(level || 0));
    let total = 0;
    for (let i = 0; i < upto && i < SAVER_LEVELS.length; i++) total += Number(SAVER_LEVELS[i] || 0);
    return total;
  }

  function validateCompletedSaverState(bs, live) {
    if (!bs || !Array.isArray(bs.completedLog)) return false;
    let changed = false;
    let pool = getSeriesPool(bs, live);
    let validEntries = [];
    let highestValid = 0;
    let consumed = 0;

    getCompletedSaverLevels(bs).forEach(function(entry) {
      let level = Number(entry && entry.level || 0);
      if (level !== highestValid + 1) {
        changed = true;
        return;
      }
      let target = Number(SAVER_LEVELS[level - 1] || 0);
      if (pool - consumed + 0.0001 < target) {
        changed = true;
        return;
      }
      validEntries.push(entry);
      consumed += target;
      highestValid = level;
    });

    let nonSaverEntries = bs.completedLog.filter(function(entry) { return entry && entry.series !== 'the_saver'; });
    if (validEntries.length !== getCompletedSaverLevels(bs).length || bs.completedLog.length !== validEntries.length + nonSaverEntries.length) {
      bs.completedLog = validEntries.concat(nonSaverEntries);
      changed = true;
    }

    let nextUnlocked = highestValid >= SAVER_LEVELS.length ? SAVER_LEVELS.length + 1 : highestValid + 1;
    if (Number(bs.saver.unlockedBadge || 1) !== nextUnlocked) {
      bs.saver.unlockedBadge = nextUnlocked;
      changed = true;
    }

    let activeBadge = Number(bs.saver.activeBadge || 0);
    if (activeBadge && activeBadge !== highestValid + 1) {
      bs.saver.activeBadge = null;
      bs.saver.activationBaseline = null;
      bs.saver.activatedAt = null;
      bs.saver.activatedMonthKey = null;
      bs.saver.activatedMonthLabel = null;
      changed = true;
    }

    if (!bs.saver.hidden && !bs.saver.activeBadge && nextUnlocked <= SAVER_LEVELS.length) {
      bs.saver.activeBadge = nextUnlocked;
      bs.saver.activationBaseline = Math.max(0, Number(bs.saver.seriesBaseline || 0));
      bs.saver.activatedAt = bs.saver.activatedAt || new Date().toISOString();
      bs.saver.activatedMonthKey = bs.saver.activatedMonthKey || calMonthKey();
      bs.saver.activatedMonthLabel = bs.saver.activatedMonthLabel || monthLabelFromKey(bs.saver.activatedMonthKey);
      changed = true;
    }

    if (!validEntries.length && !bs.saver.activeBadge && bs.saver.seriesBaseline != null) {
      bs.saver.seriesBaseline = null;
      changed = true;
    }

    return changed;
  }

  function computeSaverStatus(bs, month, mk) {
    let live = getLiveBadgeMetrics(month);
    let activeBadge = Number(bs && bs.saver && bs.saver.activeBadge || 0);
    if (!(activeBadge >= 1 && activeBadge <= SAVER_LEVELS.length)) return { live: live, status: null };

    let activationMonthKey = bs && bs.saver ? bs.saver.activatedMonthKey : null;
    if (!isTargetVisibleFromActivationMonth(activationMonthKey, mk)) return { live: live, status: null };

    let def = getSaverBadgeDef(activeBadge);
    let pool = getSeriesPool(bs, live);
    let consumedBefore = getConsumedTargetThroughLevel(activeBadge - 1);
    let effectiveValue = Math.max(0, pool - consumedBefore);
    let progress = Math.max(0, Math.min(effectiveValue / def.target, 1));
    let completed = effectiveValue >= def.target;

    return {
      live: live,
      status: {
        id: def.id,
        series: def.series,
        name: def.name,
        icon: def.icon,
        level: def.level,
        totalLevels: def.totalLevels,
        target: def.target,
        progress: progress,
        completed: completed,
        effectiveValue: effectiveValue,
        meta: 'Current Status: ' + fmtC(effectiveValue) + '/' + fmtC(def.target)
      }
    };
  }

  function getMonthlyCheckinStatuses(achState, mk) {
    return getDashboardMonthKeysUpTo(mk).map(function(key) {
      let rec = getAchievementMonthRecordByKey(achState, key);
      let completed = !!(rec && rec.monthly && rec.monthly.snapshot && rec.monthly.snapshot.check_in_status === 'completed');
      let status = completed ? 'completed' : (key === mk ? 'pending' : 'missed');
      return { key: key, status: status, isCurrent: key === mk, mode: 'monthly' };
    });
  }

  function getWeeklyCheckinStatuses(achState, mk) {
    let today = new Date().toISOString().slice(0, 10);
    let currentMonthKey = calMonthKey();
    let items = [];

    getDashboardMonthKeysUpTo(mk).forEach(function(monthKey) {
      let rec = getAchievementMonthRecordByKey(achState, monthKey);
      let entries = rec && rec.weekly && Array.isArray(rec.weekly.entries) ? rec.weekly.entries : [];
      let sundays = getMonthSundays(monthKey);
      let reached = sundays.filter(function(due) { return due <= today; });
      let latestReached = reached.length ? reached[reached.length - 1] : null;

      sundays.forEach(function(due) {
        if (monthKey === currentMonthKey && due > today) return;
        let completed = entries.some(function(entry) { return entry && entry.due_date === due && entry.status === 'completed'; });
        let status = 'missed';
        if (completed) {
          status = 'completed';
        } else if (monthKey === currentMonthKey && due === latestReached) {
          status = 'pending';
        }
        items.push({
          key: due,
          monthKey: monthKey,
          status: status,
          isCurrent: monthKey === currentMonthKey && due === latestReached,
          mode: 'weekly'
        });
      });
    });

    return items;
  }

  function getSequenceStats(statuses) {
    let maxRun = 0;
    let run = 0;

    statuses.forEach(function(item) {
      if (item.status === 'completed') {
        run += 1;
        if (run > maxRun) maxRun = run;
      } else if (item.status === 'missed') {
        run = 0;
      }
    });

    let tail = statuses.length - 1;
    while (tail >= 0 && statuses[tail].status === 'pending') tail -= 1;

    let currentRun = 0;
    for (let i = tail; i >= 0; i--) {
      if (statuses[i].status === 'completed') currentRun += 1;
      else if (statuses[i].status === 'missed') break;
    }

    let currentPeriodCompleted = 0;
    if (statuses.length) {
      let last = statuses[statuses.length - 1];
      currentPeriodCompleted = last && last.isCurrent && last.status === 'completed' ? 1 : 0;
    }

    return {
      currentCount: currentRun,
      maxCount: maxRun,
      currentPeriodCompleted: currentPeriodCompleted
    };
  }

  function getCheckinStoredEntry(bs, mode) {
    return (bs.completedLog || []).find(function(entry) {
      return entry && entry.series === 'checkin_streak' && entry.mode === mode;
    }) || null;
  }

  function getCheckinStatusesFromActivationMonth(achState, mode, mk, activationMonthKey) {
    let safeMode = mode === 'weekly' ? 'weekly' : 'monthly';
    let base = safeMode === 'weekly' ? getWeeklyCheckinStatuses(achState, mk) : getMonthlyCheckinStatuses(achState, mk);
    let startKey = activationMonthKey || mk;
    return base.filter(function(item) {
      let itemMonthKey = safeMode === 'weekly' ? String(item.monthKey || '') : String(item.key || '');
      return compareMonthKeys(itemMonthKey, startKey) >= 0;
    });
  }

  function getCheckinMetricsFromActivationMonth(achState, mode, mk, activationMonthKey) {
    let safeMode = mode === 'weekly' ? 'weekly' : 'monthly';
    let statuses = getCheckinStatusesFromActivationMonth(achState, safeMode, mk, activationMonthKey);
    let stats = getSequenceStats(statuses);
    return {
      mode: safeMode,
      statuses: statuses,
      currentCount: stats.currentCount,
      maxCount: stats.maxCount,
      currentPeriodCompleted: stats.currentPeriodCompleted,
      currentLevel: getCheckinLevelFromCount(safeMode, stats.currentCount),
      maxLevel: getCheckinLevelFromCount(safeMode, stats.maxCount)
    };
  }

  function upsertCheckinCompletedEntry(bs, mode, level, count, mk) {
    if (!(level >= 1)) return false;
    let existing = getCheckinStoredEntry(bs, mode);
    let targetDef = getCheckinTargetDef(mode, level);
    let entry = {
      id: 'checkin_streak_' + mode,
      series: 'checkin_streak',
      title: 'Check-In Streak',
      icon: targetDef.icon,
      mode: mode,
      level: level,
      count: count,
      completedAt: new Date().toISOString(),
      monthKey: mk,
      monthLabel: monthLabelFromKey(mk),
      metricLabel: (mode === 'weekly' ? 'Weekly' : 'Monthly') + ' · Badge ' + level + '/' + targetDef.totalLevels
    };
    if (!existing) {
      bs.completedLog.push(entry);
      return true;
    }
    if (Number(existing.level || 0) !== level || Number(existing.count || 0) !== Number(count || 0) || existing.monthKey !== mk) {
      Object.assign(existing, entry);
      return true;
    }
    return false;
  }

  function removeCheckinCompletedEntry(bs, mode) {
    let before = (bs.completedLog || []).length;
    bs.completedLog = (bs.completedLog || []).filter(function(entry) {
      return !(entry && entry.series === 'checkin_streak' && entry.mode === mode);
    });
    return before !== bs.completedLog.length;
  }

  function evaluateBudgetMasterMonth(month) {
    if (!month) return { closed: false, passed: false, totalRows: 0, passedRows: 0, failingRows: [], summary: 'No month data available.' };
    let closed = isClosedMonth(month);
    let allocation = allocationRows(month);
    let rows = Array.isArray(allocation && allocation.rows) ? allocation.rows : [];
    let epsilon = 0.009;
    let failingRows = [];
    rows.forEach(function(row) {
      let allocationValue = Math.max(0, Number(row && row.allocation || 0));
      let actualValue = Math.max(0, Number(row && row.actual || 0));
      let passed = isSavingsAllocationRow(row) ? actualValue + epsilon >= allocationValue : actualValue <= allocationValue + epsilon;
      if (!passed) {
        failingRows.push({
          key: row && row.key || '',
          label: row && row.label || 'Budget row',
          allocation: allocationValue,
          actual: actualValue,
          kind: isSavingsAllocationRow(row) ? 'savings' : 'expense'
        });
      }
    });
    let passedRows = rows.length - failingRows.length;
    return {
      closed: closed,
      passed: closed && rows.length > 0 && failingRows.length === 0,
      totalRows: rows.length,
      passedRows: passedRows,
      failingRows: failingRows,
      summary: !closed
        ? ' — Budget Master .'
        : (failingRows.length ? (failingRows[0].kind === 'savings'
            ? 'Savings / Investments finished below allocation.'
            : failingRows[0].label + ' finished above allocation.')
          : 'All budget allocations were respected for the closed month.')
    };
  }

  function getBudgetMasterStatusesFromActivationMonth(mk, activationMonthKey) {
    let startKey = activationMonthKey || mk;
    return getDashboardMonthKeysUpTo(mk).filter(function(key) {
      return compareMonthKeys(key, startKey) >= 0;
    }).map(function(key) {
      let month = getDashboardMonthByKey(key);
      let evaluation = evaluateBudgetMasterMonth(month);
      let status = evaluation.closed ? (evaluation.passed ? 'completed' : 'missed') : 'pending';
      return {
        key: key,
        status: status,
        isCurrent: key === mk,
        evaluation: evaluation
      };
    });
  }

  function getBudgetMasterMetricsFromActivationMonth(mk, activationMonthKey) {
    let statuses = getBudgetMasterStatusesFromActivationMonth(mk, activationMonthKey);
    let stats = getSequenceStats(statuses);
    return {
      statuses: statuses,
      currentCount: stats.currentCount,
      maxCount: stats.maxCount,
      currentLevel: getBudgetMasterLevelFromCount(stats.currentCount),
      maxLevel: getBudgetMasterLevelFromCount(stats.maxCount),
      latest: statuses.length ? statuses[statuses.length - 1] : null
    };
  }

  function getBudgetMasterStoredEntry(bs) {
    return (bs.completedLog || []).find(function(entry) {
      return entry && entry.series === 'budget_master';
    }) || null;
  }

  function upsertBudgetMasterCompletedEntry(bs, level, count, mk) {
    if (!(level >= 1)) return false;
    let existing = getBudgetMasterStoredEntry(bs);
    let targetDef = getBudgetMasterTargetDef(level);
    let entry = {
      id: 'budget_master',
      series: 'budget_master',
      title: 'Budget Master',
      icon: targetDef.icon,
      level: level,
      count: Math.max(0, Number(count || 0)),
      completedAt: new Date().toISOString(),
      monthKey: mk,
      monthLabel: monthLabelFromKey(mk),
      metricLabel: 'Streak badge ' + level
    };
    if (!existing) {
      bs.completedLog.push(entry);
      return true;
    }
    if (Number(existing.level || 0) !== level || Number(existing.count || 0) !== Number(entry.count || 0) || existing.monthKey !== mk) {
      Object.assign(existing, entry);
      return true;
    }
    return false;
  }

  function removeBudgetMasterCompletedEntry(bs) {
    let before = (bs.completedLog || []).length;
    bs.completedLog = (bs.completedLog || []).filter(function(entry) {
      return !(entry && entry.series === 'budget_master');
    });
    return before !== bs.completedLog.length;
  }

  function syncBudgetMasterState(bs, mk) {
    let changed = false;
    if (!bs || !bs.budgetMaster) return { changed: false, metrics: null, status: null };

    let activationMonthKey = String(bs.budgetMaster.activatedMonthKey || '');
    if (!activationMonthKey || bs.budgetMaster.hidden) return { changed: changed, metrics: null, status: null };
    if (!isTargetVisibleFromActivationMonth(activationMonthKey, mk)) return { changed: changed, metrics: null, status: null };

    let metrics = getBudgetMasterMetricsFromActivationMonth(mk, activationMonthKey);
    let maxLevel = Math.max(0, Number(metrics.maxLevel || 0));
    let maxCount = Math.max(0, Number(metrics.maxCount || 0));
    if (maxLevel > Number(bs.budgetMaster.bestLevel || 0)) {
      bs.budgetMaster.bestLevel = maxLevel;
      if (upsertBudgetMasterCompletedEntry(bs, maxLevel, maxCount, mk)) changed = true;
      changed = true;
    } else if (maxLevel >= 1) {
      if (upsertBudgetMasterCompletedEntry(bs, maxLevel, maxCount, mk)) changed = true;
    } else {
      if (removeBudgetMasterCompletedEntry(bs)) changed = true;
      if (Number(bs.budgetMaster.bestLevel || 0) !== 0) {
        bs.budgetMaster.bestLevel = 0;
        changed = true;
      }
    }

    let nextLevel = Math.max(maxLevel + 1, 1);
    let nextTarget = getBudgetMasterThresholdForLevel(nextLevel);
    let currentCount = Math.max(0, Number(metrics.currentCount || 0));

    return {
      changed: changed,
      metrics: metrics,
      status: {
        id: 'budget_master_active',
        series: 'budget_master',
        name: 'Budget Master',
        icon: '🎯',
        level: nextLevel,
        earnedLevel: maxLevel,
        totalLevels: getBudgetMasterTotalLabel(),
        target: nextTarget,
        progress: nextTarget > 0 ? Math.max(0, Math.min(currentCount / nextTarget, 1)) : 0,
        progressCount: currentCount,
        currentStreak: currentCount,
        bestStreak: maxCount,
        meta: 'Current Status: ' + currentCount + '/' + nextTarget + ' months',
        detail: 'Keep your targets · Badge ' + nextLevel
      }
    };
  }

  function syncCheckinState(bs, achState, mk, selectedCadence) {
    let changed = false;
    ensureCheckinBadgeProfiles(bs);
    let activeMode = bs && bs.checkin && bs.checkin.mode === 'weekly' ? 'weekly' : (bs && bs.checkin && bs.checkin.mode === 'monthly' ? 'monthly' : null);
    let desiredMode = selectedCadence === 'weekly' ? 'weekly' : 'monthly';
    let activationMonthKey = String(bs && bs.checkin && bs.checkin.activatedMonthKey || '');
    let isCurrentMonthView = String(mk || '') === calMonthKey();
    let currentMonthRec = getAchievementMonthRecordByKey(achState, mk);
    let monthLocked = !!(currentMonthRec && currentMonthRec.cadence_locked);

    if (isCurrentMonthView && monthLocked) {
      if (clearAllCheckinDrafts(bs, mk)) changed = true;
    }

    if (bs && bs.checkin && isCurrentMonthView && !monthLocked && desiredMode !== activeMode) {
      if (bs.checkin.active && activeMode) saveCheckinDraftForMode(bs, activeMode, mk);
      let restored = restoreCheckinTargetForMode(bs, desiredMode, mk);
      if (!restored) clearActiveCheckinTarget(bs);
      syncActiveCheckinMirror(bs);
      activeMode = bs && bs.checkin && bs.checkin.mode === 'weekly' ? 'weekly' : (bs && bs.checkin && bs.checkin.mode === 'monthly' ? 'monthly' : null);
      activationMonthKey = String(bs && bs.checkin && bs.checkin.activatedMonthKey || '');
      changed = true;
    }

    if (Number(bs.checkin.bestWeeklyLevel || 0) >= 1) {
      let weeklyCount = getCheckinThresholds('weekly')[Math.max(0, Number(bs.checkin.bestWeeklyLevel || 0) - 1)] || 0;
      if (upsertCheckinCompletedEntry(bs, 'weekly', Number(bs.checkin.bestWeeklyLevel || 0), weeklyCount, mk)) changed = true;
    }
    if (Number(bs.checkin.bestMonthlyLevel || 0) >= 1) {
      let monthlyCount = getCheckinThresholds('monthly')[Math.max(0, Number(bs.checkin.bestMonthlyLevel || 0) - 1)] || 0;
      if (upsertCheckinCompletedEntry(bs, 'monthly', Number(bs.checkin.bestMonthlyLevel || 0), monthlyCount, mk)) changed = true;
    }

    if (!bs.checkin.active) return { changed: changed, metrics: null, status: null };
    if (!activeMode) {
      clearActiveCheckinTarget(bs);
      return { changed: true, metrics: null, status: null };
    }

    activationMonthKey = String(bs.checkin.activatedMonthKey || activationMonthKey || '');
    if (!isTargetVisibleFromActivationMonth(activationMonthKey, mk)) {
      return { changed: changed, metrics: null, status: null };
    }

    let metrics = getCheckinMetricsFromActivationMonth(achState, activeMode, mk, activationMonthKey || mk);
    let progressCount = Math.max(0, Number(metrics.currentCount || 0));
    let earnedLevel = getCheckinLevelFromCount(activeMode, progressCount);
    let thresholds = getCheckinThresholds(activeMode);
    let displayLevel = Math.min(Math.max(earnedLevel + 1, 1), thresholds.length);
    let nextTarget = earnedLevel >= thresholds.length ? thresholds[thresholds.length - 1] : thresholds[displayLevel - 1];

    if (activeMode === 'weekly' && earnedLevel > Number(bs.checkin.bestWeeklyLevel || 0)) {
      bs.checkin.bestWeeklyLevel = earnedLevel;
      if (upsertCheckinCompletedEntry(bs, 'weekly', earnedLevel, progressCount, mk)) changed = true;
      changed = true;
    }
    if (activeMode === 'monthly' && earnedLevel > Number(bs.checkin.bestMonthlyLevel || 0)) {
      bs.checkin.bestMonthlyLevel = earnedLevel;
      if (upsertCheckinCompletedEntry(bs, 'monthly', earnedLevel, progressCount, mk)) changed = true;
      changed = true;
    }

    return {
      changed: changed,
      metrics: metrics,
      status: {
        id: 'checkin_streak_active',
        series: 'checkin_streak',
        name: 'Check-In Streak',
        icon: activeMode === 'weekly' ? '📅' : '🗓️',
        mode: activeMode,
        level: displayLevel,
        earnedLevel: earnedLevel,
        totalLevels: getBudgetMasterTotalLabel(),
        target: nextTarget,
        progress: nextTarget > 0 ? Math.max(0, Math.min(progressCount / nextTarget, 1)) : 0,
        progressCount: progressCount,
        meta: 'Current Status: ' + progressCount + '/' + nextTarget,
        detail: (activeMode === 'weekly' ? 'Weekly' : 'Monthly') + ' mode · Badge ' + displayLevel + '/' + thresholds.length
      }
    };
  }

  function syncBadgeState(month, achievementsState, mk, selectedCadence) {
    let bs = loadBadgeState();
    let saverPayload = computeSaverStatus(bs, month, mk);
    let changed = false;

    if (validateCompletedSaverState(bs, saverPayload.live)) {
      changed = true;
      saverPayload = computeSaverStatus(bs, month, mk);
    }

    if (saverPayload.status && saverPayload.status.completed) {
      bs.completedLog = (bs.completedLog || []).filter(function(entry) {
        return !(entry && entry.series === 'the_saver' && Number(entry.level || 0) >= Number(saverPayload.status.level || 0));
      });
      bs.completedLog.push({
        id: saverPayload.status.id,
        series: 'the_saver',
        title: 'The Saver',
        icon: saverPayload.status.icon,
        level: saverPayload.status.level,
        target: saverPayload.status.target,
        completedAt: new Date().toISOString(),
        monthKey: mk || calMonthKey(),
        monthLabel: badgeMonthLabel(month, mk || calMonthKey()),
        activatedMonthLabel: bs.saver.activatedMonthLabel || '',
        metricLabel: 'Badge ' + saverPayload.status.level + '/' + saverPayload.status.totalLevels + ' · ' + fmtC(saverPayload.status.target)
      });
      bs.saver.unlockedBadge = Math.min(saverPayload.status.level + 1, SAVER_LEVELS.length + 1);
      bs.saver.activeBadge = null;
      bs.saver.activationBaseline = null;
      bs.saver.activatedAt = null;
      bs.saver.activatedMonthKey = null;
      bs.saver.activatedMonthLabel = null;
      if (!bs.saver.hidden && bs.saver.unlockedBadge <= SAVER_LEVELS.length) {
        bs.saver.activeBadge = bs.saver.unlockedBadge;
        bs.saver.activationBaseline = Math.max(0, Number(bs.saver.seriesBaseline || 0));
        bs.saver.activatedAt = new Date().toISOString();
        bs.saver.activatedMonthKey = mk || calMonthKey();
        bs.saver.activatedMonthLabel = badgeMonthLabel(month, mk || calMonthKey());
      }
      changed = true;
      saverPayload = computeSaverStatus(bs, month, mk);
    }

    let checkinPayload = syncCheckinState(bs, achievementsState, mk, selectedCadence);
    if (checkinPayload.changed) changed = true;

    let budgetMasterPayload = syncBudgetMasterState(bs, mk);
    if (budgetMasterPayload.changed) changed = true;

    let customPayload = syncCustomTargetsState(bs, month, mk);
    if (customPayload.changed) changed = true;

    if (changed) saveBadgeState(bs);

    return {
      state: bs,
      saverStatus: saverPayload.status,
      checkinStatus: checkinPayload.status,
      budgetMasterStatus: budgetMasterPayload.status,
      customStatuses: customPayload.statuses || []
    };
  }

  function renderTargetTile(status, kind) {
    let pct = Math.round(Math.max(0, Math.min(Number(status.progress || 0), 1)) * 100);
    let deleteMap = { saver: 'saver', checkin: 'checkin', budget_master: 'budget_master' };
    let deleteAttr = '';
    if (kind === 'custom_target') deleteAttr = 'data-delete-custom-target="' + badgeEsc(status.deleteId || status.id || '') + '"';
    else deleteAttr = 'data-delete-active-badge="' + badgeEsc(deleteMap[kind] || 'checkin') + '"';
    let subtitle = kind === 'saver'
      ? 'Badge ' + badgeEsc(status.level) + '/' + badgeEsc(status.totalLevels) + ' · ' + badgeEsc(badgeFmtC(status.target))
      : badgeEsc(status.detail || ((status.mode === 'weekly' ? 'Weekly' : 'Monthly') + ' mode'));
    let meta = kind === 'saver'
      ? 'Current Status: ' + badgeFmtC(status.effectiveValue) + '/' + badgeFmtC(status.target)
      : String(status.meta || '');
    if (status.supportLine) meta += (meta ? ' · ' : '') + String(status.supportLine || '');
    return '<div class="badge-tile ui-3d-panel ui-3d-ach-badge badge-tile-seq badge-active-now">'
      + '<div class="badge-target-card-controls">'
      + '<div class="badge-status-chip">Active now</div>'
      + '<button class="badge-delete-btn" type="button" title="' + badgeEsc(kind === 'custom_target' ? 'Delete custom target' : 'Remove active target') + '" ' + deleteAttr + '>&#x2715;</button>'
      + '</div>'
      + '<div class="badge-icon-wrap">' + badgeEsc(status.icon) + '</div>'
      + '<div class="badge-name">' + badgeEsc(status.name) + '</div>'
      + '<div class="badge-seq-desc">' + subtitle + '</div>'
      + '<div class="badge-prog-wrap"><div class="badge-prog-fill" style="width:' + pct + '%"></div></div>'
      + '<div class="badge-meta-label">' + badgeEsc(meta) + (status.footerLine ? '<br>' + badgeEsc(status.footerLine) : '') + '</div>'
      + '</div>';
  }

  function renderOpenSaverSlot(bs) {
    let unlockedBadge = Number(bs && bs.saver && bs.saver.unlockedBadge || 1);
    if (unlockedBadge > SAVER_LEVELS.length) {
      return '<div class="badge-tile ui-3d-panel ui-3d-ach-badge badge-empty-slot"><div class="badge-empty-icon">✓</div><div class="badge-name">Saver complete</div><div class="badge-meta-label">All 10 Saver badges are completed.</div></div>';
    }
    let def = getSaverBadgeDef(bs.saver.unlockedBadge);
    return '<div class="badge-tile ui-3d-panel ui-3d-ach-badge badge-empty-slot"><div class="badge-empty-icon">+</div><div class="badge-name">Open Slot</div><div class="badge-meta-label">Customize to activate The Saver · badge ' + badgeEsc(def.level) + '/' + badgeEsc(def.totalLevels) + '.</div></div>';
  }

  function renderOpenCheckinSlot(selectedCadence) {
    let mode = selectedCadence === 'weekly' ? 'weekly' : 'monthly';
    return '<div class="badge-tile ui-3d-panel ui-3d-ach-badge badge-empty-slot"><div class="badge-empty-icon">+</div><div class="badge-name">Open Slot</div><div class="badge-meta-label">Customize to activate Check-In Streak · ' + badgeEsc(mode === 'weekly' ? 'Weekly' : 'Monthly') + ' mode.</div></div>';
  }

  function renderOpenBudgetMasterSlot(bs) {
    let bestLevel = Math.max(0, Number(bs && bs.budgetMaster && bs.budgetMaster.bestLevel || 0));
    let nextLevel = bestLevel + 1;
    let def = getBudgetMasterTargetDef(nextLevel);
    return '<div class="badge-tile ui-3d-panel ui-3d-ach-badge badge-empty-slot"><div class="badge-empty-icon">+</div><div class="badge-name">Open Slot</div><div class="badge-meta-label">Customize to activate Budget Master · badge ' + badgeEsc(def.level) + '.</div></div>';
  }

  function renderEmptyCustomSlots(count) {
    let html = '';
    for (let i = 0; i < count; i++) {
      html += '<div class="badge-tile ui-3d-panel ui-3d-ach-badge badge-empty-slot badge-empty-slot-custom"><div class="badge-empty-icon">+</div><div class="badge-name">Open custom slot</div><div class="badge-meta-label">Build your own monthly target series.</div></div>';
    }
    return html;
  }

  function compareAchievementsMonthKeys(a, b) {
    let aa = /^\d{4}-\d{2}$/.test(String(a || '')) ? String(a) : '';
    let bb = /^\d{4}-\d{2}$/.test(String(b || '')) ? String(b) : '';
    if (!aa || !bb) return 0;
    if (aa === bb) return 0;
    return aa > bb ? 1 : -1;
  }

  function isFutureAchievementsMonth(mk) {
    let viewedKey = /^\d{4}-\d{2}$/.test(String(mk || '')) ? String(mk) : '';
    let currentKey = calMonthKey();
    return !!viewedKey && compareAchievementsMonthKeys(viewedKey, currentKey) > 0;
  }

  function renderPendingBadgeSystem(selectedCadence, mk) {
    let bs = loadBadgeState();
    let cadenceLabel = selectedCadence === 'weekly' ? 'Weekly' : 'Monthly';
    let html = '<div class="badge-system-stack"><div class="badge-system-pending"><div class="achievements-section" id="achBadgeSection"><div class="achievements-section-head"><div><h4>Targets</h4></div><div class="badge-actions-row"><button class="feature-action-btn is-primary" type="button" disabled>Create Target</button><button class="feature-action-btn" type="button" disabled>Customize</button></div></div>'
      + '<div class="badge-pending-note">Pending — previous month still active. Targets for ' + badgeEsc(monthLabelFromKey(mk)) + ' will unlock once this becomes the current month. Planned cadence: ' + badgeEsc(cadenceLabel) + '.</div>'
      + '<div class="badge-grid badge-grid-seq">'
      + renderOpenSaverSlot(bs)
      + renderOpenCheckinSlot(selectedCadence)
      + renderOpenBudgetMasterSlot(bs)
      + renderCustomTargetEmptySlots(bs)
      + '</div></div></div>'
      + renderCompletedBadgesCard(bs, mk)
      + '</div>';
    return html;
  }

  function getCompletedBadgeEntriesUpToMonth(bs, mk) {
    return (bs.completedLog || []).filter(function(entry) {
      return entry && compareAchievementsMonthKeys(entry.monthKey, mk) <= 0;
    }).slice().sort(function(a, b) {
      let ak = String(a.monthKey || '');
      let bk = String(b.monthKey || '');
      if (ak === bk) {
        let at = String(a.completedAt || '');
        let bt = String(b.completedAt || '');
        if (at !== bt) return at < bt ? 1 : -1;
        return String(a.series || '').localeCompare(String(b.series || ''));
      }
      return ak < bk ? 1 : -1;
    });
  }

  function formatCompletedBadgeEntry(entry, opts) {
    opts = opts || {};
    let dateLabel = '';
    try { dateLabel = new Date(entry.completedAt).toLocaleDateString('en-BE', { day: 'numeric', month: 'short' }); } catch(e) {}
    let title = '';
    let subtitle = '';

    if (entry.series === 'the_saver') {
      title = 'The Saver · Badge ' + badgeEsc(entry.level) + '/' + SAVER_LEVELS.length;
      subtitle = opts.compact
        ? 'Completed target: ' + badgeEsc(fmtC(entry.target || SAVER_LEVELS[Math.max(0, Number(entry.level || 1) - 1)] || 0))
        : 'Completed with ' + badgeEsc(fmtC(entry.target || SAVER_LEVELS[Math.max(0, Number(entry.level || 1) - 1)] || 0))
          + (entry.activatedMonthLabel ? ' · started ' + badgeEsc(entry.activatedMonthLabel) : '')
          + (entry.monthLabel ? ' · finished ' + badgeEsc(entry.monthLabel) : '');
    } else if (entry.series === 'budget_master') {
      title = 'Budget Master · Badge ' + badgeEsc(entry.level);
      subtitle = 'Best streak: ' + badgeEsc(String(entry.count || getBudgetMasterThresholdForLevel(entry.level))) + ' months within budget';
      if (!opts.compact && entry.monthLabel) subtitle += ' · updated ' + badgeEsc(entry.monthLabel);
    } else {
      let modeLabel = entry.mode === 'weekly' ? 'Weekly' : 'Monthly';
      title = 'Check-In Streak · ' + badgeEsc(modeLabel) + ' · Badge ' + badgeEsc(entry.level) + '/' + getCheckinThresholds(entry.mode).length;
      subtitle = 'Best streak: ' + badgeEsc(String(entry.count || getCheckinThresholds(entry.mode)[entry.level - 1] || 0)) + ' check-ins';
      if (!opts.compact && entry.monthLabel) subtitle += ' · updated ' + badgeEsc(entry.monthLabel);
    }
    if (!opts.compact && dateLabel) subtitle += ' · ' + badgeEsc(dateLabel);
    return {
      title: title,
      subtitle: subtitle,
      icon: badgeEsc(entry.icon || '🏆')
    };
  }

  function getCompletedBadgeHighlights(entries) {
    let saverBest = null;
    let budgetBest = null;
    let checkinBest = { weekly: null, monthly: null };

    entries.forEach(function(entry) {
      if (!entry) return;
      if (entry.series === 'the_saver') {
        if (!saverBest || Number(entry.level || 0) > Number(saverBest.level || 0) || (Number(entry.level || 0) === Number(saverBest.level || 0) && String(entry.completedAt || '') > String(saverBest.completedAt || ''))) {
          saverBest = entry;
        }
        return;
      }
      if (entry.series === 'budget_master') {
        let budgetPrev = budgetBest;
        let budgetPrevCount = budgetPrev ? Number(budgetPrev.count || 0) : -1;
        let budgetNextCount = Number(entry.count || 0);
        if (!budgetPrev || budgetNextCount > budgetPrevCount || (budgetNextCount === budgetPrevCount && Number(entry.level || 0) > Number(budgetPrev.level || 0)) || (budgetNextCount === budgetPrevCount && Number(entry.level || 0) === Number(budgetPrev.level || 0) && String(entry.completedAt || '') > String(budgetPrev.completedAt || ''))) {
          budgetBest = entry;
        }
        return;
      }
      if (entry.series === 'checkin_streak') {
        let mode = entry.mode === 'weekly' ? 'weekly' : 'monthly';
        let prev = checkinBest[mode];
        let prevCount = prev ? Number(prev.count || 0) : -1;
        let nextCount = Number(entry.count || 0);
        if (!prev || nextCount > prevCount || (nextCount === prevCount && Number(entry.level || 0) > Number(prev.level || 0)) || (nextCount === prevCount && Number(entry.level || 0) === Number(prev.level || 0) && String(entry.completedAt || '') > String(prev.completedAt || ''))) {
          checkinBest[mode] = entry;
        }
      }
    });

    let customBest = {};
    entries.forEach(function(entry) {
      if (!(entry && entry.series === 'custom_target')) return;
      let prev = customBest[entry.targetId];
      if (!prev || Number(entry.level || 0) > Number(prev.level || 0) || (Number(entry.level || 0) === Number(prev.level || 0) && String(entry.completedAt || '') > String(prev.completedAt || ''))) {
        customBest[entry.targetId] = entry;
      }
    });

    let out = [];
    if (checkinBest.weekly) out.push({ entry: checkinBest.weekly, highlight: true });
    if (checkinBest.monthly) out.push({ entry: checkinBest.monthly, highlight: true });
    if (budgetBest) out.push({ entry: budgetBest, highlight: true });
    if (saverBest) out.push({ entry: saverBest, highlight: false });
    Object.keys(customBest).map(function(key) { return customBest[key]; }).sort(function(a, b) {
      return String(b.completedAt || '').localeCompare(String(a.completedAt || ''));
    }).slice(0, 2).forEach(function(entry) {
      out.push({ entry: entry, highlight: false });
    });
    return out;
  }

  function renderCompletedBadgeRow(entry, opts) {
    let formatted = formatCompletedBadgeEntry(entry, opts);
    opts = opts || {};
    return '<div class="completed-badge-row' + (opts.highlight ? ' is-highlight' : '') + '">'
      + '<div class="completed-badge-icon">' + formatted.icon + '</div>'
      + '<div class="completed-badge-copy"><div class="completed-badge-title">' + formatted.title + '</div><div class="completed-badge-sub">' + formatted.subtitle + '</div></div>'
      + '</div>';
  }

  function getCompletedBadgeGalleryEntries(bs, mk) {
    let monthKey = String(mk || '');
    let out = [];
    let seen = {};
    function push(entry) {
      if (!entry) return;
      let id = String(entry.id || (entry.series + '_' + (entry.mode || '') + '_' + (entry.level || '')));
      if (seen[id]) return;
      seen[id] = true;
      out.push(entry);
    }

    getCompletedSaverLevels(bs).forEach(function(entry) {
      if (!entry || compareAchievementsMonthKeys(String(entry.monthKey || ''), monthKey) > 0) return;
      push(entry);
    });

    ['weekly','monthly'].forEach(function(mode) {
      let bestLevel = Number(bs && bs.checkin && (mode === 'weekly' ? bs.checkin.bestWeeklyLevel : bs.checkin.bestMonthlyLevel) || 0);
      if (bestLevel < 1) return;
      let stored = getCheckinStoredEntry(bs, mode) || {};
      for (let level = 1; level <= bestLevel; level++) {
        push({
          id: 'checkin_streak_' + mode + '_badge_' + level,
          series: 'checkin_streak',
          title: 'Check-In Streak',
          icon: level === bestLevel && stored.icon ? stored.icon : (mode === 'weekly' ? '📅' : '🗓️'),
          mode: mode,
          level: level,
          count: getCheckinThresholds(mode)[level - 1] || 0,
          completedAt: stored.completedAt || '',
          monthKey: stored.monthKey || monthKey,
          monthLabel: stored.monthLabel || monthLabelFromKey(monthKey)
        });
      }
    });

    let budgetBestLevel = Number(bs && bs.budgetMaster && bs.budgetMaster.bestLevel || 0);
    if (budgetBestLevel >= 1) {
      let budgetStored = getBudgetMasterStoredEntry(bs) || {};
      for (let budgetLevel = 1; budgetLevel <= budgetBestLevel; budgetLevel++) {
        push({
          id: 'budget_master_badge_' + budgetLevel,
          series: 'budget_master',
          title: 'Budget Master',
          icon: '🎯',
          level: budgetLevel,
          count: getBudgetMasterThresholdForLevel(budgetLevel),
          completedAt: budgetStored.completedAt || '',
          monthKey: budgetStored.monthKey || monthKey,
          monthLabel: budgetStored.monthLabel || monthLabelFromKey(monthKey)
        });
      }
    }

    return out.sort(function(a, b) {
      let aw = a.series === 'checkin_streak' ? 0 : 1;
      let bw = b.series === 'checkin_streak' ? 0 : 1;
      if (aw !== bw) return aw - bw;
      if (a.series === 'checkin_streak' && b.series === 'checkin_streak') {
        if (a.mode !== b.mode) return a.mode === 'weekly' ? -1 : 1;
        return Number(a.level || 0) - Number(b.level || 0);
      }
      if (a.series === 'budget_master' && b.series !== 'budget_master') return 1;
      if (a.series !== 'budget_master' && b.series === 'budget_master') return -1;
      return Number(a.level || 0) - Number(b.level || 0);
    });
  }

  function renderCompletedBadgeModalTile(entry) {
    let formatted = formatCompletedBadgeEntry(entry, { compact: true });
    return '<div class="completed-badge-modal-tile">'
      + '<div class="completed-badge-modal-tile-icon">' + formatted.icon + '</div>'
      + '<div><div class="completed-badge-modal-tile-title">' + formatted.title + '</div><div class="completed-badge-modal-tile-sub">' + formatted.subtitle + '</div></div>'
      + '</div>';
  }

  function renderCompletedBadgesCard(bs, mk) {
    let entries = getCompletedBadgeEntriesUpToMonth(bs, mk);
    let html = '<div class="achievements-section completed-badges-section">'
      + '<div class="achievements-section-head"><h4>Completed Badges</h4><button class="completed-badges-all-btn" id="completedBadgesAllBtn" type="button">All Completed Badges</button></div>';

    if (!entries.length) {
      html += '<div class="completed-badges-empty">Complete an active target to log a validated badge here.</div></div>';
      return html;
    }

    let highlights = getCompletedBadgeHighlights(entries);
    html += '<div class="completed-badge-list">';
    highlights.forEach(function(item) {
      html += renderCompletedBadgeRow(item.entry, { highlight: !!item.highlight, compact: true });
    });
    html += '</div></div>';
    return html;
  }

  function renderCompletedBadgesModal(bs, mk) {
    let entries = getCompletedBadgeGalleryEntries(bs, mk);
    let tooltipHtml = '<ul class="info-tooltip-list"><li>The main card keeps the view compact by showing your strongest current highlights.</li><li>This full history keeps every earned badge visible.</li></ul>';
    let infoBtn = buildInlineInfoHtml('completedBadgesModalInfo', tooltipHtml, 'About completed badges view');
    let html = '<div class="cbm-modal completed-badges-modal">'
      + '<div class="cbm-header"><div class="completed-badges-modal-head"><div class="completed-badges-modal-title-row"><div class="cbm-title">All Completed Badges</div>' + infoBtn + '</div></div><button class="cbm-close-btn" type="button" data-completed-badges-close="1">&#x2715;</button></div>'
      + '<div class="badge-config-body">';

    if (!entries.length) {
      html += '<div class="completed-badge-modal-empty">No completed badges yet.</div>';
    } else {
      html += '<div class="completed-badge-modal-grid">';
      entries.forEach(function(entry) {
        html += renderCompletedBadgeModalTile(entry);
      });
      html += '</div>';
    }

    html += '</div><div class="cbm-footer"><button class="cbm-btn-primary" type="button" data-completed-badges-close="1">Close</button></div></div>';
    return html;
  }

  function renderBadgeSystem(month, achievementsState, mk, selectedCadence) {

    if (isFutureAchievementsMonth(mk)) return renderPendingBadgeSystem(selectedCadence, mk);
    let payload = syncBadgeState(month, achievementsState, mk, selectedCadence);
    let bs = payload.state;
    let saverActivationMonthKey = bs && bs.saver ? String(bs.saver.activatedMonthKey || '') : '';
    let checkinActivationMonthKey = bs && bs.checkin ? String(bs.checkin.activatedMonthKey || '') : '';
    let budgetMasterActivationMonthKey = bs && bs.budgetMaster ? String(bs.budgetMaster.activatedMonthKey || '') : '';
    let showSaverTarget = !!payload.saverStatus && isTargetVisibleFromActivationMonth(saverActivationMonthKey, mk);
    let showCheckinTarget = !!payload.checkinStatus && isTargetVisibleFromActivationMonth(checkinActivationMonthKey, mk);
    let showBudgetMasterTarget = !!payload.budgetMasterStatus && isTargetVisibleFromActivationMonth(budgetMasterActivationMonthKey, mk);

    let html = '<div class="badge-system-stack"><div class="achievements-section ui-3d-panel ui-3d-ach-section ui-3d-ach-targets" id="achBadgeSection"><div class="achievements-section-head"><div><h4>Targets</h4></div><div class="badge-actions-row"><button class="feature-action-btn is-primary" id="badgeCreateCustomBtn" type="button">Create Target</button><button class="feature-action-btn" id="badgeCustomizeBtn" type="button">Customize</button></div></div><div class="badge-grid badge-grid-seq">';

    html += showSaverTarget ? renderTargetTile(payload.saverStatus, 'saver') : renderOpenSaverSlot(bs);
    html += showCheckinTarget ? renderTargetTile(payload.checkinStatus, 'checkin') : renderOpenCheckinSlot(selectedCadence);
    html += showBudgetMasterTarget ? renderTargetTile(payload.budgetMasterStatus, 'budget_master') : renderOpenBudgetMasterSlot(bs);
    (payload.customStatuses || []).forEach(function(status) {
      html += renderTargetTile(status, 'custom_target');
    });
    html += renderCustomTargetEmptySlots(bs);
    html += '</div></div>';
    html += renderCompletedBadgesCard(bs, mk);
    html += '</div>';
    return html;
  }

  function renderBadgeCustomizationModal(selectedCadence) {
    let bs = loadBadgeState();
    let unlockedBadge = Number(bs.saver.unlockedBadge || 1);
    let completedAll = unlockedBadge > SAVER_LEVELS.length;
    let draft = badgeCustomizationDraft || {};
    let saverSelected = draft.hasOwnProperty('saverBadge') ? Number(draft.saverBadge || 0) === unlockedBadge : (!bs.saver.hidden && unlockedBadge <= SAVER_LEVELS.length);
    let checkinSelected = !!draft.checkinActive;
    let budgetMasterSelected = !!draft.budgetMasterActive;
    let budgetMasterBestLevel = Math.max(0, Number(bs.budgetMaster.bestLevel || 0));
    let budgetMasterNextLevel = Math.max(budgetMasterBestLevel + 1, 1);
    let mode = selectedCadence === 'weekly' ? 'weekly' : 'monthly';

    let html = '<div class="cbm-modal badge-customize-modal">'
      + '<div class="cbm-header"><div><div class="cbm-title">Customize Targets</div><div class="cbm-sub">Preset targets auto-fill their slot when available. Use this panel to hide or restore them, and manage your custom targets.</div></div><button class="cbm-close-btn" type="button" data-badge-close="1">&#x2715;</button></div>'
      + '<div class="badge-config-body">'
      + '<div class="badge-config-list">';

    if (completedAll) {
      html += '<div class="badge-config-item is-disabled"><div class="badge-config-main"><div class="badge-config-top"><span class="badge-config-icon">💰</span><span class="badge-config-name">The Saver</span><span class="badge-config-order">Complete</span></div><div class="badge-config-desc">All Saver badges are already completed.</div></div></div>';
    } else {
      let saverDef = getSaverBadgeDef(bs.saver.unlockedBadge);
      html += '<label class="badge-config-item' + (saverSelected ? ' is-selected' : '') + '">'
        + '<input type="checkbox" class="badge-config-check" data-badge-saver-level="' + saverDef.level + '" ' + (saverSelected ? 'checked' : '') + ' />'
        + '<div class="badge-config-main"><div class="badge-config-top"><span class="badge-config-icon">' + badgeEsc(saverDef.icon) + '</span><span class="badge-config-name">The Saver</span><span class="badge-config-order">Badge ' + saverDef.level + '/' + saverDef.totalLevels + '</span></div><div class="badge-config-desc">This target auto-fills when the next Saver badge is available. Uncheck to hide it from Targets or re-check to restore it.</div></div></label>';
    }

    html += '<label class="badge-config-item' + (checkinSelected ? ' is-selected' : '') + '">'
      + '<input type="checkbox" class="badge-config-check" data-badge-checkin-active="1" ' + (checkinSelected ? 'checked' : '') + ' />'
      + '<div class="badge-config-main"><div class="badge-config-top"><span class="badge-config-icon">' + badgeEsc(mode === 'weekly' ? '📅' : '🗓️') + '</span><span class="badge-config-name">Check-In Streak</span><span class="badge-config-order">' + badgeEsc(mode === 'weekly' ? 'Weekly' : 'Monthly') + '</span></div><div class="badge-config-desc">This target auto-fills for the active cadence. Uncheck to hide it from Targets or re-check to restore it in the current month.</div></div></label>'
      + '<label class="badge-config-item' + (budgetMasterSelected ? ' is-selected' : '') + '">'
      + '<input type="checkbox" class="badge-config-check" data-badge-budget-master-active="1" ' + (budgetMasterSelected ? 'checked' : '') + ' />'
      + '<div class="badge-config-main"><div class="badge-config-top"><span class="badge-config-icon">🎯</span><span class="badge-config-name">Budget Master</span><span class="badge-config-order">Badge ' + badgeEsc(String(budgetMasterNextLevel)) + '</span></div><div class="badge-config-desc">Tracks closed months where every budget allocation is respected. Uncheck to hide it from Targets or re-check to restore it from the current month onward.</div></div></label>';

    html += '</div>' + renderCustomTargetConfigItems(bs, draft) + '<div class="cbm-error" id="badgeConfigError"></div></div><div class="cbm-footer"><button class="cbm-btn-ghost" type="button" data-badge-close="1">Cancel</button><button class="cbm-btn-primary" type="button" id="badgeSaveConfigBtn">Update Targets</button></div></div>';
    return html;
  }

  function ensureBadgeCustomizationOverlay(selectedCadence) {
    let existing = document.getElementById('badgeCustomizationOverlay');
    if (existing) {
      existing.innerHTML = renderBadgeCustomizationModal(selectedCadence);
      return;
    }
    let overlay = document.createElement('div');
    overlay.id = 'badgeCustomizationOverlay';
    overlay.className = 'cbm-overlay';
    overlay.innerHTML = renderBadgeCustomizationModal(selectedCadence);
    document.body.appendChild(overlay);
  }

  function openBadgeCustomization(selectedCadence) {
    let bs = loadBadgeState();
    let mode = selectedCadence === 'weekly' ? 'weekly' : 'monthly';
    let currentMonthKey = calMonthKey();
    let isActiveMode = !!(bs && bs.checkin && bs.checkin.active && bs.checkin.mode === mode);
    let hasDraft = hasCurrentMonthCheckinDraft(bs, mode, currentMonthKey);
    badgeCustomizationDraft = {
      saverBadge: Number(bs.saver.activeBadge || 0) || null,
      checkinActive: !!(isActiveMode || hasDraft),
      budgetMasterActive: !!(!bs.budgetMaster.hidden && bs.budgetMaster.activatedMonthKey),
      customTargetHiddenMap: Object.fromEntries((Array.isArray(bs.customTargets) ? bs.customTargets : []).map(function(target) {
        let normalized = normalizeCustomTargetRecord(target);
        return [String(normalized.id || ''), !!normalized.hidden];
      })),
      deletedCustomTargetIds: {}
    };
    ensureBadgeCustomizationOverlay(selectedCadence);
    let overlay = document.getElementById('badgeCustomizationOverlay');
    if (overlay) overlay.classList.add('cbm-open');
    wireBadgeSystemEvents(selectedCadence, currentMonthKey);
  }

  function closeBadgeCustomization() {
    badgeCustomizationDraft = null;
    let overlay = document.getElementById('badgeCustomizationOverlay');
    if (overlay) overlay.classList.remove('cbm-open');
  }

  function saveBadgeCustomizationSelection(selectedCadence) {
    let overlay = document.getElementById('badgeCustomizationOverlay');
    if (!overlay) return;
    let bs = loadBadgeState();
    let currentMonth = null;
    try { if (typeof getCurrentMonth === 'function') currentMonth = getCurrentMonth(); } catch(e) {}

    let currentMonthKey = currentMonth && currentMonth.name ? monthKeyFromMonthObj(currentMonth) : calMonthKey();
    let startOfMonthSavings = cumulativeSavingsBeforeMonth(currentMonthKey);
    let draft = badgeCustomizationDraft || {};
    let unlockedBadge = Number(bs.saver.unlockedBadge || 1);

    if (Number(draft.saverBadge || 0) === unlockedBadge && unlockedBadge <= SAVER_LEVELS.length) {
      bs.saver.hidden = false;
      if (Number(unlockedBadge || 0) === 1 || bs.saver.seriesBaseline == null) bs.saver.seriesBaseline = Math.max(0, startOfMonthSavings);
      bs.saver.activeBadge = bs.saver.unlockedBadge;
      bs.saver.activationBaseline = Math.max(0, Number(bs.saver.seriesBaseline || 0));
      bs.saver.activatedAt = new Date().toISOString();
      bs.saver.activatedMonthKey = currentMonthKey;
      bs.saver.activatedMonthLabel = badgeMonthLabel(currentMonth, currentMonthKey);
    } else {
      bs.saver.hidden = true;
      bs.saver.activeBadge = null;
      bs.saver.activationBaseline = null;
      bs.saver.activatedAt = null;
      bs.saver.activatedMonthKey = null;
      bs.saver.activatedMonthLabel = null;
      if (!getCompletedSaverLevels(bs).length) bs.saver.seriesBaseline = null;
    }

    let selectedMode = selectedCadence === 'weekly' ? 'weekly' : 'monthly';
    if (draft.checkinActive) {
      activateCheckinTarget(bs, selectedMode, currentMonthKey);
      syncActiveCheckinMirror(bs);
    } else {
      disableCheckinTargetForMode(bs, selectedMode);
      if (bs.checkin.mode === selectedMode) clearActiveCheckinTarget(bs);
      syncActiveCheckinMirror(bs);
    }

    if (draft.budgetMasterActive) {
      bs.budgetMaster.hidden = false;
      if (!bs.budgetMaster.activatedMonthKey) {
        bs.budgetMaster.activatedAt = new Date().toISOString();
        bs.budgetMaster.activatedMonthKey = currentMonthKey;
        bs.budgetMaster.activatedMonthLabel = badgeMonthLabel(currentMonth, currentMonthKey);
      }
    } else {
      bs.budgetMaster.hidden = true;
      bs.budgetMaster.activatedAt = null;
      bs.budgetMaster.activatedMonthKey = null;
      bs.budgetMaster.activatedMonthLabel = null;
    }

    let hiddenMap = (draft && draft.customTargetHiddenMap && typeof draft.customTargetHiddenMap === 'object') ? draft.customTargetHiddenMap : {};
    let deletedMap = (draft && draft.deletedCustomTargetIds && typeof draft.deletedCustomTargetIds === 'object') ? draft.deletedCustomTargetIds : {};
    bs.customTargets = (Array.isArray(bs.customTargets) ? bs.customTargets : []).filter(function(target) {
      let normalized = normalizeCustomTargetRecord(target);
      return !deletedMap[String(normalized.id || '')];
    }).map(function(target) {
      let normalized = normalizeCustomTargetRecord(target);
      let id = String(normalized.id || '');
      if (Object.prototype.hasOwnProperty.call(hiddenMap, id)) normalized.hidden = !!hiddenMap[id];
      return normalized;
    });

    saveBadgeState(bs);
    closeBadgeCustomization();
    if (window.renderAchievementsTab) window.renderAchievementsTab();
  }

  function deleteActiveBadgeSelection(kind) {
    return runBadgeUndoableMutation(function() {
      let bs = loadBadgeState();
      if (kind === 'saver') {
        bs.saver.hidden = true;
        bs.saver.activeBadge = null;
        bs.saver.activationBaseline = null;
        bs.saver.activatedAt = null;
        bs.saver.activatedMonthKey = null;
        bs.saver.activatedMonthLabel = null;
        if (!getCompletedSaverLevels(bs).length) bs.saver.seriesBaseline = null;
      } else if (kind === 'checkin') {
        let activeMode = bs && bs.checkin && bs.checkin.mode === 'weekly' ? 'weekly' : 'monthly';
        disableCheckinTargetForMode(bs, activeMode);
        syncActiveCheckinMirror(bs);
      } else if (kind === 'budget_master') {
        bs.budgetMaster.hidden = true;
        bs.budgetMaster.activatedAt = null;
        bs.budgetMaster.activatedMonthKey = null;
        bs.budgetMaster.activatedMonthLabel = null;
      } else {
        return false;
      }
      saveBadgeState(bs);
      return true;
    }, function() {
      closeBadgeCustomization();
    });
  }


  function bindCompletedBadgesOverlayEvents(overlay) {
    if (!overlay || overlay.__completedEventsBound) return overlay;
    overlay.__completedEventsBound = true;
    overlay.addEventListener('click', function(event) {
      let closeTarget = event.target.closest('[data-completed-badges-close]');
      if (closeTarget || event.target === overlay) {
        event.preventDefault();
        closeCompletedBadgesModal();
      }
    });
    return overlay;
  }

  function ensureCompletedBadgesOverlay(bs, mk) {
    let existing = document.getElementById('completedBadgesOverlay');
    if (existing) {
      existing.innerHTML = renderCompletedBadgesModal(bs, mk);
      return bindCompletedBadgesOverlayEvents(existing);
    }
    let overlay = document.createElement('div');
    overlay.id = 'completedBadgesOverlay';
    overlay.className = 'cbm-overlay';
    overlay.innerHTML = renderCompletedBadgesModal(bs, mk);
    document.body.appendChild(overlay);
    return bindCompletedBadgesOverlayEvents(overlay);
  }

  function openCompletedBadgesModal(mk) {
    let overlay = ensureCompletedBadgesOverlay(loadBadgeState(), mk);
    overlay.__completedBadgesMonthKey = mk;
    overlay.classList.add('cbm-open');
  }

  function closeCompletedBadgesModal() {
    let overlay = document.getElementById('completedBadgesOverlay');
    if (overlay) overlay.classList.remove('cbm-open');
  }

  function wireBadgeSystemEvents(selectedCadence, monthKey) {
    let effectiveCadence = selectedCadence === 'weekly' ? 'weekly' : 'monthly';
    let openBtn = document.getElementById('badgeCustomizeBtn');
    if (openBtn) openBtn.onclick = function() { openBadgeCustomization(effectiveCadence); };

    let allCompletedBtn = document.getElementById('completedBadgesAllBtn');
    if (allCompletedBtn) allCompletedBtn.onclick = function() { openCompletedBadgesModal(monthKey || calMonthKey()); };

    document.querySelectorAll('#achBadgeSection [data-delete-active-badge]').forEach(function(btn) {
      btn.onclick = function(event) {
        event.preventDefault();
        event.stopPropagation();
        deleteActiveBadgeSelection(btn.getAttribute('data-delete-active-badge'));
      };
    });

    document.querySelectorAll('#achBadgeSection [data-delete-custom-target]').forEach(function(btn) {
      btn.onclick = function(event) {
        event.preventDefault();
        event.stopPropagation();
        let targetId = btn.getAttribute('data-delete-custom-target');
        if (targetId && window.confirm('Delete this custom target? Completed badges already earned will stay in the log.')) {
          deleteCustomTargetById(targetId);
        }
      };
    });

    let createBtn = document.getElementById('badgeCreateCustomBtn');
    if (createBtn) {
      createBtn.onclick = function() {
        openCustomTargetBuilder();
      };
    }

    let overlay = document.getElementById('badgeCustomizationOverlay');
    if (overlay) {
      overlay.__badgeSelectedCadence = effectiveCadence;
      if (!overlay.__badgeEventsBound) {
        overlay.__badgeEventsBound = true;

        overlay.addEventListener('click', function(event) {
          let closeTarget = event.target.closest('[data-badge-close]');
          if (closeTarget) {
            event.preventDefault();
            closeBadgeCustomization();
            return;
          }
          let saveTarget = event.target.closest('#badgeSaveConfigBtn');
          if (saveTarget) {
            event.preventDefault();
            saveBadgeCustomizationSelection(overlay.__badgeSelectedCadence || 'monthly');
          }
          let deleteCustomBtn = event.target.closest('[data-delete-custom-target]');
          if (deleteCustomBtn) {
            event.preventDefault();
            let targetId = deleteCustomBtn.getAttribute('data-delete-custom-target');
            if (targetId && window.confirm('Delete this custom target? Completed badges already earned will stay in the log.')) {
              if (!badgeCustomizationDraft || typeof badgeCustomizationDraft !== 'object') badgeCustomizationDraft = {};
              if (!badgeCustomizationDraft.deletedCustomTargetIds || typeof badgeCustomizationDraft.deletedCustomTargetIds !== 'object') badgeCustomizationDraft.deletedCustomTargetIds = {};
              if (!badgeCustomizationDraft.customTargetHiddenMap || typeof badgeCustomizationDraft.customTargetHiddenMap !== 'object') badgeCustomizationDraft.customTargetHiddenMap = {};
              badgeCustomizationDraft.deletedCustomTargetIds[String(targetId)] = true;
              delete badgeCustomizationDraft.customTargetHiddenMap[String(targetId)];
              overlay.innerHTML = renderBadgeCustomizationModal(overlay.__badgeSelectedCadence || 'monthly');
              overlay.classList.add('cbm-open');
            }
          }
        });

        overlay.addEventListener('change', function(event) {
          let saverBox = event.target.closest('[data-badge-saver-level]');
          if (saverBox) {
            let saverBadge = Number(saverBox.getAttribute('data-badge-saver-level') || 0);
            if (!badgeCustomizationDraft || typeof badgeCustomizationDraft !== 'object') badgeCustomizationDraft = {};
            badgeCustomizationDraft.saverBadge = saverBox.checked ? saverBadge : null;
            overlay.innerHTML = renderBadgeCustomizationModal(overlay.__badgeSelectedCadence || 'monthly');
            overlay.classList.add('cbm-open');
            return;
          }
          let checkinBox = event.target.closest('[data-badge-checkin-active]');
          if (checkinBox) {
            if (!badgeCustomizationDraft || typeof badgeCustomizationDraft !== 'object') badgeCustomizationDraft = {};
            badgeCustomizationDraft.checkinActive = !!checkinBox.checked;
            overlay.innerHTML = renderBadgeCustomizationModal(overlay.__badgeSelectedCadence || 'monthly');
            overlay.classList.add('cbm-open');
            return;
          }
          let budgetMasterBox = event.target.closest('[data-badge-budget-master-active]');
          if (budgetMasterBox) {
            if (!badgeCustomizationDraft || typeof badgeCustomizationDraft !== 'object') badgeCustomizationDraft = {};
            badgeCustomizationDraft.budgetMasterActive = !!budgetMasterBox.checked;
            overlay.innerHTML = renderBadgeCustomizationModal(overlay.__badgeSelectedCadence || 'monthly');
            overlay.classList.add('cbm-open');
            return;
          }
          let customHiddenBox = event.target.closest('[data-custom-target-hidden-toggle]');
          if (customHiddenBox) {
            if (!badgeCustomizationDraft || typeof badgeCustomizationDraft !== 'object') badgeCustomizationDraft = {};
            if (!badgeCustomizationDraft.customTargetHiddenMap || typeof badgeCustomizationDraft.customTargetHiddenMap !== 'object') badgeCustomizationDraft.customTargetHiddenMap = {};
            let targetId = String(customHiddenBox.getAttribute('data-custom-target-hidden-toggle') || '');
            badgeCustomizationDraft.customTargetHiddenMap[targetId] = !customHiddenBox.checked;
            overlay.innerHTML = renderBadgeCustomizationModal(overlay.__badgeSelectedCadence || 'monthly');
            overlay.classList.add('cbm-open');
          }
        });
      }
    }

    let customOverlay = document.getElementById('customTargetBuilderOverlay');
    if (customOverlay && !customOverlay.__customTargetEventsBound) {
      customOverlay.__customTargetEventsBound = true;
      customOverlay.addEventListener('click', function(event) {
        let closeBtn = event.target.closest('[data-custom-target-close]');
        if (closeBtn || event.target === customOverlay) {
          event.preventDefault();
          closeCustomTargetBuilder();
          return;
        }
        let iconBtn = event.target.closest('[data-custom-target-icon]');
        if (iconBtn) {
          event.preventDefault();
          customTargetDraft = cloneCustomTargetDraft(customTargetDraft || buildDefaultCustomTargetDraft());
          customTargetDraft.icon = iconBtn.getAttribute('data-custom-target-icon') || customTargetDraft.icon;
          Array.prototype.forEach.call(customOverlay.querySelectorAll('[data-custom-target-icon]'), function(btn) {
            btn.classList.toggle('cbm-icon-sel', btn === iconBtn);
          });
          updateCustomTargetBuilderDynamicState();
          return;
        }
        let createTargetBtn = event.target.closest('#customTargetCreateBtn');
        if (createTargetBtn) {
          event.preventDefault();
          saveCustomTargetFromDraft();
        }
      });
      customOverlay.addEventListener('input', function(event) {
        let fieldEl = event.target.closest('[data-custom-target-field]');
        if (!fieldEl) return;
        let field = fieldEl.getAttribute('data-custom-target-field');
        syncCustomTargetDraftField(field, fieldEl.value);
        if (field === 'name' || field === 'threshold') {
          updateCustomTargetBuilderDynamicState();
        }
      });
      customOverlay.addEventListener('change', function(event) {
        let fieldEl = event.target.closest('[data-custom-target-field]');
        if (!fieldEl) return;
        let field = fieldEl.getAttribute('data-custom-target-field');
        syncCustomTargetDraftField(field, fieldEl.value);
        if (field === 'type') {
          refreshCustomTargetBuilderModal('#customTargetTypeSelect');
          return;
        }
        updateCustomTargetBuilderDynamicState();
      });
    }
  }
  /* -- Init -------------------------------------------------------------- */
  function initAchievementsModule() {
    let state = loadAchievementsState();
    saveV5State(state); // persist migrated state if needed
    updateAchievementsPill();
    if (window.activeView === 'achievements') window.renderAchievementsTab();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAchievementsModule, { once: true });
  } else {
    initAchievementsModule();
  }

})();
