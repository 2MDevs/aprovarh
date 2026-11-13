import { LayoutGrid, Lock, Plug, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSessao } from '../../app/sessao';
import { Abas, Aviso, Botao, Cabecalho, Campo, Carregando, ErroCarregar, SemPermissao, Selo, SeloSigla } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { normalizar } from '../../lib/formato';
import { useDados } from '../../lib/useDados';
import { CORES } from './cores';
import { ModalAdmin, ModalArquivos, ModalAtualizacao, ModalEnv, ModalPrivacidade, ModalSeguranca, ModalSmtp } from './Modais';

export interface CardIntegracao { id: string; aba: 'geral' | 'integracoes'; sigla: string; nome: string; categoria: string; descricao: string; configurado: boolean }


const SITUACAO: Record<string, [string, string]> = { atualizacao: ['Ligado', 'Desligado'], seguranca: ['Configurada', 'Padrão'], env: ['Ver', 'Ver'], privacidade: ['Publicado', 'Formulário fechado'] };

export function Integracao() {
  const { sessao } = useSessao();
  const [liberado, setLiberado] = useState(false);
  const liberar = useCallback(() => setLiberado(true), []);
  const expirou = useCallback(() => setLiberado(false), []);
  if (!sessao?.usuario?.desenvolvedor) return <SemPermissao />;
  return liberado ? <Telas onExpirou={expirou} /> : <Reautenticar onOk={liberar} />;
}

/** A tela pede a senha de novo a cada 10 minutos. */
function Reautenticar({ onOk }: { onOk: () => void }) {
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [conferindo, setConferindo] = useState(true);

  // Se a senha foi confirmada há menos de 10 minutos, entra direto.
  useEffect(() => {
    api.get('/api/integracao/cards').then(onOk, () => setConferindo(false));
  }, [onOk]);

  if (conferindo) return <Carregando />;
  return (
    <div className="mx-auto max-w-md pt-6">
      <div className="cartao p-6">
        <span className="grid size-12 place-items-center rounded-2xl bg-grafite text-amarelo"><Lock className="size-5" /></span>
        <h1 className="mt-4 text-xl font-bold">Confirme sua senha</h1>
        <p className="mt-1 text-sm text-suave">A tela Integração mexe na configuração do sistema. Por segurança, a senha é pedida de novo a cada 10 minutos.</p>
        <form className="mt-5 space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          setErro('');
          setEnviando(true);
          try {
            await api.post('/api/auth/reautenticar', { senha });
            onOk();
          } catch (err) {
            setErro(err instanceof ApiError ? err.message : 'Não foi possível confirmar.');
          } finally {
            setEnviando(false);
          }
        }}>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <Campo rotulo="Senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" autoFocus />
          <Botao type="submit" className="w-full" carregando={enviando} disabled={!senha}>Continuar</Botao>
        </form>
      </div>
    </div>
  );
}

function Telas({ onExpirou }: { onExpirou: () => void }) {
  const [params, setParams] = useSearchParams();
  const { dados, erro, carregando, recarregar } = useDados<CardIntegracao[]>('/api/integracao/cards');
  const aba = (params.get('aba') === 'integracoes' ? 'integracoes' : 'geral') as CardIntegracao['aba'];
  const abrir = params.get('abrir');
  const [categoria, setCategoria] = useState('Todas');
  const [busca, setBusca] = useState('');

  useEffect(() => {
    if (erro?.codigo === 'reautenticar') onExpirou();
  }, [erro, onExpirou]);

  const daAba = useMemo(() => (dados ?? []).filter((c) => c.aba === aba), [dados, aba]);
  const categorias = useMemo(() => ['Todas', ...new Set(daAba.map((c) => c.categoria))], [daAba]);
  const visiveis = daAba.filter((c) => (categoria === 'Todas' || c.categoria === categoria)
    && (!busca || normalizar(`${c.nome} ${c.descricao} ${c.categoria}`).includes(normalizar(busca))));

  const mudarParams = (mudanca: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(mudanca)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    setParams(p, { replace: true });
  };
  const fechar = () => {
    mudarParams({ abrir: null });
    void recarregar();
  };
  const aoErro = (e: unknown) => {
    if (e instanceof ApiError && e.codigo === 'reautenticar') onExpirou();
  };

  if (carregando && !dados) return <Carregando />;
  if (erro) return <ErroCarregar mensagem={erro.message} onTentar={recarregar} />;

  return (
    <>
      <Cabecalho titulo="Integração" descricao="Configuração do aprovaRH e dos serviços externos. Somente o Desenvolvedor acessa." />
      <Abas abas={[{ id: 'geral', rotulo: 'Geral', icone: <LayoutGrid className="size-4" /> }, { id: 'integracoes', rotulo: 'Integrações', icone: <Plug className="size-4" /> }]}
        ativa={aba} onChange={(id) => { setCategoria('Todas'); mudarParams({ aba: id }); }} />

      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-2">
          {categorias.map((c) => (
            <button key={c} onClick={() => setCategoria(c)}
              className={`min-h-10 rounded-full px-4 text-sm font-semibold transition ${c === categoria ? 'bg-grafite text-white dark:bg-amarelo dark:text-grafite' : 'border border-borda bg-superficie text-suave hover:text-texto'}`}>
              {c}
            </button>
          ))}
        </div>
        <label className="relative md:w-72">
          <span className="sr-only">Buscar integração</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-suave" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar integração" className="campo pl-10" />
        </label>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {visiveis.map((c) => {
          const [sim, nao] = SITUACAO[c.id] ?? ['Configurada', 'Não configurada'];
          const soLeitura = c.id === 'env';
          return (
            <article key={c.id} className="cartao flex flex-col p-6">
              <SeloSigla sigla={c.sigla} cor={CORES[c.id] ?? '#57534E'} />
              <h2 className="mt-4 text-lg font-semibold">{c.nome}</h2>
              <p className="text-sm text-suave">{c.categoria}</p>
              <p className="mt-3 flex-1 text-[15px]">{c.descricao}</p>
              <div className="mt-5 flex items-center justify-between gap-3">
                {soLeitura ? <Selo>Somente leitura</Selo> : <Selo tom={c.configurado ? 'verde' : 'cinza'}>{c.configurado ? sim : nao}</Selo>}
                <Botao variante="secundario" onClick={() => mudarParams({ abrir: c.id })}>{soLeitura ? 'Ver' : 'Configurar'}</Botao>
              </div>
            </article>
          );
        })}
      </div>
      {!visiveis.length && <p className="py-10 text-center text-sm text-suave">Nenhuma integração encontrada.</p>}

      {abrir === 'atualizacao' && <ModalAtualizacao onFechar={fechar} onErro={aoErro} />}
      {abrir === 'seguranca' && <ModalSeguranca onFechar={fechar} onErro={aoErro} />}
      {abrir === 'admin' && <ModalAdmin onFechar={fechar} onErro={aoErro} />}
      {abrir === 'env' && <ModalEnv onFechar={fechar} onErro={aoErro} />}
      {abrir === 'smtp' && <ModalSmtp onFechar={fechar} onErro={aoErro} />}
      {abrir === 'privacidade' && <ModalPrivacidade onFechar={fechar} onErro={aoErro} />}
      {abrir === 'arquivos' && <ModalArquivos onFechar={fechar} onErro={aoErro} />}
    </>
  );
}
