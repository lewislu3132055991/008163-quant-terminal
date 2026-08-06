import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, BarChart3, BookOpenCheck, ChevronDown,
  Check, Clock3, CloudOff, Database, Download, ExternalLink, Eye, EyeOff, FileDown, FlaskConical,
  Gauge, Home, Info, KeyRound, LineChart, ListChecks, LockKeyhole, RefreshCw, Save, ShieldCheck,
  Scale, Target, TrendingDown, TrendingUp, Upload, WalletCards, Wifi, X,
} from "lucide-react";
import { ComparisonChart, MarketCharts, TimingDashboard } from "./components/MarketCharts";
import { createSampleBundle } from "./data/sample";
import { decryptPortfolio, downloadEncryptedBackup, encryptPortfolio, isValidPin } from "./lib/crypto";
import { checkGitHubConnectivity, loadResearchBundle, refreshBrowserMarket } from "./lib/data";
import { buildSwingExecution, SWING_SCORE_BANDS, type SwingExecutionPlan } from "./lib/execution";
import { applyDecisionWindow, assessData, buildRecommendation, getDecisionWindow, rsi, sma } from "./lib/strategy";
import { buildTimingStudy } from "./lib/timing";
import type { DailyDecisionRecord, DecisionWindow, EncryptedPortfolio, LedgerEntry, PortfolioSnapshot, Recommendation, ResearchBundle } from "./types";

type Tab = "home" | "charts" | "timing" | "research" | "portfolio";
const PORTFOLIO_KEY = "fund-008163-portfolio-v1";
const DECISION_KEY = "fund-008163-decision-history-v1";

const money = (value: number) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
const percent = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const timeLabel = (value: string) => new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));

function getSwingExecution(bundle: ResearchBundle, recommendation: Recommendation, portfolio?: PortfolioSnapshot) {
  const closes = bundle.daily.map((bar) => bar.close);
  const study = buildTimingStudy(bundle.navSeries);
  const factor = (id: string) => recommendation.factors.find((item) => item.id === id)?.score ?? 50;
  const totalCapital = portfolio ? portfolio.marketValue + portfolio.cash : undefined;
  return buildSwingExecution({
    score: recommendation.score,
    status: recommendation.status,
    ma5AboveMa20: sma(closes, 5) >= sma(closes, 20),
    rsi14: rsi(closes, 14),
    premiumRate: bundle.premiumRate.value,
    ma250Deviation: study.deviation,
    trendScore: factor("trend"),
    breadthScore: factor("breadth"),
    trackingScore: factor("tracking"),
    negativeStructuralEvent: bundle.events.some((event) => event.category === "fund" && event.impact === "negative"),
    totalCapital,
    currentFundValue: portfolio?.marketValue,
  });
}

function Badge({ tone, children }: { tone: "good" | "warn" | "neutral" | "bad"; children: React.ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function DataModeBanner({ bundle, detail, githubOk }: { bundle: ResearchBundle; detail: string; githubOk: boolean | null }) {
  const tone = bundle.mode === "live" ? "good" : bundle.mode === "cache" ? "warn" : "neutral";
  return <div className={`data-banner ${tone}`}>
    <div className="banner-icon">{githubOk === false ? <CloudOff size={18} /> : bundle.mode === "live" ? <Wifi size={18} /> : <Database size={18} />}</div>
    <div><strong>{bundle.mode === "live" ? "最新研究数据" : bundle.mode === "cache" ? "手机缓存模式" : "内置演示模式"}</strong><p>{detail}</p>{githubOk === false && <p>GitHub连接不可用，已自动降级；恢复网络或代理后刷新。</p>}</div>
  </div>;
}

function RecommendationPanel({ recommendation, decisionWindow, swingPlan }: { recommendation: Recommendation; decisionWindow: DecisionWindow; swingPlan: SwingExecutionPlan }) {
  const executable = swingPlan.totalUnits > 0;
  const previewUnits = swingPlan.signalTotalPercent / swingPlan.unitTotalPercent;
  const actionClass = executable ? swingPlan.direction : "hold";
  const actionLabel = executable ? (swingPlan.direction === "buy" ? "执行买入" : "执行卖出") : previewUnits > 0 ? (swingPlan.signalDirection === "buy" ? "预备买入" : "预备卖出") : "等待";
  const statusLabel = recommendation.status === "frozen" ? "已冻结" : recommendation.status === "final" ? "已确认" : recommendation.status === "blocked" ? "已阻断" : "初步分析";
  const marketContribution = recommendation.factors.filter((item) => item.group === "market").reduce((sum, item) => sum + item.contribution, 0);
  const informationContribution = recommendation.factors.filter((item) => item.group === "information").reduce((sum, item) => sum + item.contribution, 0);
  const mainTitle = executable
    ? `50/50主策略：波段仓${swingPlan.direction === "buy" ? "买入" : "卖出"}${swingPlan.totalUnits}个单位`
    : previewUnits > 0 ? `当前先观察，预备${swingPlan.signalDirection === "buy" ? "买入" : "卖出"}${previewUnits}个单位` : "50/50主策略：波段仓暂不调整";
  const plainAction = executable
    ? `${swingPlan.direction === "buy" ? "申购" : "赎回"}总资金的${swingPlan.totalPercent}%；普通操作只动波段仓`
    : previewUnits > 0 ? `现在不下单；14:45后若信号保持，计划${swingPlan.signalDirection === "buy" ? "申购" : "赎回"}总资金的${swingPlan.signalTotalPercent}%` : "今天不追涨也不急卖，50%底仓保持不动";
  return <section className={`recommendation ${actionClass}`}>
    <div className="recommendation-kicker"><span>今日主建议 · 50%底仓 / 50%波段</span><Badge tone={recommendation.status === "blocked" ? "bad" : recommendation.status === "preliminary" ? "warn" : "good"}>{statusLabel}</Badge></div>
    <h1>{mainTitle}</h1>
    <div className="action-callout"><span>今天怎么做</span><strong>{plainAction}</strong><b className={actionClass}>{actionLabel}</b></div>
    <div className={`decision-clock ${decisionWindow.phase}`}><Clock3 size={16} /><span><strong>{decisionWindow.label}</strong>{decisionWindow.detail}</span></div>
    <details className="decision-details"><summary>查看量化分数怎么组成</summary><div className="recommendation-numbers">
      <div><span>综合分</span><strong>{recommendation.score}</strong><small>50为中性</small></div>
      <div><span>市场证据</span><strong>{marketContribution >= 0 ? "+" : ""}{marketContribution.toFixed(1)}</strong><small>趋势、动量、量价</small></div>
      <div><span>信息证据</span><strong>{informationContribution >= 0 ? "+" : ""}{informationContribution.toFixed(1)}</strong><small>估值、资金、宏观</small></div>
    </div><p>{recommendation.reason}</p></details>
    <div className="status-row"><Badge tone={recommendation.dataCompleteness >= 80 ? "good" : "warn"}>可用数据覆盖率 {recommendation.dataCompleteness}%</Badge><Badge tone={recommendation.validationPassed ? "good" : "neutral"}>{recommendation.validationPassed ? "收益增强已验证" : "策略偏防守"}</Badge></div>
  </section>;
}

function SignalConsensus({ bundle, recommendation }: { bundle: ResearchBundle; recommendation: Recommendation }) {
  const study = buildTimingStudy(bundle.navSeries);
  const closes = bundle.daily.map((bar) => bar.close);
  const shortPositive = sma(closes, 5) >= sma(closes, 20);
  const longPositive = study.contributionMultiplier >= 1;
  const information = recommendation.factors.filter((item) => item.group === "information");
  const informationScore = information.reduce((sum, item) => sum + item.score * item.weight, 0) / Math.max(1, information.reduce((sum, item) => sum + item.weight, 0));
  const premiumNormal = Math.abs(bundle.premiumRate.value) <= 0.3;
  let verdict = "方向证据基本一致，可按所选策略分批执行";
  if (["blocked", "preliminary"].includes(recommendation.status)) verdict = "数据或决策时点尚未确认，先观察，不立即操作";
  else if (!premiumNormal) verdict = "ETF折溢价异常，今天暂停执行，等待盘中价格恢复可信";
  else if (longPositive && !shortPositive) verdict = "长期位置允许投入，但短线仍弱：计划不取消，首笔减半并等待MA5重新站上MA20";
  else if (!longPositive && shortPositive) verdict = "短线正在走强，但长期位置不便宜：不追涨，只保留原计划的一半或继续持有";
  else if (!longPositive && !shortPositive) verdict = "长期位置和短线节奏同时偏谨慎：暂停新增；已有底仓不因单日信号一次性赎回";
  const rows = [
    { label: "长期位置", value: `${study.deviation >= 0 ? "+" : ""}${(study.deviation * 100).toFixed(2)}% vs MA250`, state: longPositive ? "允许投入" : "减少新增", tone: longPositive ? "good" : "warn" },
    { label: "短线节奏", value: `MA5 ${shortPositive ? "高于" : "低于"} MA20`, state: shortPositive ? "顺势确认" : "放慢执行", tone: shortPositive ? "good" : "warn" },
    { label: "信息环境", value: `${informationScore.toFixed(0)}分`, state: informationScore >= 55 ? "偏支持" : informationScore < 45 ? "偏压制" : "中性", tone: informationScore >= 55 ? "good" : informationScore < 45 ? "warn" : "neutral" },
  ];
  return <section className="plain-section signal-consensus">
    <div className="section-heading"><div><p className="eyebrow">指标打架时按层级处理</p><h2>今日信号冲突裁决</h2></div><Scale size={20} /></div>
    <div className="consensus-grid">{rows.map((row) => <div key={row.label}><span>{row.label}</span><strong>{row.value}</strong><Badge tone={row.tone as "good" | "warn" | "neutral"}>{row.state}</Badge></div>)}</div>
    <div className="consensus-verdict"><span>合并后的操作含义</span><strong>{verdict}</strong></div>
    <p className="plain-explainer">优先级：关键数据完整性 ＞ MA250长期位置 ＞ MA5/MA20执行节奏 ＞ 盘中折溢价。低优先级信号只能放慢或拆分操作，不能推翻全部长期判断。</p>
  </section>;
}

function ActionChecklist({ bundle }: { bundle: ResearchBundle }) {
  const study = buildTimingStudy(bundle.navSeries);
  const closes = bundle.daily.map((bar) => bar.close);
  const ma5 = sma(closes, 5);
  const ma20 = sma(closes, 20);
  const change = (bundle.quote.value / bundle.previousClose - 1) * 100;
  const rows = [
    { label: "长期位置", value: `年线偏离 ${study.deviation >= 0 ? "+" : ""}${(study.deviation * 100).toFixed(2)}%`, verdict: study.contributionMultiplier >= 1 ? "允许按计划投入" : "降低新增投入", tone: study.contributionMultiplier >= 1 ? "good" : "warn" },
    { label: "短线节奏", value: `MA5 ${ma5 >= ma20 ? "高于" : "低于"} MA20`, verdict: ma5 >= ma20 ? "不用等待金叉" : "分批并放慢执行", tone: ma5 >= ma20 ? "good" : "warn" },
    { label: "盘中确认", value: `515450 ${change >= 0 ? "+" : ""}${change.toFixed(2)}%`, verdict: Math.abs(bundle.premiumRate.value) > 0.3 ? "折溢价异常，暂缓" : "折溢价正常，可参考", tone: Math.abs(bundle.premiumRate.value) > 0.3 ? "bad" : "neutral" },
  ];
  return <section className="plain-section action-checklist">
    <div className="section-heading"><div><p className="eyebrow">按顺序判断，不被单一指标带跑</p><h2>今日三步检查单</h2></div><ListChecks size={20} /></div>
    <div className="checklist-rows">{rows.map((row, index) => <div key={row.label}><span className="step-number">{index + 1}</span><div><small>{row.label}</small><strong>{row.value}</strong></div><Badge tone={row.tone as "good" | "warn" | "neutral" | "bad"}>{row.verdict}</Badge></div>)}</div>
    <p className="plain-explainer">执行顺序：先用MA250决定投入多少，再用MA5/MA20判断是否放慢，最后用ETF盘中数据排除异常。三层都不是单独的买卖按钮。</p>
  </section>;
}

function FactorRows({ recommendation, limit }: { recommendation: Recommendation; limit?: number }) {
  const factors = [...recommendation.factors].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, limit);
  return <div className="factor-list">{factors.map((item) => <div className="factor-row" key={item.id}>
    <div className="factor-copy"><div><strong>{item.label}</strong><span>{item.weight}%</span></div><p>{item.summary}</p></div>
    <div className="factor-meter"><div className="meter-track"><span className={item.score >= 50 ? "positive" : "negative"} style={{ width: `${item.score}%` }} /></div><b className={item.score >= 50 ? "positive" : "negative"}>{item.score.toFixed(0)}</b></div>
  </div>)}</div>;
}

function WarningList({ recommendation }: { recommendation: Recommendation }) {
  if (!recommendation.warnings.length) return null;
  return <div className="warning-list">{recommendation.warnings.map((warning) => <div key={warning}><AlertTriangle size={16} /><span>{warning}</span></div>)}</div>;
}

function DataCoverageDetails({ bundle }: { bundle: ResearchBundle }) {
  const health = assessData(bundle);
  const usable = health.coverage.filter((item) => item.available);
  const pending = health.coverage.filter((item) => !item.available);
  const qualityLabel = (quality: string) => quality === "verified" ? "已验证" : quality === "estimated" ? "估算/沿用" : quality === "conflict" ? "冲突" : quality === "stale" ? "已过期" : "缺失";
  return <details className={`plain-section data-coverage ${health.completeness >= 80 ? "ready" : "waiting"}`}>
    <summary><div><p className="eyebrow">正式建议至少需要13/16项</p><h2>可用数据 {health.available}/{health.total} · {health.completeness}%</h2></div><div><Badge tone={health.completeness >= 80 ? "good" : "warn"}>{health.completeness >= 80 ? "已达到门槛" : `还差${Math.max(0, 13 - health.available)}项`}</Badge><ChevronDown size={18} /></div></summary>
    <div className="coverage-groups"><div><strong>当前可用</strong><div className="coverage-list">{usable.map((item) => <div key={item.id}><span className={`coverage-dot ${item.quality}`} /><div><b>{item.label}</b><small>{qualityLabel(item.quality)} · {String(item.asOf).slice(0, 16).replace("T", " ")}</small></div></div>)}</div></div><div><strong>等待更新</strong>{pending.length ? <div className="coverage-list">{pending.map((item) => <div key={item.id}><span className={`coverage-dot ${item.quality}`} /><div><b>{item.label}</b><small>{qualityLabel(item.quality)} · {item.source}</small></div></div>)}</div> : <p className="coverage-all-ready">16项数据均已取得。</p>}</div></div>
    <p className="plain-explainer">这个百分比只表示数据覆盖，不是上涨概率。已验证和合理时效内的估算值计为可用；过期、冲突和缺失不计入，且不会进入正式金额建议。</p>
  </details>;
}

function SwingExecutionPanel({ plan, fundUrl }: { plan: SwingExecutionPlan; fundUrl: string }) {
  const tone = plan.direction === "buy" ? "buy" : plan.direction === "sell" ? "sell" : "hold";
  const signalTone = plan.signalDirection === "buy" ? "buy" : plan.signalDirection === "sell" ? "sell" : "hold";
  const amount = plan.amount === undefined ? `总资金的${plan.totalPercent}%` : `¥${money(plan.amount)}`;
  const signalTotalUnits = plan.signalTotalPercent / plan.unitTotalPercent;
  return <section className={`plain-section swing-execution ${tone}`}>
    <div className="section-heading"><div><p className="eyebrow">按你的账户规则直接换算</p><h2>50/50 波段执行单</h2></div><Target size={20} /></div>
    <div className="swing-profile">
      <div><span>底仓</span><strong>50%</strong></div><div><span>波段仓</span><strong>50%</strong></div><div><span>1个单位</span><strong>波段仓10% = 总资金5%</strong></div><div><span>交易次数</span><strong>不设人为上限</strong></div>
    </div>
    <div className={`swing-order ${tone}`}><div><span>现在能不能下单</span><strong>{plan.title}</strong><small>{plan.explanation}</small></div><div><b>{plan.totalUnits === 0 ? "0单位" : `${plan.direction === "buy" ? "+" : "-"}${plan.totalUnits}单位`}</b><strong>{amount}</strong></div></div>
    {(plan.signalDirection !== plan.direction || signalTotalUnits !== plan.totalUnits) && <div className={`swing-preview ${signalTone}`}><div><span>预备信号</span><strong>{plan.signalTitle}</strong></div><b>{plan.signalDirection === "buy" ? "+" : plan.signalDirection === "sell" ? "-" : ""}{signalTotalUnits}单位 · 总资金{plan.signalTotalPercent}%</b></div>}
    <p className="capacity-note">{plan.capacityNote}</p>
    <div className="swing-boundaries"><div><span>底仓处理</span><strong>{plan.coreAction}</strong></div><div><span>备用资金</span><strong>{plan.reserveAction}</strong></div></div>
    <div className="execution-event-rule"><Activity size={16} /><p>{plan.eventRule}</p></div>
    <div className="unit-examples"><span>1个单位换算示例</span><div><b>总资金1万</b><strong>¥500</strong></div><div><b>总资金5万</b><strong>¥2,500</strong></div><div><b>总资金10万</b><strong>¥5,000</strong></div></div>
    <details className="score-unit-details"><summary>查看综合分对应的7档买卖单位 <ChevronDown size={16} /></summary><div className="score-unit-table"><div className="score-unit-head"><span>综合分</span><span>基础动作</span><span>单位</span></div>{SWING_SCORE_BANDS.map((band) => <div className={band.signedUnits === plan.baseUnits ? "current" : ""} key={band.range}><span>{band.range}</span><strong>{band.label}</strong><b>{band.units}</b></div>)}</div><p>这是基础单位。MA5/MA20与RSI只能把本次操作减小，折溢价或数据异常可以阻断执行；它们不会把买入直接翻成卖出。</p></details>
    <div className="account-fee-note"><ShieldCheck size={16} /><div><strong>你的交易费用口径</strong><p>{plan.feeWarning}</p></div></div>
    <a className="official-link" href={fundUrl} target="_blank" rel="noreferrer">查看基金官方交易规则 <ExternalLink size={15} /></a>
  </section>;
}

function PrimaryStrategyRules({ swingPlan }: { swingPlan: SwingExecutionPlan }) {
  return <section className="plain-section strategy-choices">
    <div className="section-heading"><div><p className="eyebrow">主策略已固定，不再多选</p><h2>你的50/50波段规则</h2></div><Target size={20} /></div>
    <div className="strategy-focus"><div><span>唯一主策略</span><strong>50%底仓 + 50%波段仓</strong><small>普通量化信号只操作波段仓</small></div><dl>
      <div><dt>单次节奏</dt><dd>平均1个单位，等于波段仓10%、总资金5%；强信号可一次2至3个单位。</dd></div>
      <div><dt>信号分工</dt><dd>综合分决定方向和基础单位；MA5/MA20、RSI只减速，数据冲突和折溢价异常直接阻断。</dd></div>
      <div><dt>交易频率</dt><dd>{swingPlan.eventRule}</dd></div>
      <div><dt>特殊边界</dt><dd>普通信号不动底仓；只有多项结构性风险共振才减底仓，深度低位反转才启用备用资金。</dd></div>
    </dl></div>
    <p className="plain-explainer">MA250、趋势、估值和资金因子不再各自给一套互相冲突的答案，它们全部服务于这一张50/50执行单。</p>
  </section>;
}

function HomeView({ bundle, recommendation, dataDetail, githubOk, decisionWindow, portfolio, onNavigate }: { bundle: ResearchBundle; recommendation: Recommendation; dataDetail: string; githubOk: boolean | null; decisionWindow: DecisionWindow; portfolio?: PortfolioSnapshot; onNavigate: (tab: Tab) => void }) {
  const change = (bundle.quote.value / bundle.previousClose - 1) * 100;
  const fund = bundle.fundProfile;
  const swingPlan = getSwingExecution(bundle, recommendation, portfolio);
  return <div className="view-stack">
    <DataModeBanner bundle={bundle} detail={dataDetail} githubOk={githubOk} />
    <RecommendationPanel recommendation={recommendation} decisionWindow={decisionWindow} swingPlan={swingPlan} />
    <WarningList recommendation={recommendation} />
    <DataCoverageDetails bundle={bundle} />
    <SwingExecutionPanel plan={swingPlan} fundUrl={fund.fees.url} />
    <ActionChecklist bundle={bundle} />
    <SignalConsensus bundle={bundle} recommendation={recommendation} />
    <PrimaryStrategyRules swingPlan={swingPlan} />
    <section className="plain-section">
      <div className="section-heading"><div><p className="eyebrow">最重要的三项驱动</p><h2>为什么得到这个建议</h2></div><button className="text-button" onClick={() => onNavigate("research")}>查看全部 <ChevronDown size={16} /></button></div>
      <FactorRows recommendation={recommendation} limit={3} />
    </section>
    <section className="instrument-pair">
      <div className="instrument-card primary-instrument"><div className="instrument-title"><span>你实际申购赎回</span><Badge tone="good">场外基金</Badge></div><strong>008163</strong><h2>{fund.latestNav.value.toFixed(4)}</h2><p className={fund.latestNavChange.value >= 0 ? "positive" : "negative"}>{percent(fund.latestNavChange.value)} · {fund.latestNav.asOf} 单位净值</p><small>累计净值 {fund.latestAccumulatedNav.value.toFixed(4)} · 未知价申赎</small></div>
      <div className="instrument-card"><div className="instrument-title"><span>盘中观察代理</span><Badge tone="neutral">场内ETF</Badge></div><strong>515450</strong><h2 className={change >= 0 ? "positive" : "negative"}>{bundle.quote.value.toFixed(3)}</h2><p className={change >= 0 ? "positive" : "negative"}>{percent(change)} · 溢价 {bundle.premiumRate.value.toFixed(2)}%</p><small>成交额 {(bundle.amount.value / 100_000_000).toFixed(2)}亿 · 换手 {bundle.turnoverRate.value.toFixed(2)}%</small></div>
    </section>
    <details className="plain-section fund-profile fund-profile-collapsed">
      <summary><div><p className="eyebrow">真正持有的产品</p><h2>008163 基金档案与费率</h2></div><ChevronDown size={20} /></summary>
      <div className="profile-grid"><div><span>成立日</span><strong>{fund.inceptionDate}</strong></div><div><span>基金经理</span><strong>{fund.manager.replace("管理股份有限公司", "")}</strong></div><div><span>目标ETF最低占比</span><strong>≥{fund.targetEtfMinRatio}%</strong></div><div><span>年跟踪误差目标</span><strong>≤{fund.annualTrackingErrorTarget}%</strong></div></div>
      <p className="plain-explainer">为什么还看515450：基金合同要求至少90%的基金资产投资目标ETF，所以ETF能更快反映盘中方向；但你买卖008163，成交价仍是收盘后确认的基金净值。</p>
      <details className="fee-details"><summary>费率与持有规则</summary><div className="fee-grid"><div><span>管理费</span><strong>{fund.fees.managementAnnual.toFixed(2)}%/年</strong></div><div><span>托管费</span><strong>{fund.fees.custodyAnnual.toFixed(2)}%/年</strong></div><div><span>A类销售服务费</span><strong>{fund.fees.salesServiceAnnual.toFixed(2)}%</strong></div><div><span>持有少于7日赎回</span><strong>1.50%</strong></div></div><p>{fund.fees.note}</p></details>
      <a className="official-link" href={fund.url} target="_blank" rel="noreferrer">打开南方基金官方资料 <ExternalLink size={15} /></a>
    </details>
    <section className="plain-section evidence-section">
      <div className="section-heading"><div><p className="eyebrow">信息层 · 不直接交易</p><h2>今日研究摘要</h2></div><Badge tone="neutral">{bundle.events.length}条</Badge></div>
      {bundle.events.slice(0, 3).map((event) => <article className="event-row" key={event.id}><span className={`event-mark ${event.impact}`} /><div><div><strong>{event.title}</strong><Badge tone={event.impact === "positive" ? "good" : event.impact === "negative" ? "bad" : "neutral"}>{event.category}</Badge></div><p>{event.summary}</p><small>{event.source} · {timeLabel(event.asOf)}</small></div></article>)}
    </section>
    <p className="disclaimer">仅用于个人量化研究，不构成投资承诺或自动交易指令。场外基金按未知价申赎，最终净值与盘中估算可能存在偏差。</p>
  </div>;
}

function ChartsView({ bundle, decisions }: { bundle: ResearchBundle; decisions: DailyDecisionRecord[] }) {
  return <div className="view-stack"><section className="plain-section chart-intro"><Info size={18} /><div><strong>先读结论，再看图验证</strong><p>K线对象是目标ETF 515450，用于观察盘中方向；你实际申赎的是008163，最终仍按收盘后的基金净值确认。</p></div></section><MarketCharts bundle={bundle} decisions={decisions} /></div>;
}

function DecisionMap({ recommendation }: { recommendation: Recommendation }) {
  const factor = (id: string) => recommendation.factors.find((item) => item.id === id)?.score ?? 50;
  const valuation = factor("valuation");
  const trend = factor("trend") * 0.55 + factor("momentum") * 0.25 + factor("relative") * 0.20;
  const band = (score: number) => score >= 60 ? 2 : score < 45 ? 0 : 1;
  const currentRow = 2 - band(trend);
  const currentColumn = band(valuation);
  const cells = [
    ["强趋势 / 吸引力低", "强势但偏贵：持有，不追涨"], ["强趋势 / 吸引力中", "趋势占优：按计划分批"], ["强趋势 / 吸引力高", "价值趋势共振：允许积极一档"],
    ["中趋势 / 吸引力低", "估值偏热：减少新增"], ["中趋势 / 吸引力中", "证据中性：观察或小额定投"], ["中趋势 / 吸引力高", "低估等待：按计划投入"],
    ["弱趋势 / 吸引力低", "双弱风险：暂停新增"], ["弱趋势 / 吸引力中", "弱势整理：等待止跌"], ["弱趋势 / 吸引力高", "便宜但未止跌：小额慢投"],
  ];
  return <section className="plain-section decision-map-section">
    <div className="section-heading"><div><p className="eyebrow">两个维度，不让总分掩盖冲突</p><h2>估值 × 趋势决策地图</h2></div><Badge tone={currentRow === 0 && currentColumn === 2 ? "good" : currentRow === 2 && currentColumn === 0 ? "bad" : "neutral"}>当前位置</Badge></div>
    <div className="decision-map-axis"><span>趋势由强到弱 ↓</span><span>估值吸引力由低到高 →</span></div>
    <div className="decision-map-grid">{cells.map(([label, action], index) => {
      const selected = Math.floor(index / 3) === currentRow && index % 3 === currentColumn;
      return <div key={label} className={selected ? "selected" : ""}><span>{label}</span><strong>{action}</strong>{selected && <b>008163当前</b>}</div>;
    })}</div>
    <div className="map-readout"><div><span>趋势强度</span><strong>{trend.toFixed(0)}</strong><small>趋势55% + 动量25% + 相对强弱20%</small></div><div><span>估值吸引力</span><strong>{valuation.toFixed(0)}</strong><small>PE、股息率与国债收益率；缺失时回到中性</small></div></div>
    <p className="plain-explainer">这张图不是预测涨跌概率。它回答的是“便宜吗”和“止跌走强了吗”是否同时成立：估值适合管理投入空间，趋势适合管理执行节奏。</p>
  </section>;
}

function DailyBriefArchive({ recommendation, decisions }: { recommendation: Recommendation; decisions: DailyDecisionRecord[] }) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(recommendation.generatedAt));
  const records = [{ date: today, recommendation, current: true }, ...decisions.filter((item) => item.date !== today).map((item) => ({ date: item.date, recommendation: item.recommendation, current: false }))]
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
  const actionText = (action: Recommendation["action"]) => action === "subscribe" ? "分批申购" : action === "redeem" ? "暂停投入/适度降低" : "持有观察";
  return <section className="plain-section brief-archive">
    <div className="section-heading"><div><p className="eyebrow">本机保存 · 最近7个决策日</p><h2>每日量化简报档案</h2></div><Badge tone="neutral">{records.length}篇</Badge></div>
    <div className="brief-list">{records.map((record) => {
      const strongest = [...record.recommendation.factors].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))[0];
      return <details key={`${record.date}-${record.current ? "current" : "frozen"}`} open={record.current}><summary><span>{record.date}{record.current ? " · 今日" : ""}</span><strong>{actionText(record.recommendation.action)}</strong><b>{record.recommendation.score}分</b></summary><div><p><strong>一句话：</strong>{record.recommendation.title}</p><p><strong>最强驱动：</strong>{strongest?.label ?? "等待数据"} · {strongest?.summary ?? "暂无"}</p><p><strong>数据状态：</strong>覆盖率 {record.recommendation.dataCompleteness}% · {record.recommendation.status === "frozen" ? "当日已冻结" : record.recommendation.status === "blocked" ? "关键数据阻断" : "仍可能更新"}</p></div></details>;
    })}</div>
    <p className="method-note">14:55冻结后的建议会保存在当前手机浏览器中。它不是云端账户记录；清除浏览器数据会一并删除。</p>
  </section>;
}

function ResearchView({ bundle, recommendation, decisions }: { bundle: ResearchBundle; recommendation: Recommendation; decisions: DailyDecisionRecord[] }) {
  const marketContribution = recommendation.factors.filter((item) => item.group === "market").reduce((sum, item) => sum + item.contribution, 0);
  const infoContribution = recommendation.factors.filter((item) => item.group === "information").reduce((sum, item) => sum + item.contribution, 0);
  const finalValue = (values: number[]) => values.length && values[0] ? 100 * values.at(-1)! / values[0] : 100;
  const fund100 = finalValue(bundle.navSeries.slice(-260).map((item) => item.accumulated ?? item.value));
  const etf100 = finalValue(bundle.daily.slice(-260).map((item) => item.close));
  const benchmark100 = finalValue(bundle.benchmarkSeries.slice(-260).map((item) => item.value));
  const positives = recommendation.factors.filter((item) => item.score >= 55).sort((a, b) => b.contribution - a.contribution).slice(0, 2);
  const negatives = recommendation.factors.filter((item) => item.score < 45).sort((a, b) => a.contribution - b.contribution).slice(0, 2);
  return <div className="view-stack">
    <DailyBriefArchive recommendation={recommendation} decisions={decisions} />
    <DecisionMap recommendation={recommendation} />
    <section className="plain-section">
      <div className="section-heading"><div><p className="eyebrow">把起点统一成100元</p><h2>一年前投100元，现在多少</h2></div><LineChart size={20} /></div>
      <ComparisonChart bundle={bundle} />
      <div className="hundred-grid"><div><span>008163</span><strong>¥{fund100.toFixed(1)}</strong></div><div><span>515450</span><strong>¥{etf100.toFixed(1)}</strong></div><div><span>沪深300</span><strong>¥{benchmark100.toFixed(1)}</strong></div></div>
      <p className="plain-explainer">三条线都假设起点投入100元，所以比较的是涨跌速度，不是基金真实净值。008163与515450的差异主要来自现金仓位、费用、跟踪误差和净值确认时点。</p>
    </section>
    <section className="plain-section research-conclusion">
      <div className="section-heading"><div><p className="eyebrow">先看结论</p><h2>今天哪些证据在起作用</h2></div><Badge tone={recommendation.score >= 55 ? "good" : recommendation.score < 45 ? "bad" : "neutral"}>{recommendation.score >= 55 ? "偏积极" : recommendation.score < 45 ? "偏谨慎" : "中性"}</Badge></div>
      <div className="evidence-columns"><div><strong className="positive">支持仓位</strong>{positives.length ? positives.map((item) => <p key={item.id}>{item.label}：{item.summary}</p>) : <p>暂无达到55分的明确利多因子。</p>}</div><div><strong className="negative">压低仓位</strong>{negatives.length ? negatives.map((item) => <p key={item.id}>{item.label}：{item.summary}</p>) : <p>暂无低于45分的明确利空因子。</p>}</div></div>
      <p className="plain-explainer">分数不是预期收益率。55分以上代表该证据偏正面，45—55分视为中性，45分以下偏负面；最后按权重合成为目标仓位。</p>
    </section>
    <section className="score-bands">
      <div><span>核心行情 70%</span><strong className={marketContribution >= 0 ? "positive" : "negative"}>{marketContribution >= 0 ? "+" : ""}{marketContribution.toFixed(1)}</strong></div>
      <div><span>信息数据 30%</span><strong className={infoContribution >= 0 ? "positive" : "negative"}>{infoContribution >= 0 ? "+" : ""}{infoContribution.toFixed(1)}</strong></div>
    </section>
    <section className="plain-section">
      <div className="section-heading"><div><p className="eyebrow">70%行情 + 30%信息</p><h2>十项证据怎么打分</h2></div><Gauge size={20} /></div>
      <FactorRows recommendation={recommendation} />
      <p className="method-note">右侧数字是0—100的证据强弱分，不是上涨概率；条目后的权重决定它对总分影响有多大。</p>
    </section>
    <section className="plain-section">
      <div className="section-heading"><div><p className="eyebrow">{bundle.backtest.testPeriods}个独立样本外区间</p><h2>新策略到底改善了什么</h2></div><FlaskConical size={20} /></div>
      <div className="validation-cards">
        <div><div><strong>收益能否更高</strong><Badge tone={bundle.backtest.returnPassed ? "good" : "neutral"}>{bundle.backtest.returnPassed ? "已证实" : "未证实"}</Badge></div><p>策略年化 {bundle.backtest.annualizedReturn.toFixed(1)}%，买入持有 {bundle.backtest.benchmarkAnnualizedReturn.toFixed(1)}%，保留了 {bundle.backtest.returnRetention.toFixed(0)}% 的收益。</p><small>通过标准：年化高2个百分点且多数区间胜出。没有达到就如实显示，不换参数刷绿。</small></div>
        <div><div><strong>回撤能否更小</strong><Badge tone={bundle.backtest.defensePassed ? "good" : "warn"}>{bundle.backtest.defensePassed ? "已通过" : "证据不足"}</Badge></div><p>最差回撤 {bundle.backtest.maxDrawdown.toFixed(1)}%，买入持有 {bundle.backtest.benchmarkMaxDrawdown.toFixed(1)}%，改善 {bundle.backtest.drawdownImprovement.toFixed(0)}%。</p><small>{(bundle.backtest.drawdownWinRate * 100).toFixed(0)}%测试区间回撤更小；同时要求保留至少80%收益。</small></div>
      </div>
      <p className="method-note">这里保留的是旧版高仓位防守模型的历史验证，只作为风险基准，不再驱动今日操作。当前唯一主执行策略是50%底仓、50%波段仓；波段单位策略将单独累计样本外记录后再展示正式回测。</p>
    </section>
    <section className="plain-section">
      <div className="section-heading"><div><p className="eyebrow">逐条可追溯</p><h2>数据源健康</h2></div><Database size={20} /></div>
      <div className="source-list">{bundle.sources.map((source) => <div key={source.id}><span className={`source-dot ${source.status}`} /><strong>{source.name}</strong><small>{source.detail ?? source.lastSuccess ?? "等待状态"}</small><Badge tone={source.status === "ok" ? "good" : source.status === "failed" ? "bad" : "neutral"}>{source.status}</Badge></div>)}</div>
    </section>
    <section className="plain-section">
      <div className="section-heading"><div><p className="eyebrow">政策 · 公告 · 新闻</p><h2>事件时间线</h2></div><BookOpenCheck size={20} /></div>
      {bundle.events.map((event) => <article className="event-row" key={event.id}><span className={`event-mark ${event.impact}`} /><div><div><strong>{event.title}</strong>{event.url && <a href={event.url} target="_blank" rel="noreferrer" aria-label="打开来源"><ExternalLink size={15} /></a>}</div><p>{event.summary}</p><small>{event.source} · {event.pointInTimeSafe ? "可用于时点研究" : "仅当前观察"}</small></div></article>)}
    </section>
  </div>;
}

function PortfolioView({ encrypted, portfolio, onUnlocked, onSaved, onImported, onLock }: { encrypted?: EncryptedPortfolio; portfolio?: PortfolioSnapshot; onUnlocked: (portfolio: PortfolioSnapshot, pin: string) => void; onSaved: (portfolio: PortfolioSnapshot, pin: string) => Promise<void>; onImported: (payload: EncryptedPortfolio) => void; onLock: () => void }) {
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [backupDue, setBackupDue] = useState(false);
  const [entryAction, setEntryAction] = useState<"subscribe" | "redeem">();
  const [entryForm, setEntryForm] = useState({ amount: 0, shares: 0, nav: 0, note: "" });
  const [form, setForm] = useState({ marketValue: portfolio?.marketValue ?? 0, cash: portfolio?.cash ?? 0, fundShares: portfolio?.fundShares ?? 0, averageCost: portfolio?.averageCost ?? 1 });
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (portfolio) setForm({ marketValue: portfolio.marketValue, cash: portfolio.cash, fundShares: portfolio.fundShares, averageCost: portfolio.averageCost }); }, [portfolio]);

  async function unlock() {
    if (!encrypted) return;
    setBusy(true); setError("");
    try { onUnlocked(await decryptPortfolio(encrypted, pin), pin); } catch (reason) { setError(reason instanceof Error ? reason.message : "无法解锁"); }
    finally { setBusy(false); }
  }

  async function saveSnapshot() {
    if (!isValidPin(pin)) { setError("请输入6位数字密码"); return; }
    const snapshot: PortfolioSnapshot = {
      version: "1.0", updatedAt: new Date().toISOString(), ...form,
      peakValue: Math.max(portfolio?.peakValue ?? 0, form.marketValue),
      ledger: portfolio?.ledger ?? [{ id: crypto.randomUUID(), date: new Date().toISOString().slice(0, 10), action: "snapshot", amount: form.marketValue, shares: form.fundShares, note: "初始持仓快照" }],
    };
    setBusy(true); setError("");
    try { await onSaved(snapshot, pin); setBackupDue(true); } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); }
    finally { setBusy(false); }
  }

  function openLedger(action: "subscribe" | "redeem") {
    if (!portfolio) return;
    setError("");
    setEntryAction(action);
    setEntryForm({ amount: 0, shares: 0, nav: 0, note: "" });
  }

  async function addLedger() {
    if (!portfolio || !entryAction) return;
    if (!isValidPin(pin)) { setError("请输入6位数字密码确认记账"); return; }
    const amount = Number(entryForm.amount);
    if (!(amount > 0)) { setError("请输入有效金额"); return; }
    if (entryAction === "subscribe" && amount > portfolio.cash) { setError("申购金额不能超过专用现金"); return; }
    if (entryAction === "redeem" && amount > portfolio.marketValue) { setError("赎回金额不能超过基金市值"); return; }
    const today = getDecisionWindow().date;
    const shares = entryForm.shares > 0 ? entryForm.shares : entryForm.nav > 0 ? amount / entryForm.nav : 0;
    const entry: LedgerEntry = { id: crypto.randomUUID(), date: today, action: entryAction, amount, shares: shares || undefined, nav: entryForm.nav || undefined, note: entryForm.note.trim() || "手动记录" };
    const next: PortfolioSnapshot = {
      ...portfolio, updatedAt: new Date().toISOString(),
      marketValue: Math.max(0, portfolio.marketValue + (entryAction === "subscribe" ? amount : -amount)),
      cash: Math.max(0, portfolio.cash + (entryAction === "subscribe" ? -amount : amount)),
      fundShares: Math.max(0, portfolio.fundShares + (entryAction === "subscribe" ? shares : -shares)),
      ledger: [entry, ...portfolio.ledger],
    };
    setBusy(true); setError("");
    try { await onSaved(next, pin); setBackupDue(true); setEntryAction(undefined); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "记账失败"); }
    finally { setBusy(false); }
  }

  async function importFile(file?: File) {
    if (!file) return;
    try { const value = JSON.parse(await file.text()) as EncryptedPortfolio; if (value.version !== "1.0" || value.algorithm !== "AES-GCM" || value.kdf !== "PBKDF2-SHA256" || value.iterations < 100_000 || !value.salt || !value.iv || !value.ciphertext) throw new Error(); onImported(value); setError("备份已导入，请输入原密码解锁"); }
    catch { setError("备份文件已损坏或格式不受支持"); }
  }

  const total = portfolio ? portfolio.marketValue + portfolio.cash : form.marketValue + form.cash;
  const position = total > 0 ? ((portfolio?.marketValue ?? form.marketValue) / total) * 100 : 0;
  return <div className="view-stack">
    <section className="portfolio-hero">
      <div className="shield"><ShieldCheck size={26} /></div><div><p className="eyebrow">仅保存在这台设备</p><h1>{portfolio ? `资产 ¥${money(total)}` : encrypted ? "持仓已加密" : "建立个人持仓"}</h1><p>6位密码派生密钥，AES-GCM加密；仓位明文不会上传。</p></div>{portfolio && <button className="lock-button" onClick={() => { setPin(""); setError(""); setEntryAction(undefined); onLock(); }} aria-label="锁定持仓" title="锁定持仓"><LockKeyhole size={18} /></button>}
    </section>
    {backupDue && encrypted && <div className="backup-banner"><AlertTriangle size={18} /><span>持仓已变更，请导出新的加密备份。</span><button onClick={() => { downloadEncryptedBackup(encrypted); setBackupDue(false); }}><FileDown size={17} />导出</button></div>}
    {!portfolio && encrypted && <section className="plain-section unlock-section"><div className="section-heading"><div><p className="eyebrow">本机密钥</p><h2>解锁持仓</h2></div><KeyRound size={20} /></div><label className="pin-field"><input type={showPin ? "text" : "password"} inputMode="numeric" maxLength={6} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} placeholder="6位数字密码" /><button onClick={() => setShowPin(!showPin)} aria-label={showPin ? "隐藏密码" : "显示密码"}>{showPin ? <EyeOff size={19} /> : <Eye size={19} />}</button></label><button className="primary-button" disabled={busy || pin.length !== 6} onClick={unlock}><LockKeyhole size={18} />{busy ? "正在解密" : "解锁"}</button></section>}
    {(!encrypted || portfolio) && <section className="plain-section"><div className="section-heading"><div><p className="eyebrow">基金 + 专用现金</p><h2>{portfolio ? "持仓快照" : "初始账户"}</h2></div><WalletCards size={20} /></div>
      <div className="position-bar"><span style={{ width: `${Math.min(100, position)}%` }} /><b>{position.toFixed(1)}%</b></div>
      <div className="form-grid">
        <label><span>基金市值（元）</span><input type="number" min="0" value={form.marketValue || ""} onChange={(e) => setForm({ ...form, marketValue: Number(e.target.value) })} /></label>
        <label><span>专用现金（元）</span><input type="number" min="0" value={form.cash || ""} onChange={(e) => setForm({ ...form, cash: Number(e.target.value) })} /></label>
        <label><span>持有份额</span><input type="number" min="0" step="0.01" value={form.fundShares || ""} onChange={(e) => setForm({ ...form, fundShares: Number(e.target.value) })} /></label>
        <label><span>平均成本净值</span><input type="number" min="0" step="0.0001" value={form.averageCost || ""} onChange={(e) => setForm({ ...form, averageCost: Number(e.target.value) })} /></label>
      </div>
      <label className="pin-field"><input type={showPin ? "text" : "password"} inputMode="numeric" maxLength={6} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} placeholder={portfolio ? "输入密码确认保存" : "设置6位数字密码"} /><button onClick={() => setShowPin(!showPin)} aria-label={showPin ? "隐藏密码" : "显示密码"}>{showPin ? <EyeOff size={19} /> : <Eye size={19} />}</button></label>
      <button className="primary-button" disabled={busy || pin.length !== 6} onClick={saveSnapshot}><Save size={18} />{busy ? "正在加密" : portfolio ? "更新加密快照" : "加密保存"}</button>
    </section>}
    {portfolio && <section className="plain-section"><div className="section-heading"><div><p className="eyebrow">不限记录次数 · 每笔独立核对</p><h2>操作账本</h2></div><Activity size={20} /></div><div className="ledger-actions"><button onClick={() => openLedger("subscribe")}><TrendingUp size={17} />记录申购</button><button onClick={() => openLedger("redeem")}><TrendingDown size={17} />记录赎回</button></div>
      {entryAction && <div className="ledger-editor"><div className="editor-title"><strong>{entryAction === "subscribe" ? "记录申购" : "记录赎回"}</strong><button onClick={() => setEntryAction(undefined)} aria-label="取消记账"><X size={17} /></button></div><div className="form-grid"><label><span>金额（元）</span><input autoFocus type="number" min="0" value={entryForm.amount || ""} onChange={(event) => setEntryForm({ ...entryForm, amount: Number(event.target.value) })} /></label><label><span>确认净值</span><input type="number" min="0" step="0.0001" value={entryForm.nav || ""} onChange={(event) => setEntryForm({ ...entryForm, nav: Number(event.target.value) })} /></label><label><span>确认份额</span><input type="number" min="0" step="0.01" value={entryForm.shares || ""} onChange={(event) => setEntryForm({ ...entryForm, shares: Number(event.target.value) })} /></label><label><span>备注</span><input value={entryForm.note} onChange={(event) => setEntryForm({ ...entryForm, note: event.target.value })} placeholder="可选" /></label></div><button className="primary-button" disabled={busy || pin.length !== 6} onClick={addLedger}><Check size={18} />确认并加密保存</button></div>}
      <div className="ledger-list">{portfolio.ledger.slice(0, 8).map((entry) => <div key={entry.id}><span className={entry.action === "subscribe" ? "buy" : entry.action === "redeem" ? "sell" : "hold"}>{entry.action === "subscribe" ? "申" : entry.action === "redeem" ? "赎" : "记"}</span><div><strong>{entry.date}</strong><small>{entry.note}{entry.shares ? ` · ${entry.shares.toFixed(2)}份` : ""}</small></div><b>¥{money(entry.amount)}</b></div>)}</div></section>}
    <section className="backup-actions"><button disabled={!encrypted} onClick={() => encrypted && downloadEncryptedBackup(encrypted)}><Download size={18} />导出加密备份</button><button onClick={() => fileRef.current?.click()}><Upload size={18} />导入备份</button><input ref={fileRef} type="file" accept="application/json" hidden onChange={(event) => importFile(event.target.files?.[0])} /></section>
    {error && <div className="inline-error"><AlertTriangle size={16} />{error}<button onClick={() => setError("")} aria-label="关闭"><X size={16} /></button></div>}
  </div>;
}

export function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [bundle, setBundle] = useState<ResearchBundle>(() => createSampleBundle());
  const bundleRef = useRef(bundle);
  const [dataDetail, setDataDetail] = useState("正在读取本地与公开数据…");
  const [loading, setLoading] = useState(false);
  const [githubOk, setGithubOk] = useState<boolean | null>(null);
  const [encrypted, setEncrypted] = useState<EncryptedPortfolio | undefined>(() => { try { const value = localStorage.getItem(PORTFOLIO_KEY); return value ? JSON.parse(value) : undefined; } catch { return undefined; } });
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot>();
  const [now, setNow] = useState(() => new Date());
  const [decisions, setDecisions] = useState<DailyDecisionRecord[]>(() => { try { const value = JSON.parse(localStorage.getItem(DECISION_KEY) ?? "[]"); return Array.isArray(value) ? value : []; } catch { return []; } });
  const liveBusy = useRef(false);

  function installBundle(next: ResearchBundle) {
    bundleRef.current = next;
    setBundle(next);
  }

  async function refreshLive() {
    if (liveBusy.current) return;
    liveBusy.current = true;
    try {
      const result = await refreshBrowserMarket(bundleRef.current);
      installBundle(result.bundle);
      setDataDetail(result.detail);
    } finally { liveBusy.current = false; }
  }

  async function refresh() {
    setLoading(true);
    const [result, connected] = await Promise.all([loadResearchBundle(), checkGitHubConnectivity()]);
    installBundle(result.bundle); setDataDetail(result.detail); setGithubOk(connected);
    await refreshLive();
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    let ticks = 0;
    const timer = window.setInterval(() => {
      const current = new Date();
      setNow(current);
      ticks += 1;
      const decision = getDecisionWindow(current);
      const shanghaiHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", hour: "2-digit", hourCycle: "h23" }).format(current));
      const marketOpen = decision.tradingDay && shanghaiHour >= 9 && shanghaiHour < 15;
      if (decision.phase === "updating" || (marketOpen && ticks % 2 === 0)) void refreshLive();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const decisionWindow = useMemo(() => getDecisionWindow(now), [now]);
  const baseRecommendation = useMemo(() => buildRecommendation(bundle, undefined, now), [bundle, now]);
  const storedDecision = decisions.find((item) => item.date === decisionWindow.date)?.recommendation;
  const recommendation = useMemo(() => applyDecisionWindow(baseRecommendation, decisionWindow, storedDecision), [baseRecommendation, decisionWindow, storedDecision]);
  useEffect(() => {
    if (!decisionWindow.tradingDay || decisionWindow.phase !== "frozen" || storedDecision || baseRecommendation.status !== "final") return;
    const frozen = { ...baseRecommendation, status: "frozen" as const, generatedAt: now.toISOString() };
    const record: DailyDecisionRecord = { version: "1.0", date: decisionWindow.date, frozenAt: now.toISOString(), etfPrice: bundle.quote.value, recommendation: frozen };
    setDecisions((current) => {
      const next = [record, ...current.filter((item) => item.date !== record.date)].slice(0, 260);
      localStorage.setItem(DECISION_KEY, JSON.stringify(next));
      return next;
    });
  }, [baseRecommendation, bundle.quote.value, decisionWindow, now, storedDecision]);

  async function savePortfolio(next: PortfolioSnapshot, pin: string) {
    const payload = await encryptPortfolio(next, pin);
    localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(payload));
    setEncrypted(payload); setPortfolio(next);
  }

  const tabs = [
    { id: "home" as const, label: "今日", icon: Home },
    { id: "charts" as const, label: "看图", icon: BarChart3 },
    { id: "timing" as const, label: "择时", icon: Target },
    { id: "research" as const, label: "证据", icon: FlaskConical },
  ];
  return <div className="app-shell">
    <header className="app-header"><div className="header-title"><p>南方标普红利低波50ETF联接A</p><div><strong>008163</strong><span>目标ETF 515450</span></div><small>{__APP_VERSION__} · 发布 {__RELEASE_TIME__}</small></div><button className={loading ? "spin" : ""} onClick={refresh} aria-label="刷新数据" title="刷新数据"><RefreshCw size={20} /></button></header>
    <main>
      {tab === "home" && <HomeView bundle={bundle} recommendation={recommendation} dataDetail={dataDetail} githubOk={githubOk} decisionWindow={decisionWindow} portfolio={portfolio} onNavigate={setTab} />}
      {tab === "charts" && <ChartsView bundle={bundle} decisions={decisions} />}
      {tab === "timing" && <TimingDashboard bundle={bundle} />}
      {tab === "research" && <ResearchView bundle={bundle} recommendation={recommendation} decisions={decisions} />}
      {tab === "portfolio" && <PortfolioView encrypted={encrypted} portfolio={portfolio} onUnlocked={(next) => setPortfolio(next)} onSaved={savePortfolio} onImported={(payload) => { localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(payload)); setEncrypted(payload); setPortfolio(undefined); }} onLock={() => setPortfolio(undefined)} />}
    </main>
    <nav className="bottom-nav" aria-label="主导航">{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? "active" : ""} onClick={() => { setTab(id); window.scrollTo({ top: 0, behavior: "smooth" }); }}><Icon size={21} strokeWidth={tab === id ? 2.4 : 1.9} /><span>{label}</span></button>)}</nav>
  </div>;
}
