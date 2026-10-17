use forge_eye_core::EditorSession;
use forge_eye_core::{
    ExtrusionRequest, HullRequest, LatheRequest, SpinRequest, build_extruded_silhouette,
    build_lathed_profile, build_spin_profile, build_visual_hull,
};
use wasm_bindgen::prelude::*;

/// Stateful, deterministic command session shared by the browser and native hosts.
#[wasm_bindgen]
pub struct ForgeEyeSession {
    inner: EditorSession,
}

#[wasm_bindgen]
impl ForgeEyeSession {
    #[wasm_bindgen(constructor)]
    pub fn new() -> ForgeEyeSession {
        ForgeEyeSession {
            inner: EditorSession::new(),
        }
    }

    /// Executes one validated JSON editor command and returns { result, scene, history }.
    pub fn execute_json(&mut self, command_json: &str) -> Result<String, JsValue> {
        self.inner
            .execute_json(command_json)
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    /// Returns the serializable current scene.
    pub fn scene_json(&self) -> Result<String, JsValue> {
        serde_json::to_string(&self.inner.scene)
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    /// Restores a versioned scene after validating IDs, transforms, materials, keys, and mesh indices.
    pub fn load_scene_json(&mut self, scene_json: &str) -> Result<(), JsValue> {
        self.inner
            .load_scene_json(scene_json)
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    pub fn undo_json(&mut self) -> Result<String, JsValue> {
        self.inner
            .undo()
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        self.scene_json()
    }

    pub fn redo_json(&mut self) -> Result<String, JsValue> {
        self.inner
            .redo()
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        self.scene_json()
    }

    pub fn can_undo(&self) -> bool {
        self.inner.can_undo()
    }
    pub fn can_redo(&self) -> bool {
        self.inner.can_redo()
    }
}

impl Default for ForgeEyeSession {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
pub fn engine_version() -> String {
    format!("Forge Eye Rust Core {}", env!("CARGO_PKG_VERSION"))
}

fn build_visual_hull_json_impl(request_json: &str) -> Result<String, String> {
    let request: HullRequest = serde_json::from_str(request_json)
        .map_err(|error| format!("Invalid visual-hull request: {error}"))?;
    let mesh = build_visual_hull(&request).map_err(|error| error.to_string())?;
    serde_json::to_string(&mesh)
        .map_err(|error| format!("Could not serialize generated mesh: {error}"))
}

#[wasm_bindgen]
pub fn build_visual_hull_json(request_json: &str) -> Result<String, JsValue> {
    build_visual_hull_json_impl(request_json).map_err(|error| JsValue::from_str(&error))
}

fn build_extruded_silhouette_json_impl(request_json: &str) -> Result<String, String> {
    let request: ExtrusionRequest = serde_json::from_str(request_json)
        .map_err(|error| format!("Invalid silhouette-extrusion request: {error}"))?;
    let mesh = build_extruded_silhouette(&request).map_err(|error| error.to_string())?;
    serde_json::to_string(&mesh)
        .map_err(|error| format!("Could not serialize generated mesh: {error}"))
}

#[wasm_bindgen]
pub fn build_extruded_silhouette_json(request_json: &str) -> Result<String, JsValue> {
    build_extruded_silhouette_json_impl(request_json).map_err(|error| JsValue::from_str(&error))
}

fn build_lathed_profile_json_impl(request_json: &str) -> Result<String, String> {
    let request: LatheRequest = serde_json::from_str(request_json)
        .map_err(|error| format!("Invalid lathe-profile request: {error}"))?;
    let mesh = build_lathed_profile(&request).map_err(|error| error.to_string())?;
    serde_json::to_string(&mesh).map_err(|error| format!("Could not serialize lathe mesh: {error}"))
}

#[wasm_bindgen]
pub fn build_lathed_profile_json(request_json: &str) -> Result<String, JsValue> {
    build_lathed_profile_json_impl(request_json).map_err(|error| JsValue::from_str(&error))
}

fn build_spin_profile_json_impl(request_json: &str) -> Result<String, String> {
    let request: SpinRequest = serde_json::from_str(request_json)
        .map_err(|error| format!("Invalid Spin Tool request: {error}"))?;
    let mesh = build_spin_profile(&request).map_err(|error| error.to_string())?;
    serde_json::to_string(&mesh)
        .map_err(|error| format!("Could not serialize spun mesh: {error}"))
}

#[wasm_bindgen]
pub fn build_spin_profile_json(request_json: &str) -> Result<String, JsValue> {
    build_spin_profile_json_impl(request_json).map_err(|error| JsValue::from_str(&error))
}

fn validate_contour_json_impl(contour_json: &str) -> Result<String, String> {
    let contour: Vec<[f32; 2]> = serde_json::from_str(contour_json)
        .map_err(|error| format!("Invalid contour JSON: {error}"))?;
    let triangles =
        forge_eye_core::triangulate_contour(&contour).map_err(|error| error.to_string())?;
    serde_json::to_string(&triangles)
        .map_err(|error| format!("Could not serialize contour triangulation: {error}"))
}

#[wasm_bindgen]
pub fn validate_contour_json(contour_json: &str) -> Result<String, JsValue> {
    validate_contour_json_impl(contour_json).map_err(|error| JsValue::from_str(&error))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_rejects_malformed_json_without_js_runtime() {
        assert!(
            build_visual_hull_json_impl("{broken")
                .unwrap_err()
                .contains("Invalid visual-hull request")
        );
    }

    #[test]
    fn bridge_returns_serialized_mesh_for_valid_request() {
        let request = r#"{"name":"test","front_contour":[[0.1,0.1],[0.9,0.1],[0.9,0.9],[0.1,0.9]],"side_contour":[[0.1,0.1],[0.9,0.1],[0.9,0.9],[0.1,0.9]],"width":2.0,"height":1.0,"depth":1.0,"resolution":8}"#;
        let value = build_visual_hull_json_impl(request).unwrap();
        assert!(value.contains("occupied_voxels"));
        assert!(value.contains("vertices"));
    }

    #[test]
    fn bridge_returns_a_lathed_bottle_mesh() {
        let request = r#"{"name":"Bottle","profile":[[0.80,0.90],[0.80,0.78],[0.70,0.68],[0.61,0.56],[0.58,0.43],[0.58,0.18],[0.55,0.11],[0.53,0.18],[0.53,0.43],[0.56,0.58],[0.67,0.70],[0.76,0.79],[0.76,0.88]],"diameter":0.08,"height":0.25,"segments":32}"#;
        let value = build_lathed_profile_json_impl(request).unwrap();
        assert!(value.contains("spin / lathe profile"));
        assert!(value.contains("vertices"));
        assert!(value.contains("triangle_count"));
    }

    #[test]
    fn bridge_rejects_invalid_lathe_dimensions() {
        let request = r#"{"name":"Bottle","profile":[[0.8,0.9],[0.8,0.2],[0.55,0.1],[0.53,0.2],[0.53,0.9]],"diameter":0.0,"height":0.25,"segments":32}"#;
        assert!(build_lathed_profile_json_impl(request).is_err());
    }

    #[test]
    fn bridge_builds_a_blender_style_spun_bottle() {
        let request = r#"{"name":"Bottle","profile":[[0.5,0.94],[0.78,0.94],[0.82,0.90],[0.78,0.84],[0.67,0.77],[0.62,0.69],[0.62,0.30],[0.59,0.23],[0.55,0.19],[0.5,0.18]],"diameter":0.08,"height":0.25,"segments":24,"subdivision_level":2,"smooth_shading":true}"#;
        let json = build_spin_profile_json_impl(request).unwrap();
        assert!(json.contains("profile smoothing (level 2)"));
        assert!(json.contains("smooth normals"));
        assert!(json.contains("vertices"));
        assert!(json.contains("triangle_count"));
    }

    #[test]
    fn bridge_rejects_excessive_spin_subdivision() {
        let request = r#"{"name":"Bottle","profile":[[0.5,0.94],[0.78,0.94],[0.82,0.90],[0.78,0.84],[0.67,0.77],[0.62,0.69],[0.62,0.30],[0.59,0.23],[0.55,0.19],[0.5,0.18]],"diameter":0.08,"height":0.25,"segments":24,"subdivision_level":9}"#;
        assert!(build_spin_profile_json_impl(request).unwrap_err().contains("subdivision"));
    }

    #[test]
    fn bridge_validates_contours_in_native_tests() {
        assert_eq!(
            validate_contour_json_impl("[[0.1,0.1],[0.9,0.1],[0.9,0.9],[0.1,0.9]]").unwrap(),
            "[[3,0,1],[1,2,3]]"
        );
        assert!(
            validate_contour_json_impl("[[0,0],[1,1],[0,1],[1,0]]")
                .unwrap_err()
                .contains("self-intersects")
        );
    }
}
