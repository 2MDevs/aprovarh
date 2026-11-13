import nodemailer from 'nodemailer';
import { cfg, cfgBooleano, cfgNumero } from './settings.ts';

/** O SMTP está configurado? Enquanto não estiver, vale o "modo de configuração inicial". */
export async function smtpConfigurado(): Promise<boolean> {
  const [host, remetente] = await Promise.all([cfg('smtp.host'), cfg('smtp.remetente')]);
  return Boolean(host && remetente);
}

async function transporte() {
  const [host, porta, seguro, usuario, senha] = await Promise.all([
    cfg('smtp.host'),
    cfgNumero('smtp.porta'),
    cfgBooleano('smtp.seguro'),
    cfg('smtp.usuario'),
    cfg('smtp.senha'),
  ]);
  if (!host) throw new Error('O e-mail (SMTP) ainda não foi configurado.');
  return nodemailer.createTransport({
    host,
    port: porta,
    secure: seguro,
    auth: usuario ? { user: usuario, pass: senha ?? '' } : undefined,
    connectionTimeout: 15_000,
  });
}

/** Moldura simples nas cores da Hummm! Pizzas. */
function html(titulo: string, corpo: string): string {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#FDF8CF;font-family:Poppins,Arial,sans-serif;color:#1D1D1B">
  <div style="max-width:520px;margin:24px auto;background:#fff;border-radius:16px;overflow:hidden">
    <div style="background:#1D1D1B;padding:20px 24px;color:#F6D35C;font-size:20px;font-weight:700">aprovaRH</div>
    <div style="height:4px;background:linear-gradient(90deg,#EA3324,#F6D35C)"></div>
    <div style="padding:24px"><h1 style="font-size:18px;margin:0 0 12px">${titulo}</h1>${corpo}</div>
    <div style="padding:16px 24px;font-size:12px;color:#666;border-top:1px solid #eee">Hummm! Pizzas · TI - Tecnologia da Informação. Mensagem automática, não responda.</div>
  </div></body></html>`;
}

const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function enviarEmail(para: string, assunto: string, titulo: string, corpoHtml: string, texto: string) {
  const t = await transporte();
  const remetente = await cfg('smtp.remetente');
  await t.sendMail({ from: remetente ?? undefined, to: para, subject: assunto, html: html(titulo, corpoHtml), text: texto });
}

export async function enviarCodigo2FA(para: string, nome: string, codigo: string) {
  await enviarEmail(
    para,
    `${codigo} é o seu código de acesso ao aprovaRH`,
    'Código de verificação',
    `<p>Olá, ${escapar(nome)}.</p><p>Use o código abaixo para entrar no aprovaRH. Ele vale por 10 minutos.</p>
     <p style="font-size:32px;letter-spacing:8px;font-weight:700;background:#FDF8CF;padding:12px 16px;border-radius:12px;text-align:center">${codigo}</p>
     <p style="font-size:13px;color:#666">Se não foi você que tentou entrar, troque sua senha e avise a TI.</p>`,
    `Seu código de acesso ao aprovaRH é ${codigo}. Ele vale por 10 minutos.`,
  );
}

export async function enviarLinkSenha(para: string, nome: string, link: string, primeiroAcesso: boolean) {
  const titulo = primeiroAcesso ? 'Crie sua senha' : 'Redefinição de senha';
  await enviarEmail(
    para,
    primeiroAcesso ? 'Seu acesso ao aprovaRH' : 'Redefinir sua senha do aprovaRH',
    titulo,
    `<p>Olá, ${escapar(nome)}.</p><p>${primeiroAcesso ? 'Seu acesso ao aprovaRH foi criado.' : 'Recebemos um pedido para redefinir sua senha.'} Clique no botão para definir a senha. O link vale por 60 minutos e só pode ser usado uma vez.</p>
     <p><a href="${escapar(link)}" style="display:inline-block;background:#F6D35C;color:#1D1D1B;font-weight:700;padding:12px 20px;border-radius:999px;text-decoration:none">Definir senha</a></p>
     <p style="font-size:13px;color:#666">Se você não pediu, ignore este e-mail.</p>`,
    `${titulo}: ${link} (vale por 60 minutos).`,
  );
}

export async function testarSmtp(para: string) {
  const t = await transporte();
  await t.verify();
  await enviarEmail(para, 'Teste de e-mail do aprovaRH', 'E-mail configurado', '<p>Se você recebeu esta mensagem, o envio de e-mails do aprovaRH está funcionando.</p>', 'O envio de e-mails do aprovaRH está funcionando.');
}
