/** A Kiro PreToolUse event, as the hook receives it on stdin. */
export interface ToolUseEvent {
  hook_event_name?: string;
  cwd?: string;
  session_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

/** Returns the reason a tool call must be blocked, or null when it may run. */
export function blockReason(event: ToolUseEvent): string | null;
