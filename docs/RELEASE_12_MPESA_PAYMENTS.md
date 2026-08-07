# Release 12 — M-Pesa and account approval

Manual Send Money remains the active MVP payment path. Existing transaction-code submission, duplicate-reference protection, and superadmin approval behavior are unchanged.

This release adds the payment foundation for Daraja: provider-aware transaction storage, payment status history tables, receipt storage, sponsorship records, access-type and expiry fields, payment configuration, user payment history, and a superadmin reconciliation endpoint. Daraja STK Push is intentionally disabled until all required credentials and the callback URL are configured; the API returns DARAJA_NOT_CONFIGURED and directs users to the working manual flow.

Required Daraja settings when ready:

- DARAJA_ENV=sandbox or production`n+- DARAJA_CONSUMER_KEY`n+- DARAJA_CONSUMER_SECRET`n+- DARAJA_SHORTCODE`n+- DARAJA_PASSKEY`n+- DARAJA_CALLBACK_URL`n+
Manual payment remains available at /api/account/payment-submissions. New payment endpoints include /api/payments/config, /api/payments/history, /api/payments/stk-push, /api/payments/gifts, and /api/payments/superadmin/reconciliation.
