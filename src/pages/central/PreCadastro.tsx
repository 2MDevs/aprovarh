import { CheckCircle2, Download, FileSpreadsheet, FileText, Send, Upload, UserPlus, XCircle } from 'lucide-react';
import { useId, useState } from 'react';
import { Aviso, Botao, Campo, Confirmar, Modal, useAviso } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { dataHora } from '../../lib/formato';
import { useDados } from '../../lib/useDados';

const mascaraTelefone = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

/**
 * Pré-cadastro (D47): o RH cadastra quem mandou só o currículo. O candidato recebe um convite pelo WhatsApp,
 * completa o cadastro (CPF e aceite do aviso) e cai direto no portal para conversar com o RH.
 */
export function ModalPreCadastro({ onFechar, onCriado }: { onFechar: () => void; onCriado: () => void }) {
  const avisar = useAviso();
  const unidades = useDados<{ id: string; nome: string }[]>('/api/unidades');
  const [nome, setNome] = useState('');
  const [sobrenome, setSobrenome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [unidadeId, setUnidadeId] = useState('');
  const [curriculo, setCurriculo] = useState<File | null>(null);
  const [enviarConvite, setEnviarConvite] = useState(false);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const idUnidade = useId();
  const idArquivo = useId();
  const pronto = nome.trim().length >= 2 && telefone.replace(/\D/g, '').length >= 10 && unidadeId; // currículo é opcional

  const salvar = async (outro: boolean) => {
    setErro('');
    const dados = new FormData();
    dados.set('nome', nome);
    dados.set('sobrenome', sobrenome);
    dados.set('telefone', telefone);
    dados.set('unidadeId', unidadeId);
    dados.set('enviarConvite', String(enviarConvite));
    if (curriculo) dados.set('curriculo', curriculo);
    setSalvando(true);
    try {
      const r = await api.enviarArquivo<{ codigo: string; conviteAgendadoPara: string | null }>('/api/central/convites/pre-cadastro', dados);
      avisar(r.conviteAgendadoPara ? `${r.codigo} cadastrado. Convite marcado para ${dataHora(r.conviteAgendadoPara)}.` : `${r.codigo} cadastrado.`);
      onCriado();
      if (outro) { setNome(''); setSobrenome(''); setTelefone(''); setCurriculo(null); } else onFechar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal aberto onFechar={onFechar} largura="max-w-xl" titulo="Cadastrar candidato"
      descricao="Para quem mandou só o currículo. A pessoa recebe um convite pelo WhatsApp para completar o cadastro e conversar pelo portal."
      selo={<span className="grid size-11 place-items-center rounded-2xl bg-grafite text-amarelo"><UserPlus className="size-5" /></span>}
      rodape={<>
        <Botao variante="secundario" onClick={onFechar}>Fechar</Botao>
        <Botao variante="secundario" disabled={!pronto} carregando={salvando} onClick={() => void salvar(true)}>Salvar e cadastrar outro</Botao>
        <Botao disabled={!pronto} carregando={salvando} onClick={() => void salvar(false)}>Salvar</Botao>
      </>}>
      <div className="space-y-4">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} required />
          <Campo rotulo="Sobrenome (se souber)" value={sobrenome} onChange={(e) => setSobrenome(e.target.value)} maxLength={120} />
          <Campo rotulo="WhatsApp com DDD" value={telefone} onChange={(e) => setTelefone(mascaraTelefone(e.target.value))} inputMode="tel" placeholder="(11) 91234-5678" required />
          <div>
            <label htmlFor={idUnidade} className="rotulo">Unidade</label>
            <select id={idUnidade} className="campo" value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)} required>
              <option value="" disabled>Escolha a unidade</option>
              {(unidades.dados ?? []).map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </div>
        </div>
        <div>
          <span className="rotulo">Currículo <span className="font-normal text-suave">(opcional)</span></span>
          <label htmlFor={idArquivo} className="flex min-h-16 cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed border-borda bg-superficie-2 px-4 py-3 hover:border-amarelo-forte">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-creme text-grafite dark:bg-amarelo/15 dark:text-amarelo">{curriculo ? <FileText className="size-5" /> : <Upload className="size-5" />}</span>
            <span className="min-w-0 truncate font-semibold">{curriculo ? curriculo.name : 'Escolher o currículo (PDF, DOC ou DOCX)'}</span>
          </label>
          <input id={idArquivo} type="file" className="sr-only" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => setCurriculo(e.target.files?.[0] ?? null)} />
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-borda p-3">
          <input type="checkbox" checked={enviarConvite} onChange={(e) => setEnviarConvite(e.target.checked)} className="mt-0.5 size-5 accent-[#1D1D1B] dark:accent-[#F6D35C]" />
          <span className="text-sm"><strong>Já enviar o link pelo WhatsApp.</strong> Se deixar desmarcado, envie depois pelo botão "Enviar link" na lista.</span>
        </label>
      </div>
    </Modal>
  );
}

/** Botão da lista: convida de uma vez todos os pré-cadastros que ainda não receberam convite. */
export function BotaoConvites({ onFeito }: { onFeito: () => void }) {
  const avisar = useAviso();
  const resumo = useDados<{ semConvite: number; aguardando: number }>('/api/central/convites/resumo');
  const [confirmar, setConfirmar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const n = resumo.dados?.semConvite ?? 0;
  if (!n) return null;
  const enviar = async () => {
    setEnviando(true);
    try {
      const r = await api.post<{ total: number; ultimoAgendadoPara: string | null }>('/api/central/convites/pendentes');
      avisar(`${r.total} convite(s) na fila.${r.ultimoAgendadoPara ? ` O último sai em ${dataHora(r.ultimoAgendadoPara)}.` : ''}`);
      setConfirmar(false);
      await resumo.recarregar();
      onFeito();
    } catch (e) {
      avisar(e instanceof ApiError ? e.message : 'Não foi possível enviar os convites.', 'erro');
    } finally {
      setEnviando(false);
    }
  };
  return (
    <>
      <Botao variante="secundario" icone={<Send className="size-4" />} onClick={() => setConfirmar(true)}>Enviar convites ({n})</Botao>
      <Confirmar aberto={confirmar} titulo={`Enviar convite para ${n} pré-cadastro(s)?`} rotulo="Colocar na fila" carregando={enviando}
        texto="Os convites saem pelo WhatsApp em fila espaçada (intervalo, limite por dia e horário em Integração › WhatsApp). Com muitos convites, o envio leva alguns dias. Isso diminui o risco de bloqueio do número."
        onConfirmar={() => void enviar()} onCancelar={() => setConfirmar(false)} />
    </>
  );
}

interface ResultadoLinha { linha: number; nome: string; telefone: string; unidade: string | null; situacao: 'ok' | 'erro'; mensagem: string; codigo?: string }
interface RespostaImportar { previa: boolean; colunas: string[]; total: number; ok: number; erros: number; resultados: ResultadoLinha[] }

/** Importar pré-cadastros de uma planilha (Excel ou CSV). Não envia nenhum convite: o RH envia um por um. */
export function ModalImportar({ onFechar, onImportado }: { onFechar: () => void; onImportado: () => void }) {
  const unidades = useDados<{ id: string; nome: string }[]>('/api/unidades');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [unidadeId, setUnidadeId] = useState('');
  const [resp, setResp] = useState<RespostaImportar | null>(null);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const idUnidade = useId();
  const idArquivo = useId();

  const enviar = async (previa: boolean) => {
    if (!arquivo) return;
    setErro('');
    const dados = new FormData();
    dados.set('unidadeId', unidadeId);
    dados.set('previa', String(previa));
    dados.set('arquivo', arquivo);
    setEnviando(true);
    try {
      const r = await api.enviarArquivo<RespostaImportar>('/api/central/convites/importar', dados);
      setResp(r);
      if (!previa) onImportado();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível ler a planilha.');
    } finally {
      setEnviando(false);
    }
  };

  const modelo = () => {
    const csv = '\uFEFFNome;Sobrenome;Telefone;Unidade\r\nMaria;Silva;(21) 91234-5678;\r\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'modelo-candidatos.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const importado = resp && !resp.previa;
  return (
    <Modal aberto onFechar={onFechar} largura="max-w-3xl" titulo="Importar planilha"
      descricao="Cadastra de uma vez quem está na planilha. Ninguém recebe mensagem agora: o link é enviado depois, um por um, pelo botão Enviar link."
      selo={<span className="grid size-11 place-items-center rounded-2xl bg-grafite text-amarelo"><FileSpreadsheet className="size-5" /></span>}
      rodape={<>
        <Botao variante="secundario" onClick={onFechar}>{importado ? 'Fechar' : 'Cancelar'}</Botao>
        {!importado && (resp?.previa && resp.ok > 0
          ? <Botao carregando={enviando} onClick={() => void enviar(false)}>Importar {resp.ok} candidato(s)</Botao>
          : <Botao carregando={enviando} disabled={!arquivo} onClick={() => void enviar(true)}>Conferir planilha</Botao>)}
      </>}>
      <div className="space-y-4">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {!importado && (
          <>
            <div className="rounded-2xl bg-superficie-2 p-4 text-sm">
              <p>A primeira linha precisa ter os títulos. O sistema reconhece:</p>
              <ul className="mt-1 list-disc pl-5">
                <li><strong>Nome</strong> e <strong>Sobrenome</strong>, ou só <strong>Nome completo</strong>;</li>
                <li><strong>Telefone</strong> (ou Celular / WhatsApp), com DDD;</li>
                <li><strong>Unidade</strong> (opcional; se não tiver, vale a unidade escolhida abaixo).</li>
              </ul>
              <button type="button" onClick={modelo} className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold underline"><Download className="size-4" /> Baixar planilha modelo</button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <span className="rotulo">Planilha (Excel .xlsx ou .csv)</span>
                <label htmlFor={idArquivo} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed border-borda bg-superficie-2 px-4 py-2 hover:border-amarelo-forte">
                  <FileSpreadsheet className="size-5 shrink-0" />
                  <span className="min-w-0 truncate font-semibold">{arquivo ? arquivo.name : 'Escolher arquivo'}</span>
                </label>
                <input id={idArquivo} type="file" className="sr-only" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  onChange={(e) => { setArquivo(e.target.files?.[0] ?? null); setResp(null); }} />
              </div>
              <div>
                <label htmlFor={idUnidade} className="rotulo">Unidade</label>
                <select id={idUnidade} className="campo" value={unidadeId} onChange={(e) => { setUnidadeId(e.target.value); setResp(null); }}>
                  <option value="">Escolha (ou use a coluna Unidade)</option>
                  {(unidades.dados ?? []).map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                </select>
              </div>
            </div>
          </>
        )}
        {resp && (
          <div>
            <p className="mb-2 text-sm">
              {resp.previa ? 'Conferência: ' : 'Resultado: '}
              <strong className="text-verde">{resp.ok} {resp.previa ? 'pronto(s) para importar' : 'importado(s)'}</strong>
              {resp.erros > 0 && <> · <strong className="text-vermelho">{resp.erros} com problema</strong> (não {resp.previa ? 'serão importados' : 'foram importados'})</>}
            </p>
            <div className="max-h-80 overflow-auto rounded-2xl border border-borda">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-grafite text-xs uppercase text-creme">
                  <tr><th className="px-3 py-2">Linha</th><th className="px-3 py-2">Nome</th><th className="px-3 py-2">Telefone</th><th className="px-3 py-2">Unidade</th><th className="px-3 py-2">Situação</th></tr>
                </thead>
                <tbody className="divide-y divide-borda">
                  {resp.resultados.map((r) => (
                    <tr key={r.linha}>
                      <td className="px-3 py-2 text-suave">{r.linha}</td>
                      <td className="px-3 py-2">{r.nome || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.telefone || '—'}</td>
                      <td className="px-3 py-2">{r.unidade ?? '—'}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1 ${r.situacao === 'ok' ? 'text-verde' : 'text-vermelho'}`}>
                          {r.situacao === 'ok' ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}{r.codigo ? `${r.codigo} · ` : ''}{r.mensagem}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Botão da linha da lista: o robô envia o link do convite para este candidato. */
export function BotaoEnviarLink({ candidatoId, agendado, onEnviado }: { candidatoId: string; agendado: string | null; onEnviado: () => void }) {
  const avisar = useAviso();
  const [enviando, setEnviando] = useState(false);
  const enviar = async () => {
    setEnviando(true);
    try {
      const r = await api.post<{ agendadoPara: string }>(`/api/central/convites/candidato/${candidatoId}`);
      const agora = new Date(r.agendadoPara).getTime() - Date.now() < 60_000;
      avisar(agora ? 'Link enviado pelo WhatsApp.' : `Link na fila: sai em ${dataHora(r.agendadoPara)} (intervalo entre envios para proteger o número).`);
      onEnviado();
    } catch (e) {
      avisar(e instanceof ApiError ? e.message : 'Não foi possível enviar o link.', 'erro');
    } finally {
      setEnviando(false);
    }
  };
  return (
    <Botao variante={agendado ? 'secundario' : 'principal'} className="!min-h-9 !px-3 !text-xs" carregando={enviando} icone={<Send className="size-3.5" />}
      onClick={(e) => { e.stopPropagation(); void enviar(); }}>
      {agendado ? 'Reenviar link' : 'Enviar link'}
    </Botao>
  );
}
