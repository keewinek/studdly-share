// Studdly admin dashboard. Passwords are hashed with SHA-256 in the browser;
// only the hex digest is sent to the server.
(function () {
  async function sha256Hex(text) {
    var bytes = new TextEncoder().encode(text);
    var digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  function show(el, text) {
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
  }

  async function api(method, path, body) {
    var res = await fetch(path, {
      method: method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    var data = null;
    try { data = await res.json(); } catch (_) {}
    return { status: res.status, data: data };
  }

  function message(status, data) {
    if (status === 401 && data && data.error === 'invalid_password') return 'Nieprawidłowe hasło.';
    if (status === 401) return 'Sesja wygasła — zaloguj się ponownie.';
    if (status === 429) return 'Za dużo prób. Spróbuj później.';
    if (status === 0) return 'Brak połączenia z serwerem.';
    return 'Coś poszło nie tak (' + status + ').';
  }

  var login = document.getElementById('login-form');
  if (login) {
    login.addEventListener('submit', async function (event) {
      event.preventDefault();
      var button = login.querySelector('button');
      button.disabled = true;
      try {
        var digest = await sha256Hex(document.getElementById('password').value);
        var r = await api('POST', '/api/admin/login', { password_sha256: digest });
        if (r.status === 204) return location.reload();
        show(document.getElementById('login-error'), message(r.status, r.data));
      } catch (_) {
        show(document.getElementById('login-error'), message(0));
      } finally {
        button.disabled = false;
      }
    });
  }

  document.querySelectorAll('[data-logout]').forEach(function (button) {
    button.addEventListener('click', async function () {
      await api('POST', '/api/admin/logout');
      location.href = '/admin';
    });
  });

  // Destructive actions need a second click instead of a blocking confirm().
  document.querySelectorAll('[data-action]').forEach(function (button) {
    var armed = false;
    var label = button.textContent;
    button.addEventListener('click', async function () {
      if (!armed) {
        armed = true;
        button.textContent = 'Kliknij ponownie, aby potwierdzić';
        setTimeout(function () { armed = false; button.textContent = label; }, 4000);
        return;
      }
      button.disabled = true;
      var code = encodeURIComponent(button.getAttribute('data-code'));
      var action = button.getAttribute('data-action');
      var r = action === 'remove'
        ? await api('DELETE', '/api/admin/shares/' + code)
        : await api('POST', '/api/admin/shares/' + code + '/restore');
      if (r.status === 204) return location.reload();
      button.disabled = false;
      show(document.getElementById('action-error'), message(r.status, r.data));
    });
  });

  var passwordForm = document.getElementById('password-form');
  if (passwordForm) {
    passwordForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      var error = document.getElementById('password-error');
      var ok = document.getElementById('password-ok');
      error.hidden = true;
      ok.hidden = true;
      var next = document.getElementById('next').value;
      if (next.length < 12) return show(error, 'Nowe hasło musi mieć co najmniej 12 znaków.');
      if (next !== document.getElementById('repeat').value) return show(error, 'Nowe hasła się różnią.');
      var r = await api('POST', '/api/admin/password', {
        current_sha256: await sha256Hex(document.getElementById('current').value),
        new_sha256: await sha256Hex(next),
      });
      if (r.status === 204) {
        passwordForm.reset();
        ok.hidden = false;
      } else {
        show(error, r.status === 401 && r.data && r.data.error === 'invalid_password' ? 'Obecne hasło jest nieprawidłowe.' : message(r.status, r.data));
      }
    });
  }
})();
