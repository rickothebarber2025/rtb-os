#!/usr/bin/env python3
"""RTB staff reconciliation helpers for Jarvis/Ada.

Normalizes staff aliases and reconciles appointment/service revenue, tips,
payroll and actual payments. This module is intentionally data-source agnostic:
callers provide records already read from Square/RTB OS/payroll/bank sources.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable, Mapping, Any

MONEY = Decimal("0.01")

# Known Square identity aliases. Add aliases here instead of allowing one staff
# member to fragment across multiple payroll identities.
STAFF_ALIASES = {
    "failla mika": "Failla Mika",
    "failla mika, failla mika": "Failla Mika",
}


def money(value: Any) -> Decimal:
    return Decimal(str(value or 0)).quantize(MONEY, rounding=ROUND_HALF_UP)


def normalize_staff(name: str) -> str:
    cleaned = " ".join(str(name or "").strip().split())
    return STAFF_ALIASES.get(cleaned.casefold(), cleaned)


@dataclass
class Reconciliation:
    staff: str
    service_revenue: Decimal
    tips: Decimal
    commission_rate: Decimal
    deduction: Decimal
    expected_pay: Decimal
    paid: Decimal
    outstanding: Decimal
    status: str
    source_identities: list[str]

    def json(self):
        payload = asdict(self)
        for key in ("service_revenue", "tips", "commission_rate", "deduction", "expected_pay", "paid", "outstanding"):
            payload[key] = float(payload[key])
        return payload


def reconcile_staff(
    staff: str,
    transactions: Iterable[Mapping[str, Any]],
    payments: Iterable[Mapping[str, Any]],
    commission_rate: float,
    deduction: float = 5,
) -> Reconciliation:
    canonical = normalize_staff(staff)
    service_revenue = Decimal("0")
    tips = Decimal("0")
    identities: set[str] = set()

    for tx in transactions:
        raw_name = str(tx.get("staff_name") or tx.get("Staff Name") or "")
        if normalize_staff(raw_name) != canonical:
            continue
        identities.add(raw_name)
        # Retail/products are not commissionable at RTB.
        kind = str(tx.get("kind") or tx.get("type") or tx.get("category") or "service").casefold()
        if kind not in {"product", "retail"}:
            service_revenue += money(tx.get("net_sales", tx.get("Net Sales", 0)))
        tips += money(tx.get("tip", tx.get("Tip", 0)))

    paid = sum((money(p.get("amount", 0)) for p in payments if normalize_staff(str(p.get("staff_name") or p.get("staff") or "")) == canonical), Decimal("0"))
    rate = Decimal(str(commission_rate))
    deduction_d = money(deduction)
    expected = (service_revenue * rate).quantize(MONEY, rounding=ROUND_HALF_UP) + tips - deduction_d
    expected = expected.quantize(MONEY, rounding=ROUND_HALF_UP)
    outstanding = (expected - paid).quantize(MONEY, rounding=ROUND_HALF_UP)
    status = "reconciled" if outstanding == 0 else ("underpaid" if outstanding > 0 else "overpaid")

    return Reconciliation(
        staff=canonical,
        service_revenue=service_revenue,
        tips=tips,
        commission_rate=rate,
        deduction=deduction_d,
        expected_pay=expected,
        paid=paid,
        outstanding=outstanding,
        status=status,
        source_identities=sorted(i for i in identities if i),
    )


def failla_known_resolution() -> dict[str, Any]:
    """Known resolved payroll incident from 2026-08-31 through 2026-09-06."""
    return {
        "staff": "Failla Mika",
        "period": "2026-08-31/2026-09-06",
        "service_revenue": 370.50,
        "tips": 21.93,
        "commission_rate": 0.55,
        "deduction": 5.00,
        "expected_pay": 220.71,
        "payments": [67.12, 153.59],
        "paid_total": 220.71,
        "outstanding": 0.00,
        "status": "reconciled",
        "cause": "Square transactions were split between Failla Mika and Failla Mika, Failla Mika.",
        "operational_rule": "Use the shop POS for staff payments so transactions remain on the canonical staff identity.",
    }
