import fs from 'node:fs'

import { parseAgentResponse } from './parse-response.mjs'

const [
  acPath = 'ac-response.txt',
  bugsPath = 'bugs-response.txt',
  outputPath = 'ac-report.md',
  filesPath = 'files.txt',
] = process.argv.slice(2)

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

function requireLine(value, context) {
  if (value !== null && (!Number.isSafeInteger(value) || value < 1)) {
    fail(`${context} must be a positive integer or null`)
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
  try {
    return parseAgentResponse(fs.readFileSync(path, 'utf8').trim())
  } catch (error) {
    fail(`${path} ${error.message.startsWith('must be') ? error.message : `could not be parsed: ${error.message}`}`)
  }
}

const ac = parseResult(acPath)

requireKeys(ac, ['summary', 'criteria', 'risks'], 'AC root')
requireString(ac.summary, 'summary', 240)

if (!Array.isArray(ac.criteria) || ac.criteria.length > 25) {
  fail('criteria must be an array with at most 25 items')
}

const statuses = new Set(['met', 'partial', 'missing', 'not_verifiable'])
for (const [index, criterion] of ac.criteria.entries()) {
  const context = `criteria[${index}]`
  requireKeys(criterion, ['status', 'criterion', 'notes', 'evidence'], context)
  if (!statuses.has(criterion.status)) fail(`${context}.status is invalid`)
  requireString(criterion.criterion, `${context}.criterion`, 120)

  if (criterion.status === 'met') {
    if (criterion.notes !== '') fail(`${context}.notes must be empty when status is met`)
  } else {
    requireString(criterion.notes, `${context}.notes`, 240)
  }
  requireString(criterion.evidence, `${context}.evidence`, 300)
}

if (!Array.isArray(ac.risks) || ac.risks.length > 4) {
  fail('risks must be an array with at most 4 items')
}
for (const [index, risk] of ac.risks.entries()) {
  requireString(risk, `risks[${index}]`, 180)
}

const bugReport = parseResult(bugsPath)

requireKeys(bugReport, ['bugs'], 'bug root')
if (!Array.isArray(bugReport.bugs) || bugReport.bugs.length > 25) {
  fail('bugs must be an array with at most 25 items')
}

const files = changedFiles(filesPath)
for (const [index, bug] of bugReport.bugs.entries()) {
  const context = `bugs[${index}]`
  requireKeys(bug, ['file', 'line', 'trigger', 'description', 'evidence'], context)
  requireString(bug.file, `${context}.file`, 240)
  requireLine(bug.line, `${context}.line`)
  requireString(bug.trigger, `${context}.trigger`, 240)
  requireString(bug.description, `${context}.description`, 240)
  requireString(bug.evidence, `${context}.evidence`, 300)
  if (!files.has(bug.file)) fail(`${context}.file is not present in ${filesPath}`)
}

const hasBug = bugReport.bugs.length > 0
const hasGap = ac.criteria.length === 0 || ac.criteria.some(({ status }) => status !== 'met')
const acVerdict = hasGap ? '🟡' : '🟢'
const statusEmoji = {
  met: '✅',
  partial: '⚠️',
  missing: '❌',
  not_verifiable: '❓',
}

const lines = [`${acVerdict} **${ac.summary}**`, '']

if (ac.criteria.length === 0) {
  lines.push('_No concrete acceptance criteria could be derived from the supplied ticket._')
} else {
  lines.push(
    '| Status | Acceptance criterion | Notes |',
    '|:------:|----------------------|-------|',
    ...ac.criteria.map(({ status, criterion, notes }) =>
      `| ${statusEmoji[status]} | ${criterion} | ${notes} |`,
    ),
  )
}

if (hasBug) {
  lines.push('', '**Bugs**')
  for (const { file, line, description } of bugReport.bugs) {
    lines.push(`- 🔴 ${description} — \`${file}${line === null ? '' : `:${line}`}\``)
  }
}

if (ac.risks.length > 0) {
  lines.push('', `**Risks:** ${ac.risks.join('; ')}`)
}

lines.push('', '_Preliminary automated check — not a substitute for review or testing._', '')

const report = lines.join('\n')
if (Buffer.byteLength(report, 'utf8') > 55_000) fail('rendered report exceeds 55 KB')

fs.writeFileSync(outputPath, report)

// In CI the workflow's enforcement step reads these; locally GITHUB_OUTPUT is unset.
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `all_met=${hasGap ? 'false' : 'true'}\nhas_bugs=${hasBug ? 'true' : 'false'}\n`,
  )
}
console.log(`Validated ${ac.criteria.length} criteria and ${bugReport.bugs.length} bugs; AC verdict ${acVerdict}`)
