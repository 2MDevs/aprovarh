import { exportarCodigo, lerCodigo, montarPedidoParaIA } from '@shared/automacoesCodigo';
import type { Fluxo } from '@shared/automacoes';
import { Bot, ClipboardCopy, Code2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { Aviso, Botao, Modal, useAviso } from '../../components/ui';
import type { Opcoes } from './tipos';

/**
 * "Código" do construtor (decisão D46):
 * 1. Descreva o que quer e copie o pedido pronto para a IA (vai com o catálogo de cards e as regras).
 * 2. Cole o código que a IA devolveu e aplique: o fluxo aparece no construtor (dá para desfazer).
 * Só usa cards que já existem. Um card novo precisa ser programado pela TI.
 */
export function ModalCodigo({ fluxo, nome, opcoes, podeEditar, onAplicar, onFechar }: {
  fluxo: Fluxo; nome: string; opcoes: Opcoes; podeEditar: boolean; onAplicar: (f: Fluxo) => void; onFechar: () => void;
}) {
  const avisar = useAviso();
  const [pedido, setPedido] = useState('');
  const [codigo, setCodigo] = useState('');
  const [erros, setErros] = useState<string[]>([]);
  const [faltando, setFaltando] = useState<string[]>([]);

  const copiar = (texto: string, ok: string) =>
    navigator.clipboard.writeText(texto).then(() => avisar(ok), () => avisar('Não foi possível copiar. Selecione e copie à mão.', 'erro'));

  const aplicar = () => {
    const r = lerCodigo(codigo);
    if (!r.ok) {
      setErros(r.erros);
      setFaltando(r.faltando ?? []);
      return;
    }
    setErros([]);
    setFaltando([]);
    onAplicar(r.fluxo);
    avisar(`Código aplicado: ${r.fluxo.nos.length} card(s). Confira e salve o rascunho.`);
    onFechar();
  };

  return (
    <Modal aberto onFechar={onFechar} largura="max-w-3xl" titulo="Código da automação"
      descricao="Peça o fluxo para uma IA e cole o código aqui. Só vale para cards que já existem no aprovaRH."
      selo={<span className="grid size-11 place-items-center rounded-2xl bg-grafite text-amarelo"><Code2 className="size-5" /></span>}
      rodape={<><Botao variante="secundario" onClick={onFechar}>Fechar</Botao>
        {podeEditar && <Botao icone={<Wand2 className="size-4" />} disabled={!codigo.trim()} onClick={aplicar}>Aplicar no construtor</Botao>}</>}>
      <div className="space-y-6">
        <section>
          <h3 className="font-semibold">1. Peça para a IA</h3>
          <p className="mt-1 text-[13px] text-suave">Descreva a automação. O pedido copiado já leva todos os gatilhos, condições e ações, os status, tags e unidades e o fluxo atual.</p>
          <textarea value={pedido} onChange={(e) => setPedido(e.target.value)} rows={4} maxLength={4000}
            placeholder="Ex.: quando a candidatura chegar, se o candidato já mandou mensagem, confirmar; se não, esperar 10 minutos..."
            className="campo mt-3 w-full resize-y" aria-label="O que a automação deve fazer" />
          <div className="mt-2 flex flex-wrap gap-2">
            <Botao variante="secundario" icone={<Bot className="size-4" />}
              onClick={() => void copiar(montarPedidoParaIA(pedido, opcoes, fluxo), 'Pedido copiado. Cole na IA e traga o código de volta.')}>
              Copiar pedido para a IA
            </Botao>
            <Botao variante="fantasma" icone={<ClipboardCopy className="size-4" />} disabled={!fluxo.nos.length}
              onClick={() => void copiar(exportarCodigo(fluxo, nome), 'Código desta automação copiado.')}>
              Copiar código atual
            </Botao>
          </div>
        </section>

        {podeEditar && (
          <section>
            <h3 className="font-semibold">2. Cole o código que a IA devolveu</h3>
            <p className="mt-1 text-[13px] text-suave">O fluxo atual é trocado pelo do código. Se não gostar, use Desfazer. Nada vale antes de salvar e publicar.</p>
            <textarea value={codigo} onChange={(e) => { setCodigo(e.target.value); setErros([]); setFaltando([]); }} rows={10} spellCheck={false}
              placeholder='{ "nome": "...", "nos": [ ... ], "ligacoes": [ ... ] }'
              className="campo mt-3 w-full resize-y font-mono text-[13px]" aria-label="Código da automação" />
            {erros.length > 0 && (
              <div className="mt-3">
                <Aviso tipo="erro">
                  <p className="font-semibold">O código não foi aplicado:</p>
                  <ul className="mt-1 list-disc pl-5">{erros.map((e) => <li key={e}>{e}</li>)}</ul>
                  {faltando.length > 0 && (
                    <>
                      <p className="mt-2 font-semibold">Cards que a IA disse que faltam:</p>
                      <ul className="mt-1 list-disc pl-5">{faltando.map((e) => <li key={e}>{e}</li>)}</ul>
                    </>
                  )}
                </Aviso>
              </div>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}
