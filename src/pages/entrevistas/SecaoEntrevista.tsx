import { CalendarPlus, Check, RefreshCw, UserX, X } from 'lucide-react';
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { useSessao } from '../../app/sessao';
import { Aviso, Botao, Campo, Modal, useAviso } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { dataHora } from '../../lib/formato';
import { useDados } from '../../lib/useDados';
import { quando, SeletorHorario, SeloEntrevista } from './comum';

interface EntrevistaCandidato {
  id: string; inicioEm: string; duracaoMinutos: number; situacao: string; local: string | null; motivo: string | null; confirmadaEm: string | null;
  unidade: { id: string; nome: string }; responsavel: string | null; aberta: boolean;
  eventos: { tipo: string; em: string; autor: string | null; motivo: string | null }[];
}

const EVENTO: Record<string, string> = {
  agendada: 'Agendada', confirmada: 'Confirmada', cancelada: 'Cancelada', remarcada: 'Remarcada', resposta_sim: 'Candidato respondeu SIM',
  resposta_nao: 'Candidato pediu outra data', data_proposta: 'Candidato sugeriu data', esclarecimento_pedido: 'Pedido de esclarecimento',
  realizada: 'Realizada', nao_compareceu: 'Não compareceu',
};

type Acao = 'confirmar' | 'cancelar' | 'realizada' | 'nao-compareceu';
const TEXTO_ACAO: Record<Acao, { titulo: string; rotulo: string; texto: string; perigo?: boolean }> = {
  confirmar: { titulo: 'Confirmar entrevista?', rotulo: 'Confirmar', texto: 'Use quando o candidato confirmou por outro meio (ligação, conversa).' },
  cancelar: { titulo: 'Cancelar entrevista?', rotulo: 'Cancelar entrevista', texto: 'O horário volta a ficar livre e o candidato vê o aviso no portal.', perigo: true },
  realizada: { titulo: 'Marcar como realizada?', rotulo: 'Realizada', texto: 'Depois, mude o status do candidato (ex.: Pré-aprovado ou Reprovado).' },
  'nao-compareceu': { titulo: 'Candidato não compareceu?', rotulo: 'Não compareceu', texto: 'Fica registrado no histórico da entrevista.', perigo: true },
};

/** Seção "Entrevista" do perfil lateral: agendar, remarcar e registrar o que aconteceu. */
export function SecaoEntrevista({ candidatoId, unidadeId, versao, onMudou, Secao }: {
  candidatoId: string; unidadeId: string; versao: number; onMudou: () => void;
  Secao: ComponentType<{ titulo: string; children: ReactNode; recolhida?: boolean }>;
}) {
  const { pode } = useSessao();
  const lista = useDados<EntrevistaCandidato[]>(`/api/entrevistas/candidato/${candidatoId}`);
  const [agendar, setAgendar] = useState<'novo' | EntrevistaCandidato | null>(null);
  const [acao, setAcao] = useState<{ tipo: Acao; e: EntrevistaCandidato } | null>(null);
  const podeAgendar = pode('entrevistas.agendar');

  useEffect(() => {
    if (versao) void lista.recarregar();
  }, [versao]); // eslint-disable-line react-hooks/exhaustive-deps

  const aberta = lista.dados?.find((e) => e.aberta);
  const anteriores = (lista.dados ?? []).filter((e) => !e.aberta);
  const depois = () => { void lista.recarregar(); onMudou(); };

  return (
    <Secao titulo="Entrevista">
      {aberta ? (
        <div className="space-y-3">
          <div className="rounded-xl bg-creme/70 p-3 dark:bg-amarelo/10">
            <p className="font-semibold capitalize">{quando(aberta.inicioEm)}</p>
            <p className="text-sm text-suave">{aberta.unidade.nome} · {aberta.duracaoMinutos} min{aberta.responsavel ? ` · com ${aberta.responsavel}` : ''}</p>
            <div className="mt-2"><SeloEntrevista situacao={aberta.situacao} /></div>
          </div>
          {podeAgendar && (
            <div className="grid grid-cols-2 gap-2">
              {aberta.situacao !== 'confirmada' && <Botao variante="secundario" icone={<Check className="size-4" />} onClick={() => setAcao({ tipo: 'confirmar', e: aberta })}>Confirmar</Botao>}
              <Botao variante="secundario" icone={<RefreshCw className="size-4" />} onClick={() => setAgendar(aberta)}>Remarcar</Botao>
              <Botao variante="secundario" icone={<Check className="size-4" />} onClick={() => setAcao({ tipo: 'realizada', e: aberta })}>Realizada</Botao>
              <Botao variante="secundario" icone={<UserX className="size-4" />} onClick={() => setAcao({ tipo: 'nao-compareceu', e: aberta })}>Não veio</Botao>
              <Botao variante="fantasma" className="col-span-2" icone={<X className="size-4" />} onClick={() => setAcao({ tipo: 'cancelar', e: aberta })}>Cancelar entrevista</Botao>
            </div>
          )}
        </div>
      ) : (
        <>
          <p className="text-sm text-suave">Nenhuma entrevista em aberto.</p>
          {podeAgendar && <Botao className="mt-3 w-full" icone={<CalendarPlus className="size-4" />} onClick={() => setAgendar('novo')}>Agendar entrevista</Botao>}
        </>
      )}
      {anteriores.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-semibold">Histórico de entrevistas ({anteriores.length})</summary>
          <ul className="mt-2 space-y-3">
            {anteriores.map((e) => (
              <li key={e.id} className="border-l-2 border-borda pl-3">
                <p className="flex flex-wrap items-center gap-2"><span className="capitalize">{quando(e.inicioEm)}</span> <SeloEntrevista situacao={e.situacao} /></p>
                {e.motivo && <p className="text-xs text-suave">Motivo: {e.motivo}</p>}
                <ul className="mt-1 text-xs text-suave">{e.eventos.map((ev, i) => <li key={i}>{EVENTO[ev.tipo] ?? ev.tipo} · {dataHora(ev.em)}{ev.autor ? ` · ${ev.autor}` : ''}</li>)}</ul>
              </li>
            ))}
          </ul>
        </details>
      )}
      {aberta && aberta.eventos.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-semibold">O que aconteceu nesta entrevista</summary>
          <ul className="mt-2 space-y-1 text-xs text-suave">{aberta.eventos.map((ev, i) => <li key={i}>{EVENTO[ev.tipo] ?? ev.tipo} · {dataHora(ev.em)}{ev.autor ? ` · ${ev.autor}` : ''}{ev.motivo ? ` · ${ev.motivo}` : ''}</li>)}</ul>
        </details>
      )}

      {agendar && <ModalAgendar candidatoId={candidatoId} unidadeId={agendar === 'novo' ? unidadeId : agendar.unidade.id} remarcar={agendar === 'novo' ? null : agendar} onFechar={() => setAgendar(null)} onFeito={() => { setAgendar(null); depois(); }} />}
      {acao && <ModalAcao acao={acao.tipo} entrevista={acao.e} onFechar={() => setAcao(null)} onFeito={() => { setAcao(null); depois(); }} />}
    </Secao>
  );
}

function ModalAgendar({ candidatoId, unidadeId, remarcar, onFechar, onFeito }: { candidatoId: string; unidadeId: string; remarcar: EntrevistaCandidato | null; onFechar: () => void; onFeito: () => void }) {
  const [inicio, setInicio] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const avisar = useAviso();
  const salvar = async () => {
    if (!inicio) return;
    setErro('');
    setSalvando(true);
    try {
      if (remarcar) await api.post(`/api/entrevistas/${remarcar.id}/remarcar`, { inicioEm: inicio, motivo: motivo || undefined });
      else await api.post(`/api/entrevistas/candidato/${candidatoId}`, { inicioEm: inicio });
      avisar(remarcar ? 'Entrevista remarcada.' : 'Entrevista agendada.');
      onFeito();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };
  return (
    <Modal aberto onFechar={onFechar} titulo={remarcar ? 'Remarcar entrevista' : 'Agendar entrevista'} largura="max-w-xl"
      descricao="Só aparecem os horários da disponibilidade da unidade que ainda têm vaga."
      rodape={<><Botao variante="secundario" onClick={onFechar}>Cancelar</Botao><Botao carregando={salvando} disabled={!inicio} onClick={() => void salvar()}>{remarcar ? 'Remarcar' : 'Agendar'}</Botao></>}>
      <div className="space-y-4">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {remarcar && <p className="text-sm">Atual: <strong className="capitalize">{quando(remarcar.inicioEm)}</strong></p>}
        <SeletorHorario unidadeId={unidadeId} valor={inicio} onChange={setInicio} ignorarEntrevistaId={remarcar?.id} />
        {remarcar && <Campo rotulo="Motivo (opcional)" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={255} />}
        {!remarcar && <Aviso>O candidato vê o horário no portal. A partir da etapa 7, ele também recebe a mensagem no WhatsApp para responder SIM ou NÃO.</Aviso>}
      </div>
    </Modal>
  );
}

function ModalAcao({ acao, entrevista, onFechar, onFeito }: { acao: Acao; entrevista: EntrevistaCandidato; onFechar: () => void; onFeito: () => void }) {
  const t = TEXTO_ACAO[acao];
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const avisar = useAviso();
  const executar = async () => {
    setSalvando(true);
    try {
      await api.post(`/api/entrevistas/${entrevista.id}/${acao}`, { motivo: motivo || undefined });
      avisar('Feito.');
      onFeito();
    } catch (e) {
      avisar(e instanceof ApiError ? e.message : 'Não foi possível concluir.', 'erro');
    } finally {
      setSalvando(false);
    }
  };
  return (
    <Modal aberto onFechar={onFechar} titulo={t.titulo} largura="max-w-md"
      rodape={<><Botao variante="secundario" onClick={onFechar}>Voltar</Botao><Botao variante={t.perigo ? 'perigo' : 'principal'} carregando={salvando} onClick={() => void executar()}>{t.rotulo}</Botao></>}>
      <p className="text-sm"><strong className="capitalize">{quando(entrevista.inicioEm)}</strong> · {entrevista.unidade.nome}</p>
      <p className="mt-1 text-sm text-suave">{t.texto}</p>
      <Campo rotulo="Motivo ou observação (opcional)" className="mt-4" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={255} />
    </Modal>
  );
}
