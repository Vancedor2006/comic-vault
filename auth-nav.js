/* ==========================================================================
   Global Header Navigation & Session Persistence
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
    // Target the placeholder in your HTML header
    const navContainer = document.getElementById("nav-user-container");
    if (!navContainer) return; // Exit if the current page doesn't have a header

    // Renders the default Log In / Sign Up buttons
    function renderLoggedOut() {
        navContainer.innerHTML = `
            <a href="login.html" class="btn btn-outline" style="margin-right: 10px;">Log In</a>
            <a href="login.html" class="btn btn-primary">Sign Up</a>
        `;
    }

    // Renders the User Menu and Logout button
    async function renderLoggedIn(user) {
        // Fetch the username from the profiles table using the authenticated user's ID
        const { data: profile, error } = await window.supabaseClient
            .from('profiles')
            .select('username')
            .eq('id', user.id)
            .single();

        // Fallback to "Creator" if the username hasn't loaded properly
        const username = profile?.username || "Creator";

        navContainer.innerHTML = `
            <span style="margin-right: 15px;">Welcome, <strong>${username}</strong></span>
            <button id="logout-btn" class="btn btn-outline">Log Out</button>
        `;

        // Attach the event listener to the newly injected logout button
        document.getElementById("logout-btn").addEventListener("click", async () => {
            await window.supabaseClient.auth.signOut();
            window.location.href = "index.html"; // Redirect to homepage on logout
        });
    }

    // 1. Check the initial session state when the page loads
    window.supabaseClient.auth.getSession().then(({ data: { session } }) => {
        if (session) {
            renderLoggedIn(session.user);
        } else {
            renderLoggedOut();
        }
    });

    // 2. Listen for real-time auth changes across tabs/pages
    window.supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session) {
            renderLoggedIn(session.user);
        } else if (event === 'SIGNED_OUT') {
            renderLoggedOut();
        }
    });
});