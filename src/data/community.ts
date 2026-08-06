export type CommunityRuleStage = "adopted" | "shadow" | "rejected";

export interface CommunityRule {
  id: string;
  title: string;
  stage: CommunityRuleStage;
  communityClaim: string;
  terminalUse: string;
  validation: string;
  nextStep: string;
}

export interface CommunityResearchSnapshot {
  version: string;
  updatedAt: string;
  titleScreened: number;
  deepRead: number;
  queries: string[];
  rules: CommunityRule[];
}

export interface ProductPattern {
  id: string;
  pattern: string;
  decision: "adopted" | "adapted" | "rejected";
  finding: string;
  source: string;
  sourceUrl: string;
}

export const productPatterns: ProductPattern[] = [
  {
    id: "valuation-trend-map",
    pattern: "把估值与趋势放进二维决策地图",
    decision: "adopted",
    finding: "采用九宫格表达证据冲突：便宜但未止跌、趋势强但估值偏热，都不再被一个总分遮住。",
    source: "大虾皮红利估值与打分页面",
    sourceUrl: "https://daxiapi.com/hong-li-da-fen/000922.html",
  },
  {
    id: "daily-report-library",
    pattern: "按日期保存AI投研简报",
    decision: "adopted",
    finding: "改造成只服务008163的本机简报档案，回看每日动作、分数、驱动因素和数据状态。",
    source: "大虾皮AI投研报告库",
    sourceUrl: "https://daxiapi.com/llm-report.html",
  },
  {
    id: "research-path",
    pattern: "先结论、再证据、最后深入图表",
    decision: "adapted",
    finding: "保留今日建议为第一屏，证据页按市场环境、红利风格、基金状态和动作组织。",
    source: "同类AI投研工具更新记录",
    sourceUrl: "https://daxiapi.com/updates.html",
  },
  {
    id: "multi-fund-heatmap",
    pattern: "全市场ETF热力图和多基金排行榜",
    decision: "rejected",
    finding: "对发现市场主线有用，但会稀释本工具只研究008163的目标；仅保留红利风格相对沪深300的强弱。",
    source: "同类ETF热力图",
    sourceUrl: "https://daxiapi.com/etf.html",
  },
  {
    id: "opaque-ai-score",
    pattern: "只展示AI结论或会员黑箱分数",
    decision: "rejected",
    finding: "每日建议必须能追溯到数据时间、因子分数和计算规则，AI只负责解释与发现假设。",
    source: "公开同类产品页面观察",
    sourceUrl: "https://daxiapi.com/updates.html",
  },
];

export const communityResearch: CommunityResearchSnapshot = {
  version: "1.1",
  updatedAt: "2026-08-06",
  titleScreened: 40,
  deepRead: 9,
  queries: [
    "红利择时",
    "红利低波择时",
    "红利回测",
    "红利基金250日线",
    "红利基金金叉死叉",
    "红利股债利差",
  ],
  rules: [
    {
      id: "ma250-tiered-contribution",
      title: "MA250分档管理新增资金",
      stage: "adopted",
      communityClaim: "低于年线多投，高于年线少投或不投。",
      terminalUse: "使用分红再投资复权净值，按年线偏离分为2/1.5/1/0.5/0份。",
      validation: "008163成立以来的120日后收益和定投现金流回测支持分档思想，但不支持一线之隔全进全出。",
      nextStep: "继续按滚动样本外区间监控收益、回撤和实际投入金额。",
    },
    {
      id: "ma5-ma20-execution",
      title: "MA5/MA20只管理执行节奏",
      stage: "adopted",
      communityClaim: "金叉买入、死叉卖出。",
      terminalUse: "只用于决定年线档位是否立即执行；不单独改变长期方向。",
      validation: "本基金金叉和死叉后的20日表现差距不足以支持独立买卖。",
      nextStep: "观察交叉后的斜率、间距和成交量确认是否提高稳定性。",
    },
    {
      id: "valuation-bond-spread",
      title: "估值分位与股债性价比",
      stage: "shadow",
      communityClaim: "高股息率、低PE/PB和较高股债利差时增加红利配置。",
      terminalUse: "进入影子评分，展示但暂不改变每日建议。",
      validation: "经济含义合理，但需要严格的历史时点估值、指数股息率和同期国债收益率。",
      nextStep: "累计至少126个交易日的同口径时点数据后做样本外检验。",
    },
    {
      id: "dividend-seasonality",
      title: "分红季与再平衡季节性",
      stage: "shadow",
      communityClaim: "红利指数在分红季或指数调仓前后存在可利用的季节规律。",
      terminalUse: "仅作为事件日历和风险背景，不直接驱动仓位。",
      validation: "样本年份少，容易把市场行情误认为稳定季节性。",
      nextStep: "按除息、再平衡和成分调整事件对齐，比较事件前后20日超额收益。",
    },
    {
      id: "drawdown-recovery",
      title: "回撤分档与均值回归",
      stage: "shadow",
      communityClaim: "从近期高点回撤越深，后续加仓性价比越高。",
      terminalUse: "与MA250偏离并列观察，避免两者重复计权。",
      validation: "回撤反映价格位置，但在趋势恶化时可能持续加深。",
      nextStep: "检验5%、8%、12%回撤档位的60日和120日结果，并控制趋势状态。",
    },
    {
      id: "ma250-all-in-out",
      title: "年线下满仓、年线上清仓",
      stage: "rejected",
      communityClaim: "把MA250当作唯一开关。",
      terminalUse: "拒绝进入建议系统。",
      validation: "容易错过长期上涨和股息复利，主要改善回撤，未稳定创造超额收益。",
      nextStep: "保留核心仓位，只调节新增资金。",
    },
    {
      id: "raw-nav-ma250",
      title: "直接用单位净值计算MA250",
      stage: "rejected",
      communityClaim: "单位净值跌破年线就是便宜。",
      terminalUse: "拒绝；统一使用累计净值或分红再投资复权序列。",
      validation: "008163分红除息会造成单位净值机械下跳，产生假跌破。",
      nextStep: "所有均线、收益和回撤研究保持同一复权口径。",
    },
    {
      id: "fixed-rise-must-fall",
      title: "涨到固定百分比必然回落",
      stage: "rejected",
      communityClaim: "上涨达到某个百分比后应该立即卖出。",
      terminalUse: "拒绝硬阈值；高偏离只用于减少追涨。",
      validation: "历史上涨后的路径受趋势、利率和估值影响，不存在稳定的必跌点。",
      nextStep: "改看历史偏离分位、RSI和趋势强度的组合。",
    },
  ],
};
