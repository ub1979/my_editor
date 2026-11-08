/** File chat may follow a source file, but must not replace an agent chat the user is viewing. */
const visible = { sidebar: false, lounge: false };
export function setAgentChatVisible(surface: keyof typeof visible, value: boolean): void { visible[surface] = value; }
export function agentChatVisible(): boolean { return visible.sidebar || visible.lounge; }
