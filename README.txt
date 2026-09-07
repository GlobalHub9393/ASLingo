ASLingo - Dictionary + Friends/Streaks + Reset Progress

Replace/add these ROOT files in GitHub:

REPLACE:
- main.jsx
- vite.config.js
- sw.js

ADD:
- runtime-fixes.js
- social-enhancer.js
- friends.html
- friends.jsx
- friends.css

What this update does:

1. DICTIONARY
- Repairs Signbank display labels so metadata terms such as "interrogative" do not hide common words.
- Exact gloss/translation matches are preferred.
- Ensures WHAT (Signbank 1425), WHEN, WHERE, WHICH, and WHY are present as fallbacks.
- Rebuilds every Signbank source link from the current numeric sign ID and current aslsignbank.com domain.
- Course-sign source links are repaired too.

2. FRIENDS & STREAKS (BETA)
- Adds a Friends & Streaks entry to the Profile screen.
- Opens /friends.html.
- Each user gets a shareable friend code.
- Add friends by friend code.
- Accept/decline requests and remove friends.
- Shows current streak, longest streak, total study days, and whether a friend studied today.
- Streak updates after a completed lesson or cumulative Study Quiz.
- Friends do not see email or private learning history.

3. RESET PROGRESS
- Friends page includes "Reset my progress".
- Requires browser confirmation AND typing RESET.
- Clears learning progress, quiz/mastery data, favorites, practice history, and streak.
- Keeps login/account and friends.

BACKEND:
The Friends/Streaks database migration must be applied in Neon before the social page works.
The dictionary fix does not require the migration.
