import {
  Box,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Layers3,
  Plus,
  Route,
  ScanLine,
  Wrench,
} from 'lucide-react';
import {
  addCamSetup,
  camOperationLabel,
  setActiveCamSetup,
} from '../../cam/document';
import { useAppStore } from '../../store/appStore';

export function CamBrowser() {
  const cam = useAppStore((state) => state.camDocument);
  const selectedOperationId = useAppStore((state) => state.selectedCamOperationId);
  const selectSetup = useAppStore((state) => state.setSelectedCamSetupId);
  const selectOperation = useAppStore((state) => state.setSelectedCamOperationId);

  return (
    <aside
      data-testid="cam-browser"
      className="flex w-[228px] shrink-0 flex-col border-r border-edge bg-panel"
    >
      <header className="flex h-8 items-center justify-between border-b border-edge px-2.5 text-[10px] font-semibold tracking-[0.16em] text-mute">
        <span>MANUFACTURING</span>
        <button
          type="button"
          title="New CAM setup"
          onClick={() => runCamAction(addCamSetup)}
          className="rounded p-1 text-mute hover:bg-edge hover:text-ink"
        >
          <Plus size={15} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {cam.setups.map((setup) => {
          const active = setup.id === cam.active_setup_id;
          return (
            <section key={setup.id}>
              <button
                type="button"
                onClick={() => runCamAction(() => setActiveCamSetup(setup.id))}
                className={`flex h-8 w-full items-center gap-1.5 px-2 text-left ${
                  active ? 'bg-accent/18 text-ink' : 'text-mute hover:bg-edge/50 hover:text-ink'
                }`}
              >
                {active ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <Layers3 size={14} />
                <span className="min-w-0 flex-1 truncate text-[12px]">{setup.name}</span>
                <span className="font-mono text-[9px] uppercase text-mute/70">
                  {setup.work_offset}
                </span>
              </button>
              {active && (
                <div className="pb-1">
                  <button
                    type="button"
                    onClick={() => {
                      selectSetup(setup.id);
                      selectOperation(null);
                    }}
                    className={`flex h-7 w-full items-center gap-2 pl-9 pr-2 text-left text-[11px] ${
                      selectedOperationId === null
                        ? 'bg-accent/20 text-ink'
                        : 'text-mute hover:bg-edge/40 hover:text-ink'
                    }`}
                  >
                    <Box size={12} />
                    <span>Stock &amp; WCS</span>
                  </button>
                  {setup.operations.map((operation) => (
                    <button
                      key={operation.id}
                      type="button"
                      onClick={() => {
                        selectSetup(setup.id);
                        selectOperation(operation.id);
                      }}
                      className={`flex h-7 w-full items-center gap-2 pl-9 pr-2 text-left text-[11px] ${
                        selectedOperationId === operation.id
                          ? 'bg-accent/25 text-ink'
                          : 'text-mute hover:bg-edge/40 hover:text-ink'
                      } ${operation.enabled ? '' : 'opacity-45'}`}
                    >
                      <OperationIcon kind={operation.kind} />
                      <span className="min-w-0 flex-1 truncate">{operation.name}</span>
                      <span className="text-[8px] uppercase opacity-60">
                        {camOperationLabel(operation.kind)}
                      </span>
                    </button>
                  ))}
                  {setup.operations.length === 0 && (
                    <div className="px-9 py-2 text-[10px] italic text-mute/70">
                      No operations
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
        {cam.setups.length === 0 && (
          <div className="px-4 py-6 text-center text-[11px] text-mute">
            Create a setup to begin.
          </div>
        )}
        {cam.tools.length > 0 && (
          <section className="mt-2 border-t border-edge pt-1">
            <div className="flex h-7 items-center gap-2 px-3 text-[9px] font-semibold tracking-[0.14em] text-mute/60">
              <Wrench size={11} /> TOOL LIBRARY
            </div>
            {cam.tools.map((tool) => (
              <div key={tool.id} className="flex h-7 items-center gap-2 px-4 text-[10px] text-mute">
                <span className="w-5 font-mono text-accent">T{tool.number}</span>
                <span className="min-w-0 flex-1 truncate">{tool.name}</span>
                <span className="font-mono text-[9px]">Ø{tool.diameter}</span>
              </div>
            ))}
          </section>
        )}
      </div>
    </aside>
  );
}

function OperationIcon({ kind }: { kind: 'face' | 'contour2d' | 'drill' }) {
  if (kind === 'face') return <ScanLine size={12} />;
  if (kind === 'contour2d') return <Route size={12} />;
  return <CircleDot size={12} />;
}

export function runCamAction(action: () => Promise<unknown>): void {
  void action().catch((error) => {
    useAppStore.getState().setConstraintDialog({
      titleKey: 'file.errorTitle',
      message: error instanceof Error ? error.message : String(error),
    });
  });
}
