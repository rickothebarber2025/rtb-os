"""This module provides data post-processing for things loaded from IDL.

In particular it applies patches that are not part of the official data model.
"""
import dataclasses
from typing import Any, Optional

from matter.idl.matter_idl_types import ApiMaturity
from matter.idl.matter_idl_types import Attribute
from matter.idl.matter_idl_types import Bitmap
from matter.idl.matter_idl_types import Cluster
from matter.idl.matter_idl_types import Command
from matter.idl.matter_idl_types import DataType
from matter.idl.matter_idl_types import Enum
from matter.idl.matter_idl_types import Event
from matter.idl.matter_idl_types import Field
from matter.idl.matter_idl_types import FieldQuality
from matter.idl.matter_idl_types import Idl
from matter.idl.matter_idl_types import Struct


_EVENT_LIST_ATTRIBUTE_CODE = 0xFFFA
_FEATURE_MAP_ATTRIBUTE_CODE = 0xFFFC

# List of acronyms that should be replaced with Camel instead of UPPER
# Generally Kotlin wants to have 3+ letter acronyms with lower case rather
# than uppercase
ACRONYMS = [
    "ANSI",
    "BDX",
    "CSR",
    "DAC",
    "HVAC",
    "LED",
    "IEC",
    "IPK",
    "MAC",
    "MLE",
    "NFC",
    "NOC",
    "OTA",
    "PAI",
    "PAKE",
    "PHY",
    "PIN",
    "PIR",
    "RFID",
    "URL",
    "UTC",
]


def _UpdateAcronymsInString(s: Optional[str]) -> Optional[str]:
  if not s:
    return s

  for a in [a for a in ACRONYMS if a in s]:
    s = s.replace(a, a[0] + a[1:].lower())

  return s


def _UpdateAcronymsInName(item: Any) -> Any:
  """Replaces item.name with an acronym-updated one.

  Uses dataclasses replacing.

  Args:
    item: the item whose name to inspect and potentially replace

  Returns:
    the item with a potentially updated `name`
  """
  updated_name = _UpdateAcronymsInString(item.name)

  if updated_name == item.name:
    return item

  return dataclasses.replace(item, name=updated_name)


def _UpdateAcronymsInField(f: Field) -> Field:
  return _UpdateAcronymsInName(
      dataclasses.replace(f, data_type=_UpdateAcronymsInName(f.data_type))
  )


def _OptionalCopyOf(attribute: Attribute) -> Attribute:
  """Returns a clone of the given attribute, with the optional quality set."""
  return dataclasses.replace(
      attribute,
      definition=dataclasses.replace(
          attribute.definition,
          qualities=attribute.definition.qualities | FieldQuality.OPTIONAL,
      ),
  )


def _GetFeatureMapType(cluster: Cluster) -> Optional[DataType]:
  """Finds the feature map data type of the given cluster if it exists."""
  # The feature map is expected to be a bitmap named <ClusterName>Feature

  # Accept both generic "Feature" and "<Cluster>Feature" for the feature
  # bitmap naming. The logic here had some back and forth across time
  #
  # Eventually we may want to end up as "Feature" only.
  expected_names = {"Feature", f"{cluster.name}Feature"}

  for e in cluster.bitmaps:
    if (e.name in expected_names) and (e.base_type.lower() == "bitmap32"):
      return DataType(name=e.name)

  return None


def _PostProcessEvent(e: Event) -> Event:
  return _UpdateAcronymsInName(
      dataclasses.replace(
          e, fields=[_UpdateAcronymsInField(v) for v in e.fields]
      )
  )


def _PostProcessEnum(e: Enum) -> Enum:
  return _UpdateAcronymsInName(
      dataclasses.replace(
          e, entries=[_UpdateAcronymsInName(v) for v in e.entries]
      )
  )


def _PostProcessStruct(s: Struct) -> Struct:
  return _UpdateAcronymsInName(
      dataclasses.replace(
          s, fields=[_UpdateAcronymsInField(v) for v in s.fields]
      )
  )


def _PostProcessBitmap(b: Bitmap) -> Bitmap:
  return _UpdateAcronymsInName(
      dataclasses.replace(
          b, entries=[_UpdateAcronymsInName(v) for v in b.entries]
      )
  )


def _PostProcessCommand(c: Command) -> Command:
  return _UpdateAcronymsInName(
      dataclasses.replace(
          c,
          input_param=_UpdateAcronymsInString(c.input_param),
          output_param=_UpdateAcronymsInString(c.output_param),  # pyrefly: ignore[bad-argument-type]
      )
  )


def _PostProcessAttribute(attribute: Attribute, cluster: Cluster) -> Attribute:
  """Modify data within an attribute of the given cluster with google3-specific settings.

  Args:
    attribute: the attribute to modify
    cluster: the cluster to which the attribute belongs

  Returns:
    A modified copy of the input attribute
  """

  attribute = dataclasses.replace(
      attribute,
      definition=_UpdateAcronymsInField(attribute.definition),
  )

  if (
      attribute.definition.code == _FEATURE_MAP_ATTRIBUTE_CODE
      and attribute.definition.data_type.name.lower() == "bitmap32"
  ):
    # global attributes in MATTER SDK/ZAP are generally single-typed so
    # even though a feature enum may be defined, it is generally untyped
    # in the IDL. Here we add types.
    feature_map_data_type = _GetFeatureMapType(cluster)
    if feature_map_data_type:
      return dataclasses.replace(
          attribute,
          definition=dataclasses.replace(
              attribute.definition, data_type=feature_map_data_type
          ),
      )

  if cluster.code == 0xFFF1FC05:  # Unit testing cluster
    if attribute.definition.code in {0x31, 0x32}:
      # The cluster defines global_error_boolean and cluster_error_boolean
      # that explicitly error out when read or written too.
      # In practice this means we can NOT read them, so we allow these optional
      return _OptionalCopyOf(attribute)

  return attribute


def _PostProcessCluster(cluster: Cluster) -> Cluster:
  """Modify data within a cluster with google3-specific settings."""
  has_feature_map = any(
      a.definition.code == _FEATURE_MAP_ATTRIBUTE_CODE
      for a in cluster.attributes
  )
  bitmaps = list(cluster.bitmaps)
  if has_feature_map:
    expected_names = {"Feature", f"{cluster.name}Feature"}
    has_feature_bitmap = any(b.name in expected_names for b in bitmaps)
    if not has_feature_bitmap:
      bitmaps.append(Bitmap(name="Feature", base_type="bitmap32", entries=[]))

  cluster = dataclasses.replace(cluster, bitmaps=bitmaps)

  return dataclasses.replace(
      cluster,
      attributes=[
          # Remove the eventList attribute since it is not supported well in
          # Matter, and is currently marked provisional.
          _PostProcessAttribute(a, cluster)
          for a in cluster.attributes
          if a.definition.code != _EVENT_LIST_ATTRIBUTE_CODE
      ],
      events=[_PostProcessEvent(e) for e in cluster.events],
      enums=[_PostProcessEnum(e) for e in cluster.enums],
      structs=[_PostProcessStruct(s) for s in cluster.structs],
      bitmaps=[_PostProcessBitmap(b) for b in cluster.bitmaps],
      commands=[_PostProcessCommand(c) for c in cluster.commands],
  )


def PostProcessIdl(idl: Idl) -> Idl:
  """Add google3 specific modifications to a given IDL.

  Args:
     idl: the idl to post-process. This is NOT modified.

  Returns:
     The processed IDL. A new IDL is returned (original IDL is considered
     immutable)
  """
  return dataclasses.replace(
      idl,
      clusters=[
          _PostProcessCluster(c)
          for c in idl.clusters
          # Omit provisional clusters from internal/external consumption since
          # they can still change.
          if c.api_maturity != ApiMaturity.PROVISIONAL
      ],
  )
