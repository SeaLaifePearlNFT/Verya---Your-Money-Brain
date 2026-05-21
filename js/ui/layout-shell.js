(function(){
  function $(id){ return document.getElementById(id); }
  function setExpanded(ids, value){ ids.forEach(function(id){ const b=$(id); if(b) b.setAttribute('aria-expanded', value ? 'true':'false'); }); }
  function hideRegion(el){ if(window.veyraHideA11yRegion) window.veyraHideA11yRegion(el); else if(el) el.setAttribute('aria-hidden','true'); }
  function showRegion(el){ if(window.veyraShowA11yRegion) window.veyraShowA11yRegion(el); else if(el) el.setAttribute('aria-hidden','false'); }
  function closeMonthPopover(){ document.body.classList.remove('month-popover-open'); const btn=$('monthSelectorBtn'); if(btn) btn.setAttribute('aria-expanded','false'); }
  function closeToolsDrawer(returnFocus){
    const wasOpen = document.body.classList.contains('tools-drawer-open');
    const drawer = $('toolsDrawer');
    document.body.classList.remove('tools-drawer-open');
    setExpanded(['toolsDrawerBtn','contextToolsBtn'], false);
    hideRegion(drawer);
    if(returnFocus && wasOpen){
      const target = $('toolsDrawerBtn') || $('contextToolsBtn');
      if(target && typeof target.focus === 'function') { try { target.focus({preventScroll:true}); } catch(e) { target.focus(); } }
    }
  }
  function openToolsDrawer(trigger){
    closeMonthPopover();
    closeMobileNav();
    document.body.classList.add('tools-drawer-open');
    setExpanded(['toolsDrawerBtn','contextToolsBtn'], true);
    showRegion($('toolsDrawer'));
    if(trigger && typeof trigger.focus === 'function') { try { trigger.focus({preventScroll:true}); } catch(e) {} }
  }
  function toggleToolsDrawer(trigger){
    if(document.body.classList.contains('tools-drawer-open')) closeToolsDrawer(true);
    else openToolsDrawer(trigger);
  }
  function closeMobileNav(){ document.body.classList.remove('mobile-nav-open'); const b=$('mobileMenuBtn'); if(b) b.setAttribute('aria-expanded','false'); }
  function syncShellLabels(){
    const title=$('monthTitle'); const label=$('monthSelectorLabel');
    if(title && label) label.textContent = title.textContent || 'Month';
    const active=document.querySelector('#viewNav [data-view-btn].active .view-btn-title');
    const view=$('contextViewLabel'); if(active && view) view.textContent = active.textContent || 'Overview';
  }
  document.addEventListener('DOMContentLoaded', function(){
    const monthBtn=$('monthSelectorBtn'), toolsBtn=$('toolsDrawerBtn'), ctxTools=$('contextToolsBtn'), closeTools=$('toolsDrawerCloseBtn'), mobileBtn=$('mobileMenuBtn'), scrim=$('mobileShellScrim'), drawer=$('toolsDrawer');
    hideRegion(drawer);
    if(monthBtn) monthBtn.addEventListener('click', function(e){ e.stopPropagation(); const open=document.body.classList.toggle('month-popover-open'); monthBtn.setAttribute('aria-expanded', open ? 'true':'false'); closeToolsDrawer(false); });
    [toolsBtn,ctxTools].forEach(function(btn){ if(btn && !btn.dataset.toolsDrawerWired){ btn.dataset.toolsDrawerWired='true'; btn.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); toggleToolsDrawer(btn); }); } });
    if(closeTools && !closeTools.dataset.toolsDrawerCloseWired){ closeTools.dataset.toolsDrawerCloseWired='true'; closeTools.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); closeToolsDrawer(true); }); }
    if(mobileBtn) mobileBtn.addEventListener('click', function(e){ e.stopPropagation(); const open=document.body.classList.toggle('mobile-nav-open'); mobileBtn.setAttribute('aria-expanded', open?'true':'false'); closeMonthPopover(); closeToolsDrawer(false); });
    if(scrim) scrim.addEventListener('click', function(){ closeToolsDrawer(false); closeMobileNav(); closeMonthPopover(); });
    document.addEventListener('click', function(e){
      if(!e.target.closest('#monthSelectorPopover') && !e.target.closest('#monthSelectorBtn')) closeMonthPopover();
      if(!e.target.closest('#toolsDrawer') && !e.target.closest('#toolsDrawerBtn') && !e.target.closest('#contextToolsBtn')) closeToolsDrawer(false);
    });
    document.addEventListener('keydown', function(e){ if(e.key==='Escape'){ closeMonthPopover(); closeToolsDrawer(true); closeMobileNav(); } });
    const monthList=$('monthList'); if(monthList) monthList.addEventListener('click', function(){ setTimeout(function(){ closeMonthPopover(); closeMobileNav(); syncShellLabels(); }, 30); });
    const nav=$('viewNav'); if(nav) nav.addEventListener('click', function(){ setTimeout(function(){ closeMobileNav(); syncShellLabels(); }, 30); });
    const title=$('monthTitle'); if(title && window.MutationObserver){ new MutationObserver(syncShellLabels).observe(title,{childList:true,characterData:true,subtree:true}); }
    syncShellLabels();
  });
})();
