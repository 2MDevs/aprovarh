import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout, useMenu } from './app/Layout';
import { SessaoProvider, useSessao } from './app/sessao';
import { Carregando, ToastProvider } from './components/ui';
import { Login } from './pages/acesso/Login';
import { Candidatura } from './pages/publico/Candidatura';
import { Acesso } from './pages/portal/Acesso';
import { Portal } from './pages/portal/Portal';
import { Candidatos } from './pages/central/Candidatos';
import { Configuracoes } from './pages/central/Configuracoes';
import { Conversas } from './pages/central/Conversas';
import { Entrevistas } from './pages/entrevistas/Entrevistas';
import { DefinirSenha, TelaBloqueada, TrocarSenhaObrigatoria } from './pages/acesso/Senhas';
import { Administracao } from './pages/administracao/Administracao';
import { Auditoria } from './pages/auditoria/Auditoria';
import { Conta } from './pages/conta/Conta';
import { Dispositivos } from './pages/dispositivos/Dispositivos';
import { Integracao } from './pages/integracao/Integracao';
import { Sistema } from './pages/sistema/Sistema';

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <SessaoProvider>
          <Rotas />
        </SessaoProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

function Rotas() {
  const { sessao } = useSessao();
  const menu = useMenu();
  const local = useLocation();

  // Página pública do candidato: abre igual para todos, logado ou não.
  if (local.pathname === '/candidatura') return <Candidatura />;
  // Portal do candidato: área separada, com sessão própria (código do dia).
  if (local.pathname === '/acesso') return <Acesso />;
  if (local.pathname === '/portal') return <Portal />;

  if (!sessao) return <Carregando texto="Abrindo o aprovaRH..." />;

  if (!sessao.logado) {
    return (
      <Routes>
        <Route path="/definir-senha" element={<DefinirSenha />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  if (sessao.deveTrocarSenha) return <TrocarSenhaObrigatoria />;

  const inicio = menu[0]?.rota ?? '/conta';
  return (
    <>
      {sessao.bloqueada && <TelaBloqueada />}
      <Routes>
        <Route path="/definir-senha" element={<DefinirSenha />} />
        <Route element={<Layout />}>
          <Route index element={<Navigate to={inicio} replace />} />
          <Route path="/conversas" element={<Conversas />} />
          <Route path="/candidatos" element={<Candidatos />} />
          <Route path="/entrevistas" element={<Entrevistas />} />
          <Route path="/configuracoes" element={<Configuracoes />} />
          <Route path="/administracao" element={<Administracao />} />
          <Route path="/dispositivos" element={<Dispositivos />} />
          <Route path="/auditoria" element={<Auditoria />} />
          <Route path="/sistema" element={<Sistema />} />
          <Route path="/integracao" element={<Integracao />} />
          <Route path="/conta" element={<Conta />} />
          <Route path="*" element={<Navigate to={inicio} replace />} />
        </Route>
      </Routes>
    </>
  );
}
