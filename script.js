document.addEventListener('DOMContentLoaded', async () => {

    // IMPORTANT: Replace this with your Render deployment URL.

    const API_BASE_URL = 'https://mail-sender-hwq9.onrender.com';



    // --- DOM Elements ---

    const googleSigninBtn = document.getElementById('google-signin-btn');

    const userInfoDiv = document.getElementById('user-info');

    const userEmailSpan = document.getElementById('user-email');

    const logoutBtn = document.getElementById('logout-btn');

    const authStatusMessage = document.getElementById('auth-status-message');



    const mailComposerSection = document.getElementById('mail-composer-section');

    const subjectInput = document.getElementById('subject');

    const csvFileInput = document.getElementById('csv-file');

    const recipientCountSpan = document.getElementById('recipient-count');

    const sendEmailsBtn = document.getElementById('send-emails-btn');



    const statusResultsSection = document.getElementById('status-results-section');

    const currentStatusMessage = document.getElementById('current-status-message');

    const progressDetails = document.getElementById('progress-details');

    const processedCountSpan = document.getElementById('processed-count');

    const totalCountSpan = document.getElementById('total-count');

    const sentCountSpan = document.getElementById('sent-count');

    const failedCountSpan = document.getElementById('failed-count');



    const customModal = document.getElementById('custom-modal');

    const modalTitle = customModal ? document.getElementById('modal-title') : null;

    const modalMessage = customModal ? document.getElementById('modal-message') : null;

    const modalCloseBtn = customModal ? document.getElementById('modal-close-btn') : null;



    let quill; // Quill editor instance

    let statusPollingInterval; // Interval for status polling



    // --- Modal Functions (Replaces native alerts) ---

    function showMessage(title, message) {

        if (customModal && modalTitle && modalMessage) {

            modalTitle.textContent = title;

            modalMessage.textContent = message;

            customModal.classList.remove('hidden');

            customModal.classList.add('flex');

        } else {

            alert(`${title}\n\n${message}`);

        }

    }



    if (modalCloseBtn) {

        modalCloseBtn.addEventListener('click', () => {

            customModal.classList.add('hidden');

            customModal.classList.remove('flex');

        });

    }



    // --- Quill editor initialization ---

    const emailEditorElement = document.getElementById('email-body-editor');

    if (emailEditorElement) {

        quill = new Quill('#email-body-editor', {

            theme: 'snow',

            placeholder: 'Compose your email here...',

            modules: {

                toolbar: [

                    [{ 'header': [1, 2, false] }],

                    ['bold', 'italic', 'underline', 'strike', 'blockquote'],

                    [{ 'list': 'ordered' }, { 'list': 'bullet' }, { 'indent': '-1' }, { 'indent': '+1' }],

                    ['link', 'image'],

                    [{ 'color': [] }, { 'background': [] }],

                    ['clean']

                ]

            }

        });

    }



    // --- Authentication Logic ---



    // Checks and updates the UI based on auth status

    async function checkAuthStatus() {

        try {

            const response = await fetch(`${API_BASE_URL}/api/auth/status`);

            const data = await response.json();



            if (data.isAuthenticated) {

                if (googleSigninBtn) googleSigninBtn.classList.add('hidden');

                if (userInfoDiv) userInfoDiv.classList.remove('hidden');

                if (userEmailSpan) userEmailSpan.textContent = data.userEmail;

                if (mailComposerSection) mailComposerSection.classList.remove('hidden');

                if (authStatusMessage) authStatusMessage.textContent = 'You are signed in.';

                // IMPORTANT: The session will now be kept alive by user interaction only.

                // The status polling will only run during an active campaign.

            } else {

                if (googleSigninBtn) googleSigninBtn.classList.remove('hidden');

                if (userInfoDiv) userInfoDiv.classList.add('hidden');

                if (mailComposerSection) mailComposerSection.classList.add('hidden');

                if (authStatusMessage) authStatusMessage.textContent = 'Please sign in with Google to continue.';

                resetUI();

            }

        } catch (error) {

            console.error('Error checking auth status:', error);

            if (authStatusMessage) authStatusMessage.textContent = 'Could not check authentication status.';

            resetUI();

        }

    }



    // Redirects to the backend's OAuth endpoint

    if (googleSigninBtn) {

        googleSigninBtn.addEventListener('click', () => {

            window.location.href = `${API_BASE_URL}/auth/google`;

        });

    }



    // Handles logout request

    if (logoutBtn) {

        logoutBtn.addEventListener('click', async () => {

            try {

                const response = await fetch(`${API_BASE_URL}/api/auth/logout`, { method: 'POST' });

                const data = await response.json();

                showMessage('Logout', data.message);

                await checkAuthStatus();

            } catch (error) {

                console.error('Error during logout:', error);

                showMessage('Logout Failed', 'An error occurred during logout. Please try again.');

            }

        });

    }



    // --- File Handling & Validation ---

    if (csvFileInput) {

        csvFileInput.addEventListener('change', (event) => {

            const file = event.target.files[0];

            if (file && recipientCountSpan) {

                recipientCountSpan.textContent = `File selected: ${file.name}`;

            } else if (recipientCountSpan) {

                recipientCountSpan.textContent = '';

            }

        });

    }



    // --- Email Sending Logic ---

    if (sendEmailsBtn) {

        sendEmailsBtn.addEventListener('click', async () => {

            const subject = subjectInput ? subjectInput.value.trim() : '';

            const emailBody = quill ? quill.root.innerHTML.trim() : '';

            const csvFile = csvFileInput && csvFileInput.files.length > 0 ? csvFileInput.files[0] : null;



            if (!subject) {

                return showMessage('Validation Error', 'Please enter a subject.');

            }

            if (!emailBody || emailBody === '<p><br></p>') {

                return showMessage('Validation Error', 'Please compose your email body.');

            }

            if (!csvFile) {

                return showMessage('Validation Error', 'Please upload a CSV file with recipients.');

            }



            sendEmailsBtn.disabled = true;

            sendEmailsBtn.textContent = 'Initiating Send...';

            if (statusResultsSection) statusResultsSection.classList.remove('hidden');

            if (currentStatusMessage) currentStatusMessage.textContent = 'Initiating bulk email send...';

            if (progressDetails) progressDetails.classList.add('hidden');



            const formData = new FormData();

            formData.append('subject', subject);

            formData.append('emailBody', emailBody);

            formData.append('csvFile', csvFile);



            try {

                const response = await fetch(`${API_BASE_URL}/api/send-emails`, {

                    method: 'POST',

                    body: formData,

                });

                const result = await response.json();



                if (response.ok) {

                    if (currentStatusMessage) currentStatusMessage.textContent = result.message;

                    if (progressDetails) progressDetails.classList.remove('hidden');

                    // Start polling only after a campaign has been successfully initiated

                    statusPollingInterval = setInterval(pollStatus, 2000);

                } else {

                    showMessage('Error', `Error: ${result.message}`);

                    resetSendingState();

                }

            } catch (error) {

                console.error('Error sending emails:', error);

                showMessage('Error', 'An error occurred while trying to send emails.');

                resetSendingState();

            }

        });

    }



    // Function to poll the backend for status updates

    async function pollStatus() {

        try {

            const response = await fetch(`${API_BASE_URL}/api/status`);

            const status = await response.json();



            if (currentStatusMessage) currentStatusMessage.textContent = status.message;

            if (processedCountSpan) processedCountSpan.textContent = status.sent + status.failed;

            if (totalCountSpan) totalCountSpan.textContent = status.total;

            if (sentCountSpan) sentCountSpan.textContent = status.sent;

            if (failedCountSpan) failedCountSpan.textContent = status.failed;



            if (!status.inProgress) {

                clearInterval(statusPollingInterval); // Stop polling when the campaign is complete

                resetSendingState();

                showMessage('Sending Complete', 'Bulk email sending has finished.');

            }

        } catch (error) {

            console.error('Error polling status:', error);

            clearInterval(statusPollingInterval); // Stop polling on error

            resetSendingState();

            showMessage('Error', 'Error getting sending status.');

        }

    }



    // Reset UI elements after sending or on error

    function resetSendingState() {

        if (sendEmailsBtn) {

            sendEmailsBtn.disabled = false;

            sendEmailsBtn.textContent = 'Send Bulk Mail';

        }

    }



    // Reset all input fields and UI state

    function resetUI() {

        if (subjectInput) subjectInput.value = '';

        if (quill) quill.setContents([{ insert: '\n' }]);

        if (csvFileInput) csvFileInput.value = '';

        if (recipientCountSpan) recipientCountSpan.textContent = '';

        if (statusResultsSection) statusResultsSection.classList.add('hidden');

        if (currentStatusMessage) currentStatusMessage.textContent = '';

        if (progressDetails) progressDetails.classList.add('hidden');

        if (processedCountSpan) processedCountSpan.textContent = '0';

        if (totalCountSpan) totalCountSpan.textContent = '0';

        if (sentCountSpan) sentCountSpan.textContent = '0';

        if (failedCountSpan) failedCountSpan.textContent = '0';

        clearInterval(statusPollingInterval);

        resetSendingState();

    }



    // Initial check on page load

    checkAuthStatus();

});
function updateClock() {
  const now = new Date();

  let hours = now.getHours().toString().padStart(2, '0');
  let minutes = now.getMinutes().toString().padStart(2, '0');
  let seconds = now.getSeconds().toString().padStart(2, '0');

  const timeString = `${hours}:${minutes}:${seconds}`;
  document.getElementById('clock').textContent = timeString;
}

// Update every second
setInterval(updateClock, 1000);

// Initial call
updateClock();
