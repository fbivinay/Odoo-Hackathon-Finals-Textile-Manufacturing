const { Router } = require('express');
const handle = require('../middleware/handle');
const { requireAuth, requireRole } = require('../middleware/auth');
const accounts = require('../services/accountsService');
const dispatchService = require('../services/dispatchService');
const { paymentSchema } = require('../validators/dispatchValidators');
const v = require('../validators/accountsValidators');

// Finance and payroll are owner-only.
const router = Router();
router.use(requireAuth, requireRole());

router.get('/overview', handle((req) => accounts.overview(req.query)));
router.get('/invoices', handle((req) => accounts.listInvoices(req.query)));
router.get('/invoices/:id', handle((req) => accounts.getInvoice(req.params.id)));
router.post('/invoices/:id/payments', handle((req) => dispatchService.addPayment(req.params.id, paymentSchema.parse(req.body), req.user), 201));
router.get('/bills', handle((req) => accounts.listBills(req.query)));
router.get('/bills/:id', handle((req) => accounts.getBill(req.params.id)));
router.post('/bills/:id/payments', handle((req) => accounts.payBill(req.params.id, v.billPaymentSchema.parse(req.body), req.user), 201));
router.get('/expenses', handle((req) => accounts.listExpenses(req.query)));
router.post('/expenses', handle((req) => accounts.createExpense(v.expenseSchema.parse(req.body), req.user), 201));
router.get('/expenses/:id', handle((req) => accounts.getExpense(req.params.id)));
router.post('/expenses/:id/pay', handle((req) => accounts.payExpense(req.params.id, v.payExpenseSchema.parse(req.body), req.user)));
router.get('/payroll', handle((req) => accounts.payroll(req.query)));
router.get('/payslip', handle((req) => accounts.getPayslip(req.query)));
router.get('/gst', handle((req) => accounts.gstRegister(req.query)));
router.get('/tax-rules', handle(() => accounts.taxRules()));
router.get('/reports/:name', handle((req) => accounts.report(req.params.name, req.query)));

module.exports = router;
