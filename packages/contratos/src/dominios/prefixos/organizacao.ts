// Domínios do CRUD genérico do módulo `organizacao` (W0-01: um arquivo por prefixo; o agregador DOMINIOS_DECLARADOS, em
// ../catalogo.ts, já importa todos, inclusive os vazios). Domínio novo do módulo entra aqui; auxiliares em
// ../ajudantes.ts. Regras da obra: docs/operacoes/README.md.
import {
  CIEI_M10,
  CIE_M10,
  EMPRESAS,
  HOSPITAL,
  LER,
  M10,
  OFICIAL,
  SISTEMA_M10,
  inferida,
  propria,
  todas,
} from '../ajudantes.js';
import type { DominioPublico } from '../tipos.js';

export const DOMINIOS_ORGANIZACAO: readonly DominioPublico[] = [
  M10(
    propria(
      {
        modulo: 'organizacao',
        recurso: 'unidade',
        rotulo: { singular: 'Unidade de atendimento', plural: 'Unidades de atendimento' },
        subitem: 'estruturaUnidades',
        natureza: 'editavel',
        acoes: ['ler', 'editar', 'inativar', 'exportar'],
        semInclusao:
          'a unidade nasce com o CNPJ, o endereço e o diretor técnico, que o faturamento do SUS confere: aqui se alteram o nome e o CNES e se inativa; a inclusão chega com o cadastro completo da unidade',
      },
      { ler: [6401, 6405], editar: [6402], inativar: [6404], exportar: [6406] },
    ),
  ),
  M10(
    inferida(
      {
        modulo: 'organizacao',
        recurso: 'esferaAdministrativa',
        rotulo: { singular: 'Esfera administrativa', plural: 'Esferas administrativas' },
        subitem: 'estruturaUnidades',
        natureza: 'carga-referencia',
        motivoSomenteLeitura: OFICIAL,
        acoes: LER,
      },
      HOSPITAL,
    ),
  ),
  M10(
    propria(
      {
        modulo: 'organizacao',
        recurso: 'centroCusto',
        rotulo: { singular: 'Centro de custo', plural: 'Centros de custo' },
        subitem: 'estruturaCentrosCusto',
        natureza: 'editavel',
        acoes: ['ler', 'editar', 'inativar', 'exportar'],
        semInclusao:
          'o centro de custo nasce com os parâmetros de rateio, repasse e produção da área de custos: aqui se alteram o nome e a sigla e se inativa; a inclusão chega com o cadastro de custos',
      },
      { ler: [3663, 3665, 6349], editar: [3981], inativar: [3983], exportar: [6350] },
    ),
  ),
  M10(
    propria(
      {
        modulo: 'organizacao',
        recurso: 'clinica',
        rotulo: { singular: 'Clínica', plural: 'Clínicas' },
        subitem: 'estruturaCentrosCusto',
        natureza: 'editavel',
        acoes: CIEI_M10,
      },
      todas([3662], CIEI_M10),
    ),
  ),
  M10(
    propria(
      {
        modulo: 'organizacao',
        recurso: 'bloco',
        rotulo: { singular: 'Bloco', plural: 'Blocos' },
        subitem: 'estruturaLeitos',
        natureza: 'editavel',
        acoes: CIE_M10,
      },
      { ler: [2323, 2326], criar: [2323], editar: [2323], exportar: [2323, 2326] },
    ),
  ),
  M10(
    propria(
      {
        modulo: 'organizacao',
        recurso: 'especialidadeLeito',
        rotulo: { singular: 'Especialidade de leito', plural: 'Especialidades de leito' },
        subitem: 'estruturaLeitos',
        natureza: 'carga-referencia',
        motivoSomenteLeitura: OFICIAL,
        acoes: LER,
      },
      todas([3851], LER),
    ),
  ),
  M10(
    propria(
      {
        modulo: 'organizacao',
        recurso: 'local',
        rotulo: { singular: 'Local de atendimento', plural: 'Locais de atendimento' },
        subitem: 'estruturaLocais',
        natureza: 'editavel',
        acoes: ['ler', 'editar', 'inativar', 'exportar'],
        semInclusao:
          'o local nasce junto com o horário de funcionamento e os encaminhamentos do painel: aqui se alteram a descrição, o painel e a situação; a inclusão chega com o cadastro dos horários',
      },
      todas([3727], ['ler', 'editar', 'inativar', 'exportar']),
    ),
  ),
  M10(
    propria(
      {
        modulo: 'organizacao',
        recurso: 'feriado',
        rotulo: { singular: 'Feriado', plural: 'Feriados' },
        subitem: 'estruturaLocais',
        natureza: 'editavel',
        acoes: CIE_M10,
      },
      todas([3690], CIE_M10),
    ),
  ),
  M10(
    inferida(
      {
        modulo: 'organizacao',
        recurso: 'prioridade',
        rotulo: { singular: 'Grupo de prioridade', plural: 'Grupos de prioridade' },
        subitem: 'estruturaLocais',
        natureza: 'editavel',
        acoes: CIE_M10,
      },
      [3724],
    ),
  ),
  M10(
    propria(
      {
        modulo: 'organizacao',
        recurso: 'localConta',
        rotulo: { singular: 'Local de conta', plural: 'Locais de conta' },
        subitem: 'estruturaLocaisConta',
        natureza: 'editavel',
        acoes: CIEI_M10,
      },
      todas([3697], CIEI_M10),
    ),
  ),
  M10(
    propria(
      {
        modulo: 'organizacao',
        recurso: 'unidadeConsumo',
        rotulo: { singular: 'Unidade de consumo', plural: 'Unidades de consumo' },
        subitem: 'estruturaLocaisConta',
        natureza: 'editavel',
        acoes: CIE_M10,
      },
      todas([3760], CIE_M10),
    ),
  ),
  M10(
    inferida(
      {
        modulo: 'organizacao',
        recurso: 'tipoEmpresa',
        rotulo: { singular: 'Tipo de empresa', plural: 'Tipos de empresa' },
        subitem: 'dadosFiscais',
        natureza: 'sistema',
        motivoSomenteLeitura: SISTEMA_M10,
        acoes: LER,
      },
      EMPRESAS,
    ),
  ),
  M10(
    inferida(
      {
        modulo: 'organizacao',
        recurso: 'tipoCooperativa',
        rotulo: { singular: 'Indicador de cooperativa', plural: 'Indicadores de cooperativa' },
        subitem: 'dadosFiscais',
        natureza: 'carga-referencia',
        motivoSomenteLeitura: OFICIAL,
        acoes: LER,
      },
      EMPRESAS,
    ),
  ),
  M10(
    inferida(
      {
        modulo: 'organizacao',
        recurso: 'tipoConstrutora',
        rotulo: { singular: 'Indicador de construtora', plural: 'Indicadores de construtora' },
        subitem: 'dadosFiscais',
        natureza: 'carga-referencia',
        motivoSomenteLeitura: OFICIAL,
        acoes: LER,
      },
      EMPRESAS,
    ),
  ),
  M10(
    inferida(
      {
        modulo: 'organizacao',
        recurso: 'ministerioCertificador',
        rotulo: { singular: 'Ministério certificador', plural: 'Ministérios certificadores' },
        subitem: 'dadosFiscais',
        natureza: 'carga-referencia',
        motivoSomenteLeitura: OFICIAL,
        acoes: LER,
      },
      EMPRESAS,
    ),
  ),
];
