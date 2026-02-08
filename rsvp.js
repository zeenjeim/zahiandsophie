/**
 * Sophie & Zahi Wedding - RSVP System
 * Multi-step form with Airtable backend
 * Supports individual guests, +1s, and family/group RSVPs
 */

// ============================================
// CONFIGURATION
// ============================================
// Airtable API calls are proxied through Netlify Functions.
// The API key is stored server-side as an environment variable.
// Demo mode is used for local development (localhost/file://).

function isDemoMode() {
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '' || window.location.protocol === 'file:';
}

/*
  AIRTABLE GUESTS TABLE STRUCTURE:
  ================================
  | Field Name        | Type          | Description                              |
  |-------------------|---------------|------------------------------------------|
  | First Name        | Single text   | Guest's first name                       |
  | Last Name         | Single text   | Guest's last name                        |
  | Email             | Email         | Optional - for confirmations             |
  | Party Name        | Single text   | Family/group name (e.g., "Njeim Family") |
  | Plus One Allowed  | Checkbox      | Can bring an unnamed +1? (solo guests)   |
  | Has Responded     | Checkbox      | Auto-updated when party RSVPs            |
  | Adult/Kid         | Single select | "Adult" or "Kid" - affects meal options  |

  NOTE: Any party member can RSVP first. Once submitted, the RSVP is locked
  for all party members (they'll see a read-only view of the submitted response).

  EXAMPLES:
  ---------
  Solo guest with +1:
    First: "John", Last: "Smith", Party Name: "", Plus One Allowed: true

  Family (anyone can RSVP for everyone, first one to do it locks it):
    First: "Pierre",  Last: "Njeim", Party Name: "Njeim Family", Adult/Kid: "Adult"
    First: "Luciana", Last: "Njeim", Party Name: "Njeim Family", Adult/Kid: "Adult"
    First: "Phoenix", Last: "Njeim", Party Name: "Njeim Family", Adult/Kid: "Kid"
    First: "Leona",   Last: "Njeim", Party Name: "Njeim Family", Adult/Kid: "Kid"
    First: "Jasmine", Last: "Njeim", Party Name: "Njeim Family", Adult/Kid: "Kid"

  When any Njeim family member logs in, they see and RSVP for all 5 family members.
  Once submitted, anyone else trying to RSVP sees the locked confirmation.
*/

// ============================================
// STATE MANAGEMENT
// ============================================
let currentStep = 1;
let partyLeader = null;      // The person who logged in
let partyMembers = [];       // All guests in the party (including leader)
let hasPlusOne = false;      // Whether party leader can bring unnamed +1
let existingRsvp = null;     // Existing RSVP data if party has already responded

let formData = {
  attending: null,
  guests: [],        // Array of { id, firstName, lastName, isAdult, events: [], dietary }
  plusOne: null,     // { name, events: [], dietary } if applicable
  message: ''
};

// ============================================
// DOM ELEMENTS
// ============================================
const form = document.getElementById('rsvpForm');
const steps = document.querySelectorAll('.rsvp-step');
const progressSteps = document.querySelectorAll('.rsvp-progress__step');

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
});

function initEventListeners() {
  // Step 1: Find Invitation
  document.getElementById('findInvitation')?.addEventListener('click', handleFindInvitation);

  // Handle Enter key on name fields
  ['firstName', 'lastName'].forEach(id => {
    document.getElementById(id)?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleFindInvitation();
      }
    });
  });

  // Step 2: Guest Details
  document.getElementById('backToStep1FromDetails')?.addEventListener('click', () => goToStep(1));
  document.getElementById('toStep3')?.addEventListener('click', handleDetailsSubmit);

  // Step 3: Review
  document.getElementById('backToStep2')?.addEventListener('click', () => goToStep(2));
  document.getElementById('submitRsvp')?.addEventListener('click', handleFinalSubmit);

  // Form submission prevention
  form?.addEventListener('submit', (e) => e.preventDefault());
}

// ============================================
// GUEST ATTENDANCE TOGGLE
// ============================================
function toggleGuestAttending(guestId, notAttending) {
  const fieldsContainer = document.getElementById(`guest-fields-${guestId}`);
  const guestCard = document.querySelector(`.rsvp-guest-card[data-guest-id="${guestId}"]`);

  if (fieldsContainer) {
    if (notAttending) {
      fieldsContainer.style.display = 'none';
      guestCard?.classList.add('rsvp-guest-card--not-attending');
    } else {
      fieldsContainer.style.display = '';
      guestCard?.classList.remove('rsvp-guest-card--not-attending');
    }
  }
}

// ============================================
// STEP NAVIGATION
// ============================================
function goToStep(step) {
  // Hide all steps
  steps.forEach(s => s.classList.remove('active'));

  // Show target step
  const targetStep = document.querySelector(`.rsvp-step[data-step="${step}"]`);
  if (targetStep) {
    targetStep.classList.add('active');
  }

  // Update progress indicators
  progressSteps.forEach(ps => {
    const psStep = parseInt(ps.dataset.step);
    ps.classList.remove('active', 'completed');

    if (psStep < step) {
      ps.classList.add('completed');
    } else if (psStep === step) {
      ps.classList.add('active');
    }
  });

  currentStep = step;

  // Scroll to top of form
  document.querySelector('.rsvp-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showSuccessState() {
  steps.forEach(s => s.classList.remove('active'));
  document.querySelector('.rsvp-step[data-step="success"]')?.classList.add('active');
  document.querySelector('.rsvp-progress')?.style.setProperty('display', 'none');

  // Set up calendar links
  setupCalendarLinks();
}

function showDeclineState() {
  steps.forEach(s => s.classList.remove('active'));
  document.querySelector('.rsvp-step[data-step="decline"]')?.classList.add('active');
  document.querySelector('.rsvp-progress')?.style.setProperty('display', 'none');
}

/**
 * Show the "already submitted" view for parties that have already RSVPed
 * Displays a read-only summary of the submitted response
 */
function showAlreadySubmittedView() {
  // Hide all steps and progress
  steps.forEach(s => s.classList.remove('active'));
  document.querySelector('.rsvp-progress')?.style.setProperty('display', 'none');

  // Show the already submitted step
  const alreadySubmittedStep = document.querySelector('.rsvp-step[data-step="already-submitted"]');
  if (alreadySubmittedStep) {
    alreadySubmittedStep.classList.add('active');
  }

  // Populate the submitted by info
  const submittedByEl = document.getElementById('submittedByName');
  if (submittedByEl && existingRsvp.submittedBy) {
    submittedByEl.textContent = existingRsvp.submittedBy;
  }

  // If they declined
  if (!existingRsvp.attending) {
    const summaryEl = document.getElementById('alreadySubmittedSummary');
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="rsvp-summary__section">
          <div class="rsvp-summary__label">Response</div>
          <div class="rsvp-summary__value" style="color: var(--color-stone);">
            Regretfully declined
          </div>
        </div>
      `;
    }
    return;
  }

  // Show calendar section for attending guests
  const calendarSection = document.getElementById('alreadySubmittedCalendar');
  if (calendarSection) {
    calendarSection.style.display = 'block';
    const googleCalLink = document.getElementById('googleCalendarLinkAlreadySubmitted');
    if (googleCalLink) {
      googleCalLink.href = generateGoogleCalendarUrl();
    }
  }

  // Build the read-only summary
  const eventShortNames = {
    welcome: 'Welcome Party',
    beach: 'Beach Party',
    wedding: 'Wedding'
  };

  const summaryEl = document.getElementById('alreadySubmittedSummary');
  if (!summaryEl) return;

  let html = '';

  // Show attending guests
  if (existingRsvp.guests && existingRsvp.guests.length > 0) {
    const guestCount = existingRsvp.guests.length;
    html += `
      <div class="rsvp-summary__section">
        <div class="rsvp-summary__label">Attending (${guestCount})</div>
    `;

    existingRsvp.guests.forEach(guest => {
      const eventsText = guest.events.map(e => eventShortNames[e] || e).join(', ');
      html += `
        <div class="rsvp-summary__guest">
          <div class="rsvp-summary__guest-name">${guest.name}</div>
          <div class="rsvp-summary__guest-events">${eventsText}</div>
          ${guest.dietary ? `<div>Dietary: ${guest.dietary}</div>` : ''}
        </div>
      `;
    });

    html += '</div>';
  }

  // Show not attending guests
  if (existingRsvp.notAttendingGuests && existingRsvp.notAttendingGuests.length > 0) {
    html += `
      <div class="rsvp-summary__section">
        <div class="rsvp-summary__label">Not Attending (${existingRsvp.notAttendingGuests.length})</div>
    `;

    existingRsvp.notAttendingGuests.forEach(guest => {
      html += `
        <div class="rsvp-summary__guest rsvp-summary__guest--not-attending">
          <div class="rsvp-summary__guest-name">${guest.name}</div>
        </div>
      `;
    });

    html += '</div>';
  }

  if (existingRsvp.message) {
    html += `
      <div class="rsvp-summary__section">
        <div class="rsvp-summary__label">Message</div>
        <div class="rsvp-summary__value">"${existingRsvp.message}"</div>
      </div>
    `;
  }

  summaryEl.innerHTML = html;
}

// ============================================
// STEP 1: FIND INVITATION
// ============================================
async function handleFindInvitation() {
  const firstNameInput = document.getElementById('firstName');
  const lastNameInput = document.getElementById('lastName');
  const errorEl = document.getElementById('nameError');
  const button = document.getElementById('findInvitation');

  const firstName = firstNameInput.value.trim();
  const lastName = lastNameInput.value.trim();

  // Clear previous error
  errorEl.textContent = '';

  if (!firstName || !lastName) {
    errorEl.textContent = 'Please enter both your first and last name';
    if (!firstName) {
      firstNameInput.focus();
    } else {
      lastNameInput.focus();
    }
    return;
  }

  // Show loading state
  button.classList.add('loading');
  button.disabled = true;

  try {
    // Look up guest in Airtable
    const result = await findGuestInAirtable(firstName, lastName);

    if (result) {
      partyLeader = result.leader;
      partyMembers = result.members;
      hasPlusOne = result.hasPlusOne;
      existingRsvp = result.existingRsvp;

      // Check if party has already responded
      if (existingRsvp) {
        // Show locked/already submitted view
        showAlreadySubmittedView();
        return;
      }

      // Initialize form data for all party members
      formData.guests = partyMembers.map(member => ({
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        meal: '',
        dietary: '',
        attending: true  // Default to attending
      }));

      // Set attending to true by default (individual guests can opt out in step 2)
      formData.attending = true;

      // Build guest details UI
      buildGuestDetailsUI();

      // Go to step 2 (guest details)
      goToStep(2);
    } else {
      errorEl.textContent = 'We couldn\'t find your invitation. Please check the spelling or contact us.';
    }
  } catch (error) {
    console.error('Error finding guest:', error);
    errorEl.textContent = 'Something went wrong. Please try again or contact us.';
  } finally {
    button.classList.remove('loading');
    button.disabled = false;
  }
}

/**
 * Build the guest details UI dynamically based on party members
 * Each guest gets their own event checkboxes + meal preferences
 */
function buildGuestDetailsUI() {
  const container = document.getElementById('guestDetailsContainer');
  if (!container) return;

  let html = '';

  // Add card for each party member
  partyMembers.forEach((member, index) => {
    const isAdult = member.isAdult !== false; // Default to adult if not specified
    const guestType = isAdult ? '' : '<span class="rsvp-guest-card__badge">Child</span>';

    html += `
      <div class="rsvp-guest-card" data-guest-id="${member.id}">
        <h4 class="rsvp-guest-card__title">
          <span class="rsvp-guest-card__number">${index + 1}</span>
          ${member.firstName} ${member.lastName}
          ${guestType}
        </h4>

        <!-- Not attending toggle -->
        <div class="rsvp-form__group rsvp-not-attending-toggle">
          <label class="rsvp-checkbox rsvp-checkbox--inline">
            <input type="checkbox" name="not_attending_${member.id}" onchange="toggleGuestAttending('${member.id}', this.checked)">
            <span class="rsvp-checkbox__box"></span>
            <span class="rsvp-checkbox__content">
              <span class="rsvp-checkbox__title">${member.firstName} will not be attending</span>
            </span>
          </label>
        </div>

        <div class="rsvp-guest-card__fields" id="guest-fields-${member.id}">
          <!-- Events for this guest -->
          <div class="rsvp-form__group">
            <label class="rsvp-form__label">Which events will ${member.firstName} attend?</label>
            <div class="rsvp-events-compact">
              <label class="rsvp-event-chip">
                <input type="checkbox" name="event_welcome_${member.id}" checked>
                <span class="rsvp-event-chip__label">Welcome Party</span>
                <span class="rsvp-event-chip__date">Sun Aug 30</span>
              </label>
              <label class="rsvp-event-chip">
                <input type="checkbox" name="event_beach_${member.id}" checked>
                <span class="rsvp-event-chip__label">Beach Party</span>
                <span class="rsvp-event-chip__date">Mon Aug 31</span>
              </label>
              <label class="rsvp-event-chip">
                <input type="checkbox" name="event_wedding_${member.id}" checked>
                <span class="rsvp-event-chip__label">Wedding</span>
                <span class="rsvp-event-chip__date">Tue Sep 1</span>
              </label>
            </div>
          </div>

          <!-- Dietary restrictions -->
          <div class="rsvp-form__group">
            <label class="rsvp-form__label">Dietary Restrictions / Allergies</label>
            <input
              type="text"
              name="dietary_${member.id}"
              class="rsvp-form__input"
              placeholder="e.g., gluten-free, nut allergy"
            >
          </div>
        </div>
      </div>
    `;
  });

  // Add plus one card if applicable (only for single guests with +1 allowed)
  if (hasPlusOne && partyMembers.length === 1) {
    html += `
      <div class="rsvp-guest-card rsvp-guest-card--plusone" data-guest-id="plusone">
        <h4 class="rsvp-guest-card__title">
          <span class="rsvp-guest-card__number">+1</span>
          Your Guest (Optional)
        </h4>
        <div class="rsvp-guest-card__fields">
          <div class="rsvp-form__group">
            <label class="rsvp-form__label">Guest's Full Name</label>
            <input
              type="text"
              name="plusone_name"
              class="rsvp-form__input"
              placeholder="Leave blank if not bringing a guest"
            >
          </div>

          <!-- Events for plus one -->
          <div class="rsvp-form__group rsvp-plusone-events" style="display: none;">
            <label class="rsvp-form__label">Which events will they attend?</label>
            <div class="rsvp-events-compact">
              <label class="rsvp-event-chip">
                <input type="checkbox" name="event_welcome_plusone" checked>
                <span class="rsvp-event-chip__label">Welcome Party</span>
              </label>
              <label class="rsvp-event-chip">
                <input type="checkbox" name="event_beach_plusone" checked>
                <span class="rsvp-event-chip__label">Beach Party</span>
              </label>
              <label class="rsvp-event-chip">
                <input type="checkbox" name="event_wedding_plusone" checked>
                <span class="rsvp-event-chip__label">Wedding</span>
              </label>
            </div>
          </div>

          <div class="rsvp-form__group">
            <label class="rsvp-form__label">Dietary Restrictions / Allergies</label>
            <input
              type="text"
              name="plusone_dietary"
              class="rsvp-form__input"
              placeholder="e.g., gluten-free, nut allergy"
            >
          </div>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;

  // Add event listener to show/hide plus one events when name is entered
  const plusOneName = document.querySelector('input[name="plusone_name"]');
  const plusOneEvents = document.querySelector('.rsvp-plusone-events');
  if (plusOneName && plusOneEvents) {
    plusOneName.addEventListener('input', () => {
      plusOneEvents.style.display = plusOneName.value.trim() ? 'block' : 'none';
    });
  }
}

// ============================================
// STEP 2: ATTENDANCE RESPONSE
// ============================================
function handleAttendanceResponse() {
  const attendingRadio = document.querySelector('input[name="attending"]:checked');

  if (!attendingRadio) {
    alert('Please select whether you will be attending.');
    return;
  }

  formData.attending = attendingRadio.value === 'yes';

  if (formData.attending) {
    goToStep(3);
  } else {
    // Submit decline and show decline state
    submitDecline();
  }
}

async function submitDecline() {
  try {
    await submitRSVPToAirtable({
      leader: partyLeader,
      members: partyMembers,
      attending: false,
      events: [],
      guests: [],
      plusOne: null,
      message: ''
    });
    showDeclineState();
  } catch (error) {
    console.error('Error submitting decline:', error);
    showDeclineState(); // Still show decline state even if API fails
  }
}

// ============================================
// STEP 2: GUEST DETAILS
// ============================================
function handleDetailsSubmit() {
  // Gather guest details with per-guest events
  formData.guests = partyMembers.map(member => {
    // Check if this guest is marked as not attending
    const notAttending = document.querySelector(`input[name="not_attending_${member.id}"]`)?.checked || false;

    if (notAttending) {
      return {
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        isAdult: member.isAdult !== false,
        notAttending: true,
        events: [],
        meal: '',
        dietary: ''
      };
    }

    // Get events for this guest
    const events = [];
    if (document.querySelector(`input[name="event_welcome_${member.id}"]`)?.checked) events.push('welcome');
    if (document.querySelector(`input[name="event_beach_${member.id}"]`)?.checked) events.push('beach');
    if (document.querySelector(`input[name="event_wedding_${member.id}"]`)?.checked) events.push('wedding');

    return {
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      isAdult: member.isAdult !== false,
      notAttending: false,
      events: events,
      meal: '',
      dietary: document.querySelector(`input[name="dietary_${member.id}"]`)?.value || ''
    };
  });

  // Gather plus one if applicable
  if (hasPlusOne && partyMembers.length === 1) {
    const plusOneName = document.querySelector('input[name="plusone_name"]')?.value?.trim() || '';
    if (plusOneName) {
      // Get events for plus one
      const plusOneEvents = [];
      if (document.querySelector('input[name="event_welcome_plusone"]')?.checked) plusOneEvents.push('welcome');
      if (document.querySelector('input[name="event_beach_plusone"]')?.checked) plusOneEvents.push('beach');
      if (document.querySelector('input[name="event_wedding_plusone"]')?.checked) plusOneEvents.push('wedding');

      formData.plusOne = {
        name: plusOneName,
        events: plusOneEvents,
        meal: '',
        dietary: document.querySelector('input[name="plusone_dietary"]')?.value || ''
      };
    } else {
      formData.plusOne = null;
    }
  }

  // Gather message
  formData.message = document.querySelector('textarea[name="message"]')?.value || '';

  // Check if everyone is marked as not attending
  const attendingGuests = formData.guests.filter(g => !g.notAttending);
  if (attendingGuests.length === 0 && !formData.plusOne?.name) {
    // Everyone declined - submit as a decline
    formData.attending = false;
    submitDecline();
    return;
  }

  // Validate: each attending guest must attend at least one event
  for (const guest of attendingGuests) {
    if (guest.events.length === 0) {
      alert(`Please select at least one event for ${guest.firstName} to attend.`);
      return;
    }
  }

  // Check plus one has events if they're coming
  if (formData.plusOne && formData.plusOne.name) {
    if (formData.plusOne.events.length === 0) {
      alert('Please select at least one event for your guest to attend.');
      return;
    }
  }

  // Generate summary and go to step 3
  generateSummary();
  goToStep(3);
}

// ============================================
// STEP 3: REVIEW & SUBMIT
// ============================================
function generateSummary() {
  const summaryEl = document.getElementById('rsvpSummary');
  if (!summaryEl) return;

  const eventShortNames = {
    welcome: 'Welcome Party',
    beach: 'Beach Party',
    wedding: 'Wedding'
  };

  // Split guests into attending and not attending
  const attendingGuests = formData.guests.filter(g => !g.notAttending);
  const notAttendingGuests = formData.guests.filter(g => g.notAttending);

  // Count total attending
  const attendingCount = attendingGuests.length + (formData.plusOne?.name ? 1 : 0);

  let html = '';

  // Attending guests section
  if (attendingCount > 0) {
    html += `
      <div class="rsvp-summary__section">
        <div class="rsvp-summary__label">Attending (${attendingCount})</div>
    `;

    // List each attending guest with their events
    attendingGuests.forEach(guest => {
      const eventsText = guest.events.map(e => eventShortNames[e]).join(', ');
      html += `
        <div class="rsvp-summary__guest">
          <div class="rsvp-summary__guest-name">${guest.firstName} ${guest.lastName}</div>
          <div class="rsvp-summary__guest-events">${eventsText}</div>
          ${guest.dietary ? `<div>Dietary: ${guest.dietary}</div>` : ''}
        </div>
      `;
    });

    // Plus one
    if (formData.plusOne && formData.plusOne.name) {
      const plusOneEvents = formData.plusOne.events.map(e => eventShortNames[e]).join(', ');
      html += `
        <div class="rsvp-summary__guest">
          <div class="rsvp-summary__guest-name">${formData.plusOne.name} <span style="color: var(--color-sage);">(+1)</span></div>
          <div class="rsvp-summary__guest-events">${plusOneEvents}</div>
          ${formData.plusOne.dietary ? `<div>Dietary: ${formData.plusOne.dietary}</div>` : ''}
        </div>
      `;
    }

    html += '</div>';
  }

  // Not attending guests section
  if (notAttendingGuests.length > 0) {
    html += `
      <div class="rsvp-summary__section">
        <div class="rsvp-summary__label">Not Attending (${notAttendingGuests.length})</div>
    `;

    notAttendingGuests.forEach(guest => {
      html += `
        <div class="rsvp-summary__guest rsvp-summary__guest--not-attending">
          <div class="rsvp-summary__guest-name">${guest.firstName} ${guest.lastName}</div>
        </div>
      `;
    });

    html += '</div>';
  }

  if (formData.message) {
    html += `
      <div class="rsvp-summary__section">
        <div class="rsvp-summary__label">Your Message</div>
        <div class="rsvp-summary__value">"${formData.message}"</div>
      </div>
    `;
  }

  summaryEl.innerHTML = html;
}

async function handleFinalSubmit(e) {
  e.preventDefault();

  const button = document.getElementById('submitRsvp');
  button.classList.add('loading');
  button.disabled = true;

  try {
    await submitRSVPToAirtable({
      leader: partyLeader,
      members: partyMembers,
      attending: true,
      events: formData.events,
      guests: formData.guests,
      plusOne: formData.plusOne,
      message: formData.message
    });

    showSuccessState();
  } catch (error) {
    console.error('Error submitting RSVP:', error);
    alert('There was an error submitting your RSVP. Please try again or contact us directly.');
    button.classList.remove('loading');
    button.disabled = false;
  }
}

// ============================================
// AIRTABLE API FUNCTIONS
// ============================================

/**
 * Find a guest via Netlify function (or demo mode for local dev)
 * Returns { leader, members, hasPlusOne, existingRsvp } or null if not found
 */
async function findGuestInAirtable(firstName, lastName) {
  // Use demo mode for local development
  if (isDemoMode()) {
    return getDemoGuest(firstName, lastName);
  }

  const response = await fetch('/.netlify/functions/lookup-guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName, lastName })
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error('Lookup error:', response.status, errorData);
    throw new Error(errorData.error || 'Failed to look up guest');
  }

  return await response.json();
}

/**
 * Submit RSVP via Netlify function (or demo mode for local dev)
 */
async function submitRSVPToAirtable(rsvpData) {
  // Use demo mode for local development
  if (isDemoMode()) {
    console.log('Demo mode - RSVP data:', rsvpData);
    await new Promise(resolve => setTimeout(resolve, 1000));
    return;
  }

  const response = await fetch('/.netlify/functions/submit-rsvp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rsvpData)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to submit RSVP');
  }
}

// ============================================
// DEMO MODE (for testing without Airtable)
// ============================================

/**
 * Demo guest data for testing the form
 * Includes examples of: solo guest, solo + plus one, family group, and already responded
 */
function getDemoGuest(firstName, lastName) {
  // Demo guests database
  const demoGuests = [
    // Solo guest with +1
    {
      id: 'demo_john',
      firstName: 'John',
      lastName: 'Smith',
      email: 'john@example.com',
      partyName: '',
      plusOneAllowed: true,
      hasResponded: false,
      isAdult: true
    },
    // Solo guest without +1
    {
      id: 'demo_jane',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      partyName: '',
      plusOneAllowed: false,
      hasResponded: false,
      isAdult: true
    },
    // Pierre's Family (Zahi's brother) - can RSVP for everyone
    {
      id: 'demo_pierre',
      firstName: 'Pierre',
      lastName: 'Njeim',
      email: 'pierre@example.com',
      partyName: 'Njeim Family',
      plusOneAllowed: false,
      hasResponded: false,
      isAdult: true
    },
    // Pierre's wife
    {
      id: 'demo_luciana',
      firstName: 'Luciana',
      lastName: 'Njeim',
      email: '',
      partyName: 'Njeim Family',
      plusOneAllowed: false,
      hasResponded: false,
      isAdult: true
    },
    // Pierre's kids
    {
      id: 'demo_phoenix',
      firstName: 'Phoenix',
      lastName: 'Njeim',
      email: '',
      partyName: 'Njeim Family',
      plusOneAllowed: false,
      hasResponded: false,
      isAdult: false  // Child
    },
    {
      id: 'demo_leona',
      firstName: 'Leona',
      lastName: 'Njeim',
      email: '',
      partyName: 'Njeim Family',
      plusOneAllowed: false,
      hasResponded: false,
      isAdult: false  // Child
    },
    {
      id: 'demo_jasmine',
      firstName: 'Jasmine',
      lastName: 'Njeim',
      email: '',
      partyName: 'Njeim Family',
      plusOneAllowed: false,
      hasResponded: false,
      isAdult: false  // Child
    },
    // Sophie (bride) - for testing
    {
      id: 'demo_sophie',
      firstName: 'Sophie',
      lastName: 'Belmand',
      email: 'sophie@example.com',
      partyName: '',
      plusOneAllowed: true,
      hasResponded: false,
      isAdult: true
    },
    // Example of already-responded family (for testing locked view)
    // Use "Test Responded" as last name to test the locked view
    {
      id: 'demo_bob',
      firstName: 'Bob',
      lastName: 'Responded',
      email: 'bob@example.com',
      partyName: 'Responded Family',
      plusOneAllowed: false,
      hasResponded: true,
      isAdult: true
    },
    {
      id: 'demo_alice',
      firstName: 'Alice',
      lastName: 'Responded',
      email: '',
      partyName: 'Responded Family',
      plusOneAllowed: false,
      hasResponded: true,
      isAdult: true
    }
  ];

  // Demo existing RSVP data (for testing locked view)
  const demoExistingRsvps = {
    'Responded Family': {
      attending: true,
      submittedBy: 'Bob Responded',
      message: 'So excited to celebrate with you!',
      guests: [
        {
          name: 'Bob Responded',
          events: ['welcome', 'beach', 'wedding'],
          meal: 'meat',
          dietary: ''
        },
        {
          name: 'Alice Responded',
          events: ['welcome', 'wedding'],
          meal: 'vegetarian',
          dietary: 'Gluten-free'
        }
      ]
    }
  };

  // Find the guest
  const guest = demoGuests.find(
    g => g.firstName.toLowerCase() === firstName.toLowerCase() &&
         g.lastName.toLowerCase() === lastName.toLowerCase()
  );

  if (!guest) return null;

  // If guest has a party, get all party members
  let members = [guest];
  if (guest.partyName) {
    members = demoGuests.filter(g => g.partyName === guest.partyName);
  }

  // Check if party has already responded
  const hasResponded = members.some(m => m.hasResponded);
  let existingRsvpData = null;

  if (hasResponded && guest.partyName && demoExistingRsvps[guest.partyName]) {
    existingRsvpData = demoExistingRsvps[guest.partyName];
  } else if (hasResponded && !guest.partyName) {
    // Solo guest who already responded
    existingRsvpData = {
      attending: true,
      submittedBy: `${guest.firstName} ${guest.lastName}`,
      message: '',
      guests: [{
        name: `${guest.firstName} ${guest.lastName}`,
        events: ['welcome', 'beach', 'wedding'],
        meal: 'fish',
        dietary: ''
      }]
    };
  }

  return {
    leader: guest,
    members: members,
    hasPlusOne: guest.plusOneAllowed && !guest.partyName,
    existingRsvp: existingRsvpData
  };
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Sanitize user input
 */
function sanitize(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================
// CALENDAR FUNCTIONS
// ============================================

/**
 * Wedding event details for calendar generation
 */
const WEDDING_EVENTS = [
  {
    title: "Sophie & Zahi's Wedding - Welcome Party",
    start: new Date(2026, 7, 30, 18, 0),  // Aug 30, 2026, 6pm
    end: new Date(2026, 7, 30, 23, 0),    // Aug 30, 2026, 11pm
    description: "Welcome cocktails and dinner to kick off the wedding celebrations!",
    location: "French Riviera"
  },
  {
    title: "Sophie & Zahi's Wedding - Beach Party",
    start: new Date(2026, 7, 31, 12, 0),  // Aug 31, 2026, 12pm
    end: new Date(2026, 7, 31, 18, 0),    // Aug 31, 2026, 6pm
    description: "Fun day at the beach with the wedding party!",
    location: "French Riviera"
  },
  {
    title: "Sophie & Zahi's Wedding",
    start: new Date(2026, 8, 1, 15, 0),   // Sep 1, 2026, 3pm
    end: new Date(2026, 8, 2, 1, 0),      // Sep 2, 2026, 1am
    description: "The wedding ceremony and reception of Sophie & Zahi. We can't wait to celebrate with you!",
    location: "French Riviera"
  }
];

/**
 * Format date for ICS file (YYYYMMDDTHHMMSS format in UTC)
 */
function formatDateForICS(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

/**
 * Format date for Google Calendar URL (YYYYMMDDTHHMMSS format, local time)
 */
function formatDateForGoogle(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

/**
 * Generate ICS file content for all wedding events
 */
function generateICSContent() {
  let icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sophie & Zahi Wedding//RSVP//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ];

  WEDDING_EVENTS.forEach((event, index) => {
    const uid = `wedding-event-${index}@sophieandzahi.com`;
    const dtstamp = formatDateForICS(new Date());
    const dtstart = formatDateForICS(event.start);
    const dtend = formatDateForICS(event.end);

    icsContent.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${dtstart}`,
      `DTEND:${dtend}`,
      `SUMMARY:${event.title}`,
      `DESCRIPTION:${event.description.replace(/\n/g, '\\n')}`,
      `LOCATION:${event.location}`,
      'END:VEVENT'
    );
  });

  icsContent.push('END:VCALENDAR');
  return icsContent.join('\r\n');
}

/**
 * Download ICS calendar file
 */
function downloadCalendarFile() {
  const icsContent = generateICSContent();
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = 'sophie-zahi-wedding.ics';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Generate Google Calendar URL for the main wedding event
 */
function generateGoogleCalendarUrl() {
  const wedding = WEDDING_EVENTS[2]; // Main wedding event
  const startStr = formatDateForGoogle(wedding.start);
  const endStr = formatDateForGoogle(wedding.end);

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: wedding.title,
    dates: `${startStr}/${endStr}`,
    details: `${wedding.description}\n\nThis event includes:\n• Welcome Party (Aug 30)\n• Beach Party (Aug 31)\n• Wedding Ceremony & Reception (Sep 1)`,
    location: wedding.location,
    ctz: 'Europe/Paris'
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Set up Google Calendar link when showing success state
 */
function setupCalendarLinks() {
  const googleCalLink = document.getElementById('googleCalendarLink');
  if (googleCalLink) {
    googleCalLink.href = generateGoogleCalendarUrl();
  }
}
