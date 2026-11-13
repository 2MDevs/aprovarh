import { Ban, Laptop, ShieldCheck, ShieldOff, Smartphone, Tablet, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSessao } from '../../app/sessao';
import { Botao, Cabecalho, Carregando, Confirmar, ErroCarregar, Selo, useAviso, Vazio } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { data, dataHora, normalizar } from '../../lib/formato';
import { useDados } from '../../lib/useDados';

export interface Dispositivo {
  id: string; nome: string; sistema: string | null; navegador: string | null; tipo: string; ipPrimeiro: string | null; ipUltimo: string | null;
  situacao: 'pendente' | 'confiavel' | 'bloqueado' | 'revogado' | 'expirado'; confiavelAte: string | null;
  primeiroAcessoEm: string; ultimoAcessoEm: string; usuario: { id: string; nome: string; email: string }; atual: boolean;
}

const SITUACAO: Record<Dispositivo['situacao'], { texto: string; tom: 'verde' | 'cinza' | 'vermelho' | 'amarelo' }> = {
  confiavel: { texto: 'Confiável', tom: 'verde' },
  pendente: { texto: 'Pendente', tom: 'amarelo' },
  bloqueado: { texto: 'Bloqueado', tom: 'vermelho' },
  revogado: { texto: 'Revogado', tom: 'cinza' },
  expirado: { texto: 'Confiança vencida', tom: 'cinza' },
};

type Acao = 'aprovar' | 'bloquear' | 'revogar' | 'remover';
const TEXTOS: Record<Acao, { titulo: string; texto: string; rotulo: string; perigo?: boolean }> = {
  aprovar: { titulo: 'Aprovar dispositivo?', texto: 'O dispositivo fica confiável por 30 dias e entra sem o código por e-mail.', rotulo: 'Aprovar' },
  bloquear: { titulo: 'Bloquear dispositivo?', texto: 'As sessões abertas nele terminam na hora e ninguém entra por ele até ser liberado.', rotulo: 'Bloquear', perigo: true },
  revogar: { titulo: 'Revogar confiança?', texto: 'As sessões abertas nele terminam na hora. No próximo acesso o código por e-mail será pedido de novo.', rotulo: 'Revogar' },
  remover: { titulo: 'Remover dispositivo?', texto: 'Ele sai da lista e as sessões abertas nele terminam. Se for usado de novo, aparece como novo.', rotulo: 'Remover', perigo: true },
};

export function ListaDispositivos({ mostrarPessoa }: { mostrarPessoa: boolean }) {
  const { pode } = useSessao();
  const { dados, erro, carregando, recarregar } = useDados<Dispositivo[]>('/api/dispositivos');
  const [busca, setBusca] = useState('');
  const [acao, setAcao] = useState<{ tipo: Acao; d: Dispositivo } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const avisar = useAviso();
  const gerencia = pode('dispositivos.gerenciar');

  const lista = useMemo(() => {
    const b = normalizar(busca);
    return (dados ?? []).filter((d) => !b || normalizar(`${d.nome} ${d.usuario.nome} ${d.ipUltimo ?? ''}`).includes(b));
  }, [dados, busca]);

  if (carregando && !dados) return <Carregando />;
  if (erro) return <ErroCarregar mensagem={erro.message} onTentar={recarregar} />;

  const executar = async () => {
    if (!acao) return;
    setOcupado(true);
    try {
      if (acao.tipo === 'remover') await api.del(`/api/dispositivos/${acao.d.id}`);
      else await api.post(`/api/dispositivos/${acao.d.id}/${acao.tipo}`);
      avisar('Feito.');
      setAcao(null);
      await recarregar();
    } catch (e) {
      avisar(e instanceof ApiError ? e.message : 'Não foi possível concluir.', 'erro');
    } finally {
      setOcupado(false);
    }
  };

  const Icone = (t: string) => (t === 'celular' ? Smartphone : t === 'tablet' ? Tablet : Laptop);

  return (
    <div className="space-y-4">
      {mostrarPessoa && (
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por pessoa, dispositivo ou IP" className="campo sm:max-w-sm" aria-label="Buscar dispositivo" />
      )}
      {!lista.length ? (
        <Vazio titulo="Nenhum dispositivo encontrado." />
      ) : (
        <ul className="cartao divide-y divide-borda">
          {lista.map((d) => {
            const I = Icone(d.tipo);
            const s = SITUACAO[d.situacao];
            return (
              <li key={d.id} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-superficie-2"><I className="size-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{d.nome} {d.atual && <span className="text-sm font-normal text-suave">(este dispositivo)</span>}</p>
                  {mostrarPessoa && <p className="text-sm text-suave">{d.usuario.nome} · {d.usuario.email}</p>}
                  <p className="text-xs text-suave">
                    Último acesso {dataHora(d.ultimoAcessoEm)}{d.ipUltimo ? ` · IP ${d.ipUltimo}` : ''} · primeiro acesso {data(d.primeiroAcessoEm)}
                    {d.situacao === 'confiavel' && d.confiavelAte ? ` · confiável até ${data(d.confiavelAte)}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Selo tom={s.tom}>{s.texto}</Selo>
                  {gerencia && d.situacao !== 'confiavel' && d.situacao !== 'bloqueado' && <Botao variante="secundario" icone={<ShieldCheck className="size-4" />} onClick={() => setAcao({ tipo: 'aprovar', d })}>Aprovar</Botao>}
                  {gerencia && d.situacao === 'bloqueado' && <Botao variante="secundario" icone={<ShieldCheck className="size-4" />} onClick={() => setAcao({ tipo: 'aprovar', d })}>Liberar</Botao>}
                  {d.situacao === 'confiavel' && <Botao variante="secundario" icone={<ShieldOff className="size-4" />} onClick={() => setAcao({ tipo: 'revogar', d })}>Revogar</Botao>}
                  {d.situacao !== 'bloqueado' && <Botao variante="fantasma" aria-label="Bloquear" title="Bloquear" icone={<Ban className="size-4" />} onClick={() => setAcao({ tipo: 'bloquear', d })} />}
                  <Botao variante="fantasma" aria-label="Remover" title="Remover" icone={<Trash2 className="size-4 text-vermelho" />} onClick={() => setAcao({ tipo: 'remover', d })} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {acao && (
        <Confirmar aberto titulo={TEXTOS[acao.tipo].titulo} rotulo={TEXTOS[acao.tipo].rotulo} perigo={TEXTOS[acao.tipo].perigo} carregando={ocupado}
          texto={<><strong>{acao.d.nome}</strong>{mostrarPessoa ? ` de ${acao.d.usuario.nome}` : ''}: {TEXTOS[acao.tipo].texto}{acao.d.atual && acao.tipo !== 'aprovar' ? ' Atenção: é o dispositivo que você está usando agora, e você vai sair.' : ''}</>}
          onConfirmar={() => void executar()} onCancelar={() => setAcao(null)} />
      )}
    </div>
  );
}

export function Dispositivos() {
  const { pode } = useSessao();
  const todos = pode('dispositivos.gerenciar');
  return (
    <>
      <Cabecalho titulo="Dispositivos" descricao={todos ? 'Todos os computadores e celulares que acessaram o aprovaRH.' : 'Os computadores e celulares em que você entrou.'} />
      <ListaDispositivos mostrarPessoa={todos} />
    </>
  );
}
