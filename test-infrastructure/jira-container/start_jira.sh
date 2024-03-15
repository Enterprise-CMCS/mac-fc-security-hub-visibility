#!/bin/bash
set -e

./config_jira.sh&

# Start Jira
atlas-run-standalone --jvmargs -XX:+ExplicitGCInvokesConcurrent -Datlassian.plugins.enable.wait=300 --product jira --version 8.20.10
