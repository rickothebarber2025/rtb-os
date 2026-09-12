"""Plugin module to matter_idl for auto-generation of .proto files.

This module provides a plugin to the matter_idl tool from the Matter SDK
(https://github.com/project-chip/connectedhomeip/tree/master/scripts/py_matter_idl)
to assist generating java device definitions
"""

import logging
import os
import re
import sys
from typing import Optional, Union

import common
from common.postprocess import PostProcessIdl
import jinja2
from matter.idl.generators import CodeGenerator
from matter.idl.generators import GeneratorStorage
from matter.idl.generators.filters import lowfirst
from matter.idl.generators.filters import upfirst
from matter.idl.generators.type_definitions import BasicInteger
from matter.idl.generators.type_definitions import BasicString
from matter.idl.generators.type_definitions import FundamentalType
from matter.idl.generators.type_definitions import IdlBitmapType
from matter.idl.generators.type_definitions import IdlEnumType
from matter.idl.generators.type_definitions import IdlType
from matter.idl.generators.type_definitions import ParseDataType
from matter.idl.generators.type_definitions import TypeLookupContext
from matter.idl.matter_idl_types import Attribute
from matter.idl.matter_idl_types import Bitmap
from matter.idl.matter_idl_types import Cluster
from matter.idl.matter_idl_types import Command
from matter.idl.matter_idl_types import ConstantEntry
from matter.idl.matter_idl_types import DataType
from matter.idl.matter_idl_types import Field
from matter.idl.matter_idl_types import Idl
from matter.idl.matter_idl_types import Struct
import stringcase
import yaml


class CodeGenerationError(Exception):

  def __init__(self, message: str):
    super().__init__(message)


def ToConstFieldName(const_name: str) -> str:
  """Return enum/bitmap entry name as camel case, without a leading 'k', and prepending 'Num' if the symbol starts with a numeral."""
  if const_name[0] == "k":
    const_name = const_name[1:]
  if const_name[0].isnumeric():
    const_name = "Num" + const_name
  return const_name


def BoolAsStr(bool_value: bool) -> str:
  """Return string-ified boolean."""
  return "true" if bool_value else "false"


def IsNullable(field: Field) -> bool:
  """Returns true if the field is nullable."""
  return bool(field.is_nullable)


def IsOptional(field: Field) -> bool:
  """Returns true if the field is optional."""
  return bool(field.is_optional)


def _CommandHasResponse(command: Command) -> bool:
  """Returns true if a command has a specific response."""
  return command.output_param != "DefaultSuccess"


def _HasWritableAttributes(cluster: Cluster) -> bool:
  """Checks if any attribute is writable in a cluster."""
  for attribute in cluster.attributes:
    if attribute.is_writable:
      return True

  return False


def _HasTimedAttributes(cluster: Cluster) -> bool:
  """Checks if any attribute in a cluster requires a timed interaction for the write."""
  for attribute in cluster.attributes:
    if attribute.requires_timed_write:
      return True

  return False


def _AreVariablesDifferent(
    data_type, field: Field, name1: str, name2: str
) -> str:
  """Returns the comparison string of two variables being different."""

  if field.is_list or field.is_optional:
    return f"{name1} != {name2}"

  if isinstance(data_type, BasicString):
    if data_type.is_binary:
      return f"!({name1} contentEquals {name2})"

  return f"{name1} != {name2}"


def _DataTypeToKotlinType(
    data_type: Union[
        BasicInteger,
        BasicString,
        IdlBitmapType,
        FundamentalType,
        IdlEnumType,
        IdlType,
    ],
) -> str:
  """Return the kotlin type for the given parser AST data type."""

  if isinstance(data_type, BasicInteger):
    if data_type.is_signed:
      if data_type.byte_count <= 1:
        return "Byte"
      if data_type.byte_count <= 2:
        return "Short"
      if data_type.byte_count <= 4:
        return "Int"
      return "Long"
    else:  # unsigned
      if data_type.byte_count <= 1:
        return "UByte"
      if data_type.byte_count <= 2:
        return "UShort"
      if data_type.byte_count <= 4:
        return "UInt"
      return "ULong"

  if isinstance(data_type, BasicString):
    if data_type.is_binary:
      return "ByteArray"

    return "String"

  # isinstance(data_type, FundamentalType):
  if data_type == FundamentalType.BOOL:
    return "Boolean"

  if data_type == FundamentalType.FLOAT:
    return "Float"

  if data_type == FundamentalType.DOUBLE:
    return "Double"

  if isinstance(data_type, IdlEnumType):
    return _DataTypeToKotlinType(data_type.base_type)

  if isinstance(data_type, IdlBitmapType):
    return _DataTypeToKotlinType(data_type.base_type)

  if isinstance(data_type, IdlType):
    return data_type.idl_name

  # Above should have handled all cases
  raise CodeGenerationError("Unsupported data type: %r" % data_type)


def _DataTypeToDescriptorType(
    data_type: Union[
        BasicInteger,
        BasicString,
        IdlBitmapType,
        FundamentalType,
        IdlEnumType,
        IdlType,
    ],
) -> str:
  """Return the descriptor type for the given parser AST data type."""
  descriptor_type = ""

  if isinstance(data_type, IdlType):
    if data_type.is_struct:
      descriptor_type = ToUpperCamelCase(data_type.idl_name + ".Adapter")
    else:
      descriptor_type = "NoOpDescriptor"
  elif isinstance(data_type, IdlEnumType):
    if data_type.idl_name not in ("enum8", "enum16", "enum32", "enum64"):
      descriptor_type = ToUpperCamelCase(data_type.idl_name + ".EnumDescriptor")
    else:
      descriptor_type = "NoOpDescriptor"
  elif isinstance(data_type, IdlBitmapType):
    if data_type.idl_name not in (
        "bitmap8",
        "bitmap16",
        "bitmap32",
        "bitmap64",
    ):
      descriptor_type = ToUpperCamelCase(
          data_type.idl_name + ".BitmapDescriptor"
      )
    else:
      descriptor_type = "NoOpDescriptor"
  else:
    descriptor_type = "NoOpDescriptor"

  return descriptor_type


def _DataTypeToKotlinAutomationConversionType(
    data_type: Union[
        BasicInteger,
        BasicString,
        IdlBitmapType,
        FundamentalType,
        IdlEnumType,
        IdlType,
    ],
) -> str:
  """Return the kotlin type for the given parser AST data type.

  Notably, if a type is a "named" bitmap or enum (say enum8 NamedEnum), this
  will return "NamedEnum". If, however, the type is "enum8", this will return
  "UByte"

  Args:
    data_type: the type to convert

  Raises:
    CodeGenerationError: if no type is found.
  """

  if isinstance(data_type, BasicInteger):
    if data_type.is_signed:
      if data_type.byte_count <= 1:
        return "Byte"
      if data_type.byte_count <= 2:
        return "Short"
      if data_type.byte_count <= 4:
        return "Int"
      return "Long"
    else:  # unsigned
      if data_type.byte_count <= 1:
        return "UByte"
      if data_type.byte_count <= 2:
        return "UShort"
      if data_type.byte_count <= 4:
        return "UInt"
      return "ULong"

  if isinstance(data_type, BasicString):
    if data_type.is_binary:
      return "ByteArray"

    return "String"

  if data_type == FundamentalType.BOOL:
    return "Boolean"

  if data_type == FundamentalType.FLOAT:
    return "Float"

  if data_type == FundamentalType.DOUBLE:
    return "Double"

  if isinstance(data_type, IdlEnumType):
    if data_type.idl_name in ("enum8", "enum16", "enum32", "enum64"):
      return _DataTypeToKotlinType(data_type.base_type)
    else:
      return data_type.idl_name

  if isinstance(data_type, IdlBitmapType):
    if data_type.idl_name in ("bitmap8", "bitmap16", "bitmap32", "bitmap64"):
      return _DataTypeToKotlinType(data_type.base_type)
    else:
      return data_type.idl_name

  if isinstance(data_type, IdlType):
    return data_type.idl_name

  # Above should have handled all cases
  raise CodeGenerationError("Unsupported data type: %r" % data_type)


def _CreateCommandInputArgumentFilter(type_lookup: TypeLookupContext):
  """Create a filter that fetches the input structure of a command.

  Structure will be fetched using the provided type lookup (i.e.
  commands MUST be tied to the type lookup cluster for this to work).

  Args:
    type_lookup: the lookup to use

  Returns:
    a filter suitable to use in jinja templates
  """

  def InternalFilter(command: Command) -> Optional[Struct]:
    if command.input_param is None:
      return None

    result = type_lookup.find_struct(command.input_param)

    if result is None:
      raise ValueError("Could not find input param for %r" % command)

    return result

  return InternalFilter


def _CreateCommandOutputArgumentFilter(type_lookup: TypeLookupContext):
  """Create a filter that fetches the output structure of a command.

  Structure will be fetched using the provided type lookup (i.e.
  commands MUST be tied to the type lookup cluster for this to work).

  Args:
    type_lookup: the lookup to use

  Returns:
    a filter suitable to use in jinja templates
  """

  def InternalFilter(command: Command) -> Optional[Struct]:
    if command.output_param == "DefaultSuccess":
      return None

    result = type_lookup.find_struct(command.output_param)

    if result is None:
      raise ValueError("Could not find output param for %r" % command)

    return result

  return InternalFilter


def _CreateParseDataTypeFilter(type_lookup: TypeLookupContext):
  """Creates a filter that parses data types given a lookup context.

  Args:
    type_lookup: the lookup to use

  Returns:
    a filter suitable to use in jinja templates
  """

  def InternalFilter(
      data_type: DataType,
  ) -> Union[
      BasicInteger,
      BasicString,
      FundamentalType,
      IdlType,
      IdlEnumType,
      IdlBitmapType,
  ]:
    return ParseDataType(data_type, type_lookup)

  return InternalFilter


def _CreateSerializerReadFieldFilter(type_lookup: TypeLookupContext):
  """Wraps SerializerReadField.

  Args:
    type_lookup: the lookup to use

  Returns:
    a filter suitable to use in jinja templates
  """

  def InternalFilter(field: Field):
    return SerializerReadField(type_lookup, field)

  return InternalFilter


def _CreateSerializerReadNullableFieldFilter(type_lookup: TypeLookupContext):
  """Wraps SerializerReadField.

  Args:
    type_lookup: the lookup to use

  Returns:
    a filter suitable to use in jinja templates for an optional field
  """

  def InternalFilter(field: Field):
    return SerializerReadField(type_lookup, field, override_optional=True)

  return InternalFilter


def _CreateSerializerReadNullableFieldAttributeFilter(
    type_lookup: TypeLookupContext,
):
  """Wraps SerializerReadField.

  Args:
    type_lookup: the lookup to use

  Returns:
    a filter suitable to use in jinja templates for reading struct fields
  """

  def InternalFilter(field: Field):
    return SerializerReadField(
        type_lookup, field, override_optional=True, is_attribute=True
    )

  return InternalFilter


def _CreateSerializerWriteFieldFilter(type_lookup: TypeLookupContext):
  """Wraps SerializerWriteField.

  Args:
    type_lookup: the lookup to use

  Returns:
    a filter suitable to use in jinja templates for writing struct fields
  """

  def InternalFilter(field: Field):
    return SerializerWriteField(type_lookup, field, False)

  return InternalFilter


def _CreateSerializerWriteMutableFieldFilter(type_lookup: TypeLookupContext):
  """Wraps SerializerWriteMutableField.

  Args:
    type_lookup: the lookup to use

  Returns:
    a filter suitable to use in jinja templates for writing mutable attributes
  """

  def InternalFilter(field: Field):
    return SerializerWriteField(type_lookup, field, True)

  return InternalFilter


def _CreateSerializerWriteAttributeFieldFilter(type_lookup: TypeLookupContext):
  """Wraps SerializerWriteAttributeField.

  Args:
    type_lookup: the lookup to use

  Returns:
    a filter suitable to use in jinja templates for writing non-mutable
    attributes
  """

  def InternalFilter(field: Field):
    return SerializerWriteField(
        type_lookup, field, is_mutable=False, is_attribute=True
    )

  return InternalFilter


def _CreateSerializerEqualsFieldFilter(type_lookup: TypeLookupContext):
  """Wraps SerializerEqualsField.

  Args:
    type_lookup: the lookup to use

  Returns:
    a filter suitable to use in jinja templates
  """

  def InternalFilter(field: Field):
    return SerializerEqualsField(type_lookup, field)

  return InternalFilter


def _CreateSerializerEqualsAttributeFieldFilter(type_lookup: TypeLookupContext):
  """Wraps SerializerEqualsField.

  Args:
    type_lookup: the lookup to use

  Returns:
    a filter suitable to use in jinja templates
  """

  def InternalFilter(field: Field):
    return SerializerEqualsField(type_lookup, field, override_optional=True)

  return InternalFilter


def _CreateSerializerHashcodeFieldFilter(type_lookup: TypeLookupContext):
  """Wraps SerializerHashcodeField.

  Args:
    type_lookup: the lookup to use

  Returns:
    a filter suitable to use in jinja templates
  """

  def InternalFilter(field: Field):
    return SerializerHashcodeField(type_lookup, field)

  return InternalFilter


def _CreateSerializerHashcodeAttributeFieldFilter(
    type_lookup: TypeLookupContext,
):
  """Wraps SerializerHashcodeField.

  Args:
    type_lookup: the lookup to use

  Returns:
    a filter suitable to use in jinja templates
  """

  def InternalFilter(field: Field):
    return SerializerHashcodeField(type_lookup, field, override_optional=True)

  return InternalFilter


def _CreateDefaultValueForFieldFilter(type_lookup: TypeLookupContext):
  """Creates a filter that transforms a data type into an initializer default.

  Args:
    type_lookup: the lookup to use

  Returns:
    a filter suitable to use in jinja templates
  """

  def InternalFilter(field: Field):
    return DefaultFieldValue(type_lookup, field)

  return InternalFilter


def _CreateDefaultValueForOptionalArgFieldFilter(
    type_lookup: TypeLookupContext,
):
  """Creates a filter that transforms a data type into an initializer default.

  Ignores the optional modifier.

  Args:
    type_lookup: the lookup to use

  Returns:
    a filter suitable to use in jinja templates for optional command args
  """

  def InternalFilter(field: Field):
    return DefaultFieldValue(type_lookup, field, True)

  return InternalFilter


def DefaultFieldValue(
    type_lookup: TypeLookupContext, field: Field, ignore_optional: bool = False
) -> str:
  """Returns an appropriate initializer default.

  Args:
    type_lookup: the lookup to use
    field: the field to be defaulted
    ignore_optional: if the optional modifier should be ignored

  Raises:
    CodeGenerationError: if the type of the value is not valid or available.
  Returns:
    a string representing the type default
  """

  if field.is_optional and not ignore_optional:
    return "OptionalValue.absent()"

  if field.is_nullable:
    return "null"

  if field.is_list:
    return "emptyList()"

  data_type = ParseDataType(field.data_type, type_lookup)

  if IsPrimitiveType(data_type):
    # enum8/enum16/enum32 and such.
    return "0u"

  if isinstance(data_type, IdlBitmapType):
    return f"{ToUpperCamelCase(data_type.idl_name)}()"

  if isinstance(data_type, IdlType):  # structs
    return f"{ToUpperCamelCase(data_type.idl_name)}()"

  if isinstance(data_type, IdlEnumType):
    enum_value = type_lookup.find_enum(data_type.idl_name)

    if not enum_value:
      raise CodeGenerationError(f"Failed to find enum {data_type.idl_name}")

    entry = enum_value.entries[0]
    return (
        f"{ToUpperCamelCase(data_type.idl_name)}.{ToConstFieldName(entry.name)}"
    )

  kotlin_type = _DataTypeToKotlinType(data_type)

  if kotlin_type in {"Byte", "Short", "Int", "Long"}:
    return "0"

  if kotlin_type == "Float":
    return "0.0f"

  if kotlin_type == "Double":
    return "0.0"

  if kotlin_type in {"UByte", "UShort", "UInt", "ULong"}:
    return "0u"

  if kotlin_type == "String":
    return '""'

  if kotlin_type == "ByteArray":
    return "ByteArray(0)"

  if kotlin_type == "Boolean":
    return "false"

  raise CodeGenerationError("Unable to determine default value for %r" % field)


def IsPrimitiveType(
    data_type: Union[
        BasicInteger,
        BasicString,
        FundamentalType,
        IdlBitmapType,
        IdlEnumType,
        IdlType,
    ],
) -> bool:
  """Returns whether the given type is a partially defined complex type and should in fact be processed as a primitive type."""
  return data_type.idl_name.lower() in {
      "enum8",
      "enum16",
      "enum32",
      "enum64",
      "bitmap8",
      "bitmap16",
      "bitmap32",
      "bitmap64",
  }


def IsGlobal(field: Field) -> bool:
  """Returns whether the given field is a global attribute.

  https://spang.users.x20web.corp.google.com/www/connectedhomeip-spec/index.html#ref_MeiDataModelTypes

  Args:
    field: the field to check the tag of for the global range
  """
  return field.code >= 0xF000 and field.code <= 0xFFFE


def _IsSemanticTag(cluster: Cluster, struct: Struct) -> bool:
  """Checks that the struct is the descriptor cluster's SemanticTagStruct, which overrides the Tag protocol."""
  return cluster.code == 29 and struct.name == "SemanticTagStruct"


def _KotlinTypeBeforeOptionalNullable(
    data_type: Union[
        BasicInteger,
        BasicString,
        FundamentalType,
        IdlType,
        IdlEnumType,
        IdlBitmapType,
    ],
    field: Field,
) -> str:
  """Return the Kotlin type for the given field.

  Type is returned before applying optional and nullable modifiers.

  Args:
    data_type: the underlying field data type
    field: the field, field.data_type MUST match data type. Used for field
      modifiers such as optional and nullable

  Returns:
    The data type before optional/nullable.
  """
  inner_type = _DataTypeToKotlinType(data_type)  # assume this type for now

  if IsPrimitiveType(data_type):
    # just a default integer generally
    # this is for bitmap32 or enum8 or similar
    pass
  elif (
      isinstance(data_type, IdlEnumType)
      or isinstance(data_type, IdlBitmapType)
      or isinstance(data_type, IdlType)  # this is for structures
  ):
    if field.is_list:
      inner_type = f"List<{ToUpperCamelCase(data_type.idl_name)}>"
    else:
      inner_type = f"{ToUpperCamelCase(data_type.idl_name)}"
  elif field.is_list:
    inner_type = f"List<{inner_type}>"
  return inner_type


def ToKotlinFieldType(
    data_type: Union[
        BasicInteger,
        BasicString,
        FundamentalType,
        IdlType,
        IdlEnumType,
        IdlBitmapType,
    ],
    field: Field,
) -> str:
  """Return the full Kotlin type for the given field.

  Args:
    data_type: the underlying field data type
    field: the field, field.data_type MUST match data type. Used for field
      modifiers such as optional and nullable

  Returns:
    The data type to use.
  """
  inner_type = _KotlinTypeBeforeOptionalNullable(data_type, field)

  if field.is_nullable:
    inner_type += "?"

  if field.is_optional:
    inner_type = "OptionalValue<" + inner_type + ">"

  return inner_type


def ToKotlinFieldTypeForCommands(
    data_type: Union[
        BasicInteger,
        BasicString,
        FundamentalType,
        IdlType,
        IdlEnumType,
        IdlBitmapType,
    ],
    field: Field,
) -> str:
  """Return the command type for a given field.

  If field is optional not nullable returns a nullable value defaulted to null.

  Args:
    data_type: the underlying field data type
    field: the field, field.data_type MUST match data type. Used for field
      modifiers such as optional and nullable

  Returns:
    The data type to use for non optional params, a nullable type for optionals.
  """
  if not field.is_optional:
    return ToKotlinFieldType(data_type, field)

  inner_type = _KotlinTypeBeforeOptionalNullable(data_type, field)

  if field.is_nullable:
    return f"{inner_type}?"

  return inner_type


def ToOptionalValueForCommandRequest(
    field: Field,
) -> str:
  """Returns the field name for the command request constructor.

  If the field is optional not nullable returns the appropriate conversion to an
  optional value.

  Args:
    field: the field used for the command request

  Returns: the Kotlin syntax for the command request parameter
  """
  if not field.is_optional or field.is_nullable:
    return ToLowerCamelCase(field.name)
  return (
      f"if ({ToLowerCamelCase(field.name)} == null) OptionalValue.absent() else"
      f" OptionalValue.present({ToLowerCamelCase(field.name)})"
  )


def ToKotlinFieldTypeForMutableAttributes(
    data_type: Union[
        BasicInteger,
        BasicString,
        FundamentalType,
        IdlType,
        IdlEnumType,
        IdlBitmapType,
    ],
    field: Field,
) -> str:
  """Return the full Kotlin type for the given field.

  Args:
    data_type: the underlying field data type
    field: the field, field.data_type MUST match data type. Used for field
      modifiers such as optional and nullable

  Returns:
    The data type to use.
  """
  inner_type = _KotlinTypeBeforeOptionalNullable(data_type, field)

  if field.is_nullable:
    inner_type += "?"

  return inner_type


def _DataTypeToKotlinTypeEnum(
    data_type: Union[
        BasicInteger,
        BasicString,
        IdlBitmapType,
        FundamentalType,
        IdlEnumType,
        IdlType,
    ],
) -> str:
  """Return the Type enum value for the given field.

  Notably, if a type is a "named" bitmap or enum (say enum8 NamedEnum), this
  will return "Enum". If, however, the type is "enum8", this will return
  "UByte"

  Args:
    data_type: the type to convert

  Raises:
    CodeGenerationError: if no Type enum is found.
  """
  if isinstance(data_type, BasicInteger):
    if data_type.is_signed:
      if data_type.byte_count <= 1:
        return "Byte"
      if data_type.byte_count <= 2:
        return "Short"
      if data_type.byte_count <= 4:
        return "Int"
      return "Long"
    else:  # unsigned
      if data_type.byte_count <= 1:
        return "UByte"
      if data_type.byte_count <= 2:
        return "UShort"
      if data_type.byte_count <= 4:
        return "UInt"
      return "ULong"

  if isinstance(data_type, BasicString):
    if data_type.is_binary:
      return "ByteArray"

    return "String"

  if data_type == FundamentalType.BOOL:
    return "Boolean"

  if data_type == FundamentalType.FLOAT:
    return "Float"

  if data_type == FundamentalType.DOUBLE:
    return "Double"

  if isinstance(data_type, IdlEnumType):
    if data_type.idl_name in ("enum8", "enum16", "enum32", "enum64"):
      return _DataTypeToKotlinType(data_type.base_type)
    else:
      return "Enum"

  if isinstance(data_type, IdlBitmapType):
    if data_type.idl_name in ("bitmap8", "bitmap16", "bitmap32", "bitmap64"):
      return _DataTypeToKotlinType(data_type.base_type)
    else:
      return "Bitmap"

  if isinstance(data_type, IdlType):
    return "Struct"

  # Above should have handled all cases
  raise CodeGenerationError("Unsupported data type: %r" % data_type)


def ToKotlinFieldTypeForAttributes(
    data_type: Union[
        BasicInteger,
        BasicString,
        FundamentalType,
        IdlType,
        IdlEnumType,
        IdlBitmapType,
    ],
    field: Field,
) -> str:
  """Return the full Kotlin type for the given field.

  Args:
    data_type: the underlying field data type
    field: the field, field.data_type MUST match data type. Used for field
      modifiers such as optional and nullable

  Returns:
    The data type to use.
  """
  inner_type = _KotlinTypeBeforeOptionalNullable(data_type, field)

  if not IsGlobal(field):
    inner_type += "?"

  return inner_type


def ToLowerCamelCase(text: str) -> str:
  """Converts the given string to standard Kotlin lower camel case.

  Args:
    text: The text which is to be converted to camel case.

  Returns:
    Input text converted to Kotlin specific camel case.
  """

  # Replace known terms that don't conform to the general regex patterns below.
  # 1. `BLE` with `Ble`. This is primarily to work around the `BLEUWB`
  # acronym present in the DoorLock cluster.
  # 2. `IDs` with `Ids`.
  replace_terms = {
      "BLE": "Ble",
      "IDs": "Ids",
  }

  # If text is all uppercase, return the lower case version
  if text.isupper():
    return text.lower()
  # Replace known terms from the above map.
  for old, new in replace_terms.items():
    text = text.replace(old, new)
  # Replace `IPv4` and `IPv6` with `Ipv4` and `Ipv6` respectively.
  text = re.sub(r"(?i)(ipv(4|6))", lambda x: x.group(1).title(), text)
  # Replace single term, capitalized case with lower case.
  # ex: "Abcdef" to "abcdef"
  text = re.sub(r"^([A-Z][a-z]+)", lambda x: x.group(1).lower(), text)
  # Replace capitalized terms at the beginning of the string with lower case.
  # ex: "ABCDef" to "abcDef"
  # ex: "AbcDef" to "abcDef"
  text = re.sub(
      r"^([A-Z]+[0-9]*|[A-Z]+[a-z]+?)([A-Z][a-z])",
      lambda x: x.group(1).lower() + x.group(2),
      text,
  )
  # Replace capitalized terms in the middle of the string with title case.
  # ex: "abcDEFgh" to "abcDeFgh"
  text = re.sub(
      r"([A-Z]+[0-9]*)([A-Z][a-z])",
      lambda x: x.group(1).title() + x.group(2),
      text,
  )
  # Replace capitalized terms at the end of the string with title case.
  # ex: "abcDEF" to "abcDef"
  text = re.sub(r"([A-Z]+)\b", lambda x: x.group(1).title(), text)
  return text


def ToUpperCamelCase(text: str) -> str:
  """Converts the given string to standard Kotlin upper camel case.

  Args:
    text: The text which is to be converted to camel case.

  Returns:
    Input text converted to Kotlin specific camel case.
  """
  text = ToLowerCamelCase(text)
  return text[0].capitalize() + text[1:]


def IsCommandStruct(struct: Struct) -> bool:
  return struct.tag is not None


def SerializerWriteField(
    type_lookup: TypeLookupContext,
    field: Field,
    is_mutable: bool = False,
    is_attribute: bool = False,
) -> str:
  """Generates the code to encode a field."""
  zap_type = field.data_type.name
  data_type = ParseDataType(field.data_type, type_lookup)
  codec_type = _DataTypeToKotlinType(data_type).lower()
  if not IsPrimitiveType(data_type):
    if type_lookup.is_struct_type(zap_type):
      codec_type = f"struct({ToUpperCamelCase(zap_type)}.Adapter)"
    elif type_lookup.is_enum_type(zap_type):
      codec_type = f"enum({ToUpperCamelCase(zap_type)}.Adapter)"
    elif type_lookup.is_bitmap_type(zap_type):
      codec_type = f"bitmap({ToUpperCamelCase(zap_type)}.Adapter)"

  codec_op = "write"
  if field.is_list:
    codec_op += "List"
  if IsGlobal(field):
    return (
        f"writer.{codec_type}.{codec_op}({field.code}u,"
        f" value.{ToLowerCamelCase(field.name)})"
    )
  if is_mutable:
    return f"""
        if (!writer.strictOperationValidation || value.attributeList.contains({field.code}u)) {{
          writer.{codec_type}.{codec_op}({field.code}u, value._{ToLowerCamelCase(field.name)})
        }} else {{
          throw HomeException.invalidArgument("{ToLowerCamelCase(field.name)}")
        }}""".strip()
  if is_attribute:
    return f"""
        if (!writer.strictOperationValidation || value.attributeList.contains({field.code}u)) {{
          writer.{codec_type}.{codec_op}({field.code}u, value.{ToLowerCamelCase(field.name)})
        }}""".strip()

  return (
      f"writer.{codec_type}.{codec_op}({field.code}u,"
      f" value.{ToLowerCamelCase(field.name)})"
  )


def SerializerReadField(
    type_lookup: TypeLookupContext,
    field: Field,
    override_optional: bool = False,
    is_attribute: bool = False,
) -> str:
  """Generates the code to decode a field.

  Args:
    type_lookup: the lookup to use
    field: the field to be read
    override_optional: flag to override the field to being optional nullable
    is_attribute: flag to add attribute-specific calls to populate attributeList

  Returns:
    Kotlin code for reading a field
  """
  zap_type = field.data_type.name
  data_type = ParseDataType(field.data_type, type_lookup)
  codec_type = _DataTypeToKotlinType(data_type).lower()
  if not IsPrimitiveType(data_type):
    if type_lookup.is_struct_type(zap_type):
      codec_type = f"struct {{ {ToUpperCamelCase(zap_type)}() }}"
    elif type_lookup.is_enum_type(zap_type):
      codec_type = f"enum({ToUpperCamelCase(zap_type)}.Adapter)"
    elif type_lookup.is_bitmap_type(zap_type):
      codec_type = f"bitmap({ToUpperCamelCase(zap_type)}.Adapter)"

  if is_attribute and field.name == "attributeList":
    return f"attributeList.also {{ attributeList.add({field.code}u) }}"
  codec_op = "get"
  # If this is an attribute, don't override global attributes.
  # Otherwise always override to optional nullable.
  is_attribute_non_global = is_attribute and not IsGlobal(field)
  if override_optional and (is_attribute_non_global or not is_attribute):
    codec_op += "OptionalNullable"
  else:
    if field.is_optional:
      codec_op += "Optional"
    if field.is_nullable:
      codec_op += "Nullable"
  if field.is_list:
    codec_op += "List"

  field_name = upfirst(ToLowerCamelCase(field.name))

  result = f'data.{codec_type}.{codec_op}({field.code}u, "{field_name}")'

  if not override_optional:
    return result
  if not is_attribute:
    return f"{result}.getOrNull()"
  if IsGlobal(field):
    return f"{result}.also{{ attributeList.add({field.code}u)}}"
  if field.is_nullable:
    return (
        f"{result}.also{{ if (it.isPresent) attributeList.add({field.code}u)"
        " }.getOrNull()"
    )
  return (
      f"{result}.also{{ if (it.isPresent && it.value != null)"
      f" attributeList.add({field.code}u) }}.getOrNull()"
  )


def SerializerEqualsField(
    type_lookup: TypeLookupContext,
    field: Field,
    override_optional: bool = False,
) -> str:
  """Generates code to check equality of a field."""

  is_different = (
      f"{ToLowerCamelCase(field.name)} != other.{ToLowerCamelCase(field.name)}"
  )
  data_type = ParseDataType(field.data_type, type_lookup)

  if override_optional and not IsGlobal(field):
    if _DataTypeToKotlinType(data_type) == "ByteArray":
      if field.is_list:
        is_different = (
            f"!({ToLowerCamelCase(field.name)}?.toTypedArray()"
            " contentDeepEquals"
            f" other.{ToLowerCamelCase(field.name)}?.toTypedArray())"
        )
      else:
        is_different = (
            f"!({ToLowerCamelCase(field.name)} contentEquals"
            f" other.{ToLowerCamelCase(field.name)})"
        )
    return f"if ({is_different}) {{ return false; }}"

  if not field.is_optional:
    if _DataTypeToKotlinType(data_type) == "ByteArray":
      if field.is_list:
        if field.is_nullable:
          is_different = (
              f"!({ToLowerCamelCase(field.name)}?.toTypedArray()"
              " contentDeepEquals"
              f" other.{ToLowerCamelCase(field.name)}?.toTypedArray())"
          )
        else:
          is_different = (
              f"!({ToLowerCamelCase(field.name)}.toTypedArray()"
              " contentDeepEquals"
              f" other.{ToLowerCamelCase(field.name)}.toTypedArray())"
          )
      else:
        is_different = (
            f"!({ToLowerCamelCase(field.name)} contentEquals"
            f" other.{ToLowerCamelCase(field.name)})"
        )

  return f"if ({is_different}) {{ return false; }}"


def SerializerHashcodeField(
    type_lookup: TypeLookupContext,
    field: Field,
    override_optional: bool = False,
) -> str:
  """Generates code to check equality of a field.

  Generally uses `hashCode` except for non-optional ByteArrays, where
  contentHashCode is used.

  Args:
    type_lookup: Context to find data types to identify ByteArray and similar
    field: Field to generate the serialize `hashCode` code for
    override_optional: For attributes on a trait we force them to be optional
      go/ghp-non-compliant-device

  Returns:
    A string of the form `result = 31 * result + field.hashCode()`
  """
  name = ToLowerCamelCase(field.name)
  hash_function = "hashCode()"
  data_type = ParseDataType(field.data_type, type_lookup)

  if not field.is_optional or override_optional:
    if _DataTypeToKotlinType(data_type) == "ByteArray":
      if not field.is_list:
        hash_function = "contentHashCode()"
      elif field.is_nullable:
        hash_function = "toTypedArray()?.contentDeepHashCode()"
      else:
        hash_function = "toTypedArray().contentDeepHashCode()"

  if (override_optional and not IsGlobal(field)) or (
      not field.is_optional and field.is_nullable
  ):
    hash_code = f"({name}?.{hash_function} ?: 0)"
  else:
    hash_code = f"{name}.{hash_function}"

  return f"result = 31 * result + {hash_code}"


def EscapeKtKeyword(word: str) -> str:
  reserved_for_field_enum = ["name", "tag"]
  if word in reserved_for_field_enum:
    return word.capitalize()

  reserved_keywords = ["data", "value"]
  if word in reserved_keywords:
    return "`" + word + "`"

  return word


def _CreateIsStructFieldTest(
    type_lookup: TypeLookupContext,
):
  """Creates a filter that returns true if and only if a given field is a struct."""

  def InternalTest(field: Field):
    return type_lookup.is_struct_type(field.data_type.name)

  return InternalTest


def _HasKnownConversionToAdm(
    data_type: DataType,
    type_lookup: TypeLookupContext,
) -> bool:
  """Returns whether the given type has a known conversion to the Automation Data Model (ADM)."""

  # The details of this will change as more is supported.
  field_type = ParseDataType(data_type, type_lookup)
  return (
      isinstance(field_type, FundamentalType)
      or isinstance(field_type, IdlEnumType)
      or isinstance(field_type, IdlBitmapType)
      or isinstance(field_type, BasicString)
      or isinstance(field_type, BasicInteger)
      or field_type.is_struct
  )


def _TypeIsConvertibleToAdm(
    field: Field,
    type_lookup: TypeLookupContext,
) -> bool:
  """Returns whether the struct type's fields are all convertible to ADM."""
  return _HasKnownConversionToAdm(field.data_type, type_lookup)


def _CreateIsStructConvertibleToAdmTest(
    type_lookup: TypeLookupContext,
):
  """Creates a filter that returns true if and only if the request struct of a Command takes only privitives that are not nullable nor optional."""

  def InternalTest(struct: Optional[Struct]) -> bool:
    if struct is None:
      return True

    return all(
        map(
            _TypeIsConvertibleToAdm,
            struct.fields,
            # Make iterable of type_lookup to match length of struct.fields
            # to satisfy map()
            [type_lookup] * len(struct.fields),
        )
    )

  return InternalTest


def _CreateIsFieldConvertibleToAdmTest(
    type_lookup: TypeLookupContext,
):
  """Returns true if and only if the given field has known conversion to ADM."""

  def InternalTest(field: Field) -> bool:
    return _HasKnownConversionToAdm(field.data_type, type_lookup)

  return InternalTest


class CustomGenerator(CodeGenerator):
  """Example of a custom generator.

  Outputs protobuf representation of Matter clusters.
  """

  def __init__(self, storage: GeneratorStorage, idl: Idl, **kargs):
    """Inintialization is specific for java generation and will add filters as required by the java .jinja templates to function."""
    super().__init__(storage, PostProcessIdl(idl))

    if "package" not in kargs:
      # A friendlier message than if we make this a required argument
      logging.error(
          "Missing `package` argument. If using codegen.py, please"
          " provide one via `--option package:...`."
      )
      sys.exit(1)
    if "file_comment" in kargs:
      self.file_comment = kargs["file_comment"]
    else:
      self.file_comment = "This file contains machine-generated code."

    self.package_name = kargs["package"]

    if not self.package_name or self.package_name.endswith("."):
      raise ValueError("Package name %r is not valid." % self.package_name)

    if "docs" in kargs:
      self.docs = kargs["docs"]
    else:
      yaml_data = "docs/clusters.yaml"
      with open(yaml_data) as y:
        self.docs = yaml.safe_load(y)

    # Override the template path to use local templates within this plugin
    # directory.
    old_env = self.jinja_env
    self.jinja_env = jinja2.Environment(
        loader=jinja2.FileSystemLoader(searchpath=os.path.dirname(__file__)),
        keep_trailing_newline=True,
    )
    for key, func in old_env.filters.items():
      self.jinja_env.filters[key] = func

    for key, func in old_env.tests.items():
      self.jinja_env.tests[key] = func

    # Type helpers
    self.jinja_env.filters["boolAsStr"] = BoolAsStr
    self.jinja_env.filters["IsNullable"] = IsNullable
    self.jinja_env.filters["IsOptional"] = IsOptional
    self.jinja_env.filters["ToConstFieldName"] = ToConstFieldName
    self.jinja_env.filters["ToLowerCamelCase"] = ToLowerCamelCase
    self.jinja_env.filters["ToUpperCamelCase"] = ToUpperCamelCase
    self.jinja_env.filters["ToKotlinFieldType"] = ToKotlinFieldType
    self.jinja_env.filters["ToKotlinFieldTypeBeforeOptionalNullable"] = (
        _KotlinTypeBeforeOptionalNullable
    )
    self.jinja_env.filters["ToOptionalValueForCommandRequest"] = (
        ToOptionalValueForCommandRequest
    )
    self.jinja_env.filters["ToKotlinFieldTypeForCommands"] = (
        ToKotlinFieldTypeForCommands
    )
    self.jinja_env.filters["ToKotlinFieldTypeForAttributes"] = (
        ToKotlinFieldTypeForAttributes
    )
    self.jinja_env.filters["ToKotlinFieldTypeForMutableAttributes"] = (
        ToKotlinFieldTypeForMutableAttributes
    )
    self.jinja_env.filters["checkVariablesDiffer"] = _AreVariablesDifferent
    self.jinja_env.filters["hasWritableAttributes"] = _HasWritableAttributes
    self.jinja_env.filters["hasTimedAttributes"] = _HasTimedAttributes
    self.jinja_env.filters["hasResponse"] = _CommandHasResponse

    self.jinja_env.filters["dataTypeToKotlinType"] = _DataTypeToKotlinType
    self.jinja_env.filters["dataTypeToKotlinAutomationConversionType"] = (
        _DataTypeToKotlinAutomationConversionType
    )

    self.jinja_env.filters["dataTypeToDescriptorType"] = (
        _DataTypeToDescriptorType
    )

    self.jinja_env.filters["dataTypeToKotlinTypeEnum"] = (
        _DataTypeToKotlinTypeEnum
    )
    self.jinja_env.filters["camelcase"] = stringcase.camelcase
    self.jinja_env.filters["snakecase"] = stringcase.snakecase

    self.jinja_env.tests["isCommandStruct"] = IsCommandStruct  # pyrefly: ignore[unsupported-operation]

    # Documentation filters
    self.jinja_env.filters["attributeDocType"] = common.AttributeDocType
    self.jinja_env.filters["outputAttributeComment"] = (
        common.OutputAttributeComment
    )
    self.jinja_env.filters["showClusterInDocs"] = common.ShowClusterInDocs
    self.jinja_env.filters["EscapeKtKeyword"] = EscapeKtKeyword
    self.jinja_env.globals["IsSemanticTag"] = _IsSemanticTag  # pyrefly: ignore[unsupported-operation]
    self.jinja_env.globals["is_internal"] = self.is_internal()  # pyrefly: ignore[unsupported-operation]

  def internal_render_all(self):
    """Renders the given custom template to the given output filename."""

    # The proto template generates one trait file per cluster.
    for cluster in self.idl.clusters:
      # context-sensitive filter (i.e. the ones that do
      # type lookups)
      type_lookup = TypeLookupContext(self.idl, cluster)
      self.jinja_env.filters["commandInputStruct"] = (
          _CreateCommandInputArgumentFilter(type_lookup)
      )
      self.jinja_env.filters["commandOutputStruct"] = (
          _CreateCommandOutputArgumentFilter(type_lookup)
      )
      self.jinja_env.filters["lookupDataType"] = _CreateParseDataTypeFilter(
          type_lookup
      )
      self.jinja_env.filters["SerializerReadField"] = (
          _CreateSerializerReadFieldFilter(type_lookup)
      )
      self.jinja_env.filters["SerializerReadNullableField"] = (
          _CreateSerializerReadNullableFieldFilter(type_lookup)
      )
      self.jinja_env.filters["SerializerReadNullableAttributeField"] = (
          _CreateSerializerReadNullableFieldAttributeFilter(type_lookup)
      )
      self.jinja_env.filters["SerializerWriteField"] = (
          _CreateSerializerWriteFieldFilter(type_lookup)
      )
      self.jinja_env.filters["SerializerWriteAttributeField"] = (
          _CreateSerializerWriteAttributeFieldFilter(type_lookup)
      )
      self.jinja_env.filters["SerializerWriteMutableField"] = (
          _CreateSerializerWriteMutableFieldFilter(type_lookup)
      )
      self.jinja_env.filters["SerializerEqualsField"] = (
          _CreateSerializerEqualsFieldFilter(type_lookup)
      )
      self.jinja_env.filters["SerializerEqualsAttributeField"] = (
          _CreateSerializerEqualsAttributeFieldFilter(type_lookup)
      )
      self.jinja_env.filters["SerializerHashcodeField"] = (
          _CreateSerializerHashcodeFieldFilter(type_lookup)
      )
      self.jinja_env.filters["SerializerHashcodeAttributeField"] = (
          _CreateSerializerHashcodeAttributeFieldFilter(type_lookup)
      )
      self.jinja_env.filters["DefaultValueForField"] = (
          _CreateDefaultValueForFieldFilter(type_lookup)
      )
      self.jinja_env.filters["DefaultValueForOptionalArgField"] = (
          _CreateDefaultValueForOptionalArgFieldFilter(type_lookup)
      )
      self.jinja_env.tests["IsStructField"] = _CreateIsStructFieldTest(
          type_lookup
      )
      self.jinja_env.tests["IsStructConvertibleToAdm"] = (
          _CreateIsStructConvertibleToAdmTest(type_lookup)
      )
      self.jinja_env.tests["IsFieldConvertibleToAdm"] = (
          _CreateIsFieldConvertibleToAdmTest(type_lookup)
      )

      # filter docs to this cluster
      cluster_docs = self.docs.get(cluster.name)

      # Header containing a macro to initialize all cluster plugins
      self.internal_render_one_output(
          template_path="ClusterSerialization.kt.jinja",
          output_file_name=f"{ToUpperCamelCase(cluster.name)}Trait.kt",
          template_vars={
              "typeLookup": TypeLookupContext(self.idl, cluster),
              "cluster": cluster,
              "docs": cluster_docs,
              "package": self.package_name,
              "file_comment": self.file_comment,
          },
      )

      self.internal_render_one_output(
          template_path="Cluster.kt.jinja",
          output_file_name=f"{ToUpperCamelCase(cluster.name)}.kt",
          template_vars={
              "typeLookup": TypeLookupContext(self.idl, cluster),
              "cluster": cluster,
              "docs": cluster_docs,
              "package": self.package_name,
              "file_comment": self.file_comment,
          },
      )

  def is_internal(self) -> bool:
    try:
      import google3  # pylint: disable=g-import-not-at-top,unused-import

      return True
    except ImportError:
      return False
