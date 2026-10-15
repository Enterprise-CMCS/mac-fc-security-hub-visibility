import {describe, it, expect, vi} from 'vitest'
import {AxiosError, AxiosResponse, InternalAxiosRequestConfig} from 'axios'
import {isRetryableJiraError} from '../libs/jira-lib'

// src/index.ts calls run() on import, which would execute the whole action.
// Replace it with just the helper jira-lib needs.
vi.mock('../index', () => ({
  extractErrorMessage: (e: unknown) =>
    e instanceof Error ? e.message : String(e)
}))

const err = (
  method: string,
  url: string,
  status?: number,
  data: unknown = {}
): AxiosError => {
  const config = {method, url, headers: {}} as InternalAxiosRequestConfig
  const response = status
    ? ({status, data, headers: {}, config} as AxiosResponse)
    : undefined
  return new AxiosError(
    'x',
    status ? 'ERR_BAD_RESPONSE' : 'ECONNRESET',
    config,
    {},
    response
  )
}

describe('isRetryableJiraError', () => {
  it('retries network errors', () =>
    expect(isRetryableJiraError(err('post', '/rest/api/2/issue'))).toBe(true))
  it('retries 503 on search POST', () =>
    expect(isRetryableJiraError(err('post', '/rest/api/2/search', 503))).toBe(
      true
    ))
  it('retries 429 on GET', () =>
    expect(isRetryableJiraError(err('get', '/rest/api/2/myself', 429))).toBe(
      true
    ))
  it('does NOT retry 503 on create-issue POST', () =>
    expect(isRetryableJiraError(err('post', '/rest/api/2/issue', 503))).toBe(
      false
    ))
  it('retries edge HTML 403 on search', () =>
    expect(
      isRetryableJiraError(
        err('post', '/rest/api/2/search', 403, '<html>403</html>')
      )
    ).toBe(true))
  it('does NOT retry Jira JSON 403', () =>
    expect(
      isRetryableJiraError(
        err('post', '/rest/api/2/search', 403, {errorMessages: ['nope']})
      )
    ).toBe(false))
  it('does NOT retry 400/401', () =>
    expect(isRetryableJiraError(err('get', '/rest/api/2/myself', 401))).toBe(
      false
    ))
})
