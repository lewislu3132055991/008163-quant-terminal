import { createSampleBundle } from "../data/sample";
import type { IntradayBar, MarketDatum, OhlcvBar, ResearchBundle, SourceStatus } from "../types";

const CACHE_KEY = "fund-008163-research-cache-v1";

function isBundle(value: unknown): value is ResearchBundle {
  if (!value || typeof value !== "object") return false;
  const bundle = value as Partial<ResearchBundle>;
  return bundle.version === "1.0" && Array.isArray(bundle.daily) && Array.isArray(bundle.intraday) && Boolean(bundle.quote);
}

export async function loadResearchBundle(): Promise<{ bundle: ResearchBundle; detail: string }> {
  const inline = (window as Window & { __RESEARCH_BUNDLE__?: ResearchBundle }).__RESEARCH_BUNDLE__;
  try {
    const response = await fetch(`./data/research-bundle.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value = (await response.json()) as unknown;
    if (!isBundle(value)) throw new Error("数据包格式不兼容");
    localStorage.setItem(CACHE_KEY, JSON.stringify(value));
    return { bundle: value, detail: "已载入GitHub Actions最新研究数据包" };
  } catch (error) {
    if (inline && isBundle(inline)) return { bundle: inline, detail: "在线数据包不可达，已使用单文件内置备用数据" };
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        const value = JSON.parse(cached) as unknown;
        if (isBundle(value)) return { bundle: { ...value, mode: "cache" }, detail: "GitHub数据不可达，已使用手机缓存" };
      } catch {
        localStorage.removeItem(CACHE_KEY);
      }
    }
    return { bundle: createSampleBundle(), detail: `实时数据不可达，使用内置演示快照${error instanceof Error ? `：${error.message}` : ""}` };
  }
}

export async function checkGitHubConnectivity(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 3500);
    const response = await fetch("https://api.github.com/zen", { signal: controller.signal, cache: "no-store" });
    window.clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

type BrowserQuote = {
  price: number;
  previousClose?: number;
  amount?: number;
  turnoverRate?: number;
  asOf: string;
  source: string;
};

function realtimeDatum(value: number, source: string, asOf: string): MarketDatum<number> {
  return { value, source, asOf, retrievedAt: new Date().toISOString(), frequency: "realtime", quality: "verified", pointInTimeSafe: true };
}

async function fetchJson(url: string) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store", referrerPolicy: "no-referrer" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as Record<string, unknown>;
  } finally {
    window.clearTimeout(timer);
  }
}

async function fetchEastMoneyQuote(): Promise<BrowserQuote> {
  const payload = await fetchJson("https://push2.eastmoney.com/api/qt/stock/get?secid=1.515450&fields=f43,f48,f60,f124,f168,f170");
  const data = payload.data as Record<string, number> | undefined;
  if (!data || !data.f43) throw new Error("东方财富报价为空");
  return {
    price: data.f43 / 1000,
    previousClose: data.f60 / 1000,
    amount: Number(data.f48 || 0),
    turnoverRate: Number(data.f168 || 0) / 100,
    asOf: data.f124 ? new Date(data.f124 * 1000).toISOString() : new Date().toISOString(),
    source: "东方财富浏览器直连",
  };
}

async function fetchTencentQuote(): Promise<BrowserQuote> {
  const key = "v_sh515450";
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timer = window.setTimeout(() => { script.remove(); reject(new Error("腾讯行情超时")); }, 4500);
    script.src = `https://qt.gtimg.cn/q=sh515450&t=${Date.now()}`;
    script.referrerPolicy = "no-referrer";
    script.onload = () => {
      window.clearTimeout(timer);
      try {
        const globalWindow = window as unknown as Record<string, unknown>;
        const text = globalWindow[key];
        const fields = String(text ?? "").split("~");
        const price = Number(fields[3]);
        if (!(price > 0)) throw new Error("腾讯报价为空");
        const raw = fields[30] ?? "";
        const asOf = /^\d{14}$/.test(raw)
          ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}+08:00`
          : new Date().toISOString();
        resolve({ price, previousClose: Number(fields[4]) || undefined, asOf, source: "腾讯行情浏览器直连" });
      } catch (error) { reject(error); }
      finally { delete (window as unknown as Record<string, unknown>)[key]; script.remove(); }
    };
    script.onerror = () => { window.clearTimeout(timer); script.remove(); reject(new Error("腾讯行情不可达")); };
    document.head.appendChild(script);
  });
}

async function fetchEastMoneyIntraday(): Promise<IntradayBar[]> {
  const url = "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.515450&klt=5&fqt=1&lmt=120&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61";
  const payload = await fetchJson(url);
  const data = payload.data as { klines?: string[] } | undefined;
  if (!data?.klines?.length) throw new Error("五分钟行情为空");
  let totalAmount = 0;
  let totalVolume = 0;
  return data.klines.slice(-48).map((row) => {
    const fields = row.split(",");
    const volume = Number(fields[5]);
    totalVolume += volume;
    totalAmount += Number(fields[6]);
    const close = Number(fields[2]);
    const calculated = totalAmount / Math.max(1, totalVolume * 100);
    const vwap = calculated > close * 0.5 && calculated < close * 1.5 ? calculated : close;
    return { time: `${fields[0].replace(" ", "T")}+08:00`, open: Number(fields[1]), close, high: Number(fields[3]), low: Number(fields[4]), volume, vwap: Number(vwap.toFixed(3)) };
  });
}

async function fetchEastMoneyDaily(symbol: "515450" | "510300"): Promise<OhlcvBar[]> {
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.${symbol}&klt=101&fqt=1&lmt=900&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`;
  const payload = await fetchJson(url);
  const data = payload.data as { klines?: string[] } | undefined;
  if (!data?.klines || data.klines.length < 126) throw new Error(`${symbol}日线不足`);
  return data.klines.map((row) => {
    const fields = row.split(",");
    return { time: fields[0], open: Number(fields[1]), close: Number(fields[2]), high: Number(fields[3]), low: Number(fields[4]), volume: Number(fields[5]) };
  });
}

async function fetchTencentDaily(symbol: "515450" | "510300"): Promise<OhlcvBar[]> {
  const ticker = `sh${symbol}`;
  const key = `__kline_${ticker}_${Date.now()}`;
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timer = window.setTimeout(() => { script.remove(); reject(new Error(`${symbol}腾讯日线超时`)); }, 5500);
    script.src = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?_var=${key}&param=${ticker},day,,,900,qfq&r=${Date.now()}`;
    script.referrerPolicy = "no-referrer";
    script.onload = () => {
      window.clearTimeout(timer);
      try {
        const globalWindow = window as unknown as Record<string, unknown>;
        const payload = globalWindow[key] as { data?: Record<string, { qfqday?: string[][]; day?: string[][] }> } | undefined;
        const rows = payload?.data?.[ticker]?.qfqday ?? payload?.data?.[ticker]?.day;
        if (!rows || rows.length < 126) throw new Error(`${symbol}腾讯日线不足`);
        resolve(rows.map((fields) => ({
          time: fields[0], open: Number(fields[1]), close: Number(fields[2]), high: Number(fields[3]), low: Number(fields[4]), volume: Number(fields[5]),
        })));
      } catch (error) { reject(error); }
      finally { delete (window as unknown as Record<string, unknown>)[key]; script.remove(); }
    };
    script.onerror = () => { window.clearTimeout(timer); script.remove(); reject(new Error(`${symbol}腾讯日线不可达`)); };
    document.head.appendChild(script);
  });
}

async function fetchDailyWithFallback(symbol: "515450" | "510300"): Promise<OhlcvBar[]> {
  try {
    return await fetchEastMoneyDaily(symbol);
  } catch {
    return fetchTencentDaily(symbol);
  }
}

export async function refreshBrowserMarket(bundle: ResearchBundle): Promise<{ bundle: ResearchBundle; detail: string }> {
  const [eastMoney, tencent, intraday, daily, benchmark] = await Promise.allSettled([
    fetchEastMoneyQuote(), fetchTencentQuote(), fetchEastMoneyIntraday(), fetchDailyWithFallback("515450"), fetchDailyWithFallback("510300"),
  ]);
  const primary = eastMoney.status === "fulfilled" ? eastMoney.value : undefined;
  const backup = tencent.status === "fulfilled" ? tencent.value : undefined;
  if (!primary && !backup) return { bundle, detail: "浏览器实时行情不可达，继续使用研究数据包" };

  const quote = primary ? realtimeDatum(primary.price, primary.source, primary.asOf) : { ...bundle.quote };
  const backupQuote = backup ? realtimeDatum(backup.price, backup.source, backup.asOf) : { ...bundle.backupQuote };
  const conflict = backupQuote.value <= 0 || Math.abs(quote.value / backupQuote.value - 1) > 0.003;
  if (conflict) {
    quote.quality = "conflict";
    backupQuote.quality = "conflict";
  }
  const sourceStatus = (id: string, name: string, result: PromiseSettledResult<unknown>): SourceStatus => ({
    id, name, status: result.status === "fulfilled" ? "ok" : "failed",
    lastSuccess: result.status === "fulfilled" ? new Date().toISOString() : undefined,
    detail: result.status === "fulfilled" ? "手机已直取最新数据" : "直连失败，保留静态数据",
  });
  const sources = bundle.sources.filter((item) => !item.id.startsWith("browser-"));
  sources.unshift(
    sourceStatus("browser-eastmoney", "东方财富手机直连", eastMoney),
    sourceStatus("browser-tencent", "腾讯手机直连", tencent),
    sourceStatus("browser-daily", "手机日线更新", daily),
  );
  const next: ResearchBundle = {
    ...bundle,
    quote,
    backupQuote,
    previousClose: primary?.previousClose || backup?.previousClose || bundle.previousClose,
    amount: primary?.amount !== undefined ? realtimeDatum(primary.amount, primary.source, primary.asOf) : bundle.amount,
    turnoverRate: primary?.turnoverRate !== undefined ? realtimeDatum(primary.turnoverRate, primary.source, primary.asOf) : bundle.turnoverRate,
    daily: daily.status === "fulfilled" ? daily.value : bundle.daily,
    intraday: intraday.status === "fulfilled" ? intraday.value : bundle.intraday,
    benchmarkSeries: benchmark.status === "fulfilled" ? benchmark.value.map((bar) => ({ time: bar.time, value: bar.close })) : bundle.benchmarkSeries,
    premiumRate: bundle.iopv.value > 0 ? { ...bundle.premiumRate, value: Number(((quote.value / bundle.iopv.value - 1) * 100).toFixed(4)), asOf: quote.asOf, retrievedAt: new Date().toISOString() } : bundle.premiumRate,
    sources,
  };
  const names = [primary && "东方财富", backup && "腾讯", daily.status === "fulfilled" && "日K", intraday.status === "fulfilled" && "5分钟线"].filter(Boolean).join(" + ");
  return { bundle: next, detail: `手机直连已更新：${names}` };
}
