BRANDVAULT TRADEMARK DASHBOARD
==============================

File: brandvault-trademark-dashboard.html
Location: /sessions/zen-compassionate-archimedes/mnt/outputs/brandvault/public/

OVERVIEW
--------
This is a complete, single-file HTML dashboard that replicates the InnoVault patent 
dashboard design, adapted for trademark management. The dashboard is fully functional 
and requires no server-side components.

DESIGN SPECIFICATIONS
---------------------
- Exact CSS replica of InnoVault design with verbatim classes
- 240px sidebar with navigation hierarchy
- Top bar with breadcrumbs and status badge
- 4-stat card row with grid layout
- 4 tabbed sections with dynamic content
- 340px right panel with alerts and renewals
- InnoVault color palette: #37352f (primary), #fbfbfa (background), etc.
- Professional typography using Inter font family

FEATURES
--------
1. Actions Required Tab
   - Lists trademarks needing renewal within 365 days
   - Sorted by urgency (days until expiry)
   - Color-coded badges: red (≤90d), orange (91-180d), green (181-365d)
   - Shows registry and registration number

2. By Mark Tab
   - Groups trademarks by mark text (e.g., YOTI, INNOVATE)
   - Collapsible cards showing Nice classifications
   - Displays registry, application/registration number, status
   - Status colors: green (Registered), blue (Published), orange (Pending)

3. Pipeline Tab
   - 6-stage filing pipeline: FILED → PUBLISHED → PENDING → REGISTERED → ABANDONED → EXPIRED
   - Bubble visualization with counts
   - Bottom 5 Nice classes with horizontal bar chart

4. By Registry Tab
   - Groups trademarks by registry (UKIPO, EUIPO, etc.)
   - Shows registered vs. pending count summary
   - Expandable to show individual marks per registry

Right Panel
-----------
- AILA Intelligence: Portfolio status message
- BrandVault Alert: Renewal deadline warning
- Portfolio Insight: Nice class breakdown
- Data Source: Last update timestamp
- Upcoming Renewals: Top 5 renewals sorted by urgency

DATA BINDING
-----------
The dashboard loads trademark data from trademark-data.json, which should be 
in the same directory. The JSON structure expected:
[
  {
    "id": "TM-UK-001",
    "registry_name": "UKIPO",
    "mark_text": "YOTI",
    "application_number": "UK00003218765",
    "registration_number": "UK00003218765",
    "status": "Registered",
    "expiry_date": "2027-06-15",
    "good_and_services": [
      { "search_class": { "number": 9 } }
    ]
  }
]

If data loading fails, the dashboard displays sample data (YOTI, INNOVATE).

STYLING
-------
- All CSS is inline (single-file)
- Color palette colors: #2e6b8a, #6940a5, #0f7b6c, #c4823f, #8b5e3c (badge rotation)
- Layout: Flexbox with CSS Grid for stats row
- Responsive scrollable panels
- Custom scrollbar styling
- Hover states and transitions

JAVASCRIPT
----------
- 939 lines total (including HTML and CSS)
- No external dependencies except CDN libs for export
- Uses document.createElement for all DOM manipulation (no innerHTML)
- Functions:
  * initApp() - Load trademark data
  * renderDashboard() - Update stats
  * renderTab(tabName) - Switch between tabs
  * renderActionsTab/Marks/Pipeline/Registry() - Populate each tab
  * renderUpcomingRenewals() - Right panel renewal list

BROWSER COMPATIBILITY
---------------------
- Modern browsers (Chrome, Firefox, Safari, Edge)
- Requires JavaScript enabled
- Supports local file:// protocol loading for trademark-data.json

USAGE
-----
1. Open brandvault-trademark-dashboard.html in a web browser
2. Ensure trademark-data.json is in the same directory
3. Dashboard loads automatically on page load
4. Click tabs to switch between views
5. Click expandable cards to show/hide details

EXPORTS (Potential)
-------------------
The file includes CDN links for SheetJS and html2pdf for export functionality
(not fully implemented in UI, but libraries loaded).

STYLING NOTES
-------------
- Sidebar: 240px width, #fbfbfa background, 1px border
- All colors match InnoVault spec exactly
- Letter-spacing: 0.05em for section labels
- Font sizes: 26px title, 13px nav items, 11px labels
- Border radius: 6px (inputs), 10px (cards), 12px (stat row)

Author: Generated with InnoVault design specification
Date: February 2026
