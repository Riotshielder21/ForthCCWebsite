import React from 'react';
import { CheckCircle2 } from 'lucide-react';

export default function PaymentSuccessPage() {
  return (
    <div className="SectionBottom PageFadeIn">
      <div className="ReceiptWrapper">
        <div className="ContentPanel text-center">
          <CheckCircle2 className="ReceiptCheckIcon" />
          <h2 className="ContentTitle">Payment received</h2>
          <p className="ContentBody">Stripe has received your payment request. Once the payment is confirmed, your receipt and secure purchase link will be sent to the email address used at checkout.</p>
          <p className="ContentBody SpaceT4">Please allow a few minutes for the confirmation email to arrive.</p>
        </div>
      </div>
    </div>
  );
}