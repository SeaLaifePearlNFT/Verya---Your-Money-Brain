/* InsightEngine: centralized Smart Insights display models. */
(function(){
  if (window.InsightEngine && window.InsightEngine.__phase5Engine) return;

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
  function getGuidancePace(month, decision){
    return call(function(){
      var dec = decision || insightDecisionEngine(month);
      var liveKey = dec && dec.liveIssue ? 'expense-group|' + dec.liveIssue.key : null;
      var catKey = liveKey || (function(){
        var opts = planningBucketOptions(month).filter(function(o){
          return o.bucketType === 'expense' && o.key.indexOf('expense-group|') === 0;
        });
        return opts.length ? opts.sort(function(a,b){ return (b.current||0)-(a.current||0); })[0].key : null;
      })();
      if (!catKey) return { data: null, mode: 'guidance', hasLiveIssue: false };
      var pd = computeCategoryPaceData(month, catKey);
      var grpOpt = planningBucketOptions(month).find(function(o){ return o.key === catKey; });
      var groupName = grpOpt ? grpOpt.label.replace('Expenses / ','').replace('Expenses/','').trim() : catKey.replace('expense-group|','');
      return {
        data: Object.assign({}, pd, { groupName: groupName, groupHistAvg: null, bufferBasket: [] }),
        mode: 'guidance',
        hasLiveIssue: !!liveKey,
        categoryKey: catKey
      };
    }, { data: null, mode: 'guidance', hasLiveIssue: false });
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
        ? Number((forecastLocked ? lockedForecast.projectedAvailableEnd : forecast.projectedAvailableEnd) || 0)
        : Number(forecastReference.projectedAvailableEnd || 0);
      var comparisonProjectedEnd = monthClosed
        ? closedForecastFinalAmount
        : Number(forecast.projectedAvailableEnd || 0);
      var forecastGapVsLock = forecastLocked
        ? comparisonProjectedEnd - Number(lockedForecast.projectedAvailableEnd || 0)
        : 0;
      var driftDir = forecastDriftDirection(month);
      var driftArrowHtml = '<span class="forecast-drift-arrow ' + (driftDir.cls || '') + '" title="' + (driftDir.title || '') + '">' + (driftDir.arrow || '') + '</span>';
      var primaryMetrics = [
        {
          theme: 'theme-status',
          tone: preLockWindow ? '' : 'good',
          label: 'Forecast status',
          value: forecastLocked ? 'Locked' : 'Open',
          support: forecastLocked
            ? 'Reference forecast saved for ' + (month.name || 'this month')
            : Math.max(forecastLockDay - Number(forecast.currentDay || 0), 0) + ' day' + (Math.max(forecastLockDay - Number(forecast.currentDay || 0), 0) === 1 ? '' : 's') + ' until lock'
        },
        {
          theme: 'theme-live',
          tone: monthClosed ? (forecastGapVsLock >= 0 ? 'good' : 'bad') : ((Number(forecast.projectedAvailableEnd || 0) - Number(forecastReference.projectedAvailableEnd || 0)) >= 0 ? 'good' : 'bad'),
          label: monthClosed ? 'Final result' : (forecastLocked ? 'Live projection now' : 'Current pace'),
          value: monthClosed
            ? money(closedForecastFinalAmount)
            : (forecastLocked ? money(Number(forecast.projectedAvailableEnd || 0)) : money(model.currentPace) + '/day'),
          support: monthClosed
            ? (monthEndOutcome.hasRolloverImpact ? 'Closing result before rollover transfer' : 'Final remaining allocation')
            : (forecastLocked
              ? 'Updated end-of-month projection' + (Number(forecast.projectedSavingsReserveRemaining || 0) > 0 ? ' after ' + money(Number(forecast.projectedSavingsReserveRemaining || 0)) + ' savings reserve' : '')
              : money(model.paceGap) + '/day vs target')
        },
        {
          theme: 'theme-plan',
          tone: forecastLocked ? (forecastGapVsLock >= 0 ? 'good' : 'bad') : (model.planGap < 0 ? 'bad' : 'good'),
          label: forecastLocked ? 'Vs locked forecast' : 'Buffer vs plan',
          value: forecastLocked ? (forecastGapVsLock >= 0 ? '+' : '') + money(forecastGapVsLock) : (model.planGap >= 0 ? '+' : '') + money(model.planGap),
          support: forecastLocked
            ? (monthClosed ? 'Final result vs day-5 forecast' : 'Current end projection vs locked reference')
            : (forecast.remainingDays > 0 ? forecast.remainingDays + ' day' + (forecast.remainingDays === 1 ? '' : 's') + ' left' : 'Month closed'),
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
        ? (forecastGapVsLock >= 0 ? 'Above' : 'Below') + ' locked forecast by ' + money(Math.abs(forecastGapVsLock)) + '.' + (monthEndOutcome.hasRolloverImpact ? ' ' + money(monthEndOutcome.closingBeforeRollover) + ' rolled forward.' : '')
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
  function primaryAction(month, guidance, subs, burnPct){
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
    if (burnPct > 100) return { title: 'Budget pressure', sub: 'Projected spending is above plan.', tone: 'bad' };
    return { title: 'Monitor pace', sub: 'No urgent action detected.', tone: 'good' };
  }
  function buildBriefing(month, metrics){
    var subs = metrics.subscriptions;
    var projection = metrics.forecast.projectedAvailableEnd;
    var burnPct = metrics.budget.forecastEndPct;
    var behavior = metrics.behaviorInsights || [];
    var leadBehavior = behavior[0] || null;
    var items = [
      {
        key: 'forecast',
        title: projection >= 0 ? 'Positive outlook' : 'Watch cash pressure',
        sub: 'End-of-month projection: ' + money(projection),
        tone: projection >= 0 ? 'good' : 'bad'
      },
      {
        key: 'pace',
        title: burnPct > 100 ? 'Over planned pace' : 'Within planned pace',
        sub: 'Forecast budget use is currently ' + percent(burnPct) + '.',
        tone: burnPct > 100 ? 'bad' : (burnPct >= 90 ? 'warn' : 'good')
      },
      {
        key: 'subscriptions',
        title: num(subs.unpaidTotal) > 0 ? money(subs.unpaidTotal) + ' still due' : 'Recurring load absorbed',
        sub: num(subs.paidCount) + ' paid · ' + num(subs.dueCount) + ' due',
        tone: num(subs.unpaidTotal) > 0 ? 'warn' : 'good'
      }
    ];
    if (leadBehavior && leadBehavior.message) {
      items.push({
        key: 'behavior',
        title: text(leadBehavior.tone, 'Signal').replace(/^./, function(c){ return c.toUpperCase(); }) + ' behavior signal',
        sub: text(leadBehavior.message, '').slice(0, 160),
        tone: text(leadBehavior.tone, 'warn')
      });
    }
    return items.slice(0, 4);
  }
  function analyze(month){
    month = month || (typeof getActiveMonth === 'function' ? getActiveMonth() : null);
    if (!month) {
      return { month: null, monthName: 'Current month', model: null, forecast: {}, budget: {}, subscriptions: {}, guidance: [], behaviorInsights: [], trends: { rows: [], monthLabels: [] }, action: primaryAction(null, [], {}, 0), briefing: [] };
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
    var guidancePace = getGuidancePace(month, decision);
    var mix = getMix(month);
    var reallocation = getReallocation(month);
    var specialFunding = getSpecialFunding(month, model);
    var forecastCard = getForecastCard(month, model, forecast, burn, subscriptions, specialFunding, reallocation);
    var burnCard = getBurnCard(month, forecastCard && forecastCard.burnDisplay ? forecastCard.burnDisplay : burn, burn, forecastCard && forecastCard.monthClosed, forecastCard && forecastCard.monthEndOutcome);
    var projection = num(forecast.projectedAvailableEnd);
    var burnPct = num(burn.forecastEndPct || burn.spentPct);
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
        guidancePace: guidancePace,
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
    metrics.action = primaryAction(month, guidance, metrics.subscriptions, burnPct);
    metrics.briefing = buildBriefing(month, metrics);
    return metrics;
  }

  window.InsightEngine = {
    __phase5Engine: true,
    analyze: analyze,
    money: money,
    percent: percent
  };
})();
