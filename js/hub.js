/* Raghav's Game Hub - games page logic.
   Written in conservative ES5 + Promises (no optional chaining, no ??, no
   template literals, no async/await, no modules) so it parses on old
   Chromium/Firefox. All Supabase tables, views, RPCs and columns are exactly
   the ones the original games.html used. */
(function () {
"use strict";

var SUPABASE_URL = "https://wpdqxooopwivbzazonca.supabase.co";
var SUPABASE_KEY = "sb_publishable_9wI9m5g9qLnjMtJzPGM5pA_KeJ36NWD";
var OWNER_ID = "548419b4-f0c2-427d-9e4c-9b729e566f3b";

/* ---------- Small helpers ---------- */
function $(id) { return document.getElementById(id); }
function each(list, fn) { Array.prototype.forEach.call(list, fn); }
function clear(node) { if (!node) return; while (node.firstChild) node.removeChild(node.firstChild); }
function isLocalHost() {
    var h = location.hostname, p = location.protocol;
    return p === "file:" || h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
}
/* Clean URLs on the deployed site (/games, /); real file names when opened locally. */
function loginUrl() { return isLocalHost() ? "index.html" : "/"; }
function escapeHTML(value) {
    var s = (value === null || value === undefined) ? "" : String(value);
    return s.replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
}
function safeURL(value) {
    var v = (value === null || value === undefined) ? "" : String(value).trim();
    if (!/^https?:\/\//i.test(v)) return "";
    try { return new URL(v).href; } catch (e) { return /^https?:\/\/[^\s]+$/i.test(v) ? v : ""; }
}
function store(kind, key, value) {
    try {
        var s = kind === "session" ? window.sessionStorage : window.localStorage;
        if (value === undefined) return s.getItem(key);
        if (value === null) s.removeItem(key); else s.setItem(key, value);
    } catch (e) { /* storage blocked: carry on without it */ }
    return null;
}
function newKey() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    var d = new Date().getTime();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
        var r = (d + Math.random() * 16) % 16 | 0; d = Math.floor(d / 16);
        return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
    });
}
var visitorKey = (function () {
    var key = store("local", "gamehub_visitor_key");
    if (!key) { key = newKey(); store("local", "gamehub_visitor_key", key); }
    return key;
})();
function reducedMotion() {
    try { return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; }
}
function smoothTop(node) {
    var y = node.getBoundingClientRect().top + (window.pageYOffset || document.documentElement.scrollTop) - 84;
    if (y < 0) y = 0;
    if ("scrollBehavior" in document.documentElement.style && !reducedMotion()) window.scrollTo({ top: y, behavior: "smooth" });
    else window.scrollTo(0, y);
}
function showNotice(text) {
    var n = $("pageNotice");
    if (!n) return;
    n.textContent = text; n.hidden = !text;
}

/* ---------- Supabase client (unchanged initialisation) ---------- */
var db = null;
if (window.supabase && window.supabase.createClient) {
    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}

var games = [];
var editingGameId = null;
var currentGame = null;
var isOwner = false;
var activeTag = "";
var playerUser = null, playerProfile = null, playerWallet = null, playerStreak = null;
var playerModalMode = "profile";

/* ---------- Modals (focus management + Escape) ---------- */
var modalStack = [];
var lastFocus = {};
function openModal(id) {
    var m = $(id); if (!m) return;
    lastFocus[id] = document.activeElement;
    m.style.display = "flex"; m.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    if (modalStack.indexOf(id) === -1) modalStack.push(id);
    var target = m.querySelector("input:not([type=hidden]), .modal-close");
    if (id === "playerModal") target = m.querySelector(".modal-close");
    if (target && target.focus) { try { target.focus(); } catch (e) {} }
}
function closeModal(id) {
    var m = $(id); if (!m) return;
    m.style.display = "none"; m.setAttribute("aria-hidden", "true");
    var i = modalStack.indexOf(id); if (i > -1) modalStack.splice(i, 1);
    if (!modalStack.length) document.body.classList.remove("modal-open");
    var back = lastFocus[id];
    if (back && back.focus) { try { back.focus(); } catch (e) {} }
}

/* ---------- Rewards UI ---------- */
function getRewards() {
    return { points: Number((playerWallet && playerWallet.balance) || 0), streak: Number((playerStreak && playerStreak.current_streak) || 0) };
}
function updateRewardUI() {
    var r = getRewards();
    $("pointsCount").textContent = r.points;
    $("coinChipValue").textContent = r.points;
    $("streakCount").textContent = r.streak + " days";
    $("rewardLevel").textContent = "⭐ Level " + ((playerProfile && playerProfile.level) || 1);
    $("rewardDetails").textContent = r.points + " coins • " + r.streak + "-day streak";
    $("nextReward").textContent = "Claim your daily reward from My Profile → Rewards & Streak.";
}

/* ---------- Auth / player data ---------- */
function isMissingSession(err) {
    if (!err) return false;
    var msg = String(err.message || "");
    return err.name === "AuthSessionMissingError" || /auth session missing/i.test(msg) ||
        err.status === 401 || err.status === 403 || /user from sub claim|invalid jwt|jwt expired/i.test(msg);
}
/* Resolves to "ok", "redirect" (not signed in) or "error". */
function loadPlayerData() {
    return db.auth.getUser().then(function (authResult) {
        var user = authResult && authResult.data ? authResult.data.user : null;
        var authError = authResult ? authResult.error : null;
        if (authError && isMissingSession(authError)) { location.replace(loginUrl()); return "redirect"; }
        if (authError) {
            // Network/auth-server failure: don't redirect (avoids login <-> hub loops).
            console.error("Supabase auth error:", authError);
            var t = "Could not verify your login with Supabase: " + (authError.message || "Unknown authentication error") + ". Check your connection, then refresh.";
            $("playerMessage").textContent = t; showNotice(t);
            return "error";
        }
        if (!user) { location.replace(loginUrl()); return "redirect"; }
        playerUser = user;
        return Promise.all([
            db.from("player_profiles").select("*").eq("user_id", user.id).maybeSingle(),
            db.from("player_wallets").select("*").eq("user_id", user.id).maybeSingle(),
            db.from("player_streaks").select("*").eq("user_id", user.id).maybeSingle()
        ]).then(function (results) {
            var p = results[0], w = results[1], s = results[2];
            var dbError = p.error || w.error || s.error;
            var msg;
            if (dbError) {
                console.error("Player setup database error:", dbError);
                msg = "Supabase database error: " + (dbError.message || dbError.details || "Check table permissions and run the SQL setup.");
                $("playerMessage").textContent = msg; showNotice(msg);
                return "error";
            }
            playerProfile = p.data; playerWallet = w.data; playerStreak = s.data;
            if (!playerProfile || !playerWallet || !playerStreak) {
                var missing = [];
                if (!playerProfile) missing.push("player profile");
                if (!playerWallet) missing.push("wallet");
                if (!playerStreak) missing.push("streak record");
                msg = "Your account is missing: " + missing.join(", ") + ". Run the supplied repair SQL in Supabase, then refresh.";
                $("playerMessage").textContent = msg; showNotice(msg);
                return "error";
            }
            showNotice("");
            $("profileName").textContent = playerProfile.display_name || "My Profile";
            updateRewardUI();
            return "ok";
        }, function (e) {
            console.error("Player database request failed:", e);
            var m2 = "Could not load player data: " + (e && e.message ? e.message : e);
            $("playerMessage").textContent = m2; showNotice(m2);
            return "error";
        });
    }, function (e) {
        console.error("Supabase authentication request failed:", e);
        var m3 = "Could not contact Supabase: " + (e && e.message ? e.message : e) + ". Check your internet connection and Supabase URL.";
        $("playerMessage").textContent = m3; showNotice(m3);
        return "error";
    });
}
function claimDailyReward() {
    return db.rpc("claim_daily_reward").then(function (res) {
        if (res.error) throw res.error;
        return loadPlayerData().then(function () { return res.data; });
    });
}
function playerSignOut() {
    var done = function () { location.replace(loginUrl()); };
    try {
        // Local scope clears this browser's session without needing the network.
        db.auth.signOut({ scope: "local" }).then(function (r) {
            if (r && r.error) console.error("Supabase sign-out warning:", r.error);
            done();
        }, function (e) { console.error("Supabase sign-out failed:", e); done(); });
    } catch (e) { console.error("Supabase sign-out failed:", e); done(); }
}

/* Daily login streak: claim automatically once per day when the hub opens.
   Uses the same claim_daily_reward() RPC as the button; the database decides
   whether today's reward was already taken, so this cannot double-pay. */
function localDay() {
    var d = new Date();
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}
function autoClaimDaily() {
    if (!playerUser) return;
    var flag = "gamehub_autoclaim_" + playerUser.id;
    if (store("local", flag) === localDay()) return;
    db.rpc("claim_daily_reward").then(function (res) {
        if (res.error) { console.warn("Daily reward:", res.error.message); return; }
        store("local", flag, localDay());
        if (res.data && res.data.claimed) {
            var toast = $("rewardToast");
            if (toast) {
                toast.textContent = "🎁 Daily reward claimed: +" + res.data.coins + " coins! Streak: " + res.data.streak + " day" + (res.data.streak === 1 ? "" : "s") + " 🔥";
                toast.hidden = false;
            }
            return loadPlayerData();
        }
    }, function (e) { console.warn("Daily reward unavailable:", e); });
}

/* ---------- Player modal ---------- */
function openPlayerModal(mode) {
    playerModalMode = mode;
    closeProfileMenu();
    openModal("playerModal");
    renderPlayerModal();
}
function closePlayerModal() { closeModal("playerModal"); }

function renderPlayerModal() {
    var content = $("playerModalContent"), message = $("playerMessage");
    message.textContent = ""; content.innerHTML = '<p class="muted">Loading…</p>';
    return loadPlayerData().then(function (state) {
        if (state !== "ok") {
            content.innerHTML = '<p class="muted">' + escapeHTML(message.textContent || "Player data could not be loaded. Check the browser console for details.") + "</p>";
            return;
        }
        var p = playerProfile, w = playerWallet, s = playerStreak;
        var title = $("playerModalTitle");
        return db.from("player_badges_public").select("badge_name,emoji").eq("user_id", playerUser.id).then(function (badges) {
            var list = (badges && badges.data) || [];
            var badgeHTML = list.map(function (b) {
                return '<span class="badge-chip">' + escapeHTML(b.emoji) + " " + escapeHTML(b.badge_name) + "</span>";
            }).join("") || '<span class="muted">No badges earned yet.</span>';
            var initial = escapeHTML(String(p.display_name || "?").charAt(0).toUpperCase());

            if (playerModalMode === "profile") {
                title.textContent = "👤 Player Profile";
                content.innerHTML =
                    '<div class="player-hero"><div class="avatar" aria-hidden="true">' + initial + '</div><div><h3>' + escapeHTML(p.display_name) +
                    '</h3><p class="muted">Player ID: <strong>' + escapeHTML(p.player_id) + '</strong></p></div></div>' +
                    '<div class="player-grid"><div class="player-stat">💰 Coins<strong>' + w.balance + '</strong></div>' +
                    '<div class="player-stat">🔥 Streak<strong>' + s.current_streak + ' days</strong></div>' +
                    '<div class="player-stat">⭐ Level<strong>' + p.level + '</strong></div>' +
                    '<div class="player-stat">✨ XP<strong>' + p.xp + '</strong></div></div>' +
                    '<h3 class="sub-title">🏅 Badges</h3>' + badgeHTML +
                    '<div class="btn-row" style="margin-top:14px"><button type="button" class="btn btn-navy btn-sm" data-player="settings">Edit profile / Player ID</button></div>';
            } else if (playerModalMode === "rewards") {
                title.textContent = "💰 Rewards & Streak";
                content.innerHTML =
                    '<div class="player-grid"><div class="player-stat">Wallet<strong>' + w.balance + ' coins</strong></div>' +
                    '<div class="player-stat">Current streak<strong>' + s.current_streak + ' days</strong></div>' +
                    '<div class="player-stat">Best streak<strong>' + s.longest_streak + ' days</strong></div>' +
                    '<div class="player-stat">Next ID unlock<strong>' + Math.max(0, 5 - s.current_streak) + ' days</strong></div></div>' +
                    '<p class="muted">Daily login reward: 10 coins. A 5-day streak unlocks your first custom Player ID at no cost. Future changes cost 500 coins and are subject to the cooldown.</p>' +
                    '<div class="btn-row" style="margin-top:12px"><button type="button" class="btn btn-play" data-act="claim">🎁 Claim daily reward</button></div>' +
                    '<h3 class="sub-title">Recent coin activity</h3><ul class="player-list" id="coinHistory"><li>Loading transactions…</li></ul>';
                loadCoinHistory();
            } else if (playerModalMode === "settings") {
                title.textContent = "⚙️ Account Settings";
                content.innerHTML =
                    '<div class="field"><label for="editDisplayName">Display name</label><input id="editDisplayName" maxlength="30" value="' + escapeHTML(p.display_name) + '"></div>' +
                    '<div class="field"><label for="customPlayerId">Choose custom Player ID</label><input id="customPlayerId" maxlength="18" placeholder="3–18 letters, numbers or underscores"></div>' +
                    '<p class="muted" id="idNote">Your generated ID: ' + escapeHTML(p.player_id) + '. First custom ID is free after a 5-day streak; later changes cost 500 coins.</p>' +
                    '<div class="btn-row" style="margin-top:12px"><button type="button" class="btn btn-navy" data-act="save-name">Save display name</button>' +
                    '<button type="button" class="btn btn-cyan" id="setIdBtn" data-act="set-id">Set custom ID</button></div>';
            } else if (playerModalMode === "friends") {
                title.textContent = "👥 Friends";
                content.innerHTML =
                    '<p class="muted" style="margin-bottom:14px">Connect with other players using their unique Player ID.</p>' +
                    '<div class="id-card"><div><small>Your Player ID · Share this with friends</small><strong>' + escapeHTML(p.player_id) + '</strong></div>' +
                    '<button type="button" class="btn btn-yellow btn-sm" data-act="copy-id">Copy ID</button></div>' +
                    '<div class="panel-soft"><label class="label" for="friendLookupId">Find a player</label><div class="inline-form">' +
                    '<input id="friendLookupId" class="input" maxlength="24" placeholder="Enter your friend\'s Player ID">' +
                    '<button type="button" class="btn btn-play btn-sm" data-act="send-request">Send request</button></div></div>' +
                    '<div class="two-col"><section><h3 class="sub-title">📨 Friend requests</h3><ul class="player-list" id="friendRequests"><li>Loading requests…</li></ul></section>' +
                    '<section><h3 class="sub-title">👥 Your friends</h3><ul class="player-list" id="friendsList"><li>Loading friends…</li></ul></section></div>';
                loadFriends();
            } else if (playerModalMode === "leaderboard") {
                title.textContent = "🏆 Leaderboards";
                content.innerHTML =
                    '<h3 class="sub-title">💰 Top coin collectors</h3><ul class="player-list" id="coinLeaders"><li>Loading…</li></ul>' +
                    '<h3 class="sub-title">🔥 Longest streaks</h3><ul class="player-list" id="streakLeaders"><li>Loading…</li></ul>';
                loadLeaderboards();
            } else if (playerModalMode === "achievements") {
                title.textContent = "🏅 Achievements";
                content.innerHTML = '<p class="muted" style="margin-bottom:12px">Badges are earned through verified account activity.</p>' + badgeHTML +
                    '<p class="muted" style="margin-top:10px">More achievements will unlock as you use Game Hub.</p>';
            }
        });
    });
}

function loadCoinHistory() {
    var ul = $("coinHistory"); if (!ul) return;
    db.from("player_coin_transactions").select("amount,reason,created_at").order("created_at", { ascending: false }).limit(8).then(function (r) {
        ul = $("coinHistory"); if (!ul) return;
        if (r.error) { ul.innerHTML = "<li>Could not load history.</li>"; return; }
        ul.innerHTML = (r.data || []).map(function (x) {
            return "<li><span>" + escapeHTML(x.reason) + "</span><strong>" + (x.amount > 0 ? "+" : "") + x.amount + "</strong></li>";
        }).join("") || "<li>No transactions yet.</li>";
    });
}
function claimDailyFromUI() {
    var m = $("playerMessage");
    claimDailyReward().then(function (result) {
        m.textContent = (result && result.message) || "Daily reward processed.";
        renderPlayerModal();
    }, function (e) { m.textContent = (e && e.message) || "Could not claim today's reward."; });
}
function savePlayerSettings() {
    var name = $("editDisplayName").value.trim(), msg = $("playerMessage");
    if (name.length < 2) { msg.textContent = "Display name must be at least 2 characters."; return; }
    db.from("player_profiles").update({ display_name: name }).eq("user_id", playerUser.id).then(function (r) {
        var text = r.error ? r.error.message : "Display name updated.";
        return loadPlayerData().then(function () { return renderPlayerModal(); }).then(function () { $("playerMessage").textContent = text; });
    });
}
function changeCustomPlayerId() {
    var input = $("customPlayerId"), button = $("setIdBtn"), message = $("playerMessage");
    var id = input ? input.value.trim() : "";
    if (!id) { message.textContent = "Enter a custom Player ID first."; if (input) input.focus(); return; }
    if (button) { button.disabled = true; button.textContent = "Saving…"; }
    message.textContent = "Saving your custom Player ID…";
    var reset = function () { if (button) { button.disabled = false; button.textContent = "Set custom ID"; } };
    db.rpc("set_custom_player_id", { requested_id: id }).then(function (res) {
        if (res.error) throw res.error;
        var data = res.data;
        return loadPlayerData().then(function () {
            var savedId = (data && data.player_id) || id;
            var note = $("idNote");
            if (note) note.innerHTML = "Your Player ID is now: <strong>" + escapeHTML(savedId) + "</strong>. Your generated ID was " + escapeHTML((playerProfile && playerProfile.player_id) || "") + ".";
            if (input) input.value = "";
            message.textContent = (data && data.message) || "Custom Player ID updated successfully.";
        });
    }).then(reset, function (error) {
        message.textContent = (error && error.message) || "Could not update your Player ID. Please try again.";
        reset();
    });
}
function copyPlayerId() {
    var id = playerProfile && playerProfile.player_id, msg = $("playerMessage");
    if (!id) return;
    var ok = function () { msg.textContent = "Player ID copied! Share it with your friends."; };
    var fail = function () { msg.textContent = "Copy was unavailable. Select and copy your Player ID manually."; };
    var legacy = function () {
        try {
            var t = document.createElement("textarea");
            t.value = id; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.top = "0"; t.style.opacity = "0";
            document.body.appendChild(t); t.select();
            var done = document.execCommand("copy");
            document.body.removeChild(t);
            if (done) ok(); else fail();
        } catch (e) { fail(); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(id).then(ok, legacy);
    else legacy();
}
function sendFriendRequest() {
    var id = $("friendLookupId").value.trim();
    db.rpc("send_player_friend_request", { target_player_id: id }).then(function (r) {
        $("playerMessage").textContent = r.error ? r.error.message : ((r.data && r.data.message) || "Request sent.");
    });
}
function loadFriends() {
    Promise.all([
        db.from("player_friend_requests").select("id,sender_id,created_at").eq("receiver_id", playerUser.id).eq("status", "pending"),
        db.from("player_friends_public").select("friend_id,display_name,player_id").eq("user_id", playerUser.id)
    ]).then(function (res) {
        var requests = res[0], friends = res[1];
        var req = $("friendRequests"), fr = $("friendsList");
        if (req) req.innerHTML = requests.error ? "<li>Could not load requests.</li>" : ((requests.data || []).map(function (x) {
            return "<li><span>Player request</span><span><button type=\"button\" class=\"btn btn-play btn-sm\" data-act=\"answer\" data-accept=\"1\" data-id=\"" + escapeHTML(x.id) + "\">Accept</button>" +
                "<button type=\"button\" class=\"btn btn-ghost btn-sm\" data-act=\"answer\" data-accept=\"0\" data-id=\"" + escapeHTML(x.id) + "\">Decline</button></span></li>";
        }).join("") || "<li>No pending requests.</li>");
        if (fr) fr.innerHTML = friends.error ? "<li>Could not load friends.</li>" : ((friends.data || []).map(function (x) {
            return "<li><span>" + escapeHTML(x.display_name) + " <small>" + escapeHTML(x.player_id) + "</small></span></li>";
        }).join("") || "<li>No friends yet.</li>");
    });
}
function answerFriendRequest(id, accept) {
    db.rpc("respond_player_friend_request", { request_id: id, accept_request: accept }).then(function (r) {
        $("playerMessage").textContent = r.error ? r.error.message : "Friend request updated.";
        loadFriends();
    });
}
function loadLeaderboards() {
    Promise.all([
        db.from("player_coin_leaderboard").select("display_name,player_id,balance,level").order("balance", { ascending: false }).order("display_name", { ascending: true }).limit(500),
        db.from("player_streak_leaderboard").select("display_name,player_id,current_streak").order("current_streak", { ascending: false }).order("display_name", { ascending: true }).limit(500)
    ]).then(function (res) {
        var coins = res[0], streaks = res[1];
        /* One row per player name: rows arrive best-first, so the first one seen is that name's best. */
        function bestPerName(rows) {
            var seen = {}, out = [];
            (rows || []).forEach(function (r) {
                var k = String(r.display_name || "").trim().toLowerCase();
                if (seen[k]) return;
                seen[k] = true; out.push(r);
            });
            return out.slice(0, 10);
        }
        if (!coins.error) coins = { data: bestPerName(coins.data) };
        if (!streaks.error) streaks = { data: bestPerName(streaks.data) };
        var medals = ["🥇", "🥈", "🥉"];
        function rank(i) { return '<span class="rank">' + (medals[i] || ("#" + (i + 1))) + "</span>"; }
        var c = $("coinLeaders"), s = $("streakLeaders");
        if (c) c.innerHTML = coins.error ? "<li>Leaderboard unavailable.</li>" : ((coins.data || []).map(function (x, i) {
            return "<li><span>" + rank(i) + escapeHTML(x.display_name) + " <small>" + escapeHTML(x.player_id) + "</small></span><strong>" + x.balance + " 💰</strong></li>";
        }).join("") || "<li>No players yet.</li>");
        if (s) s.innerHTML = streaks.error ? "<li>Leaderboard unavailable.</li>" : ((streaks.data || []).map(function (x, i) {
            return "<li><span>" + rank(i) + escapeHTML(x.display_name) + " <small>" + escapeHTML(x.player_id) + "</small></span><strong>" + x.current_streak + " 🔥</strong></li>";
        }).join("") || "<li>No players yet.</li>");
    });
}

/* ---------- Analytics ---------- */
function recordEvent(type, game) {
    try {
        return db.from("game_hub_events").insert({
            event_type: type,
            game_id: (game && game.id !== null && game.id !== undefined) ? String(game.id) : null,
            game_name: (game && game.name) || null,
            name: (playerProfile && playerProfile.display_name) || "Guest",
            visitor_key: visitorKey
        }).then(function (r) { if (r && r.error) console.warn("Analytics event:", r.error.message); },
                function (e) { console.warn("Analytics unavailable:", e); });
    } catch (e) { console.warn("Analytics unavailable:", e); return Promise.resolve(); }
}

/* ---------- Games: load, render, filter ---------- */
function gameTags(game) {
    if (Array.isArray(game.tags)) return game.tags.map(String);
    if (typeof game.tags === "string") return game.tags.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    return [];
}
function isFeatured(game) {
    return game.featured === true || game.featured === "true" || game.featured === 1 || game.featured === "1";
}
function isNew(game) {
    if (!game.created_at) return false;
    var t = new Date(game.created_at).getTime();
    return !isNaN(t) && (new Date().getTime() - t) < 14 * 24 * 3600 * 1000 && t <= new Date().getTime() + 86400000;
}
function accentFor(game) {
    var s = String(game.id !== undefined && game.id !== null ? game.id : game.name), h = 0, i;
    for (i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 7919;
    return "acc-" + (h % 7);
}
function looksLikeImage(v) {
    v = String(v || "").trim();
    return /^https?:\/\/\S+$/i.test(v) || /^\/?[\w\-.\/]+\.(png|jpe?g|gif|webp|svg|avif)(\?\S*)?$/i.test(v);
}
function makeCard(game, featured) {
    var li = document.createElement("li");
    li.className = "game-card " + accentFor(game) + (featured ? " is-featured" : "");

    var art = document.createElement("div"); art.className = "card-art";
    var badges = document.createElement("div"); badges.className = "card-badges";
    if (isFeatured(game)) { var bf = document.createElement("span"); bf.className = "badge badge-featured"; bf.textContent = "⭐ Featured"; badges.appendChild(bf); }
    if (isNew(game)) { var bn = document.createElement("span"); bn.className = "badge badge-new"; bn.textContent = "🆕 New"; badges.appendChild(bn); }
    art.appendChild(badges);

    var tile = document.createElement("div"); tile.className = "icon-tile"; tile.setAttribute("aria-hidden", "true");
    var iconVal = game.icon || "🎮";
    if (looksLikeImage(iconVal) && (/^https?:/i.test(iconVal) ? safeURL(iconVal) : true)) {
        var img = document.createElement("img");
        img.src = iconVal; img.alt = ""; img.width = 96; img.height = 96;
        try { img.loading = "lazy"; } catch (e) {}
        img.onerror = function () { tile.removeChild(img); tile.textContent = "🎮"; };
        tile.appendChild(img);
    } else tile.textContent = iconVal;
    art.appendChild(tile);

    var body = document.createElement("div"); body.className = "card-body";
    var h = document.createElement("h3"); h.className = "card-title"; h.textContent = game.name || "Untitled Game";
    var desc = document.createElement("p"); desc.className = "card-desc"; desc.textContent = game.description || "Jump in and play!";
    var tags = document.createElement("div"); tags.className = "tag-row";
    gameTags(game).forEach(function (tag) {
        var chip = document.createElement("span"); chip.className = "tag-chip"; chip.textContent = tag; tags.appendChild(chip);
    });
    var btn = document.createElement("button"); btn.type = "button"; btn.className = "btn btn-play";
    btn.textContent = featured ? "▶ PLAY FEATURED" : "▶ PLAY NOW";
    btn.setAttribute("aria-label", "Play " + (game.name || "game"));
    btn.addEventListener("click", function () { openGame(game); });

    body.appendChild(h); body.appendChild(desc); body.appendChild(tags); body.appendChild(btn);
    li.appendChild(art); li.appendChild(body);
    return li;
}
function showSkeletons() {
    var host = $("gamesGrid"); clear(host);
    for (var i = 0; i < 8; i++) {
        var li = document.createElement("li"); li.className = "game-card is-skeleton acc-0"; li.setAttribute("aria-hidden", "true");
        li.innerHTML = '<div class="card-art"></div><div class="card-body"><div class="sk-line w60"></div><div class="sk-line w90"></div><div class="sk-line w90"></div></div>';
        host.appendChild(li);
    }
    $("resultCount").textContent = "Loading games…";
}
function loadGames() {
    showSkeletons();
    return db.from("games").select("*").order("id").then(function (res) {
        if (res.error) {
            console.error(res.error);
            clear($("gamesGrid")); $("resultCount").textContent = "";
            $("noGames").innerHTML = "<strong>Couldn't load games</strong>Check your Supabase table and permissions.";
            $("noGames").style.display = "block";
            return;
        }
        games = res.data || [];
        $("gamesCount").textContent = games.length;
        renderFilters(); renderGames(); renderFeaturedGames(); renderOwnerGames(); renderTags();
    }, function (e) {
        console.error(e);
        clear($("gamesGrid"));
        $("noGames").innerHTML = "<strong>Couldn't load games</strong>Check your connection and try again.";
        $("noGames").style.display = "block";
    });
}
function allTags() {
    var seen = {}, out = [];
    games.forEach(function (g) {
        gameTags(g).forEach(function (t) {
            var k = t.toLowerCase();
            if (!seen[k]) { seen[k] = true; out.push(t); }
        });
    });
    out.sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
    return out;
}
function renderFilters() {
    var row = $("filterRow"); clear(row);
    var tags = allTags();
    if (!tags.length) { row.style.display = "none"; return; }
    row.style.display = "";
    var names = [""].concat(tags);
    var stillThere = names.some(function (n) { return n.toLowerCase() === activeTag.toLowerCase(); });
    if (!stillThere) activeTag = "";
    names.forEach(function (name) {
        var b = document.createElement("button"); b.type = "button"; b.className = "filter-chip";
        b.textContent = name || "All";
        b.setAttribute("data-tag", name);
        b.setAttribute("aria-pressed", String(name.toLowerCase() === activeTag.toLowerCase()));
        row.appendChild(b);
    });
}
function renderFeaturedGames() {
    var host = $("featuredGames"); clear(host);
    var selected = games.filter(isFeatured);
    $("noFeatured").style.display = selected.length ? "none" : "block";
    selected.forEach(function (g) { host.appendChild(makeCard(g, true)); });
}
function renderGames() {
    var host = $("gamesGrid"); clear(host);
    var q = $("search").value.trim().toLowerCase();
    var tag = activeTag.toLowerCase();
    var filtered = games.filter(function (g) {
        var tags = gameTags(g);
        if (tag && tags.map(function (t) { return t.toLowerCase(); }).indexOf(tag) === -1) return false;
        return [g.name, g.description].concat(tags).join(" ").toLowerCase().indexOf(q) !== -1;
    });
    filtered.forEach(function (g) { host.appendChild(makeCard(g, false)); });
    var none = !filtered.length;
    $("noGames").innerHTML = "<strong>No games found</strong>No games match your search.";
    $("noGames").style.display = none ? "block" : "none";
    $("resultCount").textContent = games.length ? ("Showing " + filtered.length + " of " + games.length + " games") : "";
}

/* ---------- Navigation / game player ---------- */
function showHome() {
    $("homePage").style.display = "block";
    $("gamePlayer").hidden = true;
    window.scrollTo(0, 0);
}
function scrollToGames() { goHomeThen(function () { smoothTop($("gamesHeading")); }); }
function scrollToFeatured() { goHomeThen(function () { smoothTop($("featuredSection")); }); }
function goHomeThen(fn) {
    if ($("homePage").style.display === "none") { closeGame(); }
    fn();
}
function openGame(game) {
    var url = safeURL(game.url);
    if (!url) { alert("This game has an invalid URL."); return; }
    currentGame = game;
    recordEvent("play", game).then(function () {
        $("playingTitle").textContent = game.name;
        $("gameFrame").src = url;
        $("homePage").style.display = "none";
        $("gamePlayer").hidden = false;
        window.scrollTo(0, 0);
    });
}
function openCurrentGame() {
    var url = safeURL(currentGame && currentGame.url);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
}
function closeGame() {
    $("gameFrame").src = "about:blank";
    $("gamePlayer").hidden = true;
    $("homePage").style.display = "block";
    currentGame = null;
}

/* ---------- Owner ---------- */
function openOwnerLogin() { openModal("ownerLoginModal"); }
function closeOwnerLogin() { closeModal("ownerLoginModal"); }
function ownerLogin(event) {
    event.preventDefault();
    var msg = $("loginMessage");
    msg.textContent = "Signing in...";
    db.auth.signInWithPassword({
        email: $("ownerEmail").value.trim(),
        password: $("ownerPassword").value
    }).then(function (res) {
        if (res.error) { msg.textContent = "Login failed: " + res.error.message; return; }
        if (res.data.user.id !== OWNER_ID) {
            return db.auth.signOut().then(function () { msg.textContent = "This account is not authorized as the owner."; });
        }
        store("session", "gamehub_owner_mode_logged_out", null);
        isOwner = true;
        closeOwnerLogin();
        $("ownerPanel").hidden = false;
        return loadOwnerAnalytics().then(function () {
            renderOwnerGames();
            smoothTop($("ownerPanel"));
        });
    }, function (e) { msg.textContent = "Login failed: " + (e && e.message ? e.message : e); });
}
function ownerLogout() {
    isOwner = false;
    store("session", "gamehub_owner_mode_logged_out", "true");
    $("ownerPanel").hidden = true;
    clear($("ownerAnalytics")); clear($("ownerGames"));
    window.scrollTo(0, 0);
}
function checkSession() {
    return db.auth.getUser().then(function (res) {
        var closed = store("session", "gamehub_owner_mode_logged_out") === "true";
        var ownerAccount = !res.error && res.data && res.data.user && res.data.user.id === OWNER_ID;
        isOwner = Boolean(ownerAccount && !closed);
        $("ownerPanel").hidden = !isOwner;
        if (isOwner) { renderOwnerGames(); return loadOwnerAnalytics(); }
    }, function () { /* ignore */ });
}
function renderOwnerGames() {
    var host = $("ownerGames"); if (!host) return;
    clear(host);
    if (!isOwner) return;
    games.forEach(function (game) {
        var row = document.createElement("div"); row.className = "owner-game";
        var info = document.createElement("div"); info.className = "og-info";
        info.innerHTML = "<strong>" + escapeHTML(game.icon || "🎮") + " " + escapeHTML(game.name) + "</strong><br><small>" +
            (isFeatured(game) ? "⭐ Featured" : "Not featured") + " · " + gameTags(game).map(escapeHTML).join(", ") + "</small>";
        var actions = document.createElement("div"); actions.className = "btn-row";
        var edit = document.createElement("button"); edit.type = "button"; edit.className = "btn btn-navy btn-sm"; edit.textContent = "✏️ Edit";
        edit.addEventListener("click", function () { editGame(game); });
        var del = document.createElement("button"); del.type = "button"; del.className = "btn btn-danger btn-sm"; del.textContent = "🗑️ Delete";
        del.addEventListener("click", function () { deleteGame(game); });
        actions.appendChild(edit); actions.appendChild(del);
        row.appendChild(info); row.appendChild(actions);
        host.appendChild(row);
    });
}
function fillGameForm(game) {
    $("gameFormHeading").textContent = game ? "✏️ Edit Game" : "➕ Add Game";
    $("gameName").value = game ? (game.name || "") : "";
    $("gameDescription").value = game ? (game.description || "") : "";
    $("gameUrl").value = game ? (game.url || "") : "";
    $("gameIcon").value = game ? (game.icon || "🎮") : "🎮";
    $("gameTags").value = game ? gameTags(game).join(", ") : "";
    $("gameFeatured").value = game ? String(isFeatured(game)) : "false";
    $("gameMessage").textContent = "";
    openModal("gameModal");
}
function newGame() { editingGameId = null; fillGameForm(null); }
function editGame(game) { editingGameId = game.id; fillGameForm(game); }
function closeGameForm() { closeModal("gameModal"); }
function saveGame(event) {
    event.preventDefault();
    if (!isOwner) { alert("Please log in as the owner first."); return; }
    db.auth.getUser().then(function (res) {
        var user = res && res.data ? res.data.user : null;
        if (!user || user.id !== OWNER_ID) { isOwner = false; alert("Owner authentication required."); return; }
        var name = $("gameName").value.trim();
        var description = $("gameDescription").value.trim();
        var url = safeURL($("gameUrl").value.trim());
        var icon = $("gameIcon").value.trim() || "🎮";
        var seen = {}, tags = [];
        $("gameTags").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (t) {
            if (!seen[t]) { seen[t] = true; tags.push(t); }
        });
        tags = tags.slice(0, 12);
        var featured = $("gameFeatured").value === "true";
        var message = $("gameMessage");
        if (!name || !url) { message.textContent = "Please enter a valid game name and URL."; return; }
        var payload = { name: name, description: description, url: url, icon: icon, tags: tags, featured: featured };
        message.textContent = "Saving...";
        var req;
        if (editingGameId === null) {
            payload.owner_id = OWNER_ID;
            req = db.from("games").insert(payload);
        } else req = db.from("games").update(payload).eq("id", editingGameId);
        return req.then(function (result) {
            if (result.error) { message.textContent = "Save failed: " + result.error.message; return; }
            closeGameForm();
            return loadGames().then(function () { alert("Game saved successfully!"); });
        });
    });
}
function deleteGame(game) {
    if (!isOwner) return;
    if (!confirm('Delete "' + game.name + '"? This cannot be undone.')) return;
    db.auth.getUser().then(function (res) {
        var user = res && res.data ? res.data.user : null;
        if (!user || user.id !== OWNER_ID) { alert("Owner authentication required."); return; }
        return db.from("games").delete().eq("id", game.id).then(function (r) {
            if (r.error) { alert("Delete failed: " + r.error.message); return; }
            return loadGames();
        });
    });
}

/* Custom tags (stored in this browser, as in the original) */
function getSavedTags() {
    try { return JSON.parse(store("local", "gamehub_custom_tags")) || []; } catch (e) { return []; }
}
function renderTags() {
    var host = $("tagManager"); if (!host) return;
    clear(host);
    getSavedTags().forEach(function (tag) {
        var chip = document.createElement("button"); chip.type = "button"; chip.className = "tag-chip";
        chip.textContent = tag + " ×";
        chip.title = "Click to remove this tag";
        chip.setAttribute("aria-label", "Remove tag " + tag);
        chip.addEventListener("click", function () {
            if (!isOwner) return;
            store("local", "gamehub_custom_tags", JSON.stringify(getSavedTags().filter(function (t) { return t !== tag; })));
            renderTags();
        });
        host.appendChild(chip);
    });
}
function addTag() {
    if (!isOwner) { alert("Owner login required."); return; }
    var input = $("newTag"), tag = input.value.trim().slice(0, 32);
    if (!tag) return;
    var tags = getSavedTags();
    if (!tags.some(function (t) { return t.toLowerCase() === tag.toLowerCase(); })) {
        tags.push(tag); store("local", "gamehub_custom_tags", JSON.stringify(tags));
    }
    input.value = ""; renderTags();
}

function loadOwnerAnalytics() {
    if (!isOwner) return Promise.resolve();
    var host = $("ownerAnalytics");
    host.textContent = "Loading analytics...";
    return db.auth.getUser().then(function (res) {
        var user = res && res.data ? res.data.user : null;
        if (!user || user.id !== OWNER_ID) { host.textContent = "Owner authentication required."; return; }
        return db.from("game_hub_events").select("game_id,game_name,visitor_key,event_type,name").eq("event_type", "play").then(function (r) {
            if (r.error) { host.textContent = "Analytics unavailable. Check the game_hub_events table and its permissions."; console.error(r.error); return; }
            var totals = {};
            (r.data || []).forEach(function (e) {
                var key = e.game_id || e.game_name || "unknown";
                if (!totals[key]) totals[key] = { name: e.game_name || "Unknown game", plays: 0, visitors: {}, players: {} };
                totals[key].plays++;
                if (e.visitor_key) totals[key].visitors[e.visitor_key] = true;
                if (e.name) totals[key].players[e.name] = true;
            });
            clear(host);
            var rows = Object.keys(totals).map(function (k) { return totals[k]; }).sort(function (a, b) { return b.plays - a.plays; });
            if (!rows.length) { host.textContent = "No game plays have been recorded yet."; return; }
            rows.forEach(function (item) {
                var row = document.createElement("div"); row.className = "owner-game";
                var info = document.createElement("div"); info.className = "og-info";
                info.innerHTML = "<strong>" + escapeHTML(item.name) + "</strong><br><small>" + item.plays + " play clicks · " +
                    Object.keys(item.visitors).length + " browsers</small><br><small>Players: " +
                    escapeHTML(Object.keys(item.players).join(", ") || "Unknown") + "</small>";
                row.appendChild(info); host.appendChild(row);
            });
        });
    });
}

/* ---------- Suggestions ---------- */
function toggleSuggestion(forceClose) {
    var box = $("suggestionBox");
    var open = forceClose ? false : !box.classList.contains("open");
    if (open) box.classList.add("open"); else box.classList.remove("open");
    $("suggestionTrigger").setAttribute("aria-expanded", String(open));
}
function submitSuggestion(event) {
    event.preventDefault();
    var form = event.currentTarget, msg = $("suggestionMessage");
    msg.className = "form-message"; msg.textContent = "Sending...";
    if (!window.fetch || !window.FormData) { form.submit(); return; }
    fetch(form.action, { method: "POST", body: new FormData(form), headers: { Accept: "application/json" } }).then(function (response) {
        if (!response.ok) throw new Error("Submission failed");
        msg.className = "form-message ok"; msg.textContent = "✅ Thank you! Your suggestion was sent.";
        form.reset();
        setTimeout(function () { toggleSuggestion(true); msg.textContent = ""; }, 5000);
    }).then(null, function () {
        msg.className = "form-message err"; msg.textContent = "❌ Couldn't send it. Please try again.";
    });
}

/* ---------- Profile menu / nav ---------- */
function closeProfileMenu() {
    $("profileMenu").classList.remove("open");
    $("profileTrigger").setAttribute("aria-expanded", "false");
}
function toggleProfileMenu() {
    var m = $("profileMenu"), open = !m.classList.contains("open");
    if (open) m.classList.add("open"); else m.classList.remove("open");
    $("profileTrigger").setAttribute("aria-expanded", String(open));
}
function setNavOpen(open) {
    var nav = $("siteNav");
    if (open) nav.classList.add("open"); else nav.classList.remove("open");
    $("navToggle").setAttribute("aria-expanded", String(open));
    $("navToggle").setAttribute("aria-label", open ? "Close menu" : "Open menu");
    $("navToggle").textContent = open ? "✕" : "☰";
}
function handleNav(name) {
    setNavOpen(false); closeProfileMenu();
    if (name === "home") { goHomeThen(function () { window.scrollTo(0, 0); }); }
    else if (name === "games") scrollToGames();
    else if (name === "featured") scrollToFeatured();
    else if (name === "leaderboard") openPlayerModal("leaderboard");
    else if (name === "friends") openPlayerModal("friends");
    else if (name === "rewards") openPlayerModal("rewards");
    else if (name === "owner") openOwnerLogin();
    else if (name === "signout") playerSignOut();
}
function closest(node, selector) {
    while (node && node.nodeType === 1) {
        var fn = node.matches || node.msMatchesSelector || node.webkitMatchesSelector;
        if (fn && fn.call(node, selector)) return node;
        node = node.parentNode;
    }
    return null;
}

function wireEvents() {
    document.addEventListener("click", function (e) {
        var t = e.target, el;
        if ((el = closest(t, "[data-nav]"))) { handleNav(el.getAttribute("data-nav")); return; }
        if ((el = closest(t, "[data-player]"))) { openPlayerModal(el.getAttribute("data-player")); return; }
        if ((el = closest(t, "[data-close]"))) { closeModal(el.getAttribute("data-close")); return; }
        if ((el = closest(t, "[data-act]"))) {
            var act = el.getAttribute("data-act");
            if (act === "claim") claimDailyFromUI();
            else if (act === "save-name") savePlayerSettings();
            else if (act === "set-id") changeCustomPlayerId();
            else if (act === "copy-id") copyPlayerId();
            else if (act === "send-request") sendFriendRequest();
            else if (act === "answer") answerFriendRequest(el.getAttribute("data-id"), el.getAttribute("data-accept") === "1");
            return;
        }
        if ((el = closest(t, ".filter-chip"))) {
            activeTag = el.getAttribute("data-tag") || "";
            each($("filterRow").children, function (b) { b.setAttribute("aria-pressed", String((b.getAttribute("data-tag") || "").toLowerCase() === activeTag.toLowerCase())); });
            renderGames(); return;
        }
        if (e.target.className && String(e.target.className).indexOf("modal-backdrop") !== -1) { closeModal(e.target.id); return; }
        if (!closest(t, ".profile-wrap")) closeProfileMenu();
    });
    $("profileTrigger").addEventListener("click", toggleProfileMenu);
    $("navToggle").addEventListener("click", function () { setNavOpen(!$("siteNav").classList.contains("open")); });
    $("backToHub").addEventListener("click", closeGame);
    $("openNewTab").addEventListener("click", openCurrentGame);
    $("addGameBtn").addEventListener("click", newGame);
    $("refreshAnalyticsBtn").addEventListener("click", loadOwnerAnalytics);
    $("ownerLogoutBtn").addEventListener("click", ownerLogout);
    $("addTagBtn").addEventListener("click", addTag);
    $("ownerLoginForm").addEventListener("submit", ownerLogin);
    $("gameForm").addEventListener("submit", saveGame);
    $("suggestionTrigger").addEventListener("click", function () { toggleSuggestion(); });
    $("cancelSuggestion").addEventListener("click", function () { toggleSuggestion(true); });
    $("suggestionForm").addEventListener("submit", submitSuggestion);

    var timer = null;
    var onSearch = function () { clearTimeout(timer); timer = setTimeout(renderGames, 80); };
    $("search").addEventListener("input", onSearch);
    $("search").addEventListener("change", renderGames);

    document.addEventListener("keydown", function (event) {
        var k = event.key || event.keyCode;
        if (k === "Escape" || k === "Esc" || k === 27) {
            if (modalStack.length) closeModal(modalStack[modalStack.length - 1]);
            else { closeProfileMenu(); setNavOpen(false); }
            return;
        }
        if ((k === "Tab" || k === 9) && modalStack.length) {   // keep focus inside the open dialog
            var m = $(modalStack[modalStack.length - 1]);
            var f = m.querySelectorAll("a[href], button:not([disabled]), input:not([disabled]), select, textarea");
            if (!f.length) return;
            var first = f[0], last = f[f.length - 1];
            if (event.shiftKey && document.activeElement === first) { last.focus(); event.preventDefault(); }
            else if (!event.shiftKey && document.activeElement === last) { first.focus(); event.preventDefault(); }
        }
    });

    // Local (non-deployed) copies use real file names instead of clean URLs.
    if (isLocalHost()) each(document.querySelectorAll("a[data-route=games]"), function (a) { a.setAttribute("href", "games.html"); });
}

/* ---------- Startup ---------- */
function init() {
    if (!db) {
        showNotice("Game Hub could not load its sign-in library (Supabase). Your browser may be too old, or the script is blocked. Try the latest Chrome or Firefox, disable content blockers, and refresh.");
        $("resultCount").textContent = "";
        return;
    }
    wireEvents();
    loadPlayerData().then(function (state) {
        if (state === "redirect") return;
        return loadGames().then(checkSession).then(function () {
            if (state === "ok") { autoClaimDaily(); return recordEvent("visit"); }
        });
    }).then(null, function (e) { console.error(e); showNotice("Something went wrong while loading Game Hub: " + (e && e.message ? e.message : e)); });
}
if (!window.Promise) { showNotice("Your browser is too old to run Game Hub. Please update Chrome or Firefox."); }
else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
})();
