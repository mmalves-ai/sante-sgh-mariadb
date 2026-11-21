// Permissões do M13 (ficha, seção 7; convencoes.md §12): painel e cargas dos catálogos oficiais, consulta dos
// catálogos, mapeamentos editáveis pelo CRUD genérico e os leiautes de importação de CEP. Quem tem a opção no
// legado tem a permissão no novo: as opções vêm da árvore do menu de origem (retrato
// tools/verificadores/dados/acesso-legado.pc.json):
//   - importação de tabelas: Utilitários › Importações (3766) › Tabelas (3768), Referência TUSS (3777),
//     Tabelas auxiliares padrão TISS (6460); Tabelas › SUS (6920) › Tabela unificada (6921);
//   - consulta: Tabelas › CID 10 (3653, Gerenciamento 6343/6347), CIAP (6693/6697), CEP (3649/6341), C.B.O.
//     (3980), C.B.O ANS (4884), Municípios IBGE (3722), Laboratórios (3589), Atividades (3615), Bancos (3617),
//     Motivos de glosa (3631), Tabela de DCB (1721), SUS › Consulta de compatibilidade (6986), SPED (4980);
//   - leiautes de CEP: Tabelas › CEP › Alterar (3650);
//   - aprovação por área (ficha, seção 5: faturamento para preços e terminologias de faturamento; fiscal para as
//     tabelas fiscais; administração para os demais; farmácia para Brasíndice e Simpro, dono de mat/med):
//     faturamento = Tabela unificada (6921; Faturamento A.I.H. › Tabelas › Unificada 3183), Referência TUSS
//     (3777), Tabelas auxiliares padrão TISS (6460); administração = Importações › Tabelas (3766, 3768);
//     fiscal = SPED (4980), Contribuições PIS/COFINS (4981), Informações Sped Fiscal (4504); farmácia =
//     Estoque › Atualiza referência Brasíndice (2208) e Estoque › Importações (2218). A aprovação exige
//     `catalogo.carga.publicar` E a permissão da área do catálogo (decisão D20 das evidências do M13).
// Os mapeamentos locais (TUSS × tipo de lançamento, DRS, fabricantes de OPM) e os leiautes de CEP são
// domínios do CRUD genérico do M08: as permissões de incluir e alterar deles são as geradas da declaração
// (`catalogo.<recurso>.<acao>`, com as mesmas opções), no lugar de `catalogo.mapeamento.editar` e
// `catalogo.leiaute.editar` da ficha (decisão D5 das evidências do M13).
// A correspondência ação → opção é inferida (POL-1b) onde a árvore não tem item próprio e é conferida na
// validação humana (pendência nas evidências do M13).
import type { DeclaracaoPermissao } from './tipos.js';

/** Perfis da operadora que leem os catálogos da ANS na tela dos envios (M56; os mesmos de `operadora.ans.ler`). */
const PERFIS_OPERADORA_ANS = ['operadora-gestor', 'operadora-ans'] as const;
const area = (codigo: string, descricao: string): DeclaracaoPermissao => ({
  codigo,
  descricao,

  concessaoPorPerfil: null,
  categoria: 'administrativa',
});

export const PERMISSOES_M13: readonly DeclaracaoPermissao[] = [
  {
    codigo: 'catalogo.carga.ler',
    descricao: 'Consultar o painel de cargas dos catálogos oficiais e o detalhe de cada carga',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
  },
  {
    codigo: 'catalogo.carga.criar',
    descricao:
      'Enviar o arquivo oficial de um catálogo (preparação, validação e comparação; nada é publicado)',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
  },
  {
    codigo: 'catalogo.carga.publicar',
    descricao:
      'Aprovar e publicar a carga de um catálogo oficial (com justificativa e a senha de novo; exige também a permissão da área do catálogo)',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'critica',
  },
  {
    codigo: 'catalogo.carga.rejeitar',
    descricao: 'Rejeitar ou cancelar a carga de um catálogo oficial (com motivo)',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
  },
  {
    codigo: 'catalogo.item.ler',
    descricao: 'Consultar os catálogos oficiais (CID, CIAP, SIGTAP, TUSS, CEP, CBO, DCB e tabelas fiscais)',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
  },
  // M56 (correção do M56.1, D-ANS-HOSPITAL-56): os catálogos da ANS (grupos e procedimentos do SIP, classificação de
  // procedimentos) são catálogo oficial útil ao hospital, com o módulo da operadora desligado ou ligado: quem consulta
  // os catálogos oficiais no hospital (as mesmas opções de `catalogo.item.ler`) e os perfis da operadora que cuidam dos
  // envios. A parte dos envios fica em `operadora.ans.ler`.
  {
    codigo: 'catalogo.ans.ler',
    descricao:
      'Consultar os catálogos da ANS (grupos e procedimentos do SIP, classificação de procedimentos)',

    concessaoPorPerfil: 'por-perfil',
    perfis: PERFIS_OPERADORA_ANS,
    categoria: 'administrativa',
  },
  {
    codigo: 'catalogo.leiaute.ler',
    descricao: 'Consultar os leiautes de importação da base de CEP',

    concessaoPorPerfil: null,
    categoria: 'tecnica',
  },
  area(
    'catalogo.faturamento.aprovar',
    'Aprovar as cargas da área de faturamento (SIGTAP, TUSS e terminologias TISS)',
  ),
  area(
    'catalogo.administracao.aprovar',
    'Aprovar as cargas da administração (CID, CIAP, CEP, CBO e listas oficiais)',
  ),
  area('catalogo.fiscal.aprovar', 'Aprovar as cargas das tabelas fiscais e do SPED'),
  area('catalogo.farmacia.aprovar', 'Aprovar as cargas do Brasíndice e do Simpro'),
];
