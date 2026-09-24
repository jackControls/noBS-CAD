//! Reference import plugin: a JSON plate description becomes a native script.
//!
//! Input file, for example `plate.json`:
//! `{"name":"Cover","width_mm":60,"height_mm":40,"thickness_mm":5,
//!   "holes":[{"x":-20,"y":-10,"diameter":5}]}`
//!
//! The host tests also use it: options `fail`, `sleep_ms`, `garbage` and
//! `invalid_script` exercise the error paths of the protocol.
use serde_json::{json, Map, Value};
use std::io::{Read, Write};

fn main() {
    let mut text = String::new();
    if std::io::stdin().read_to_string(&mut text).is_err() {
        respond(&error("cannot read request"));
        std::process::exit(1);
    }
    let request: Value = match serde_json::from_str(&text) {
        Ok(value) => value,
        Err(problem) => {
            respond(&error(&format!("invalid request JSON: {problem}")));
            std::process::exit(1);
        }
    };
    if request["protocol"] != 1 {
        respond(&error("unsupported protocol"));
        std::process::exit(1);
    }
    let options = &request["options"];
    if let Some(ms) = options["sleep_ms"].as_u64() {
        std::thread::sleep(std::time::Duration::from_millis(ms));
    }
    if options["fail"] == true {
        eprintln!("failing because the options asked for it");
        respond(&error("failure requested by options"));
        std::process::exit(2);
    }
    if options["garbage"] == true {
        println!("this is not a JSON response");
        return;
    }
    let Some(path) = request["input"]["path"].as_str() else {
        respond(&error("import needs input.path"));
        std::process::exit(1);
    };
    let plate: Result<Value, String> = std::fs::read_to_string(path)
        .map_err(|problem| problem.to_string())
        .and_then(|text| serde_json::from_str(&text).map_err(|problem| problem.to_string()));
    let plate = match plate {
        Ok(plate) => plate,
        Err(problem) => {
            respond(&error(&format!(
                "cannot read plate description {path}: {problem}"
            )));
            std::process::exit(1);
        }
    };
    match build(&plate, options["invalid_script"] == true) {
        Ok((script, report)) => {
            respond(&json!({"protocol":1,"ok":true,"script":script,"report":report}))
        }
        Err(problem) => {
            respond(&error(&problem));
            std::process::exit(1);
        }
    }
}

fn error(message: &str) -> Value {
    json!({"protocol":1,"ok":false,"error":message})
}

fn respond(value: &Value) {
    let mut out = std::io::stdout().lock();
    let _ = out.write_all(value.to_string().as_bytes());
    let _ = out.write_all(b"\n");
}

fn positive(value: &Value, key: &str) -> Result<f64, String> {
    value[key]
        .as_f64()
        .filter(|number| number.is_finite() && *number > 0.0)
        .ok_or_else(|| format!("{key} must be a positive number"))
}

fn finite(value: &Value, key: &str) -> Result<f64, String> {
    value[key]
        .as_f64()
        .filter(|number| number.is_finite())
        .ok_or_else(|| format!("{key} must be a number"))
}

fn binding(name: &str, expression: Value) -> Value {
    let mut map = Map::new();
    map.insert(name.to_owned(), expression);
    json!({"let": Value::Object(map)})
}

/// The same construction as the bundled mounting-plate recipe: a located
/// rectangle, one extrusion, then holes placed on the current top face.
fn build(plate: &Value, invalid: bool) -> Result<(Value, Value), String> {
    let width = positive(plate, "width_mm")?;
    let height = positive(plate, "height_mm")?;
    let thickness = positive(plate, "thickness_mm")?;
    let name = plate["name"].as_str().unwrap_or("Imported plate");
    let sketch = format!("{name} / {width} by {height} stock");
    let (x0, y0) = (-width / 2.0, -height / 2.0);
    let mut steps = vec![
        json!({"chapter":"Locate the plate",
            "note":format!("{width} × {height} × {thickness} mm stock centred on the origin with one corner fixed."),
            "duration_ms":600}),
        json!({"id":"plate_begin","call":{"group":"sketch/draw","operation":"sketch_begin",
            "arguments":{"name":sketch,"plane":{"type":"origin_plane","plane":"xy"}}}}),
        json!({"id":"plate_rectangle","call":{"group":"sketch/draw","operation":"sketch_add_rectangle_locked",
            "arguments":{"mode":"two_point","anchor":{"x":x0,"y":y0},"corner_hint":{"x":x0+width,"y":y0+height},
                "width_mm":width,"height_mm":height,"ctrl_held":true}}}),
        json!({"id":"plate_locate","call":{"group":"sketch/constrain","operation":"sketch_add_constraint",
            "arguments":{"type":"fix","entity":{"$select":{"from":{"$ref":"plate_rectangle","pointer":"/sketch"},
                "path":"/entities","where":{"/kind":"point","/position/x":x0,"/position/y":y0},"take":"one","pointer":"/id"}}}}}),
        json!({"id":"plate_finish","call":{"group":"sketch/draw","operation":"sketch_finish","arguments":{}}}),
        json!({"id":"plate_build","call":{"group":"solid/build","operation":"solid_extrude",
            "arguments":{"sketch_name":sketch,"profile_indices":[0],"operation":"new_body",
                "extent":{"type":"distance","distance":thickness},"taper_angle_deg":0,"flip":false,"target_body_ids":[]}}}),
        binding(
            "plate_feature",
            json!({"$select":{"from":{"$ref":"plate_build"},"path":"/document/features","take":"last","pointer":"/id"}}),
        ),
        binding(
            "plate_body",
            json!({"$select":{"from":{"$ref":"plate_build"},"path":"/scene/bodies",
            "where":{"/feature_id":{"$ref":"plate_feature"}},"take":"one"}}),
        ),
    ];
    let holes = plate["holes"].as_array().cloned().unwrap_or_default();
    if !holes.is_empty() {
        steps.push(json!({"chapter":"Drill from current geometry",
            "note":format!("{} through holes placed on the current top face.", holes.len()),"duration_ms":600}));
    }
    let mut previous = "plate_build".to_owned();
    for (index, hole) in holes.iter().enumerate() {
        let x = finite(hole, "x")?;
        let y = finite(hole, "y")?;
        let diameter = positive(hole, "diameter")?;
        let face = format!("plate_face_{index}");
        let id = format!("plate_hole_{index}");
        steps.push(binding(
            &face,
            json!({"$select":{
            "from":{"$select":{"from":{"$ref":previous},"path":"/scene/bodies",
                "where":{"/id":{"$ref":"plate_body","pointer":"/id"}},"take":"one"}},
            "path":"/faces","where":{"/plane/normal/2":1},"take":"one"}}),
        ));
        steps.push(json!({"id":id,"call":{"group":"solid/refine","operation":"solid_hole","arguments":{
            "body_id":{"$ref":"plate_body","pointer":"/id"},
            "face_id":{"$ref":face,"pointer":"/id"},
            "position":{"$project":{"point":[x,y,thickness],"basis":{"$ref":face,"pointer":"/plane"}}},
            "diameter":diameter,"extent":{"type":"through_all"},"style":"simple",
            "counterbore_diameter":0,"counterbore_depth":0,"countersink_diameter":0,"countersink_angle_deg":90,"flip":false}}}));
        previous = id;
    }
    let mut script = json!({
        "version":1,
        "name":name,
        "starting_state":"empty",
        "steps":steps,
        "checks":[
            {"id":"final_scene","call":{"group":"solid/check","operation":"solid_scene","arguments":{}}},
            {"assert":{"$ref":"final_scene","pointer":"/errors"},"equals":[]},
            {"assert":{"$count":{"$ref":"final_scene","pointer":"/bodies"}},"equals":1}
        ]
    });
    if invalid {
        script["steps"] = json!([]);
    }
    let report = json!({
        "summary":format!("Plate {width} × {height} × {thickness} mm with {} through holes", holes.len()),
        "flags":[{"severity":"info","message":"Reference example: every dimension comes from the input file; nothing is measured or guessed."}]
    });
    Ok((script, report))
}
