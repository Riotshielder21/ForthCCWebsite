import React from 'react';
import ReceiptEmailPanel from './ReceiptEmailPanel';
import WelcomeEmailPanel from './WelcomeEmailPanel';

export default function EmailSettingsPanel({ adminUser }) {
  return <>
    <WelcomeEmailPanel adminUser={adminUser} />
    <ReceiptEmailPanel adminUser={adminUser} />
  </>;
}
