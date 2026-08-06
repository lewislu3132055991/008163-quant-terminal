import type { Recommendation } from "../types";
import { swingUnitsForScore } from "./strategy.ts";

export const SWING_SCORE_BANDS = [
  { signedUnits: 3, range: "75—100", label: "强买入", units: "+3" },
  { signedUnits: 2, range: "65—74.9", label: "买入", units: "+2" },
  { signedUnits: 1, range: "57—64.9", label: "小买", units: "+1" },
  { signedUnits: 0, range: "43.1—56.9", label: "观察", units: "0" },
  { signedUnits: -1, range: "35.1—43", label: "小卖", units: "-1" },
  { signedUnits: -2, range: "25.1—35", label: "卖出", units: "-2" },
  { signedUnits: -3, range: "0—25", label: "强卖出", units: "-3" },
] as const;

export interface SwingExecutionInput {
  score: number;
  status: Recommendation["status"];
  ma5AboveMa20: boolean;
  rsi14: number;
  premiumRate: number;
  ma250Deviation: number;
  trendScore: number;
  breadthScore: number;
  trackingScore: number;
  negativeStructuralEvent: boolean;
  totalCapital?: number;
  currentFundValue?: number;
}

export interface SwingExecutionPlan {
  direction: "buy" | "sell" | "hold";
  signalDirection: "buy" | "sell" | "hold";
  units: number;
  signalUnits: number;
  specialUnits: number;
  totalUnits: number;
  unitTotalPercent: 5;
  totalPercent: number;
  signalTotalPercent: number;
  amount?: number;
  baseUnits: number;
  title: string;
  signalTitle: string;
  explanation: string;
  capacityNote: string;
  coreAction: string;
  reserveAction: string;
  eventRule: string;
  feeWarning: string;
}

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const directionOf = (signedUnits: number) => signedUnits > 0 ? "buy" : signedUnits < 0 ? "sell" : "hold";

function actionTitle(direction: "buy" | "sell" | "hold", regularUnits: number, specialUnits: number, prefix: string) {
  const totalUnits = regularUnits + specialUnits;
  if (direction === "hold" || totalUnits === 0) return `${prefix}暂不调整`;
  const detail = specialUnits ? `（波段${regularUnits}+特殊${specialUnits}）` : "";
  return `${prefix}${direction === "buy" ? "买入" : "卖出"}${totalUnits}个单位${detail}`;
}

export function buildSwingExecution(input: SwingExecutionInput): SwingExecutionPlan {
  const unitRatio = 0.05;
  const totalCapital = input.totalCapital && input.totalCapital > 0 ? input.totalCapital : undefined;
  const currentFundValue = totalCapital === undefined ? undefined : clamp(input.currentFundValue ?? totalCapital * 0.5, 0, totalCapital);
  const currentSwingUnits = currentFundValue === undefined ? undefined : clamp((currentFundValue - totalCapital! * 0.5) / (totalCapital! * unitRatio), 0, 10);
  const remainingSwingUnits = currentSwingUnits === undefined ? undefined : 10 - currentSwingUnits;
  const baseUnits = swingUnitsForScore(input.score);
  let signalSignedUnits = baseUnits;
  const reasons: string[] = [`综合分${input.score.toFixed(1)}对应基础${Math.abs(baseUnits)}个单位${baseUnits > 0 ? "买入" : baseUnits < 0 ? "卖出" : "观察"}`];

  if (signalSignedUnits > 0) {
    if (!input.ma5AboveMa20) {
      signalSignedUnits = Math.max(0, signalSignedUnits - 1);
      reasons.push("MA5低于MA20，买入减1个单位");
    }
    if (input.rsi14 >= 70) {
      signalSignedUnits = Math.max(0, signalSignedUnits - 1);
      reasons.push("RSI进入偏热区，买入再减1个单位");
    }
  } else if (signalSignedUnits < 0) {
    if (input.ma5AboveMa20) {
      signalSignedUnits = Math.min(0, signalSignedUnits + 1);
      reasons.push("MA5仍高于MA20，卖出减1个单位");
    }
    if (input.rsi14 <= 30) {
      signalSignedUnits = Math.min(0, signalSignedUnits + 1);
      reasons.push("RSI进入偏冷区，卖出再减1个单位");
    }
  }

  const signalDirection = directionOf(signalSignedUnits);
  const coreTriggered = signalDirection === "sell"
    && input.score <= 25
    && input.trendScore <= 25
    && input.breadthScore <= 30
    && input.trackingScore <= 30
    && input.negativeStructuralEvent;
  const reserveTriggered = signalDirection === "buy"
    && input.score >= 75
    && input.ma250Deviation <= -0.05
    && input.ma5AboveMa20
    && input.rsi14 < 70;
  const signalSpecialUnits = coreTriggered || reserveTriggered ? 1 : 0;
  const signalUnits = Math.abs(signalSignedUnits);
  const signalTotalPercent = (signalUnits + signalSpecialUnits) * 5;
  let executableSignedUnits = signalSignedUnits;
  let executionBlocked = false;

  if (!["final", "frozen"].includes(input.status)) {
    executableSignedUnits = 0;
    executionBlocked = true;
    reasons.push("14:45前只显示预备方案，当前可执行为0");
  } else if (Math.abs(input.premiumRate) > 0.3) {
    executableSignedUnits = 0;
    executionBlocked = true;
    reasons.push("ETF折溢价超过0.3%，盘中代理价格失真，暂停执行");
  }

  if (!executionBlocked && executableSignedUnits > 0 && remainingSwingUnits !== undefined) {
    const adjusted = Math.min(executableSignedUnits, Math.floor(remainingSwingUnits + 1e-9));
    if (adjusted !== executableSignedUnits) reasons.push(`波段仓容量限制，普通买入缩至${adjusted}个单位`);
    executableSignedUnits = adjusted;
  }
  if (!executionBlocked && executableSignedUnits < 0 && currentSwingUnits !== undefined) {
    const adjusted = Math.min(Math.abs(executableSignedUnits), Math.floor(currentSwingUnits + 1e-9));
    if (adjusted !== Math.abs(executableSignedUnits)) reasons.push(`波段仓余额限制，普通卖出缩至${adjusted}个单位`);
    executableSignedUnits = -adjusted;
  }

  const specialUnits = executionBlocked ? 0 : signalSpecialUnits;
  const units = Math.abs(executableSignedUnits);
  const direction = units + specialUnits === 0 ? "hold" : signalDirection;
  const totalUnits = units + specialUnits;
  const totalPercent = totalUnits * 5;
  const amount = totalCapital === undefined ? undefined : Math.round(totalUnits * totalCapital * unitRatio);
  const capacityNote = currentSwingUnits === undefined
    ? "无需提供个人金额：按总资金比例执行；普通卖出不得超过实际波段仓，普通信号不动50%底仓"
    : `当前估算波段仓${currentSwingUnits.toFixed(1)}/10个单位，剩余买入容量${remainingSwingUnits!.toFixed(1)}个单位`;

  return {
    direction,
    signalDirection,
    units,
    signalUnits,
    specialUnits,
    totalUnits,
    unitTotalPercent: 5,
    totalPercent,
    signalTotalPercent,
    amount,
    baseUnits,
    title: actionTitle(direction, units, specialUnits, "当前可执行："),
    signalTitle: actionTitle(signalDirection, signalUnits, signalSpecialUnits, "模型预备："),
    explanation: reasons.join("；"),
    capacityNote,
    coreAction: coreTriggered ? "五项结构性风险同时满足：建议额外卖出1个底仓单位（总资金5%）" : "底仓50%保持不动",
    reserveAction: reserveTriggered ? "深度低位反转条件同时满足：建议额外投入1个备用资金单位（总资金5%）" : "备用资金不启用",
    eventRule: "不限制交易次数；综合分跨档、MA5/MA20关系改变或风险阻断解除，才算一个新的执行事件，重复刷新不重复下单",
    feeWarning: direction === "sell"
      ? "按你的账户规则，使用长期份额赎回，不把赎回费作为日常仓位约束；下单时仍核对份额明细"
      : "官方APP申购费按你的实际账户记为0；同一交易日多次申购仍按同一未知净值确认",
  };
}
