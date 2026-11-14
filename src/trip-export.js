import { jsPDF } from 'jspdf';

const formatValue = (value) => value === null || value === undefined || value === '' ? 'Not provided' : String(value);

const formatMoney = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
    : formatValue(value);
};

const formatDate = (value) => {
  if (!value) return 'Date not set';
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' }).format(date);
};

export function downloadTripPdf(data) {
  if (!data?.trip || typeof data.trip !== 'object') {
    throw new Error('Trip details are unavailable. Please reload the trip and try again.');
  }

  const { trip } = data;
  const items = Array.isArray(data.items) ? [...data.items].sort((left, right) => (
    Number(left.day_number || 0) - Number(right.day_number || 0)
    || String(left.start_time || '').localeCompare(String(right.start_time || ''))
  )) : [];
  const estimatedCost = items.reduce((total, item) => total + Number(item.est_cost || 0), 0);
  const budgetLeft = Number(trip.budget || 0) - estimatedCost;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 18;
  const contentWidth = pageWidth - margin * 2;
  let y = 41;

  function drawHeader() {
    pdf.setFillColor(31, 48, 34);
    pdf.rect(0, 0, pageWidth, 29, 'F');
    pdf.setTextColor(250, 247, 239);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(15);
    pdf.text('EcoTrip', margin, 13);
    pdf.setFontSize(8);
    pdf.setCharSpace(1.2);
    pdf.text('TRIP PLAN', margin, 21);
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

  function drawPesoAmount(value, x, baseline, fontSize) {
    const amount = Number(value);
    const label = Number.isFinite(amount) ? formatMoney(amount) : formatValue(value);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(fontSize);
    pdf.setTextColor(38, 43, 35);
    // Standard PDF fonts can substitute the peso glyph, so draw it from a P and two bars.
    pdf.text('P', x, baseline);
    const symbolWidth = pdf.getTextWidth('P') * 0.78;
    const symbolHeight = fontSize * 0.3528;
    const firstBarY = baseline - symbolHeight * 0.4;
    const secondBarY = baseline - symbolHeight * 0.68;
    pdf.setDrawColor(38, 43, 35);
    pdf.setLineWidth(0.2);
    pdf.line(x - 0.15, firstBarY, x + symbolWidth, firstBarY);
    pdf.line(x - 0.15, secondBarY, x + symbolWidth, secondBarY);
    pdf.text(label, x + symbolWidth + 1, baseline);
  }

  function addSummaryRow(label, value, isMoney = false) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(117, 91, 67);
    pdf.text(`${label}:`, margin + 3, y);
    if (isMoney) {
      drawPesoAmount(value, margin + 37, y, 9);
      y += 7;
      return;
    }
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(38, 43, 35);
    const lines = pdf.splitTextToSize(formatValue(value), contentWidth - 37);
    pdf.text(lines, margin + 37, y);
    y += Math.max(5, lines.length * 4.5) + 2;
  }

  function addStop(item) {
    const description = pdf.splitTextToSize(formatValue(item.description), contentWidth - 10);
    const metadata = [
      String(item.start_time || '').slice(0, 5) || 'Time not set',
      formatValue(item.item_type || 'Activity'),
      Number(item.completed) ? 'Completed' : 'Not completed',
    ].join(' / ');
    const costOffset = 12 + description.length * 4.5;
    const co2Offset = costOffset + 4.5;
    const height = co2Offset + 4;
    ensureSpace(height);
    const costY = y + costOffset;
    const co2Y = y + co2Offset;

    pdf.setDrawColor(224, 215, 198);
    pdf.setFillColor(255, 253, 248);
    pdf.roundedRect(margin, y, contentWidth, height, 2, 2, 'FD');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.text(description, margin + 5, y + 7);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(103, 103, 92);
    pdf.text(metadata, margin + 5, y + 7 + description.length * 4.5);
    pdf.setTextColor(38, 43, 35);
    pdf.text('Estimated cost:', margin + 5, costY);
    drawPesoAmount(item.est_cost, margin + 5 + pdf.getTextWidth('Estimated cost: '), costY, 8);
    pdf.text(`Estimated CO2: ${formatValue(item.est_co2_kg ?? 0)} kg`, margin + 5, co2Y);
    y += height + 4;
  }

  drawHeader();
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(20);
  const titleLines = pdf.splitTextToSize(formatValue(trip.title || trip.destination || 'Trip plan'), contentWidth);
  pdf.text(titleLines, margin, y);
  y += titleLines.length * 8 + 2;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(103, 103, 92);
  pdf.text(`${formatValue(trip.destination)}  |  ${formatDate(trip.start_date)} - ${formatDate(trip.end_date)}`, margin, y);
  y += 6;
  pdf.setFontSize(8);
  pdf.text(`Generated ${new Date().toLocaleDateString('en-PH')}`, margin, y);
  pdf.setTextColor(38, 43, 35);
  y += 10;

  addSection('Trip summary');
  addSummaryRow('Destination', trip.destination);
  addSummaryRow('Dates', `${formatDate(trip.start_date)} to ${formatDate(trip.end_date)}`);
  addSummaryRow('Travelers', trip.travelers);
  addSummaryRow('Status', trip.status);
  addSummaryRow('Trip budget', trip.budget, true);
  addSummaryRow('Estimated itinerary cost', estimatedCost, true);
  addSummaryRow('Estimated budget left', budgetLeft, true);
  y += 5;

  addSection(`Itinerary (${items.length} stops)`);
  if (items.length) {
    const groupedItems = items.reduce((groups, item) => {
      const day = Number(item.day_number) || 1;
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(item);
      return groups;
    }, new Map());

    groupedItems.forEach((dayItems, dayNumber) => {
      const dayDate = new Date(`${trip.start_date}T00:00:00`);
      if (!Number.isNaN(dayDate.getTime())) dayDate.setDate(dayDate.getDate() + dayNumber - 1);
      ensureSpace(12);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(11);
      const dayLabel = Number.isNaN(dayDate.getTime()) ? `Day ${dayNumber}` : `Day ${dayNumber} - ${formatDate(dayDate)}`;
      pdf.text(dayLabel, margin, y);
      y += 7;
      dayItems.forEach(addStop);
      y += 3;
    });
  } else {
    addSummaryRow('Details', 'No itinerary stops have been saved for this trip yet.');
  }

  const pageCount = pdf.internal.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(224, 215, 198);
    pdf.line(margin, pageHeight - 14, pageWidth - margin, pageHeight - 14);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(117, 117, 105);
    pdf.text('EcoTrip trip plan', margin, pageHeight - 9);
    pdf.text(`${page} / ${pageCount}`, pageWidth - margin, pageHeight - 9, { align: 'right' });
  }

  const slug = String(trip.title || trip.destination || 'trip-plan')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'trip-plan';
  pdf.save(`ecotrip-${slug}.pdf`);
}
