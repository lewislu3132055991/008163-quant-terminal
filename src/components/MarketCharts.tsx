import { useEffect, useMemo, useRef, useState } from "react";
import { Download, RotateCw, ShieldCheck } from "lucide-react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { DailyDecisionRecord, IntradayBar, OhlcvBar, ResearchBundle } from "../types";
import { ema, rsi, sma } from "../lib/strategy";
import { buildTimingStudy } from "../lib/timing";
import { communityResearch, productPatterns, type CommunityRuleStage } from "../data/community";

const chartOptions = {
  layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#68716c", fontSize: 11 },
  grid: { vertLines: { color: "#edf0ed" }, horzLines: { color: "#edf0ed" } },
  rightPriceScale: { borderColor: "#dde2de" },
  timeScale: { borderColor: "#dde2de", timeVisible: true, secondsVisible: false, rightOffset: 2 },
  crosshair: { vertLine: { color: "#7a827d", labelBackgroundColor: "#242a27" }, horzLine: { color: "#7a827d", labelBackgroundColor: "#242a27" } },
  localization: { locale: "zh-CN" },
} as const;

function useResizeChart(container: React.RefObject<HTMLDivElement | null>, chart: React.MutableRefObject<IChartApi | null>) {
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => chart.current?.applyOptions({ width: entry.contentRect.width }));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [chart, container]);
}

export function supportResistance(bars: OhlcvBar[]) {
  const recent = bars.slice(-120);
  const last = recent.at(-1)?.close ?? 0;
  const lows = recent.filter((bar, index) => index >= 2 && index < recent.length - 2 && bar.low <= Math.min(...recent.slice(index - 2, index + 3).map((item) => item.low))).map((bar) => bar.low);
  const highs = recent.filter((bar, index) => index >= 2 && index < recent.length - 2 && bar.high >= Math.max(...recent.slice(index - 2, index + 3).map((item) => item.high))).map((bar) => bar.high);
  const support = lows.filter((value) => value <= last).sort((a, b) => b - a)[0] ?? Math.min(...recent.slice(-20).map((bar) => bar.low));
  const resistance = highs.filter((value) => value >= last).sort((a, b) => a - b)[0] ?? Math.max(...recent.slice(-20).map((bar) => bar.high));
  return { support, resistance };
}

function DailyChart({ bars, decisions }: { bars: OhlcvBar[]; decisions: DailyDecisionRecord[] }) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const latest = bars.at(-1);
  const [readout, setReadout] = useState(latest);
  useResizeChart(container, chart);

  useEffect(() => {
    if (!container.current) return;
    const api = createChart(container.current, { ...chartOptions, height: 330 });
    chart.current = api;
    const candle = api.addSeries(CandlestickSeries, {
      upColor: "#c63d45", downColor: "#14825d", wickUpColor: "#c63d45", wickDownColor: "#14825d", borderVisible: false,
      priceFormat: { type: "price", precision: 3, minMove: 0.001 },
    });
    candle.setData(bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    const levels = supportResistance(bars);
    candle.createPriceLine({ price: levels.support, color: "#14825d", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "支撑" });
    candle.createPriceLine({ price: levels.resistance, color: "#c63d45", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "压力" });
    const barDates = new Set(bars.map((bar) => bar.time));
    createSeriesMarkers(candle, decisions.filter((item) => barDates.has(item.date)).map((item) => ({
      time: item.date,
      position: item.recommendation.action === "subscribe" ? "belowBar" as const : item.recommendation.action === "redeem" ? "aboveBar" as const : "inBar" as const,
      color: item.recommendation.action === "subscribe" ? "#c63d45" : item.recommendation.action === "redeem" ? "#14825d" : "#68716c",
      shape: item.recommendation.action === "subscribe" ? "arrowUp" as const : item.recommendation.action === "redeem" ? "arrowDown" as const : "circle" as const,
      text: `${item.recommendation.targetPosition}%`,
    })));
    const volume = api.addSeries(HistogramSeries, { priceScaleId: "volume", priceFormat: { type: "volume" } });
    api.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volume.setData(bars.map((bar) => ({ time: bar.time, value: bar.volume, color: bar.close >= bar.open ? "#c63d4570" : "#14825d70" })));
    const closes = bars.map((bar) => bar.close);
    const colors: Record<number, string> = { 5: "#d68a15", 10: "#137b8a", 20: "#7d5aa6", 60: "#3449a2", 120: "#9d603f", 250: "#222826" };
    [5, 10, 20, 60, 120, 250].forEach((period) => {
      const series = api.addSeries(LineSeries, { color: colors[period], lineWidth: period <= 20 ? 2 : 1, title: `MA${period}`, priceLineVisible: false, lastValueVisible: false });
      series.setData(bars.slice(period - 1).map((bar, index) => ({ time: bar.time, value: sma(closes.slice(0, index + period), period) })));
    });
    const boll = api.addSeries(LineSeries, { color: "#929a95", lineWidth: 1, lineStyle: 2, title: "BOLL", priceLineVisible: false, lastValueVisible: false });
    boll.setData(bars.slice(19).map((bar, index) => {
      const window = closes.slice(index, index + 20);
      const mean = sma(window, 20);
      const sd = Math.sqrt(window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / window.length);
      return { time: bar.time, value: mean + 2 * sd };
    }));
    api.subscribeCrosshairMove((param) => {
      const value = param.seriesData.get(candle) as { open?: number; high?: number; low?: number; close?: number } | undefined;
      if (value?.close !== undefined) setReadout({ time: String(param.time ?? ""), open: value.open!, high: value.high!, low: value.low!, close: value.close, volume: 0 });
      else setReadout(bars.at(-1));
    });
    api.timeScale().fitContent();
    return () => { api.remove(); chart.current = null; };
  }, [bars]);
  return <div><div className="chart-readout" aria-live="polite"><span>{readout?.time ?? "--"}</span><span>开 {readout?.open.toFixed(3) ?? "--"}</span><span>高 {readout?.high.toFixed(3) ?? "--"}</span><span>低 {readout?.low.toFixed(3) ?? "--"}</span><span>收 {readout?.close.toFixed(3) ?? "--"}</span></div><div className="chart-canvas" ref={container} aria-label="515450日K线图" /></div>;
}

function IntradayChart({ bars, previousClose }: { bars: IntradayBar[]; previousClose: number }) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const [decisionX, setDecisionX] = useState<number | null>(null);
  useResizeChart(container, chart);
  useEffect(() => {
    if (!container.current) return;
    const api = createChart(container.current, { ...chartOptions, height: 330 });
    chart.current = api;
    const toTime = (value: string) => Math.floor(new Date(value).getTime() / 1000) as UTCTimestamp;
    const price = api.addSeries(LineSeries, { color: "#c63d45", lineWidth: 2, title: "价格", priceFormat: { type: "price", precision: 3, minMove: 0.001 } });
    const vwap = api.addSeries(LineSeries, { color: "#d68a15", lineWidth: 2, title: "VWAP", priceLineVisible: false });
    const iopv = api.addSeries(LineSeries, { color: "#137b8a", lineWidth: 1, lineStyle: 2, title: "IOPV", priceLineVisible: false });
    const volume = api.addSeries(HistogramSeries, { priceScaleId: "volume", priceFormat: { type: "volume" } });
    api.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    price.setData(bars.map((bar) => ({ time: toTime(bar.time), value: bar.close })));
    vwap.setData(bars.map((bar) => ({ time: toTime(bar.time), value: bar.vwap })));
    iopv.setData(bars.filter((bar) => bar.iopv).map((bar) => ({ time: toTime(bar.time), value: bar.iopv! })));
    volume.setData(bars.map((bar) => ({ time: toTime(bar.time), value: bar.volume, color: bar.close >= previousClose ? "#c63d4555" : "#14825d55" })));
    price.createPriceLine({ price: previousClose, color: "#929a95", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "昨收" });
    api.timeScale().fitContent();
    const date = bars.at(-1)?.time.slice(0, 10);
    const updateLine = () => setDecisionX(date ? api.timeScale().timeToCoordinate(toTime(`${date}T14:45:00+08:00`)) : null);
    window.setTimeout(updateLine, 0);
    api.timeScale().subscribeVisibleTimeRangeChange(updateLine);
    return () => { api.remove(); chart.current = null; };
  }, [bars, previousClose]);
  return <div className="chart-wrap"><div className="chart-canvas" ref={container} aria-label="515450五分钟分时图" />{decisionX !== null && <div className="decision-line" style={{ left: decisionX }}><span>14:45 决策</span></div>}</div>;
}

type Indicator = "MACD" | "RSI" | "KDJ" | "ATR" | "OBV";

function indicatorValues(bars: OhlcvBar[], indicator: Indicator) {
  const closes = bars.map((bar) => bar.close);
  let obv = 0;
  let k = 50;
  return bars.map((bar, index) => {
    const prefix = closes.slice(0, index + 1);
    if (indicator === "MACD") return ema(prefix, 12) - ema(prefix, 26);
    if (indicator === "RSI") return rsi(prefix, 14);
    if (indicator === "KDJ") {
      const window = bars.slice(Math.max(0, index - 8), index + 1);
      const low = Math.min(...window.map((item) => item.low));
      const high = Math.max(...window.map((item) => item.high));
      const rsv = high === low ? 50 : ((bar.close - low) / (high - low)) * 100;
      k = (2 * k + rsv) / 3;
      return k;
    }
    if (indicator === "ATR") {
      const window = bars.slice(Math.max(0, index - 13), index + 1);
      return window.reduce((sum, item, localIndex) => {
        const prev = bars[Math.max(0, index - window.length + localIndex)].close;
        return sum + Math.max(item.high - item.low, Math.abs(item.high - prev), Math.abs(item.low - prev));
      }, 0) / window.length;
    }
    if (index > 0) obv += Math.sign(bar.close - bars[index - 1].close) * bar.volume;
    return obv;
  });
}

function indicatorLesson(bars: OhlcvBar[], indicator: Indicator) {
  const values = indicatorValues(bars, indicator);
  const value = values.at(-1) ?? 0;
  const previous = values.at(-6) ?? value;
  const close = bars.at(-1)?.close ?? 1;
  if (indicator === "MACD") return {
    value: value.toFixed(4), state: value > 0 ? "多头动量" : "空头动量",
    meaning: `MACD在零轴${value > 0 ? "上方" : "下方"}，近5日${value >= previous ? "走强" : "走弱"}。它用于确认趋势速度，不负责预测拐点。`,
    action: value > 0 && value >= previous ? "支持保持较高仓位，但仍需趋势和量能共同确认。" : "不支持追涨；若趋势也转弱，应降低目标仓位。",
    caution: "震荡市容易反复交叉，单看一次金叉或死叉常会产生假信号。",
  };
  if (indicator === "RSI") return {
    value: value.toFixed(1), state: value >= 70 ? "偏热" : value <= 30 ? "偏冷" : "中性区",
    meaning: `RSI14为${value.toFixed(1)}，衡量最近上涨与下跌力度。70以上是偏热，不等于马上下跌；30以下同理。`,
    action: value >= 70 ? "不宜一次性大额追高，可等待回落或分批。" : value <= 30 ? "可观察止跌信号，但不能仅凭超卖抄底。" : "动量没有极端拥挤，服从中期趋势。",
    caution: "强趋势里RSI可长时间停留在高位或低位。",
  };
  if (indicator === "KDJ") return {
    value: value.toFixed(1), state: value >= 80 ? "短线偏热" : value <= 20 ? "短线偏冷" : "短线中性",
    meaning: `K值为${value.toFixed(1)}，更敏感地观察9日价格在区间中的位置，适合看短线节奏。`,
    action: value >= 80 ? "场外基金未知价成交，避免因短线高位信号频繁申赎。" : value <= 20 ? "等待价格重新站稳均线，再考虑加仓。" : "没有明显短线极值，重点看MA20/MA60。",
    caution: "KDJ比RSI更灵敏，也更容易在单边行情中钝化。",
  };
  if (indicator === "ATR") return {
    value: `${(value / close * 100).toFixed(2)}%`, state: value >= previous ? "波动扩大" : "波动收敛",
    meaning: `ATR14约占价格${(value / close * 100).toFixed(2)}%，只表示每天通常波动多大，不表示涨跌方向。`,
    action: value >= previous ? "波动上升时减少单次调整幅度，优先分批。" : "波动收敛，仓位变化可以更平缓地执行。",
    caution: "ATR上升可能来自大涨，也可能来自大跌，必须配合趋势判断。",
  };
  return {
    value: new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value), state: value >= previous ? "量能累积" : "量能流出",
    meaning: `OBV近5日${value >= previous ? "上行" : "下行"}，用成交量检验价格趋势是否得到资金配合。绝对数值本身没有横向比较意义。`,
    action: value >= previous ? "量价方向一致时，趋势信号可信度更高。" : "若价格上涨但OBV下降，警惕量价背离。",
    caution: "ETF大额申赎和尾盘成交会扭曲单日成交量，需看连续变化。",
  };
}

function TechnicalSummary({ bars }: { bars: OhlcvBar[] }) {
  const closes = bars.map((bar) => bar.close);
  const latest = bars.at(-1)!;
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);
  const rsi14 = rsi(closes, 14);
  const atr = indicatorValues(bars, "ATR").at(-1) ?? 0;
  const levels = supportResistance(bars);
  const volume20 = bars.slice(-20).reduce((sum, bar) => sum + bar.volume, 0) / Math.min(20, bars.length);
  const volumeRatio = volume20 ? latest.volume / volume20 : 1;
  const positives = [latest.close > ma20, ma20 > ma60, rsi14 >= 50, volumeRatio >= 1].filter(Boolean).length;
  const action = positives >= 3 ? "趋势允许继续持有或小额顺势投入，但不追涨"
    : positives <= 1 ? "暂停新增；已有仓位也不要只凭技术面一次性赎回"
      : "多空证据冲突，今天以观察和分批为主";
  return <div className="technical-summary">
    <div className="summary-head"><div><strong>今日技术结论</strong><span>4组相互独立的证据</span></div><span className={`signal-chip ${positives >= 3 ? "positive-bg" : positives <= 1 ? "negative-bg" : "neutral-bg"}`}>{positives >= 3 ? "偏强" : positives <= 1 ? "偏弱" : "中性"}</span></div>
    <div className="tech-grid">
      <div><span>趋势</span><strong>{latest.close > ma20 && ma20 > ma60 ? "多头排列" : latest.close < ma20 && ma20 < ma60 ? "空头排列" : "方向混合"}</strong><small>收盘 {latest.close > ma20 ? "高于" : "低于"} MA20；MA20 {ma20 > ma60 ? "高于" : "低于"} MA60</small></div>
      <div><span>动量</span><strong>RSI {rsi14.toFixed(0)}</strong><small>{rsi14 >= 70 ? "偏热，不等于立即下跌" : rsi14 <= 30 ? "偏冷，等待止跌确认" : "未进入极端区域"}</small></div>
      <div><span>风险</span><strong>ATR {(atr / latest.close * 100).toFixed(2)}%</strong><small>支撑 {levels.support.toFixed(3)} · 压力 {levels.resistance.toFixed(3)}</small></div>
      <div><span>量价</span><strong>量比 {volumeRatio.toFixed(2)}</strong><small>{volumeRatio >= 1 ? "成交量高于20日均量" : "成交量低于20日均量"}</small></div>
    </div>
    <div className="technical-action"><span>翻译成操作</span><strong>{action}</strong></div>
    <p>读法：先看趋势决定方向，再用动量和量价确认，最后用ATR控制每次调整大小。任何单一指标都不直接等于买卖指令。</p>
  </div>;
}

function median(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2;
}

function forwardStats(values: number[], predicate: (index: number) => boolean, horizon: number, start = 20) {
  const returns: number[] = [];
  for (let index = start; index < values.length - horizon; index += 1) {
    if (predicate(index)) returns.push(values[index + horizon] / values[index] - 1);
  }
  return {
    count: returns.length,
    winRate: returns.length ? returns.filter((value) => value > 0).length / returns.length * 100 : 0,
    median: returns.length ? median(returns) * 100 : 0,
  };
}

function FundRuleLab({ bundle }: { bundle: ResearchBundle }) {
  const nav = bundle.navSeries.map((item) => item.value);
  const adjusted = bundle.navSeries.map((item) => item.accumulated ?? item.value);
  const current = adjusted.at(-1) ?? 0;
  const raw = nav.at(-1) ?? 0;
  const raw250 = sma(nav, 250);
  const ma5 = sma(adjusted, 5);
  const ma20 = sma(adjusted, 20);
  const ma250 = sma(adjusted, 250);
  const previous5 = sma(adjusted.slice(0, -1), 5);
  const previous20 = sma(adjusted.slice(0, -1), 20);
  const cross = previous5 <= previous20 && ma5 > ma20 ? "今日金叉" : previous5 >= previous20 && ma5 < ma20 ? "今日死叉" : ma5 > ma20 ? "金叉后运行" : "死叉后运行";
  const crossStats = (golden: boolean) => forwardStats(adjusted, (index) => {
    const prior5 = sma(adjusted.slice(0, index), 5);
    const prior20 = sma(adjusted.slice(0, index), 20);
    const current5 = sma(adjusted.slice(0, index + 1), 5);
    const current20 = sma(adjusted.slice(0, index + 1), 20);
    return golden ? prior5 <= prior20 && current5 > current20 : prior5 >= prior20 && current5 < current20;
  }, 20);
  const golden = crossStats(true);
  const death = crossStats(false);
  const below250 = forwardStats(adjusted, (index) => adjusted[index] < sma(adjusted.slice(0, index + 1), 250), 120, 250);
  const above250 = forwardStats(adjusted, (index) => adjusted[index] >= sma(adjusted.slice(0, index + 1), 250), 120, 250);
  const afterTenPercent = forwardStats(adjusted, (index) => adjusted[index] / adjusted[index - 60] - 1 >= 0.10, 20, 60);
  const current60 = adjusted.length > 60 ? (current / adjusted.at(-61)! - 1) * 100 : 0;
  return <div className="rule-lab">
    <div className="summary-head"><div><strong>008163 规则实验室</strong><span>成立以来净值 · 分红再投资口径</span></div><BadgeLike>{bundle.navSeries.length}个净值日</BadgeLike></div>
    <article><div><span>规则一</span><strong>MA5 / MA20 金叉与死叉</strong><b>{cross}</b></div><p>MA5代表约一周平均成本，MA20代表约一个月。MA5上穿MA20通常叫<strong>金叉</strong>，下穿叫<strong>死叉</strong>；“银叉”不是统一术语。</p><div className="rule-stats"><span>金叉后20日<br /><b>{golden.winRate.toFixed(0)}%上涨</b> · 中位{golden.median.toFixed(2)}%</span><span>死叉后20日<br /><b>{death.winRate.toFixed(0)}%上涨</b> · 中位{death.median.toFixed(2)}%</span></div><small>本基金历史里两者差距并不大，说明短均线交叉只能确认节奏，不能单独决定买卖；需配合MA250、RSI和量价。</small></article>
    <article><div><span>规则二</span><strong>低于MA250才额外投入</strong><b className={current < ma250 ? "positive" : "neutral-text"}>{current < ma250 ? "满足加码条件" : "暂不额外加码"}</b></div><p>MA250约代表一年平均成本，更适合判断长期位置。当前分红复权净值 {current.toFixed(4)}，MA250为 {ma250.toFixed(4)}，相差 {((current / ma250 - 1) * 100).toFixed(2)}%。</p><div className="rule-stats"><span>年线下买入后120日<br /><b>{below250.winRate.toFixed(0)}%上涨</b> · 中位{below250.median.toFixed(2)}%</span><span>年线上买入后120日<br /><b>{above250.winRate.toFixed(0)}%上涨</b> · 中位{above250.median.toFixed(2)}%</span></div><small>单位净值 {raw.toFixed(4)} 看起来比其MA250低 {Math.abs((raw / raw250 - 1) * 100).toFixed(2)}%，但分红除息会压低单位净值。量化判断必须使用累计净值或复权序列，避免假跌破。</small></article>
    <article><div><span>规则三</span><strong>“涨多少就会跌”不存在固定答案</strong><b>当前60日 {current60 >= 0 ? "+" : ""}{current60.toFixed(2)}%</b></div><p>历史上60日涨幅达到10%后，随后20日上涨比例为 {afterTenPercent.winRate.toFixed(0)}%，中位收益 {afterTenPercent.median.toFixed(2)}%，样本 {afterTenPercent.count} 次。</p><small>上涨过快会提高均值回归概率，但不是必跌。样本数、趋势强度、估值和利率环境都要一起看，因此只用于暂停追涨或缩小单次投入。</small></article>
  </div>;
}

function BadgeLike({ children }: { children: React.ReactNode }) {
  return <span className="signal-chip neutral-bg">{children}</span>;
}

function IntradayLesson({ bundle }: { bundle: ResearchBundle }) {
  const latest = bundle.intraday.at(-1);
  if (!latest) return null;
  const aboveVwap = latest.close >= latest.vwap;
  const recentVolume = bundle.intraday.slice(-6).reduce((sum, bar) => sum + bar.volume, 0) / Math.min(6, bundle.intraday.length);
  const averageVolume = bundle.intraday.reduce((sum, bar) => sum + bar.volume, 0) / bundle.intraday.length;
  const signal = aboveVwap && latest.close >= bundle.previousClose ? "盘中偏强" : !aboveVwap && latest.close < bundle.previousClose ? "盘中偏弱" : "方向混合";
  return <div className="technical-summary intraday-lesson">
    <div className="summary-head"><div><strong>分时图怎么读</strong><span>只判断今天的方向，不替代场外确认净值</span></div><span className="signal-chip neutral-bg">{signal}</span></div>
    <div className="tech-grid"><div><span>价格 vs VWAP</span><strong>{latest.close.toFixed(3)} / {latest.vwap.toFixed(3)}</strong><small>{aboveVwap ? "价格在当日平均成本上方，买方略占优" : "价格在当日平均成本下方，卖方略占优"}</small></div><div><span>价格 vs IOPV</span><strong>溢价 {bundle.premiumRate.value.toFixed(2)}%</strong><small>{Math.abs(bundle.premiumRate.value) > 0.3 ? "偏离超过0.3%，盘中价格可信度下降" : "折溢价处于观察阈值内"}</small></div><div><span>最近30分钟量能</span><strong>{(recentVolume / averageVolume).toFixed(2)}倍</strong><small>{recentVolume >= averageVolume ? "近期成交活跃，方向信号更有分量" : "近期缩量，价格变化确认度较低"}</small></div><div><span>14:45以后</span><strong>观察而非追价</strong><small>场外基金未知价申赎，用尾盘信息判断当天净值方向</small></div></div>
    <p>组合顺序：价格在VWAP上方 + IOPV折溢价正常 + 放量，才算较完整的盘中强势；三者冲突时按“方向不明”处理。</p>
  </div>;
}

function IndicatorChart({ bars, indicator }: { bars: OhlcvBar[]; indicator: Indicator }) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  useResizeChart(container, chart);
  useEffect(() => {
    if (!container.current) return;
    const api = createChart(container.current, { ...chartOptions, height: 145, rightPriceScale: { borderColor: "#dde2de", scaleMargins: { top: 0.16, bottom: 0.12 } } });
    chart.current = api;
    const line = api.addSeries(LineSeries, { color: indicator === "RSI" || indicator === "KDJ" ? "#7d5aa6" : "#137b8a", lineWidth: 2, title: indicator, priceLineVisible: false });
    const values = indicatorValues(bars, indicator);
    line.setData(bars.map((bar, index) => ({ time: bar.time, value: values[index] })));
    if (indicator === "RSI" || indicator === "KDJ") {
      line.createPriceLine({ price: 70, color: "#c63d4570", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });
      line.createPriceLine({ price: 30, color: "#14825d70", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });
    }
    api.timeScale().fitContent();
    return () => { api.remove(); chart.current = null; };
  }, [bars, indicator]);
  return <div className="chart-canvas indicator-canvas" ref={container} aria-label={`${indicator}指标图`} />;
}

export function MarketCharts({ bundle, decisions = [] }: { bundle: ResearchBundle; decisions?: DailyDecisionRecord[] }) {
  const [mode, setMode] = useState<"daily" | "intraday">("daily");
  const [indicator, setIndicator] = useState<Indicator>("MACD");
  const last = bundle.quote.value;
  const change = (last / bundle.previousClose - 1) * 100;
  const lesson = indicatorLesson(bundle.daily, indicator);
  return <section className="chart-section">
    <TechnicalSummary bars={bundle.daily} />
    <div className="chart-reading-order"><span><b>1</b>先看技术结论</span><i /><span><b>2</b>再看K线位置</span><i /><span><b>3</b>最后选指标验证</span></div>
    <div className="section-heading chart-heading">
      <div><p className="eyebrow">515450 · {mode === "daily" ? "复权日线" : "5分钟"}</p><h2>{last.toFixed(3)} <small className={change >= 0 ? "positive" : "negative"}>{change >= 0 ? "+" : ""}{change.toFixed(2)}%</small></h2></div>
      <div className="segmented" role="tablist"><button className={mode === "daily" ? "active" : ""} onClick={() => setMode("daily")}>日K</button><button className={mode === "intraday" ? "active" : ""} onClick={() => setMode("intraday")}>5分钟</button></div>
    </div>
    <div className="chart-legend"><span><i className="dot price" />价格</span><span><i className="dot avg" />均线/VWAP</span><span><i className="dot iopv" />IOPV</span><span>折溢价 {bundle.premiumRate.value.toFixed(2)}%</span></div>
    {mode === "daily" ? <DailyChart bars={bundle.daily} decisions={decisions} /> : <IntradayChart bars={bundle.intraday} previousClose={bundle.previousClose} />}
    {mode === "daily" && <>
      <div className="indicator-tabs" role="tablist">{(["MACD", "RSI", "KDJ", "ATR", "OBV"] as Indicator[]).map((item) => <button key={item} className={indicator === item ? "active" : ""} onClick={() => setIndicator(item)}>{item}</button>)}</div>
      <IndicatorChart bars={bundle.daily} indicator={indicator} />
      <div className="indicator-lesson">
        <div><span>当前读数</span><strong>{lesson.value}</strong><b>{lesson.state}</b></div>
        <p><strong>怎么看：</strong>{lesson.meaning}</p>
        <p><strong>对操作：</strong>{lesson.action}</p>
        <p className="lesson-caution"><strong>易错点：</strong>{lesson.caution}</p>
      </div>
      <details className="chart-rule-details"><summary>继续学习：008163均线规则的历史检验</summary><FundRuleLab bundle={bundle} /></details>
    </>}
    {mode === "intraday" && <IntradayLesson bundle={bundle} />}
  </section>;
}

export function ComparisonChart({ bundle }: { bundle: ResearchBundle }) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  useResizeChart(container, chart);
  const fund = useMemo(() => bundle.navSeries.slice(-260).map((item) => ({ ...item, value: item.accumulated ?? item.value })), [bundle.navSeries]);
  const benchmark = useMemo(() => bundle.benchmarkSeries.slice(-260), [bundle.benchmarkSeries]);
  useEffect(() => {
    if (!container.current) return;
    const api = createChart(container.current, { ...chartOptions, height: 260 });
    chart.current = api;
    const normalized = (values: typeof fund) => { const base = values[0]?.value ?? 100; return values.map((item) => ({ time: item.time, value: item.value / base * 100 })); };
    const nav = api.addSeries(LineSeries, { color: "#c63d45", lineWidth: 2, title: "008163", priceLineVisible: false });
    const etf = api.addSeries(LineSeries, { color: "#d68a15", lineWidth: 2, title: "515450", priceLineVisible: false });
    const hs300 = api.addSeries(LineSeries, { color: "#137b8a", lineWidth: 2, title: "沪深300", priceLineVisible: false });
    nav.setData(normalized(fund));
    etf.setData(normalized(bundle.daily.slice(-260).map((bar) => ({ time: bar.time, value: bar.close }))));
    hs300.setData(normalized(benchmark));
    api.timeScale().fitContent();
    return () => { api.remove(); chart.current = null; };
  }, [benchmark, bundle.daily, fund]);
  return <div className="comparison"><div className="chart-legend"><span><i className="dot fund" />008163</span><span><i className="dot etf" />515450</span><span><i className="dot hs300" />沪深300</span></div><div className="chart-canvas" ref={container} aria-label="累计收益对比图" /></div>;
}

function TimingHistoryChart({ bundle }: { bundle: ResearchBundle }) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  useResizeChart(container, chart);
  useEffect(() => {
    if (!container.current) return;
    const api = createChart(container.current, { ...chartOptions, height: 300 });
    chart.current = api;
    const values = bundle.navSeries.map((item) => item.accumulated ?? item.value);
    const nav = api.addSeries(LineSeries, { color: "#c63d45", lineWidth: 2, title: "复权净值", priceLineVisible: false });
    const ma250 = api.addSeries(LineSeries, { color: "#232825", lineWidth: 2, title: "MA250", priceLineVisible: false });
    nav.setData(bundle.navSeries.map((item, index) => ({ time: item.time, value: values[index] })));
    ma250.setData(bundle.navSeries.slice(249).map((item, index) => ({ time: item.time, value: sma(values.slice(0, index + 250), 250) })));
    api.timeScale().fitContent();
    return () => { api.remove(); chart.current = null; };
  }, [bundle.navSeries]);
  return <div className="chart-canvas" ref={container} aria-label="008163复权净值与250日均线" />;
}

function DeviationHistoryChart({ bundle }: { bundle: ResearchBundle }) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const study = useMemo(() => buildTimingStudy(bundle.navSeries), [bundle.navSeries]);
  useResizeChart(container, chart);
  useEffect(() => {
    if (!container.current) return;
    const api = createChart(container.current, { ...chartOptions, height: 185 });
    chart.current = api;
    const values = bundle.navSeries.map((item) => item.accumulated ?? item.value);
    const deviation = api.addSeries(LineSeries, {
      color: "#137b8a", lineWidth: 2, title: "偏离度", priceLineVisible: false,
      priceFormat: { type: "custom", formatter: (value: number) => `${value.toFixed(1)}%` },
    });
    deviation.setData(bundle.navSeries.slice(249).map((item, index) => ({
      time: item.time,
      value: (values[index + 249] / sma(values.slice(0, index + 250), 250) - 1) * 100,
    })));
    deviation.createPriceLine({ price: 0, color: "#23282580", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "MA250" });
    deviation.createPriceLine({ price: study.p20 * 100, color: "#14825d90", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "P20" });
    deviation.createPriceLine({ price: study.p80 * 100, color: "#c63d4590", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "P80" });
    api.timeScale().fitContent();
    return () => { api.remove(); chart.current = null; };
  }, [bundle.navSeries, study.p20, study.p80]);
  return <div className="chart-canvas deviation-canvas" ref={container} aria-label="008163相对250日均线偏离度" />;
}

export function TimingDashboard({ bundle }: { bundle: ResearchBundle }) {
  const study = useMemo(() => buildTimingStudy(bundle.navSeries), [bundle.navSeries]);
  const crossText = study.crossState === "golden-today" ? "今日金叉" : study.crossState === "death-today" ? "今日死叉" : study.crossState === "above" ? "MA5在MA20上方" : "MA5在MA20下方";
  const currentBand = study.bands.find((band) => study.deviation >= band.min && study.deviation < band.max);
  const researchCounts = communityResearch.rules.reduce((counts, rule) => {
    counts[rule.stage] += 1;
    return counts;
  }, { adopted: 0, shadow: 0, rejected: 0 } as Record<CommunityRuleStage, number>);
  const ruleAudit = [
    { rule: "净值低于MA250就加大投入", status: "修正后采用", tone: "good", finding: "本基金年线下的120日后上涨率和中位收益更高；但年线上也经常继续上涨，因此改为2/1.5/1/0.5/0份分档，不用全开全关。" },
    { rule: "MA5上穿MA20就买，下穿就卖", status: "仅作确认", tone: "warn", finding: `金叉后20日上涨率${study.goldenCross.winRate.toFixed(0)}%，死叉后仍有${study.deathCross.winRate.toFixed(0)}%；震荡期交叉频繁，不足以单独申赎。` },
    { rule: "低于年线满仓，高于年线清仓", status: "拒绝全开全关", tone: "bad", finding: "社区十年回测与本工具滚动样本外验证都显示：这类规则主要降低回撤，并未稳定取得超额收益。保留核心仓位，只调节新增投入。" },
    { rule: "周线RSI低于47买、高于63卖", status: "观察池", tone: "warn", finding: `在008163的${study.weeklyRsiAudit.weeks}周复权净值上，前一周信号执行、现金收益按0计，策略年化${study.weeklyRsiAudit.strategyAnnualized.toFixed(1)}%，同期持有${study.weeklyRsiAudit.benchmarkAnnualized.toFixed(1)}%，换向${study.weeklyRsiAudit.trades}次。精确阈值未显示稳定优势，不进入主建议。` },
    { rule: "股息率、PE和股债利差三信号", status: "影子因子", tone: "warn", finding: "方向有经济含义，但历史估值数据必须满足当时可见、口径一致。当前数据包尚不够完整，先展示学习，不参与仓位分数。" },
    { rule: "80分买、55分卖且每日调25%", status: "拒绝照搬", tone: "bad", finding: "原帖没有公开可复算的评分模型和样本外结果；场外基金又按未知净值成交，每日大幅换仓不匹配申赎机制。" },
    { rule: "涨到固定百分比后必然回落", status: "拒绝硬规则", tone: "bad", finding: "价格没有固定的“涨多少必跌”。只把高偏离度当作减少新增资金的理由，不据此一次性赎回。" },
    { rule: "用单位净值直接比较MA250", status: "拒绝", tone: "bad", finding: "008163会分红除息，单位净值出现机械下跳。年线研究必须用累计净值或分红再投资复权序列。" },
  ];
  const communityFindings = [
    { title: "均线看过程，不看按钮", body: "较完整的经验帖会同时观察均线方向、距离收敛或发散、价格所处位置，以及交叉后的持续性。这比只记“金叉买、死叉卖”可靠。" },
    { title: "MA250更适合管新增资金", body: "多篇年线定投帖把年线当估值替代物。复核后可保留“低位多投、高位少投”的思想，但不能把它解释成企业真实估值，也不应一线之隔就清仓。" },
    { title: "保留核心仓位有依据", body: "红利低波依靠股息再投资、低波筛选和定期调仓获取长期暴露。完全空仓容易错过趋势延续，工具因此只在极热时暂停新增，不自动赎回核心仓位。" },
    { title: "漂亮回测先检查可复现性", body: "资金因子、RSI和安全分模型常出现亮眼曲线，但若不公开公式、信号错位规则、费用与样本外结果，就只能作为候选想法，不能进入每日建议。" },
    { title: "OTC比ETF慢一个节拍", body: "008163按收盘后确认的未知净值申赎，无法按盘中看到的价格精确成交。盘中515450信号用于观察，最终建议以14:45附近状态和基金交易规则为准。" },
  ];
  return <div className="view-stack timing-dashboard">
    <section className="timing-hero">
      <div><p className="eyebrow">008163 · 分红复权口径</p><h1>{study.contributionLabel}</h1><p>这是对“下一笔新增资金”的建议，不代表把已有仓位全部买入或卖出。</p></div>
      <div className="timing-multiplier"><strong>{study.contributionMultiplier}</strong><span>倍投入</span></div>
    </section>
    <section className="timing-metrics">
      <div><span>复权净值</span><strong>{study.current.toFixed(4)}</strong><small>分红再投资</small></div>
      <div><span>MA250</span><strong>{study.ma250.toFixed(4)}</strong><small>约一年成本</small></div>
      <div><span>年线偏离</span><strong className={study.deviation <= 0 ? "negative" : "positive"}>{study.deviation >= 0 ? "+" : ""}{(study.deviation * 100).toFixed(2)}%</strong><small>越低越便宜，但非估值</small></div>
      <div><span>历史位置</span><strong>P{study.percentile.toFixed(0)}</strong><small>约{(100 - study.percentile).toFixed(0)}%历史日更高</small></div>
    </section>
    <section className="plain-section timing-chart-section">
      <div className="section-heading"><div><p className="eyebrow">位置比口诀更重要</p><h2>复权净值与MA250</h2></div><BadgeLike>{bundle.navSeries.length}日</BadgeLike></div>
      <div className="chart-legend"><span><i className="dot fund" />复权净值</span><span><i className="dot ma250" />MA250</span></div>
      <TimingHistoryChart bundle={bundle} />
      <div className="subchart-heading"><strong>均线偏离度</strong><span>P20 {(study.p20 * 100).toFixed(1)}% · P80 {(study.p80 * 100).toFixed(1)}%</span></div>
      <DeviationHistoryChart bundle={bundle} />
      <p className="plain-explainer">偏离度 = 复权净值 ÷ MA250 − 1。当前虽然略高于年线，但历史分位只有P{study.percentile.toFixed(0)}，应理解为“靠近年线的相对低位”，而不是机械判定为贵。</p>
    </section>
    <section className="plain-section">
      <div className="section-heading"><div><p className="eyebrow">每年环境不同</p><h2>各年跌破MA250的交易日占比</h2></div><BadgeLike>不满一年从形成MA250起算</BadgeLike></div>
      <div className="annual-bars">{study.annualBelow.map((row) => <div key={row.year}><span>{row.year}</span><div><i style={{ width: `${Math.max(1, row.percentage)}%` }} /></div><strong>{row.percentage.toFixed(1)}%</strong><small>{row.below}/{row.total}日</small></div>)}</div>
      <p className="method-note">2022年长时间位于年线下，而部分年份几乎从不跌破。MA250适合调节投入强度，不适合作为必须空仓的开关。</p>
    </section>
    <section className="plain-section">
      <div className="section-heading"><div><p className="eyebrow">成立以来 · 重叠样本</p><h2>不同年线位置，之后120日怎样</h2></div><BadgeLike>当前：{currentBand?.label}</BadgeLike></div>
      <div className="band-table"><div className="band-head"><span>买入位置</span><span>样本</span><span>上涨率</span><span>中位收益</span></div>{study.bands.map((band) => <div key={band.id} className={band.id === currentBand?.id ? "current" : ""}><strong>{band.label}</strong><span>{band.count}</span><span>{band.winRate.toFixed(0)}%</span><span>{band.medianReturn >= 0 ? "+" : ""}{band.medianReturn.toFixed(1)}%</span></div>)}</div>
      <p className="method-note">相邻交易日的120日区间彼此重叠，所以“样本数”不是独立实验次数，不能把上涨率当未来概率。它用于比较相对位置，不用于保证收益。</p>
    </section>
    <section className="plain-section">
      <div className="section-heading"><div><p className="eyebrow">现金流回测 · 成立以来</p><h2>分档投入是否优于固定定投</h2></div><BadgeLike>每月首个净值日</BadgeLike></div>
      <div className="dca-comparison"><div><span>每月固定投100元</span><strong>收益率 {study.fixedDcaGain.toFixed(1)}%</strong><small>累计投入 ¥{study.fixedDcaInvested.toFixed(0)} · 期末 ¥{study.fixedDcaValue.toFixed(0)}</small></div><div><span>MA250分档投入</span><strong>收益率 {study.timingDcaGain.toFixed(1)}%</strong><small>累计投入 ¥{study.timingDcaInvested.toFixed(0)} · 期末 ¥{study.timingDcaValue.toFixed(0)}</small></div></div>
      <p className="plain-explainer">分档法把同一份基准资金按2/1.5/1/0.5/0倍投入，收益率略高，但实际投入金额更少，期末总资产也可能更少。它优化的是投入价格，不是凭空创造收益。</p>
    </section>
    <section className="plain-section">
      <div className="section-heading"><div><p className="eyebrow">短线只做确认</p><h2>MA5 / MA20 现在怎么看</h2></div><span className="signal-chip neutral-bg">{crossText}</span></div>
      <div className="cross-readout"><div><span>MA5</span><strong>{study.ma5.toFixed(4)}</strong><small>约一周成本</small></div><div><span>MA20</span><strong>{study.ma20.toFixed(4)}</strong><small>约一月成本</small></div></div>
      <p className="plain-explainer">金叉是MA5从下向上穿过MA20，死叉相反。“银叉”没有统一定义。对场外红利基金，更稳妥的用法是：MA250决定投入档位，MA5/MA20只决定是否立刻执行这档投入。</p>
    </section>
    <section className="plain-section">
      <div className="section-heading"><div><p className="eyebrow">经验先审计，再入模</p><h2>红利择时规则审计</h2></div><BadgeLike>008163自身数据</BadgeLike></div>
      <div className="rule-audit">{ruleAudit.map((item) => <article key={item.rule}><div><strong>{item.rule}</strong><span className={`audit-status ${item.tone}`}>{item.status}</span></div><p>{item.finding}</p></article>)}</div>
    </section>
    <section className="plain-section community-radar">
      <div className="section-heading"><div><p className="eyebrow">小红书经验研究库 · v{communityResearch.version}</p><h2>经验研究雷达</h2></div><BadgeLike>更新 {communityResearch.updatedAt}</BadgeLike></div>
      <div className="collector-health">
        <div className="collector-heading"><div><ShieldCheck size={18} /><span><strong>电脑端研究采集器</strong><small>登录会话内低频读取，原文仅保存在本地</small></span></div><a href="https://lewislu3132055991.github.io/008163-quant-terminal/tools/xhs-research-collector.zip" download><Download size={15} />下载采集器</a></div>
        <div className="collector-metrics"><div><span>每批上限</span><strong>6篇</strong></div><div><span>篇间等待</span><strong>12–20秒</strong></div><div><span>中断恢复</span><strong><RotateCw size={13} />保留队列</strong></div><div><span>登录/风控</span><strong>立即暂停</strong></div></div>
      </div>
      <div className="research-funnel"><span>帖子检索</span><i /><span>转成规则</span><i /><span>008163回测</span><i /><span>样本外验证</span><i /><span>进入建议</span></div>
      <div className="research-summary"><div><span>标题筛选</span><strong>{communityResearch.titleScreened}</strong></div><div><span>逐条深读</span><strong>{communityResearch.deepRead}</strong></div><div><span>已入模</span><strong>{researchCounts.adopted}</strong></div><div><span>影子观察</span><strong>{researchCounts.shadow}</strong></div><div><span>已拒绝</span><strong>{researchCounts.rejected}</strong></div></div>
      <div className="research-radar-list">{communityResearch.rules.map((rule) => <article key={rule.id}>
        <div><strong>{rule.title}</strong><span className={`research-stage ${rule.stage}`}>{rule.stage === "adopted" ? "已入模" : rule.stage === "shadow" ? "影子观察" : "已拒绝"}</span></div>
        <p><b>帖子观点：</b>{rule.communityClaim}</p><p><b>终端处理：</b>{rule.terminalUse}</p>
        <details><summary>查看验证依据和下一步</summary><p><b>验证：</b>{rule.validation}</p><p><b>下一步：</b>{rule.nextStep}</p></details>
      </article>)}</div>
      <div className="product-benchmark">
        <div className="subchart-heading"><strong>同类AI工具拆解</strong><span>取其结构，不抄黑箱</span></div>
        {productPatterns.map((item) => <article key={item.id}><div><strong>{item.pattern}</strong><span className={`research-stage ${item.decision === "adopted" ? "adopted" : item.decision === "adapted" ? "shadow" : "rejected"}`}>{item.decision === "adopted" ? "本轮采用" : item.decision === "adapted" ? "改造采用" : "不采用"}</span></div><p>{item.finding}</p><a href={item.sourceUrl} target="_blank" rel="noreferrer">来源：{item.source}</a></article>)}
      </div>
      <div className="research-queries"><span>持续检索主题</span>{communityResearch.queries.map((query) => <a key={query} href={`https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(query)}`} target="_blank" rel="noreferrer">{query}</a>)}</div>
      <p className="method-note">进入“已入模”不代表永久有效。每条规则都要持续监控样本外表现；失效时降回影子观察。点赞、收藏和作者收益截图只用于发现假设，不作为有效性证据。</p>
    </section>
    <section className="plain-section">
      <div className="section-heading"><div><p className="eyebrow">2026-08-06 · 社区研究笔记</p><h2>40篇标题筛选，9篇逐条深读</h2></div><BadgeLike>红利择时 / 回测</BadgeLike></div>
      <div className="community-findings">{communityFindings.map((item, index) => <article key={item.title}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{item.title}</strong><p>{item.body}</p></div></article>)}</div>
      <p className="method-note">社区帖子用于发现问题，不作为权威数据源。这里记录的是对规则的转述和审计结论，不复制作者未公开的模型，也不以点赞量替代验证。</p>
      <div className="source-links"><a href="https://www.xiaohongshu.com/search_result?keyword=%E7%BA%A2%E5%88%A9%E6%8B%A9%E6%97%B6" target="_blank" rel="noreferrer">检索：红利择时</a><a href="https://www.xiaohongshu.com/search_result?keyword=%E7%BA%A2%E5%88%A9%E5%9B%9E%E6%B5%8B" target="_blank" rel="noreferrer">检索：红利回测</a></div>
    </section>
    <section className="plain-section source-methods">
      <div className="section-heading"><div><p className="eyebrow">证据层级</p><h2>本页判断来自哪里</h2></div></div>
      <p><strong>一级：</strong>008163成立以来复权净值的直接统计和前一日信号计算。</p>
      <p><strong>二级：</strong>标普指数方法与研究，说明高股息后叠加低波筛选、半年调仓及红利陷阱风险。</p>
      <p><strong>三级：</strong>社区经验帖提供候选规则，只能在本基金数据复核后进入模型。</p>
      <div className="source-links"><a href="https://www.spglobal.com/spdji/zh/education/article/talkingpoints-finding-resilience-amid-uncertainty-a-low-volatility-high-dividend-approach-for-the-a-share-market/" target="_blank" rel="noreferrer">标普：A股红利低波策略</a><a href="https://www.nafmii.org.cn/yj/jrscyj/qk/2024/202404/202406/P020250324541975021112.pdf" target="_blank" rel="noreferrer">《金融评论》低波择时研究</a></div>
    </section>
  </div>;
}
