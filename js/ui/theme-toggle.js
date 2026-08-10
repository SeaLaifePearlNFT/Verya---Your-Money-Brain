(function(){
  var KEY = 'veyra-theme';
  var root = document.documentElement;
  function apply(theme){
    if (theme === 'dark') root.setAttribute('data-theme','dark');
    else root.removeAttribute('data-theme');
  }
  function current(){
    return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }
  // Initial: stored preference > system preference > light
  try {
    var stored = localStorage.getItem(KEY);
    if (stored === 'dark' || stored === 'light') {
      apply(stored);
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      apply('dark');
    }
  } catch(e){}

  document.addEventListener('DOMContentLoaded', function(){
    var btn = document.getElementById('themeToggleBtn');
    if (!btn) return;
    btn.addEventListener('click', function(){
      var next = current() === 'dark' ? 'light' : 'dark';
      apply(next);
      try { localStorage.setItem(KEY, next); } catch(e){}
    });
  });
})();
