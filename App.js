// تحلیلگر سهام بورس ایران — فایل واحد (Expo / Android)
// تنها منبع داده: tsetmc.com (بدون ورود دستی داده). فقط آموزشی است، توصیه سرمایه‌گذاری نیست.
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl, StatusBar, StyleSheet, Text, View,
} from 'react-native';

/* ───────────── منابع داده ───────────── */
const MW = 'https://old.tsetmc.com/tsev2/data/MarketWatchInit.aspx?h=0&r=0';
const INFO = (id) => `https://cdn.tsetmc.com/api/Instrument/GetInstrumentInfo/${id}`;
const HIST = (id) => `https://cdn.tsetmc.com/api/ClosingPrice/GetClosingPriceDailyList/${id}/80`;

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const fixFa = (s) => String(s || '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').trim();
const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
const fd = (v) => String(v).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]).replace('.', '٫');
const pct = (v, d = 0) => `${fd(v.toFixed(d))}٪`;

async function getText(url, tries = 2) {
  for (let k = 0; k < tries; k++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (r.ok) return await r.text();
    } catch (e) { /* تلاش مجدد */ } finally { clearTimeout(t); }
  }
  throw new Error('net');
}

/* فقط سهام عادی (کد نوع ۳۰۰/۳۰۳/۳۱۳)؛ حق‌تقدم، صندوق و اوراق حذف می‌شوند.
   ترتیب ستون‌ها: ۰ شناسه، ۲ نماد، ۳ نام، ۶ پایانی، ۷ آخرین، ۱۰ ارزش، ۱۱ کمینه، ۱۲ بیشینه،
   ۱۳ دیروز، ۱۴ EPS، ۱۸ کد صنعت، ۲۲ نوع بازار */
function parseMarket(text) {
  const part = text.split('@').sort((a, b) => b.length - a.length)[0] || '';
  return part.split(';').map((r) => r.split(',')).filter((f) => f.length > 22)
    .filter((f) => ['300', '303', '313'].includes(String(f[22]).trim()))
    .map((f) => ({
      id: f[0], symbol: fixFa(f[2]), name: fixFa(f[3]), last: +f[7], value: +f[10],
      low: +f[11], high: +f[12], yesterday: +f[13], eps: +f[14], sectorCode: f[18],
    }))
    .filter((s) => s.id && s.symbol && s.last > 0 && s.yesterday > 0 && s.eps > 0 && s.value > 0
      && s.last >= s.low * 0.9 && s.last <= s.high * 1.1); // اعتبارسنجی ساختار داده
}

/* تحلیل عمیق یک سهم؛ اگر هر داده لازم موجود نباشد، سهم کنار گذاشته می‌شود (بدون حدس) */
async function deep(s) {
  try {
    const [ij, hj] = await Promise.all([getText(INFO(s.id)), getText(HIST(s.id))]);
    const info = JSON.parse(ij); const i = info.instrumentInfo || info;
    const est = num(i.eps?.estimatedEPS), spe = num(i.eps?.sectorPE), psr = num(i.eps?.psr);
    if (!(est > 0) || !(spe > 0) || !(psr > 0)) return null;

    const h = JSON.parse(hj);
    const rows = (h.closingPriceDaily || (Array.isArray(h) ? h : []))
      .sort((a, b) => a.dEven - b.dEven).slice(-70);
    if (rows.length < 40) return null;
    const closes = rows.map((r) => num(r.pClosing));
    const vals = rows.map((r) => num(r.qTotCap) || 0);

    // بازده‌ها؛ جهش‌های بزرگ‌تر از ۷٫۵٪ (افزایش سرمایه/تعدیل ناشده) حذف می‌شوند
    let cum = 1, cum20 = 1, peak = 1, dd = 0; const rets = [];
    for (let k = 1; k < closes.length; k++) {
      const r = closes[k] / closes[k - 1] - 1;
      if (!Number.isFinite(r) || Math.abs(r) > 0.075) continue;
      rets.push(r); cum *= 1 + r; peak = Math.max(peak, cum); dd = Math.max(dd, 1 - cum / peak);
      if (k >= closes.length - 20) cum20 *= 1 + r;
    }
    if (rets.length < 30) return null;
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const vol = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);
    const l20 = vals.slice(-20).sort((a, b) => a - b);
    const med = l20[Math.floor(l20.length / 2)];
    const traded = l20.filter((v) => v > 0).length / l20.length;
    if (med < 1e9) return null; // نقدشوندگی ناکافی

    const pe = s.last / s.eps, fpe = s.last / est;
    const growth = (est / s.eps - 1) * 100;
    const margin = (est / psr) * 100; // حاشیه سود خالص برآوردی
    const r3m = (cum - 1) * 100, r1m = (cum20 - 1) * 100;
    const f = {
      // رشد بسیار بالا (>۱۰۰٪) برآورد خوش‌بینانه فرض می‌شود و امتیاز کمتری می‌گیرد
      growth: growth <= 0 ? 0 : growth > 100 ? 0.4 : clamp(growth / 60),
      value: clamp(1.3 - fpe / spe),
      quality: clamp(margin / 35),
      risk: 0.35 * clamp((Math.log10(med) - 9) / 2) + 0.2 * traded
        + 0.3 * (1 - clamp(vol / 0.04)) + 0.15 * (1 - clamp(dd / 0.3)),
      trend: 0.6 * clamp((r3m + 10) / 50) + 0.4 * clamp((r1m + 5) / 20),
    };
    const total = 100 * (0.25 * f.growth + 0.25 * f.value + 0.15 * f.quality + 0.2 * f.risk + 0.15 * f.trend);
    return {
      ...s, sector: fixFa(i.sector?.lSecVal) || `صنعت ${s.sectorCode}`,
      pe, fpe, spe, growth, margin, vol: vol * 100, dd: dd * 100, r3m, r1m, f, total,
    };
  } catch (e) { return null; }
}

async function analyze(onProgress) {
  let text;
  try { text = await getText(MW); } catch (e) {
    throw new Error('اتصال به tsetmc برقرار نشد. اینترنت را بررسی و دوباره تلاش کنید.');
  }
  const all = parseMarket(text);
  if (all.length < 50) throw new Error('قالب داده tsetmc تغییر کرده است و تحلیل نامطمئن می‌شود؛ اپ باید به‌روزرسانی شود.');

  // غربال مرحله اول: P/E پایین‌تر و نقدشوندگی بیشتر
  const pre = (s) => 0.6 * clamp((20 - s.last / s.eps) / 20) + 0.4 * clamp((Math.log10(s.value) - 9) / 2);
  const pool = all.filter((s) => s.value >= 2e9).sort((a, b) => pre(b) - pre(a)).slice(0, 40);

  const out = [];
  for (let k = 0; k < pool.length; k += 8) {
    onProgress(`تحلیل بنیادی و ریسک: ${fd(Math.min(k + 8, pool.length))} از ${fd(pool.length)}`);
    out.push(...(await Promise.all(pool.slice(k, k + 8).map(deep))));
  }
  const ok = out.filter(Boolean).sort((a, b) => b.total - a.total);
  if (!ok.length) throw new Error('داده بنیادی در دسترس نبود. کمی بعد دوباره تلاش کنید.');

  const used = {}, list = []; // حداکثر ۲ سهم از هر صنعت
  for (const s of ok) {
    if ((used[s.sector] || 0) < 2) { used[s.sector] = (used[s.sector] || 0) + 1; list.push(s); }
    if (list.length === 10) break;
  }
  return { list, checked: pool.length, valid: ok.length, at: new Date(), total: all.length };
}

/* ───────────── رابط کاربری ───────────── */
const C = {
  ink: '#14232E', paper: '#F5F6F2', card: '#FFFFFF', line: '#DDE1DA',
  up: '#0E8F63', down: '#C94040', gold: '#B07D1E', muted: '#66727B',
};
const riskLabel = (r) => (r > 0.66 ? 'کم' : r > 0.4 ? 'متوسط' : 'زیاد');
const FACTORS = [['رشد', 'growth'], ['ارزندگی', 'value'], ['کیفیت سود', 'quality'], ['ریسک', 'risk'], ['روند', 'trend']];

function Row({ item, rank }) {
  const [open, setOpen] = useState(false);
  const up = item.r1m >= 0;
  return (
    <Pressable style={s.card} onPress={() => setOpen(!open)}>
      <View style={s.top}>
        <Text style={s.rank}>{fd(rank)}</Text>
        <View style={s.grow}>
          <Text style={s.symbol}>{item.symbol}</Text>
          <Text style={s.name} numberOfLines={1}>{item.name} · {item.sector}</Text>
        </View>
        <View style={s.scoreBox}>
          <Text style={s.score}>{fd(item.total.toFixed(0))}</Text>
          <Text style={s.small}>امتیاز</Text>
        </View>
      </View>
      <View style={s.bar}><View style={[s.fill, { width: `${item.total}%` }]} /></View>
      <View style={s.meta}>
        <Text style={s.small}>P/E آتی: {fd(item.fpe.toFixed(1))} (صنعت {fd(item.spe.toFixed(1))})</Text>
        <Text style={s.small}>رشد EPS: {pct(item.growth)}</Text>
      </View>
      <View style={[s.meta, { marginTop: 4 }]}>
        <Text style={s.small}>حاشیه سود: {pct(item.margin)}</Text>
        <Text style={s.small}>ریسک: {riskLabel(item.f.risk)}</Text>
        <Text style={[s.small, { color: up ? C.up : C.down }]}>۱ ماه: {pct(item.r1m, 1)} {up ? '▲' : '▼'}</Text>
      </View>
      {open && (
        <View style={{ marginTop: 12 }}>
          {FACTORS.map(([n, k]) => (
            <View key={k} style={s.fr}>
              <Text style={s.fl}>{n}</Text>
              <View style={s.fbar}><View style={[s.fill, { width: `${item.f[k] * 100}%` }]} /></View>
              <Text style={s.fv}>{fd(Math.round(item.f[k] * 100))}</Text>
            </View>
          ))}
          <Text style={s.note}>
            نوسان روزانه {pct(item.vol, 1)} · افت از اوج ۳ ماه {pct(item.dd)} · بازده ۳ ماه {pct(item.r3m)}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export default function App() {
  const [st, setSt] = useState({ s: 'loading', p: 'دریافت فهرست بازار…' });
  const run = useCallback(async () => {
    setSt((x) => ({ ...x, s: 'loading', p: 'دریافت فهرست بازار…' }));
    try { setSt({ s: 'ok', d: await analyze((p) => setSt((x) => ({ ...x, p }))) }); }
    catch (e) { setSt({ s: 'error', m: e.message }); }
  }, []);
  useEffect(() => { run(); }, [run]);

  const d = st.d;
  const hh = d ? `${fd(String(d.at.getHours()).padStart(2, '0'))}:${fd(String(d.at.getMinutes()).padStart(2, '0'))}` : '';
  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.ink} />
      <View style={s.header}>
        <Text style={s.title}>۱۰ سهم برتر بورس</Text>
        <Text style={s.sub}>رشد EPS، ارزندگی نسبت به صنعت، کیفیت سود، ریسک و روند</Text>
      </View>
      {d && (
        <Text style={s.banner}>
          منبع: tsetmc · {fd(d.total)} سهم بررسی اولیه، {fd(d.valid)} سهم با داده کامل · ساعت {hh}
        </Text>
      )}
      {st.s === 'error' ? (
        <View style={s.center}>
          <Text style={s.err}>{st.m}</Text>
          <Pressable style={s.btn} onPress={run}><Text style={s.btnText}>تلاش دوباره</Text></Pressable>
        </View>
      ) : !d ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={C.ink} />
          <Text style={s.note}>{st.p}</Text>
        </View>
      ) : (
        <FlatList
          data={d.list}
          keyExtractor={(i) => i.id}
          renderItem={({ item, index }) => <Row item={item} rank={index + 1} />}
          refreshControl={<RefreshControl refreshing={st.s === 'loading'} onRefresh={run} />}
          contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
          ListFooterComponent={
            <Text style={s.disclaimer}>
              روش: سهام عادی با نقدشوندگی کافی از بازار انتخاب و فقط با داده کامل امتیاز می‌گیرند. EPS برآوردی را خود شرکت‌ها
              اعلام می‌کنند و ممکن است خوش‌بینانه باشد. حاشیه سود از EPS برآوردی تقسیم بر درآمد پیش‌بینی هر سهم (PSR) تقریب زده
              شده است. از هر صنعت حداکثر ۲ سهم می‌آید. صورت‌های مالی کامل، نرخ ارز و خبرهای شرکت‌ها در مدل نیست.
              این ابزار آموزشی است و توصیه سرمایه‌گذاری نیست؛ پیش از خرید، گزارش‌های کدال را بخوانید.
            </Text>
          }
        />
      )}
    </View>
  );
}

const rtl = { textAlign: 'right', writingDirection: 'rtl' };
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.paper },
  header: { backgroundColor: C.ink, paddingTop: (StatusBar.currentHeight || 24) + 12, paddingBottom: 16, paddingHorizontal: 16 },
  title: { ...rtl, color: '#fff', fontSize: 22, fontWeight: '700' },
  sub: { ...rtl, color: '#A9B8C2', fontSize: 12, marginTop: 4 },
  banner: { ...rtl, fontSize: 11, color: C.ink, backgroundColor: '#E6EBE3', paddingVertical: 6, paddingHorizontal: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  err: { ...rtl, textAlign: 'center', color: C.down, fontSize: 14, lineHeight: 22, marginBottom: 16 },
  card: { backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.line, padding: 12, marginBottom: 10 },
  top: { flexDirection: 'row-reverse', alignItems: 'center' },
  rank: { width: 28, textAlign: 'center', color: C.muted, fontSize: 16, fontWeight: '600' },
  grow: { flex: 1, paddingHorizontal: 10 },
  symbol: { ...rtl, fontSize: 20, fontWeight: '700', color: C.ink },
  name: { ...rtl, fontSize: 12, color: C.muted },
  scoreBox: { alignItems: 'center', minWidth: 44 },
  score: { fontSize: 22, fontWeight: '700', color: C.gold },
  small: { fontSize: 12, color: C.muted },
  bar: { height: 5, backgroundColor: '#ECEEE8', borderRadius: 3, marginVertical: 10, alignItems: 'flex-end' },
  fill: { height: 5, backgroundColor: C.gold, borderRadius: 3 },
  meta: { flexDirection: 'row-reverse', justifyContent: 'space-between' },
  fr: { flexDirection: 'row-reverse', alignItems: 'center', marginBottom: 6 },
  fl: { width: 64, ...rtl, fontSize: 12, color: C.ink },
  fbar: { flex: 1, height: 5, backgroundColor: '#ECEEE8', borderRadius: 3, marginHorizontal: 8, alignItems: 'flex-end' },
  fv: { width: 28, textAlign: 'left', fontSize: 12, color: C.muted },
  note: { ...rtl, fontSize: 11, color: C.muted, marginTop: 6, lineHeight: 18 },
  disclaimer: { ...rtl, fontSize: 11, color: C.muted, marginTop: 8, lineHeight: 19 },
  btn: { backgroundColor: C.ink, borderRadius: 24, paddingVertical: 12, paddingHorizontal: 28 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
