import React from 'react';

/** The reason staff must give for a destructive action; it is stored in the audit log. */
export default function ReasonInput({ value, onChange, disabled }) {
  return <label className="FormLabel SpaceT4">Reason (required, kept in the audit log)<textarea className="FormInput" required maxLength={1000}
    value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} /></label>;
}
