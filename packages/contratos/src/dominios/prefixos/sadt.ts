// Domínios do CRUD genérico do módulo `sadt` (W0-01: um arquivo por prefixo; o agregador DOMINIOS_DECLARADOS, em
// ../catalogo.ts, já importa todos, inclusive os vazios). Domínio novo do módulo entra aqui; auxiliares em
// ../ajudantes.ts. Regras da obra: docs/operacoes/README.md.
import { CI, CIE, M26, PORTAL, inferida, propria, todas } from '../ajudantes.js';
import type { DominioPublico } from '../tipos.js';

export const DOMINIOS_SADT: readonly DominioPublico[] = [
  M26(
    propria(
      {
        modulo: 'sadt',
        recurso: 'modalidade',
        rotulo: { singular: 'Modalidade de imagem', plural: 'Modalidades de imagem (DICOM)' },
        subitem: 'sadtModalidades',
        natureza: 'editavel',
        acoes: CIE,
      },
      todas([4740, 4742], CIE),
    ),
  ),
  M26(
    inferida(
      {
        modulo: 'sadt',
        recurso: 'grandezaEco',
        rotulo: { singular: 'Grandeza do laudo do eco', plural: 'Grandezas do laudo estruturado do eco' },
        subitem: 'sadtMetodosGraficos',
        natureza: 'editavel',
        acoes: CIE,
      },
      [2677],
    ),
  ),
  M26(
    propria(
      {
        modulo: 'sadt',
        recurso: 'portalPerfil',
        rotulo: { singular: 'Perfil do portal', plural: 'Perfis do portal de resultados' },
        subitem: 'portalResultados',
        natureza: 'editavel',
        acoes: CIE,
      },
      todas(PORTAL, CIE),
    ),
  ),
  M26(
    propria(
      {
        modulo: 'sadt',
        recurso: 'portalPerfilModalidade',
        rotulo: {
          singular: 'Modalidade visível no perfil',
          plural: 'Modalidades visíveis por perfil do portal',
        },
        subitem: 'portalResultados',
        natureza: 'editavel',
        acoes: CI,
      },
      todas(PORTAL, CI),
    ),
  ),
  M26(
    propria(
      {
        modulo: 'sadt',
        recurso: 'portalPerfilUsuario',
        rotulo: { singular: 'Usuário do perfil do portal', plural: 'Usuários por perfil do portal' },
        subitem: 'portalResultados',
        natureza: 'editavel',
        acoes: CI,
      },
      todas(PORTAL, CI),
    ),
  ),
  M26(
    propria(
      {
        modulo: 'sadt',
        recurso: 'portalPermissao',
        rotulo: { singular: 'Permissões do perfil do portal', plural: 'Permissões por perfil do portal' },
        subitem: 'portalResultados',
        natureza: 'editavel',
        acoes: CIE,
      },
      todas(PORTAL, CIE),
    ),
  ),
  M26(
    propria(
      {
        modulo: 'sadt',
        recurso: 'portalSetor',
        rotulo: {
          singular: 'Setor publicado no portal',
          plural: 'Setores publicados no portal de resultados',
        },
        subitem: 'portalResultados',
        natureza: 'editavel',
        acoes: CIE,
      },
      todas(PORTAL, CIE),
    ),
  ),
  M26(
    propria(
      {
        modulo: 'sadt',
        recurso: 'autocadastroLegado',
        rotulo: {
          singular: 'Autocadastro de médico solicitante (portal anterior)',
          plural: 'Autocadastros de médico solicitante (portal anterior)',
        },
        subitem: 'portalAutocadastro',
        natureza: 'editavel',
        acoes: ['ler', 'editar'],
        semInclusao:
          'o autocadastro nasce no portal (o médico preenche e escolhe a senha); aqui só se liga ao médico do cadastro de solicitantes e se ativa ou desativa',
      },
      todas([4748], ['ler', 'editar']),
    ),
  ),
];
