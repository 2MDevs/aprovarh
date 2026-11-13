import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Aviso, Botao, Campo, Carregando, Confirmar, ErroCarregar, Interruptor, Modal, Selo, useAviso, Vazio } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { data } from '../../lib/formato';
import { useDados } from '../../lib/useDados';

export interface Unidade { id: string; nome: string; codigo: string | null; ativa: boolean; criadoEm: string }

export function Unidades() {
  const { dados, erro, carregando, recarregar } = useDados<Unidade[]>('/api/unidades');
  const [editando, setEditando] = useState<Unidade | 'nova' | null>(null);
  const [excluir, setExcluir] = useState<Unidade | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const avisar = useAviso();

  if (carregando && !dados) return <Carregando />;
  if (erro) return <ErroCarregar mensagem={erro.message} onTentar={recarregar} />;

  const confirmarExclusao = async () => {
    if (!excluir) return;
    setOcupado(true);
    try {
      await api.del(`/api/unidades/${excluir.id}`);
      avisar('Unidade excluída.');
      setExcluir(null);
      await recarregar();
    } catch (e) {
      avisar(e instanceof ApiError ? e.message : 'Não foi possível excluir.', 'erro');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Botao icone={<Plus className="size-4" />} onClick={() => setEditando('nova')}>Nova unidade</Botao>
      </div>
      {!dados?.length ? (
        <Vazio titulo="Nenhuma unidade cadastrada.">Cadastre as lojas que recebem candidatos (ex.: KM32).</Vazio>
      ) : (
        <ul className="cartao divide-y divide-borda">
          {dados.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{u.nome} {u.codigo && <span className="ml-1 text-sm font-normal text-suave">({u.codigo})</span>}</p>
                <p className="text-xs text-suave">Cadastrada em {data(u.criadoEm)}</p>
              </div>
              <Selo tom={u.ativa ? 'verde' : 'cinza'}>{u.ativa ? 'Ativa' : 'Inativa'}</Selo>
              <Botao variante="secundario" icone={<Pencil className="size-4" />} onClick={() => setEditando(u)}>Editar</Botao>
              <Botao variante="fantasma" aria-label={`Excluir ${u.nome}`} icone={<Trash2 className="size-4 text-vermelho" />} onClick={() => setExcluir(u)} />
            </li>
          ))}
        </ul>
      )}
      {editando && <FormUnidade unidade={editando === 'nova' ? null : editando} onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); void recarregar(); }} />}
      <Confirmar aberto={Boolean(excluir)} titulo="Excluir unidade?" perigo rotulo="Excluir" carregando={ocupado}
        texto={<>A unidade <strong>{excluir?.nome}</strong> sai da lista e do acesso dos usuários. Se ela só vai parar por um tempo, prefira desativar.</>}
        onConfirmar={() => void confirmarExclusao()} onCancelar={() => setExcluir(null)} />
    </div>
  );
}

function FormUnidade({ unidade, onFechar, onSalvo }: { unidade: Unidade | null; onFechar: () => void; onSalvo: () => void }) {
  const [nome, setNome] = useState(unidade?.nome ?? '');
  const [codigo, setCodigo] = useState(unidade?.codigo ?? '');
  const [ativa, setAtiva] = useState(unidade?.ativa ?? true);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const avisar = useAviso();

  const salvar = async (e?: FormEvent) => {
    e?.preventDefault();
    setErro('');
    setSalvando(true);
    try {
      const corpo = { nome, codigo: codigo || null, ativa };
      if (unidade) await api.put(`/api/unidades/${unidade.id}`, corpo);
      else await api.post('/api/unidades', corpo);
      avisar(unidade ? 'Unidade atualizada.' : 'Unidade cadastrada.');
      onSalvo();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal aberto onFechar={onFechar} titulo={unidade ? 'Editar unidade' : 'Nova unidade'}
      rodape={<><Botao variante="secundario" onClick={onFechar}>Cancelar</Botao><Botao carregando={salvando} disabled={nome.trim().length < 2} onClick={() => void salvar()}>Salvar</Botao></>}>
      <form onSubmit={salvar} className="space-y-4">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} required />
        <Campo rotulo="Código (opcional)" value={codigo} onChange={(e) => setCodigo(e.target.value)} maxLength={32} ajuda="Como a loja é chamada internamente, ex.: KM32." />
        <Interruptor ligado={ativa} onChange={setAtiva} rotulo="Unidade ativa" descricao="Unidades inativas não aparecem para novos candidatos." />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
