import { Cpu, Database, FileText, HardDrive, KeyRound, Server } from 'lucide-react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSessao } from '../../app/sessao';
import { Abas, Botao, Cabecalho, Carregando, ErroCarregar, SemPermissao, Selo, Vazio } from '../../components/ui';
import { bytes, dataHora, duracao } from '../../lib/formato';
import { useDados } from '../../lib/useDados';
import { ApiWebhooks } from './ApiWebhooks';

type Aba = 'recursos' | 'servidor' | 'api' | 'artefatos';

export function Sistema() {
  const { pode } = useSessao();
  const [params, setParams] = useSearchParams();
  if (!pode('sistema.ver')) return <SemPermissao />;
  const abas = [
    { id: 'recursos' as const, rotulo: 'Recursos da plataforma', icone: <HardDrive className="size-4" /> },
    { id: 'servidor' as const, rotulo: 'Servidor', icone: <Server className="size-4" /> },
    ...(pode('api.gerenciar') ? [{ id: 'api' as const, rotulo: 'API & Webhooks', icone: <KeyRound className="size-4" /> }] : []),
    { id: 'artefatos' as const, rotulo: 'Artefatos da plataforma', icone: <FileText className="size-4" /> },
  ];
  const ativa = abas.find((a) => a.id === params.get('aba'))?.id ?? 'recursos';
  return (
    <>
      <Cabecalho titulo="Sistema" descricao="Como o aprovaRH está usando o servidor, que é compartilhado com outros projetos." />
      <Abas<Aba> abas={abas} ativa={ativa} onChange={(id) => setParams({ aba: id }, { replace: true })} />
      {ativa === 'recursos' && <Recursos />}
      {ativa === 'servidor' && <Servidor />}
      {ativa === 'api' && <ApiWebhooks />}
      {ativa === 'artefatos' && <Artefatos />}
    </>
  );
}

function Barra({ parte, total, rotulo }: { parte: number; total: number; rotulo: string }) {
  const pct = total > 0 ? Math.min(100, (parte / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-sm"><span>{rotulo}</span><span className="font-semibold">{pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span></div>
      <div className="h-2.5 overflow-hidden rounded-full bg-superficie-2" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={rotulo}>
        <div className="h-full rounded-full bg-amarelo-forte" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

interface Recurso {
  projeto: { memoria: number; cpuPercentual: number; disco: { arquivos: number | null; temporarios: number | null; banco: number | null; aplicacao: number | null } };
  servidor: { memoriaTotal: number; memoriaLivre: number; disco: { total: number; livre: number; usado: number } | null; nucleos: number; carga: number[] };
}

function Recursos() {
  const { dados, erro, carregando, recarregar } = useDados<Recurso>('/api/sistema/recursos');
  if (carregando && !dados) return <Carregando texto="Medindo o servidor..." />;
  if (erro || !dados) return <ErroCarregar mensagem={erro?.message ?? 'Sem dados.'} onTentar={recarregar} />;
  const d = dados.projeto.disco;
  const discoProjeto = (d.arquivos ?? 0) + (d.temporarios ?? 0) + (d.banco ?? 0) + (d.aplicacao ?? 0);
  const servDisco = dados.servidor.disco;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="cartao space-y-4 p-5">
          <p className="flex items-center gap-2 font-semibold"><Cpu className="size-5" /> Processamento</p>
          <p className="text-3xl font-bold">{dados.projeto.cpuPercentual.toLocaleString('pt-BR')}%</p>
          <p className="text-sm text-suave">do servidor ({dados.servidor.nucleos} núcleos) usado pelo aprovaRH desde a última medição. Carga do servidor: {dados.servidor.carga.map((c) => c.toFixed(2)).join(' · ')}</p>
        </div>
        <div className="cartao space-y-4 p-5">
          <p className="flex items-center gap-2 font-semibold"><Server className="size-5" /> Memória</p>
          <p className="text-3xl font-bold">{bytes(dados.projeto.memoria)}</p>
          <Barra parte={dados.projeto.memoria} total={dados.servidor.memoriaTotal} rotulo={`aprovaRH de ${bytes(dados.servidor.memoriaTotal)}`} />
          <Barra parte={dados.servidor.memoriaTotal - dados.servidor.memoriaLivre} total={dados.servidor.memoriaTotal} rotulo="Servidor inteiro em uso" />
        </div>
        <div className="cartao space-y-4 p-5">
          <p className="flex items-center gap-2 font-semibold"><HardDrive className="size-5" /> Disco</p>
          <p className="text-3xl font-bold">{bytes(discoProjeto)}</p>
          {servDisco ? <>
            <Barra parte={discoProjeto} total={servDisco.total} rotulo={`aprovaRH de ${bytes(servDisco.total)}`} />
            <Barra parte={servDisco.usado} total={servDisco.total} rotulo={`Servidor inteiro (${bytes(servDisco.livre)} livres)`} />
          </> : <p className="text-sm text-suave">Não foi possível ler o disco do servidor.</p>}
        </div>
      </div>
      <div className="cartao p-5">
        <p className="mb-3 font-semibold">Espaço do aprovaRH</p>
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          {[['Arquivos (currículos e fotos)', d.arquivos], ['Temporários', d.temporarios], ['Banco de dados', d.banco], ['Aplicação', d.aplicacao]].map(([r, v]) => (
            <div key={r as string} className="rounded-xl bg-superficie-2 p-4"><dt className="text-suave">{r}</dt><dd className="mt-1 text-lg font-semibold">{v === null ? 'Não medido' : bytes(v as number)}</dd></div>
          ))}
        </dl>
      </div>
      <Botao variante="secundario" onClick={() => void recarregar()}>Medir de novo</Botao>
    </div>
  );
}

interface InfoServidor {
  hostname: string; sistema: string; node: string; ligadoHaSegundos: number; processoHaSegundos: number; memoriaTotal: number; memoriaLivre: number;
  nucleos: number; carga: number[]; disco: { total: number; livre: number } | null; banco: { conectado: boolean; latenciaMs: number | null; versao: string | null };
}

function Servidor() {
  const { dados, erro, carregando, recarregar } = useDados<InfoServidor>('/api/sistema/servidor');
  if (carregando && !dados) return <Carregando />;
  if (erro || !dados) return <ErroCarregar mensagem={erro?.message ?? 'Sem dados.'} onTentar={recarregar} />;
  const linhas: [string, ReactNode][] = [
    ['Servidor', dados.hostname],
    ['Sistema', dados.sistema],
    ['Node.js', dados.node],
    ['Ligado há', duracao(dados.ligadoHaSegundos)],
    ['aprovaRH rodando há', duracao(dados.processoHaSegundos)],
    ['Memória', `${bytes(dados.memoriaTotal - dados.memoriaLivre)} de ${bytes(dados.memoriaTotal)} em uso`],
    ['Processador', `${dados.nucleos} núcleos · carga ${dados.carga.map((c) => c.toFixed(2)).join(' · ')}`],
    ['Disco', dados.disco ? `${bytes(dados.disco.livre)} livres de ${bytes(dados.disco.total)}` : 'Não foi possível ler'],
  ];
  return (
    <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
      <dl className="cartao divide-y divide-borda">
        {linhas.map(([r, v]) => <div key={r} className="flex flex-wrap justify-between gap-2 px-5 py-3.5 text-sm"><dt className="text-suave">{r}</dt><dd className="font-medium">{v}</dd></div>)}
      </dl>
      <div className="cartao p-5">
        <p className="flex items-center gap-2 font-semibold"><Database className="size-5" /> Banco de dados</p>
        <div className="mt-3"><Selo tom={dados.banco.conectado ? 'verde' : 'vermelho'}>{dados.banco.conectado ? 'Conectado' : 'Fora do ar'}</Selo></div>
        <p className="mt-3 text-sm text-suave">PostgreSQL {dados.banco.versao ?? '—'}</p>
        {dados.banco.latenciaMs !== null && <p className="text-sm text-suave">Resposta em {dados.banco.latenciaMs} ms</p>}
      </div>
    </div>
  );
}

interface Artefato { arquivo: string; nome: string; tipo: string; tamanho: number; atualizadoEm: string }

function Artefatos() {
  const { dados, erro, carregando, recarregar } = useDados<{ versao: string; artefatos: Artefato[] }>('/api/sistema/artefatos');
  if (carregando && !dados) return <Carregando />;
  if (erro || !dados) return <ErroCarregar mensagem={erro?.message ?? 'Sem dados.'} onTentar={recarregar} />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-suave">Documentos do projeto, da pasta <code>docs/</code> do repositório. Chegam junto com cada atualização. Versão instalada: <strong>{dados.versao}</strong>.</p>
      {!dados.artefatos.length ? <Vazio titulo="Nenhum artefato publicado ainda." /> : (
        <ul className="cartao divide-y divide-borda">
          {dados.artefatos.map((a) => (
            <li key={a.arquivo} className="flex flex-wrap items-center gap-3 px-5 py-4">
              <span className="grid size-11 place-items-center rounded-xl bg-creme text-xs font-bold text-grafite dark:bg-amarelo/15 dark:text-amarelo">{a.tipo}</span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{a.nome}</p>
                <p className="text-xs text-suave">{bytes(a.tamanho)} · atualizado em {dataHora(a.atualizadoEm)}</p>
              </div>
              <a className="inline-flex min-h-11 items-center rounded-full border border-borda px-5 text-sm font-semibold hover:bg-superficie-2" href={`/api/sistema/artefatos/${encodeURIComponent(a.arquivo)}`} target="_blank" rel="noreferrer">Visualizar</a>
              <a className="inline-flex min-h-11 items-center rounded-full bg-destaque px-5 text-sm font-semibold text-destaque-texto" href={`/api/sistema/artefatos/${encodeURIComponent(a.arquivo)}?baixar=1`}>Baixar</a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
