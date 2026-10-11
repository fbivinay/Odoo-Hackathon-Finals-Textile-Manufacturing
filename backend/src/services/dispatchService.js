const prisma = require('../lib/prisma');
const { nextNumber } = require('../lib/numbering');
const { notFound, conflict, badRequest } = require('../lib/errors');
const { syncStatus, sumQty } = require('./orderService');
const { pageArgs, toPage, countFor, dateRange } = require('../lib/paging');
const { taxFor } = require('../lib/tax');
const { setting } = require('./configService');

// What an order still has to deliver in all: its quantity less fabric rejected at quality check,
// which a separate remake order now owes.
async function toShip(db, order) {
  const rejected = await db.roll.aggregate({ where: { orderId: order.id, status: 'REJECTED' }, _sum: { qty: true } });
  return Math.max(0, Math.round((Number(order.qty) - Number(rejected._sum.qty || 0)) * 100) / 100);
}

const dispatchInclude = {
  order: { select: { id: true, orderNo: true, fabricType: true, colour: true, qty: true } },
  buyer: { select: { id: true, name: true, phone: true, address: true } },
  rolls: { select: { id: true, rollNo: true, qty: true } },
  invoice: { include: { payments: true } },
};

// Payable = the GST-inclusive total (the pre-tax amount on invoices from before GST fields).
const payableOf = (invoice) => Number(invoice.totalAmount ?? invoice.amount);
const withBalance = (invoice) => {
  const paid = sumAmount(invoice.payments);
  return { ...invoice, paid, balance: Math.round((payableOf(invoice) - paid) * 100) / 100 };
};
const sumAmount = (rows) => rows.reduce((total, r) => total + Number(r.amount), 0);

// Finished fabric sitting on the shelf: passed QC, not yet loaded on a truck. Rolls of cancelled
// orders are listed apart as unsold stock: made, but no buyer waiting for them.
async function stock() {
  const unsold = await prisma.roll.findMany({
    where: { dispatchId: null, status: { in: ['PASSED', 'PENDING_QC', 'REWORK'] }, order: { status: 'CANCELLED' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, rollNo: true, qty: true, status: true, createdAt: true, order: { select: { id: true, orderNo: true, fabricType: true, colour: true, note: true, buyer: { select: { name: true } } } } },
  });
  const rolls = await prisma.roll.findMany({
    where: { status: 'PASSED', dispatchId: null, order: { status: { not: 'CANCELLED' } } },
    orderBy: { createdAt: 'asc' },
    include: {
      order: {
        select: {
          id: true, orderNo: true, fabricType: true, colour: true, qty: true, deadline: true,
          buyer: { select: { id: true, name: true, address: true } },
        },
      },
    },
  });

  const groups = new Map();
  for (const { order, ...roll } of rolls) {
    if (!groups.has(order.id)) groups.set(order.id, { order, rolls: [], totalQty: 0 });
    const group = groups.get(order.id);
    group.rolls.push(roll);
    group.totalQty += Number(roll.qty);
  }
  for (const group of groups.values()) group.order.toShip = await toShip(prisma, group.order);
  return { orders: [...groups.values()], totalRolls: rolls.length, totalQty: sumQty(rolls), unsold: { rolls: unsold, totalQty: sumQty(unsold) } };
}

async function create({ orderId, rollIds, vehicleNo }) {
  const ids = [...new Set(rollIds)];

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw notFound('Order not found');
    if (order.status === 'CANCELLED') throw badRequest('Order is cancelled');

    // An order goes out whole, in one truck: no part deliveries. "Whole" allows the buyer's tolerance.
    const [owed, sent, truck, tolerancePct] = await Promise.all([
      toShip(tx, order),
      tx.roll.aggregate({ where: { orderId, status: 'DISPATCHED' }, _sum: { qty: true } }),
      tx.roll.aggregate({ where: { id: { in: ids }, orderId, status: 'PASSED', dispatchId: null }, _sum: { qty: true } }),
      setting('dispatchTolerancePct'),
    ]);
    const short = Math.round((owed * (1 - tolerancePct / 100) - Number(sent._sum.qty || 0) - Number(truck._sum.qty || 0)) * 100) / 100;
    if (short > 0) throw conflict(`This order is not complete yet: ${short} m is still to come. Orders are dispatched whole.`, 'ORDER_NOT_COMPLETE');

    const dispatch = await tx.dispatch.create({
      data: { dispatchNo: await nextNumber(tx.dispatch, 'DSP'), orderId, buyerId: order.buyerId, vehicleNo },
    });

    // Only rolls of this order that passed QC and are still on the shelf get claimed.
    // A short count means a wrong, unchecked or already-dispatched roll: roll everything back.
    const { count } = await tx.roll.updateMany({
      where: { id: { in: ids }, orderId, status: 'PASSED', dispatchId: null },
      data: { status: 'DISPATCHED', dispatchId: dispatch.id },
    });
    if (count !== ids.length) {
      throw conflict('Some rolls are not passed, already dispatched, or belong to another order', 'ROLLS_NOT_AVAILABLE');
    }

    const rolls = await tx.roll.findMany({ where: { dispatchId: dispatch.id } });
    // Taxable value = metres sent x the order price; 5% GST on fabric by the buyer's state.
    const buyer = await tx.buyer.findUnique({ where: { id: order.buyerId } });
    const amount = Math.round(sumQty(rolls) * Number(order.pricePerUnit) * 100) / 100;
    const now = new Date();
    await tx.invoice.create({
      data: {
        invoiceNo: await nextNumber(tx.invoice, 'INV'),
        dispatchId: dispatch.id,
        amount,
        issuedAt: now,
        dueDate: new Date(now.getTime() + buyer.creditDays * 86400000),
        ...taxFor('FABRIC', amount, now, buyer.state),
        itcEligible: false, // output tax: input credit is the buyer's
      },
    });
    await syncStatus(tx, orderId);

    const full = await tx.dispatch.findUnique({ where: { id: dispatch.id }, include: dispatchInclude });
    return shape(full);
  });
}

const shape = (dispatch) => ({
  ...dispatch,
  totalQty: sumQty(dispatch.rolls),
  invoice: dispatch.invoice && withBalance(dispatch.invoice),
});

// from/to filter on dispatchedAt.
async function list(query = {}) {
  const { orderId, buyerId, from, to } = query;
  const where = { orderId, buyerId, dispatchedAt: dateRange(from, to) };
  const rows = await prisma.dispatch.findMany({
    where,
    orderBy: [{ dispatchedAt: 'desc' }, { id: 'desc' }],
    include: dispatchInclude,
    ...pageArgs(query),
  });
  const total = await countFor(prisma.dispatch, where, query);
  return toPage(rows.map(shape), query, total);
}

async function get(id) {
  const dispatch = await prisma.dispatch.findUnique({ where: { id }, include: dispatchInclude });
  if (!dispatch) throw notFound('Dispatch not found');
  return shape(dispatch);
}

const invoiceInclude = {
  payments: { orderBy: { paidAt: 'desc' } },
  dispatch: {
    select: {
      id: true, dispatchNo: true, dispatchedAt: true,
      order: { select: { id: true, orderNo: true } },
      buyer: { select: { id: true, name: true } },
    },
  },
};

// from/to filter on issuedAt.
async function listInvoices(query = {}) {
  const { from, to, buyerId } = query;
  // ?open=true: everything still owed, whether untouched or part paid. ?buyerId= one client's invoices.
  const status = query.open === 'true' ? { in: ['UNPAID', 'PARTIAL'] } : query.status;
  const where = { status, issuedAt: dateRange(from, to), ...(buyerId ? { dispatch: { buyerId } } : {}) };
  const rows = await prisma.invoice.findMany({
    where,
    // Oldest first when collecting, so the longest-owed order is at the top.
    orderBy: query.open === 'true' ? [{ issuedAt: 'asc' }, { id: 'asc' }] : [{ issuedAt: 'desc' }, { id: 'desc' }],
    include: invoiceInclude,
    ...pageArgs(query),
  });
  const total = await countFor(prisma.invoice, where, query);
  return toPage(rows.map(withBalance), query, total);
}

async function addPayment(invoiceId, { amount, method, reference }, user) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } });
    if (!invoice) throw notFound('Invoice not found');

    // Whole paise, so a balance of 0.01 is not lost to floating point.
    const balance = Math.round(payableOf(invoice) * 100) - Math.round(sumAmount(invoice.payments) * 100);
    const value = Math.round(Number(amount) * 100);
    if (value <= 0) throw badRequest('Payment must be more than zero');
    if (value > balance) throw badRequest(`Payment exceeds the balance of ${(balance / 100).toFixed(2)}`);

    await tx.payment.create({ data: { invoiceId, amount: value / 100, method, reference } });
    const updated = await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: value === balance ? 'PAID' : 'PARTIAL' },
      include: invoiceInclude,
    });
    await tx.auditLog.create({ data: { entity: 'Invoice', entityId: invoiceId, action: 'PAYMENT', detail: `${(value / 100).toFixed(2)} by ${method || 'unspecified'}${reference ? ` (${reference})` : ''}`, by: user?.name || 'system' } });
    return withBalance(updated);
  });
}

module.exports = { stock, create, list, get, listInvoices, addPayment, withBalance, payableOf };
