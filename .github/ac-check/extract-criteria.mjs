import fs from 'node:fs'

import { parseAgentResponse } from './parse-response.mjs'

// Pulls the criteria out of the AC review response so the bug hunt agent can
// exclude already-reported gaps. Lenient by design: a malformed AC response
// only costs the bug hunt its exclusion list — the validate step still fails
// the job on the same malformed response afterwards.
const [inputPath = 'ac-response.txt', outputPath = 'ac-findings.json'] = process.argv.slice(2)

try {
  const result = parseAgentResponse(fs.readFileSync(inputPath, 'utf8').trim())
  if (!Array.isArray(result.criteria)) throw new Error('criteria is not an array')
  fs.writeFileSync(outputPath, `${JSON.stringify({ criteria: result.criteria }, null, 2)}\n`)
  console.log(`Wrote ${result.criteria.length} criteria to ${outputPath}`)
} catch (error) {
  console.warn(`::warning::Could not extract AC findings (${error.message}); the bug hunt runs without them`)
}
