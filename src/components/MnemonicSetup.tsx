import { useState, useMemo } from 'react';
import './MnemonicSetup.css';

interface Props {
  mnemonic: string;
  onConfirm: () => void;
  onSkip?: () => void;
}

export default function MnemonicSetup({ mnemonic, onConfirm, onSkip }: Props) {
  const [revealed, setRevealed] = useState(false);
  const [verifyMode, setVerifyMode] = useState(false);
  const [verifySlots, setVerifySlots] = useState<number[]>([]);
  const [verifyValues, setVerifyValues] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const words = useMemo(() => mnemonic.trim().split(/\s+/), [mnemonic]);

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(mnemonic);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Falha ao copiar');
    }
  };

  const downloadTxt = () => {
    const content = `NOSTR FILESYNC - FRASE DE RECUPERAÇÃO\n\n${words
      .map((w, i) => `${i + 1}. ${w}`)
      .join('\n')}\n\nGuardar em local seguro e offline.\nNÃO compartilhe com ninguém.\n`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nostr-filesync-recovery.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const startVerify = () => {
    const indices: number[] = [];
    while (indices.length < 3) {
      const idx = Math.floor(Math.random() * words.length);
      if (!indices.includes(idx)) indices.push(idx);
    }
    indices.sort((a, b) => a - b);
    setVerifySlots(indices);
    setVerifyValues({});
    setError(null);
    setVerifyMode(true);
  };

  const handleVerifySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const allOk = verifySlots.every(
      (idx) => verifyValues[idx]?.trim().toLowerCase() === words[idx]
    );
    if (!allOk) {
      setError('Algumas palavras estão incorretas. Revise e tente novamente.');
      return;
    }
    onConfirm?.();
  };

  if (verifyMode) {
    return (
      <div className="mnemonic-screen">
        <div className="mnemonic-card">
          <h2>Verificar frase</h2>
          <p className="mnemonic-subtitle">
            Confirme as palavras abaixo para garantir que você anotou corretamente.
          </p>
          <form onSubmit={handleVerifySubmit} className="verify-form">
            {verifySlots.map((idx) => (
              <div key={idx} className="verify-slot">
                <label>Palavra #{idx + 1}</label>
                <input
                  type="text"
                  value={verifyValues[idx] || ''}
                  onChange={(e) =>
                    setVerifyValues((v) => ({ ...v, [idx]: e.target.value }))
                  }
                  autoFocus={idx === verifySlots[0]}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            ))}
            {error && <div className="mnemonic-error">{error}</div>}
            <div className="verify-actions">
              <button type="submit" className="mnemonic-btn primary">
                Confirmar
              </button>
              <button
                type="button"
                className="mnemonic-btn"
                onClick={() => {
                  setVerifyMode(false);
                  setError(null);
                }}
              >
                Voltar
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="mnemonic-screen">
      <div className="mnemonic-card">
        <h2>🔑 Frase de recuperação</h2>
        <p className="mnemonic-subtitle">
          Estas 12 palavras são a única forma de recuperar sua conta se você
          esquecer a senha. Anote em papel e guarde em local seguro.
        </p>

        <div className="mnemonic-warning">
          <strong>⚠ Não compartilhe com ninguém.</strong> Quem tiver acesso a
          estas palavras controla sua conta. Não salve em fotos, e-mail ou
          cloud pública.
        </div>

        <div className={`mnemonic-grid ${revealed ? 'revealed' : 'blurred'}`}>
          {words.map((w, i) => (
            <div key={i} className="mnemonic-word">
              <span className="mnemonic-num">{i + 1}</span>
              <span className="mnemonic-text">{w}</span>
            </div>
          ))}
        </div>

        {!revealed ? (
          <button className="mnemonic-btn" onClick={() => setRevealed(true)}>
            👁 Revelar palavras
          </button>
        ) : (
          <>
            <div className="mnemonic-actions">
              <button className="mnemonic-btn" onClick={copyAll}>
                {copied ? '✓ Copiado!' : '📋 Copiar'}
              </button>
              <button className="mnemonic-btn" onClick={downloadTxt}>
                💾 Baixar .txt
              </button>
              <button className="mnemonic-btn primary" onClick={startVerify}>
                ✓ Verificar
              </button>
            </div>
            <button
              className="mnemonic-btn block secondary"
              onClick={onConfirm}
              style={{ marginTop: 8 }}
            >
              Já anotei, continuar →
            </button>
            {onSkip && (
              <button className="mnemonic-link" onClick={onSkip}>
                Pular por agora (não recomendado)
              </button>
            )}
            {error && <div className="mnemonic-error">{error}</div>}
          </>
        )}
      </div>
    </div>
  );
}
