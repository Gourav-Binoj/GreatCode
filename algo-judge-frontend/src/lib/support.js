// =====================================
// SUPPORT / UPI CONFIGURATION
// =====================================
//
// A UPI ID is not a secret - it is the address people pay TO, and it
// has to reach the browser for any payment link to work. It still
// lives in env rather than in the source so the page can be shared
// or forked without carrying someone else's payment details.
//
// Set in .env locally and in Vercel for production:
//   VITE_UPI_ID    yourname@okaxis
//   VITE_UPI_NAME  Your Name
//   VITE_SUPPORT_URL  (optional) an external page, e.g. Buy Me a Coffee

export const UPI_ID =
  import.meta.env.VITE_UPI_ID || "";

export const UPI_NAME =
  import.meta.env.VITE_UPI_NAME || "GreatCode";

export const SUPPORT_URL =
  import.meta.env.VITE_SUPPORT_URL || "";


export const UPI_CONFIGURED = Boolean(UPI_ID);


// Preset amounts, in rupees.
export const COFFEE_TIERS = [
  { amount: 49, label: "Chai", emoji: "☕" },
  { amount: 99, label: "Coffee", emoji: "🍵" },
  { amount: 199, label: "Lunch", emoji: "🍛" },
];


// =====================================
// UPI DEEP LINK
// =====================================
//
// Builds a upi:// intent URL per the UPI linking spec. Opening it on
// a phone hands off to whichever UPI app is installed - GPay, PhonePe,
// Paytm - and pre-fills the payee and amount.
//
// Desktop browsers have no handler for upi://, which is why the page
// also renders the same string as a QR code: the user scans it with
// the phone they would have paid from anyway.
//
//   pa  payee address (the VPA)
//   pn  payee name
//   am  amount
//   cu  currency
//   tn  transaction note

export function buildUpiUrl({ amount, note } = {}) {

  if (!UPI_ID) {
    return "";
  }

  const params = new URLSearchParams();

  params.set("pa", UPI_ID);
  params.set("pn", UPI_NAME);
  params.set("cu", "INR");

  // Amount is optional: omitting it lets the payer choose in their
  // own app, which is the friendlier default for a tip jar.
  if (amount) {
    params.set("am", String(amount));
  }

  if (note) {
    params.set("tn", note);
  }

  // URLSearchParams encodes a space as "+", which is correct for
  // HTML form submission but wrong here: UPI apps percent-decode the
  // query, so "+" survives literally and the payee name shows up as
  // "Gourav+Binoj". %20 is decoded to a space by both.
  return `upi://pay?${params.toString().replace(/\+/g, "%20")}`;

}
