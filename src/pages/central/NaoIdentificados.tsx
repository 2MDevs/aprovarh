import { Archive, Copy, Eraser, UserRoundX } from 'lucide-react';
import { useState } from 'react';
import { useSessao } from '../../app/sessao';
import { Botao, Carregando, Confirmar, ErroCarregar, Modal, useAviso } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { dataHora } from '../../lib/formato';
import { useDados } from '../../lib/useDados';

interface Contato { id: string; telefone: string | null; nomePerfil: string | null; ultimaMensagem: string | null; mensagens: number; primeiraEm: string; ultimaEm: string }

/** Números que escreveram no WhatsApp e não são de nenhum candidato (não criam candidato sozinhos). */
export function NaoIdentificados({ onFechar }: { onFechar: () => void }) {
  const { pode } = useSessao();
  const { dados, erro, carregando, recarregar } = useDados<Contato[]>('/api/central/whatsapp/nao-identificados');
  const [arquivando, setArquivando] = useState<string | null>(null);
  const [limpar, setLimpar] = useState(false);
  const [limpando, setLimpando] = useState(false);
  const avisar = useAviso();
  const copiar = (t: string) => navigator.clipboard.writeText(t).then(() => avisar('Número copiado.'), () => avisar('Não foi possível copiar.', 'erro'));

  const arquivar = async (id: string) => {
    setArquivando(id);
    try {
      await api.post(`/api/central/whatsapp/nao-identificados/${id}/arquivar`);
      avisar('Contato arquivado.');
      await recarregar();
    } catch (e) {
      avisar(e instanceof ApiError ? e.message : 'Não foi possível arquivar.', 'erro');
    } finally {
      setArquivando(null);
    }
  };

  const limparTudo = async () => {
    setLimpando(true);
    try {
      const r = await api.post<{ total: number }>('/api/central/whatsapp/nao-identificados/limpar');
      avisar(`${r.total} contato(s) arquivado(s).`);
      setLimpar(false);
      await recarregar();
    } catch (e) {
      avisar(e instanceof ApiError ? e.message : 'Não foi possível limpar.', 'erro');
    } finally {
      setLimpando(false);
    }
  };

  return (
    <>
    <Confirmar aberto={limpar} titulo="Limpar a lista?" rotulo="Limpar" carregando={limpando}
      texto={`Os ${dados?.length ?? 0} contato(s) saem da lista (ficam arquivados). Se um deles escrever de novo, volta para a lista.`}
      onConfirmar={() => void limparTudo()} onCancelar={() => setLimpar(false)} />
    <Modal aberto onFechar={onFechar} largura="max-w-2xl" titulo="Contatos não identificados"
      descricao="Números que escreveram no WhatsApp do recrutamento e não são de candidatos. Se for alguém interessado na vaga, envie o link da candidatura."
      rodape={<>{pode('conversas.responder') && Boolean(dados?.length) && <Botao variante="secundario" icone={<Eraser className="size-4" />} onClick={() => setLimpar(true)}>Limpar lista</Botao>}<Botao variante="secundario" onClick={onFechar}>Fechar</Botao></>}>
      {carregando && !dados ? <Carregando /> : erro ? <ErroCarregar mensagem={erro.message} onTentar={recarregar} /> : !dados?.length ? (
        <div className="py-10 text-center text-suave">
          <UserRoundX className="mx-auto size-10" aria-hidden />
          <p className="mt-2 text-sm">Nenhum contato não identificado.</p>
        </div>
      ) : (
        <ul className="divide-y divide-borda rounded-2xl border border-borda">
          {dados.map((c) => (
            <li key={c.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="font-semibold">{c.nomePerfil || 'Sem nome no WhatsApp'} <span className="font-normal text-suave">· {c.telefone ?? 'número ilegível'}</span></p>
                {c.ultimaMensagem && <p className="mt-1 line-clamp-2 text-sm">“{c.ultimaMensagem}”</p>}
                <p className="mt-1 text-xs text-suave">{c.mensagens} mensage{c.mensagens === 1 ? 'm' : 'ns'} · primeira em {dataHora(c.primeiraEm)} · última em {dataHora(c.ultimaEm)}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                {c.telefone && <Botao variante="fantasma" icone={<Copy className="size-4" />} onClick={() => void copiar(c.telefone!)}>Copiar</Botao>}
                {pode('conversas.responder') && (
                  <Botao variante="secundario" icone={<Archive className="size-4" />} carregando={arquivando === c.id} onClick={() => void arquivar(c.id)}>Arquivar</Botao>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
    </>
  );
}
