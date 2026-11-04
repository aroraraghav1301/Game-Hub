/* Raghav's Game Hub - login / sign-up page logic (conservative ES5 + Promises).
   Supabase URL, key and auth calls are identical to the original index.html. */
(function () {
"use strict";
function $(id) { return document.getElementById(id); }
function isLocalHost() {
    var h = location.hostname, p = location.protocol;
    return p === "file:" || h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
}
/* /games on the deployed site (Vercel rewrite); games.html when opened locally. */
function gamesUrl() { return isLocalHost() ? "games.html" : "/games"; }

var message = $("message"), mode = "signup";
function say(text, kind) { message.className = "form-message" + (kind ? " " + kind : ""); message.textContent = text; }

if (!window.Promise || !window.supabase || !window.supabase.createClient) {
    say("Game Hub could not load its sign-in library (Supabase). Your browser may be too old, or the script is blocked. Try the latest Chrome or Firefox, disable content blockers, and refresh.", "err");
    $("submitBtn").disabled = true;
    return;
}
var db = window.supabase.createClient(
    "https://wpdqxooopwivbzazonca.supabase.co",
    "sb_publishable_9wI9m5g9qLnjMtJzPGM5pA_KeJ36NWD"
);

function setMode(next) {
    mode = next; var signup = mode === "signup";
    $("nameWrap").hidden = !signup;
    $("displayName").required = signup;
    $("password").setAttribute("autocomplete", signup ? "new-password" : "current-password");
    $("formTitle").textContent = signup ? "Join the fun 🚀" : "Welcome back 🎮";
    $("subtitle").textContent = signup ? "Create your player account and get your own Player ID." : "Welcome back. Log in to continue your Game Hub journey.";
    $("submitBtn").textContent = signup ? "Create account 🚀" : "Log in 🎮";
    $("tabSignup").setAttribute("aria-selected", String(signup));
    $("tabLogin").setAttribute("aria-selected", String(!signup));
    say("");
}
$("tabSignup").addEventListener("click", function () { setMode("signup"); });
$("tabLogin").addEventListener("click", function () { setMode("login"); });
$("showPass").addEventListener("change", function () { $("password").type = this.checked ? "text" : "password"; });

// Validate the session with Supabase instead of trusting a stale cached one.
// This prevents index <-> games redirect loops.
db.auth.getUser().then(function (res) {
    if (!res.error && res.data && res.data.user) location.replace(gamesUrl());
    else if (res.error && !/session missing/i.test(res.error.message || "")) console.warn("Could not validate existing session:", res.error.message);
}, function (e) { console.error("Could not check existing Supabase session:", e); });

$("accountForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = $("submitBtn");
    var email = $("email").value.trim(), password = $("password").value;
    if (!email || !password) { say("Please enter your email and password.", "err"); return; }
    if (password.length < 8 && mode === "signup") { say("Password must be at least 8 characters.", "err"); return; }
    btn.disabled = true; say(mode === "signup" ? "Creating your account…" : "Signing in…");
    var work;
    if (mode === "signup") {
        var display_name = $("displayName").value.trim();
        if (display_name.length < 2) { btn.disabled = false; say("Player name must be at least 2 characters.", "err"); return; }
        work = db.auth.signUp({ email: email, password: password, options: { data: { display_name: display_name } } }).then(function (r) {
            if (r.error) throw r.error;
            if (r.data.session) { say("Account created! Opening your hub…", "ok"); location.replace(gamesUrl()); }
            else say("Account created. Check your email for the verification link, then log in here.", "ok");
        });
    } else {
        work = db.auth.signInWithPassword({ email: email, password: password }).then(function (r) {
            if (r.error) throw r.error;
            location.replace(gamesUrl());
        });
    }
    work.then(null, function (err) {
        console.error(err); say((err && err.message) || "Something went wrong. Please try again.", "err");
    }).then(function () { btn.disabled = false; });
});
})();
