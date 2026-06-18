# Telotrade Frontend Page Pack

Generated pages:

Public/Auth:
- index.html
- features.html
- signin.html
- signup.html
- pending-approval.html
- forgot-password.html
- reset-password.html
- verify-email-result.html

App:
- dashboard.html
- portfolio.html
- orders.html
- funds.html
- settings.html
- security.html

Docs:
- docs.html
- account.html
- trade.html
- orderbook.html
- stocks.html
- history.html
- websocket.html

Shared files:
- assets/css/theme.css
- assets/js/api.js
- assets/js/ui.js

Backend assumptions:
- API base URL: https://localhost:7239
- Browser signin uses /api/account/signin?useCookie=true
- Refresh token is stored by backend as HttpOnly cookie
- Access token is stored in sessionStorage
