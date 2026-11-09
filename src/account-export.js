import { jsPDF } from 'jspdf';

const formatValue = (value) => {
  if (value === null || value === undefined || value === '') return 'Not provided';
  return String(value);
};

const formatMoney = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount)
    : formatValue(value);
};

export function downloadAccountPdf(data) {
  if (!data || typeof data !== 'object' || !data.profile) {
    throw new Error('Your account export did not include profile data. Please try again.');
  }

  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 18;
  const contentWidth = pageWidth - margin * 2;
  let y = 42;

  function drawHeader() {
    pdf.setFillColor(31, 48, 34);
    pdf.rect(0, 0, pageWidth, 29, 'F');
    pdf.setTextColor(250, 247, 239);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(15);
    pdf.text('EcoTrip', margin, 13);
    pdf.setFontSize(8);
    pdf.setCharSpace(1.2);
    pdf.text('PERSONAL DATA EXPORT', margin, 21);
    pdf.setCharSpace(0);
    pdf.setTextColor(38, 43, 35);
  }

  function addPage() {
    pdf.addPage();
    drawHeader();
    y = 40;
  }

  function ensureSpace(height) {
    if (y + height > pageHeight - 20) addPage();
  }

  function addSection(title) {
    ensureSpace(13);
    pdf.setFillColor(242, 237, 226);
    pdf.roundedRect(margin, y, contentWidth, 9, 2, 2, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(82, 66, 49);
    pdf.text(title.toUpperCase(), margin + 4, y + 6);
    pdf.setTextColor(38, 43, 35);
    y += 14;
  }

  function addRecord(title, fields) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    const rows = fields.map(([label, value]) => {
      const lines = pdf.splitTextToSize(formatValue(value), contentWidth - 10);
      return { label, lines };
    });
    const height = 11 + rows.reduce((total, row) => total + 4 + row.lines.length * 4.3 + 2, 0);
    ensureSpace(height);

    pdf.setDrawColor(224, 215, 198);
    pdf.setFillColor(255, 253, 248);
    pdf.roundedRect(margin, y, contentWidth, height, 2, 2, 'FD');
    let rowY = y + 7;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.text(pdf.splitTextToSize(title, contentWidth - 10), margin + 5, rowY);
    rowY += 7;

    rows.forEach((row) => {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8);
      pdf.setTextColor(117, 91, 67);
      pdf.text(`${row.label}:`, margin + 5, rowY);
      rowY += 4;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(38, 43, 35);
      pdf.text(row.lines, margin + 5, rowY);
      rowY += row.lines.length * 4.3 + 2;
    });

    pdf.setTextColor(38, 43, 35);
    y += height + 5;
  }

  drawHeader();
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  pdf.text('Your EcoTrip records', margin, y);
  y += 7;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(103, 103, 92);
  pdf.text(`Generated ${new Date().toLocaleDateString()}`, margin, y);
  pdf.setTextColor(38, 43, 35);
  y += 10;

  const profile = data.profile;
  addSection('Profile');
  addRecord(profile.name || 'Account profile', [
    ['Email', profile.email],
    ['Phone', profile.phone],
    ['Address', profile.address],
    ['Account type', profile.role],
    ['Joined', profile.created_at],
  ]);

  const trips = Array.isArray(data.trips) ? data.trips : [];
  addSection(`Trips (${trips.length})`);
  if (trips.length) {
    trips.forEach((trip) => addRecord(trip.title || `Trip ${trip.id}`, [
      ['Destination', trip.destination],
      ['Dates', `${formatValue(trip.start_date)} to ${formatValue(trip.end_date)}`],
      ['Budget', formatMoney(trip.budget)],
      ['Travelers', trip.travelers],
      ['Status', trip.status],
      ['Estimated emissions', trip.total_co2_kg === null || trip.total_co2_kg === undefined ? null : `${trip.total_co2_kg} kg CO2`],
    ]));
  } else {
    addRecord('No trips', [['Details', 'No trips were included in this export.']]);
  }

  const bookings = Array.isArray(data.bookings) ? data.bookings : [];
  addSection(`Bookings (${bookings.length})`);
  if (bookings.length) {
    bookings.forEach((booking) => addRecord(`Booking ${booking.id}`, [
      ['Trip', booking.trip_id],
      ['Reservation', booking.reservation_name],
      ['Amount', formatMoney(booking.amount)],
      ['Offset contribution', formatMoney(booking.offset_amount)],
      ['Payment status', booking.payment_status],
      ['Created', booking.created_at],
    ]));
  } else {
    addRecord('No bookings', [['Details', 'No bookings were included in this export.']]);
  }

  const pageCount = pdf.internal.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(224, 215, 198);
    pdf.line(margin, pageHeight - 14, pageWidth - margin, pageHeight - 14);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(117, 117, 105);
    pdf.text('EcoTrip personal data export', margin, pageHeight - 9);
    pdf.text(`${page} / ${pageCount}`, pageWidth - margin, pageHeight - 9, { align: 'right' });
  }

  pdf.save('ecotrip-data.pdf');
}
