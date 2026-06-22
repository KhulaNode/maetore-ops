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

## Shift interpretation

- `D` day shift = Morning In + Evening Out
- `N` night shift = Evening In + Morning Out
- `OFF` = no trip
