import sys
import unittest
import json
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from backtest import evaluate_rolling, max_drawdown  # noqa: E402
from collect_data import update_share_history  # noqa: E402


class BacktestTests(unittest.TestCase):
    def test_requires_a_full_train_validate_test_window(self):
        short = [{"value": 1 + index / 1000} for index in range(755)]
        self.assertEqual(evaluate_rolling(short)["testPeriods"], 0)

    def test_uses_only_completed_out_of_sample_windows(self):
        enough = [{"value": 1 + index / 1000} for index in range(882)]
        report = evaluate_rolling(enough)
        self.assertEqual(report["testPeriods"], 2)
        self.assertIn("504日训练", report["methodology"])

    def test_reports_return_and_defense_as_separate_objectives(self):
        values = []
        level = 1.0
        for index in range(1600):
            level *= 1 + (0.0005 if index % 90 < 65 else -0.0008)
            values.append({"value": level})
        report = evaluate_rolling(values)
        for field in ("returnPassed", "defensePassed", "returnRetention", "drawdownImprovement", "benchmarkMaxDrawdown", "drawdownWinRate"):
            self.assertIn(field, report)
        self.assertGreaterEqual(report["testPeriods"], 3)

    def test_drawdown_calculation(self):
        self.assertAlmostEqual(max_drawdown([1.0, 1.2, 0.9, 1.1]), -0.25)

    def test_share_change_uses_twenty_persisted_point_in_time_snapshots(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "share-history.json"
            history = [{"date": f"2026-07-{day:02d}", "value": 100 + day} for day in range(1, 20)]
            path.write_text(json.dumps({"history": history}), encoding="utf-8")
            current = {
                "value": 140, "source": "test", "asOf": "2026-07-20T15:00:00+08:00",
                "retrievedAt": "2026-07-20T15:01:00+08:00", "quality": "verified", "pointInTimeSafe": True,
            }
            points, metric = update_share_history(path, current)
            self.assertEqual(len(points), 20)
            self.assertTrue(metric["pointInTimeSafe"])
            self.assertAlmostEqual(metric["value"], 140 / 101 - 1)


if __name__ == "__main__":
    unittest.main()
