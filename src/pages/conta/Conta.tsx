import { KeyRound, LogOut, Monitor, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useSessao } from '../../app/sessao';
import { Aviso, Botao, Cabecalho, Campo, Carregando, Confirmar, Modal, Selo, useAviso } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { dataHora, relativo } from '../../lib/formato';
import { useDados } from '../../lib/useDados';
import { regraSenha } from '../acesso/Senhas';
import { ListaDispositivos } from '../dispositivos/Dispositivos';

interface SessaoAberta { id: string; criadaEm: string; ultimoUsoEm: string; expiraEm: string; ip: string | null; dispositivo: string; atual: boolean }

/** Segurança da conta: trocar senha, PIN, sessões e dispositivos próprios. */
export function Conta() {
  const { sessao, recarregar } = useSessao();
  const u = sessao!.usuario!;
  const sessoes = useDados<SessaoAberta[]>('/api/conta/sessoes');
  const [modal, setModal] = useState<'senha' | 'pin' | null>(null);
  const [removerPin, setRemoverPin] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const avisar = useAviso();

  const encerrar = async (id?: string) => {
    try {
      if (id) await api.del(`/api/conta/sessoes/${id}`);
      else await api.post('/api/conta/sessoes/encerrar-outras');
      avisar(id ? 'Sessão encerrada.' : 'As outras sessões foram encerradas.');
      await sessoes.recarregar();
    } catch (e) {
      avisar(e instanceof ApiError ? e.message : 'Não foi possível encerrar.', 'erro');
    }
  };

  return (
    <>
      <Cabecalho titulo="Minha conta" descricao="Sua senha, o PIN de desbloqueio e onde você está conectado." />
      <div className="grid gap-4 md:grid-cols-3">
        <div className="cartao p-5 md:col-span-1">
          <p className="text-lg font-semibold">{u.nome}</p>
          <p className="text-sm text-suave">{u.email}</p>
          <p className="mt-3 text-sm"><span className="text-suave">Perfil:</span> {u.perfil}</p>
          {u.setor && <p className="text-sm"><span className="text-suave">Setor:</span> {u.setor}</p>}
        </div>
        <div className="cartao flex flex-col p-5">
          <span className="grid size-11 place-items-center rounded-xl bg-creme text-grafite dark:bg-amarelo/15 dark:text-amarelo"><KeyRound className="size-5" /></span>
          <p className="mt-3 font-semibold">Senha</p>
          <p className="flex-1 text-sm text-suave">Ao trocar, você sai dos outros dispositivos.</p>
          <Botao variante="secundario" className="mt-4" onClick={() => setModal('senha')}>Trocar senha</Botao>
        </div>
        <div className="cartao flex flex-col p-5">
          <span className="grid size-11 place-items-center rounded-xl bg-creme text-grafite dark:bg-amarelo/15 dark:text-amarelo"><ShieldCheck className="size-5" /></span>
          <p className="mt-3 flex items-center gap-2 font-semibold">PIN de desbloqueio <Selo tom={u.temPin ? 'verde' : 'cinza'}>{u.temPin ? 'Criado' : 'Sem PIN'}</Selo></p>
          <p className="flex-1 text-sm text-suave">Desbloqueia a tela depois de {sessao?.bloqueioMinutos ?? 10} minutos sem uso, sem digitar a senha.</p>
          <div className="mt-4 flex gap-2">
            <Botao variante="secundario" className="flex-1" onClick={() => setModal('pin')}>{u.temPin ? 'Alterar PIN' : 'Criar PIN'}</Botao>
            {u.temPin && <Botao variante="fantasma" onClick={() => setRemoverPin(true)}>Remover</Botao>}
          </div>
        </div>
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Sessões abertas</h2>
          {(sessoes.dados?.length ?? 0) > 1 && <Botao variante="secundario" icone={<LogOut className="size-4" />} onClick={() => void encerrar()}>Sair dos outros</Botao>}
        </div>
        {sessoes.carregando && !sessoes.dados ? <Carregando /> : (
          <ul className="cartao divide-y divide-borda">
            {sessoes.dados?.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <Monitor className="size-5 text-suave" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{s.dispositivo} {s.atual && <span className="text-sm font-normal text-suave">(esta sessão)</span>}</p>
                  <p className="text-xs text-suave">Entrou {dataHora(s.criadaEm)} · usou {relativo(s.ultimoUsoEm)}{s.ip ? ` · IP ${s.ip}` : ''}</p>
                </div>
                {!s.atual && <Botao variante="secundario" onClick={() => void encerrar(s.id)}>Encerrar</Botao>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Meus dispositivos</h2>
        <ListaDispositivos mostrarPessoa={false} />
      </section>

      {modal === 'senha' && <TrocarSenha onFechar={() => setModal(null)} onOk={() => { setModal(null); avisar('Senha trocada. Os outros dispositivos foram desconectados.'); void sessoes.recarregar(); }} />}
      {modal === 'pin' && <DefinirPin onFechar={() => setModal(null)} onOk={() => { setModal(null); avisar('PIN salvo.'); void recarregar(); }} />}
      <Confirmar aberto={removerPin} titulo="Remover PIN?" texto="Para desbloquear a tela você vai precisar digitar a senha." rotulo="Remover" carregando={ocupado}
        onCancelar={() => setRemoverPin(false)}
        onConfirmar={async () => {
          setOcupado(true);
          try {
            await api.del('/api/conta/pin');
            setRemoverPin(false);
            avisar('PIN removido.');
            await recarregar();
          } finally {
            setOcupado(false);
          }
        }} />
    </>
  );
}

function TrocarSenha({ onFechar, onOk }: { onFechar: () => void; onOk: () => void }) {
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirma, setConfirma] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const problema = nova ? regraSenha(nova) : null;

  const salvar = async () => {
    setErro('');
    if (nova !== confirma) return setErro('As senhas novas não são iguais.');
    setSalvando(true);
    try {
      await api.post('/api/auth/trocar-senha', { atual, nova });
      onOk();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível trocar.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal aberto onFechar={onFechar} titulo="Trocar senha" largura="max-w-md"
      rodape={<><Botao variante="secundario" onClick={onFechar}>Cancelar</Botao><Botao carregando={salvando} disabled={!atual || Boolean(regraSenha(nova)) || !confirma} onClick={() => void salvar()}>Salvar</Botao></>}>
      <div className="space-y-4">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Senha atual" type="password" value={atual} onChange={(e) => setAtual(e.target.value)} autoComplete="current-password" />
        <Campo rotulo="Nova senha" type="password" value={nova} onChange={(e) => setNova(e.target.value)} autoComplete="new-password" erro={problema ?? undefined} ajuda="10 caracteres ou mais, com letras e números." />
        <Campo rotulo="Repita a nova senha" type="password" value={confirma} onChange={(e) => setConfirma(e.target.value)} autoComplete="new-password" />
      </div>
    </Modal>
  );
}

function DefinirPin({ onFechar, onOk }: { onFechar: () => void; onOk: () => void }) {
  const [senha, setSenha] = useState('');
  const [pin, setPin] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    setErro('');
    setSalvando(true);
    try {
      await api.put('/api/conta/pin', { senha, pin });
      onOk();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal aberto onFechar={onFechar} titulo="PIN de desbloqueio" descricao="De 4 a 8 números. Use só para desbloquear a tela." largura="max-w-md"
      rodape={<><Botao variante="secundario" onClick={onFechar}>Cancelar</Botao><Botao carregando={salvando} disabled={!senha || !/^\d{4,8}$/.test(pin)} onClick={() => void salvar()}>Salvar</Botao></>}>
      <div className="space-y-4">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Novo PIN" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} autoComplete="off" />
        <Campo rotulo="Confirme com sua senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" />
      </div>
    </Modal>
  );
}
