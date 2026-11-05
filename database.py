import os
import sqlite3
from datetime import datetime, timedelta

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bloodbank.db')

HOSPITALS = ['Hospital_1', 'Hospital_2', 'Hospital_3']
BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

HOSPITAL_METADATA = {
    'Hospital_1': {
        'name': 'Hospital_1',
        'trust_name': "St Thomas' & Guy's NHS Trust",
        'city': 'London',
        'station_code': 'LON-H1',
        'courier_hub': 'South East Cold-Chain Hub',
    },
    'Hospital_2': {
        'name': 'Hospital_2',
        'trust_name': 'Manchester Royal Infirmary Trust',
        'city': 'Manchester',
        'station_code': 'MAN-H2',
        'courier_hub': 'North West Cold-Chain Hub',
    },
    'Hospital_3': {
        'name': 'Hospital_3',
        'trust_name': 'Leeds General Infirmary Trust',
        'city': 'Leeds',
        'station_code': 'LDS-H3',
        'courier_hub': 'Yorkshire Cold-Chain Hub',
    },
}


def get_db_connection():
    """Create and return a SQLite connection with row factory enabled."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Create tables if they do not exist and seed realistic initial data if empty."""
    conn = get_db_connection()
    cursor = conn.cursor()

    # 1. users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            town TEXT NOT NULL,
            postcode TEXT NOT NULL,
            age INTEGER NOT NULL,
            blood_group TEXT NOT NULL,
            user_type TEXT NOT NULL CHECK(user_type IN ('Donor', 'Recipient'))
        )
    ''')

    # 2. blood_inventory table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS blood_inventory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hospital_name TEXT NOT NULL,
            blood_group TEXT NOT NULL,
            expiry_date DATETIME NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 0
        )
    ''')

    # 3. blood_transactions table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS blood_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hospital_name TEXT NOT NULL,
            blood_group TEXT NOT NULL,
            date DATETIME NOT NULL,
            donations INTEGER NOT NULL DEFAULT 0,
            withdrawals INTEGER NOT NULL DEFAULT 0
        )
    ''')

    # 4. blood_deliveries table (Inter-Hospital Network Dispatch & Cold-Chain Transit)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS blood_deliveries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tracking_code TEXT NOT NULL UNIQUE,
            donor_hospital TEXT NOT NULL,
            target_hospital TEXT NOT NULL,
            blood_group TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('REQUESTED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED')),
            requested_at DATETIME NOT NULL,
            dispatched_at DATETIME,
            delivered_at DATETIME,
            transit_eta_seconds INTEGER DEFAULT 60,
            temperature_celsius REAL DEFAULT 4.0,
            batch_expiry_date DATETIME,
            emergency_override INTEGER DEFAULT 0,
            notes TEXT
        )
    ''')

    conn.commit()
    seed_data(conn)
    conn.close()


def seed_data(conn):
    """Populate database with realistic UK donors/recipients, hospital stock, and historical transactions."""
    cursor = conn.cursor()

    # Seed users if empty
    cursor.execute('SELECT COUNT(*) FROM users')
    if cursor.fetchone()[0] == 0:
        sample_users = [
            ('Eleanor Vance', '07700 900123', 'eleanor.vance@nhs-mail.org.uk', 'London', 'SW1A 1AA', 29, 'O+', 'Donor'),
            ('Arthur Pendelton', '+44 7700 900456', 'a.pendelton@btinternet.co.uk', 'Manchester', 'M1 1AE', 45, 'A+', 'Donor'),
            ('Clara Oswald', '07911 123456', 'clara.oswald@cardiff.ac.uk', 'Cardiff', 'CF10 1BH', 26, 'O-', 'Donor'),
            ('Tariq Mahmood', '07822 654321', 'tariq.mahmood@leeds.gov.uk', 'Leeds', 'LS1 4AP', 38, 'B+', 'Donor'),
            ('Beatrice Hollow', '+44 7911 888222', 'b.hollow@oxford.org.uk', 'Oxford', 'OX1 2JD', 52, 'AB+', 'Recipient'),
            ('Liam Gallagher', '07712 345678', 'liam.g@manchester.co.uk', 'Manchester', 'M2 5DB', 34, 'A-', 'Donor'),
            ('Sophie Jenkins', '07456 789012', 'sophie.jenkins@bristol.ac.uk', 'Bristol', 'BS1 5TR', 22, 'O+', 'Recipient'),
            ('Davidatten Borough', '07890 112233', 'david.b@richmond.org.uk', 'London', 'TW9 1DN', 67, 'B-', 'Recipient'),
            ('Priya Patel', '+44 7555 234567', 'priya.patel@bham.ac.uk', 'Birmingham', 'B1 1BB', 31, 'A+', 'Donor'),
            ('Callum MacLeod', '07321 987654', 'callum.m@edinburgh.org.uk', 'Edinburgh', 'EH1 1YZ', 41, 'AB-', 'Donor'),
            ('Hannah Abbott', '07654 321987', 'hannah.abbott@york.co.uk', 'York', 'YO1 7HH', 24, 'O-', 'Recipient'),
            ('Marcus Sterling', '07788 445566', 'm.sterling@cambridge.ac.uk', 'Cambridge', 'CB2 1TN', 59, 'A+', 'Recipient'),
        ]
        cursor.executemany('''
            INSERT INTO users (name, phone, email, town, postcode, age, blood_group, user_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', sample_users)

    # Seed blood_inventory if empty
    # Designed with realistic stock levels:
    # - Most above threshold (>= 10)
    # - A few below threshold (< 10) and critical (< 5) while other hospitals have strong surplus (> 20)
    #   so Merge Sort Redistribution can be tested immediately.
    cursor.execute('SELECT COUNT(*) FROM blood_inventory')
    if cursor.fetchone()[0] == 0:
        now = datetime.now()
        inventory_seed = [
            # Hospital_1
            ('Hospital_1', 'A+',  (now + timedelta(days=34, hours=6)).strftime('%Y-%m-%d %H:%M:%S'), 28),
            ('Hospital_1', 'A-',  (now + timedelta(days=18, hours=14)).strftime('%Y-%m-%d %H:%M:%S'), 4),   # Critical (< 5), Hospital_2 & 3 have surplus
            ('Hospital_1', 'B+',  (now + timedelta(days=27, hours=9)).strftime('%Y-%m-%d %H:%M:%S'), 19),
            ('Hospital_1', 'B-',  (now + timedelta(days=11, hours=3)).strftime('%Y-%m-%d %H:%M:%S'), 12),
            ('Hospital_1', 'AB+', (now + timedelta(days=22, hours=18)).strftime('%Y-%m-%d %H:%M:%S'), 15),
            ('Hospital_1', 'AB-', (now - timedelta(hours=5)).strftime('%Y-%m-%d %H:%M:%S'), 7),             # Low (< 10) & Expired sample for testing timer
            ('Hospital_1', 'O+',  (now + timedelta(days=38, hours=11)).strftime('%Y-%m-%d %H:%M:%S'), 35),
            ('Hospital_1', 'O-',  (now + timedelta(days=6, hours=8)).strftime('%Y-%m-%d %H:%M:%S'), 3),     # Critical (< 5), Hospital_3 has surplus

            # Hospital_2
            ('Hospital_2', 'A+',  (now + timedelta(days=29, hours=4)).strftime('%Y-%m-%d %H:%M:%S'), 8),    # Low (< 10), Hospital_1 & 3 have surplus
            ('Hospital_2', 'A-',  (now + timedelta(days=31, hours=16)).strftime('%Y-%m-%d %H:%M:%S'), 22),
            ('Hospital_2', 'B+',  (now + timedelta(days=14, hours=20)).strftime('%Y-%m-%d %H:%M:%S'), 6),   # Low (< 10), Hospital_1 & 3 have surplus
            ('Hospital_2', 'B-',  (now + timedelta(days=25, hours=7)).strftime('%Y-%m-%d %H:%M:%S'), 16),
            ('Hospital_2', 'AB+', (now + timedelta(days=19, hours=12)).strftime('%Y-%m-%d %H:%M:%S'), 14),
            ('Hospital_2', 'AB-', (now + timedelta(days=33, hours=2)).strftime('%Y-%m-%d %H:%M:%S'), 18),
            ('Hospital_2', 'O+',  (now + timedelta(days=21, hours=15)).strftime('%Y-%m-%d %H:%M:%S'), 24),
            ('Hospital_2', 'O-',  (now + timedelta(days=16, hours=22)).strftime('%Y-%m-%d %H:%M:%S'), 14),

            # Hospital_3
            ('Hospital_3', 'A+',  (now + timedelta(days=36, hours=10)).strftime('%Y-%m-%d %H:%M:%S'), 24),
            ('Hospital_3', 'A-',  (now + timedelta(days=24, hours=5)).strftime('%Y-%m-%d %H:%M:%S'), 17),
            ('Hospital_3', 'B+',  (now + timedelta(days=32, hours=19)).strftime('%Y-%m-%d %H:%M:%S'), 25),
            ('Hospital_3', 'B-',  (now + timedelta(days=8, hours=13)).strftime('%Y-%m-%d %H:%M:%S'), 3),    # Critical (< 5), Hospital_1 & 2 have surplus
            ('Hospital_3', 'AB+', (now + timedelta(days=28, hours=1)).strftime('%Y-%m-%d %H:%M:%S'), 11),
            ('Hospital_3', 'AB-', (now + timedelta(days=35, hours=17)).strftime('%Y-%m-%d %H:%M:%S'), 21),
            ('Hospital_3', 'O+',  (now + timedelta(days=12, hours=9)).strftime('%Y-%m-%d %H:%M:%S'), 9),    # Low (< 10), Hospital_1 & 2 have surplus
            ('Hospital_3', 'O-',  (now + timedelta(days=39, hours=4)).strftime('%Y-%m-%d %H:%M:%S'), 26),
        ]
        cursor.executemany('''
            INSERT INTO blood_inventory (hospital_name, blood_group, expiry_date, quantity)
            VALUES (?, ?, ?, ?)
        ''', inventory_seed)

    # Seed blood_transactions if empty so every blood group has rich historical trend data
    cursor.execute('SELECT COUNT(*) FROM blood_transactions')
    if cursor.fetchone()[0] == 0:
        now = datetime.now()
        # Historical pattern per blood group across 10 time points over the last 30 days
        history_patterns = {
            'A+':  [(14, 4), (10, 6), (18, 5), (8, 11), (16, 4), (12, 7), (20, 6), (9, 5), (15, 6), (18, 4)],
            'A-':  [(8, 3),  (6, 5),  (10, 2), (5, 7),  (9, 3),  (7, 4),  (11, 3), (4, 6), (8, 2),  (10, 3)],
            'B+':  [(12, 5), (9, 4),  (14, 6), (7, 8),  (13, 3), (11, 5), (15, 4), (8, 6), (12, 3), (14, 5)],
            'B-':  [(6, 2),  (5, 4),  (8, 3),  (4, 6),  (7, 2),  (6, 3),  (9, 4),  (3, 5), (7, 2),  (8, 3)],
            'AB+': [(9, 3),  (7, 4),  (11, 3), (6, 5),  (10, 2), (8, 4),  (12, 5), (5, 3), (9, 4),  (11, 3)],
            'AB-': [(7, 2),  (6, 3),  (9, 2),  (5, 4),  (8, 3),  (7, 2),  (10, 3), (4, 5), (8, 2),  (9, 3)],
            'O+':  [(20, 7), (16, 9), (24, 8), (12, 14),(22, 6), (18, 9), (25, 7), (15, 8),(21, 7), (24, 6)],
            'O-':  [(11, 4), (8, 6),  (13, 3), (6, 8),  (12, 4), (9, 5),  (14, 4), (7, 6), (11, 3), (13, 4)],
        }
        tx_rows = []
        for bg, points in history_patterns.items():
            for idx, (don, wit) in enumerate(points):
                days_ago = (len(points) - idx) * 3
                tx_date = (now - timedelta(days=days_ago, hours=(idx * 2) % 12)).strftime('%Y-%m-%d %H:%M:%S')
                hosp = HOSPITALS[idx % len(HOSPITALS)]
                tx_rows.append((hosp, bg, tx_date, don, wit))

        cursor.executemany('''
            INSERT INTO blood_transactions (hospital_name, blood_group, date, donations, withdrawals)
            VALUES (?, ?, ?, ?, ?)
        ''', tx_rows)

    # Seed blood_deliveries if empty so the Network Dispatch board has live & historical shipments
    cursor.execute('SELECT COUNT(*) FROM blood_deliveries')
    if cursor.fetchone()[0] == 0:
        now = datetime.now()
        deliveries_seed = [
            (
                'NHS-TR-4810',
                'Hospital_1',
                'Hospital_2',
                'O+',
                6,
                'DELIVERED',
                (now - timedelta(hours=5, minutes=12)).strftime('%Y-%m-%d %H:%M:%S'),
                (now - timedelta(hours=5, minutes=10)).strftime('%Y-%m-%d %H:%M:%S'),
                (now - timedelta(hours=4, minutes=35)).strftime('%Y-%m-%d %H:%M:%S'),
                60,
                3.9,
                (now + timedelta(days=38, hours=11)).strftime('%Y-%m-%d %H:%M:%S'),
                0,
                'Routine regional stock replenishment via South East Cold-Chain Hub',
            ),
            (
                'NHS-TR-4819',
                'Hospital_3',
                'Hospital_1',
                'B+',
                4,
                'DELIVERED',
                (now - timedelta(hours=2, minutes=20)).strftime('%Y-%m-%d %H:%M:%S'),
                (now - timedelta(hours=2, minutes=18)).strftime('%Y-%m-%d %H:%M:%S'),
                (now - timedelta(hours=1, minutes=50)).strftime('%Y-%m-%d %H:%M:%S'),
                60,
                4.1,
                (now + timedelta(days=32, hours=19)).strftime('%Y-%m-%d %H:%M:%S'),
                0,
                'Scheduled inter-trust peer transfer',
            ),
            (
                'NHS-TR-4825',
                'Hospital_3',
                'Hospital_1',
                'O-',
                4,
                'IN_TRANSIT',
                (now - timedelta(seconds=15)).strftime('%Y-%m-%d %H:%M:%S'),
                (now - timedelta(seconds=10)).strftime('%Y-%m-%d %H:%M:%S'),
                None,
                120,
                3.8,
                (now + timedelta(days=39, hours=4)).strftime('%Y-%m-%d %H:%M:%S'),
                0,
                'Priority universal donor dispatch to St Thomas & Guys NHS Trust',
            ),
        ]
        cursor.executemany('''
            INSERT INTO blood_deliveries (
                tracking_code, donor_hospital, target_hospital, blood_group, quantity,
                status, requested_at, dispatched_at, delivered_at, transit_eta_seconds,
                temperature_celsius, batch_expiry_date, emergency_override, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', deliveries_seed)

    conn.commit()


if __name__ == '__main__':
    init_db()
    print(f'Database initialized successfully at {DB_PATH}')

