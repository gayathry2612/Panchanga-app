# Panchanga App

A Google Apps Script that fetches daily Panchanga data from the [Prokerala Astrology API](https://api.prokerala.com) for multiple locations across a date range, parses the full JSON response into structured Google Sheets, and feeds a Looker Studio report.

---

## Architecture

```
Config Sheet (locations + date range)
    └── Google Apps Script
            ├── OAuth2 token fetch (cached 55 min)
            ├── Date range loop per location
            ├── Calls /v2/astrology/panchang/advanced
            ├── Parses JSON → 7 typed row sets
            └── Batch writes to 7 output sheets
                    └── Looker Studio (7 data sources)
```

---

## Prerequisites

- A Google account with access to Google Sheets and Google Apps Script
- A [Prokerala API account](https://api.prokerala.com/register) with a CLIENT_ID and CLIENT_SECRET

---

## Setup

### 1. Create a Google Sheet

Open [Google Sheets](https://sheets.google.com) and create a new spreadsheet.

### 2. Open Apps Script

Go to **Extensions > Apps Script**, delete any existing code, and paste the full contents of [`appscript/panchanga.gs`](appscript/panchanga.gs). Save with **Ctrl+S**.

### 3. Set API Credentials

Reload the spreadsheet. A **🪐 Panchanga** menu will appear in the toolbar.

Go to **🪐 Panchanga > Set API Credentials** and enter your:
- `CLIENT_ID`
- `CLIENT_SECRET`

Credentials are stored securely in **Script Properties** and are never written to the sheet.

### 4. Set Up the Config Sheet

Go to **🪐 Panchanga > Setup Config Sheet**.

This creates a `Config` tab with sample locations pre-filled. Edit the rows with your own locations:

| Column | Field | Example |
|--------|-------|---------|
| A | Location Name | Mumbai |
| B | Latitude | 19.0821978 |
| C | Longitude | 72.7411014 |
| D | Timezone | Asia/Kolkata |
| E | Start Date | 2026-01-01 |
| F | End Date | 2026-01-31 |
| G | Ayanamsa | 1 (Lahiri) / 0 (Tropical) |
| H | Language | en / hi / ta / te / ml |

Leave **End Date** blank to fetch only the Start Date.

### 5. Generate the Report

Go to **🪐 Panchanga > Generate Panchanga Report**.

The script will fetch data and write results to 7 output sheets:

| Sheet | Contents |
|-------|----------|
| `Panchanga_Summary` | Sunrise, Sunset, Moonrise, Moonset, Vaara per location/date |
| `Panchanga_Nakshatra` | Nakshatra periods with lord details |
| `Panchanga_Tithi` | Tithi periods with Paksha |
| `Panchanga_Karana` | Karana periods |
| `Panchanga_Yoga` | Yoga periods |
| `Panchanga_Auspicious` | Abhijit Muhurat, Amrit Kaal, Brahma Muhurat |
| `Panchanga_Inauspicious` | Rahu Kaal, Yamaganda, Gulika, Dur Muhurat, Varjyam |

---

## Rate Limits

The Prokerala API enforces a limit of **5 requests per 60 seconds**.

The script automatically sleeps **13 seconds after every API call** to stay within this limit. This means:

| Locations | Days | Total Requests | Estimated Time |
|-----------|------|----------------|----------------|
| 1 | 31 | 31 | ~7 min |
| 2 | 31 | 62 | ~14 min |
| 5 | 31 | 155 | ~34 min |

> **Important:** Google Apps Script has an execution time limit of **6 minutes** for free Google accounts and **30 minutes** for Google Workspace accounts.
>
> If you are on a free account, run **one location at a time** to avoid hitting the execution timeout.

If you hit a `429 Too Many Requests` error, wait 60 seconds and re-run. Use **🪐 Panchanga > Clear All Output Sheets** before re-running to avoid duplicate rows.

---

## Looker Studio

Connect each output sheet as a separate data source in [Looker Studio](https://lookerstudio.google.com):

1. **Create > Report > Add Data > Google Sheets**
2. Select your spreadsheet and choose a sheet
3. Enable **Use first row as headers** and **Auto-detect data types**
4. Repeat for all 7 sheets

Recommended report pages:

| Page | Data Sources | Key Charts |
|------|-------------|------------|
| Daily Summary | Summary | Scorecards (Sunrise/Sunset), Vaara pie chart, daily table |
| Nakshatra & Tithi | Nakshatra, Tithi | Frequency bar charts, Paksha split, detail tables |
| Muhurtas | Auspicious, Inauspicious | Period tables, frequency charts, Rahu Kaal highlighted |
| Location Comparison | All | Stacked bars comparing Nakshatra/Tithi across locations |
| Yoga & Karana | Yoga, Karana | Frequency charts, detail tables |

---

## Menu Options

| Menu Item | Action |
|-----------|--------|
| ▶ Generate Panchanga Report | Fetch data and write to all output sheets |
| ⚙ Set API Credentials | Store CLIENT_ID and CLIENT_SECRET in Script Properties |
| 📋 Setup Config Sheet | Create Config tab with sample locations |
| 🗑 Clear All Output Sheets | Delete all data rows (keeps headers) |

---

## Supported Languages

| Code | Language |
|------|----------|
| `en` | English |
| `hi` | Hindi |
| `ta` | Tamil |
| `te` | Telugu |
| `ml` | Malayalam |

---

## API Reference

- **Token endpoint:** `POST https://api.prokerala.com/token`
- **Panchang endpoint:** `GET https://api.prokerala.com/v2/astrology/panchang/advanced`
- **Docs:** [api.prokerala.com](https://api.prokerala.com)
