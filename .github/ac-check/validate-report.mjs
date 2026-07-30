import fs from 'node:fs'

import { parseAgentResponse } from './parse-response.mjs'

const [
  responsePath = 'finalize-response.txt',
  outputPath = 'ac-report.md',
  filesPath = 'files.txt',
  rulesPath = 'rules.md',
  droppedPath = 'ac-dropped.md',
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
  if (value.trim().length === 0) fail(`${context} must be non-empty`)
  if (value.length > maxLength) fail(`${context} exceeds ${maxLength} characters`)
}

function inlineText(value, maxLength) {
  const plain = value
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/```(?:[a-z0-9_-]+)?/giu, '')
    .replace(/`/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  const shortened = plain.length <= maxLength
    ? plain
    : `${plain.slice(0, maxLength - 1).trimEnd()}…`
  return shortened.replace(/\|/gu, '\\|')
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

function ruleIds(path) {
  const ids = new Set()
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^##\s+(.+?)\s*$/u)
    if (match) ids.add(match[1])
  }
  return ids
}

function parseResult(path) {
  try {
    return parseAgentResponse(fs.readFileSync(path, 'utf8').trim())
  } catch (error) {
    fail(`${path} ${error.message.startsWith('must be') ? error.message : `could not be parsed: ${error.message}`}`)
  }
}

const report = parseResult(responsePath)

requireKeys(report, ['summary', 'criteria', 'risks', 'bugs', 'dropped'], 'report root')
requireString(report.summary, 'summary', 4_000)

if (!Array.isArray(report.criteria) || report.criteria.length > 25) {
  fail('criteria must be an array with at most 25 items')
}

const statuses = new Set(['met', 'partial', 'missing', 'not_verifiable'])
for (const [index, criterion] of report.criteria.entries()) {
  const context = `criteria[${index}]`
  requireKeys(criterion, ['status', 'criterion', 'notes', 'evidence'], context)
  if (!statuses.has(criterion.status)) fail(`${context}.status is invalid`)
  requireString(criterion.criterion, `${context}.criterion`, 2_000)

  if (criterion.status === 'met') {
    if (criterion.notes !== '') fail(`${context}.notes must be empty when status is met`)
  } else {
    requireString(criterion.notes, `${context}.notes`, 4_000)
  }
  requireString(criterion.evidence, `${context}.evidence`, 8_000)
}

if (!Array.isArray(report.risks) || report.risks.length > 4) {
  fail('risks must be an array with at most 4 items')
}
for (const [index, risk] of report.risks.entries()) {
  requireString(risk, `risks[${index}]`, 4_000)
}

if (!Array.isArray(report.bugs) || report.bugs.length > 25) {
  fail('bugs must be an array with at most 25 items')
}

const files = changedFiles(filesPath)
for (const [index, bug] of report.bugs.entries()) {
  const context = `bugs[${index}]`
  requireKeys(bug, ['file', 'line', 'trigger', 'description', 'evidence'], context)
  requireString(bug.file, `${context}.file`, 240)
  requireLine(bug.line, `${context}.line`)
  requireString(bug.trigger, `${context}.trigger`, 4_000)
  requireString(bug.description, `${context}.description`, 4_000)
  requireString(bug.evidence, `${context}.evidence`, 8_000)
  if (!files.has(bug.file)) fail(`${context}.file is not present in ${filesPath}`)
}

const rules = ruleIds(rulesPath)
if (!Array.isArray(report.dropped) || report.dropped.length > 50) {
  fail('dropped must be an array with at most 50 items')
}
for (const [index, entry] of report.dropped.entries()) {
  const context = `dropped[${index}]`
  requireKeys(entry, ['kind', 'rule', 'reason'], context)
  if (entry.kind !== 'criterion' && entry.kind !== 'bug') {
    fail(`${context}.kind must be 'criterion' or 'bug'`)
  }
  if (entry.rule !== null) {
    requireString(entry.rule, `${context}.rule`, 200)
    if (!rules.has(entry.rule)) {
      fail(`${context}.rule '${entry.rule}' does not match any rule in ${rulesPath}`)
    }
  }
  requireString(entry.reason, `${context}.reason`, 4_000)
}

const hasBug = report.bugs.length > 0
const hasGap = report.criteria.length === 0 || report.criteria.some(({ status }) => status !== 'met')
const acVerdict = hasGap ? '🟡' : '🟢'
const statusEmoji = {
  met: '✅',
  partial: '⚠️',
  missing: '❌',
  not_verifiable: '❓',
}

const lines = [`${acVerdict} **${inlineText(report.summary, 240)}**`, '']

if (report.criteria.length === 0) {
  lines.push('_No concrete acceptance criteria could be derived from the supplied ticket._')
} else {
  lines.push(
    '| Status | Acceptance criterion | Notes |',
    '|:------:|----------------------|-------|',
    ...report.criteria.map(({ status, criterion, notes }) =>
      `| ${statusEmoji[status]} | ${inlineText(criterion, 120)} | ${notes === '' ? '' : inlineText(notes, 240)} |`,
    ),
  )
}

if (hasBug) {
  lines.push('', '**Bugs**')
  for (const { file, line, description } of report.bugs) {
    lines.push(`- 🔴 ${inlineText(description, 240)} — \`${file}${line === null ? '' : `:${line}`}\``)
  }
}

if (report.risks.length > 0) {
  lines.push('', `**Risks:** ${report.risks.map((risk) => inlineText(risk, 180)).join('; ')}`)
}

lines.push('', '_Preliminary automated check — not a substitute for review or testing._', '')

const rendered = lines.join('\n')
if (Buffer.byteLength(rendered, 'utf8') > 55_000) fail('rendered report exceeds 55 KB')

fs.writeFileSync(outputPath, rendered)

const droppedLines = report.dropped.length === 0 ? [] : [
  '',
  '**Dropped in verification**',
  '',
  '| Kind | Rule | Reason |',
  '|------|------|--------|',
  ...report.dropped.map(({ kind, rule, reason }) =>
    `| ${kind} | ${rule === null ? 'verification' : inlineText(rule, 80)} | ${inlineText(reason, 240)} |`,
  ),
  '',
]
fs.writeFileSync(droppedPath, droppedLines.join('\n'))

// The workflow reads these: the comment footer renders the dropped count, and
// the enforce step gates on all_met / has_bugs — a deliberate divergence from
// cf-ai-workflow, which reports without gating.
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `dropped=${report.dropped.length}\nall_met=${hasGap ? 'false' : 'true'}\nhas_bugs=${hasBug ? 'true' : 'false'}\n`,
  )
}
console.log(`Validated ${report.criteria.length} criteria, ${report.bugs.length} bugs, ${report.dropped.length} dropped; AC verdict ${acVerdict}`)
