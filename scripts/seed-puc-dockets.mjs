#!/usr/bin/env node

const SUPABASE_URL = 'https://fdphdzbjdtbxxexgyfba.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkcGhkemJqZHRieHhleGd5ZmJhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjAzOTA1MCwiZXhwIjoyMDkxNjE1MDUwfQ.aaFEmTHR4Y2RtHAIddzlQgptcE3rJKQqDnE6_VoQLd8';

const headers = {
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'apikey': SERVICE_KEY,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
};

const dockets = [
  { docket_number: "2017-0352", title: "Competitive Renewable Energy Procurement", docket_type: "procurement", status: "open", utility_type: "electric", summary: "Stage 3 awarded Dec 2023: 1,170 MW solar and 2,144 MWh storage across 15 projects for HECO service territories." },
  { docket_number: "2018-0088", title: "Performance-Based Regulation Investigation", docket_type: "investigation", status: "open", utility_type: "electric", summary: "Investigation into performance-based regulation framework for Hawaiian Electric utilities to replace traditional cost-of-service regulation." },
  { docket_number: "2023-0349", title: "HECO Deferred Accounting of Maui Wildfire Response Costs", docket_type: "rate_case", status: "approved", utility_type: "electric", summary: "Hawaiian Electric request to defer accounting of costs incurred responding to August 2023 Maui wildfires. Approved Dec 27, 2023." },
  { docket_number: "2024-0040", title: "HECO Accounts Receivable Credit Facility", docket_type: "financial", status: "approved", utility_type: "electric", summary: "Hawaiian Electric $250M credit facility to manage accounts receivable. Approved June 27, 2024." },
  { docket_number: "2024-0158", title: "Hawaii Gas Rate Case", docket_type: "rate_case", status: "open", utility_type: "gas", summary: "Hawaii Gas general rate increase application. Public hearing held Oct 4, 2024." },
  { docket_number: "2015-0389", title: "Community-Based Renewable Energy Program", docket_type: "program", status: "open", utility_type: "electric", summary: "Establishing framework for community-based renewable energy program allowing customers to subscribe to offsite renewable energy projects." },
  { docket_number: "2018-0135", title: "Electrification of Transportation", docket_type: "policy", status: "open", utility_type: "electric", summary: "Investigation into policies and programs to accelerate electric vehicle adoption and transportation electrification in Hawaii." },
  { docket_number: "2022-0135", title: "Climate Adaptation Transmission & Distribution Resilience", docket_type: "policy", status: "open", utility_type: "electric", summary: "Investigation into climate adaptation measures for electric transmission and distribution infrastructure resilience." },
  { docket_number: "2025-0156", title: "HECO Wildfire Mitigation Plan 2025-2027", docket_type: "compliance", status: "approved", utility_type: "electric", summary: "Hawaiian Electric three-year wildfire mitigation plan covering vegetation management, equipment hardening, and situational awareness. Approved Dec 31, 2025." },
  { docket_number: "2024-0258", title: "Integrated Grid Planning RFP", docket_type: "procurement", status: "open", utility_type: "electric", summary: "Request for proposals for integrated grid planning resources to support Hawaii's 100% renewable energy by 2045 mandate." },
  { docket_number: "2024-0200", title: "Electricity Wheeling Investigation", docket_type: "policy", status: "open", utility_type: "electric", summary: "Investigation into electricity wheeling policies. Technical conference scheduled April 7, 2026." },
  { docket_number: "2025-0255", title: "KIUC Wildfire Mitigation Plans", docket_type: "compliance", status: "open", utility_type: "electric", summary: "Kauai Island Utility Cooperative wildfire mitigation plans. Hearing Sept 23, 2025." },
];

async function apiCall(method, endpoint, body = null, extraHeaders = {}) {
  const opts = { method, headers: { ...headers, ...extraHeaders } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${SUPABASE_URL}${endpoint}`, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${endpoint} ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  // Step 1: Insert dockets (upsert by docket_number to be idempotent)
  console.log('Inserting 12 PUC dockets...');
  const inserted = await apiCall('POST', '/rest/v1/puc_docket', dockets, {
    'Prefer': 'return=representation,resolution=merge-duplicates',
  });
  console.log(`Dockets inserted/upserted: ${inserted.length}`);
  for (const d of inserted) {
    console.log(`  ${d.docket_number} - ${d.title} (id: ${d.id})`);
  }

  // Build docket lookup by docket_number
  const docketMap = {};
  for (const d of inserted) docketMap[d.docket_number] = d.id;

  // Step 2: Fetch organizations
  console.log('\nFetching organizations...');
  const orgs = await apiCall('GET', '/rest/v1/organization?select=id,slug');
  const hecoOrg = orgs.find(o => o.slug === 'hawaiian-electric-industries');
  const pucOrg = orgs.find(o => o.slug === 'hawaii-public-utilities-commission');
  console.log(`HECO org: ${hecoOrg ? hecoOrg.id : 'NOT FOUND'}`);
  console.log(`PUC org:  ${pucOrg ? pucOrg.id : 'NOT FOUND'}`);

  if (!hecoOrg || !pucOrg) {
    console.error('Missing required organizations. Aborting participant insert.');
    process.exit(1);
  }

  // Step 3: Build participant records
  // HECO-related dockets (all electric HECO dockets)
  const hecoDockets = [
    "2017-0352", "2018-0088", "2023-0349", "2024-0040",
    "2015-0389", "2018-0135", "2022-0135", "2025-0156",
    "2024-0258", "2024-0200",
  ];
  // Dockets where HECO is the applicant (filed by HECO)
  const hecoApplicant = ["2023-0349", "2024-0040", "2025-0156"];

  const participants = [];

  // PUC as regulator on ALL dockets
  for (const dn of Object.keys(docketMap)) {
    participants.push({
      docket_id: docketMap[dn],
      person_id: null,
      organization_id: pucOrg.id,
      role: 'regulator',
    });
  }

  // HECO on relevant dockets
  for (const dn of hecoDockets) {
    participants.push({
      docket_id: docketMap[dn],
      person_id: null,
      organization_id: hecoOrg.id,
      role: hecoApplicant.includes(dn) ? 'applicant' : 'regulated_entity',
    });
  }

  console.log(`\nInserting ${participants.length} participant records...`);
  const insertedParticipants = await apiCall('POST', '/rest/v1/puc_participant', participants, {
    'Prefer': 'return=representation,resolution=merge-duplicates',
  });
  console.log(`Participants inserted/upserted: ${insertedParticipants.length}`);

  // Summary
  const roles = {};
  for (const p of insertedParticipants) {
    roles[p.role] = (roles[p.role] || 0) + 1;
  }
  console.log('\nParticipant breakdown:');
  for (const [role, count] of Object.entries(roles)) {
    console.log(`  ${role}: ${count}`);
  }

  console.log('\nDone!');
}

main().catch(err => { console.error(err); process.exit(1); });
