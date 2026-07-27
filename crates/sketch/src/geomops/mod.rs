//! Self-contained sketch geometry operations and their regression suites.
//!
//! Conversion helpers between these modules' `LineSeg`/`Circle`/`ArcSeg`/
//! `Curve` shapes and the sketch's entity model live in `session/mods.rs`.

pub mod chamfer;
pub mod fillet;
pub mod offset;
pub mod polygon;
pub mod slot;
pub mod spline;
pub mod trimext;
pub mod xform;
