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
    throw new Error(`Airtable error: ${result.error.message || result.error}`);
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
          'Submitted By': `${leader.firstName} ${leader.lastName}`,
          'Message': message || ''
        }
      });
    } else {
      // Attending guests with event details
      if (guests) {
        guests
          .filter(g => !g.notAttending && g.events && g.events.length > 0)
          .forEach(guest => {
            records.push({
              fields: {
                'Guest': [guest.id],
                'Guest Name': `${guest.firstName} ${guest.lastName}`,
                'Attending': true,
                'Welcome Party': guest.events.includes('welcome'),
                'Beach Party': guest.events.includes('beach'),
                'Wedding': guest.events.includes('wedding'),
                'Meal': guest.meal,
                'Dietary': guest.dietary,
                'Is Adult': guest.isAdult,
                'Submitted By': `${leader.firstName} ${leader.lastName}`,
                'Message': message || ''
              }
            });
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
                'Is Adult': guest.isAdult,
                'Submitted By': `${leader.firstName} ${leader.lastName}`
              }
            });
          });
      }

      // Plus one record
      if (plusOne && plusOne.name) {
        records.push({
          fields: {
            'Guest Name': `${plusOne.name} (Guest of ${leader.firstName})`,
            'Attending': true,
            'Welcome Party': plusOne.events.includes('welcome'),
            'Beach Party': plusOne.events.includes('beach'),
            'Wedding': plusOne.events.includes('wedding'),
            'Meal': plusOne.meal,
            'Dietary': plusOne.dietary,
            'Is Plus One': true,
            'Submitted By': `${leader.firstName} ${leader.lastName}`
          }
        });
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
    console.error('submit-rsvp error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to submit RSVP' })
    };
  }
};
