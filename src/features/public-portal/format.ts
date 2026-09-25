/**
 * Date and money words for the public pages. Server- and client-safe.
 *
 * Two zones, on purpose. A registration's validity (`validFrom`, `validTo`) is a
 * calendar DAY stored at midnight UTC, and must print as that day whatever the
 * server's clock says. Everything else — a submission, a decision, a payment —
 * is an INSTANT, and is printed as the day it was in India.
 */
const day = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const instant = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const instantTime = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

export const fmtDay = (iso: string | null | undefined): string => (iso ? day.format(new Date(iso)) : '—');
export const fmtInstant = (iso: string | null | undefined): string => (iso ? instant.format(new Date(iso)) : '—');
export const fmtInstantTime = (iso: string | null | undefined): string => (iso ? instantTime.format(new Date(iso)) : '—');

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
export const fmtRupees = (n: number): string => rupees.format(n);
