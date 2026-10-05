/* ==========================================================================
   Phase 2: Supabase Authentication Logic
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
    // 1. Grab DOM elements for Login
    const loginForm = document.getElementById("login-form");
    const loginEmail = document.getElementById("login-email");
    const loginPassword = document.getElementById("login-password");
    const loginBtn = document.getElementById("login-btn");
    const loginMessage = document.getElementById("login-message");

    // 2. Grab DOM elements for Sign Up
    const signupForm = document.getElementById("signup-form");
    const signupUsername = document.getElementById("signup-username");
    const signupEmail = document.getElementById("signup-email");
    const signupPassword = document.getElementById("signup-password");
    const signupBtn = document.getElementById("signup-btn");
    const signupMessage = document.getElementById("signup-message");

    // UI feedback helper
    function showMessage(targetEl, message, isError = false) {
        if (!targetEl) return;
        targetEl.textContent = message;
        targetEl.style.color = isError ? "#ff4c4c" : "#4caf50";
        targetEl.style.marginTop = "12px";
        targetEl.style.fontSize = "0.9rem";
    }

    // 3. Handle Login Submit
    if (loginForm) {
        loginForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            loginBtn.disabled = true;
            showMessage(loginMessage, "Logging in...", false);

            const { data, error } = await window.supabaseClient.auth.signInWithPassword({
                email: loginEmail.value.trim(),
                password: loginPassword.value
            });

            if (error) {
                showMessage(loginMessage, error.message, true);
                loginBtn.disabled = false;
            } else {
                showMessage(loginMessage, "Login successful! Redirecting...", false);
                setTimeout(() => window.location.href = "index.html", 1000);
            }
        });
    }

    // 4. Handle Sign Up Submit
    if (signupForm) {
        signupForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            signupBtn.disabled = true;
            showMessage(signupMessage, "Creating account...", false);

            const { data, error } = await window.supabaseClient.auth.signUp({
                email: signupEmail.value.trim(),
                password: signupPassword.value,
                options: {
                    data: {
                        // Metadata passed to trigger for populating public.profiles
                        username: signupUsername ? signupUsername.value.trim() : ""
                    }
                }
            });

            if (error) {
                showMessage(signupMessage, error.message, true);
                signupBtn.disabled = false;
            } else {
                showMessage(signupMessage, "Account created! You can now log in.", false);
                signupBtn.disabled = false;
            }
        });
    }
    // 5. UI Toggle Logic (Switch between Login and Sign Up)
    const showSignupLink = document.getElementById("show-signup");
    const showLoginLink = document.getElementById("show-login");

    if (showSignupLink && showLoginLink) {
        showSignupLink.addEventListener("click", (e) => {
            e.preventDefault(); // Prevent page jump
            loginForm.classList.add("hidden");
            signupForm.classList.remove("hidden");
        });

        showLoginLink.addEventListener("click", (e) => {
            e.preventDefault(); // Prevent page jump
            signupForm.classList.add("hidden");
            loginForm.classList.remove("hidden");
        });
    }
});