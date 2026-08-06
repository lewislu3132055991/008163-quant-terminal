import type { DatumMeta, IntradayBar, MarketDatum, OhlcvBar, ResearchBundle, ResearchEvent } from "../types";

const SAMPLE_AS_OF = "2026-08-04T15:00:00+08:00";
const RETRIEVED_AT = "2026-08-04T15:24:00+08:00";

function meta(source: string, frequency: DatumMeta["frequency"], pointInTimeSafe = true): DatumMeta {
  return { source, asOf: SAMPLE_AS_OF, retrievedAt: RETRIEVED_AT, frequency, quality: "sample", pointInTimeSafe };
}

function datum(value: number, source: string, frequency: DatumMeta["frequency"], pointInTimeSafe = true): MarketDatum<number> {
  return { value, ...meta(source, frequency, pointInTimeSafe) };
}

function mulberry32(seed: number) {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function createDaily(): OhlcvBar[] {
  const random = mulberry32(8163);
  const bars: OhlcvBar[] = [];
  const date = new Date("2024-12-02T00:00:00Z");
  let close = 1.245;
  while (bars.length < 410) {
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      const drift = bars.length > 270 ? 0.00055 : 0.0001;
      const shock = (random() - 0.5) * 0.018 + drift;
      const open = close * (1 + (random() - 0.5) * 0.006);
      close = Math.max(0.92, open * (1 + shock));
      const high = Math.max(open, close) * (1 + random() * 0.006);
      const low = Math.min(open, close) * (1 - random() * 0.006);
      bars.push({
        time: dateOnly(date),
        open: Number(open.toFixed(3)),
        high: Number(high.toFixed(3)),
        low: Number(low.toFixed(3)),
        close: Number(close.toFixed(3)),
        volume: Math.round(9_000_000 + random() * 22_000_000),
      });
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return bars;
}

function createIntraday(previousClose: number): IntradayBar[] {
  const random = mulberry32(515450);
  const bars: IntradayBar[] = [];
  let price = previousClose * 1.001;
  let cumulativeAmount = 0;
  let cumulativeVolume = 0;
  const sessions = [[9, 30, 24], [13, 0, 24]];
  for (const [hour, minute, count] of sessions) {
    for (let index = 0; index < count; index += 1) {
      const totalMinutes = hour * 60 + minute + index * 5;
      const hh = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
      const mm = String(totalMinutes % 60).padStart(2, "0");
      const open = price;
      price *= 1 + (random() - 0.47) * 0.0032;
      const volume = Math.round(160_000 + random() * 650_000);
      const average = (open + price) / 2;
      cumulativeAmount += average * volume;
      cumulativeVolume += volume;
      bars.push({
        time: `2026-08-04T${hh}:${mm}:00+08:00`,
        open: Number(open.toFixed(3)),
        high: Number((Math.max(open, price) * (1 + random() * 0.0012)).toFixed(3)),
        low: Number((Math.min(open, price) * (1 - random() * 0.0012)).toFixed(3)),
        close: Number(price.toFixed(3)),
        volume,
        vwap: Number((cumulativeAmount / cumulativeVolume).toFixed(3)),
        iopv: Number((price * (1 + (random() - 0.5) * 0.001)).toFixed(3)),
      });
    }
  }
  return bars;
}

function indexedSeries(daily: OhlcvBar[], beta: number, offset = 0) {
  const base = daily[0].close;
  return daily.map((bar, index) => ({
    time: bar.time,
    value: Number((100 * (bar.close / base) ** beta * (1 + Math.sin(index / 17) * offset)).toFixed(2)),
  }));
}

export function createSampleBundle(): ResearchBundle {
  const daily = createDaily();
  const intraday = createIntraday(daily.at(-2)!.close);
  const quote = intraday.at(-1)!.close;
  const eventMeta = meta("南方基金 / 上交所 / 中国人民银行", "event", false);
  const events: ResearchEvent[] = [
    { id: "fund-report", title: "基金定期报告进入更新窗口", category: "fund", impact: "neutral", summary: "关注目标ETF占比、跟踪误差与份额变化，正式采集后展示原文链接。", ...eventMeta },
    { id: "dividend-style", title: "高股息风格相对强弱回升", category: "index", impact: "positive", summary: "样例数据显示近20日相对沪深300占优，需以实时指数数据复核。", ...eventMeta },
    { id: "rates", title: "低利率环境支撑股债性价比", category: "macro", impact: "positive", summary: "10年国债收益率处于低位，高股息资产的相对现金流吸引力仍在。", ...eventMeta },
  ];
  return {
    version: "1.0",
    mode: "sample",
    generatedAt: RETRIEVED_AT,
    quote: datum(quote, "东方财富（演示）", "realtime"),
    backupQuote: datum(Number((quote * 1.0007).toFixed(3)), "腾讯行情（演示）", "realtime"),
    previousClose: daily.at(-2)!.close,
    iopv: datum(intraday.at(-1)!.iopv!, "上交所IOPV（演示）", "realtime"),
    premiumRate: datum(0.08, "行情与IOPV计算（演示）", "realtime"),
    turnoverRate: datum(2.31, "东方财富（演示）", "daily"),
    amount: datum(287_400_000, "东方财富（演示）", "daily"),
    daily,
    intraday,
    fundProfile: {
      name: "南方标普中国A股大盘红利低波50ETF联接A", code: "008163", shareClass: "A类",
      fundType: "股票型ETF联接基金", manager: "南方基金管理股份有限公司", custodian: "中国农业银行股份有限公司",
      inceptionDate: "2020-01-21", openFrequency: "每个开放日开放申购与赎回", targetEtf: "515450",
      targetIndex: "标普中国A股大盘红利低波50指数", targetEtfMinRatio: 90,
      benchmark: "标的指数收益率×95% + 银行活期存款税后利率×5%",
      dailyTrackingDeviationTarget: 0.35, annualTrackingErrorTarget: 4,
      latestNav: datum(1.284, "历史净值（演示）", "daily"),
      latestAccumulatedNav: datum(1.284, "历史净值（演示）", "daily"),
      latestNavChange: datum(0.42, "历史净值（演示）", "daily"),
      fees: {
        managementAnnual: 0.5, custodyAnnual: 0.1, salesServiceAnnual: 0,
        subscription: [{ range: "100万元以下", rate: "1.20%" }, { range: "100万—300万元", rate: "0.80%" }, { range: "300万—500万元", rate: "0.40%" }, { range: "500万元及以上", rate: "每笔1000元" }],
        redemption: [{ holdingPeriod: "少于7日", rate: "1.50%" }, { holdingPeriod: "不少于7日", rate: "0%" }],
        note: "销售机构可能有申购折扣；赎回费按持有期计算。", source: "南方基金产品资料概要", url: "https://www.nffund.com/main/files/2024/12/03/133713706418.pdf", asOf: "2024-11-05",
      },
      source: "南方基金产品资料概要", url: "https://www.nffund.com/main/files/2024/12/03/133713706418.pdf", asOf: "2024-11-05",
    },
    navSeries: indexedSeries(daily, 0.97, 0.002),
    benchmarkSeries: indexedSeries(daily, 0.72, 0.006),
    metrics: {
      trackingError: datum(0.42, "南方基金定期报告（演示）", "quarterly"),
      dividendYield: datum(5.78, "标普指数资料（演示）", "daily"),
      pe: datum(7.26, "标普指数资料（演示）", "daily"),
      pb: datum(0.91, "标普指数资料（演示）", "daily"),
      roe: datum(12.8, "成分股加权计算（演示）", "quarterly", false),
      breadth: datum(0.64, "50只成分股计算（演示）", "daily"),
      tenYearYield: datum(1.78, "中国债券信息网（演示）", "daily"),
      dr007: datum(1.55, "中国人民银行（演示）", "daily"),
      northboundProxy: datum(0.12, "市场资金代理（演示）", "daily", false),
      shareChange20d: datum(0.036, "上交所ETF份额（演示）", "daily"),
    },
    events,
    sources: [
      { id: "eastmoney", name: "东方财富行情", status: "sample", detail: "内置演示快照" },
      { id: "tencent", name: "腾讯行情", status: "sample", detail: "内置演示快照" },
      { id: "sse", name: "上交所ETF信息", status: "sample", detail: "等待公开采集" },
      { id: "southern", name: "南方基金", status: "sample", detail: "等待公开采集" },
      { id: "macro", name: "宏观官方源", status: "sample", detail: "等待公开采集" },
    ],
    backtest: {
      asOf: "2026-08-04",
      methodology: "504日训练 / 126日验证 / 126日测试滚动样本外",
      testPeriods: 4,
      annualizedReturn: 8.7,
      benchmarkAnnualizedReturn: 7.2,
      excessReturn: 1.5,
      maxDrawdown: -12.4,
      benchmarkMaxDrawdown: -15.1,
      winRate: 0.5,
      drawdownWinRate: 0.75,
      returnRetention: 84.2,
      drawdownImprovement: 17.9,
      returnPassed: false,
      defensePassed: true,
      validationPassed: false,
    },
  };
}
