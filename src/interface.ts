import catalog from '../interface/catalog.json';

export const interfaceGroups = [
  ...catalog.workspaces.flatMap(workspace => workspace.panels.map(panel => ({
    id: `${workspace.id}/${panel.id}`, labelKey: panel.labelKey, operations: panel.operations,
  }))),
  ...catalog.groups,
];

export function operationGroup(operation: string): string | undefined {
  return interfaceGroups.find(group => group.operations.includes(operation))?.id;
}
