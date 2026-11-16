import { CheckCircle2, Loader2, PlugZap, QrCode, RefreshCw, Smartphone, Unplug } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSessao } from '../../app/sessao';
import { Aviso, Botao, Cabecalho, Carregando, Confirmar, SemPermissao, Selo, useAviso } from '../../components/ui';
import { api, ApiError } from '../../lib/api';

type Estado = 'conectado' | 'conectando' | 'desconectado' | 'sem_instancia';
interface Situacao {
  configurado: boolean;
  faltando: string[];
  podeConfigurar: boolean;
  conexao: { estado: Estado; numero: string | null; nomePerfil: string | null; instancia: string | null } | null;
}
interface RespostaConectar { estado: Estado; qrcode: string | null; codigoPareamento: string | null; criada: boolean }

/** O QR Code da Evolution vence em cerca de 1 minuto: renovamos sozinhos algumas vezes enquanto a tela está aberta. */
const RENOVAR_QR_MS = 45_000;
const MAX_RENOVACOES = 5;
const CONFERIR_MS = 3_000;

function telefone(n: string | null) {
  if (!n) return null;
  const m = n.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : `+${n}`;
}

export function Conexao() {
  const { pode } = useSessao();
  if (!pode('whatsapp.conectar')) return <SemPermissao />;
  return <ConexaoTela />;
}

function ConexaoTela() {
  const avisar = useAviso();
  const [sit, setSit] = useState<Situacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [qr, setQr] = useState<RespostaConectar | null>(null);
  const [conectando, setConectando] = useState(false);
  const [renovacoes, setRenovacoes] = useState(0);
  const [confirmarSaida, setConfirmarSaida] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const ativo = useRef(true);
  useEffect(() => () => { ativo.current = false; }, []);

  const carregar = useCallback(async () => {
    try {
      const s = await api.get<Situacao>('/api/whatsapp/conexao');
      if (!ativo.current) return null;
      setSit(s);
      setErro(null);
      return s;
    } catch (e) {
      if (ativo.current) setErro(e instanceof ApiError ? e.message : 'Não foi possível falar com a Evolution API.');
      return null;
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const gerarQr = useCallback(async () => {
    setConectando(true);
    try {
      const r = await api.post<RespostaConectar>('/api/whatsapp/conexao/conectar');
      if (!ativo.current) return;
      if (r.estado === 'conectado') {
        setQr(null);
        await carregar();
        avisar('O WhatsApp já está conectado.');
      } else {
        setQr(r);
        setErro(null);
      }
    } catch (e) {
      if (ativo.current) setErro(e instanceof ApiError ? e.message : 'Não foi possível gerar o QR Code.');
    } finally {
      if (ativo.current) setConectando(false);
    }
  }, [avisar, carregar]);

  // Enquanto o QR Code está na tela: confere a cada 3 s se o celular leu e renova o QR antes de vencer.
  useEffect(() => {
    if (!qr) return;
    const conferir = setInterval(async () => {
      const s = await carregar();
      if (s?.conexao?.estado === 'conectado') {
        setQr(null);
        setRenovacoes(0);
        avisar('WhatsApp conectado.');
      }
    }, CONFERIR_MS);
    const renovar = setTimeout(() => {
      if (renovacoes + 1 >= MAX_RENOVACOES) {
        setQr(null);
        setRenovacoes(0);
        return;
      }
      setRenovacoes((n) => n + 1);
      void gerarQr();
    }, RENOVAR_QR_MS);
    return () => { clearInterval(conferir); clearTimeout(renovar); };
  }, [qr, renovacoes, carregar, gerarQr, avisar]);

  const desconectar = async () => {
    setSaindo(true);
    try {
      await api.post('/api/whatsapp/conexao/desconectar');
      setConfirmarSaida(false);
      await carregar();
      avisar('WhatsApp desconectado.');
    } catch (e) {
      avisar(e instanceof ApiError ? e.message : 'Não foi possível desconectar.', 'erro');
    } finally {
      setSaindo(false);
    }
  };

  const estado = sit?.conexao?.estado;

  return (
    <>
      <Cabecalho titulo="Conexão do WhatsApp" descricao="Conecte o celular do número do recrutamento lendo o QR Code. As mensagens das automações e da Central saem por esse número." />

      {!sit && !erro && <Carregando />}

      {erro && (
        <div className="mb-6 space-y-3">
          <Aviso tipo="erro">{erro}</Aviso>
          <Botao variante="secundario" icone={<RefreshCw className="size-4" />} onClick={() => { setErro(null); void carregar(); }}>Tentar de novo</Botao>
        </div>
      )}

      {sit && !sit.configurado && (
        <section className="rounded-3xl border border-borda bg-superficie p-6">
          <div className="flex items-start gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-amarelo/30 text-grafite dark:text-amarelo"><PlugZap className="size-6" /></span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">Falta configurar a Evolution API</h2>
              {sit.podeConfigurar ? (
                <>
                  <p className="mt-1 text-sm text-suave">Preencha em Integração › WhatsApp:</p>
                  <ul className="mt-2 list-disc pl-5 text-sm">{sit.faltando.map((f) => <li key={f}>{f}</li>)}</ul>
                  <Link to="/integracao?aba=integracoes&abrir=whatsapp" className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-destaque px-5 text-sm font-semibold text-destaque-texto hover:opacity-90">
                    Abrir Integração › WhatsApp
                  </Link>
                </>
              ) : (
                <p className="mt-1 text-sm text-suave">A TI - Tecnologia da Informação precisa informar os dados do servidor da Evolution API antes de conectar o celular.</p>
              )}
            </div>
          </div>
        </section>
      )}

      {sit?.configurado && sit.conexao && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* Situação */}
          <section className="rounded-3xl border border-borda bg-superficie p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">Situação</h2>
              {estado === 'conectado' ? <Selo tom="verde">Conectado</Selo>
                : estado === 'conectando' || qr ? <Selo tom="amarelo">Aguardando leitura</Selo>
                : estado === 'sem_instancia' ? <Selo tom="cinza">Instância ainda não criada</Selo>
                : <Selo tom="vermelho">Desconectado</Selo>}
            </div>

            <div className="mt-5 flex items-center gap-4">
              <span className={`grid size-14 shrink-0 place-items-center rounded-2xl ${estado === 'conectado' ? 'bg-verde/12 text-verde dark:text-emerald-300' : 'bg-superficie-2 text-suave'}`}>
                {estado === 'conectado' ? <CheckCircle2 className="size-7" /> : <Smartphone className="size-7" />}
              </span>
              <div className="min-w-0">
                <p className="text-xl font-bold">{estado === 'conectado' ? (telefone(sit.conexao.numero) ?? 'Número conectado') : 'Nenhum celular conectado'}</p>
                <p className="truncate text-sm text-suave">
                  {estado === 'conectado' && sit.conexao.nomePerfil ? `${sit.conexao.nomePerfil} · ` : ''}Instância "{sit.conexao.instancia}"
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              {estado === 'conectado' ? (
                <Botao variante="secundario" icone={<Unplug className="size-4" />} onClick={() => setConfirmarSaida(true)}>Desconectar</Botao>
              ) : (
                <Botao icone={<QrCode className="size-4" />} carregando={conectando} onClick={() => { setRenovacoes(0); void gerarQr(); }}>
                  {qr ? 'Gerar novo QR Code' : 'Conectar'}
                </Botao>
              )}
              <Botao variante="fantasma" icone={<RefreshCw className="size-4" />} onClick={() => void carregar()}>Atualizar</Botao>
            </div>

            {estado !== 'conectado' && (
              <p className="mt-4 text-[13px] text-suave">
                Ao conectar, o aprovaRH {estado === 'sem_instancia' ? 'cria a instância na Evolution, ' : ''}configura o webhook dela para receber as respostas dos candidatos e mostra o QR Code.
              </p>
            )}
          </section>

          {/* QR Code / passo a passo */}
          <section className="rounded-3xl border border-borda bg-superficie p-6">
            {estado === 'conectado' ? (
              <>
                <h2 className="font-semibold">Tudo certo</h2>
                <p className="mt-2 text-sm text-suave">
                  As mensagens das automações, dos códigos de acesso e da Central saem por este número, e as respostas dos candidatos chegam em Conversas.
                  Mantenha o celular com internet e não desconecte o aparelho no WhatsApp.
                </p>
              </>
            ) : qr ? (
              <div className="flex flex-col items-center text-center">
                <h2 className="font-semibold">Leia o QR Code com o celular</h2>
                {qr.qrcode ? (
                  <img src={qr.qrcode} alt="QR Code para conectar o WhatsApp" className="mt-4 size-64 rounded-2xl border border-borda bg-white p-3" />
                ) : (
                  <div className="mt-4 grid size-64 place-items-center rounded-2xl border border-dashed border-borda text-sm text-suave">
                    <span className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Gerando QR Code...</span>
                  </div>
                )}
                {qr.codigoPareamento && (
                  <p className="mt-3 text-sm">Ou use o código <strong className="font-mono tracking-widest">{qr.codigoPareamento}</strong> em "Conectar com número de telefone".</p>
                )}
                <p className="mt-3 flex items-center gap-2 text-[13px] text-suave"><Loader2 className="size-3.5 animate-spin" aria-hidden /> Esperando a leitura. O QR Code é renovado sozinho.</p>
              </div>
            ) : (
              <>
                <h2 className="font-semibold">Como conectar</h2>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
                  <li>Clique em <strong>Conectar</strong>.</li>
                  <li>No celular do número do recrutamento, abra o WhatsApp.</li>
                  <li>Toque em <strong>Configurações › Aparelhos conectados › Conectar um aparelho</strong>.</li>
                  <li>Aponte a câmera para o QR Code que vai aparecer aqui.</li>
                </ol>
                <p className="mt-4 text-[13px] text-suave">A Evolution API não é oficial: use um número só para o recrutamento (decisão D27).</p>
              </>
            )}
          </section>
        </div>
      )}

      <Confirmar
        aberto={confirmarSaida}
        titulo="Desconectar o WhatsApp?"
        texto="As automações e a Central param de enviar e receber mensagens pelo WhatsApp até alguém conectar de novo."
        rotulo="Desconectar"
        perigo
        carregando={saindo}
        onConfirmar={() => void desconectar()}
        onCancelar={() => setConfirmarSaida(false)}
      />
    </>
  );
}
