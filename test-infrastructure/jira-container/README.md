# Jira SDK Container

This code is intended to be use with testing the alerter code, in the future it could be augmented to take command line arguments to load different configs scripts to seed the Jira state for each application we are trying to test.

The Jira instance will have a license to allow you to test for 3 days from starting the container. After 3 days you will have to launch a new instance with a fresh state. 

Currently we install the jira software app and mirror much of prod Jira, however workflows can not be created via the Jira API and macfc-workflow.xml has been included in this directory and can be optionally imported using the jira web UI.

## Build and Run

`docker build -t jira-atlassian-sdk .`

`docker run --ulimit nofile=16384:16384 --rm -it -p 2990:2990 jira-atlassian-sdk`

Note: without -it the main process immediately quits after jira fully starts and the container shuts down

# Accessing Jira

Once the container is running the last line of the terminal output will be the Jira Personal Access Token for the mac_fc_jira_ent user.

The web UI will be available at `http://localhost:2990/jira`

### To Login as the admin user
username: admin\
password: admin

### To login as the mac_fc_jira_ent user
username: mac_fc_jira_ent\
password: password

# Sync Setup

To run the sync locally and have it create tickets, setup the following environment variables in a different shell from the jira container.

```
JIRA_USERNAME=mac_fc_jira_ent
JIRA_PROJECT=MACFC
JIRA_BASE_URI=http://localhost:2990/jira
JIRA_TOKEN=#get from terminal output
DRY_RUN=(true|false) # optional if you don't want to execute jira write operations

export AWS_ACCESS_KEY_ID=#get from cloudtamer
export AWS_SECRET_ACCESS_KEY=#get from cloudtamer
export AWS_SESSION_TOKEN=#get from cloudtamer

#from the root of this repo
pnpm install
pnpm build
node dist/index.js
```
