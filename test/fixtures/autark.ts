/** Build explicit spoken turns for deterministic provider fixtures. Legacy
 * checkpoint fixtures retain their original reply representation separately. */
export function spokenTurn(value: string | Record<string, unknown>): string {
  let fields: Record<string, unknown> = {};
  let speech: unknown = value;
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'reply' in parsed) {
        fields = parsed as Record<string, unknown>;
        speech = fields.reply;
      }
    } catch { /* Literal outward words, not a decision object. */ }
  } else { fields = value; speech = fields.reply; }
  const { reply: _reply, ...decision } = fields;
  return JSON.stringify({ version: 'autark-turn/1', actions: [{ name: 'say', arguments: { text: speech } }], ...decision });
}
