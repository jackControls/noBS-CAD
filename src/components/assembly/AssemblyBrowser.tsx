import { Link2, Plus, Trash2 } from 'lucide-react';
import { useAppStore } from '../../store/appStore';

export function AssemblyBrowser() {
  const assembly = useAppStore((state) => state.assemblyDocument);
  const selectedJointId = useAppStore((state) => state.selectedJointId);
  const bodies = useAppStore((state) => state.solidScene.bodies);
  const setSelectedJointId = useAppStore((state) => state.setSelectedJointId);
  const setJointDialogOpen = useAppStore((state) => state.setJointDialogOpen);

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
    </aside>
  );
}

function showAssemblyError(error: unknown): void {
  useAppStore.getState().setConstraintDialog({
    titleKey: 'file.errorTitle',
    message: error instanceof Error ? error.message : String(error),
  });
}
