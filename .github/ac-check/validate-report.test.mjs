import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const validator = fileURLToPath(new URL('./validate-report.mjs', import.meta.url))

function validate(result, files = 'M\tsrc/App.jsx\n') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-report-'))
  const input = path.join(directory, 'result.json')
  const output = path.join(directory, 'report.md')
  const changedFiles = path.join(directory, 'files.txt')

  fs.writeFileSync(input, JSON.stringify(result))
  fs.writeFileSync(changedFiles, files)

  const processResult = spawnSync(process.execPath, [validator, input, output, changedFiles], {
    encoding: 'utf8',
  })

  return {
    ...processResult,
    report: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '',
  }
}

function validResult(overrides = {}) {
  return {
    summary: 'The change meets the ticket requirements.',
    criteria: [
      {
        status: 'met',
        criterion: 'State persists after refresh',
        notes: '',
      },
    ],
    bugs: [],
    risks: [],
    ...overrides,
  }
}

test('renders a green report when every criterion is met', () => {
  const result = validate(validResult())

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.report, /^🟢 /u)
  assert.match(result.report, /\| ✅ \| State persists after refresh \|  \|/u)
})

test('computes a yellow verdict when a criterion has a gap', () => {
  const result = validate(validResult({
    criteria: [{
      status: 'partial',
      criterion: 'State persists after refresh',
      notes: 'Completed items are not restored',
    }],
  }))

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.report, /^🟡 /u)
})

test('computes a red verdict when there is a bug', () => {
  const result = validate(validResult({
    bugs: [{
      file: 'src/App.jsx',
      description: 'Clearing completed items removes active items too',
    }],
  }))

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.report, /^🔴 /u)
  assert.match(result.report, /Clearing completed items removes active items too; src\/App\.jsx/u)
})

test('rejects notes on a met criterion', () => {
  const result = validate(validResult({
    criteria: [{
      status: 'met',
      criterion: 'State persists after refresh',
      notes: 'Implemented in the application',
    }],
  }))

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /notes must be empty/u)
})

test('rejects a bug attributed to an unchanged file', () => {
  const result = validate(validResult({
    bugs: [{
      file: 'src/Other.jsx',
      description: 'The action returns the wrong result',
    }],
  }))

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /not present/u)
})
