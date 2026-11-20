// Permissões do M14 (ficha, seção 7; convencoes.md §12): a consulta somente leitura de cada módulo
// (`<modulo>.consulta.ler` / `<modulo>.consulta.exportar`), com as opções do legado da área "Tabelas" do
// módulo de cada código da matriz (quem tem a opção no legado tem a permissão no novo); a consulta de
// conteúdo clínico, só para perfis clínicos e auditor (as opções que abrem o prontuário no PEP, como no M15,
// e a da auditoria); o índice das consultas (todos os perfis de pessoa) e o painel da matriz (administrador).
import { OPCOES_CONSULTA_POR_MODULO } from '../consultas/catalogo.js';
import { PERFIS_OPERADORA } from './operadora.js';
import { OPCAO_PEP_AUDITORIA, OPCOES_PEP_PRONTUARIO } from './pep.js';
import type { DeclaracaoPermissao } from './tipos.js';

const ADMIN = ['administrador-sistema'] as const;

export const PERMISSOES_CONSULTAS_M14: readonly DeclaracaoPermissao[] = [
  {
    codigo: 'config.consulta.ler',
    descricao: 'Ver o índice das consultas somente leitura (só as que a pessoa pode ler)',
    opcoesLegado: [],
    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
    categoria: 'administrativa',
  },
  {
    codigo: 'config.matriz.ler',
    descricao:
      'Ver o painel da matriz de cobertura (tabelas por código, destino, marco e estado; tabelas vazias)',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'tecnica',
  },
  ...Object.entries(OPCOES_CONSULTA_POR_MODULO).flatMap(([modulo, opcoes]): DeclaracaoPermissao[] => [
    {
      codigo: `${modulo}.consulta.ler`,
      descricao: `Consultar as tabelas do módulo ${modulo} (somente leitura, ao vivo)`,
      opcoesLegado: [...opcoes],
      // A auditoria (trilhas, exclusões, conexões) também é do papel Auditor (perfil complementar).
      ...(modulo === 'auditoria'
        ? { concessaoPorPerfil: 'por-perfil' as const, perfis: ['auditor', 'administrador-sistema'] }
        : // M56 (D-PERM-56): a opção da operadora não tem concessão; os catálogos dela vão aos perfis da operadora.
          modulo === 'operadora'
          ? { concessaoPorPerfil: 'por-perfil' as const, perfis: [...PERFIS_OPERADORA] }
          : { concessaoPorPerfil: null }),
      categoria: modulo === 'pep' ? 'clinica' : 'administrativa',
    },
    {
      codigo: `${modulo}.consulta.exportar`,
      descricao: `Exportar a consulta das tabelas do módulo ${modulo} (CSV, auditado)`,
      opcoesLegado: [...opcoes],
      ...(modulo === 'operadora'
        ? { concessaoPorPerfil: 'por-perfil' as const, perfis: ['operadora-gestor'] }
        : { concessaoPorPerfil: null }),
      categoria: modulo === 'pep' ? 'clinica' : 'administrativa',
      criticidade: 'sensivel',
    },
  ]),
  {
    codigo: 'pep.consultaClinica.ler',
    descricao:
      'Consultar as tabelas de conteúdo clínico (rascunhos, checagem, assinaturas de documento); a leitura vai à trilha',
    opcoesLegado: [...OPCOES_PEP_PRONTUARIO, OPCAO_PEP_AUDITORIA],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['auditor'],
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'pep.consultaClinica.exportar',
    descricao: 'Exportar a consulta de conteúdo clínico (com justificativa; auditado)',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['auditor'],
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
];
