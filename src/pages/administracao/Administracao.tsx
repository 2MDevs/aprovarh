import { Building2, ShieldCheck, Users } from 'lucide-react';
import type { ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSessao } from '../../app/sessao';
import { Abas, Cabecalho, SemPermissao } from '../../components/ui';
import { Perfis } from './Perfis';
import { Unidades } from './Unidades';
import { Usuarios } from './Usuarios';

type Aba = 'usuarios' | 'unidades' | 'perfis';

export function Administracao() {
  const { pode } = useSessao();
  const [params, setParams] = useSearchParams();
  const abas = [
    pode('usuarios.gerenciar') && { id: 'usuarios' as const, rotulo: 'Usuários', icone: <Users className="size-4" /> },
    pode('unidades.gerenciar') && { id: 'unidades' as const, rotulo: 'Unidades', icone: <Building2 className="size-4" /> },
    pode('usuarios.gerenciar') && { id: 'perfis' as const, rotulo: 'Perfis e permissões', icone: <ShieldCheck className="size-4" /> },
  ].filter(Boolean) as { id: Aba; rotulo: string; icone: ReactElement }[];

  if (!abas.length) return <SemPermissao />;
  const pedida = params.get('aba') as Aba | null;
  const ativa = abas.find((a) => a.id === pedida)?.id ?? abas[0].id;

  return (
    <>
      <Cabecalho titulo="Usuários e unidades" descricao="Quem acessa o aprovaRH, com qual perfil e em quais unidades (lojas)." />
      <Abas abas={abas} ativa={ativa} onChange={(id) => setParams({ aba: id }, { replace: true })} />
      {ativa === 'usuarios' && <Usuarios />}
      {ativa === 'unidades' && <Unidades />}
      {ativa === 'perfis' && <Perfis />}
    </>
  );
}
