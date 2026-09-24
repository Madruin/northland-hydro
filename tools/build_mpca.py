"""Build the Contamination (MPCA) layer from MnGeo copies of MPCA data:
  mpca-sites     What's In My Neighborhood sites, categorized (cleanup / tanks-waste / permitted facility); construction
                 stormwater-only and business-licence-only records are left out (no lasting site condition)
  mpca-gwconcern Groundwater Contamination Atlas: contamination areas of concern and potential source areas (polygons)
  mpca-gwline    Groundwater Contamination Atlas: contamination boundaries (lines)
  mpca-ic        Institutional control areas (recorded land-use restrictions at cleanup sites)
  mpca-landfill  Closed Landfill Program waste footprints

    python tools/build_mpca.py
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_static_layers as b

P = b.B + "/us_mn_state_pca"
CLEANUP = ("Leak Site", "Petroleum Remediation", "Brownfield", "Superfund", "Voluntary Investigation", "Site Assessment", "Contaminated Soil", "Dump", "Closed Landfill", "Resource Conservation and Recovery Act Corrective Action")
WASTE = ("Hazardous Waste", "generator", "Underground Tanks", "Aboveground Tanks", "Solid Waste", "Tanks")
SKIP_ONLY = {"Construction Stormwater", "Licensed Organization", "SSTS"}

def category(acts):
    if any(k.lower() in a.lower() for a in acts for k in CLEANUP): return "cleanup"
    if any(k.lower() in a.lower() for a in acts for k in WASTE): return "waste"
    return "permit"

def sites():
    b.LAYERS["mpca-sites"] = (P + "/env_my_neighborhood/FeatureServer/0", "site_id,name,active_flag,activity_list,industrial_classification,ic_flag,site_url,address_street,address_city", None)
    out = []
    for f in b.page("mpca-sites"):
        p = f["properties"]; acts = [a.strip() for a in (p.get("activity_list") or "").split(";") if a.strip()]
        if not acts or set(acts) <= SKIP_ONLY: continue
        f["properties"] = {k: v for k, v in {"name": (p.get("name") or "").strip(), "acts": "; ".join(acts), "cat": category(acts), "active": p.get("active_flag"), "ic": p.get("ic_flag") == "Y" or None,
            "naics": (p.get("industrial_classification") or "").strip() or None, "url": p.get("site_url"), "addr": " ".join(x.strip() for x in (p.get("address_street"), p.get("address_city")) if x and x.strip()) or None}.items() if v}
        out.append(f)
    return out

POLY = {
    "mpca-gwconcern": [(P + "/env_mn_gw_contamination_atlas/FeatureServer/5", "project_name,project_type,status,media_type,acreage,draw_date", "area of concern"),
                       (P + "/env_mn_gw_contamination_atlas/FeatureServer/4", "project_name,project_type,status,media_type,acreage,draw_date", "potential source area")],
    "mpca-gwline": [(P + "/env_mn_gw_contamination_atlas/FeatureServer/3", "project_na,project_ty,status,media_type,type,draw_date", "contamination boundary")],
    "mpca-ic": [(P + "/env_institutional_controls/FeatureServer/1", "ai_name,ai_program,si_type_desc,si_cat_desc,ic_site_type", "institutional control area")],
    "mpca-landfill": [(P + "/env_closed_landfill/FeatureServer/0", "facilityname,status,acres,swpermitno", "closed landfill waste footprint")],
}

if __name__ == "__main__":
    t = time.time()
    s = sites()
    b.write("mpca-sites", s, P + "/env_my_neighborhood/FeatureServer/0")
    ov = [{"type": "Feature", "geometry": f["geometry"], "properties": {k: f["properties"][k] for k in ("name", "cat", "active") if k in f["properties"]}} for f in s]
    with open(os.path.join(b.OUT, "mpca-sites", "overview.json"), "w", encoding="utf-8") as fh: json.dump({"type": "FeatureCollection", "features": ov}, fh, separators=(",", ":"))
    from collections import Counter
    print("sites kept", len(s), dict(Counter(f["properties"]["cat"] for f in s)), flush=True)
    for lid, srcs in POLY.items():
        feats = []
        for url, fields, kind in srcs:
            b.LAYERS[lid] = (url, fields, None); b.OPTS[lid] = {"single": True, "no_overview": True, "offset": 0.00004}
            for f in b.page(lid): f["properties"]["kind"] = kind; feats.append(f)
        b.LAYERS[lid] = (srcs[0][0], srcs[0][1], None)
        b.write(lid, feats, "; ".join(u for u, _, _ in srcs))
    print(f"done in {time.time() - t:.0f}s", flush=True)
