/**
 * Fetch FEC campaign contribution data for Hawaii's federal delegation
 * and insert into Supabase contribution table.
 */

const FEC_BASE = 'https://api.open.fec.gov/v1';
const API_KEY = 'DEMO_KEY';
const SUPABASE_URL = 'https://fdphdzbjdtbxxexgyfba.supabase.co/rest/v1';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkcGhkemJqZHRieHhleGd5ZmJhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjAzOTA1MCwiZXhwIjoyMDkxNjE1MDUwfQ.aaFEmTHR4Y2RtHAIddzlQgptcE3rJKQqDnE6_VoQLd8';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function fecGet(path) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${FEC_BASE}${path}${sep}api_key=${API_KEY}`;
  console.log(`  FEC GET: ${path.substring(0, 80)}...`);
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FEC API error ${res.status}: ${text.substring(0, 200)}`);
  }
  return res.json();
}

async function supabaseGet(path) {
  const url = `${SUPABASE_URL}${path}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
    },
  });
  if (!res.ok) throw new Error(`Supabase GET error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function supabasePost(table, records) {
  const url = `${SUPABASE_URL}/${table}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(records),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase POST error ${res.status}: ${text.substring(0, 500)}`);
  }
  return res.json();
}

// ---------- Main ----------
const candidates = [
  { name: 'Brian Schatz', slug: 'brian-schatz', searchName: 'schatz', office: 'S' },
  { name: 'Mazie Hirono', slug: 'mazie-hirono', searchName: 'hirono', office: 'S' },
  { name: 'Ed Case', slug: 'ed-case', searchName: 'case', office: 'H' },
];

(async () => {
  try {
    // Step 1: Find candidate IDs
    console.log('\n=== Step 1: Finding candidate IDs ===');
    for (const c of candidates) {
      const data = await fecGet(`/candidates/search/?name=${c.searchName}&state=HI&office=${c.office}`);
      const results = data.results || [];
      // Pick the most relevant result
      const match = results.find(r => r.name.toLowerCase().includes(c.searchName.toLowerCase())) || results[0];
      if (!match) throw new Error(`No FEC candidate found for ${c.name}`);
      c.candidateId = match.candidate_id;
      c.fecName = match.name;
      console.log(`  ${c.name} -> ${c.candidateId} (${c.fecName})`);
      await delay(1000);
    }

    // Step 2: Find committee IDs
    console.log('\n=== Step 2: Finding committee IDs ===');
    for (const c of candidates) {
      const data = await fecGet(`/candidate/${c.candidateId}/committees/`);
      const committees = data.results || [];
      // Find the principal campaign committee
      const principal = committees.find(cm => cm.designation === 'P') || committees[0];
      if (!principal) throw new Error(`No committee found for ${c.name}`);
      c.committeeId = principal.committee_id;
      c.committeeName = principal.name;
      console.log(`  ${c.name} -> ${c.committeeId} (${c.committeeName})`);
      await delay(1000);
    }

    // Step 3: Fetch contributions
    console.log('\n=== Step 3: Fetching contributions ===');
    for (const c of candidates) {
      const data = await fecGet(`/schedules/schedule_a/?committee_id=${c.committeeId}&sort=-contribution_receipt_date&per_page=50&min_date=2022-01-01`);
      c.contributions = data.results || [];
      console.log(`  ${c.name}: ${c.contributions.length} contributions fetched`);
      await delay(1000);
    }

    // Step 4: Get person IDs from Supabase
    console.log('\n=== Step 4: Getting person IDs from Supabase ===');
    const slugList = candidates.map(c => c.slug).join(',');
    const persons = await supabaseGet(`/person?select=id,slug,full_name&slug=in.(${slugList})`);
    console.log(`  Found ${persons.length} persons in Supabase`);
    const personMap = {};
    for (const p of persons) {
      personMap[p.slug] = p.id;
      console.log(`  ${p.full_name} (${p.slug}) -> ${p.id}`);
    }

    // Step 5: Build and insert contribution records
    console.log('\n=== Step 5: Inserting contributions ===');
    const allRecords = [];
    for (const c of candidates) {
      const personId = personMap[c.slug] || null;
      if (!personId) {
        console.warn(`  WARNING: No person_id found for ${c.name} (${c.slug}), will insert with null recipient_person_id`);
      }
      for (const contrib of c.contributions) {
        allRecords.push({
          donor_name_raw: contrib.contributor_name || null,
          recipient_name_raw: c.name,
          recipient_person_id: personId,
          amount: contrib.contribution_receipt_amount || null,
          contribution_date: contrib.contribution_receipt_date || null,
          contribution_type: contrib.receipt_type_full || contrib.receipt_type || 'individual',
          election_period: contrib.two_year_transaction_period || null,
          source: 'fec',
          match_status: personId ? 'recipient_matched' : 'unmatched',
          raw_record: contrib,
          source_file: null,
        });
      }
    }

    console.log(`  Total records to insert: ${allRecords.length}`);

    // Insert in batches of 50 to avoid payload limits
    const BATCH = 50;
    let inserted = 0;
    for (let i = 0; i < allRecords.length; i += BATCH) {
      const batch = allRecords.slice(i, i + BATCH);
      const result = await supabasePost('contribution', batch);
      inserted += result.length;
      console.log(`  Inserted batch ${Math.floor(i / BATCH) + 1}: ${result.length} records`);
    }

    // Summary
    console.log('\n=== Summary ===');
    for (const c of candidates) {
      console.log(`  ${c.name}: ${c.contributions.length} contributions`);
    }
    console.log(`  Total inserted: ${inserted}`);
    console.log('Done!');

  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
})();
