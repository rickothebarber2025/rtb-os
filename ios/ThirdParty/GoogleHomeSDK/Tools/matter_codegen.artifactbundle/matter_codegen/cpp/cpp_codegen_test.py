"""Unit tests of codegen primitives."""

import dataclasses
import textwrap
import unittest

from common import casing
import google_home_codegen.cpp as codegen
from matter.idl.generators.type_definitions import __CHIP_SIZED_TYPES__
from matter.idl.generators.type_definitions import ParseDataType
from matter.idl.matter_idl_types import AttributeQuality
from matter.idl.matter_idl_types import DataType
from matter.idl.matter_idl_types import Field
from matter.idl.matter_idl_types import FieldQuality
from matter.idl.matter_idl_types import Idl

DATA_TYPES = {
    "bool": DataType("boolean"),
    "int8_t": DataType("int8s"),
    "int16_t": DataType("int16s"),
    "int32_t": DataType("int32s"),
    "int64_t": DataType("int64s"),
    "uint8_t": DataType("int8u"),
    "uint16_t": DataType("int16u"),
    "uint32_t": DataType("int32u"),
    "uint64_t": DataType("int64u"),
    "float": DataType("single"),
    "double": DataType("double"),
    "std::string": DataType("char_string"),
}


@dataclasses.dataclass
class TestEntry:
  field: Field
  cpp_type: str


FIELDS_TEST_VECTOR = [
    TestEntry(Field(DATA_TYPES["std::string"], 1, "name"), "std::string"),
    TestEntry(Field(DATA_TYPES["uint32_t"], 2, "age"), "uint32_t"),
    TestEntry(Field(DATA_TYPES["bool"], 3, "is_active"), "bool"),
    TestEntry(
        Field(
            DATA_TYPES["float"], 5, "height", qualities=FieldQuality.OPTIONAL
        ),
        "float",
    ),
    TestEntry(
        Field(
            DATA_TYPES["double"], 6, "height", qualities=FieldQuality.NULLABLE
        ),
        "double",
    ),
]

FIELD_INT32U = codegen.Field(
    name="attr_int32u",
    data_type=codegen.DataType(name="int32u"),
    code=1,
)

FIELD_INT32U_NULLABLE = codegen.Field(
    name="attr_int32u",
    data_type=codegen.DataType(name="int32u"),
    qualities=FieldQuality.NULLABLE,
    code=1,
)

FIELD_INT32U_OPTIONAL = codegen.Field(
    name="attr_int32u",
    data_type=codegen.DataType(name="int32u"),
    qualities=FieldQuality.OPTIONAL,
    code=1,
)

FIELD_INT32U_OPTIONAL_NULLABLE = codegen.Field(
    name="attr_int32u",
    data_type=codegen.DataType(name="int32u"),
    qualities=FieldQuality.OPTIONAL | FieldQuality.NULLABLE,
    code=1,
)

FIELD_STRING = codegen.Field(
    name="attr_string",
    data_type=codegen.DataType(name="char_string"),
    code=1,
)

ATTR_INT32U_NON_WRITABLE = codegen.Attribute(
    definition=FIELD_INT32U,
)

ATTR_INT32U_WRITABLE = codegen.Attribute(
    definition=FIELD_INT32U,
    qualities=AttributeQuality.WRITABLE,
)

ATTR_STRING_WRITABLE = codegen.Attribute(
    definition=FIELD_STRING,
    qualities=AttributeQuality.WRITABLE,
)

ATTR_BOOL_WRITABLE = codegen.Attribute(
    definition=codegen.Field(
        name="attr_bool",
        data_type=codegen.DataType(name="boolean"),
        code=1,
    ),
    qualities=AttributeQuality.WRITABLE,
)

ATTR_FLOAT_WRITABLE = codegen.Attribute(
    definition=codegen.Field(
        name="attr_float",
        data_type=codegen.DataType(name="single"),
        code=1,
    ),
    qualities=AttributeQuality.WRITABLE,
)

ATTR_DOUBLE_WRITABLE = codegen.Attribute(
    definition=codegen.Field(
        name="attr_double",
        data_type=codegen.DataType(name="double"),
        code=1,
    ),
    qualities=AttributeQuality.WRITABLE,
)

ATTR_LIST_WRITABLE = codegen.Attribute(
    definition=codegen.Field(
        name="TestAttribute",
        data_type=codegen.DataType(name="int32u"),
        code=1,
        is_list=True,
    ),
    qualities=AttributeQuality.WRITABLE,
)

ATTR_STRUCT_WRITABLE = codegen.Attribute(
    definition=codegen.Field(
        name="attr_struct",
        data_type=codegen.DataType(name="TestStruct"),
        code=1,
    ),
    qualities=AttributeQuality.WRITABLE,
)

ATTR_STRUCT_NON_WRITABLE = codegen.Attribute(
    definition=codegen.Field(
        name="attr_struct",
        data_type=codegen.DataType(name="TestStruct"),
        code=1,
    ),
)

TEST_CLUSTER = codegen.Cluster(
    name="TestCluster",
    code=0x0001,
    attributes=[ATTR_INT32U_WRITABLE, ATTR_STRUCT_WRITABLE],
    structs=[
        codegen.Struct(
            name="TestStruct",
            code=1,
            fields=[
                codegen.Field(
                    name="field1",
                    data_type=codegen.DataType(name="int32u"),
                    code=1,
                ),
                codegen.Field(
                    name="field2",
                    data_type=codegen.DataType(name="int32u"),
                    code=2,
                ),
            ],
        )
    ],
)

TYPE_LOOKUP = codegen.TypeLookupContext(
    Idl(),
    TEST_CLUSTER,
)


class CodegenTests(unittest.TestCase):

  def test_ToCppBaseType(self):
    for expected, value in DATA_TYPES.items():
      idl_type = ParseDataType(value, TYPE_LOOKUP)
      cpp_type = codegen._ToCppBaseType(idl_type)
      self.assertEqual(expected, cpp_type)

  def test_ToCppReadWidth(self):
    k_test_vector = {
        "int8s": 32,
        "int16s": 32,
        "int32s": 32,
        "int64s": 64,
        "int8u": 32,
        "int16u": 32,
        "int32u": 32,
        "int64u": 64,
        "bitmap8": 32,
        "bitmap16": 32,
        "bitmap32": 32,
        "bitmap64": 64,
        "enum8": 32,
        "enum16": 32,
    }
    for chip_type, expected in k_test_vector.items():
      basic_int = __CHIP_SIZED_TYPES__[chip_type]

      type_width = codegen._ToCppReadWidth(basic_int)
      self.assertEqual(expected, type_width)

      list_width = codegen._ToCppReadWidth(basic_int, is_list=True)
      expected_list_width = basic_int.bits
      self.assertEqual(expected_list_width, list_width)

  def test_ToHex(self):
    self.assertEqual(codegen.ToHex(0), "0")
    self.assertEqual(codegen.ToHex(1), "1")
    self.assertEqual(codegen.ToHex(0x1A), "1a")
    self.assertEqual(codegen.ToHex(0x1A, 16), "001a")
    self.assertEqual(codegen.ToHex(0x1A, 32), "0000001a")
    with self.assertRaises(ValueError):
      codegen.ToHex(0xFFFFFF, 48)

  def test_ToVendorId(self):
    self.assertEqual(codegen.ToVendorId(0xFFFF0100), 0xFFFF)

  def test_ToMeiSuffix(self):
    self.assertEqual(codegen.ToMeiSuffix(0xFFFF0100), 0x0100)

  def test_ToTraitId(self):
    cluster = codegen.Cluster(code=0x0001, name="TestCluster")
    self.assertEqual(
        codegen.ToTraitId(cluster), "home.matter.0000.clusters.0001"
    )
    cluster = codegen.Cluster(code=0xFFFF0001, name="TestMeiCluster")
    self.assertEqual(
        codegen.ToTraitId(cluster), "home.matter.ffff.clusters.0001"
    )

  def test_ToEnumEntryName(self):
    self.assertEqual(codegen.ToEnumEntryName("kOnOff", "OnOff"), "OnOff_OnOff")

  def test_ToEnum(self):
    self.assertEqual(codegen.ToEnum("Simple"), "SimpleEnum")
    self.assertEqual(codegen.ToEnum("SimpleEnum"), "SimpleEnum")
    self.assertEqual(
        codegen.ToEnum("Simple", "namespace::"), "namespace::SimpleEnum"
    )
    self.assertEqual(
        codegen.ToEnum("SimpleEnum", "namespace::"), "namespace::SimpleEnum"
    )

  def test_ToBitmap(self):
    self.assertEqual(codegen.ToBitmap("Simple"), "SimpleBitmap")
    self.assertEqual(codegen.ToBitmap("SimpleBitmap"), "SimpleBitmap")
    self.assertEqual(
        codegen.ToBitmap("Simple", "namespace::"),
        "namespace::SimpleBitmap",
    )
    self.assertEqual(
        codegen.ToBitmap("SimpleBitmap", "namespace::"),
        "namespace::SimpleBitmap",
    )

  def test_ToCommandName(self):
    self.assertEqual(
        codegen.ToCommandName(
            codegen.Command(
                name="Simple", code=1, input_param=None, output_param=""
            ),
            codegen.Cluster(name="Test", code=0xFFFF),
        ),
        "Simple",
    )
    self.assertEqual(
        codegen.ToCommandName(
            codegen.Command(
                name="Simple", code=1, input_param=None, output_param=""
            ),
            codegen.Cluster(name="Simple", code=0xFFFF),
        ),
        "SimpleCommand",
    )

  def test_ToBitmapAdapter(self):
    self.assertEqual(codegen.ToBitmapAdapter("Simple"), "SimpleBitmapAdapter")
    self.assertEqual(
        codegen.ToBitmapAdapter("SimpleBitmap"), "SimpleBitmapAdapter"
    )
    self.assertEqual(
        codegen.ToBitmapAdapter("Simple", "namespace::"),
        "namespace::SimpleBitmapAdapter",
    )
    self.assertEqual(
        codegen.ToBitmapAdapter("SimpleBitmap", "namespace::"),
        "namespace::SimpleBitmapAdapter",
    )

  def test_ToUpperCamelCase(self):
    self.assertEqual(casing.ToUpperCamelCase("simple"), "Simple")
    self.assertEqual(casing.ToUpperCamelCase("On/Off"), "OnOff")
    self.assertEqual(casing.ToUpperCamelCase("Door Lock"), "DoorLock")
    self.assertEqual(
        casing.ToUpperCamelCase("Simple_Name"),
        "SimpleName",
    )

  def test_RemoveConstantPrefix(self):
    self.assertEqual(codegen.RemoveConstantPrefix("kConstant"), "Constant")
    with self.assertRaises(ValueError):
      codegen.RemoveConstantPrefix("Constant")

  def test_ToFieldType(self):
    self.assertEqual(
        codegen.ToFieldType(TYPE_LOOKUP, FIELD_INT32U),
        "Mandatory<uint32_t>",
    )
    self.assertEqual(
        codegen.ToFieldType(TYPE_LOOKUP, FIELD_INT32U_NULLABLE),
        "Nullable<uint32_t>",
    )
    self.assertEqual(
        codegen.ToFieldType(TYPE_LOOKUP, FIELD_INT32U_OPTIONAL),
        "Optional<uint32_t>",
    )
    self.assertEqual(
        codegen.ToFieldType(TYPE_LOOKUP, FIELD_INT32U_OPTIONAL_NULLABLE),
        "OptionalNullable<uint32_t>",
    )
    self.assertEqual(
        codegen.ToFieldType(TYPE_LOOKUP, FIELD_STRING),
        "Mandatory<std::string>",
    )

  def test_ToFieldArgs(self):
    fields = [
        codegen.Field(
            name="field1",
            data_type=codegen.DataType(name="int32u"),
            code=1,
        ),
        codegen.Field(
            name="field2",
            data_type=codegen.DataType(name="int32u"),
            code=2,
        ),
    ]
    self.assertEqual(
        codegen.ToFieldArgs(fields),
        "field1,field2",
    )

  def test_ToFieldKeywordArgs(self):
    fields = [
        codegen.Field(
            name="field1",
            data_type=codegen.DataType(name="int32u"),
            code=1,
        ),
        codegen.Field(
            name="field2",
            data_type=codegen.DataType(name="int32u"),
            code=2,
        ),
    ]
    self.assertEqual(
        codegen.ToFieldKeywordArgs(fields),
        "field1=field1,field2=field2",
    )

  def test_ToWritableAttrArgs_Single(self):
    # Alter this test to use the new codegen.Attribute class.
    fields = [
        codegen.Attribute(
            definition=codegen.Field(
                name="field1",
                data_type=codegen.DataType(name="int32u"),
                code=1,
            ),
            qualities=AttributeQuality.NONE,
        ),
        codegen.Attribute(
            definition=codegen.Field(
                name="field2",
                data_type=codegen.DataType(name="int32u"),
                code=2,
            ),
            qualities=AttributeQuality.WRITABLE,
        ),
    ]
    self.assertEqual(
        codegen.ToWritableAttrArgs(fields),
        "field2",
    )

  def test_ToWritableAttrArgs_Multiple(self):
    # Alter this test to use the new codegen.Attribute class.
    fields = [
        codegen.Attribute(
            definition=codegen.Field(
                name="field1",
                data_type=codegen.DataType(name="int32u"),
                code=1,
            ),
            qualities=AttributeQuality.NONE,
        ),
        codegen.Attribute(
            definition=codegen.Field(
                name="field2",
                data_type=codegen.DataType(name="int32u"),
                code=2,
            ),
            qualities=AttributeQuality.WRITABLE,
        ),
        codegen.Attribute(
            definition=codegen.Field(
                name="field3",
                data_type=codegen.DataType(name="int32u"),
                code=3,
            ),
            qualities=AttributeQuality.WRITABLE,
        ),
    ]
    self.assertEqual(
        codegen.ToWritableAttrArgs(fields),
        "field2,field3",
    )

  def test_ToWritableAttrKeywordArgs_Single(self):
    fields = [
        codegen.Attribute(
            definition=codegen.Field(
                name="field1",
                data_type=codegen.DataType(name="int32u"),
                code=1,
            ),
            qualities=AttributeQuality.NONE,
        ),
        codegen.Attribute(
            definition=codegen.Field(
                name="field2",
                data_type=codegen.DataType(name="int32u"),
                code=2,
            ),
            qualities=AttributeQuality.WRITABLE,
        ),
    ]
    self.assertEqual(
        codegen.ToWritableAttrKeywordArgs(fields),
        "field2=field2",
    )

  def test_ToWritableAttrKeywordArgs_Multiple(self):
    fields = [
        codegen.Attribute(
            definition=codegen.Field(
                name="field1",
                data_type=codegen.DataType(name="int32u"),
                code=1,
            ),
            qualities=AttributeQuality.NONE,
        ),
        codegen.Attribute(
            definition=codegen.Field(
                name="field2",
                data_type=codegen.DataType(name="int32u"),
                code=2,
            ),
            qualities=AttributeQuality.WRITABLE,
        ),
        codegen.Attribute(
            definition=codegen.Field(
                name="field3",
                data_type=codegen.DataType(name="int32u"),
                code=3,
            ),
            qualities=AttributeQuality.WRITABLE,
        ),
    ]
    self.assertEqual(
        codegen.ToWritableAttrKeywordArgs(fields),
        "field2=field2,field3=field3",
    )

  def test_OutputsClickType_ForInt32Attribute(self):
    self.assertEqual(
        codegen.ToClickType(TYPE_LOOKUP, ATTR_INT32U_WRITABLE.definition),
        "int",
    )

  def test_OutputsClickType_ForStringAttribute(self):
    self.assertEqual(
        codegen.ToClickType(TYPE_LOOKUP, ATTR_STRING_WRITABLE.definition),
        "str",
    )

  def test_OutputsClickType_ForBooleanAttribute(self):
    self.assertEqual(
        codegen.ToClickType(TYPE_LOOKUP, ATTR_BOOL_WRITABLE.definition),
        "bool",
    )

  def test_OutputsClickType_ForFloatAttribute(self):
    self.assertEqual(
        codegen.ToClickType(TYPE_LOOKUP, ATTR_FLOAT_WRITABLE.definition),
        "float",
    )

  def test_OutputsClickType_ForDoubleAttribute(self):
    self.assertEqual(
        codegen.ToClickType(TYPE_LOOKUP, ATTR_DOUBLE_WRITABLE.definition),
        "float",
    )


class CodegenToGrpcFieldInitializerTests(unittest.TestCase):

  def test_OutputsExpectedCode_ForNonNullableField(self):
    self.assertEqual(
        textwrap.dedent(
            codegen.ToGrpcFieldInitializer(
                codegen.Field(
                    name="TestAttribute",
                    data_type=codegen.DataType(name="int32u"),
                    code=1,
                ),
                TYPE_LOOKUP,
            )
        ),
        textwrap.dedent("""
            if (grpc_request->parameters().has_test_attribute()) {
              test_attribute = grpc_request->parameters().test_attribute();
            }"""),
    )

  def test_OutputsExpectedCode_ForNullableField(self):
    self.assertEqual(
        textwrap.dedent(
            codegen.ToGrpcFieldInitializer(
                codegen.Field(
                    name="TestAttribute",
                    data_type=codegen.DataType(name="int32u"),
                    code=1,
                    qualities=FieldQuality.NULLABLE,
                ),
                TYPE_LOOKUP,
            )
        ),
        textwrap.dedent("""
            if (grpc_request->parameters().has_test_attribute()) {

              if (grpc_request->parameters().test_attribute_is_null()) {
                test_attribute = std::nullopt;
              } else {
                test_attribute = grpc_request->parameters().test_attribute();
              }
            }"""),
    )

  def test_OutputsNoCode_ForListField(self):
    self.assertEqual(
        codegen.ToGrpcFieldInitializer(
            codegen.Field(
                name="TestAttribute",
                data_type=codegen.DataType(name="int32u"),
                is_list=True,
                code=1,
            ),
            TYPE_LOOKUP,
        ),
        "",
    )

  def test_OutputsNoCode_ForStructField(self):
    self.assertEqual(
        codegen.ToGrpcFieldInitializer(
            ATTR_STRUCT_WRITABLE.definition,
            TYPE_LOOKUP,
        ),
        "",
    )


class CodegenSerializerTypeTests(unittest.TestCase):

  def test_SerializerWriteField(self):
    k_test_vector = [
        ("int8u", "WriteUInt"),
        ("int16u", "WriteUInt"),
        ("int32u", "WriteUInt"),
        ("int64u", "WriteUInt"),
        ("int8s", "WriteInt"),
        ("int16s", "WriteInt"),
        ("int32s", "WriteInt"),
        ("int64s", "WriteInt"),
        ("bool", "WriteBool"),
        ("float", "WriteFloat"),
        ("double", "WriteDouble"),
    ]

    for chip_type, write_method in k_test_vector:
      expected = f"writer.{write_method}(kTagTestAttribute, test_attribute)"
      actual = codegen.SerializerWriteField(
          TYPE_LOOKUP,
          codegen.Field(
              name="TestAttribute",
              data_type=codegen.DataType(name=chip_type),
              code=1,
          ),
      )
      self.assertEqual(actual, expected)

  def test_SerializerReadField(self):
    k_test_vector = [
        ("int32u", "ReadUInt32"),
        ("int32s", "ReadInt32"),
        ("bool", "ReadBool"),
        ("float", "ReadFloat"),
        ("double", "ReadDouble"),
    ]

    for chip_type, read_method in k_test_vector:
      expected = (
          f"auto test_attribute = reader.{read_method}(kTagTestAttribute);if"
          " (test_attribute.ok()){ test_attribute = test_attribute.value();}"
      )
      actual = codegen.SerializerReadField(
          TYPE_LOOKUP,
          codegen.Field(
              name="TestAttribute",
              data_type=codegen.DataType(name=chip_type),
              code=1,
          ),
      )
      self.assertEqual(actual, expected)


class CodegenToGrpcServiceAttributeAccessorTests(unittest.TestCase):

  def test_ToGrpcServiceAttributeGet_NonWritableField(self):
    self.assertEqual(
        textwrap.dedent(
            codegen.ToGrpcServiceAttributeGet(
                TYPE_LOOKUP,
                codegen.Attribute(
                    definition=codegen.Field(
                        name="TestAttribute",
                        data_type=codegen.DataType(name="int32u"),
                        code=1,
                    ),
                    qualities=AttributeQuality.NONE,
                ),
                codegen.Cluster(
                    name="TestCluster",
                    code=0x0001,
                    attributes=[
                        codegen.Attribute(
                            definition=codegen.Field(
                                name="TestAttribute",
                                data_type=codegen.DataType(name="int32u"),
                                code=1,
                            ),
                        )
                    ],
                ),
            )
        ),
        textwrap.dedent("""
            if (attributes.test_attribute.has_value()) {
              grpc_response->mutable_value()->set_test_attribute(attributes.test_attribute.value());
            }"""),
    )

  def test_ToGrpcServiceAttributeSet_NonWritableField(self):
    self.assertEqual(
        codegen.ToGrpcServiceAttributeSet(
            TYPE_LOOKUP,
            ATTR_INT32U_NON_WRITABLE,
            TEST_CLUSTER,
        ),
        "",
    )

  def test_ToGrpcServiceAttributeSet_WritableField(self):
    self.assertEqual(
        textwrap.dedent(
            codegen.ToGrpcServiceAttributeSet(
                TYPE_LOOKUP,
                ATTR_INT32U_WRITABLE,
                TEST_CLUSTER,
            )
        ),
        textwrap.dedent("""
            if (grpc_request->value().has_attr_int32u()) {
              attributes.attr_int32u = grpc_request->value().attr_int32u();
            }"""),
    )

  def test_ToGrpcServiceAttributeGet_List(self):
    self.assertEqual(
        textwrap.dedent(
            codegen.ToGrpcServiceAttributeGet(
                TYPE_LOOKUP,
                ATTR_LIST_WRITABLE,
                codegen.Cluster(
                    name="TestCluster",
                    code=0x0001,
                    attributes=[
                        ATTR_LIST_WRITABLE,
                    ],
                ),
            )
        ),
        textwrap.dedent("""
      if (attributes.writable.test_attribute.has_value()) {
        grpc_response->mutable_value()->clear_test_attribute();
        for (const auto& entry : attributes.writable.test_attribute.value()) {
          grpc_response->mutable_value()->add_test_attribute(entry);
        }
      }"""),
    )

  def test_ToGrpcServiceAttributeSet_List(self):
    self.assertEqual(
        textwrap.dedent(
            codegen.ToGrpcServiceAttributeSet(
                TYPE_LOOKUP,
                ATTR_LIST_WRITABLE,
                codegen.Cluster(
                    name="TestCluster",
                    code=0x0001,
                    attributes=[
                        ATTR_LIST_WRITABLE,
                    ],
                ),
            )
        ),
        textwrap.dedent(
            """if (!grpc_request->value().test_attribute().empty()) {
            attributes.test_attribute = {
                grpc_request->value().test_attribute().begin(),
                grpc_request->value().test_attribute().end()
            };
          }"""
        ),
    )

  def test_ToGrpcServiceAttributeSet_StructNonWritable(self):
    self.assertEqual(
        codegen.ToGrpcServiceAttributeSet(
            TYPE_LOOKUP,
            ATTR_STRUCT_NON_WRITABLE,
            TEST_CLUSTER,
        ),
        "",
    )

  def test_ToGrpcServiceAttributeSet_Struct(self):
    self.assertEqual(
        codegen.ToGrpcServiceAttributeSet(
            TYPE_LOOKUP,
            ATTR_STRUCT_WRITABLE,
            TEST_CLUSTER,
        ),
        textwrap.dedent("""if (grpc_request->value().has_attr_struct()) {
        attributes.attr_struct->SetStruct(
          [&src = grpc_request->value().attr_struct()](
              google_home_api::traits::matter::TestClusterTrait::
                  TestStruct& dest) { DecodeFromGrpc(src, dest); });
      }"""),
    )

  def test_ToGrpcServiceAttributeGet_Struct(self):
    self.assertEqual(
        codegen.ToGrpcServiceAttributeGet(
            TYPE_LOOKUP,
            ATTR_STRUCT_WRITABLE,
            TEST_CLUSTER,
        ),
        textwrap.dedent("""if (attributes.writable.attr_struct.has_value()) {
        EncodeToGrpc(
          attributes.writable.attr_struct->GetStruct(),
          *grpc_response->mutable_value()->mutable_attr_struct());
      }"""),
    )

  def test_FieldIsBasicType(self):
    self.assertTrue(
        codegen.FieldIsBasicType(
            TYPE_LOOKUP,
            codegen.Field(
                name="TestAttribute",
                data_type=codegen.DataType(name="int32u"),
                code=1,
            ),
        )
    )
    self.assertFalse(
        codegen.FieldIsBasicType(
            TYPE_LOOKUP,
            codegen.Field(
                name="TestAttribute",
                data_type=codegen.DataType(name="TestStruct"),
                code=1,
            ),
        )
    )
    self.assertFalse(
        codegen.FieldIsBasicType(
            TYPE_LOOKUP,
            codegen.Field(
                name="TestAttribute",
                data_type=codegen.DataType(name="enum8"),
                code=1,
            ),
        )
    )
    self.assertFalse(
        codegen.FieldIsBasicType(
            TYPE_LOOKUP,
            codegen.Field(
                name="TestAttribute",
                data_type=codegen.DataType(name="bitmap16"),
                code=1,
            ),
        )
    )
    self.assertFalse(
        codegen.FieldIsBasicType(
            TYPE_LOOKUP,
            codegen.Field(
                name="TestAttribute",
                is_list=True,
                data_type=codegen.DataType(name="int32u"),
                code=1,
            ),
        )
    )


class CodegenIsAttributeEqualTests(unittest.TestCase):
  """Test the codegen.IsAttributeEqual function for various types.

  The code output assumes that the lhs and rhs are provided as
  Attribute arguments for comparison.
  """

  def test_OutputsComparisonCode_ForNonWritableIntegerAttribute(self):
    """Test the non-writable int32_t attributecomparison (operator==)."""
    self.assertEqual(
        codegen.IsAttributeEqual(
            TYPE_LOOKUP,
            codegen.Attribute(
                definition=codegen.Field(
                    name="attr_int32u",
                    data_type=codegen.DataType(name="int32u"),
                    code=1,
                ),
            ),
        ),
        "if (lhs.attr_int32u != rhs.attr_int32u) return false;",
    )

  def test_OutputsComparisonCode_ForWritableIntegerAttribute(self):
    """Test the writable int32_t attribute comparison (operator==)."""
    self.assertEqual(
        codegen.IsAttributeEqual(
            TYPE_LOOKUP,
            codegen.Attribute(
                definition=codegen.Field(
                    name="attr_int32u",
                    data_type=codegen.DataType(name="int32u"),
                    code=1,
                ),
                qualities=AttributeQuality.WRITABLE,
            ),
        ),
        "if (lhs.writable.attr_int32u != rhs.writable.attr_int32u) return"
        " false;",
    )

  def test_OutputsComparisonCode_ForIntegerListAttribute(self):
    """Test the vector<int32_t> attribute comparison (operator==)."""
    self.assertEqual(
        codegen.IsAttributeEqual(
            TYPE_LOOKUP,
            codegen.Attribute(
                definition=codegen.Field(
                    name="attr_int32u",
                    data_type=codegen.DataType(name="int32u"),
                    is_list=True,
                    code=1,
                ),
                qualities=AttributeQuality.WRITABLE,
            ),
        ),
        "if (lhs.writable.attr_int32u != rhs.writable.attr_int32u) return"
        " false;",
    )

  def test_OutputsNoComparisonCode_ForStructAttribute(self):
    """Test struct attribute comparison (operator==)."""
    self.assertEqual(
        codegen.IsAttributeEqual(
            TYPE_LOOKUP,
            ATTR_STRUCT_WRITABLE,
        ),
        "",
    )


class CodegenToCodecTypeTests(unittest.TestCase):
  """Test the codegen.ToCodecType function for various types.

  The output should be the "CodecType" or the proper API suffix for
  the `CodecWriter::Write*` and `CodecReader::Read*` methods for the type
  of the given field.

  Examples:
    - C++ type `int32_t` -> `CodecWriter::WriteUInt`
    - C++ type `float` -> `CodecWriter::ReadFloat`
  """

  def test_OutputsCodecType_ForBooleanField(self):
    """Verify the codec type for a boolean field."""
    self.assertEqual(
        codegen.ToCodecType(
            TYPE_LOOKUP,
            codegen.Field(
                name="TestAttribute",
                data_type=codegen.DataType(name="boolean"),
                code=1,
            ),
        ),
        "Bool",
    )

  def test_OutputsCodecType_ForUInt32Field(self):
    """Verify the codec type for a unsigned integer field."""
    self.assertEqual(
        codegen.ToCodecType(
            TYPE_LOOKUP,
            codegen.Field(
                name="TestAttribute",
                data_type=codegen.DataType(name="int32u"),
                code=1,
            ),
        ),
        "UInt32",
    )

  def test_OutputsCodecType_ForUInt64Field(self):
    """Verify the codec type for a unsigned long field."""
    self.assertEqual(
        codegen.ToCodecType(
            TYPE_LOOKUP,
            codegen.Field(
                name="TestAttribute",
                data_type=codegen.DataType(name="int64u"),
                code=1,
            ),
        ),
        "UInt64",
    )

  def test_OutputsCodecType_ForInt32Field(self):
    """Verify the codec type for a signed integer field."""
    self.assertEqual(
        codegen.ToCodecType(
            TYPE_LOOKUP,
            codegen.Field(
                name="TestAttribute",
                data_type=codegen.DataType(name="int32s"),
                code=1,
            ),
        ),
        "Int32",
    )

  def test_OutputsCodecType_ForInt64Field(self):
    """Verify the codec type for a signed long field."""
    self.assertEqual(
        codegen.ToCodecType(
            TYPE_LOOKUP,
            codegen.Field(
                name="TestAttribute",
                data_type=codegen.DataType(name="int64s"),
                code=1,
            ),
        ),
        "Int64",
    )

  def test_OutputsCodecType_ForFloatField(self):
    """Verify the codec type for a float field."""
    self.assertEqual(
        codegen.ToCodecType(
            TYPE_LOOKUP,
            codegen.Field(
                name="TestAttribute",
                data_type=codegen.DataType(name="single"),
                code=1,
            ),
        ),
        "Float",
    )

  def test_OutputsCodecType_ForDoubleField(self):
    """Verify the codec type for a double field."""
    self.assertEqual(
        codegen.ToCodecType(
            TYPE_LOOKUP,
            codegen.Field(
                name="TestAttribute",
                data_type=codegen.DataType(name="double"),
                code=1,
            ),
        ),
        "Double",
    )

  def test_OutputsCodecType_ForStructField(self):
    """Verify the codec type for a struct field."""
    self.assertEqual(
        codegen.ToCodecType(
            TYPE_LOOKUP,
            ATTR_STRUCT_WRITABLE.definition,
        ),
        "TestStruct",
    )


if __name__ == "__main__":
  unittest.main()
