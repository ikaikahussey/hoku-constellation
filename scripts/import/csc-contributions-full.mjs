/**
 * Import ALL campaign contribution data from Hawaii's Campaign Spending Commission
 * via the opendata.hawaii.gov CKAN API.
 *
 * Fetches all records from 2022+ election periods and upserts into Supabase.
 * Resource: Campaign Contributions Received By Hawaii State and County Candidates
 * CKAN resource ID: 443bd998-1ef3-47da-9170-c2c376b2e41c
 */

const SUPABASE_URL = 'https://fdphdzbjdtbxxexgyfba.supabase.co';
const SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkcGhkemJqZHRieHhleGd5ZmJhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjAzOTA1MCwiZXhwIjoyMDkxNjE1MDUwfQ.aaFEmTHR4Y2RtHAIddzlQgptcE3rJKQqDnE6_VoQLd8';

const CKAN_RESOURCE_ID = '443bd998-1ef3-47da-9170-c2c376b2e41c';
const CKAN_BASE = 'https://opendata.hawaii.gov/api/3/action/datastore_search';

// Election periods that start in 2020 or later (covers 2022+ contribution dates)
const TARGET_ELECTION_PERIODS = [
  '2020-2022',
  '2020-2024',
  '2022-2024',
  '2022-2026',
  '2024-2026',
  '2024-2028',
];

const HEADERS = {
  Authorization: `Bearer ${SUPABASE_KEY}`,
  apikey: SUPABASE_KEY,
  'Content-Type': 'application/json',
};

// ── Helpers ──

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[ʻ'']/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeName(raw) {
  // "Last, First Middle" -> "first last"
  const s = raw.trim();
  const comma = s.indexOf(',');
  if (comma === -1) return s.toLowerCase().replace(/\s+/g, ' ').trim();
  const last = s.substring(0, comma).trim();
  const first = s.substring(comma + 1).trim().split(/\s+/)[0] || '';
  return `${first} ${last}`.toLowerCase().replace(/\s+/g, ' ').trim();
}

function parseContributionDate(dateStr) {
  if (!dateStr) return null;
  // Format: "2016-06-16T23:43:05" or "6/30/2025 18:37:54"
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Supabase helpers ──

async function supabaseGet(table, query = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const res = await fetch(url, { headers: { ...HEADERS, Prefer: 'return=representation' } });
  if (!res.ok) throw new Error(`GET ${table} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function supabaseUpsert(table, rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      ...HEADERS,
      Prefer: 'return=representation,resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`UPSERT ${table} failed: ${res.status} ${text}`);
  }
  return res.json();
}

// ── Fetch records from CKAN for a single election period ──

async function fetchRecordsForPeriod(electionPeriod) {
  const allRecords = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const filters = JSON.stringify({ 'Election Period': electionPeriod });
    const url = `${CKAN_BASE}?resource_id=${CKAN_RESOURCE_ID}&limit=${limit}&offset=${offset}&filters=${encodeURIComponent(filters)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CKAN fetch failed: ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error(`CKAN error: ${JSON.stringify(data.error)}`);

    const records = data.result.records;
    if (records.length === 0) break;
    allRecords.push(...records);

    const total = data.result.total;
    process.stdout.write(`\r  [${electionPeriod}] ${allRecords.length} / ${total}`);

    if (allRecords.length >= total) break;
    offset += limit;
    await sleep(200); // be polite to the API
  }

  console.log(`\r  [${electionPeriod}] ${allRecords.length} records fetched`);
  return allRecords;
}

// ── Main ──

async function main() {
  console.log('=== CSC Campaign Contributions Full Import ===\n');

  // 1. Load existing persons from Supabase for recipient matching
  console.log('Loading existing persons from Supabase...');
  let allPersons = [];
  let personOffset = 0;
  while (true) {
    const batch = await supabaseGet(
      'person',
      `select=id,slug,full_name&limit=1000&offset=${personOffset}`
    );
    allPersons.push(...batch);
    if (batch.length < 1000) break;
    personOffset += 1000;
  }
  console.log(`  Loaded ${allPersons.length} persons`);

  // Build lookup: normalized name -> person id
  const personByNormName = new Map();
  const personBySlug = new Map();
  for (const p of allPersons) {
    if (p.full_name) {
      personByNormName.set(p.full_name.toLowerCase().replace(/\s+/g, ' ').trim(), p.id);
    }
    if (p.slug) {
      personBySlug.set(p.slug, p.id);
    }
  }

  function findPersonId(candidateNameRaw) {
    if (!candidateNameRaw) return null;
    // Try normalized "First Last" form
    const norm = normalizeName(candidateNameRaw);
    if (personByNormName.has(norm)) return personByNormName.get(norm);
    // Try slug match
    const slug = slugify(norm);
    if (personBySlug.has(slug)) return personBySlug.get(slug);
    return null;
  }

  // 2. Fetch all contribution records from 2022+ election periods
  console.log('\nFetching contributions from CKAN...');
  const allRecords = [];

  for (const period of TARGET_ELECTION_PERIODS) {
    const records = await fetchRecordsForPeriod(period);
    allRecords.push(...records);
  }

  console.log(`\nTotal records fetched: ${allRecords.length}`);

  // 3. Transform and upsert in batches
  console.log('\nTransforming and upserting to Supabase...');

  let totalUpserted = 0;
  let totalMatched = 0;
  let totalUnmatched = 0;
  let batchErrors = 0;
  const BATCH_SIZE = 200;

  // Deduplicate by _id to avoid issues
  const seenIds = new Set();
  const uniqueRecords = [];
  for (const rec of allRecords) {
    const id = rec._id;
    if (!seenIds.has(id)) {
      seenIds.add(id);
      uniqueRecords.push(rec);
    }
  }
  console.log(`Unique records (after dedup): ${uniqueRecords.length}`);

  for (let i = 0; i < uniqueRecords.length; i += BATCH_SIZE) {
    const batch = uniqueRecords.slice(i, i + BATCH_SIZE);
    const rows = batch.map((rec) => {
      const recipientPersonId = findPersonId(rec['Candidate Name']);
      const matched = recipientPersonId ? 'recipient_matched' : 'unmatched';
      if (recipientPersonId) totalMatched++;
      else totalUnmatched++;

      return {
        donor_name_raw: (rec['Contributor Name'] || '').trim() || null,
        recipient_name_raw: (rec['Candidate Name'] || '').trim() || null,
        recipient_person_id: recipientPersonId,
        amount: rec['Amount'] != null ? Number(rec['Amount']) : null,
        contribution_date: parseContributionDate(rec['Date']),
        contribution_type: rec['Contributor Type'] || null,
        election_period: rec['Election Period'] || null,
        source: 'hawaii_csc',
        match_status: matched,
        raw_record: rec,
        source_file: 'ccscha.csv',
      };
    });

    try {
      const result = await supabaseUpsert('contribution', rows);
      totalUpserted += result.length;
    } catch (err) {
      batchErrors++;
      console.error(`\n  Batch ${Math.floor(i / BATCH_SIZE) + 1} error: ${err.message.substring(0, 150)}`);
      // Try individual inserts for this batch
      for (const row of rows) {
        try {
          const result = await supabaseUpsert('contribution', [row]);
          totalUpserted += result.length;
        } catch (e) {
          // skip silently
        }
      }
    }

    if ((i / BATCH_SIZE) % 10 === 0 || i + BATCH_SIZE >= uniqueRecords.length) {
      process.stdout.write(
        `\r  Progress: ${Math.min(i + BATCH_SIZE, uniqueRecords.length)} / ${uniqueRecords.length} records processed, ${totalUpserted} upserted`
      );
    }
  }

  console.log('\n');
  console.log('========================================');
  console.log('IMPORT COMPLETE');
  console.log('========================================');
  console.log(`Total CKAN records fetched:    ${allRecords.length}`);
  console.log(`Unique records (after dedup):  ${uniqueRecords.length}`);
  console.log(`Records upserted to Supabase:  ${totalUpserted}`);
  console.log(`Recipients matched to person:  ${totalMatched}`);
  console.log(`Recipients unmatched:          ${totalUnmatched}`);
  console.log(`Batch errors:                  ${batchErrors}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
