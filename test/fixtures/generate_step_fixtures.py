"""Generate real XCAF STEP fixtures; no JSON or mesh substitutes are used."""

from pathlib import Path

from OCP.BRep import BRep_Builder
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCP.IFSelect import IFSelect_ReturnStatus
from OCP.Interface import Interface_Static
from OCP.STEPCAFControl import STEPCAFControl_Writer
from OCP.TCollection import TCollection_ExtendedString
from OCP.TDataStd import TDataStd_Name
from OCP.TDocStd import TDocStd_Document
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS_Compound
from OCP.XCAFDoc import XCAFDoc_DocumentTool
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec


UNIT_TO_METRES = {
    "millimetre": 0.001,
    "metre": 1.0,
    "inch": 0.0254,
}


def _write_xcaf_assembly(target: Path, name: str, parts: list[tuple[str, object, tuple[float, float, float]]], unit_metres: float = 0.001) -> Path:
    scale = 1.0 / unit_metres
    document = TDocStd_Document(TCollection_ExtendedString("XmlXCAF"))
    XCAFDoc_DocumentTool.SetLengthUnit_s(document, unit_metres)
    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(document.Main())
    assembly = shape_tool.NewShape()
    TDataStd_Name.Set_s(assembly, TCollection_ExtendedString(name))
    for part_name, shape, translation_metres in parts:
        label = shape_tool.AddShape(shape, False)
        TDataStd_Name.Set_s(label, TCollection_ExtendedString(f"{part_name}_definition"))
        transform = gp_Trsf()
        transform.SetTranslation(gp_Vec(*(value * scale for value in translation_metres)))
        occurrence = shape_tool.AddComponent(assembly, label, TopLoc_Location(transform))
        TDataStd_Name.Set_s(occurrence, TCollection_ExtendedString(part_name))
    shape_tool.UpdateAssemblies()
    writer = STEPCAFControl_Writer()
    if not Interface_Static.SetCVal_s("write.step.schema", "AP242DIS"):
        raise RuntimeError("OCCT did not accept AP242DIS writer schema")
    writer.SetNameMode(True)
    if not writer.Transfer(document):
        raise RuntimeError(f"Could not transfer {name}")
    status = writer.Write(str(target))
    Interface_Static.SetCVal_s("write.step.schema", "AP214IS")
    if status != IFSelect_ReturnStatus.IFSelect_RetDone:
        raise RuntimeError(f"Could not write STEP fixture: {status}")
    return target


def write_planar_contact_assembly(target: Path) -> Path:
    """Two 20 mm cubes sharing exactly one 20 x 20 mm planar interface."""
    scale = 1000.0
    left = BRepPrimAPI_MakeBox(0.02 * scale, 0.02 * scale, 0.02 * scale).Shape()
    right = BRepPrimAPI_MakeBox(0.02 * scale, 0.02 * scale, 0.02 * scale).Shape()
    return _write_xcaf_assembly(target, "planar_contact", [
        ("left_block", left, (0.0, 0.0, 0.0)),
        ("right_block", right, (0.02, 0.0, 0.0)),
    ])


def write_coaxial_contact_assembly(target: Path) -> Path:
    """A shaft touching the exact inner cylindrical face of a sleeve."""
    scale = 1000.0
    shaft = BRepPrimAPI_MakeCylinder(0.006 * scale, 0.02 * scale).Shape()
    outer = BRepPrimAPI_MakeCylinder(0.010 * scale, 0.02 * scale).Shape()
    inner = BRepPrimAPI_MakeCylinder(0.006 * scale, 0.02 * scale).Shape()
    sleeve = BRepAlgoAPI_Cut(outer, inner).Shape()
    return _write_xcaf_assembly(target, "coaxial_contact", [
        ("shaft", shaft, (0.0, 0.0, 0.0)),
        ("sleeve", sleeve, (0.0, 0.0, 0.0)),
    ])


def write_mirrored_occurrence_assembly(target: Path) -> Path:
    document = TDocStd_Document(TCollection_ExtendedString("XmlXCAF"))
    XCAFDoc_DocumentTool.SetLengthUnit_s(document, 0.001)
    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(document.Main())
    definition = shape_tool.AddShape(BRepPrimAPI_MakeBox(10, 20, 30).Shape(), False)
    TDataStd_Name.Set_s(definition, TCollection_ExtendedString("mirrored_part_definition"))
    assembly = shape_tool.NewShape()
    TDataStd_Name.Set_s(assembly, TCollection_ExtendedString("mirrored_occurrence_assembly"))
    reflection = gp_Trsf()
    reflection.SetMirror(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(1, 0, 0)))
    occurrence = shape_tool.AddComponent(assembly, definition, TopLoc_Location(reflection))
    TDataStd_Name.Set_s(occurrence, TCollection_ExtendedString("mirrored_part"))
    shape_tool.UpdateAssemblies()
    writer = STEPCAFControl_Writer()
    Interface_Static.SetCVal_s("write.step.schema", "AP242DIS")
    writer.SetNameMode(True)
    if not writer.Transfer(document):
        raise RuntimeError("Could not transfer mirrored fixture")
    status = writer.Write(str(target))
    Interface_Static.SetCVal_s("write.step.schema", "AP214IS")
    if status != IFSelect_ReturnStatus.IFSelect_RetDone:
        raise RuntimeError(f"Could not write mirrored STEP fixture: {status}")
    return target


def write_two_part_assembly(target: Path, source_unit: str = "millimetre") -> Path:
    if source_unit not in UNIT_TO_METRES:
        raise ValueError(f"Unsupported fixture unit: {source_unit}")
    unit_metres = UNIT_TO_METRES[source_unit]
    coordinate_scale = 1.0 / unit_metres
    document = TDocStd_Document(TCollection_ExtendedString("XmlXCAF"))
    XCAFDoc_DocumentTool.SetLengthUnit_s(document, unit_metres)
    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(document.Main())
    box_shape = BRepPrimAPI_MakeBox(0.01 * coordinate_scale, 0.02 * coordinate_scale, 0.03 * coordinate_scale).Shape()
    cylinder_shape = BRepPrimAPI_MakeCylinder(0.005 * coordinate_scale, 0.04 * coordinate_scale).Shape()
    compound = TopoDS_Compound()
    builder = BRep_Builder()
    builder.MakeCompound(compound)
    builder.Add(compound, box_shape)
    translation = gp_Trsf()
    translation.SetTranslation(gp_Vec(0.1 * coordinate_scale, 0, 0))
    builder.Add(compound, cylinder_shape.Moved(TopLoc_Location(translation)))
    assembly = shape_tool.AddShape(compound, True)
    TDataStd_Name.Set_s(assembly, TCollection_ExtendedString("fixture_assembly"))

    writer = STEPCAFControl_Writer()
    if not Interface_Static.SetCVal_s("write.step.schema", "AP242DIS"):
        raise RuntimeError("OCCT did not accept AP242DIS writer schema")
    writer.Writer().Model(True)
    writer.SetNameMode(True)
    if not writer.Transfer(document):
        raise RuntimeError("Could not transfer XCAF fixture")
    status = writer.Write(str(target))
    if status != IFSelect_ReturnStatus.IFSelect_RetDone:
        raise RuntimeError(f"Could not write STEP fixture: {status}")
    Interface_Static.SetCVal_s("write.step.schema", "AP214IS")
    return target


def write_two_joint_servo_arm(target: Path, source_unit: str = "millimetre") -> Path:
    """Write a small AP242 assembly with two instances of one anonymous actuator definition."""
    if source_unit not in UNIT_TO_METRES:
        raise ValueError(f"Unsupported fixture unit: {source_unit}")
    unit_metres = UNIT_TO_METRES[source_unit]
    scale = 1.0 / unit_metres
    document = TDocStd_Document(TCollection_ExtendedString("XmlXCAF"))
    XCAFDoc_DocumentTool.SetLengthUnit_s(document, unit_metres)
    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(document.Main())

    base = BRepPrimAPI_MakeBox(0.06 * scale, 0.05 * scale, 0.02 * scale).Shape()
    arm = BRepPrimAPI_MakeBox(0.06 * scale, 0.012 * scale, 0.012 * scale).Shape()
    servo_compound = TopoDS_Compound()
    servo_builder = BRep_Builder()
    servo_builder.MakeCompound(servo_compound)
    servo_builder.Add(servo_compound, BRepPrimAPI_MakeBox(0.028 * scale, 0.018 * scale, 0.035 * scale).Shape())
    servo_builder.Add(servo_compound, BRepPrimAPI_MakeCylinder(0.006 * scale, 0.006 * scale).Shape())

    base_label = shape_tool.AddShape(base, False)
    arm_label = shape_tool.AddShape(arm, False)
    servo_label = shape_tool.AddShape(servo_compound, False)
    TDataStd_Name.Set_s(base_label, TCollection_ExtendedString("base_plate"))
    TDataStd_Name.Set_s(arm_label, TCollection_ExtendedString("arm_link"))
    TDataStd_Name.Set_s(servo_label, TCollection_ExtendedString("anonymous_actuator"))
    assembly = shape_tool.NewShape()
    TDataStd_Name.Set_s(assembly, TCollection_ExtendedString("two_joint_servo_arm"))

    def add(label, name, x, z=0.02):
        transform = gp_Trsf()
        transform.SetTranslation(gp_Vec(x * scale, 0, z * scale))
        occurrence = shape_tool.AddComponent(assembly, label, TopLoc_Location(transform))
        TDataStd_Name.Set_s(occurrence, TCollection_ExtendedString(name))

    add(base_label, "base", 0.0, 0.0)
    add(servo_label, "servo_a", 0.04)
    add(arm_label, "upper_arm", 0.085)
    add(servo_label, "servo_b", 0.14)
    add(arm_label, "forearm", 0.19)
    shape_tool.UpdateAssemblies()

    writer = STEPCAFControl_Writer()
    if not Interface_Static.SetCVal_s("write.step.schema", "AP242DIS"):
        raise RuntimeError("OCCT did not accept AP242DIS writer schema")
    writer.SetNameMode(True)
    if not writer.Transfer(document):
        raise RuntimeError("Could not transfer two-joint XCAF fixture")
    status = writer.Write(str(target))
    Interface_Static.SetCVal_s("write.step.schema", "AP214IS")
    if status != IFSelect_ReturnStatus.IFSelect_RetDone:
        raise RuntimeError(f"Could not write STEP fixture: {status}")
    return target
