import { normalizarTelefone } from '../../lib/documentos.ts';

/**
 * Leitura dos webhooks dos dois provedores (Meta e Evolution) para um formato único.
 * Sem banco e sem rede: testável isoladamente.
 */
export type EventoEntrada =
  | { tipo: 'mensagem'; id: string; de: string | null; lid?: string | null; nome: string | null; texto: string; em: string }
  | { tipo: 'status'; id: string; situacao: 'enviada' | 'entregue' | 'lida' | 'falhou'; em: string; erro?: string | null; lid?: string | null };

/** "5511912345678@s.whatsapp.net" ou "5511912345678" → "+5511912345678". Corrige celular antigo sem o 9. */
export function telefoneDoWhatsapp(bruto: string | undefined | null): string | null {
  const d = String(bruto ?? '').split('@')[0].replace(/\D/g, '');
  if (!d) return null;
  const direto = normalizarTelefone(d);
  if (direto) return direto;
  // Alguns números brasileiros chegam sem o nono dígito (55 + DDD + 8 dígitos começando com 6 a 9).
  const m = d.match(/^55(\d{2})([6-9]\d{7})$/);
  return m ? normalizarTelefone(`55${m[1]}9${m[2]}`) : null;
}

const iso = (segundos: unknown) => new Date((Number(segundos) || Date.now() / 1000) * 1000).toISOString();

// ── Meta (Cloud API) ───────────────────────────────────────────────────────
interface MetaValor {
  contacts?: { wa_id: string; profile?: { name?: string } }[];
  messages?: { from: string; id: string; timestamp: string; type: string; text?: { body: string }; button?: { text: string }; interactive?: { button_reply?: { title: string }; list_reply?: { title: string } }; image?: { caption?: string }; document?: { filename?: string; caption?: string } }[];
  statuses?: { id: string; status: string; timestamp: string; errors?: { title?: string; message?: string }[] }[];
}

export function eventosMeta(corpo: { entry?: { changes?: { field?: string; value?: MetaValor }[] }[] }): EventoEntrada[] {
  const out: EventoEntrada[] = [];
  for (const entry of corpo.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      const v = ch.value;
      if (!v) continue;
      for (const m of v.messages ?? []) {
        const de = telefoneDoWhatsapp(m.from);
        if (!de) continue;
        const texto = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title
          ?? (m.type === 'image' ? `[Imagem recebida pelo WhatsApp]${m.image?.caption ? ` ${m.image.caption}` : ''}` : null)
          ?? (m.type === 'document' ? `[Documento recebido pelo WhatsApp: ${m.document?.filename ?? 'arquivo'}]` : null)
          ?? `[Mensagem do tipo "${m.type}" recebida pelo WhatsApp]`;
        out.push({ tipo: 'mensagem', id: m.id, de, nome: v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? null, texto, em: iso(m.timestamp) });
      }
      for (const s of v.statuses ?? []) {
        const situacao = ({ sent: 'enviada', delivered: 'entregue', read: 'lida', failed: 'falhou' } as const)[s.status as 'sent'];
        if (situacao) out.push({ tipo: 'status', id: s.id, situacao, em: iso(s.timestamp), erro: s.errors?.[0]?.message ?? s.errors?.[0]?.title ?? null });
      }
    }
  }
  return out;
}

// ── Evolution API ──────────────────────────────────────────────────────────
interface EvoMensagem {
  key?: { remoteJid?: string; remoteJidAlt?: string; senderPn?: string; participantPn?: string; participantAlt?: string; senderLid?: string; fromMe?: boolean; id?: string };
  senderPn?: string; remoteJidAlt?: string;
  pushName?: string;
  message?: {
    conversation?: string; extendedTextMessage?: { text?: string }; buttonsResponseMessage?: { selectedDisplayText?: string };
    listResponseMessage?: { title?: string }; imageMessage?: { caption?: string }; documentMessage?: { fileName?: string };
    [k: string]: unknown;
  };
  messageTimestamp?: number | string;
}
interface EvoStatus { keyId?: string; key?: { id?: string; fromMe?: boolean; remoteJid?: string }; remoteJid?: string; status?: string; fromMe?: boolean }

const ehLid = (j: string | undefined | null): j is string => Boolean(j && j.endsWith('@lid'));

export function eventosEvolution(corpo: { event?: string; data?: unknown }): EventoEntrada[] {
  const evento = String(corpo.event ?? '').toLowerCase().replace(/_/g, '.');
  const lista = Array.isArray(corpo.data) ? corpo.data : corpo.data ? [corpo.data] : [];
  const out: EventoEntrada[] = [];
  if (evento === 'messages.upsert') {
    for (const m of lista as EvoMensagem[]) {
      const k = m.key ?? {};
      if (k.fromMe || !k.id) continue; // eco das mensagens enviadas por nós
      const jid = k.remoteJid ?? '';
      if (jid.endsWith('@g.us') || jid.endsWith('@broadcast')) continue; // grupos e listas não entram
      // Contas novas chegam como "@lid" (um código, não o telefone). O telefone, quando vem, está num destes campos.
      const candidatos = [ehLid(jid) ? null : jid, k.remoteJidAlt, k.senderPn, m.remoteJidAlt, m.senderPn, k.participantPn, k.participantAlt].filter((x) => x && !ehLid(x));
      let de: string | null = null;
      for (const c of candidatos) { de = telefoneDoWhatsapp(c); if (de) break; }
      const lid = ehLid(jid) ? jid : ehLid(k.senderLid) ? k.senderLid : null;
      if (!de && !lid) continue;
      const msg = m.message ?? {};
      const texto = msg.conversation ?? msg.extendedTextMessage?.text ?? msg.buttonsResponseMessage?.selectedDisplayText ?? msg.listResponseMessage?.title
        ?? (msg.imageMessage ? `[Imagem recebida pelo WhatsApp]${msg.imageMessage.caption ? ` ${msg.imageMessage.caption}` : ''}` : null)
        ?? (msg.documentMessage ? `[Documento recebido pelo WhatsApp: ${msg.documentMessage.fileName ?? 'arquivo'}]` : null)
        ?? '[Mensagem recebida pelo WhatsApp]';
      out.push({ tipo: 'mensagem', id: k.id, de, lid, nome: m.pushName ?? null, texto, em: iso(m.messageTimestamp) });
    }
  } else if (evento === 'messages.update') {
    for (const s of lista as EvoStatus[]) {
      const id = s.keyId ?? s.key?.id;
      const situacao = ({ SERVER_ACK: 'enviada', DELIVERY_ACK: 'entregue', READ: 'lida', PLAYED: 'lida', ERROR: 'falhou' } as const)[String(s.status) as 'READ'];
      const jid = s.remoteJid ?? s.key?.remoteJid;
      if (id && situacao) out.push({ tipo: 'status', id, situacao, em: new Date().toISOString(), lid: ehLid(jid) ? jid : null });
    }
  }
  return out;
}

