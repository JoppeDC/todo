// Agent responses are either pure JSON or narration containing exactly one
// fenced ```json block. Throws with a human-readable reason otherwise.
export function parseAgentResponse(content) {
  try {
    return JSON.parse(content)
  } catch (directError) {
    const jsonBlocks = [...content.matchAll(/```json\s*([\s\S]*?)```/giu)]
    if (jsonBlocks.length !== 1) {
      throw new Error('must be pure JSON or contain exactly one fenced JSON block')
    }
    return JSON.parse(jsonBlocks[0][1].trim())
  }
}
