// 配餐规则：只放纯计算，不碰页面，方便用 node 跑测试（test.js）
(function (root) {
  const MEALS = ['早餐', '午餐', '晚餐'];
  const KJ_PER_KCAL = 4.184;

  function pad(n) { return String(n).padStart(2, '0'); }
  function dateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return dateStr(d); }
  function diffDays(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 86400000); }
  function isWeekend(s) { const w = parseDate(s).getDay(); return w === 0 || w === 6; }
  function modeOf(s) { return isWeekend(s) ? '周末' : '工作日'; }
  const r1 = n => Math.round(n * 10) / 10;

  // 这一顿从哪个菜单抽
  function menuOf(mode, meal) {
    if (mode === '周末') return 'C';
    return meal === '早餐' ? 'A' : 'B';
  }

  // ---------- 按食材算每道菜的营养（载入时算一次） ----------
  // 返回找不到的食材，方便 Kitty 加菜时发现写错名字
  function prepareMenu(menu, food, cfg) {
    const errors = [];
    for (const d of menu) {
      let kj = 0, p = 0, f = 0, c = 0, veg = 0;
      for (const [name, g] of d.食材) {
        const x = food[name];
        if (!x) { errors.push(`${d.菜品ID} ${d.菜名}：食材「${name}」不在食材营养表里`); continue; }
        kj += x.千焦 * g / 100; p += x.蛋白质 * g / 100; f += x.脂肪 * g / 100; c += x.碳水 * g / 100;
        if (x.蔬菜) veg += g;
      }
      const kcal = kj / KJ_PER_KCAL, swing = d.菜单 === 'C' ? 0 : cfg.外面买的浮动;
      Object.assign(d, { 热量: Math.round(kcal), 热量下限: Math.round(kcal * (1 - swing)), 热量上限: Math.round(kcal * (1 + swing)),
        蛋白质: r1(p), 脂肪: r1(f), 碳水: r1(c), 蔬菜克数: veg });
    }
    menu._idx = new Map(menu.map(d => [d.菜品ID, d]));
    return errors;
  }

  function byId(menu, id) { return menu._idx ? menu._idx.get(id) : menu.find(x => x.菜品ID === id); }

  function ingredientsOf(dish, cfg) {
    const skip = cfg ? cfg.调料 : [];
    return dish.食材.map(x => x[0]).filter(n => !skip.includes(n));
  }

  function isDisliked(dish, dislikes) {
    return dislikes.some(d => d.类型 === '整道菜' ? d.菜品ID === dish.菜品ID
      : dish.食材.some(x => x[0] === d.名称) || dish.菜名.includes(d.名称));
  }

  // exclude = 今天别的顿已经有的菜（主食除外：午饭晚饭都吃米饭很正常）；inMeal = 这一顿已经有的菜
  function candidates(menu, { 菜单, 餐次, 类别, dislikes, exclude = [], inMeal = [], 店名 }) {
    return menu.filter(x => x.菜单 === 菜单 && x.适用餐次.includes(餐次) && x.类别 === 类别 &&
      (!店名 || x.店名 === 店名) && !isDisliked(x, dislikes) && !inMeal.includes(x.菜品ID) &&
      (x.类别 === '主食' || !exclude.includes(x.菜品ID)));
  }

  function pick(list, rng) { return list[Math.floor(rng() * list.length)]; }

  // 先避开最近几天吃过的；避不开就放宽
  function pickPreferFresh(list, recent, rng) {
    const fresh = list.filter(x => !recent.includes(x.菜品ID));
    return pick(fresh.length ? fresh : list, rng);
  }

  // 生成一顿：随机挑一种组法，每类抽一样。菜单 B 的组合菜（自选快餐）必须同一家店
  function buildMeal(menu, cfg, mode, meal, dislikes, used, recent, rng) {
    const code = menuOf(mode, meal);
    const tpl = pick(cfg.模板[mode][meal], rng);
    let store;
    if (code === 'B' && tpl.length > 1) {
      const stores = [...new Set(menu.filter(x => x.菜单 === 'B').map(x => x.店名))]
        .filter(s => tpl.every(cat => candidates(menu, { 菜单: code, 餐次: meal, 类别: cat, dislikes, exclude: used, 店名: s }).length));
      if (!stores.length) return null;
      store = pick(stores, rng);
    }
    const ids = [];
    for (const cat of tpl) {
      const list = candidates(menu, { 菜单: code, 餐次: meal, 类别: cat, dislikes, exclude: used, inMeal: ids, 店名: store });
      if (!list.length) return null;
      ids.push(pickPreferFresh(list, recent, rng).菜品ID);
    }
    return ids;
  }

  function sumOf(menu, ids) {
    const s = { kcal: 0, lo: 0, hi: 0, protein: 0, fat: 0, carb: 0, veg: 0 };
    for (const id of ids) {
      const d = byId(menu, id);
      if (!d) continue;
      s.kcal += d.热量; s.lo += d.热量下限; s.hi += d.热量上限;
      s.protein += d.蛋白质; s.fat += d.脂肪; s.carb += d.碳水; s.veg += d.蔬菜克数;
    }
    return s;
  }

  // 三大营养素各占多少热量（%）
  function shares(s) {
    if (!s.kcal) return { p: 0, f: 0, c: 0 };
    return { p: s.protein * 4 / s.kcal * 100, f: s.fat * 9 / s.kcal * 100, c: s.carb * 4 / s.kcal * 100 };
  }

  // 一天合不合格（聚餐那顿不算）。problems 按"最该先说"的顺序排
  function evaluate(menu, cfg, meals) {
    const R = cfg.营养规则;
    const t = { kcal: 0, lo: 0, hi: 0, protein: 0, fat: 0, carb: 0, veg: 0 };
    const perMeal = {};
    let party = false, lunchDinnerVeg = true, mealOk = true;
    const problems = [];
    for (const m of MEALS) {
      const meal = meals[m];
      if (meal.party) { party = true; continue; }
      const s = sumOf(menu, meal.items);
      perMeal[m] = s;
      for (const k in t) t[k] += s[k];
      if (m !== '早餐' && s.veg === 0) lunchDinnerVeg = false;
      const [lo, hi] = R.每顿热量[m];
      if (s.kcal < lo || s.kcal > hi) { mealOk = false; problems.push({ k: 'meal', m, d: s.kcal < lo ? lo - s.kcal : s.kcal - hi, over: s.kcal > hi }); }
    }
    const sh = shares(t);
    const kcalOk = Math.abs(t.kcal - cfg.每日热量目标) <= cfg.热量浮动;
    const proteinOk = t.protein >= cfg.蛋白质下限 && sh.p <= R.蛋白质供能比上限;
    const fatOk = sh.f >= R.脂肪供能比[0] && sh.f <= R.脂肪供能比[1];
    const carbOk = sh.c >= R.碳水供能比[0] && sh.c <= R.碳水供能比[1];
    const vegOk = t.veg >= cfg.蔬菜下限 && lunchDinnerVeg;
    if (!kcalOk) problems.unshift({ k: 'kcal', d: Math.abs(t.kcal - cfg.每日热量目标) - cfg.热量浮动, over: t.kcal > cfg.每日热量目标 });
    if (t.protein < cfg.蛋白质下限) problems.push({ k: 'protein', d: cfg.蛋白质下限 - t.protein });
    if (sh.p > R.蛋白质供能比上限) problems.push({ k: 'proteinHigh', d: sh.p - R.蛋白质供能比上限 });
    if (!fatOk) problems.push({ k: 'fat', over: sh.f > R.脂肪供能比[1], v: sh.f });
    if (!carbOk) problems.push({ k: 'carb', over: sh.c > R.碳水供能比[1], v: sh.c });
    if (!vegOk) problems.push({ k: 'veg', d: Math.max(0, cfg.蔬菜下限 - t.veg), noVegMeal: !lunchDinnerVeg });
    // 偏离多少（用来挑"最接近合格"的那一套）
    const pen = (v, lo, hi) => v < lo ? lo - v : v > hi ? v - hi : 0;
    let penalty = pen(t.kcal, cfg.每日热量目标 - cfg.热量浮动, cfg.每日热量目标 + cfg.热量浮动)
      + Math.max(0, cfg.蛋白质下限 - t.protein) * 10 + pen(sh.p, 0, R.蛋白质供能比上限) * 20
      + pen(sh.f, ...R.脂肪供能比) * 20 + pen(sh.c, ...R.碳水供能比) * 20
      + Math.max(0, cfg.蔬菜下限 - t.veg) + (lunchDinnerVeg ? 0 : 200);
    for (const m in perMeal) penalty += pen(perMeal[m].kcal, ...R.每顿热量[m]);
    return { ...t, mid: t.kcal, share: sh, perMeal, kcalOk, proteinOk, fatOk, carbOk, vegOk, mealOk,
      ok: kcalOk && proteinOk && fatOk && carbOk && vegOk && mealOk, party, penalty, problems };
  }

  // 实际吃了多少（看"吃了吗"的记录）：照着吃了 = 抽到的菜；换了别的 + 从菜库选了 = 选的那道；
  // 换了别的但没选 / 只写了文字 = 算不进去；没吃 = 0；聚餐 = 不算
  function actualOf(menu, cfg, meals) {
    const t = { kcal: 0, lo: 0, hi: 0, protein: 0, fat: 0, carb: 0, veg: 0 };
    let unknown = 0, party = 0;
    for (const m of MEALS) {
      const x = meals[m];
      if (x.party) { party++; continue; }
      if (x.rec === '没吃') continue;
      let ids = x.items;
      if (x.rec === '换了别的') {
        if (x.ate && x.ate.菜品ID && byId(menu, x.ate.菜品ID)) ids = [x.ate.菜品ID];
        else { unknown++; continue; }
      }
      const s = sumOf(menu, ids);
      for (const k in t) t[k] += s[k];
    }
    return { ...t, mid: t.kcal, unknown, party, kcalOk: Math.abs(t.kcal - cfg.每日热量目标) <= cfg.热量浮动,
      proteinOk: t.protein >= cfg.蛋白质下限, vegOk: t.veg >= cfg.蔬菜下限 };
  }

  // 当天第一次打开时调用：从整个菜库里随机挑三顿，直到一天合格
  function generateDay(menu, cfg, date, dislikes, recent, rng = Math.random, tries = 4000) {
    const mode = modeOf(date);
    let best = null;
    for (let i = 0; i < tries; i++) {
      const meals = {}; const used = [];
      let failed = false;
      // 前一半尽量避开最近几天吃过的，凑不出合格的再放宽
      const avoid = i < tries / 2 ? recent : [];
      for (const m of MEALS) {
        const ids = buildMeal(menu, cfg, mode, m, dislikes, used, avoid, rng);
        if (!ids) { failed = true; break; }
        used.push(...ids);
        meals[m] = { items: ids, revealed: false, party: false, rec: null };
      }
      if (failed) continue;
      const ev = evaluate(menu, cfg, meals);
      if (!best || ev.penalty < best.ev.penalty) best = { meals, ev };
      if (ev.ok) break;
    }
    if (!best) return null;
    return { mode, meals: best.meals, ok: best.ev.ok };
  }

  // 换一道：同一个菜单、同一类、这一顿能吃的；组合菜（自选快餐）只在同一家店里换；
  // 排除不爱吃和今天已经出现的。
  // 换完一天不合格时，悄悄重配"还没揭晓"的那几顿来补平（他还没看到，不算改他的菜）。
  // 返回 ok = [{ dish, meals }]：换成 dish 之后一天仍然合格的方案（meals 是换完的整天三顿）
  // 换一道。返回 { all: 所有能换的, ok: 换完一天仍合格的 }，每项是 { dish: 换上的主角菜, items: 这一顿换完的菜, meals: 换完的三顿 }
  // · 套餐整顿换：可以换成别的套餐，也可以换成自选快餐的组合（饭 + 荤 + 素）
  // · 别的菜只换这一样（同一类、同一家店）
  // · 换完不合格时，会重配还没揭晓的顿来补平：先随机配一批（tries 份），每个候选都拿去试
  function swapOptions(menu, cfg, day, meal, idx, dislikes, recent = [], rng = Math.random, tries = 200) {
    const items = day.meals[meal].items, dish = byId(menu, items[idx]);
    const code = menuOf(day.mode, meal);
    const others = MEALS.filter(m => m !== meal).flatMap(m => day.meals[m].items);
    let all;
    if (dish.类别 === '套餐') {
      all = candidates(menu, { 菜单: code, 餐次: meal, 类别: '套餐', dislikes, exclude: others, inMeal: items })
        .map(x => ({ dish: x, items: [x.菜品ID] }));
      // 自选快餐的组合：每个荤菜配几组随机的饭和素菜
      const tpls = cfg.模板[day.mode][meal].filter(t => !t.includes('套餐'));
      const stores = [...new Set(menu.filter(x => x.菜单 === code && x.类别 !== '套餐').map(x => x.店名))];
      for (const store of stores) for (const tpl of tpls) {
        const stars = candidates(menu, { 菜单: code, 餐次: meal, 类别: '肉蛋豆', dislikes, exclude: others, 店名: store });
        for (const star of stars) for (let k = 0; k < 3; k++) {
          const ids = [];
          for (const cat of tpl) {
            if (cat === '肉蛋豆') { ids.push(star.菜品ID); continue; }
            const list = candidates(menu, { 菜单: code, 餐次: meal, 类别: cat, dislikes, exclude: others, inMeal: ids.concat(star.菜品ID), 店名: store });
            if (!list.length) { ids.length = 0; break; }
            ids.push(pick(list, rng).菜品ID);
          }
          if (ids.length && !all.some(o => o.items.join() === ids.join())) all.push({ dish: star, items: ids });
        }
      }
    } else {
      const store = items.length > 1 && dish.菜单 === 'B' ? dish.店名 : undefined;
      all = candidates(menu, { 菜单: code, 餐次: meal, 类别: dish.类别, dislikes, exclude: others, inMeal: items, 店名: store })
        .map(x => ({ dish: x, items: items.map((id, i) => i === idx ? x.菜品ID : id) }));
    }
    // 还没揭晓的顿，先随机重配一批备用
    const hidden = MEALS.filter(m => m !== meal && !day.meals[m].revealed && !day.meals[m].party && !day.meals[m].rec);
    const fixedIds = MEALS.filter(m => m !== meal && !hidden.includes(m)).flatMap(m => day.meals[m].items);
    const pool = [];
    for (let t = 0; t < tries && hidden.length; t++) {
      const used = fixedIds.slice(), plan = {};
      let failed = false;
      for (const m of hidden) {
        const ids = buildMeal(menu, cfg, day.mode, m, dislikes, used, t < tries / 2 ? recent : [], rng);
        if (!ids) { failed = true; break; }
        used.push(...ids); plan[m] = ids;
      }
      if (!failed) pool.push(plan);
    }
    const isMain = id => byId(menu, id).类别 === '主食';
    const ok = [];
    for (const o of all) {
      const base = { ...day.meals, [meal]: { ...day.meals[meal], items: o.items } };
      if (evaluate(menu, cfg, base).ok) { ok.push({ ...o, meals: base }); continue; }
      const mine = o.items.filter(id => !isMain(id));
      for (const plan of pool) {
        if (hidden.some(m => plan[m].some(id => !isMain(id) && mine.includes(id)))) continue;
        const trial = { ...base };
        hidden.forEach(m => { trial[m] = { ...trial[m], items: plan[m] }; });
        if (evaluate(menu, cfg, trial).ok) { ok.push({ ...o, meals: trial }); break; }
      }
    }
    all.forEach(o => { if (!o.meals) o.meals = { ...day.meals, [meal]: { ...day.meals[meal], items: o.items } }; });
    return { all, ok };
  }

  function allIds(day) { return MEALS.flatMap(m => day.meals[m].items); }

  // 最近 n 天（不含今天）出现过的菜
  function recentIds(days, date, n) {
    const out = [];
    for (let i = 1; i <= n; i++) {
      const d = days[addDays(date, -i)];
      if (d) out.push(...allIds(d));
    }
    return out;
  }

  // 现在该吃哪一顿 / 某一顿的时间过了没有
  function mealByHour(h, cfg) { return h < cfg.时间分界.早餐结束 ? '早餐' : h < cfg.时间分界.午餐结束 ? '午餐' : '晚餐'; }
  function isPassed(meal, h, cfg) {
    if (meal === '早餐') return h >= cfg.时间分界.早餐结束;
    if (meal === '午餐') return h >= cfg.时间分界.午餐结束;
    return false;
  }

  const api = { MEALS, dateStr, parseDate, addDays, diffDays, modeOf, menuOf, prepareMenu, ingredientsOf, isDisliked, candidates,
    byId, sumOf, shares, evaluate, actualOf, generateDay, swapOptions, allIds, recentIds, mealByHour, isPassed, pickPreferFresh };
  if (typeof module !== 'undefined') module.exports = api; else root.Core = api;
})(this);
