#!/usr/bin/env python3
"""Collect public data for 008163/515450 and emit point-in-time annotated JSON.

The collector is deliberately fail-soft: a source failure is recorded in data-health,
and previous values are carried as stale rather than silently presented as current.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import tempfile
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from backtest import evaluate_rolling

SHANGHAI = timezone(timedelta(hours=8))
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "public" / "data"
BUNDLE_FILE = DATA_DIR / "research-bundle.json"
USER_AGENT = "Mozilla/5.0 008163-quant-research/1.0"


def now_iso() -> str:
    return datetime.now(SHANGHAI).isoformat(timespec="seconds")


def http_get(url: str, encoding: str = "utf-8", headers: dict[str, str] | None = None) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    with urllib.request.urlopen(request, timeout=18) as response:
        return response.read().decode(encoding, errors="replace")


def get_json(url: str, headers: dict[str, str] | None = None) -> Any:
    return json.loads(http_get(url, headers=headers))


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=path.parent, suffix=".tmp") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2, allow_nan=False)
        handle.write("\n")
        temp = Path(handle.name)
    os.replace(temp, path)


def meta(source: str, as_of: str, frequency: str, quality: str = "verified", point_safe: bool = True) -> dict[str, Any]:
    return {
        "source": source,
        "asOf": as_of,
        "retrievedAt": now_iso(),
        "frequency": frequency,
        "quality": quality,
        "pointInTimeSafe": point_safe,
    }


def datum(value: float, source: str, as_of: str, frequency: str, quality: str = "verified", point_safe: bool = True) -> dict[str, Any]:
    return {"value": value, **meta(source, as_of, frequency, quality, point_safe)}


def unavailable(value: float, label: str, frequency: str = "daily") -> dict[str, Any]:
    return datum(value, label, now_iso(), frequency, "unavailable", False)


@dataclass
class Status:
    id: str
    name: str
    status: str = "failed"
    detail: str = "未执行"
    last_success: str | None = None

    def ok(self, detail: str) -> None:
        self.status = "ok"
        self.detail = detail
        self.last_success = now_iso()

    def fail(self, error: Exception) -> None:
        self.status = "failed"
        self.detail = str(error)[:180]

    def as_dict(self) -> dict[str, Any]:
        value = {"id": self.id, "name": self.name, "status": self.status, "detail": self.detail}
        if self.last_success:
            value["lastSuccess"] = self.last_success
        return value


def guarded(status: Status, function: Callable[[], Any], success: str) -> Any | None:
    try:
        result = function()
        status.ok(success)
        return result
    except Exception as error:  # a failed source must not stop other sources
        status.fail(error)
        return None


def eastmoney_daily(symbol: str, limit: int = 900) -> list[dict[str, Any]]:
    params = urllib.parse.urlencode({
        "secid": f"1.{symbol}", "klt": "101", "fqt": "1", "lmt": str(limit),
        "fields1": "f1,f2,f3,f4,f5,f6", "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
    })
    payload = get_json(f"https://push2his.eastmoney.com/api/qt/stock/kline/get?{params}")
    rows = payload.get("data", {}).get("klines") or []
    if len(rows) < 30:
        raise ValueError(f"{symbol}日线不足30条")
    bars = []
    for row in rows:
        fields = row.split(",")
        bars.append({
            "time": fields[0], "open": float(fields[1]), "close": float(fields[2]),
            "high": float(fields[3]), "low": float(fields[4]), "volume": int(float(fields[5])),
        })
    return bars


def eastmoney_intraday(symbol: str) -> list[dict[str, Any]]:
    params = urllib.parse.urlencode({
        "secid": f"1.{symbol}", "klt": "5", "fqt": "1", "lmt": "120",
        "fields1": "f1,f2,f3,f4,f5,f6", "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
    })
    payload = get_json(f"https://push2his.eastmoney.com/api/qt/stock/kline/get?{params}")
    rows = payload.get("data", {}).get("klines") or []
    if not rows:
        raise ValueError("5分钟行情为空")
    bars, total_amount, total_volume = [], 0.0, 0.0
    for row in rows:
        fields = row.split(",")
        volume, amount = float(fields[5]), float(fields[6])
        total_volume += volume
        total_amount += amount
        close = float(fields[2])
        calculated_vwap = total_amount / max(1.0, total_volume * 100)
        if calculated_vwap < close * 0.5 or calculated_vwap > close * 1.5:
            calculated_vwap = close
        bars.append({
            "time": fields[0].replace(" ", "T") + "+08:00", "open": float(fields[1]),
            "close": close, "high": float(fields[3]), "low": float(fields[4]),
            "volume": int(volume), "vwap": round(calculated_vwap, 3), "iopv": round(close, 3),
        })
    return bars[-48:]


def eastmoney_quote(symbol: str) -> dict[str, float | str]:
    fields = "f43,f44,f45,f46,f47,f48,f57,f58,f60,f124,f168,f170"
    payload = get_json(f"https://push2.eastmoney.com/api/qt/stock/get?secid=1.{symbol}&fields={fields}")
    data = payload.get("data") or {}
    if not data.get("f43"):
        raise ValueError("东方财富报价为空")
    raw_timestamp = int(data.get("f124", 0) or 0)
    timestamp = datetime.fromtimestamp(raw_timestamp, SHANGHAI).isoformat(timespec="seconds") if raw_timestamp > 0 else now_iso()
    return {
        "price": float(data["f43"]) / 1000, "previousClose": float(data["f60"]) / 1000,
        "amount": float(data.get("f48") or 0), "turnoverRate": float(data.get("f168") or 0) / 100,
        "changePercent": float(data.get("f170") or 0) / 100, "asOf": timestamp,
    }


def tencent_quote(symbol: str) -> dict[str, Any]:
    text = http_get(f"https://qt.gtimg.cn/q=sh{symbol}", encoding="gbk", headers={"Referer": "https://gu.qq.com/"})
    match = re.search(r'="(.*)"', text)
    if not match:
        raise ValueError("腾讯报价格式变化")
    fields = match.group(1).split("~")
    price = float(fields[3])
    if price <= 0:
        raise ValueError("腾讯报价为空")
    raw_time = fields[30] if len(fields) > 30 else ""
    as_of = now_iso()
    if re.fullmatch(r"\d{14}", raw_time):
        as_of = datetime.strptime(raw_time, "%Y%m%d%H%M%S").replace(tzinfo=SHANGHAI).isoformat(timespec="seconds")
    return {"price": price, "asOf": as_of}


def tencent_fundamentals(symbol: str) -> tuple[float | None, float | None]:
    market = "sh" if symbol.startswith(("5", "6", "9")) else "sz"
    text = http_get(f"https://qt.gtimg.cn/q={market}{symbol}", encoding="gbk", headers={"Referer": "https://gu.qq.com/"})
    match = re.search(r'="(.*)"', text)
    if not match:
        return None, None
    fields = match.group(1).split("~")
    try:
        pe = float(fields[39]) if fields[39] not in {"", "-"} else None
        pb = float(fields[46]) if fields[46] not in {"", "-"} else None
        return pe if pe and pe > 0 else None, pb if pb and pb > 0 else None
    except (IndexError, ValueError):
        return None, None


def tencent_daily(symbol: str, limit: int = 900) -> list[dict[str, Any]]:
    market = "sh" if symbol.startswith(("5", "6", "9")) else "sz"
    url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={market}{symbol},day,,,{limit},qfq"
    payload = get_json(url, headers={"Referer": "https://gu.qq.com/"})
    node = payload.get("data", {}).get(f"{market}{symbol}", {})
    rows = node.get("qfqday") or node.get("day") or []
    if len(rows) < 30:
        raise ValueError(f"腾讯{symbol}日线不足30条")
    return [{
        "time": row[0], "open": float(row[1]), "close": float(row[2]),
        "high": float(row[3]), "low": float(row[4]), "volume": int(float(row[5])),
    } for row in rows]


def tencent_intraday(symbol: str) -> list[dict[str, Any]]:
    url = f"https://web.ifzq.gtimg.cn/appstock/app/kline/mKLine?param=sh{symbol},m5,,120"
    payload = get_json(url, headers={"Referer": "https://gu.qq.com/"})
    rows = payload.get("data", {}).get(f"sh{symbol}", {}).get("m5") or []
    if not rows:
        raise ValueError("腾讯5分钟行情为空")
    bars, weighted_sum, total_volume = [], 0.0, 0.0
    for row in rows[-48:]:
        stamp, open_price, close, high, low, volume = row[:6]
        volume_value = float(volume)
        typical = (float(open_price) + float(close)) / 2
        weighted_sum += typical * volume_value
        total_volume += volume_value
        formatted = datetime.strptime(stamp, "%Y%m%d%H%M").replace(tzinfo=SHANGHAI).isoformat(timespec="seconds")
        bars.append({
            "time": formatted, "open": float(open_price), "close": float(close), "high": float(high),
            "low": float(low), "volume": int(volume_value), "vwap": round(weighted_sum / max(1, total_volume), 3),
            "iopv": round(float(close), 3),
        })
    return bars


def fund_nav(code: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen_dates: set[str] = set()
    page = 1
    total = 1
    while len(rows) < total:
        url = f"https://api.fund.eastmoney.com/f10/lsjz?fundCode={code}&pageIndex={page}&pageSize=100"
        payload = get_json(url, headers={"Referer": f"https://fundf10.eastmoney.com/jjjz_{code}.html"})
        total = int(payload.get("TotalCount") or total)
        current = (payload.get("Data") or {}).get("LSJZList") or []
        fresh = [row for row in current if row.get("FSRQ") not in seen_dates]
        rows.extend(fresh)
        seen_dates.update(row.get("FSRQ") for row in fresh if row.get("FSRQ"))
        if not current or not fresh:
            break
        page += 1
    if len(rows) < 20:
        raise ValueError("基金净值记录不足")
    return [{
        "time": row["FSRQ"], "value": float(row["DWJZ"]),
        "accumulated": float(row.get("LJJZ") or row["DWJZ"]),
    } for row in reversed(rows) if row.get("DWJZ")]


def fund_profile(nav: list[dict[str, Any]]) -> dict[str, Any]:
    latest = nav[-1]
    previous = nav[-2] if len(nav) > 1 else latest
    change = (latest["value"] / previous["value"] - 1) * 100 if previous["value"] else 0.0
    source_url = "https://www.nffund.com/main/files/2024/12/03/133713706418.pdf"
    nav_source = "东方财富历史净值（基金公司净值聚合）"
    return {
        "name": "南方标普中国A股大盘红利低波50ETF联接A", "code": "008163", "shareClass": "A类",
        "fundType": "股票型ETF联接基金", "manager": "南方基金管理股份有限公司", "custodian": "中国农业银行股份有限公司",
        "inceptionDate": "2020-01-21", "openFrequency": "每个开放日开放申购与赎回", "targetEtf": "515450",
        "targetIndex": "标普中国A股大盘红利低波50指数", "targetEtfMinRatio": 90,
        "benchmark": "标的指数收益率×95% + 银行活期存款税后利率×5%",
        "dailyTrackingDeviationTarget": 0.35, "annualTrackingErrorTarget": 4.0,
        "latestNav": datum(latest["value"], nav_source, latest["time"], "daily", "verified", True),
        "latestAccumulatedNav": datum(latest.get("accumulated", latest["value"]), nav_source, latest["time"], "daily", "verified", True),
        "latestNavChange": datum(round(change, 4), nav_source, latest["time"], "daily", "verified", True),
        "fees": {
            "managementAnnual": 0.50, "custodyAnnual": 0.10, "salesServiceAnnual": 0.0,
            "subscription": [
                {"range": "100万元以下", "rate": "1.20%"}, {"range": "100万—300万元", "rate": "0.80%"},
                {"range": "300万—500万元", "rate": "0.40%"}, {"range": "500万元及以上", "rate": "每笔1000元"},
            ],
            "redemption": [{"holdingPeriod": "少于7日", "rate": "1.50%"}, {"holdingPeriod": "不少于7日", "rate": "0%"}],
            "note": "以上为产品资料概要标准费率，销售机构可能有申购折扣；赎回费按持有期计算。",
            "source": "南方基金产品资料概要", "url": source_url, "asOf": "2024-11-05",
        },
        "source": "南方基金产品资料概要", "url": source_url, "asOf": "2024-11-05",
    }


def tracking_error(nav: list[dict[str, Any]], daily: list[dict[str, Any]]) -> float | None:
    nav_map = {row["time"]: float(row["value"]) for row in nav}
    etf_map = {row["time"]: float(row["close"]) for row in daily}
    dates = sorted(set(nav_map).intersection(etf_map))[-253:]
    if len(dates) < 126:
        return None
    differences = []
    for previous_date, current_date in zip(dates, dates[1:]):
        nav_return = nav_map[current_date] / nav_map[previous_date] - 1
        etf_return = etf_map[current_date] / etf_map[previous_date] - 1
        differences.append(nav_return - etf_return)
    mean = sum(differences) / len(differences)
    variance = sum((value - mean) ** 2 for value in differences) / max(1, len(differences) - 1)
    return math.sqrt(variance) * math.sqrt(252) * 100


def akshare_enrichment(daily: list[dict[str, Any]]) -> dict[str, Any]:
    import akshare as ak

    result: dict[str, Any] = {"metrics": {}, "constituents": [], "warnings": []}
    now = now_iso()
    try:
        spot = ak.fund_etf_spot_em()
        target = spot[spot["代码"].astype(str).str.zfill(6) == "515450"]
        if target.empty:
            raise ValueError("ETF全市场行情中未找到515450")
        row = target.iloc[-1]
        as_of = str(row.get("更新时间") or now)
        result["iopv"] = datum(float(row["IOPV实时估值"]), "AKShare / 东方财富ETF行情", as_of, "realtime", "verified", False)
        result["quote"] = datum(float(row["最新价"]), "AKShare / 东方财富ETF行情", as_of, "realtime", "verified", True)
        result["premiumRate"] = datum(-float(row["基金折价率"]), "AKShare / 东方财富ETF行情", as_of, "realtime", "verified", False)
        result["turnoverRate"] = datum(float(row["换手率"]), "AKShare / 东方财富ETF行情", as_of, "realtime")
        result["amount"] = datum(float(row["成交额"]), "AKShare / 东方财富ETF行情", as_of, "realtime")
        amount = float(row["成交额"]) if float(row["成交额"]) else 1.0
        result["metrics"]["northboundProxy"] = datum(float(row["主力净流入-净额"]) / amount, "ETF主力资金净流入占比（非北向资金）", as_of, "daily", "estimated", False)
        result["etfShare"] = {"value": float(row["最新份额"]), **meta("AKShare / 东方财富ETF行情", as_of, "daily", "verified", True)}
    except Exception as error:
        result["warnings"].append(f"ETF扩展行情：{error}")

    try:
        start = (datetime.now(SHANGHAI).date() - timedelta(days=35)).strftime("%Y%m%d")
        end = datetime.now(SHANGHAI).date().strftime("%Y%m%d")
        curves = ak.bond_china_yield(start_date=start, end_date=end)
        government = curves[curves["曲线名称"] == "中债国债收益率曲线"].dropna(subset=["10年"])
        if not government.empty:
            latest = government.sort_values("日期").iloc[-1]
            result["metrics"]["tenYearYield"] = datum(float(latest["10年"]), "中国债券信息网-中债国债收益率曲线", str(latest["日期"]), "daily", "verified", True)
    except Exception as error:
        result["warnings"].append(f"中债收益率：{error}")

    try:
        shibor = ak.macro_china_shibor_all().dropna(subset=["O/N-定价"])
        if not shibor.empty:
            latest = shibor.sort_values("日期").iloc[-1]
            result["metrics"]["dr007"] = datum(float(latest["O/N-定价"]), "Shibor O/N流动性代理", str(latest["日期"]), "daily", "verified", True)
    except Exception as error:
        result["warnings"].append(f"Shibor：{error}")

    try:
        holdings = ak.fund_portfolio_hold_em(symbol="515450", date="")
        if not holdings.empty:
            latest_quarter = holdings["季度"].astype(str).max()
            latest_holdings = holdings[holdings["季度"].astype(str) == latest_quarter].copy()
            latest_holdings["股票代码"] = latest_holdings["股票代码"].astype(str).str.zfill(6)

            def enrich_holding(holding: dict[str, Any]) -> dict[str, Any]:
                code = str(holding["股票代码"])
                enriched = {
                    "code": code,
                    "name": str(holding["股票名称"]),
                    "weight": float(holding["占净值比例"]),
                    "aboveMa20": None,
                    "pe": None,
                    "pb": None,
                    "holdingAsOf": latest_quarter,
                }
                try:
                    bars = tencent_daily(code, 45)
                    closes = [float(item["close"]) for item in bars[-20:]]
                    enriched["aboveMa20"] = len(closes) >= 20 and closes[-1] > sum(closes) / len(closes)
                except Exception:
                    pass
                try:
                    enriched["pe"], enriched["pb"] = tencent_fundamentals(code)
                except Exception:
                    pass
                return enriched

            records = latest_holdings.head(50).to_dict("records")
            with ThreadPoolExecutor(max_workers=8) as executor:
                enriched_holdings = list(executor.map(enrich_holding, records))
            weights = positive_weights = pe_weight = pb_weight = pe_sum = pb_sum = 0.0
            constituents = []
            for holding in enriched_holdings:
                weight = float(holding["weight"])
                above_ma20 = holding["aboveMa20"]
                if above_ma20 is not None:
                    weights += weight
                    if above_ma20:
                        positive_weights += weight
                if holding["pe"] is not None:
                    pe_sum += float(holding["pe"]) * weight
                    pe_weight += weight
                if holding["pb"] is not None:
                    pb_sum += float(holding["pb"]) * weight
                    pb_weight += weight
                constituents.append({key: holding[key] for key in ("code", "name", "weight", "aboveMa20", "holdingAsOf")})
            result["constituents"] = constituents
            if weights > 0:
                result["metrics"]["breadth"] = datum(positive_weights / weights, "最新披露持仓加权 / 腾讯复权行情", now, "daily", "estimated", False)
            if pe_weight > 0:
                result["metrics"]["pe"] = datum(pe_sum / pe_weight, "最新披露持仓加权 / 腾讯个股PE", now, "daily", "estimated", False)
            if pb_weight > 0:
                result["metrics"]["pb"] = datum(pb_sum / pb_weight, "最新披露持仓加权 / 腾讯个股PB", now, "daily", "estimated", False)
            if pe_weight > 0 and pb_weight > 0 and pe_sum > 0:
                aggregate_pe = pe_sum / pe_weight
                aggregate_pb = pb_sum / pb_weight
                result["metrics"]["roe"] = datum(aggregate_pb / aggregate_pe * 100, "披露持仓PB/PE推导ROE代理", now, "quarterly", "estimated", False)
    except Exception as error:
        result["warnings"].append(f"披露持仓：{error}")

    if not result.get("iopv") and not result["metrics"]:
        raise RuntimeError("；".join(result["warnings"]) or "AKShare扩展数据全部失败")
    return result


def etf_announcements(symbol: str) -> list[dict[str, Any]]:
    params = urllib.parse.urlencode({"sr": "-1", "page_size": "12", "page_index": "1", "ann_type": "A", "client_source": "web", "stock_list": symbol})
    payload = get_json(f"https://np-anotice-stock.eastmoney.com/api/security/ann?{params}")
    events = []
    for item in (payload.get("data", {}).get("list") or [])[:6]:
        title = item.get("title", "ETF公告")
        notice_date = item.get("notice_date") or now_iso()
        events.append({
            "id": str(item.get("art_code", title)), "title": title, "category": "fund", "impact": "neutral",
            "summary": "ETF正式公告；用于核对分红、份额、交易与产品事项，不直接触发仓位。",
            "url": f"https://data.eastmoney.com/notices/detail/515450/{item.get('art_code', '')}.html",
            **meta("东方财富公告聚合 / 上交所公告", notice_date, "event", "verified", False),
        })
    return events


def load_previous() -> dict[str, Any] | None:
    try:
        return json.loads(BUNDLE_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def parse_as_of(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.replace(tzinfo=SHANGHAI) if parsed.tzinfo is None else parsed.astimezone(SHANGHAI)
    except (TypeError, ValueError):
        return None


def previous_or_unavailable(previous: dict[str, Any] | None, key: str, default: float, source: str, frequency: str = "daily") -> dict[str, Any]:
    try:
        value = previous["metrics"][key]
        as_of = parse_as_of(str(value.get("asOf", "")))
        ttl = {"realtime": timedelta(hours=24), "daily": timedelta(days=4), "monthly": timedelta(days=45), "quarterly": timedelta(days=130)}.get(frequency, timedelta(days=4))
        fresh_enough = as_of is not None and datetime.now(SHANGHAI) - as_of <= ttl
        return {
            **value,
            "quality": "estimated" if fresh_enough else "stale",
            "retrievedAt": now_iso(),
            "source": f"{value.get('source', source)}（上次成功值）",
        }
    except (TypeError, KeyError):
        return unavailable(default, source, frequency)


def update_share_history(path: Path, current: dict[str, Any] | None) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    try:
        history = json.loads(path.read_text(encoding="utf-8")).get("history", [])
    except (FileNotFoundError, json.JSONDecodeError, AttributeError):
        history = []
    if current:
        raw_date = str(current.get("asOf") or now_iso())[:10]
        date = raw_date if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw_date) else datetime.now(SHANGHAI).date().isoformat()
        point = {"date": date, "value": float(current["value"]), **{key: current[key] for key in ("source", "asOf", "retrievedAt", "quality", "pointInTimeSafe")}}
        history = [item for item in history if item.get("date") != date]
        history.append(point)
    history = sorted(history, key=lambda item: item.get("date", ""))[-260:]
    metric = None
    if len(history) >= 20 and float(history[-20]["value"]) > 0:
        change = float(history[-1]["value"]) / float(history[-20]["value"]) - 1
        metric = datum(change, "每日公开ETF份额快照累计计算", history[-1]["date"], "daily", "verified", True)
    return history, metric


def collect(output: Path) -> dict[str, Any]:
    previous = load_previous()
    statuses = {
        "eastmoney": Status("eastmoney", "东方财富行情"),
        "tencent": Status("tencent", "腾讯行情"),
        "nav": Status("nav", "008163基金净值"),
        "benchmark": Status("benchmark", "沪深300ETF行情"),
        "announcements": Status("announcements", "ETF公告"),
        "daily": Status("daily", "515450复权日线"),
        "intraday": Status("intraday", "515450五分钟线"),
        "akshare": Status("akshare", "AKShare扩展数据", "delayed", "本轮未启用扩展因子"),
    }
    quote = guarded(statuses["eastmoney"], lambda: eastmoney_quote("515450"), "报价、成交额和换手率已更新")
    backup = guarded(statuses["tencent"], lambda: tencent_quote("515450"), "独立备份报价已更新")
    daily = guarded(statuses["daily"], lambda: eastmoney_daily("515450"), "东方财富复权日线已更新")
    if not daily:
        daily = guarded(statuses["daily"], lambda: tencent_daily("515450"), "东方财富不可达，已切换腾讯复权日线")
    intraday = guarded(statuses["intraday"], lambda: eastmoney_intraday("515450"), "东方财富五分钟线已更新")
    if not intraday:
        intraday = guarded(statuses["intraday"], lambda: tencent_intraday("515450"), "东方财富不可达，已切换腾讯五分钟线")
    nav = guarded(statuses["nav"], lambda: fund_nav("008163"), "单位净值历史已更新")
    benchmark_bars = guarded(statuses["benchmark"], lambda: eastmoney_daily("510300"), "沪深300ETF复权日线已更新")
    if not benchmark_bars:
        benchmark_bars = guarded(statuses["benchmark"], lambda: tencent_daily("510300"), "已切换腾讯沪深300ETF复权日线")
    events = guarded(statuses["announcements"], lambda: etf_announcements("515450"), "ETF公告列表已更新") or []

    if not quote and previous:
        quote_value = {**previous["quote"], "quality": "stale", "retrievedAt": now_iso()}
    elif quote:
        quote_value = datum(float(quote["price"]), "东方财富", str(quote["asOf"]), "realtime")
    else:
        raise RuntimeError("首次采集必须取得主行情，已中止写入")
    backup_value = datum(float(backup["price"]), "腾讯行情", str(backup["asOf"]), "realtime") if backup else (
        {**previous["backupQuote"], "quality": "stale", "retrievedAt": now_iso()} if previous else unavailable(float(quote_value["value"]), "腾讯行情", "realtime")
    )
    daily = daily or (previous.get("daily", []) if previous else [])
    intraday = intraday or (previous.get("intraday", []) if previous else [])
    nav = nav or (previous.get("navSeries", []) if previous else [])
    benchmark = ([{"time": row["time"], "value": row["close"]} for row in benchmark_bars] if benchmark_bars else (previous.get("benchmarkSeries", []) if previous else []))
    if len(daily) < 30 or not intraday:
        raise RuntimeError("关键K线数据不足，拒绝覆盖现有数据包")

    previous_close = float(quote.get("previousClose", daily[-2]["close"])) if quote else float(daily[-2]["close"])
    proxy_iopv = float(intraday[-1].get("iopv") or quote_value["value"])
    premium = (float(quote_value["value"]) / proxy_iopv - 1) * 100 if proxy_iopv else 0.0
    metrics = {
        "trackingError": previous_or_unavailable(previous, "trackingError", 0.0, "南方基金定期报告", "quarterly"),
        "dividendYield": previous_or_unavailable(previous, "dividendYield", 0.0, "标普指数资料", "daily"),
        "pe": previous_or_unavailable(previous, "pe", 0.0, "标普指数资料", "daily"),
        "pb": previous_or_unavailable(previous, "pb", 0.0, "标普指数资料", "daily"),
        "roe": previous_or_unavailable(previous, "roe", 0.0, "成分股加权计算", "quarterly"),
        "breadth": previous_or_unavailable(previous, "breadth", 0.5, "50只成分股计算", "daily"),
        "tenYearYield": previous_or_unavailable(previous, "tenYearYield", 0.0, "中国债券信息网", "daily"),
        "dr007": previous_or_unavailable(previous, "dr007", 0.0, "中国人民银行", "daily"),
        "northboundProxy": previous_or_unavailable(previous, "northboundProxy", 0.0, "市场资金代理", "daily"),
        "shareChange20d": previous_or_unavailable(previous, "shareChange20d", 0.0, "上交所ETF份额", "daily"),
    }
    calculated_tracking_error = tracking_error(nav, daily)
    if calculated_tracking_error is not None:
        metrics["trackingError"] = datum(round(calculated_tracking_error, 4), "008163净值 / 515450复权行情计算", nav[-1]["time"], "daily", "verified", True)
    enrichment = guarded(statuses["akshare"], lambda: akshare_enrichment(daily), "IOPV、宏观利率与最新披露持仓已更新")
    if enrichment:
        if enrichment.get("warnings"):
            statuses["akshare"].status = "delayed"
            statuses["akshare"].detail = "部分扩展源失败：" + "；".join(enrichment["warnings"])[:150]
        metrics.update(enrichment.get("metrics", {}))
        if (not quote) and enrichment.get("quote"):
            quote_value = enrichment["quote"]
    share_history, share_change = update_share_history(output / "share-history.json", enrichment.get("etfShare") if enrichment else None)
    if share_change:
        metrics["shareChange20d"] = share_change
    elif enrichment and enrichment.get("etfShare"):
        metrics["shareChange20d"] = unavailable(0.0, f"ETF份额历史积累中（{len(share_history)}/20）", "daily")
    conflict = abs(float(quote_value["value"]) / float(backup_value["value"]) - 1) > 0.003 if float(backup_value["value"]) else True
    if conflict:
        quote_value["quality"] = backup_value["quality"] = "conflict"

    fund_watch = {
        "id": "southern-fund-disclosure", "title": "南方基金008163公告与定期报告入口", "category": "fund", "impact": "neutral",
        "summary": "采集任务保留官方核对入口；报告内容经结构化解析后再进入跟踪误差与资产配置因子。",
        "url": "https://www.nffund.com/main/jjcp/fundproduct/008163.shtml",
        **meta("南方基金", now_iso(), "event", "verified", False),
    }
    sse_watch = {
        "id": "sse-515450-official", "title": "上交所515450产品资料与公告入口", "category": "fund", "impact": "neutral",
        "summary": "用于核对ETF份额、净值、IOPV、分红和交易公告；官方披露优先于聚合行情。",
        "url": "https://www.sse.com.cn/assortment/fund/etf/detail/index.shtml?FUNDID=515450",
        **meta("上海证券交易所", now_iso(), "event", "verified", False),
    }
    index_watch = {
        "id": "sp-index-methodology-watch", "title": "标普红利低波指数方法与调整监控", "category": "index", "impact": "neutral",
        "summary": "跟踪指数方法、再平衡和成分调整公告；仅在取得可验证时点后进入研究记录。",
        "url": "https://www.spglobal.com/spdji/en/indices/dividends-factors/sp-china-a-share-dividend-low-volatility-50-index/",
        **meta("S&P Dow Jones Indices", now_iso(), "event", "verified", False),
    }
    source_matrix = [
        {"id": "southern", "name": "南方基金", "role": "基金净值、公告、定期报告", "url": fund_watch["url"]},
        {"id": "sse", "name": "上海证券交易所", "role": "ETF产品资料、份额与公告", "url": sse_watch["url"]},
        {"id": "sp", "name": "标普道琼斯指数", "role": "指数方法与调整", "url": index_watch["url"]},
        {"id": "chinabond", "name": "中国债券信息网", "role": "国债收益率", "url": "https://yield.chinabond.com.cn/"},
        {"id": "pbc", "name": "中国人民银行", "role": "利率与流动性", "url": "https://www.pbc.gov.cn/"},
        {"id": "nbs", "name": "国家统计局", "role": "PMI、CPI、PPI", "url": "https://www.stats.gov.cn/"},
    ]
    bundle = {
        "version": "1.0", "mode": "live", "generatedAt": now_iso(), "quote": quote_value, "backupQuote": backup_value,
        "previousClose": previous_close,
        "iopv": enrichment.get("iopv") if enrichment else datum(proxy_iopv, "515450成交价格代理", intraday[-1]["time"], "5m", "estimated", False),
        "premiumRate": enrichment.get("premiumRate") if enrichment else datum(round(premium, 4), "报价/IOPV代理计算", intraday[-1]["time"], "5m", "estimated", False),
        "turnoverRate": enrichment.get("turnoverRate") if enrichment else datum(float(quote.get("turnoverRate", 0.0)) if quote else 0.0, "东方财富", str(quote_value["asOf"]), "realtime"),
        "amount": enrichment.get("amount") if enrichment else datum(float(quote.get("amount", 0.0)) if quote else 0.0, "东方财富", str(quote_value["asOf"]), "realtime"),
        "daily": daily, "intraday": intraday, "fundProfile": fund_profile(nav), "navSeries": nav, "benchmarkSeries": benchmark, "metrics": metrics,
        "events": [fund_watch, sse_watch, index_watch, *events], "sources": [status.as_dict() for status in statuses.values()],
        "constituents": enrichment.get("constituents", []) if enrichment else [],
        "etfShare": enrichment.get("etfShare") if enrichment else None,
        "backtest": evaluate_rolling([{"time": row["time"], "value": row.get("accumulated", row["value"])} for row in nav]),
    }
    quality_items = [bundle["quote"], bundle["backupQuote"], bundle["iopv"], bundle["premiumRate"], *metrics.values()]
    healthy = sum(item["quality"] not in {"unavailable", "conflict", "stale"} for item in quality_items)
    array_checks = [len(daily) >= 126, len(intraday) >= 24]
    completeness = round((healthy + sum(array_checks)) / (len(quality_items) + len(array_checks)) * 100)
    output.mkdir(parents=True, exist_ok=True)
    atomic_json(output / "research-bundle.json", bundle)
    atomic_json(output / "share-history.json", {"version": "1.0", "generatedAt": bundle["generatedAt"], "fundCode": "008163", "targetEtf": "515450", "history": share_history})
    atomic_json(output / "market-snapshot.json", {key: bundle[key] for key in ("version", "generatedAt", "quote", "backupQuote", "previousClose", "iopv", "premiumRate", "turnoverRate", "amount", "daily", "intraday")})
    atomic_json(output / "fund-research.json", {"version": "1.0", "generatedAt": bundle["generatedAt"], "fundCode": "008163", "targetEtf": "515450", "profile": bundle["fundProfile"], "navSeries": nav, "trackingError": metrics["trackingError"]})
    atomic_json(output / "macro-regime.json", {"version": "1.0", "generatedAt": bundle["generatedAt"], "tenYearYield": metrics["tenYearYield"], "dr007": metrics["dr007"]})
    atomic_json(output / "constituent-breadth.json", {"version": "1.0", "generatedAt": bundle["generatedAt"], "breadth": metrics["breadth"], "pe": metrics["pe"], "pb": metrics["pb"], "roe": metrics["roe"], "dividendYield": metrics["dividendYield"], "constituents": bundle["constituents"]})
    atomic_json(output / "events.json", {"version": "1.0", "generatedAt": bundle["generatedAt"], "events": bundle["events"], "sourceMatrix": source_matrix})
    atomic_json(output / "data-health.json", {"version": "1.0", "generatedAt": bundle["generatedAt"], "completeness": completeness, "quoteConflict": conflict, "shareHistoryDays": len(share_history), "sources": bundle["sources"], "sourceMatrix": source_matrix})
    return bundle


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DATA_DIR)
    args = parser.parse_args()
    try:
        bundle = collect(args.output)
        print(json.dumps({"generatedAt": bundle["generatedAt"], "bars": len(bundle["daily"]), "events": len(bundle["events"])}, ensure_ascii=False))
        return 0
    except Exception as error:
        print(f"collector failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
