// Simscape — Owner Publish Object
//
// Rez this on your parcel. Touching it (as owner) lets you publish the venue to
// the Simscape site for 6 or 24 hours, picking a theme. While published it sends
// a population heartbeat every HEARTBEAT_INTERVAL seconds. When the chosen time
// runs out the site stops listing it automatically (server-side expiry filter) —
// touch again to republish. See Project Plan.MD and lsl/shared_reference/themes.md.
//
// Fill in PUBLISH_URL / HEARTBEAT_URL / DELIST_URL / ANON_KEY below with your
// Supabase project's values before use.

// ---- Configuration -------------------------------------------------------

string PUBLISH_URL   = "https://ingqyyxryrfunxgedypt.supabase.co/functions/v1/publish";
string HEARTBEAT_URL = "https://ingqyyxryrfunxgedypt.supabase.co/functions/v1/heartbeat";
string DELIST_URL    = "https://ingqyyxryrfunxgedypt.supabase.co/functions/v1/delist";
string ANON_KEY      = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImluZ3F5eXhyeXJmdW54Z2VkeXB0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTE2MDUsImV4cCI6MjEwMjEyNzYwNX0.eAHXfvLSFTBCQH8jpu9LsVI6YNH1bBvZf3IIRebKXJQ"; // sent as apikey header; safe to be public

float HEARTBEAT_INTERVAL = 300.0; // seconds; must match lsl/shared_reference/themes.md

// Name of the optional cover-photo texture in this object's inventory (see
// doPublish()). IMPORTANT: llGetInventoryKey() only returns a real UUID for
// full-permission (copy+mod+transfer) items — for anything else (most
// marketplace textures) it silently returns NULL_KEY and no photo is sent.
// The reliable way to get a usable texture: take an in-world Snapshot to
// Inventory (viewer snapshot floater) — your own snapshots are always full
// permission — then rename it to this exact name.
string PHOTO_TEXTURE_NAME = "Photo";

// Keep in sync with lsl/shared_reference/themes.md and the DB CHECK constraint.
list THEME_BUTTONS = ["BDSM", "Club", "Venue", "Hangout", "Dating",
                       "Roleplay", "Live Music", "Shopping", "Other"];
list DURATION_BUTTONS = ["2 Hours", "4 Hours", "6 Hours", "12 Hours", "24 Hours", "Cancel"];
list DURATION_HOURS   = [2, 4, 6, 12, 24]; // parallel to DURATION_BUTTONS minus "Cancel"

// ---- State -----------------------------------------------------------------

integer DIALOG_CHANNEL;
key     gExpectedAvatar;
integer gListenHandle;

integer MODE_NONE        = 0;
integer MODE_THEME       = 1;
integer MODE_DURATION    = 2;
integer MODE_OWNER_MENU  = 3;
integer gListenMode = 0;

string  gPendingTheme;      // theme chosen this flow, awaiting duration pick
integer gPendingDurationHours; // duration chosen this flow, awaiting publish response

string  gVenueId;
string  gSecretToken;
string  gTheme;
integer gDurationHours;
integer gExpiresAtUnix;
key     gOwnerAvatar; // the verified parcel owner who last published, not llGetOwner()

key gPublishRequestId;
key gHeartbeatRequestId;
key gDelistRequestId;

integer isPublished()
{
    return (gVenueId != "" && gExpiresAtUnix > llGetUnixTime());
}

// The land parcel's registered owner, NOT this object's owner (llGetOwner()) —
// those can differ, e.g. someone could rez this on land they don't actually
// own. Only the parcel owner (or, for group-deeded land, a member of that
// group — see below) should be able to publish/manage the listing.
//
// GROUP-DEEDED LAND: if the parcel is deeded to a group, PARCEL_DETAILS_OWNER
// returns the GROUP's key, not any individual's — no avatar key will ever
// match it directly. LSL has no direct "is this avatar a member of group X"
// check; the only tool available, llSameGroup(), compares the toucher's
// currently-ACTIVE group against THIS OBJECT's own group setting (Edit >
// General > Group in the viewer) — it says nothing about the parcel at all.
// So: set this object's own group (in-world) to the SAME group the parcel is
// deeded to. Then isParcelOwner() only trusts llSameGroup() after confirming
// this object's set group actually matches the parcel's owning group — that
// guards against the object being left set to some unrelated group.
integer isParcelOwner(key avatar)
{
    key parcelOwner = llList2Key(llGetParcelDetails(llGetPos(), [PARCEL_DETAILS_OWNER]), 0);
    key objectGroup = llList2Key(llGetObjectDetails(llGetKey(), [OBJECT_GROUP]), 0);
    integer individualMatch = (avatar == parcelOwner);
    integer groupDeeded = (objectGroup != NULL_KEY && objectGroup == parcelOwner);
    integer groupMatch = groupDeeded && llSameGroup(avatar);

    return individualMatch || groupMatch;
}

// ---- Persistence (Linkset Data survives script reset / region restart) -----
// NOTE: verify empirically that this persists the way you expect for your build
// (per Stage 4 of the plan) — if not, fall back to llSetObjectDesc for the two
// short strings.

savePublishedState()
{
    llLinksetDataWrite("venue_id", gVenueId);
    llLinksetDataWrite("secret_token", gSecretToken);
    llLinksetDataWrite("theme", gTheme);
    llLinksetDataWrite("duration_hours", (string)gDurationHours);
    llLinksetDataWrite("expires_at_unix", (string)gExpiresAtUnix);
    llLinksetDataWrite("owner_avatar", (string)gOwnerAvatar);
}

clearPublishedState()
{
    gVenueId = "";
    gSecretToken = "";
    gExpiresAtUnix = 0;
    llLinksetDataDelete("venue_id");
    llLinksetDataDelete("secret_token");
    llLinksetDataDelete("expires_at_unix");
}

loadPersistedState()
{
    gVenueId       = llLinksetDataRead("venue_id");
    gSecretToken   = llLinksetDataRead("secret_token");
    gTheme         = llLinksetDataRead("theme");
    gDurationHours = (integer)llLinksetDataRead("duration_hours");
    gExpiresAtUnix = (integer)llLinksetDataRead("expires_at_unix");
    gOwnerAvatar   = (key)llLinksetDataRead("owner_avatar");
}

// ---- UI ----------------------------------------------------------------

integer channelForKey(key k)
{
    // Deterministic-but-unique-enough negative channel derived from this
    // object's key, so repeated resets reuse the same channel and dialogs
    // from other nearby Simscape objects don't collide.
    return -1 - (integer)("0x" + llGetSubString((string)k, 0, 6));
}

startListen()
{
    if (gListenHandle) llListenRemove(gListenHandle);
    gListenHandle = llListen(DIALOG_CHANNEL, "", gExpectedAvatar, "");
}

stopListen()
{
    if (gListenHandle) llListenRemove(gListenHandle);
    gListenHandle = 0;
    gListenMode = MODE_NONE;
}

updateFloatingText()
{
    if (isPublished())
    {
        integer remaining = gExpiresAtUnix - llGetUnixTime();
        integer hours = remaining / 3600;
        integer minutes = (remaining % 3600) / 60;
        llSetText("Simscape: LIVE (" + gTheme + ")\nExpires in " +
                   (string)hours + "h " + (string)minutes + "m\nTouch to manage",
                   <0.3, 1.0, 0.5>, 1.0);
    }
    else
    {
        llSetText("Simscape: not published\nTouch to publish this venue", <1.0, 0.6, 0.2>, 1.0);
    }
}

showThemeDialog(key avatar)
{
    gExpectedAvatar = avatar;
    gListenMode = MODE_THEME;
    startListen();
    llDialog(avatar, "Choose a theme for this venue:", THEME_BUTTONS, DIALOG_CHANNEL);
}

showDurationDialog(key avatar)
{
    gExpectedAvatar = avatar;
    gListenMode = MODE_DURATION;
    startListen();
    llDialog(avatar, "Publish \"" + gPendingTheme + "\" for how long?", DURATION_BUTTONS, DIALOG_CHANNEL);
}

showOwnerMenu(key avatar)
{
    gExpectedAvatar = avatar;
    gListenMode = MODE_OWNER_MENU;
    startListen();
    integer remaining = gExpiresAtUnix - llGetUnixTime();
    llDialog(avatar,
        "Published as \"" + gTheme + "\", expires in " + (string)(remaining / 60) + " min.",
        ["Refresh Now", "Update", "Delist Now", "Cancel"], DIALOG_CHANNEL);
}

showStatusDialog(key avatar)
{
    string msg;
    if (isPublished())
    {
        integer remaining = gExpiresAtUnix - llGetUnixTime();
        msg = "This venue is live on Simscape.\nTheme: " + gTheme +
              "\nExpires in " + (string)(remaining / 60) + " minutes.";
    }
    else
    {
        msg = "This venue is not currently published on Simscape.";
    }
    llDialog(avatar, msg, ["OK"], DIALOG_CHANNEL); // no listener needed for a plain "OK"
}

// ---- Networking ----------------------------------------------------------

list httpHeaders()
{
    return [HTTP_METHOD, "POST",
            HTTP_MIMETYPE, "application/json",
            HTTP_BODY_MAXLENGTH, 2048,
            HTTP_CUSTOM_HEADER, "apikey", ANON_KEY];
}

doPublish(string theme, integer durationHours)
{
    string parcelName = llList2String(llGetParcelDetails(llGetPos(), [PARCEL_DETAILS_NAME]), 0);
    if (parcelName == "") parcelName = llGetObjectName();
    vector pos = llGetPos();

    list fields = [
        "object_key", (string)llGetKey(),
        "parcel_name", parcelName,
        "region_name", llGetRegionName(),
        "owner_key", (string)gOwnerAvatar,
        "owner_name", llKey2Name(gOwnerAvatar),
        "local_x", pos.x,
        "local_y", pos.y,
        "local_z", pos.z,
        "theme", theme,
        "duration_hours", durationHours,
        "population", llGetListLength(llGetAgentList(AGENT_LIST_PARCEL, []))
    ];

    // Cover photo: LSL can't read the parcel's About Land snapshot, so instead
    // drop a texture named exactly "Venue Photo" into this object's inventory.
    // If present, its UUID gets sent along and rendered on the site via
    // Linden Lab's public texture proxy. If absent, the site just shows no photo.
    key photoKey = llGetInventoryKey(PHOTO_TEXTURE_NAME);
    if (photoKey != NULL_KEY)
    {
        fields += ["photo_texture_uuid", (string)photoKey];
    }

    string body = llList2Json(JSON_OBJECT, fields);

    gPublishRequestId = llHTTPRequest(PUBLISH_URL, httpHeaders(), body);
    llSetText("Simscape: publishing…", <1.0, 1.0, 1.0>, 1.0);
}

doHeartbeat()
{
    if (!isPublished()) return;

    integer population = llGetListLength(llGetAgentList(AGENT_LIST_PARCEL, []));
    string body = llList2Json(JSON_OBJECT, [
        "venue_id", gVenueId,
        "secret_token", gSecretToken,
        "population", population
    ]);
    gHeartbeatRequestId = llHTTPRequest(HEARTBEAT_URL, httpHeaders(), body);
}

doDelist()
{
    if (gVenueId == "") return;
    string body = llList2Json(JSON_OBJECT, ["venue_id", gVenueId, "secret_token", gSecretToken]);
    gDelistRequestId = llHTTPRequest(DELIST_URL, httpHeaders(), body);
    clearPublishedState();
    llSetTimerEvent(0.0);
    updateFloatingText();
}

// ---- Script -----------------------------------------------------------

default
{
    state_entry()
    {
        DIALOG_CHANNEL = channelForKey(llGetKey());
        loadPersistedState();

        if (isPublished())
        {
            llSetTimerEvent(HEARTBEAT_INTERVAL);
            doHeartbeat(); // don't leave a stale population count sitting until the next tick
        }
        else
        {
            // Cached theme/duration may still be set (from a previous, now-
            // expired publish) — kept only so a silent republish (see
            // http_response 401 handling) has something to reuse.
            llSetTimerEvent(0.0);
        }
        updateFloatingText();
    }

    on_rez(integer start_param)
    {
        llResetScript();
    }

    touch_start(integer total_number)
    {
        key toucher = llDetectedKey(0);

        if (!isParcelOwner(toucher))
        {
            showStatusDialog(toucher);
            return;
        }

        gOwnerAvatar = toucher; // verified parcel owner — see doPublish()

        if (isPublished())
        {
            showOwnerMenu(toucher);
        }
        else
        {
            showThemeDialog(toucher);
        }
    }

    listen(integer channel, string name, key id, string message)
    {
        if (id != gExpectedAvatar) return;

        if (gListenMode == MODE_THEME)
        {
            stopListen();
            if (llListFindList(THEME_BUTTONS, [message]) == -1) return;
            gPendingTheme = message;
            showDurationDialog(gExpectedAvatar);
        }
        else if (gListenMode == MODE_DURATION)
        {
            stopListen();
            if (message == "Cancel") return;
            integer idx = llListFindList(DURATION_BUTTONS, [message]);
            if (idx == -1) return;
            gPendingDurationHours = llList2Integer(DURATION_HOURS, idx);
            doPublish(gPendingTheme, gPendingDurationHours);
        }
        else if (gListenMode == MODE_OWNER_MENU)
        {
            stopListen();
            if (message == "Refresh Now")
            {
                doHeartbeat();
            }
            else if (message == "Update")
            {
                showThemeDialog(gExpectedAvatar);
            }
            else if (message == "Delist Now")
            {
                doDelist();
            }
            // "Cancel" falls through, does nothing.
        }
    }

    timer()
    {
        if (isPublished())
        {
            doHeartbeat();
        }
        else
        {
            llSetTimerEvent(0.0);
            updateFloatingText();
        }
    }

    http_response(key request_id, integer status, list metadata, string body)
    {
        if (request_id == gPublishRequestId)
        {
            if (status == 200)
            {
                gVenueId       = llJsonGetValue(body, ["venue_id"]);
                gSecretToken   = llJsonGetValue(body, ["secret_token"]);
                gExpiresAtUnix = (integer)llJsonGetValue(body, ["expires_at_unix"]);
                gTheme         = gPendingTheme;
                gDurationHours = gPendingDurationHours;
                savePublishedState();
                llSetTimerEvent(HEARTBEAT_INTERVAL);
                updateFloatingText();
                // No separate immediate heartbeat needed — population was already
                // sent as part of the publish request itself, above.
            }
            else if (status == 403 && llJsonGetValue(body, ["error"]) == "banned")
            {
                llOwnerSay("Simscape: this account is banned from publishing venues.");
                updateFloatingText();
            }
            else
            {
                llOwnerSay("Simscape: publish failed (status " + (string)status + "): " + body);
                updateFloatingText();
            }
        }
        else if (request_id == gHeartbeatRequestId)
        {
            if (status == 200)
            {
                gExpiresAtUnix = (integer)llJsonGetValue(body, ["expires_at_unix"]);
                savePublishedState();
                updateFloatingText();
            }
            else if (status == 401)
            {
                // Token lost (e.g. after an unexpected reset) — silently
                // republish using the last known theme/duration rather than
                // forcing the owner to re-touch. This does NOT extend a
                // still-valid listing's expiry beyond what was already set;
                // it only recovers a broken client/server token mismatch.
                if (gTheme != "" && gDurationHours > 0)
                {
                    gPendingTheme = gTheme;
                    gPendingDurationHours = gDurationHours;
                    doPublish(gPendingTheme, gPendingDurationHours);
                }
                else
                {
                    clearPublishedState();
                    llSetTimerEvent(0.0);
                    updateFloatingText();
                }
            }
            else if (status == 403)
            {
                clearPublishedState();
                llSetTimerEvent(0.0);
                updateFloatingText();
            }
            // Any other status (network error, 5xx) — leave state as-is,
            // retry on the next timer tick. The site's own expires_at filter
            // is the real source of truth for delisting, not this client.
        }
        else if (request_id == gDelistRequestId)
        {
            // Local state already cleared in doDelist(); nothing further to do.
        }
    }
}
