// Human-readable running numbers such as ORD-0007. `delegate` is a Prisma model delegate.
async function nextNumber(delegate, prefix) {
  const count = await delegate.count();
  return `${prefix}-${String(count + 1).padStart(4, '0')}`;
}

module.exports = { nextNumber };
