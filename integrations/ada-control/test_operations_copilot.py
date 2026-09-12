#!/usr/bin/env python3
import unittest
from operations_copilot import build_owner_brief, route_operations_prompt

class OperationsCopilotTests(unittest.TestCase):
    def test_clean_day_is_green(self):
        brief=build_owner_brief({"staff":[],"coverage":[],"appointments":[],"payroll":[]})
        self.assertEqual(brief["status"],"green")
        self.assertTrue(brief["safe_to_run_payroll"])

    def test_payroll_mismatch_blocks_payroll(self):
        brief=build_owner_brief({"payroll":[{"staff":"Failla","status":"underpaid","outstanding":153.59}]})
        self.assertEqual(brief["status"],"red")
        self.assertFalse(brief["safe_to_run_payroll"])

    def test_owner_prompt_routes(self):
        result=route_operations_prompt("Jarvis what needs my attention today?",{"coverage":[{"business":"Beauty","covered":False,"window":"10-1"}]})
        self.assertTrue(result["handled"])
        self.assertEqual(result["intent"],"owner_brief")

if __name__ == "__main__": unittest.main()
