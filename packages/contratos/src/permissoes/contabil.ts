// Permissões da contabilidade, etapa 1 (M54-F1; ficha, seção 7; convencoes.md §12): plano de contas e plano
// referencial, publicação da regra de contabilização versionada e o acompanhamento da leitura dos fatos. Quem tem a
// opção no outro sistema tem a permissão no novo (regra 1 do M06). Opções da árvore do menu de origem (conector/mapa/permissoes.tsv;
// no pc só o grupo MASTER tem as opções do módulo Contabilidade, conferido em acesso-legado.pc.json em 24/10/2026):
//   - Contabilidade 3; Tabelas 12 (Parâmetros 13, Empresas 14, Histórico padrão 15, Plano de contas 4297, Plano de
//     contas referencial 4312 com Manutenção 4313, Contas 4314, Referências 4315, Plano referencial x próprio 4316);
//   - Tabelas › Integração 19 (Integração 4302, Eventos 4300, Convênios 4298, Grupos 4305): o de-para das regras;
//   - Utilitários › Integrar lançamentos 82 (Contas a pagar e receber 83, Lançamentos bancários 84); Consulta de
//     lançamentos 81: a leitura dos fatos.
// As etapas seguintes (lançamento, estorno, encerramento, demonstrações, SPED, custos, patrimônio e orçamento) declaram
// as suas no mesmo arquivo.
import type { DeclaracaoPermissao } from './tipos.js';

const p = (
  codigo: string,
  descricao: string,

  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,

  concessaoPorPerfil: null,
  categoria: 'financeira',
  criticidade: 'normal',
  escopos: [],
  ...extra,
});

export const PERMISSOES_CONTABIL_M54_F1: readonly DeclaracaoPermissao[] = [
  p('contabil.plano.ler', 'Consultar o plano de contas, o plano referencial e as regras de contabilização'),
  p(
    'contabil.plano.editar',
    'Incluir e alterar contas do plano e o vínculo com o plano referencial',

    { criticidade: 'sensivel' },
  ),
  p(
    'contabil.regra.publicar',
    'Publicar nova versão de regra de contabilização (a versão publicada não muda; reprocessa só período aberto)',

    { criticidade: 'critica' },
  ),
  p(
    'contabil.fato.ler',
    'Acompanhar a leitura dos fatos dos módulos (pendentes, sem regra, contabilizados) e o reprocessamento',
  ),
];

/**
 * Etapa 2 (M54-F2; ficha, seção 7): lançamentos (automáticos, manual, estorno), razão, conciliação de contas e o
 * encerramento do período. `contabil.conciliacao.registrar` e `contabil.periodo.reabrir` não estão na ficha: a
 * conciliação e o "desfazer encerramento" têm opção própria no outro sistema (4328 e 88), e quem tem a opção tem a
 * permissão (D-PERM-CONCILIA-542).
 */
export const PERMISSOES_CONTABIL_M54_F2: readonly DeclaracaoPermissao[] = [
  p(
    'contabil.lancamento.ler',
    'Consultar os lançamentos contábeis, o razão das contas, a conciliação e os períodos',
  ),
  p(
    'contabil.lancamento.criar',
    'Incluir lançamento manual e contabilizar os fatos dos módulos (só em período aberto)',

    { criticidade: 'sensivel' },
  ),
  p(
    'contabil.lancamento.estornar',
    'Estornar lançamento contábil (outro lançamento, que inverte as partidas; o original fica)',

    { criticidade: 'sensivel' },
  ),
  p('contabil.conciliacao.registrar', 'Conciliar e desfazer a conciliação das partidas de uma conta'),
  p(
    'contabil.periodo.encerrar',
    'Encerrar o período contábil (depois do encerramento, nenhum lançamento entra na competência)',

    { criticidade: 'critica' },
  ),
  p(
    'contabil.periodo.reabrir',
    'Reabrir o último período contábil encerrado, com justificativa',

    { criticidade: 'critica' },
  ),
];

/**
 * Etapa 3 (M54-F3; ficha, seção 7): balancete, diário, DRE e balanço (`contabil.demonstracao.ler`) e o SPED contábil
 * (`contabil.sped.ler` e `contabil.sped.gerar`). A apuração do resultado do exercício usa a `contabil.periodo.encerrar`
 * da etapa 2 (é o "Encerramento de exercício" do outro sistema, opções 85 e 86). Baixar o arquivo gerado exige a
 * `contabil.sped.gerar`: o arquivo traz o CPF dos signatários (D-BAIXAR-543).
 */
export const PERMISSOES_CONTABIL_M54_F3: readonly DeclaracaoPermissao[] = [
  // A pasta Relatórios (30) não entra: quem tem só o Razão (35-37, contabil.lancamento.ler) também tem a pasta para
  // chegar a ele, e ganharia o balancete, o diário, a DRE e o balanço sem ter as opções deles (D-PASTA-543).
  p('contabil.demonstracao.ler', 'Consultar o balancete, o diário, a DRE e o balanço patrimonial'),
  p('contabil.sped.ler', 'Consultar os arquivos da ECD e da ECF gerados e a prévia da geração'),
  p(
    'contabil.sped.gerar',
    'Gerar e baixar a ECD e a ECF do exercício e registrar o recibo da transmissão',

    { criticidade: 'sensivel' },
  ),
  // C2-101 (07-FIN linha 127): consolidação gerencial de várias empresas. Recurso novo, sem opção correspondente no
  // menu de origem: concedido pelo perfil ao administrador do sistema (a controladoria recebe pelo perfil dela).
  p(
    'contabil.consolidacao.ler',
    'Consultar os grupos de consolidação, o de-para, a prévia e a DRE e o balanço consolidados',
    {
      concessaoPorPerfil: 'por-perfil',
      perfis: ['administrador-sistema'],
      escopos: [],
    },
  ),
  p(
    'contabil.consolidacao.editar',
    'Manter o grupo de consolidação, o plano gerencial comum e o de-para das contas dos estabelecimentos',
    {
      criticidade: 'sensivel',
      concessaoPorPerfil: 'por-perfil',
      perfis: ['administrador-sistema'],
      escopos: [],
    },
  ),
  p(
    'contabil.consolidacao.apurar',
    'Apurar a consolidação mensal com a eliminação entre empresas e liberar a competência',
    {
      criticidade: 'sensivel',
      concessaoPorPerfil: 'por-perfil',
      perfis: ['administrador-sistema'],
      escopos: [],
    },
  ),
  // C3-023 (07-FIN linha 115): LALUR/LACS (partes A e B) e apuração e provisão do IRPJ e da CSLL do lucro real.
  // Recurso sem opção correspondente no menu de origem: concedido pelo perfil ao administrador do sistema.
  p(
    'contabil.lalur.ler',
    'Consultar o LALUR e o LACS (partes A e B), a apuração do IRPJ e da CSLL e o bloco M da ECF',
    {
      concessaoPorPerfil: 'por-perfil',
      perfis: ['administrador-sistema'],
      escopos: [],
    },
  ),
  p(
    'contabil.lalur.editar',
    'Manter os ajustes da parte A, as contas da parte B e a configuração da provisão do IRPJ e da CSLL',
    {
      criticidade: 'sensivel',
      concessaoPorPerfil: 'por-perfil',
      perfis: ['administrador-sistema'],
      escopos: [],
    },
  ),
  p('contabil.lalur.apurar', 'Apurar, provisionar e fechar o IRPJ e a CSLL do lucro real', {
    criticidade: 'sensivel',
    concessaoPorPerfil: 'por-perfil',
    perfis: ['administrador-sistema'],
    escopos: [],
  }),
];
