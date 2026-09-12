"""Plugin module to matter_idl for auto-generation of .swift files.

This module provides a plugin to the matter_idl tool from the Matter SDK
(https://github.com/project-chip/connectedhomeip/tree/master/scripts/py_matter_idl)
to assist generating Swift device definitions
"""

import enum
import logging
import os
import re
import sys
import types
from typing import Optional, Union

import common
from common.postprocess import PostProcessIdl
import jinja2
from matter.idl.generators import CodeGenerator
from matter.idl.generators import GeneratorStorage
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


class OptionalityStrategy(enum.StrEnum):
  # Always generate optional types, even if the field is not marked optional.
  ALWAYS = "ALWAYS"
  # Generation optional types only if the field is marked nullable.
  IF_NULLABLE = "IF_NULLABLE"
  # Generation optional types if the field is marked optional or nullable.
  IF_OPTIONAL_OR_NULLABLE = "IF_OPTIONAL_OR_NULLABLE"
  # Never generate optional types, even if the field is marked optional.
  # This is useful for when nullable is not yet supported, but we can
  # support the non-nullable case in the meantime.
  NEVER = "NEVER"


def UseOptionalType(
    optionality_strategy: OptionalityStrategy, field: Field
) -> bool:
  """Returns whether to use optional types for the given field given."""
  match optionality_strategy:
    case OptionalityStrategy.ALWAYS:
      return True
    case OptionalityStrategy.IF_NULLABLE:
      return IsNullable(field)
    case OptionalityStrategy.IF_OPTIONAL_OR_NULLABLE:
      return IsOptional(field) or IsNullable(field)
    case OptionalityStrategy.NEVER:
      return False
    case _:
      raise ValueError(
          f"Unsupported optionality strategy: {optionality_strategy}"
      )


class CodeGenerationError(Exception):

  def __init__(self, message: str):
    super().__init__(message)


# LINT.IfChange(_SHIPPED_SNAKE_CASE_EXCEPTIONS)
# TODO: b/534288231 - The following attributes were already shipped with
# snake_case property names. Maintain this exception list to preserve backward
# compatibility.
# IMPORTANT: It is NOT ALLOWED to add new items here. All newly introduced
# attributes must follow lowerCamelCase.
_SHIPPED_SNAKE_CASE_EXCEPTIONS = frozenset({
    "preview_image_url",
    "preview_url",
    "thumbnail_url",
    "mp4_download_url",
    "dash_manifest_url",
    "hls_master_playlist_url",
    "casting_control_notification_enabled",
    "fan_cooling_active",
    "fan_cooling_readiness",
    "fan_cooling_enabled",
    "user_requested_fan_running",
    "timer_speed",
    "timer_end",
    "timer_duration",
    "fan_speed_state",
    "snapshot_url",
})
# LINT.ThenChange(//depot/google3/nest/engprod/gna/inception/matter/ghp/codegen/swift_code_generator.py:_SHIPPED_SNAKE_CASE_EXCEPTIONS)


def ToCamelCase(text: str) -> str:
  """Converts the given string to Swift camel case based on capital letters.

  Args:
    text: The text which is to be converted to camel case.

  Returns:
    Input text converted to Swift specific camel case.

  Examples:

  "ToCamelCase" -> "toCamelCase"
  "ToCamelCASE" -> "toCamelCASE"
  "TOCamelCASE" -> "toCamelCASE"
  "TOCamelCase" -> "toCamelCase"
  "TOCAMELCASE" -> "tocamelcase"
  """
  if text in _SHIPPED_SNAKE_CASE_EXCEPTIONS:
    return text
  if "_" in text:
    parts = [token for token in text.split("_") if token]
    if not parts:
      raise ValueError(
          f"Invalid identifier '{text}': cannot consist solely of underscores."
      )
    first = ToCamelCase(parts[0])
    rest = [
        part[0].upper() + (part[1:].lower() if part.isupper() else part[1:])
        for part in parts[1:]
    ]
    return first + "".join(rest)
  if text.isupper():
    return text.lower()
  term = re.match("^[A-Z]{2,}", text)
  if term is None:
    return text.lower()[0:1] + text[1:]
  return text.replace(
      term.group(), term.group().lower()[:-1] + term.group().lower()[-1].upper()
  )


def ToUpperCamelCase(text: str) -> str:
  """Converts the given string to upper camel case.

  Args:
    text: The text which is to be converted to camel case.

  Returns:
    Input text converted to Kotlin specific camel case.
  """
  text = ToCamelCase(text)
  return text[0].capitalize() + text[1:]


def IsReservedSwiftTypeKeyword(text: str) -> bool:
  """Returns whether the given string is a Swift type keyword.

  i.e. a reserved keyword that may be used as a type name.

  Args:
    text: The text to check.

  Returns:
    True if the text is a reserved Swift type keyword.
  """

  return text in ("Type")


def IsReservedSwiftKeyword(text: str) -> bool:
  """Returns whether the given string is a reserved Swift keyword.

  Args:
    text: The text which is to be checked.

  Returns:
    True if the text is a reserved Swift keyword.
  """

  return text in (
      "extension",
      "default",
      "internal",
      "Type",
      "case",
      "in",
      "self",
      "private",
  )


def ToNormalizedSwiftName(text: str, cluster_name: str = "") -> str:
  """Escapes property and type names with backticks for reserved swift keywords.

  Args:
    text: The text which is to be escaped.
    cluster_name: The name of the cluster.

  Returns:
    Text wrapped in backticks if matches a reserved swift keyword.
  """
  if IsReservedSwiftTypeKeyword(text):
    # Some reserved keywords, like "Type", are used for swift types,
    # these should generally be avoided to avoid conflicts with the swift type,
    # in that case, prefix the type with the cluster name to avoid the conflict.
    return cluster_name + text
  elif IsReservedSwiftKeyword(text):
    return f"`{text}`"
  return text


# TODO: b/305042842 - Extract from kotlin/swift py files and move to common.py
def ToConstFieldName(const_name: str) -> str:
  """Return enum/bitmap entry name as camel case, without a leading 'k', and prepending 'Num' if the symbol starts with a numeral."""
  if const_name[0] == "k":
    const_name = const_name[1:]
  if const_name[0].isnumeric():
    const_name = f"Num{const_name}"
  return const_name


def EnumTypeToSwiftEnumType(enum_type: str) -> str:
  """Converts the raw Enum type to the corresponding Swift enum type."""
  return enum_type.lower().replace("enum", "Enum")


def BitmapTypeToSwiftUIntType(enum_type: str) -> str:
  """Converts the raw Bitmap type to the corresponding GHP Swift UInt type."""
  return enum_type.lower().replace("bitmap", "UInt")


def LookupDataTypeFactory(type_lookup: TypeLookupContext) -> types.FunctionType:
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


def DataTypeToSwiftTypeEnum(
    data_type: (
        BasicInteger
        | BasicString
        | FundamentalType
        | IdlType
        | IdlEnumType
        | IdlBitmapType
    ),
) -> str:
  # """Converts the raw Enum type to the corresponding Swift enum type."""
  """Returns the basic Type for the given DataType.

  Args:
    data_type: The DataType for which to obtain the basic type.

  Returns:
    The String representing the basic type of the given DataType.

  Raises:
      CodeGenerationError: Type cannot be determined
  """

  if isinstance(data_type, BasicInteger):
    if data_type.is_signed:
      if data_type.byte_count <= 1:
        basic_type = "int8"
      elif data_type.byte_count <= 2:
        basic_type = "int16"
      elif data_type.byte_count <= 4:
        basic_type = "int32"
      else:
        basic_type = "int64"
    else:  # unsigned
      if data_type.byte_count <= 1:
        basic_type = "uint8"
      elif data_type.byte_count <= 2:
        basic_type = "uint16"
      elif data_type.byte_count <= 4:
        basic_type = "uint32"
      else:
        basic_type = "uint64"
  elif isinstance(data_type, BasicString):
    if data_type.is_binary:
      basic_type = "data"
    else:
      basic_type = "string"
  elif data_type == FundamentalType.BOOL:
    basic_type = "bool"
  elif data_type == FundamentalType.FLOAT:
    basic_type = "float"
  elif data_type == FundamentalType.DOUBLE:
    basic_type = "double"
  elif isinstance(data_type, IdlEnumType):
    if data_type.idl_name in ("enum8", "enum16", "enum32", "enum64"):
      basic_type = data_type.idl_name.replace("enum", "uint")
    else:
      basic_type = "enum"
  elif isinstance(data_type, IdlBitmapType):
    if data_type.idl_name in ("bitmap8", "bitmap16", "bitmap32", "bitmap64"):
      basic_type = data_type.idl_name.replace("bitmap", "uint")
    else:
      basic_type = "bitmap"
  elif isinstance(data_type, IdlType):
    basic_type = "struct"

  else:
    raise CodeGenerationError("Unsupported data type: %r" % data_type)

  return basic_type


def IsTypedEnum(
    data_type: (
        BasicInteger
        | BasicString
        | FundamentalType
        | IdlType
        | IdlEnumType
        | IdlBitmapType
    ),
) -> bool:
  return isinstance(data_type, IdlEnumType) and data_type.idl_name not in (
      "enum8",
      "enum16",
      "enum32",
      "enum64",
  )


def IsTypedBitmap(
    data_type: (
        BasicInteger
        | BasicString
        | FundamentalType
        | IdlType
        | IdlEnumType
        | IdlBitmapType
    ),
) -> bool:
  return isinstance(data_type, IdlBitmapType) and data_type.idl_name not in (
      "bitmap8",
      "bitmap16",
      "bitmap32",
      "bitmap64",
  )


def IsStruct(
    data_type: (
        BasicInteger
        | BasicString
        | FundamentalType
        | IdlType
        | IdlEnumType
        | IdlBitmapType
    ),
) -> bool:
  return isinstance(data_type, IdlType)


def IsTraitType(
    data_type: (
        BasicInteger
        | BasicString
        | FundamentalType
        | IdlType
        | IdlEnumType
        | IdlBitmapType
    ),
) -> bool:
  return (
      IsTypedEnum(data_type) or IsTypedBitmap(data_type) or IsStruct(data_type)
  )


def FieldToSwiftTypeFactory(
    type_lookup: TypeLookupContext,
) -> types.FunctionType:
  """Wrapper for _FieldToSwiftType function to collect the type_lookup parameter.

  Args:
    type_lookup: Scoped Type Lookup.

  Returns:
    Function for converting DataType to Swift Type String.
  """

  def _FieldToSwiftType(
      field: Field,
      optionality_strategy: OptionalityStrategy,
      cluster_name: str = "",
      type_prefix: str = "",
  ) -> str:
    """Converts Field.DataType to Swift Type String.

    Args:
      field: The field which DataType is to be converted to Swift Type.
      optionality_strategy: Whether and how to treat the field as optional.
      cluster_name: The name of the cluster.
      type_prefix: The prefix to add to the type. This can be necessary when the
        type is a trait specific type that requires fully qualified name.

    Returns:
      The String representing the Swift type corresponding to the
      Field.DataType.
    """

    def _GetInnerType(
        data_type: (
            BasicInteger
            | BasicString
            | FundamentalType
            | IdlType
            | IdlEnumType
            | IdlBitmapType
        ),
    ) -> str:
      """Returns the basic Type for the given DataType.

      Args:
        data_type: The DataType for which to obtain the basic type.

      Returns:
        The String representing the basic type of the given DataType.

      Raises:
          CodeGenerationError: Type cannot be determined
      """

      if isinstance(data_type, BasicInteger):
        if data_type.is_signed:
          if data_type.byte_count <= 1:
            basic_type = "Int8"
          elif data_type.byte_count <= 2:
            basic_type = "Int16"
          elif data_type.byte_count <= 4:
            basic_type = "Int32"
          else:
            basic_type = "Int64"
        else:  # unsigned
          if data_type.byte_count <= 1:
            basic_type = "UInt8"
          elif data_type.byte_count <= 2:
            basic_type = "UInt16"
          elif data_type.byte_count <= 4:
            basic_type = "UInt32"
          else:
            basic_type = "UInt64"
      elif isinstance(data_type, BasicString):
        if data_type.is_binary:
          basic_type = "Data"
        else:
          basic_type = "String"
      elif data_type == FundamentalType.BOOL:
        basic_type = "Bool"
      elif data_type == FundamentalType.FLOAT:
        basic_type = "Float32"
      elif data_type == FundamentalType.DOUBLE:
        basic_type = "Float64"
      elif isinstance(data_type, IdlEnumType):
        basic_type = _GetInnerType(data_type.base_type)
      elif isinstance(data_type, IdlBitmapType):
        basic_type = _GetInnerType(data_type.base_type)
      elif isinstance(data_type, IdlType):
        basic_type = data_type.idl_name
      else:
        raise CodeGenerationError("Unsupported data type: %r" % data_type)

      return basic_type

    # Convert basic type to full type.
    data_type = ParseDataType(field.data_type, type_lookup)
    basic_type = _GetInnerType(data_type)
    if IsPrimitiveType(data_type):
      # just a default integer generally
      # this is for bitmap32 or enum8 or similar
      pass
    elif (
        isinstance(data_type, IdlEnumType)
        or isinstance(data_type, IdlBitmapType)
        or isinstance(data_type, IdlType)  # this is for structures
    ):
      cluster_prefix = ""
      if IsReservedSwiftTypeKeyword(data_type.idl_name):
        # Avoid collisions with swift type keywords by prefixing the type with
        # the cluster name.
        cluster_prefix = cluster_name

      if field.is_list:
        basic_type = f"[{type_prefix}{cluster_prefix}{data_type.idl_name}]"
      else:
        basic_type = f"{type_prefix}{cluster_prefix}{data_type.idl_name}"
    elif field.is_list:
      basic_type = f"[{basic_type}]"

    if UseOptionalType(optionality_strategy=optionality_strategy, field=field):
      basic_type += "?"

    return basic_type

  return _FieldToSwiftType


def IsPrimitiveType(
    data_type: (
        BasicInteger
        | BasicString
        | FundamentalType
        | IdlBitmapType
        | IdlEnumType
        | IdlType
    ),
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


def IsAttributeWritable(attr: Attribute) -> bool:
  """Checks if attribute is writable ."""
  if attr.is_writable:
    return True
  return False


def HasWritableAttributes(cluster: Cluster) -> bool:
  """Checks if any attribute is writable in a cluster."""
  for attribute in cluster.attributes:
    if attribute.is_writable:
      return True

  return False


def RequiresTimedWrite(cluster: Cluster) -> bool:
  """Checks if any attribute requires a timed write."""
  for attribute in cluster.attributes:
    if attribute.requires_timed_write:
      return True

  return False


def IsTimedInvoke(command: Command) -> bool:
  """Checks if a command must be invoked using timed interaction."""
  if command.is_timed_invoke:
    return True
  return False


def TypeToDecodeFunction(
    field: Field,
    optionality_strategy: OptionalityStrategy,
) -> str:
  """Returns the decoder function name based on the data type being decoded.

  Args:
    field: The field being decoded.
    optionality_strategy: Whether and how to treat the field as optional.
  """
  use_optional_decode = UseOptionalType(
      optionality_strategy=optionality_strategy, field=field
  )
  function_name = "decodeOptional" if use_optional_decode else "decode"
  if field.is_list:
    function_name += "Array"
  return function_name


def IsCommandStruct(struct: Struct) -> bool:
  return struct.tag is not None


def IsEmptyStruct(struct: Struct) -> bool:
  return len(struct.fields) == 0


def IsCommandOrEmptyStruct(struct: Struct) -> bool:
  return IsCommandStruct(struct) or IsEmptyStruct(struct)


def IsNullable(field: Field) -> bool:
  """Checks if a field is nullable."""
  return bool(field.is_nullable)


def IsOptional(field: Field) -> bool:
  """Checks if a field is optional."""
  return bool(field.is_optional)


def HasOptionalFields(struct: Struct) -> bool:
  """Checks if any fields are optional."""
  return any(field.is_optional for field in struct.fields)


def GetCommandRequestFactory(
    type_lookup: TypeLookupContext,
) -> types.FunctionType:
  """Create a function that fetches the input structure of a command.

  Structure will be fetched using the provided type lookup (i.e.
  commands MUST be tied to the type lookup cluster for this to work).

  Args:
    type_lookup: the lookup to use

  Returns:
    a function suitable to use in jinja templates
  """

  def _GetCommandRequest(command: Command) -> Optional[Struct]:
    """Returns the request Struct of a command.

    Args:
      command: the Command for which to return the request Struct

    Returns:
      Associated request Struct or None if structure does not contain a request.

    Raises:
      ValueError: If request Struct cannot be resolved from type_lookup.
    """
    if command.input_param is None:
      return None

    result = type_lookup.find_struct(command.input_param)

    if result is None:
      raise ValueError("Could not find input param for %r" % command)

    return result

  return _GetCommandRequest


def GetCommandResponseFactory(
    type_lookup: TypeLookupContext,
) -> types.FunctionType:
  """Create a function that fetches the input structure of a command.

  Structure will be fetched using the provided type lookup (i.e.
  commands MUST be tied to the type lookup cluster for this to work).

  Args:
    type_lookup: the lookup to use

  Returns:
    a function suitable to use in jinja templates
  """

  def _GetCommandResponse(command: Command) -> Optional[Struct]:
    """Returns the response Struct of a command.

    Args:
      command: the Command for which to return the response Struct

    Returns:
      Associated response Struct or None if structure does not contain a
      response.

    Raises:
      ValueError: If response Struct cannot be resolved from type_lookup.
    """
    if command.output_param in (None, "DefaultSuccess"):
      return None

    result = type_lookup.find_struct(command.output_param)

    if result is None:
      raise ValueError("Could not find input param for %r" % command)

    return result

  return _GetCommandResponse


def FormatElementsForJazzy(s: str) -> str:
  """Formats source Kotlin-style link references from clusters.yaml to be compatible with Swift Jazzy.

  Args:
    s: The doc comment string.

  Returns:
    The same string with reference links formatted for Swift Jazzy.
  """

  # Remove the '.Request' from command parameter struct references, these are
  # not used in Swift.
  result = re.sub(r"\.Request", "", s)

  # If Attributes is in the link target, reformat the link.
  result = re.sub(
      r"\[([a-zA-Z_]+)\]\[([a-zA-Z]+)\.Attributes\.([a-zA-Z_]+)\]",
      r"`\2/Attributes/\1`",
      result,
  )

  # The next set of regexes remove link targets and changes the link text to use
  # code font to enable Jazzy links.
  result = re.sub(
      r"\[([a-zA-Z_]+)\]\[([a-zA-Z]+)\.([a-zA-Z]+)\.([a-zA-Z_]+)\]",
      r"`\1`",
      result,
  )

  result = re.sub(
      r"\[([a-zA-Z_]+)\]\[([a-zA-Z]+)\.([a-zA-Z_]+)\]",
      r"`\1`",
      result,
  )

  result = re.sub(
      r"\[([a-zA-Z]*)\]",
      r"`\1`",
      result,
  )
  return result


class CustomGenerator(CodeGenerator):
  """Custom generator for Swift codegen.

  Outputs Swift representation of Matter clusters.
  """

  def __init__(self, storage: GeneratorStorage, idl: Idl, **kargs):
    super().__init__(storage, PostProcessIdl(idl))

    if "package" not in kargs:
      # A friendlier message than if we make this a required argument
      logging.error(
          "Missing `package` argument. If using codegen.py, please"
          " provide one via `--option package:...`."
      )
      sys.exit(1)
    self.package_name = kargs["package"]
    self.generate_namespace = kargs.get("generate_namespace", False)

    if "file_comment" in kargs:
      self.file_comment = kargs["file_comment"]
    else:
      self.file_comment = "This file contains machine-generated code."

    if "docs" in kargs:
      self.docs = kargs["docs"]
    else:
      yaml_data = "docs/clusters.yaml"
      with open(yaml_data) as y:
        self.docs = yaml.safe_load(y)

    if "access_level" in kargs:
      self.access_level = kargs["access_level"]
    else:
      self.access_level = "public"

    # Override the template path to use local templates within this plugin
    # directory.
    old_env = self.jinja_env
    self.jinja_env = jinja2.Environment(
        trim_blocks=True,
        lstrip_blocks=True,
        loader=jinja2.FileSystemLoader(searchpath=os.path.dirname(__file__)),
        keep_trailing_newline=True,
    )
    for key, func in old_env.filters.items():
      self.jinja_env.filters[key] = func

    # Type helpers
    self.jinja_env.filters["ToConstFieldName"] = ToConstFieldName
    self.jinja_env.filters["EnumTypeToSwiftEnumType"] = EnumTypeToSwiftEnumType
    self.jinja_env.filters["BitmapTypeToSwiftUIntType"] = (
        BitmapTypeToSwiftUIntType
    )
    self.jinja_env.filters["ToCamelCase"] = ToCamelCase
    self.jinja_env.filters["ToUpperCamelCase"] = ToUpperCamelCase
    self.jinja_env.filters["ToNormalizedSwiftName"] = ToNormalizedSwiftName
    self.jinja_env.tests["IsCommandStruct"] = IsCommandStruct  # pyrefly: ignore[unsupported-operation]
    self.jinja_env.tests["IsCommandOrEmptyStruct"] = IsCommandOrEmptyStruct  # pyrefly: ignore[unsupported-operation]
    self.jinja_env.tests["IsAttributeWritableTest"] = IsAttributeWritable  # pyrefly: ignore[unsupported-operation]
    self.jinja_env.filters["HasWritableAttributes"] = HasWritableAttributes
    self.jinja_env.filters["IsAttributeWritableFilter"] = IsAttributeWritable
    self.jinja_env.filters["lowercase"] = stringcase.lowercase
    self.jinja_env.filters["TypeToDecodeFunction"] = TypeToDecodeFunction
    self.jinja_env.filters["IsTimedInvoke"] = IsTimedInvoke
    self.jinja_env.filters["RequiresTimedWrite"] = RequiresTimedWrite
    self.jinja_env.filters["IsNullable"] = IsNullable
    self.jinja_env.tests["IsOptionalTest"] = IsOptional  # pyrefly: ignore[unsupported-operation]
    self.jinja_env.filters["IsOptionalFilter"] = IsOptional
    self.jinja_env.filters["HasOptionalFields"] = HasOptionalFields
    self.jinja_env.filters["DataTypeToSwiftTypeEnum"] = DataTypeToSwiftTypeEnum
    self.jinja_env.tests["IsTraitType"] = IsTraitType  # pyrefly: ignore[unsupported-operation]

    # Documentation filters
    self.jinja_env.filters["attributeDocType"] = common.AttributeDocType
    self.jinja_env.filters["FormatElementsForJazzy"] = FormatElementsForJazzy
    self.jinja_env.filters["outputAttributeComment"] = (
        common.OutputAttributeComment
    )
    self.jinja_env.filters["showClusterInDocs"] = common.ShowClusterInDocs

    # Builtins
    self.jinja_env.filters["enumerate"] = enumerate

  def internal_render_all(self):
    """Renders the given custom template to the given output filename."""

    # Generate the namespace file.
    if self.generate_namespace:
      self.internal_render_one_output(
          template_path="Namespace.swift.jinja",
          output_file_name=f"{self.package_name}.swift",
          template_vars={
              "package_name": self.package_name,
          },
      )

    # Generate the cluster files.
    for cluster in self.idl.clusters:
      # filter docs to this cluster
      cluster_docs = self.docs.get(cluster.name)

      type_lookup = TypeLookupContext(self.idl, cluster)
      self.jinja_env.filters["FieldToSwiftType"] = FieldToSwiftTypeFactory(
          type_lookup
      )
      self.jinja_env.filters["GetCommandRequest"] = GetCommandRequestFactory(
          type_lookup
      )
      self.jinja_env.filters["GetCommandResponse"] = GetCommandResponseFactory(
          type_lookup
      )
      self.jinja_env.filters["LookupDataType"] = LookupDataTypeFactory(
          type_lookup
      )

      self.internal_render_one_output(
          template_path="Cluster.swift.jinja",
          output_file_name=f"{cluster.name}.swift",
          template_vars={
              "typeLookup": TypeLookupContext(self.idl, cluster),
              "cluster": cluster,
              "docs": cluster_docs,
              "file_comment": self.file_comment,
              "package_name": self.package_name,
              "access_level": self.access_level,
          },
      )
