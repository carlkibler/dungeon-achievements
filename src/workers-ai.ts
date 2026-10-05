/** Normalize the binding's text or already-decoded achievement JSON for the shared parser. */
export function readWorkersAIText(result: unknown, model: string): string {
    const output = result as {
        response?: unknown;
        choices?: Array<{ message?: { content?: unknown } }>;
    } | null;
    const response = output?.response;
    let text: string | undefined;

    if (typeof response === 'string') {
        text = response;
    } else if (response && typeof response === 'object') {
        // Observed during fallback: response is not always the string promised by the SDK types.
        // Preserve the JSON payload; resolveModelOutput still validates cards and handles refusals.
        text = JSON.stringify(response);
    }

    if (!text?.trim()) {
        const content = output?.choices?.[0]?.message?.content;
        if (typeof content === 'string') text = content;
    }
    if (!text?.trim()) {
        throw new Error(`workers-ai returned no usable text for ${model} (response type: ${response === null ? 'null' : typeof response})`);
    }
    return text;
}
