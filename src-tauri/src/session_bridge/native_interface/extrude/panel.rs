//! The retained native Extrude panel. Every field comes from the typed form;
//! its actual widget is the control inspected and driven by MCP.

use super::{ExtrudeCommand, ExtrudeControl, ExtrudeField};
use crate::native_viewport::{
    interface_shell::{self, fields, InterfaceCamera, InterfaceControl, InterfaceOccluder, NativeInterfaceHandle},
    ui::{ViewportUiAssets, ViewportUiTheme}, ViewportPalette,
};
use crate::session_bridge::native_interface::{bind_command, NativeCommand};
use bevy::{ecs::system::SystemState, prelude::*, text::FontWeight};
use nbcad_interface::{DocumentContext, Field, KeyChord, Rect as Area};
use std::collections::{HashMap, HashSet};

#[derive(Resource, Default)]
struct PanelWidgets {
    owner: Option<DocumentContext>,
    form_id: u64,
    root: Option<Entity>,
    body: Option<Entity>,
    controls: HashMap<String, (Entity, ExtrudeCommand)>,
    labels: HashMap<String, Entity>,
    area: Area,
    scroll: f32,
    max_scroll: f32,
}

fn node(x: f32, y: f32, width: f32, height: f32) -> Node {
    Node { position_type: PositionType::Absolute, left:px(x), top:px(y), width:px(width), height:px(height),
        align_items:AlignItems::Center, justify_content:JustifyContent::Center, ..default() }
}

/// Wheel coordinates are logical window pixels, just like the published
/// panel. The controller must call this before orbit/zoom or canvas gestures.
pub(crate) fn scroll_panel(world: &mut World, point: [f32; 2], delta: f32) -> bool {
    let Some(mut state) = world.get_resource_mut::<PanelWidgets>() else { return false; };
    if state.root.is_none() || !delta.is_finite() || !point.iter().all(|v| v.is_finite()) { return false; }
    let a = state.area;
    if f64::from(point[0]) < a.x || f64::from(point[0]) > a.x+a.width || f64::from(point[1]) < a.y || f64::from(point[1]) > a.y+a.height { return false; }
    state.scroll = (state.scroll + delta).clamp(0., state.max_scroll);
    true
}

pub(crate) fn synchronize_panel(world: &mut World, handle: &NativeInterfaceHandle, owner: &DocumentContext, area: Area) -> Result<(), String> {
    let mut state = world.remove_resource::<PanelWidgets>().unwrap_or_default();
    let result = synchronize_owned(world, owner, area, &mut state);
    world.insert_resource(state);
    if result.is_ok() { handle.request_redraw(); }
    result
}

fn synchronize_owned(world: &mut World, owner: &DocumentContext, area: Area, state: &mut PanelWidgets) -> Result<(), String> {
    let panel = super::panel(world);
    if state.owner.as_ref() != Some(owner) || panel.as_ref().map(|p|p.form_id) != Some(state.form_id) {
        if let Some(root) = state.root { world.despawn(root); }
        *state = PanelWidgets::default();
    }
    let Some(panel) = panel else { return Ok(()); };
    if [area.x,area.y,area.width,area.height].iter().any(|v| !v.is_finite()) || area.width < 120. || area.height < 120. { return Err("The native Extrude panel needs usable window bounds".into()); }
    let mut cameras = world.query_filtered::<Entity, With<InterfaceCamera>>();
    let camera = cameras.single(world).map_err(|_|"Native interface camera is unavailable")?;
    let assets = world.get_resource::<ViewportUiAssets>().cloned().unwrap_or_default();
    let theme = ViewportUiTheme::from_palette(&ViewportPalette::default());
    let width = area.width as f32;
    let height = area.height as f32;
    let body_height = height - 92.;
    let root = *state.root.get_or_insert_with(|| world.spawn((Name::new("Extrude panel"),Node::default(),BackgroundColor(theme.panel),BorderColor::all(theme.edge),UiTargetCamera(camera),InterfaceOccluder,ZIndex(40))).id());
    let mut root_node = node(area.x as f32,area.y as f32,width,height);
    root_node.border = UiRect::all(px(1.));
    if world.get::<Node>(root) != Some(&root_node) { world.entity_mut(root).insert(root_node); }
    let body = *state.body.get_or_insert_with(|| {
        let body = world.spawn((Name::new("Extrude fields"),Node::default(),UiTargetCamera(camera),ZIndex(41))).id();
        world.entity_mut(root).add_child(body); body
    });
    let mut body_node = node(12.,40.,width-24.,body_height);
    body_node.overflow = Overflow::clip();
    if world.get::<Node>(body) != Some(&body_node) { world.entity_mut(body).insert(body_node); }
    state.owner = Some(owner.clone()); state.form_id = panel.form_id; state.area = area;
    let mut live_controls = HashSet::new(); let mut live_labels = HashSet::new();
    label(world,state,&mut live_labels,"title",root,camera,"Extrude",node(14.,8.,width-28.,24.),theme,&assets,true);
    let mut y = 0.;
    let inner = width-24.;
    for row in panel.fields.iter().filter(|row| row.visible) {
        let key = format!("{:?}",row.field);
        let mut control = InterfaceControl::button(nbcad_interface::catalog::group_for("solid_extrude").unwrap_or("solid/build"),&row.label);
        control.disabled = !row.enabled;
        control.field = row.value.clone();
        let action;
        match &row.value {
            Field::Text { .. } | Field::Choice { .. } => {
                label(world,state,&mut live_labels,&format!("{key}-label"),body,camera,&row.label,node(0.,y-state.scroll,inner,18.),theme,&assets,false);
                y += 20.;
                action = ExtrudeControl::Field(row.field);
                if let Field::Choice {value,options} = &row.value {
                    let selected = options.iter().find(|option| &option.value == value).map(|option| option.label.as_str()).unwrap_or(value);
                    control.label = format!("{}: {}",row.label,selected);
                    control.role = "combobox".into();
                    control.expanded = Some(panel.choice_field == Some(row.field));
                    control.owned_keys = ["ArrowUp","ArrowDown","Home","End"].map(KeyChord::plain).into();
                }
            }
            Field::Toggle(value) => { action = ExtrudeControl::Field(row.field); control.role="checkbox".into();control.selected=Some(*value); }
            Field::None => { action = ExtrudeControl::Pick(row.field); control.selected=Some(panel.pick_target==Some(row.field)); }
        }
        let reference = matches!(row.value,Field::None);
        widget(world,state,&mut live_controls,&key,body,camera,control,node(0.,y-state.scroll,if reference {inner-62.} else {inner},30.),ExtrudeCommand::Control{form_id:panel.form_id,action},theme,&assets)?;
        if reference {
            let mut clear = InterfaceControl::button("solid/build","Clear"); clear.disabled=!row.enabled;
            widget(world,state,&mut live_controls,&format!("{key}-clear"),body,camera,clear,node(inner-58.,y-state.scroll,58.,30.),ExtrudeCommand::Control{form_id:panel.form_id,action:ExtrudeControl::Clear(row.field)},theme,&assets)?;
        }
        y+=36.;
        if panel.choice_field == Some(row.field) {
            if let Field::Choice {value,options} = &row.value {
                for (index,option) in options.iter().enumerate() {
                    let mut choice=InterfaceControl::button("solid/build",&option.label);choice.disabled=option.disabled || !row.enabled;choice.role="option".into();choice.selected=Some(&option.value==value);
                    widget(world,state,&mut live_controls,&format!("{key}-option-{}",option.value),body,camera,choice,node(8.,y-state.scroll,inner-8.,28.),ExtrudeCommand::Control{form_id:panel.form_id,action:ExtrudeControl::Choose{field:row.field,option:index}},theme,&assets)?;
                    y+=30.;
                }
            }
        }
        if let Some(error)=&row.error {
            label(world,state,&mut live_labels,&format!("{key}-error"),body,camera,error,node(0.,y-state.scroll,inner,38.),theme,&assets,false); y+=42.;
        }
    }
    for (key,message) in [("engine-error",panel.error.as_deref()),("preview-notice",panel.preview_notice.as_deref())] {
        if let Some(message)=message { label(world,state,&mut live_labels,key,body,camera,message,node(0.,y-state.scroll,inner,52.),theme,&assets,false); y+=56.; }
    }
    state.max_scroll=(y-body_height).max(0.);state.scroll=state.scroll.min(state.max_scroll);
    let mut cancel=InterfaceControl::button("solid/build","Cancel Extrude"); cancel.disabled=panel.busy;
    widget(world,state,&mut live_controls,"cancel",root,camera,cancel,node(12.,height-42.,(inner-8.)*0.5,30.),ExtrudeCommand::Control{form_id:panel.form_id,action:ExtrudeControl::Cancel},theme,&assets)?;
    let mut apply=InterfaceControl::button("solid/build",if panel.busy {"Applying…"} else {"Apply Extrude"});apply.disabled=!panel.can_apply;apply.selected=Some(true);
    widget(world,state,&mut live_controls,"apply",root,camera,apply,node(16.+inner*0.5,height-42.,(inner-8.)*0.5,30.),ExtrudeCommand::Control{form_id:panel.form_id,action:ExtrudeControl::Apply},theme,&assets)?;
    state.controls.retain(|key,(entity,_)| {if live_controls.contains(key){true}else{world.despawn(*entity);false}});
    state.labels.retain(|key,entity| {if live_labels.contains(key){true}else{world.despawn(*entity);false}});
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn widget(world:&mut World,state:&mut PanelWidgets,live:&mut HashSet<String>,key:&str,parent:Entity,camera:Entity,mut control:InterfaceControl,mut node:Node,command:ExtrudeCommand,theme:ViewportUiTheme,assets:&ViewportUiAssets)->Result<(),String>{
    live.insert(key.into()); node.border=UiRect::all(px(1.)); node.padding=UiRect::axes(px(7.),px(3.));
    let entity=if let Some((entity,_))=state.controls.get(key){*entity}else{
        let mut system=SystemState::<Commands>::new(world);
        let entity={let mut commands=system.get_mut(world).map_err(|e|e.to_string())?;
            if matches!(control.field,Field::Text{..}){ fields::spawn_text_field(&mut commands,camera,node.clone(),control.clone(),theme,assets)? }
            else{interface_shell::spawn_button(&mut commands,camera,node.clone(),control.clone(),theme,assets)}};
        system.apply(world);world.entity_mut(parent).add_child(entity);bind_command(world,entity,NativeCommand::Extrude(command.clone()))?;state.controls.insert(key.into(),(entity,command.clone()));entity
    };
    if state.controls[key].1!=command { bind_command(world,entity,NativeCommand::Extrude(command.clone()))?;state.controls.get_mut(key).unwrap().1=command; }
    control.binding=world.get::<InterfaceControl>(entity).ok_or("Extrude widget was removed")?.binding;
    if matches!(control.field,Field::Text{..}) {control.text_editing=true;control.role="textbox".into();}
    if world.get::<InterfaceControl>(entity)!=Some(&control){world.entity_mut(entity).insert(control);}
    if world.get::<Node>(entity)!=Some(&node){world.entity_mut(entity).insert(node);}
    if world.get::<ZIndex>(entity)!=Some(&ZIndex(42)){world.entity_mut(entity).insert(ZIndex(42));}
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn label(world:&mut World,state:&mut PanelWidgets,live:&mut HashSet<String>,key:&str,parent:Entity,camera:Entity,text:&str,node:Node,theme:ViewportUiTheme,assets:&ViewportUiAssets,strong:bool){
    live.insert(key.into());
    let entity=*state.labels.entry(key.into()).or_insert_with(||{let entity=world.spawn((Text::new(text),theme.text(assets,if strong{16.}else{12.},if strong{FontWeight::SEMIBOLD}else{FontWeight::NORMAL}),TextColor(if strong{theme.ink}else{theme.mute}),node.clone(),UiTargetCamera(camera),ZIndex(42))).id();world.entity_mut(parent).add_child(entity);entity});
    if world.get::<Text>(entity).is_some_and(|current|current.0!=text){world.get_mut::<Text>(entity).unwrap().0=text.into();}
    if world.get::<Node>(entity)!=Some(&node){world.entity_mut(entity).insert(node);}
}
