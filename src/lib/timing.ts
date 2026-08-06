const sma = (values: number[], period: number) => {
  if (!values.length) return 0;
  const window = values.slice(-Math.min(period, values.length));
  return window.reduce((sum, value) => sum + value, 0) / window.length;
};

export interface ForwardStatistic {
  count: number;
  winRate: number;
  medianReturn: number;
  averageReturn: number;
}

export interface TimingBand extends ForwardStatistic {
  id: string;
  label: string;
  min: number;
  max: number;
}

export interface TimingStudy {
  current: number;
  ma5: number;
  ma20: number;
  ma250: number;
  deviation: number;
  percentile: number;
  p20: number;
  p80: number;
  crossState: "golden-today" | "death-today" | "above" | "below";
  contributionMultiplier: number;
  contributionLabel: string;
  annualBelow: Array<{ year: string; below: number; total: number; percentage: number }>;
  bands: TimingBand[];
  goldenCross: ForwardStatistic;
  deathCross: ForwardStatistic;
  fixedDcaGain: number;
  fixedDcaInvested: number;
  fixedDcaValue: number;
  timingDcaGain: number;
  timingDcaInvested: number;
  timingDcaValue: number;
  weeklyRsiAudit: {
    strategyAnnualized: number;
    benchmarkAnnualized: number;
    trades: number;
    weeks: number;
  };
}

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const quantile = (values: number[], q: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const remainder = position - base;
  return sorted[base] + ((sorted[base + 1] ?? sorted[base]) - sorted[base]) * remainder;
};

function forwardStatistic(values: number[], predicate: (index: number) => boolean, horizon = 120, start = 250): ForwardStatistic {
  const returns: number[] = [];
  for (let index = start; index < values.length - horizon; index += 1) {
    if (predicate(index)) returns.push(values[index + horizon] / values[index] - 1);
  }
  return {
    count: returns.length,
    winRate: returns.length ? returns.filter((value) => value > 0).length / returns.length * 100 : 0,
    medianReturn: median(returns) * 100,
    averageReturn: (returns.reduce((sum, value) => sum + value, 0) / Math.max(1, returns.length)) * 100,
  };
}

export function timingMultiplier(deviation: number) {
  if (deviation < -0.05) return { multiplier: 2, label: "明显低于年线：计划投入的2倍" };
  if (deviation < 0) return { multiplier: 1.5, label: "略低于年线：计划投入的1.5倍" };
  if (deviation < 0.05) return { multiplier: 1, label: "年线附近：按原计划投入1份" };
  if (deviation < 0.10) return { multiplier: 0.5, label: "高于年线5%—10%：只投半份" };
  return { multiplier: 0, label: "高于年线10%以上：暂停新增，继续持有" };
}

function weekStart(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  const daysAfterMonday = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - daysAfterMonday);
  return value.toISOString().slice(0, 10);
}

function weeklyRsiAudit(dates: string[], values: number[], low = 47, high = 63) {
  const weekly = new Map<string, number>();
  dates.forEach((date, index) => weekly.set(weekStart(date), values[index]));
  const closes = [...weekly.values()];
  const period = 14;
  let position = 1;
  let trades = 0;
  let strategyValue = 1;
  let benchmarkValue = 1;

  for (let index = period + 1; index < closes.length; index += 1) {
    let gains = 0;
    let losses = 0;
    for (let cursor = index - period - 1; cursor < index - 1; cursor += 1) {
      const change = closes[cursor + 1] - closes[cursor];
      if (change > 0) gains += change;
      else losses -= change;
    }
    const averageGain = gains / period;
    const averageLoss = losses / period;
    const rsiValue = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
    const nextPosition = rsiValue < low ? 1 : rsiValue > high ? 0 : position;
    if (nextPosition !== position) trades += 1;
    position = nextPosition;
    const weeklyReturn = closes[index] / closes[index - 1] - 1;
    strategyValue *= 1 + weeklyReturn * position;
    benchmarkValue *= 1 + weeklyReturn;
  }

  const investedWeeks = Math.max(1, closes.length - period - 1);
  const annualize = (value: number) => (Math.pow(value, 52 / investedWeeks) - 1) * 100;
  return {
    strategyAnnualized: annualize(strategyValue),
    benchmarkAnnualized: annualize(benchmarkValue),
    trades,
    weeks: closes.length,
  };
}

export function buildTimingStudy(navSeries: Array<{ time: string; value: number; accumulated?: number }>): TimingStudy {
  const dates = navSeries.map((item) => item.time);
  const values = navSeries.map((item) => item.accumulated ?? item.value);
  const last = values.length - 1;
  const current = values[last] ?? 0;
  const ma5 = sma(values, 5);
  const ma20 = sma(values, 20);
  const ma250 = sma(values, 250);
  const deviation = ma250 ? current / ma250 - 1 : 0;
  const deviations = values.slice(249).map((value, index) => value / sma(values.slice(0, index + 250), 250) - 1);
  const prior5 = sma(values.slice(0, -1), 5);
  const prior20 = sma(values.slice(0, -1), 20);
  const crossState = prior5 <= prior20 && ma5 > ma20 ? "golden-today"
    : prior5 >= prior20 && ma5 < ma20 ? "death-today"
      : ma5 >= ma20 ? "above" : "below";
  const annualMap = new Map<string, { below: number; total: number }>();
  for (let index = 249; index < values.length; index += 1) {
    const year = dates[index].slice(0, 4);
    const row = annualMap.get(year) ?? { below: 0, total: 0 };
    row.total += 1;
    if (values[index] < sma(values.slice(0, index + 1), 250)) row.below += 1;
    annualMap.set(year, row);
  }
  const bandDefinitions = [
    { id: "deep", label: "低于MA250超过5%", min: -Infinity, max: -0.05 },
    { id: "below", label: "低于MA250 0—5%", min: -0.05, max: 0 },
    { id: "near", label: "高于MA250 0—5%", min: 0, max: 0.05 },
    { id: "warm", label: "高于MA250 5—10%", min: 0.05, max: 0.10 },
    { id: "hot", label: "高于MA250超过10%", min: 0.10, max: Infinity },
  ];
  const bands = bandDefinitions.map((band) => ({
    ...band,
    ...forwardStatistic(values, (index) => {
      const dev = values[index] / sma(values.slice(0, index + 1), 250) - 1;
      return dev >= band.min && dev < band.max;
    }),
  }));
  const crossStat = (golden: boolean) => forwardStatistic(values, (index) => {
    const p5 = sma(values.slice(0, index), 5);
    const p20 = sma(values.slice(0, index), 20);
    const c5 = sma(values.slice(0, index + 1), 5);
    const c20 = sma(values.slice(0, index + 1), 20);
    return golden ? p5 <= p20 && c5 > c20 : p5 >= p20 && c5 < c20;
  }, 20, 20);
  const monthStarts = new Map<string, number>();
  dates.forEach((date, index) => { if (!monthStarts.has(date.slice(0, 7))) monthStarts.set(date.slice(0, 7), index); });
  let fixedUnits = 0;
  let timingUnits = 0;
  let fixedInvested = 0;
  let timingInvested = 0;
  monthStarts.forEach((index) => {
    const signalIndex = Math.max(0, index - 1);
    const signalMa250 = sma(values.slice(0, signalIndex + 1), 250);
    const signalDeviation = signalIndex >= 249 && signalMa250 ? values[signalIndex] / signalMa250 - 1 : 0;
    const multiplier = timingMultiplier(signalDeviation).multiplier;
    fixedInvested += 100;
    timingInvested += 100 * multiplier;
    fixedUnits += 100 / values[index];
    timingUnits += 100 * multiplier / values[index];
  });
  const rule = timingMultiplier(deviation);
  return {
    current, ma5, ma20, ma250, deviation, crossState,
    percentile: deviations.length ? deviations.filter((value) => value <= deviation).length / deviations.length * 100 : 50,
    p20: quantile(deviations, 0.20), p80: quantile(deviations, 0.80),
    contributionMultiplier: rule.multiplier, contributionLabel: rule.label,
    annualBelow: [...annualMap.entries()].map(([year, row]) => ({ year, ...row, percentage: row.below / row.total * 100 })),
    bands, goldenCross: crossStat(true), deathCross: crossStat(false),
    fixedDcaGain: fixedInvested ? (fixedUnits * current / fixedInvested - 1) * 100 : 0,
    fixedDcaInvested: fixedInvested, fixedDcaValue: fixedUnits * current,
    timingDcaGain: timingInvested ? (timingUnits * current / timingInvested - 1) * 100 : 0,
    timingDcaInvested: timingInvested, timingDcaValue: timingUnits * current,
    weeklyRsiAudit: weeklyRsiAudit(dates, values),
  };
}
