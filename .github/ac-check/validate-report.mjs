import fs from 'node:fs'

const [inputPath = 'copilot-response.txt', outputPath = 'ac-report.md', filesPath = 'files.txt'] = process.argv.slice(2)

function fail(message) {
  console.error(`::error::Invalid AC report: ${message}`)
  process.exit(1)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireKeys(value, expected, context) {
  if (!isObject(value)) fail(`${context} must be an object`)

  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${context} must contain exactly: ${wanted.join(', ')}`)
  }
}

function requireString(value, context, maxLength) {
  if (typeof value !== 'string') fail(`${context} must be a string`)
  if (value !== value.trim() || value.length === 0) fail(`${context} must be non-empty and trimmed`)
  if (value.length > maxLength) fail(`${context} exceeds ${maxLength} characters`)
  if (/\r|\n|\||```|\]\(|https?:\/\//u.test(value)) {
    fail(`${context} contains forbidden Markdown, a link, or a line break`)
  }
}

function changedFiles(path) {
  const files = new Set()
  const content = fs.readFileSync(path, 'utf8').trim()
  if (!content) return files

  for (const line of content.split('\n')) {
    const fields = line.split('\t')
    for (const file of fields.slice(1)) files.add(file)
  }
  return files
}

function parseResult(path) {
  const content = fs.readFileSync(path, 'utf8').trim()

  try {
    return JSON.parse(content)
  } catch (directError) {
    const jsonBlocks = [...content.matchAll(/```json\s*([\s\S]*?)```/giu)]
    if (jsonBlocks.length !== 1) {
      fail(`${path} must be pure JSON or contain exactly one fenced JSON block`)
    }

    try {
      return JSON.parse(jsonBlocks[0][1].trim())
    } catch (blockError) {
      fail(`could not parse the fenced JSON block in ${path}: ${blockError.message}`)
    }
  }
}

const result = parseResult(inputPath)

requireKeys(result, ['summary', 'criteria', 'bugs', 'risks'], 'root')
requireString(result.summary, 'summary', 240)

if (!Array.isArray(result.criteria) || result.criteria.length < 1 || result.criteria.length > 12) {
  fail('criteria must contain between 1 and 12 items')
}

const statuses = new Set(['met', 'partial', 'missing', 'not_verifiable'])
for (const [index, criterion] of result.criteria.entries()) {
  const context = `criteria[${index}]`
  requireKeys(criterion, ['status', 'criterion', 'notes'], context)
  if (!statuses.has(criterion.status)) fail(`${context}.status is invalid`)
  requireString(criterion.criterion, `${context}.criterion`, 120)

  if (criterion.status === 'met') {
    if (criterion.notes !== '') fail(`${context}.notes must be empty when status is met`)
  } else {
    requireString(criterion.notes, `${context}.notes`, 180)
  }
}

if (!Array.isArray(result.bugs) || result.bugs.length > 8) {
  fail('bugs must be an array with at most 8 items')
}

const files = changedFiles(filesPath)
for (const [index, bug] of result.bugs.entries()) {
  const context = `bugs[${index}]`
  requireKeys(bug, ['file', 'description'], context)
  requireString(bug.file, `${context}.file`, 240)
  requireString(bug.description, `${context}.description`, 220)
  if (!files.has(bug.file)) fail(`${context}.file is not present in ${filesPath}`)
}

if (!Array.isArray(result.risks) || result.risks.length > 4) {
  fail('risks must be an array with at most 4 items')
}
for (const [index, risk] of result.risks.entries()) {
  requireString(risk, `risks[${index}]`, 180)
}

const prose = [
  result.summary,
  ...result.criteria.flatMap(({ criterion, notes }) => [criterion, notes]),
  ...result.bugs.flatMap(({ file, description }) => [file, description]),
  ...result.risks,
].filter(Boolean)
const proseWords = prose.join(' ').trim().split(/\s+/u).length
if (proseWords > 130) fail(`prose contains ${proseWords} words; maximum is 130`)

const hasBug = result.bugs.length > 0
const hasGap = result.criteria.some(({ status }) => status !== 'met')
const verdict = hasBug ? '🔴' : hasGap ? '🟡' : '🟢'
const statusEmoji = {
  met: '✅',
  partial: '⚠️',
  missing: '❌',
  not_verifiable: '❓',
}

const lines = [
  `${verdict} **${result.summary}**`,
  '',
  '| Status | Acceptance criterion | Notes |',
  '|:------:|----------------------|-------|',
  ...result.criteria.map(({ status, criterion, notes }) =>
    `| ${statusEmoji[status]} | ${criterion} | ${notes} |`,
  ),
]

if (hasBug) {
  lines.push('', '**Bugs**')
  for (const { file, description } of result.bugs) lines.push(`🔴 ${description}; ${file}`)
}

if (result.risks.length > 0) {
  lines.push('', `**Risks:** ${result.risks.join('; ')}`)
}

lines.push('', '_Preliminary automated check — not a substitute for review or testing._', '')

const report = lines.join('\n')
if (Buffer.byteLength(report, 'utf8') > 8_000) fail('rendered report exceeds 8 KB')

fs.writeFileSync(outputPath, report)
console.log(`Validated ${result.criteria.length} criteria and ${result.bugs.length} bugs; verdict ${verdict}`)
