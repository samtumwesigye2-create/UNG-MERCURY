from bom import BillOfMaterials, BomComponent, explode_bom
from mrp import plan_material_requirements
from production_orders import create_production_order


def test_bom_explosion_scales_components():
    bom = BillOfMaterials(
        finished_sku="FG-100",
        components=[
            BomComponent(sku="RM-A", quantity=2),
            BomComponent(sku="RM-B", quantity=0.5),
        ],
    )
    assert explode_bom(bom, 10) == {"RM-A": 20, "RM-B": 5}


def test_mrp_creates_shortage_only_for_missing_quantity():
    requirements = {"RM-A": 20, "RM-B": 5}
    stock = {"RM-A": 7, "RM-B": 8}
    plan = plan_material_requirements(requirements, stock)
    assert plan["RM-A"]["required"] == 20
    assert plan["RM-A"]["available"] == 7
    assert plan["RM-A"]["shortage"] == 13
    assert plan["RM-B"]["shortage"] == 0


def test_production_order_contains_material_plan():
    bom = BillOfMaterials(
        finished_sku="FG-100",
        components=[BomComponent(sku="RM-A", quantity=2)],
    )
    order = create_production_order(
        finished_sku="FG-100",
        quantity=10,
        bom=bom,
        stock={"RM-A": 7},
        work_center="WC-ASSEMBLY-01",
    )
    assert order["finished_sku"] == "FG-100"
    assert order["quantity"] == 10
    assert order["work_center"] == "WC-ASSEMBLY-01"
    assert order["status"] == "planned"
    assert order["material_plan"]["RM-A"]["shortage"] == 13
