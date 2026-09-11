"""Tests for CustomGenerator.

This test class tests the helper functions for CustomGenerator in __init__.py.
"""

import unittest
import kotlin


class CustomGeneratorTest(unittest.TestCase):

  def test_lower_camel_case_formatting(self):
    test_cases = [
        ("all_uppercase", "ABCDEF", "abcdef"),
        ("ble_uwb_acronym_at_start", "BLEUWBDef", "bleUwbDef"),
        ("ble_uwb_acronym_in_middle", "AbcBLEUWBDef", "abcBleUwbDef"),
        ("ble_uwb_acronym_at_end", "AbcBLEUWB", "abcBleUwb"),
        ("trailing_ids", "AbcIDs", "abcIds"),
        ("ipv4_acronym_at_start_small_p", "IpV4Abc", "ipv4Abc"),
        ("ipv4_acronym_at_start_capital_p", "IPV4Abc", "ipv4Abc"),
        ("ipv4_acronym_at_end_small_p", "AbcIpV4", "abcIpv4"),
        ("ipv4_acronym_at_end_capital_p", "AbcIPV4", "abcIpv4"),
        ("ipv6_acronym_at_start_small_p", "IpV6Abc", "ipv6Abc"),
        ("ipv6_acronym_at_start_capital_p", "IPV6Abc", "ipv6Abc"),
        ("ipv6_acronym_at_end_small_p", "AbcIpV6", "abcIpv6"),
        ("ipv6_acronym_at_end_capital_p", "AbcIPV6", "abcIpv6"),
        ("initial_capitalized_term", "Abcdefg", "abcdefg"),
        ("multiple_capitalized_terms", "AbcDefg", "abcDefg"),
        ("multiple_capitalized_terms_acronym_at_start", "ABCDefg", "abcDefg"),
        (
            "multiple_capitalized_terms_acronym_in_middle",
            "AbcDEFGh",
            "abcDefGh",
        ),
        ("multiple_capitalized_terms_acronym_at_end", "AbcDEF", "abcDef"),
    ]
    for name, text, expected in test_cases:
      with self.subTest(name):
        self.assertEqual(kotlin.ToLowerCamelCase(text), expected)

  def test_upper_camel_case_formatting(self):
    test_cases = [
        ("all_uppercase", "ABCDEF", "Abcdef"),
        ("ble_uwb_acronym_at_start", "BLEUWBDef", "BleUwbDef"),
        ("ble_uwb_acronym_in_middle", "AbcBLEUWBDef", "AbcBleUwbDef"),
        ("ble_uwb_acronym_at_end", "AbcBLEUWB", "AbcBleUwb"),
        ("trailing_ids", "AbcIDs", "AbcIds"),
        ("ipv4_acronym_at_start_small_p", "IpV4Abc", "Ipv4Abc"),
        ("ipv4_acronym_at_start_capital_p", "IPV4Abc", "Ipv4Abc"),
        ("ipv4_acronym_at_end_small_p", "AbcIpV4", "AbcIpv4"),
        ("ipv4_acronym_at_end_capital_p", "AbcIPV4", "AbcIpv4"),
        ("ipv6_acronym_at_start_small_p", "IpV6Abc", "Ipv6Abc"),
        ("ipv6_acronym_at_start_capital_p", "IPV6Abc", "Ipv6Abc"),
        ("ipv6_acronym_at_end_small_p", "AbcIpV6", "AbcIpv6"),
        ("ipv6_acronym_at_end_capital_p", "AbcIPV6", "AbcIpv6"),
        ("initial_capitalized_term", "Abcdefg", "Abcdefg"),
        ("multiple_capitalized_terms", "AbcDefg", "AbcDefg"),
        ("multiple_capitalized_terms_acronym_at_start", "ABCDefg", "AbcDefg"),
        (
            "multiple_capitalized_terms_acronym_in_middle",
            "AbcDEFGh",
            "AbcDefGh",
        ),
        ("multiple_capitalized_terms_acronym_at_end", "AbcDEF", "AbcDef"),
    ]
    for name, text, expected in test_cases:
      with self.subTest(name):
        self.assertEqual(kotlin.ToUpperCamelCase(text), expected)

  def test_escape_kt_reserved_keywords(self):
    test_cases = [
        ("reserved_keyword", "data", "`data`"),
        ("unreserved_keyword", "abc", "abc"),
        ("keyword_name", "name", "Name"),
    ]
    for name, text, expected in test_cases:
      with self.subTest(name):
        self.assertEqual(kotlin.EscapeKtKeyword(text), expected)


if __name__ == "__main__":
  unittest.main()
