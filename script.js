// public/script.js
document.addEventListener('DOMContentLoaded', async () => {
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

    // Custom modal elements (assumes this HTML exists in your index.html)
    const customModal = document.getElementById('custom-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalMessage = document.getElementById('modal-message');
    const modalCloseBtn = document.getElementById('modal-close-btn');

    let quill; // Quill editor instance
    let statusPollingInterval; // Interval for status polling

    // --- Modal Functions (Replaces native alerts) ---
    function showModal(title, message) {
        modalTitle.textContent = title;
        modalMessage.textContent = message;
        customModal.classList.remove('hidden');
        customModal.classList.add('flex');
    }

    modalCloseBtn.addEventListener('click', () => {
        customModal.classList.add('hidden');
        customModal.classList.remove('flex');
    });

    // --- Quill editor initialization ---
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

    // --- Authentication Logic ---

    // Checks and updates the UI based on auth status
    async function checkAuthStatus() {
        try {
            const response = await fetch('/api/auth/status');
            const data = await response.json();

            if (data.isAuthenticated) {
                googleSigninBtn.classList.add('hidden');
                userInfoDiv.classList.remove('hidden');
                userEmailSpan.textContent = data.userEmail;
                mailComposerSection.classList.remove('hidden');
                authStatusMessage.textContent = 'You are signed in.';
            } else {
                googleSigninBtn.classList.remove('hidden');
                userInfoDiv.classList.add('hidden');
                mailComposerSection.classList.add('hidden');
                authStatusMessage.textContent = 'Please sign in with Google to continue.';
                // Reset all UI to default if not authenticated
                resetUI();
            }
        } catch (error) {
            console.error('Error checking auth status:', error);
            authStatusMessage.textContent = 'Could not check authentication status.';
            resetUI();
        }
    }

    // Redirects to the backend's OAuth endpoint
    googleSigninBtn.addEventListener('click', () => {
        window.location.href = '/auth/google';
    });

    // Handles logout request
    logoutBtn.addEventListener('click', async () => {
        try {
            const response = await fetch('/api/auth/logout', { method: 'POST' });
            const data = await response.json();
            showModal('Logout', data.message);
            await checkAuthStatus(); // Update UI after logout
        } catch (error) {
            console.error('Error during logout:', error);
            showModal('Logout Failed', 'An error occurred during logout. Please try again.');
        }
    });

    // --- File Handling & Validation ---
    // This now only updates the UI to show the selected filename
    csvFileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            recipientCountSpan.textContent = `File selected: ${file.name}`;
        } else {
            recipientCountSpan.textContent = '';
        }
    });

    // --- Email Sending Logic ---
    sendEmailsBtn.addEventListener('click', async () => {
        const subject = subjectInput.value.trim();
        const emailBody = quill.root.innerHTML.trim();
        const csvFile = csvFileInput.files[0];

        if (!subject) {
            return showModal('Validation Error', 'Please enter a subject.');
        }
        if (!emailBody || emailBody === '<p><br></p>') {
            return showModal('Validation Error', 'Please compose your email body.');
        }
        // The server will handle validation of the CSV content. We only check if a file is attached.
        if (!csvFile) {
            return showModal('Validation Error', 'Please upload a CSV file with recipients.');
        }

        // Disable button and show loading
        sendEmailsBtn.disabled = true;
        sendEmailsBtn.textContent = 'Initiating Send...';
        statusResultsSection.classList.remove('hidden');
        currentStatusMessage.textContent = 'Initiating bulk email send...';
        progressDetails.classList.add('hidden');

        const formData = new FormData();
        formData.append('subject', subject);
        formData.append('emailBody', emailBody);
        formData.append('csvFile', csvFile);

        try {
            const response = await fetch('/api/send-emails', {
                method: 'POST',
                body: formData,
            });
            const result = await response.json();

            if (response.ok) {
                currentStatusMessage.textContent = result.message;
                progressDetails.classList.remove('hidden');
                // Start polling for status updates
                statusPollingInterval = setInterval(pollStatus, 2000);
            } else {
                showModal('Error', `Error: ${result.message}`);
                resetSendingState();
            }
        } catch (error) {
            console.error('Error sending emails:', error);
            showModal('Error', 'An error occurred while trying to send emails.');
            resetSendingState();
        }
    });

    // Function to poll the backend for status updates
    async function pollStatus() {
        try {
            const response = await fetch('/api/status');
            const status = await response.json();

            currentStatusMessage.textContent = status.message;
            processedCountSpan.textContent = status.sent + status.failed;
            totalCountSpan.textContent = status.total;
            sentCountSpan.textContent = status.sent;
            failedCountSpan.textContent = status.failed;

            if (!status.inProgress) {
                clearInterval(statusPollingInterval); // Stop polling
                resetSendingState();
                showModal('Sending Complete', 'Bulk email sending has finished.');
            }
        } catch (error) {
            console.error('Error polling status:', error);
            clearInterval(statusPollingInterval); // Stop polling on error
            resetSendingState();
            showModal('Error', 'Error getting sending status.');
        }
    }

    // Reset UI elements after sending or on error
    function resetSendingState() {
        sendEmailsBtn.disabled = false;
        sendEmailsBtn.textContent = 'Send Bulk Mail';
    }

    // Reset all input fields and UI state
    function resetUI() {
        subjectInput.value = '';
        quill.setContents([{ insert: '\n' }]); // Clears Quill editor
        csvFileInput.value = ''; // Clear file input
        recipientCountSpan.textContent = '';
        statusResultsSection.classList.add('hidden');
        currentStatusMessage.textContent = '';
        progressDetails.classList.add('hidden');
        processedCountSpan.textContent = '0';
        totalCountSpan.textContent = '0';
        sentCountSpan.textContent = '0';
        failedCountSpan.textContent = '0';
        clearInterval(statusPollingInterval);
        resetSendingState();
    }

    // Initial check on page load
    checkAuthStatus();
});
