// Permissões do M52, fatia F5 (ficha, seção 7, telas do SESMT; convencoes.md §12): prontuário ocupacional e ASO,
// acidentes e CAT, riscos e EPI, vacinação do colaborador. Quem tem a opção no outro sistema tem a permissão no novo
// (regra 1 do M06). Opções da árvore do menu de origem (conector/mapa/permissoes.tsv), módulo "Segurança do trabalho" (554, 582):
//   - Lançamentos 567 › CAT 569, Risco - Seção 570, Funcionário 571 (Exame 572, EPI 573);
//   - Tabelas 555 › PPRA 557 (Grupos de risco 558, Riscos 559, Tipo de exposição 560), Exames 566, Tipo de exames 565;
//   - Relatórios 574 › CAT 576, ASO 577, PPP 578.
// Regra 16 (segregação): o prontuário ocupacional é dado de saúde do colaborador; nenhuma permissão do PEP o abre e as
// daqui não abrem o PEP. Decisão D-PERM-525 (POL-5): a vacinação usa Funcionário › Exame (572), como o ASO, porque o
// outro sistema não tem opção própria, com o código `pessoas.vacinacao.*` (a ficha diz `pessoas.vacina.*`, mas
// `pessoas.vacina.ler` já é a permissão do domínio de vacinas do CRUD genérico do M14); o mapa de riscos edita pelas
// tabelas do PPRA e pelo risco da seção.
import type { DeclaracaoPermissao } from './tipos.js';

const p = (
  codigo: string,
  descricao: string,

  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,

  concessaoPorPerfil: null,
  categoria: 'administrativa',
  criticidade: 'sensivel',
  escopos: [],
  ...extra,
});

export const PERMISSOES_PESSOAS_M52_F5: readonly DeclaracaoPermissao[] = [
  p(
    'pessoas.ocupacional.ler',
    'Consultar o prontuário ocupacional (ASO, exames do PCMSO) e o painel de pendências do SESMT (dado de saúde, leitura auditada)',
  ),
  p('pessoas.ocupacional.registrar', 'Registrar e retificar o ASO e os exames do PCMSO'),
  p('pessoas.acidente.ler', 'Consultar os acidentes de trabalho, a profilaxia, a sorologia e a CAT'),
  p(
    'pessoas.acidente.registrar',
    'Registrar o acidente de trabalho, a profilaxia, a sorologia, a emissão da CAT e o encerramento; retificar e anular o acidente e a CAT com motivo (W0-06)',
  ),
  p(
    'pessoas.risco.ler',
    'Consultar o mapa de riscos e o EPI por função, as entregas de EPI, a dosimetria e o PPP',

    { criticidade: 'normal' },
  ),
  p(
    'pessoas.risco.editar',
    'Editar o mapa de riscos e o EPI exigido por função',

    { criticidade: 'normal' },
  ),
  p(
    'pessoas.epi.entregar',
    'Registrar a entrega de EPI e a assinatura, a leitura do dosímetro e a exposição a quimioterápico; cancelar com motivo (W0-06)',
  ),
  p(
    'pessoas.vacinacao.ler',
    'Consultar a vacinação do colaborador e o anti-HBs (dado de saúde, leitura auditada)',
  ),
  p('pessoas.vacinacao.registrar', 'Registrar e retificar a dose de vacina e o anti-HBs do colaborador'),
];
