import {describe, it, expect, vi, beforeAll, afterAll} from 'vitest'
import http from 'http'
import {AddressInfo} from 'net'
import {Jira} from '../libs/jira-lib'

// src/index.ts calls run() on import; replace it with just the helper jira-lib needs.
vi.mock('../index', () => ({
  extractErrorMessage: (e: unknown) =>
    e instanceof Error ? e.message : String(e)
}))

// Local fake Jira that returns a configurable status for every request
let mode = 503
let hits = 0
let base = ''
let server: http.Server

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits++
    if (mode === 200) {
      res.writeHead(200, {'Content-Type': 'application/json'})
      res.end(
        JSON.stringify({
          issues: [
            {id: '1', key: 'CME-1', fields: {summary: 's', description: 'd'}}
          ],
          total: 1
        })
      )
    } else {
      res.writeHead(mode, {'Content-Type': 'text/html'})
      res.end(`<html>${mode}</html>`)
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => server.close())

const jira = () =>
  new Jira({
    jiraBaseURI: base,
    jiraUsername: 'u',
    jiraToken: 't',
    jiraProjectKey: 'CME',
    jiraIgnoreStatuses: 'Done',
    transitionMap: [],
    dryRunTestData: false,
    includeAllProducts: false,
    jiraApiVersion: '2',
    jiraRetryDelay: 50 // keep the test fast
  } as never)

const labels = ['123456789012', 'us-east-1']

describe(`Jira search retry against a fake server (Node ${process.version})`, () => {
  it('retries twice on 503 (3 requests total)', async () => {
    mode = 503
    hits = 0
    await expect(
      jira().getAllSecurityHubIssuesInJiraProject(labels)
    ).rejects.toThrow(/503/)
    expect(hits).toBe(3)
  })

  it('retries twice on edge/WAF 403 (3 requests total)', async () => {
    mode = 403
    hits = 0
    await expect(
      jira().getAllSecurityHubIssuesInJiraProject(labels)
    ).rejects.toThrow(/403/)
    expect(hits).toBe(3)
  })

  it('makes a single request and returns issues on 200', async () => {
    mode = 200
    hits = 0
    const issues = await jira().getAllSecurityHubIssuesInJiraProject(labels)
    expect(issues).toHaveLength(1)
    expect(hits).toBe(1)
  })
})
