"""Casing utilities."""

import re


def ToLowerCamelCase(text: str) -> str:
  """Converts the given string to standard Kotlin lower camel case.

  Args:
    text: The text which is to be converted to camel case.

  Returns:
    Input text converted to Kotlin specific camel case.
  """
  camel = ToUpperCamelCase(text)
  return camel[0].lower() + camel[1:]


def ToUpperCamelCase(text: str) -> str:
  """Converts the given string to standard Kotlin upper camel case.

  Args:
    text: The text which is to be converted to camel case.

  Returns:
    Input text converted to Kotlin specific camel case.
  """
  # Special cases for acronyms that should have specific UpperCamelCase forms.
  splits = ToLowerSnakeCase(text).split("_")
  return "".join([x.capitalize() for x in splits])


def ToLowerSnakeCase(text: str) -> str:
  """Convert camelCaseString to lower_snake_case with proper handling of acronyms and numerals."""
  # Replace known terms that don't conform to the general regex patterns below.
  # 1. `BLE` with `Ble`. Work around for `BLEUWB` in the DoorLock cluster.
  # 2. Handles plural `IDs` as `Ids`.
  # 3. Convert `IPv4` and `IPv6` into single term.
  # 4. Convert `iOS` into single term.
  replace_terms = {
      "BLE": "Ble",
      "IDs": "Ids",
      "IPv4": "Ipv4",
      "IPv6": "Ipv6",
      "iOS": "Ios",
      "Int8U": "Int8u",
      "KWh": "Kwh",  # Kilowatt hour
      "KVAh": "Kvah",  # Kilovolt amper hour
  }

  # Replace known terms from the above map.
  for old, new in replace_terms.items():
    text = text.replace(old, new)

  # 1. [A-Z]+(?=[A-Z][a-z]) : Match caps if followed by Cap+Lower
  #                           (e.g., "ABC" in "ABCDef")
  # 2. [A-Z]+[^A-Z]*        : Match standard Cap+Lower words
  #                           (e.g., "Def") or terminal acronyms
  # 3. ^[^A-Z]+             : Match leading non-capital characters
  splits = re.findall(r"[A-Z]+(?=[A-Z][a-z])|[A-Z]+[^A-Z]*|^[^A-Z]+", text)
  return "_".join([x.lower() for x in splits])


def ToUpperSnakeCase(s: str) -> str:
  """Converts camelCaseString to UPPER_SNAKE_CASE with proper handling of acronyms and numerals."""
  return ToLowerSnakeCase(s).upper()
