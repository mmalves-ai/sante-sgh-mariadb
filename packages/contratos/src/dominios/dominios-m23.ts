// Cadastros de dieta do M23 (ficha, seção 7 e regra 16: "Multiprofissional > Nutrição clínica > Dietas,
// características e horários de refeição" e "Hotelaria e apoio > Serviço de nutrição e dietética > Dietas e tipos de
// dieta") no CRUD genérico (M08). A regra da dieta única por paciente é da prescrição (M24); aqui, os cadastros.
// Opções do legado (TBOPCOES, retrato tools/verificadores/dados/acesso-legado.pc.json): as da nutrição do PEP
// (consultar 2675, 5926, 2654, 5925; incluir, alterar e excluir 4656, 5927, 4658, 4657, 5362, 2657) e a de
// Tabelas › Dietas (3677) na hotelaria.
import type { DominioPublico } from './tipos.js';

const LER_NUTRICAO = [2675, 5926, 2654, 5925];
const EDITAR_NUTRICAO = [4656, 5927, 4658, 4657, 5362, 2657];
const TABELAS_DIETAS = [3677];
const SISTEMA = 'o banco de dados recusa inclusão, alteração e exclusão: dado de sistema do fornecedor';

const nutricao = (
  recurso: string,
  rotulo: DominioPublico['rotulo'],
  acoes: DominioPublico['acoes'],
  extra: Partial<Pick<DominioPublico, 'categoria'>> = {},
): DominioPublico => ({
  modulo: 'pep',
  recurso,
  rotulo,
  subitem: 'nutricaoClinica',
  natureza: 'editavel',
  acoes,
  opcoesLegado: Object.fromEntries(
    acoes.map((a) => [a, a === 'ler' || a === 'exportar' ? LER_NUTRICAO : EDITAR_NUTRICAO]),
  ) as unknown as DominioPublico['opcoesLegado'],
  origemOpcoes: 'tbopcoes',
  marco: 'M23',
  ...extra,
});

export const DOMINIOS_M23: readonly DominioPublico[] = [
  // W0-02 (pilotos do motor do CRUD genérico): a exclusão física do item nunca usado (o cadastro anterior exclui pelas
  // opções da nutrição: 4656, 5927, 4658, 4657, 5362, 2657), com o verificador de dependências e o retrato; o texto
  // longo das respostas possíveis se edita na alteração (D-CRUD-30).
  nutricao(
    'caracteristicaDieta',
    { singular: 'Característica de dieta', plural: 'Características de dieta' },
    ['ler', 'criar', 'editar', 'inativar', 'excluir', 'exportar'],
    { categoria: 'dominio' },
  ),
  // W0-02: a ligação dieta × característica (chave composta) se exclui como o cadastro anterior exclui.
  nutricao(
    'caracteristicaDaDieta',
    { singular: 'Característica da dieta', plural: 'Características das dietas' },
    ['ler', 'criar', 'editar', 'inativar', 'excluir', 'exportar'],
    { categoria: 'ligacao' },
  ),
  nutricao('tipoRefeicao', { singular: 'Tipo de refeição', plural: 'Tipos de refeição' }, [
    'ler',
    'criar',
    'editar',
    'exportar',
  ]),
  nutricao('horarioRefeicao', { singular: 'Horário de refeição', plural: 'Horários de refeição' }, [
    'ler',
    'criar',
    'editar',
    'inativar',
    'exportar',
  ]),
  {
    modulo: 'internacao',
    recurso: 'dieta',
    rotulo: { singular: 'Dieta', plural: 'Dietas' },
    subitem: 'nutricaoHotelaria',
    natureza: 'editavel',
    acoes: ['ler', 'criar', 'editar', 'inativar', 'exportar'],
    opcoesLegado: {
      ler: TABELAS_DIETAS,
      criar: TABELAS_DIETAS,
      editar: TABELAS_DIETAS,
      inativar: TABELAS_DIETAS,
      exportar: TABELAS_DIETAS,
    },
    origemOpcoes: 'tbopcoes',
    marco: 'M23',
  },
  {
    modulo: 'internacao',
    recurso: 'tipoDieta',
    rotulo: { singular: 'Tipo de dieta', plural: 'Tipos de dieta' },
    subitem: 'nutricaoHotelaria',
    natureza: 'sistema',
    motivoSomenteLeitura: SISTEMA,
    acoes: ['ler', 'exportar'],
    opcoesLegado: { ler: TABELAS_DIETAS, exportar: TABELAS_DIETAS },
    origemOpcoes: 'tbopcoes',
    marco: 'M23',
  },
];
