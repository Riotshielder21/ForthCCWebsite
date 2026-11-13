import React from 'react';
import ReceiptEmailPanel from './ReceiptEmailPanel';
import RenewalsPanel from './RenewalsPanel';
import WelcomeEmailPanel from './WelcomeEmailPanel';

export default function EmailSettingsPanel({ adminUser }) {
  return <>
    <WelcomeEmailPanel adminUser={adminUser} />
    <RenewalsPanel adminUser={adminUser} />
    <ReceiptEmailPanel adminUser={adminUser} />
  </>;
}
