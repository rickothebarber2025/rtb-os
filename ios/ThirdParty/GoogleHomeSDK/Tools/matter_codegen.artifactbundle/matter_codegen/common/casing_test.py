"""Unit tests for casing utility module."""

from common import casing
from google3.testing.pybase import parameterized


class CasingTest(parameterized.TestCase):

  @parameterized.named_parameters(
      ("TestString", "TestString", "test_string", "TEST_STRING"),
      ("ABC", "ABC", "abc", "ABC"),
      ("ABCDef", "ABCDef", "abc_def", "ABC_DEF"),
      ("AbcDef", "AbcDef", "abc_def", "ABC_DEF"),
      ("Test123String", "Test123String", "test123_string", "TEST123_STRING"),
      ("BLEUWB", "BLEUWB", "ble_uwb", "BLE_UWB"),
      (
          "SomeBLEStringIDs",
          "SomeBLEStringIDs",
          "some_ble_string_ids",
          "SOME_BLE_STRING_IDS",
      ),
      ("IPv4", "IPv4", "ipv4", "IPV4"),
      ("IPv6Address", "IPv6Address", "ipv6_address", "IPV6_ADDRESS"),
      ("IPAddress", "IPAddress", "ip_address", "IP_ADDRESS"),
      ("IDs", "IDs", "ids", "IDS"),
      ("SomeIDs", "SomeIDs", "some_ids", "SOME_IDS"),
      ("UPPERCASE", "UPPERCASE", "uppercase", "UPPERCASE"),
      ("lowercase", "lowercase", "lowercase", "LOWERCASE"),
      ("kTestString", "kTestString", "k_test_string", "K_TEST_STRING"),
      ("TCPKeepAlive", "TCPKeepAlive", "tcp_keep_alive", "TCP_KEEP_ALIVE"),
      ("XMLHttp", "XMLHttp", "xml_http", "XML_HTTP"),
      ("iOSTest", "iOSTest", "ios_test", "IOS_TEST"),
      ("Int8UValue", "Int8UValue", "int8u_value", "INT8U_VALUE"),
      ("TariffKWh", "TariffKWh", "tariff_kwh", "TARIFF_KWH"),
      ("TariffKVAh", "TariffKVAh", "tariff_kvah", "TARIFF_KVAH"),
  )
  def test_to_snake_case(
      self, input_text, expected_lower_output, expected_upper_output
  ):
    self.assertEqual(casing.ToLowerSnakeCase(input_text), expected_lower_output)
    self.assertEqual(casing.ToUpperSnakeCase(input_text), expected_upper_output)

  @parameterized.named_parameters(
      ("TestString", "TestString", "testString", "TestString"),
      ("ABC", "ABC", "abc", "Abc"),
      ("ABCDef", "ABCDef", "abcDef", "AbcDef"),
      ("AbcDef", "AbcDef", "abcDef", "AbcDef"),
      ("Test123String", "Test123String", "test123String", "Test123String"),
      ("BLEUWB", "BLEUWB", "bleUwb", "BleUwb"),
      (
          "SomeBLEStringIDs",
          "SomeBLEStringIDs",
          "someBleStringIds",
          "SomeBleStringIds",
      ),
      ("IPv4", "IPv4", "ipv4", "Ipv4"),
      ("IPv6Address", "IPv6Address", "ipv6Address", "Ipv6Address"),
      ("IPAddress", "IPAddress", "ipAddress", "IpAddress"),
      ("IDs", "IDs", "ids", "Ids"),
      ("SomeIDs", "SomeIDs", "someIds", "SomeIds"),
      ("UPPERCASE", "UPPERCASE", "uppercase", "Uppercase"),
      ("lowercase", "lowercase", "lowercase", "Lowercase"),
      ("kTestString", "kTestString", "kTestString", "KTestString"),
      ("TCPKeepAlive", "TCPKeepAlive", "tcpKeepAlive", "TcpKeepAlive"),
      ("XMLHttp", "XMLHttp", "xmlHttp", "XmlHttp"),
      ("iOSTest", "iOSTest", "iosTest", "IosTest"),
      ("Int8UValue", "Int8UValue", "int8uValue", "Int8uValue"),
      ("TariffKWh", "TariffKWh", "tariffKwh", "TariffKwh"),
      ("TariffKVAh", "TariffKVAh", "tariffKvah", "TariffKvah"),
  )
  def test_to_camel_case(
      self, input_text, expected_lower_output, expected_upper_output
  ):
    self.assertEqual(casing.ToLowerCamelCase(input_text), expected_lower_output)
    self.assertEqual(casing.ToUpperCamelCase(input_text), expected_upper_output)
