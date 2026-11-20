// Domínios do CRUD genérico do módulo `auditoria` (W0-01: um arquivo por prefixo; o agregador DOMINIOS_DECLARADOS, em
// ../catalogo.ts, já importa todos, inclusive os vazios). Domínio novo do módulo entra aqui; auxiliares em
// ../ajudantes.ts. Regras da obra: docs/operacoes/README.md.
import {
  CIE,
  GERAL_A_L,
  LER,
  M10,
  PRIVACIDADE,
  SISTEMA_M10,
  inferida,
  propria,
  todas,
} from '../ajudantes.js';
import type { DominioPublico } from '../tipos.js';

export const DOMINIOS_AUDITORIA: readonly DominioPublico[] = [
  inferida(
    {
      modulo: 'auditoria',
      recurso: 'justificativaExportacao',
      rotulo: { singular: 'Justificativa de exportação', plural: 'Justificativas de exportação' },
      subitem: 'hotelaria',
      natureza: 'editavel',
      acoes: CIE,
    },
    GERAL_A_L,
  ),
  ...(
    [
      ['motivoAnonimizacao', 'Motivo de anonimização', 'Motivos de anonimização'],
      ['situacaoTermo', 'Situação de termo de consentimento', 'Situações de termo de consentimento'],
      ['tipoTermoConsentimento', 'Tipo de termo de consentimento', 'Tipos de termo de consentimento'],
      [
        'funcaoResponsavel',
        'Função do responsável pela anonimização',
        'Funções do responsável pela anonimização',
      ],
      ['tipoRepresentante', 'Tipo de representante do titular', 'Tipos de representante do titular'],
    ] as const
  ).map(([recurso, singular, plural]) =>
    M10(
      propria(
        {
          modulo: 'auditoria',
          recurso,
          rotulo: { singular, plural },
          subitem: 'privacidade',
          natureza: 'sistema',
          motivoSomenteLeitura: SISTEMA_M10,
          acoes: LER,
        },
        todas(PRIVACIDADE, LER),
      ),
    ),
  ),
];
