import { Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PERMISSOES, type Permissao } from '@shared/permissoes';
import { useSessao } from '../../app/sessao';
import { Aviso, Botao, Campo, Carregando, Confirmar, ErroCarregar, Modal, Selo, useAviso } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { useDados } from '../../lib/useDados';

export interface Perfil { id: string; chave: string; nome: string; descricao: string | null; sistema: boolean; permissoes: Permissao[]; usuarios: number }

const GRUPOS = Object.entries(PERMISSOES).reduce<Record<string, Permissao[]>>((acc, [chave, p]) => {
  (acc[p.grupo] ??= []).push(chave as Permissao);
  return acc;
}, {});

export function Perfis() {
  const { pode, sessao } = useSessao();
  const { dados, erro, carregando, recarregar } = useDados<Perfil[]>('/api/perfis');
  const [editando, setEditando] = useState<Perfil | 'novo' | null>(null);
  const [excluir, setExcluir] = useState<Perfil | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const avisar = useAviso();
  const podeEditar = pode('perfis.gerenciar');

  if (carregando && !dados) return <Carregando />;
  if (erro) return <ErroCarregar mensagem={erro.message} onTentar={recarregar} />;

  const bloqueado = (p: Perfil) => p.chave === 'desenvolvedor' || (p.chave === 'diretoria' && !sessao?.usuario?.desenvolvedor);

  return (
    <div className="space-y-4">
      {podeEditar && (
        <div className="flex justify-end">
          <Botao icone={<Plus className="size-4" />} onClick={() => setEditando('novo')}>Novo perfil</Botao>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {dados?.map((p) => (
          <div key={p.id} className="cartao flex flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold">{p.nome}</p>
                {p.descricao && <p className="mt-0.5 text-sm text-suave">{p.descricao}</p>}
              </div>
              {p.sistema && <Selo>Do sistema</Selo>}
            </div>
            <p className="mt-3 text-sm text-suave">{p.permissoes.length} permissão(ões) · {p.usuarios} usuário(s)</p>
            {podeEditar && (
              <div className="mt-4 flex gap-2">
                {bloqueado(p) ? (
                  <span className="inline-flex items-center gap-1.5 text-sm text-suave"><Lock className="size-4" /> {p.chave === 'desenvolvedor' ? 'Sempre tem todas as permissões' : 'Só o Desenvolvedor altera'}</span>
                ) : (
                  <Botao variante="secundario" icone={<Pencil className="size-4" />} onClick={() => setEditando(p)}>Editar permissões</Botao>
                )}
                {!p.sistema && <Botao variante="fantasma" aria-label={`Excluir ${p.nome}`} icone={<Trash2 className="size-4 text-vermelho" />} onClick={() => setExcluir(p)} />}
              </div>
            )}
          </div>
        ))}
      </div>
      {editando && <FormPerfil perfil={editando === 'novo' ? null : editando} onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); void recarregar(); }} />}
      <Confirmar aberto={Boolean(excluir)} titulo="Excluir perfil?" perigo rotulo="Excluir" carregando={ocupado}
        texto={<>O perfil <strong>{excluir?.nome}</strong> será excluído. Só é possível se nenhum usuário estiver com ele.</>}
        onCancelar={() => setExcluir(null)}
        onConfirmar={async () => {
          setOcupado(true);
          try {
            await api.del(`/api/perfis/${excluir!.id}`);
            avisar('Perfil excluído.');
            setExcluir(null);
            await recarregar();
          } catch (e) {
            avisar(e instanceof ApiError ? e.message : 'Não foi possível excluir.', 'erro');
          } finally {
            setOcupado(false);
          }
        }} />
    </div>
  );
}

function FormPerfil({ perfil, onFechar, onSalvo }: { perfil: Perfil | null; onFechar: () => void; onSalvo: () => void }) {
  const [nome, setNome] = useState(perfil?.nome ?? '');
  const [descricao, setDescricao] = useState(perfil?.descricao ?? '');
  const [marcadas, setMarcadas] = useState<Set<Permissao>>(new Set(perfil?.permissoes ?? []));
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const avisar = useAviso();
  const grupos = useMemo(() => Object.entries(GRUPOS), []);

  const alternar = (p: Permissao) => setMarcadas((s) => {
    const n = new Set(s);
    if (n.has(p)) n.delete(p);
    else n.add(p);
    return n;
  });

  const salvar = async () => {
    setErro('');
    setSalvando(true);
    try {
      const corpo = { nome, descricao: descricao || null, permissoes: [...marcadas] };
      if (perfil) await api.put(`/api/perfis/${perfil.id}`, corpo);
      else await api.post('/api/perfis', corpo);
      avisar('Perfil salvo.');
      onSalvo();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal aberto onFechar={onFechar} titulo={perfil ? `Permissões: ${perfil.nome}` : 'Novo perfil'} largura="max-w-2xl"
      descricao="As permissões valem no servidor: quem não tem a permissão não consegue fazer a ação, mesmo pelo endereço direto."
      rodape={<><Botao variante="secundario" onClick={onFechar}>Cancelar</Botao><Botao carregando={salvando} disabled={nome.trim().length < 2} onClick={() => void salvar()}>Salvar</Botao></>}>
      <div className="space-y-5">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} />
          <Campo rotulo="Descrição (opcional)" value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={255} />
        </div>
        {grupos.map(([grupo, lista]) => (
          <fieldset key={grupo}>
            <legend className="mb-2 text-sm font-semibold">{grupo}</legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {lista.map((p) => (
                <label key={p} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 hover:bg-superficie-2">
                  <input type="checkbox" checked={marcadas.has(p)} onChange={() => alternar(p)} className="size-5 accent-[#1D1D1B] dark:accent-[#F6D35C]" />
                  <span className="text-sm">{PERMISSOES[p].nome}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </Modal>
  );
}
