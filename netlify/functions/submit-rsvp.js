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

async function createRsvpRecords(apiKey, baseId, records) {
  const table = encodeURIComponent('RSVPs');
  const url = `${AIRTABLE_BASE_URL}/${baseId}/${table}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: airtableHeaders(apiKey),
    body: JSON.stringify({ records })
  });

  const result = await response.json();
  if (result.error) {
    console.error('Airtable API error:', JSON.stringify(result.error));
    throw new Error(`Airtable error: ${result.error.message || JSON.stringify(result.error)}`);
  }
  return result;
}

async function markGuestResponded(apiKey, baseId, guestId) {
  const table = encodeURIComponent('Guests');
  const url = `${AIRTABLE_BASE_URL}/${baseId}/${table}/${guestId}`;

  await fetch(url, {
    method: 'PATCH',
    headers: airtableHeaders(apiKey),
    body: JSON.stringify({
      fields: { 'Has Responded': true }
    })
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { apiKey, baseId } = getConfig();
    const rsvpData = JSON.parse(event.body);
    const { leader, members, attending, guests, plusOne, message } = rsvpData;

    const records = [];

    if (!attending) {
      // Declining - create one record for the whole party
      records.push({
        fields: {
          'Guest': [leader.id],
          'Guest Name': members.map(m => `${m.firstName} ${m.lastName}`).join(', '),
          'Attending': false,
          'Message': message || ''
        }
      });
    } else {
      // Attending guests with event details
      if (guests) {
        guests
          .filter(g => !g.notAttending && g.events && g.events.length > 0)
          .forEach(guest => {
            const fields = {
              'Guest': [guest.id],
              'Guest Name': `${guest.firstName} ${guest.lastName}`,
              'Attending': true,
              'Welcome Party': guest.events.includes('welcome'),
              'Beach Party': guest.events.includes('beach'),
              'Wedding': guest.events.includes('wedding'),
              'Is Adult': guest.isAdult,
              'Message': message || ''
            };
            if (guest.dietary) fields['Dietary'] = guest.dietary;
            records.push({ fields });
          });

        // Non-attending guests (individual declines within a party)
        guests
          .filter(g => g.notAttending)
          .forEach(guest => {
            records.push({
              fields: {
                'Guest': [guest.id],
                'Guest Name': `${guest.firstName} ${guest.lastName}`,
                'Attending': false,
                'Is Adult': guest.isAdult
              }
            });
          });
      }

      // Plus one record
      if (plusOne && plusOne.name) {
        const plusOneFields = {
          'Guest Name': `${plusOne.name} (Guest of ${leader.firstName})`,
          'Attending': true,
          'Welcome Party': plusOne.events.includes('welcome'),
          'Beach Party': plusOne.events.includes('beach'),
          'Wedding': plusOne.events.includes('wedding'),
          'Is Plus One': true
        };
        if (plusOne.dietary) plusOneFields['Dietary'] = plusOne.dietary;
        records.push({ fields: plusOneFields });
      }
    }

    // Create RSVP records in Airtable
    if (records.length > 0) {
      await createRsvpRecords(apiKey, baseId, records);
    }

    // Mark all party members as responded
    for (const member of members) {
      await markGuestResponded(apiKey, baseId, member.id);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };
  } catch (error) {
    console.error('submit-rsvp error:', error.message || error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Failed to submit RSVP' })
    };
  }
};
