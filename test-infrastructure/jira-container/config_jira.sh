#!/bin/bash
set -e

# Initial setup for local Jira instance to be used with the alerter future versions may need different setups depending what we are testing

# Wait for Jira to start
echo -e "\nWaiting for Jira to start...\n"
until $(curl --output /dev/null --silent --head --fail http://localhost:2990/jira); do
  printf '.'
  sleep 5
done

# Run the create project curl command
echo -e "\nCreating Jira project...\n"
macfc_project_id=$(curl --request POST \
  --url 'http://localhost:2990/jira/rest/api/2/project' \
  --header 'Accept: application/json' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Basic YWRtaW46YWRtaW4=' \
  --data '{
    "key": "MACFC",
    "name": "MAC-FC",
    "projectTypeKey": "business",
    "projectTemplateKey": "com.atlassian.jira-core-project-templates:jira-core-project-management",
    "description": "Placeholder",
    "lead": "admin",
    "url": "",
    "assigneeType": "PROJECT_LEAD",
    "avatarId": 10200
  }' | jq -r '.id')

echo -e "\nGetting upm_token\n"
upm_token=$(curl -I -u admin:admin -X GET http://localhost:2990/jira/rest/plugins/1.0/ \
  | grep -i 'upm-token' \
  | awk -F ': ' '{print $2}' \
  | tr -d '\r')

# select Jira Software version that matches the Jira core version from https://marketplace.atlassian.com/apps/1213607/jira-software/version-history
echo -e "Installing Jira Software\n"
curl -u admin:admin "http://localhost:2990/jira/rest/plugins/1.0/?token=$upm_token" \
  -H 'Content-Type: application/vnd.atl.plugins.install.uri+json' \
  --data-raw '{"pluginUri":"https://marketplace.atlassian.com/download/apps/1213607/version/820010"}'

echo -e "\nCreating Bug issue type\n"
bug_issue_type_id=$(curl --request POST \
  --url 'http://localhost:2990/jira/rest/api/2/issuetype' \
  --header 'Content-Type: application/json' \
  -u admin:admin \
  --data '{
    "name": "Bug",
    "description": "A bug issue type",
    "type": "standard"
  }' | jq -r '.id')

curl --request PUT -u admin:admin --url "http://localhost:2990/jira/rest/api/2/issuetype/$bug_issue_type_id" -H 'Content-Type: application/json' --data '{
    "avatarId": 10303,
    "description": "A bug issue type",
    "name": "Bug"
  }'

echo -e "\nCreating Release issue type\n"
release_issue_type_id=$(curl --request POST \
  --url 'http://localhost:2990/jira/rest/api/2/issuetype' \
  --header 'Content-Type: application/json' \
  -u admin:admin \
  --data '{
    "name": "Release",
    "description": "A release issue type",
    "type": "standard"
  }' | jq -r '.id')

curl --request PUT -u admin:admin --url "http://localhost:2990/jira/rest/api/2/issuetype/$release_issue_type_id" -H 'Content-Type: application/json' --data '{
"avatarId": 10321,
"description": "A release issue type",
"name": "Release"
}'

echo -e "\nCreating Service Request issue type\n"
service_request_issue_type_id=$(curl --request POST \
--url 'http://localhost:2990/jira/rest/api/2/issuetype' \
--header 'Content-Type: application/json' \
-u admin:admin \
--data '{
"name": "Service Request",
"description": "A service request issue type",
"type": "standard"
}' | jq -r '.id')

echo -e "\nGet Epic issue type ID\n"

# Loop until Jira Software is fully installed and this issue type is created
while [[ -z "$epic_issue_type_id" ]]; do
epic_issue_type_id=$(curl --request GET \
--url 'http://localhost:2990/jira/rest/api/2/issuetype' \
-u admin:admin | jq -r '.[] | select(.name=="Epic") | .id')
sleep 5
done

echo -e "\nGet Story issue type ID\n"
story_issue_type_id=$(curl --request GET \
--url 'http://localhost:2990/jira/rest/api/2/issuetype' \
-u admin:admin | jq -r '.[] | select(.name=="Story") | .id')

echo -e "\nGet Task issue type ID\n"
task_issue_type_id=$(curl --request GET \
--url 'http://localhost:2990/jira/rest/api/2/issuetype' \
-u admin:admin | jq -r '.[] | select(.name=="Task") | .id')

echo -e "\nAdd issue types to MAC FC scheme\n"
curl --request PUT --url 'http://localhost:2990/jira/rest/api/2/issuetypescheme/10200' --header 'Content-Type: application/json' -u admin:admin --data "{
\"name\": \"MACFC: Project Management Issue Type Scheme\",
\"issueTypeIds\": [\"$task_issue_type_id\", \"$bug_issue_type_id\", \"$epic_issue_type_id\", \"$story_issue_type_id\", \"$release_issue_type_id\", \"$service_request_issue_type_id\"]
}"

echo -e "\nGet ID for MACFC: Project Management Create Issue Screen\n"
screen_id=$(curl --request GET \
--url 'http://localhost:2990/jira/rest/api/2/screens' \
-u admin:admin | jq -r '.[] | select(.name=="MACFC: Project Management Create Issue Screen") | .id')

echo -e "\nGet custom field ID for Epic Link\n"
epic_link_field_id=$(curl --request GET \
--url 'http://localhost:2990/jira/rest/api/2/field' \
-u admin:admin | jq -r '.[] | select(.name=="Epic Link") | .id')

echo -e "\nGet field tab ID for MACFC: Project Management Create Issue Screen\n"
field_tab_id=$(curl --request GET \
--url "http://localhost:2990/jira/rest/api/2/screens/${screen_id}/tabs" \
-u admin:admin | jq -r '.[] | select(.name=="Field Tab") | .id')

echo -e "\nAdd Epic Link to MACFC: Project Management Create Issue Screen\n"
curl --request POST --url "http://localhost:2990/jira/rest/api/2/screens/${screen_id}/tabs/${field_tab_id}/fields" --header 'Content-Type: application/json' -u admin:admin --data "{
\"fieldId\": \"${epic_link_field_id}\"
}"

echo -e "\nGet custom field ID for Epic Name\n"
epic_name_field_id=$(curl --request GET \
--url 'http://localhost:2990/jira/rest/api/2/field' \
-u admin:admin | jq -r '.[] | select(.name=="Epic Name") | .id')

echo -e "\nAdd Epic Name to MACFC: Project Management Create Issue Screen\n"
curl --request POST --url "http://localhost:2990/jira/rest/api/2/screens/${screen_id}/tabs/${field_tab_id}/fields" --header 'Content-Type: application/json' -u admin:admin --data "{
\"fieldId\": \"${epic_name_field_id}\"
}"

echo -e "\nGet ID for MACFC: Project Management Edit/View Issue Screen\n"
screen_id=$(curl --request GET \
--url 'http://localhost:2990/jira/rest/api/2/screens' \
-u admin:admin | jq -r '.[] | select(.name=="MACFC: Project Management Edit/View Issue Screen") | .id')

echo -e "\nGet field tab ID for MACFC: Project Management Edit/View Issue Screen\n"
field_tab_id=$(curl --request GET \
--url "http://localhost:2990/jira/rest/api/2/screens/${screen_id}/tabs" \
-u admin:admin | jq -r '.[] | select(.name=="Field Tab") | .id')

echo -e "\nAdd Epic Link to MACFC: Project Management Edit/View Issue Screen\n"
curl --request POST --url "http://localhost:2990/jira/rest/api/2/screens/${screen_id}/tabs/${field_tab_id}/fields" --header 'Content-Type: application/json' -u admin:admin --data "{
\"fieldId\": \"${epic_link_field_id}\"
}"

echo -e "\nAdd Epic Name to MACFC: Project Management Edit/View Issue Screen\n"
curl --request POST --url "http://localhost:2990/jira/rest/api/2/screens/${screen_id}/tabs/${field_tab_id}/fields" --header 'Content-Type: application/json' -u admin:admin --data "{
\"fieldId\": \"${epic_name_field_id}\"
}"

echo -e "\nAdding MAC FC user\n"
curl --request POST --url 'http://localhost:2990/jira/rest/api/2/user' --header 'Accept: application/json' --header 'Content-Type: application/json' -u admin:admin --data '{
"name": "mac_fc_jira_ent",
"password": "password",
"emailAddress": "mac_fc_jira_ent@cms.gov",
"displayName": "mac_fc_jira_ent"
}'

echo -e "\nGetting MACFC project admin role id\n"
macfc_admin_role_id=$(curl -X GET -u admin:admin -H "Content-Type: application/json" "http://localhost:2990/jira/rest/api/2/project/$macfc_project_id/role" | jq -r '."Administrators" | match("/[0-9]+$").string[1:]')

echo -e "\Adding mac_fc_jira_ent to the MACFC project admin role\n"
curl -X POST -u admin:admin -H "Content-Type: application/json" -d '{"user": ["mac_fc_jira_ent"]}' "http://localhost:2990/jira/rest/api/2/project/$macfc_project_id/role/$macfc_admin_role_id"

# Usernames
declare -a usernames=("AURK" "D4W7" "L5NF" "CM3Q" "GPEC" "BCWY" "GV4S" "G6W5" "LQ7P" "MR5S" "OBHY" "ESQZ" "L3U6" "S2HY" "H8MP")

# Loop through usernames and create users
for username in "${usernames[@]}"; do
  echo -e "\nCreating user: $username\n"

  curl --request POST \
    --url 'http://localhost:2990/jira/rest/api/2/user' \
    --header 'Accept: application/json' \
    --header 'Content-Type: application/json' \
    -u admin:admin \
    --data "{
      \"name\": \"$username\",
      \"password\": \"password\",
      \"emailAddress\": \"${username}@foo.com\",
      \"displayName\": \"$username\"
    }"
done

#project_key="MACFC" #was using project \"key\" instead of \"id\"
echo -e "\nCreating 77 dummy epics in the MACFC project\n"
for i in $(seq 1 77); do
  curl --request POST \
    --url 'http://localhost:2990/jira/rest/api/2/issue' \
    --header 'Content-Type: application/json' \
    -u admin:admin \
    --data "{
      \"fields\": {
        \"project\": {
          \"id\": \"${macfc_project_id}\"
        },
        \"summary\": \"Dummy Epic #${i}\",
        \"issuetype\": {
          \"id\": \"${epic_issue_type_id}\"
        },
        \"${epic_name_field_id}\": \"MACFC-${i}\"
      }
    }"
  sleep 1
done

echo -e "\nCreating MAC FC user PAT\n"
curl -u mac_fc_jira_ent:password -v -H 'Content-type: application/json' --data '{"expirationDuration": 90, "name": "dev"}' 'http://localhost:2990/jira/rest/pat/latest/tokens'
