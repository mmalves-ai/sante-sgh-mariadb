// Domínios do CRUD genérico do módulo `cadastro` (W0-01: um arquivo por prefixo; o agregador DOMINIOS_DECLARADOS, em
// ../catalogo.ts, já importa todos, inclusive os vazios). Domínio novo do módulo entra aqui; auxiliares em
// ../ajudantes.ts. Regras da obra: docs/operacoes/README.md.
import {
  AE,
  AEI,
  CIE,
  CONSELHOS,
  ESPECIALIDADES,
  GERAL_A_L,
  GERAL_M_Z,
  LER,
  M11,
  SISTEMA,
  inferida,
  propria,
  todas,
} from '../ajudantes.js';
import type { DominioPublico } from '../tipos.js';

export const DOMINIOS_CADASTRO: readonly DominioPublico[] = [
  // Demográficos, documentos e endereço (CAD 7)
  inferida(
    {
      modulo: 'cadastro',
      recurso: 'estadoCivil',
      rotulo: { singular: 'Estado civil', plural: 'Estados civis' },
      subitem: 'demograficos',
      natureza: 'editavel',
      acoes: CIE,
    },
    GERAL_A_L,
  ),
  inferida(
    {
      modulo: 'cadastro',
      recurso: 'escolaridade',
      rotulo: { singular: 'Escolaridade', plural: 'Escolaridades' },
      subitem: 'demograficos',
      natureza: 'editavel',
      acoes: CIE,
    },
    GERAL_A_L,
  ),
  inferida(
    {
      modulo: 'cadastro',
      recurso: 'parentesco',
      rotulo: { singular: 'Grau de parentesco', plural: 'Graus de parentesco' },
      subitem: 'demograficos',
      natureza: 'editavel',
      acoes: CIE,
    },
    GERAL_M_Z,
  ),
  propria(
    {
      modulo: 'cadastro',
      recurso: 'religiao',
      rotulo: { singular: 'Religião', plural: 'Religiões' },
      subitem: 'demograficos',
      natureza: 'editavel',
      acoes: CIE,
    },
    todas([3739], CIE),
  ),
  inferida(
    {
      modulo: 'cadastro',
      recurso: 'tipoDocumento',
      rotulo: { singular: 'Tipo de documento', plural: 'Tipos de documento' },
      subitem: 'demograficos',
      natureza: 'editavel',
      acoes: CIE,
    },
    GERAL_M_Z,
  ),
  inferida(
    {
      modulo: 'cadastro',
      recurso: 'tipoTelefone',
      rotulo: { singular: 'Tipo de telefone', plural: 'Tipos de telefone' },
      subitem: 'demograficos',
      natureza: 'editavel',
      acoes: CIE,
    },
    GERAL_M_Z,
  ),
  propria(
    {
      modulo: 'cadastro',
      recurso: 'classificacaoAlergia',
      rotulo: { singular: 'Classificação de alergia', plural: 'Classificações de alergia' },
      subitem: 'demograficos',
      natureza: 'sistema',
      motivoSomenteLeitura: SISTEMA,
      acoes: LER,
    },
    { ler: [5441, 6331], exportar: [6332] },
  ),
  M11(
    propria(
      {
        modulo: 'cadastro',
        recurso: 'conselho',
        rotulo: { singular: 'Conselho profissional', plural: 'Conselhos profissionais' },
        subitem: 'profissionais',
        natureza: 'editavel',
        acoes: CIE,
      },
      todas(CONSELHOS, CIE),
    ),
  ),
  M11(
    propria(
      {
        modulo: 'cadastro',
        recurso: 'especialidade',
        rotulo: { singular: 'Especialidade', plural: 'Especialidades' },
        subitem: 'especialidades',
        natureza: 'editavel',
        acoes: AE,
        semInclusao:
          'os códigos de especialidade vão de 0 a 99 e os 100 já estão em uso: especialidade nova não cabe; aqui se alteram sigla, faixa etária e sexo',
      },
      todas(ESPECIALIDADES, AE),
    ),
  ),
  M11(
    inferida(
      {
        modulo: 'cadastro',
        recurso: 'cboEspecialidade',
        rotulo: { singular: 'CBO da especialidade', plural: 'CBOs das especialidades' },
        subitem: 'especialidades',
        natureza: 'editavel',
        acoes: AE,
        semInclusao:
          'o CBO vem da tabela oficial (carga própria); aqui se troca a especialidade de um CBO já ligado',
      },
      ESPECIALIDADES,
    ),
  ),
  M11(
    propria(
      {
        modulo: 'cadastro',
        recurso: 'prestador',
        rotulo: { singular: 'Prestador de serviço terceiro', plural: 'Prestadores de serviço terceiros' },
        subitem: 'prestadores',
        natureza: 'editavel',
        acoes: AEI,
        semInclusao:
          'o prestador nasce do registro do profissional com os dados de repasse (o banco confere o CRM do registro): a inclusão fica com o favorecido do repasse, em módulo próprio',
      },
      { ler: [3730, 6376], editar: [3731], inativar: [3733], exportar: [6377] },
    ),
  ),
];
