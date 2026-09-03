(function () {
  'use strict';

  var MIA = 'https://mia.its.ac.id';
  var API = MIA + '/api';
  var SESSION = 'myits_academics_session';
  var POLL_MS = 1500;

  var state = { smtId: null, smtList: [], groups: null, groupKey: null, mkCode: null, kelasId: null, frsCache: {}, me: null, peserta: null, pesertaFilter: '', multiClass: false, multiCount: 0, pesertaCache: {}, loadToken: 0 };
  var loginTimer = null;

  var $ = function (id) { return document.getElementById(id); };
  var loginBox = $('loginBox'), toolBox = $('toolBox');
  var selSmt = $('smt'), selGrp = $('grp'), selMk = $('mk'), selKelas = $('kelas');
  var btnBuka = $('btnBuka'), statusEl = $('status'), metaEl = $('meta'), metaText = $('metaText'), tableWrap = $('tableWrap');
  var searchGroup = $('searchGroup'), qInput = $('q');

  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (html != null) n.innerHTML = html;
    return n;
  }

  function setStatus(t, err) {
    statusEl.textContent = t || '';
    statusEl.style.color = err ? '#ff9e8a' : '#9aa4c8';
  }

  function getSession() {
    return new Promise(function (resolve) {
      chrome.cookies.get({ url: MIA, name: SESSION }, function (c) { resolve(c ? c.value : null); });
    });
  }

  async function apiGet(path) {
    var res = await fetch(API + path, { credentials: 'include', headers: { Accept: 'application/json' } });
    var j = null;
    try { j = await res.json(); } catch (e) {}
    if (res.status === 401 || (j && j.code === 9001)) throw new Error('Logout');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return j;
  }

  function fillSelect(sel, items, placeholder) {
    sel.innerHTML = '';
    if (placeholder) sel.appendChild(el('option', { value: '' }, placeholder));
    items.forEach(function (it) { sel.appendChild(el('option', { value: it.value }, it.label)); });
    if (items.length) sel.value = items[0].value;
  }

  function findGroups(j) {
    var cand = [j, j && j.data];
    for (var i = 0; i < cand.length; i++) {
      var o = cand[i];
      if (o && typeof o === 'object' && (Array.isArray(o.mku) || Array.isArray(o.prodi) || Array.isArray(o.prodi_lain) || Array.isArray(o.pengayaan) || Array.isArray(o.mbkm))) return o;
    }
    return null;
  }

  function groupLabel(key) {
    if (key === 'mku') return 'MKU / SKPB';
    if (key === 'prodi') {
      var arr = state.groups.prodi || [];
      var bs = (arr[0] && (arr[0].bidang_studi_nama || arr[0].bidang_studi)) || 'Prodi';
      return bs + ' (Prodi)';
    }
    if (key === 'prodi_lain') return 'Prodi Lain';
    if (key === 'pengayaan') return 'Pengayaan';
    if (key === 'mbkm') return 'MBKM';
    return key;
  }

  function groupKeys() {
    return ['mku', 'prodi', 'prodi_lain', 'pengayaan', 'mbkm'].filter(function (k) {
      return state.groups[k] && state.groups[k].length > 0;
    });
  }

  async function loadSemesters() {
    var j = await apiGet('/frs/rencana-studi');
    var list = (j && (j.data || j)) || [];
    if (!Array.isArray(list)) list = [];
    state.smtList = list.filter(function (s) { return s && s.semester_id; })
      .slice().sort(function (a, b) { return String(b.semester_id).localeCompare(String(a.semester_id)); });
    if (!state.smtList.length) throw new Error('Tidak ada semester ditemukan.');
    fillSelect(selSmt, state.smtList.map(function (s) {
      return { value: s.semester_id, label: s.nama_semester + ' (' + s.semester_id + ')' };
    }));
    state.smtId = selSmt.value;
  }

  async function loadKelas() {
    if (!state.smtId) return;
    var url = '/frs/kelas-ditawarkan?mhs_id=me&smt_id=' + encodeURIComponent(state.smtId) + '&active_role_id=mhs';
    var j = await apiGet(url);
    var groups = findGroups(j);
    if (!groups) throw new Error('Respons kelas tidak dikenal.');
    state.groups = groups;
    state.groupKey = null; state.mkCode = null; state.kelasId = null;
    var keys = groupKeys();
    var pref = keys.indexOf('prodi');
    if (pref < 0) pref = keys.indexOf('mku');
    if (pref < 0) pref = 0;
    fillSelect(selGrp, keys.map(function (k) { return { value: k, label: groupLabel(k) }; }));
    if (keys.length) { selGrp.value = keys[pref]; state.groupKey = keys[pref]; }
    fillMk();
  }

  function uniqueMk() {
    var items = state.groups[state.groupKey] || [];
    var seen = {}, out = [];
    items.forEach(function (it) {
      var code = it.kode_mk;
      if (!code || seen[code]) return;
      seen[code] = 1;
      out.push({ value: code, label: code + ' — ' + (it.nama_mk || '') });
    });
    out.sort(function (a, b) { return a.label.localeCompare(b.label); });
    return out;
  }

  function fillMk() {
    if (!state.groups || !state.groupKey) { fillSelect(selMk, [], ''); fillSelect(selKelas, [], ''); state.mkCode = state.kelasId = null; return; }
    fillSelect(selMk, uniqueMk(), '');
    state.mkCode = selMk.value || null;
    fillKelas();
  }

  function sortKelas(a, b) {
    var ka = String(a.kelas == null ? '' : a.kelas);
    var kb = String(b.kelas == null ? '' : b.kelas);
    var na = parseInt(ka, 10), nb = parseInt(kb, 10);
    var aNum = !isNaN(na), bNum = !isNaN(nb);
    if (aNum && bNum) return na - nb;      // kelas angka: 1, 8, 19
    if (aNum) return -1;
    if (bNum) return 1;
    return ka.localeCompare(kb, undefined, { numeric: true, sensitivity: 'base' }); // huruf: A, B, C
  }

  function fillKelas() {
    if (!state.groups || !state.groupKey || !state.mkCode) { fillSelect(selKelas, [], ''); state.kelasId = null; return; }
    var items = (state.groups[state.groupKey] || []).filter(function (it) { return it.kode_mk === state.mkCode; });
    items = items.slice().sort(sortKelas);
    fillSelect(selKelas, items.map(function (it) {
      var cap = it.daya_tampung ? ' / ' + it.daya_tampung : '';
      var jadwal = '';
      if (it.jadwal && it.jadwal.length) {
        var j = it.jadwal[0];
        jadwal = ' — ' + (j.nama_hari || '') + ' ' + (j.jam_mulai || '');
        if (it.jadwal[1]) jadwal += ' dkk';
      }
      return { value: it.id, label: 'Kelas ' + it.kelas + ' · ' + (it.jumlah_peserta != null ? it.jumlah_peserta : '?') + cap + jadwal };
    }), 'Semua kelas (' + items.length + ')');
    // default = semua kelas
    selKelas.value = '';
    state.kelasId = '';
  }

  async function getFrsId() {
    if (state.frsCache[state.smtId]) return state.frsCache[state.smtId];
    var candidates = [state.smtId].concat(state.smtList.map(function (s) { return s.semester_id; }));
    var tried = {};
    for (var i = 0; i < candidates.length; i++) {
      var smt = candidates[i];
      if (!smt || tried[smt]) continue;
      tried[smt] = 1;
      try {
        var j = await apiGet('/frs/mahasiswa/me/rencana-studi/detail?smt_id=' + encodeURIComponent(smt));
        var d = (j && j.data) || {};
        if (d && d.id) { state.frsCache[smt] = d.id; return d.id; }
      } catch (e) {}
    }
    throw new Error('Tidak ditemukan FRS aktif.');
  }

  async function loadMe() {
    try {
      var j = await apiGet('/frs/mahasiswa/me');
      var d = (j && j.data) || {};
      state.me = d;
      $('meLine').textContent = d.nama ? (d.nama + ' · ' + (d.nrp || '') + ' · ' + (d.bidang_studi_nama || '')) : '';
    } catch (e) {}
  }

  function resetResult() {
    state.peserta = null;
    state.pesertaFilter = '';
    state.multiClass = false;
    state.multiCount = 0;
    if (qInput) qInput.value = '';
    if (searchGroup) searchGroup.style.display = 'none';
    metaEl.style.display = 'none';
    tableWrap.style.display = 'none';
    tableWrap.innerHTML = '';
  }

  function currentMkKelas() {
    if (!state.groups || !state.groupKey || !state.mkCode) return [];
    return (state.groups[state.groupKey] || []).filter(function (it) { return it.kode_mk === state.mkCode; });
  }

  async function fetchPeserta(kelasId) {
    if (state.pesertaCache[kelasId]) return state.pesertaCache[kelasId];
    var frs = await getFrsId();
    var j = await apiGet('/frs/rencana-studi/' + encodeURIComponent(frs) + '/kelas/' + encodeURIComponent(kelasId) + '/peserta');
    var d = (j && (j.data || j)) || [];
    if (!Array.isArray(d)) d = [];
    state.pesertaCache[kelasId] = d;
    return d;
  }

  async function loadPeserta() {
    resetResult();
    if (!state.mkCode) { setStatus('Pilih mata kuliah dulu.'); return; }
    var tok = ++state.loadToken;
    btnBuka.disabled = true; btnBuka.textContent = 'Memuat…';
    try {
      if (state.kelasId) {
        // mode kelas tunggal
        var data = await fetchPeserta(state.kelasId);
        if (tok !== state.loadToken) return;
        state.peserta = data;
        state.multiClass = false;
        state.multiCount = 1;
      } else {
        // mode semua kelas MK ini
        var klasses = currentMkKelas().sort(sortKelas);
        if (!klasses.length) { setStatus('Tidak ada kelas untuk MK ini.'); return; }
        state.multiCount = klasses.length;
        setStatus('Memuat peserta dari ' + klasses.length + ' kelas…');
        var sorted = klasses.map(function (it, i) { return { it: it, idx: i }; });
        var rows = [];
        var next = 0;
        async function worker() {
          while (true) {
            if (tok !== state.loadToken) return;
            var i = next++;
            if (i >= sorted.length) return;
            var s = sorted[i];
            try {
              var d = await fetchPeserta(s.it.id);
              d.forEach(function (p) {
                rows.push(Object.assign({}, p, { __kelasIdx: s.idx, __kelas: String(s.it.kelas == null ? '' : s.it.kelas) }));
              });
            } catch (e) { /* lewati kelas yang gagal */ }
          }
        }
        await Promise.all([worker(), worker(), worker(), worker()]);
        if (tok !== state.loadToken) return;
        rows.sort(function (a, b) { return a.__kelasIdx - b.__kelasIdx; });
        state.peserta = rows;
        state.multiClass = true;
      }
      searchGroup.style.display = 'block';
      qInput.value = '';
      state.pesertaFilter = '';
      drawPeserta();
      setStatus('');
    } catch (e) {
      if (tok !== state.loadToken) return;
      if (e.message === 'Logout') { showLogin('Sesi kedaluwarsa. Login ulang di MIA.'); }
      else setStatus('Gagal ambil peserta: ' + e.message, true);
    } finally {
      if (tok === state.loadToken) { btnBuka.disabled = false; btnBuka.textContent = 'Lihat Peserta'; }
    }
  }

  function normText(s) { return String(s == null ? '' : s).toLowerCase().trim(); }

  function matches(p) {
    var q = state.pesertaFilter;
    if (!q) return true;
    return normText(p.nama).indexOf(q) >= 0 || normText(p.nrp).indexOf(q) >= 0;
  }

  function drawPeserta() {
    var mkLabel = selMk.selectedIndex >= 0 ? (selMk.options[selMk.selectedIndex].textContent || '').split(' — ')[0] : '';
    var klLabel = selKelas.selectedIndex >= 0 ? selKelas.options[selKelas.selectedIndex].textContent : '';
    var multi = state.multiClass && state.multiCount > 1;
    var all = state.peserta || [];
    var shown = all.filter(matches);

    tableWrap.style.display = 'block'; tableWrap.innerHTML = '';
    if (!all.length) {
      tableWrap.innerHTML = '<div class="empty">Belum ada peserta terdaftar.</div>';
      metaEl.style.display = 'none';
      return;
    }
    if (!shown.length) {
      tableWrap.innerHTML = '<div class="empty">Tidak ada peserta yang cocok dengan &ldquo;' + esc(qInput.value) + '&rdquo;.</div>';
      metaEl.style.display = 'none';
      return;
    }

    var tbl = el('table');
    tbl.innerHTML = multi
      ? '<thead><tr><th>#</th><th>Nama</th><th>NRP</th><th>Kelas</th><th>Prodi</th><th>Angkatan</th></tr></thead>'
      : '<thead><tr><th>#</th><th>Nama</th><th>NRP</th><th>Prodi</th><th>Angkatan</th></tr></thead>';
    var tb = el('tbody');
    shown.forEach(function (p, idx) {
      var tr = el('tr');
      tr.innerHTML = multi
        ? '<td>' + (idx + 1) + '</td>' +
          '<td>' + (p.nama == null ? '-' : esc(p.nama)) + '</td>' +
          '<td>' + (p.nrp == null ? '-' : esc(p.nrp)) + '</td>' +
          '<td>Kelas ' + esc(p.__kelas) + '</td>' +
          '<td>' + (p.bidang_studi == null ? '-' : esc(p.bidang_studi)) + '</td>' +
          '<td>' + (p.tahun_angkatan == null ? '-' : esc(p.tahun_angkatan)) + '</td>'
        : '<td>' + (idx + 1) + '</td>' +
          '<td>' + (p.nama == null ? '-' : esc(p.nama)) + '</td>' +
          '<td>' + (p.nrp == null ? '-' : esc(p.nrp)) + '</td>' +
          '<td>' + (p.bidang_studi == null ? '-' : esc(p.bidang_studi)) + '</td>' +
          '<td>' + (p.tahun_angkatan == null ? '-' : esc(p.tahun_angkatan)) + '</td>';
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    tableWrap.appendChild(tbl);

    metaText.innerHTML = '<b>' + shown.length + '</b> peserta' +
      (shown.length < all.length ? ' dari ' + all.length : '') +
      (multi ? ' · ' + state.multiCount + ' kelas' : '') +
      (mkLabel ? ' · ' + esc(mkLabel) : '') +
      (klLabel ? ' · ' + esc(klLabel) : '');
    $('btnCopy').onclick = function () {
      copyText(shown.map(function (p) {
        return p.nama + ' | ' + p.nrp + (multi ? ' | Kelas ' + p.__kelas : '');
      }).join('\n'));
    };
    metaEl.style.display = 'flex';
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function copyText(txt) {
    function done(ok) {
      var b = $('btnCopy');
      var old = b.textContent;
      b.textContent = ok ? 'Tersalin ✓' : 'Gagal menyalin';
      setTimeout(function () { b.textContent = old; }, 1600);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { done(true); }, function () { fallbackCopy(txt, done); });
    } else { fallbackCopy(txt, done); }
  }

  function fallbackCopy(txt, done) {
    var ta = el('textarea'); ta.value = txt;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { done(document.execCommand('copy')); } catch (e) { done(false); }
    ta.remove();
  }

  function showLogin(hint) {
    loginBox.classList.remove('hidden');
    toolBox.classList.add('hidden');
    $('loginHint').textContent = hint || '';
  }

  function showTool() {
    loginBox.classList.add('hidden');
    toolBox.classList.remove('hidden');
    $('loginHint').textContent = '';
  }

  function stopPolling() { if (loginTimer) { clearInterval(loginTimer); loginTimer = null; } }

  async function checkLogin() {
    var sess = await getSession();
    if (sess) {
      stopPolling();
      $('loginHint').textContent = 'Sesi terambil ✓ Memuat data…';
      await loadAll();
    }
  }

  function startLoginPoll() {
    stopPolling();
    loginTimer = setInterval(checkLogin, POLL_MS);
  }

  async function loadAll() {
    showTool();
    setStatus('Memuat semester…');
    try {
      await Promise.all([loadMe().catch(function () {}), loadSemesters()]);
      setStatus('Memuat daftar kelas…');
      await loadKelas();
      setStatus('');
    } catch (e) {
      if (e.message === 'Logout') { showLogin('Sesi kedaluwarsa. Login ulang di MIA.'); }
      else { setStatus('Gagal memuat: ' + e.message, true); showLogin('Terjadi kesalahan: ' + e.message); }
    }
  }

  // wiring
  $('btnLogin').addEventListener('click', function () {
    chrome.tabs.create({ url: MIA + '/rencana-studi' });
    $('loginHint').textContent = 'Login di tab MIA yang terbuka… Mengawasi otomatis.';
    startLoginPoll();
  });

  // cek otomatis lagi saat tab tool dapat fokus (user balik ke tab ini)
  window.addEventListener('focus', function () {
    if (loginBox.classList.contains('hidden')) return;
    checkLogin();
  });

  selSmt.addEventListener('change', function () {
    state.smtId = selSmt.value || null;
    state.frsCache = {};
    state.pesertaCache = {};
    resetResult();
    if (state.smtId) loadKelas().catch(function (e) { setStatus('Gagal: ' + e.message, true); });
  });
  selGrp.addEventListener('change', function () { state.groupKey = selGrp.value || null; resetResult(); fillMk(); });
  selMk.addEventListener('change', function () { state.mkCode = selMk.value || null; resetResult(); fillKelas(); });
  selKelas.addEventListener('change', function () { state.kelasId = selKelas.value || null; resetResult(); });
  btnBuka.addEventListener('click', loadPeserta);

  qInput.addEventListener('input', function () {
    state.pesertaFilter = normText(qInput.value).replace(/\s+/g, ' ');
    drawPeserta();
  });

  // init
  (async function () {
    var sess = await getSession();
    if (!sess) { showLogin(); return; }
    await loadAll();
  })();
})();