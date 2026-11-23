import { FileText, Send, Upload, UserPlus } from 'lucide-react';
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
  const [enviarConvite, setEnviarConvite] = useState(true);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const idUnidade = useId();
  const idArquivo = useId();
  const pronto = nome.trim().length >= 2 && telefone.replace(/\D/g, '').length >= 10 && unidadeId && curriculo;

  const salvar = async (outro: boolean) => {
    setErro('');
    const dados = new FormData();
    dados.set('nome', nome);
    dados.set('sobrenome', sobrenome);
    dados.set('telefone', telefone);
    dados.set('unidadeId', unidadeId);
    dados.set('enviarConvite', String(enviarConvite));
    dados.set('curriculo', curriculo!);
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
          <span className="rotulo">Currículo</span>
          <label htmlFor={idArquivo} className="flex min-h-16 cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed border-borda bg-superficie-2 px-4 py-3 hover:border-amarelo-forte">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-creme text-grafite dark:bg-amarelo/15 dark:text-amarelo">{curriculo ? <FileText className="size-5" /> : <Upload className="size-5" />}</span>
            <span className="min-w-0 truncate font-semibold">{curriculo ? curriculo.name : 'Escolher o currículo (PDF, DOC ou DOCX)'}</span>
          </label>
          <input id={idArquivo} type="file" className="sr-only" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => setCurriculo(e.target.files?.[0] ?? null)} />
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-borda p-3">
          <input type="checkbox" checked={enviarConvite} onChange={(e) => setEnviarConvite(e.target.checked)} className="mt-0.5 size-5 accent-[#1D1D1B] dark:accent-[#F6D35C]" />
          <span className="text-sm"><strong>Enviar o convite pelo WhatsApp.</strong> O envio entra na fila espaçada (alguns minutos entre um e outro, só no horário comercial), para não arriscar o número.</span>
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
