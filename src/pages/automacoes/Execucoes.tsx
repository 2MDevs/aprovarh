import { Clock, MessagesSquare, RotateCcw, Square } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSessao } from '../../app/sessao';
import { Aviso, Botao, Carregando, Confirmar, ErroCarregar, Modal, Selo, Vazio, useAviso } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { dataHora, relativo } from '../../lib/formato';
import { useDados } from '../../lib/useDados';
import { ESTILO, SITUACAO_EXECUCAO } from './estilo';
import type { ExecucaoDetalhe, ExecucaoLista } from './tipos';

const FILTROS = [['', 'Todas'], ['em_andamento', 'Em andamento'], ['aguardando', 'Aguardando'], ['com_erro', 'Com erro'], ['concluida', 'Concluídas'], ['interrompida', 'Interrompidas']] as const;

export function Execucoes({ automacaoId, aberta, onAbrir }: { automacaoId: string; aberta: string | null; onAbrir: (id: string | null) => void }) {
  const [situacao, setSituacao] = useState('');
  const [pagina, setPagina] = useState(1);
  const lista = useDados<{ temMais: boolean; execucoes: ExecucaoLista[] }>(`/api/automacoes/${automacaoId}/execucoes?pagina=${pagina}${situacao ? `&situacao=${situacao}` : ''}`);

  return (
    <div className="mx-auto w-full max-w-5xl p-4 lg:p-6">
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTROS.map(([id, rotulo]) => (
          <button key={id} onClick={() => { setSituacao(id); setPagina(1); }}
            className={`min-h-10 rounded-full px-4 text-sm font-semibold ${situacao === id ? 'bg-grafite text-white dark:bg-amarelo dark:text-grafite' : 'border border-borda bg-superficie text-suave hover:text-texto'}`}>{rotulo}</button>
        ))}
      </div>
      {lista.carregando && !lista.dados ? <Carregando /> : lista.erro ? <ErroCarregar mensagem={lista.erro.message} onTentar={lista.recarregar} /> : !lista.dados?.execucoes.length ? (
        <Vazio titulo="Nenhuma execução.">Quando a automação estiver ativa e o gatilho acontecer, as execuções aparecem aqui.</Vazio>
      ) : (
        <div className="cartao overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-grafite text-xs uppercase tracking-wide text-creme">
              <tr><th className="px-4 py-3">Nº</th><th className="px-4 py-3">Candidato</th><th className="px-4 py-3">Situação</th><th className="px-4 py-3">Passos</th><th className="px-4 py-3">Início</th><th className="px-4 py-3">Última mudança</th><th className="px-4 py-3">Versão</th></tr>
            </thead>
            <tbody className="divide-y divide-borda">
              {lista.dados.execucoes.map((x) => {
                const s = SITUACAO_EXECUCAO[x.situacao];
                return (
                  <tr key={x.id} tabIndex={0} className="cursor-pointer hover:bg-superficie-2" onClick={() => onAbrir(x.id)} onKeyDown={(e) => e.key === 'Enter' && onAbrir(x.id)}>
                    <td className="px-4 py-3 font-mono">{x.numero}</td>
                    <td className="px-4 py-3"><span className="font-semibold">{x.candidato.nome}</span> <span className="text-xs text-suave">{x.candidato.codigo}</span></td>
                    <td className="px-4 py-3"><Selo tom={s?.tom}>{s?.rotulo ?? x.situacao}</Selo>{x.erro && x.situacao === 'com_erro' && <span className="mt-1 block max-w-[220px] truncate text-xs text-vermelho" title={x.erro}>{x.erro}</span>}</td>
                    <td className="px-4 py-3">{x.passos}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-suave">{dataHora(x.iniciadaEm)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-suave">{relativo(x.atualizadaEm)}</td>
                    <td className="px-4 py-3">v{x.versao}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {lista.dados && (pagina > 1 || lista.dados.temMais) && (
        <div className="mt-4 flex justify-end gap-2">
          <Botao variante="secundario" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>Anteriores</Botao>
          <Botao variante="secundario" disabled={!lista.dados.temMais} onClick={() => setPagina((p) => p + 1)}>Mais antigas</Botao>
        </div>
      )}
      {aberta && <DetalheExecucao id={aberta} onFechar={() => onAbrir(null)} onMudou={() => void lista.recarregar()} />}
    </div>
  );
}

export function DetalheExecucao({ id, onFechar, onMudou }: { id: string; onFechar: () => void; onMudou: () => void }) {
  const { pode } = useSessao();
  const d = useDados<ExecucaoDetalhe>(`/api/automacoes/execucoes/${id}`);
  const [confirmar, setConfirmar] = useState<'interromper' | 'reprocessar' | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const avisar = useAviso();
  const x = d.dados;
  const s = x ? SITUACAO_EXECUCAO[x.situacao] : null;

  const agir = async (acao: 'interromper' | 'reprocessar') => {
    setOcupado(true);
    try {
      await api.post(`/api/automacoes/execucoes/${id}/${acao}`);
      avisar(acao === 'interromper' ? 'Execução interrompida.' : 'Execução reprocessada: ela continua do passo que falhou.');
      setConfirmar(null);
      await d.recarregar();
      onMudou();
    } catch (e) {
      avisar(e instanceof ApiError ? e.message : 'Não foi possível.', 'erro');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Modal aberto onFechar={onFechar} largura="max-w-2xl" titulo={x ? `Execução nº ${x.numero}` : 'Execução'}
      descricao={x ? `${x.automacao.nome} · versão ${x.versao}` : undefined}
      rodape={<>
        {x && pode('automacoes.publicar') && x.situacao === 'com_erro' && <Botao variante="secundario" icone={<RotateCcw className="size-4" />} onClick={() => setConfirmar('reprocessar')}>Reprocessar</Botao>}
        {x && pode('automacoes.publicar') && ['em_andamento', 'aguardando', 'com_erro'].includes(x.situacao) && <Botao variante="perigo" icone={<Square className="size-4" />} onClick={() => setConfirmar('interromper')}>Interromper</Botao>}
        <Botao variante="secundario" onClick={onFechar}>Fechar</Botao>
      </>}>
      {d.carregando && !x ? <Carregando /> : d.erro ? <ErroCarregar mensagem={d.erro.message} onTentar={d.recarregar} /> : x && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Selo tom={s?.tom}>{s?.rotulo ?? x.situacao}</Selo>
            <span>Candidato: <strong>{x.candidato.nome}</strong> <span className="text-suave">{x.candidato.codigo}</span></span>
            <Link to={`/conversas?c=${x.candidato.id}`} className="inline-flex items-center gap-1 font-semibold underline"><MessagesSquare className="size-4" /> Abrir conversa</Link>
          </div>
          {x.erro && <Aviso tipo={x.situacao === 'com_erro' ? 'erro' : 'info'}>{x.erro}</Aviso>}
          {x.esperando.map((w, i) => (
            <p key={i} className="flex items-center gap-2 rounded-xl bg-creme px-3 py-2 text-sm text-grafite dark:bg-amarelo/10 dark:text-creme">
              <Clock className="size-4" /> {w.tipo === 'resposta' ? `Esperando a resposta do candidato até ${dataHora(w.ate)}` : `Aguardando até ${dataHora(w.ate)}`} ({w.nome})
            </p>
          ))}
          <ol className="relative space-y-3 border-l-2 border-borda pl-5">
            {x.passos.map((p, i) => {
              const est = p.categoria ? ESTILO[p.categoria as keyof typeof ESTILO] : null;
              return (
                <li key={i} className="relative">
                  <span className={`absolute -left-[27px] top-1 size-3.5 rounded-full border-2 border-superficie ${p.situacao === 'erro' ? 'bg-vermelho' : est?.barra ?? 'bg-suave'}`} aria-hidden />
                  <p className="text-sm font-semibold">{p.nome}
                    {p.saida && p.saida !== 'proximo' && <span className="ml-2 rounded-full bg-superficie-2 px-2 py-0.5 text-[11px] font-bold uppercase">{p.saida.replace('_', ' ')}</span>}
                    {p.situacao === 'erro' && <span className="ml-2 text-xs font-semibold text-vermelho">erro (tentativa {p.tentativa})</span>}
                  </p>
                  <p className={`text-[13px] ${p.situacao === 'erro' ? 'text-vermelho' : 'text-suave'}`}>{p.erro ?? p.resumo}</p>
                  <p className="text-[11px] text-suave">{dataHora(p.em)}</p>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      <Confirmar aberto={confirmar === 'interromper'} perigo titulo="Interromper a execução?" rotulo="Interromper" carregando={ocupado}
        texto="Ela para agora e não continua mais. O que já foi feito (mensagens, status) não é desfeito." onCancelar={() => setConfirmar(null)} onConfirmar={() => void agir('interromper')} />
      <Confirmar aberto={confirmar === 'reprocessar'} titulo="Reprocessar a execução?" rotulo="Reprocessar" carregando={ocupado}
        texto="Ela continua do passo que falhou. O que já foi enviado não é enviado de novo." onCancelar={() => setConfirmar(null)} onConfirmar={() => void agir('reprocessar')} />
    </Modal>
  );
}
