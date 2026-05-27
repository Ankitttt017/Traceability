/**
 * time.js
 * Frontend time utilities to ensure consistent industrial formatting.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Formats a date to: DD-MMM-YYYY HH:mm:ss
 * Example: 13-May-2026 17:40:55
 */
export function formatIndustrial(dateInput) {
  if (!dateInput) return "-";
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return "-";

  const day = String(d.getDate()).padStart(2, '0');
  const month = MONTHS[d.getMonth()];
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');

  return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
}

/**
 * Returns a date string compatible with <input type="datetime-local">
 * Format: YYYY-MM-DDTHH:mm
 */
export function toDatetimeLocal(dateInput) {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return "";
  
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Industrial Shift Logic (Presets)
 */
export function getShiftInterval(shiftType = 'current') {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  switch(shiftType) {
    case 'today':
      return { 
        from: new Date(today.setHours(0,0,0,0)), 
        to: new Date(today.setHours(23,59,59,999)) 
      };
    case 'yesterday':
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return {
        from: new Date(yesterday.setHours(0,0,0,0)),
        to: new Date(yesterday.setHours(23,59,59,999))
      };
    case 'last7days':
      const lastWeek = new Date(today);
      lastWeek.setDate(lastWeek.getDate() - 7);
      return {
        from: new Date(lastWeek.setHours(0,0,0,0)),
        to: new Date(now)
      };
    case 'current_shift':
      const hour = now.getHours();
      if (hour >= 6 && hour < 14) {
        return { from: new Date(today.setHours(6,0,0,0)), to: new Date(today.setHours(14,0,0,0)) };
      } else if (hour >= 14 && hour < 22) {
        return { from: new Date(today.setHours(14,0,0,0)), to: new Date(today.setHours(22,0,0,0)) };
      } else {
        const start = new Date(today);
        if (hour < 6) start.setDate(start.getDate() - 1);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        return { from: new Date(start.setHours(22,0,0,0)), to: new Date(end.setHours(6,0,0,0)) };
      }
    default:
      return { from: new Date(today), to: new Date(now) };
  }
}
