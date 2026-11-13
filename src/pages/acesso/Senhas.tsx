import { Check, Lock, LogOut, Unlock } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSessao } from '../../app/sessao';
import { Aviso, Botao, Campo } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { MolduraAcesso } from './MolduraAcesso';

/** Mesma regra do servidor: 10+ caracteres com letras e números. */
export function regraSenha(s: string): string | null {
  if (s.length < 10) return 'Pelo menos 10 caracteres.';
  if (!/[a-zA-Z]/.test(s) || !/[0-9]/.test(s)) return 'Use letras e números.';
  return null;
}

function Requisitos({ senha }: { senha: string }) {
  const itens = [
    { ok: senha.length >= 10, texto: '10 caracteres ou mais' },
    { ok: /[a-zA-Z]/.test(senha), texto: 'Letras' },
    { ok: /[0-9]/.test(senha), texto: 'Números' },
  ];
  return (
    <ul className="flex flex-wrap gap-2 text-xs">
      {itens.map((i) => (
        <li key={i.texto} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${i.ok ? 'bg-verde/12 text-verde dark:text-emerald-300' : 'bg-superficie-2 text-suave'}`}>
          <Check className="size-3" aria-hidden /> {i.texto}{i.ok ? '' : ' (falta)'}
        </li>
      ))}
    </ul>
  );
}

/** Link do e-mail (primeiro acesso ou "esqueci minha senha"). */
export function DefinirSenha() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navegar = useNavigate();
  const [senha, setSenha] = useState('');
  const [confirma, setConfirma] = useState('');
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro('');
    if (senha !== confirma) return setErro('As senhas não são iguais.');
    setEnviando(true);
    try {
      await api.post('/api/auth/redefinir-senha', { token, senha });
      setOk(true);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Não foi possível salvar.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <MolduraAcesso titulo="Criar senha" subtitulo="Escolha uma senha só sua. Ela não pode ser a mesma de outros sistemas.">
      {!token ? (
        <Aviso tipo="erro">Link incompleto. Abra o link do e-mail novamente.</Aviso>
      ) : ok ? (
        <div className="space-y-5">
          <Aviso>Senha criada. Agora é só entrar.</Aviso>
          <Botao className="w-full" onClick={() => navegar('/', { replace: true })}>Ir para o login</Botao>
        </div>
      ) : (
        <form onSubmit={enviar} className="space-y-5" noValidate>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <Campo rotulo="Nova senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" autoFocus />
          <Requisitos senha={senha} />
          <Campo rotulo="Repita a senha" type="password" value={confirma} onChange={(e) => setConfirma(e.target.value)} autoComplete="new-password" />
          <Botao type="submit" className="w-full" carregando={enviando} disabled={Boolean(regraSenha(senha)) || !confirma}>Salvar senha</Botao>
        </form>
      )}
    </MolduraAcesso>
  );
}

/** Troca obrigatória (primeiro login do administrador inicial ou de quem recebeu senha inicial). */
export function TrocarSenhaObrigatoria() {
  const { recarregar, sair } = useSessao();
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirma, setConfirma] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro('');
    if (nova !== confirma) return setErro('As senhas novas não são iguais.');
    setEnviando(true);
    try {
      await api.post('/api/auth/trocar-senha', { atual, nova });
      await recarregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Não foi possível salvar.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <MolduraAcesso titulo="Troque sua senha" subtitulo="Por segurança, defina uma senha nova antes de continuar.">
      <form onSubmit={enviar} className="space-y-5" noValidate>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Senha atual" type="password" value={atual} onChange={(e) => setAtual(e.target.value)} autoComplete="current-password" autoFocus />
        <Campo rotulo="Nova senha" type="password" value={nova} onChange={(e) => setNova(e.target.value)} autoComplete="new-password" />
        <Requisitos senha={nova} />
        <Campo rotulo="Repita a nova senha" type="password" value={confirma} onChange={(e) => setConfirma(e.target.value)} autoComplete="new-password" />
        <Botao type="submit" className="w-full" carregando={enviando} disabled={!atual || Boolean(regraSenha(nova)) || !confirma}>Salvar e continuar</Botao>
        <Botao type="button" variante="fantasma" className="w-full" icone={<LogOut className="size-4" />} onClick={() => void sair()}>Sair</Botao>
      </form>
    </MolduraAcesso>
  );
}

/** Tela bloqueada por inatividade: só PIN/senha, sair. */
export function TelaBloqueada() {
  const { sessao, recarregar, sair } = useSessao();
  const temPin = Boolean(sessao?.usuario?.temPin);
  const [usarSenha, setUsarSenha] = useState(!temPin);
  const [valor, setValor] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      await api.post('/api/auth/desbloquear', usarSenha ? { senha: valor } : { pin: valor });
      await recarregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Não foi possível desbloquear.');
      setValor('');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-grafite/95 px-5 text-creme backdrop-blur">
      <form onSubmit={enviar} className="w-full max-w-sm space-y-5 text-center" noValidate>
        <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-amarelo text-grafite"><Lock className="size-7" /></span>
        <div>
          <h1 className="text-xl font-bold">Tela bloqueada</h1>
          <p className="mt-1 text-sm text-creme/70">{sessao?.usuario?.nome}, ficou um tempo sem uso. {usarSenha ? 'Digite sua senha' : 'Digite seu PIN'} para continuar.</p>
        </div>
        {erro && <p role="alert" className="rounded-xl bg-vermelho/20 px-4 py-3 text-sm text-red-200">{erro}</p>}
        <input
          type="password"
          inputMode={usarSenha ? 'text' : 'numeric'}
          autoComplete={usarSenha ? 'current-password' : 'off'}
          value={valor}
          onChange={(e) => setValor(usarSenha ? e.target.value : e.target.value.replace(/\D/g, '').slice(0, 8))}
          aria-label={usarSenha ? 'Senha' : 'PIN'}
          autoFocus
          className="w-full rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-center text-lg tracking-widest text-creme placeholder:text-creme/40 focus:border-amarelo focus:outline-none"
          placeholder={usarSenha ? 'Senha' : 'PIN'}
        />
        <button type="submit" disabled={!valor || enviando} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-amarelo font-semibold text-grafite disabled:opacity-50">
          <Unlock className="size-4" /> Desbloquear
        </button>
        <div className="flex justify-between text-sm text-creme/70">
          {temPin ? (
            <button type="button" className="min-h-11 hover:text-creme" onClick={() => { setUsarSenha((v) => !v); setValor(''); setErro(''); }}>
              {usarSenha ? 'Usar PIN' : 'Usar senha'}
            </button>
          ) : <span />}
          <button type="button" className="inline-flex min-h-11 items-center gap-1 hover:text-creme" onClick={() => void sair()}><LogOut className="size-4" /> Sair</button>
        </div>
      </form>
    </div>
  );
}
