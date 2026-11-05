import hashlib
import random
import re
from datetime import datetime, timedelta
from functools import wraps
from flask import (
    Flask,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from database import BLOOD_GROUPS, HOSPITAL_METADATA, HOSPITALS, get_db_connection, init_db

app = Flask(__name__)
app.secret_key = 'bloodbank_modernized_secret_key_nea_2026'

THRESHOLD = 10
CRITICAL_THRESHOLD = 5

# Strict Validation Regexes preserved from Nea Real.py
POSTCODE_REGEX = re.compile(r'^([A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})$')
EMAIL_REGEX = re.compile(r'^[\w\.-]+@([\w-]+\.)+[\w-]{2,4}$')
PHONE_REGEX = re.compile(r'^(\+44\s?7\d{3}|\(?07\d{3}\)?)\s?\d{3}\s?\d{3}$')


# =====================================================================
# Custom Algorithmic Logic Preserved from Nea Real.py
# =====================================================================
def merge_sort(hospitals):
    """Recursively sort (hospital_name, quantity) tuples in descending order of quantity."""
    if len(hospitals) <= 1:
        return hospitals  # Base case: A list with 0 or 1 item
    mid = len(hospitals) // 2  # Split the list into two halves
    left_half = merge_sort(hospitals[:mid])
    right_half = merge_sort(hospitals[mid:])

    return merge(left_half, right_half)  # Merge the sorted halves


def merge(left, right):
    """Merge two descending-sorted halves of (hospital_name, quantity) tuples."""
    sorted_list = []
    i = j = 0

    while i < len(left) and j < len(right):  # Compare elements from both halves and merge them in sorted order
        if left[i][1] > right[j][1]:  # Sort in descending order by quantity
            sorted_list.append(left[i])
            i += 1
        else:
            sorted_list.append(right[j])
            j += 1

    sorted_list.extend(left[i:])  # Add any remaining elements from the left or right half
    sorted_list.extend(right[j:])

    return sorted_list


def perform_redistribution(conn, blood_group, target_hospital, data_dict):
    """
    Redistribute blood from surplus hospitals (quantity > THRESHOLD) to target_hospital
    using merge_sort to prioritize donors with the highest surplus first.
    Also logs transfers into blood_transactions.
    """
    cursor = conn.cursor()
    transfers = []

    high_supply_hospitals = [
        (hospital, quantity)
        for hospital, quantity in data_dict.get(blood_group, {}).items()
        if quantity > THRESHOLD and hospital != target_hospital
    ]
    amount_needed = THRESHOLD - data_dict[blood_group][target_hospital]

    while amount_needed > 0 and high_supply_hospitals:
        high_supply_hospitals = merge_sort(high_supply_hospitals)
        donor_hospital, available_qty = high_supply_hospitals.pop(0)
        transfer_qty = min(amount_needed, available_qty - THRESHOLD)

        if transfer_qty <= 0:
            continue

        target_before = data_dict[blood_group][target_hospital]
        donor_before = data_dict[blood_group][donor_hospital]

        data_dict[blood_group][target_hospital] += transfer_qty
        data_dict[blood_group][donor_hospital] -= transfer_qty
        amount_needed -= transfer_qty

        # If donor still has surplus > THRESHOLD after partial transfer, keep in candidate pool
        if data_dict[blood_group][donor_hospital] > THRESHOLD:
            high_supply_hospitals.append((donor_hospital, data_dict[blood_group][donor_hospital]))

        now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        # Update donor hospital inventory
        cursor.execute(
            'UPDATE blood_inventory SET quantity = quantity - ? WHERE hospital_name = ? AND blood_group = ?',
            (transfer_qty, donor_hospital, blood_group),
        )
        # Update target hospital inventory
        cursor.execute(
            'UPDATE blood_inventory SET quantity = quantity + ? WHERE hospital_name = ? AND blood_group = ?',
            (transfer_qty, target_hospital, blood_group),
        )

        # Auto-log corresponding transactions in blood_transactions
        cursor.execute(
            '''INSERT INTO blood_transactions (hospital_name, blood_group, date, donations, withdrawals)
               VALUES (?, ?, ?, ?, ?)''',
            (donor_hospital, blood_group, now_str, 0, transfer_qty),
        )
        cursor.execute(
            '''INSERT INTO blood_transactions (hospital_name, blood_group, date, donations, withdrawals)
               VALUES (?, ?, ?, ?, ?)''',
            (target_hospital, blood_group, now_str, transfer_qty, 0),
        )

        transfers.append({
            'blood_group': blood_group,
            'from_hospital': donor_hospital,
            'to_hospital': target_hospital,
            'quantity': transfer_qty,
            'donor_before': donor_before,
            'donor_after': data_dict[blood_group][donor_hospital],
            'target_before': target_before,
            'target_after': data_dict[blood_group][target_hospital],
        })

    conn.commit()
    return transfers


# =====================================================================
# Authentication Helpers (SHA-256 Verification from Nea Real.py)
# =====================================================================
def verify_credentials(username, password):
    """Verify admin or hospital node credentials using SHA-256 hash comparison as in Nea Real.py."""
    h_correct = hashlib.new('SHA256')
    h_correct.update('Blood bank'.encode())
    correct_hash = h_correct.hexdigest()

    h_input = hashlib.new('SHA256')
    h_input.update(password.encode())
    input_hash = h_input.hexdigest()

    valid_usernames = {'admin', 'hospital_1', 'hospital_2', 'hospital_3'}
    return username.lower() in valid_usernames and input_hash == correct_hash


def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('admin_logged_in'):
            if request.path.startswith('/api/'):
                return jsonify({'error': 'Unauthorized. Please log in as admin.'}), 401
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function


def compute_expiry_details(expiry_str, quantity):
    """Compute human-readable countdown and status for an inventory row."""
    if quantity <= 0:
        return {
            'formatted': 'No stock available',
            'is_expired': False,
            'no_stock': True,
            'days_left': 0,
            'hours_left': 0,
            'minutes_left': 0,
            'seconds_left': 0,
            'total_seconds': 0,
        }
    try:
        expiry_dt = datetime.strptime(expiry_str, '%Y-%m-%d %H:%M:%S')
    except ValueError:
        expiry_dt = datetime.fromisoformat(expiry_str)

    time_left = expiry_dt - datetime.now()
    total_sec = int(time_left.total_seconds())
    if total_sec > 0:
        days_left = time_left.days
        hours_left = time_left.seconds // 3600
        minutes_left = (time_left.seconds % 3600) // 60
        seconds_left = time_left.seconds % 60
        return {
            'formatted': f'{days_left}d {hours_left}h {minutes_left}m left',
            'is_expired': False,
            'no_stock': False,
            'days_left': days_left,
            'hours_left': hours_left,
            'minutes_left': minutes_left,
            'seconds_left': seconds_left,
            'total_seconds': total_sec,
        }
    else:
        return {
            'formatted': 'Expired',
            'is_expired': True,
            'no_stock': False,
            'days_left': 0,
            'hours_left': 0,
            'minutes_left': 0,
            'seconds_left': 0,
            'total_seconds': total_sec,
        }


# =====================================================================
# Page Routes
# =====================================================================
@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'GET':
        if session.get('admin_logged_in'):
            return redirect(url_for('dashboard'))
        return render_template('login.html')

    data = request.get_json(silent=True) or request.form
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''

    if verify_credentials(username, password):
        session['admin_logged_in'] = True
        session['username'] = username
        if username.lower().startswith('hospital_'):
            session['active_hospital'] = username.capitalize()
        else:
            session['active_hospital'] = 'Hospital_1'
        if request.is_json:
            return jsonify({'success': True, 'redirect': url_for('dashboard')})
        return redirect(url_for('dashboard'))

    if request.is_json:
        return jsonify({'success': False, 'error': 'Invalid admin credentials. Please check username and password.'}), 401
    return render_template('login.html', error='Invalid admin credentials. Please try again.')


@app.route('/logout', methods=['GET', 'POST'])
def logout():
    session.clear()
    if request.is_json:
        return jsonify({'success': True, 'redirect': url_for('login')})
    return redirect(url_for('login'))


@app.route('/')
@login_required
def dashboard():
    return render_template(
        'index.html',
        hospitals=HOSPITALS,
        hospital_metadata=HOSPITAL_METADATA,
        default_hospital=session.get('active_hospital', 'Hospital_1'),
        blood_groups=BLOOD_GROUPS,
        threshold=THRESHOLD,
        critical_threshold=CRITICAL_THRESHOLD,
        username=session.get('username', 'admin'),
    )


# =====================================================================
# REST API Endpoints
# =====================================================================
@app.route('/api/summary', methods=['GET'])
@login_required
def api_summary():
    """Return high-level dashboard KPIs, low/critical alerts, and recent transactions."""
    conn = get_db_connection()
    cursor = conn.cursor()

    # Total blood units & alerts
    cursor.execute('SELECT id, hospital_name, blood_group, expiry_date, quantity FROM blood_inventory')
    inv_rows = cursor.fetchall()

    total_units = 0
    critical_items = []
    low_items = []
    expired_items = []

    # Build data_dict for checking whether surplus exists for each blood group
    data_dict = {bg: {h: 0 for h in HOSPITALS} for bg in BLOOD_GROUPS}
    for row in inv_rows:
        data_dict[row['blood_group']][row['hospital_name']] = row['quantity']

    for row in inv_rows:
        qty = row['quantity']
        total_units += qty
        exp_info = compute_expiry_details(row['expiry_date'], qty)
        surplus_donors = merge_sort([
            (h, q) for h, q in data_dict[row['blood_group']].items()
            if q > THRESHOLD and h != row['hospital_name']
        ])
        available_surplus = sum(q - THRESHOLD for _, q in surplus_donors)

        item_summary = {
            'id': row['id'],
            'hospital_name': row['hospital_name'],
            'blood_group': row['blood_group'],
            'quantity': qty,
            'needed_for_threshold': max(0, THRESHOLD - qty),
            'available_surplus': available_surplus,
            'top_donor': surplus_donors[0][0] if surplus_donors else None,
            'expiry_date': row['expiry_date'],
            'expiry': exp_info,
        }
        if qty < CRITICAL_THRESHOLD:
            item_summary['severity'] = 'critical'
            critical_items.append(item_summary)
            low_items.append(item_summary)
        elif qty < THRESHOLD:
            item_summary['severity'] = 'low'
            low_items.append(item_summary)

        if exp_info['is_expired']:
            expired_items.append(item_summary)

    # Users count
    cursor.execute("SELECT user_type, COUNT(*) as cnt FROM users GROUP BY user_type")
    user_counts = {'Donor': 0, 'Recipient': 0}
    for r in cursor.fetchall():
        user_counts[r['user_type']] = r['cnt']

    # Recent transactions
    cursor.execute('''
        SELECT id, hospital_name, blood_group, date, donations, withdrawals
        FROM blood_transactions
        ORDER BY date DESC, id DESC
        LIMIT 10
    ''')
    recent_tx = [dict(r) for r in cursor.fetchall()]

    # Active in-transit network deliveries
    cursor.execute("SELECT COUNT(*) FROM blood_deliveries WHERE status = 'IN_TRANSIT'")
    in_transit_count = cursor.fetchone()[0]

    conn.close()
    return jsonify({
        'total_units': total_units,
        'total_donors': user_counts['Donor'],
        'total_recipients': user_counts['Recipient'],
        'total_users': user_counts['Donor'] + user_counts['Recipient'],
        'critical_count': len(critical_items),
        'low_count': len(low_items),
        'expired_count': len(expired_items),
        'in_transit_count': in_transit_count,
        'critical_items': critical_items,
        'low_items': low_items,
        'expired_items': expired_items,
        'recent_transactions': recent_tx,
        'threshold': THRESHOLD,
        'critical_threshold': CRITICAL_THRESHOLD,
    })


# ---------------------------------------------------------------------
# User Management Endpoints
# ---------------------------------------------------------------------
@app.route('/api/users', methods=['GET'])
@login_required
def api_get_users():
    search = (request.args.get('search') or '').strip()
    user_type = (request.args.get('user_type') or '').strip()
    blood_group = (request.args.get('blood_group') or '').strip()

    conn = get_db_connection()
    cursor = conn.cursor()

    query = 'SELECT id, name, phone, email, town, postcode, age, blood_group, user_type FROM users WHERE 1=1'
    params = []

    if search:
        query += ' AND (name LIKE ? OR email LIKE ? OR town LIKE ? OR postcode LIKE ? OR phone LIKE ?)'
        wildcard = f'%{search}%'
        params.extend([wildcard, wildcard, wildcard, wildcard, wildcard])

    if user_type in ('Donor', 'Recipient'):
        query += ' AND user_type = ?'
        params.append(user_type)

    if blood_group in BLOOD_GROUPS:
        query += ' AND blood_group = ?'
        params.append(blood_group)

    query += ' ORDER BY id DESC'
    cursor.execute(query, params)
    users = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return jsonify({'users': users})


@app.route('/api/users', methods=['POST'])
@login_required
def api_add_user():
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    phone_number = (data.get('phone') or '').strip()
    email_address = (data.get('email') or '').strip()
    town = (data.get('town') or '').strip()
    postcode = (data.get('postcode') or '').strip().upper()
    age_raw = str(data.get('age') or '').strip()
    blood_group = (data.get('blood_group') or '').strip().upper()
    user_type = (data.get('user_type') or '').strip()

    # Preserve exact validation rules from Nea Real.py
    if not all([name, phone_number, email_address, town, postcode, age_raw, blood_group, user_type]):
        return jsonify({'error': 'All fields are required.'}), 400

    if not POSTCODE_REGEX.match(postcode):
        return jsonify({'error': 'Postcode not valid. Please enter a valid UK postcode (e.g., SW1A 1AA).'}), 400

    if not EMAIL_REGEX.match(email_address):
        return jsonify({'error': 'Email not valid. Please enter a valid email address.'}), 400

    if not PHONE_REGEX.match(phone_number):
        return jsonify({'error': 'Phone number not valid. Please enter a valid UK mobile number (e.g., 07700 900123 or +44 7700 900123).'}), 400

    if not age_raw.isdigit():
        return jsonify({'error': 'Age must be a valid number.'}), 400

    age_int = int(age_raw)
    if age_int < 18 or age_int > 100:
        return jsonify({'error': 'Age must be between 18 and 100.'}), 400

    if blood_group not in BLOOD_GROUPS:
        return jsonify({'error': f'Blood group must be one of {", ".join(BLOOD_GROUPS)}.'}), 400

    if user_type not in ('Donor', 'Recipient'):
        return jsonify({'error': 'User type must be Donor or Recipient.'}), 400

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute('SELECT email FROM users WHERE LOWER(email) = LOWER(?)', (email_address,))
    if cursor.fetchone():
        conn.close()
        return jsonify({'error': f'User email {email_address} already exists.'}), 409

    cursor.execute(
        '''INSERT INTO users (name, phone, email, town, postcode, age, blood_group, user_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
        (name, phone_number, email_address, town, postcode, age_int, blood_group, user_type),
    )
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()

    return jsonify({
        'message': f'{user_type} {name} was successfully added.',
        'user': {
            'id': new_id,
            'name': name,
            'phone': phone_number,
            'email': email_address,
            'town': town,
            'postcode': postcode,
            'age': age_int,
            'blood_group': blood_group,
            'user_type': user_type,
        },
    }), 201


@app.route('/api/users/<int:user_id>', methods=['DELETE'])
@login_required
def api_delete_user(user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT id, name, user_type FROM users WHERE id = ?', (user_id,))
    user = cursor.fetchone()
    if not user:
        conn.close()
        return jsonify({'error': 'User not found in the database.'}), 404

    cursor.execute('DELETE FROM users WHERE id = ?', (user_id,))
    conn.commit()
    conn.close()
    return jsonify({'message': f"User {user['name']} was successfully deleted."})


# ---------------------------------------------------------------------
# Inventory Management & Live Expiry Tracker Endpoints
# ---------------------------------------------------------------------
@app.route('/api/inventory', methods=['GET'])
@login_required
def api_get_inventory():
    hospital_filter = (request.args.get('hospital') or '').strip()
    blood_group_filter = (request.args.get('blood_group') or '').strip()
    sort_order = (request.args.get('sort') or '').strip().lower()  # 'asc', 'desc', or ''

    conn = get_db_connection()
    cursor = conn.cursor()

    query = 'SELECT id, hospital_name, blood_group, expiry_date, quantity FROM blood_inventory WHERE 1=1'
    params = []

    if hospital_filter in HOSPITALS:
        query += ' AND hospital_name = ?'
        params.append(hospital_filter)

    if blood_group_filter in BLOOD_GROUPS:
        query += ' AND blood_group = ?'
        params.append(blood_group_filter)

    if sort_order == 'asc':
        query += ' ORDER BY quantity ASC, hospital_name ASC, blood_group ASC'
    elif sort_order == 'desc':
        query += ' ORDER BY quantity DESC, hospital_name ASC, blood_group ASC'
    else:
        query += ' ORDER BY hospital_name ASC, blood_group ASC'

    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()

    inventory = []
    for r in rows:
        qty = r['quantity']
        exp = compute_expiry_details(r['expiry_date'], qty)
        if qty < CRITICAL_THRESHOLD:
            status = 'critical'
        elif qty < THRESHOLD:
            status = 'low'
        else:
            status = 'optimal'

        inventory.append({
            'id': r['id'],
            'hospital_name': r['hospital_name'],
            'blood_group': r['blood_group'],
            'expiry_date': r['expiry_date'],
            'quantity': qty,
            'status': status,
            'expiry': exp,
        })

    return jsonify({
        'inventory': inventory,
        'server_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
    })


@app.route('/api/inventory/expiry', methods=['GET'])
@login_required
def api_get_expiry():
    """Return earliest expiring batch for a selected hospital and blood group."""
    hospital_name = (request.args.get('hospital_name') or '').strip()
    blood_group = (request.args.get('blood_group') or '').strip().upper()

    if not hospital_name or not blood_group:
        return jsonify({'error': 'Select both a Hospital and Blood Group to track expiry.'}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        '''SELECT expiry_date, quantity
           FROM blood_inventory
           WHERE blood_group = ? AND hospital_name = ?
           ORDER BY expiry_date ASC LIMIT 1''',
        (blood_group, hospital_name),
    )
    row = cursor.fetchone()
    conn.close()

    if not row or row['quantity'] <= 0:
        return jsonify({
            'hospital_name': hospital_name,
            'blood_group': blood_group,
            'quantity': 0,
            'expiry_date': None,
            'server_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'expiry': compute_expiry_details('', 0),
        })

    exp_details = compute_expiry_details(row['expiry_date'], row['quantity'])
    return jsonify({
        'hospital_name': hospital_name,
        'blood_group': blood_group,
        'quantity': row['quantity'],
        'expiry_date': row['expiry_date'],
        'server_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'expiry': exp_details,
    })


@app.route('/api/inventory/add', methods=['POST'])
@login_required
def api_add_blood():
    data = request.get_json(silent=True) or {}
    hospital_name = (data.get('hospital_name') or '').strip()
    blood_group = (data.get('blood_group') or '').strip().upper()
    quantity_raw = str(data.get('quantity') or '').strip()

    if not hospital_name or not blood_group or not quantity_raw:
        return jsonify({'error': 'Please enter hospital, blood group, and quantity.'}), 400

    if hospital_name not in HOSPITALS:
        return jsonify({'error': 'Invalid hospital selected.'}), 400

    if blood_group not in BLOOD_GROUPS:
        return jsonify({'error': f'Invalid blood group. Choose from {", ".join(BLOOD_GROUPS)}.'}), 400

    if not quantity_raw.isdigit():
        return jsonify({'error': 'Quantity must be a positive whole number.'}), 400

    quantity_int = int(quantity_raw)
    if quantity_int <= 0:
        return jsonify({'error': 'The quantity should be a positive number.'}), 400

    now = datetime.now()
    now_str = now.strftime('%Y-%m-%d %H:%M:%S')
    expiry_date_str = (now + timedelta(days=40)).strftime('%Y-%m-%d %H:%M:%S')

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute(
        'SELECT id, quantity FROM blood_inventory WHERE hospital_name = ? AND blood_group = ?',
        (hospital_name, blood_group),
    )
    existing = cursor.fetchone()
    if existing:
        cursor.execute(
            '''UPDATE blood_inventory
               SET quantity = quantity + ?, expiry_date = ?
               WHERE id = ?''',
            (quantity_int, expiry_date_str, existing['id']),
        )
    else:
        cursor.execute(
            '''INSERT INTO blood_inventory (hospital_name, blood_group, expiry_date, quantity)
               VALUES (?, ?, ?, ?)''',
            (hospital_name, blood_group, expiry_date_str, quantity_int),
        )

    # Auto-log donation transaction into blood_transactions
    cursor.execute(
        '''INSERT INTO blood_transactions (hospital_name, blood_group, date, donations, withdrawals)
           VALUES (?, ?, ?, ?, ?)''',
        (hospital_name, blood_group, now_str, quantity_int, 0),
    )

    conn.commit()
    conn.close()

    return jsonify({
        'message': f'Added {quantity_int} units of {blood_group} blood to {hospital_name} (Expiry set to +40 days: {expiry_date_str}).',
        'expiry_date': expiry_date_str,
    })


@app.route('/api/inventory/remove', methods=['POST'])
@login_required
def api_remove_blood():
    data = request.get_json(silent=True) or {}
    hospital_name = (data.get('hospital_name') or '').strip()
    blood_group = (data.get('blood_group') or '').strip().upper()
    quantity_raw = str(data.get('quantity') or '').strip()

    if not hospital_name or not blood_group or not quantity_raw:
        return jsonify({'error': 'Please enter hospital, blood group, and quantity.'}), 400

    if hospital_name not in HOSPITALS:
        return jsonify({'error': 'Invalid hospital selected.'}), 400

    if blood_group not in BLOOD_GROUPS:
        return jsonify({'error': f'Invalid blood group. Choose from {", ".join(BLOOD_GROUPS)}.'}), 400

    if not quantity_raw.isdigit():
        return jsonify({'error': 'Quantity must be a positive whole number.'}), 400

    quantity_int = int(quantity_raw)
    if quantity_int <= 0:
        return jsonify({'error': 'Quantity should be positive.'}), 400

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute(
        'SELECT id, quantity FROM blood_inventory WHERE blood_group = ? AND hospital_name = ?',
        (blood_group, hospital_name),
    )
    result = cursor.fetchone()

    if not result or result['quantity'] < quantity_int:
        available = result['quantity'] if result else 0
        conn.close()
        return jsonify({
            'error': f'Not enough blood in stock at {hospital_name} for {blood_group} (Available: {available} units, Requested: {quantity_int} units).'
        }), 400

    now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    cursor.execute(
        'UPDATE blood_inventory SET quantity = quantity - ? WHERE id = ?',
        (quantity_int, result['id']),
    )

    # Auto-log withdrawal transaction into blood_transactions
    cursor.execute(
        '''INSERT INTO blood_transactions (hospital_name, blood_group, date, donations, withdrawals)
           VALUES (?, ?, ?, ?, ?)''',
        (hospital_name, blood_group, now_str, 0, quantity_int),
    )

    conn.commit()
    conn.close()

    return jsonify({
        'message': f'Removed {quantity_int} units of {blood_group} blood from {hospital_name}.',
    })


@app.route('/api/inventory/redistribute', methods=['POST'])
@login_required
def api_redistribute_blood():
    """
    Trigger the custom Merge Sort redistribution algorithm.
    Can redistribute for a specific (hospital_name, blood_group) or across all low-stock items.
    """
    data = request.get_json(silent=True) or {}
    target_hospital = (data.get('hospital_name') or '').strip()
    blood_group = (data.get('blood_group') or '').strip().upper()

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT hospital_name, blood_group, quantity FROM blood_inventory')
    rows = cursor.fetchall()

    data_dict = {bg: {h: 0 for h in HOSPITALS} for bg in BLOOD_GROUPS}
    for r in rows:
        data_dict[r['blood_group']][r['hospital_name']] = r['quantity']

    all_transfers = []
    unmet_deficits = []

    if target_hospital and blood_group:
        if target_hospital not in HOSPITALS or blood_group not in BLOOD_GROUPS:
            conn.close()
            return jsonify({'error': 'Invalid hospital or blood group specified.'}), 400

        if data_dict[blood_group][target_hospital] >= THRESHOLD:
            conn.close()
            return jsonify({
                'message': f'{target_hospital} already has {data_dict[blood_group][target_hospital]} units of {blood_group} (at or above threshold of {THRESHOLD}).',
                'transfers': [],
            })

        transfers = perform_redistribution(conn, blood_group, target_hospital, data_dict)
        all_transfers.extend(transfers)
        if data_dict[blood_group][target_hospital] < THRESHOLD:
            unmet_deficits.append({
                'hospital_name': target_hospital,
                'blood_group': blood_group,
                'remaining_deficit': THRESHOLD - data_dict[blood_group][target_hospital],
            })
    else:
        # Run redistribution across all hospitals and blood groups below THRESHOLD
        # Prioritize critical (< 5) deficits first
        deficits = []
        for h in HOSPITALS:
            for bg in BLOOD_GROUPS:
                if data_dict[bg][h] < THRESHOLD:
                    deficits.append((data_dict[bg][h], h, bg))
        deficits.sort(key=lambda x: x[0])

        for _, h, bg in deficits:
            if data_dict[bg][h] < THRESHOLD:
                transfers = perform_redistribution(conn, bg, h, data_dict)
                all_transfers.extend(transfers)
                if data_dict[bg][h] < THRESHOLD:
                    unmet_deficits.append({
                        'hospital_name': h,
                        'blood_group': bg,
                        'remaining_deficit': THRESHOLD - data_dict[bg][h],
                    })

    conn.close()

    if not all_transfers and unmet_deficits:
        return jsonify({
            'error': 'Unable to redistribute: no other hospital has surplus stock above the 10-unit threshold for the requested blood group(s).',
            'transfers': [],
            'unmet_deficits': unmet_deficits,
        }), 400

    if not all_transfers:
        return jsonify({
            'message': 'All hospital blood stocks are already at or above the 10-unit threshold.',
            'transfers': [],
            'unmet_deficits': [],
        })

    total_moved = sum(t['quantity'] for t in all_transfers)
    return jsonify({
        'message': f'Merge Sort Redistribution complete: transferred {total_moved} units across {len(all_transfers)} hospital transfer(s).',
        'transfers': all_transfers,
        'unmet_deficits': unmet_deficits,
    })


# ---------------------------------------------------------------------
# Analytics & Chart.js Endpoints
# ---------------------------------------------------------------------
@app.route('/api/analytics/trend', methods=['GET'])
@login_required
def api_analytics_trend():
    """
    Calculate Net Blood Stock over time and the 3-Point Moving Average
    preserving the exact logic from handle_plot_blood_trend in Nea Real.py.
    """
    blood_group = (request.args.get('blood_group') or 'A+').strip().upper()
    hospital_name = (request.args.get('hospital_name') or '').strip()

    if blood_group not in BLOOD_GROUPS:
        return jsonify({'error': 'Invalid blood group selected.'}), 400

    conn = get_db_connection()
    cursor = conn.cursor()

    if hospital_name in HOSPITALS:
        cursor.execute(
            '''SELECT id, hospital_name, blood_group, date, donations, withdrawals
               FROM blood_transactions
               WHERE blood_group = ? AND hospital_name = ?
               ORDER BY date ASC, id ASC''',
            (blood_group, hospital_name),
        )
    else:
        cursor.execute(
            '''SELECT id, hospital_name, blood_group, date, donations, withdrawals
               FROM blood_transactions
               WHERE blood_group = ?
               ORDER BY date ASC, id ASC''',
            (blood_group,),
        )

    rows = cursor.fetchall()
    conn.close()

    dates = [r['date'] for r in rows]
    donations = [r['donations'] for r in rows]
    withdrawals = [r['withdrawals'] for r in rows]

    # Exact calculation from Nea Real.py lines 350-355:
    sub_totals = [donation - withdrawal for donation, withdrawal in zip(donations, withdrawals)]

    avg_change_over_time = []
    for i in range(len(sub_totals)):
        window = sub_totals[max(0, i - 2): i + 1]  # last 3 points (or fewer if at start)
        avg_change_over_time.append(round(sum(window) / len(window), 2))

    transactions = [
        {
            'id': r['id'],
            'hospital_name': r['hospital_name'],
            'blood_group': r['blood_group'],
            'date': r['date'],
            'donations': r['donations'],
            'withdrawals': r['withdrawals'],
            'net_change': sub_totals[idx],
            'moving_avg': avg_change_over_time[idx],
        }
        for idx, r in enumerate(rows)
    ]

    return jsonify({
        'blood_group': blood_group,
        'hospital_name': hospital_name or 'All Hospitals',
        'dates': dates,
        'donations': donations,
        'withdrawals': withdrawals,
        'sub_totals': sub_totals,
        'moving_average': avg_change_over_time,
        'transactions': transactions,
    })


@app.route('/api/analytics/overview', methods=['GET'])
@login_required
def api_analytics_overview():
    """
    Return Hospital Overview stock by blood group, threshold lines,
    and Merge Sort ranked surplus hospitals per blood group.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT hospital_name, blood_group, quantity FROM blood_inventory')
    rows = cursor.fetchall()
    conn.close()

    data_dict = {bg: {h: 0 for h in HOSPITALS} for bg in BLOOD_GROUPS}
    for r in rows:
        data_dict[r['blood_group']][r['hospital_name']] = r['quantity']

    # Also compute Merge Sort rankings for surplus hospitals per blood group
    surplus_rankings = {}
    deficits = []
    for bg in BLOOD_GROUPS:
        high_supply = [(h, q) for h, q in data_dict[bg].items() if q > THRESHOLD]
        sorted_surplus = merge_sort(high_supply)
        surplus_rankings[bg] = [
            {'hospital_name': h, 'quantity': q, 'surplus_above_threshold': q - THRESHOLD}
            for h, q in sorted_surplus
        ]
        for h in HOSPITALS:
            qty = data_dict[bg][h]
            if qty < THRESHOLD:
                deficits.append({
                    'hospital_name': h,
                    'blood_group': bg,
                    'quantity': qty,
                    'deficit': THRESHOLD - qty,
                    'severity': 'critical' if qty < CRITICAL_THRESHOLD else 'low',
                })

    return jsonify({
        'hospitals': HOSPITALS,
        'blood_groups': BLOOD_GROUPS,
        'data_dict': data_dict,
        'threshold': THRESHOLD,
        'critical_threshold': CRITICAL_THRESHOLD,
        'surplus_rankings': surplus_rankings,
        'deficits': deficits,
    })


# ---------------------------------------------------------------------
# Inter-Hospital Network Exchange & Self-Service Delivery Endpoints
# ---------------------------------------------------------------------
def serialize_delivery_row(row):
    """Serialize a blood_deliveries SQLite row with live ETA & clinical expiry flags."""
    d = dict(row)
    now = datetime.now()
    eta_total = d.get('transit_eta_seconds') or 60

    if d['status'] == 'IN_TRANSIT' and d.get('dispatched_at'):
        try:
            disp_dt = datetime.strptime(d['dispatched_at'], '%Y-%m-%d %H:%M:%S')
        except ValueError:
            disp_dt = now
        elapsed = max(0, int((now - disp_dt).total_seconds()))
        remaining = max(0, eta_total - elapsed)
        progress_pct = min(100, int((elapsed / max(1, eta_total)) * 100))
    elif d['status'] == 'DELIVERED':
        remaining = 0
        progress_pct = 100
    else:
        remaining = eta_total
        progress_pct = 0

    batch_exp_str = d.get('batch_expiry_date') or (now + timedelta(days=30)).strftime('%Y-%m-%d %H:%M:%S')
    exp_details = compute_expiry_details(batch_exp_str, d['quantity'])
    short_expiry_flag = exp_details['is_expired'] or exp_details['days_left'] < 5

    d['remaining_eta_seconds'] = remaining
    d['progress_pct'] = progress_pct
    d['batch_expiry'] = exp_details
    d['short_expiry_flag'] = short_expiry_flag
    d['emergency_override'] = bool(d.get('emergency_override'))
    d['donor_meta'] = HOSPITAL_METADATA.get(d['donor_hospital'], {'name': d['donor_hospital'], 'trust_name': d['donor_hospital'], 'city': 'UK'})
    d['target_meta'] = HOSPITAL_METADATA.get(d['target_hospital'], {'name': d['target_hospital'], 'trust_name': d['target_hospital'], 'city': 'UK'})
    return d


@app.route('/api/network/nodes', methods=['GET'])
@login_required
def api_network_nodes():
    """Return status, reserves, deficits, and transit counts for all hospital nodes."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute('SELECT hospital_name, blood_group, expiry_date, quantity FROM blood_inventory')
    inv_rows = cursor.fetchall()

    cursor.execute("SELECT donor_hospital, target_hospital, quantity FROM blood_deliveries WHERE status = 'IN_TRANSIT'")
    transit_rows = cursor.fetchall()
    conn.close()

    nodes = []
    for h in HOSPITALS:
        h_inv = [r for r in inv_rows if r['hospital_name'] == h]
        total_units = sum(r['quantity'] for r in h_inv)
        surplus_groups = [r['blood_group'] for r in h_inv if r['quantity'] > THRESHOLD]
        surplus_units = sum(max(0, r['quantity'] - THRESHOLD) for r in h_inv)
        low_groups = [r['blood_group'] for r in h_inv if r['quantity'] < THRESHOLD]
        critical_groups = [r['blood_group'] for r in h_inv if r['quantity'] < CRITICAL_THRESHOLD]

        incoming = sum(1 for t in transit_rows if t['target_hospital'] == h)
        outgoing = sum(1 for t in transit_rows if t['donor_hospital'] == h)

        meta = HOSPITAL_METADATA.get(h, {})
        nodes.append({
            'hospital_name': h,
            'trust_name': meta.get('trust_name', h),
            'city': meta.get('city', 'UK'),
            'station_code': meta.get('station_code', h),
            'courier_hub': meta.get('courier_hub', 'Regional Hub'),
            'status': 'ONLINE',
            'total_units': total_units,
            'surplus_units': surplus_units,
            'surplus_groups': surplus_groups,
            'low_groups': low_groups,
            'critical_groups': critical_groups,
            'incoming_shipments': incoming,
            'outgoing_shipments': outgoing,
        })

    return jsonify({'nodes': nodes, 'threshold': THRESHOLD})


@app.route('/api/network/catalog', methods=['GET'])
@login_required
def api_network_catalog():
    """
    Return cross-hospital blood catalog available for delivery to the requesting hospital.
    Uses custom merge_sort() to rank donor hospitals by highest stock/surplus.
    """
    requesting_hospital = (request.args.get('hospital') or '').strip()
    blood_group_filter = (request.args.get('blood_group') or '').strip().upper()

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT id, hospital_name, blood_group, expiry_date, quantity FROM blood_inventory')
    rows = cursor.fetchall()
    conn.close()

    # Build lookup by (hospital, blood_group)
    inv_map = {}
    data_dict = {bg: {} for bg in BLOOD_GROUPS}
    for r in rows:
        inv_map[(r['hospital_name'], r['blood_group'])] = dict(r)
        data_dict[r['blood_group']][r['hospital_name']] = r['quantity']

    other_hospitals = [h for h in HOSPITALS if h != requesting_hospital] if requesting_hospital in HOSPITALS else list(HOSPITALS)

    # Nodes list (excluding self when a specific hospital node is selected)
    nodes = []
    for h in other_hospitals:
        meta = HOSPITAL_METADATA.get(h, {})
        stock_items = []
        for bg in BLOOD_GROUPS:
            if blood_group_filter in BLOOD_GROUPS and bg != blood_group_filter:
                continue
            item = inv_map.get((h, bg), {'quantity': 0, 'expiry_date': ''})
            qty = item['quantity']
            exp = compute_expiry_details(item['expiry_date'], qty)
            short_expiry_flag = (not exp['no_stock']) and (exp['is_expired'] or exp['days_left'] < 5)
            stock_items.append({
                'hospital_name': h,
                'blood_group': bg,
                'quantity': qty,
                'surplus_available': max(0, qty - THRESHOLD),
                'emergency_available': max(0, qty),
                'expiry_date': item['expiry_date'],
                'expiry': exp,
                'short_expiry_flag': short_expiry_flag,
            })
        nodes.append({
            'hospital_name': h,
            'trust_name': meta.get('trust_name', h),
            'city': meta.get('city', 'UK'),
            'station_code': meta.get('station_code', h),
            'inventory': stock_items,
        })

    # Merge-sort ranked donor options per blood group
    catalog_by_group = {}
    for bg in BLOOD_GROUPS:
        candidate_tuples = [
            (h, data_dict[bg].get(h, 0))
            for h in other_hospitals
        ]
        sorted_candidates = merge_sort(candidate_tuples)
        ranked_list = []
        for donor_h, qty in sorted_candidates:
            item = inv_map.get((donor_h, bg), {'quantity': 0, 'expiry_date': ''})
            exp = compute_expiry_details(item['expiry_date'], qty)
            short_expiry_flag = (not exp['no_stock']) and (exp['is_expired'] or exp['days_left'] < 5)
            meta = HOSPITAL_METADATA.get(donor_h, {})
            ranked_list.append({
                'donor_hospital': donor_h,
                'trust_name': meta.get('trust_name', donor_h),
                'city': meta.get('city', 'UK'),
                'quantity': qty,
                'surplus_available': max(0, qty - THRESHOLD),
                'emergency_available': max(0, qty),
                'expiry_date': item['expiry_date'],
                'expiry': exp,
                'short_expiry_flag': short_expiry_flag,
            })
        catalog_by_group[bg] = ranked_list

    # Deficits for the requesting hospital (or across all hospitals if ALL)
    target_hospitals = [requesting_hospital] if requesting_hospital in HOSPITALS else list(HOSPITALS)
    self_deficits = []
    for th in target_hospitals:
        for bg in BLOOD_GROUPS:
            qty = data_dict[bg].get(th, 0)
            if qty < THRESHOLD:
                donor_candidates = merge_sort([
                    (dh, data_dict[bg].get(dh, 0))
                    for dh in HOSPITALS if dh != th and data_dict[bg].get(dh, 0) > THRESHOLD
                ])
                best_donor = donor_candidates[0][0] if donor_candidates else None
                best_donor_surplus = (donor_candidates[0][1] - THRESHOLD) if donor_candidates else 0
                self_deficits.append({
                    'target_hospital': th,
                    'blood_group': bg,
                    'current_quantity': qty,
                    'needed_for_threshold': THRESHOLD - qty,
                    'severity': 'critical' if qty < CRITICAL_THRESHOLD else 'low',
                    'recommended_donor': best_donor,
                    'recommended_donor_surplus': best_donor_surplus,
                })

    return jsonify({
        'requesting_hospital': requesting_hospital or 'ALL',
        'nodes': nodes,
        'catalog_by_group': catalog_by_group,
        'self_deficits': self_deficits,
        'threshold': THRESHOLD,
    })


@app.route('/api/network/dispatch', methods=['POST'])
@login_required
def api_network_dispatch():
    """
    Create and dispatch an inter-hospital blood delivery order ('Deliver to Us').
    - Standard mode requires donor quantity > THRESHOLD (10) and preserves safety reserve.
    - Emergency Override mode allows drawing down donor stock below 10 for critical clinical needs.
    - Delivered batch inherits the donor batch's original expiry_date (with a clinical flag if < 5 days).
    """
    data = request.get_json(silent=True) or {}
    target_hospital = (data.get('target_hospital') or '').strip()
    donor_hospital = (data.get('donor_hospital') or '').strip()
    blood_group = (data.get('blood_group') or '').strip().upper()
    quantity_raw = str(data.get('quantity') or '').strip()
    emergency_override = bool(data.get('emergency_override', False))
    express_delivery = bool(data.get('express_delivery', False))
    transit_seconds_raw = data.get('transit_seconds', 45)
    notes = (data.get('notes') or '').strip()

    if target_hospital not in HOSPITALS:
        return jsonify({'success': False, 'error': 'Please select a valid destination hospital (Hospital_1, Hospital_2, or Hospital_3).'}), 400

    if blood_group not in BLOOD_GROUPS:
        return jsonify({'success': False, 'error': f'Invalid blood group. Choose from {", ".join(BLOOD_GROUPS)}.'}), 400

    if not quantity_raw.isdigit() or int(quantity_raw) <= 0:
        return jsonify({'success': False, 'error': 'Quantity must be a positive whole number.'}), 400
    quantity_int = int(quantity_raw)

    try:
        transit_eta = max(5, min(600, int(transit_seconds_raw)))
    except (ValueError, TypeError):
        transit_eta = 45

    conn = get_db_connection()
    cursor = conn.cursor()

    # If donor_hospital is 'AUTO' or empty, use merge_sort to pick the highest-stock donor hospital
    if not donor_hospital or donor_hospital.upper() == 'AUTO':
        cursor.execute(
            'SELECT hospital_name, quantity FROM blood_inventory WHERE blood_group = ? AND hospital_name != ?',
            (blood_group, target_hospital),
        )
        candidates = [(r['hospital_name'], r['quantity']) for r in cursor.fetchall()]
        sorted_donors = merge_sort(candidates)
        if not sorted_donors:
            conn.close()
            return jsonify({'success': False, 'error': 'No donor hospitals available on the network.'}), 400
        donor_hospital = sorted_donors[0][0]

    if donor_hospital not in HOSPITALS:
        conn.close()
        return jsonify({'success': False, 'error': 'Invalid origin donor hospital selected.'}), 400

    if donor_hospital == target_hospital:
        conn.close()
        return jsonify({'success': False, 'error': 'Origin and destination hospitals must be different.'}), 400

    cursor.execute(
        'SELECT id, quantity, expiry_date FROM blood_inventory WHERE hospital_name = ? AND blood_group = ?',
        (donor_hospital, blood_group),
    )
    donor_row = cursor.fetchone()
    if not donor_row or donor_row['quantity'] <= 0:
        conn.close()
        return jsonify({'success': False, 'error': f'{donor_hospital} has 0 units of {blood_group} in stock.'}), 400

    donor_qty = donor_row['quantity']
    donor_expiry_str = donor_row['expiry_date']
    exp_details = compute_expiry_details(donor_expiry_str, donor_qty)

    if exp_details['is_expired']:
        conn.close()
        return jsonify({
            'success': False,
            'error': f'Cannot dispatch {blood_group} from {donor_hospital}: batch is expired ({donor_expiry_str}).'
        }), 400

    surplus_available = max(0, donor_qty - THRESHOLD)

    # Enforce Surplus Restriction unless Emergency Override is active
    if not emergency_override:
        if donor_qty <= THRESHOLD:
            conn.close()
            return jsonify({
                'success': False,
                'error': f'{donor_hospital} only has {donor_qty} units of {blood_group} (no surplus above the {THRESHOLD}-unit threshold). Enable "Emergency Override" for critical patient transfers.'
            }), 400
        if quantity_int > surplus_available:
            conn.close()
            return jsonify({
                'success': False,
                'error': f'Standard dispatch limited to {surplus_available} surplus units from {donor_hospital} (to preserve its {THRESHOLD}-unit reserve). Reduce quantity to {surplus_available} or enable "Emergency Override".'
            }), 400
    else:
        if quantity_int > donor_qty:
            conn.close()
            return jsonify({
                'success': False,
                'error': f'{donor_hospital} only has {donor_qty} total units of {blood_group} available even with Emergency Override.'
            }), 400

    now = datetime.now()
    now_str = now.strftime('%Y-%m-%d %H:%M:%S')

    # Generate unique tracking code
    tracking_code = f'NHS-TR-{random.randint(5000, 9999)}'
    cursor.execute('SELECT id FROM blood_deliveries WHERE tracking_code = ?', (tracking_code,))
    while cursor.fetchone():
        tracking_code = f'NHS-TR-{random.randint(1000, 9999)}'
        cursor.execute('SELECT id FROM blood_deliveries WHERE tracking_code = ?', (tracking_code,))

    short_expiry_flag = exp_details['days_left'] < 5
    clinical_notes = notes or f'Inter-hospital dispatch from {donor_hospital} to {target_hospital}'
    if emergency_override:
        clinical_notes = f'[EMERGENCY OVERRIDE] {clinical_notes}'
    if short_expiry_flag:
        clinical_notes = f'{clinical_notes} | [CLINICAL FLAG: Inherited batch has <5 days shelf life ({exp_details["formatted"]})]'

    # 1. Deduct from donor hospital immediately and auto-log withdrawal
    cursor.execute(
        'UPDATE blood_inventory SET quantity = quantity - ? WHERE id = ?',
        (quantity_int, donor_row['id']),
    )
    cursor.execute(
        '''INSERT INTO blood_transactions (hospital_name, blood_group, date, donations, withdrawals)
           VALUES (?, ?, ?, ?, ?)''',
        (donor_hospital, blood_group, now_str, 0, quantity_int),
    )

    temperature = round(random.uniform(3.6, 4.4), 1)
    status = 'DELIVERED' if express_delivery else 'IN_TRANSIT'
    delivered_at_str = now_str if express_delivery else None

    # 2. If express delivery, immediately credit target hospital and inherit donor batch expiry
    if express_delivery:
        cursor.execute(
            'SELECT id FROM blood_inventory WHERE hospital_name = ? AND blood_group = ?',
            (target_hospital, blood_group),
        )
        target_row = cursor.fetchone()
        if target_row:
            cursor.execute(
                'UPDATE blood_inventory SET quantity = quantity + ?, expiry_date = ? WHERE id = ?',
                (quantity_int, donor_expiry_str, target_row['id']),
            )
        else:
            cursor.execute(
                '''INSERT INTO blood_inventory (hospital_name, blood_group, expiry_date, quantity)
                   VALUES (?, ?, ?, ?)''',
                (target_hospital, blood_group, donor_expiry_str, quantity_int),
            )
        cursor.execute(
            '''INSERT INTO blood_transactions (hospital_name, blood_group, date, donations, withdrawals)
               VALUES (?, ?, ?, ?, ?)''',
            (target_hospital, blood_group, now_str, quantity_int, 0),
        )

    # 3. Insert delivery record
    cursor.execute(
        '''INSERT INTO blood_deliveries (
               tracking_code, donor_hospital, target_hospital, blood_group, quantity,
               status, requested_at, dispatched_at, delivered_at, transit_eta_seconds,
               temperature_celsius, batch_expiry_date, emergency_override, notes
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
        (
            tracking_code,
            donor_hospital,
            target_hospital,
            blood_group,
            quantity_int,
            status,
            now_str,
            now_str,
            delivered_at_str,
            transit_eta,
            temperature,
            donor_expiry_str,
            1 if emergency_override else 0,
            clinical_notes,
        ),
    )
    delivery_id = cursor.lastrowid
    conn.commit()

    cursor.execute('SELECT * FROM blood_deliveries WHERE id = ?', (delivery_id,))
    created_row = cursor.fetchone()
    conn.close()

    serialized = serialize_delivery_row(created_row)
    mode_label = 'delivered via Express Dispatch' if express_delivery else f'dispatched In Transit (ETA {transit_eta}s)'
    msg = f'Order {tracking_code}: {quantity_int} units of {blood_group} from {donor_hospital} -> {target_hospital} {mode_label}.'
    if short_expiry_flag:
        msg += f' Clinical Flag: Inherited batch has <5 days remaining ({exp_details["formatted"]}).'

    return jsonify({
        'success': True,
        'message': msg,
        'delivery': serialized,
    }), 201


@app.route('/api/network/deliveries', methods=['GET'])
@login_required
def api_network_deliveries():
    """Return active IN_TRANSIT shipments and completed delivery history."""
    hospital_filter = (request.args.get('hospital') or '').strip()

    conn = get_db_connection()
    cursor = conn.cursor()

    if hospital_filter in HOSPITALS:
        cursor.execute(
            '''SELECT * FROM blood_deliveries
               WHERE donor_hospital = ? OR target_hospital = ?
               ORDER BY id DESC LIMIT 30''',
            (hospital_filter, hospital_filter),
        )
    else:
        cursor.execute('SELECT * FROM blood_deliveries ORDER BY id DESC LIMIT 30')

    rows = cursor.fetchall()
    conn.close()

    deliveries = [serialize_delivery_row(r) for r in rows]
    active = [d for d in deliveries if d['status'] == 'IN_TRANSIT']
    completed = [d for d in deliveries if d['status'] != 'IN_TRANSIT']

    return jsonify({
        'active_deliveries': active,
        'completed_deliveries': completed,
        'total_active': len(active),
    })


@app.route('/api/network/deliveries/<int:delivery_id>/receive', methods=['POST'])
@login_required
def api_network_receive_delivery(delivery_id):
    """
    Confirm arrival and receipt of an IN_TRANSIT shipment at the destination hospital.
    Credits target hospital inventory, inherits donor batch expiry date, and auto-logs transaction.
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute('SELECT * FROM blood_deliveries WHERE id = ?', (delivery_id,))
    delivery = cursor.fetchone()
    if not delivery:
        conn.close()
        return jsonify({'success': False, 'error': 'Delivery record not found.'}), 404

    if delivery['status'] == 'DELIVERED':
        conn.close()
        return jsonify({
            'success': True,
            'message': f'Delivery {delivery["tracking_code"]} was already marked as received.',
            'delivery': serialize_delivery_row(delivery),
        })

    now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    target_hospital = delivery['target_hospital']
    blood_group = delivery['blood_group']
    quantity = delivery['quantity']
    inherited_expiry = delivery['batch_expiry_date'] or (datetime.now() + timedelta(days=40)).strftime('%Y-%m-%d %H:%M:%S')

    # Credit target hospital inventory and inherit donor batch expiry date
    cursor.execute(
        'SELECT id FROM blood_inventory WHERE hospital_name = ? AND blood_group = ?',
        (target_hospital, blood_group),
    )
    target_row = cursor.fetchone()
    if target_row:
        cursor.execute(
            'UPDATE blood_inventory SET quantity = quantity + ?, expiry_date = ? WHERE id = ?',
            (quantity, inherited_expiry, target_row['id']),
        )
    else:
        cursor.execute(
            '''INSERT INTO blood_inventory (hospital_name, blood_group, expiry_date, quantity)
               VALUES (?, ?, ?, ?)''',
            (target_hospital, blood_group, inherited_expiry, quantity),
        )

    # Auto-log receipt in blood_transactions
    cursor.execute(
        '''INSERT INTO blood_transactions (hospital_name, blood_group, date, donations, withdrawals)
           VALUES (?, ?, ?, ?, ?)''',
        (target_hospital, blood_group, now_str, quantity, 0),
    )

    cursor.execute(
        "UPDATE blood_deliveries SET status = 'DELIVERED', delivered_at = ? WHERE id = ?",
        (now_str, delivery_id),
    )
    conn.commit()

    cursor.execute('SELECT * FROM blood_deliveries WHERE id = ?', (delivery_id,))
    updated = serialize_delivery_row(cursor.fetchone())
    conn.close()

    msg = f'Shipment {updated["tracking_code"]} received! Added {quantity} units of {blood_group} to {target_hospital} (Batch expiry inherited: {inherited_expiry}).'
    if updated['short_expiry_flag']:
        msg += f' [CLINICAL FLAG: Batch has <5 days shelf life ({updated["batch_expiry"]["formatted"]})]'

    return jsonify({
        'success': True,
        'message': msg,
        'delivery': updated,
    })


# Initialize database automatically on import / startup
init_db()

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=True, use_reloader=False)
