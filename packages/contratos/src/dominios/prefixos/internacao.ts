// Domínios do CRUD genérico do módulo `internacao` (W0-01: um arquivo por prefixo; o agregador DOMINIOS_DECLARADOS, em
// ../catalogo.ts, já importa todos, inclusive os vazios). Domínio novo do módulo entra aqui; auxiliares em
// ../ajudantes.ts. Regras da obra: docs/operacoes/README.md.
import {
  CI,
  CIEI,
  FICHAS_INT,
  GERAL_A_L,
  GERAL_M_Z,
  LER,
  M21,
  SEM_INCLUSAO_FICHA_INT,
  SISTEMA,
  inferida,
  propria,
  todas,
} from '../ajudantes.js';
import type { DominioPublico } from '../tipos.js';

export const DOMINIOS_INTERNACAO: readonly DominioPublico[] = [
  // Internação, leitos e centro cirúrgico (INT 3, CC 1)
  inferida(
    {
      modulo: 'internacao',
      recurso: 'tipoAcomodacao',
      rotulo: { singular: 'Tipo de acomodação', plural: 'Tipos de acomodação' },
      subitem: 'internacao',
      natureza: 'sistema',
      motivoSomenteLeitura: SISTEMA,
      acoes: LER,
    },
    GERAL_M_Z,
  ),
  inferida(
    {
      modulo: 'internacao',
      recurso: 'desfechoInternacao',
      rotulo: { singular: 'Desfecho de internação', plural: 'Desfechos de internação' },
      subitem: 'internacao',
      natureza: 'sistema',
      motivoSomenteLeitura: SISTEMA,
      acoes: LER,
    },
    GERAL_A_L,
  ),
  inferida(
    {
      modulo: 'internacao',
      recurso: 'desfechoRecemNascido',
      rotulo: { singular: 'Desfecho do recém-nascido', plural: 'Desfechos do recém-nascido' },
      subitem: 'internacao',
      natureza: 'sistema',
      motivoSomenteLeitura: SISTEMA,
      acoes: LER,
    },
    GERAL_A_L,
  ),
  // Hotelaria e administração (HOT 4, ADM 1)
  propria(
    {
      modulo: 'internacao',
      recurso: 'tipoLimpeza',
      rotulo: { singular: 'Tipo de limpeza', plural: 'Tipos de limpeza' },
      subitem: 'hotelaria',
      natureza: 'editavel',
      acoes: CIEI,
    },
    todas([5006], CIEI),
  ),
  propria(
    {
      modulo: 'internacao',
      recurso: 'ocorrenciaLimpeza',
      rotulo: { singular: 'Tipo de ocorrência de limpeza', plural: 'Tipos de ocorrência de limpeza' },
      subitem: 'hotelaria',
      natureza: 'editavel',
      acoes: CI,
    },
    todas([5005], CI),
  ),
  propria(
    {
      modulo: 'internacao',
      recurso: 'situacaoHigienizacao',
      rotulo: { singular: 'Situação de higienização', plural: 'Situações de higienização' },
      subitem: 'hotelaria',
      natureza: 'editavel',
      acoes: CIEI,
    },
    todas([5003], CIEI),
  ),
  propria(
    {
      modulo: 'internacao',
      recurso: 'criticidadeArea',
      rotulo: { singular: 'Criticidade de área', plural: 'Criticidades de área' },
      subitem: 'hotelaria',
      natureza: 'editavel',
      acoes: CI,
    },
    todas([5004], CI),
  ),
  M21(
    propria(
      {
        modulo: 'internacao',
        recurso: 'modeloFichaInternacao',
        rotulo: { singular: 'Ficha a imprimir na internação', plural: 'Fichas a imprimir na internação' },
        subitem: 'internacao',
        natureza: 'editavel',
        acoes: ['ler', 'editar', 'exportar'],
        semInclusao: SEM_INCLUSAO_FICHA_INT,
      },
      todas(FICHAS_INT, ['ler', 'editar', 'exportar']),
    ),
  ),
  M21(
    propria(
      {
        modulo: 'internacao',
        recurso: 'tituloFichaInternacao',
        rotulo: { singular: 'Título da ficha da internação', plural: 'Títulos das fichas da internação' },
        subitem: 'internacao',
        natureza: 'editavel',
        acoes: ['ler', 'editar', 'exportar'],
        semInclusao: SEM_INCLUSAO_FICHA_INT,
      },
      todas(FICHAS_INT, ['ler', 'editar', 'exportar']),
    ),
  ),
];
