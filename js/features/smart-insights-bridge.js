/* Smart Insights render/order bridge routed through CardLayoutManager. */
(function(){
  function ensure(){
    if (window.CardLayoutManager && typeof window.CardLayoutManager.ensure === 'function') {
      window.CardLayoutManager.ensure('smartInsights');
    }
  }
  function wrapRender(name){
    const fn = window[name];
    if (typeof fn !== 'function' || fn.__cardLayoutManagerWrapped) return;
    const wrapped = function(){
      const result = fn.apply(this, arguments);
      setTimeout(ensure, 0);
      setTimeout(ensure, 100);
      return result;
    };
    wrapped.__cardLayoutManagerWrapped = true;
    window[name] = wrapped;
  }
  ['renderInsights','renderSmartInsights','renderInsightGrid','renderOverview','renderTrends','renderTrendCharts','render'].forEach(wrapRender);

  window.resetSmartInsightOrder = function(){
    if (window.CardLayoutManager && typeof window.CardLayoutManager.reset === 'function') {
      window.CardLayoutManager.reset('smartInsights');
      setTimeout(ensure, 0);
      setTimeout(ensure, 120);
    }
  };

  document.addEventListener('dragend', function(e){
    const grid = document.getElementById('insightGrid');
    if (grid && e.target && grid.contains(e.target)) setTimeout(ensure, 0);
  }, true);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensure, { once:true });
  else ensure();
})();
