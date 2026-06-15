# Telotrade Frontend

Telotrade is a professional stock trading simulator frontend built with HTML, CSS, and vanilla JavaScript. It connects to an ASP.NET Core backend through REST APIs and WebSockets to provide live market data, order placement, order book management, portfolio tracking, and real-time P&L updates.

The interface is designed as a premium dark trading terminal with a black/gold brand theme, live charting, keyboard shortcuts, watchlist management, order execution, and position monitoring.

---

## Features

### Trading Dashboard

* Live candlestick chart using Lightweight Charts
* Real-time WebSocket price updates
* Watchlist with live LTP updates
* Price movement flash indicators
* Active position badges in watchlist
* Buy/Sell order ticket
* Market, limit, stop-loss market, and stop-limit order support
* Flat brokerage/fee estimate
* Required cash and after-order cash preview
* Pending order lines on chart
* Trigger order lines on chart
* Average price and live P&L lines on chart
* Filled order markers on chart
* Real-time unrealized P&L
* Square off selected position
* Exit all active positions

### Order Management

* Order book with status filters
* Search orders by symbol or order ID
* Sort by latest, status, symbol, or price
* Modify pending orders
* Cancel pending orders
* Track filled, pending, trigger pending, cancelled, and rejected orders

### Account and Portfolio

* Cash balance display
* Realized P&L display
* Unrealized P&L display
* Active holdings panel
* Position type support:

  * LONG
  * SHORT
  * FLAT

### Keyboard Shortcuts

* `↑` / `↓` — Move through watchlist
* `B` — Select Buy side
* `S` — Select Sell side
* `Ctrl + Enter` — Place selected order
* `Alt + ↑` — Increase lots
* `Alt + ↓` — Decrease lots
* `1` — 1 minute chart
* `2` — 5 minute chart
* `3` — 15 minute chart
* `4` — 30 minute chart
* `5` — 1 hour chart
* `X` — Square off selected position
* `Shift + X` — Exit all positions
* `R` — Reset chart view
* `I` — Toggle SMA
* `O` — Toggle filled order markers
* `Esc` — Close modal / blur input
* `?` — Open shortcuts help

---

## Tech Stack

* HTML5
* CSS3
* Vanilla JavaScript
* Lightweight Charts
* Font Awesome
* ASP.NET Core backend
* JWT authentication
* HttpOnly refresh-token cookies
* WebSocket live market feed

---

## Project Structure

```txt
telotrade-frontend/
│
├── dashboard.html
├── dashboard.css
├── dashboard.js
├── README.md
│
├── assets/
│   ├── css/
│   │   └── theme.css
│   │
│   └── js/
│       ├── api.js
│       ├── config.js
│       └── ui.js
│
├── index.html
├── signin.html
├── signup.html
├── portfolio.html
├── orders.html
├── funds.html
├── settings.html
├── security.html
└── docs.html
```

Depending on your current version, the dashboard may exist as standalone files or as part of a larger multi-page frontend.

---

## Backend Requirements

The frontend expects the backend API to be available at:

```txt
https://localhost:7239
```

or a configured IP/domain such as:

```txt
http://192.168.1.50:7239
```

The backend should expose the following endpoints.

### Authentication

```http
POST /api/account/signin?useCookie=true
POST /api/account/refresh?useCookie=true
POST /api/account/signout?useCookie=true
GET  /api/account/details
PUT  /api/account/update
POST /api/account/change-password
POST /api/account/forgot-password
POST /api/account/reset-password
POST /api/account/resend-verification
POST /api/account/approval-request
```

### Trading

```http
POST   /api/trade/place-order
PUT    /api/trade/modify-order
DELETE /api/trade/cancel-order/{orderId}
GET    /api/orderbook
```

### Stocks and Market Data

```http
GET /api/stocks
GET /api/stocks/lot-size/{symbol}
GET /api/historicdata/{symbol}?timeFrameMinutes={n}
```

### WebSocket

```txt
/ws?token={accessToken}
```

Example:

```txt
wss://localhost:7239/ws?token=YOUR_ACCESS_TOKEN
```

---

## Configuration

The frontend should keep the backend URL in one place instead of hardcoding it across multiple pages.

Recommended config file:

```js
// assets/js/config.js

window.TELOTRADE_CONFIG = {
  API_BASE_URL: "https://localhost:7239"
};
```

For LAN testing:

```js
window.TELOTRADE_CONFIG = {
  API_BASE_URL: "http://192.168.1.50:7239"
};
```

Then load it before the main JavaScript files:

```html
<script src="assets/js/config.js"></script>
<script src="assets/js/api.js"></script>
```

For the standalone dashboard:

```html
<script src="assets/js/config.js"></script>
<script>
  window.TELOTRADE_API_BASE_URL = window.TELOTRADE_CONFIG.API_BASE_URL;
</script>
<script src="dashboard.js"></script>
```

---

## Authentication Flow

Telotrade uses a safer browser authentication model:

1. User signs in with email and password.
2. Backend returns a short-lived access token.
3. Backend stores the refresh token in an HttpOnly cookie.
4. Frontend stores only the access token in `sessionStorage`.
5. API requests use the access token in the `Authorization` header.
6. If the access token expires, the frontend calls the refresh endpoint.
7. If refresh succeeds, the original request is retried.
8. If refresh fails, the user is redirected to sign in.

Access token storage:

```js
sessionStorage.setItem("token", data.TOKEN);
```

Do not store refresh tokens in `localStorage` or `sessionStorage`.

---

## Running Locally

### Option 1: Serve Frontend with VS Code Live Server

Frontend:

```txt
http://127.0.0.1:5500
```

Backend:

```txt
https://localhost:7239
```

Make sure the backend CORS policy allows the frontend origin.

Example development CORS policy:

```csharp
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        policy.SetIsOriginAllowed(origin =>
        {
            if (string.IsNullOrWhiteSpace(origin))
                return false;

            var uri = new Uri(origin);

            return (uri.Scheme == "http" || uri.Scheme == "https") &&
                   (
                       uri.Host == "localhost" ||
                       uri.Host == "127.0.0.1" ||
                       uri.Host.StartsWith("192.168.")
                   );
        })
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials();
    });
});
```

Middleware order:

```csharp
app.UseCors("AllowFrontend");

app.UseRateLimiter();

app.UseAuthentication();
app.UseAuthorization();

app.UseTokenVersionValidation();

app.MapControllers();
```

### Option 2: Serve Frontend from ASP.NET Core

Place the frontend files inside:

```txt
wwwroot/
```

Then open:

```txt
https://localhost:7239/index.html
```

This avoids most CORS and cookie issues because the frontend and backend are served from the same origin.

---

## LAN Testing

To access the backend from another device on the same network, run the backend on all network interfaces:

```bash
dotnet run --urls "http://0.0.0.0:7239"
```

Then configure the frontend API URL:

```js
window.TELOTRADE_CONFIG = {
  API_BASE_URL: "http://YOUR_PC_IP:7239"
};
```

Example:

```js
window.TELOTRADE_CONFIG = {
  API_BASE_URL: "http://192.168.1.50:7239"
};
```

Do not use `https://192.168.x.x` unless your HTTPS certificate is valid for that IP address.

---

## WebSocket Notes

The dashboard automatically generates the WebSocket URL from the API base URL.

```txt
http  -> ws
https -> wss
```

Examples:

```txt
http://192.168.1.50:7239  -> ws://192.168.1.50:7239/ws
https://localhost:7239    -> wss://localhost:7239/ws
```

The access token is passed as a query parameter:

```txt
/ws?token={accessToken}
```

If the WebSocket disconnects, the dashboard attempts to refresh the access token and reconnect.

---

## Order Ticket Design

The order ticket is designed for safe keyboard-based trading.

Buy and Sell buttons select the order side. They do not need to immediately submit an order.

Recommended flow:

```txt
B               Select Buy
S               Select Sell
Ctrl + Enter    Place selected order
```

This prevents accidental trades and avoids browser shortcut conflicts such as `Ctrl + S`.

The ticket displays:

* Selected symbol
* Order side
* Lots
* Order type
* Limit price
* Trigger price
* Quantity
* Trade value
* Flat fee
* Required cash
* Cash after order
* Position after order

---

## Styling Guidelines

The Telotrade theme uses a premium institutional trading style.

Recommended color usage:

```txt
Gold   -> Brand, selected state, premium highlights
Green  -> Buy, profit, price up
Red    -> Sell, loss, price down
Blue   -> Neutral technical/chart information
Dark   -> Main dashboard background
```

Avoid using too much glow or heavy glassmorphism in the dashboard. The trading screen should feel professional and calm, not like a gaming interface.

---

## Local Storage Usage

The frontend may store UI preferences locally:

```txt
Selected symbol
Selected timeframe
Watchlist order
SMA visibility
Filled order marker visibility
Default lots
```

Example keys:

```txt
tt_selectedSymbol
tt_timeframe
tt_watchlist
tt_smaVisible
tt_filledOrdersVisible
```

Authentication tokens should not be stored in `localStorage`.

---

## Common Issues

### CORS Error

Error:

```txt
No 'Access-Control-Allow-Origin' header is present
```

Fix:

* Add the frontend origin to backend CORS.
* Include the correct port.
* Use `AllowCredentials()`.
* Place `UseCors()` before authentication middleware.

### Cookie Not Stored

Fix:

* Add `credentials: "include"` to fetch requests.
* Backend refresh cookie should use:

```csharp
HttpOnly = true,
Secure = true,
SameSite = SameSiteMode.None
```

For production, configure cookie policy based on your domain setup.

### WebSocket Fails

Check:

* Access token exists in `sessionStorage`.
* Backend `/ws` endpoint is reachable.
* Correct protocol is used:

  * `ws://` for HTTP
  * `wss://` for HTTPS
* Token validation succeeds on the backend.

### Chart Not Updating

Check:

* WebSocket is connected.
* Selected symbol is subscribed.
* Tick data contains `SYMBOL`, `LTP`, `LTT`, and `LTQ`.
* Historic candle endpoint returns timestamps in milliseconds.

### Wrong P&L Display

Avoid parsing formatted UI text such as:

```txt
₹1,843.22
```

Use raw numeric values stored in `data-*` attributes instead.

Example:

```html
<div
  class="holdingRow"
  data-average-price="1843.22"
  data-quantity="18"
  data-position-type="SHORT">
</div>
```

---

## Deployment Notes

For production, use a proper domain and HTTPS certificate.

Recommended structure:

```txt
Frontend: https://telotrade.com
Backend:  https://api.telotrade.com
```

Production CORS should allow only the real frontend domain:

```csharp
policy.WithOrigins("https://telotrade.com")
      .AllowAnyHeader()
      .AllowAnyMethod()
      .AllowCredentials();
```

Do not allow all origins in production when using cookies.

---

## Security Notes

* Do not store refresh tokens in JavaScript-accessible storage.
* Use HttpOnly cookies for refresh tokens.
* Use short-lived access tokens.
* Refresh tokens should be rotated.
* Sign out should revoke the current refresh token.
* Password change should invalidate active sessions.
* WebSocket authentication should validate token expiry and token version.
* Backend should validate all trading rules, even if the frontend already validates them.

---

## Future Improvements

Possible future upgrades:

* Command palette with `Ctrl + K`
* Full activity/trade log drawer
* More compact order ticket mode
* Advanced order validation hints
* Net equity calculation
* Account analytics page
* Strategy replay mode
* Export trades as CSV
* Admin approval dashboard
* Mobile-optimized dashboard mode

---

## License

This project is currently private/internal unless a license file is added.

---

## Author

Built for the Telotrade / StockSimulator project by Akhil K A.
