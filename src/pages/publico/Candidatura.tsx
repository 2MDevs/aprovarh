import { CheckCircle2, FileText, ImagePlus, Loader2, Send, Upload } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { LogoHummm } from '../../components/Marca';
import { Aviso, Botao, Campo, Modal } from '../../components/ui';

interface Formulario {
  aberto: boolean;
  mensagem: string | null;
  unidades: { id: string; nome: string }[];
  aviso: { texto: string; versao: string; contato: string | null } | null;
  limites: { curriculoMb: number; fotoMb: number; curriculo: string[]; foto: string[] };
}

/** Máscaras só de exibição; o servidor valida e normaliza de novo. */
const mascaraCpf = (v: string) => v.replace(/\D/g, '').slice(0, 11)
  .replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
const mascaraTelefone = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

export function Candidatura() {
  const [form, setForm] = useState<Formulario | null>(null);
  const [erroCarga, setErroCarga] = useState(false);
  const [enviado, setEnviado] = useState(false);

  useEffect(() => {
    fetch('/api/publico/formulario').then((r) => (r.ok ? r.json() : Promise.reject())).then(setForm).catch(() => setErroCarga(true));
  }, []);

  return (
    <div className="min-h-dvh bg-fundo">
      <header className="bg-grafite px-5 pb-6 pt-[max(1.5rem,env(safe-area-inset-top))] text-creme">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 text-center">
          <LogoHummm fundo="escuro" className="h-12" />
          <h1 className="text-2xl font-bold sm:text-3xl">Trabalhe com a gente</h1>
          <p className="text-[15px] text-creme/75">Preencha seus dados e envie seu currículo. Leva poucos minutos.</p>
        </div>
      </header>
      <div className="faixa-marca h-1.5" aria-hidden />
      <main className="mx-auto max-w-2xl px-5 py-8 pb-[max(2rem,env(safe-area-inset-bottom))]">
        {erroCarga ? (
          <Aviso tipo="erro">Não foi possível abrir o formulário. Confira sua internet e recarregue a página.</Aviso>
        ) : !form ? (
          <p className="flex items-center justify-center gap-2 py-16 text-suave"><Loader2 className="size-5 animate-spin" /> Carregando...</p>
        ) : enviado ? (
          <Confirmacao />
        ) : !form.aberto ? (
          <Aviso tipo="atencao">{form.mensagem}</Aviso>
        ) : (
          <FormularioCandidatura form={form} onEnviado={() => setEnviado(true)} />
        )}
      </main>
    </div>
  );
}

/** Mensagem pedida no prompt geral (seção 3). Não dá acesso ao portal. */
function Confirmacao() {
  useEffect(() => window.scrollTo({ top: 0 }), []);
  return (
    <div className="cartao p-6 text-center sm:p-10" role="status">
      <CheckCircle2 className="mx-auto size-14 text-verde" aria-hidden />
      <h2 className="mt-4 text-2xl font-bold">Sua candidatura foi enviada com sucesso!</h2>
      <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-suave">
        Nossa equipe de RH analisará seu cadastro. Caso seu perfil avance no processo seletivo, entraremos em contato pelo WhatsApp para informar os próximos passos.
      </p>
      <p className="mt-4 font-semibold">Agradecemos seu interesse em fazer parte da Hummm! Pizzas.</p>
    </div>
  );
}

function FormularioCandidatura({ form, onEnviado }: { form: Formulario; onEnviado: () => void }) {
  const [nome, setNome] = useState('');
  const [sobrenome, setSobrenome] = useState('');
  const [cpf, setCpf] = useState('');
  const [telefone, setTelefone] = useState('');
  // Link da loja (?unidade=<id>) já chega com a unidade escolhida.
  const pedida = new URLSearchParams(window.location.search).get('unidade');
  const [unidadeId, setUnidadeId] = useState(form.unidades.find((u) => u.id === pedida)?.id ?? (form.unidades.length === 1 ? form.unidades[0].id : ''));
  const [curriculo, setCurriculo] = useState<File | null>(null);
  const [foto, setFoto] = useState<File | null>(null);
  const [aceite, setAceite] = useState(false);
  const [verAviso, setVerAviso] = useState(false);
  const [site, setSite] = useState(''); // campo-armadilha
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const topo = useRef<HTMLDivElement>(null);
  const idUnidade = useId();

  const pronto = nome.trim().length >= 2 && sobrenome.trim().length >= 2 && cpf.replace(/\D/g, '').length === 11
    && telefone.replace(/\D/g, '').length >= 10 && unidadeId && curriculo && foto && aceite;

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro('');
    if (curriculo && curriculo.size > form.limites.curriculoMb * 1024 * 1024) return mostrarErro(`O currículo pode ter no máximo ${form.limites.curriculoMb} MB.`);
    if (foto && foto.size > form.limites.fotoMb * 1024 * 1024) return mostrarErro(`A foto pode ter no máximo ${form.limites.fotoMb} MB.`);
    const dados = new FormData();
    // Campos de texto antes dos arquivos (o servidor lê nessa ordem).
    dados.set('nome', nome);
    dados.set('sobrenome', sobrenome);
    dados.set('cpf', cpf);
    dados.set('telefone', telefone);
    dados.set('unidadeId', unidadeId);
    dados.set('aceite', String(aceite));
    dados.set('avisoVersao', form.aviso!.versao);
    if (site) dados.set('site', site);
    dados.set('curriculo', curriculo!);
    dados.set('foto', foto!);
    setEnviando(true);
    try {
      const r = await fetch('/api/publico/candidaturas', { method: 'POST', body: dados });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        return mostrarErro(j?.erro || 'Não foi possível enviar. Tente de novo.');
      }
      onEnviado();
    } catch {
      mostrarErro('Sem conexão. Confira sua internet e tente de novo.');
    } finally {
      setEnviando(false);
    }
  };

  function mostrarErro(m: string) {
    setErro(m);
    topo.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return (
    <form onSubmit={enviar} className="space-y-6" noValidate>
      <div ref={topo}>{erro && <Aviso tipo="erro">{erro}</Aviso>}</div>

      <section className="cartao space-y-4 p-5 sm:p-6">
        <h2 className="text-lg font-semibold">Seus dados</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Nome" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="given-name" maxLength={80} required />
          <Campo rotulo="Sobrenome" value={sobrenome} onChange={(e) => setSobrenome(e.target.value)} autoComplete="family-name" maxLength={120} required />
          <Campo rotulo="CPF" value={cpf} onChange={(e) => setCpf(mascaraCpf(e.target.value))} inputMode="numeric" placeholder="000.000.000-00" required />
          <Campo rotulo="Telefone com DDD (WhatsApp)" value={telefone} onChange={(e) => setTelefone(mascaraTelefone(e.target.value))} inputMode="tel" autoComplete="tel-national" placeholder="(11) 91234-5678" required />
        </div>
        <div>
          <label htmlFor={idUnidade} className="rotulo">Unidade pretendida</label>
          <select id={idUnidade} className="campo" value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)} required>
            <option value="" disabled>Escolha a unidade</option>
            {form.unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </div>
        {/* Campo-armadilha: invisível para pessoas, robôs costumam preencher */}
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>Site <input tabIndex={-1} autoComplete="off" value={site} onChange={(e) => setSite(e.target.value)} name="site" /></label>
        </div>
      </section>

      <section className="cartao space-y-4 p-5 sm:p-6">
        <h2 className="text-lg font-semibold">Documentos</h2>
        <EscolherArquivo rotulo="Currículo" dica={`${form.limites.curriculo.join(', ')} · até ${form.limites.curriculoMb} MB`}
          accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          arquivo={curriculo} onEscolher={setCurriculo} icone={<FileText className="size-6" />} />
        <EscolherArquivo rotulo="Foto 3x4" dica={`${form.limites.foto.join(' ou ')} · até ${form.limites.fotoMb} MB · rosto de frente, fundo claro`}
          accept="image/jpeg,image/png" arquivo={foto} onEscolher={setFoto} icone={<ImagePlus className="size-6" />} imagem />
      </section>

      <section className="cartao p-5 sm:p-6">
        <label className="flex cursor-pointer gap-3">
          <input type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[#1D1D1B] dark:accent-[#F6D35C]" />
          <span className="text-[15px]">
            Li e concordo com o{' '}
            <button type="button" className="font-semibold underline" onClick={() => setVerAviso(true)}>aviso de privacidade</button>
            , que explica como a Hummm! Pizzas usa meus dados neste processo seletivo.
          </span>
        </label>
      </section>

      <Botao type="submit" className="w-full sm:w-auto" carregando={enviando} disabled={!pronto} icone={<Send className="size-4" />}>
        {enviando ? 'Enviando...' : 'Enviar candidatura'}
      </Botao>

      <Modal aberto={verAviso} onFechar={() => setVerAviso(false)} titulo="Aviso de privacidade" largura="max-w-2xl"
        rodape={<Botao onClick={() => { setAceite(true); setVerAviso(false); }}>Li e concordo</Botao>}>
        <div className="whitespace-pre-line text-[15px] leading-relaxed">{form.aviso!.texto}</div>
        {form.aviso!.contato && <p className="mt-4 text-sm text-suave">Dúvidas sobre seus dados: {form.aviso!.contato}</p>}
      </Modal>
    </form>
  );
}

function EscolherArquivo({ rotulo, dica, accept, arquivo, onEscolher, icone, imagem }: {
  rotulo: string; dica: string; accept: string; arquivo: File | null; onEscolher: (f: File | null) => void; icone: ReactNode; imagem?: boolean;
}) {
  const id = useId();
  const [previa, setPrevia] = useState<string | null>(null);
  useEffect(() => {
    if (!imagem || !arquivo) return setPrevia(null);
    const url = URL.createObjectURL(arquivo);
    setPrevia(url);
    return () => URL.revokeObjectURL(url);
  }, [arquivo, imagem]);

  return (
    <div>
      <span className="rotulo">{rotulo}</span>
      <label htmlFor={id} className="flex min-h-20 cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed border-borda bg-superficie-2 px-4 py-3 transition hover:border-amarelo-forte focus-within:border-amarelo-forte">
        {previa ? (
          <img src={previa} alt="Prévia da foto" className="size-16 rounded-xl object-cover" />
        ) : (
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-creme text-grafite dark:bg-amarelo/15 dark:text-amarelo">{arquivo ? icone : <Upload className="size-6" />}</span>
        )}
        <span className="min-w-0">
          <span className="block truncate font-semibold">{arquivo ? arquivo.name : `Escolher ${rotulo.toLowerCase()}`}</span>
          <span className="block text-[13px] text-suave">{arquivo ? 'Toque para trocar' : dica}</span>
        </span>
        <input id={id} type="file" accept={accept} className="sr-only" onChange={(e) => onEscolher(e.target.files?.[0] ?? null)} />
      </label>
    </div>
  );
}
