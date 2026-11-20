// Domínios do CRUD genérico do módulo `hotelaria` (W0-01: um arquivo por prefixo; o agregador DOMINIOS_DECLARADOS, em
// ../catalogo.ts, já importa todos, inclusive os vazios). Domínio novo do módulo entra aqui; auxiliares em
// ../ajudantes.ts. Regras da obra: docs/operacoes/README.md.
import {
  CIE,
  CIEI,
  HIG_AREAS,
  HIG_MATERIAIS,
  HIG_PROFISSIONAIS,
  HIG_VINCULOS,
  LER,
  M21,
  VINCULO,
  propria,
  todas,
} from '../ajudantes.js';
import type { DominioPublico } from '../tipos.js';

export const DOMINIOS_HOTELARIA: readonly DominioPublico[] = [
  M21(
    propria(
      {
        modulo: 'hotelaria',
        recurso: 'area',
        rotulo: { singular: 'Área da higienização', plural: 'Áreas da higienização' },
        subitem: 'higienizacaoCadastros',
        natureza: 'editavel',
        acoes: CIEI,
      },
      todas(HIG_AREAS, CIEI),
    ),
  ),
  M21(
    propria(
      {
        modulo: 'hotelaria',
        recurso: 'profissional',
        rotulo: { singular: 'Profissional da higienização', plural: 'Profissionais da higienização' },
        subitem: 'higienizacaoCadastros',
        natureza: 'editavel',
        acoes: CIEI,
      },
      todas(HIG_PROFISSIONAIS, CIEI),
    ),
  ),
  M21(
    propria(
      {
        modulo: 'hotelaria',
        recurso: 'telefoneProfissional',
        rotulo: {
          singular: 'Telefone do profissional da higienização',
          plural: 'Telefones dos profissionais da higienização',
        },
        subitem: 'higienizacaoCadastros',
        natureza: 'editavel',
        acoes: CIE,
      },
      todas(HIG_PROFISSIONAIS, CIE),
    ),
  ),
  M21(
    propria(
      {
        modulo: 'hotelaria',
        recurso: 'areaProfissional',
        rotulo: { singular: 'Profissional da área', plural: 'Profissionais por área' },
        subitem: 'higienizacaoCadastros',
        natureza: 'editavel',
        // Todas as combinações área × profissional já existem (110 × 17): sem inclusão provável, só consulta.
        acoes: LER,
        semInclusao:
          'todos os profissionais já estão em todas as áreas: a inclusão fica desligada até haver área ou profissional novo para provar a gravação',
      },
      todas(HIG_VINCULOS, LER),
    ),
  ),
  M21(
    propria(
      {
        modulo: 'hotelaria',
        recurso: 'leitoProfissional',
        rotulo: { singular: 'Profissional do leito', plural: 'Profissionais por leito' },
        subitem: 'higienizacaoCadastros',
        natureza: 'editavel',
        acoes: VINCULO,
      },
      todas(HIG_VINCULOS, VINCULO),
    ),
  ),
  M21(
    propria(
      {
        modulo: 'hotelaria',
        recurso: 'materialLimpeza',
        rotulo: { singular: 'Material por tipo de limpeza', plural: 'Materiais por tipo de limpeza' },
        subitem: 'higienizacaoCadastros',
        natureza: 'editavel',
        acoes: CIE,
      },
      todas(HIG_MATERIAIS, CIE),
    ),
  ),
];
