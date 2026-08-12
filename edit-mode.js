/* ============================================================
   綾錦サイト 簡易編集モード（Webflow Collaborator 風）
   使い方: 公開URLの末尾に ?edit を付けるだけ
     例) https://hirokowasi.github.io/ayanishiki/index_v2.html?edit

   - ?edit が無い通常表示には一切影響しません（UIも出ません）
   - 編集内容はブラウザ内(localStorage)に下書き保存されます
   - 「HTMLをダウンロード」で編集済みHTMLを書き出し、
     GitHubにアップロードすると公開サイトに反映されます
   ============================================================ */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  if (!params.has('edit') && location.hash !== '#edit') return;

  // ---- 対象ファイル名（下書きの保存キー / ダウンロード名に使用） ----
  var FILE = location.pathname.split('/').pop() || 'index.html';
  var STORE_KEY = 'ayanishiki-edits:' + FILE;

  // ---- 状態 ----
  var overrides = load();       // { "body[1]/div[2]/p[1]": {en:"...", jp:"..."} }
  var baseline = new Map();     // element -> {en, jp} 初期値（リセット用）
  var keyed = new Map();        // key -> element
  var editing = true;           // true: テキスト編集 / false: ページ操作
  var current = null;           // 編集中の要素

  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, SVG: 1, PATH: 1, IFRAME: 1, IMG: 1, BR: 1, HR: 1, INPUT: 1, TEXTAREA: 1, SELECT: 1, VIDEO: 1, SOURCE: 1 };
  var INLINE_TAGS = { BR: 1, STRONG: 1, EM: 1, B: 1, I: 1, SPAN: 1, SMALL: 1, SUP: 1, SUB: 1, U: 1, CODE: 1, MARK: 1, ABBR: 1, A: 1 };

  // ------------------------------------------------------------
  // 保存・読み込み
  // ------------------------------------------------------------
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(overrides)); }
    catch (e) { alert('保存に失敗しました（ブラウザの保存容量制限の可能性があります）'); }
    renderCount();
  }
  function lang() {
    return document.documentElement.getAttribute('data-lang') === 'jp' ? 'jp' : 'en';
  }

  // ------------------------------------------------------------
  // 要素のパス（HTMLファイル側の同じ要素を特定するためのキー）
  // 例: body[1]/div[3]/section[1]/h2[1]
  // ------------------------------------------------------------
  function pathOf(el) {
    var parts = [];
    while (el && el.nodeType === 1 && el !== document.documentElement) {
      var i = 1;
      for (var s = el.previousElementSibling; s; s = s.previousElementSibling) {
        if (s.tagName === el.tagName) i++;
      }
      parts.unshift(el.tagName.toLowerCase() + '[' + i + ']');
      el = el.parentElement;
    }
    return parts.join('/');
  }

  function resolvePath(doc, path) {
    var cur = doc.documentElement;
    var parts = path.split('/');
    for (var i = 0; i < parts.length; i++) {
      var m = /^([a-z0-9-]+)\[(\d+)\]$/.exec(parts[i]);
      if (!m) return null;
      var n = 0, found = null;
      for (var c = cur.firstElementChild; c; c = c.nextElementSibling) {
        if (c.tagName.toLowerCase() === m[1] && ++n === Number(m[2])) { found = c; break; }
      }
      if (!found) return null;
      cur = found;
    }
    return cur;
  }

  // ------------------------------------------------------------
  // 編集可能な「テキストのかたまり」を抽出
  //  ・data-jp を持つ要素は、その要素ごと1単位（日英切替の単位に合わせる）
  //  ・それ以外は、子がインライン要素だけの最も外側の要素
  // ------------------------------------------------------------
  function isUnit(el) {
    if (!el.textContent || !el.textContent.trim()) return false;
    for (var i = 0; i < el.children.length; i++) {
      if (!INLINE_TAGS[el.children[i].tagName]) return false;
    }
    return true;
  }

  function markEditable() {
    var all = document.body.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (SKIP_TAGS[el.tagName]) continue;
      if (el.closest('.am-ui')) continue;
      if (el.hasAttribute('data-am-key')) continue;
      // すでに編集単位の内側なら対象外
      if (el.parentElement && el.parentElement.closest('[data-am-key]')) continue;

      var ok = el.hasAttribute('data-jp')
        ? true
        : (isUnit(el) && !el.querySelector('[data-jp]'));
      if (!ok) continue;

      var key = pathOf(el);
      el.setAttribute('data-am-key', key);
      keyed.set(key, el);
      baseline.set(el, {
        en: el.innerHTML,
        jp: el.hasAttribute('data-jp') ? el.getAttribute('data-jp') : null
      });
    }
  }

  // ------------------------------------------------------------
  // 保存済みの編集内容を画面に反映
  // ------------------------------------------------------------
  function applyAll() {
    var L = lang();
    Object.keys(overrides).forEach(function (key) {
      var el = keyed.get(key);
      if (!el) return;
      var ov = overrides[key];
      if (ov.jp != null) el.setAttribute('data-jp', ov.jp);
      if (ov.en != null && el._en !== undefined && el._en !== null) el._en = ov.en;

      if (L === 'jp') {
        if (ov.jp != null) el.innerHTML = ov.jp;
        else if (ov.en != null && !el.hasAttribute('data-jp')) el.innerHTML = ov.en;
      } else if (ov.en != null) {
        el.innerHTML = ov.en;
      }
    });
    renderCount();
  }

  // ------------------------------------------------------------
  // 編集操作
  // ------------------------------------------------------------
  function startEdit(el) {
    if (current === el) return;
    if (current) finishEdit(current, true);
    current = el;
    el.setAttribute('contenteditable', 'plaintext-only');
    if (el.contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true');
    el.classList.add('am-active');
    el.dataset.amBefore = el.innerHTML;
    el.focus();
    var r = document.createRange();
    r.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function finishEdit(el, commit) {
    if (!el) return;
    var before = el.dataset.amBefore;
    if (!commit) el.innerHTML = before;
    el.removeAttribute('contenteditable');
    el.classList.remove('am-active');
    delete el.dataset.amBefore;
    if (current === el) current = null;
    if (!commit) return;

    var html = el.innerHTML;
    if (html === before) return;

    var key = el.getAttribute('data-am-key');
    var ov = overrides[key] || (overrides[key] = {});
    var base = baseline.get(el) || {};

    if (lang() === 'jp' && (el.hasAttribute('data-jp') || el._en)) {
      // 日本語表示中の編集 → data-jp（日本語テキスト）を更新
      ov.jp = html;
      el.setAttribute('data-jp', html);
      if (base.jp == null) base.jp = html; // 元々日本語訳を持たなかった要素
    } else {
      // 英語（＝HTML本文）の編集
      ov.en = html;
      if (el._en !== undefined && el._en !== null) el._en = html;
    }
    save();
    toast('保存しました（下書き）');
  }

  // ------------------------------------------------------------
  // イベント
  // ------------------------------------------------------------
  document.addEventListener('click', function (e) {
    if (e.target.closest('.am-ui')) return;
    if (!editing) return;
    var el = e.target.closest('[data-am-key]');
    if (!el) {
      if (current) finishEdit(current, true);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    startEdit(el);
  }, true);

  document.addEventListener('keydown', function (e) {
    if (!current) return;
    if (e.key === 'Escape') { e.preventDefault(); finishEdit(current, false); }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finishEdit(current, true); }
  }, true);

  document.addEventListener('focusout', function (e) {
    if (current && e.target === current) finishEdit(current, true);
  }, true);

  // 編集中は貼り付けをプレーンテキストに
  document.addEventListener('paste', function (e) {
    if (!current) return;
    e.preventDefault();
    var text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  }, true);

  // ------------------------------------------------------------
  // ダウンロード
  //   元のHTMLファイルを取得し、編集した箇所の文字列だけを置き換える。
  //   （DOMを丸ごと書き出すと無関係な行まで差分が出るため）
  // ------------------------------------------------------------
  function attrEscape(s) {
    return String(s).replace(/"/g, '&quot;');
  }

  // 同じ文字列がHTML内に何度も現れるため、「ドキュメント順で何番目か」で位置を特定する
  function nthIndexOf(text, needle, n) {
    var pos = -1;
    for (var i = 0; i <= n; i++) {
      pos = text.indexOf(needle, pos + 1);
      if (pos < 0) return -1;
    }
    return pos;
  }

  function ordinalByInner(doc, el) {
    var tag = el.tagName.toLowerCase();
    var inner = el.innerHTML;
    var list = doc.querySelectorAll(tag), n = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i] === el) return n;
      if (list[i].innerHTML === inner) n++;
    }
    return -1;
  }

  function ordinalByJp(doc, el, value) {
    var list = doc.querySelectorAll('[data-jp]'), n = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i] === el) return n;
      if (list[i].getAttribute('data-jp') === value) n++;
    }
    return -1;
  }

  // 元HTML（文字列）に対する差し替え操作を組み立てる。
  // 位置がずれないよう、いったん全部の位置を出してから後ろ側から適用する。
  function patchSource(text, doc) {
    var ops = [], failed = [], touched = {};

    Object.keys(overrides).forEach(function (key) {
      var el = resolvePath(doc, key);
      if (!el) { failed.push(key); return; }
      var ov = overrides[key];
      var tag = el.tagName.toLowerCase();
      var oldInner = el.innerHTML;
      var innerNeedle = '>' + oldInner + '</' + tag;
      var ok = true;

      // 本文（英語＝HTML本文）の差し替え
      if (ov.en != null && ov.en !== oldInner) {
        var ord = ordinalByInner(doc, el);
        var pos = ord < 0 ? -1 : nthIndexOf(text, innerNeedle, ord);
        if (pos < 0) { ok = false; }
        else ops.push({ start: pos + 1, end: pos + 1 + oldInner.length, text: ov.en, key: key });
      }

      // 日本語（data-jp属性）の差し替え／追加
      if (ok && ov.jp != null) {
        var oldJp = el.getAttribute('data-jp');
        if (oldJp === ov.jp) { /* すでに同じ内容 */ }
        else if (oldJp != null) {
          var escOld = attrEscape(oldJp);
          var needle = 'data-jp="' + escOld + '"';
          var jOrd = ordinalByJp(doc, el, oldJp);
          var jPos = jOrd < 0 ? -1 : nthIndexOf(text, needle, jOrd);
          if (jPos < 0) { ok = false; }
          else ops.push({
            start: jPos + 'data-jp="'.length,
            end: jPos + 'data-jp="'.length + escOld.length,
            text: attrEscape(ov.jp), key: key
          });
        } else {
          // 元々 data-jp を持たない要素 → 開始タグに属性を追加
          var aOrd = ordinalByInner(doc, el);
          var anchor = aOrd < 0 ? -1 : nthIndexOf(text, innerNeedle, aOrd);
          var open = anchor < 0 ? -1 : text.lastIndexOf('<' + tag, anchor);
          if (open < 0) { ok = false; }
          else {
            var at = open + tag.length + 1;
            ops.push({ start: at, end: at, text: ' data-jp="' + attrEscape(ov.jp) + '"', key: key });
          }
        }
      }

      if (!ok) failed.push(key);
      else touched[key] = 1;
    });

    // 失敗した項目の操作は捨てる／後ろから適用して位置ずれを防ぐ
    ops = ops.filter(function (o) { return touched[o.key]; })
      .sort(function (a, b) { return b.start - a.start; });

    var last = Infinity;
    ops.forEach(function (o) {
      if (o.end > last) { // 範囲が重なる場合は安全側で見送り
        failed.push(o.key);
        delete touched[o.key];
        return;
      }
      text = text.slice(0, o.start) + o.text + text.slice(o.end);
      last = o.start;
    });

    return { text: text, applied: Object.keys(touched).length, failed: failed };
  }

  function downloadHtml() {
    fetch(FILE, { cache: 'no-store' })
      .then(function (r) { return r.text(); })
      .then(function (text) {
        var doc = new DOMParser().parseFromString(text, 'text/html');
        var res = patchSource(text, doc);
        var out = res.text;
        var blob = new Blob([out], { type: 'text/html;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = FILE;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        if (res.failed.length) {
          toast(res.applied + '件を書き出し／' + res.failed.length + '件は反映できませんでした');
          console.warn('[編集モード] 反映できなかった箇所:', res.failed);
          alert(res.failed.length + '件は元のHTML内で場所を特定できませんでした。\n' +
            '「変更一覧をコピー」で内容を控えて、手作業で反映してください。');
        } else {
          toast(res.applied + '件を反映したHTMLを書き出しました');
        }
      })
      .catch(function () {
        alert('HTMLの読み込みに失敗しました。\nローカルの file:// で開いている場合は、公開URL（https://…）でお試しください。');
      });
  }

  function copyChanges() {
    var lines = [];
    Object.keys(overrides).forEach(function (key) {
      var el = keyed.get(key);
      var base = el ? baseline.get(el) : null;
      var ov = overrides[key];
      lines.push('■ ' + key);
      if (ov.en != null) lines.push('  [EN] ' + (base ? strip(base.en) : '') + '  →  ' + strip(ov.en));
      if (ov.jp != null) lines.push('  [JP] ' + (base && base.jp ? strip(base.jp) : '(なし)') + '  →  ' + strip(ov.jp));
    });
    var txt = lines.join('\n') || '変更はありません';
    navigator.clipboard.writeText(txt).then(
      function () { toast('変更一覧をコピーしました'); },
      function () { window.prompt('コピーしてください', txt); }
    );
  }

  function strip(html) {
    var d = document.createElement('div');
    d.innerHTML = html || '';
    return d.textContent.replace(/\s+/g, ' ').trim();
  }

  function resetAll() {
    if (!window.confirm('この端末に保存した編集内容をすべて破棄します。よろしいですか？')) return;
    localStorage.removeItem(STORE_KEY);
    overrides = {};
    location.reload();
  }

  // ------------------------------------------------------------
  // 編集バー（UI）
  // ------------------------------------------------------------
  var bar, countEl, modeBtn, toastEl;

  function buildUI() {
    var css = document.createElement('style');
    css.textContent = [
      '.am-ui{font-family:-apple-system,"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;}',
      '#am-bar{position:fixed;left:14px;bottom:14px;z-index:99999;background:#111110;color:#F2EEE7;',
      'border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.35);padding:10px 12px;width:250px;max-width:calc(100vw - 28px);font-size:12px;line-height:1.55;}',
      '#am-bar h6{font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:500;display:flex;align-items:center;gap:6px;}',
      '#am-bar h6::before{content:"";width:7px;height:7px;border-radius:50%;background:#7BC49A;flex:none;}',
      '#am-bar h6 .am-fold{margin-left:auto;cursor:pointer;padding:0 5px;opacity:.7;font-size:13px;line-height:1;}',
      '#am-bar h6 .am-fold:hover{opacity:1;}',
      '#am-bar .am-body{margin-top:8px;}',
      '#am-bar.am-folded .am-body{display:none;}',
      '#am-bar .am-row{display:flex;gap:6px;margin-top:8px;}',
      '#am-bar button{flex:1;font:inherit;font-size:11px;padding:7px 6px;border:1px solid rgba(242,238,231,.28);',
      'background:transparent;color:#F2EEE7;border-radius:6px;cursor:pointer;transition:.15s;}',
      '#am-bar button:hover{background:rgba(242,238,231,.14);}',
      '#am-bar button.am-primary{background:#F2EEE7;color:#111110;border-color:#F2EEE7;font-weight:600;}',
      '#am-bar button.am-primary:hover{background:#fff;}',
      '#am-bar .am-note{color:rgba(242,238,231,.6);font-size:10.5px;margin-top:9px;border-top:1px solid rgba(242,238,231,.18);padding-top:8px;}',
      '#am-bar .am-count{color:#7BC49A;}',
      '#am-toast{position:fixed;left:16px;bottom:16px;z-index:100000;background:#2A4A3E;color:#F2EEE7;',
      'padding:9px 14px;border-radius:8px;font-size:12px;opacity:0;transform:translateY(8px);transition:.2s;pointer-events:none;}',
      '#am-toast.show{opacity:1;transform:translateY(0);}',
      'body.am-editing [data-am-key]{outline:1px dashed rgba(42,74,62,.45);outline-offset:2px;cursor:text;}',
      'body.am-editing [data-am-key]:hover{outline:1px solid #2A4A3E;background:rgba(123,196,154,.14);}',
      'body.am-editing [data-am-key].am-active{outline:2px solid #2A4A3E;background:rgba(123,196,154,.2);}'
    ].join('');
    document.head.appendChild(css);

    bar = document.createElement('div');
    bar.id = 'am-bar';
    bar.className = 'am-ui';
    bar.innerHTML =
      '<h6>編集モード<span class="am-fold" data-am-act="fold" title="折りたたむ">－</span></h6>' +
      '<div class="am-body">' +
      '<div>変更 <span class="am-count">0</span> 件（この端末に下書き保存）</div>' +
      '<div class="am-row"><button data-am-act="mode">クリックで編集：ON</button></div>' +
      '<div class="am-row"><button data-am-act="en">EN</button><button data-am-act="jp">日本語</button></div>' +
      '<div class="am-row"><button class="am-primary" data-am-act="dl">HTMLをダウンロード</button></div>' +
      '<div class="am-row"><button data-am-act="copy">変更一覧をコピー</button><button data-am-act="reset">破棄</button></div>' +
      '<div class="am-row"><button data-am-act="exit">編集モードを終了</button></div>' +
      '<div class="am-note">文字をクリックして直接書き換えられます。Enterで確定 / Escで取り消し。' +
      '公開に反映するには、書き出したHTMLをGitHubにアップロードしてください。</div>' +
      '</div>';
    document.body.appendChild(bar);

    toastEl = document.createElement('div');
    toastEl.id = 'am-toast';
    toastEl.className = 'am-ui';
    document.body.appendChild(toastEl);

    countEl = bar.querySelector('.am-count');
    modeBtn = bar.querySelector('[data-am-act="mode"]');

    bar.addEventListener('click', function (e) {
      var act = e.target.getAttribute && e.target.getAttribute('data-am-act');
      if (!act) return;
      if (act === 'fold') setFolded(!bar.classList.contains('am-folded'));
      else if (act === 'mode') setEditing(!editing);
      else if (act === 'en' || act === 'jp') { if (window.setLang) window.setLang(act); }
      else if (act === 'dl') downloadHtml();
      else if (act === 'copy') copyChanges();
      else if (act === 'reset') resetAll();
      else if (act === 'exit') location.href = location.pathname;
    });
  }

  function setFolded(on) {
    bar.classList.toggle('am-folded', on);
    bar.querySelector('.am-fold').textContent = on ? '＋' : '－';
    bar.querySelector('.am-fold').title = on ? '開く' : '折りたたむ';
    try { localStorage.setItem('ayanishiki-edit-folded', on ? '1' : '0'); } catch (e) {}
  }

  function setEditing(on) {
    editing = on;
    if (!on && current) finishEdit(current, true);
    document.body.classList.toggle('am-editing', on);
    modeBtn.textContent = 'クリックで編集：' + (on ? 'ON' : 'OFF（ページ操作）');
    toast(on ? 'テキストをクリックすると編集できます' : 'ページ操作モード：リンクやタブが通常どおり動きます');
  }

  function renderCount() {
    if (countEl) countEl.textContent = String(Object.keys(overrides).length);
  }

  var toastTimer;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.style.left = '300px';
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }

  // ------------------------------------------------------------
  // 起動
  // ------------------------------------------------------------
  function boot() {
    buildUI();
    markEditable();
    applyAll();
    setEditing(true);
    try { setFolded(localStorage.getItem('ayanishiki-edit-folded') === '1'); } catch (e) {}

    // 言語切替のたびに編集内容を再適用
    if (typeof window.setLang === 'function') {
      var orig = window.setLang;
      window.setLang = function () {
        var r = orig.apply(this, arguments);
        applyAll();
        return r;
      };
    }
  }

  // 既存スクリプトの言語復元（load時）より後に走らせる
  if (document.readyState === 'complete') boot();
  else window.addEventListener('load', function () { setTimeout(boot, 0); });
})();
