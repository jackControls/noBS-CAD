use super::*;
fn vector(n: u64) -> Value {
    json!({"type":"array","items":{"type":"number"},"minItems":n,"maxItems":n})
}
fn choice(values: &[&str]) -> Value {
    json!({"type":"string","enum":values})
}
pub fn specs() -> Vec<ToolSpec> {
    let id = json!({"type":"integer","minimum":1});
    let anchor = object_schema(
        json!({"body_id":id,"edge_id":id,"edge_key":{"type":"string","minLength":1},"endpoint":choice(&["start","end"]),"fallback_point":vector(3),"circle_center":{"type":"boolean"}}),
        &[
            "body_id",
            "edge_id",
            "edge_key",
            "endpoint",
            "fallback_point",
        ],
    );
    let sheet = object_schema(json!({"sheet_id":id}), &["sheet_id"]);
    let view = object_schema(
        json!({
            "name":{"type":"string"},"kind":choice(&["front","rear","left","right","top","bottom","isometric","custom"]),
            "direction":vector(3),"up":vector(3),"position":vector(2),"scale":{"type":"number","exclusiveMinimum":0},
            "parent_view_id":id,"alignment":choice(&["free","horizontal","vertical"]),"body_ids":{"type":"array","items":id},"show_hidden_lines":{"type":"boolean"},"show_tangent_edges":{"type":"boolean"}
        }),
        &["name", "kind", "direction", "up", "position", "scale"],
    );
    vec![
        ToolSpec::direct("drawing_document","Inspect drawing sheets","Read persistent sheets, views, notes and annotations in the current completed model.","drawing_document",Payload::Empty,empty_schema()),
        ToolSpec::direct("drawing_create_sheet","Create drawing sheet","Create and select a sheet. ISO and first-angle are defaults; specify ANSI and third-angle explicitly when desired. Dimensions and positions are millimetres.","drawing_create_sheet",Payload::Object,
            object_schema(json!({"name":{"type":"string"},"format":choice(&["a0","a1","a2","a3","a4","letter","ansi_b","ansi_c","ansi_d","ansi_e"]),"orientation":choice(&["landscape","portrait"]),"standard":choice(&["iso","ansi"]),"projection_method":choice(&["first_angle","third_angle"]),"tolerance_note":object_schema(json!({"preset":choice(&["none","iso2768_fine","iso2768_medium","iso2768_coarse","iso2768_very_coarse","ansi_decimal","custom"]),"custom":{"type":"string"}}),&["preset","custom"]),"title_block":object_schema(json!({"title":{"type":"string"},"drawing_number":{"type":"string"},"revision":{"type":"string"},"author":{"type":"string"},"checked_by":{"type":"string"},"approved_by":{"type":"string"},"company":{"type":"string"},"material":{"type":"string"},"finish":{"type":"string"}}),&[])}),&["name","format","orientation"])),
        ToolSpec::direct("drawing_select_sheet","Select drawing sheet","Select an existing sheet by ID.","drawing_select_sheet",Payload::Object,sheet.clone()),
        ToolSpec::direct("drawing_delete_sheet","Delete drawing sheet","Delete an existing sheet and its views/annotations. Select another remaining sheet when necessary.","drawing_delete_sheet",Payload::Object,sheet),
        ToolSpec::direct("drawing_add_view","Add drawing view","Add a standard or custom orthographic view. The engine allocates its ID; direction points toward the viewer, up is page-up, position is paper mm and scale is paper/model mm. Returns the updated drawing document.","drawing_add_view",Payload::Object,object_schema(json!({"sheet_id":id,"view":view,"rescale_group":{"type":"boolean"}}),&["sheet_id","view"])),
        ToolSpec::direct("drawing_add_linear_dimension","Add associative linear dimension","Dimension two current topology anchors from drawing_projection in an existing view. Modes are aligned, horizontal or vertical. Offset is paper millimetres. Stale or excluded references reject atomically; the measured value follows the model, never an entered label.","drawing_add_linear_dimension",Payload::Object,object_schema(json!({"sheet_id":id,"view_id":id,"first":anchor,"second":anchor,"mode":choice(&["aligned","horizontal","vertical"]),"offset":{"type":"number"},"prefix":{"type":"string"},"suffix":{"type":"string"},"precision":{"type":"integer","minimum":0,"maximum":6},"presentation":object_schema(json!({"tolerance":object_schema(json!({"mode":choice(&["none","symmetric","deviation","limits"]),"upper":{"type":"number"},"lower":{"type":"number"}}),&["mode","upper","lower"]),"basic":{"type":"boolean"},"reference":{"type":"boolean"},"fit_class":{"type":"string"}}),&[])}),&["sheet_id","view_id","first","second","mode","offset"])),
        ToolSpec::direct("drawing_add_note","Add drawing note","Add a free-standing note in paper millimetres. Returns the updated drawing document.","drawing_add_note",Payload::Object,object_schema(json!({"sheet_id":id,"text":{"type":"string","maxLength":4096},"position":vector(2)}),&["sheet_id","text","position"])),
        ToolSpec::direct("drawing_projection","Generate exact drawing projection","Generate OCCT visible/hidden linework, bounds, topology anchors and circular references from the current completed solid model. Supports exact section planes. No GUI is required.","drawing_projection",Payload::Object,object_schema(json!({"body_ids":{"type":"array","items":id},"direction":vector(3),"up":vector(3),"include_hidden":{"type":"boolean"},"include_tangent_edges":{"type":"boolean"},"deflection":{"type":"number","exclusiveMinimum":0},"section_plane":object_schema(json!({"point":vector(3),"normal":vector(3),"depth":{"type":"number","exclusiveMinimum":0}}),&["point","normal"])}),&["direction","up"]))
    ]
}
