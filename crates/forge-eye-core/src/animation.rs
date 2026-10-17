use serde::{Deserialize, Serialize};

/// Local-space transform. Rotation uses Euler degrees in XYZ order at the editor boundary.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Transform {
    #[serde(default)]
    pub location: [f32; 3],
    #[serde(default)]
    pub rotation_euler_deg: [f32; 3],
    #[serde(default = "unit_scale")]
    pub scale: [f32; 3],
}

fn unit_scale() -> [f32; 3] { [1.0, 1.0, 1.0] }

impl Default for Transform {
    fn default() -> Self {
        Self { location: [0.0; 3], rotation_euler_deg: [0.0; 3], scale: unit_scale() }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum KeyInterpolation {
    #[default]
    Linear,
    Ease,
    #[serde(rename = "constant")]
    Hold,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct TransformKey {
    pub frame: u32,
    pub transform: Transform,
    #[serde(default)]
    pub interpolation: KeyInterpolation,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct AnimationTrack {
    #[serde(default)]
    pub keys: Vec<TransformKey>,
}

impl AnimationTrack {
    /// Insert a key or replace the existing key on the same frame, then preserve frame order.
    pub fn insert_or_replace(&mut self, key: TransformKey) -> bool {
        if let Some(existing) = self.keys.iter_mut().find(|item| item.frame == key.frame) {
            *existing = key;
            self.keys.sort_by_key(|item| item.frame);
            return false;
        }
        self.keys.push(key);
        self.keys.sort_by_key(|item| item.frame);
        true
    }

    pub fn evaluate(&self, frame: f32) -> Transform {
        if self.keys.is_empty() {
            return Transform::default();
        }
        if frame <= self.keys[0].frame as f32 {
            return self.keys[0].transform;
        }
        let last = self.keys.len() - 1;
        if frame >= self.keys[last].frame as f32 {
            return self.keys[last].transform;
        }

        for pair in self.keys.windows(2) {
            let a = pair[0];
            let b = pair[1];
            if frame < a.frame as f32 || frame > b.frame as f32 {
                continue;
            }
            let duration = (b.frame - a.frame).max(1) as f32;
            let mut t = ((frame - a.frame as f32) / duration).clamp(0.0, 1.0);
            match a.interpolation {
                KeyInterpolation::Linear => {}
                KeyInterpolation::Ease => t = t * t * (3.0 - 2.0 * t),
                KeyInterpolation::Hold => t = 0.0,
            }
            return blend_transform(a.transform, b.transform, t);
        }
        self.keys[last].transform
    }
}

pub fn blend_transform(a: Transform, b: Transform, t: f32) -> Transform {
    let mut result = Transform::default();
    for i in 0..3 {
        result.location[i] = lerp(a.location[i], b.location[i], t);
        result.scale[i] = lerp(a.scale[i], b.scale[i], t);
        result.rotation_euler_deg[i] = lerp_angle_degrees(
            a.rotation_euler_deg[i],
            b.rotation_euler_deg[i],
            t,
        );
    }
    result
}

fn lerp(a: f32, b: f32, t: f32) -> f32 { a + (b - a) * t }

/// Interpolate the shortest route around a 360-degree axis rather than spinning a full turn.
fn lerp_angle_degrees(a: f32, b: f32, t: f32) -> f32 {
    let delta = (b - a + 180.0).rem_euclid(360.0) - 180.0;
    a + delta * t
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(frame: u32, x: f32, interpolation: KeyInterpolation) -> TransformKey {
        let mut transform = Transform::default();
        transform.location[0] = x;
        TransformKey { frame, transform, interpolation }
    }

    #[test]
    fn keys_are_sorted_and_same_frame_is_replaced() {
        let mut track = AnimationTrack::default();
        assert!(track.insert_or_replace(key(24, 4.0, KeyInterpolation::Linear)));
        assert!(track.insert_or_replace(key(0, 0.0, KeyInterpolation::Linear)));
        assert!(!track.insert_or_replace(key(24, 8.0, KeyInterpolation::Linear)));
        assert_eq!(track.keys.len(), 2);
        assert_eq!(track.keys[1].transform.location[0], 8.0);
        assert_eq!(track.keys[0].frame, 0);
    }

    #[test]
    fn linear_interpolation_is_deterministic() {
        let mut track = AnimationTrack::default();
        track.insert_or_replace(key(0, 0.0, KeyInterpolation::Linear));
        track.insert_or_replace(key(24, 12.0, KeyInterpolation::Linear));
        assert!((track.evaluate(12.0).location[0] - 6.0).abs() < 1e-5);
    }

    #[test]
    fn ease_interpolation_has_smoothstep_midpoint() {
        let mut track = AnimationTrack::default();
        track.insert_or_replace(key(0, 0.0, KeyInterpolation::Ease));
        track.insert_or_replace(key(20, 10.0, KeyInterpolation::Linear));
        assert!((track.evaluate(10.0).location[0] - 5.0).abs() < 1e-5);
    }

    #[test]
    fn hold_interpolation_keeps_the_previous_value_until_the_next_key() {
        let mut track = AnimationTrack::default();
        track.insert_or_replace(key(0, 2.0, KeyInterpolation::Hold));
        track.insert_or_replace(key(10, 9.0, KeyInterpolation::Linear));
        assert_eq!(track.evaluate(9.9).location[0], 2.0);
        assert_eq!(track.evaluate(10.0).location[0], 9.0);
    }

    #[test]
    fn rotation_interpolates_over_the_short_arc() {
        let mut a = Transform::default();
        let mut b = Transform::default();
        a.rotation_euler_deg[1] = 350.0;
        b.rotation_euler_deg[1] = 10.0;
        let result = blend_transform(a, b, 0.5);
        assert!(result.rotation_euler_deg[1].abs() < 1e-4 || (result.rotation_euler_deg[1] - 360.0).abs() < 1e-4);
    }

    #[test]
    fn empty_track_returns_identity_transform() {
        assert_eq!(AnimationTrack::default().evaluate(10.0), Transform::default());
    }
}
