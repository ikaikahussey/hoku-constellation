/**
 * Fetch Ed Case contributions using the correct committee ID (C00680918)
 * and insert into Supabase.
 */

const FEC_BASE = 'https://api.open.fec.gov/v1';
const API_KEY = 'DEMO_KEY';
const SUPABASE_URL = 'https://fdphdzbjdtbxxexgyfba.supabase.co/rest/v1';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkcGhkemJqZHRieHhleGd5ZmJhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjAzOTA1MCwiZXhwIjoyMDkxNjE1MDUwfQ.aaFEmTHR4Y2RtHAIddzlQgptcE3rJKQqDnE6_VoQLd8';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function fecGet(path) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${FEC_BASE}${path}${sep}api_key=${API_KEY}`;
  console.log(`  FEC GET: ${path.substring(0, 100)}...`);
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FEC API error ${res.status}: ${text.substring(0, 300)}`);
  }
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

(async () => {
  try {
    const COMMITTEE_ID = 'C00680918'; // CASE FOR CONGRESS (current)
    const PERSON_ID = '6eaadbba-23b6-451f-a69b-c87d958d6595'; // ed-case in Supabase

    console.log('Fetching Ed Case contributions from committee C00680918...');
    const data = await fecGet(`/schedules/schedule_a/?committee_id=${COMMITTEE_ID}&sort=-contribution_receipt_date&per_page=50&min_date=2022-01-01`);
    const contributions = data.results || [];
    console.log(`  Fetched ${contributions.length} contributions`);

    if (contributions.length === 0) {
      // Try without date filter
      console.log('  No results with date filter, trying without...');
      await delay(1000);
      const data2 = await fecGet(`/schedules/schedule_a/?committee_id=${COMMITTEE_ID}&sort=-contribution_receipt_date&per_page=50`);
      const contribs2 = data2.results || [];
      console.log(`  Fetched ${contribs2.length} contributions (no date filter)`);
      contributions.push(...contribs2);
    }

    if (contributions.length === 0) {
      console.log('  Still no contributions found. Exiting.');
      return;
    }

    const records = contributions.map(contrib => ({
      donor_name_raw: contrib.contributor_name || null,
      recipient_name_raw: 'Ed Case',
      recipient_person_id: PERSON_ID,
      amount: contrib.contribution_receipt_amount || null,
      contribution_date: contrib.contribution_receipt_date || null,
      contribution_type: contrib.receipt_type_full || contrib.receipt_type || 'individual',
      election_period: contrib.two_year_transaction_period || null,
      source: 'fec',
      match_status: 'recipient_matched',
      raw_record: contrib,
      source_file: null,
    }));

    console.log(`  Inserting ${records.length} records...`);
    const result = await supabasePost('contribution', records);
    console.log(`  Inserted ${result.length} records for Ed Case`);
    console.log('Done!');
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
})();
