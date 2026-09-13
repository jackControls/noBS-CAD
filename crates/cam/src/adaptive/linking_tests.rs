fn with_linking(mut doc: CamDocumentDto) -> CamDocumentDto {
    let mut link = crate::CamLinkingDto {
        operation_id: 1,
        ramp_enabled: true,
        minimum_helix_diameter: 1.6,
        helix_diameter: 3.8,
        ramp_stepdown: 0.5,
        lead_in_feed: 250.0,
        lead_out_feed: 300.0,
        ..Default::default()
    };
    link.lead_in = crate::CamLeadDto {
        horizontal_radius: 0.4,
        vertical_radius: 0.3,
        linear_distance: 0.0,
        ..Default::default()
    };
    doc.linking.push(link);
    doc
}

#[test]
fn adaptive_linking_exterior_roundtrip_and_cache_invalidation() {
    let mut doc = with_linking(fixture(vec![cuboid([6.0, 5.0, -3.0], [10.0, 9.0, 0.0])]));
    assert_adaptive_nc_roundtrip(doc.clone());
    let before = plan_setup(&doc, 1).unwrap();
    doc.linking[0].lead_in_feed = 50.0;
    let after = plan_setup(&doc, 1).unwrap();
    assert_ne!(before.commands, after.commands);
    assert!(after.stats.estimated_seconds > before.stats.estimated_seconds);
    let full = after.stats.rapid_distance;
    for policy in [
        crate::CamRetractionPolicy::Minimum,
        crate::CamRetractionPolicy::Shortest,
    ] {
        doc.linking[0].retraction_policy = policy;
        let program = plan_setup(&doc, 1).unwrap();
        assert!(program.stats.rapid_distance <= full + EPS);
        assert_adaptive_nc_roundtrip(doc.clone());
    }
}

#[test]
fn adaptive_linking_cavity_rolls_and_taper_are_checked() {
    let mut doc = with_linking(cavity_fixture());
    doc.linking[0].keep_tool_down = true;
    doc.linking[0].maximum_stay_down = 60.0;
    doc.linking[0].stay_down_level = 100;
    doc.linking[0].minimum_clearance = 0.05;
    doc.linking[0].lift_height = 0.1;
    doc.linking[0].ramp_taper_angle = 1.0;
    assert_adaptive_nc_roundtrip(doc.clone());
    let program = plan_setup(&doc, 1).unwrap();
    assert!(program.commands.iter().any(
        |c| matches!(c,CamCommandDto::Linear{feed,..} if (*feed-doc.linking[0].ramp_feed).abs()<EPS)
    ));
    doc.linking[0].helix_diameter = 1.6;
    assert!(plan_setup(&doc, 1)
        .unwrap_err()
        .0
        .contains("diameter range"));
}

#[test]
fn adaptive_linking_predrill_is_proof_not_an_xy_permission() {
    let doc = with_linking(cavity_fixture());
    let setup = &doc.setups[0];
    let CamOperationDto::Adaptive3d { parameters, .. } = &setup.operations[0] else {
        unreachable!()
    };
    let c = Point2Dto::new(8.0, 7.0);
    let mut builder = ProgramBuilder::new();
    builder.tool_radius = 2.0;
    builder.incoming_top = 0.0;
    builder.feed_height_z = 1.0;
    builder.retract_z = 3.0;
    builder.clearance_z = 5.0;
    let mut link = doc.linking[0].clone();
    link.ramp_type = crate::CamRampType::Predrill;
    link.predrill_positions.push(c);
    builder.linking = Some(link);
    assert!(configured_ramp(&mut builder, c, 0.8, -1.0, parameters)
        .unwrap_err()
        .0
        .contains("earlier enabled hole"));
    builder
        .predrilled
        .push(super::super::linking_planner::PredrilledHole {
            center: c,
            radius: 2.5,
            bottom: -0.5,
        });
    assert!(
        configured_ramp(&mut builder, c, 0.8, -1.0, parameters).is_err(),
        "drill tip is not cylindrical depth"
    );
    builder.predrilled[0].bottom = -2.0;
    configured_ramp(&mut builder, c, 0.8, -1.0, parameters).unwrap();
    builder.linking.as_mut().unwrap().ramp_type = crate::CamRampType::Plunge;
    builder.predrilled.clear();
    configured_ramp(&mut builder, c, 0.8, -1.0, parameters).unwrap();
    assert!(builder
        .warnings
        .iter()
        .any(|w| w.contains("full-width axial cutting")));
}
