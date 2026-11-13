import { ChevronLeft, ChevronRight, Download, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSessao } from '../../app/sessao';
import { Aviso, Botao, Cabecalho, Carregando, ErroCarregar, Modal, SemPermissao, Selo, Vazio } from '../../components/ui';
import { api, ApiError, query } from '../../lib/api';
import { dataHora } from '../../lib/formato';
import { useDados } from '../../lib/useDados';

interface Registro {
  id: number; em: string; pessoa: string | null; perfil: string | null; setor: string | null; acao: string;
  item: { tipo: string; id: string | null; nome: string | null } | null; detalhes: Record<string, unknown>;
  resultado: 'sucesso' | 'negado' | 'bloqueado' | 'falha'; ip: string | null; dispositivo: string | null; hash: string;
}
interface Pagina { total: number; pagina: number; porPagina: number; registros: Registro[] }
interface Opcoes { acoes: string[]; setores: string[]; pessoas: { id: string; nome: string }[] }

const TOM = { sucesso: 'verde', negado: 'vermelho', bloqueado: 'vermelho', falha: 'amarelo' } as const;
const RESULTADO = { sucesso: 'Sucesso', negado: 'Negado', bloqueado: 'Bloqueado', falha: 'Falha' } as const;

/** Data do campo (dia, no fuso de Brasília) → ISO com fuso. */
const inicioDia = (d: string) => (d ? `${d}T00:00:00-03:00` : undefined);
const fimDia = (d: string) => (d ? `${d}T23:59:59.999-03:00` : undefined);

export function Auditoria() {
  const { pode } = useSessao();
  const [filtro, setFiltro] = useState({ de: '', ate: '', usuarioId: '', setor: '', acao: '', resultado: '', busca: '' });
  const [aplicado, setAplicado] = useState(filtro);
  const [pagina, setPagina] = useState(1);
  const [aberto, setAberto] = useState<Registro | null>(null);
  const [verificacao, setVerificacao] = useState<{ ok: boolean; total: number; quebradoEm?: number } | null>(null);
  const [verificando, setVerificando] = useState(false);
  const permitido = pode('auditoria.ver');

  const params = { ...aplicado, de: inicioDia(aplicado.de), ate: fimDia(aplicado.ate) };
  const opcoes = useDados<Opcoes>(permitido ? '/api/auditoria/opcoes' : null);
  const lista = useDados<Pagina>(permitido ? `/api/auditoria${query({ ...params, pagina, porPagina: 50 })}` : null);

  // A busca por texto aplica sozinha depois de uma pausa na digitação.
  useEffect(() => {
    const t = setTimeout(() => { setAplicado((a) => ({ ...a, busca: filtro.busca })); setPagina(1); }, 400);
    return () => clearTimeout(t);
  }, [filtro.busca]);

  if (!permitido) return <SemPermissao />;

  const mudar = (campo: keyof typeof filtro, valor: string) => {
    const novo = { ...filtro, [campo]: valor };
    setFiltro(novo);
    if (campo !== 'busca') {
      setAplicado(novo);
      setPagina(1);
    }
  };

  const verificar = async () => {
    setVerificando(true);
    try {
      setVerificacao(await api.get('/api/auditoria/verificar'));
    } catch (e) {
      setVerificacao(null);
      alertaErro(e);
    } finally {
      setVerificando(false);
    }
  };
  const alertaErro = (e: unknown) => setVerificacao({ ok: false, total: 0, quebradoEm: e instanceof ApiError ? -1 : undefined });

  const totalPaginas = lista.dados ? Math.max(1, Math.ceil(lista.dados.total / lista.dados.porPagina)) : 1;

  return (
    <>
      <Cabecalho titulo="Auditoria" descricao="Registro de tudo o que acontece no aprovaRH. Ninguém consegue alterar ou apagar estes registros."
        acoes={<>
          <Botao variante="secundario" icone={<ShieldCheck className="size-4" />} carregando={verificando} onClick={() => void verificar()}>Verificar integridade</Botao>
          <a href={`/api/auditoria/exportar.csv${query(params)}`} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-destaque px-5 text-sm font-semibold text-destaque-texto hover:opacity-90">
            <Download className="size-4" /> Exportar CSV
          </a>
        </>} />

      {verificacao && (
        <div className="mb-4">
          {verificacao.ok
            ? <Aviso>Corrente íntegra: {verificacao.total.toLocaleString('pt-BR')} registros conferidos, nenhum alterado.</Aviso>
            : <Aviso tipo="erro">{verificacao.quebradoEm && verificacao.quebradoEm > 0 ? `Foi encontrada uma quebra na corrente no registro nº ${verificacao.quebradoEm}. Avise a TI.` : 'Não foi possível verificar agora.'}</Aviso>}
        </div>
      )}

      <div className="cartao mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm"><span className="rotulo">De</span><input type="date" className="campo" value={filtro.de} onChange={(e) => mudar('de', e.target.value)} /></label>
        <label className="text-sm"><span className="rotulo">Até</span><input type="date" className="campo" value={filtro.ate} onChange={(e) => mudar('ate', e.target.value)} /></label>
        <label className="text-sm"><span className="rotulo">Pessoa</span>
          <select className="campo" value={filtro.usuarioId} onChange={(e) => mudar('usuarioId', e.target.value)}>
            <option value="">Todas</option>
            {opcoes.dados?.pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </label>
        <label className="text-sm"><span className="rotulo">Resultado</span>
          <select className="campo" value={filtro.resultado} onChange={(e) => mudar('resultado', e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(RESULTADO).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </label>
        <label className="text-sm"><span className="rotulo">Ação</span>
          <select className="campo" value={filtro.acao} onChange={(e) => mudar('acao', e.target.value)}>
            <option value="">Todas</option>
            {opcoes.dados?.acoes.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="text-sm"><span className="rotulo">Setor</span>
          <select className="campo" value={filtro.setor} onChange={(e) => mudar('setor', e.target.value)}>
            <option value="">Todos</option>
            {opcoes.dados?.setores.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="text-sm sm:col-span-2"><span className="rotulo">Buscar</span>
          <input className="campo" value={filtro.busca} onChange={(e) => mudar('busca', e.target.value)} placeholder="Pessoa, item, ação ou IP" />
        </label>
      </div>

      {lista.carregando && !lista.dados ? <Carregando /> : lista.erro ? <ErroCarregar mensagem={lista.erro.message} onTentar={lista.recarregar} /> : !lista.dados?.registros.length ? (
        <Vazio titulo="Nenhum registro com estes filtros." />
      ) : (
        <>
          <div className="cartao overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-grafite text-xs uppercase tracking-wide text-creme">
                <tr><th className="px-4 py-3 font-semibold">Data e hora</th><th className="px-4 py-3 font-semibold">Pessoa</th><th className="px-4 py-3 font-semibold">Ação</th><th className="px-4 py-3 font-semibold">Item</th><th className="px-4 py-3 font-semibold">Resultado</th><th className="px-4 py-3 font-semibold">IP</th></tr>
              </thead>
              <tbody className="divide-y divide-borda">
                {lista.dados.registros.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-superficie-2" onClick={() => setAberto(r)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setAberto(r)}>
                    <td className="whitespace-nowrap px-4 py-3">{dataHora(r.em)}</td>
                    <td className="px-4 py-3">{r.pessoa ?? '—'}{r.perfil && <span className="block text-xs text-suave">{r.perfil}{r.setor ? ` · ${r.setor}` : ''}</span>}</td>
                    <td className="px-4 py-3 font-medium">{r.acao}</td>
                    <td className="max-w-[220px] truncate px-4 py-3 text-suave">{r.item?.nome ?? '—'}</td>
                    <td className="px-4 py-3"><Selo tom={TOM[r.resultado]}>{RESULTADO[r.resultado]}</Selo></td>
                    <td className="px-4 py-3 text-suave">{r.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center justify-between text-sm text-suave">
            <span>{lista.dados.total.toLocaleString('pt-BR')} registro(s)</span>
            <div className="flex items-center gap-2">
              <Botao variante="secundario" aria-label="Página anterior" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} icone={<ChevronLeft className="size-4" />} />
              <span>Página {pagina} de {totalPaginas}</span>
              <Botao variante="secundario" aria-label="Próxima página" disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)} icone={<ChevronRight className="size-4" />} />
            </div>
          </div>
        </>
      )}

      {aberto && (
        <Modal aberto onFechar={() => setAberto(null)} titulo={`Registro nº ${aberto.id}`} descricao={dataHora(aberto.em)}>
          <dl className="grid gap-3 text-sm sm:grid-cols-[140px_1fr]">
            <dt className="font-semibold">Pessoa</dt><dd>{aberto.pessoa ?? '—'}</dd>
            <dt className="font-semibold">Perfil / setor</dt><dd>{[aberto.perfil, aberto.setor].filter(Boolean).join(' · ') || '—'}</dd>
            <dt className="font-semibold">Ação</dt><dd>{aberto.acao}</dd>
            <dt className="font-semibold">Item</dt><dd>{aberto.item ? `${aberto.item.tipo}: ${aberto.item.nome ?? aberto.item.id ?? ''}` : '—'}</dd>
            <dt className="font-semibold">Resultado</dt><dd><Selo tom={TOM[aberto.resultado]}>{RESULTADO[aberto.resultado]}</Selo></dd>
            <dt className="font-semibold">IP</dt><dd>{aberto.ip ?? '—'}</dd>
            <dt className="font-semibold">Dispositivo</dt><dd>{aberto.dispositivo ?? '—'}</dd>
            <dt className="font-semibold">Detalhes</dt><dd><pre className="overflow-x-auto whitespace-pre-wrap rounded-xl bg-superficie-2 p-3 text-xs">{JSON.stringify(aberto.detalhes, null, 2)}</pre></dd>
            <dt className="font-semibold">Hash</dt><dd className="break-all font-mono text-xs text-suave">{aberto.hash}</dd>
          </dl>
        </Modal>
      )}
    </>
  );
}
