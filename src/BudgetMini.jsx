import React from 'react';

const monthKey = (date) => {
  const d = new Date(`${date}T12:00:00`);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const money = (amount, currency) => new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount || 0);

export default function BudgetMini({ budgets, transactions, currency }) {
  const currentMonth = monthKey(new Date().toISOString().slice(0, 10));
  return <div className="budget-mini-list">{budgets.slice(0, 4).map((budget) => {
    const spent = transactions.filter((transaction) => transaction.type === 'expense' && transaction.category_id === budget.category_id && monthKey(transaction.date) === currentMonth).reduce((total, transaction) => total + transaction.amount, 0);
    const percent = Math.min(100, Math.round(spent / budget.amount * 100));
    return <div className="budget-mini-item" key={budget.id}>
      <div className="budget-mini-meta"><span>{budget.category}</span><span>{money(spent, currency)} <small>of {money(budget.amount, currency)}</small></span></div>
      <div className="mini-progress"><i style={{ width: `${percent}%`, background: percent >= 85 ? '#f2a944' : undefined }} /></div>
    </div>;
  })}</div>;
}
