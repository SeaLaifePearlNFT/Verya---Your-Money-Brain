/* InsightEngine: centralized Smart Insights display models. Phase 6: adaptive signal layer. */
(function(){
  if (window.InsightEngine && window.InsightEngine.__phase6Engine) return;

  function call(fn, fallback){
    try { return (typeof fn === 'function') ? fn() : fallback; } catch(e) { return fallback; }
  }
  function num(value, fallback){
    var n = Number(value);
    return Number.isFinite(n) ? n : (fallback || 0);
  }
  function text(value, fallback){
    var s = String(value == null ? '' : value).replace(/\\s+/g, ' ').trim();
    return s || fallback || '';
  }
  function money(value){
    try { return (typeof currency === 'function') ? currency(num(value)) : ('€' + num(value).toFixed(2)); } catch(e){ return '€' + num(value).toFixed(2); }
  }
  function percent(value){
    var n = num(value);
    return (Number.isFinite(n) ? Math.round(n) : 0) + '%';
  }
  function getModel(month){
    return call(function(){ return forecastWidgetModel(month); }, null);
  }
  function getSubscriptionBurden(month, model){
    return (model && model.subscriptionBurden) || call(function(){ return subscriptionBurdenModel(month); }, null) || {
      unpaidTotal: 0, dueCount: 0, paidCount: 0, plannedTotal: 0, activeCount: 0, state: { tone: 'neutral' }
    };
  }
  function getGuidance(month){
    var model = call(function(){ return topGuidance(month); }, null);
    return (model && typeof model === 'object') ? model : {
      type: 'good',
      title: 'On track',
      priority: '#1 Live issue: Daily pace',
      headline: 'No urgent guidance available yet.',
      driverLabel: 'Live signal',
      driver: 'Guidance will appear once this month has enough budget data.',
      impactLabel: 'Why it matters',
      impact: 'The insight engine is waiting for more usable inputs.',
      actionLabel: 'Best move now',
      action: 'Keep logging spending and reviewing subscriptions.',
      urgencyLabel: 'Confidence',
      urgency: 'Low confidence until more data is available.',
      trackLabel: 'Spending Pace',
      trackCurrent: 0,
      trackTarget: 0,
      trackPct: 0,
      trackTone: 'good',
      trackState: 'Awaiting data'
    };
  }
  function getBehavior(month){
    var rows = call(function(){ return behaviorInsightsForMonth(month); }, []);
    return Array.isArray(rows) ? rows : [];
  }
  function getTrendData(month){
    return call(function(){ return categoryTrendRows(month); }, { rows: [], monthLabels: [] }) || { rows: [], monthLabels: [] };
  }
  function getEvolution(month){
    return call(function(){ return evolutionChartModel(month); }, { labels: [], expenseSeries: [], savingsSeries: [], expenseCurrentTotal: 0, savingsCurrentTotal: 0 }) || { labels: [], expenseSeries: [], savingsSeries: [], expenseCurrentTotal: 0, savingsCurrentTotal: 0 };
  }
  function getCategoryTrendModel(month){
    return call(function(){
      var trendData = categoryTrendRows(month) || { rows: [], monthLabels: [] };
      var rows = Array.isArray(trendData.rows) ? trendData.rows : [];
      var monthLabels = Array.isArray(trendData.monthLabels) ? trendData.monthLabels : [];
      var rankedRows = rows.slice().sort(function(a, b){ return num(b.score) - num(a.score); });
      var orderedRows = orderedTrendRowsForExpenses(month, rows);
      var selectedRows = selectedTrendRows(rows);
      var maxVal = Math.max.apply(null, [1].concat(rows.reduce(function(acc, row){
        return acc.concat(Array.isArray(row.values) ? row.values : []);
      }, [])));
      return {
        rows: rows,
        rankedRows: rankedRows,
        orderedRows: orderedRows,
        selectedRows: selectedRows,
        monthLabels: monthLabels,
        maxVal: maxVal,
        hasPreviousMonth: state && Array.isArray(state.months) && state.months.findIndex(function(m){ return m.name === month.name; }) > 0,
        modalMeta: orderedRows.length
          ? orderedRows.length + ' categories shown in the same order as the Expenses tab.'
          : 'No category trend data yet.'
      };
    }, { rows: [], rankedRows: [], orderedRows: [], selectedRows: [], monthLabels: [], maxVal: 1, hasPreviousMonth: false, modalMeta: 'No category trend data yet.' }) || { rows: [], rankedRows: [], orderedRows: [], selectedRows: [], monthLabels: [], maxVal: 1, hasPreviousMonth: false, modalMeta: 'No category trend data yet.' };
  }
  function getDecision(month){
    return call(function(){ return insightDecisionEngine(month); }, null);
  }
  function getBehaviorIntelligence(month){
    var rows = call(function(){ return intelligenceInsightsForBehaviorCard(month); }, []);
    return Array.isArray(rows) ? rows : [];
  }
  function getMix(month){
    return call(function(){ return budgetMixTrackerModel(month); }, null);
  }
  function getReallocation(month){
    var model = call(function(){ return budgetAdjustmentAdvisor(month); }, null);
    if (model && typeof model === 'object' && !Array.isArray(model)) return model;
    return {
      state: { className: 'state-stable', label: 'Stable', tone: 'neutral' },
      tone: 'neutral',
      badge: 'Stable',
      headline: 'Adjustment opportunities',
      detail: 'No adjustment model is available yet.',
      impact: '',
      items: []
    };
  }
  function getSpecialFunding(month, model){
    return (model && model.specialFunding) || call(function(){ return specialFundingInsightModel(month); }, null);
  }
  function getForecastCard(month, model, forecast, burn, subscriptions, specialFunding, reallocation){
    return call(function(){
      model = model || forecastWidgetModel(month) || {};
      forecast = forecast || model.forecast || {};
      burn = burn || model.burn || {};
      subscriptions = subscriptions || getSubscriptionBurden(month, model);
      specialFunding = specialFunding || getSpecialFunding(month, model) || {};
      var monthClosed = isClosedMonth(month);
      var forecastLockDay = Number(month.forecastLockDay || 5);
      var forecastLockDateText = forecastLockDateLabel(month, forecastLockDay);
      var lockedForecast = ensureLockedForecastSnapshot(month, forecast);
      var forecastLocked = Boolean(lockedForecast);
      var forecastLockIsLegacy = forecastLocked && String((lockedForecast && lockedForecast.trustLevel) || '') === 'legacy';
      var preLockWindow = !forecastLocked && Number(forecast.currentDay || 0) < forecastLockDay;
      var forecastReference = forecastLocked ? lockedForecast : forecast;
      var forecastStateMeta = resolvedDashboardStateMeta(
        forecastLocked
          ? String(lockedForecast.stateKey || 'stable')
          : forecastStateMetaForValues(forecast.projectedAvailableEnd, burn.forecastEndPct, model.head && model.head.availableBudget),
        monthClosed
      );
      var forecastContext = forecastContextLayer(month, model, Array.isArray(reallocation) ? reallocation : []);
      var forecastEvaluation = forecastEvaluationOutcomeModel(month, model, forecast);
      var monthEndOutcome = forecastEvaluation.monthEndOutcome || {};
      var closedForecastFinalAmount = Number(forecastEvaluation.finalAmountForEvaluation || 0);
      var forecastUsedPctForEvaluation = Number(forecastEvaluation.usedPctForEvaluation || 0);
      var burnDisplay = monthClosed
        ? Object.assign({}, burn, {
            spentPct: forecastUsedPctForEvaluation,
            forecastEndPct: forecastUsedPctForEvaluation,
            delta: forecastUsedPctForEvaluation - 100
          })
        : Object.assign({}, burn, { forecastEndPct: forecastUsedPctForEvaluation });
      var forecastHeadlineAmount = monthClosed
        ? closedForecastFinalAmount
        : Number(forecastReference.projectedAvailableEnd || 0);
      var comparisonProjectedEnd = monthClosed
        ? closedForecastFinalAmount
        : Number(forecast.projectedAvailableEnd || 0);
      var forecastGapVsLock = forecastLocked
        ? comparisonProjectedEnd - Number(lockedForecast.projectedAvailableEnd || 0)
        : 0;
      var forecastAccuracy = forecastLocked && typeof forecastAccuracyModel === 'function'
        ? forecastAccuracyModel(month, lockedForecast, comparisonProjectedEnd)
        : null;
      var confidenceMeta = (model && model.confidenceMeta) || (forecast && forecast.forecastConfidenceMeta) || {};
      var confidencePct = Number((confidenceMeta && confidenceMeta.pct) || (model && model.forecastConfidencePct) || 0);
      var confidenceLabel = (confidenceMeta && confidenceMeta.label) || (model && model.confidenceLabel) || (confidencePct >= 75 ? 'High confidence' : (confidencePct >= 50 ? 'Medium confidence' : 'Low confidence'));
      var confidenceTone = (confidenceMeta && confidenceMeta.tone) || (confidencePct >= 75 ? 'good' : (confidencePct >= 50 ? 'warn' : 'bad'));
      var confidenceSupport = (confidenceMeta && confidenceMeta.support) || 'Based on month progress, recurring expenses, savings, and spending history.';
      var driftDir = forecastDriftDirection(month);
      var driftArrowHtml = '<span class="forecast-drift-arrow ' + (driftDir.cls || '') + '" title="' + (driftDir.title || '') + '">' + (driftDir.arrow || '') + '</span>';
      var primaryMetrics = monthClosed ? [
        {
          theme: 'theme-status',
          tone: forecastLocked ? 'good' : '',
          label: 'Locked forecast',
          value: forecastLocked ? money(Number(lockedForecast.projectedAvailableEnd || 0)) : 'N/A',
          support: forecastLocked
            ? (forecastLockIsLegacy ? 'Historical lock restored from legacy data' : 'Day-' + forecastLockDay + ' expectation captured for ' + (month.name || 'this month'))
            : 'No forecast lock was captured for comparison'
        },
        {
          theme: 'theme-live',
          tone: closedForecastFinalAmount >= 0 ? 'good' : 'bad',
          label: 'Final result',
          value: money(closedForecastFinalAmount),
          support: monthEndOutcome.hasRolloverImpact ? 'Closing result before rollover transfer' : 'Final remaining allocation'
        },
        {
          theme: 'theme-plan',
          tone: forecastAccuracy ? forecastAccuracy.tone : '',
          label: 'Forecast accuracy',
          value: forecastAccuracy ? ((forecastAccuracy.label ? forecastAccuracy.label + ' · ' : '') + forecastAccuracy.pct + '%') : 'N/A',
          support: forecastLocked ? ((forecastAccuracy && forecastAccuracy.support ? forecastAccuracy.support + ' · ' : '') + 'Variance ' + (forecastGapVsLock >= 0 ? '+' : '') + money(forecastGapVsLock) + (forecastLockIsLegacy ? ' vs restored legacy lock' : ' vs locked forecast')) : 'No lock available for comparison',
          driftArrow: forecastLocked ? driftArrowHtml : ''
        }
      ] : [
        {
          theme: 'theme-status',
          tone: preLockWindow ? '' : 'good',
          label: 'Forecast status',
          value: forecastLocked ? (forecastLockIsLegacy ? 'Legacy lock' : 'Locked') : 'Open',
          support: forecastLocked
            ? (forecastLockIsLegacy ? 'Restored historical reference for ' + (month.name || 'this month') : 'Reference forecast saved for ' + (month.name || 'this month'))
            : Math.max(forecastLockDay - Number(forecast.currentDay || 0), 0) + ' day' + (Math.max(forecastLockDay - Number(forecast.currentDay || 0), 0) === 1 ? '' : 's') + ' until lock'
        },
        {
          theme: 'theme-live',
          tone: confidenceTone,
          label: 'Forecast confidence',
          value: confidencePct ? (confidenceLabel.replace(' confidence', '') + ' · ' + Math.round(confidencePct) + '%') : confidenceLabel.replace(' confidence', ''),
          support: ((confidenceMeta && confidenceMeta.componentSummary) ? confidenceMeta.componentSummary + ' · ' : '') + confidenceSupport
        },
        {
          theme: 'theme-plan',
          tone: forecastLocked ? (forecastGapVsLock >= 0 ? 'good' : 'bad') : (model.planGap < 0 ? 'bad' : 'good'),
          label: forecastLocked ? (forecastLockIsLegacy ? 'Vs legacy lock' : 'Vs locked forecast') : 'Buffer vs plan',
          value: forecastLocked ? (forecastGapVsLock >= 0 ? '+' : '') + money(forecastGapVsLock) : ((model.planGap >= 0 ? '+' : '') + money(model.planGap)),
          support: forecastLocked ? (forecastLockIsLegacy ? 'Current end projection vs restored historical reference' : 'Current end projection vs locked reference') : (forecast.remainingDays > 0 ? forecast.remainingDays + ' day' + (forecast.remainingDays === 1 ? '' : 's') + ' left' : 'Month closed'),
          driftArrow: driftArrowHtml
        }
      ];
      var secondaryMetrics = [
        {
          theme: 'theme-structure',
          tone: '',
          label: 'Repeatable / open',
          value: money(Number((forecastLocked ? lockedForecast.projectedRepeatable : forecast.projectedRepeatable) || 0) + Number((forecastLocked ? lockedForecast.projectedOpen : forecast.projectedOpen) || 0)),
          support: forecastLocked ? 'Captured at lock as the base recurring load' : 'Projected from pace and confirmed note patterns'
        },
        {
          theme: 'theme-structure',
          tone: Number(forecastLocked ? lockedForecast.projectedOneoff : forecast.projectedOneoff) > 0 ? 'bad' : 'good',
          label: 'One-off left',
          value: money(Number(forecastLocked ? lockedForecast.projectedOneoff : forecast.projectedOneoff) || 0),
          support: forecastLocked ? 'Remaining one-off allowance at lock' : 'Not extrapolated from past one-off spend'
        },
        {
          theme: 'theme-structure',
          tone: subscriptions && subscriptions.state && subscriptions.state.tone === 'bad' ? 'bad' : (subscriptions && subscriptions.state && subscriptions.state.tone === 'good' ? 'good' : ''),
          label: 'Subscription burden',
          value: money((subscriptions.unpaidTotal > 0 ? subscriptions.unpaidTotal : subscriptions.plannedTotal) || 0),
          support: subscriptions.unpaidTotal > 0 ? subscriptions.dueCount + ' still unpaid' : subscriptions.activeCount + ' active for this month'
        }
      ];
      if (specialFunding && specialFunding.enabled) {
        secondaryMetrics.push({
          theme: 'theme-plan',
          tone: specialFunding.tone === 'bad' ? 'bad' : specialFunding.tone === 'good' ? 'good' : 'warn',
          label: specialFunding.label,
          value: money(specialFunding.covered),
          support: Math.round((specialFunding.ratio || 0) * 100) + '% of ' + specialFunding.targetLabel + ' covered'
        });
      }
      var summaryLabel = monthClosed ? 'Final read' : (forecastLocked ? 'vs lock' : 'Locks');
      var summaryCopy = monthClosed
        ? (forecastLocked ? ((forecastGapVsLock >= 0 ? 'Above' : 'Below') + (forecastLockIsLegacy ? ' legacy forecast by ' : ' locked forecast by ') + money(Math.abs(forecastGapVsLock)) + '.') : 'Closed with final result ' + money(closedForecastFinalAmount) + '.') + (monthEndOutcome.hasRolloverImpact ? ' ' + money(monthEndOutcome.closingBeforeRollover) + ' rolled forward.' : '')
        : (forecastLocked
          ? 'Live projection is ' + (forecastGapVsLock >= 0 ? 'above' : 'below') + ' the lock by ' + money(Math.abs(forecastGapVsLock)) + '.'
          : 'Locks on ' + forecastLockDateText + '.');
      return {
        monthClosed: monthClosed,
        forecastLockDay: forecastLockDay,
        forecastLockDateText: forecastLockDateText,
        lockedForecast: lockedForecast,
        forecastLocked: forecastLocked,
        preLockWindow: preLockWindow,
        forecastReference: forecastReference,
        forecastStateMeta: forecastStateMeta,
        forecastContext: forecastContext,
        forecastEvaluation: forecastEvaluation,
        monthEndOutcome: monthEndOutcome,
        closedForecastFinalAmount: closedForecastFinalAmount,
        forecastUsedPctForEvaluation: forecastUsedPctForEvaluation,
        burnDisplay: burnDisplay,
        forecastHeadlineAmount: forecastHeadlineAmount,
        comparisonProjectedEnd: comparisonProjectedEnd,
        forecastGapVsLock: forecastGapVsLock,
        forecastAccuracy: forecastAccuracy,
        confidenceMeta: confidenceMeta,
        confidencePct: confidencePct,
        driftDir: driftDir,
        primaryMetrics: primaryMetrics,
        secondaryMetrics: secondaryMetrics,
        summaryLabel: summaryLabel,
        summaryCopy: summaryCopy,
        driverRows: forecastLocked ? ((lockedForecast && lockedForecast.driverRows) || []) : (model.driverRows || [])
      };
    }, null);
  }
  function getBurnCard(month, burnDisplay, burn, monthClosed, monthEndOutcome){
    return call(function(){
      burnDisplay = burnDisplay || burn || {};
      burn = burn || burnDisplay || {};
      monthEndOutcome = monthEndOutcome || {};
      var visualState = burnDisplay.forecastEndPct > 110 || burnDisplay.delta > 12 ? 'overheat' : burnDisplay.forecastEndPct > 100 || burnDisplay.delta > 4 ? 'hot' : burnDisplay.delta > -4 ? 'watch' : 'safe';
      var state = burnHealthState(burn);
      var closedMeta = normalizedStateMeta('closed');
      var stateLabel = monthClosed ? 'Closed Month' : state.label;
      var stateClass = monthClosed ? closedMeta.className : state.className;
      var hint = monthClosed
        ? burnDisplay.forecastEndPct > 100 ? 'The month closed above its ideal available-funds pace.'
          : burnDisplay.forecastEndPct >= 95 ? 'The month closed close to its ideal available-funds pace.'
          : 'The month closed with pace under control.'
        : state.key === 'critical' ? 'Pace is now actively threatening the month.'
          : state.key === 'pressure' ? 'Pace is above target and needs attention.'
          : state.key === 'watch' ? 'Close to the edge — keep an eye on pace.'
          : state.key === 'stable' ? 'Pace is close to plan with limited drift.'
          : 'Controlled pace with room to spare.';
      var body = monthClosed
        ? 'This is now a retrospective read. The pace signal is no longer live, but it still shows how spending tracked against the month timeline and available funds.'
        : state.key === 'critical' ? 'You are spending faster than the month can comfortably absorb. Without a trim, the end-of-month result is likely to deteriorate further.'
          : state.key === 'pressure' ? 'You are spending faster than expected for this point in the month. The buffer is narrowing and needs active monitoring.'
          : state.key === 'watch' ? 'You are close to expected pace. A few heavier spending days could quickly reduce the remaining cushion.'
          : state.key === 'stable' ? 'You are broadly aligned with expected pace. Staying disciplined should keep the month manageable.'
          : 'You are spending slower than expected. This gives you healthy room to absorb variability later in the month.';
      var paceGapLabel = (burnDisplay.delta > 0 ? '+' : '') + Number(burnDisplay.delta || 0).toFixed(1) + '%';
      var forecastLabel = Number(burnDisplay.forecastEndPct || 0).toFixed(1) + '%';
      var bufferLabel = monthClosed ? 'Final review' : state.label;
      var interpretation = monthClosed
        ? 'Final burn summary: finished at ' + Number(burnDisplay.forecastEndPct || 0).toFixed(1) + '% used.' + (monthEndOutcome.hasRolloverImpact ? ' Pre-rollover close before ' + money(monthEndOutcome.closingBeforeRollover) + ' moved forward.' : (burnDisplay.forecastEndPct > 100 ? ' Carry a slightly tighter setup into next month.' : burnDisplay.forecastEndPct >= 95 ? ' Landed close to plan with modest room left.' : ' The structure held up well and preserved buffer.'))
        : state.key === 'critical' ? 'Keep discretionary spending very tight for now. Every lighter day helps prevent a weaker month-end result.'
          : state.key === 'pressure' ? 'Try to hold discretionary spending below your current pace so the month does not drift further off track.'
          : state.key === 'watch' ? 'A steady pace matters here. Small trims now help preserve flexibility for the rest of the month.'
          : state.key === 'stable' ? 'Stay close to current pacing. The month looks manageable, but discipline still matters.'
          : 'At this pace, you can absorb later variability more safely or preserve extra buffer into month-end.';
      return { visualState: visualState, state: state, stateLabel: stateLabel, stateClass: stateClass, hint: hint, body: body, paceGapLabel: paceGapLabel, forecastLabel: forecastLabel, bufferLabel: bufferLabel, interpretation: interpretation };
    }, {});
  }
  function attachSubscriptionBurdenCardModel(subscriptionBurden){
    subscriptionBurden = (subscriptionBurden && typeof subscriptionBurden === 'object') ? subscriptionBurden : {};
    var unpaid = num(subscriptionBurden.unpaidTotal);
    var planned = num(subscriptionBurden.plannedTotal);
    subscriptionBurden.cardModel = {
      currentBurden: unpaid > 0 ? unpaid : planned,
      currentBurdenLabel: unpaid > 0 ? 'Still unpaid' : 'Planned this month',
      currentBurdenSub: unpaid > 0 ? num(subscriptionBurden.dueCount) + ' due now' : num(subscriptionBurden.activeCount) + ' active',
      shareLabel: unpaid > 0 ? num(subscriptionBurden.unpaidShareOfAvailablePct).toFixed(1) + '%' : num(subscriptionBurden.plannedShareOfAvailablePct).toFixed(1) + '%',
      shareSub: unpaid > 0 ? 'of budget reserved' : 'of budget planned',
      supportCopy: num(subscriptionBurden.activeCount) > 0 ? '' : 'No subscription pressure.'
    };
    return subscriptionBurden;
  }
  /* ----------------------------------------------------------------------
   * Adaptive signal layer (Phase 6)
   * Harvests richer, history-aware signals from models app.js already
   * computes, so the briefing / action / forecast copy can grow more
   * specific and confident as more months of data accumulate.
   * Everything here is defensive: any missing source degrades to silence,
   * never an error.
   * -------------------------------------------------------------------- */

  function cap(s){ return text(s, '').replace(/^./, function(c){ return c.toUpperCase(); }); }
  function signed(value){ var n = num(value); return (n > 0 ? '+' : '') + money(Math.abs(n) === n ? n : n); }
  function signedMoney(value){ var n = num(value); return (n >= 0 ? '+' : '−') + money(Math.abs(n)); }
  function plural(n, one, many){ return num(n) === 1 ? one : (many || one + 's'); }

  // How many usable prior months exist for this month — the basis of the
  // "learns over time" confidence gradient.
  function historyDepth(month){
    return call(function(){
      if (!month || !state || !Array.isArray(state.months)) return 0;
      var idx = state.months.findIndex(function(m){ return m && m.name === month.name; });
      return idx < 0 ? 0 : idx; // number of months before this one
    }, 0);
  }
  // Maps depth -> qualitative confidence tier used to soften/strengthen copy.
  function confidenceTier(depth){
    if (depth <= 0) return { key: 'none',     adj: 'early',      hedge: 'so far',                 weight: 0.4 };
    if (depth === 1) return { key: 'thin',     adj: 'emerging',   hedge: 'on limited history',     weight: 0.6 };
    if (depth <= 3) return { key: 'building',  adj: 'building',   hedge: 'against recent months',  weight: 0.85 };
    return            { key: 'rich',     adj: 'established', hedge: 'against your usual pattern', weight: 1 };
  }

  // Pull the strongest category trend signals (rising / improving / risk).
  function trendSignals(month){
    return call(function(){
      var data = categoryTrendRows(month) || { rows: [] };
      var rows = Array.isArray(data.rows) ? data.rows : [];
      var scored = rows.slice().sort(function(a, b){ return num(b.score) - num(a.score); });
      var topRisk = scored.find(function(r){ return r.status === 'risk' || r.status === 'watch'; }) || null;
      var topRising = rows.filter(function(r){ return num(r.pctChange) > 12 && num(r.curr) > 0 && num(r.prev) > 0; })
                          .sort(function(a, b){ return num(b.pctChange) - num(a.pctChange); })[0] || null;
      var topImproving = rows.filter(function(r){ return r.status === 'improving' || (num(r.pctChange) < -12 && num(r.prev) > 0); })
                            .sort(function(a, b){ return num(a.pctChange) - num(b.pctChange); })[0] || null;
      var hasComparable = rows.some(function(r){ return num(r.prev) > 0; });
      return { rows: rows, topRisk: topRisk, topRising: topRising, topImproving: topImproving, hasComparable: hasComparable };
    }, { rows: [], topRisk: null, topRising: null, topImproving: null, hasComparable: false });
  }

  // Direction of travel vs the previous month (improving / worsening / stable).
  function driftSignal(month){
    return call(function(){
      var d = forecastDriftDirection(month) || {};
      var cls = text(d.cls, 'stable');
      return {
        cls: cls,
        improving: cls === 'improving',
        worsening: cls === 'worsening',
        stable: cls === 'stable',
        title: text(d.title, '')
      };
    }, { cls: 'stable', improving: false, worsening: false, stable: true, title: '' });
  }

  // Streak of consecutive recent months that finished within / over plan.
  // Gives the "you've stayed on track N months running" style feedback.
  function planStreak(month){
    return call(function(){
      if (!month || !state || !Array.isArray(state.months)) return { kind: 'none', length: 0 };
      var idx = state.months.findIndex(function(m){ return m && m.name === month.name; });
      if (idx < 1) return { kind: 'none', length: 0 };
      var underRun = 0, overRun = 0, broke = false, started = null;
      for (var i = idx - 1; i >= 0 && !broke; i--) {
        var m = state.months[i];
        var alloc = call(function(){ return allocationRows(m); }, null);
        if (!alloc || !Array.isArray(alloc.rows)) break;
        var funds = num(alloc.availableFunds) || 0;
        var spent = alloc.rows.reduce(function(s, r){ return s + Math.max(0, num(r.actual)); }, 0);
        if (funds <= 0) break;
        var usedPct = (spent / funds) * 100;
        var under = usedPct <= 100;
        if (started === null) started = under;
        if (under === started) { if (under) underRun++; else overRun++; }
        else broke = true;
      }
      if (underRun > 0) return { kind: 'under', length: underRun };
      if (overRun > 0) return { kind: 'over', length: overRun };
      return { kind: 'none', length: 0 };
    }, { kind: 'none', length: 0 });
  }

  // Best behavior-intelligence line (growth / overspend / subscription share).
  function behaviorSignal(month, metrics){
    return call(function(){
      var rows = (metrics && Array.isArray(metrics.behaviorIntelligence)) ? metrics.behaviorIntelligence : getBehaviorIntelligence(month);
      var warn = rows.find(function(r){ return text(r.tone) === 'warn'; });
      var lead = warn || rows[0] || null;
      return lead ? { text: text(lead.text, ''), tone: text(lead.tone, 'neutral'), type: text(lead.type, '') } : null;
    }, null);
  }

  // Forecast confidence note from the context layer app.js already builds.
  function forecastConfidence(month, model){
    return call(function(){
      var ctx = forecastContextLayer(month, model || getModel(month) || {}, []);
      return ctx ? { pct: num(ctx.baseConfidence || ctx.confidencePct), note: text(ctx.confidenceNote, '') } : null;
    }, null);
  }

  // Single bundle consumed by briefing + action + metrics.signals.
  function harvestSignals(month, metrics){
    var depth = historyDepth(month);
    return {
      depth: depth,
      tier: confidenceTier(depth),
      trends: trendSignals(month),
      drift: driftSignal(month),
      streak: planStreak(month),
      behavior: behaviorSignal(month, metrics),
      confidence: forecastConfidence(month, metrics && metrics.model)
    };
  }

  function primaryAction(month, guidance, subs, burnPct, signals){
    signals = signals || {};
    var trends = signals.trends || {};
    var drift = signals.drift || {};
    var streak = signals.streak || {};

    var first = guidance && typeof guidance === 'object' ? guidance : null;
    if (first) {
      return {
        title: text(first.title || first.label || first.name, 'Review guidance'),
        sub: text(first.urgency || first.driver || first.action || first.message || first.copy || first.headline, 'Open the guidance card for details.'),
        tone: text(first.tone || first.type || first.status || '', burnPct > 100 ? 'bad' : 'good')
      };
    }
    if (num(subs.unpaidTotal) > 0) {
      var count = num(subs.dueCount);
      return { title: 'Subscriptions due', sub: count + ' recurring payment' + (count === 1 ? '' : 's') + ' still due', tone: 'warn' };
    }
    // A clear single overspending driver beats a generic "budget pressure".
    if (burnPct > 100 && trends.topRisk && num(trends.topRisk.projectedDelta) > 0) {
      return {
        title: 'Trim ' + cap(trends.topRisk.key),
        sub: cap(trends.topRisk.key) + ' is projected ' + signedMoney(trends.topRisk.projectedDelta) + ' over target and is the main pace driver.',
        tone: 'bad'
      };
    }
    if (burnPct > 100) return { title: 'Budget pressure', sub: 'Projected spending is above plan.', tone: 'bad' };
    // Rising category worth catching early, even when not yet over budget.
    if (trends.topRising && num(trends.topRising.pctChange) >= 25) {
      return {
        title: 'Watch ' + cap(trends.topRising.key),
        sub: cap(trends.topRising.key) + ' is up ' + Math.round(num(trends.topRising.pctChange)) + '% vs last month — worth a glance before it sets a pattern.',
        tone: 'warn'
      };
    }
    // Positive reinforcement when a genuine on-track streak exists.
    if (streak.kind === 'under' && streak.length >= 2) {
      return {
        title: 'Keep the streak',
        sub: streak.length + ' ' + plural(streak.length, 'month') + ' running inside plan — current pace keeps it going.',
        tone: 'good'
      };
    }
    if (drift.improving) {
      return { title: 'Trending better', sub: 'You are holding more of your funds than at this point last month.', tone: 'good' };
    }
    return { title: 'Monitor pace', sub: 'No urgent action detected.', tone: 'good' };
  }
  // ---- Slot builders --------------------------------------------------
  // The workspace binds briefing[0]=forecast, [1]=pace, [2]=subscriptions
  // by position, so each slot keeps its theme but its copy now adapts to
  // drift, streaks, trends and history depth.

  function forecastSlot(metrics, signals){
    var projection = num(metrics.forecast.projectedAvailableEnd);
    var positive = projection >= 0;
    var drift = signals.drift || {};
    var conf = signals.confidence || null;
    var tier = signals.tier || {};

    var title = positive ? 'Positive outlook' : 'Watch cash pressure';
    if (positive && drift.improving) title = 'Outlook strengthening';
    else if (positive && drift.worsening) title = 'Positive, but easing';
    else if (!positive && drift.improving) title = 'Pressure easing';
    else if (!positive && drift.worsening) title = 'Pressure building';

    var sub = (positive ? 'Projected ' : 'Projected shortfall of ') + money(Math.abs(projection)) + ' at month end';
    if (drift.improving) sub += ' — better than this point last month';
    else if (drift.worsening) sub += ' — tighter than this point last month';
    // Confidence framing scales with how much history backs the projection.
    if (conf && conf.note) sub += '. ' + conf.note;
    else if (tier.key === 'none') sub += '. Read as an early estimate ' + tier.hedge + '.';
    else if (tier.key === 'thin') sub += '. Still ' + tier.adj + ' — ' + tier.hedge + '.';

    return { key: 'forecast', title: title, sub: sub, tone: positive ? (drift.worsening ? 'warn' : 'good') : 'bad' };
  }

  function paceSlot(metrics, signals){
    var burnPct = num(metrics.budget.forecastEndPct);
    var over = burnPct > 100;
    var near = burnPct >= 90 && burnPct <= 100;
    var streak = signals.streak || {};
    var trends = signals.trends || {};

    var title = over ? 'Over planned pace' : (near ? 'Near planned pace' : 'Within planned pace');
    if (!over && streak.kind === 'under' && streak.length >= 2) title = 'On track ' + streak.length + ' months running';
    else if (over && streak.kind === 'over' && streak.length >= 2) title = 'Over plan ' + streak.length + ' months running';

    var sub = 'Forecast budget use is currently ' + percent(burnPct) + '.';
    if (over && trends.topRisk) {
      sub += ' ' + cap(trends.topRisk.key) + ' is the heaviest driver (' + signedMoney(trends.topRisk.projectedDelta) + ' vs target).';
    } else if (!over && trends.topImproving) {
      sub += ' ' + cap(trends.topImproving.key) + ' is easing vs last month, which is helping.';
    } else if (streak.kind === 'under' && streak.length >= 2) {
      sub += ' That extends a ' + streak.length + '-month run inside plan.';
    }
    return { key: 'pace', title: title, sub: sub, tone: over ? 'bad' : (near ? 'warn' : 'good') };
  }

  function subscriptionsSlot(metrics){
    var subs = metrics.subscriptions || {};
    var unpaid = num(subs.unpaidTotal);
    var due = num(subs.dueCount);
    var paid = num(subs.paidCount);
    var active = num(subs.activeCount);
    var raw = subs.raw || {};
    var sharePct = num(raw.unpaidShareOfAvailablePct || raw.plannedShareOfAvailablePct);

    var title = unpaid > 0 ? money(unpaid) + ' still due' : (active > 0 ? 'Recurring load absorbed' : 'No recurring load');
    var sub;
    if (unpaid > 0) {
      sub = paid + ' paid · ' + due + ' due';
      if (sharePct > 0) sub += ' · ' + percent(sharePct) + ' of available funds';
    } else if (active > 0) {
      sub = active + ' active ' + plural(active, 'subscription') + ' fully covered this month';
    } else {
      sub = 'Add subscriptions to track recurring pressure over time.';
    }
    return { key: 'subscriptions', title: title, sub: sub, tone: unpaid > 0 ? 'warn' : 'good' };
  }

  // Prioritised 4th slot: surface the single most useful "learned" signal.
  function spotlightSlot(month, metrics, signals){
    var trends = signals.trends || {};
    var behavior = signals.behavior || null;
    var streak = signals.streak || {};
    var depth = num(signals.depth);

    // 1. A material rising category (early-warning, the most actionable).
    if (trends.topRising && num(trends.topRising.pctChange) >= 20) {
      return {
        key: 'spotlight',
        title: cap(trends.topRising.key) + ' climbing',
        sub: 'Up ' + Math.round(num(trends.topRising.pctChange)) + '% vs last month (' + money(trends.topRising.prev) + ' → ' + money(trends.topRising.curr) + ').',
        tone: num(trends.topRising.pctChange) >= 40 ? 'warn' : 'neutral'
      };
    }
    // 2. A behaviour-intelligence learning.
    if (behavior && behavior.text) {
      return {
        key: 'spotlight',
        title: cap(behavior.type || 'Pattern') + ' signal',
        sub: behavior.text.slice(0, 160),
        tone: behavior.tone === 'warn' ? 'warn' : 'neutral'
      };
    }
    // 3. An improving category — positive reinforcement.
    if (trends.topImproving && num(trends.topImproving.curr) > 0) {
      return {
        key: 'spotlight',
        title: cap(trends.topImproving.key) + ' easing',
        sub: 'Down to ' + money(trends.topImproving.curr) + ' this month — the lighter pace is helping the overall picture.',
        tone: 'good'
      };
    }
    // 4. A streak callout.
    if (streak.kind === 'under' && streak.length >= 3) {
      return {
        key: 'spotlight',
        title: streak.length + '-month healthy run',
        sub: 'You have stayed inside plan ' + streak.length + ' months in a row — a genuine, durable pattern now.',
        tone: 'good'
      };
    }
    // 5. Cold-start nudge while history is still thin.
    if (depth <= 1) {
      return {
        key: 'spotlight',
        title: 'Learning your pattern',
        sub: depth === 0
          ? 'This is your first tracked month — insights sharpen sharply once a second month lands.'
          : 'One month of history so far. Trends and comparisons get far richer from next month on.',
        tone: 'neutral'
      };
    }
    return null;
  }

  function buildBriefing(month, metrics){
    var signals = metrics.signals || harvestSignals(month, metrics);
    var items = [
      forecastSlot(metrics, signals),
      paceSlot(metrics, signals),
      subscriptionsSlot(metrics)
    ];
    var spotlight = spotlightSlot(month, metrics, signals);
    if (spotlight) items.push(spotlight);
    return items.slice(0, 4);
  }
  function analyze(month){
    month = month || (typeof getActiveMonth === 'function' ? getActiveMonth() : null);
    if (!month) {
      return { month: null, monthName: 'Current month', model: null, forecast: {}, budget: {}, subscriptions: {}, guidance: [], behaviorInsights: [], trends: { rows: [], monthLabels: [] }, signals: { depth: 0, tier: confidenceTier(0), trends: {}, drift: {}, streak: {}, behavior: null, confidence: null }, action: primaryAction(null, [], {}, 0, {}), briefing: [] };
    }
    var model = getModel(month) || {};
    var forecast = model.forecast || {};
    var burn = model.burn || {};
    var subscriptions = attachSubscriptionBurdenCardModel(getSubscriptionBurden(month, model));
    var guidance = getGuidance(month);
    var behaviorInsights = getBehavior(month);
    var behaviorIntelligence = getBehaviorIntelligence(month);
    var trendData = getTrendData(month);
    var categoryTrends = getCategoryTrendModel(month);
    var evolution = getEvolution(month);
    var decision = getDecision(month);
    var mix = getMix(month);
    var reallocation = getReallocation(month);
    var specialFunding = getSpecialFunding(month, model);
    var forecastCard = getForecastCard(month, model, forecast, burn, subscriptions, specialFunding, reallocation);
    var burnCard = getBurnCard(month, forecastCard && forecastCard.burnDisplay ? forecastCard.burnDisplay : burn, burn, forecastCard && forecastCard.monthClosed, forecastCard && forecastCard.monthEndOutcome);
    var projection = (forecastCard && forecastCard.monthClosed) ? num(forecastCard.closedForecastFinalAmount) : num(forecast.projectedAvailableEnd);
    var burnPct = (forecastCard && forecastCard.burnDisplay) ? num(forecastCard.burnDisplay.forecastEndPct || forecastCard.burnDisplay.spentPct) : num(burn.forecastEndPct || burn.spentPct);
    var metrics = {
      month: month,
      monthName: text(month.name, 'Current month'),
      model: model,
      forecast: {
        raw: forecast,
        projectedAvailableEnd: projection,
        currentPace: num(model.currentPace),
        planGap: num(model.planGap),
        remainingDays: num(forecast.remainingDays),
        currentDay: num(forecast.currentDay)
      },
      budget: {
        raw: burn,
        forecastEndPct: burnPct,
        spentPct: num(burn.spentPct),
        delta: num(burn.delta),
        tone: burnPct > 100 ? 'bad' : burnPct >= 90 ? 'warn' : 'good'
      },
      subscriptions: {
        raw: subscriptions,
        unpaidTotal: num(subscriptions.unpaidTotal),
        dueCount: num(subscriptions.dueCount),
        paidCount: num(subscriptions.paidCount),
        plannedTotal: num(subscriptions.plannedTotal),
        activeCount: num(subscriptions.activeCount),
        tone: subscriptions && subscriptions.state ? text(subscriptions.state.tone, 'neutral') : 'neutral'
      },
      guidance: guidance,
      behaviorInsights: behaviorInsights,
      behaviorIntelligence: behaviorIntelligence,
      trends: trendData,
      evolution: evolution,
      decision: decision,
      cardModels: {
        forecastModel: model,
        forecast: forecast,
        burn: burn,
        burnDisplay: null,
        guidance: guidance,
        mix: mix,
        behaviorInsights: behaviorInsights,
        behaviorIntelligence: behaviorIntelligence,
        trendData: trendData,
        categoryTrends: categoryTrends,
        evolution: evolution,
        reallocation: reallocation,
        subscriptionBurden: subscriptions,
        specialFunding: specialFunding,
        forecastCard: forecastCard,
        burnCard: burnCard
      }
    };
    metrics.signals = harvestSignals(month, metrics);
    metrics.action = primaryAction(month, guidance, metrics.subscriptions, burnPct, metrics.signals);
    metrics.briefing = buildBriefing(month, metrics);
    return metrics;
  }

  window.InsightEngine = {
    __phase5Engine: true,
    __phase6Engine: true,
    analyze: analyze,
    harvestSignals: harvestSignals,
    money: money,
    percent: percent
  };
})();
