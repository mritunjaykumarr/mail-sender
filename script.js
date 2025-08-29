document.addEventListener('DOMContentLoaded', async () => {
    // IMPORTANT: Replace this with your Render deployment URL.
    const API_BASE_URL = 'https://mail-sender-hwq9.onrender.com';

    // --- DOM Elements ---
    const googleSigninBtn = document.getElementById('google-signin-btn');
    const userInfoDiv = document.getElementById('user-info');
    const userNameSpan = document.getElementById('user-name'); // Updated to include user name
    const userProfilePic = document.getElementById('user-profile-pic');
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
    
    // 🆕 New DOM elements for the loader and success animation
    const loaderContainer = document.getElementById('loader-container');
    const loaderPercentage = document.getElementById('loader-percentage');
    const successAnimation = document.getElementById('success-animation');

    const customModal = document.getElementById('custom-modal');
    const modalTitle = customModal ? document.getElementById('modal-title') : null;
    const modalMessage = customModal ? document.getElementById('modal-message') : null;
    const modalCloseBtn = customModal ? document.getElementById('modal-close-btn') : null;

    // 🆕 New DOM elements for theme toggle
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    const themeIcon = document.getElementById('theme-icon');

    let quill; // Quill editor instance
    let statusPollingInterval; // Interval for status polling

    // --- Theme Toggle Logic ---
    function applySavedTheme() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.body.dataset.theme = savedTheme;
        updateThemeIcon(savedTheme);
    }
    
    function updateThemeIcon(theme) {
        if (themeIcon) {
            themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
        }
    }
    
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            const currentTheme = document.body.dataset.theme;
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            document.body.dataset.theme = newTheme;
            localStorage.setItem('theme', newTheme);
            updateThemeIcon(newTheme);
        });
    }
    
    // Apply the saved theme on initial load
    applySavedTheme();

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
    async function checkAuthStatus() {
        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/status`);
            const data = await response.json();

            if (data.isAuthenticated) {
                if (googleSigninBtn) googleSigninBtn.classList.add('hidden');
                if (userInfoDiv) userInfoDiv.classList.remove('hidden');
                
                // Show the user's name
                if (userNameSpan) userNameSpan.textContent = data.userName || data.userEmail;
                
                // Display the user's profile picture if the URL exists
                if (userProfilePic && data.userPicture) {
                    userProfilePic.src = data.userPicture;
                    userProfilePic.classList.remove('hidden');
                } else if (userProfilePic) {
                    userProfilePic.classList.add('hidden');
                }
                
                if (mailComposerSection) mailComposerSection.classList.remove('hidden');
                if (authStatusMessage) authStatusMessage.textContent = 'You are signed in.';
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

    if (googleSigninBtn) {
        googleSigninBtn.addEventListener('click', () => {
            window.location.href = `${API_BASE_URL}/auth/google`;
        });
    }

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
            
            // 🆕 Show the loader and hide other status elements
            if (loaderContainer) loaderContainer.classList.remove('hidden');
            if (progressDetails) progressDetails.classList.add('hidden');
            if (successAnimation) successAnimation.classList.add('hidden');
            if (currentStatusMessage) currentStatusMessage.textContent = 'Initiating bulk email send...';

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

            // 🆕 Calculate and display the percentage
            const processedCount = status.sent + status.failed;
            const totalCount = status.total;
            const percentage = totalCount > 0 ? Math.floor((processedCount / totalCount) * 100) : 0;
            if (loaderPercentage) loaderPercentage.textContent = `${percentage}%`;

            if (currentStatusMessage) currentStatusMessage.textContent = status.message;
            if (processedCountSpan) processedCountSpan.textContent = processedCount;
            if (totalCountSpan) totalCountSpan.textContent = totalCount;
            if (sentCountSpan) sentCountSpan.textContent = status.sent;
            if (failedCountSpan) failedCountSpan.textContent = status.failed;

            if (!status.inProgress) {
                clearInterval(statusPollingInterval); // Stop polling when the campaign is complete
                resetSendingState();
                
                // 🆕 Hide the loader and show the success animation
                if (loaderContainer) loaderContainer.classList.add('hidden');
                if (successAnimation) successAnimation.classList.remove('hidden');

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
        
        // 🆕 Ensure new UI elements are hidden on a full reset
        if (loaderContainer) loaderContainer.classList.add('hidden');
        if (successAnimation) successAnimation.classList.add('hidden');
    }

    // Initial check on page load
    checkAuthStatus();
});

// Your clock functions remain unchanged
function updateClocks() {
    const now = new Date();
    // Digital clock
    let hours = now.getHours();
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    const digitalTime = `${hours.toString().padStart(2, '0')}:${minutes}:${seconds} ${ampm}`;
    document.getElementById('digital-clock').textContent = digitalTime;
    // Analog clock
    const secDeg = now.getSeconds() * 6;
    const minDeg = now.getMinutes() * 6 + now.getSeconds() * 0.1;
    const hourDeg = ((now.getHours() % 12) * 30) + (now.getMinutes() * 0.5);
    document.getElementById('second-hand').style.transform = `translateX(-50%) rotate(${secDeg}deg)`;
    document.getElementById('minute-hand').style.transform = `translateX(-50%) rotate(${minDeg}deg)`;
    document.getElementById('hour-hand').style.transform = `translateX(-50%) rotate(${hourDeg}deg)`;
}

setInterval(updateClocks, 1000);
updateClocks();
