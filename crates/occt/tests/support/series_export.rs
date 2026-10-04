//! Synthetic exact-anchor series fixtures; no OCCT or live-input claim.
use super::occt;
use nbcad_sketch::DrawingDocumentDto;
use nbcad_solid::SolidSceneDto;
use occt::DrawingProjectionDto;
use serde_json::json;
#[path = "straight_export.rs"]
mod rectangle;
pub use rectangle::full_presentation;

pub fn fixture(layout: &str) -> (DrawingDocumentDto, SolidSceneDto, DrawingProjectionDto) {
    let (mut document, scene, projection) = rectangle::fixture("length", 40.);
    let anchor = |id: usize, key: &str, endpoint: &str| {
        json!({
            "body_id":1,"edge_id":id,"edge_key":key,
            "topology_signature":"feature:1:rectangle-connectivity",
            "endpoint":endpoint,"fallback_point":[999.,999.,999.]
        })
    };
    // Non-collinear real edge anchors catch accidental view scaling of offset
    // and origin-only measurements in chain/continued layouts.
    document.sheets[0].annotations = vec![serde_json::from_value(json!({
        "id":1,"kind":"chain_dimension","view_id":1,
        "anchors":[anchor(1,"bottom","start"),anchor(1,"bottom","end"),anchor(2,"right","end")],
        "mode":"aligned","layout":layout,"offset":12.,"spacing":7.,"precision":2
    }))
    .unwrap()];
    (document, scene, projection)
}
