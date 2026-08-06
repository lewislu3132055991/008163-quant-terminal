"""Transparent rolling out-of-sample evaluator for the 008163 position rules."""

from __future__ import annotations

import itertools
from datetime import date
from typing import Any


def moving_average(values: list[float], end: int, period: int) -> float:
    window = values[max(0, end - period + 1): end + 1]
    return sum(window) / len(window)


POSITIONS = (0.75, 0.82, 0.88, 0.90)


def simulate(values: list[float], short: int, long: int, momentum_period: int = 60) -> list[float]:
    """Use yesterday's three trend votes to set today's position, avoiding look-ahead."""
    equity = [1.0]
    for index in range(1, len(values)):
        if index <= max(long, momentum_period):
            position = POSITIONS[1]
        else:
            short_ma = moving_average(values, index - 1, short)
            long_ma = moving_average(values, index - 1, long)
            momentum = values[index - 1] / values[index - 1 - momentum_period] - 1
            votes = sum((short_ma > long_ma, values[index - 1] > long_ma, momentum > 0))
            position = POSITIONS[votes]
        daily_return = values[index] / values[index - 1] - 1
        equity.append(equity[-1] * (1 + position * daily_return))
    return equity


def annualized(values: list[float]) -> float:
    if len(values) < 2 or values[0] <= 0 or values[-1] <= 0:
        return 0.0
    return (values[-1] / values[0]) ** (252 / (len(values) - 1)) - 1


def max_drawdown(values: list[float]) -> float:
    peak, result = values[0], 0.0
    for value in values:
        peak = max(peak, value)
        result = min(result, value / peak - 1)
    return result


def evaluate_rolling(series: list[dict[str, Any]], train: int = 504, validation: int = 126, test: int = 126) -> dict[str, Any]:
    values = [float(item["value"]) for item in series if float(item["value"]) > 0]
    parameters = [
        item for item in itertools.product((10, 20, 40, 60), (60, 120, 180, 250), (20, 60, 120, 250))
        if item[0] < item[1]
    ]
    tests: list[dict[str, float]] = []
    cursor = 0
    while cursor + train + validation + test <= len(values):
        training = values[cursor: cursor + train]
        validation_slice = values[cursor + train: cursor + train + validation]
        test_slice = values[cursor + train + validation: cursor + train + validation + test]
        def selection_score(data: list[float], params: tuple[int, int, int]) -> float:
            curve = simulate(data, *params)
            return annualized(curve) + 0.25 * max_drawdown(curve)

        ranked = sorted(parameters, key=lambda params: selection_score(training, params), reverse=True)
        selected = max(ranked[:12], key=lambda params: selection_score(validation_slice, params))
        strategy_equity = simulate(test_slice, *selected)
        strategy_return = annualized(strategy_equity)
        benchmark_return = annualized(test_slice)
        tests.append({
            "strategy": strategy_return, "benchmark": benchmark_return,
            "excess": strategy_return - benchmark_return,
            "drawdown": max_drawdown(strategy_equity),
            "benchmarkDrawdown": max_drawdown(test_slice),
        })
        cursor += test
    if not tests:
        return {
            "asOf": date.today().isoformat(), "methodology": f"{train}日训练 / {validation}日验证 / {test}日测试；仅用前一日信号，仓位75%—90%",
            "testPeriods": 0, "annualizedReturn": 0.0, "benchmarkAnnualizedReturn": 0.0, "excessReturn": 0.0,
            "maxDrawdown": 0.0, "benchmarkMaxDrawdown": 0.0, "winRate": 0.0, "drawdownWinRate": 0.0,
            "returnRetention": 0.0, "drawdownImprovement": 0.0, "returnPassed": False,
            "defensePassed": False, "validationPassed": False,
        }
    strategy = sum(item["strategy"] for item in tests) / len(tests)
    benchmark = sum(item["benchmark"] for item in tests) / len(tests)
    wins = sum(item["excess"] > 0 for item in tests)
    win_rate = wins / len(tests)
    strategy_drawdown = min(item["drawdown"] for item in tests)
    benchmark_drawdown = min(item["benchmarkDrawdown"] for item in tests)
    drawdown_win_rate = sum(item["drawdown"] > item["benchmarkDrawdown"] for item in tests) / len(tests)
    return_retention = strategy / benchmark if benchmark > 0 else 0.0
    drawdown_improvement = 1 - abs(strategy_drawdown) / abs(benchmark_drawdown) if benchmark_drawdown else 0.0
    return_passed = strategy - benchmark >= 0.02 and win_rate > 0.5
    defense_passed = len(tests) >= 3 and return_retention >= 0.80 and drawdown_improvement >= 0.15 and drawdown_win_rate > 0.5
    return {
        "asOf": date.today().isoformat(), "methodology": f"{train}日训练 / {validation}日验证 / {test}日测试；仅用前一日信号，仓位75%—90%",
        "testPeriods": len(tests), "annualizedReturn": round(strategy * 100, 3),
        "benchmarkAnnualizedReturn": round(benchmark * 100, 3), "excessReturn": round((strategy - benchmark) * 100, 3),
        "maxDrawdown": round(strategy_drawdown * 100, 3), "benchmarkMaxDrawdown": round(benchmark_drawdown * 100, 3),
        "winRate": round(win_rate, 3), "drawdownWinRate": round(drawdown_win_rate, 3),
        "returnRetention": round(return_retention * 100, 3), "drawdownImprovement": round(drawdown_improvement * 100, 3),
        "returnPassed": return_passed, "defensePassed": defense_passed, "validationPassed": return_passed,
    }
