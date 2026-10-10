const prisma = require('../lib/prisma');
const { nextNumber } = require('../lib/numbering');
const { notFound, conflict, badRequest } = require('../lib/errors');
const { syncStatus, sumQty } = require('./orderService');

const dispatchInclude = {
  order: { select: { id: true, orderNo: true, fabricType: true, colour: true, qty: true } },
  buyer: { select: { id: true, name: true, phone: true } },
  rolls: { select: { id: true, rollNo: true, qty: true } },
  invoice: { include: { payments: true } },
};

const withBalance = (invoice) => {
  const paid = sumAmount(invoice.payments);
  return { ...invoice, paid, balance: Number(invoice.amount) - paid };
};
const sumAmount = (rows) => rows.reduce((total, r) => total + Number(r.amount), 0);

// Finished fabric sitting on the shelf: passed QC, not yet loaded on a truck.
async function stock() {
  const rolls = await prisma.roll.findMany({
    where: { status: 'PASSED', dispatchId: null },
    orderBy: { createdAt: 'asc' },
    include: {
      order: {
        select: {
          id: true, orderNo: true, fabricType: true, colour: true, qty: true, deadline: true,
          buyer: { select: { id: true, name: true } },
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
  return { orders: [...groups.values()], totalRolls: rolls.length, totalQty: sumQty(rolls) };
}

async function create({ orderId, rollIds, vehicleNo }) {
  const ids = [...new Set(rollIds)];

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw notFound('Order not found');
    if (order.status === 'CANCELLED') throw badRequest('Order is cancelled');

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
    await tx.invoice.create({
      data: {
        invoiceNo: await nextNumber(tx.invoice, 'INV'),
        dispatchId: dispatch.id,
        amount: sumQty(rolls) * Number(order.pricePerUnit),
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

async function list({ orderId } = {}) {
  const rows = await prisma.dispatch.findMany({
    where: { orderId },
    orderBy: { dispatchedAt: 'desc' },
    include: dispatchInclude,
  });
  return rows.map(shape);
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

async function listInvoices({ status } = {}) {
  const rows = await prisma.invoice.findMany({
    where: { status },
    orderBy: { issuedAt: 'desc' },
    include: invoiceInclude,
  });
  return rows.map(withBalance);
}

async function addPayment(invoiceId, { amount, method }) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } });
    if (!invoice) throw notFound('Invoice not found');

    const balance = Number(invoice.amount) - sumAmount(invoice.payments);
    if (amount > balance) throw badRequest(`Payment exceeds the balance of ${balance}`);

    await tx.payment.create({ data: { invoiceId, amount, method } });
    const updated = await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: amount === balance ? 'PAID' : 'PARTIAL' },
      include: invoiceInclude,
    });
    return withBalance(updated);
  });
}

module.exports = { stock, create, list, get, listInvoices, addPayment };
