import { Ban, KeyRound, Pencil, Plus, Search, Trash2, Unlock } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSessao } from '../../app/sessao';
import { Aviso, Botao, Campo, Carregando, Confirmar, ErroCarregar, Interruptor, Modal, Selecao, Selo, useAviso, Vazio } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { normalizar, relativo } from '../../lib/formato';
import { useDados } from '../../lib/useDados';
import type { Perfil } from './Perfis';
import type { Unidade } from './Unidades';

interface Usuario {
  id: string; nome: string; email: string; setor: string | null; situacao: 'ativo' | 'bloqueado'; todasUnidades: boolean;
  adminInicial: boolean; deveTrocarSenha: boolean; ultimoLoginEm: string | null; criadoEm: string;
  perfil: { id: string; nome: string; chave: string }; bloqueadoPorErros: boolean; unidades: string[];
}

type Acao = { tipo: 'bloquear' | 'desbloquear' | 'excluir' | 'redefinicao'; usuario: Usuario };

export function Usuarios() {
  const { sessao } = useSessao();
  const lista = useDados<Usuario[]>('/api/usuarios');
  const perfis = useDados<Perfil[]>('/api/perfis');
  const unidades = useDados<Unidade[]>('/api/unidades');
  const [busca, setBusca] = useState('');
  const [editando, setEditando] = useState<Usuario | 'novo' | null>(null);
  const [acao, setAcao] = useState<Acao | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const avisar = useAviso();

  const filtrados = useMemo(() => {
    const b = normalizar(busca.trim());
    return (lista.dados ?? []).filter((u) => !b || normalizar(`${u.nome} ${u.email} ${u.setor ?? ''} ${u.perfil.nome}`).includes(b));
  }, [lista.dados, busca]);

  if (lista.carregando && !lista.dados) return <Carregando />;
  if (lista.erro) return <ErroCarregar mensagem={lista.erro.message} onTentar={lista.recarregar} />;

  const nomeUnidade = (id: string) => unidades.dados?.find((x) => x.id === id)?.nome ?? '—';

  const executar = async () => {
    if (!acao) return;
    setOcupado(true);
    const { tipo, usuario } = acao;
    try {
      if (tipo === 'excluir') await api.del(`/api/usuarios/${usuario.id}`);
      else if (tipo === 'redefinicao') await api.post(`/api/usuarios/${usuario.id}/enviar-redefinicao`);
      else await api.post(`/api/usuarios/${usuario.id}/${tipo}`);
      avisar({ bloquear: 'Acesso bloqueado. As sessões foram encerradas.', desbloquear: 'Acesso liberado.', excluir: 'Usuário excluído.', redefinicao: 'Link de redefinição enviado por e-mail.' }[tipo]);
      setAcao(null);
      await lista.recarregar();
    } catch (e) {
      avisar(e instanceof ApiError ? e.message : 'Não foi possível concluir.', 'erro');
    } finally {
      setOcupado(false);
    }
  };

  const textos: Record<Acao['tipo'], { titulo: string; texto: string; rotulo: string; perigo?: boolean }> = {
    bloquear: { titulo: 'Bloquear acesso?', texto: 'A pessoa sai na hora de todos os dispositivos e não consegue entrar até ser liberada.', rotulo: 'Bloquear', perigo: true },
    desbloquear: { titulo: 'Liberar acesso?', texto: 'A pessoa volta a conseguir entrar com a senha dela.', rotulo: 'Liberar' },
    excluir: { titulo: 'Excluir usuário?', texto: 'O usuário perde o acesso. O histórico dele continua na auditoria.', rotulo: 'Excluir', perigo: true },
    redefinicao: { titulo: 'Enviar link de redefinição?', texto: 'A pessoa recebe por e-mail um link (60 minutos) para criar uma nova senha.', rotulo: 'Enviar' },
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block sm:w-80">
          <span className="sr-only">Buscar usuário</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-suave" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, e-mail ou setor" className="campo pl-10" />
        </label>
        <Botao icone={<Plus className="size-4" />} onClick={() => setEditando('novo')} disabled={!perfis.dados}>Novo usuário</Botao>
      </div>

      {!filtrados.length ? (
        <Vazio titulo={busca ? 'Ninguém encontrado.' : 'Nenhum usuário cadastrado.'} />
      ) : (
        <ul className="cartao divide-y divide-borda">
          {filtrados.map((u) => (
            <li key={u.id} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{u.nome} {u.id === sessao?.usuario?.id && <span className="text-sm font-normal text-suave">(você)</span>}</p>
                <p className="truncate text-sm text-suave">{u.email}</p>
                <p className="mt-1 text-xs text-suave">
                  {u.perfil.nome}{u.setor ? ` · ${u.setor}` : ''} · {u.todasUnidades || u.perfil.chave === 'diretoria' || u.perfil.chave === 'desenvolvedor' ? 'Todas as unidades' : u.unidades.length ? u.unidades.map(nomeUnidade).join(', ') : 'Nenhuma unidade'}
                  {' · '}último acesso {relativo(u.ultimoLoginEm)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {u.situacao === 'bloqueado' ? <Selo tom="vermelho">Bloqueado</Selo> : u.bloqueadoPorErros ? <Selo tom="amarelo">Senha errada demais</Selo> : <Selo tom="verde">Ativo</Selo>}
                {u.deveTrocarSenha && <Selo>Precisa criar a senha</Selo>}
                <Botao variante="secundario" icone={<Pencil className="size-4" />} onClick={() => setEditando(u)}>Editar</Botao>
                {sessao?.smtpConfigurado && <Botao variante="fantasma" aria-label="Enviar redefinição de senha" title="Enviar redefinição de senha" icone={<KeyRound className="size-4" />} onClick={() => setAcao({ tipo: 'redefinicao', usuario: u })} />}
                {u.id !== sessao?.usuario?.id && (
                  <>
                    {u.situacao === 'bloqueado' || u.bloqueadoPorErros
                      ? <Botao variante="fantasma" aria-label="Liberar acesso" title="Liberar acesso" icone={<Unlock className="size-4" />} onClick={() => setAcao({ tipo: 'desbloquear', usuario: u })} />
                      : <Botao variante="fantasma" aria-label="Bloquear acesso" title="Bloquear acesso" icone={<Ban className="size-4" />} onClick={() => setAcao({ tipo: 'bloquear', usuario: u })} />}
                    <Botao variante="fantasma" aria-label="Excluir usuário" title="Excluir usuário" icone={<Trash2 className="size-4 text-vermelho" />} onClick={() => setAcao({ tipo: 'excluir', usuario: u })} />
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editando && perfis.dados && (
        <FormUsuario usuario={editando === 'novo' ? null : editando} perfis={perfis.dados} unidades={unidades.dados ?? []}
          smtp={Boolean(sessao?.smtpConfigurado)} onFechar={() => setEditando(null)}
          onSalvo={(msg) => { setEditando(null); avisar(msg); void lista.recarregar(); }} />
      )}
      {acao && (
        <Confirmar aberto titulo={textos[acao.tipo].titulo} perigo={textos[acao.tipo].perigo} rotulo={textos[acao.tipo].rotulo} carregando={ocupado}
          texto={<><strong>{acao.usuario.nome}</strong>: {textos[acao.tipo].texto}</>} onConfirmar={() => void executar()} onCancelar={() => setAcao(null)} />
      )}
    </div>
  );
}

function FormUsuario({ usuario, perfis, unidades, smtp, onFechar, onSalvo }: {
  usuario: Usuario | null; perfis: Perfil[]; unidades: Unidade[]; smtp: boolean; onFechar: () => void; onSalvo: (msg: string) => void;
}) {
  const escolhiveis = perfis.filter((p) => p.chave !== 'desenvolvedor');
  const [nome, setNome] = useState(usuario?.nome ?? '');
  const [email, setEmail] = useState(usuario?.email ?? '');
  const [perfilId, setPerfilId] = useState(usuario?.perfil.chave === 'desenvolvedor' ? escolhiveis[0]?.id ?? '' : usuario?.perfil.id ?? escolhiveis.find((p) => p.chave === 'gestora_rh')?.id ?? escolhiveis[0]?.id ?? '');
  const [setor, setSetor] = useState(usuario?.setor ?? '');
  const [todas, setTodas] = useState(usuario?.todasUnidades ?? false);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set(usuario?.unidades ?? []));
  const [senhaInicial, setSenhaInicial] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const ehDev = usuario?.perfil.chave === 'desenvolvedor';

  const salvar = async () => {
    setErro('');
    setSalvando(true);
    try {
      const corpo = { nome, email, perfilId, setor: setor || null, todasUnidades: todas, unidades: [...marcadas] };
      if (usuario) {
        await api.put(`/api/usuarios/${usuario.id}`, corpo);
        onSalvo('Usuário atualizado.');
      } else {
        const r = await api.post<{ emailEnviado: boolean }>('/api/usuarios', { ...corpo, senhaInicial: smtp ? undefined : senhaInicial });
        onSalvo(smtp ? (r.emailEnviado ? 'Usuário criado. Ele recebeu um e-mail para criar a senha.' : 'Usuário criado, mas o e-mail não saiu. Use "Enviar redefinição".') : 'Usuário criado. Informe a senha inicial a ele; a troca é obrigatória no primeiro acesso.');
      }
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal aberto onFechar={onFechar} titulo={usuario ? 'Editar usuário' : 'Novo usuário'} largura="max-w-2xl"
      rodape={<><Botao variante="secundario" onClick={onFechar}>Cancelar</Botao><Botao carregando={salvando} disabled={nome.trim().length < 2 || !email || (!usuario && !smtp && !senhaInicial)} onClick={() => void salvar()}>Salvar</Botao></>}>
      <div className="space-y-4">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={160} />
          <Campo rotulo="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
        </div>
        {ehDev ? (
          <Aviso>Perfil <strong>Desenvolvedor</strong>, definido pela TI na variável DEVELOPER_EMAILS.</Aviso>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Selecao rotulo="Perfil" value={perfilId} onChange={(e) => setPerfilId(e.target.value)}>
              {escolhiveis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </Selecao>
            <Campo rotulo="Setor (opcional)" value={setor} onChange={(e) => setSetor(e.target.value)} maxLength={80} placeholder="Ex.: RH" />
          </div>
        )}
        {!usuario && (smtp
          ? <Aviso>A pessoa recebe um e-mail com um link para criar a própria senha.</Aviso>
          : <Campo rotulo="Senha inicial" type="password" value={senhaInicial} onChange={(e) => setSenhaInicial(e.target.value)} autoComplete="new-password"
              ajuda="O e-mail ainda não foi configurado. A senha precisa ter 10+ caracteres com letras e números, e a troca é obrigatória no primeiro acesso." />)}
        <fieldset className="space-y-2">
          <legend className="rotulo">Unidades que a pessoa enxerga</legend>
          <Interruptor ligado={todas} onChange={setTodas} rotulo="Todas as unidades" descricao="Diretoria e Desenvolvedor sempre veem todas." />
          {!todas && (unidades.length ? (
            <div className="grid gap-1 sm:grid-cols-2">
              {unidades.map((u) => (
                <label key={u.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 hover:bg-superficie-2">
                  <input type="checkbox" className="size-5 accent-[#1D1D1B] dark:accent-[#F6D35C]" checked={marcadas.has(u.id)}
                    onChange={() => setMarcadas((s) => { const n = new Set(s); if (n.has(u.id)) n.delete(u.id); else n.add(u.id); return n; })} />
                  <span className="text-sm">{u.nome}{u.ativa ? '' : ' (inativa)'}</span>
                </label>
              ))}
            </div>
          ) : <p className="text-sm text-suave">Nenhuma unidade cadastrada ainda.</p>)}
        </fieldset>
      </div>
    </Modal>
  );
}
