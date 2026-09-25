const WALLET_DEBIT_TYPES = new Set([
  "registration",
  "renewal",
  "penalty",
  "arrears",
  "late_payment",
  "case_wallet_deduction",
  "wallet_manual_adjustment",
]);

const WALLET_NEUTRAL_TYPES = new Set([
  "reversal_memo",
  "contribution",
]);

/**
 * Signed wallet effect for one transaction row.
 * Returns null for non-completed rows (pending/failed/reversed status rows).
 */
export function walletRowDelta(
  transactionType: string | null | undefined,
  amount: number | null | undefined,
  status: string | null | undefined
): number | null {
  if (status && status !== "completed") return null;
  const txType = String(transactionType || "");
  const txAmount = Number(amount) || 0;

  if (WALLET_NEUTRAL_TYPES.has(txType)) return 0;
  if (WALLET_DEBIT_TYPES.has(txType)) return -Math.abs(txAmount);
  return txAmount;
}

