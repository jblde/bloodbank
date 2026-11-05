/**
 * HemoSync UK — Blood Bank Management System Frontend Application
 * Implements Dashboard Overview, User Registry, Inventory + Live Expiry Tracker,
 * Merge Sort Redistribution, and Chart.js Analytics.
 */

const BLOOD_GROUP_COLORS = {
    'A+':  { bg: 'rgba(225, 29, 72, 0.82)',  border: 'rgb(225, 29, 72)' },
    'A-':  { bg: 'rgba(244, 63, 94, 0.65)',  border: 'rgb(244, 63, 94)' },
    'B+':  { bg: 'rgba(37, 99, 235, 0.82)',  border: 'rgb(37, 99, 235)' },
    'B-':  { bg: 'rgba(59, 130, 246, 0.65)', border: 'rgb(59, 130, 246)' },
    'AB+': { bg: 'rgba(124, 58, 237, 0.82)', border: 'rgb(124, 58, 237)' },
    'AB-': { bg: 'rgba(139, 92, 246, 0.65)', border: 'rgb(139, 92, 246)' },
    'O+':  { bg: 'rgba(5, 150, 105, 0.82)',  border: 'rgb(5, 150, 105)' },
    'O-':  { bg: 'rgba(217, 119, 6, 0.85)',  border: 'rgb(217, 119, 6)' },
};

// Custom Chart.js plugin to draw the dashed red threshold line at x = 10 units on horizontal bar charts
const thresholdLinePlugin = {
    id: 'thresholdLinePlugin',
    afterDraw(chart, args, options) {
        if (!options || !options.enabled) return;
        const { ctx, chartArea: { top, bottom, left, right }, scales: { x } } = chart;
        if (!x) return;

        const thresholdVal = options.threshold || 10;
        const xPos = x.getPixelForValue(thresholdVal);

        if (xPos >= left && xPos <= right) {
            ctx.save();
            ctx.beginPath();
            ctx.setLineDash([6, 5]);
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#dc2626'; // Crimson/Red dashed threshold line
            ctx.moveTo(xPos, top);
            ctx.lineTo(xPos, bottom);
            ctx.stroke();

            // Label pill
            const labelText = `Threshold (${thresholdVal})`;
            ctx.font = '600 11px Inter, sans-serif';
            const textWidth = ctx.measureText(labelText).width;
            const boxX = Math.min(Math.max(xPos - (textWidth / 2) - 6, left + 2), right - textWidth - 14);
            const boxY = top + 6;

            ctx.setLineDash([]);
            ctx.fillStyle = '#fef2f2';
            ctx.strokeStyle = '#fecaca';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(boxX, boxY, textWidth + 12, 20, 6);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#b91c1c';
            ctx.fillText(labelText, boxX + 6, boxY + 14);
            ctx.restore();
        }
    }
};

Chart.register(thresholdLinePlugin);

// Application State
let dashOverviewChartInstance = null;
let analyticsOverviewChartInstance = null;
let bloodTrendChartInstance = null;
let cachedOverviewData = null;

// Live Expiry Timer State
let trackedExpiryTarget = {
    hospital_name: 'Hospital_1',
    blood_group: 'A+',
    expiry_TimestampMs: null,
    quantity: 0,
    expiry_date_str: null
};

// =====================================================================
// Toast Notification System (Replaces browser alert())
// =====================================================================
function showToast(message, type = 'info', title = '') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const styles = {
        success: {
            bg: 'bg-white border-emerald-200',
            iconBg: 'bg-emerald-100 text-emerald-600',
            title: title || 'Success',
            titleColor: 'text-emerald-950',
            icon: `<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>`
        },
        error: {
            bg: 'bg-white border-rose-200',
            iconBg: 'bg-rose-100 text-rose-600',
            title: title || 'Validation / System Error',
            titleColor: 'text-rose-950',
            icon: `<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>`
        },
        warning: {
            bg: 'bg-white border-amber-200',
            iconBg: 'bg-amber-100 text-amber-600',
            title: title || 'Low Supply Alert',
            titleColor: 'text-amber-950',
            icon: `<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>`
        },
        info: {
            bg: 'bg-white border-slate-200',
            iconBg: 'bg-slate-100 text-slate-700',
            title: title || 'Notification',
            titleColor: 'text-slate-900',
            icon: `<path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>`
        }
    };

    const st = styles[type] || styles.info;
    const toast = document.createElement('div');
    toast.className = `pointer-events-auto rounded-2xl border ${st.bg} p-4 shadow-xl shadow-slate-900/10 flex items-start gap-3.5 transition-all duration-300`;
    toast.innerHTML = `
        <div class="h-9 w-9 rounded-xl ${st.iconBg} flex items-center justify-center shrink-0">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                ${st.icon}
            </svg>
        </div>
        <div class="flex-1 min-w-0">
            <p class="text-xs font-bold ${st.titleColor}">${escapeHtml(st.title)}</p>
            <p class="mt-0.5 text-xs text-slate-600 leading-relaxed">${escapeHtml(message)}</p>
        </div>
        <button type="button" class="text-slate-400 hover:text-slate-600 p-1 rounded-lg">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
        </button>
    `;

    toast.querySelector('button').addEventListener('click', () => toast.remove());
    container.appendChild(toast);

    setTimeout(() => {
        if (toast.parentNode) {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-8px)';
            setTimeout(() => toast.remove(), 250);
        }
    }, 5000);
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// =====================================================================
// Confirmation Modal Helper
// =====================================================================
function openConfirmModal({ title, message, onConfirm }) {
    const modal = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-modal-title');
    const msgEl = document.getElementById('confirm-modal-message');
    const cancelBtn = document.getElementById('confirm-modal-cancel');
    const acceptBtn = document.getElementById('confirm-modal-accept');

    titleEl.textContent = title || 'Confirm Action';
    msgEl.textContent = message || 'Are you sure you want to proceed?';

    modal.classList.remove('hidden');
    modal.classList.add('flex');

    const cleanup = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        cancelBtn.onclick = null;
        acceptBtn.onclick = null;
    };

    cancelBtn.onclick = cleanup;
    acceptBtn.onclick = async () => {
        cleanup();
        if (typeof onConfirm === 'function') {
            await onConfirm();
        }
    };
}

// =====================================================================
// Sidebar Navigation & View Switching
// =====================================================================
const VIEW_META = {
    dashboard: {
        title: 'Dashboard Overview',
        subtitle: 'Real-time hospital blood stock monitoring, critical supply alerts & Merge Sort redistribution'
    },
    users: {
        title: 'User Registry (Donors & Recipients)',
        subtitle: 'Strict UK postcode, mobile, email & age (18–100) validation with live search and filtering'
    },
    inventory: {
        title: 'Inventory Management & Live Expiry Tracker',
        subtitle: 'Add/withdraw blood units (+40d auto-expiry), live countdown ticker & sortable stock matrix'
    },
    analytics: {
        title: 'Analytics, Moving Average & Merge Sort Inspector',
        subtitle: 'Interactive Chart.js Net Blood Trend (with 3-Point Moving Average) & Hospital Stock Comparison'
    },
    network: {
        title: 'Inter-Hospital Network Exchange & Delivery Hub',
        subtitle: 'Cross-hospital stock visibility, Merge Sort donor routing, self-service "Deliver to Us" dispatch & cold-chain transit'
    }
};

function switchView(targetView) {
    ['dashboard', 'users', 'inventory', 'analytics', 'network'].forEach(v => {
        const section = document.getElementById(`view-${v}`);
        if (section) {
            section.classList.toggle('hidden', v !== targetView);
        }
    });

    document.querySelectorAll('.nav-btn').forEach(btn => {
        const isActive = btn.dataset.target === targetView;
        btn.className = isActive
            ? 'nav-btn w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition bg-rose-600 text-white shadow-sm'
            : 'nav-btn w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-slate-300 hover:bg-slate-800/80 hover:text-white transition';
    });

    const meta = VIEW_META[targetView] || VIEW_META.dashboard;
    document.getElementById('page-title').textContent = meta.title;
    document.getElementById('page-subtitle').textContent = meta.subtitle;

    // Refresh relevant view data and resize charts cleanly
    if (targetView === 'dashboard') {
        loadDashboardSummary();
        loadOverviewData();
    } else if (targetView === 'users') {
        loadUsers();
    } else if (targetView === 'inventory') {
        loadInventoryTable();
        syncExpiryTrackerFromSelectors();
    } else if (targetView === 'analytics') {
        loadTrendChart();
        loadOverviewData();
    } else if (targetView === 'network') {
        loadNetworkHub();
    }
}

// =====================================================================
// 1. Dashboard Summary & Merge Sort Redistribution
// =====================================================================
async function loadDashboardSummary() {
    try {
        const res = await fetch('/api/summary');
        if (!res.ok) return;
        const data = await res.json();

        document.getElementById('kpi-total-units').textContent = data.total_units;
        document.getElementById('kpi-total-users').textContent = data.total_users;
        document.getElementById('kpi-users-breakdown').textContent = `${data.total_donors} Donors • ${data.total_recipients} Recipients`;
        document.getElementById('kpi-low-count').textContent = data.low_count;
        document.getElementById('kpi-critical-count').textContent = data.critical_count;
        document.getElementById('kpi-expired-note').textContent =
            data.expired_count > 0 ? `${data.expired_count} expired batch(es) detected` : 'All active batches within date';

        // Update sidebar badges
        const alertBadge = document.getElementById('nav-badge-alerts');
        if (data.low_count > 0) {
            alertBadge.textContent = data.low_count;
            alertBadge.classList.remove('hidden');
        } else {
            alertBadge.classList.add('hidden');
        }
        document.getElementById('nav-badge-users').textContent = data.total_users;

        const transitBadge = document.getElementById('nav-badge-transit');
        if (transitBadge) {
            if (data.in_transit_count > 0) {
                transitBadge.textContent = data.in_transit_count;
                transitBadge.classList.remove('hidden');
            } else {
                transitBadge.classList.add('hidden');
            }
        }

        renderLowStockAlerts(data.low_items || []);
        renderRecentTransactions(data.recent_transactions || []);
    } catch (err) {
        console.error('Error loading summary:', err);
    }
}

function renderLowStockAlerts(lowItems) {
    const container = document.getElementById('low-stock-alerts-container');
    const pingDot = document.getElementById('alert-ping-dot');

    if (!lowItems.length) {
        if (pingDot) pingDot.classList.add('hidden');
        container.innerHTML = `
            <div class="rounded-xl bg-emerald-50 border border-emerald-200 p-4 flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <div class="h-9 w-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
                        </svg>
                    </div>
                    <div>
                        <p class="text-sm font-bold text-emerald-950">All Hospital Supplies Optimal (&ge; 10 Units)</p>
                        <p class="text-xs text-emerald-700">Every hospital and blood group currently meets or exceeds the safety threshold.</p>
                    </div>
                </div>
            </div>
        `;
        return;
    }

    if (pingDot) pingDot.classList.remove('hidden');

    // Sort critical (< 5) first, then by quantity ascending
    const sorted = [...lowItems].sort((a, b) => a.quantity - b.quantity);

    container.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            ${sorted.map(item => {
                const isCritical = item.severity === 'critical';
                const cardStyle = isCritical
                    ? 'border-rose-300 bg-rose-50/70'
                    : 'border-amber-200 bg-amber-50/50';
                const badgeStyle = isCritical
                    ? 'bg-rose-600 text-white'
                    : 'bg-amber-500 text-white';
                const labelText = isCritical ? 'CRITICAL (<5)' : 'BELOW THRESHOLD (<10)';

                return `
                    <div class="rounded-xl border ${cardStyle} p-4 flex flex-col justify-between gap-3 shadow-2xs">
                        <div>
                            <div class="flex items-center justify-between gap-2">
                                <span class="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900">
                                    <span>${escapeHtml(item.hospital_name)}</span>
                                    <span class="text-slate-400">•</span>
                                    <span class="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-rose-700 font-mono-num">${escapeHtml(item.blood_group)}</span>
                                </span>
                                <span class="rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide ${badgeStyle}">
                                    ${labelText}
                                </span>
                            </div>

                            <div class="mt-3 flex items-baseline justify-between">
                                <div>
                                    <span class="text-2xl font-bold font-mono-num ${isCritical ? 'text-rose-700' : 'text-amber-800'}">${item.quantity}</span>
                                    <span class="text-xs text-slate-600"> / 10 units threshold</span>
                                </div>
                                <span class="text-xs font-semibold text-rose-700">Deficit: -${item.needed_for_threshold} units</span>
                            </div>

                            <p class="mt-2 text-xs text-slate-600">
                                ${item.top_donor
                                    ? `Top surplus donor (Merge Sort): <strong class="text-slate-900">${escapeHtml(item.top_donor)}</strong> (${item.available_surplus} surplus units available)`
                                    : `<span class="text-rose-600 font-medium">No other hospital currently has surplus (&gt;10) for ${escapeHtml(item.blood_group)}</span>`
                                }
                            </p>
                        </div>

                        <div class="pt-2 border-t border-slate-200/60 flex items-center justify-between gap-2">
                            <span class="text-[11px] text-slate-500">${escapeHtml(item.expiry.formatted)}</span>
                            <button type="button"
                                    onclick="triggerRedistribution('${escapeHtml(item.hospital_name)}', '${escapeHtml(item.blood_group)}')"
                                    ${!item.top_donor ? 'disabled' : ''}
                                    class="rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                                        item.top_donor
                                            ? 'bg-rose-600 text-white hover:bg-rose-700 shadow-2xs'
                                            : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                    }">
                                Redistribute Blood
                            </button>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function renderRecentTransactions(transactions) {
    const listEl = document.getElementById('recent-transactions-list');
    if (!transactions.length) {
        listEl.innerHTML = `<p class="text-xs text-slate-400 py-4 text-center">No transactions recorded yet.</p>`;
        return;
    }

    listEl.innerHTML = transactions.map(tx => {
        const isDonation = tx.donations > 0;
        const qty = isDonation ? `+${tx.donations}` : `-${tx.withdrawals}`;
        const pillClass = isDonation
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-rose-50 text-rose-700 border-rose-200';
        return `
            <div class="rounded-xl border border-slate-100 bg-slate-50/70 p-3 flex items-center justify-between gap-3">
                <div class="min-w-0">
                    <div class="flex items-center gap-2">
                        <span class="text-xs font-bold text-slate-800">${escapeHtml(tx.hospital_name)}</span>
                        <span class="rounded bg-white px-1.5 py-0.5 text-[11px] font-bold text-rose-700 border border-slate-200 font-mono-num">${escapeHtml(tx.blood_group)}</span>
                    </div>
                    <p class="text-[11px] text-slate-400 mt-0.5">${escapeHtml(tx.date)}</p>
                </div>
                <span class="rounded-lg border px-2.5 py-1 text-xs font-bold font-mono-num ${pillClass}">
                    ${qty} units
                </span>
            </div>
        `;
    }).join('');
}

async function triggerRedistribution(hospitalName = '', bloodGroup = '') {
    try {
        const payload = {};
        if (hospitalName && bloodGroup) {
            payload.hospital_name = hospitalName;
            payload.blood_group = bloodGroup;
        }

        const res = await fetch('/api/inventory/redistribute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (!res.ok) {
            showToast(data.error || 'Could not redistribute blood.', 'error', 'Redistribution Blocked');
            return;
        }

        if (data.transfers && data.transfers.length > 0) {
            showToast(data.message, 'success', 'Merge Sort Redistribution Complete');
            showRedistributionBanner(data.transfers, data.message);
        } else {
            showToast(data.message || 'No transfers needed.', 'info', 'Stock Already Balanced');
        }

        // Refresh all data and charts
        await Promise.all([
            loadDashboardSummary(),
            loadOverviewData(),
            loadInventoryTable(),
            loadTrendChart()
        ]);
        syncExpiryTrackerFromSelectors();
    } catch (err) {
        showToast('Network error while running redistribution algorithm.', 'error');
    }
}

function showRedistributionBanner(transfers, summaryMessage) {
    const banner = document.getElementById('redistribution-result-banner');
    const subtitle = document.getElementById('redistribution-result-subtitle');
    const list = document.getElementById('redistribution-transfers-list');

    subtitle.textContent = summaryMessage;
    list.innerHTML = transfers.map(t => `
        <div class="rounded-xl bg-white border border-emerald-200/80 p-3 text-xs shadow-2xs">
            <div class="flex items-center justify-between font-bold text-slate-900">
                <span>${escapeHtml(t.from_hospital)} &rarr; ${escapeHtml(t.to_hospital)}</span>
                <span class="rounded bg-rose-50 px-1.5 py-0.5 text-rose-700 border border-rose-200 font-mono-num">${escapeHtml(t.blood_group)}</span>
            </div>
            <div class="mt-1.5 flex items-center justify-between text-slate-600">
                <span>Transferred: <strong class="text-emerald-700 font-mono-num">+${t.quantity} units</strong></span>
                <span class="font-mono-num text-[11px]">${t.target_before} &rarr; ${t.target_after} units</span>
            </div>
        </div>
    `).join('');

    banner.classList.remove('hidden');
}

// =====================================================================
// 2. Hospital Overview Chart & Merge Sort Rankings
// =====================================================================
async function loadOverviewData() {
    try {
        const res = await fetch('/api/analytics/overview');
        if (!res.ok) return;
        cachedOverviewData = await res.json();

        renderDashboardOverviewChart();
        renderAnalyticsOverviewChart();
        renderMergeSortRankings(cachedOverviewData.surplus_rankings || {});
    } catch (err) {
        console.error('Error loading overview data:', err);
    }
}

function buildOverviewChartConfig(data, filterBloodGroup = 'ALL') {
    const hospitals = data.hospitals || ['Hospital_1', 'Hospital_2', 'Hospital_3'];
    const bloodGroups = filterBloodGroup === 'ALL'
        ? (data.blood_groups || [])
        : [filterBloodGroup];

    const datasets = bloodGroups.map(bg => {
        const color = BLOOD_GROUP_COLORS[bg] || { bg: 'rgba(225, 29, 72, 0.75)', border: 'rgb(225, 29, 72)' };
        return {
            label: bg,
            data: hospitals.map(h => (data.data_dict[bg] && data.data_dict[bg][h]) || 0),
            backgroundColor: color.bg,
            borderColor: color.border,
            borderWidth: 1,
            borderRadius: 4,
        };
    });

    return {
        type: 'bar',
        data: {
            labels: hospitals.map(h => h.replace('_', ' ')),
            datasets
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { boxWidth: 12, usePointStyle: true, font: { size: 11 } }
                },
                thresholdLinePlugin: {
                    enabled: true,
                    threshold: data.threshold || 10
                },
                tooltip: {
                    callbacks: {
                        label(ctx) {
                            const val = ctx.parsed.x;
                            const status = val < 5 ? ' (CRITICAL < 5)' : (val < 10 ? ' (Below Threshold < 10)' : '');
                            return ` ${ctx.dataset.label}: ${val} units${status}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    suggestedMax: 40,
                    title: { display: true, text: 'Blood Quantity (Units)', font: { size: 12, weight: '600' } },
                    grid: { color: '#f1f5f9' }
                },
                y: {
                    grid: { display: false }
                }
            }
        }
    };
}

function renderDashboardOverviewChart() {
    if (!cachedOverviewData) return;
    const canvas = document.getElementById('dashOverviewChart');
    if (!canvas) return;

    const filterBg = document.getElementById('dash-overview-filter')?.value || 'ALL';
    if (dashOverviewChartInstance) {
        dashOverviewChartInstance.destroy();
    }
    dashOverviewChartInstance = new Chart(canvas.getContext('2d'), buildOverviewChartConfig(cachedOverviewData, filterBg));
}

function renderAnalyticsOverviewChart() {
    if (!cachedOverviewData) return;
    const canvas = document.getElementById('analyticsOverviewChart');
    if (!canvas) return;

    if (analyticsOverviewChartInstance) {
        analyticsOverviewChartInstance.destroy();
    }
    analyticsOverviewChartInstance = new Chart(canvas.getContext('2d'), buildOverviewChartConfig(cachedOverviewData, 'ALL'));
}

function renderMergeSortRankings(rankings) {
    const container = document.getElementById('merge-sort-rankings-list');
    if (!container) return;

    const entries = Object.entries(rankings);
    container.innerHTML = entries.map(([bg, list]) => `
        <div class="rounded-xl border border-slate-200/80 p-3 bg-slate-50/60">
            <div class="flex items-center justify-between mb-2">
                <span class="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900">
                    <span class="px-2 py-0.5 rounded bg-rose-600 text-white font-mono-num">${escapeHtml(bg)}</span>
                    <span>Surplus Donors (&gt;10 units)</span>
                </span>
                <span class="text-[11px] text-slate-500">${list.length} hospital(s)</span>
            </div>
            ${list.length === 0
                ? `<p class="text-xs text-rose-600">No hospital currently has surplus &gt; 10 units.</p>`
                : `<div class="space-y-1.5">
                    ${list.map((item, idx) => `
                        <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5 text-xs border border-slate-200/70">
                            <span class="font-medium text-slate-800 shrink-0">#${idx + 1} ${escapeHtml(item.hospital_name)}</span>
                            <span class="font-mono-num font-semibold text-emerald-700 shrink-0">${item.quantity} units (+${item.surplus_above_threshold} surplus)</span>
                        </div>
                    `).join('')}
                   </div>`
            }
        </div>
    `).join('');
}

// =====================================================================
// 3. Blood Trend Chart with 3-Point Moving Average
// =====================================================================
async function loadTrendChart() {
    const bgSelect = document.getElementById('trend-bg-select');
    const hospSelect = document.getElementById('trend-hospital-select');
    const bloodGroup = bgSelect ? bgSelect.value : 'A+';
    const hospital = hospSelect ? hospSelect.value : '';

    try {
        const params = new URLSearchParams({ blood_group: bloodGroup });
        if (hospital) params.append('hospital_name', hospital);

        const res = await fetch(`/api/analytics/trend?${params.toString()}`);
        if (!res.ok) return;
        const data = await res.json();

        const canvas = document.getElementById('bloodTrendChart');
        if (!canvas) return;

        if (bloodTrendChartInstance) {
            bloodTrendChartInstance.destroy();
        }

        const shortLabels = (data.dates || []).map(d => d.slice(5, 16));

        bloodTrendChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: shortLabels,
                datasets: [
                    {
                        label: `Net Blood Stock Change (${data.blood_group})`,
                        data: data.sub_totals || [],
                        borderColor: '#2563eb',
                        backgroundColor: 'rgba(37, 99, 235, 0.1)',
                        borderWidth: 2.5,
                        pointRadius: 4,
                        pointBackgroundColor: '#2563eb',
                        tension: 0.25,
                        fill: true
                    },
                    {
                        label: '3-Point Moving Avg',
                        data: data.moving_average || [],
                        borderColor: '#e11d48',
                        backgroundColor: 'transparent',
                        borderWidth: 2.5,
                        borderDash: [6, 5],
                        pointRadius: 4,
                        pointBackgroundColor: '#e11d48',
                        tension: 0.25,
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { usePointStyle: true, font: { size: 12, weight: '600' } }
                    },
                    tooltip: {
                        callbacks: {
                            afterBody(items) {
                                const idx = items[0]?.dataIndex;
                                const tx = data.transactions?.[idx];
                                if (!tx) return '';
                                return `Hospital: ${tx.hospital_name} | Donations: +${tx.donations} | Withdrawals: -${tx.withdrawals}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: { display: true, text: 'Transaction Timestamp', font: { size: 12, weight: '600' } },
                        grid: { color: '#f1f5f9' }
                    },
                    y: {
                        title: { display: true, text: 'Net Blood Quantity (Units)', font: { size: 12, weight: '600' } },
                        grid: { color: '#f1f5f9' }
                    }
                }
            }
        });
    } catch (err) {
        console.error('Error loading blood trend chart:', err);
    }
}

// =====================================================================
// 4. User Management (Donors & Recipients)
// =====================================================================
async function loadUsers() {
    const search = document.getElementById('user-search-input')?.value || '';
    const userType = document.getElementById('user-filter-type')?.value || '';
    const bloodGroup = document.getElementById('user-filter-bg')?.value || '';

    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (userType) params.append('user_type', userType);
    if (bloodGroup) params.append('blood_group', bloodGroup);

    try {
        const res = await fetch(`/api/users?${params.toString()}`);
        if (!res.ok) return;
        const data = await res.json();
        const users = data.users || [];

        document.getElementById('users-count-badge').textContent = `${users.length} record${users.length === 1 ? '' : 's'}`;
        const tbody = document.getElementById('users-table-body');

        if (!users.length) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="px-4 py-8 text-center text-sm text-slate-400">
                        No matching users found in the registry.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = users.map(u => {
            const isDonor = u.user_type === 'Donor';
            const roleBadge = isDonor
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-purple-50 text-purple-700 border-purple-200';
            return `
                <tr class="hover:bg-slate-50/80 transition">
                    <td class="px-4 py-3.5">
                        <div class="font-semibold text-slate-900">${escapeHtml(u.name)}</div>
                        <div class="text-xs text-slate-400">ID #${u.id}</div>
                    </td>
                    <td class="px-4 py-3.5">
                        <div class="flex items-center gap-1.5">
                            <span class="rounded-full border px-2.5 py-0.5 text-xs font-semibold ${roleBadge}">
                                ${escapeHtml(u.user_type)}
                            </span>
                            <span class="rounded-md bg-rose-50 border border-rose-200 px-2 py-0.5 text-xs font-bold text-rose-700 font-mono-num">
                                ${escapeHtml(u.blood_group)}
                            </span>
                        </div>
                    </td>
                    <td class="px-4 py-3.5">
                        <div class="text-xs font-medium text-slate-800">${escapeHtml(u.email)}</div>
                        <div class="text-xs text-slate-500 font-mono-num">${escapeHtml(u.phone)}</div>
                    </td>
                    <td class="px-4 py-3.5">
                        <div class="text-xs font-medium text-slate-800">${escapeHtml(u.town)}</div>
                        <div class="text-xs text-slate-500 font-mono-num">${escapeHtml(u.postcode)}</div>
                    </td>
                    <td class="px-4 py-3.5 text-center font-mono-num text-xs font-semibold text-slate-700">
                        ${u.age}
                    </td>
                    <td class="px-4 py-3.5 text-right">
                        <button type="button"
                                onclick="requestDeleteUser(${u.id}, '${escapeHtml(u.name)}')"
                                class="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 border border-rose-200/70 transition">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                            </svg>
                            <span>Delete</span>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        console.error('Error loading users:', err);
    }
}

function requestDeleteUser(userId, userName) {
    openConfirmModal({
        title: 'Confirm User Deletion',
        message: `Do you want to delete ${userName} from the Blood Bank Registry?`,
        onConfirm: async () => {
            try {
                const res = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
                const data = await res.json();
                if (res.ok) {
                    showToast(data.message, 'success', 'User Deleted');
                    loadUsers();
                    loadDashboardSummary();
                } else {
                    showToast(data.error || 'Failed to delete user.', 'error');
                }
            } catch (err) {
                showToast('Network error while deleting user.', 'error');
            }
        }
    });
}

// =====================================================================
// 5. Inventory Management & Live 1-Second Expiry Countdown Tracker
// =====================================================================
async function loadInventoryTable() {
    const hospital = document.getElementById('inv-table-hospital-filter')?.value || '';
    const bloodGroup = document.getElementById('inv-table-bg-filter')?.value || '';
    const sort = document.getElementById('inv-table-sort')?.value || '';

    const params = new URLSearchParams();
    if (hospital) params.append('hospital', hospital);
    if (bloodGroup) params.append('blood_group', bloodGroup);
    if (sort) params.append('sort', sort);

    try {
        const res = await fetch(`/api/inventory?${params.toString()}`);
        if (!res.ok) return;
        const data = await res.json();
        const items = data.inventory || [];

        const tbody = document.getElementById('inventory-table-body');
        if (!items.length) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="px-5 py-8 text-center text-sm text-slate-400">
                        No inventory records match the selected filters.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = items.map(item => {
            let statusBadge = '';
            if (item.status === 'critical') {
                statusBadge = `<span class="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-700 border border-rose-200">Critical (&lt;5)</span>`;
            } else if (item.status === 'low') {
                statusBadge = `<span class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800 border border-amber-200">Low (&lt;10)</span>`;
            } else {
                statusBadge = `<span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">Optimal (&ge;10)</span>`;
            }

            const expClass = item.expiry.is_expired
                ? 'text-white bg-rose-600 font-bold px-2.5 py-0.5 rounded-lg'
                : (item.expiry.no_stock ? 'text-amber-600 font-medium' : 'text-slate-700 font-mono-num font-semibold');

            const barWidth = Math.min(100, Math.round((item.quantity / 30) * 100));
            const barColor = item.status === 'critical' ? 'bg-rose-600' : (item.status === 'low' ? 'bg-amber-500' : 'bg-emerald-500');

            return `
                <tr class="hover:bg-slate-50/90 transition">
                    <td class="px-5 py-3.5 font-semibold text-slate-900">
                        ${escapeHtml(item.hospital_name)}
                    </td>
                    <td class="px-5 py-3.5">
                        <span class="rounded-lg bg-rose-50 border border-rose-200 px-2.5 py-1 text-xs font-bold text-rose-700 font-mono-num">
                            ${escapeHtml(item.blood_group)}
                        </span>
                    </td>
                    <td class="px-5 py-3.5">
                        <div class="flex items-center gap-3">
                            <span class="font-mono-num text-sm font-bold text-slate-900 w-8">${item.quantity}</span>
                            <div class="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div class="h-full ${barColor} rounded-full" style="width: ${barWidth}%"></div>
                            </div>
                        </div>
                    </td>
                    <td class="px-5 py-3.5">
                        ${statusBadge}
                    </td>
                    <td class="px-5 py-3.5 text-xs text-slate-500 font-mono-num">
                        ${escapeHtml(item.expiry_date)}
                    </td>
                    <td class="px-5 py-3.5 text-xs">
                        <span class="row-expiry-ticker ${expClass}"
                              data-expiry="${escapeHtml(item.expiry_date)}"
                              data-qty="${item.quantity}">
                            ${escapeHtml(item.expiry.formatted)}
                        </span>
                    </td>
                    <td class="px-5 py-3.5 text-right space-x-1.5">
                        <button type="button"
                                onclick="selectForExpiryTracker('${escapeHtml(item.hospital_name)}', '${escapeHtml(item.blood_group)}')"
                                class="rounded-lg bg-slate-100 hover:bg-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 transition">
                            Track Timer
                        </button>
                        ${item.quantity < 10 ? `
                        <button type="button"
                                onclick="triggerRedistribution('${escapeHtml(item.hospital_name)}', '${escapeHtml(item.blood_group)}')"
                                class="rounded-lg bg-rose-600 hover:bg-rose-700 px-2.5 py-1 text-xs font-semibold text-white transition">
                            Redistribute
                        </button>
                        ` : ''}
                    </td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        console.error('Error loading inventory:', err);
    }
}

async function handleInventoryChange(action) {
    const hospital_name = document.getElementById('inv-hospital').value;
    const blood_group = document.getElementById('inv-blood-group').value;
    const quantity = document.getElementById('inv-quantity').value;

    const endpoint = action === 'add' ? '/api/inventory/add' : '/api/inventory/remove';
    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hospital_name, blood_group, quantity })
        });
        const data = await res.json();

        if (!res.ok) {
            showToast(data.error || 'Operation failed.', 'error');
            return;
        }

        showToast(data.message, 'success', action === 'add' ? 'Blood Stock Added' : 'Blood Stock Withdrawn');
        await Promise.all([
            loadInventoryTable(),
            loadDashboardSummary(),
            loadOverviewData(),
            loadTrendChart(),
            syncExpiryTrackerFromSelectors()
        ]);
    } catch (err) {
        showToast('Network error updating inventory.', 'error');
    }
}

function selectForExpiryTracker(hospitalName, bloodGroup) {
    const hospSelect = document.getElementById('inv-hospital');
    const bgSelect = document.getElementById('inv-blood-group');
    if (hospSelect) hospSelect.value = hospitalName;
    if (bgSelect) bgSelect.value = bloodGroup;
    syncExpiryTrackerFromSelectors();
}

async function syncExpiryTrackerFromSelectors() {
    const hospital_name = document.getElementById('inv-hospital')?.value || 'Hospital_1';
    const blood_group = document.getElementById('inv-blood-group')?.value || 'A+';

    try {
        const params = new URLSearchParams({ hospital_name, blood_group });
        const res = await fetch(`/api/inventory/expiry?${params.toString()}`);
        if (!res.ok) return;
        const data = await res.json();

        trackedExpiryTarget = {
            hospital_name: data.hospital_name,
            blood_group: data.blood_group,
            quantity: data.quantity,
            expiry_date_str: data.expiry_date,
            expiry_TimestampMs: data.expiry_date ? new Date(data.expiry_date.replace(' ', 'T')).getTime() : null
        };

        updateLiveExpiryDisplay();
    } catch (err) {
        console.error('Failed to sync expiry tracker:', err);
    }
}

function formatCountdownFromMs(diffMs, quantity) {
    if (quantity <= 0 || diffMs === null || isNaN(diffMs)) {
        return { text: 'No stock available', subtext: 'Add blood units to start a +40 day batch timer', status: 'empty' };
    }
    if (diffMs <= 0) {
        return { text: 'Expired', subtext: 'Batch has passed its 40-day shelf life', status: 'expired' };
    }
    const totalSeconds = Math.floor(diffMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return {
        text: `${days}d ${hours}h ${minutes}m left`,
        subtext: `Live precision: ${days}d ${hours}h ${minutes}m ${seconds}s remaining (Batch expires ${trackedExpiryTarget.expiry_date_str})`,
        status: 'active'
    };
}

function updateLiveExpiryDisplay() {
    const labelEl = document.getElementById('timer-selection-label');
    const displayEl = document.getElementById('live-expiry-display');
    const subtextEl = document.getElementById('live-expiry-subtext');
    const qtyEl = document.getElementById('timer-stock-qty');

    if (labelEl) {
        labelEl.innerHTML = `Earliest expiring batch for <span class="text-white font-semibold">${escapeHtml(trackedExpiryTarget.hospital_name)} • ${escapeHtml(trackedExpiryTarget.blood_group)}</span>`;
    }
    if (qtyEl) {
        qtyEl.textContent = `${trackedExpiryTarget.quantity} units`;
    }

    const nowMs = Date.now();
    const diffMs = trackedExpiryTarget.expiry_TimestampMs ? (trackedExpiryTarget.expiry_TimestampMs - nowMs) : null;
    const formatted = formatCountdownFromMs(diffMs, trackedExpiryTarget.quantity);

    if (displayEl) {
        displayEl.textContent = formatted.text;
        if (formatted.status === 'expired') {
            displayEl.className = 'text-2xl sm:text-3xl font-bold font-mono-num tracking-tight text-rose-400';
        } else if (formatted.status === 'empty') {
            displayEl.className = 'text-2xl sm:text-3xl font-bold font-mono-num tracking-tight text-amber-400';
        } else {
            displayEl.className = 'text-2xl sm:text-3xl font-bold font-mono-num tracking-tight text-white';
        }
    }
    if (subtextEl) {
        subtextEl.textContent = formatted.subtext;
    }

    // Also tick every row countdown in the inventory table
    document.querySelectorAll('.row-expiry-ticker').forEach(el => {
        const expStr = el.dataset.expiry;
        const qty = parseInt(el.dataset.qty || '0', 10);
        if (qty <= 0 || !expStr) {
            el.textContent = 'No stock available';
            return;
        }
        const expMs = new Date(expStr.replace(' ', 'T')).getTime();
        const rowDiff = expMs - nowMs;
        if (rowDiff <= 0) {
            el.textContent = 'Expired';
        } else {
            const totalSec = Math.floor(rowDiff / 1000);
            const d = Math.floor(totalSec / 86400);
            const h = Math.floor((totalSec % 86400) / 3600);
            const m = Math.floor((totalSec % 3600) / 60);
            el.textContent = `${d}d ${h}h ${m}m left`;
        }
    });
}

// =====================================================================
// 6. Inter-Hospital Network Exchange & Self-Service Delivery
// =====================================================================
let cachedNetworkCatalog = null;
let activeNetworkDeliveries = [];
let autoReceivingIds = new Set();

function getActiveHospitalNode() {
    const sel = document.getElementById('active-hospital-node');
    return sel ? sel.value : 'Hospital_1';
}

function setActiveHospitalNode(hospitalName) {
    const sel = document.getElementById('active-hospital-node');
    if (sel) sel.value = hospitalName;
    const targetSel = document.getElementById('net-target-hospital');
    if (targetSel && hospitalName !== 'ALL') {
        targetSel.value = hospitalName;
    }
    updateDispatchButtonLabel();
    loadNetworkHub();
}

function updateDispatchButtonLabel() {
    const targetHosp = document.getElementById('net-target-hospital')?.value || 'Hospital_1';
    const labelEl = document.getElementById('btn-dispatch-label');
    if (labelEl) {
        labelEl.textContent = `Deliver to ${targetHosp}`;
    }
}

async function loadNetworkHub() {
    const activeNode = getActiveHospitalNode();
    const targetSel = document.getElementById('net-target-hospital');
    if (targetSel && activeNode !== 'ALL') {
        targetSel.value = activeNode;
    }
    updateDispatchButtonLabel();

    const catalogHosp = activeNode !== 'ALL'
        ? activeNode
        : (document.getElementById('net-target-hospital')?.value || 'Hospital_1');

    try {
        const [nodesRes, catRes, delivRes] = await Promise.all([
            fetch('/api/network/nodes'),
            fetch(`/api/network/catalog?hospital=${encodeURIComponent(catalogHosp)}`),
            fetch(`/api/network/deliveries?hospital=${encodeURIComponent(activeNode === 'ALL' ? '' : activeNode)}`)
        ]);

        if (nodesRes.ok) {
            const nodesData = await nodesRes.json();
            renderNetworkNodes(nodesData.nodes || []);
        }
        if (catRes.ok) {
            cachedNetworkCatalog = await catRes.json();
            renderNetworkCatalog();
            updateDonorBatchPreview();
        }
        if (delivRes.ok) {
            const delivData = await delivRes.json();
            activeNetworkDeliveries = delivData.active_deliveries || [];
            renderNetworkDeliveries(activeNetworkDeliveries, delivData.completed_deliveries || []);
            const transitBadge = document.getElementById('nav-badge-transit');
            if (transitBadge) {
                if (delivData.total_active > 0) {
                    transitBadge.textContent = delivData.total_active;
                    transitBadge.classList.remove('hidden');
                } else {
                    transitBadge.classList.add('hidden');
                }
            }
        }
    } catch (err) {
        console.error('Error loading network hub:', err);
    }
}

function renderNetworkNodes(nodes) {
    const grid = document.getElementById('network-nodes-grid');
    if (!grid) return;
    const activeNode = getActiveHospitalNode();

    grid.innerHTML = nodes.map(n => {
        const isCurrent = n.hospital_name === activeNode;
        const borderStyle = isCurrent
            ? 'border-rose-500 ring-2 ring-rose-500/15 bg-white'
            : 'border-slate-200/80 bg-white';
        const deficitBadge = n.critical_groups.length > 0
            ? `<span class="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">${n.critical_groups.length} Critical (${n.critical_groups.join(', ')})</span>`
            : (n.low_groups.length > 0
                ? `<span class="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">${n.low_groups.length} Low (${n.low_groups.join(', ')})</span>`
                : `<span class="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">All Stock Optimal</span>`);

        return `
            <div class="rounded-2xl border ${borderStyle} p-5 shadow-xs flex flex-col justify-between gap-4 transition">
                <div>
                    <div class="flex items-start justify-between gap-2">
                        <div>
                            <div class="flex items-center gap-2">
                                <span class="text-sm font-bold text-slate-900">${escapeHtml(n.hospital_name)}</span>
                                <span class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono-num font-semibold text-slate-600">${escapeHtml(n.station_code)}</span>
                                ${isCurrent ? `<span class="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white">ACTIVE STATION</span>` : ''}
                            </div>
                            <p class="text-xs text-slate-500 mt-0.5">${escapeHtml(n.trust_name)} • ${escapeHtml(n.city)}</p>
                        </div>
                        <span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                            <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                            ONLINE
                        </span>
                    </div>

                    <div class="mt-4 grid grid-cols-3 gap-2 text-center">
                        <div class="rounded-xl bg-slate-50 p-2.5 border border-slate-100">
                            <div class="text-[10px] uppercase font-semibold text-slate-400">Total Stock</div>
                            <div class="text-base font-bold font-mono-num text-slate-900 mt-0.5">${n.total_units}u</div>
                        </div>
                        <div class="rounded-xl bg-emerald-50/60 p-2.5 border border-emerald-100">
                            <div class="text-[10px] uppercase font-semibold text-emerald-700">Surplus (&gt;10)</div>
                            <div class="text-base font-bold font-mono-num text-emerald-700 mt-0.5">+${n.surplus_units}u</div>
                        </div>
                        <div class="rounded-xl bg-blue-50/60 p-2.5 border border-blue-100">
                            <div class="text-[10px] uppercase font-semibold text-blue-700">In Transit</div>
                            <div class="text-xs font-bold font-mono-num text-blue-800 mt-1">&darr;${n.incoming_shipments} &uarr;${n.outgoing_shipments}</div>
                        </div>
                    </div>
                </div>

                <div class="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                    ${deficitBadge}
                    ${!isCurrent ? `
                        <button type="button" onclick="setActiveHospitalNode('${escapeHtml(n.hospital_name)}')"
                                class="rounded-lg bg-slate-100 hover:bg-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 transition shrink-0">
                            Operate as ${escapeHtml(n.hospital_name)}
                        </button>
                    ` : `<span class="text-[11px] font-medium text-rose-600">Receiving Station</span>`}
                </div>
            </div>
        `;
    }).join('');
}

function updateDonorBatchPreview() {
    const previewEl = document.getElementById('net-donor-preview');
    if (!previewEl || !cachedNetworkCatalog) return;

    const targetHosp = document.getElementById('net-target-hospital')?.value || 'Hospital_1';
    const bloodGroup = document.getElementById('net-blood-group')?.value || 'A+';
    const donorChoice = document.getElementById('net-donor-hospital')?.value || 'AUTO';
    const emergencyOverride = document.getElementById('net-emergency-override')?.checked || false;

    const candidates = (cachedNetworkCatalog.catalog_by_group?.[bloodGroup] || []).filter(
        c => c.donor_hospital !== targetHosp
    );

    let selectedDonor = null;
    if (donorChoice === 'AUTO') {
        selectedDonor = candidates[0] || null;
    } else {
        selectedDonor = candidates.find(c => c.donor_hospital === donorChoice) || null;
    }

    if (!selectedDonor) {
        previewEl.innerHTML = `<p class="text-rose-600 font-medium">Select a different origin and destination hospital.</p>`;
        return;
    }

    const maxDispatchable = emergencyOverride ? selectedDonor.emergency_available : selectedDonor.surplus_available;
    const flagHtml = selectedDonor.short_expiry_flag
        ? `<div class="mt-1.5 rounded-lg bg-amber-100 border border-amber-300 px-2.5 py-1 text-[11px] font-bold text-amber-900">
             &#9888; CLINICAL FLAG: Batch has &lt;5 days shelf life (${escapeHtml(selectedDonor.expiry.formatted)})
           </div>`
        : '';

    previewEl.innerHTML = `
        <div class="flex items-center justify-between font-semibold text-slate-900">
            <span>Selected Donor: <strong class="text-rose-700">${escapeHtml(selectedDonor.donor_hospital)}</strong> (${escapeHtml(selectedDonor.city)})</span>
            <span class="font-mono-num">${selectedDonor.quantity}u total</span>
        </div>
        <div class="flex items-center justify-between text-slate-600">
            <span>Max Dispatchable (${emergencyOverride ? 'Override' : 'Surplus &gt;10'}):</span>
            <strong class="font-mono-num ${maxDispatchable > 0 ? 'text-emerald-700' : 'text-rose-600'}">${maxDispatchable} units</strong>
        </div>
        <div class="flex items-center justify-between text-slate-600">
            <span>Inherited Batch Expiry:</span>
            <span class="font-mono-num text-[11px] font-semibold text-slate-800">${escapeHtml(selectedDonor.expiry_date || 'N/A')} (${escapeHtml(selectedDonor.expiry.formatted)})</span>
        </div>
        ${flagHtml}
    `;
}

function renderNetworkCatalog() {
    const tbody = document.getElementById('network-catalog-body');
    if (!tbody || !cachedNetworkCatalog) return;

    const bgFilter = document.getElementById('net-catalog-bg-filter')?.value || '';
    const targetHosp = document.getElementById('net-target-hospital')?.value || 'Hospital_1';
    const emergencyOverride = document.getElementById('net-emergency-override')?.checked || false;

    const subtitleEl = document.getElementById('net-catalog-subtitle');
    if (subtitleEl) {
        subtitleEl.innerHTML = `Showing partner hospital batches available for delivery to <strong class="text-slate-900">${escapeHtml(targetHosp)}</strong> (ranked descending by <code class="font-mono-num">merge_sort()</code>).`;
    }

    const groups = bgFilter ? [bgFilter] : Object.keys(cachedNetworkCatalog.catalog_by_group || {});
    const rows = [];

    groups.forEach(bg => {
        const donors = (cachedNetworkCatalog.catalog_by_group[bg] || []).filter(d => d.donor_hospital !== targetHosp);
        donors.forEach((d, idx) => {
            rows.push({ ...d, blood_group: bg, rank: idx + 1 });
        });
    });

    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-slate-400">No network batches found.</td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map(r => {
        const canOrderStandard = r.surplus_available > 0 && !r.expiry.is_expired;
        const canOrderEmergency = emergencyOverride && r.emergency_available > 0 && !r.expiry.is_expired;
        const canOrder = canOrderStandard || canOrderEmergency;
        const suggestedQty = canOrderStandard ? Math.min(4, r.surplus_available) : Math.min(2, r.emergency_available);

        const surplusBadge = r.surplus_available > 0
            ? `<span class="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-bold text-emerald-700 font-mono-num">+${r.surplus_available} units</span>`
            : `<span class="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">0 surplus (Reserve &le;10)</span>`;

        const expiryBadge = r.expiry.is_expired
            ? `<span class="rounded bg-rose-600 text-white px-2 py-0.5 text-[11px] font-bold">Expired</span>`
            : (r.short_expiry_flag
                ? `<span class="rounded bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 text-[11px] font-bold">&#9888; ${escapeHtml(r.expiry.formatted)} (&lt;5d Flag)</span>`
                : `<span class="font-mono-num text-xs font-semibold text-slate-700">${escapeHtml(r.expiry.formatted)}</span>`);

        return `
            <tr class="hover:bg-slate-50/80 transition">
                <td class="px-4 py-3">
                    <div class="flex items-center gap-1.5">
                        <span class="text-xs font-bold text-slate-900">${escapeHtml(r.donor_hospital)}</span>
                        ${r.rank === 1 && r.surplus_available > 0 ? `<span class="rounded bg-rose-50 text-rose-700 border border-rose-200 px-1.5 py-0.5 text-[10px] font-bold">Top MergeSort</span>` : ''}
                    </div>
                    <div class="text-[11px] text-slate-400">${escapeHtml(r.trust_name)}</div>
                </td>
                <td class="px-4 py-3">
                    <span class="rounded-md bg-rose-50 border border-rose-200 px-2 py-0.5 text-xs font-bold text-rose-700 font-mono-num">${escapeHtml(r.blood_group)}</span>
                </td>
                <td class="px-4 py-3 font-mono-num text-xs font-bold text-slate-800">
                    ${r.quantity} units
                </td>
                <td class="px-4 py-3">
                    ${surplusBadge}
                </td>
                <td class="px-4 py-3">
                    <div>${expiryBadge}</div>
                    <div class="text-[10px] text-slate-400 font-mono-num mt-0.5">${escapeHtml(r.expiry_date)}</div>
                </td>
                <td class="px-4 py-3 text-right">
                    <button type="button"
                            onclick="quickOrderFromCatalog('${escapeHtml(r.donor_hospital)}', '${escapeHtml(r.blood_group)}', ${suggestedQty || 1})"
                            ${!canOrder ? 'disabled' : ''}
                            class="rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                                canOrder
                                    ? 'bg-rose-600 text-white hover:bg-rose-700 shadow-2xs'
                                    : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                            }">
                        Deliver ${suggestedQty || 1}u to ${escapeHtml(targetHosp)}
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

async function quickOrderFromCatalog(donorHospital, bloodGroup, quantity) {
    const targetHospital = document.getElementById('net-target-hospital')?.value || 'Hospital_1';
    const emergencyOverride = document.getElementById('net-emergency-override')?.checked || false;
    const transitMode = document.getElementById('net-transit-mode')?.value || 'transit';

    // Also sync form fields for clarity
    if (document.getElementById('net-blood-group')) document.getElementById('net-blood-group').value = bloodGroup;
    if (document.getElementById('net-donor-hospital')) document.getElementById('net-donor-hospital').value = donorHospital;
    if (document.getElementById('net-quantity')) document.getElementById('net-quantity').value = quantity;
    updateDonorBatchPreview();

    await submitNetworkDispatch({
        target_hospital: targetHospital,
        donor_hospital: donorHospital,
        blood_group: bloodGroup,
        quantity,
        emergency_override: emergencyOverride,
        express_delivery: transitMode === 'express',
        transit_seconds: 30
    });
}

async function submitNetworkDispatch(payload) {
    try {
        const res = await fetch('/api/network/dispatch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
            showToast(data.error || 'Could not dispatch delivery.', 'error', 'Dispatch Blocked');
            return;
        }

        showToast(data.message, data.delivery?.short_expiry_flag ? 'warning' : 'success', 'Inter-Hospital Delivery Dispatched');
        await Promise.all([
            loadNetworkHub(),
            loadDashboardSummary(),
            loadOverviewData(),
            loadInventoryTable(),
            loadTrendChart()
        ]);
    } catch (err) {
        showToast('Network error while dispatching inter-hospital delivery.', 'error');
    }
}

function renderNetworkDeliveries(activeList, completedList) {
    const activeContainer = document.getElementById('network-active-deliveries');
    const completedContainer = document.getElementById('network-completed-deliveries');
    const completedBadge = document.getElementById('completed-deliveries-badge');

    if (completedBadge) {
        completedBadge.textContent = `${completedList.length} delivered`;
    }

    if (activeContainer) {
        if (!activeList.length) {
            activeContainer.innerHTML = `
                <div class="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                    No active shipments currently in transit. Use the "Deliver to Us" console or catalog above to dispatch blood units.
                </div>
            `;
        } else {
            activeContainer.innerHTML = activeList.map(d => `
                <div class="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-3 shadow-2xs" data-delivery-id="${d.id}">
                    <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-2">
                            <span class="rounded-lg bg-slate-900 px-2 py-0.5 text-xs font-mono-num font-bold text-white">${escapeHtml(d.tracking_code)}</span>
                            <span class="text-xs font-bold text-slate-900">${escapeHtml(d.donor_hospital)} &rarr; ${escapeHtml(d.target_hospital)}</span>
                            <span class="rounded bg-rose-600 px-2 py-0.5 text-xs font-bold text-white font-mono-num">${escapeHtml(d.blood_group)} (${d.quantity}u)</span>
                        </div>
                        <span class="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[11px] font-mono-num font-semibold text-blue-700">
                            &#10052; ${d.temperature_celsius}&deg;C OK
                        </span>
                    </div>

                    <div>
                        <div class="flex items-center justify-between text-xs text-slate-600 mb-1">
                            <span class="font-medium">Cold-Chain Courier En Route</span>
                            <span class="font-mono-num font-bold text-emerald-700 delivery-eta-label" data-id="${d.id}">
                                ${d.remaining_eta_seconds > 0 ? `ETA: ${d.remaining_eta_seconds}s` : 'Arrived at Receiving Bay'}
                            </span>
                        </div>
                        <div class="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                            <div class="h-full bg-emerald-600 rounded-full transition-all duration-500 delivery-progress-bar"
                                 data-id="${d.id}"
                                 style="width: ${d.progress_pct}%"></div>
                        </div>
                    </div>

                    <div class="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
                        <div class="text-[11px] text-slate-600">
                            Inherited Batch Expiry: <strong class="font-mono-num">${escapeHtml(d.batch_expiry_date)}</strong>
                            ${d.short_expiry_flag ? `<span class="ml-1 rounded bg-amber-100 text-amber-900 px-1.5 py-0.5 font-bold">&lt;5d Flag</span>` : ''}
                            ${d.emergency_override ? `<span class="ml-1 rounded bg-rose-100 text-rose-800 px-1.5 py-0.5 font-bold">Override</span>` : ''}
                        </div>
                        <button type="button"
                                onclick="receiveNetworkDelivery(${d.id})"
                                class="rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white shadow-2xs transition">
                            Confirm Receipt &amp; Stock
                        </button>
                    </div>
                </div>
            `).join('');
        }
    }

    if (completedContainer) {
        if (!completedList.length) {
            completedContainer.innerHTML = `<p class="text-xs text-slate-400 py-6 text-center">No completed deliveries recorded yet.</p>`;
        } else {
            completedContainer.innerHTML = completedList.map(d => `
                <div class="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 flex flex-col gap-1.5 text-xs">
                    <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-2">
                            <span class="font-mono-num font-bold text-slate-700">${escapeHtml(d.tracking_code)}</span>
                            <span class="font-bold text-slate-900">${escapeHtml(d.donor_hospital)} &rarr; ${escapeHtml(d.target_hospital)}</span>
                            <span class="rounded bg-rose-50 border border-rose-200 px-1.5 py-0.5 font-mono-num font-bold text-rose-700">${escapeHtml(d.blood_group)} (+${d.quantity}u)</span>
                        </div>
                        <span class="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                            DELIVERED
                        </span>
                    </div>
                    <div class="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                        <span>Delivered: <span class="font-mono-num">${escapeHtml(d.delivered_at || d.dispatched_at)}</span> • Temp: ${d.temperature_celsius}&deg;C</span>
                        <span>Inherited Expiry: <span class="font-mono-num font-medium text-slate-700">${escapeHtml(d.batch_expiry_date)}</span></span>
                    </div>
                    ${d.short_expiry_flag || d.emergency_override ? `
                        <div class="flex items-center gap-2 mt-0.5">
                            ${d.short_expiry_flag ? `<span class="rounded bg-amber-100 border border-amber-300 px-2 py-0.5 text-[10px] font-bold text-amber-900">&#9888; Clinical Flag: Batch &lt;5 Days Shelf Life</span>` : ''}
                            ${d.emergency_override ? `<span class="rounded bg-rose-100 border border-rose-300 px-2 py-0.5 text-[10px] font-bold text-rose-800">Emergency Override Used</span>` : ''}
                        </div>
                    ` : ''}
                </div>
            `).join('');
        }
    }
}

async function receiveNetworkDelivery(deliveryId) {
    if (autoReceivingIds.has(deliveryId)) return;
    autoReceivingIds.add(deliveryId);
    try {
        const res = await fetch(`/api/network/deliveries/${deliveryId}/receive`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok || !data.success) {
            showToast(data.error || 'Could not confirm delivery receipt.', 'error');
            return;
        }
        showToast(data.message, data.delivery?.short_expiry_flag ? 'warning' : 'success', 'Shipment Received & Stocked');
        await Promise.all([
            loadNetworkHub(),
            loadDashboardSummary(),
            loadOverviewData(),
            loadInventoryTable(),
            loadTrendChart()
        ]);
    } catch (err) {
        console.error('Error receiving delivery:', err);
    } finally {
        autoReceivingIds.delete(deliveryId);
    }
}

function tickNetworkDeliveries() {
    if (!activeNetworkDeliveries.length) return;
    const autoReceive = document.getElementById('net-auto-receive-toggle')?.checked;

    activeNetworkDeliveries.forEach(d => {
        if (d.remaining_eta_seconds > 0) {
            d.remaining_eta_seconds -= 1;
        }
        const totalEta = Math.max(1, d.transit_eta_seconds || 45);
        d.progress_pct = Math.min(100, Math.round(((totalEta - d.remaining_eta_seconds) / totalEta) * 100));

        const etaEl = document.querySelector(`.delivery-eta-label[data-id="${d.id}"]`);
        if (etaEl) {
            etaEl.textContent = d.remaining_eta_seconds > 0
                ? `ETA: ${d.remaining_eta_seconds}s`
                : 'Arrived at Receiving Bay';
        }
        const barEl = document.querySelector(`.delivery-progress-bar[data-id="${d.id}"]`);
        if (barEl) {
            barEl.style.width = `${d.progress_pct}%`;
        }

        if (d.remaining_eta_seconds <= 0 && autoReceive && !autoReceivingIds.has(d.id)) {
            receiveNetworkDelivery(d.id);
        }
    });
}

// =====================================================================
// Initialization & Event Listeners
// =====================================================================
document.addEventListener('DOMContentLoaded', () => {
    // Sidebar navigation buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            switchView(btn.dataset.target);
        });
    });

    // Mobile menu toggle
    const mobileBtn = document.getElementById('mobile-menu-btn');
    const navWrapper = document.getElementById('sidebar-nav-wrapper');
    if (mobileBtn && navWrapper) {
        mobileBtn.addEventListener('click', () => {
            navWrapper.classList.toggle('hidden');
            navWrapper.classList.toggle('flex');
        });
    }

    // Active Hospital Node Perspective Switcher in Header
    document.getElementById('active-hospital-node')?.addEventListener('change', (e) => {
        const node = e.target.value;
        const targetSel = document.getElementById('net-target-hospital');
        if (targetSel && node !== 'ALL') {
            targetSel.value = node;
        }
        updateDispatchButtonLabel();
        loadNetworkHub();
        showToast(
            node === 'ALL'
                ? 'Switched to Regional Network Hub (viewing all hospital nodes).'
                : `Operating as ${node}. Network catalog and self-delivery target updated.`,
            'info',
            'Hospital Perspective Switched'
        );
    });

    // Header global buttons
    document.getElementById('header-redistribute-btn')?.addEventListener('click', () => triggerRedistribution());
    document.getElementById('dashboard-redistribute-all-btn')?.addEventListener('click', () => triggerRedistribution());
    document.getElementById('header-refresh-btn')?.addEventListener('click', async () => {
        await Promise.all([
            loadDashboardSummary(),
            loadOverviewData(),
            loadUsers(),
            loadInventoryTable(),
            loadTrendChart(),
            syncExpiryTrackerFromSelectors(),
            loadNetworkHub()
        ]);
        showToast('All clinical tables, charts, and network transits synchronized.', 'info', 'Data Refreshed');
    });

    document.getElementById('close-redistribution-banner')?.addEventListener('click', () => {
        document.getElementById('redistribution-result-banner')?.classList.add('hidden');
    });

    // Dashboard overview chart filter
    document.getElementById('dash-overview-filter')?.addEventListener('change', () => {
        renderDashboardOverviewChart();
    });

    // Add User Form submission
    document.getElementById('add-user-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            name: document.getElementById('user-name').value.trim(),
            phone: document.getElementById('user-phone').value.trim(),
            email: document.getElementById('user-email').value.trim(),
            town: document.getElementById('user-town').value.trim(),
            postcode: document.getElementById('user-postcode').value.trim().toUpperCase(),
            age: document.getElementById('user-age').value.trim(),
            blood_group: document.getElementById('user-blood-group').value,
            user_type: document.getElementById('user-type').value
        };

        try {
            const res = await fetch('/api/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (res.ok) {
                showToast(data.message, 'success', 'User Registered');
                e.target.reset();
                loadUsers();
                loadDashboardSummary();
            } else {
                showToast(data.error || 'Validation error.', 'error', 'Registration Rejected');
            }
        } catch (err) {
            showToast('Network error submitting user registration.', 'error');
        }
    });

    // User search and filters
    document.getElementById('user-search-input')?.addEventListener('input', loadUsers);
    document.getElementById('user-filter-type')?.addEventListener('change', loadUsers);
    document.getElementById('user-filter-bg')?.addEventListener('change', loadUsers);

    // Inventory controls
    document.getElementById('btn-add-blood')?.addEventListener('click', () => handleInventoryChange('add'));
    document.getElementById('btn-remove-blood')?.addEventListener('click', () => handleInventoryChange('remove'));
    document.getElementById('btn-redistribute-selected')?.addEventListener('click', () => {
        const hosp = document.getElementById('inv-hospital').value;
        const bg = document.getElementById('inv-blood-group').value;
        triggerRedistribution(hosp, bg);
    });

    document.getElementById('inv-hospital')?.addEventListener('change', syncExpiryTrackerFromSelectors);
    document.getElementById('inv-blood-group')?.addEventListener('change', syncExpiryTrackerFromSelectors);
    document.getElementById('test-expired-btn')?.addEventListener('click', () => {
        selectForExpiryTracker('Hospital_1', 'AB-');
    });

    // Inventory table filters & sorting
    document.getElementById('inv-table-hospital-filter')?.addEventListener('change', loadInventoryTable);
    document.getElementById('inv-table-bg-filter')?.addEventListener('change', loadInventoryTable);
    document.getElementById('inv-table-sort')?.addEventListener('change', loadInventoryTable);
    document.getElementById('th-sort-quantity')?.addEventListener('click', () => {
        const sortSelect = document.getElementById('inv-table-sort');
        if (!sortSelect) return;
        sortSelect.value = sortSelect.value === 'asc' ? 'desc' : 'asc';
        loadInventoryTable();
    });

    // Analytics trend selectors
    document.getElementById('trend-bg-select')?.addEventListener('change', loadTrendChart);
    document.getElementById('trend-hospital-select')?.addEventListener('change', loadTrendChart);

    // Network Dispatch form & selectors
    document.getElementById('net-target-hospital')?.addEventListener('change', (e) => {
        const activeSel = document.getElementById('active-hospital-node');
        if (activeSel) activeSel.value = e.target.value;
        updateDispatchButtonLabel();
        loadNetworkHub();
    });
    document.getElementById('net-blood-group')?.addEventListener('change', updateDonorBatchPreview);
    document.getElementById('net-donor-hospital')?.addEventListener('change', updateDonorBatchPreview);
    document.getElementById('net-emergency-override')?.addEventListener('change', () => {
        updateDonorBatchPreview();
        renderNetworkCatalog();
    });
    document.getElementById('net-catalog-bg-filter')?.addEventListener('change', renderNetworkCatalog);

    document.getElementById('network-dispatch-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const target_hospital = document.getElementById('net-target-hospital').value;
        const donor_hospital = document.getElementById('net-donor-hospital').value;
        const blood_group = document.getElementById('net-blood-group').value;
        const quantity = document.getElementById('net-quantity').value;
        const emergency_override = document.getElementById('net-emergency-override').checked;
        const transitMode = document.getElementById('net-transit-mode').value;

        await submitNetworkDispatch({
            target_hospital,
            donor_hospital,
            blood_group,
            quantity,
            emergency_override,
            express_delivery: transitMode === 'express',
            transit_seconds: 30
        });
    });

    // Initial Data Load
    loadDashboardSummary();
    loadOverviewData();
    loadUsers();
    loadInventoryTable();
    loadTrendChart();
    syncExpiryTrackerFromSelectors();
    loadNetworkHub();

    // Start 1-second live expiry & cold-chain transit countdown ticker
    setInterval(() => {
        updateLiveExpiryDisplay();
        tickNetworkDeliveries();
    }, 1000);
});

