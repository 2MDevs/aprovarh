import { KeyRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogoHummm } from '../../components/Marca';
import { Aviso, Botao } from '../../components/ui';

/** "Acesse sua candidatura": só o código. Sem cadastro, sem senha, sem recuperação. */
export function Acesso() {
  const navegar = useNavigate();
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  const formatar = (v: string) => {
    const c = v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
  };

  const entrar = async (e: FormEvent) => {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      const r = await fetch('/api/portal/entrar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo }), credentials: 'same-origin' });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        setErro(r.status === 429 ? j?.erro || 'Muitas tentativas. Aguarde e tente de novo.' : 'Código inválido ou expirado.');
        return;
      }
      navegar('/portal', { replace: true });
    } catch {
      setErro('Sem conexão. Confira sua internet e tente de novo.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-fundo">
      <header className="bg-grafite px-5 pb-6 pt-[max(1.5rem,env(safe-area-inset-top))] text-center">
        <LogoHummm fundo="escuro" className="mx-auto h-12" />
      </header>
      <div className="faixa-marca h-1.5" aria-hidden />
      <main className="flex flex-1 items-start justify-center px-5 py-10 sm:items-center">
        <form onSubmit={entrar} className="cartao w-full max-w-sm space-y-5 p-6 sm:p-8" noValidate>
          <div className="text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-amarelo text-grafite"><KeyRound className="size-6" /></span>
            <h1 className="mt-4 text-2xl font-bold">Acesse sua candidatura</h1>
            <p className="mt-1 text-sm text-suave">Use o código que você recebeu pelo WhatsApp.</p>
          </div>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <div>
            <label htmlFor="codigo" className="rotulo">Código de acesso</label>
            <input id="codigo" value={codigo} onChange={(e) => setCodigo(formatar(e.target.value))} autoComplete="one-time-code" autoCapitalize="characters"
              spellCheck={false} placeholder="XXXX-XXXX" autoFocus className="campo text-center font-mono text-2xl tracking-[0.3em]" />
          </div>
          <Botao type="submit" className="w-full" carregando={enviando} disabled={codigo.replace('-', '').length !== 8}>Entrar</Botao>
          <p className="text-center text-xs text-suave">O código vale só no dia em que foi enviado, até 23h59.</p>
        </form>
      </main>
    </div>
  );
}
