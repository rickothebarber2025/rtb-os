"""Plugin module to matter_idl for auto-generation of C++ files.

This module provides a plugin to the matter_idl tool from the Matter SDK
(https://github.com/project-chip/connectedhomeip/tree/master/scripts/py_matter_idl)
to assist generating C++ device definitions
"""

import collections
import functools
import logging
import os
import re
import sys
import textwrap
from typing import Any, Optional, Sequence, Union, cast

import common
from common import casing
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
from matter.idl.matter_idl_types import ApiMaturity
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


def ToHex(value: int, width: Optional[int] = None) -> str:
  """Converts an integer to a hex string with the given width."""
  if not width:
    format_string = "{:x}"
  elif width == 16:
    value = value & 0xFFFF
    format_string = "{:04x}"
  elif width == 32:
    value = value & 0xFFFFFFFF
    format_string = "{:08x}"
  else:
    raise ValueError("Unsupported width")

  return format_string.format(value)


def ToVendorId(value: int) -> int:
  return value >> 16


def ToMeiSuffix(value: int) -> int:
  return value & 0xFFFF


def ToTraitId(cluster: Cluster) -> str:
  """Returns the GHP TraitId for the given cluster."""
  vid_hex = ToHex(ToVendorId(cluster.code), 16)
  cluster_hex = ToHex(cluster.code, 16)
  return f"home.matter.{vid_hex}.clusters.{cluster_hex}"


def ToFieldArgs(fields: list[Field]) -> str:
  """Lists the given fields as args list, e.g. arg1,arg2,arg3,..."""
  return ",".join(casing.ToLowerSnakeCase(field.name) for field in fields)


def ToFieldKeywordArgs(fields: list[Field]) -> str:
  """Formats the given list of fields as a named keyword args list.

  To use with attributes list, use:
  `cluster.attributes `| map(attribute="definition")`

  Args:
    fields: List of Fields to convert to keyword args.

  Returns:
    The keyword args list, e.g. "arg1=arg1,arg2=arg2,arg3=arg3,..."
  """
  keyword_args = []
  for field in fields:
    field_name = casing.ToLowerSnakeCase(field.name)
    keyword_args.append(f"{field_name}={field_name}")
  return ",".join(keyword_args)


def ToWritableAttrArgs(attrs: list[Attribute]) -> str:
  """Outputs the given attributes as an args list, e.g. arg1,arg2,arg3,..."""
  return ",".join(
      casing.ToLowerSnakeCase(attr.definition.name)
      for attr in attrs
      if attr.is_writable
  )


def ToWritableAttrKeywordArgs(
    attrs: Sequence[Attribute], *, cluster: Cluster | None = None
) -> str:
  """Formats the given list of attributes as a named keyword args list.

  Args:
    attrs: List of Attributes to convert to keyword args.
    cluster: The cluster to which the attributes belong.

  Returns:
    The keyword args list, e.g. "arg1=arg1,arg2=arg2,arg3=arg3,..."
  """
  final_args = []
  vendor_args = collections.defaultdict(list)

  for attr in attrs:
    if not attr.is_writable:
      continue

    field = attr.definition
    vendor_id = ToVendorId(field.code)
    field_name = casing.ToLowerSnakeCase(field.name)

    if vendor_id == 0 or not cluster:
      # Standard cluster, or no cluster provided;
      # Add to final args list directly.
      final_args.append(f"{field_name}={field_name}")
    else:
      vendor_args[vendor_id].append(field_name)

  # Process vendor args
  if vendor_args:
    # cluster is known to be not None if vendor_args is not empty.
    assert cluster  # Added for static analysis.
    module_alias = f"{casing.ToLowerSnakeCase(cluster.name)}_service_pb2"
    cluster_name = cluster.name

    for vid, fields in vendor_args.items():
      vid_hex = f"{vid:04x}"
      vid_hex_upper = vid_hex.upper()

      nested_args = [f"{f}={f}" for f in fields]
      nested_args_str = ", ".join(nested_args)

      # Check if any field is not None
      condition = " or ".join(f"{f} is not None" for f in fields)
      arg_str = (
          f"attributes_for_vendor_{vid_hex}=({module_alias}.{cluster_name}.Attribute.Data.AttributesForVendor{vid_hex_upper}({nested_args_str})"
          f" if ({condition}) else None)"
      )
      final_args.append(arg_str)

  return ",\n      ".join(final_args)


def RemoveConstantPrefix(s: str) -> str:
  """Returns the string with the first character removed."""
  if not s.startswith("k"):
    raise ValueError("Constant does not start with k.")
  return s[1:]


def _CommandHasResponse(command: Command) -> bool:
  """Returns true if a command has a specific response."""
  return command.output_param != "DefaultSuccess"


def FormatElementsForDoxygen(s: str, enums_no_enum: list[str]) -> str:
  """Formats source Kotlin-style link references from clusters.yaml to be compatible with C++ Doxygen.

  Args:
    s: The doc comment string.
    enums_no_enum: A list of documented enums that don't end in "Enum".

  Returns:
    The same string with reference links formatted for C++ Doxygen.
  """

  # Find any camelCase element from the doc source (like globalSceneControl) and
  # convert it to snake case (global_scene_control).
  result = re.sub(
      r"(?:\[|\.|`)([a-z][a-zA-Z]*)(?:\]|`)",
      MakeDoxygenElementSnakeCase,
      s,
  )

  # Replace "Trait" suffix of the Kotlin cluster with "Cluster" suffix to match
  # the C++ code generation.
  result = re.sub(
      r"\[([a-zA-Z]+)Trait\.([a-zA-Z]+)",
      r"[\1Trait.\2",
      result,
  )

  # Add "Enum" to the end of any enum in a link format. The regex handles ones
  # that already end in "Enum", while the loop handles those that don't already
  # end in "Enum" (it is not consistent in the Matter spec).
  result = re.sub(r"(Enum(\]|\.[A-Za-z]))", r"Enum\1", result)
  for e in enums_no_enum:
    result = result.replace(e + "]", e + "Enum]")
  for e in enums_no_enum:
    result = result.replace(e + ".", e + "Enum.")

  # Remove the '.Request' from command parameter struct references (since C++
  # uses 'Parameters').
  result = re.sub(r"\.Request", "", result)

  # The next set of regexes remove square brackets and change any embedded '.'s
  # to scope resolution operators (::) and changes them to use code font. For
  # example, [OnOffTrait.Attributes.on_off] to
  # `OnOffTrait::Attributes::on_off`.
  result = re.sub(
      r"\[[a-zA-Z_]+\]\[([a-zA-Z]+)\.([a-zA-Z]+)\.([a-zA-Z_]+)\]",
      r"`\1::\2::\3`",
      result,
  )
  result = re.sub(
      r"\[[a-zA-Z_]+\]\[([a-zA-Z]+)\.([a-zA-Z_]+)\]",
      r"`\1::\2`",
      result,
  )
  result = re.sub(
      r"\[[a-zA-Z]+\.[a-zA-Z]+\]\[([a-zA-Z]+)\.([a-zA-Z]+)\.([a-zA-Z_]+)\]",
      r"`\1::\2::\3`",
      result,
  )
  result = re.sub(
      r"\[([a-zA-Z]+)\.([a-zA-Z]+)\]",
      r"`\1::\2`",
      result,
  )
  result = re.sub(
      r"\[([a-zA-Z]+)\.([a-zA-Z]+)\.([a-zA-Z_]+)\]",
      r"`\1::\2::\3`",
      result,
  )

  # Prefix 'k' to an individually linked enum value.
  result = re.sub(r"(Enum::)([a-zA-Z])", r"\1k\2", result)

  # Prefix '#' to an individual element reference to enable Doxygen links.
  result = re.sub(
      r"\[([a-z_]+)\]",
      r"`#\1`",
      result,
  )

  # Remove the square brackets for a non-camelcase individual element to enable
  # Doxygen links.
  result = re.sub(
      r"\[([A-Z][a-zA-Z]*)\]",
      r"`\1`",
      result,
  )
  return result


def MakeDoxygenElementSnakeCase(match: re.Match[str]) -> str:
  """Reformats a Match object from Doxygen regex to lower snake case."""
  match = match.group()  # pyrefly: ignore[bad-assignment]
  return casing.ToLowerSnakeCase(match)  # pyrefly: ignore[bad-argument-type]


def GetDocEnumsNoEnum(docs: Any) -> list[str]:
  """Get the list of all documented enums that don't end in Enum."""

  no_enum = []
  for cluster in docs:
    if "enums" in docs[cluster]:
      for e in docs[cluster]["enums"]:
        if not e["name"].endswith("Enum"):
          no_enum.append(e["name"])

  return no_enum


def _ToCppReadWidth(
    data_type: BasicInteger,
    is_list: bool = False,
) -> int:
  """Return the C++ read width for the given BasicInteger AST data type."""
  if not is_list:
    # Outside of vector, read either long or standard width and cast to final.
    if data_type.byte_count <= 4:
      return 32
    return 64

  # List items require exact width inside of std::vector<>.
  if data_type.byte_count <= 1:
    return 8
  if data_type.byte_count <= 2:
    return 16
  if data_type.byte_count <= 4:
    return 32
  return 64


def _ToCppBaseType(
    data_type: Union[
        BasicInteger,
        BasicString,
        IdlBitmapType,
        FundamentalType,
        IdlEnumType,
        IdlType,
    ],
) -> str:
  """Return the C++ type for the given parser AST data type."""

  if isinstance(data_type, BasicInteger):
    if data_type.is_signed:
      if data_type.byte_count <= 1:
        return "int8_t"
      if data_type.byte_count <= 2:
        return "int16_t"
      if data_type.byte_count <= 4:
        return "int32_t"
      return "int64_t"
    else:  # unsigned
      if data_type.byte_count <= 1:
        return "uint8_t"
      if data_type.byte_count <= 2:
        return "uint16_t"
      if data_type.byte_count <= 4:
        return "uint32_t"
      return "uint64_t"

  if isinstance(data_type, BasicString):
    if data_type.is_binary:
      return "ByteArray"

    return "std::string"

  # isinstance(data_type, FundamentalType):
  if data_type == FundamentalType.BOOL:
    return "bool"

  if data_type == FundamentalType.FLOAT:
    return "float"

  if data_type == FundamentalType.DOUBLE:
    return "double"

  if isinstance(data_type, IdlEnumType):
    return _ToCppBaseType(data_type.base_type)

  if isinstance(data_type, IdlBitmapType):
    return _ToCppBaseType(data_type.base_type)

  if isinstance(data_type, IdlType):
    return data_type.idl_name

  # Above should have handled all cases
  raise CodeGenerationError("Unsupported data type: %r" % data_type)


def _IsUnmappedEnumOrBitmap(
    data_type: Union[
        BasicInteger,
        BasicString,
        FundamentalType,
        IdlBitmapType,
        IdlEnumType,
        IdlType,
    ],
) -> bool:
  """Returns whether the given type is an unmapped enum or bitmap which should be processed as a primitive type."""
  return data_type.idl_name.lower() in {
      "enum8",
      "enum16",
      # enum16 is maximum enum range per go/matter-spec#ref_DataTypeEnum
      "bitmap8",
      "bitmap16",
      "bitmap24",
      "bitmap32",
      "bitmap40",
      "bitmap48",
      "bitmap56",
      "bitmap64",
  }


def ToEnum(name: str, namespace: str = "") -> str:
  """Append "Enum" to the given name if it doesn't already end in "Enum"."""
  if not name.endswith("Enum"):
    name += "Enum"
  return f"{namespace}{name}"


def ToBitmap(name: str, namespace: str = "") -> str:
  """Append "Bitmap" to the given name if it doesn't already end in "Bitmap"."""
  if not name.endswith("Bitmap"):
    name += "Bitmap"
  return f"{namespace}{name}"


def ToBitmapAdapter(name: str, namespace: str = "") -> str:
  """Append "BitmapAdapter" to the given name without repeating "Bitmap" if the name already ends with that."""
  name = ToBitmap(name, namespace)
  name += "Adapter"
  return name


def _ToCppFieldType(
    data_type: Union[
        BasicInteger,
        BasicString,
        FundamentalType,
        IdlType,
        IdlEnumType,
        IdlBitmapType,
    ],
    field: Field,
    namespace: str = "",
) -> str:
  """Return the full Cpp type for the given field.

  Args:
    data_type: the underlying field data type
    field: the field, field.data_type MUST match data type. Used for field
      modifiers such as optional and nullable
    namespace: if present, 'Namespace::' to prepend to the inner type.

  Returns:
    The data type to use.
  """
  type_comment = ""
  inner_type = _ToCppBaseType(data_type)  # assume this type for now

  if _IsUnmappedEnumOrBitmap(data_type):
    # just a default integer generally
    # this is for bitmap32 or enum8 or similar
    pass
  elif isinstance(data_type, IdlEnumType):
    inner_type = ToEnum(data_type.idl_name, namespace)
  elif isinstance(data_type, IdlBitmapType):
    inner_type = ToBitmapAdapter(data_type.idl_name, namespace)
  elif isinstance(data_type, IdlType):  # It's a Structure
    inner_type = f"{namespace}{data_type.idl_name}Adapter"

  if field.is_list:
    inner_type = f"std::vector<{inner_type}>"

  if field.is_nullable and field.is_optional:
    inner_type = f"OptionalNullable<{inner_type}>"

  elif field.is_nullable:
    inner_type = f"Nullable<{inner_type}>"

  elif field.is_optional:
    inner_type = f"Optional<{inner_type}>"

  else:
    # Mandatory is always optional as well.
    inner_type = f"Mandatory<{inner_type}>"

  return type_comment + inner_type


def _BitmapToBaseType(type_lookup: TypeLookupContext, bitmap: Bitmap) -> str:
  data_type = ParseDataType(DataType(bitmap.name), type_lookup)
  return _ToCppBaseType(data_type)


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


def IsCommandStruct(struct: Struct) -> bool:
  return struct.tag is not None


def FieldIsBasicType(type_lookup: TypeLookupContext, field: Field):
  zap_type = field.data_type.name
  if type_lookup.is_struct_type(zap_type):
    return False
  elif type_lookup.is_enum_type(zap_type):
    return False
  elif type_lookup.is_bitmap_type(zap_type):
    return False
  elif field.is_list:
    return False
  return True


def ToFieldType(
    type_lookup: TypeLookupContext, field: Field, namespace: str = ""
) -> str:
  """Returns the fully qualified C++ type for the given field."""
  data_type = ParseDataType(field.data_type, type_lookup)
  final_type = _ToCppFieldType(data_type, field, namespace)
  return final_type


def ToCommandName(command: Command, cluster: Cluster) -> str:
  if command.name == cluster.name:
    return command.name + "Command"
  return command.name


def ToCommandParameter(
    field: Field, cluster_name: str, type_lookup: TypeLookupContext
) -> str:
  namespace = f"{cluster_name}Trait::"
  field_type = ToFieldType(type_lookup, field, namespace)
  return field_type + " " + casing.ToLowerSnakeCase(field.name)


def ToCommandResponse(type_lookup: TypeLookupContext, command: Command) -> str:
  output_struct = _CreateCommandOutputArgumentFilter(type_lookup)(command)
  if output_struct:
    return command.name + "CommandResponse"
  return "StandardResponse"


def ToSerializerType(
    data_type: Union[
        BasicInteger,
        BasicString,
        IdlBitmapType,
        FundamentalType,
        IdlEnumType,
        IdlType,
    ],
) -> str:
  """Returns the Codec type name for the given data type.

  Args:
    data_type: the underlying field data type

  Returns:
    A string of the form `UInt` or `Int`, etc.
  """
  cpp_type = _ToCppBaseType(data_type)

  if cpp_type in {"uint8_t", "uint16_t", "uint32_t", "uint64_t"}:
    return "UInt"

  if cpp_type in {"int8_t", "int16_t", "int32_t", "int64_t"}:
    return "Int"

  if cpp_type in {"std::string"}:
    return "String"

  if cpp_type in {"ByteArray"}:
    return "Bytes"

  return stringcase.capitalcase(cpp_type)


def ToCodecType(type_lookup: TypeLookupContext, field: Field) -> str:
  """Returns the Codec type name for the given field."""
  data_type = ParseDataType(field.data_type, type_lookup)
  codec_type = ToSerializerType(data_type)

  if isinstance(data_type, BasicInteger):
    if data_type.is_signed:
      codec_type = f"Int{data_type.byte_count*8}"
    else:
      codec_type = f"UInt{data_type.byte_count*8}"
  elif isinstance(data_type, IdlEnumType):
    codec_type = data_type.idl_name
  elif isinstance(data_type, IdlBitmapType):
    codec_type = data_type.idl_name

  codec_type = casing.ToUpperCamelCase(codec_type)
  if field.is_list:
    codec_type += "[]"
  return codec_type


def ToEnumEntryName(enum_entry: str, enum_name: str) -> str:
  """Create enum entry name by prepending the enum name and converting to upper snake case."""
  prefix = stringcase.pascalcase(enum_name)
  if enum_entry[0] == "k":
    enum_entry = enum_entry[1:]
  return prefix + "_" + stringcase.pascalcase(enum_entry)


def IsAttributeEqual(
    type_lookup: TypeLookupContext, attribute: Attribute
) -> str:
  """Generates the C++ code to check equality of an attribute field."""
  field = attribute.definition
  field_snake_name = casing.ToLowerSnakeCase(field.name)
  zap_type = field.data_type.name
  if type_lookup.is_struct_type(zap_type):
    return ""
  if attribute.is_writable:
    field_snake_name = "writable." + field_snake_name
  return f"if (lhs.{field_snake_name} != rhs.{field_snake_name}) return false;"


def SerializerWriteField(
    type_lookup: TypeLookupContext, field: Field, parent_accessor: str = ""
) -> str:
  """Generates the code to encode a field.

  Args:
    type_lookup: the lookup to use
    field: Field to generate `writer.Write<Type>` code for
    parent_accessor: Name of variable to access struct data through

  Returns:
    A string of the form `UInt` or `Int`, etc.

  Example:
    writer.WriteBool(kTagOnOff, attributes_.on_off);
  """

  field_snake_name = casing.ToLowerSnakeCase(field.name)
  field_capital_name = casing.ToUpperCamelCase(field.name)
  zap_type = field.data_type.name
  data_type = ParseDataType(field.data_type, type_lookup)
  codec_type = ToSerializerType(data_type)
  if not _IsUnmappedEnumOrBitmap(data_type):
    if type_lookup.is_struct_type(zap_type):
      codec_type = f"Struct<{zap_type}Adapter>"
    elif type_lookup.is_enum_type(zap_type):
      type_name = ToEnum(zap_type)
      codec_type = f"Enum<{type_name}>"
    elif type_lookup.is_bitmap_type(zap_type):
      type_name = ToBitmapAdapter(zap_type)
      codec_type = f"Bitmap<{type_name}>"

  codec_op = "Write"
  if field.is_list:
    codec_op += "List"

  return (
      f"writer.{codec_op}{codec_type}(kTag{field_capital_name},"
      f" {parent_accessor}{field_snake_name})"
  )


def SerializerReadField(
    type_lookup: TypeLookupContext, field: Field, parent_accessor: str = ""
) -> str:
  """Generates the code to decode a field."""
  field_snake_name = casing.ToLowerSnakeCase(field.name)
  field_capital_name = casing.ToUpperCamelCase(field.name)
  zap_type = field.data_type.name
  data_type = ParseDataType(field.data_type, type_lookup)
  codec_type = ToSerializerType(data_type)
  if not _IsUnmappedEnumOrBitmap(data_type):
    if type_lookup.is_struct_type(zap_type):
      codec_type = f"Struct<{zap_type}Adapter>"
    elif type_lookup.is_enum_type(zap_type):
      type_name = ToEnum(zap_type)
      codec_type = f"Enum<{type_name}>"
    elif type_lookup.is_bitmap_type(zap_type):
      type_name = ToBitmapAdapter(zap_type)
      codec_type = f"Bitmap<{type_name}>"
  elif isinstance(data_type, IdlEnumType) or isinstance(
      data_type, IdlBitmapType
  ):
    data_type = cast(IdlEnumType or IdlBitmapType, data_type).base_type

  if isinstance(data_type, BasicInteger):
    data_width = _ToCppReadWidth(data_type, field.is_list)
    if data_type.is_signed:
      codec_type = f"Int{data_width}"
    else:
      codec_type = f"UInt{data_width}"

  codec_op = "Read"
  if field.is_list:
    codec_op += "List"

  return (
      f"auto {field_snake_name} ="
      f" reader.{codec_op}{codec_type}(kTag{field_capital_name});if"
      f" ({field_snake_name}.ok())"
      "{"
      f" {parent_accessor}{field_snake_name} = {field_snake_name}.value();"
      "}"
  )


def ToClickType(type_lookup: TypeLookupContext, field: Field) -> str:
  """Returns the type of the click option for the given field."""
  data_type = ParseDataType(field.data_type, type_lookup)
  if isinstance(data_type, BasicInteger):
    return "int"
  elif type_lookup.is_enum_type(field.data_type.name):
    return "int"
  elif type_lookup.is_bitmap_type(field.data_type.name):
    return "int"
  elif data_type == FundamentalType.BOOL:
    return "bool"
  elif data_type == FundamentalType.FLOAT:
    return "float"
  elif data_type == FundamentalType.DOUBLE:
    return "float"
  return "str"


def ToClusterPackageNamespace(cluster: Cluster) -> str:
  if hasattr(cluster, "PACKAGE_NAMESPACE") and cluster.PACKAGE_NAMESPACE:
    return cluster.PACKAGE_NAMESPACE
  return "matter"


def HasWritableAttributes(cluster: Cluster) -> bool:
  """Returns whether the cluster has writable attributes."""
  return any(attribute.is_writable for attribute in cluster.attributes)


def ToGrpcServiceAttributeGet(
    type_lookup: TypeLookupContext, attribute: Attribute, cluster: Cluster
) -> str:
  """Returns the code to get an attribute."""
  field = attribute.definition
  data_type = ParseDataType(field.data_type, type_lookup)
  attribute_snake_name = casing.ToLowerSnakeCase(field.name)
  attribute_field_name = attribute_snake_name
  if attribute.is_writable:
    attribute_field_name = "writable." + attribute_field_name

  vendor_id = ToVendorId(field.code)
  parent_accessor = "grpc_response->mutable_value()"
  if vendor_id != 0:
    parent_accessor += f"->mutable_attributes_for_vendor_{vendor_id:04x}()"

  if type_lookup.is_struct_type(field.data_type.name):
    if field.is_list:
      return ""
    return textwrap.dedent(
        f"""if (attributes.{attribute_field_name}.has_value()) {{
        EncodeToGrpc(
          attributes.{attribute_field_name}->GetStruct(),
          *{parent_accessor}->mutable_{attribute_snake_name}());
      }}"""
    )
  elif not _IsUnmappedEnumOrBitmap(data_type):
    if type_lookup.is_enum_type(field.data_type.name):
      if field.is_list:
        return ""
      enum_name = ToEnumEntryName(field.data_type.name, cluster.name)
      package_namespace = ToClusterPackageNamespace(cluster)
      return f"""
      if (attributes.{attribute_field_name}.has_value()) {{
        {parent_accessor}->set_{attribute_snake_name}(
            static_cast<
                google_home_api::traits::{package_namespace}::service::{enum_name}>(
                attributes.{attribute_field_name}.value()));
      }}"""
    elif type_lookup.is_bitmap_type(field.data_type.name):
      return f"""
      if (attributes.{attribute_field_name}.has_value()) {{
        {parent_accessor}->set_{attribute_snake_name}(
            attributes.{attribute_field_name}.value().GetValue());
      }}"""
    elif field.is_list:
      return f"""
      if (attributes.{attribute_field_name}.has_value()) {{
        {parent_accessor}->clear_{attribute_snake_name}();
        for (const auto& entry : attributes.{attribute_field_name}.value()) {{
          {parent_accessor}->add_{attribute_snake_name}(entry);
        }}
      }}"""
  elif field.is_list:
    return ""

  # Otherwise, it's a primitive type
  return f"""
    if (attributes.{attribute_field_name}.has_value()) {{
      {parent_accessor}->set_{attribute_snake_name}(attributes.{attribute_field_name}.value());
    }}"""


def ToGrpcServiceAttributeSet(
    type_lookup: TypeLookupContext, attribute: Attribute, cluster: Cluster
) -> str:
  """Returns the code to set an attribute."""
  if not attribute.is_writable:
    return ""
  field = attribute.definition
  type_name = field.data_type.name
  data_type = ParseDataType(field.data_type, type_lookup)
  attribute_snake_name = casing.ToLowerSnakeCase(field.name)
  package_namespace = ToClusterPackageNamespace(cluster)

  vendor_id = ToVendorId(field.code)
  value_accessor = "grpc_request->value()"
  if vendor_id != 0:
    value_accessor += f".attributes_for_vendor_{vendor_id:04x}()"

  # Default output to support primitive types and bitmaps
  inner = (
      f"attributes.{attribute_snake_name} = "
      f"{value_accessor}.{attribute_snake_name}();"
  )

  if type_lookup.is_struct_type(type_name):
    if field.is_list or not attribute.is_writable:
      return ""
    return textwrap.dedent(
        f"""if ({value_accessor}.has_{attribute_snake_name}()) {{
        attributes.{attribute_snake_name}->SetStruct(
          [&src = {value_accessor}.{attribute_snake_name}()](
              google_home_api::traits::{package_namespace}::{cluster.name}Trait::
                  {type_name}& dest) {{ DecodeFromGrpc(src, dest); }});
      }}"""
    )
  elif not _IsUnmappedEnumOrBitmap(data_type):
    if type_lookup.is_enum_type(type_name):
      if field.is_list:
        return ""
      enum_name = ToEnum(type_name)
      inner = f"""attributes.{attribute_snake_name} = static_cast<
            google_home_api::traits::{package_namespace}::{cluster.name}Trait::{enum_name}>(
            {value_accessor}.{attribute_snake_name}());"""
    elif field.is_list:
      return f"""if (!{value_accessor}.{attribute_snake_name}().empty()) {{
            attributes.{attribute_snake_name} = {{
                {value_accessor}.{attribute_snake_name}().begin(),
                {value_accessor}.{attribute_snake_name}().end()
            }};
          }}"""
  elif field.is_list:
    return ""
  # Finally, wrap with optional check
  return f"""
    if ({value_accessor}.has_{attribute_snake_name}()) {{
      {inner}
    }}"""


def ToGrpcFieldInitializer(field: Field, type_lookup: TypeLookupContext) -> str:
  """Returns the code to define a field locally and initialize it from grpc request."""
  data_type = ParseDataType(field.data_type, type_lookup)
  # TODO: b/353979723 - Support set attributes for lists and bitmaps
  if field.is_list:
    return ""
  elif type_lookup.is_struct_type(field.data_type.name):
    return ""
  elif not _IsUnmappedEnumOrBitmap(data_type):
    if type_lookup.is_enum_type(field.data_type.name):
      return ""
    elif type_lookup.is_bitmap_type(field.data_type.name):
      return ""

  # Otherwise, it's a primitive type
  field_name = casing.ToLowerSnakeCase(field.name)
  inner_setting = f"{field_name} = grpc_request->parameters().{field_name}();"

  if field.is_nullable:
    inner_setting = f"""
      if (grpc_request->parameters().{field_name}_is_null()) {{
        {field_name} = std::nullopt;
      }} else {{
        {inner_setting}
      }}"""

  return f"""
    if (grpc_request->parameters().has_{field_name}()) {{
      {inner_setting}
    }}"""


def _CreateIsStructFieldTest(type_lookup):
  """Creates a filter that returns true if and only if a given field is a struct."""

  def InternalTest(field: Field):
    return type_lookup.is_struct_type(field.data_type.name)

  return InternalTest


class CustomGenerator(CodeGenerator):
  """Example of a custom generator.

  Outputs protobuf representation of Matter clusters.
  """

  def __init__(self, storage: GeneratorStorage, idl: Idl, **kargs):
    """Inintialization is specific for C++ generation and will add filters as required by the java .jinja templates to function."""
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
    self.output_type = kargs["output_type"]
    self.filtered_clusters = [
        cluster
        for cluster in self.idl.clusters
        if cluster.api_maturity != ApiMaturity.DEPRECATED
        and cluster.name != "SampleMei"
    ]

    if not self.package_name or self.package_name.endswith("."):
      raise ValueError("Package name %r is not valid." % self.package_name)

    if "docs" in kargs:
      self.docs = kargs["docs"]
    else:
      yaml_data = "docs/clusters.yaml"
      with open(yaml_data) as y:
        self.docs = yaml.safe_load(y)

    # Get the list of all documented enums that don't end in "Enum", so they can
    # be used in the FormatElementsForDoxygen filter later.
    self.doc_enums_no_enum = GetDocEnumsNoEnum(self.docs)

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

    self.jinja_env.globals["PACKAGE_PATH"] = self.package_name
    self.jinja_env.globals["PACKAGE_NAMESPACE"] = self.package_name.replace(
        "/", "::"
    )
    self.jinja_env.globals["PACKAGE_PY_NAMESPACE"] = self.package_name.replace(
        "/", "."
    )
    self.jinja_env.globals["PACKAGE_DEFINE"] = self.package_name.replace(
        "/", "_"
    ).upper()

    # Format helpers
    self.jinja_env.filters["ToHex"] = ToHex
    self.jinja_env.filters["ToVendorId"] = ToVendorId
    self.jinja_env.filters["ToMeiSuffix"] = ToMeiSuffix
    self.jinja_env.filters["ToTraitId"] = ToTraitId
    self.jinja_env.filters["ToEnum"] = ToEnum
    self.jinja_env.filters["ToBitmap"] = ToBitmap
    self.jinja_env.filters["ToBitmapAdapter"] = ToBitmapAdapter
    self.jinja_env.filters["ToUpperSnakeCase"] = casing.ToUpperSnakeCase
    self.jinja_env.filters["ToLowerSnakeCase"] = casing.ToLowerSnakeCase
    self.jinja_env.filters["ToUpperCamelCase"] = casing.ToUpperCamelCase
    self.jinja_env.filters["RemoveConstantPrefix"] = RemoveConstantPrefix
    self.jinja_env.filters["camelcase"] = stringcase.camelcase

    # Command helpers
    self.jinja_env.filters["ToCommandName"] = ToCommandName
    self.jinja_env.filters["ToCommandParameter"] = ToCommandParameter
    self.jinja_env.filters["hasResponse"] = _CommandHasResponse
    self.jinja_env.tests["isCommandStruct"] = IsCommandStruct  # pyrefly: ignore[unsupported-operation]

    # Field and Attribute helpers
    self.jinja_env.filters["ToFieldArgs"] = ToFieldArgs
    self.jinja_env.filters["ToFieldKeywordArgs"] = ToFieldKeywordArgs
    self.jinja_env.filters["ToWritableAttrArgs"] = ToWritableAttrArgs
    # ToWritableAttrKeywordArgs needs cluster context, so it is registered in
    # init_filters_for_cluster instead.
    self.jinja_env.filters["ToGrpcFieldInitializer"] = ToGrpcFieldInitializer

    # Documentation filters
    self.jinja_env.filters["AttributeDocType"] = common.AttributeDocType
    self.jinja_env.filters["DocExcludeComment"] = common.DocExcludeComment
    self.jinja_env.filters["FormatElementsForDoxygen"] = (
        FormatElementsForDoxygen
    )
    self.jinja_env.filters["OutputAttributeComment"] = (
        common.OutputAttributeComment
    )

  def init_filters_for_cluster(self, cluster: Cluster):
    """Initializes filters for a given cluster."""
    # context-sensitive filter (i.e. the ones that do type lookups)
    type_lookup = TypeLookupContext(self.idl, cluster)

    self.jinja_env.filters["ToFieldType"] = functools.partial(
        ToFieldType, type_lookup
    )
    self.jinja_env.filters["ToCodecType"] = functools.partial(
        ToCodecType, type_lookup
    )
    self.jinja_env.filters["FieldIsBasicType"] = functools.partial(
        FieldIsBasicType, type_lookup
    )
    self.jinja_env.filters["BitmapToBaseType"] = functools.partial(
        _BitmapToBaseType, type_lookup
    )
    self.jinja_env.filters["commandInputStruct"] = (
        _CreateCommandInputArgumentFilter(type_lookup)
    )
    self.jinja_env.filters["commandOutputStruct"] = (
        _CreateCommandOutputArgumentFilter(type_lookup)
    )
    self.jinja_env.filters["ToCommandResponse"] = functools.partial(
        ToCommandResponse, type_lookup
    )
    self.jinja_env.filters["lookupDataType"] = functools.partial(
        ParseDataType, type_lookup
    )
    self.jinja_env.filters["SerializerReadField"] = functools.partial(
        SerializerReadField, type_lookup
    )
    self.jinja_env.filters["SerializerWriteField"] = functools.partial(
        SerializerWriteField, type_lookup
    )
    self.jinja_env.tests["IsStructField"] = _CreateIsStructFieldTest(
        type_lookup
    )
    self.jinja_env.filters["HasWritableAttributes"] = HasWritableAttributes
    self.jinja_env.filters["IsAttributeEqual"] = functools.partial(
        IsAttributeEqual, type_lookup
    )
    self.jinja_env.filters["ToGrpcServiceAttributeGet"] = functools.partial(
        ToGrpcServiceAttributeGet, type_lookup
    )
    self.jinja_env.filters["ToGrpcServiceAttributeSet"] = functools.partial(
        ToGrpcServiceAttributeSet, type_lookup
    )
    self.jinja_env.filters["ToClickType"] = functools.partial(
        ToClickType, type_lookup
    )
    self.jinja_env.filters["ToWritableAttrKeywordArgs"] = functools.partial(
        ToWritableAttrKeywordArgs, cluster=cluster
    )

  def internal_render_all(self):
    """Renders the given custom template to the given output filename."""
    if self.output_type == "json":
      return self.internal_render_json()
    elif self.output_type == "grpc":
      return self.internal_render_grpc()
    # Default to the C++ API output.
    return self.internal_render_cpp_api()

  def internal_render_json(self):
    """Renders --output_type=json."""

    # The proto template generates one trait file per cluster.
    for cluster in self.filtered_clusters:
      self.init_filters_for_cluster(cluster)

      # filter docs to this cluster
      cluster_docs = self.docs.get(cluster.name)
      cluster_snakecase = casing.ToLowerSnakeCase(cluster.name)

      # Header containing a macro to initialize all cluster plugins
      self.internal_render_one_output(
          template_path="trait_schema.json.jinja",
          output_file_name=f"{cluster_snakecase}_schema.json",
          template_vars={
              "typeLookup": TypeLookupContext(self.idl, cluster),
              "cluster": cluster,
              "docs": cluster_docs,
              "docs_enums_no_enum": self.doc_enums_no_enum,
              "file_comment": self.file_comment,
          },
      )

  def internal_render_grpc(self):
    """Renders --output_type=grpc."""

    # Templates that generate one output file for all clusters.
    target_name = self.package_name.split("/")[-1]
    self.internal_render_one_output(
        template_path="grpc_cli.BUILD.jinja",
        output_file_name="grpc_cli.BUILD",
        template_vars={
            "clusters": self.filtered_clusters,
            "file_comment": self.file_comment,
            "package_name": self.package_name,
            "target_name": target_name,
        },
    )

    self.internal_render_one_output(
        template_path="grpc_client.BUILD.jinja",
        output_file_name="grpc_client.BUILD",
        template_vars={
            "clusters": self.filtered_clusters,
            "file_comment": self.file_comment,
            "package_name": self.package_name,
            "target_name": target_name,
        },
    )

    self.internal_render_one_output(
        template_path="grpc_service.BUILD.jinja",
        output_file_name="grpc_service.BUILD",
        template_vars={
            "clusters": self.filtered_clusters,
            "file_comment": self.file_comment,
            "package_name": self.package_name,
            "target_name": target_name,
        },
    )

    self.internal_render_one_output(
        template_path="grpc_traits_cli.py.jinja",
        output_file_name=f"traits_cli_{self.package_name}.py",
        template_vars={
            "clusters": self.filtered_clusters,
            "file_comment": self.file_comment,
        },
    )

    # The proto template generates one trait file per cluster.
    for cluster in self.filtered_clusters:
      self.init_filters_for_cluster(cluster)

      cluster.PACKAGE_NAMESPACE = self.jinja_env.globals["PACKAGE_NAMESPACE"]  # pyrefly: ignore[missing-attribute]

      # filter docs to this cluster
      cluster_docs = self.docs.get(cluster.name)
      cluster_snakecase = casing.ToLowerSnakeCase(cluster.name)

      # Header containing a macro to initialize all cluster plugins
      self.internal_render_one_output(
          template_path="grpc_cli.py.jinja",
          output_file_name=f"{cluster_snakecase}_cli.py",
          template_vars={
              "typeLookup": TypeLookupContext(self.idl, cluster),
              "cluster": cluster,
              "docs": cluster_docs,
              "docs_enums_no_enum": self.doc_enums_no_enum,
              "file_comment": self.file_comment,
          },
      )

      self.internal_render_one_output(
          template_path="grpc_client.py.jinja",
          output_file_name=f"{cluster_snakecase}_trait.py",
          template_vars={
              "typeLookup": TypeLookupContext(self.idl, cluster),
              "cluster": cluster,
              "docs": cluster_docs,
              "docs_enums_no_enum": self.doc_enums_no_enum,
              "file_comment": self.file_comment,
          },
      )

      self.internal_render_one_output(
          template_path="grpc_service.h.jinja",
          output_file_name=f"{cluster_snakecase}_service.h",
          template_vars={
              "typeLookup": TypeLookupContext(self.idl, cluster),
              "cluster": cluster,
              "docs": cluster_docs,
              "docs_enums_no_enum": self.doc_enums_no_enum,
              "file_comment": self.file_comment,
          },
      )

  def internal_render_cpp_api(self):
    """Renders --output_type=cpp_api (default)."""

    self.internal_render_one_output(
        template_path="traits_cpp.BUILD.jinja",
        output_file_name="traits_cpp.BUILD",
        template_vars={
            "clusters": self.filtered_clusters,
            "file_comment": self.file_comment,
        },
    )

    # The proto template generates one trait file per cluster.
    for cluster in self.filtered_clusters:
      self.init_filters_for_cluster(cluster)

      # filter docs to this cluster
      cluster_docs = self.docs.get(cluster.name)
      cluster_snakecase = casing.ToLowerSnakeCase(cluster.name)

      # Header containing a macro to initialize all cluster plugins
      self.internal_render_one_output(
          template_path="trait_cluster.h.jinja",
          output_file_name=f"{cluster_snakecase}_trait.h",
          template_vars={
              "typeLookup": TypeLookupContext(self.idl, cluster),
              "cluster": cluster,
              "docs": cluster_docs,
              "docs_enums_no_enum": self.doc_enums_no_enum,
              "file_comment": self.file_comment,
          },
      )

      self.internal_render_one_output(
          template_path="trait_cluster.cc.jinja",
          output_file_name=f"{cluster_snakecase}_trait.cc",
          template_vars={
              "typeLookup": TypeLookupContext(self.idl, cluster),
              "cluster": cluster,
              "docs": cluster_docs,
              "docs_enums_no_enum": self.doc_enums_no_enum,
              "file_comment": self.file_comment,
          },
      )

      self.internal_render_one_output(
          template_path="trait_entity.h.jinja",
          output_file_name=f"{cluster_snakecase}.h",
          template_vars={
              "typeLookup": TypeLookupContext(self.idl, cluster),
              "cluster": cluster,
              "docs": cluster_docs,
              "docs_enums_no_enum": self.doc_enums_no_enum,
              "file_comment": self.file_comment,
          },
      )
