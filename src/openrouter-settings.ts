export const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-haiku-5.5';

// Haiku 5.5 otherwise spends the generation budget thinking and can return empty text.
// Keep both generation and the five-token triage call in the tested non-thinking mode.
export function openRouterSettings(model: string) {
    return model.startsWith('anthropic/claude-haiku-5.5')
        ? { reasoning: { enabled: false } }
        : {};
}
