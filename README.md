# HemoSync UK — Blood Bank Management & Inter-Hospital Network System

A full-stack web application refactored and modernized from a legacy Python Tkinter/MySQL desktop application into a responsive clinical portal built with **Python (Flask)**, **SQLite (`sqlite3`)**, **HTML5 & Tailwind CSS**, and **Chart.js**.

---

## Key Features & Architecture

### 1. Portable SQLite Database & Auto-Seeding (`database.py`)
- Zero-configuration local persistence in `bloodbank.db` using Python's built-in `sqlite3`.
- Automatically creates and seeds 4 relational tables on startup:
  - `users`: Registered blood **Donors** and **Recipients** across UK towns.
  - `blood_inventory`: Real-time stock across `Hospital_1` (London), `Hospital_2` (Manchester), and `Hospital_3` (Leeds) for all 8 blood groups (`A+`, `A-`, `B+`, `B-`, `AB+`, `AB-`, `O+`, `O-`).
  - `blood_transactions`: Automated ledger tracking every blood donation, withdrawal, and inter-hospital transfer.
  - `blood_deliveries`: Cold-chain inter-hospital dispatch tracking (`NHS-TR-XXXX`), batch expiry inheritance, and transit telemetry.

### 2. Core Clinical & Algorithmic Logic (`app.py`)
- **SHA-256 Authentication**: Preserves SHA-256 password verification (`admin` or individual hospital stations `hospital_1`, `hospital_2`, `hospital_3` with password `Blood bank`) backed by Flask session protection.
- **Strict UK User Registry Validation**:
  - UK Postcode regex (`^([A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})$`)
  - UK Mobile Phone regex (`^(\+44\s?7\d{3}|\(?07\d{3}\)?)\s?\d{3}\s?\d{3}$`)
  - Email format & case-insensitive duplicate email prevention
  - Donor/Recipient age validation (`18–100`)
- **Inventory & Live 1-Second Expiry Countdown**:
  - Adding blood automatically sets batch shelf-life to **+40 days** and logs a transaction.
  - Real-time 1-second JavaScript countdown timer (`Xd Xh Xm left` or `Expired`) for any selected hospital and blood group.
- **Custom Merge Sort (`O(n log n)`) Redistribution**:
  - Uses custom recursive `merge_sort()` and `merge()` functions to rank hospitals with surplus blood (`quantity > 10`) in descending order.
  - Automatically balances deficits (`< 10` low threshold, prioritizing `< 5` critical levels) across the hospital network and logs all resulting transfers.

### 3. Inter-Hospital Network Exchange & Self-Service Delivery Hub
- **Hospital Perspective Switcher**: Operate as `Hospital_1`, `Hospital_2`, `Hospital_3`, or the `Regional Network Hub` directly from the top navigation bar.
- **"Deliver to Us" Self-Service Dispatch**:
  - Request blood deliveries from partner hospitals (either manually or via `AUTO` Merge Sort routing).
  - **Surplus Protection & Emergency Override**: Standard orders require donor `quantity > 10` to protect the donor hospital's 10-unit safety reserve; an **Emergency Override** toggle allows critical patient orders to draw below 10 units.
  - **Batch Expiry Inheritance & Clinical Flagging**: Delivered units inherit the donor hospital's original batch expiry date and automatically trigger a `[CLINICAL FLAG]` if `< 5 days` shelf life remain.
  - **Live Cold-Chain Transit Tracker**: Tracks shipments in real time (`IN_TRANSIT` &rarr; `DELIVERED`) with cold-chain temperature telemetry (`3.8°C OK`), live ETA progress bars, and one-click or automatic receipt confirmation.

### 4. Interactive Chart.js Analytics
- **Blood Trend & 3-Point Moving Average**: Plots net blood stock changes (`donations - withdrawals`) over time alongside a dashed red **3-Point Moving Average** curve.
- **Hospital Stock Overview**: Horizontal bar chart comparing stock across all hospitals by blood group with a custom dashed red threshold line at `10 units`.

---

## Project Structure

```text
bloodbank-web/
├── app.py                  # Flask backend, SHA-256 auth, REST APIs & Merge Sort logic
├── database.py             # SQLite schema initialization & realistic UK seed data
├── bloodbank.db            # Local portable SQLite database (auto-generated)
├── requirements.txt        # Python dependencies (Flask)
├── templates/
│   ├── login.html          # Clinical sign-in portal with demo auto-fill
│   └── index.html          # Responsive SPA dashboard (5 clinical modules)
└── static/
    └── js/
        └── app.js          # Chart.js plugins, live 1s expiry/transit tickers & API client
```

---

## Quick Start

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```
2. **Run the server:**
   ```bash
   python app.py
   ```
3. **Open in browser:**
   Navigate to `http://127.0.0.1:5000` and sign in with:
   - **Username:** `admin` (or `hospital_1`, `hospital_2`, `hospital_3`)
   - **Password:** `Blood bank`
