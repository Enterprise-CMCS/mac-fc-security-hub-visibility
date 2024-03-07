"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const macfc_security_hub_sync_1 = require("./macfc-security-hub-sync");
new macfc_security_hub_sync_1.SecurityHubJiraSync({
    region: "us-east-1",
    severities: ["CRITICAL", "HIGH"],
    customJiraFields: {
        customfield_14117: [{ value: "Dev Team" }],
        customfield_14151: [{ value: "OneMac" }],
    },
}).sync();
