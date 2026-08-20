/**
 * IPC contract mirroring `nbcad-core`'s serde output (crates/core).
 * Keep field names and kind strings 1:1 with the Rust side.
 */

export type UnitSystem = 'mm' | 'cm' | 'in';

export interface DocumentSettings {
  units: UnitSystem;
}

export type NodeId = number;

/** snake_case strings serialized from `BrowserNodeKind` unit variants. */
export type BrowserNodeKind =
  | 'document_settings'
  | 'named_views'
  | 'origin'
  | 'origin_plane_xy'
  | 'origin_plane_xz'
  | 'origin_plane_yz'
  | 'origin_center_point'
  | 'bodies_folder'
  | 'body'
  | 'sketches_folder'
  | 'sketch'
  | 'construction_folder'
  | 'construction_plane';

export interface BrowserNode {
  id: NodeId;
  kind: BrowserNodeKind;
  /** User-facing name for named nodes (e.g. "Sketch1"); null → localized label from kind. */
  name: string | null;
  /** Stable model object id for object rows (currently Body). */
  reference_id: number | null;
  visible: boolean;
  children: BrowserNode[];
}

export type FeatureKind =
  | 'sketch'
  | 'construction_plane'
  | 'extrude'
  | 'revolve'
  | 'sweep'
  | 'loft'
  | 'rib'
  | 'fillet'
  | 'chamfer'
  | 'hole'
  | 'external_thread'
  | 'move_copy'
  | 'shell'
  | 'mirror'
  | 'rectangular_pattern'
  | 'circular_pattern'
  | 'combine'
  | 'split_body'
  | 'import_step';
export type FeatureStatus =
  | { state: 'ok' }
  | { state: 'error'; message: string };

export interface FeatureDto {
  id: number;
  name: string;
  kind: FeatureKind;
  suppressed: boolean;
  status: FeatureStatus;
}

export interface DocumentDto {
  name: string;
  settings: DocumentSettings;
  browser: BrowserNode[];
  features: FeatureDto[];
  /** Feature count before the rollback marker. */
  rollback_index: number;
}
