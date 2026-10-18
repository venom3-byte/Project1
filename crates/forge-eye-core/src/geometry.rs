use serde::{Deserialize, Serialize};
use std::fmt::{Display, Formatter};

const RADIUS_EPSILON: f32 = 1.0e-5;
const MAX_PROFILE_POINTS: usize = 4096;
const MAX_ESTIMATED_VERTICES: usize = 1_000_000;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct LatheProfilePoint {
    /// Distance from the spin axis, in editor world units.
    pub radius: f32,
    /// Height along the selected spin axis, in editor world units.
    pub height: f32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Axis {
    #[default]
    Y,
    Z,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct LatheOptions {
    #[serde(default = "default_radial_segments")]
    pub radial_segments: u32,
    #[serde(default = "default_profile_subdivisions")]
    pub profile_subdivisions: u8,
    #[serde(default = "default_true")]
    pub cap_ends: bool,
    #[serde(default)]
    pub axis: Axis,
}

fn default_radial_segments() -> u32 {
    64
}
fn default_profile_subdivisions() -> u8 {
    1
}
fn default_true() -> bool {
    true
}

impl Default for LatheOptions {
    fn default() -> Self {
        Self {
            radial_segments: default_radial_segments(),
            profile_subdivisions: default_profile_subdivisions(),
            cap_ends: true,
            axis: Axis::Y,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MeshData {
    /// World-space positions as XYZ triples. Index order is triangle-list order.
    pub positions: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub indices: Vec<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MeshError {
    TooFewProfilePoints,
    TooManyProfilePoints,
    InvalidRadius,
    InvalidHeight,
    InvalidSegmentCount,
    InvalidSubdivisionLevel,
    MeshTooLarge,
    DegenerateProfile,
}

impl Display for MeshError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::TooFewProfilePoints => "A lathe profile requires at least two points.",
            Self::TooManyProfilePoints => "The profile exceeds the 4096-point safety limit.",
            Self::InvalidRadius => "Profile radii must be finite and non-negative.",
            Self::InvalidHeight => "Profile heights must be finite.",
            Self::InvalidSegmentCount => "Radial segments must be between 3 and 512.",
            Self::InvalidSubdivisionLevel => "Profile smoothing must be between 0 and 3.",
            Self::MeshTooLarge => "The requested mesh exceeds the one-million-vertex safety limit.",
            Self::DegenerateProfile => "The profile has no usable length.",
        };
        f.write_str(message)
    }
}

impl std::error::Error for MeshError {}

/// Generate a closed, indexed surface by revolving a radius/height profile around Y or Z.
///
/// Profile points are ordered from bottom to top. For a bottle, begin at the axis at
/// the base, move radially to the outer base, trace the silhouette, and return to the
/// axis at the mouth/top. A reference image is a guide; the profile itself defines the
/// missing 3D depth.
pub fn generate_lathe_mesh(
    profile: &[LatheProfilePoint],
    options: LatheOptions,
) -> Result<MeshData, MeshError> {
    if profile.len() < 2 {
        return Err(MeshError::TooFewProfilePoints);
    }
    if profile.len() > MAX_PROFILE_POINTS {
        return Err(MeshError::TooManyProfilePoints);
    }
    if !(3..=512).contains(&options.radial_segments) {
        return Err(MeshError::InvalidSegmentCount);
    }
    if options.profile_subdivisions > 3 {
        return Err(MeshError::InvalidSubdivisionLevel);
    }

    for point in profile {
        if !point.radius.is_finite() || point.radius < 0.0 {
            return Err(MeshError::InvalidRadius);
        }
        if !point.height.is_finite() {
            return Err(MeshError::InvalidHeight);
        }
    }

    let points = subdivide_profile(profile, options.profile_subdivisions);
    if points.len() < 2
        || points.windows(2).all(|pair| {
            (pair[0].radius - pair[1].radius).abs() < RADIUS_EPSILON
                && (pair[0].height - pair[1].height).abs() < RADIUS_EPSILON
        })
    {
        return Err(MeshError::DegenerateProfile);
    }

    let segments = options.radial_segments as usize;
    let full_ring_count = points
        .iter()
        .filter(|point| point.radius > RADIUS_EPSILON)
        .count();
    let estimated = full_ring_count
        .saturating_mul(segments)
        .saturating_add(points.len().saturating_sub(full_ring_count))
        .saturating_add(2);
    if estimated > MAX_ESTIMATED_VERTICES {
        return Err(MeshError::MeshTooLarge);
    }

    let mut positions: Vec<[f32; 3]> = Vec::with_capacity(estimated);
    let mut rings: Vec<Vec<u32>> = Vec::with_capacity(points.len());
    for point in &points {
        if point.radius <= RADIUS_EPSILON {
            let index = positions.len() as u32;
            positions.push(axis_position(0.0, point.height, 0.0, options.axis));
            rings.push(vec![index]);
            continue;
        }
        let mut ring = Vec::with_capacity(segments);
        for i in 0..segments {
            let angle = std::f32::consts::TAU * (i as f32) / (segments as f32);
            let (sin, cos) = angle.sin_cos();
            let index = positions.len() as u32;
            positions.push(axis_position(
                point.radius * cos,
                point.height,
                point.radius * sin,
                options.axis,
            ));
            ring.push(index);
        }
        rings.push(ring);
    }

    let mut indices: Vec<u32> =
        Vec::with_capacity(points.len().saturating_mul(segments).saturating_mul(6));
    for ring_index in 0..rings.len() - 1 {
        let a = &rings[ring_index];
        let b = &rings[ring_index + 1];
        match (a.len(), b.len()) {
            (1, 1) => {}
            (1, _) => {
                for j in 0..segments {
                    push_triangle(&mut indices, a[0], b[j], b[(j + 1) % segments]);
                }
            }
            (_, 1) => {
                for j in 0..segments {
                    push_triangle(&mut indices, a[j], b[0], a[(j + 1) % segments]);
                }
            }
            _ => {
                for j in 0..segments {
                    let next = (j + 1) % segments;
                    let (a0, a1, b0, b1) = (a[j], a[next], b[j], b[next]);
                    push_triangle(&mut indices, a0, b0, b1);
                    push_triangle(&mut indices, a0, b1, a1);
                }
            }
        }
    }

    if options.cap_ends {
        cap_open_ring(
            &mut positions,
            &mut indices,
            rings.first().unwrap(),
            &points[0],
            options.axis,
            false,
        );
        cap_open_ring(
            &mut positions,
            &mut indices,
            rings.last().unwrap(),
            points.last().unwrap(),
            options.axis,
            true,
        );
    }

    let normals = calculate_normals(&positions, &indices);
    Ok(MeshData {
        positions,
        normals,
        indices,
    })
}

fn axis_position(radius_x: f32, height: f32, radius_z: f32, axis: Axis) -> [f32; 3] {
    match axis {
        Axis::Y => [radius_x, height, radius_z],
        Axis::Z => [radius_x, radius_z, height],
    }
}

fn push_triangle(indices: &mut Vec<u32>, a: u32, b: u32, c: u32) {
    if a != b && b != c && a != c {
        indices.extend_from_slice(&[a, b, c]);
    }
}

fn cap_open_ring(
    positions: &mut Vec<[f32; 3]>,
    indices: &mut Vec<u32>,
    ring: &[u32],
    point: &LatheProfilePoint,
    axis: Axis,
    top: bool,
) {
    if ring.len() <= 1 {
        return;
    }
    let center = positions.len() as u32;
    positions.push(axis_position(0.0, point.height, 0.0, axis));
    for j in 0..ring.len() {
        let next = (j + 1) % ring.len();
        if top {
            push_triangle(indices, center, ring[next], ring[j]);
        } else {
            push_triangle(indices, center, ring[j], ring[next]);
        }
    }
}

fn subdivide_profile(profile: &[LatheProfilePoint], level: u8) -> Vec<LatheProfilePoint> {
    if level == 0 {
        return profile.to_vec();
    }
    let steps = 1usize << level;
    let mut result = Vec::with_capacity((profile.len() - 1) * steps + 1);
    for i in 0..profile.len() - 1 {
        let p0 = profile[i.saturating_sub(1)];
        let p1 = profile[i];
        let p2 = profile[i + 1];
        let p3 = profile[(i + 2).min(profile.len() - 1)];
        for step in 0..steps {
            let t = step as f32 / steps as f32;
            let (radius, height) = (
                catmull_rom(p0.radius, p1.radius, p2.radius, p3.radius, t),
                catmull_rom(p0.height, p1.height, p2.height, p3.height, t),
            );
            result.push(LatheProfilePoint {
                radius: radius.max(0.0),
                height,
            });
        }
    }
    result.push(*profile.last().unwrap());
    result
}

fn catmull_rom(p0: f32, p1: f32, p2: f32, p3: f32, t: f32) -> f32 {
    0.5 * ((2.0 * p1)
        + (-p0 + p2) * t
        + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t * t
        + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t * t * t)
}

pub fn calculate_normals(positions: &[[f32; 3]], indices: &[u32]) -> Vec<[f32; 3]> {
    let mut normals = vec![[0.0_f32; 3]; positions.len()];
    for tri in indices.as_chunks::<3>().0 {
        let a = positions[tri[0] as usize];
        let b = positions[tri[1] as usize];
        let c = positions[tri[2] as usize];
        let ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        let ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        let n = [
            ab[1] * ac[2] - ab[2] * ac[1],
            ab[2] * ac[0] - ab[0] * ac[2],
            ab[0] * ac[1] - ab[1] * ac[0],
        ];
        for index in tri {
            let out = &mut normals[*index as usize];
            out[0] += n[0];
            out[1] += n[1];
            out[2] += n[2];
        }
    }
    for normal in &mut normals {
        let length = (normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]).sqrt();
        if length > RADIUS_EPSILON {
            normal[0] /= length;
            normal[1] /= length;
            normal[2] /= length;
        } else {
            *normal = [0.0, 1.0, 0.0];
        }
    }
    normals
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bottle_profile() -> Vec<LatheProfilePoint> {
        vec![
            LatheProfilePoint {
                radius: 0.0,
                height: 0.0,
            },
            LatheProfilePoint {
                radius: 0.45,
                height: 0.0,
            },
            LatheProfilePoint {
                radius: 0.50,
                height: 0.12,
            },
            LatheProfilePoint {
                radius: 0.47,
                height: 0.42,
            },
            LatheProfilePoint {
                radius: 0.27,
                height: 0.66,
            },
            LatheProfilePoint {
                radius: 0.24,
                height: 0.88,
            },
            LatheProfilePoint {
                radius: 0.15,
                height: 0.98,
            },
            LatheProfilePoint {
                radius: 0.0,
                height: 0.98,
            },
        ]
    }

    #[test]
    fn bottle_revolution_creates_indexed_triangles_and_normals() {
        let mesh = generate_lathe_mesh(
            &bottle_profile(),
            LatheOptions {
                radial_segments: 48,
                profile_subdivisions: 1,
                cap_ends: true,
                axis: Axis::Y,
            },
        )
        .unwrap();
        assert!(mesh.positions.len() > 48 * 5);
        assert!(!mesh.indices.is_empty());
        assert_eq!(mesh.indices.len() % 3, 0);
        assert_eq!(mesh.positions.len(), mesh.normals.len());
        assert!(mesh.positions.iter().flatten().all(|v| v.is_finite()));
        assert!(mesh.normals.iter().flatten().all(|v| v.is_finite()));
        assert!(
            mesh.indices
                .iter()
                .all(|i| (*i as usize) < mesh.positions.len())
        );
    }

    #[test]
    fn z_axis_revolution_places_height_on_z() {
        let profile = [
            LatheProfilePoint {
                radius: 0.0,
                height: 0.0,
            },
            LatheProfilePoint {
                radius: 1.0,
                height: 0.0,
            },
            LatheProfilePoint {
                radius: 0.0,
                height: 2.0,
            },
        ];
        let mesh = generate_lathe_mesh(
            &profile,
            LatheOptions {
                radial_segments: 16,
                profile_subdivisions: 0,
                cap_ends: false,
                axis: Axis::Z,
            },
        )
        .unwrap();
        assert!(mesh.positions.iter().any(|p| (p[2] - 2.0).abs() < 1e-5));
    }

    #[test]
    fn rejects_negative_radius_and_too_few_points() {
        let short = [LatheProfilePoint {
            radius: 1.0,
            height: 0.0,
        }];
        assert_eq!(
            generate_lathe_mesh(&short, LatheOptions::default()).unwrap_err(),
            MeshError::TooFewProfilePoints
        );
        let bad = [
            LatheProfilePoint {
                radius: 0.0,
                height: 0.0,
            },
            LatheProfilePoint {
                radius: -1.0,
                height: 1.0,
            },
        ];
        assert_eq!(
            generate_lathe_mesh(&bad, LatheOptions::default()).unwrap_err(),
            MeshError::InvalidRadius
        );
    }

    #[test]
    fn subdivision_adds_profile_samples() {
        let p = bottle_profile();
        let plain = generate_lathe_mesh(
            &p,
            LatheOptions {
                profile_subdivisions: 0,
                ..LatheOptions::default()
            },
        )
        .unwrap();
        let smooth = generate_lathe_mesh(
            &p,
            LatheOptions {
                profile_subdivisions: 2,
                ..LatheOptions::default()
            },
        )
        .unwrap();
        assert!(smooth.positions.len() > plain.positions.len());
    }

    #[test]
    fn zero_radius_profile_points_do_not_create_degenerate_ring_faces() {
        let mesh = generate_lathe_mesh(
            &bottle_profile(),
            LatheOptions {
                profile_subdivisions: 0,
                ..LatheOptions::default()
            },
        )
        .unwrap();
        assert!(
            mesh.indices
                .iter()
                .all(|i| (*i as usize) < mesh.positions.len())
        );
        assert!(mesh.indices.len().is_multiple_of(3));
    }
}
