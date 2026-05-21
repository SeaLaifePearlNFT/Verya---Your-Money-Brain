(function(){
  if (window.__veyraFocusSafeModalManagerV1290) return;
  window.__veyraFocusSafeModalManagerV1290 = true;

  var lastInteractiveTrigger = null;
  var focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function isElement(node) { return !!(node && node.nodeType === 1); }

  function rememberTrigger(node) {
    if (!isElement(node)) return;
    if (!node.matches || !node.matches(focusableSelector)) return;
    if (node.closest('[aria-hidden="true"], [inert]')) return;
    lastInteractiveTrigger = node;
  }

  function fallbackFocus(hiddenRoot) {
    var active = document.activeElement;
    if (!isElement(hiddenRoot) || !active || !hiddenRoot.contains(active)) return;

    var target = null;
    if (lastInteractiveTrigger && document.contains(lastInteractiveTrigger) && !lastInteractiveTrigger.closest('[aria-hidden="true"], [inert]')) {
      target = lastInteractiveTrigger;
    }
    if (!target && hiddenRoot.id === 'toolsDrawer') {
      target = document.getElementById('toolsDrawerBtn') || document.getElementById('contextToolsBtn');
    }
    if (!target && hiddenRoot.id === 'subscriptionsManagerOverlay') {
      target = document.getElementById('openSubscriptionsManagerBtn') || document.querySelector('[aria-controls="subscriptionsManagerOverlay"]');
    }
    if (!target) {
      target = document.querySelector('[data-view-btn].active') || document.getElementById('monthSelectorBtn') || document.body;
    }

    if (typeof active.blur === 'function') active.blur();
    if (target && typeof target.focus === 'function') {
      try { target.focus({ preventScroll: true }); }
      catch(e) { try { target.focus(); } catch(err) {} }
    }
  }

  window.veyraHideA11yRegion = function(region) {
    if (!region) return;
    fallbackFocus(region);
    region.setAttribute('aria-hidden', 'true');
    if ('inert' in region) region.inert = true;
    else region.setAttribute('inert', '');
  };

  window.veyraShowA11yRegion = function(region) {
    if (!region) return;
    if ('inert' in region) region.inert = false;
    region.removeAttribute('inert');
    region.setAttribute('aria-hidden', 'false');
  };

  document.addEventListener('pointerdown', function(event) {
    rememberTrigger(event.target && event.target.closest ? event.target.closest(focusableSelector) : event.target);
  }, true);
  document.addEventListener('focusin', function(event) {
    rememberTrigger(event.target);
  }, true);

  var nativeSetAttribute = Element.prototype.setAttribute;
  if (!nativeSetAttribute.__veyraFocusSafeWrapped) {
    var wrappedSetAttribute = function(name, value) {
      if (String(name).toLowerCase() === 'aria-hidden' && String(value) === 'true') {
        fallbackFocus(this);
      }
      return nativeSetAttribute.apply(this, arguments);
    };
    wrappedSetAttribute.__veyraFocusSafeWrapped = true;
    Element.prototype.setAttribute = wrappedSetAttribute;
  }
})();
