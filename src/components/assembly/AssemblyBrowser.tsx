import { useEffect, useRef, useState } from 'react';
import { Anchor, Gauge, Link2, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { useAppStore } from '../../store/appStore';

export function AssemblyBrowser() {
  const assembly = useAppStore((state) => state.assemblyDocument);
  const solution = useAppStore((state) => state.assemblySolution);
  const selectedJointId = useAppStore((state) => state.selectedJointId);
  const bodies = useAppStore((state) => state.solidScene.bodies);
  const setSelectedJointId = useAppStore((state) => state.setSelectedJointId);
  const setJointDialogOpen = useAppStore((state) => state.setJointDialogOpen);
  const setGroundedBody = useAppStore((state) => state.setGroundedBody);
  const setJointValue = useAppStore((state) => state.setJointValue);
  const selectedJoint = assembly.joints.find((joint) => joint.id === selectedJointId) ?? null;
  const selectedValue = selectedJoint?.kind === 'revolute'
    ? selectedJoint.angle_offset_deg
    : selectedJoint?.kind === 'slider'
      ? selectedJoint.linear_offset_mm
      : 0;
  const [motionValue, setMotionValue] = useState(selectedValue);
  const motionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setMotionValue(selectedValue);
  }, [selectedJointId, selectedValue]);

  useEffect(() => () => {
    if (motionTimer.current) clearTimeout(motionTimer.current);
  }, []);

  const selectJoint = (jointId: number) => {
    const state = useAppStore.getState();
    const joint = state.assemblyDocument.joints.find((candidate) => candidate.id === jointId);
    if (!joint) return;
    state.clearSolidSelection();
    for (const connector of [joint.connector_a, joint.connector_b]) {
      state.selectSolidFeature('face', connector.body_id, connector.face_id, null, true);
    }
    setSelectedJointId(jointId);
  };

  const removeJoint = (jointId: number) => {
    void useAppStore.getState().deleteJoint(jointId).catch(showAssemblyError);
  };

  const queueMotion = (jointId: number, value: number) => {
    setMotionValue(value);
    if (motionTimer.current) clearTimeout(motionTimer.current);
    motionTimer.current = setTimeout(() => {
      void setJointValue(jointId, value).catch(showAssemblyError);
    }, 40);
  };

  return (
    <aside data-testid="assembly-browser" className="flex w-[228px] shrink-0 flex-col border-r border-edge bg-panel">
      <header className="flex h-8 items-center justify-between border-b border-edge px-2.5 text-[10px] font-semibold tracking-[0.16em] text-mute">
        <span>ASSEMBLY</span>
        <button
          type="button"
          title="Create joint"
          onClick={() => setJointDialogOpen(true)}
          className="rounded p-1 text-mute hover:bg-edge hover:text-ink"
        >
          <Plus size={15} />
        </button>
      </header>
      <div className="border-b border-edge p-2">
        <label className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-mute">
          <Anchor size={13} className="text-accent" /> Grounded body
        </label>
        <select
          data-testid="assembly-ground-select"
          value={assembly.grounded_body_id ?? ''}
          onChange={(event) => {
            const value = event.target.value === '' ? null : Number(event.target.value);
            void setGroundedBody(value).catch(showAssemblyError);
          }}
          className="mt-1 h-7 w-full rounded border border-edge bg-header px-1.5 text-[10px] text-ink outline-none focus:border-accent"
        >
          <option value="">Automatic ground</option>
          {bodies.map((body) => <option key={body.id} value={body.id}>{body.name}</option>)}
        </select>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {assembly.joints.length === 0 && (
          <div className="px-4 py-8 text-center">
            <Link2 className="mx-auto mb-2 text-mute/50" size={28} />
            <p className="text-[11px] font-medium text-ink">No joints</p>
            <p className="mt-1 text-[10px] leading-relaxed text-mute">
              Connect two planar faces on different bodies.
            </p>
            <button
              type="button"
              onClick={() => setJointDialogOpen(true)}
              className="mt-3 rounded bg-accent px-3 py-1.5 text-[10px] font-semibold text-white hover:brightness-110"
            >
              Create joint
            </button>
          </div>
        )}
        {assembly.joints.map((joint) => {
          const broken = [joint.connector_a, joint.connector_b].some((connector) => {
            const body = bodies.find((candidate) => candidate.id === connector.body_id);
            const face = body?.faces.find((candidate) => candidate.id === connector.face_id);
            return !face?.plane || face.key !== connector.face_key;
          });
          return (
          <div
            key={joint.id}
            className={`group flex h-8 items-center gap-2 px-2 ${
              selectedJointId === joint.id
                ? 'bg-accent/20 text-ink'
                : 'text-mute hover:bg-edge/50 hover:text-ink'
            }`}
          >
            <button
              type="button"
              onClick={() => selectJoint(joint.id)}
              title={broken ? 'Broken face reference' : undefined}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <Link2
                size={14}
                className={broken ? 'text-warn' : joint.enabled ? 'text-accent' : 'opacity-40'}
              />
              <span className="truncate text-[11px]">{joint.name}</span>
              <span className={`ml-auto text-[9px] uppercase ${broken ? 'text-warn' : 'opacity-60'}`}>
                {broken ? 'broken' : joint.kind}
              </span>
            </button>
            <button
              type="button"
              title={`Delete ${joint.name}`}
              onClick={() => removeJoint(joint.id)}
              className="invisible rounded p-1 text-mute hover:bg-warn/15 hover:text-warn group-hover:visible"
            >
              <Trash2 size={12} />
            </button>
          </div>
          );
        })}
      </div>
      {selectedJoint && (
        <section data-testid="joint-motion-panel" className="border-t border-edge p-2.5">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-mute">
            <Gauge size={13} className="text-accent" /> Motion
          </div>
          <p className="mt-1 truncate text-[11px] font-medium text-ink">{selectedJoint.name}</p>
          {selectedJoint.kind === 'rigid' ? (
            <p className="mt-2 text-[10px] leading-4 text-mute">Rigid joints have no free motion.</p>
          ) : (
            <>
              <div className="mt-2 flex items-center gap-2">
                <input
                  data-testid="joint-motion-slider"
                  type="range"
                  min={selectedJoint.limits?.min ?? (selectedJoint.kind === 'revolute' ? -180 : -100)}
                  max={selectedJoint.limits?.max ?? (selectedJoint.kind === 'revolute' ? 180 : 100)}
                  step={selectedJoint.kind === 'revolute' ? 1 : 0.5}
                  value={motionValue}
                  onChange={(event) => queueMotion(selectedJoint.id, Number(event.target.value))}
                  className="min-w-0 flex-1 accent-accent"
                />
                <input
                  data-testid="joint-motion-value"
                  type="number"
                  step="any"
                  value={motionValue}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isFinite(value)) queueMotion(selectedJoint.id, value);
                  }}
                  className="h-7 w-[72px] rounded border border-edge bg-header px-1.5 text-right text-[10px] text-ink outline-none focus:border-accent"
                />
              </div>
              <p className="mt-1 text-[9px] text-mute">
                {selectedJoint.kind === 'revolute' ? 'degrees' : 'millimetres'} · live solved pose
              </p>
            </>
          )}
        </section>
      )}
      {solution.diagnostics.length > 0 && (
        <section data-testid="assembly-diagnostics" className="max-h-28 overflow-y-auto border-t border-edge p-2">
          {solution.diagnostics.map((diagnostic, index) => (
            <div key={`${diagnostic.kind}-${diagnostic.joint_id ?? diagnostic.body_id ?? index}`} className="mb-1 flex gap-1.5 text-[9px] leading-3 text-mute last:mb-0">
              <TriangleAlert size={11} className={diagnostic.kind === 'free_component' ? 'text-mute' : 'text-warn'} />
              <span>{diagnostic.message}</span>
            </div>
          ))}
        </section>
      )}
    </aside>
  );
}

function showAssemblyError(error: unknown): void {
  useAppStore.getState().setConstraintDialog({
    titleKey: 'file.errorTitle',
    message: error instanceof Error ? error.message : String(error),
  });
}
