// Telas mestre-detalhe do CRUD genérico (M14; ficha, seção 7): em cada item da árvore, o domínio MESTRE e os
// DETALHES que se ligam a ele por um campo (o código do mestre). É configuração de tela (dados, não tela por
// tabela): a tela genérica do grupo mostra o mestre e, escolhido um registro, os detalhes filtrados por ele. Um
// teste confere que os domínios e os campos existem nas declarações.
import type { SubitemDominio } from './tipos.js';

export interface DetalheDominio {
  /** `<modulo>.<recurso>` do detalhe. */
  readonly dominio: string;
  /** Campo do detalhe que guarda o código do mestre. */
  readonly campo: string;
  /** Campo do mestre com o valor ligado (`codigo`: o código exposto). */
  readonly deCampo: string;
}

/**
 * Correção do M14: consulta somente leitura ligada ao mestre (histórico de referência do exame, retrato do kit):
 * escolhido o registro do mestre, a consulta abre já filtrada por ele (filtro `igual` em cada campo).
 */
export interface DetalheConsulta {
  /** `<modulo>.<recurso>` da consulta. */
  readonly consulta: string;
  readonly filtros: readonly { readonly campo: string; readonly deCampo: string }[];
}

export interface MestreDetalhe {
  readonly mestre: string;
  readonly detalhes: readonly DetalheDominio[];
  readonly consultas?: readonly DetalheConsulta[];
}

export const MESTRE_DETALHE: Readonly<Partial<Record<SubitemDominio, MestreDetalhe>>> = {
  // M24: cadastros de prescrição (kit de medicamento e seus materiais; frequência e seus horários relativos; item
  // não padronizado com vias e princípios; protocolo e especialidades; grade de doses e seus horários).
  prescricaoKits: {
    mestre: 'pep.kitMedicamento',
    detalhes: [{ dominio: 'pep.itemKitMedicamento', campo: 'kit', deCampo: 'codigo' }],
  },
  prescricaoFrequencias: {
    mestre: 'pep.frequenciaPrescricao',
    detalhes: [{ dominio: 'pep.horarioRelativo', campo: 'frequencia', deCampo: 'codigo' }],
  },
  prescricaoNaoPadronizados: {
    mestre: 'pep.itemNaoPadronizado',
    detalhes: [
      { dominio: 'pep.viaItemNaoPadronizado', campo: 'item', deCampo: 'codigo' },
      { dominio: 'pep.principioItemNaoPadronizado', campo: 'item', deCampo: 'codigo' },
    ],
  },
  prescricaoProtocolos: {
    mestre: 'pep.protocoloPrescricao',
    detalhes: [{ dominio: 'pep.especialidadeProtocolo', campo: 'protocolo', deCampo: 'codigo' }],
  },
  prescricaoHorarios: {
    mestre: 'pep.numeroDosesGrade',
    detalhes: [{ dominio: 'pep.horarioDoseGrade', campo: 'grade', deCampo: 'codigo' }],
  },
  exames: {
    mestre: 'sadt.exame',
    detalhes: [
      { dominio: 'sadt.elemento', campo: 'codprc', deCampo: 'codalf' },
      { dominio: 'sadt.formulaCalculo', campo: 'exame', deCampo: 'codalf' },
      { dominio: 'sadt.variavelFormula', campo: 'exame', deCampo: 'codalf' },
    ],
    consultas: [
      {
        consulta: 'sadt.versaoFaixasReferenciaExame',
        filtros: [
          { campo: 'idSitabproAto', deCampo: 'ato' },
          { campo: 'idSitabproCodalf', deCampo: 'codalf' },
        ],
      },
      {
        consulta: 'sadt.versaoTextoValorReferenciaExame',
        filtros: [
          { campo: 'idSitabproAto', deCampo: 'ato' },
          { campo: 'idSitabproCodalf', deCampo: 'codalf' },
        ],
      },
      {
        consulta: 'sadt.versaoFaixasReferenciaElemento',
        filtros: [{ campo: 'idSitabeleCodprc', deCampo: 'codalf' }],
      },
    ],
  },
  kitsExames: {
    mestre: 'sadt.kit',
    detalhes: [{ dominio: 'sadt.itemKit', campo: 'kit', deCampo: 'codigo' }],
    consultas: [
      {
        consulta: 'sadt.versaoHistoricaKitsExamesVigencia',
        filtros: [{ campo: 'idSikitexa', deCampo: 'codigo' }],
      },
    ],
  },
  alergiasPrincipios: {
    mestre: 'cadastro.alergia',
    detalhes: [{ dominio: 'cadastro.alergiaPrincipioAtivo', campo: 'idTbalergia', deCampo: 'codigo' }],
  },
  resultadosSadt: {
    mestre: 'sadt.grupoResultadosPossiveis',
    detalhes: [{ dominio: 'sadt.resultadoPossivel', campo: 'tab', deCampo: 'codigo' }],
  },
  fornecedoresCategorias: {
    mestre: 'suprimentos.categoria',
    detalhes: [{ dominio: 'suprimentos.fornecedorCategoria', campo: 'categ', deCampo: 'codigo' }],
  },
};
