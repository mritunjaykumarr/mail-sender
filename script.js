// public/script.js
document.addEventListener('DOMContentLoaded', async () => {
    // DOM Elements
    const authSection = document.getElementById('auth-section');
    const googleSigninBtn = document.getElementById('google-signin-btn');
    const userInfoDiv = document.getElementById('user-info');
    const userNameSpan = document.getElementById('user-name');
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

    let quill; // Quill editor instance
    let recipients = []; // Array to store parsed recipients
    let statusPollingInterval; // Interval for status polling

    // Initialize Quill editor
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

    // Check authentication status on page load
    async function checkAuthStatus() {
        try {
            const response = await fetch('/api/auth/status');
            const data = await response.json();

            if (data.isAuthenticated) {
                googleSigninBtn.classList.add('hidden');
                userInfoDiv.classList.remove('hidden');
                userNameSpan.textContent = data.userEmail || 'Authenticated User'; // Backend doesn't send name in this demo
                userEmailSpan.textContent = data.userEmail;
                mailComposerSection.classList.remove('hidden');
                authStatusMessage.textContent = 'You are signed in.';
            } else {
                googleSigninBtn.classList.remove('hidden');
                userInfoDiv.classList.add('hidden');
                mailComposerSection.classList.add('hidden');
                authStatusMessage.textContent = 'Please sign in with Google to continue.';
            }
        } catch (error) {
            console.error('Error checking auth status:', error);
            authStatusMessage.textContent = 'Could not check authentication status.';
        }
    }

    // Handle Google Sign-in button click
    googleSigninBtn.addEventListener('click', () => {
        // Redirect to backend's OAuth initiation endpoint
        window.location.href = '/auth/google';
    });

    // Handle Logout button click
    logoutBtn.addEventListener('click', async () => {
        try {
            const response = await fetch('/api/auth/logout', { method: 'POST' });
            const data = await response.json();
            alert(data.message); // Use a custom modal in production
            checkAuthStatus(); // Update UI after logout
            resetUI();
        } catch (error) {
            console.error('Error during logout:', error);
            alert('Logout failed.'); // Use a custom modal in production
        }
    });

    // --- CSV File Handling ---

    csvFileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const text = e.target.result;
                parseCSV(text);
            };
            reader.readAsText(file);
        } else {
            recipients = [];
            recipientCountSpan.textContent = '';
        }
    });

    function parseCSV(csvText) {
        recipients = []; // Clear previous recipients
        const lines = csvText.split('\n').filter(line => line.trim() !== '');
        lines.forEach(line => {
            // Simple parsing: assume each line is an email or the first comma-separated value
            const potentialEmail = line.split(',')[0].trim();
            if (validateEmail(potentialEmail)) {
                recipients.push(potentialEmail);
            }
        });
        recipientCountSpan.textContent = `${recipients.length} recipients loaded.`;
        if (recipients.length === 0) {
            alert('No valid email addresses found in the CSV file.'); // Use a custom modal
        }
    }

    // Basic email validation regex
    function validateEmail(email) {
        return String(email)
            .toLowerCase()
            .match(
                /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
            );
    }

    // --- Email Sending Logic ---

    sendEmailsBtn.addEventListener('click', async () => {
        const subject = subjectInput.value.trim();
        const emailBody = quill.root.innerHTML.trim(); // Get HTML content from Quill

        if (!subject) {
            alert('Please enter a subject.');
            return;
        }
        if (!emailBody || emailBody === '<p><br></p>') { // Check for empty Quill content
            alert('Please compose your email body.');
            return;
        }
        if (recipients.length === 0) {
            alert('Please upload a CSV file with recipients.');
            return;
        }

        // Disable button and show loading
        sendEmailsBtn.disabled = true;
        sendEmailsBtn.textContent = 'Initiating Send...';
        statusResultsSection.classList.remove('hidden');
        currentStatusMessage.textContent = 'Initiating bulk email send...';
        progressDetails.classList.add('hidden'); // Hide progress until backend confirms

        const formData = new FormData();
        formData.append('subject', subject);
        formData.append('emailBody', emailBody);
        formData.append('csvFile', csvFileInput.files[0]);

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
                statusPollingInterval = setInterval(pollStatus, 2000); // Poll every 2 seconds
            } else {
                alert(`Error: ${result.message}`);
                resetSendingState();
            }
        } catch (error) {
            console.error('Error sending emails:', error);
            alert('An error occurred while trying to send emails.');
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
                alert('Bulk email sending completed!'); // Use custom modal
            }
        } catch (error) {
            console.error('Error polling status:', error);
            clearInterval(statusPollingInterval); // Stop polling on error
            resetSendingState();
            alert('Error getting sending status.'); // Use custom modal
        }
    }

    // Reset UI elements after sending or on error
    function resetSendingState() {
        sendEmailsBtn.disabled = false;
        sendEmailsBtn.textContent = 'Send Bulk Mail';
        // Keep status results visible after completion, but hide progress details if not in progress
        if (!emailCampaignStatus.inProgress) { // Assuming emailCampaignStatus is accessible or re-fetched
            progressDetails.classList.add('hidden');
        }
    }

    function resetUI() {
        subjectInput.value = '';
        quill.setContents([{ insert: '\n' }]); // Clears Quill editor
        csvFileInput.value = ''; // Clear file input
        recipients = [];
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
