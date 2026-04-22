import React from 'react';
import { CheckCircle2, Receipt, ArrowLeft, CreditCard } from 'lucide-react';

export default function ReceiptPage({ cart, calculations, voucherCodes, activePromo, isAnnual, getPricedItemDetails, onClose }) {
  const orderRef = `FCC-${Date.now().toString(36).toUpperCase()}`;
  const orderDate = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  return (
    <div className="PageFadeIn">
      <div className="SectionBottom">
        <div className="ReceiptWrapper">
          {/* Header */}
          <div className="ReceiptHeader">
            <CheckCircle2 className="ReceiptCheckIcon" />
            <h2 className="PageTitle">Order<br />Complete</h2>
            <p className="PageIntroCentered">Thank you for your purchase. A copy of this receipt will be emailed to you.</p>
          </div>

          <div className="ReceiptCard">
            {/* Meta */}
            <div className="ReceiptDivider">
              <div>
                <p className="ReceiptLabel">Order Reference</p>
                <p className="ReceiptValue">{orderRef}</p>
              </div>
              <div>
                <p className="ReceiptLabel">Date</p>
                <p className="ReceiptValue">{orderDate}</p>
              </div>
            </div>

            <p className="ReceiptLabel">Payment Mode</p>
            <p className="ReceiptValue SpaceB8">
              {isAnnual ? 'Club Year / Annual' : 'Monthly'}
            </p>

            {/* Line items */}
            <div className="ReceiptItemList">
              <p className="ReceiptLabel">Items</p>
              {cart.map((item) => {
                const details = getPricedItemDetails(item);
                return (
                  <div key={item.id} className="ReceiptLineItem">
                    <div>
                      <p className="ReceiptItemName">
                        {item.name}
                      </p>
                      <p className="ReceiptItemMeta">
                        {details.label}
                      </p>
                    </div>
                    <p className="ReceiptItemPrice">
                      £{details.displayPrice.toFixed(2)}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Totals */}
            <div className="ReceiptTotals">
              <div className="ReceiptSummaryRow">
                <span className="ReceiptSummaryLabel">Subtotal</span>
                <span className="ReceiptSummaryValue">£{calculations.subtotal.toFixed(2)}</span>
              </div>
              {isAnnual && calculations.annualSaving > 0 && (
                <div className="ReceiptSummaryRow">
                  <span className="ReceiptSavingLabel">Annual Saving</span>
                  <span className="ReceiptSavingValue">-£{calculations.annualSaving.toFixed(2)}</span>
                </div>
              )}
              {activePromo && calculations.promoDiscountValue > 0 && (
                <div className="ReceiptSummaryRow">
                  <span className="ReceiptSavingLabel">
                    {activePromo.discountType === 'flat'
                      ? `${activePromo.label} (${activePromo.code})`
                      : `${activePromo.label} (${(activePromo.discountValue * 100).toFixed(0)}%)`}
                  </span>
                  <span className="ReceiptSavingValue">-£{calculations.promoDiscountValue.toFixed(2)}</span>
                </div>
              )}
              <div className="ReceiptTotalRow">
                <span className="ReceiptTotalLabel">Total Paid</span>
                <span className="ReceiptTotalValue">
                  £{calculations.total.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Voucher codes */}
            {Object.keys(voucherCodes).length > 0 && (
              <div className="ReceiptVoucherList">
                <p className="ReceiptLabel">Gift Voucher Codes</p>
                {Object.entries(voucherCodes).map(([id, code]) => {
                  const item = cart.find((i) => i.id === id);
                  return (
                    <div key={id} className="ReceiptVoucherCard">
                      <p className="ReceiptVoucherLabel">{item?.name}</p>
                      <p className="ReceiptVoucherCode">{code}</p>
                      <p className="ReceiptVoucherHint">Share this code with the recipient — valid for 1 year</p>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Note about future info collection */}
            <div className="InfoBox">
              <p><strong>Demo mode.</strong> In production, you will be asked to provide your details before payment is processed via Stripe.</p>
            </div>
          </div>

          {/* Actions */}
          <div className="ReceiptActions">
            <button
              onClick={onClose}
              className="ReceiptBackButton"
            >
              <ArrowLeft className="IconMd" />
              Back to Store
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
