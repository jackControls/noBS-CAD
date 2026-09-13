/** Real component-size/disabled-state fixture; loaded only by the icon E2E. */
import { createRoot } from 'react-dom/client';
import { CAM_ICON_IDS } from '../src/components/cam/CamToolIcon';
import { ToolIcon } from '../src/components/icons';

const container = document.createElement('section');
container.id = 'cam-icon-gallery';
Object.assign(container.style, {
  position: 'absolute', top: '170px', left: '20px', zIndex: '9999',
  background: 'var(--header)', color: 'var(--ink)', padding: '20px',
});
document.body.appendChild(container);
createRoot(container).render(
  <>
    <h2 style={{ fontSize: 16, marginBottom: 12 }}>CAM icons · actual components</h2>
    {[15, 22, 28, 32, 32].map((size, row) => (
      <div key={row} data-icon-size={size} data-icon-disabled={row === 4} style={{ display: 'flex', alignItems: 'center', gap: 16, minHeight: 52 }}>
        <span style={{ width: 90, fontSize: 12 }}>{size}px{row === 4 ? ' · disabled' : ''}</span>
        {CAM_ICON_IDS.map((id) => (
          <button key={id} type="button" aria-label={id} disabled={row === 4} style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', color: 'var(--accent)' }}>
            <ToolIcon id={id} size={size} />
          </button>
        ))}
      </div>
    ))}
  </>,
);
