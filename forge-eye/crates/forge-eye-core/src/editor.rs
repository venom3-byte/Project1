//! Scene, command, history, and animation contracts shared by Forge Eye web/native hosts.
use crate::{
    ExtrusionRequest, GeometryError, HullRequest, MeshData, MeshDiagnostics,
    build_extruded_silhouette, build_visual_hull,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

fn default_fps() -> u32 {
    24
}
fn default_timeline_end() -> u32 {
    240
}
fn default_color() -> [f32; 4] {
    [0.32, 0.62, 0.76, 1.0]
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PrimitiveKind {
    Cube,
    Sphere,
    Cylinder,
    Plane,
    Cone,
    Torus,
    Camera,
    Light,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Transform {
    pub position: [f32; 3],
    /// Euler angles in degrees. Quaternion animation is a later migration step.
    pub rotation: [f32; 3],
    pub scale: [f32; 3],
}

impl Default for Transform {
    fn default() -> Self {
        Self {
            position: [0.0; 3],
            rotation: [0.0; 3],
            scale: [1.0; 3],
        }
    }
}

impl Transform {
    pub fn validate(&self) -> Result<(), GeometryError> {
        for (group, values) in [
            ("position", self.position),
            ("rotation", self.rotation),
            ("scale", self.scale),
        ] {
            if values.iter().any(|v| !v.is_finite() || v.abs() > 10_000.0) {
                return Err(GeometryError(format!(
                    "Transform {group} must contain finite values within ±10,000."
                )));
            }
        }
        if self.scale.iter().any(|v| v.abs() < 1.0e-5) {
            return Err(GeometryError(
                "Scale components must not be zero or nearly zero.".into(),
            ));
        }
        Ok(())
    }

    fn interpolate(a: Self, b: Self, t: f32) -> Self {
        let mix = |x: f32, y: f32| x + (y - x) * t;
        Self {
            position: std::array::from_fn(|i| mix(a.positio
…[1 chars truncated — re-run with head/grep/tail for full output]…
   playing: bool,
    },
    MeshCreated {
        id: u64,
        diagnostics: MeshDiagnostics,
    },
    HistoryUpdated {
        can_undo: bool,
        can_redo: bool,
    },
}

#[derive(Debug, Clone)]
pub struct EditorSession {
    pub scene: Scene,
    undo_stack: Vec<Scene>,
    redo_stack: Vec<Scene>,
    history_limit: usize,
}

impl Default for EditorSession {
    fn default() -> Self {
        Self::new()
    }
}

impl EditorSession {
    pub fn new() -> Self {
        Self {
            scene: Scene::default(),
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            history_limit: 128,
        }
    }
    pub fn with_scene(scene: Scene) -> Result<Self, GeometryError> {
        validate_scene(&scene)?;
        Ok(Self {
            scene,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            history_limit: 128,
        })
    }
    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty()
    }
    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }

    pub fn execute_json(&mut self, input: &str) -> Result<String, GeometryError> {
        let command: EditorCommand = serde_json::from_str(input)
            .map_err(|e| GeometryError(format!("Invalid editor command JSON: {e}")))?;
        let result = self.execute(command)?;
        serde_json::to_string(&serde_json::json!({
            "result": result,
            "scene": self.scene,
            "history": {"can_undo": self.can_undo(), "can_redo": self.can_redo()}
        }))
        .map_err(|e| GeometryError(format!("Could not serialize editor result: {e}")))
    }

    pub fn load_scene_json(&mut self, input: &str) -> Result<(), GeometryError> {
        let scene: Scene = serde_json::from_str(input)
            .map_err(|e| GeometryError(format!("Invalid scene JSON: {e}")))?;
        validate_scene(&scene)?;
        self.scene = scene;
        self.undo_stack.clear();
        self.redo_stack.clear();
        Ok(())
    }

    pub fn execute(&mut self, command: EditorCommand) -> Result<CommandResult, GeometryError> {
        if matches!(command, EditorCommand::Undo) {
            return self.undo();
        }
        if matches!(command, EditorCommand::Redo) {
            return self.redo();
        }
        let history = !matches!(
            command,
            EditorCommand::Select { .. }
                | EditorCommand::EvaluateFrame { .. }
                | EditorCommand::SetPlaying { .. }
        );
        let previous = self.scene.clone();
        let result = self.apply(command)?;
        if history && self.scene != previous {
            self.undo_stack.push(previous);
            if self.undo_stack.len() > self.history_limit {
                self.undo_stack.remove(0);
            }
            self.redo_stack.clear();
        }
        Ok(result)
    }

    fn apply(&mut self, command: EditorCommand) -> Result<CommandResult, GeometryError> {
        match command {
            EditorCommand::CreatePrimitive { primitive, name } => {
                let id = self.scene.allocate_id()?;
                let default_name = format!("{:?} {}", primitive, id);
                self.scene.objects.insert(
                    id,
                    SceneObject {
                        id,
                        name: name
                            .filter(|x| !x.trim().is_empty())
                            .unwrap_or(default_name),
                        kind: ObjectKind::Primitive { primitive },
                        transform: Transform::default(),
                        material: MaterialState::default(),
                        visible: true,
                        mesh: None,
                        keyframes: Vec::new(),
                    },
                );
                self.scene.selected_id = Some(id);
                Ok(CommandResult::Created { id })
            }
            EditorCommand::Select { id } => {
                if let Some(value) = id {
                    if !self.scene.objects.contains_key(&value) {
                        return Err(GeometryError(format!("Object {value} does not exist.")));
                    }
                }
                self.scene.selected_id = id;
                Ok(CommandResult::Selected { id })
            }
            EditorCommand::SetTransform {
                id,
                transform,
                auto_key,
            } => {
                transform.validate()?;
                let record = self
                    .scene
                    .objects
                    .get_mut(&id)
                    .ok_or_else(|| GeometryError(format!("Object {id} does not exist.")))?;
                record.transform = transform;
                let should_key = auto_key || self.scene.timeline.auto_key;
                let frame = self.scene.timeline.current_frame;
                let interpolation = Interpolation::Ease;
                let keyed = if should_key {
                    insert_keyframe(record, frame, interpolation)?;
                    true
                } else {
                    false
                };
                Ok(CommandResult::TransformUpdated { id, keyed })
            }
            EditorCommand::InsertKeyframe {
                id,
                frame,
                interpolation,
            } => {
                if frame > 1_000_000 {
                    return Err(GeometryError(
                        "Keyframe lies outside the supported timeline range.".into(),
                    ));
                }
                let record = self
                    .scene
                    .objects
                    .get_mut(&id)
                    .ok_or_else(|| GeometryError(format!("Object {id} does not exist.")))?;
                let replaced = record.keyframes.iter().any(|key| key.frame == frame);
                insert_keyframe(record, frame, interpolation)?;
                Ok(CommandResult::KeyframeUpdated {
                    id,
                    frame,
                    replaced,
                    count: record.keyframes.len(),
                })
            }
            EditorCommand::DeleteObject { id } => {
                if self.scene.objects.remove(&id).is_none() {
                    return Err(GeometryError(format!("Object {id} does not exist.")));
                }
                if self.scene.selected_id == Some(id) {
                    self.scene.selected_id = None;
                }
                Ok(CommandResult::Deleted { id })
            }
            EditorCommand::SetTimeline {
                fps,
                start_frame,
                end_frame,
                looping,
            } => {
                if !(1..=240).contains(&fps) {
                    return Err(GeometryError("Timeline FPS must be in [1, 240].".into()));
                }
                if end_frame <= start_frame || end_frame > 1_000_000 {
                    return Err(GeometryError(
                        "Timeline end frame must be greater than its start and at most 1,000,000."
                            .into(),
                    ));
                }
                self.scene.timeline.fps = fps;
                self.scene.timeline.start_frame = start_frame;
                self.scene.timeline.end_frame = end_frame;
                self.scene.timeline.looping = looping;
                self.scene.timeline.current_frame = self
                    .scene
                    .timeline
                    .current_frame
                    .clamp(start_frame, end_frame);
                Ok(CommandResult::TimelineUpdated)
            }
            EditorCommand::SetAutoKey { enabled } => {
                self.scene.timeline.auto_key = enabled;
                Ok(CommandResult::TimelineUpdated)
            }
            EditorCommand::EvaluateFrame { frame } => {
                if frame > 1_000_000 {
                    return Err(GeometryError(
                        "Frame lies outside the supported timeline range.".into(),
                    ));
                }
                self.scene.timeline.current_frame = frame;
                let mut evaluated = Vec::new();
                for object in self.scene.objects.values_mut() {
                    if !object.keyframes.is_empty() {
                        object.transform = evaluate_keyframes(&object.keyframes, frame);
                        evaluated.push(object.id);
                    }
                }
                let _ = evaluated;
                Ok(CommandResult::FrameEvaluated { frame })
            }
            EditorCommand::SetPlaying { playing } => {
                self.scene.timeline.playing = playing;
                Ok(CommandResult::PlaybackUpdated { playing })
            }
            EditorCommand::ExtrudeSilhouette { request } => {
                let mesh = build_extruded_silhouette(&request)?;
                let diagnostics = mesh.diagnostics.clone();
                let id = self.scene.insert_mesh(mesh)?;
                Ok(CommandResult::MeshCreated { id, diagnostics })
            }
            EditorCommand::BuildVisualHull { request } => {
                let mesh = build_visual_hull(&request)?;
                let diagnostics = mesh.diagnostics.clone();
                let id = self.scene.insert_mesh(mesh)?;
                Ok(CommandResult::MeshCreated { id, diagnostics })
            }
            EditorCommand::Undo | EditorCommand::Redo => {
                unreachable!("history commands are intercepted")
            }
        }
    }

    pub fn undo(&mut self) -> Result<CommandResult, GeometryError> {
        let previous = self
            .undo_stack
            .pop()
            .ok_or_else(|| GeometryError("Nothing to undo.".into()))?;
        self.redo_stack.push(self.scene.clone());
        self.scene = previous;
        Ok(CommandResult::HistoryUpdated {
            can_undo: self.can_undo(),
            can_redo: self.can_redo(),
        })
    }

    pub fn redo(&mut self) -> Result<CommandResult, GeometryError> {
        let next = self
            .redo_stack
            .pop()
            .ok_or_else(|| GeometryError("Nothing to redo.".into()))?;
        self.undo_stack.push(self.scene.clone());
        self.scene = next;
        Ok(CommandResult::HistoryUpdated {
            can_undo: self.can_undo(),
            can_redo: self.can_redo(),
        })
    }
}

fn insert_keyframe(
    object: &mut SceneObject,
    frame: u32,
    interpolation: Interpolation,
) -> Result<(), GeometryError> {
    object.transform.validate()?;
    if let Some(key) = object.keyframes.iter_mut().find(|key| key.frame == frame) {
        key.transform = object.transform;
        key.interpolation = interpolation;
    } else {
        object.keyframes.push(TransformKeyframe {
            frame,
            transform: object.transform,
            interpolation,
        });
    }
    object.keyframes.sort_by_key(|key| key.frame);
    Ok(())
}

fn evaluate_keyframes(keys: &[TransformKeyframe], frame: u32) -> Transform {
    if frame <= keys[0].frame {
        return keys[0].transform;
    }
    if frame >= keys[keys.len() - 1].frame {
        return keys[keys.len() - 1].transform;
    }
    for pair in keys.windows(2) {
        let a = &pair[0];
        let b = &pair[1];
        if frame < a.frame || frame > b.frame {
            continue;
        }
        let span = (b.frame - a.frame) as f32;
        let mut t = (frame - a.frame) as f32 / span;
        match a.interpolation {
            Interpolation::Linear => {}
            Interpolation::Ease => t = t * t * (3.0 - 2.0 * t),
            Interpolation::Hold => t = 0.0,
        }
        return Transform::interpolate(a.transform, b.transform, t);
    }
    keys[keys.len() - 1].transform
}

fn validate_scene(scene: &Scene) -> Result<(), GeometryError> {
    if scene.schema_version != 1 {
        return Err(GeometryError(format!(
            "Unsupported scene schema version {}.",
            scene.schema_version
        )));
    }
    if scene.timeline.fps == 0
        || scene.timeline.fps > 240
        || scene.timeline.end_frame <= scene.timeline.start_frame
    {
        return Err(GeometryError(
            "Serialized timeline settings are invalid.".into(),
        ));
    }
    if scene
        .selected_id
        .is_some_and(|id| !scene.objects.contains_key(&id))
    {
        return Err(GeometryError(
            "Selected object ID is not present in the scene.".into(),
        ));
    }
    for (id, object) in &scene.objects {
        if *id != object.id {
            return Err(GeometryError(
                "Scene object map key does not match object ID.".into(),
            ));
        }
        object.transform.validate()?;
        object.material.validate()?;
        for key in &object.keyframes {
            key.transform.validate()?;
        }
        if object
            .keyframes
            .windows(2)
            .any(|pair| pair[0].frame >= pair[1].frame)
        {
            return Err(GeometryError(format!(
                "Object {} has unsorted or duplicate keyframes.",
                object.id
            )));
        }
        if let Some(mesh) = &object.mesh {
            if mesh
                .indices
                .iter()
                .any(|index| *index as usize >= mesh.vertices.len())
            {
                return Err(GeometryError(format!(
                    "Object {} has an out-of-range mesh index.",
                    object.id
                )));
            }
            if mesh
                .vertices
                .iter()
                .chain(mesh.normals.iter())
                .flatten()
                .any(|value| !value.is_finite())
            {
                return Err(GeometryError(format!(
                    "Object {} has a non-finite mesh coordinate.",
                    object.id
                )));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn default_transform() -> Transform {
        Transform::default()
    }
    #[test]
    fn creates_primitive_and_stable_id() {
        let mut session = EditorSession::new();
        let out = session
            .execute(EditorCommand::CreatePrimitive {
                primitive: PrimitiveKind::Cube,
                name: Some("Cube".into()),
            })
            .unwrap();
        assert_eq!(out, CommandResult::Created { id: 1 });
        assert_eq!(session.scene.selected_id, Some(1));
    }
    #[test]
    fn undo_redo_restore_scene_snapshots() {
        let mut s = EditorSession::new();
        s.execute(EditorCommand::CreatePrimitive {
            primitive: PrimitiveKind::Cube,
            name: None,
        })
        .unwrap();
        assert_eq!(s.scene.objects.len(), 1);
        s.undo().unwrap();
        assert!(s.scene.objects.is_empty());
        s.redo().unwrap();
        assert_eq!(s.scene.objects.len(), 1);
    }
    #[test]
    fn auto_key_replaces_key_at_same_frame() {
        let mut s = EditorSession::new();
        s.execute(EditorCommand::CreatePrimitive {
            primitive: PrimitiveKind::Cube,
            name: None,
        })
        .unwrap();
        s.execute(EditorCommand::SetAutoKey { enabled: true })
            .unwrap();
        let t = Transform {
            position: [1.0, 0.0, 0.0],
            ..default_transform()
        };
        s.execute(EditorCommand::SetTransform {
            id: 1,
            transform: t,
            auto_key: false,
        })
        .unwrap();
        s.execute(EditorCommand::SetTransform {
            id: 1,
            transform: Transform {
                position: [4.0, 0.0, 0.0],
                ..default_transform()
            },
            auto_key: false,
        })
        .unwrap();
        assert_eq!(s.scene.objects[&1].keyframes.len(), 1);
        assert_eq!(s.scene.objects[&1].keyframes[0].transform.position[0], 4.0);
    }
    #[test]
    fn ease_interpolation_is_monotonic_between_keys() {
        let mut s = EditorSession::new();
        s.execute(EditorCommand::CreatePrimitive {
            primitive: PrimitiveKind::Cube,
            name: None,
        })
        .unwrap();
        s.execute(EditorCommand::SetTransform {
            id: 1,
            transform: Transform {
                position: [0.0, 0.0, 0.0],
                ..default_transform()
            },
            auto_key: false,
        })
        .unwrap();
        s.execute(EditorCommand::InsertKeyframe {
            id: 1,
            frame: 0,
            interpolation: Interpolation::Ease,
        })
        .unwrap();
        s.execute(EditorCommand::SetTransform {
            id: 1,
            transform: Transform {
                position: [8.0, 0.0, 0.0],
                ..default_transform()
            },
            auto_key: false,
        })
        .unwrap();
        s.execute(EditorCommand::InsertKeyframe {
            id: 1,
            frame: 24,
            interpolation: Interpolation::Ease,
        })
        .unwrap();
        s.execute(EditorCommand::EvaluateFrame { frame: 12 })
            .unwrap();
        assert!((s.scene.objects[&1].transform.position[0] - 4.0).abs() < 1e-4);
    }
    #[test]
    fn bad_transform_is_rejected_without_mutating_scene() {
        let mut s = EditorSession::new();
        s.execute(EditorCommand::CreatePrimitive {
            primitive: PrimitiveKind::Cube,
            name: None,
        })
        .unwrap();
        let before = s.scene.clone();
        let bad = Transform {
            position: [f32::INFINITY, 0.0, 0.0],
            ..default_transform()
        };
        assert!(
            s.execute(EditorCommand::SetTransform {
                id: 1,
                transform: bad,
                auto_key: false
            })
            .is_err()
        );
        assert_eq!(before, s.scene);
    }
}
