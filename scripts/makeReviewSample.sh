#!/usr/bin/env bash
#
# A repository with uncommitted work worth reviewing: the kind of change a
# coding agent hands back — several separate edits through one file, a small
# change to another, and a new file — so review mode has hunks to walk
# through, tick off and comment on.
#
#   ./scripts/makeReviewSample.sh [target-dir] [--committed]
#
# With --committed the same work is committed instead, on a branch of its own
# in two commits — a pull request's worth of history to review, and a clean
# working tree.
#
set -euo pipefail

TARGET="${1:-/tmp/githawk-review-sample}"
MODE="${2:-}"
rm -rf "$TARGET"
mkdir -p "$TARGET/src/billing" "$TARGET/src/shared"
cd "$TARGET"
git init --quiet --initial-branch=main
git config user.name "Sample Author"
git config user.email "author@example.com"
git config commit.gpgsign false

cat > src/billing/invoice.ts <<'TS'
import { formatMoney } from '../shared/money';

export interface LineItem {
    description: string;
    quantity: number;
    unitPrice: number;
}

export interface Invoice {
    number: string;
    customer: string;
    items: LineItem[];
    issuedAt: Date;
}

export function subtotal(invoice: Invoice): number {
    let total = 0;
    for (const item of invoice.items) {
        total += item.quantity * item.unitPrice;
    }
    return total;
}

export function tax(invoice: Invoice, rate: number): number {
    return subtotal(invoice) * rate;
}

export function total(invoice: Invoice, rate: number): number {
    return subtotal(invoice) + tax(invoice, rate);
}

export function dueDate(invoice: Invoice): Date {
    const due = new Date(invoice.issuedAt);
    due.setDate(due.getDate() + 30);
    return due;
}

export function isOverdue(invoice: Invoice, today: Date): boolean {
    return today > dueDate(invoice);
}

export function summary(invoice: Invoice, rate: number): string {
    const lines = invoice.items.map(
        (item) => `${item.description} x${item.quantity}`
    );
    return [
        `Invoice ${invoice.number} for ${invoice.customer}`,
        ...lines,
        `Total: ${formatMoney(total(invoice, rate))}`,
    ].join('\n');
}
TS

git add -A
git commit --quiet -m "Invoices with subtotal, tax and due dates"

cat > src/shared/money.ts <<'TS'
export function formatMoney(amount: number): string {
    return `$${amount.toFixed(2)}`;
}
TS

git add -A
git commit --quiet -m "Format money for invoice summaries"

# The agent's round: three separate edits to invoice.ts…
python3 - <<'PY'
import re
p = 'src/billing/invoice.ts'
s = open(p).read()
s = s.replace("""    issuedAt: Date;
}""", """    issuedAt: Date;
    /** Days until payment is due; 30 when the customer has no terms. */
    paymentTermsDays?: number;
}""")
s = s.replace("""    let total = 0;
    for (const item of invoice.items) {
        total += item.quantity * item.unitPrice;
    }
    return total;""", """    return invoice.items.reduce(
        (sum, item) => sum + item.quantity * item.unitPrice,
        0
    );""")
s = s.replace("""    due.setDate(due.getDate() + 30);""", """    due.setDate(due.getDate() + (invoice.paymentTermsDays ?? 30));""")
s = s.replace("""    return today > dueDate(invoice);""", """    return today.getTime() > dueDate(invoice).getTime();""")
open(p, 'w').write(s)
PY

# …one to money.ts…
cat > src/shared/money.ts <<'TS'
export function formatMoney(amount: number, currency = 'USD'): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}
TS

# …and a new file.
cat > src/billing/reminders.ts <<'TS'
import { Invoice, isOverdue } from './invoice';

export function overdueInvoices(invoices: Invoice[], today: Date): Invoice[] {
    return invoices.filter((invoice) => isOverdue(invoice, today));
}
TS

if [ "$MODE" = "--committed" ]; then
    git checkout --quiet -b feature/payment-terms
    git add src/billing/invoice.ts src/shared/money.ts
    git commit --quiet -m "Payment terms per customer, and currency-aware money"
    git add src/billing/reminders.ts
    git commit --quiet -m "List overdue invoices for reminders"
fi

echo "Built $TARGET"
