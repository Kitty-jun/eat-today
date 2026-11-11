// 今天吃什么 · 页面和交互（规则在 core.js，菜库在 menu.js）
(function () {
  const C = window.Core, MENU = window.MENU, CFG = window.CONFIG;
  // 按食材和成分表算出每道菜的营养；食材名写错会列在这里
  const MENU_ERRORS = C.prepareMenu(MENU, window.FOOD, CFG);
  const MEALS = C.MEALS;
  const KEY = 'jz3c-v1';

  // ---------- 测试用：?date=2026-11-10&hour=12 模拟日期和时间，?reset=1 清空数据 ----------
  const qs = new URLSearchParams(location.search);
  if (qs.get('reset') === '1') { try { localStorage.removeItem(KEY); } catch (e) {} }
  function now() {
    const d = new Date();
    return { date: qs.get('date') || C.dateStr(d), hour: qs.has('hour') ? Number(qs.get('hour')) : d.getHours() };
  }

  // ---------- 存储（只存在这台手机的浏览器里） ----------
  let mem = null;
  function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (e) {}
    return mem;
  }
  function save() { mem = DB; try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch (e) {} }

  let DB = load() || { start: null, introSeen: false, dislikes: null, days: {} };
  if (!DB.dislikes) DB.dislikes = CFG.初始不爱吃.map(名称 => ({ 类型: '食材', 名称, 来源: '初始' }));
  if (!DB.start) DB.start = now().date;
  Object.values(DB.days).forEach(d => C.MEALS.forEach(m => { if (d.meals[m].rec === '没按') d.meals[m].rec = '没吃'; }));
  // 菜库版本：菜品ID、菜名、类别、食材任何一样变了，版本就变。
  // 旧版菜库存下的日子里，同一个 ID 可能已经换成了别的菜（v0.1 的 A-06 是茶叶蛋，v0.2 是玉米），
  // 所以版本不同、还没记录过的日子一律作废重配；已经记录过的留着当历史。
  const MENU_VER = (() => {
    const str = JSON.stringify(MENU.map(d => [d.菜品ID, d.菜名, d.类别, d.食材]));
    let h = 5381; for (let i = 0; i < str.length; i++) h = (h * 33 + str.charCodeAt(i)) >>> 0;
    return h.toString(36);
  })();
  const recorded = d => C.MEALS.some(m => d.meals[m].rec || d.meals[m].party);
  Object.keys(DB.days).forEach(k => {
    const d = DB.days[k];
    if (C.allIds(d).some(id => !C.byId(MENU, id)) || (d.ver !== MENU_VER && !recorded(d))) delete DB.days[k];
  });
  save();

  // ---------- 页面状态（不存） ----------
  const S = { tab: 'today', cur: null, peek: false, sheet: null, toast: '', rolling: false, pop: false,
    flash: null, newCk: null, how: {}, hintMeal: null, lastSwap: null, showIntro: !DB.introSeen };

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const dish = id => C.byId(MENU, id);
  const r10 = n => Math.round(n / 10) * 10;
  // 文案：一项里有几句就随机一句；{称呼} 等占位换成实际值
  const W = CFG.文案 || {};
  function say(k, vars) {
    let t = W[k]; if (Array.isArray(t)) t = t[Math.floor(Math.random() * t.length)];
    if (!t) return '';
    return esc(String(t).replace(/\{(\w+|[一-龥]+)\}/g, (_, v) => v === '称呼' ? (CFG.称呼 || '') : (vars && vars[v] != null ? vars[v] : '')));
  }
  function greet(hour) { return hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好'; }
  // 第几天：开始那天算第 1 天
  const dayNo = date => Math.max(1, C.diffDays(DB.start, date) + 1);
  const followCount = upto => Object.keys(DB.days).filter(k => k <= upto).reduce((a, k) => a + MEALS.filter(m => DB.days[k].meals[m].rec === '照着吃了').length, 0);
  const WEEK = '日一二三四五六';
  function dateLabel(s) { const d = C.parseDate(s); return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEK[d.getDay()]}`; }
  function shortDate(s) { const d = C.parseDate(s); return `${d.getMonth() + 1}月${d.getDate()}日`; }

  // ---------- 今天的三餐（当天第一次打开时，系统自动从菜库里挑） ----------
  function today() {
    const t = now().date;
    if (!DB.days[t]) {
      const recent = C.recentIds(DB.days, t, CFG.几天内不重复);
      const day = C.generateDay(MENU, CFG, t, DB.dislikes, recent);
      if (!day) return null;
      day.ver = MENU_VER;
      DB.days[t] = day;
      // 只留最近 60 天
      Object.keys(DB.days).forEach(k => { if (C.diffDays(k, t) > 60) delete DB.days[k]; });
      save();
    }
    return DB.days[t];
  }

  const done = m => !!(m.rec || m.party);
  function kcalText(meal) {
    const s = C.sumOf(MENU, meal.items);
    return s.lo === s.hi ? `${s.lo} 千卡` : `约 ${r10((s.lo + s.hi) / 2)} 千卡`;
  }
  function kcalNum(meal) { const s = C.sumOf(MENU, meal.items); return s.lo === s.hi ? s.lo : r10((s.lo + s.hi) / 2); }
  function placeOf(day, m) { return CFG.地点[C.menuOf(day.mode, m)]; }

  function defaultMeal(day) {
    const byTime = C.mealByHour(now().hour, CFG);
    if (!done(day.meals[byTime])) return byTime;
    return MEALS.find(m => !done(day.meals[m])) || '晚餐';
  }

  // ================= 渲染 =================
  const $view = document.getElementById('view'), $layer = document.getElementById('layer');

  function render() {
    document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === (S.tab === 'today' ? 'today' : 'log')));
    if (S.tab === 'today') $view.innerHTML = viewToday();
    else if (S.tab === 'log') $view.innerHTML = viewLog();
    else if (S.tab === 'dislikes') $view.innerHTML = viewDislikes();
    $layer.innerHTML = viewLayer();
    S.pop = false; S.flash = null; S.newCk = null;
  }

  function viewToday() {
    const day = today();
    const t = now();
    const n = dayNo(t.date);
    let h = `<div class="top"><div><div class="d1">${dateLabel(t.date)} · 第 ${n} 天</div><div class="d2">${CFG.称呼 ? `${greet(t.hour)}，${esc(CFG.称呼)}` : `第 ${n} 天`}</div></div>
      <div class="tot"><span class="wk ${day && day.mode === '周末' ? 'we' : ''}">${day && day.mode === '周末' ? '周末 · 在家做' : '工作日'}</span>
      <div class="tv">今天约 <b>${CFG.每日热量目标}</b> 千卡</div></div></div>`;
    if (MENU_ERRORS.length) return h + `<div class="res"><div class="main" style="padding:18px 16px"><div class="nm" style="font-size:18px">菜库有写错的地方</div>
      <div class="sp">${MENU_ERRORS.map(esc).join('<br>')}</div></div></div>`;
    if (!day) return h + `<div class="res"><div class="main" style="padding:18px 16px"><div class="nm" style="font-size:18px">今天的菜配不出来</div>
      <div class="sp">菜单里能吃的菜太少了，凑不齐三顿。请让 Kitty 检查菜单。</div></div></div>`;
    if (!S.cur) S.cur = defaultMeal(day);
    const ms = W.里程碑 && W.里程碑[n];
    if (ms && !(DB.msSeen || []).includes(n)) {
      h += `<div class="ms"><button class="x" data-act="msok" data-n="${n}" aria-label="关闭">✕</button><div class="me">${esc(ms[0])}</div>
        <div class="mt">${esc(ms[1])}</div><div class="mp">${esc(ms[2]).replace('{顿}', followCount(t.date))}</div></div>`;
    }


    const allDone = MEALS.every(m => done(day.meals[m]));
    h += segHtml(day, allDone && !S.peek);
    if (allDone && !S.peek) return h + summaryHtml(day);

    const m = S.cur, meal = day.meals[m];
    if (meal.party) {
      h += `<div class="party"><div class="pt">${m} · 聚餐 🍻</div><div class="pw">${say('聚餐')}</div><ol><li>先吃蔬菜和肉，再吃主食</li><li>主食少吃</li><li>饮料喝无糖的</li></ol>
        <div class="pp">另外两顿照常吃，明天也不用补回来。</div><button class="pu" data-act="unparty">不聚餐了，抽一下</button></div>`;
    } else if (S.rolling) {
      h += `<div class="draw"><div class="q1">${m}吃什么？</div><div class="q2">正在抽……</div>
        <div class="roll"><div class="win"></div><div class="names" id="names"></div></div><span class="lnk" style="visibility:hidden">.</span></div>`;
    } else if (!meal.revealed) {
      h += `<div class="draw"><div class="q1">${m}吃什么？</div><div class="q2">这顿约 ${CFG.三餐热量参考[m]} 千卡 · ${placeOf(day, m)}</div>
        <button class="dbtn" data-act="draw" aria-label="抽${m}">抽</button>
        <button class="lnk" data-act="sheet" data-sheet="party">这顿是聚餐？</button></div>`;
    } else {
      h += cardHtml(day, m);
    }
    if (allDone && S.peek) h += `<div class="center"><button class="lnk" data-act="summary">看今天合计</button></div>`;
    return h;
  }

  function segHtml(day, none) {
    const hour = now().hour;
    let h = `<div class="seg ${none ? 'none' : ''}">`;
    MEALS.forEach(m => {
      const x = day.meals[m];
      const mark = x.party ? '<span class="ck">🍻</span>' : x.rec ? `<span class="ck ${S.newCk === m ? 'new' : ''}">✓</span>` :
        C.isPassed(m, hour, CFG) ? '<i class="rd"></i>' : '';
      // 每顿一格：餐名 + 这顿的热量，底下一条小进度（揭晓了就变绿，聚餐是橙色）
      const sub = x.party ? '聚餐' : x.revealed ? `${kcalNum(x)} 千卡` : '待揭晓';
      h += `<button class="${m === S.cur && !none ? 'on' : ''}" data-act="meal" data-meal="${m}"><span class="sn">${m}${mark}</span>
        <span class="sk ${x.revealed || x.party ? 'v' : ''}">${sub}</span><i class="sb ${x.party ? 'party' : x.revealed ? 'on' : ''}"></i></button>`;
    });
    return h + '</div>';
  }

  function cardHtml(day, m) {
    const meal = day.meals[m], recorded = !!meal.rec, weekend = day.mode === '周末';
    const ds = meal.items.map(dish);
    const multi = !(ds.length === 1 && !weekend);
    let h = `<div class="res ${S.pop ? 'pop' : ''}"><div class="rh"><span>${m} · ${placeOf(day, m)}</span><span class="rr"><span class="kc">${kcalText(meal)}</span>${multi ? '<button class="mo" data-act="sheet" data-sheet="more" aria-label="更多">⋯</button>' : ''}</span></div>`;
    if (!multi) {
      const d = ds[0];
      h += `<div class="main"><div class="nm ${S.flash && S.flash.meal === m ? 'flash' : ''}">${esc(d.菜名)}${d.份数 > 1 ? ' ×' + d.份数 : ''}</div>
        <div class="sp">${esc(d.店名)}</div>${d.点单规则 ? `<div class="how"><b>怎么点</b>${esc(d.点单规则)}</div>` : ''}
        <div class="meta"><span>蛋白质约 ${d.蛋白质} g</span>${d.蔬菜克数 > 0 ? '<span>有蔬菜</span>' : ''}</div></div>`;
      h += hintHtml(day, m);
      h += `<div class="ops">${recorded ? '' : '<button class="ob swp" data-act="swap" data-idx="0">↻ 换一个</button>'}
        <button class="ob more ${recorded ? 'wide' : ''}" data-act="sheet" data-sheet="more">${recorded ? '⋯ 更多' : '⋯'}</button></div>`;
    } else {
      h += `<div class="items">`;
      ds.forEach((d, i) => {
        const sub = weekend ? d.食材.filter(([n]) => !['姜', '蒜', '糖', '淀粉'].includes(n)).map(([n, g]) => `${esc(n)} ${g} g`).join(' · ') : `${esc(d.店名)} · 约 ${r10((d.热量下限 + d.热量上限) / 2)} 千卡`;
        const open = S.how[d.菜品ID];
        h += `<div class="it ${S.flash && S.flash.meal === m && S.flash.idx === i ? 'flash' : ''}"><div class="in">
          <b>${esc(d.菜名)}${d.份数 > 1 ? ' ×' + d.份数 : ''}</b><small>${sub}</small>
          ${d.点单规则 ? `<div class="rule">${esc(d.点单规则)}</div>` : ''}
          ${d.做法 ? `<button class="hw" data-act="how" data-id="${d.菜品ID}">${open ? '收起做法' : '看做法 ›'}</button>${open ? `<div class="hwt">${esc(d.做法)}</div>` : ''}` : ''}
          </div>${recorded ? '' : `<button class="sw" data-act="swap" data-idx="${i}" aria-label="换一个">↻ 换一个</button>`}</div>`;
      });
      h += `</div>` + hintHtml(day, m);
    }
    const ate = meal.rec === '换了别的' && meal.ate ? (meal.ate.菜品ID ? dish(meal.ate.菜品ID)?.菜名 : meal.ate.文字) : '';
    h += `<div class="rec"><div class="rl">${recorded ? '已记录，今天内可以改' : '吃完点一下'}${ate ? `　实际吃了：<b>${esc(ate)}</b>` : ''}</div><div class="rb">` +
      ['照着吃了', '换了别的', '没吃'].map(r => `<button class="${meal.rec === r ? 'p' : ''}" data-act="rec" data-rec="${r}">${r}</button>`).join('') + `</div></div></div>`;
    return h;
  }

  // 换完不合格（换不出合格的菜时才会出现）：只提示，不偷偷改已揭晓的菜
  function hintHtml(day, m) {
    if (S.hintMeal !== m || day.meals[m].rec) return '';
    const ev = C.evaluate(MENU, CFG, day.meals);
    if (ev.ok) return '';
    const p = ev.problems[0];
    let msg, tail = '今天少一点也没关系。';
    if (p.k === 'kcal' && p.over) { msg = `今天热量多了约 ${Math.max(10, r10(p.d))} 千卡`; tail = '偶尔多一点也没关系。'; }
    else if (p.k === 'kcal') msg = `今天热量少了约 ${Math.max(10, r10(p.d))} 千卡`;
    else if (p.k === 'protein') msg = `今天蛋白质还差约 ${Math.ceil(p.d)} g`;
    else if (p.k === 'proteinHigh') { msg = '今天蛋白质偏多了'; tail = '偶尔多一点也没关系。'; }
    else if (p.k === 'fat') { msg = p.over ? '今天油脂偏多了' : '今天油脂偏少了'; tail = p.over ? '偶尔多一点也没关系。' : tail; }
    else if (p.k === 'carb') { msg = p.over ? '今天主食偏多了' : '今天主食偏少了'; tail = p.over ? '偶尔多一点也没关系。' : tail; }
    else if (p.k === 'veg') msg = p.noVegMeal ? '有一顿没有蔬菜' : `今天蔬菜还差约 ${Math.ceil(p.d)} g`;
    else { msg = `这一顿${p.over ? '吃得偏多' : '吃得偏少'}`; tail = p.over ? '偶尔多一点也没关系。' : tail; }
    return `<div class="hint"><b>换完以后，${msg}</b><br>可以再换一次，或者就这样吃，${tail}
      <div class="ha"><button data-act="reswap">再换一次</button><button class="g" data-act="nohint">就这样吃</button></div></div>`;
  }

  function summaryHtml(day) {
    const ev = C.actualOf(MENU, CFG, day.meals);
    const allFollow = MEALS.every(m => day.meals[m].rec === '照着吃了');
    const skip = ev.party + ev.unknown;
    const why = [ev.party ? `聚餐 ${ev.party} 顿` : '', ev.unknown ? `换了别的没选菜 ${ev.unknown} 顿` : ''].filter(Boolean).join('、');
    const tag = ok => skip ? '' : ok ? '<i>✓ 达标</i>' : '<i class="no">差一点</i>';
    return `<div class="all"><div class="ae">🎉</div><div class="at">${allFollow ? say('三顿都照着吃完') : say('三顿都记好')}</div>
      <div class="sp">按实际吃的算${skip ? `，有 ${skip} 顿没算进去（${why}）` : ''}</div>
      <div class="as"><div><b>约 ${r10(ev.mid)}</b>千卡<br>${tag(ev.kcalOk)}</div><div><b>约 ${ev.protein} g</b>蛋白质<br>${tag(ev.proteinOk)}</div>
      <div><b>约 ${ev.veg} g</b>蔬菜<br>${tag(ev.vegOk)}</div></div>
      <div class="aw">🚶 今天多走走，目标 ${CFG.走路目标} 步</div></div>
      <div class="center"><span class="sp">点上面的早餐、午餐、晚餐，可以回看那一顿</span></div>`;
  }

  // ---------- 记录页 ----------
  function viewLog() {
    const t = now().date, n = dayNo(t);
    const cnt = { 照着吃了: 0, 换了别的: 0, 没吃: 0, 聚餐: 0 };
    Object.keys(DB.days).forEach(k => {
      if (C.diffDays(DB.start, k) < 0 || k > t) return;
      MEALS.forEach(m => { const r = DB.days[k].meals[m].rec; if (r && cnt[r] !== undefined) cnt[r]++; });
    });
    const total = cnt.照着吃了 + cnt.换了别的 + cnt.没吃 + cnt.聚餐;
    let h = `<div class="top"><div><div class="d1">${shortDate(DB.start)}开始 · 挑战 30 天</div><div class="d2">我的记录</div></div><span class="wk">第 ${n} 天</span></div>
      <div class="big"><div class="x">${say('记录大数字', { n })}</div><div class="y">${cnt.照着吃了} 顿</div><div class="x">已经记了 ${total} 顿</div></div>
      <div class="cnt"><div><b>${cnt.换了别的}</b>换了别的</div><div><b>${cnt.没吃}</b>没吃</div><div><b>${cnt.聚餐}</b>聚餐</div></div>
      <div class="cal"><div class="ch">30 天 · 每格一天（颜色看那天照着吃了几顿）</div><div class="cg">`;
    for (let i = 0; i < 30; i++) {
      const d = C.addDays(DB.start, i);
      let cls = 'f';
      if (d <= t) {
        const day = DB.days[d];
        const k = day ? MEALS.filter(m => day.meals[m].rec === '照着吃了').length : 0;
        cls = k === 3 ? 'a' : k > 0 ? 'b' : 'c';
      }
      h += `<button class="${cls} ${d === t ? 't' : ''}" ${d <= t ? `data-act="dayinfo" data-date="${d}"` : 'tabindex="-1"'} aria-label="第 ${i + 1} 天">${i + 1}</button>`;
    }
    h += `</div><div class="lg"><span><i style="background:var(--main)"></i>3 顿都照着吃</span><span><i style="background:#9cc9ad"></i>1～2 顿</span>
      <span><i style="background:#d2ccc1"></i>0 顿</span><span><i style="outline:2px solid var(--hot)"></i>今天</span></div></div>
      <button class="lrow" data-act="tab" data-tab="dislikes"><span>🙅 不爱吃名单</span><small>${DB.dislikes.length} 项 ›</small></button>
      <button class="lrow" data-act="help"><span>📖 使用说明</span><small>›</small></button>
      <div class="foot">${say('记录底部')}</div>`;
    return h;
  }

  function viewDislikes() {
    const list = DB.dislikes.map((d, i) => ({ d, i })).sort((a, b) => (a.d.来源 === '初始' ? 0 : 1) - (b.d.来源 === '初始' ? 0 : 1));
    let h = `<button class="back" data-act="tab" data-tab="log">‹ 记录</button>
      <div class="top"><div><div class="d2">不爱吃 🙅</div><div class="d1">名单里的菜和食材，以后都不会被抽到</div></div></div><div class="nl">`;
    if (!list.length) h += `<div class="empty">名单是空的</div>`;
    list.forEach(({ d, i }) => {
      const sub = d.来源 === '初始' ? '一开始就有' : `${shortDate(d.日期)} 加的${d.店名 ? ' · ' + esc(d.店名) : ''}`;
      h += `<div class="ni"><span class="ty">${d.类型}</span><span class="nn">${esc(d.名称)}<small>${sub}</small></span>
        <button class="un" data-act="undislike" data-i="${i}">撤回</button></div>`;
    });
    return h + `</div><div class="foot">在今天的菜上点「⋯」→「以后不想再吃到」，就会加到这里。</div>`;
  }

  // ---------- 弹层 ----------
  function viewLayer() {
    let h = '';
    if (S.showIntro) h += introHtml();
    const sh = S.sheet;
    if (sh) {
      h += `<div class="mask" data-act="close"></div><div class="sheet" role="dialog"><div class="grab"></div>`;
      const day = today();
      if (sh.type === 'more') {
        const meal = day.meals[S.cur], ds = meal.items.map(dish), s = C.sumOf(MENU, meal.items), wk = day.mode !== '周末';
        h += `<div class="s1">${ds.length === 1 ? esc(ds[0].菜名) : S.cur}</div><div class="s2">${placeOf(day, S.cur)}</div>
          <div class="mi static"><span class="mx">📊</span><div>营养详情<small>热量${wk ? `约 ${r10(s.lo)}～${r10(s.hi)}` : ` ${s.kcal}`} 千卡 · 蛋白质 ${Math.round(s.protein)} g · 脂肪 ${Math.round(s.fat)} g · 碳水 ${Math.round(s.carb)} g · 蔬菜 ${s.veg} g
          <br>按下面的克数和《中国食物成分表》算${wk ? '；外面的份量会有出入，所以给的是 ±15% 的范围' : ''}</small>
          ${ds.map(d => `<small>· ${esc(d.菜名)}：${d.食材.map(([n, g]) => `${esc(n)} ${g} g`).join('、')}${d.待核 ? `（${esc(d.待核)}）` : ''}</small>`).join('')}</div></div>`;
        ds.forEach((d, i) => { h += `<button class="mi red" data-act="sheet" data-sheet="dislike" data-idx="${i}"><span class="mx">🙅</span><div>以后不想再吃到${ds.length > 1 ? '：' + esc(d.菜名) : ''}<small>选整道菜，或者里面的某样东西</small></div></button>`; });
        h += `<button class="btn sec" data-act="close">取消</button>`;
      } else if (sh.type === 'dislike') {
        const d = dish(day.meals[S.cur].items[sh.idx]);
        const ings = C.ingredientsOf(d, CFG);
        h += `<div class="s1">以后不想再吃到？</div><div class="s2">选了以后就不会再被抽到，可以在「记录 → 不爱吃名单」里撤回</div>
          <button class="opt ${!sh.ing ? 'on' : ''}" data-act="pickdish">整道菜：${esc(d.菜名)}${d.店名 ? `<small>${esc(d.店名)}</small>` : ''}</button>`;
        if (ings.length) h += `<div class="opt ${sh.ing ? 'on' : ''}">只是不吃里面的某样东西<div class="chips">${ings.map(x => `<button class="${sh.ing === x ? 'on' : ''}" data-act="picking" data-ing="${esc(x)}">${esc(x)}</button>`).join('')}</div>
          <small>所有带这样东西的菜都不会再出现</small></div>`;
        h += `<button class="btn pri" data-act="dislike">确定</button><button class="btn sec" data-act="close">取消</button>`;
      } else if (sh.type === 'party') {
        h += `<div class="s1">${S.cur}是聚餐？</div><div class="s2">这一顿就不用照工具吃了，另外两顿照常</div>
          <button class="btn hot" data-act="party">是，这顿聚餐</button><button class="btn sec" data-act="close">取消</button>`;
      } else if (sh.type === 'ate') {
        h += `<div class="s1">吃了啥？</div><div class="s2">可以不填。从菜库里选的会算进今天合计；随手写的只记下来，不算热量。</div>
          <input class="inp" id="ateq" placeholder="搜菜名，比如 牛肉面" value="${esc(sh.q)}" autocomplete="off">
          <div id="atelist">${ateList(sh)}</div>
          <div class="s2" style="margin:12px 0 6px">菜库里没有？随手写几个字</div>
          <input class="inp" id="atetext" placeholder="比如 同事请的炸鸡" value="${esc(sh.text)}" autocomplete="off">
          <button class="btn pri" data-act="atesave">确定</button><button class="btn sec" data-act="ateskip">跳过，不填了</button>`;
      } else if (sh.type === 'day') {
        const d = DB.days[sh.date], n = dayNo(sh.date);
        h += `<div class="s1">第 ${n} 天 · ${dateLabel(sh.date)}</div><div class="daylist">`;
        MEALS.forEach(m => {
          const x = d && d.meals[m];
          const name = !x ? '—' : x.party ? '聚餐' : x.revealed ? x.items.map(id => dish(id) ? dish(id).菜名 : '').join('、') : '没抽';
          const ate = x && x.rec === '换了别的' && x.ate ? (x.ate.菜品ID ? dish(x.ate.菜品ID)?.菜名 : x.ate.文字) : '';
          h += `<div><span>${m} · ${esc(name)}${ate ? `<br><small style="color:var(--sub)">实际吃了：${esc(ate)}</small>` : ''}</span><b>${x && x.rec ? x.rec : '没记'}</b></div>`;
        });
        h += `</div><button class="btn sec" data-act="close">关闭</button>`;
      }
      h += `</div>`;
    }
    if (S.toast) h += `<div class="toast" role="status">${S.toast}</div>`;
    return h;
  }

  // 没搜的时候列这一顿同一个菜单的菜，搜了就在整个菜库里找
  function ateList(sh) {
    const day = today(), q = sh.q.trim();
    const code = C.menuOf(day.mode, S.cur);
    const list = (q ? MENU.filter(d => d.菜名.includes(q) || (d.店名 || '').includes(q))
      : MENU.filter(d => d.菜单 === code && d.适用餐次.includes(S.cur) && !day.meals[S.cur].items.includes(d.菜品ID))).slice(0, 6);
    if (!list.length) return `<div class="empty">菜库里没找到，可以在下面随手写</div>`;
    return list.map(d => `<button class="opt ${sh.id === d.菜品ID ? 'on' : ''}" data-act="atepick" data-id="${d.菜品ID}">${esc(d.菜名)}${d.份数 > 1 ? ' ×' + d.份数 : ''}
      <small>${esc(d.店名 || '在家做')} · ${d.热量下限 === d.热量上限 ? '' : '约 '}${r10((d.热量下限 + d.热量上限) / 2)} 千卡</small></button>`).join('');
  }

  function introHtml() {
    return `<div class="intro"><div class="wrap"><div class="ie">🥗</div>${CFG.称呼 ? `<div class="hi">Hello，${esc(CFG.称呼)}</div>` : ''}<div class="it1">今天吃什么</div><div class="it2">每顿抽一下就知道</div>
      <div class="ib"><div>🎯 <span>每天大约吃 <b>${CFG.每日热量目标} 千卡</b>，蛋白质至少 ${CFG.蛋白质下限} g，蔬菜至少 ${CFG.蔬菜下限} g</span></div>
      <div>👆 <span>每顿点一下"抽"，揭晓吃什么</span></div><div>✅ <span>吃完点一下，记录会帮你数</span></div></div>
      <div class="safe">这是给家人用的饮食参考，不是医疗建议。出现头晕、乏力，或者饿到影响工作和睡眠，就停下来，多吃一点。有慢性病的人，减重前先问医生。</div>
      <button class="btn pri" style="margin-top:20px" data-act="introok">知道了，开始</button></div></div>`;
  }

  // ================= 操作 =================
  let toastTimer;
  function toast(t) { S.toast = t; render(); clearTimeout(toastTimer); toastTimer = setTimeout(() => { S.toast = ''; $layer.querySelector('.toast')?.remove(); }, 2200); }

  function draw() {
    const day = today(), m = S.cur, meal = day.meals[m];
    if (meal.revealed || S.rolling) return;
    const code = C.menuOf(day.mode, m);
    // 滚动的只放这一顿的"主角"：早餐滚主食，午晚餐滚套餐（周末滚肉菜），停在主角的名字上
    const tpl = CFG.模板[day.mode][m];
    const rollCat = m === '早餐' ? '主食' : tpl.includes('套餐') ? '套餐' : '肉蛋豆';
    const star = meal.items.map(dish).find(d => d.类别 === rollCat) || dish(meal.items[0]);
    const finalName = star.菜名;
    let pool = MENU.filter(x => x.菜单 === code && x.适用餐次.includes(m) && x.类别 === rollCat && !C.isDisliked(x, DB.dislikes)).map(x => x.菜名);
    if (!pool.length) pool = [finalName];
    const other = pool.find(x => x !== finalName) || finalName;
    const reveal = () => { S.rolling = false; meal.revealed = true; S.pop = true; save(); render(); };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { reveal(); return; }
    S.rolling = true; render();
    const seq = [];
    for (let i = 0; i < 14; i++) seq.push(pool[Math.floor(Math.random() * pool.length)]);
    seq.push(finalName, other);
    const box = document.getElementById('names');
    box.innerHTML = seq.map(n => `<div>${esc(n)}</div>`).join('');
    const steps = seq.length - 2, start = performance.now(), dur = 1200;
    (function tick(t) {
      const p = Math.min(1, (t - start) / dur), pos = (1 - Math.pow(1 - p, 3)) * steps;
      box.style.transform = `translateY(${-pos * 44}px)`;
      [...box.children].forEach((c, j) => { c.style.filter = Math.abs(j - pos) < 0.5 ? '' : 'blur(1.4px)'; c.style.opacity = Math.abs(j - pos) < 0.5 ? 1 : 0.5; });
      if (p < 1) requestAnimationFrame(tick);
      else { if (navigator.vibrate) navigator.vibrate(30); setTimeout(reveal, 180); }
    })(start);
  }

  // 换掉某一顿的第 idx 样：优先换成"换完一天仍然合格"的（必要时系统会重配还没揭晓的顿）；
  // 实在没有，才随便换一样并提示。quiet = 不出提示（不爱吃后替换没揭晓的菜时用）
  function swapAt(day, m, idx, quiet) {
    const meal = day.meals[m], whole = dish(meal.items[idx]).类别 === '套餐';
    const recent = C.recentIds(DB.days, now().date, CFG.几天内不重复);
    const opt = C.swapOptions(MENU, CFG, day, m, idx, DB.dislikes, recent);
    if (!opt.all.length) return null;
    const list = opt.ok.length ? opt.ok : opt.all;
    // 这一顿今天已经出现过的菜排到后面；能换的都轮过一遍，才重新开始
    let seen = (meal.seen || []).concat(meal.items);
    let pool = list.filter(o => !seen.includes(o.dish.菜品ID));
    if (!pool.length) { seen = meal.items.slice(); pool = list.filter(o => !seen.includes(o.dish.菜品ID)); }
    if (!pool.length) pool = list;
    const fresh = pool.filter(o => !recent.includes(o.dish.菜品ID));
    const o = (fresh.length ? fresh : pool)[Math.floor(Math.random() * (fresh.length ? fresh : pool).length)];
    if (opt.ok.length) MEALS.forEach(x => { day.meals[x].items = o.meals[x].items.slice(); });
    else meal.items = o.items.slice();
    meal.seen = [...new Set(seen.concat(meal.items))];
    const at = Math.max(0, meal.items.indexOf(o.dish.菜品ID));
    if (!quiet) { meal.rec = null; meal.ate = null; S.flash = { meal: m, idx: at }; S.lastSwap = { meal: m, idx: at }; S.hintMeal = m; }
    day.ok = C.evaluate(MENU, CFG, day.meals).ok;
    save();
    // 整顿换成组合时，提示里把几样菜都说出来
    return { 菜名: whole && o.items.length > 1 ? o.items.map(id => dish(id).菜名).join(' + ') : o.dish.菜名 };
  }

  function doSwap(idx) {
    const day = today();
    const p = swapAt(day, S.cur, idx);
    if (!p) { toast('这一类暂时没有别的可换了'); return; }
    toast(`已换成：${esc(p.菜名)}`);
  }

  function doDislike() {
    const day = today(), sh = S.sheet, meal = day.meals[S.cur], d = dish(meal.items[sh.idx]);
    const entry = sh.ing ? { 类型: '食材', 名称: sh.ing, 来源: '他点的', 日期: now().date }
      : { 类型: '整道菜', 名称: d.菜名, 菜品ID: d.菜品ID, 店名: d.店名 || '', 来源: '他点的', 日期: now().date };
    DB.dislikes.push(entry);
    S.sheet = null;
    // 还没揭晓的顿里如果有刚拉黑的，悄悄换掉
    MEALS.forEach(m => { const x = day.meals[m]; if (x.revealed || m === S.cur) return;
      x.items.forEach((id, i) => { if (C.isDisliked(dish(id), [entry])) swapAt(day, m, i, true); }); });
    save();
    const what = sh.ing ? `带「${esc(sh.ing)}」的菜` : esc(d.菜名);
    const ok = say('不爱吃', { 菜: sh.ing ? `带「${sh.ing}」的菜` : d.菜名 }) || `记住了，以后不会再出现${what}`;
    if (meal.rec) { toast(ok); return; }
    const p = swapAt(day, S.cur, sh.idx);
    toast(p ? `${ok}<br>已经帮你换成：${esc(p.菜名)}` : `${ok}<br>这一类暂时没有别的可换了`);
  }

  function doRec(r) {
    const meal = today().meals[S.cur];
    if (r === '换了别的') {
      const a = meal.rec === '换了别的' && meal.ate || {};
      S.sheet = { type: 'ate', q: '', id: a.菜品ID || null, text: a.文字 || '' };
      render(); return;
    }
    commitRec(r, null);
  }

  function commitRec(r, ate) {
    const day = today(), m = S.cur, meal = day.meals[m];
    S.sheet = null;
    const was = meal.rec;
    meal.ate = r === '换了别的' ? ate : null;
    if (was) { meal.rec = r; save(); toast(`已改成：${r}`); return; }
    meal.rec = r; S.hintMeal = null; save();
    const word = r === '照着吃了' && m === '晚餐' ? say('晚餐照着吃了') : say(r);
    if (word) toast(word); else render();
    setTimeout(() => {
      S.newCk = m;
      const next = MEALS.find(x => !done(day.meals[x]));
      if (next) { S.cur = next; S.peek = false; } else { S.peek = false; }
      render();
    }, 350);
  }

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const a = el.dataset.act, day = S.tab === 'today' ? today() : null;
    switch (a) {
      case 'tab': S.tab = el.dataset.tab; S.sheet = null; window.scrollTo(0, 0); break;
      case 'meal': if (S.rolling) return; S.cur = el.dataset.meal; S.peek = day && MEALS.every(m => done(day.meals[m])); S.hintMeal = null; break;
      case 'summary': S.peek = false; break;
      case 'draw': draw(); return;
      case 'swap': doSwap(Number(el.dataset.idx)); return;
      case 'reswap': if (S.lastSwap) { S.cur = S.lastSwap.meal; doSwap(S.lastSwap.idx); } return;
      case 'nohint': S.hintMeal = null; break;
      case 'how': S.how[el.dataset.id] = !S.how[el.dataset.id]; break;
      case 'rec': doRec(el.dataset.rec); return;
      case 'sheet': S.sheet = { type: el.dataset.sheet, idx: Number(el.dataset.idx || 0) }; break;
      case 'close':
        // 点空白处关掉"吃了啥"：还没记过就按"换了别的、没填"记下；已经记过就保持原样
        if (S.sheet && S.sheet.type === 'ate' && today().meals[S.cur].rec !== '换了别的') { commitRec('换了别的', null); return; }
        S.sheet = null; break;
      case 'atepick': S.sheet.id = S.sheet.id === el.dataset.id ? null : el.dataset.id; document.getElementById('atelist').innerHTML = ateList(S.sheet); return;
      case 'atesave': { const sh = S.sheet, t = sh.text.trim();
        commitRec('换了别的', sh.id || t ? { 菜品ID: sh.id || null, 文字: t || null } : null); return; }
      case 'ateskip': commitRec('换了别的', null); return;
      case 'pickdish': S.sheet.ing = null; break;
      case 'picking': e.stopPropagation(); S.sheet.ing = el.dataset.ing; break;
      case 'dislike': doDislike(); return;
      case 'party': { const meal = day.meals[S.cur]; meal.party = true; meal.rec = '聚餐'; S.sheet = null; S.peek = true; save(); break; }
      case 'unparty': { const meal = day.meals[S.cur]; meal.party = false; meal.rec = null; save(); break; }
      case 'undislike': { const i = Number(el.dataset.i); DB.dislikes.splice(i, 1); save(); toast('已撤回'); return; }
      case 'dayinfo': S.sheet = { type: 'day', date: el.dataset.date }; break;
      case 'help': S.showIntro = true; break;
      case 'msok': DB.msSeen = (DB.msSeen || []).concat(Number(el.dataset.n)); save(); break;
      case 'introok': S.showIntro = false; DB.introSeen = true; save(); break;
    }
    render();
  });

  document.addEventListener('input', e => {
    if (!S.sheet || S.sheet.type !== 'ate') return;
    if (e.target.id === 'ateq') { S.sheet.q = e.target.value; document.getElementById('atelist').innerHTML = ateList(S.sheet); }
    if (e.target.id === 'atetext') S.sheet.text = e.target.value;
  });

  // 隔天打开或者放在后台过了饭点，回来时刷新
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !S.rolling && !S.sheet) { S.cur = null; render(); } });

  render();
})();
