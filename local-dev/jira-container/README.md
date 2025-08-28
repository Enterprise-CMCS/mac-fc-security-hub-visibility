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
