// How much of a material to buy: enough for the open orders still waiting on it, plus a refill
// back to its low-stock warning level, less what is already ordered and on its way.
// Rounded up to 10 so suppliers get round numbers.
export function toOrder({ qtyInStock, reorderLevel }: { qtyInStock: number; reorderLevel: number }, neededForOrders = 0, onOrder = 0) {
  const short = neededForOrders + Number(reorderLevel) - Number(qtyInStock) - onOrder
  return short > 0 ? Math.ceil(short / 10) * 10 : 0
}
