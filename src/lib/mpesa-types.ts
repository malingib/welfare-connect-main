export interface MpesaCallbackItem {
  Name: string;
  Value?: string | number;
}

export interface MpesaStkCallback {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResultCode: number;
  ResultDesc: string;
  CallbackMetadata?: { Item: MpesaCallbackItem[] };
}

export interface MpesaCallbackPayload {
  Body?: { stkCallback?: MpesaStkCallback };
}

export interface MpesaTransactionMetadata {
  amount?: number;
  mpesa_receipt?: string;
  transaction_date?: string;
  phone_number?: string;
  account_reference?: string;
  checkout_request_id?: string;
  merchant_request_id?: string;
  [key: string]: unknown;
}
