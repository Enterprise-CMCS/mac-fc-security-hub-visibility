# Security Hub Visibility

## A GitHub Action that syncs Security Hub findings with Jira issues

1. Gets all current findings from Security Hub, filtered by the `Severity` of the findings (default is `CRITICAL,HIGH,MEDIUM`)

2. Creates Jira issues for findings that do not already have a Jira issue

- To avoid creating duplicate issues, the search criteria use the custom label configuration as well as default configuration for three identifying search labels: region, AWS account ID, and "security-hub."

- each Security Hub Finding type (by title) is represented as a single issue, e.g. if there are three resources that have violated the 'S3.8' rule there will be a single S3.8 Jira issue created

3. Closes existing Jira issues in the target project if their underlying findings are no longer active

## Inputs

Inputs can either be provided by GitHub Action YAML, Please see `action.yml` or if being run locally via environment variables. In GitHub Action YAML files, input variables are lowercase and separated by dashes." For example, the environment variable `JIRA_BASE_URI` would be `jira-base-uri` if set in a GitHub Action YAML file.

### JIRA_BASE_URI

**Required: No**

**Default Value: https://jiraent.cms.gov**

Specifies the base URI prepended to all API calls.

### JIRA_USERNAME

**Required: Yes**

**Default Value: N/A**

Jira Username used to authenticate.

### JIRA_TOKEN

**Required: Yes**

**Default Value: N/A**

Jira Personal Access Token used to authenticate.

### JIRA_PROJECT

**Required: Yes**

**Default Value: N/A**

The Jira Project in which Security Hub tickets should be created in by this tool.

### JIRA_IGNORE_STATUSES

**Required: No**

**Default Value: 'Done, Closed, Resolved'**

Specifies the Jira issue statuses to omit when refreshing Security Hub Jira issues.

### JIRA_ASSIGNEE

**Required: No**

**Default Value: N/A**

Assignee to be used for any ticket created by this tool.

### JIRA_CUSTOM_FIELDS

**Required: No**

**Default Value: N/A**

JSON string of Jira custom field keys/values, e.g. `{ "customfield_14117": "example-value" }`

### AWS_SEVERITIES

**Required: No**

**Default Value: 'CRITICAL,HIGH,MEDIUM'**

Comma separated list of AWS Security Hub finding severities for which this tool should create Jira Issues.

### AWS_REGION

**Required: No**

**Default Value: us-east-1**

AWS Region to target

### SECURITY_HUB_NEW_ISSUE_DELAY

**Required: No**

**Default Value: 86400000**

Delay in milliseconds for filtering out ephemeral issues. The default value of 86400000 is 24 hours.

### AUTO_CLOSE

**Required: No**

**Default Value: true**

If set to true, when a Security Hub finding is resolved, the corresponding Jira issue will be closed. If set to false, the description will be updated and a comment will be added indicating the finding has been resolved, but the Jira Issue status will not change. The closure has following modes

**Full Transition Handling**
The **Full Transition Handling** feature operates automatically when the `jira-transition-map` is not specified. It helps manage issue resolution by automatically transitioning issues through the workflow towards a final status.

### How It Works

- **Automatic Transitioning**: The feature attempts to move the issue to one of the commonly used closing statuses, which are:

  - `done`
  - `closed`
  - `close`
  - `complete`
  - `completed`
  - `deploy`
  - `deployed`

- **Stopping Point**: If the workflow does not include any of these closing statuses, the system will transition the issue to the final status in the workflow that is not a reject status.
- **Reject Statuses**: The system avoids transitioning to statuses that indicate rejection or cancellation, such as:

  - `canceled`
  - `backout`
  - `rejected`
  - `cancel`
  - `reject`
  - `block`
  - `blocked`

For example If there's a workflow which has following transition rules

```
Cancel  <---
			|
To-Do -> Progress -> Worked
	^					|
	|					|
	---------------------
```

In this example:

- If an issue is at the `To-Do` status, the feature will attempt to transition through `Progress` and `Worked`.
- Since `Worked` is the last status before the end of the workflow and does not fall into the reject categories, the transition handling will stop there.

This feature ensures that issues are moved efficiently through the workflow towards a completion state, minimizing the need for manual intervention.
**Note**: `If the full transition handling feature does not stop at the desired status, consider specifying the transition map using jira-transition-map variable`

### JIRA_TRANSITION_MAP

When the `AUTO_CLOSE` feature is enabled, the `TRANSITION_MAP` defines which transitions to execute for statuses that are not terminal. Terminal statuses are those where no further action is needed (often 'Done' or similar).

### Overview

- **Purpose**: Automate issue transitions based on the specified path to the closure transition.
- **Format**: A string of semi-colon separated `status:transition` pairs, where each pair maps a status to its transition.
- **Case Insensitive**: Statuses and transitions are not case-sensitive

### Example

Let' say there is a jira workflow with the following transition rules.
**Jira Workflow:**

`[In Progress] --To QA--> [In QA] --To Test--> [In Test] -- Complete --> [Done]`

_Note: [In Progress] is status of issue and the QA is transition name_

**Transition Map:**
`"In Progress:To QA, In QA:To Test, In Test:Complete"`

- The map provides transitions for statuses except 'Done', which is terminal.
- The system will follow the map's transitions until it reaches a terminal status or detects a loop.

**Guide to Specify Transition Map**
To get jira workflow transition information

1.  **View Transition Details**:

- Open an issue in Jira and click on the status dropdown menu to see the list of available transitions.

![enter image description here](https://lh3.googleusercontent.com/d/1Eqz5TOdLPNYaDdaCzyrXvVM16PQl9Xkm=s320?authuser=0)
![enter image description here](https://lh3.googleusercontent.com/d/1FgBBdT2XAVqjtGdpx_wZkh30tKoMhFhn=s320?authuser=0)

2.  **Define Transition Rules**:

- Suppose the current status is "In Progress" with possible transitions to "Validate," "Block," and "Cancel." If you want to automate moving to "Validate," add this rule to your transition map:
  `In Progress: Validate`
- To continue the issue's progress through the workflow, include the next transition. For instance, if "Validate" leads to "In Review" and you want to set up a transition to "Approve," use:
  `In Progress: Validate; In review: Approve`

3. **Update the Transition Map**:

- Add all relevant `status:transition` pairs to ensure the issue moves through the desired states according to your workflow.

### Wild Card Transition Support

If your Jira workflow allows transitions from many or all statuses to another status (such as "Done"), you can use the `*` wildcard in the transition map to specify this. For example, if your Jira workflow permits transitions from any status to "Done," your transition map should be:

```
* : Done
```

The wildcard has priority in this integration. This means that when processing transitions, the system will first apply any wildcard rules before considering other specific transitions. So, if you have a wildcard transition and other defined transitions in your map, the wildcard transition will be executed first, and then the system will proceed with the other transitions according to the rules defined.

### DRY_RUN

**Required: No**

**Default Value: false**

Execute a sync but only log API calls to Jira which would create/modify Jira Issues.

### `jira-link-id`

**Required: No**

**Default Value: None**

**Description:** This field specifies the Jira link ID to which the newly created issue will be linked. If a value is provided, the issue will be associated with this link ID. If not specified, the issue will remain unlinked.

### `jira-link-type`

**Required: No**

**Default Value: 'Relates'**

**Description:** Defines the type of relationship between the new issue and the feature issue specified by the `jira-link-id`. The default relationship is 'Relates'. Other types can be used depending on your Jira configuration, such as 'Blocks', 'Is blocked by', or 'Duplicates'.

### `include-all-products`

**Required: No**

**Default Value: false**

**Description:** A boolean flag that determines whether findings from all products should be included in the sync process. When set to true, the tool will include findings from other products beyond those specified. When false, only findings from the specified products will be processed.

### `skip-products`

**Required: No**

**Default Value: None**

**Description:** A comma-separated list of product names for which findings should be excluded from the sync. This allows you to omit specific products from the synchronization process.

### `jira-link-direction`

**Required: No**

**Default Value: None**

**Description:** Specifies the direction of the issue link in Jira, which can be either 'inward' or 'outward'. 'Inward' means the new issue will be linked to the feature issue, while 'outward' means the feature issue will be linked to the new issue.

### `jira-labels-config`

**Required: No**

**Default Value: None**

**Description:** Specifies a stringified configuration for labels to be applied to the Jira issue. Labels are used to categorize and tag issues, making them easier to search and filter.

## Local Testing

See test-infrastructure/jira-container/README.md for instructions on how to run against local Jira container
