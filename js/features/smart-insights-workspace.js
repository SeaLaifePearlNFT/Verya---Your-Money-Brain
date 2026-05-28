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
    var signals = (engine && engine.signals) ? engine.signals : null;
    var drift = signals && signals.drift ? signals.drift : {};
    var streak = signals && signals.streak ? signals.streak : {};
    var actionTitle = engine && engine.action ? engine.action.title : (due > 0 ? 'Subscriptions due' : (burnPct > 100 ? 'Budget pressure' : 'Monitor pace'));
    var actionSub = engine && engine.action ? engine.action.sub : (due > 0 ? (dueCount + ' recurring payment' + (dueCount===1?'':'s') + ' still due') : 'No urgent action detected.');
    var briefing = engine && Array.isArray(engine.briefing) ? engine.briefing : [];
    var forecastBrief = briefing[0] || {};
    var paceBrief = briefing[1] || {};
    var subsBrief = briefing[2] || {};
    var spotlight = briefing[3] || null;

    // Forecast tile — note direction of travel when we have it.
    var forecastSub = projection >= 0 ? 'Projected remaining at month end' : 'Projected shortfall at month end';
    if (drift.improving) forecastSub += ' · improving vs last month';
    else if (drift.worsening) forecastSub += ' · tighter vs last month';
    safeText('siForecastValue', money(projection));
    safeText('siForecastSub', forecastSub);

    // Budget pressure tile — note an on-track streak when present.
    var pressureSub = burnPct > 100 ? 'Projected above plan' : 'Budget use vs. expected pace';
    if (burnPct <= 100 && streak.kind === 'under' && streak.length >= 2) pressureSub = streak.length + ' months running inside plan';
    else if (burnPct > 100 && streak.kind === 'over' && streak.length >= 2) pressureSub = streak.length + ' months running above plan';
    safeText('siBudgetPressureValue', pct(burnPct));
    safeText('siBudgetPressureSub', pressureSub);

    safeText('siSubscriptionsDueValue', money(due));
    safeText('siSubscriptionsDueSub', due > 0 ? (dueCount + ' still due this month') : (engine && Number(engine.subscriptions.activeCount||0) > 0 ? 'All recurring items covered' : 'No recurring items yet'));

    safeText('siActionFocusValue', actionTitle);
    // If no urgent action, let the spotlight learning fill the action sub-line.
    var isQuiet = /monitor pace|no urgent|trending better|keep the streak/i.test(actionTitle + ' ' + actionSub);
    if (isQuiet && spotlight && spotlight.sub) safeText('siActionFocusSub', spotlight.title + ' — ' + spotlight.sub);
    else safeText('siActionFocusSub', actionSub);

    safeText('siBriefingMonth', (engine && engine.monthName) || month.name || 'Current month');
    safeText('siBriefForecast', forecastBrief.title || (projection >= 0 ? 'Positive outlook' : 'Watch cash pressure'));
    safeText('siBriefForecastSub', forecastBrief.sub || ('End-of-month projection: ' + money(projection)));
    safeText('siBriefPace', paceBrief.title || (burnPct > 100 ? 'Over planned pace' : 'Within planned pace'));
    safeText('siBriefPaceSub', paceBrief.sub || ('Forecast budget use is currently ' + pct(burnPct) + '.'));
    safeText('siBriefSubs', subsBrief.title || (due > 0 ? money(due) + ' still due' : 'Recurring load absorbed'));
    safeText('siBriefSubsSub', subsBrief.sub || ((engine && engine.subscriptions) ? ((engine.subscriptions.paidCount || 0) + ' paid · ' + dueCount + ' due') : 'Subscription status unavailable.'));

    // Optional 4th briefing slot — populated only if the markup provides it.
    if (spotlight) {
      safeText('siBriefSpotlight', spotlight.title);
      safeText('siBriefSpotlightSub', spotlight.sub);
    }
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
