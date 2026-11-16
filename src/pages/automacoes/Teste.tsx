import { CARD, gatilhoDo, type Fluxo } from '@shared/automacoes';
import { FlaskConical, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Aviso, Botao, Campo, Interruptor, Modal, Selecao } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { ESTILO } from './estilo';
import type { Opcoes, ResultadoTeste } from './tipos';

const SITUACOES = { aguardando_confirmacao: 'Aguardando confirmação', confirmada: 'Confirmada', remarcacao_solicitada: 'Pediu outra data' } as const;
const hojeBr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

/** Testar: roda o fluxo com um candidato simulado. Nada é enviado nem gravado. */
export function ModalTeste({ automacaoId, fluxo, opcoes, onFechar, onCaminho }: {
  automacaoId: string; fluxo: Fluxo; opcoes: Opcoes; onFechar: () => void; onCaminho: (ids: string[]) => void;
}) {
  const [unidadeId, setUnidadeId] = useState(opcoes.unidades[0]?.id ?? '');
  const [statusId, setStatusId] = useState(opcoes.status[0]?.id ?? '');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [comEntrevista, setComEntrevista] = useState(true);
  const [entrevista, setEntrevista] = useState({ situacao: 'aguardando_confirmacao' as keyof typeof SITUACOES, data: hojeBr(), hora: '15:00' });
  const [acessoAtivo, setAcessoAtivo] = useState(false);
  const [janelaAberta, setJanelaAberta] = useState(true);
  const esperas = fluxo.nos.filter((n) => n.tipo === 'tempo.aguardar_resposta').length;
  const g = gatilhoDo(fluxo);
  const gatilhoComMensagem = Boolean(g && CARD[g.tipo]?.produz?.includes('resposta'));
  const [respostas, setRespostas] = useState<string[]>(gatilhoComMensagem ? ['sim'] : esperas ? ['sim'] : []);
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState('');
  const [resultado, setResultado] = useState<ResultadoTeste | null>(null);

  const rodar = async () => {
    setErro('');
    setRodando(true);
    try {
      const r = await api.post<ResultadoTeste>(`/api/automacoes/${automacaoId}/testar`, {
        fluxo, unidadeId, statusId: statusId || undefined, tagIds, respostas: respostas.map((x) => x.trim()),
        entrevista: comEntrevista ? entrevista : null, acessoAtivo, janelaAberta,
      });
      setResultado(r);
      onCaminho(r.passos.map((p) => p.noId));
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível testar.');
    } finally {
      setRodando(false);
    }
  };

  return (
    <Modal aberto onFechar={onFechar} largura="max-w-3xl" titulo="Testar automação"
      descricao="Simule um candidato e veja o caminho, passo a passo. Nenhuma mensagem é enviada e nenhum dado real é alterado."
      selo={<span className="grid size-12 place-items-center rounded-2xl bg-creme text-grafite"><FlaskConical className="size-6" /></span>}
      rodape={<>
        <Botao variante="secundario" onClick={onFechar}>Fechar</Botao>
        <Botao carregando={rodando} disabled={!unidadeId} icone={<FlaskConical className="size-4" />} onClick={() => void rodar()}>{resultado ? 'Testar de novo' : 'Rodar teste'}</Botao>
      </>}>
      <div className="grid gap-6 md:grid-cols-[1fr_1.15fr]">
        <div className="space-y-4">
          <p className="text-sm font-semibold">Candidato simulado</p>
          <Selecao rotulo="Unidade" value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
            {opcoes.unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </Selecao>
          <Selecao rotulo="Status" value={statusId} onChange={(e) => setStatusId(e.target.value)}>
            {opcoes.status.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </Selecao>
          {opcoes.tags.length > 0 && (
            <fieldset>
              <legend className="rotulo">Tags</legend>
              <div className="flex flex-wrap gap-1">
                {opcoes.tags.map((t) => (
                  <button key={t.id} type="button" aria-pressed={tagIds.includes(t.id)} onClick={() => setTagIds((v) => (v.includes(t.id) ? v.filter((x) => x !== t.id) : [...v, t.id]))}
                    className={`min-h-8 rounded-full px-3 text-xs font-semibold ${tagIds.includes(t.id) ? 'bg-grafite text-white dark:bg-amarelo dark:text-grafite' : 'border border-borda text-suave'}`}>{t.nome}</button>
                ))}
              </div>
            </fieldset>
          )}
          <Interruptor ligado={comEntrevista} onChange={setComEntrevista} rotulo="Tem entrevista marcada" />
          {comEntrevista && (
            <div className="grid grid-cols-2 gap-3 rounded-xl bg-superficie-2 p-3">
              <div className="col-span-2">
                <Selecao rotulo="Situação" value={entrevista.situacao} onChange={(e) => setEntrevista((v) => ({ ...v, situacao: e.target.value as keyof typeof SITUACOES }))}>
                  {Object.entries(SITUACOES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Selecao>
              </div>
              <Campo rotulo="Data" type="date" value={entrevista.data} onChange={(e) => setEntrevista((v) => ({ ...v, data: e.target.value }))} />
              <Campo rotulo="Hora" type="time" value={entrevista.hora} onChange={(e) => setEntrevista((v) => ({ ...v, hora: e.target.value }))} />
            </div>
          )}
          <Interruptor ligado={acessoAtivo} onChange={setAcessoAtivo} rotulo="Já tem acesso ao portal hoje" />
          {opcoes.whatsapp.provedor === 'meta' && (
            <Interruptor ligado={janelaAberta} onChange={setJanelaAberta} rotulo="Escreveu no WhatsApp nas últimas 24 h" descricao="Na Meta, o texto livre só sai com essa janela aberta." />
          )}
          <fieldset>
            <legend className="rotulo">Respostas do candidato, em ordem</legend>
            <p className="mb-2 text-[12px] text-suave">
              {gatilhoComMensagem ? 'A primeira é a mensagem que dispara o gatilho. ' : ''}
              Cada "Aguardar resposta" usa a próxima. Sem resposta, segue por "Tempo esgotado".
            </p>
            <div className="space-y-2">
              {respostas.map((r, i) => (
                <div key={i} className="flex gap-2">
                  <input className="campo" value={r} placeholder='Ex.: "sim", "não posso", "dia 20 às 14h"' aria-label={`Resposta ${i + 1}`}
                    onChange={(e) => setRespostas((v) => v.map((x, j) => (j === i ? e.target.value : x)))} />
                  <button type="button" onClick={() => setRespostas((v) => v.filter((_, j) => j !== i))} className="grid size-11 shrink-0 place-items-center rounded-full hover:bg-superficie-2" aria-label="Tirar resposta"><Trash2 className="size-4" /></button>
                </div>
              ))}
              <Botao variante="fantasma" icone={<Plus className="size-4" />} onClick={() => setRespostas((v) => [...v, ''])}>Adicionar resposta</Botao>
            </div>
          </fieldset>
        </div>

        <div>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          {!resultado && !erro && <div className="grid h-full min-h-48 place-items-center rounded-2xl border border-dashed border-borda p-6 text-center text-sm text-suave">O caminho percorrido aparece aqui.</div>}
          {resultado && (
            <div className="space-y-3">
              <p className="flex items-center gap-2 rounded-xl bg-verde/10 px-3 py-2 text-sm font-semibold text-verde dark:text-emerald-300"><ShieldCheck className="size-4" /> Teste: nada foi enviado e nada foi gravado.</p>
              <ol className="space-y-1.5">
                {resultado.passos.map((p, i) => {
                  const est = ESTILO[(p.categoria || 'acao') as keyof typeof ESTILO] ?? ESTILO.acao;
                  return (
                    <li key={i} className={`flex gap-3 rounded-xl border p-2.5 text-sm ${p.erro ? 'border-vermelho/50 bg-vermelho/5' : 'border-borda'}`}>
                      <span className={`mt-0.5 h-auto w-1.5 shrink-0 rounded-full ${est.barra}`} aria-hidden />
                      <span className="min-w-0">
                        <span className="block font-semibold">{i + 1}. {p.nome}{p.saida && !['proximo'].includes(p.saida) && <span className="ml-2 rounded-full bg-superficie-2 px-2 py-0.5 text-[11px] font-bold uppercase">{p.saida.replace('_', ' ')}</span>}</span>
                        <span className={`block text-[13px] ${p.erro ? 'text-vermelho' : 'text-suave'}`}>{p.resumo}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
              <p className="text-sm font-semibold">{resultado.fim}</p>
              <div className="rounded-xl bg-superficie-2 p-3 text-[13px]">
                <p className="font-semibold">Como o candidato terminaria</p>
                <ul className="mt-1 space-y-0.5 text-suave">
                  <li>Status: <span className="text-texto">{resultado.candidatoNoFim.status ?? '—'}</span></li>
                  <li>Tags: <span className="text-texto">{resultado.candidatoNoFim.tags.join(', ') || 'nenhuma'}</span></li>
                  <li>Entrevista: <span className="text-texto">{resultado.candidatoNoFim.entrevista ? `${SITUACOES[resultado.candidatoNoFim.entrevista.situacao as keyof typeof SITUACOES] ?? resultado.candidatoNoFim.entrevista.situacao}, ${resultado.candidatoNoFim.entrevista.data.split('-').reverse().join('/')} às ${resultado.candidatoNoFim.entrevista.hora}` : 'nenhuma'}</span></li>
                  <li>Acesso ao portal: <span className="text-texto">{resultado.candidatoNoFim.acessoAtivo ? 'liberado' : 'sem acesso'}</span></li>
                </ul>
              </div>
              <p className="text-[12px] text-suave">Os cards do caminho ficam destacados na área. Para limpar, clique em "Limpar destaque".</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
