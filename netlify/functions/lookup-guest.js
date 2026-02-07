const AIRTABLE_BASE_URL = 'https://api.airtable.com/v0';

function getConfig() {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID || 'appVYdeqjVvBqzrqd';
  if (!apiKey) {
    throw new Error('AIRTABLE_API_KEY environment variable is not set');
  }
  return { apiKey, baseId };
}

function airtableHeaders(apiKey) {
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };
}

async function searchGuest(apiKey, baseId, firstName, lastName) {
  const table = encodeURIComponent('Guests');
  const filterFormula = `AND(LOWER({First Name}) = LOWER("${firstName.replace(/"/g, '\\"')}"), LOWER({Last Name}) = LOWER("${lastName.replace(/"/g, '\\"')}"))`;
  const url = `${AIRTABLE_BASE_URL}/${baseId}/${table}?filterByFormula=${encodeURIComponent(filterFormula)}`;

  console.log('Airtable request URL:', url);
  console.log('API key starts with:', apiKey.substring(0, 8) + '...');
  const response = await fetch(url, { headers: airtableHeaders(apiKey) });
  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Airtable error body:', errorBody);
    throw new Error(`Airtable search failed: ${response.status} - ${errorBody}`);
  }

  const data = await response.json();
  if (!data.records || data.records.length === 0) {
    return null;
  }

  const record = data.records[0];
  return {
    id: record.id,
    firstName: record.fields['First Name'],
    lastName: record.fields['Last Name'],
    email: record.fields.Email,
    partyName: record.fields['Party Name'] || '',
    plusOneAllowed: record.fields['Plus One Allowed'] || false,
    hasResponded: record.fields['Has Responded'] || false,
    isAdult: record.fields['Adult/Kid'] !== 'Kid'
  };
}

async function fetchPartyMembers(apiKey, baseId, partyName) {
  const table = encodeURIComponent('Guests');
  const filterFormula = `{Party Name} = "${partyName.replace(/"/g, '\\"')}"`;
  const url = `${AIRTABLE_BASE_URL}/${baseId}/${table}?filterByFormula=${encodeURIComponent(filterFormula)}`;

  const response = await fetch(url, { headers: airtableHeaders(apiKey) });
  if (!response.ok) {
    throw new Error(`Airtable party fetch failed: ${response.status}`);
  }

  const data = await response.json();
  return data.records.map(record => ({
    id: record.id,
    firstName: record.fields['First Name'],
    lastName: record.fields['Last Name'],
    email: record.fields.Email,
    partyName: record.fields['Party Name'],
    hasResponded: record.fields['Has Responded'] || false,
    isAdult: record.fields['Adult/Kid'] !== 'Kid'
  }));
}

async function fetchExistingRsvp(apiKey, baseId, members) {
  const table = encodeURIComponent('RSVPs');
  const guestIds = members.map(m => m.id);
  const filterParts = guestIds.map(id => `FIND("${id}", ARRAYJOIN({Guest}))`);
  const filterFormula = `OR(${filterParts.join(',')})`;
  const url = `${AIRTABLE_BASE_URL}/${baseId}/${table}?filterByFormula=${encodeURIComponent(filterFormula)}`;

  const response = await fetch(url, { headers: airtableHeaders(apiKey) });
  if (!response.ok) {
    return {
      attending: true,
      guests: [],
      submittedBy: 'a party member',
      message: ''
    };
  }

  const data = await response.json();
  if (!data.records || data.records.length === 0) {
    return {
      attending: false,
      guests: [],
      submittedBy: 'a party member',
      message: ''
    };
  }

  const attendingGuests = [];
  const notAttendingGuests = [];
  let submittedBy = '';
  let message = '';

  data.records.forEach(record => {
    const fields = record.fields;

    if (!submittedBy && fields['Submitted By']) {
      submittedBy = fields['Submitted By'];
    }
    if (!message && fields['Message']) {
      message = fields['Message'];
    }

    if (fields['Attending'] === false) {
      notAttendingGuests.push({
        name: fields['Guest Name'],
        isPlusOne: fields['Is Plus One'] || false
      });
      return;
    }

    const events = [];
    if (fields['Welcome Party']) events.push('welcome');
    if (fields['Beach Party']) events.push('beach');
    if (fields['Wedding']) events.push('wedding');

    attendingGuests.push({
      name: fields['Guest Name'],
      events,
      meal: fields['Meal'] || '',
      dietary: fields['Dietary'] || '',
      isPlusOne: fields['Is Plus One'] || false
    });
  });

  return {
    attending: attendingGuests.length > 0,
    guests: attendingGuests,
    notAttendingGuests,
    submittedBy: submittedBy || 'a party member',
    message
  };
}

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { apiKey, baseId } = getConfig();
    const { firstName, lastName } = JSON.parse(event.body);

    if (!firstName || !lastName) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'firstName and lastName are required' })
      };
    }

    // 1. Search for the guest
    const guest = await searchGuest(apiKey, baseId, firstName, lastName);
    if (!guest) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'not_found' })
      };
    }

    // 2. Fetch party members if applicable
    let members = [guest];
    if (guest.partyName) {
      members = await fetchPartyMembers(apiKey, baseId, guest.partyName);
    }

    // 3. Check for existing RSVP if anyone has responded
    const hasResponded = members.some(m => m.hasResponded);
    let existingRsvp = null;
    if (hasResponded) {
      existingRsvp = await fetchExistingRsvp(apiKey, baseId, members);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        leader: guest,
        members,
        hasPlusOne: guest.plusOneAllowed && !guest.partyName,
        existingRsvp
      })
    };
  } catch (error) {
    console.error('lookup-guest error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Internal server error' })
    };
  }
};
