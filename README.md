# 008163 移动量化研究终端

专门研究南方标普红利低波50ETF联接A（`008163`）及目标ETF（`515450`）的免费、移动优先H5。它提供透明的申购/持有/赎回研究建议，不连接券商，也不承诺收益。

## 已实现

- 结论优先的每日建议：综合分、目标仓位、调整幅度、金额/份额与证据归因。
- 固定70/30权重：行情70%，估值、资金、宽度、宏观、跟踪与事件30%。
- 数据保护：关键行情陈旧或双源价差超过0.3%时，禁止最终金额建议。
- 决策时钟：14:45前仅显示初步分析，14:45—14:55每30秒复核，14:55后把当日建议冻结到本机。
- 图表：515450复权日K、成交量、MA5/10/20/60/120/250、BOLL、支撑压力和历史建议标记；5分钟价格、VWAP、IOPV、昨收和14:45决策线；MACD/RSI/KDJ/ATR/OBV切换。
- 历史验证：504日训练、126日验证、126日测试的完整滚动样本外窗口；基准使用008163累计净值，按分红再投资口径比较。
- 私密持仓：PBKDF2-SHA256（25万次）+ AES-GCM，仅存浏览器；支持加密导入导出、快速锁定和每天一次的完整操作账本。
- PWA与离线降级：GitHub不可达时读取手机缓存；另有可直接双击打开的单文件HTML。
- 手机实时层：打开页面后直取东方财富与腾讯主备报价，交易时段每分钟更新，决策窗口每30秒更新；跨域失败时保留Actions数据包。

## 数据源

每条量化数据都包含 `source`、`asOf`、`retrievedAt`、`frequency`、`quality` 与 `pointInTimeSafe`。

| 层级 | 当前免费来源 | 说明 |
| --- | --- | --- |
| ETF行情 | 东方财富、腾讯、AKShare、上交所官方入口 | 主备报价、复权日线、5分钟线、IOPV、折溢价、成交额、换手率、资金流、份额 |
| 基金 | 东方财富基金接口、南方基金官方入口 | 单位/累计净值、公告入口、净值与ETF计算跟踪误差 |
| 成分股 | 最新披露持仓、腾讯个股行情 | 宽度及持仓加权PE/PB先标为影子数据，不进入回测仓位 |
| 宏观 | 中国债券信息网、Shibor（AKShare结构化） | 10年期国债与流动性代理 |
| 指数 | 标普官方页面与方法文档 | 指数规则和调整事件必须以官方文件为准 |

AKShare目录：<https://akshare.akfamily.xyz/data/index.html>；Lightweight Charts：<https://tradingview.github.io/lightweight-charts/>。

## 本地运行

需要 Node.js 22 与 Python 3.12。

```bash
pnpm install
pnpm dev
python scripts/collect_data.py
pnpm test
python -m unittest tests/test_backtest.py -v
pnpm build
python scripts/build_standalone.py
```

公开数据写入 `public/data/`。个人持仓不会写入仓库或数据包。

## GitHub Pages

1. 新建公共GitHub仓库并推送本目录到 `main`。
2. 在仓库 `Settings > Pages` 中把 Source 设为 `GitHub Actions`。
3. 手动运行一次 `Collect public research data`，再运行 `Deploy GitHub Pages`。
4. 定时采集按北京时间工作日 `08:17`、`14:37`、`15:23`、`21:17` 运行；GitHub可能延迟定时任务。

`pages.yml` 会构建纯静态站点；`collect-data.yml` 只提交公开研究JSON。华为浏览器可通过系统菜单将Pages链接添加到桌面。

## 重要限制

- 场外基金按未知价申赎；盘中ETF信号只能用于估算，最终以基金公司确认净值为准。
- 当前免费历史只有一个完整的756交易日样本外窗口，页面如实显示“未达到验证门槛”。
- 最新披露持仓存在报告滞后，缺少历史时点的数据只显示为影子证据。
- ETF份额变化从每日公开快照开始累积，未满20个交易日时不会进入仓位评分。
- 赎回份额为净值估算值；计划按用户要求将申购费和赎回费视为0。
