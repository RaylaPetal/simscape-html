// Simscape — Browser HUD
//
// Wear this and touch it to browse currently open venues listed on Simscape,
// sort them, and teleport to one — or jump straight to the website. Reads
// straight from the public_venues view via PostgREST (anon key) — no custom
// backend endpoint needed for this. See Project Plan.MD and
// lsl/shared_reference/themes.md.
//
// Fill in SUPABASE_URL / ANON_KEY / SITE_URL below before use.

// ---- Configuration -------------------------------------------------------

string SUPABASE_URL = "https://ingqyyxryrfunxgedypt.supabase.co";
string ANON_KEY      = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImluZ3F5eXhyeXJmdW54Z2VkeXB0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTE2MDUsImV4cCI6MjEwMjEyNzYwNX0.eAHXfvLSFTBCQH8jpu9LsVI6YNH1bBvZf3IIRebKXJQ";
string SITE_URL      = "https://raylapetal.github.io/simscape-html/";

// 4 numbered venue buttons + up to 4 control buttons (Prev/Next/Filters/Back)
// comfortably fits llDialog's 12-button cap, and keeping the venue buttons to
// bare digits (see showListDialog()) leaves the dialog's shared message text
// free to show full names + population instead of squeezing them into each
// button's 24-byte label.
integer PAGE_SIZE = 4;

// ---- State -----------------------------------------------------------------

integer DIALOG_CHANNEL;
key     gExpectedAvatar;
integer gListenHandle;

integer MODE_MAIN    = 0;
integer MODE_FILTERS = 1;
integer MODE_LIST    = 2;
integer MODE_DETAIL  = 3;
integer gListenMode = 0;

integer gPage;       // current page number, 0-based
string  gSortMode;   // "population" | "name" | "theme"
key     gListRequestId;

// Parallel lists describing the venues on the current page.
list gNames;
list gPopulations;
list gThemes;
list gRegions;
list gLocalX;
list gLocalY;
list gLocalZ;

integer gSelectedIndex;

// ---- UI plumbing -----------------------------------------------------------

integer channelForKey(key k)
{
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
}

showMainMenu(key avatar)
{
    gExpectedAvatar = avatar;
    gListenMode = MODE_MAIN;
    startListen();
    llDialog(avatar, "Simscape — Browse open venues", ["Browse All", "Filters", "Open Web"], DIALOG_CHANNEL);
}

showFilterMenu()
{
    gListenMode = MODE_FILTERS;
    startListen();
    llDialog(gExpectedAvatar, "Sort by:", ["Population", "Name", "Theme", "Back"], DIALOG_CHANNEL);
}

openWeb()
{
    llLoadURL(gExpectedAvatar, "Open the Simscape website?", SITE_URL);
}

// ---- Networking ------------------------------------------------------------

string orderParam()
{
    if (gSortMode == "name") return "name.asc";
    if (gSortMode == "theme") return "theme.asc,name.asc";
    return "population.desc"; // default
}

fetchVenues()
{
    string url = SUPABASE_URL +
        "/rest/v1/public_venues?select=name,population,theme,region_name,local_x,local_y,local_z" +
        "&order=" + orderParam() +
        "&limit=" + (string)PAGE_SIZE + "&offset=" + (string)(gPage * PAGE_SIZE);

    list headers = [HTTP_METHOD, "GET",
                     HTTP_MIMETYPE, "application/json",
                     HTTP_CUSTOM_HEADER, "apikey", ANON_KEY,
                     HTTP_CUSTOM_HEADER, "Authorization", "Bearer " + ANON_KEY];
    gListRequestId = llHTTPRequest(url, headers, "");
}

parseVenues(string body)
{
    gNames = [];
    gPopulations = [];
    gThemes = [];
    gRegions = [];
    gLocalX = [];
    gLocalY = [];
    gLocalZ = [];

    list elements = llJson2List(body);
    integer n = llGetListLength(elements);
    integer i;
    for (i = 0; i < n; i++)
    {
        string element = llList2String(elements, i);
        gNames       += llJsonGetValue(element, ["name"]);
        gPopulations += llJsonGetValue(element, ["population"]);
        gThemes      += llJsonGetValue(element, ["theme"]);
        gRegions     += llJsonGetValue(element, ["region_name"]);
        gLocalX      += llJsonGetValue(element, ["local_x"]);
        gLocalY      += llJsonGetValue(element, ["local_y"]);
        gLocalZ      += llJsonGetValue(element, ["local_z"]);
    }
}

// ---- List / detail dialogs --------------------------------------------

showListDialog()
{
    integer n = llGetListLength(gNames);

    if (n == 0)
    {
        gListenMode = MODE_LIST;
        startListen();
        llDialog(gExpectedAvatar, "No open venues right now.", ["Filters", "Refresh", "Back"], DIALOG_CHANNEL);
        return;
    }

    // Venue buttons are bare numbers — the actual names + population live in
    // the message text below, which has far more room than a 24-byte button
    // label does, so names don't need heavy truncation.
    list buttons;
    string text = "Simscape (page " + (string)(gPage + 1) + ", sort: " + gSortMode + ")";
    integer i;
    for (i = 0; i < n; i++)
    {
        string name = llList2String(gNames, i);
        if (llStringLength(name) > 24) name = llGetSubString(name, 0, 23) + "…";
        text += "\n" + (string)(i + 1) + ". " + name + " — " + llList2String(gPopulations, i);
        buttons += (string)(i + 1);
    }

    if (gPage > 0) buttons += "Prev";
    if (n == PAGE_SIZE) buttons += "Next"; // heuristic: a full page may mean there's more
    buttons += "Filters";
    buttons += "Back";

    gListenMode = MODE_LIST;
    startListen();
    llDialog(gExpectedAvatar, text, buttons, DIALOG_CHANNEL);
}

showDetailDialog(integer index)
{
    gSelectedIndex = index;
    string msg = llList2String(gNames, index) +
        "\nTheme: " + llList2String(gThemes, index) +
        "\nPopulation: " + llList2String(gPopulations, index) +
        "\nRegion: " + llList2String(gRegions, index);

    gListenMode = MODE_DETAIL;
    startListen();
    llDialog(gExpectedAvatar, msg, ["Teleport", "Back"], DIALOG_CHANNEL);
}

teleportToSelected()
{
    string region = llList2String(gRegions, gSelectedIndex);
    vector pos = <(float)llList2String(gLocalX, gSelectedIndex),
                   (float)llList2String(gLocalY, gSelectedIndex),
                   (float)llList2String(gLocalZ, gSelectedIndex)>;
    llMapDestination(region, pos, ZERO_VECTOR);

    string slurl = "https://maps.secondlife.com/secondlife/" + llEscapeURL(region) +
        "/" + (string)llRound(pos.x) + "/" + (string)llRound(pos.y) + "/" + (string)llRound(pos.z);
    llOwnerSay("Simscape: " + slurl);
}

// ---- Script -----------------------------------------------------------

default
{
    state_entry()
    {
        DIALOG_CHANNEL = channelForKey(llGetKey());
        gPage = 0;
        gSortMode = "population";
    }

    attach(key id)
    {
        if (id) DIALOG_CHANNEL = channelForKey(llGetKey());
    }

    touch_start(integer total_number)
    {
        showMainMenu(llDetectedKey(0));
    }

    listen(integer channel, string name, key id, string message)
    {
        if (id != gExpectedAvatar) return;
        stopListen();

        if (gListenMode == MODE_MAIN)
        {
            if (message == "Browse All")
            {
                gPage = 0;
                fetchVenues();
            }
            else if (message == "Filters")
            {
                showFilterMenu();
            }
            else if (message == "Open Web")
            {
                openWeb();
            }
        }
        else if (gListenMode == MODE_FILTERS)
        {
            if (message == "Back")
            {
                showMainMenu(gExpectedAvatar);
            }
            else
            {
                if (message == "Population") gSortMode = "population";
                else if (message == "Name") gSortMode = "name";
                else if (message == "Theme") gSortMode = "theme";
                gPage = 0;
                fetchVenues();
            }
        }
        else if (gListenMode == MODE_LIST)
        {
            if (message == "Prev")
            {
                gPage--;
                fetchVenues();
            }
            else if (message == "Next")
            {
                gPage++;
                fetchVenues();
            }
            else if (message == "Filters")
            {
                showFilterMenu();
            }
            else if (message == "Refresh")
            {
                fetchVenues();
            }
            else if (message == "Back")
            {
                showMainMenu(gExpectedAvatar);
            }
            else
            {
                integer idx = (integer)message - 1;
                if (idx >= 0 && idx < llGetListLength(gNames))
                {
                    showDetailDialog(idx);
                }
            }
        }
        else if (gListenMode == MODE_DETAIL)
        {
            if (message == "Teleport")
            {
                teleportToSelected();
            }
            else if (message == "Back")
            {
                showListDialog();
            }
        }
    }

    http_response(key request_id, integer status, list metadata, string body)
    {
        if (request_id != gListRequestId) return;

        if (status == 200)
        {
            parseVenues(body);
            showListDialog();
        }
        else
        {
            llOwnerSay("Simscape: couldn't load venues (status " + (string)status + ").");
            gListenMode = MODE_MAIN;
            startListen();
            llDialog(gExpectedAvatar, "Couldn't load venues right now.", ["Browse All", "Filters", "Open Web"], DIALOG_CHANNEL);
        }
    }
}
