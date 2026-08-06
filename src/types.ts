export type DataQuality = "verified" | "estimated" | "stale" | "conflict" | "sample" | "unavailable";

export interface DatumMeta {
  source: string;
  asOf: string;
  retrievedAt: string;
  frequency: "realtime" | "5m" | "daily" | "monthly" | "quarterly" | "event";
  quality: DataQuality;
  pointInTimeSafe: boolean;
}

export interface MarketDatum<T = number> extends DatumMeta {
  value: T;
}

export interface OhlcvBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IntradayBar extends OhlcvBar {
  vwap: number;
  iopv?: number;
}

export interface SourceStatus {
  id: string;
  name: string;
  status: "ok" | "delayed" | "failed" | "sample";
  latencyMs?: number;
  lastSuccess?: string;
  detail?: string;
}

export interface FactorContribution {
  id: string;
  label: string;
  group: "market" | "information";
  weight: number;
  score: number;
  contribution: number;
  summary: string;
  pointInTimeSafe: boolean;
}

export interface Recommendation {
  version: "1.0";
  generatedAt: string;
  status: "preliminary" | "final" | "blocked" | "frozen";
  action: "subscribe" | "hold" | "redeem";
  score: number;
  targetPosition: number;
  suggestedPositionChange: number;
  suggestedAmount?: number;
  suggestedShares?: number;
  dataCompleteness: number;
  validationPassed: boolean;
  title: string;
  reason: string;
  warnings: string[];
  factors: FactorContribution[];
}

export type DecisionPhase = "preliminary" | "updating" | "frozen";

export interface DecisionWindow {
  date: string;
  phase: DecisionPhase;
  tradingDay: boolean;
  label: string;
  detail: string;
}

export interface DailyDecisionRecord {
  version: "1.0";
  date: string;
  frozenAt: string;
  etfPrice: number;
  recommendation: Recommendation;
}

export interface LedgerEntry {
  id: string;
  date: string;
  action: "subscribe" | "redeem" | "dividend" | "snapshot";
  amount: number;
  shares?: number;
  nav?: number;
  note?: string;
}

export interface PortfolioSnapshot {
  version: "1.0";
  updatedAt: string;
  marketValue: number;
  cash: number;
  fundShares: number;
  averageCost: number;
  peakValue: number;
  ledger: LedgerEntry[];
}

export interface BacktestReport {
  asOf: string;
  methodology: string;
  testPeriods: number;
  annualizedReturn: number;
  benchmarkAnnualizedReturn: number;
  excessReturn: number;
  maxDrawdown: number;
  benchmarkMaxDrawdown: number;
  winRate: number;
  drawdownWinRate: number;
  returnRetention: number;
  drawdownImprovement: number;
  returnPassed: boolean;
  defensePassed: boolean;
  validationPassed: boolean;
}

export interface FundProfile {
  name: string;
  code: "008163";
  shareClass: string;
  fundType: string;
  manager: string;
  custodian: string;
  inceptionDate: string;
  openFrequency: string;
  targetEtf: string;
  targetIndex: string;
  targetEtfMinRatio: number;
  benchmark: string;
  dailyTrackingDeviationTarget: number;
  annualTrackingErrorTarget: number;
  latestNav: MarketDatum<number>;
  latestAccumulatedNav: MarketDatum<number>;
  latestNavChange: MarketDatum<number>;
  fees: {
    managementAnnual: number;
    custodyAnnual: number;
    salesServiceAnnual: number;
    subscription: Array<{ range: string; rate: string }>;
    redemption: Array<{ holdingPeriod: string; rate: string }>;
    note: string;
    source: string;
    url: string;
    asOf: string;
  };
  source: string;
  url: string;
  asOf: string;
}

export interface ResearchEvent extends DatumMeta {
  id: string;
  title: string;
  category: "fund" | "index" | "macro" | "policy" | "company";
  impact: "positive" | "neutral" | "negative";
  summary: string;
  url?: string;
}

export interface ResearchBundle {
  version: "1.0";
  mode: "live" | "cache" | "sample";
  generatedAt: string;
  quote: MarketDatum<number>;
  backupQuote: MarketDatum<number>;
  previousClose: number;
  iopv: MarketDatum<number>;
  premiumRate: MarketDatum<number>;
  turnoverRate: MarketDatum<number>;
  amount: MarketDatum<number>;
  daily: OhlcvBar[];
  intraday: IntradayBar[];
  fundProfile: FundProfile;
  navSeries: Array<{ time: string; value: number; accumulated?: number }>;
  benchmarkSeries: Array<{ time: string; value: number }>;
  metrics: {
    trackingError: MarketDatum<number>;
    dividendYield: MarketDatum<number>;
    pe: MarketDatum<number>;
    pb: MarketDatum<number>;
    roe: MarketDatum<number>;
    breadth: MarketDatum<number>;
    tenYearYield: MarketDatum<number>;
    dr007: MarketDatum<number>;
    northboundProxy: MarketDatum<number>;
    shareChange20d: MarketDatum<number>;
  };
  events: ResearchEvent[];
  sources: SourceStatus[];
  backtest: BacktestReport;
}

export interface EncryptedPortfolio {
  version: "1.0";
  algorithm: "AES-GCM";
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
  createdAt: string;
}
