/**
 * Import Hawaii lobbyist registration data from the Hawaii Open Data Portal
 * Source: Hawaii State Ethics Commission's Lobbyist Registration Statements
 * CKAN resource: aed69d13-fe07-4e91-8abf-a51c8a408e1f (2020 dataset)
 * Also: f186ec29-a1c8-4985-b92e-870b19db8211 (original dataset)
 */

const SUPABASE_URL = 'https://fdphdzbjdtbxxexgyfba.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkcGhkemJqZHRieHhleGd5ZmJhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjAzOTA1MCwiZXhwIjoyMDkxNjE1MDUwfQ.aaFEmTHR4Y2RtHAIddzlQgptcE3rJKQqDnE6_VoQLd8';

const HEADERS = {
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'apikey': SUPABASE_KEY,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
};

const CKAN_RESOURCE_ID = 'aed69d13-fe07-4e91-8abf-a51c8a408e1f';
const CKAN_BASE = 'https://opendata.hawaii.gov/api/3/action/datastore_search';

// ── Helpers ──

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[ʻ'']/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseName(fullNameRaw) {
  // Format is typically "Last, First Middle" or just "Name"
  const fullName = fullNameRaw.trim();
  const commaIdx = fullName.indexOf(',');
  if (commaIdx === -1) {
    const parts = fullName.split(/\s+/);
    return {
      full_name: fullName,
      first_name: parts[0] || '',
      last_name: parts[parts.length - 1] || '',
    };
  }
  const last = fullName.substring(0, commaIdx).trim();
  const firstParts = fullName.substring(commaIdx + 1).trim();
  const firstName = firstParts.split(/\s+/)[0] || '';
  return {
    full_name: `${firstName} ${last}`.replace(/\s+/g, ' ').trim(),
    first_name: firstName,
    last_name: last,
  };
}

async function supabaseGet(table, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`GET ${table} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function supabasePost(table, rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...HEADERS, 'Prefer': 'return=representation,resolution=ignore-duplicates' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${table} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function supabaseUpsert(table, rows, onConflict) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      ...HEADERS,
      'Prefer': `return=representation,resolution=merge-duplicates`,
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`UPSERT ${table} failed: ${res.status} ${text}`);
  }
  return res.json();
}

// ── Fetch all records from Hawaii Open Data ──

async function fetchAllRecords() {
  const allRecords = [];
  let offset = 0;
  const limit = 500;

  console.log('Fetching lobbyist registration data from Hawaii Open Data Portal...');

  while (true) {
    const url = `${CKAN_BASE}?resource_id=${CKAN_RESOURCE_ID}&limit=${limit}&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CKAN fetch failed: ${res.status}`);
    const data = await res.json();
    const records = data.result.records;
    if (records.length === 0) break;
    allRecords.push(...records);
    console.log(`  Fetched ${allRecords.length} / ${data.result.total} records...`);
    offset += limit;
    if (allRecords.length >= data.result.total) break;
  }

  console.log(`Total records fetched: ${allRecords.length}`);
  return allRecords;
}

// ── Main import logic ──

async function main() {
  // 1. Fetch all open data records
  const records = await fetchAllRecords();

  // 2. Load existing persons and orgs from Supabase
  console.log('\nLoading existing Supabase data...');
  const existingPersons = await supabaseGet('person', 'select=id,slug,full_name');
  const existingOrgs = await supabaseGet('organization', 'select=id,slug,name');

  console.log(`  Existing persons: ${existingPersons.length}`);
  console.log(`  Existing orgs: ${existingOrgs.length}`);

  // Build lookup maps
  const personBySlug = new Map(existingPersons.map(p => [p.slug, p]));
  const orgBySlug = new Map(existingOrgs.map(o => [o.slug, o]));
  const orgByName = new Map(existingOrgs.map(o => [o.name.toLowerCase(), o]));

  // 3. Collect unique lobbyists and organizations from the data
  const uniqueLobbyists = new Map(); // slug -> parsed name info
  const uniqueOrgs = new Map(); // slug -> org name

  for (const rec of records) {
    const nameRaw = rec['Full Name'];
    const orgName = rec['Organization'];
    if (!nameRaw) continue;

    const parsed = parseName(nameRaw);
    const slug = slugify(parsed.full_name);
    if (!uniqueLobbyists.has(slug)) {
      uniqueLobbyists.set(slug, { ...parsed, nameRaw });
    }

    if (orgName) {
      const orgSlug = slugify(orgName);
      if (!uniqueOrgs.has(orgSlug)) {
        uniqueOrgs.set(orgSlug, orgName.trim());
      }
    }
  }

  console.log(`\nUnique lobbyists in data: ${uniqueLobbyists.size}`);
  console.log(`Unique organizations in data: ${uniqueOrgs.size}`);

  // 4. Create new persons (lobbyists not already in DB)
  const newPersons = [];
  for (const [slug, info] of uniqueLobbyists) {
    if (!personBySlug.has(slug)) {
      newPersons.push({
        full_name: info.full_name,
        first_name: info.first_name,
        last_name: info.last_name,
        slug,
        entity_types: ['lobbyist'],
        status: 'active',
        visibility: 'public',
        aliases: [],
        island: 'Oʻahu',
      });
    }
  }

  console.log(`\nNew persons to create: ${newPersons.length}`);

  if (newPersons.length > 0) {
    // Insert in batches of 100
    let insertedPersonCount = 0;
    for (let i = 0; i < newPersons.length; i += 100) {
      const batch = newPersons.slice(i, i + 100);
      try {
        const result = await supabasePost('person', batch);
        insertedPersonCount += result.length;
        // Add to lookup
        for (const p of result) {
          personBySlug.set(p.slug, p);
        }
        console.log(`  Inserted persons batch ${Math.floor(i / 100) + 1}: ${result.length} rows`);
      } catch (err) {
        // If batch fails, try one by one
        console.log(`  Batch insert failed, trying individual inserts...`);
        for (const person of batch) {
          try {
            const result = await supabasePost('person', [person]);
            insertedPersonCount += result.length;
            for (const p of result) personBySlug.set(p.slug, p);
          } catch (e) {
            console.log(`    Skipped person ${person.slug}: ${e.message.substring(0, 80)}`);
          }
        }
      }
    }
    console.log(`Total persons inserted: ${insertedPersonCount}`);
  }

  // 5. Create new organizations (client orgs not already in DB)
  const newOrgs = [];
  for (const [slug, name] of uniqueOrgs) {
    if (!orgBySlug.has(slug) && !orgByName.has(name.toLowerCase())) {
      newOrgs.push({
        name,
        slug,
        org_type: 'lobbying_client',
        status: 'active',
        visibility: 'public',
        aliases: [],
        island: 'Oʻahu',
      });
    }
  }

  console.log(`\nNew organizations to create: ${newOrgs.length}`);

  if (newOrgs.length > 0) {
    let insertedOrgCount = 0;
    for (let i = 0; i < newOrgs.length; i += 100) {
      const batch = newOrgs.slice(i, i + 100);
      try {
        const result = await supabasePost('organization', batch);
        insertedOrgCount += result.length;
        for (const o of result) {
          orgBySlug.set(o.slug, o);
          orgByName.set(o.name.toLowerCase(), o);
        }
        console.log(`  Inserted orgs batch ${Math.floor(i / 100) + 1}: ${result.length} rows`);
      } catch (err) {
        console.log(`  Batch insert failed, trying individual inserts...`);
        for (const org of batch) {
          try {
            const result = await supabasePost('organization', [org]);
            insertedOrgCount += result.length;
            for (const o of result) {
              orgBySlug.set(o.slug, o);
              orgByName.set(o.name.toLowerCase(), o);
            }
          } catch (e) {
            console.log(`    Skipped org ${org.slug}: ${e.message.substring(0, 80)}`);
          }
        }
      }
    }
    console.log(`Total orgs inserted: ${insertedOrgCount}`);
  }

  // 6. Insert lobbyist registrations
  console.log('\nInserting lobbyist registrations...');

  const registrations = [];
  let skippedNoLobbyist = 0;

  for (const rec of records) {
    const nameRaw = rec['Full Name'];
    if (!nameRaw) { skippedNoLobbyist++; continue; }

    const parsed = parseName(nameRaw);
    const personSlug = slugify(parsed.full_name);
    const person = personBySlug.get(personSlug);

    if (!person) {
      skippedNoLobbyist++;
      continue;
    }

    const orgName = (rec['Organization'] || '').trim();
    const orgSlug = orgName ? slugify(orgName) : null;

    // Try to match org
    let clientOrgId = null;
    if (orgSlug) {
      const org = orgBySlug.get(orgSlug) || orgByName.get(orgName.toLowerCase());
      if (org) clientOrgId = org.id;
    }

    registrations.push({
      lobbyist_person_id: person.id,
      client_org_id: clientOrgId,
      client_name_raw: orgName || null,
      registration_period: rec['Lobby Year'] || null,
      issues: [],
      source_url: rec['View'] || null,
      raw_record: rec,
    });
  }

  console.log(`Registrations to insert: ${registrations.length}`);
  if (skippedNoLobbyist > 0) {
    console.log(`Skipped (no lobbyist match): ${skippedNoLobbyist}`);
  }

  let insertedRegCount = 0;
  for (let i = 0; i < registrations.length; i += 100) {
    const batch = registrations.slice(i, i + 100);
    try {
      const result = await supabasePost('lobbyist_registration', batch);
      insertedRegCount += result.length;
      if ((i / 100) % 5 === 0 || i + 100 >= registrations.length) {
        console.log(`  Inserted registrations: ${insertedRegCount} / ${registrations.length}`);
      }
    } catch (err) {
      console.log(`  Batch ${Math.floor(i / 100) + 1} failed: ${err.message.substring(0, 120)}`);
      // Try one by one
      for (const reg of batch) {
        try {
          const result = await supabasePost('lobbyist_registration', [reg]);
          insertedRegCount += result.length;
        } catch (e) {
          // Skip silently
        }
      }
    }
  }

  console.log(`\n========================================`);
  console.log(`IMPORT COMPLETE`);
  console.log(`========================================`);
  console.log(`Records fetched from Hawaii Open Data: ${records.length}`);
  console.log(`Lobbyist registrations inserted: ${insertedRegCount}`);
  console.log(`Unique persons (lobbyists) in lookup: ${personBySlug.size}`);
  console.log(`Unique organizations in lookup: ${orgBySlug.size}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
