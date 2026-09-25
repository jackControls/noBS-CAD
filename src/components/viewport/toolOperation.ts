/** Mutations cannot be cancelled after reaching the engine. Serialize submits,
 * update only their original sketch, and let only the owning run retire its UI. */
export interface ToolOperationTicket {
  readonly owner: object;
  readonly context: number;
}

export class ToolOperationGate {
  private active: ToolOperationTicket | null = null;
  get pending(): boolean { return this.active !== null; }

  begin(owner: object, context: number): ToolOperationTicket | null {
    if (this.active) return null;
    return this.active = { owner, context };
  }

  settle(ticket: ToolOperationTicket, context: number, owner: object | null): 'stale' | 'detached' | 'current' {
    if (this.active !== ticket) return 'stale';
    this.active = null;
    if (ticket.context !== context) return 'stale';
    return ticket.owner === owner ? 'current' : 'detached';
  }
}
