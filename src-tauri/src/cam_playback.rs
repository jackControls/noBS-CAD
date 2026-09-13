//! Bounded producer/consumer stock playback. Preparation never publishes a
//! future stock surface: only an explicit presentation of a ready frame does.
use crate::{
    native_viewport::{NativeViewport, ViewportCamStock},
    retained_cam_stock,
    state::AppState,
};
use nbcad_cam::{
    CamPlayback, CamSimulationCancellation, CamSimulationRequestDto, CamSimulationResultDto,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};

const MAX_FRAMES: usize = 24;
const MAX_BYTES: usize = 48 * 1024 * 1024;

#[derive(Default)]
pub(crate) struct CamPlaybackService {
    sequence: AtomicU64,
    current: Mutex<Option<Arc<Session>>>,
}
struct Player {
    kernel: CamPlayback,
    stock: Option<ViewportCamStock>,
    revision: u64,
}
struct ReadyFrame {
    id: u64,
    revision: u64,
    stock: Option<ViewportCamStock>,
}
struct Session {
    id: u64,
    project: String,
    cancellation: CamSimulationCancellation,
    player: Mutex<Option<Player>>,
    frames: Mutex<VecDeque<ReadyFrame>>,
    sequence: AtomicU64,
    presented: AtomicU64,
}
impl CamPlaybackService {
    pub fn clear(&self) {
        if let Some(session) = self
            .current
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take()
        {
            session.cancellation.cancel();
        }
    }
    fn get(&self, id: u64) -> Result<Arc<Session>, String> {
        self.current
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
            .filter(|session| session.id == id && !session.cancellation.is_cancelled())
            .cloned()
            .ok_or_else(|| "CAM playback session was closed or superseded".into())
    }
}

#[derive(Deserialize)]
pub(crate) struct OpenRequest {
    request: CamSimulationRequestDto,
    start_time: f64,
}
#[derive(Deserialize)]
pub(crate) struct SampleRequest {
    session_id: u64,
    time: f64,
}
#[derive(Deserialize)]
pub(crate) struct PresentRequest {
    session_id: u64,
    frame_id: u64,
}
#[derive(Serialize)]
pub(crate) struct BufferedFrame {
    frame_id: u64,
    compute_ms: f64,
    mesh_bytes: usize,
    simulation: CamSimulationResultDto,
}

#[tauri::command]
pub(crate) async fn engine_cam_playback_open(
    state: tauri::State<'_, AppState>,
    service: tauri::State<'_, CamPlaybackService>,
    input: OpenRequest,
) -> Result<u64, String> {
    let (project, document, _) = state.cam_snapshot(input.request.setup_id)?;
    let session = Arc::new(Session {
        id: service.sequence.fetch_add(1, Ordering::AcqRel) + 1,
        project,
        cancellation: CamSimulationCancellation::default(),
        player: Mutex::new(None),
        frames: Mutex::new(VecDeque::new()),
        sequence: AtomicU64::new(0),
        presented: AtomicU64::new(0),
    });
    {
        let mut current = service
            .current
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(previous) = current.replace(session.clone()) {
            previous.cancellation.cancel();
        }
    }
    let worker = session.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let kernel = CamPlayback::new(
            document,
            input.request,
            input.start_time,
            Some(&worker.cancellation),
        )
        .map_err(|error| error.to_string())?;
        *worker
            .player
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(Player {
            kernel,
            stock: None,
            revision: 0,
        });
        Ok::<_, String>(())
    })
    .await
    .map_err(|error| error.to_string())??;
    service.get(session.id)?;
    if state.active_project_session_id() != session.project {
        return Err("CAM playback project changed".into());
    }
    Ok(session.id)
}

#[tauri::command]
pub(crate) async fn engine_cam_playback_sample(
    state: tauri::State<'_, AppState>,
    service: tauri::State<'_, CamPlaybackService>,
    input: SampleRequest,
) -> Result<BufferedFrame, String> {
    let session = service.get(input.session_id)?;
    if state.active_project_session_id() != session.project {
        return Err("CAM playback project changed".into());
    }
    let worker = session.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        let mut guard = worker
            .player
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let player = guard.as_mut().ok_or("CAM playback is not prepared")?;
        let mut simulation = player
            .kernel
            .sample(input.time, Some(&worker.cancellation))
            .map_err(|error| error.to_string())?;
        if simulation.stock_mesh.is_some() {
            player.stock = retained_cam_stock(&simulation);
            player.revision += 1;
        }
        let mesh_bytes = player
            .stock
            .as_ref()
            .map_or(0, |stock| (stock.positions.len() + stock.normals.len()) * 4);
        simulation.stock_mesh = None;
        simulation.native_stock_present = true;
        let frame_id = worker.sequence.fetch_add(1, Ordering::AcqRel) + 1;
        let mut frames = worker
            .frames
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        frames.push_back(ReadyFrame {
            id: frame_id,
            revision: player.revision,
            stock: player.stock.clone(),
        });
        // Count shared geometry once. Rapids reuse exactly the same Arc buffers.
        while frames.len() > MAX_FRAMES || retained_bytes(&frames) > MAX_BYTES {
            frames.pop_front();
        }
        Ok::<_, String>(BufferedFrame {
            frame_id,
            compute_ms: started.elapsed().as_secs_f64() * 1000.0,
            mesh_bytes,
            simulation,
        })
    })
    .await
    .map_err(|error| error.to_string())??;
    service.get(session.id)?;
    Ok(result)
}

fn retained_bytes(frames: &VecDeque<ReadyFrame>) -> usize {
    let mut revisions = Vec::new();
    frames
        .iter()
        .filter_map(|frame| {
            if revisions.contains(&frame.revision) {
                return None;
            }
            revisions.push(frame.revision);
            frame
                .stock
                .as_ref()
                .map(|stock| (stock.positions.len() + stock.normals.len()) * 4)
        })
        .sum()
}

#[tauri::command]
pub(crate) async fn engine_cam_playback_present(
    state: tauri::State<'_, AppState>,
    viewport: tauri::State<'_, NativeViewport>,
    service: tauri::State<'_, CamPlaybackService>,
    input: PresentRequest,
) -> Result<(), String> {
    // Hold the generation gate through enqueue, so a late old frame cannot
    // replace stock selected by a newer setup/session.
    let guard = service
        .current
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let session = guard
        .as_ref()
        .filter(|s| s.id == input.session_id && !s.cancellation.is_cancelled())
        .ok_or("CAM playback session was closed or superseded")?;
    if state.active_project_session_id() != session.project {
        return Err("CAM playback project changed".into());
    }
    let mut frames = session
        .frames
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let frame = frames
        .iter()
        .find(|frame| frame.id == input.frame_id)
        .ok_or("CAM playback frame was evicted")?;
    if session.presented.load(Ordering::Acquire) != frame.revision {
        viewport.set_cam_stock(frame.stock.clone())?;
        session.presented.store(frame.revision, Ordering::Release);
    }
    while frames
        .front()
        .is_some_and(|frame| frame.id < input.frame_id)
    {
        frames.pop_front();
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn engine_cam_playback_close(
    service: tauri::State<'_, CamPlaybackService>,
    session_id: u64,
) {
    let mut current = service
        .current
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if current
        .as_ref()
        .is_some_and(|session| session.id == session_id)
    {
        if let Some(session) = current.take() {
            session.cancellation.cancel();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_rapid_stock_counts_once_and_sessions_cancel_on_selection() {
        let stock = ViewportCamStock {
            positions: Arc::new(vec![0.0; 9]),
            normals: Arc::new(vec![1.0; 9]),
        };
        let frames = (1..9)
            .map(|id| ReadyFrame {
                id,
                revision: 1,
                stock: Some(stock.clone()),
            })
            .collect();
        assert_eq!(retained_bytes(&frames), 72);
        let session = Arc::new(Session {
            id: 9,
            project: "test".into(),
            cancellation: CamSimulationCancellation::default(),
            player: Mutex::new(None),
            frames: Mutex::new(frames),
            sequence: AtomicU64::new(8),
            presented: AtomicU64::new(0),
        });
        let service = CamPlaybackService {
            sequence: AtomicU64::new(9),
            current: Mutex::new(Some(session.clone())),
        };
        assert!(service.get(9).is_ok());
        assert!(
            service.get(8).is_err(),
            "an earlier playback cannot present into the current one"
        );
        service.clear();
        assert!(session.cancellation.is_cancelled());
        assert!(service.get(9).is_err());
    }
}
