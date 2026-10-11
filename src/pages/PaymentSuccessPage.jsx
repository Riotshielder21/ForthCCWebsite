import React from 'react';
import { CheckCircle2 } from 'lucide-react';

export default function PaymentSuccessPage() {
  return (
    <div className="SectionBottom PageFadeIn">
      <div className="ReceiptWrapper">
        <div className="main_tile text-center">
          <CheckCircle2 className="ReceiptCheckIcon" />
          <h2 className="tile_heading_bold_1">Payment received</h2>
          <p className="text_container">Stripe has received your payment request. Once the payment is confirmed, your receipt and secure purchase link will be sent to the email address used at checkout.</p>
          <p className="text_container SpaceT4">Please allow a few minutes for the confirmation email to arrive.</p>
        </div>
      </div>
    </div>
  );
}