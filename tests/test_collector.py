import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from collect_data import SHANGHAI, previous_or_unavailable  # noqa: E402


class CollectorCarryForwardTests(unittest.TestCase):
    @staticmethod
    def previous(as_of: str) -> dict:
        return {
            "metrics": {
                "pe": {
                    "value": 8.5,
                    "source": "test source",
                    "asOf": as_of,
                    "retrievedAt": as_of,
                    "frequency": "daily",
                    "quality": "verified",
                    "pointInTimeSafe": True,
                }
            }
        }

    def test_recent_daily_value_is_carried_as_estimated(self):
        as_of = (datetime.now(SHANGHAI) - timedelta(days=1)).isoformat()
        result = previous_or_unavailable(self.previous(as_of), "pe", 0.0, "fallback", "daily")
        self.assertEqual(result["quality"], "estimated")
        self.assertEqual(result["value"], 8.5)

    def test_old_daily_value_is_marked_stale(self):
        as_of = (datetime.now(SHANGHAI) - timedelta(days=10)).isoformat()
        result = previous_or_unavailable(self.previous(as_of), "pe", 0.0, "fallback", "daily")
        self.assertEqual(result["quality"], "stale")


if __name__ == "__main__":
    unittest.main()
