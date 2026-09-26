// Report buttons on the landing page. No tracking, no third parties.
(function () {
  var box = document.querySelector('.report');
  if (!box) return;
  var code = box.getAttribute('data-code');
  box.querySelectorAll('.reason').forEach(function (button) {
    button.addEventListener('click', function () {
      var reason = button.getAttribute('data-reason');
      box.querySelector('.reasons').hidden = true;
      box.querySelector('.thanks').hidden = false;
      fetch('/api/v1/shares/' + encodeURIComponent(code) + '/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason }),
      }).catch(function () {});
    });
  });
})();
