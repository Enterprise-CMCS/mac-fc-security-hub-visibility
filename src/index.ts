import * as core from '@actions/core'
import {SecurityHubJiraSync} from '@enterprise-cmcs/macpro-security-hub-sync'

async function run(): Promise<void> {
  try {
    process.env.JIRA_HOST = 'localhost'
    process.env.JIRA_PROTOCOL = 'http'
    process.env.JIRA_PORT = '2990'
    process.env.JIRA_BASE = '/jira'
    process.env.JIRA_USERNAME = 'mac_fc_jira_ent'
    process.env.JIRA_TOKEN = 'NDk5MzQ4OTA3NTk0Op52vG3Lbw459HPN3CsQiYovBl0m'
    process.env.JIRA_PROJECT = 'MACFC'
    process.env.JIRA_CLOSED_STATUSES = core.getInput('jira-ignore-statuses')
    process.env.AUTO_CLOSE = core.getInput('auto-close')
    process.env.ASSIGNEE = core.getInput('assign-jira-ticket-to')
    process.env.JIRA_LINK_ID = core.getInput('jira-link-id')
    process.env.JIRA_LINK_TYPE = core.getInput('jira-link-type')
    process.env.INCLUDE_ALL_PRODUCTS = core.getInput('include-all-products')
    process.env.JIRA_LINK_DIRECTION = core.getInput('jira-link-direction')
    process.env.LABELS_CONFIG = core.getInput('jira-labels-config')

    const productList: string[] = core
      .getInput('skip-products')
      .split(',')
      .map((product: string) => product.trim())
    process.env.SKIP_PRODUCTS = productList.join(',')

    let customJiraFields
    const customJiraFieldsInput = core.getInput('jira-custom-fields')
    if (customJiraFieldsInput) {
      try {
        customJiraFields = JSON.parse(customJiraFieldsInput)
      } catch (e: any) {
        throw new Error(
          `Error parsing JSON string for jira-custom-fields input: ${e.message}`
        )
      }
    }

    core.info('Syncing Security Hub and Jira')
    await new SecurityHubJiraSync({
      region: 'us-east-1',
      severities: 'CRITICAL, HIGH, MEDIUM'.split(',')
        .map(severity => severity.trim()),
      epicKey: core.getInput('jira-epic-key'),
      customJiraFields
    }).sync()
  } catch (e: any) {
    core.setFailed(`Sync failed: ${e.message}`)
  }
}

run()
