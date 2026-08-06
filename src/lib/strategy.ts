import type { DecisionWindow, FactorContribution, PortfolioSnapshot, Recommendation, ResearchBundle } from "../types";

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const round = (value: number, digits = 2) => Number(value.toFixed(digits));

export function sma(values: number[], period: number): number {
  if (!values.length) return 0;
  const slice = values.slice(-Math.min(period, values.length));
  return slice.reduce((sum, value) => sum + value, 0) / slice.length;
}

export function ema(values: number[], period: number): number {
  if (!values.length) return 0;
  const alpha = 2 / (period + 1);
  return values.slice(1).reduce((value, current) => current * alpha + value * (1 - alpha), values[0]);
}

export function rsi(values: number[], period = 14): number {
  if (values.length < 2) return 50;
  const changes = values.slice(1).map((value, index) => value - values[index]).slice(-period);
  const gains = changes.reduce((sum, value) => sum + Math.max(0, value), 0) / changes.length;
  const losses = changes.reduce((sum, value) => sum + Math.max(0, -value), 0) / changes.length;
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

export function maxDrawdown(values: number[]): number {
  let peak = values[0] ?? 0;
  let drawdown = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    if (peak > 0) drawdown = Math.min(drawdown, value / peak - 1);
  }
  return drawdown;
}

function shanghaiParts(now: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute),
    tradingDay: !["Sat", "Sun"].includes(parts.weekday),
  };
}

export function getDecisionWindow(now = new Date()): DecisionWindow {
  const clock = shanghaiParts(now);
  if (!clock.tradingDay) {
    return { date: clock.date, phase: "frozen", tradingDay: false, label: "非交易日", detail: "沿用最近交易日研究结论，不生成新的操作金额" };
  }
  if (clock.minuteOfDay < 14 * 60 + 45) {
    return { date: clock.date, phase: "preliminary", tradingDay: true, label: "初步分析", detail: "14:45前仅观察，不建议立即操作" };
  }
  if (clock.minuteOfDay < 14 * 60 + 55) {
    return { date: clock.date, phase: "updating", tradingDay: true, label: "决策更新中", detail: "每30秒核对主备报价，14:55冻结" };
  }
  return { date: clock.date, phase: "frozen", tradingDay: true, label: "今日已冻结", detail: "14:55后行情继续更新，操作建议不再改变" };
}

export function applyDecisionWindow(base: Recommendation, window: DecisionWindow, frozen?: Recommendation): Recommendation {
  if (window.phase === "frozen" && frozen) return frozen;
  if (base.status === "blocked") return base;
  if (window.phase === "preliminary" || !window.tradingDay) {
    return { ...base, status: "preliminary", suggestedAmount: undefined, suggestedShares: undefined };
  }
  if (window.phase === "updating") return base;
  return base.status === "final" ? { ...base, status: "frozen" } : base;
}

function factor(
  id: string,
  label: string,
  group: "market" | "information",
  weight: number,
  score: number,
  summary: string,
  pointInTimeSafe = true,
): FactorContribution {
  return { id, label, group, weight, score: round(clamp(score), 1), contribution: round((clamp(score) - 50) * weight / 50, 2), summary, pointInTimeSafe };
}

export function assessData(bundle: ResearchBundle, now = new Date()) {
  const quoteAgeMinutes = (now.getTime() - new Date(bundle.quote.asOf).getTime()) / 60_000;
  const clock = shanghaiParts(now);
  const isTradingWindow = clock.tradingDay && clock.minuteOfDay >= 9 * 60 + 15 && clock.minuteOfDay < 15 * 60 + 5;
  const quoteStale = bundle.mode !== "sample" && quoteAgeMinutes > (isTradingWindow ? 15 : 24 * 60);
  const latestDailyTime = bundle.daily.at(-1)?.time?.slice(0, 10);
  const latestDailyDate = latestDailyTime ? new Date(`${latestDailyTime}T15:00:00+08:00`) : undefined;
  // Ten calendar days tolerates long exchange holidays while still rejecting abandoned snapshots.
  const dailyStale = bundle.mode !== "sample" && (!latestDailyDate || !Number.isFinite(latestDailyDate.getTime())
    || now.getTime() - latestDailyDate.getTime() > 10 * 24 * 60 * 60 * 1000);
  const stale = quoteStale || dailyStale;
  const conflict = Math.abs(bundle.quote.value / bundle.backupQuote.value - 1) > 0.003;
  const labels: Record<string, string> = {
    quote: "主行情", backupQuote: "备用行情", iopv: "IOPV", premiumRate: "折溢价",
    trackingError: "跟踪误差", dividendYield: "股息率", pe: "市盈率", pb: "市净率", roe: "ROE",
    breadth: "成分股宽度", tenYearYield: "10年国债", dr007: "DR007代理", northboundProxy: "ETF资金代理", shareChange20d: "20日份额变化",
  };
  const coverage = Object.entries({ quote: bundle.quote, backupQuote: bundle.backupQuote, iopv: bundle.iopv, premiumRate: bundle.premiumRate, ...bundle.metrics }).map(([id, item]) => ({
    id, label: labels[id] ?? id, quality: item.quality, source: item.source, asOf: item.asOf,
    available: !["unavailable", "conflict", "stale"].includes(item.quality),
  }));
  coverage.push(
    { id: "daily", label: "日K历史", quality: bundle.daily.length >= 126 ? "verified" : "unavailable", source: "515450日线", asOf: bundle.daily.at(-1)?.time ?? "无", available: bundle.daily.length >= 126 },
    { id: "intraday", label: "5分钟线", quality: bundle.intraday.length >= 24 ? "verified" : "unavailable", source: "515450分时", asOf: bundle.intraday.at(-1)?.time ?? "无", available: bundle.intraday.length >= 24 },
  );
  const available = coverage.filter((item) => item.available).length;
  const total = coverage.length;
  const completeness = Math.round((available / total) * 100);
  return { stale, quoteStale, dailyStale, conflict, completeness, available, total, coverage, canFinalize: bundle.mode !== "sample" && !stale && !conflict && completeness >= 80 };
}

export function calculateFactors(bundle: ResearchBundle): FactorContribution[] {
  const closes = bundle.daily.map((bar) => bar.close);
  const volumes = bundle.daily.map((bar) => bar.volume);
  const close = closes.at(-1) ?? bundle.quote.value;
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);
  const ma120 = sma(closes, 120);
  const momentum20 = closes.length > 20 ? close / closes.at(-21)! - 1 : 0;
  const momentum60 = closes.length > 60 ? close / closes.at(-61)! - 1 : 0;
  const dailyReturns = closes.slice(1).map((value, index) => value / closes[index] - 1).slice(-20);
  const vol20 = Math.sqrt(dailyReturns.reduce((sum, value) => sum + value * value, 0) / Math.max(1, dailyReturns.length)) * Math.sqrt(252);
  const volumeRatio = (volumes.at(-1) ?? 0) / Math.max(1, sma(volumes.slice(0, -1), 20));
  const benchmark = bundle.benchmarkSeries.map((item) => item.value);
  const relative20 = benchmark.length > 20 && closes.length > 20
    ? (close / closes.at(-21)! - 1) - (benchmark.at(-1)! / benchmark.at(-21)! - 1)
    : 0;

  const trendScore = 50 + (close > ma20 ? 14 : -14) + (ma20 > ma60 ? 11 : -11) + (ma60 > ma120 ? 8 : -8);
  const momentumScore = 50 + clamp(momentum20 * 350, -22, 22) + clamp(momentum60 * 180, -14, 14) - clamp((rsi(closes) - 70) * 1.2, 0, 18);
  const volatilityScore = 74 - vol20 * 105 + clamp((maxDrawdown(closes.slice(-60)) + 0.12) * 110, -15, 15);
  const volumePriceScore = 50 + Math.sign(momentum20) * clamp((volumeRatio - 0.8) * 24, -12, 20) + (close > ema(closes, 12) ? 8 : -8);
  const relativeScore = 50 + clamp(relative20 * 400, -35, 35);

  const missing = (key: keyof ResearchBundle["metrics"]) => ["unavailable", "conflict", "stale"].includes(bundle.metrics[key].quality) || !bundle.metrics[key].pointInTimeSafe;
  const valuationScore = missing("pe") || missing("dividendYield") || missing("tenYearYield") ? 50 : 50 + clamp((5.5 - bundle.metrics.pe.value) * 6, -22, 22) + clamp((bundle.metrics.dividendYield.value - bundle.metrics.tenYearYield.value) * 7, -20, 20);
  const flowScore = missing("shareChange20d") ? 50 : 50 - clamp(Math.abs(bundle.premiumRate.value) * 18, 0, 22) + clamp(bundle.metrics.shareChange20d.value * 120, -22, 22);
  const breadthScore = missing("breadth") ? 50 : 35 + bundle.metrics.breadth.value * 30;
  const macroScore = missing("dr007") || missing("tenYearYield") ? 50 : 64 - bundle.metrics.dr007.value * 5 + clamp((2.2 - bundle.metrics.tenYearYield.value) * 10, -15, 15);
  const trackingScore = missing("trackingError") ? 50 : 70 - bundle.metrics.trackingError.value * 12 - (bundle.events.some((event) => event.impact === "negative") ? 10 : 0);

  return [
    factor("trend", "趋势结构", "market", 30, trendScore, `收盘${close > ma20 ? "位于" : "跌破"}MA20，MA20${ma20 > ma60 ? "高于" : "低于"}MA60`),
    factor("momentum", "动量", "market", 15, momentumScore, `20日动量${(momentum20 * 100).toFixed(1)}%，RSI14为${rsi(closes).toFixed(0)}`),
    factor("volatility", "波动风险", "market", 10, volatilityScore, `20日年化波动约${(vol20 * 100).toFixed(1)}%`),
    factor("volume", "量价关系", "market", 10, volumePriceScore, `量比${volumeRatio.toFixed(2)}，价格${close > ema(closes, 12) ? "强于" : "弱于"}EMA12`),
    factor("relative", "相对强弱", "market", 5, relativeScore, `近20日相对沪深300 ${(relative20 * 100).toFixed(1)}个百分点`),
    factor("valuation", "估值与股债性价比", "information", 10, valuationScore, missing("pe") ? "估值数据待官方源更新，暂按中性处理" : `指数PE ${bundle.metrics.pe.value.toFixed(1)}，股息率${bundle.metrics.dividendYield.value.toFixed(1)}%`),
    factor("flow", "ETF资金与折溢价", "information", 7, flowScore, missing("shareChange20d") ? `折溢价${bundle.premiumRate.value.toFixed(2)}%，份额历史仍在积累` : `折溢价${bundle.premiumRate.value.toFixed(2)}%，20日份额变化${(bundle.metrics.shareChange20d.value * 100).toFixed(1)}%`),
    factor("breadth", "成分股与行业宽度", "information", 6, breadthScore, missing("breadth") ? "成分股历史时点数据待扩展采集" : `${Math.round(bundle.metrics.breadth.value * 50)}/50只成分股位于20日线上`),
    factor("macro", "宏观流动性", "information", 4, macroScore, missing("dr007") ? "官方宏观数据待扩展采集" : `10年国债${bundle.metrics.tenYearYield.value.toFixed(2)}%，DR007 ${bundle.metrics.dr007.value.toFixed(2)}%`),
    factor("tracking", "跟踪与事件", "information", 3, trackingScore, missing("trackingError") ? "跟踪误差样本不足，暂按中性处理" : `近一年跟踪误差${bundle.metrics.trackingError.value.toFixed(2)}%`, false),
  ];
}

export function buildRecommendation(bundle: ResearchBundle, portfolio?: PortfolioSnapshot, now = new Date()): Recommendation {
  const factors = calculateFactors(bundle);
  const score = round(factors.reduce((sum, item) => sum + item.score * item.weight, 0) / 100, 1);
  const rawTarget = 20 + ((score - 30) / 50) * 70;
  const targetPosition = Math.round(clamp(rawTarget, 20, 90) / 5) * 5;
  const health = assessData(bundle, now);
  const total = portfolio ? portfolio.marketValue + portfolio.cash : 0;
  const currentPosition = total > 0 && portfolio ? (portfolio.marketValue / total) * 100 : targetPosition;
  const uncappedChange = targetPosition - currentPosition;
  const suggestedPositionChange = portfolio
    ? (Math.abs(uncappedChange) < 5 ? 0 : clamp(uncappedChange, -20, 20))
    : (score >= 60 ? 10 : score < 42 ? -10 : 0);
  const action = suggestedPositionChange > 0 ? "subscribe" : suggestedPositionChange < 0 ? "redeem" : "hold";
  const amount = portfolio ? Math.min(Math.abs((suggestedPositionChange / 100) * total), action === "subscribe" ? portfolio.cash : portfolio.marketValue) : undefined;
  const latestNav = bundle.navSeries.at(-1)?.value ?? 1;
  const warnings: string[] = [];
  if (bundle.mode === "sample") warnings.push("当前为内置演示快照，只展示功能，不构成当日操作依据");
  if (health.quoteStale) warnings.push("实时行情已过期，禁止生成最终金额建议");
  if (health.dailyStale) warnings.push("日K数据已超过10天未更新，禁止生成最终金额建议");
  if (health.conflict) warnings.push("主备价格差异超过0.3%，禁止生成最终金额建议");
  if (!bundle.backtest.returnPassed && bundle.backtest.defensePassed) warnings.push("收益增强尚未证实；防守型仓位规则已达到回撤控制门槛");
  else if (!bundle.backtest.returnPassed) warnings.push("策略的收益增强与回撤控制均尚未通过样本外验证");
  if (portfolio && portfolio.peakValue > 0 && portfolio.marketValue / portfolio.peakValue - 1 <= -0.15) warnings.push("账户回撤已达到15%预警线，不触发强制卖出");
  const status = health.conflict || health.stale ? "blocked" : health.canFinalize ? "final" : "preliminary";
  return {
    version: "1.0",
    generatedAt: now.toISOString(),
    status,
    action,
    score,
    targetPosition,
    suggestedPositionChange: round(suggestedPositionChange, 1),
    suggestedAmount: status === "final" && amount !== undefined ? Math.round(amount) : undefined,
    suggestedShares: status === "final" && action === "redeem" && amount !== undefined ? Math.floor(amount / latestNav * 100) / 100 : undefined,
    dataCompleteness: health.completeness,
    validationPassed: bundle.backtest.validationPassed,
    title: action === "subscribe" ? "当前点位偏适合分批买入" : action === "redeem" ? "当前点位偏谨慎，暂停投入" : "信号中性，今日以观察为主",
    reason: `市场类贡献${round(factors.filter((item) => item.group === "market").reduce((sum, item) => sum + item.contribution, 0), 1)}，信息类贡献${round(factors.filter((item) => item.group === "information").reduce((sum, item) => sum + item.contribution, 0), 1)}。`,
    warnings,
    factors,
  };
}
