# Maetore Transport Services SPA/PWA v2

A lightweight HTML/CSS/JS single-page app for Sasol R71 Staff Transport.

## Features

- Brighter Maetore-themed UI based on the uploaded image
- Static JSON datastore
- Schedule split into 4 trip columns:
  - Morning In
  - Morning Out
  - Evening In
  - Evening Out
- Today view
- Passenger private page preview
- Payment page link to Paystack
- DynamoDB-ready JSON structure

## Run locally

From inside the folder:

```bash
python3 -m http.server 8080
```

Open:

```text
http://localhost:8080
```

Do not double-click `index.html`; JSON fetches may be blocked.

## Deploy to AWS Amplify

This repo is a static site. Connect the repo to Amplify and use the included `amplify.yml` at the project root. No build step is required.

## Shift interpretation

- `D` day shift = Morning In + Evening Out
- `N` night shift = Evening In + Morning Out
- `OFF` = no trip
