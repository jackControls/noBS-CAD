import {createRoot} from 'react-dom/client';
import '../index.css';
import {DrawingWorkspace} from '../components/drawing/DrawingWorkspace';
import {useAppStore} from '../store/appStore';
import type {DrawingSheetDto} from '../engine/types';
import {drawingSheetSize, normalizeDrawingDocument} from './sheet';
import {assertTitleBlockFits, drawingTitleBlock, fitTitleBlockCell} from './titleBlock';
import {drawingSheetSvg, printActiveDrawing} from './export';
import {buildDrawingSheetDxf} from './dxf';

export async function checkDrawingTitleBlocks(inputs: Array<{recipe: string; arguments: Partial<DrawingSheetDto>}>) {
  const check = (value: unknown, message: string) => {if (!value) throw new Error(message);};
  const initial = useAppStore.getState();
  const host = window as typeof window & {__TAURI_INTERNALS__?: unknown};
  const oldNative = host.__TAURI_INTERNALS__, oldPrint = window.print;
  const nativeCalls: string[] = [];
  host.__TAURI_INTERNALS__ = {invoke(command: string) {nativeCalls.push(command); throw new Error(`Unexpected native operation: ${command}`);}};
  let prints = 0; window.print = () => {prints++;};
  const container = document.createElement('div'); container.style.cssText = 'width:1200px;height:700px';
  document.body.append(container); const root = createRoot(container);
  const exported = document.createElement('div'); document.body.append(exported);
  const frames = async () => {for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);};
  const plain = (text: string) => text.replace(/\s/gu, '');
  const checkBounds = (parent: HTMLElement, label: string) => {
    const groups = parent.querySelectorAll<SVGGElement>('[data-title-block-cell]');
    check(groups.length === 12, `${label}: missing title fields`);
    for (const group of groups) {
      const [x,y,w,h] = group.dataset.cellBounds!.split(',').map(Number);
      check(!group.dataset.overflow, `${label}: ${group.dataset.titleBlockCell} overflow`);
      const lines = Array.from(group.querySelectorAll<SVGTextElement>('text'));
      check(plain(lines.map(line => line.textContent).join('')) === plain(group.querySelector('title')!.textContent!),
        `${label}: rendered metadata was lost`);
      for (const line of lines) {
        const b = line.getBBox();
        check(b.x >= x && b.y >= y && b.x + b.width <= x + w && b.y + b.height <= y + h,
          `${label}: ${group.dataset.titleBlockCell} glyphs cross their cell: ${JSON.stringify({x,y,w,h,b:{x:b.x,y:b.y,w:b.width,h:b.height}})}`);
        check(parseFloat(getComputedStyle(line).fontSize) >= 1.8, `${label}: unreadably small text`);
      }
    }
  };
  const summaries: Record<string, number> = {};
  try {
    for (const requestedSize of [NaN, Infinity, -Infinity, -1, 0, 1e100]) {
      const cell = fitTitleBlockCell({id:'test',label:'Boundary',text:'Complete text',x:0,y:0,width:100,height:20},requestedSize);
      check(Number.isFinite(cell.fontSize) && cell.fontSize>=1.8 && !cell.overflow, 'Malformed text height must never hang or create invalid glyph sizes');
    }
    const custom=structuredClone(inputs[0]); custom.recipe='custom-font-and-unicode';
    custom.arguments.name='C:\\tooling\\vise Δ 測定';
    custom.arguments.title_block={...custom.arguments.title_block!,title:'Wide MW@% glyphs\n圧力確認 assembly'};
    const customSheet=normalizeDrawingDocument({...initial.drawingDocument,sheets:[{...custom.arguments,id:1} as DrawingSheetDto]}).sheets[0];
    custom.arguments.style={...customSheet.style,font_family:'monospace'};
    for (const [index, input] of [...inputs,custom].entries()) {
      const drawing = normalizeDrawingDocument({...initial.drawingDocument, active_sheet_id:index+1,
        sheets:[{...input.arguments, id:index+1} as DrawingSheetDto]});
      const sheet = drawing.sheets[0], before = JSON.stringify(sheet);
      useAppStore.setState({drawingDocument:drawing, activeProjectTabId:'title-contract', activeTab:'drawing',
        drawingSheetSetupOpen:false, drawingProfileExportOpen:false, drawingTool:null, drawingPendingViewKind:null,
        selectedDrawingViewId:null, selectedDrawingAnnotationId:null, engineKind:'tauri'});
      root.render(<DrawingWorkspace />); await frames();
      const label = `${input.recipe}: ${sheet.name}`;
      const layout = drawingTitleBlock(sheet, ...drawingSheetSize(sheet.format,sheet.orientation));
      assertTitleBlockFits(layout);
      checkBounds(container, `${label} UI`);
      const svg = await drawingSheetSvg(sheet);
      exported.innerHTML = svg; await frames();
      checkBounds(exported, `${label} SVG`);
      const dxf = buildDrawingSheetDxf(sheet, []);
      const pairs=dxf.replace(/\r/g,'').trimEnd().split('\n');
      const textEntities:Array<Map<string,string>>=[]; let current:Map<string,string>|null=null;
      for(let i=0;i<pairs.length;i+=2) {
        if(pairs[i]==='0') {current=pairs[i+1]==='TEXT'?new Map():null;if(current)textEntities.push(current);}
        else current?.set(pairs[i],pairs[i+1]);
      }
      const expected = layout.cells.flatMap(cell=>cell.lines.filter(line=>line.text).map(line=>({...line,height:cell.fontSize})));
      check(textEntities.length === expected.length, `${label}: missing DXF title text`);
      for(const [i, line] of expected.entries()) {
        const entity=textEntities[i];
        check(entity.get('72')==='5' && entity.get('73')==='0', `${label}: DXF text lacks bounded baseline Fit justification`);
        check(Math.abs(Number(entity.get('11'))-Number(entity.get('10'))-line.width)<1e-4,
          `${label}: DXF fit endpoints disagree with visible text`);
        check(Math.abs(Number(entity.get('40'))-line.height)<1e-4 && entity.get('1')===line.text,
          `${label}: DXF changed text or readable height`);
      }
      check(JSON.stringify(sheet)===before && useAppStore.getState().drawingDocument===drawing, `${label}: rendering modified saved metadata`);
      summaries[input.recipe]=(summaries[input.recipe]??0)+1;
    }
    const base=useAppStore.getState().drawingDocument;
    const long={...base.sheets[0],title_block:{...base.sheets[0].title_block,title:'Very long 完全 title '.repeat(300).slice(0,4096)}};
    useAppStore.setState({drawingDocument:{...base,sheets:[long]},constraintDialog:null});
    await frames();
    const warning=container.querySelector('[data-title-block-cell="title"][data-overflow]');
    check(warning?.querySelector('text')?.textContent==='! TEXT TOO LONG' && warning.querySelector('title')!.textContent!.includes(long.title_block.title),
      'Oversized metadata needs a visible warning and complete accessible text');
    for (const exportSheet of [()=>drawingSheetSvg(long),()=>buildDrawingSheetDxf(long,[])]) {
      let error=''; try{await exportSheet();}catch(e){error=String(e);}
      check(/Title block text does not fit.*Title/.test(error),'Export silently discarded unfittable text');
    }
    printActiveDrawing();
    check(prints===0 && /Title block text does not fit/.test(useAppStore.getState().constraintDialog?.message??''),
      'Print must explain overflow before opening the print dialog');
    check(long.title_block.title.length===4096,'The complete maximum-length field must remain in the model');
    check(nativeCalls.length===0,`Title layout must not call native geometry: ${nativeCalls.join(', ')}`);
    return {flagshipSheets:summaries, actualUiAndSvgBounds:true, dxfFitEndpoints:true, metadataPreserved:true, overflowRejected:true};
  } finally {
    root.unmount(); container.remove(); exported.remove(); useAppStore.setState(initial); window.print=oldPrint;
    if(oldNative)host.__TAURI_INTERNALS__=oldNative;else delete host.__TAURI_INTERNALS__;
  }
}
