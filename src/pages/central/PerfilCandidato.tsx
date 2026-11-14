import { ChevronDown, Copy, Download, Eye, FileText, KeyRound, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useSessao } from '../../app/sessao';
import { Aviso, Botao, Campo, Carregando, Confirmar, ErroCarregar, Interruptor, Modal, Selecao, Selo, useAviso } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { bytes, data, dataHora } from '../../lib/formato';
import { useDados } from '../../lib/useDados';
import { Foto, Pilula } from './comum';
import { useOpcoesFiltro } from './Filtros';
import { ROTULO_ETAPA, ROTULO_SITUACAO, urlArquivo, type Perfil, type SituacaoEtapa } from './tipos';

const TOM_ETAPA: Record<SituacaoEtapa, 'verde' | 'amarelo' | 'cinza'> = { concluida: 'verde', em_andamento: 'amarelo', aguardando: 'amarelo', nao_iniciada: 'cinza' };

export function PerfilCandidato({ candidatoId, versao, onFechar, onMudou }: { candidatoId: string; versao: number; onFechar: () => void; onMudou: () => void }) {
  const { pode } = useSessao();
  const { dados: p, erro, carregando, recarregar } = useDados<Perfil>(`/api/central/candidatos/${candidatoId}`);
  const op = useOpcoesFiltro();
  const [ocupado, setOcupado] = useState(false);
  const [editar, setEditar] = useState(false);
  const [trocarStatus, setTrocarStatus] = useState<string | null>(null);
  const [cpf, setCpf] = useState<string | null>(null);
  const avisar = useAviso();

  useEffect(() => {
    if (versao) void recarregar();
  }, [versao]); // eslint-disable-line react-hooks/exhaustive-deps

  if (carregando && !p) return <Carregando />;
  if (erro || !p) return <div className="p-4"><ErroCarregar mensagem={erro?.message ?? 'Sem dados.'} onTentar={recarregar} /></div>;

  const nome = `${p.nome} ${p.sobrenome}`;
  const podeStatus = pode('status.alterar');
  const executar = async (fn: () => Promise<unknown>, ok?: string) => {
    setOcupado(true);
    try {
      await fn();
      if (ok) avisar(ok);
      await recarregar();
      onMudou();
    } catch (e) {
      avisar(e instanceof ApiError ? e.message : 'Não foi possível concluir.', 'erro');
    } finally {
      setOcupado(false);
    }
  };
  const tagsDisponiveis = op.tags.filter((t) => !p.tags.some((x) => x.id === t.id));
  const curriculo = p.arquivos.find((a) => a.id === p.curriculoId);
  const ultimaCandidatura = p.historico.candidaturas[0];

  return (
    <div className="pb-8">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-borda bg-superficie px-4 py-3">
        <p className="font-semibold">Perfil do candidato</p>
        <button onClick={onFechar} className="grid size-10 place-items-center rounded-full hover:bg-superficie-2" aria-label="Fechar perfil"><X className="size-5" /></button>
      </div>

      <div className="flex flex-col items-center gap-3 px-5 pt-6 text-center">
        {p.fotoId && pode('candidatos.curriculo.baixar') ? (
          <a href={urlArquivo(p.id, p.fotoId)} target="_blank" rel="noreferrer" title="Abrir foto 3x4"><Foto candidatoId={p.id} fotoId={p.fotoId} nome={nome} tamanho={112} /></a>
        ) : <Foto candidatoId={p.id} fotoId={p.fotoId} nome={nome} tamanho={112} />}
        <div>
          <p className="text-xl font-bold">{nome}</p>
          <p className="text-sm text-suave">{p.codigo} · {p.unidade.nome}</p>
        </div>
      </div>

      {ultimaCandidatura && (ultimaCandidatura.telefoneDiferente || ultimaCandidatura.unidadeDiferente) && (
        <div className="mx-4 mt-4">
          <Aviso tipo="atencao">
            Na candidatura de {data(ultimaCandidatura.em)}, a pessoa informou
            {ultimaCandidatura.telefoneDiferente && <> o telefone <strong>{ultimaCandidatura.telefoneInformado}</strong></>}
            {ultimaCandidatura.telefoneDiferente && ultimaCandidatura.unidadeDiferente && ' e'}
            {ultimaCandidatura.unidadeDiferente && <> a unidade <strong>{ultimaCandidatura.unidade}</strong></>}, diferente do cadastro. Confirme com o candidato antes de alterar.
          </Aviso>
        </div>
      )}

      <Secao titulo="Dados">
        <dl className="space-y-2 text-sm">
          <Linha rotulo="Telefone">{p.telefone}</Linha>
          <Linha rotulo="CPF">
            {cpf ?? p.cpf}{' '}
            {!cpf && pode('candidatos.editar') && <button className="ml-1 text-xs font-semibold underline" onClick={() => void api.post<{ cpf: string }>(`/api/central/candidatos/${p.id}/cpf`).then((r) => setCpf(r.cpf))}>mostrar</button>}
          </Linha>
          <Linha rotulo="Unidade">{p.unidade.nome}</Linha>
          <Linha rotulo="Candidatura">{dataHora(p.candidaturaEm)}</Linha>
          <Linha rotulo="Aceite LGPD">{dataHora(p.consentimentoEm)}</Linha>
        </dl>
        {pode('candidatos.editar') && <Botao variante="secundario" className="mt-3 w-full" icone={<Pencil className="size-4" />} onClick={() => setEditar(true)}>Corrigir dados</Botao>}
      </Secao>

      <Secao titulo="Status">
        {podeStatus ? (
          <select className="campo" value={p.status.id} disabled={ocupado} onChange={(e) => setTrocarStatus(e.target.value)} aria-label="Status do candidato">
            {op.status.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        ) : <Pilula cor={p.status.cor}>{p.status.nome}</Pilula>}
      </Secao>

      <Secao titulo="Tags">
        <div className="flex flex-wrap gap-1.5">
          {p.tags.length ? p.tags.map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1">
              <Pilula cor={t.cor}>{t.nome}</Pilula>
              {podeStatus && <button disabled={ocupado} onClick={() => void executar(() => api.post(`/api/central/candidatos/${p.id}/tags/remover`, { tagId: t.id }))} className="grid size-7 place-items-center rounded-full text-suave hover:bg-superficie-2 hover:text-texto" aria-label={`Tirar a tag ${t.nome}`}><X className="size-3.5" /></button>}
            </span>
          )) : <p className="text-sm text-suave">Sem tags.</p>}
        </div>
        {podeStatus && tagsDisponiveis.length > 0 && (
          <select className="campo mt-3 !py-2 text-sm" value="" disabled={ocupado} aria-label="Adicionar tag"
            onChange={(e) => e.target.value && void executar(() => api.post(`/api/central/candidatos/${p.id}/tags/adicionar`, { tagId: e.target.value }))}>
            <option value="">+ Adicionar tag</option>
            {tagsDisponiveis.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
        )}
      </Secao>

      <Secao titulo="Etapas no portal do candidato">
        <ol className="space-y-2">
          {p.etapas.map((e) => (
            <li key={e.etapa} className="flex items-center justify-between gap-2 text-sm">
              <span>{ROTULO_ETAPA[e.etapa]}{e.origem === 'manual' && <span className="ml-1 text-xs text-suave">(ajuste manual)</span>}</span>
              {podeStatus ? (
                <select className="rounded-lg border border-borda bg-superficie-2 px-2 py-1 text-xs font-semibold" value={e.situacao} disabled={ocupado} aria-label={`Situação de ${ROTULO_ETAPA[e.etapa]}`}
                  onChange={(ev) => void executar(() => api.put(`/api/central/candidatos/${p.id}/etapas/${e.etapa}`, { situacao: ev.target.value }), 'Etapa ajustada.')}>
                  {Object.entries(ROTULO_SITUACAO).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                </select>
              ) : <Selo tom={TOM_ETAPA[e.situacao]}>{ROTULO_SITUACAO[e.situacao]}</Selo>}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-suave">As etapas acompanham o status. Um ajuste manual vale até a próxima mudança de status.</p>
      </Secao>

      <AcessoPortal p={p} pode={pode('portal.liberar')} onMudou={() => { void recarregar(); onMudou(); }} />

      <Secao titulo="Currículo e arquivos">
        {curriculo && pode('candidatos.curriculo.baixar') && (
          <div className="mb-3 flex gap-2">
            <a href={urlArquivo(p.id, curriculo.id)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-destaque px-4 text-sm font-semibold text-destaque-texto"><Eye className="size-4" /> Ver currículo</a>
            <a href={urlArquivo(p.id, curriculo.id, 'baixar')} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-borda px-4 text-sm font-semibold" aria-label="Baixar currículo"><Download className="size-4" /></a>
          </div>
        )}
        <ul className="space-y-1.5">
          {p.arquivos.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-sm">
              <FileText className="size-4 shrink-0 text-suave" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{a.nome}<span className="block text-xs text-suave">{{ curriculo: 'Currículo', foto: 'Foto 3x4', anexo: 'Anexo' }[a.tipo]} · {bytes(a.tamanho)} · {data(a.em)}</span></span>
              {pode('candidatos.curriculo.baixar') && (
                <a href={urlArquivo(p.id, a.id, 'baixar')} className="grid size-9 place-items-center rounded-full hover:bg-superficie-2" aria-label={`Baixar ${a.nome}`}><Download className="size-4" /></a>
              )}
            </li>
          ))}
        </ul>
        {!pode('candidatos.curriculo.baixar') && <p className="mt-2 text-xs text-suave">Seu perfil não pode abrir currículos.</p>}
      </Secao>

      {p.observacoes && <Observacoes p={p} onMudou={() => void recarregar()} />}

      <Secao titulo="Histórico" recolhida>
        <ul className="space-y-3 text-sm">
          {[
            ...p.historico.status.map((h) => ({ em: h.em, texto: h.anterior ? `Status: ${h.anterior} → ${h.novo}` : `Status inicial: ${h.novo}`, quem: h.autor_nome, extra: h.motivo })),
            ...p.historico.tags.map((h) => ({ em: h.em, texto: `Tag ${h.tag} ${h.acao}`, quem: h.autor_nome, extra: null })),
            ...p.historico.candidaturas.map((c) => ({ em: c.em, texto: { nova: 'Candidatura recebida', repetida: 'Candidatura enviada de novo', reaberta: 'Nova candidatura (processo reaberto)' }[c.tipo] + ` · ${c.unidade}`, quem: 'Formulário', extra: c.telefoneDiferente ? `Telefone informado: ${c.telefoneInformado}` : null })),
          ].sort((a, b) => b.em.localeCompare(a.em)).map((h, i) => (
            <li key={i} className="border-l-2 border-amarelo pl-3">
              <p className="font-medium">{h.texto}</p>
              <p className="text-xs text-suave">{dataHora(h.em)}{h.quem ? ` · ${h.quem}` : ''}</p>
              {h.extra && <p className="text-xs text-suave">{h.extra}</p>}
            </li>
          ))}
        </ul>
      </Secao>

      {editar && <EditarDados p={p} onFechar={() => setEditar(false)} onSalvo={() => { setEditar(false); void recarregar(); onMudou(); avisar('Dados atualizados.'); }} />}
      {trocarStatus && (
        <TrocarStatus nomeAtual={p.status.nome} novo={op.status.find((s) => s.id === trocarStatus)?.nome ?? ''} carregando={ocupado}
          onCancelar={() => setTrocarStatus(null)}
          onConfirmar={(motivo) => void executar(() => api.post(`/api/central/candidatos/${p.id}/status`, { statusId: trocarStatus, motivo: motivo || undefined }), 'Status alterado.').then(() => setTrocarStatus(null))} />
      )}
    </div>
  );
}

function Secao({ titulo, children, recolhida }: { titulo: string; children: ReactNode; recolhida?: boolean }) {
  const [aberta, setAberta] = useState(!recolhida);
  return (
    <section className="mx-4 mt-4 rounded-2xl border border-borda p-4">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setAberta((v) => !v)} aria-expanded={aberta}>
        <h3 className="text-sm font-bold uppercase tracking-wide text-suave">{titulo}</h3>
        <ChevronDown className={`size-4 text-suave transition ${aberta ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {aberta && <div className="mt-3">{children}</div>}
    </section>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return <div className="flex justify-between gap-3"><dt className="text-suave">{rotulo}</dt><dd className="text-right font-medium">{children}</dd></div>;
}

function Observacoes({ p, onMudou }: { p: Perfil; onMudou: () => void }) {
  const [texto, setTexto] = useState('');
  const [salvando, setSalvando] = useState(false);
  const avisar = useAviso();
  const salvar = async () => {
    setSalvando(true);
    try {
      await api.post(`/api/central/candidatos/${p.id}/observacoes`, { texto });
      setTexto('');
      onMudou();
    } catch (e) {
      avisar(e instanceof ApiError ? e.message : 'Não foi possível salvar.', 'erro');
    } finally {
      setSalvando(false);
    }
  };
  return (
    <Secao titulo="Observações internas">
      <p className="mb-2 text-xs text-suave">Só a equipe vê. Nunca aparecem para o candidato.</p>
      <textarea className="campo min-h-20 text-sm" value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={4000} placeholder="Escreva uma observação" aria-label="Nova observação" />
      <Botao variante="secundario" className="mt-2 w-full" carregando={salvando} disabled={!texto.trim()} icone={<Plus className="size-4" />} onClick={() => void salvar()}>Adicionar</Botao>
      <ul className="mt-3 space-y-2">
        {p.observacoes!.map((o) => (
          <li key={o.id} className="rounded-xl bg-creme/60 p-3 text-sm dark:bg-amarelo/10">
            <p className="whitespace-pre-wrap">{o.texto}</p>
            <p className="mt-1 flex items-center justify-between text-xs text-suave">
              <span>{o.autor} · {dataHora(o.em)}</span>
              {o.minha && <button onClick={() => void api.del(`/api/central/candidatos/${p.id}/observacoes/${o.id}`).then(onMudou)} className="grid size-8 place-items-center rounded-full hover:bg-superficie" aria-label="Excluir observação"><Trash2 className="size-3.5" /></button>}
            </p>
          </li>
        ))}
      </ul>
    </Secao>
  );
}

function TrocarStatus({ nomeAtual, novo, carregando, onCancelar, onConfirmar }: { nomeAtual: string; novo: string; carregando: boolean; onCancelar: () => void; onConfirmar: (motivo: string) => void }) {
  const [motivo, setMotivo] = useState('');
  return (
    <Modal aberto onFechar={onCancelar} titulo="Mudar o status?" largura="max-w-md"
      rodape={<><Botao variante="secundario" onClick={onCancelar}>Cancelar</Botao><Botao carregando={carregando} onClick={() => onConfirmar(motivo)}>Mudar</Botao></>}>
      <p className="text-[15px]"><strong>{nomeAtual}</strong> → <strong>{novo}</strong></p>
      <p className="mt-1 text-sm text-suave">A mudança fica no histórico, com seu nome, data e horário, e atualiza as etapas no portal do candidato.</p>
      <Campo rotulo="Motivo (opcional)" className="mt-4" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={255} />
    </Modal>
  );
}

function EditarDados({ p, onFechar, onSalvo }: { p: Perfil; onFechar: () => void; onSalvo: () => void }) {
  const op = useOpcoesFiltro();
  const [nome, setNome] = useState(p.nome);
  const [sobrenome, setSobrenome] = useState(p.sobrenome);
  const [telefone, setTelefone] = useState(p.telefone.includes('•') ? '' : p.telefone);
  const [unidadeId, setUnidadeId] = useState(p.unidade.id);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    setErro('');
    setSalvando(true);
    try {
      await api.put(`/api/central/candidatos/${p.id}`, { nome, sobrenome, telefone, unidadeId });
      onSalvo();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };
  return (
    <Modal aberto onFechar={onFechar} titulo="Corrigir dados" descricao="A alteração fica na auditoria. O CPF não pode ser alterado."
      rodape={<><Botao variante="secundario" onClick={onFechar}>Cancelar</Botao><Botao carregando={salvando} disabled={!nome || !sobrenome || !telefone} onClick={() => void salvar()}>Salvar</Botao></>}>
      <div className="space-y-4">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          <Campo rotulo="Sobrenome" value={sobrenome} onChange={(e) => setSobrenome(e.target.value)} />
        </div>
        <Campo rotulo="Telefone com DDD" value={telefone} onChange={(e) => setTelefone(e.target.value)} inputMode="tel" ajuda="É o número que vai receber o WhatsApp. Confirme com o candidato antes de trocar." />
        <Selecao rotulo="Unidade" value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
          {op.unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </Selecao>
      </div>
    </Modal>
  );
}

const RESULTADO_ACESSO = { sucesso: 'Entrou', codigo_invalido: 'Código inválido', expirado: 'Tentou com código vencido', revogado: 'Tentou com código revogado' } as const;

/** Acesso ao portal: liberar o código do dia, revogar e ver o histórico de acessos. */
function AcessoPortal({ p, pode, onMudou }: { p: Perfil; pode: boolean; onMudou: () => void }) {
  const [liberar, setLiberar] = useState(false);
  const [revogar, setRevogar] = useState(false);
  const [permiteArquivo, setPermiteArquivo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [gerado, setGerado] = useState<{ codigo: string; expiraEm: string; mensagemSugerida: string; aviso: string } | null>(null);
  const avisar = useAviso();
  const ativo = p.portal.ativo;
  const hora = (v: string) => new Date(v).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

  const gerar = async () => {
    setOcupado(true);
    try {
      setGerado(await api.post(`/api/central/candidatos/${p.id}/acesso`, { permiteArquivo }));
      setLiberar(false);
      onMudou();
    } catch (e) {
      avisar(e instanceof ApiError ? e.message : 'Não foi possível liberar.', 'erro');
    } finally {
      setOcupado(false);
    }
  };
  const copiar = (t: string) => navigator.clipboard.writeText(t).then(() => avisar('Copiado.'), () => avisar('Não foi possível copiar.', 'erro'));

  return (
    <Secao titulo="Acesso ao portal">
      {ativo ? (
        <div className="space-y-1 text-sm">
          <p><Selo tom="verde">Liberado</Selo> <span className="ml-1">até {hora(ativo.expiraEm)} de hoje</span></p>
          <p className="text-suave">Liberado às {hora(ativo.liberadoEm)}{ativo.liberadaPor ? ` por ${ativo.liberadaPor}` : ativo.origem === 'automacao' ? ' pela automação' : ''}{ativo.permiteArquivo ? ' · pode enviar arquivos' : ''}</p>
          <p className="text-suave">{ativo.primeiroUsoEm ? `Entrou pela primeira vez às ${hora(ativo.primeiroUsoEm)}` : 'Ainda não entrou'}</p>
        </div>
      ) : <p className="text-sm text-suave">Sem acesso liberado hoje. O candidato não consegue entrar no portal.</p>}
      {pode && (
        <div className="mt-3 flex gap-2">
          <Botao variante="secundario" className="flex-1" icone={<KeyRound className="size-4" />} onClick={() => setLiberar(true)}>{ativo ? 'Gerar código novo' : 'Liberar acesso'}</Botao>
          {ativo && <Botao variante="fantasma" onClick={() => setRevogar(true)}>Revogar</Botao>}
        </div>
      )}
      {(p.portal.acessos.length > 0 || p.portal.liberacoes.length > 0) && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-semibold">Histórico de acesso</summary>
          <ul className="mt-2 space-y-2">
            {[
              ...p.portal.liberacoes.map((l) => ({ em: l.liberadoEm, texto: `Código liberado${l.liberadaPor ? ` por ${l.liberadaPor}` : l.origem === 'automacao' ? ' pela automação' : ''} · ${{ ativa: 'ativo', expirada: 'expirou', revogada: 'revogado' }[l.situacao]}` })),
              ...p.portal.acessos.map((a) => ({ em: a.em, texto: `${RESULTADO_ACESSO[a.resultado]}${a.dispositivo ? ` · ${a.dispositivo}` : ''}${a.ip ? ` · IP ${a.ip}` : ''}` })),
            ].sort((a, b) => b.em.localeCompare(a.em)).slice(0, 30).map((h, i) => (
              <li key={i} className="border-l-2 border-borda pl-3"><p>{h.texto}</p><p className="text-xs text-suave">{dataHora(h.em)}</p></li>
            ))}
          </ul>
        </details>
      )}

      <Modal aberto={liberar} onFechar={() => setLiberar(false)} titulo={ativo ? 'Gerar código novo?' : 'Liberar acesso ao portal?'} largura="max-w-md"
        rodape={<><Botao variante="secundario" onClick={() => setLiberar(false)}>Cancelar</Botao><Botao carregando={ocupado} onClick={() => void gerar()}>Gerar código</Botao></>}>
        <div className="space-y-4 text-sm">
          <p>O código vale até <strong>23h59 de hoje</strong> (horário de Brasília).{ativo && ' O código atual deixa de valer e quem estiver no portal sai.'}</p>
          <Interruptor ligado={permiteArquivo} onChange={setPermiteArquivo} rotulo="Permitir envio de arquivos" descricao="O candidato poderá mandar documentos pelo chat do portal." />
          <Aviso>Até a integração com o WhatsApp (etapa 7), envie o código ao candidato você mesma. Depois, o envio será automático.</Aviso>
        </div>
      </Modal>

      <Modal aberto={Boolean(gerado)} onFechar={() => setGerado(null)} titulo="Código gerado" largura="max-w-md" rodape={<Botao onClick={() => setGerado(null)}>Já enviei</Botao>}>
        {gerado && (
          <div className="space-y-4">
            <Aviso tipo="atencao">{gerado.aviso}</Aviso>
            <p className="rounded-2xl bg-grafite py-4 text-center font-mono text-3xl font-bold tracking-[0.25em] text-amarelo">{gerado.codigo}</p>
            <p className="text-sm text-suave">Válido até {hora(gerado.expiraEm)} de hoje.</p>
            <div className="rounded-2xl border border-borda p-3 text-sm">{gerado.mensagemSugerida}</div>
            <Botao variante="secundario" className="w-full" icone={<Copy className="size-4" />} onClick={() => void copiar(gerado.mensagemSugerida)}>Copiar mensagem</Botao>
          </div>
        )}
      </Modal>

      <Confirmar aberto={revogar} titulo="Revogar acesso?" perigo rotulo="Revogar" carregando={ocupado}
        texto="O código deixa de valer na hora e o candidato sai do portal. As mensagens continuam guardadas."
        onCancelar={() => setRevogar(false)}
        onConfirmar={async () => {
          setOcupado(true);
          try {
            await api.post(`/api/central/candidatos/${p.id}/acesso/revogar`);
            avisar('Acesso revogado.');
            setRevogar(false);
            onMudou();
          } catch (e) {
            avisar(e instanceof ApiError ? e.message : 'Não foi possível revogar.', 'erro');
          } finally {
            setOcupado(false);
          }
        }} />
    </Secao>
  );
}
