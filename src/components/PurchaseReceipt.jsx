import React from 'react';
import { eventScheduleLabel } from '../utils/catalogue';
import { itemLabel } from '../utils/inventory';

const money = (value) => `£${Number(value || 0).toFixed(2)}`;

const itemGroups = (items) => [
  { label: 'Memberships', items: items.filter((item) => item.category === 'MEMBERSHIP') },
  { label: 'Bookings', items: items.filter((item) => item.category === 'EVENTS') },
  { label: 'Additional items', items: items.filter((item) => item.category !== 'MEMBERSHIP' && item.category !== 'EVENTS') }
].filter((group) => group.items.length);

function ReceiptItems({ groups }) {
  return groups.map((group) => (
    <section className="PurchaseReceiptSection" key={group.label}>
      <h3 className="ReceiptLabel">{group.label}</h3>
      <div>
        {group.items.map((item, index) => {
          const schedule = item.schedule || (item.eventSchedule ? eventScheduleLabel(item.eventSchedule) : '');
          const billing = item.billing || (item.monthly ? 'per month' : '');
          return (
            <div className="ReceiptLineItem" key={item.lineId || `${item.name}-${index}`}>
              <div className="ReceiptItemDetails">
                <p className="ReceiptItemName">{itemLabel(item)}</p>
                <p className="ReceiptItemPerson">{item.personNames?.length ? `For: ${item.personNames.join(', ')}` : 'No person assigned'}</p>
                {billing && <p className="ReceiptItemMeta">{billing}</p>}
                {schedule && <p className="ReceiptItemSchedule">{schedule}</p>}
              </div>
              <p className="ReceiptItemPrice">{money(item.price)}</p>
            </div>
          );
        })}
      </div>
    </section>
  ));
}

export default function PurchaseReceipt({ receipt, order }) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const groupedPeople = Array.isArray(receipt?.people) && receipt.people.length > 0;
  const orderDate = order?.createdAt ? new Date(order.createdAt) : null;
  const validOrderDate = orderDate && Number.isFinite(orderDate.getTime());
  const orderRef = receipt?.orderRef || order?.orderRef || '';
  const total = receipt?.total ?? order?.total ?? 0;

  return (
    <section className="ReceiptCard PurchaseReceipt" aria-label="Purchase receipt">
      <div className="ReceiptDivider">
        <div>
          <p className="ReceiptLabel">Order reference</p>
          <p className="ReceiptValue">{orderRef}</p>
        </div>
        {validOrderDate && <div>
          <p className="ReceiptLabel">Date</p>
          <p className="ReceiptValue">{orderDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>}
      </div>

      {groupedPeople
        ? receipt.people.map((person, index) => {
          const groups = [
            { label: 'Membership', items: person.memberships || [] },
            { label: 'Bookings', items: person.events || [] },
            { label: 'Additional items', items: person.addOns || [] }
          ].filter((group) => group.items.length);
          return groups.length ? (
            <section className="PurchaseReceiptPerson" key={`${person.name}-${index}`}>
              <h3 className="PurchaseReceiptPersonName">{person.name}</h3>
              <ReceiptItems groups={groups} />
            </section>
          ) : null;
        })
        : <ReceiptItems groups={itemGroups(items)} />}

      {receipt?.otherItems?.length > 0 && (
        <ReceiptItems groups={[{ label: 'Other items', items: receipt.otherItems }]} />
      )}

      {receipt?.vouchers?.length > 0 && <section className="PurchaseReceiptSection">
        <h3 className="ReceiptLabel">Vouchers</h3>
        {receipt.vouchers.map((voucher) => (
          <div className="ReceiptVoucherCard SpaceB3" key={voucher.code}>
            <p className="ReceiptVoucherLabel">{voucher.name}</p>
            <p className="ReceiptVoucherCode">{voucher.code}</p>
            <p className="ReceiptItemMeta">{money(voucher.value)} value</p>
            {voucher.expiresAt && <p className="ReceiptItemSchedule">Valid until {new Date(voucher.expiresAt).toLocaleDateString('en-GB')}</p>}
          </div>
        ))}
      </section>}

      <div className="ReceiptTotals">
        <div className="ReceiptTotalRow">
          <span className="ReceiptTotalLabel">Total paid</span>
          <span className="ReceiptTotalValue">{money(total)}</span>
        </div>
      </div>
    </section>
  );
}
