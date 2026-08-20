//! ISO metric screw-thread limit dimensions used by the modeling kernels.
//!
//! The persisted thread DTO keeps the standards-facing designation and
//! tolerance class.  Derived diameters live here so native OCCT and browser
//! OpenCascade can model the same maximum-material (GO) boundary without
//! mistaking a shop tap-drill recommendation for a finished thread limit.

use crate::{HoleThreadDto, HoleThreadStandard};

const SQRT_3: f64 = 1.732_050_807_568_877_2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThreadFit {
    Internal,
    External,
}

/// Diametral ISO tolerance envelope, in millimetres.
///
/// `modeled_*` is the maximum-material GO boundary.  The min/max fields are
/// retained for validation and NO-GO regression tests.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct IsoMetricThreadEnvelope {
    pub basic_major_diameter: f64,
    pub major_min: f64,
    pub major_max: f64,
    pub pitch_min: f64,
    pub pitch_max: f64,
    pub minor_min: f64,
    pub minor_max: f64,
    pub modeled_major: f64,
    pub modeled_pitch: f64,
    pub modeled_minor: f64,
}

/// Resolve the supported general-purpose ISO metric fits (6H and 6g).
///
/// ISO 965 limit dimensions are derived from the ISO basic profile. Grade-6
/// tolerance formulae are mapped to the nearest published preferred value and
/// fundamental deviations use the standard pitch table. This matches the
/// published limit tables rather than treating the formula result itself as a
/// finished limit dimension.
pub fn iso_metric_thread_envelope(
    thread: &HoleThreadDto,
    fit: ThreadFit,
) -> Result<Option<IsoMetricThreadEnvelope>, String> {
    if thread.standard != HoleThreadStandard::IsoMetric {
        return Ok(None);
    }
    let expected_class = match fit {
        ThreadFit::Internal => "6H",
        ThreadFit::External => "6g",
    };
    if thread.class.trim() != expected_class {
        return Err(format!(
            "ISO metric {fit:?} modeling currently supports tolerance class {expected_class}, got {}",
            thread.class
        ));
    }
    Ok(Some(iso_metric_grade6_envelope(
        thread.nominal_diameter,
        thread.pitch,
        fit,
    )?))
}

pub fn iso_metric_grade6_envelope(
    nominal_diameter: f64,
    pitch: f64,
    fit: ThreadFit,
) -> Result<IsoMetricThreadEnvelope, String> {
    if !nominal_diameter.is_finite() || nominal_diameter <= 0.0 {
        return Err("thread nominal diameter must be positive".to_string());
    }
    if !pitch.is_finite() || pitch <= 0.0 {
        return Err("thread pitch must be positive".to_string());
    }

    let basic_pitch = nominal_diameter - 3.0 * SQRT_3 * pitch / 8.0;
    let basic_internal_minor = nominal_diameter - 5.0 * SQRT_3 * pitch / 8.0;
    let basic_external_minor = nominal_diameter - 17.0 * SQRT_3 * pitch / 24.0;
    let representative_diameter = representative_diameter(nominal_diameter);
    let pitch_tolerance_external_um =
        preferred_tolerance_um(90.0 * pitch.powf(0.4) * representative_diameter.powf(0.1));

    match fit {
        ThreadFit::Internal => {
            let pitch_tolerance_um = preferred_tolerance_um(1.32 * pitch_tolerance_external_um);
            let minor_tolerance_um = internal_minor_tolerance_um(pitch);
            let major = round_limit_mm(nominal_diameter);
            let pitch_min = round_limit_mm(basic_pitch);
            let pitch_max = round_limit_mm(basic_pitch + pitch_tolerance_um / 1_000.0);
            let minor_min = round_limit_mm(basic_internal_minor);
            let minor_max = round_limit_mm(basic_internal_minor + minor_tolerance_um / 1_000.0);
            Ok(IsoMetricThreadEnvelope {
                basic_major_diameter: major,
                major_min: major,
                // The internal major diameter is not a NO-GO controlling
                // element. Keep the modeled/basic limit explicit instead of
                // inventing a product tolerance.
                major_max: major,
                pitch_min,
                pitch_max,
                minor_min,
                minor_max,
                modeled_major: major,
                modeled_pitch: pitch_min,
                modeled_minor: minor_min,
            })
        }
        ThreadFit::External => {
            let fundamental_deviation_um = external_g_fundamental_deviation_um(pitch);
            let major_tolerance_um = preferred_tolerance_um(180.0 * pitch.powf(2.0 / 3.0));
            let deviation = fundamental_deviation_um / 1_000.0;
            let major_max = round_limit_mm(nominal_diameter + deviation);
            let major_min =
                round_limit_mm(nominal_diameter + deviation - major_tolerance_um / 1_000.0);
            let pitch_max = round_limit_mm(basic_pitch + deviation);
            let pitch_min =
                round_limit_mm(basic_pitch + deviation - pitch_tolerance_external_um / 1_000.0);
            let minor_max = round_limit_mm(basic_external_minor + deviation);
            // ISO 965-6 defines the design-profile root minimum from d1,max,
            // Td2, H/2 and the 0.25 P minimum root truncation. It is not the
            // maximum root diameter minus the pitch-diameter tolerance.
            let basic_profile_minor_max = nominal_diameter - 5.0 * SQRT_3 * pitch / 8.0 + deviation;
            let minor_min = round_limit_mm(
                basic_profile_minor_max
                    - pitch_tolerance_external_um / 1_000.0
                    - SQRT_3 * pitch / 4.0
                    + pitch / 4.0,
            );
            Ok(IsoMetricThreadEnvelope {
                basic_major_diameter: round_limit_mm(nominal_diameter),
                major_min,
                major_max,
                pitch_min,
                pitch_max,
                minor_min,
                minor_max,
                modeled_major: major_max,
                modeled_pitch: pitch_max,
                modeled_minor: minor_max,
            })
        }
    }
}

fn round_limit_mm(value: f64) -> f64 {
    // ISO 965-6 limit dimensions are published to the third decimal place.
    (value * 1_000.0).round() / 1_000.0
}

fn representative_diameter(diameter: f64) -> f64 {
    // ISO 965 diameter steps. The geometric mean is used by the grade formula.
    const STEPS: &[(f64, f64)] = &[
        (0.99, 1.4),
        (1.4, 2.8),
        (2.8, 5.6),
        (5.6, 11.2),
        (11.2, 22.4),
        (22.4, 45.0),
        (45.0, 90.0),
        (90.0, 180.0),
        (180.0, 355.0),
    ];
    STEPS
        .iter()
        .find(|(lower, upper)| diameter > *lower && diameter <= *upper)
        .map(|(lower, upper)| (lower * upper).sqrt())
        .unwrap_or(diameter)
}

fn preferred_tolerance_um(value: f64) -> f64 {
    // Preferred ISO table values in micrometres. Formula results select the
    // nearest tabulated value; always rounding upward is incorrect for sizes
    // such as M8 x 1.25, whose grade-6 pitch tolerance is 118 um.
    const VALUES: &[f64] = &[
        16.0, 18.0, 20.0, 22.0, 25.0, 28.0, 30.0, 32.0, 36.0, 40.0, 45.0, 48.0, 50.0, 53.0, 56.0,
        60.0, 63.0, 67.0, 71.0, 75.0, 80.0, 85.0, 90.0, 95.0, 100.0, 106.0, 112.0, 118.0, 125.0,
        132.0, 140.0, 150.0, 160.0, 170.0, 180.0, 190.0, 200.0, 212.0, 224.0, 236.0, 250.0, 265.0,
        280.0, 300.0, 315.0, 335.0, 355.0, 375.0, 400.0, 425.0, 450.0, 475.0, 500.0, 530.0, 560.0,
        600.0, 630.0, 670.0, 710.0, 750.0, 800.0, 850.0, 900.0, 950.0, 1_000.0,
    ];
    VALUES
        .iter()
        .copied()
        .min_by(|left, right| {
            (left - value)
                .abs()
                .total_cmp(&(right - value).abs())
                .then_with(|| left.total_cmp(right))
        })
        .unwrap_or_else(|| value.round())
}

fn external_g_fundamental_deviation_um(pitch: f64) -> f64 {
    // ISO 965-1 fundamental deviations for external position g. The value is
    // diametral and negative. Standard pitches must use the table rather than
    // the unrounded interpolation (for example P=1.25 is -28 um, not -28.75).
    const TABLE: &[(f64, f64)] = &[
        (0.20, -17.0),
        (0.25, -18.0),
        (0.30, -18.0),
        (0.35, -19.0),
        (0.40, -19.0),
        (0.45, -20.0),
        (0.50, -20.0),
        (0.60, -21.0),
        (0.70, -22.0),
        (0.75, -22.0),
        (0.80, -24.0),
        (1.00, -26.0),
        (1.25, -28.0),
        (1.50, -32.0),
        (1.75, -34.0),
        (2.00, -38.0),
        (2.50, -42.0),
        (3.00, -48.0),
        (3.50, -53.0),
        (4.00, -60.0),
    ];
    TABLE
        .iter()
        .find(|(candidate, _)| (pitch - candidate).abs() <= 1e-9)
        .map(|(_, deviation)| *deviation)
        .unwrap_or_else(|| -(15.0 + 11.0 * pitch).round())
}

fn internal_minor_tolerance_um(pitch: f64) -> f64 {
    const TABLE: &[(f64, f64)] = &[
        (0.20, 56.0),
        (0.25, 71.0),
        (0.30, 85.0),
        (0.35, 100.0),
        (0.40, 112.0),
        (0.45, 125.0),
        (0.50, 140.0),
        (0.60, 160.0),
        (0.70, 180.0),
        (0.75, 190.0),
        (0.80, 200.0),
        (1.00, 236.0),
        (1.25, 265.0),
        (1.50, 300.0),
        (1.75, 335.0),
        (2.00, 375.0),
        (2.50, 450.0),
        (3.00, 500.0),
        (3.50, 560.0),
        (4.00, 600.0),
    ];
    TABLE
        .iter()
        .find(|(candidate, _)| (pitch - candidate).abs() <= 1e-9)
        .map(|(_, tolerance)| *tolerance)
        .unwrap_or_else(|| preferred_tolerance_um(433.0 * pitch - 190.0 * pitch.powf(1.22)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn m6_x_1_6h_go_and_no_go_envelopes_match_iso_limits() {
        let limits = iso_metric_grade6_envelope(6.0, 1.0, ThreadFit::Internal).unwrap();
        assert!((limits.major_min - 6.000).abs() < 1e-9);
        assert!((limits.pitch_min - 5.350).abs() < 1e-9);
        assert!((limits.pitch_max - 5.500).abs() < 1e-9);
        assert!((limits.minor_min - 4.917).abs() < 1e-9);
        assert!((limits.minor_max - 5.153).abs() < 1e-9);
        assert_eq!(limits.modeled_major, limits.major_min);
        assert_eq!(limits.modeled_pitch, limits.pitch_min);
        assert_eq!(limits.modeled_minor, limits.minor_min);
    }

    #[test]
    fn m6_x_1_6g_go_and_no_go_envelopes_match_iso_limits() {
        let limits = iso_metric_grade6_envelope(6.0, 1.0, ThreadFit::External).unwrap();
        assert!((limits.major_max - 5.974).abs() < 1e-9);
        assert!((limits.major_min - 5.794).abs() < 1e-9);
        assert!((limits.pitch_max - 5.324).abs() < 1e-9);
        assert!((limits.pitch_min - 5.212).abs() < 1e-9);
        assert!((limits.minor_max - 4.747).abs() < 1e-9);
        assert!((limits.minor_min - 4.596).abs() < 1e-9);
        assert_eq!(limits.modeled_major, limits.major_max);
        assert_eq!(limits.modeled_pitch, limits.pitch_max);
        assert_eq!(limits.modeled_minor, limits.minor_max);
    }

    #[test]
    fn m8_x_1_25_6h_go_and_no_go_envelopes_match_iso_limits() {
        let limits = iso_metric_grade6_envelope(8.0, 1.25, ThreadFit::Internal).unwrap();
        assert!((limits.major_min - 8.000).abs() < 1e-9);
        assert!((limits.pitch_min - 7.188).abs() < 1e-9);
        assert!((limits.pitch_max - 7.348).abs() < 1e-9);
        assert!((limits.minor_min - 6.647).abs() < 1e-9);
        assert!((limits.minor_max - 6.912).abs() < 1e-9);
        assert_eq!(limits.modeled_major, limits.major_min);
        assert_eq!(limits.modeled_pitch, limits.pitch_min);
        assert_eq!(limits.modeled_minor, limits.minor_min);
    }

    #[test]
    fn m8_x_1_25_6g_go_and_no_go_envelopes_match_iso_limits() {
        let limits = iso_metric_grade6_envelope(8.0, 1.25, ThreadFit::External).unwrap();
        assert!((limits.major_max - 7.972).abs() < 1e-9);
        assert!((limits.major_min - 7.760).abs() < 1e-9);
        assert!((limits.pitch_max - 7.160).abs() < 1e-9);
        assert!((limits.pitch_min - 7.042).abs() < 1e-9);
        assert!((limits.minor_max - 6.438).abs() < 1e-9);
        assert!((limits.minor_min - 6.272).abs() < 1e-9);
        assert_eq!(limits.modeled_major, limits.major_max);
        assert_eq!(limits.modeled_pitch, limits.pitch_max);
        assert_eq!(limits.modeled_minor, limits.minor_max);
    }
}
