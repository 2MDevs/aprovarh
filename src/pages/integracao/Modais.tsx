import { RefreshCw, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSessao } from '../../app/sessao';
import { Aviso, Botao, Campo, Carregando, Interruptor, Modal, Selo, SeloSigla, useAviso } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { dataHora, relativo } from '../../lib/formato';
import { useDados } from '../../lib/useDados';
import { CORES } from './cores';

interface PropsModal { onFechar: () => void; onErro: (e: unknown) => void }

interface ItemConfig { chave: string; rotulo: string; tipo: 'texto' | 'textoLongo' | 'numero' | 'booleano' | 'segredo' | 'email'; origem: 'banco' | 'env' | 'padrao' | 'nao_definido'; valor: string | null; definido: boolean; min?: number; max?: number }

const ORIGEM: Record<ItemConfig['origem'], string> = { banco: 'Salvo pela tela', env: 'Vindo do .env', padrao: 'Padrão', nao_definido: 'Não definido' };

/** Formulário genérico de um grupo de configurações (Banco > .env > padrão). */
function useGrupo(grupo: 'smtp' | 'seguranca' | 'arquivos' | 'privacidade', onErro: (e: unknown) => void) {
  const { dados, erro, carregando } = useDados<ItemConfig[]>(`/api/integracao/config/${grupo}`);
  const [valores, setValores] = useState<Record<string, string>>({});
  useEffect(() => {
    if (dados) setValores(Object.fromEntries(dados.map((i) => [i.chave, i.tipo === 'segredo' ? '' : i.valor ?? ''])));
  }, [dados]);
  useEffect(() => {
    if (erro) onErro(erro);
  }, [erro, onErro]);
  const salvar = async () => {
    const corpo = Object.fromEntries((dados ?? []).map((i) => [i.chave, valores[i.chave] ?? '']));
    await api.put(`/api/integracao/config/${grupo}`, corpo);
  };
  return { itens: dados, erro, carregando, valores, setValores, salvar };
}

function CamposGrupo({ itens, valores, setValores }: { itens: ItemConfig[]; valores: Record<string, string>; setValores: (f: (v: Record<string, string>) => Record<string, string>) => void }) {
  return (
    <div className="space-y-4">
      {itens.map((i) => {
        const ajuda = `${ORIGEM[i.origem]}${i.tipo === 'segredo' && i.definido ? ' · já configurada (deixe vazio para manter)' : ''}`;
        if (i.tipo === 'textoLongo') {
          return (
            <div key={i.chave}>
              <label className="rotulo" htmlFor={`cfg-${i.chave}`}>{i.rotulo}</label>
              <textarea id={`cfg-${i.chave}`} className="campo min-h-64 font-normal leading-relaxed" maxLength={20000}
                value={valores[i.chave] ?? ''} onChange={(e) => setValores((s) => ({ ...s, [i.chave]: e.target.value }))} />
              <p className="mt-1.5 text-[13px] text-suave">{ajuda}</p>
            </div>
          );
        }
        if (i.tipo === 'booleano') {
          return <Interruptor key={i.chave} ligado={valores[i.chave] === 'true'} onChange={(v) => setValores((s) => ({ ...s, [i.chave]: String(v) }))} rotulo={i.rotulo} descricao={ajuda} />;
        }
        return (
          <Campo key={i.chave} rotulo={i.rotulo} ajuda={ajuda}
            type={i.tipo === 'segredo' ? 'password' : i.tipo === 'numero' ? 'number' : 'text'}
            min={i.min} max={i.max} autoComplete={i.tipo === 'segredo' ? 'new-password' : 'off'}
            placeholder={i.tipo === 'segredo' && i.definido ? '••••••••' : undefined}
            value={valores[i.chave] ?? ''} onChange={(e) => setValores((s) => ({ ...s, [i.chave]: e.target.value }))} />
        );
      })}
    </div>
  );
}

function Rodape({ onFechar, onSalvar, salvando }: { onFechar: () => void; onSalvar: () => void; salvando: boolean }) {
  return <><Botao variante="secundario" onClick={onFechar}>Cancelar</Botao><Botao carregando={salvando} onClick={onSalvar}>Salvar</Botao></>;
}

function useSalvar(onErro: (e: unknown) => void, onFechar: () => void, mensagem: string) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const avisar = useAviso();
  const executar = async (fn: () => Promise<void>) => {
    setErro('');
    setSalvando(true);
    try {
      await fn();
      avisar(mensagem);
      onFechar();
    } catch (e) {
      onErro(e);
      setErro(e instanceof ApiError ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };
  return { salvando, erro, executar };
}

// ── E-mail (SMTP) ──────────────────────────────────────────────────────────
export function ModalSmtp({ onFechar, onErro }: PropsModal) {
  const g = useGrupo('smtp', onErro);
  const { recarregar } = useSessao();
  const s = useSalvar(onErro, onFechar, 'E-mail salvo.');
  const { sessao } = useSessao();
  const [para, setPara] = useState(sessao?.usuario?.email ?? '');
  const [testando, setTestando] = useState(false);
  const [teste, setTeste] = useState<{ ok: boolean; texto: string } | null>(null);

  const testar = async () => {
    setTeste(null);
    setTestando(true);
    try {
      await g.salvar(); // testa com o que está na tela
      await api.post('/api/integracao/smtp/teste', { para });
      setTeste({ ok: true, texto: `E-mail de teste enviado para ${para}. Confira a caixa de entrada (e o spam).` });
      await recarregar();
    } catch (e) {
      onErro(e);
      setTeste({ ok: false, texto: e instanceof ApiError ? e.message : 'Falhou.' });
    } finally {
      setTestando(false);
    }
  };

  return (
    <Modal aberto onFechar={onFechar} titulo="E-mail (SMTP)" descricao="Envia os códigos de acesso (2FA), os convites e os links de senha."
      selo={<SeloSigla sigla="SMTP" cor={CORES.smtp} />}
      rodape={<Rodape onFechar={onFechar} salvando={s.salvando} onSalvar={() => void s.executar(async () => { await g.salvar(); await recarregar(); })} />}>
      {g.carregando || !g.itens ? <Carregando /> : (
        <div className="space-y-5">
          {s.erro && <Aviso tipo="erro">{s.erro}</Aviso>}
          <Aviso>Ao configurar o e-mail pela primeira vez, o código por e-mail (2FA) passa a valer para todos, e quem entrou no modo de configuração inicial precisa entrar de novo.</Aviso>
          <CamposGrupo itens={g.itens} valores={g.valores} setValores={g.setValores} />
          <div className="rounded-2xl border border-borda p-4">
            <p className="text-sm font-semibold">Enviar e-mail de teste</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
              <Campo rotulo="Para" type="email" value={para} onChange={(e) => setPara(e.target.value)} className="flex-1" />
              <Botao variante="secundario" icone={<Send className="size-4" />} carregando={testando} disabled={!para} onClick={() => void testar()}>Enviar teste</Botao>
            </div>
            {teste && <div className="mt-3"><Aviso tipo={teste.ok ? 'info' : 'erro'}>{teste.texto}</Aviso></div>}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Segurança & Sessão ─────────────────────────────────────────────────────
export function ModalSeguranca({ onFechar, onErro }: PropsModal) {
  const g = useGrupo('seguranca', onErro);
  const { recarregar } = useSessao();
  const s = useSalvar(onErro, onFechar, 'Segurança salva.');
  return (
    <Modal aberto onFechar={onFechar} titulo="Segurança & Sessão" descricao="Limites de sessão e de bloqueio do aprovaRH."
      selo={<SeloSigla sigla="SG" cor={CORES.seguranca} />}
      rodape={<Rodape onFechar={onFechar} salvando={s.salvando} onSalvar={() => void s.executar(async () => { await g.salvar(); await recarregar(); })} />}>
      {g.carregando || !g.itens ? <Carregando /> : (
        <div className="space-y-5">
          {s.erro && <Aviso tipo="erro">{s.erro}</Aviso>}
          <CamposGrupo itens={g.itens} valores={g.valores} setValores={g.setValores} />
          <div className="rounded-2xl bg-superficie-2 p-4 text-sm text-suave">
            <p className="font-semibold text-texto">Regras fixas da infraestrutura padrão</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Senha com 10 caracteres ou mais, letras e números.</li>
              <li>5 senhas erradas bloqueiam a conta por 15 minutos; 10 tentativas a cada 15 minutos por IP.</li>
              <li>Código por e-mail com 6 números, vale 10 minutos, reenvio após 60 segundos.</li>
              <li>Dispositivo confiável por 30 dias.</li>
            </ul>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Administrador principal ────────────────────────────────────────────────
export function ModalAdmin({ onFechar, onErro }: PropsModal) {
  const { dados, carregando, erro } = useDados<{ email: string | null; existe: boolean; situacao?: string; deveTrocarSenha?: boolean; ultimoLoginEm?: string | null }>('/api/integracao/admin');
  const { sessao } = useSessao();
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  useEffect(() => { if (erro) onErro(erro); }, [erro, onErro]);
  return (
    <Modal aberto onFechar={onFechar} titulo="Administrador principal" descricao="Conta criada a partir de ADMIN_EMAIL, usada no primeiro acesso." selo={<SeloSigla sigla="AD" cor={CORES.admin} />}
      rodape={<Botao variante="secundario" onClick={onFechar}>Fechar</Botao>}>
      {carregando || !dados ? <Carregando /> : (
        <div className="space-y-4 text-sm">
          {!dados.email ? <Aviso tipo="atencao">ADMIN_EMAIL não está definido no .env.</Aviso> : (
            <>
              <dl className="grid gap-2 sm:grid-cols-[160px_1fr]">
                <dt className="font-semibold">E-mail</dt><dd>{dados.email}</dd>
                <dt className="font-semibold">Situação</dt><dd>{dados.existe ? <Selo tom={dados.situacao === 'ativo' ? 'verde' : 'vermelho'}>{dados.situacao === 'ativo' ? 'Ativo' : 'Bloqueado'}</Selo> : 'Ainda não criado'}</dd>
                {dados.existe && <><dt className="font-semibold">Senha</dt><dd>{dados.deveTrocarSenha ? 'Ainda não trocou a senha inicial' : 'Já definida pelo administrador'}</dd></>}
                {dados.existe && <><dt className="font-semibold">Último acesso</dt><dd>{dados.ultimoLoginEm ? `${dataHora(dados.ultimoLoginEm)} (${relativo(dados.ultimoLoginEm)})` : 'Nunca'}</dd></>}
              </dl>
              {msg && <Aviso tipo={msg.ok ? 'info' : 'erro'}>{msg.texto}</Aviso>}
              <Botao variante="secundario" icone={<Send className="size-4" />} carregando={enviando} disabled={!dados.existe || !sessao?.smtpConfigurado}
                onClick={async () => {
                  setEnviando(true);
                  setMsg(null);
                  try {
                    await api.post('/api/integracao/admin/enviar-redefinicao');
                    setMsg({ ok: true, texto: 'Link de redefinição enviado para o administrador.' });
                  } catch (e) {
                    onErro(e);
                    setMsg({ ok: false, texto: e instanceof ApiError ? e.message : 'Falhou.' });
                  } finally {
                    setEnviando(false);
                  }
                }}>Enviar redefinição de senha</Botao>
              {!sessao?.smtpConfigurado && <p className="text-suave">Configure o e-mail (SMTP) para poder enviar o link.</p>}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

// ── Variáveis do .env (somente leitura) ────────────────────────────────────
export function ModalEnv({ onFechar, onErro }: PropsModal) {
  const { dados, carregando, erro } = useDados<{ nome: string; definida: boolean; secreta: boolean; valor: string | null }[]>('/api/integracao/env');
  useEffect(() => { if (erro) onErro(erro); }, [erro, onErro]);
  return (
    <Modal aberto onFechar={onFechar} titulo="Variáveis do .env" descricao="Só leitura. Valores secretos nunca aparecem. Para mudar, edite o .env na VPS e reinicie." selo={<SeloSigla sigla="ENV" cor={CORES.env} />}
      rodape={<Botao variante="secundario" onClick={onFechar}>Fechar</Botao>}>
      {carregando || !dados ? <Carregando /> : (
        <>
          <p className="mb-3 text-sm text-suave">{dados.filter((d) => d.definida).length} de {dados.length} definidas.</p>
          <ul className="divide-y divide-borda rounded-2xl border border-borda">
            {dados.map((v) => (
              <li key={v.nome} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className="font-mono">{v.nome}</span>
                <span className="flex items-center gap-2">
                  {v.valor && <span className="max-w-[220px] truncate font-mono text-xs text-suave">{v.valor}</span>}
                  {v.secreta && v.definida && <Selo>Secreta</Selo>}
                  <Selo tom={v.definida ? 'verde' : 'cinza'}>{v.definida ? 'Definida' : 'Não definida'}</Selo>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}

// ── Atualização do sistema ─────────────────────────────────────────────────
interface Commit { commit: string; curto: string; mensagem: string; data: string }
interface StatusAtualizacao {
  instalado: boolean; branch: string; atual: Commit | null; ultimo: Commit | null; disponivel: boolean; emAndamento: boolean;
  status: { state: string; message: string; finishedAt?: string } | null; log: string;
}

export function ModalAtualizacao({ onFechar, onErro }: PropsModal) {
  const st = useDados<StatusAtualizacao>('/api/atualizacao/status');
  const [mudancas, setMudancas] = useState<{ titulo: string; itens: string[]; data: string }[] | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [senha, setSenha] = useState('');
  const [aplicando, setAplicando] = useState(false);
  const [erro, setErro] = useState('');

  // Enquanto atualiza, acompanha o andamento.
  useEffect(() => {
    if (!st.dados?.emAndamento) return;
    const t = setInterval(() => void st.recarregar(), 4000);
    return () => clearInterval(t);
  }, [st.dados?.emAndamento, st.recarregar]);

  const verificar = async () => {
    setVerificando(true);
    try {
      const r = await api.post<{ mudancas: { titulo: string; itens: string[]; data: string }[] }>('/api/atualizacao/verificar');
      setMudancas(r.mudancas);
      await st.recarregar();
    } catch (e) {
      onErro(e);
      setErro(e instanceof ApiError ? e.message : 'Não foi possível verificar.');
    } finally {
      setVerificando(false);
    }
  };

  const atualizar = async () => {
    setErro('');
    setAplicando(true);
    try {
      await api.post('/api/atualizacao/atualizar', { senha });
      setSenha('');
      await st.recarregar();
    } catch (e) {
      onErro(e);
      setErro(e instanceof ApiError ? e.message : 'Não foi possível atualizar.');
    } finally {
      setAplicando(false);
    }
  };

  const d = st.dados;
  const estado = d?.status?.state;
  return (
    <Modal aberto onFechar={onFechar} titulo="Atualização do sistema" descricao="Baixa a versão nova do GitHub, instala, reinicia e volta sozinho para a anterior se algo falhar."
      selo={<SeloSigla sigla="UP" cor={CORES.atualizacao} />} largura="max-w-2xl"
      rodape={<Botao variante="secundario" onClick={onFechar}>Fechar</Botao>}>
      {!d ? <Carregando /> : (
        <div className="space-y-5">
          {!d.instalado && (
            <Aviso tipo="atencao">O serviço de atualização ainda não foi instalado nesta VPS. Rode uma vez, na pasta do projeto: <code>sudo bash scripts/install-auto-update.sh</code></Aviso>
          )}
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-xl bg-superficie-2 p-4"><dt className="text-suave">Versão instalada</dt><dd className="mt-1 font-semibold">{d.atual ? `${d.atual.curto} · ${d.atual.mensagem}` : 'Desconhecida'}</dd></div>
            <div className="rounded-xl bg-superficie-2 p-4"><dt className="text-suave">No GitHub ({d.branch})</dt><dd className="mt-1 font-semibold">{d.ultimo ? `${d.ultimo.curto} · ${d.ultimo.mensagem}` : 'Sem acesso ao GitHub'}</dd></div>
          </dl>
          <div className="flex flex-wrap items-center gap-3">
            {d.emAndamento ? <Selo tom="amarelo">Atualizando...</Selo> : d.disponivel ? <Selo tom="amarelo">Nova versão disponível</Selo> : <Selo tom="verde">Em dia</Selo>}
            {estado && !d.emAndamento && <span className="text-sm text-suave">Última: {d.status!.message}{d.status!.finishedAt ? ` (${dataHora(d.status!.finishedAt)})` : ''}</span>}
            <Botao variante="secundario" icone={<RefreshCw className="size-4" />} carregando={verificando} onClick={() => void verificar()}>Verificar</Botao>
          </div>
          {mudancas && (mudancas.length ? (
            <div className="rounded-2xl border border-borda p-4">
              <p className="mb-2 text-sm font-semibold">O que a versão nova traz</p>
              <ul className="space-y-3 text-sm">
                {mudancas.map((m) => (
                  <li key={m.titulo + m.data}><p className="font-semibold">{m.titulo}</p>{m.itens.length > 0 && <ul className="mt-1 list-disc pl-5 text-suave">{m.itens.map((i) => <li key={i}>{i}</li>)}</ul>}</li>
                ))}
              </ul>
            </div>
          ) : <p className="text-sm text-suave">Nenhuma melhoria nova para mostrar.</p>)}
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          {d.disponivel && d.instalado && !d.emAndamento && (
            <div className="flex flex-col gap-2 rounded-2xl border border-borda p-4 sm:flex-row sm:items-end">
              <Campo rotulo="Confirme sua senha para atualizar" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} className="flex-1" autoComplete="current-password" />
              <Botao carregando={aplicando} disabled={!senha} onClick={() => void atualizar()}>Atualizar</Botao>
            </div>
          )}
          {d.log && (
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold">Registro da última atualização</summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-xl bg-grafite p-4 text-xs text-creme">{d.log}</pre>
            </details>
          )}
        </div>
      )}
    </Modal>
  );
}

// ── Aviso de privacidade (LGPD) ────────────────────────────────────────────
export function ModalPrivacidade({ onFechar, onErro }: PropsModal) {
  const g = useGrupo('privacidade', onErro);
  const s = useSalvar(onErro, onFechar, 'Aviso de privacidade salvo.');
  return (
    <Modal aberto onFechar={onFechar} titulo="Aviso de privacidade" largura="max-w-2xl"
      descricao="O candidato lê e aceita este texto antes de enviar a candidatura. Enquanto ele estiver vazio, o formulário público fica fechado."
      selo={<SeloSigla sigla="LGPD" cor={CORES.privacidade} />}
      rodape={<Rodape onFechar={onFechar} salvando={s.salvando} onSalvar={() => void s.executar(g.salvar)} />}>
      {g.carregando || !g.itens ? <Carregando /> : (
        <div className="space-y-5">
          {s.erro && <Aviso tipo="erro">{s.erro}</Aviso>}
          <Aviso tipo="atencao">O texto deve ser escrito ou aprovado pelo RH e pelo jurídico. Ele precisa dizer quais dados são coletados (nome, CPF, telefone, currículo e foto), para que são usados, por quanto tempo são guardados e como o candidato pede a exclusão. Quando o texto muda, os próximos candidatos aceitam a nova versão.</Aviso>
          <CamposGrupo itens={g.itens} valores={g.valores} setValores={g.setValores} />
        </div>
      )}
    </Modal>
  );
}

// ── Arquivos do candidato ──────────────────────────────────────────────────
export function ModalArquivos({ onFechar, onErro }: PropsModal) {
  const g = useGrupo('arquivos', onErro);
  const s = useSalvar(onErro, onFechar, 'Limites salvos.');
  return (
    <Modal aberto onFechar={onFechar} titulo="Arquivos do candidato" descricao="Currículo: PDF, DOC ou DOCX. Foto 3x4: JPG ou PNG. O tipo é conferido pelo conteúdo do arquivo, não pelo nome."
      selo={<SeloSigla sigla="ARQ" cor={CORES.arquivos} />}
      rodape={<Rodape onFechar={onFechar} salvando={s.salvando} onSalvar={() => void s.executar(g.salvar)} />}>
      {g.carregando || !g.itens ? <Carregando /> : (
        <div className="space-y-5">
          {s.erro && <Aviso tipo="erro">{s.erro}</Aviso>}
          <CamposGrupo itens={g.itens} valores={g.valores} setValores={g.setValores} />
        </div>
      )}
    </Modal>
  );
}
