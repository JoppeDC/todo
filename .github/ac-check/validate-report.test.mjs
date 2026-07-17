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

  fs.writeFileSync(acInput, rawAc)
  fs.writeFileSync(bugsInput, rawBugs)
  fs.writeFileSync(changedFiles, files)

  const processResult = spawnSync(process.execPath, [validator, acInput, bugsInput, output, changedFiles], {
    encoding: 'utf8',
  })

  return {
    ...processResult,
    report: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '',
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
      },
    ],
    risks: [],
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
  assert.match(result.report, /\| ✅ \| State persists after refresh \|  \|/u)
})

test('computes a yellow verdict when a criterion has a gap', () => {
  const result = validate({
    ac: validAc({
      criteria: [{
        status: 'partial',
        criterion: 'State persists after refresh',
        notes: 'Completed items are not restored',
      }],
    }),
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.report, /^🟡 /u)
})

test('computes a red verdict when the bug report has a bug', () => {
  const result = validate({
    bugs: {
      bugs: [{
        file: 'src/App.jsx',
        description: 'Clearing completed items removes active items too',
      }],
    },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.report, /^🔴 /u)
  assert.match(result.report, /Clearing completed items removes active items too; src\/App\.jsx/u)
})

test('rejects notes on a met criterion', () => {
  const result = validate({
    ac: validAc({
      criteria: [{
        status: 'met',
        criterion: 'State persists after refresh',
        notes: 'Implemented in the application',
      }],
    }),
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /notes must be empty/u)
})

test('rejects a bug attributed to an unchanged file', () => {
  const result = validate({
    bugs: {
      bugs: [{
        file: 'src/Other.jsx',
        description: 'The action returns the wrong result',
      }],
    },
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /not present/u)
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
