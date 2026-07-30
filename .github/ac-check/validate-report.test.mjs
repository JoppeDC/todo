import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const validator = fileURLToPath(new URL('./validate-report.mjs', import.meta.url))

const defaultRules = '# Review rules\n\n## i18n-labels\n\nLabel wording is i18n-configurable.\n'

function validateRaw(raw, { files = 'M\tsrc/App.jsx\n', rules = defaultRules } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-report-'))
  const input = path.join(directory, 'finalize-response.txt')
  const output = path.join(directory, 'report.md')
  const changedFiles = path.join(directory, 'files.txt')
  const rulesFile = path.join(directory, 'rules.md')
  const actionOutput = path.join(directory, 'github-output.txt')
  const droppedOutput = path.join(directory, 'dropped.md')

  fs.writeFileSync(input, raw)
  fs.writeFileSync(changedFiles, files)
  fs.writeFileSync(rulesFile, rules)

  const processResult = spawnSync(
    process.execPath,
    [validator, input, output, changedFiles, rulesFile, droppedOutput],
    { encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: actionOutput } },
  )

  return {
    ...processResult,
    report: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '',
    actionOutput: fs.existsSync(actionOutput) ? fs.readFileSync(actionOutput, 'utf8') : '',
    dropped: fs.existsSync(droppedOutput) ? fs.readFileSync(droppedOutput, 'utf8') : '',
  }
}

function validCriterion(overrides = {}) {
  return {
    status: 'met',
    criterion: 'State persists after refresh',
    notes: '',
    evidence: 'src/App.jsx:24 restores todos from local storage during initialization',
    ...overrides,
  }
}

function validBug(overrides = {}) {
  return {
    file: 'src/App.jsx',
    line: 42,
    trigger: 'Clear completed todos after adding one active todo',
    description: 'Clearing completed items removes active items too',
    evidence: 'The clear handler filters for completed items instead of active items',
    ...overrides,
  }
}

function validDropped(overrides = {}) {
  return {
    kind: 'bug',
    rule: 'i18n-labels',
    reason: 'Label wording difference is i18n-configurable, not an AC gap',
    ...overrides,
  }
}

function validReport(overrides = {}) {
  return {
    summary: 'The change meets the ticket requirements.',
    criteria: [validCriterion()],
    risks: [],
    bugs: [],
    dropped: [],
    ...overrides,
  }
}

function validate({ report = validReport(), files, rules } = {}) {
  return validateRaw(JSON.stringify(report), { files, rules })
}

test('renders a green report when every criterion is met and there are no bugs', () => {
  const result = validate()

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.report, /^🟢 /u)
  assert.match(result.report, /\| Status \| Acceptance criterion \| Notes \|/u)
  assert.match(result.report, /\| ✅ \| State persists after refresh \|  \|/u)
  assert.doesNotMatch(result.report, /Evidence|src\/App\.jsx:24 restores todos/u)
  assert.match(result.actionOutput, /^all_met=true$/mu)
  assert.match(result.actionOutput, /^has_bugs=false$/mu)
})

test('computes a yellow verdict when a criterion has a gap', () => {
  const result = validate({
    report: validReport({
      criteria: [validCriterion({
        status: 'partial',
        notes: 'Completed items are not restored',
      })],
    }),
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.report, /^🟡 /u)
  assert.match(result.actionOutput, /^all_met=false$/mu)
})

test('renders bugs as a compact list without replacing the AC verdict', () => {
  const result = validate({ report: validReport({ bugs: [validBug()] }) })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.report, /^🟢 /u)
  assert.match(result.report, /- 🔴 Clearing completed items removes active items too — `src\/App\.jsx:42`/u)
  assert.doesNotMatch(result.report, /Trigger:|Evidence:/u)
  assert.match(result.actionOutput, /^has_bugs=true$/mu)
})

test('truncates an overlong summary instead of rejecting the report', () => {
  const result = validate({
    report: validReport({
      summary: `The change meets the ticket requirements. ${'Additional generated explanation. '.repeat(12)}END`,
    }),
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.report, /^🟢 \*\*.{239}…\*\*$/mu)
  assert.doesNotMatch(result.report, /END/u)
})

test('normalizes generated Markdown in visible table text', () => {
  const result = validate({
    report: validReport({
      criteria: [validCriterion({
        status: 'partial',
        criterion: 'State | persists\n[after refresh](https://example.test)',
        notes: 'The `completed` state\nis not restored',
        evidence: 'src/App.jsx contains the relevant state restoration branch',
      })],
    }),
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.report, /\| ⚠️ \| State \\\| persists after refresh \| The completed state is not restored \|/u)
})

test('rejects notes on a met criterion', () => {
  const result = validate({
    report: validReport({
      criteria: [validCriterion({ notes: 'Implemented in the application' })],
    }),
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /notes must be empty/u)
})

test('rejects a criterion without auditable evidence', () => {
  const criterion = validCriterion()
  delete criterion.evidence
  const result = validate({ report: validReport({ criteria: [criterion] }) })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /must contain exactly/u)
})

test('rejects a bug attributed to an unchanged file', () => {
  const result = validate({ report: validReport({ bugs: [validBug({ file: 'src/Other.jsx' })] }) })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /not present/u)
})

test('accepts no assessable criteria as a deliberate failing verdict', () => {
  const result = validate({
    report: validReport({
      summary: 'The ticket contains no concrete acceptance criteria to assess.',
      criteria: [],
    }),
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.report, /^🟡 /u)
  assert.match(result.report, /No concrete acceptance criteria could be derived/u)
  assert.match(result.actionOutput, /^all_met=false$/mu)
})

test('accepts a null line for a bug caused by deleted code', () => {
  const result = validate({ report: validReport({ bugs: [validBug({ line: null })] }) })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.report, /active items too — `src\/App\.jsx`/u)
})

test('rejects an invalid bug line', () => {
  const result = validate({ report: validReport({ bugs: [validBug({ line: 0 })] }) })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /positive integer or null/u)
})

test('rejects a bug without a reproduction trigger', () => {
  const bug = validBug()
  delete bug.trigger
  const result = validate({ report: validReport({ bugs: [bug] }) })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /must contain exactly/u)
})

test('rejects a report missing the dropped key', () => {
  const report = validReport()
  delete report.dropped
  const result = validate({ report })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /report root must contain exactly/u)
})

test('rejects a report with an unexpected root key', () => {
  const result = validate({ report: { ...validReport(), extra: true } })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /report root must contain exactly/u)
})

test('accepts a dropped entry citing a known rule and reports its count', () => {
  const result = validate({ report: validReport({ dropped: [validDropped()] }) })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.actionOutput, /^dropped=1$/mu)
})

test('reports a zero dropped count when nothing was dropped', () => {
  const result = validate()

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.actionOutput, /^dropped=0$/mu)
})

test('accepts a dropped entry with a null rule', () => {
  const result = validate({ report: validReport({ dropped: [validDropped({ rule: null })] }) })

  assert.equal(result.status, 0, result.stderr)
})

test('rejects a dropped entry citing an unknown rule', () => {
  const result = validate({ report: validReport({ dropped: [validDropped({ rule: 'no-such-rule' })] }) })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /does not match any rule/u)
})

test('rejects a dropped entry with an invalid kind', () => {
  const result = validate({ report: validReport({ dropped: [validDropped({ kind: 'risk' })] }) })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /kind must be/u)
})

test('rejects more than 50 dropped entries', () => {
  const dropped = Array.from({ length: 51 }, () => validDropped())
  const result = validate({ report: validReport({ dropped }) })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /at most 50/u)
})

test('never renders dropped entries in the report body', () => {
  const result = validate({ report: validReport({ dropped: [validDropped()] }) })

  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(result.report, /i18n-configurable|i18n-labels/u)
})

test('extracts one fenced JSON result from narration', () => {
  const raw = `I verified the analyses.\n\n\`\`\`javascript\nconst example = true\n\`\`\`\n\n\`\`\`json\n${JSON.stringify(validReport(), null, 2)}\n\`\`\``
  const result = validateRaw(raw)

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.report, /^🟢 /u)
})

test('rejects ambiguous output with multiple fenced JSON results', () => {
  const json = JSON.stringify(validReport())
  const result = validateRaw(`\`\`\`json\n${json}\n\`\`\`\n\`\`\`json\n${json}\n\`\`\``)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /exactly one fenced JSON block/u)
})

test('renders dropped entries into the dropped report with sanitized text', () => {
  const result = validate({
    report: validReport({
      dropped: [validDropped({ reason: 'Label `wording`\ndiffers | only' })],
    }),
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.dropped, /\| bug \| i18n-labels \| Label wording differs \\\| only \|/u)
})

test('renders a null rule as verification in the dropped report', () => {
  const result = validate({ report: validReport({ dropped: [validDropped({ rule: null })] }) })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.dropped, /\| bug \| verification \| /u)
})

test('writes an empty dropped report when nothing was dropped', () => {
  const result = validate()

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.dropped, '')
})
