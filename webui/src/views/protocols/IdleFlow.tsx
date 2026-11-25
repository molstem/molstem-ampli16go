import React, { useMemo, useState } from 'react';
import { sortedProtocols, useProtocolStore, type StoredProtocol } from '../../stores/protocolStore';
import { IdleView } from './IdleView';
import { ProtocolListView } from './ProtocolListView';
import { ProtocolFormView } from './ProtocolFormView';
import { StartConfirmView } from './StartConfirmView';

type Step =
  | { kind: 'idle' }
  | { kind: 'list' }
  | { kind: 'form'; editing?: StoredProtocol }
  | { kind: 'confirm'; protocol: StoredProtocol; from: 'list' | 'form' };

/**
 * The idle-state wizard: idle → list → form → confirm. Mounted only while the
 * device reports IDLE, so a run started or a dialog opened on the device itself
 * unmounts it and the next visit starts fresh.
 */
export const IdleFlow: React.FC = () => {
  const protocols = useProtocolStore((s) => s.protocols);
  const remove = useProtocolStore((s) => s.remove);
  const sorted = useMemo(() => sortedProtocols(protocols), [protocols]);
  const [step, setStep] = useState<Step>({ kind: 'idle' });

  switch (step.kind) {
    case 'idle':
      return <IdleView onStart={() => setStep(sorted.length === 0 ? { kind: 'form' } : { kind: 'list' })} />;

    case 'list':
      return (
        <ProtocolListView
          protocols={sorted}
          onSelect={(protocol) => setStep({ kind: 'confirm', protocol, from: 'list' })}
          onEdit={(protocol) => setStep({ kind: 'form', editing: protocol })}
          onDelete={remove}
          onAddNew={() => setStep({ kind: 'form' })}
          onBack={() => setStep({ kind: 'idle' })}
        />
      );

    case 'form':
      return (
        <ProtocolFormView
          key={step.editing?.id ?? 'new'}
          initial={step.editing}
          onSaveAndStart={(saved) => setStep({ kind: 'confirm', protocol: saved, from: 'form' })}
          onBack={() => setStep(sorted.length > 0 ? { kind: 'list' } : { kind: 'idle' })}
        />
      );

    case 'confirm':
      return (
        <StartConfirmView
          protocol={step.protocol}
          onBack={() => setStep(step.from === 'form' ? { kind: 'form', editing: step.protocol } : { kind: 'list' })}
        />
      );
  }
};
