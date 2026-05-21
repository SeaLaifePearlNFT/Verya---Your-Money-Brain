/* Smart Insights workspace bridge, fed by InsightEngine. */
(function(){
  function safeText(id, value){ var el=document.getElementById(id); if(el) el.textContent = value == null ? '—' : String(value); }
  function money(value){ try { return (typeof currency === 'function') ? currency(Number(value||0)) : ('€' + Number(value||0).toFixed(2)); } catch(e){ return '€' + Number(value||0).toFixed(2); } }
  function pct(value){ var n=Number(value||0); return (Number.isFinite(n) ? Math.round(n) : 0) + '%'; }
  function refreshSmartInsightsPhase2(month){
    if(!month) return;
    var engine = (window.InsightEngine && typeof window.InsightEngine.analyze === 'function') ? window.InsightEngine.analyze(month) : null;
    var projection = engine ? Number(engine.forecast.projectedAvailableEnd || 0) : 0;
    var burnPct = engine ? Number(engine.budget.forecastEndPct || 0) : 0;
    var due = engine ? Number(engine.subscriptions.unpaidTotal || 0) : 0;
    var dueCount = engine ? Number(engine.subscriptions.dueCount || 0) : 0;
    var actionTitle = engine && engine.action ? engine.action.title : (due > 0 ? 'Subscriptions due' : (burnPct > 100 ? 'Budget pressure' : 'Monitor pace'));
    var actionSub = engine && engine.action ? engine.action.sub : (due > 0 ? (dueCount + ' recurring payment' + (dueCount===1?'':'s') + ' still due') : 'No urgent action detected.');
    var briefing = engine && Array.isArray(engine.briefing) ? engine.briefing : [];
    var forecastBrief = briefing[0] || {};
    var paceBrief = briefing[1] || {};
    var subsBrief = briefing[2] || {};

    safeText('siForecastValue', money(projection));
    safeText('siForecastSub', projection >= 0 ? 'Projected remaining at month end' : 'Projected shortfall at month end');
    safeText('siBudgetPressureValue', pct(burnPct));
    safeText('siBudgetPressureSub', burnPct > 100 ? 'Projected above plan' : 'Budget use vs. expected pace');
    safeText('siSubscriptionsDueValue', money(due));
    safeText('siSubscriptionsDueSub', dueCount + ' still due this month');
    safeText('siActionFocusValue', actionTitle);
    safeText('siActionFocusSub', actionSub);

    safeText('siBriefingMonth', (engine && engine.monthName) || month.name || 'Current month');
    safeText('siBriefForecast', forecastBrief.title || (projection >= 0 ? 'Positive outlook' : 'Watch cash pressure'));
    safeText('siBriefForecastSub', forecastBrief.sub || ('End-of-month projection: ' + money(projection)));
    safeText('siBriefPace', paceBrief.title || (burnPct > 100 ? 'Over planned pace' : 'Within planned pace'));
    safeText('siBriefPaceSub', paceBrief.sub || ('Forecast budget use is currently ' + pct(burnPct) + '.'));
    safeText('siBriefSubs', subsBrief.title || (due > 0 ? money(due) + ' still due' : 'Recurring load absorbed'));
    safeText('siBriefSubsSub', subsBrief.sub || ((engine && engine.subscriptions) ? ((engine.subscriptions.paidCount || 0) + ' paid · ' + dueCount + ' due') : 'Subscription status unavailable.'));
  }

  window.refreshSmartInsightsPhase2 = refreshSmartInsightsPhase2;

  document.addEventListener('click', function(evt){
    var reset = evt.target.closest && evt.target.closest('[data-reset-insight-order]');
    if(!reset) return;
    evt.preventDefault();
    var month = (typeof getActiveMonth === 'function') ? getActiveMonth() : null;
    if (typeof resetSmartInsightOrder === 'function') resetSmartInsightOrder();
    else { try { localStorage.removeItem('budgetDashboard_insightOrder'); } catch(e) {} }
    if(month && typeof renderInsights === 'function') renderInsights(month);
    if (typeof resetSmartInsightOrder === 'function') {
      setTimeout(resetSmartInsightOrder, 90);
      setTimeout(resetSmartInsightOrder, 220);
    }
    if(month) refreshSmartInsightsPhase2(month);
  });
})();
