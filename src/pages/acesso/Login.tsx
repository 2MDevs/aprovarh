import { ArrowLeft, KeyRound, LogIn, Mail } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useSessao } from '../../app/sessao';
import { Aviso, Botao, Campo } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { MolduraAcesso } from './MolduraAcesso';

type Etapa = { tipo: 'senha' } | { tipo: '2fa'; desafio: string; email: string; reenvio: number } | { tipo: 'esqueci' } | { tipo: 'esqueci-ok'; mensagem: string };

export function Login() {
  const { sessao, recarregar } = useSessao();
  const [etapa, setEtapa] = useState<Etapa>({ tipo: 'senha' });
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [espera, setEspera] = useState(0);

  // Contagem para liberar o "Reenviar código".
  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  async function executar(fn: () => Promise<void>) {
    setErro('');
    setEnviando(true);
    try {
      await fn();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Algo deu errado. Tente novamente.');
    } finally {
      setEnviando(false);
    }
  }

  const entrar = (e: FormEvent) => {
    e.preventDefault();
    void executar(async () => {
      const r = await api.post<{ etapa: 'ok' | '2fa'; desafio?: string; emailMascarado?: string; reenvioEmSegundos?: number }>('/api/auth/login', { email, senha });
      if (r.etapa === '2fa') {
        setEtapa({ tipo: '2fa', desafio: r.desafio!, email: r.emailMascarado!, reenvio: r.reenvioEmSegundos ?? 60 });
        setEspera(r.reenvioEmSegundos ?? 60);
        setSenha('');
      } else {
        await recarregar();
      }
    });
  };

  const verificar = (e: FormEvent) => {
    e.preventDefault();
    if (etapa.tipo !== '2fa') return;
    void executar(async () => {
      try {
        await api.post('/api/auth/2fa/verificar', { desafio: etapa.desafio, codigo });
        await recarregar();
      } catch (err) {
        if (err instanceof ApiError && err.codigo === 'desafio_invalido') {
          setEtapa({ tipo: 'senha' });
          setCodigo('');
        }
        throw err;
      }
    });
  };

  const reenviar = () => {
    if (etapa.tipo !== '2fa') return;
    void executar(async () => {
      const r = await api.post<{ reenvioEmSegundos: number }>('/api/auth/2fa/reenviar', { desafio: etapa.desafio });
      setEspera(r.reenvioEmSegundos);
    });
  };

  const pedirLink = (e: FormEvent) => {
    e.preventDefault();
    void executar(async () => {
      const r = await api.post<{ mensagem: string }>('/api/auth/esqueci-senha', { email });
      setEtapa({ tipo: 'esqueci-ok', mensagem: r.mensagem });
    });
  };

  if (etapa.tipo === '2fa') {
    return (
      <MolduraAcesso titulo="Confirme que é você" subtitulo={`Enviamos um código de 6 números para ${etapa.email}. Ele vale por 10 minutos.`}>
        <form onSubmit={verificar} className="space-y-5" noValidate>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <Campo rotulo="Código" value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric" autoComplete="one-time-code" placeholder="000000" autoFocus required
            className="[&_input]:text-center [&_input]:text-2xl [&_input]:tracking-[0.5em]" />
          <Botao type="submit" className="w-full" carregando={enviando} disabled={codigo.length !== 6} icone={<KeyRound className="size-4" />}>Confirmar</Botao>
          <div className="flex items-center justify-between text-sm">
            <button type="button" className="inline-flex min-h-11 items-center gap-1 text-suave hover:text-texto" onClick={() => { setEtapa({ tipo: 'senha' }); setErro(''); }}>
              <ArrowLeft className="size-4" /> Voltar
            </button>
            <button type="button" className="min-h-11 font-semibold disabled:text-suave" disabled={espera > 0 || enviando} onClick={reenviar}>
              {espera > 0 ? `Reenviar em ${espera}s` : 'Reenviar código'}
            </button>
          </div>
          <p className="text-[13px] text-suave">Depois de confirmar, este dispositivo fica confiável por 30 dias.</p>
        </form>
      </MolduraAcesso>
    );
  }

  if (etapa.tipo === 'esqueci' || etapa.tipo === 'esqueci-ok') {
    return (
      <MolduraAcesso titulo="Esqueci minha senha" subtitulo="Informe seu e-mail. Se ele estiver cadastrado, você recebe um link para criar uma nova senha.">
        {etapa.tipo === 'esqueci-ok' ? (
          <div className="space-y-5">
            <Aviso>{etapa.mensagem} O link vale por 60 minutos.</Aviso>
            <Botao variante="secundario" className="w-full" onClick={() => setEtapa({ tipo: 'senha' })}>Voltar para o login</Botao>
          </div>
        ) : (
          <form onSubmit={pedirLink} className="space-y-5" noValidate>
            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            <Campo rotulo="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus />
            <Botao type="submit" className="w-full" carregando={enviando} icone={<Mail className="size-4" />}>Enviar link</Botao>
            <Botao type="button" variante="fantasma" className="w-full" onClick={() => setEtapa({ tipo: 'senha' })}>Voltar</Botao>
          </form>
        )}
      </MolduraAcesso>
    );
  }

  return (
    <MolduraAcesso titulo="Entrar" subtitulo="Use seu e-mail e senha da empresa.">
      <form onSubmit={entrar} className="space-y-5" noValidate>
        {sessao && !sessao.smtpConfigurado && (
          <Aviso tipo="atencao">
            <strong>Configuração inicial.</strong> O e-mail do sistema ainda não foi configurado: por enquanto só a TI e o administrador inicial conseguem entrar.
          </Aviso>
        )}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus />
        <Campo rotulo="Senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" required />
        <Botao type="submit" className="w-full" carregando={enviando} disabled={!email || !senha} icone={<LogIn className="size-4" />}>Entrar</Botao>
        {sessao?.smtpConfigurado && (
          <button type="button" onClick={() => { setEtapa({ tipo: 'esqueci' }); setErro(''); }} className="block min-h-11 w-full text-center text-sm font-semibold text-suave hover:text-texto">
            Esqueci minha senha
          </button>
        )}
      </form>
    </MolduraAcesso>
  );
}
