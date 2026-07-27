use serde::{Deserialize, Serialize};
use std::ops::{Add, Mul, Sub};

/// 2D vector in sketch plane coordinates (document units, mm by default).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Vec2 {
    pub x: f64,
    pub y: f64,
}

impl Vec2 {
    pub const ZERO: Self = Self { x: 0.0, y: 0.0 };

    pub fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    pub fn dot(self, other: Self) -> f64 {
        self.x * other.x + self.y * other.y
    }

    pub fn length(self) -> f64 {
        self.dot(self).sqrt()
    }

    pub fn distance(self, other: Self) -> f64 {
        (self - other).length()
    }

    /// Unit vector perpendicular (90° CCW) to this one.
    pub fn perp(self) -> Self {
        Self::new(-self.y, self.x)
    }
}

impl Add for Vec2 {
    type Output = Self;
    fn add(self, rhs: Self) -> Self {
        Self::new(self.x + rhs.x, self.y + rhs.y)
    }
}

impl Sub for Vec2 {
    type Output = Self;
    fn sub(self, rhs: Self) -> Self {
        Self::new(self.x - rhs.x, self.y - rhs.y)
    }
}

impl Mul<f64> for Vec2 {
    type Output = Self;
    fn mul(self, rhs: f64) -> Self {
        Self::new(self.x * rhs, self.y * rhs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vector_math_basics() {
        let a = Vec2::new(3.0, 4.0);
        assert_eq!(a.length(), 5.0);
        assert_eq!(a.distance(Vec2::ZERO), 5.0);
        assert_eq!(a.perp().dot(a), 0.0);
        assert_eq!((a + a).x, 6.0);
        assert_eq!((a * 2.0).y, 8.0);
    }
}
