# SRM Feedback Bot

Automates filling student feedback forms on the SRM Student Portal with Playwright.

## Setup

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   playwright install chromium
   ```

2. **Create a `.env` file** with your credentials:
   ```
   SRM_USERNAME=your_net_id
   SRM_PASSWORD=your_password
   ```

## Usage

```bash
python feedback_bot.py
```

The bot will:
1. Open the SRM login page and auto-fill your credentials
2. **Wait for you** to solve the CAPTCHA and click Login
3. Automatically fill all course feedback forms with "EXCELLENT"
4. Submit each form one by one

## Configuration

Edit the `RATING` variable in `feedback_bot.py` to change the default rating.


## Mobile (Android / Termux)

The project also supports Android through Termux and Chromium, using Chrome DevTools Protocol (CDP) with `chrome-remote-interface`.

### Components

- **`mobile_bot.js`** – Node.js automation script for SRM portal interaction, feedback detection and rating selection. Supports dry-run operation.
- **`server.js`** – Local Node.js dashboard server providing bot controls and live execution logs.
- **`public/`** – Dashboard frontend.

### Requirements

- Android with Termux and Termux:X11
- Node.js and npm
- Chromium installed in Termux

### Setup and Usage

Install dependencies:

```bash
npm install
'EOF'
