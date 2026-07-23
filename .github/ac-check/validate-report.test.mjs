import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const validator = fileURLToPath(new URL('./validate-report.mjs', import.meta.url))

function validateRaw(rawAc, rawBugs, files = 'M\tsrc/App.jsx\n') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-report-'))
  const acInput = path.join(directory, 'ac-response.txt')
  const bugsInput = path.join(directory, 'bugs-response.txt')
  const output = path.join(directory, 'report.md')
  const changedFiles = path.join(directory, 'files.txt')
  const actionOutput = path.join(directory, 'github-output.txt')

  fs.writeFileSync(acInput, rawAc)
  fs.writeFileSync(bugsInput, rawBugs)
  fs.writeFileSync(changedFiles, files)

  const processResult = spawnSync(process.execPath, [validator, acInput, bugsInput, output, changedFiles], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: actionOutput },
  })

  return {
    ...processResult,
    report: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '',
    actionOutput: fs.existsSync(actionOutput) ? fs.readFileSync(actionOutput, 'utf8') : '',
  }
}

function validAc(overrides = {}) {
  return {
    summary: 'The change meets the ticket requirements.',
    criteria: [
      {
        status: 'met',
        criterion: 'State persists after refresh',
        notes: '',
        evidence: 'src/App.jsx:24 restores todos from local storage during initialization',
      },
    ],
    risks: [],
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

function validate({ ac = validAc(), bugs = { bugs: [] }, files } = {}) {
  return validateRaw(JSON.stringify(ac), JSON.stringify(bugs), files)
}

test('renders a green report when every criterion is met and there are no bugs', () => {
  const result = validate()

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.report, /^🟢 /u)
  assert.match(result.report, /\| Status \| Acceptance criterion \| Notes \|/u)
  assert.match(result.report, /\| ✅ \| State persists after refresh \|  \|/u)
  assert.doesNotMatch(result.report, /Evidence|src\/App\.jsx:24 restores todos/u)
})

test('truncates an overlong summary instead of rejecting the report', () => {
  const result = validate({
    ac: validAc({
      summary: `The change meets the ticket requirements. ${'Additional generated explanation. '.repeat(12)}END`,
    }),
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.report, /^🟢 \*\*.{239}…\*\*$/mu)
  assert.doesNotMatch(result.report, /END/u)
})

test('accepts Markdown and line breaks in hidden evidence', () => {
  const result = validate({
    bugs: {
      bugs: [validBug({
        evidence: 'The changed handler calls `removeAll()`.\nSee [the trace](https://example.test/trace) for details.',
      })],
    },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(result.report, /removeAll|example\.test/u)
})

test('normalizes generated Markdown in visible table text', () => {
  const result = validate({
    ac: validAc({
      criteria: [{
        status: 'partial',
        criterion: 'State | persists\n[after refresh](https://example.test)',
        notes: 'The `completed` state\nis not restored',
        evidence: 'src/App.jsx contains the relevant state restoration branch',
      }],
    }),
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.report, /\| ⚠️ \| State \\\| persists after refresh \| The completed state is not restored \|/u)
})

test('computes a yellow verdict when a criterion has a gap', () => {
  const result = validate({
    ac: validAc({
      criteria: [{
        status: 'partial',
        criterion: 'State persists after refresh',
        notes: 'Completed items are not restored',
        evidence: 'src/App.jsx:24 restores only todos whose completed value is false',
      }],
    }),
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.report, /^🟡 /u)
})

test('renders bugs as a compact list without replacing the AC verdict', () => {
  const result = validate({
    bugs: {
      bugs: [validBug()],
    },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.report, /^🟢 /u)
  assert.match(result.report, /- 🔴 Clearing completed items removes active items too — `src\/App\.jsx:42`/u)
  assert.doesNotMatch(result.report, /Trigger:|Evidence:/u)
})

test('rejects notes on a met criterion', () => {
  const result = validate({
    ac: validAc({
      criteria: [{
        status: 'met',
        criterion: 'State persists after refresh',
        notes: 'Implemented in the application',
        evidence: 'src/App.jsx:24 restores todos from local storage during initialization',
      }],
    }),
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /notes must be empty/u)
})

test('rejects a criterion without auditable evidence', () => {
  const criterion = { ...validAc().criteria[0] }
  delete criterion.evidence
  const result = validate({ ac: validAc({ criteria: [criterion] }) })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /must contain exactly/u)
})

test('rejects a bug attributed to an unchanged file', () => {
  const result = validate({
    bugs: {
      bugs: [validBug({ file: 'src/Other.jsx' })],
    },
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /not present/u)
})

test('accepts no assessable criteria as a deliberate failing verdict', () => {
  const result = validate({
    ac: validAc({
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
  const result = validate({
    bugs: { bugs: [validBug({ line: null })] },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.report, /active items too — `src\/App\.jsx`/u)
})

test('rejects an invalid bug line', () => {
  const result = validate({
    bugs: { bugs: [validBug({ line: 0 })] },
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /positive integer or null/u)
})

test('rejects a bug without a reproduction trigger', () => {
  const bug = validBug()
  delete bug.trigger
  const result = validate({ bugs: { bugs: [bug] } })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /must contain exactly/u)
})

test('allows independently valid agent reports beyond the former shared word budget', () => {
  const criteria = Array.from({ length: 6 }, (_, index) => ({
    status: 'partial',
    criterion: `Observable requirement number ${index + 1} remains incomplete for users`,
    notes: 'One requested outcome remains unavailable after the change is applied',
    evidence: `src/App.jsx:${index + 1} implements only the first branch of this requested outcome`,
  }))
  const bugs = Array.from({ length: 8 }, (_, index) => validBug({
    line: index + 1,
    trigger: `Perform currently reachable action number ${index + 1} after loading existing data`,
    description: `Action number ${index + 1} returns an observably incorrect result for the user`,
    evidence: `The changed branch number ${index + 1} returns the opposite state without a later correction`,
  }))
  const result = validate({ ac: validAc({ criteria }), bugs: { bugs } })

  assert.equal(result.status, 0, result.stderr)
})

test('rejects an AC response that still contains a bugs key', () => {
  const result = validate({ ac: { ...validAc(), bugs: [] } })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /AC root must contain exactly/u)
})

test('rejects a bug response with unexpected keys', () => {
  const result = validate({ bugs: { bugs: [], risks: [] } })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /bug root must contain exactly/u)
})

test('extracts one fenced JSON result per agent response from narration', () => {
  const rawAc = `I will inspect the supplied files.\n\n\`\`\`javascript\nconst example = true\n\`\`\`\n\n\`\`\`json\n${JSON.stringify(validAc(), null, 2)}\n\`\`\``
  const rawBugs = `No bugs found.\n\n\`\`\`json\n${JSON.stringify({ bugs: [] })}\n\`\`\``
  const result = validateRaw(rawAc, rawBugs)

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.report, /^🟢 /u)
})

test('rejects ambiguous output with multiple fenced JSON results', () => {
  const json = JSON.stringify({ bugs: [] })
  const result = validateRaw(
    JSON.stringify(validAc()),
    `\`\`\`json\n${json}\n\`\`\`\n\`\`\`json\n${json}\n\`\`\``,
  )

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /exactly one fenced JSON block/u)
})
