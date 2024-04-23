# Security Hub Visibility

## A GitHub Action that syncs Security Hub findings with Jira issues


1. Gets all current findings from Security Hub, filtered by the `Severity` of the findings (default is `CRITICAL,HIGH,MEDIUM`)

2. Creates Jira issues for findings that do not already have a Jira issue
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

### JIRA_TRANSITION_MAP
**Required: No**

**Default Value: '*:Done'**

If the `AUTO_CLOSE` feature is enabled, The `TRANSITION_MAP` specifies what transition to execute for every status that is not a desired end status or terminal status.

Before setting this variable, it's recommended to review Jira Workflow concepts and the specific workflow graph for your project in Jira. Search for how to view a workflow in the Jira documentation.

It is a list of moves to be used as a lookup table should an issue be transitioned to the status that best represents that the issue is no longer active in Security Hub. This is often the 'Done' status, but it may be different on your specific Jira project. You may even have multiple terminal statuses.

The transition map consists of a string representing a list of status:transition pairs. This specifies Given status, execute transition. The status:transition pairs can be defined in any order. After each move the entire list is reconsidered. Transition and Status are case insensitive.

### Basic Case

**Jira Workflow** 
```
[In Progress] --To QA --> [In QA] --To Test--> [In Test] -- Complete --> [Done]
```
**Transition Map**

`"In Progress:To QA, In QA:To Test, In Test:Complete"`

This transition map contains a transition for each status in the workflow except for 'Done' Which indicates done is a terminal status meaning that the transition operation on the issue is done once we arrive at the 'Done' status. The algorithm looks up the current status in the transition map, if it exist it executes the associated transition and then repeatedly performs this operation until a terminal status is reached (not specified in the transition map) or more transitions have been executed than the length of the transition map which indicates we are in a loop.

As the transition map is unordered

`"In Test:Complete, In Progress:To QA, In QA:To Test"`

Would be equivalent the earlier example. 

### Wildcard Transition Map

The transition map supports specifying a wild card '*' for the status. This will execute the transition regardless of the current status. This generally should be used only when the target transition is configured in Jira to be executable from all statuses. 

For the wildcard example, let's consider a scenario where multiple statuses can lead to a "Done" state through a "Complete" transition:

**Jira Workflow** 
```
[In Progress] --To QA --> [In QA] --To Test--> [In Test]

[All] -- Complete --> [Done]
```
Note: In Jira workflow configuration 'All' is a special representation of a status. When a transition is configured to use the 'All' status, that transition can be executed from any status in the workflow.

If you use a wildcard on a transition that is not executable from all statuses it will produce an error should there be an execution on an issue where the current status does not allow the requested transition.

**Transition Map**

`"*:Complete"`

This would be equivalent to:

`"In Review:Complete, In QA:Complete, In Test:Complete"`

Note that only one status:transition pair should be provided when a wildcard status is used.


#### Complex Workflow with Multiple Terminal States

In more intricate workflows, issues might branch into different paths with several potential terminal states, indicating resolution. Consider a scenario with branches for QA Review and Development, leading to various resolved states:

**Jira Workflow** 
```
           +--QA Review--> [QA Passed] --Close--> [Closed]
          /
[To Do] --                                     
          \                                    
           +--Development--> [In Progress] --Complete--> [Done]
```
**Transition Map:**

`"To Do:QA Review, QA Passed:Close, In Progress:Complete"`

If the current status is 'To Do' or 'QA Passed', the map guides us to the 'Closed' status. If the current status is 'In Progress' the map guides us to 'Done'. It is required that we have multiple terminal status as this workflow does not provide any set of transitions that can move something from  'In Progress' to 'Closed'.

Since the transition map is simply given a status what transition should be executed, it is possible to handle complex workflow graphs such as this.

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

If set to true, when a Security Hub finding is resolved, the corresponding Jira issue will be closed. If set to false, the description will be updated and a comment will be added indicating the finding has been resolved, but the Jira Issue status will not change.

### DRY_RUN
**Required: No**

**Default Value: false**

Execute a sync but only log API calls to Jira which would create/modify Jira Issues.


## Local Testing

See test-infrastructure/jira-container/README.md for instructions on how to run against local Jira container
