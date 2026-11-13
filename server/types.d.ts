import type { Permissao } from '../shared/permissoes.ts';

export interface UsuarioContexto {
  id: string;
  nome: string;
  email: string;
  perfilId: string;
  perfilChave: string;
  perfilNome: string;
  setor: string | null;
  permissoes: Set<Permissao>;
  todasUnidades: boolean;
  unidades: string[];
  desenvolvedor: boolean;
  adminInicial: boolean;
  deveTrocarSenha: boolean;
  temPin: boolean;
}

export interface SessaoContexto {
  id: string;
  dispositivoId: string | null;
  bloqueada: boolean;
  reautenticadaEm: Date | null;
  modoConfiguracao: boolean;
  expiraEm: Date;
}

declare global {
  namespace Express {
    interface Request {
      usuario?: UsuarioContexto;
      sessao?: SessaoContexto;
      chaveApi?: { id: string; nome: string; escopos: string[] };
    }
  }
}
