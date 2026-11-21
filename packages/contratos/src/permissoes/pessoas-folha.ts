// Permissões do M53-F0 (ficha do M53, seção 7; convencoes.md §12): ler a folha da competência e os lotes de interface,
// exportar o lote à folha externa e importar o retorno. Quem tem a opção no outro sistema tem a permissão no novo
// (regra 1 do M06). Opções da árvore do menu de origem levantadas no preparo (conector/mapa/permissoes.tsv):
//   - Folha de pagamento 351 (e as entradas 553 e 4259 do mesmo módulo); Lançamentos 372; Lançamentos › Folha Mensal
//     384; Lançamentos › Afastamento 389; Exportações 523; Rotinas › Integração 397; Utilitarios › Importações 547 (Importação inicial 548);
//   - Ponto eletrônico (novo) › Integrações › Integração com folha de pagamento 5084.
// As demais permissões da ficha (pessoas.folha.calcular, M53-F2, abaixo; pessoas.folha.fechar, M53-F6; pessoas.rubrica.*, M53-F1;
// pessoas.esocial.*, pessoas.obrigacao.*, pessoas.integracao.*, fatias seguintes) entram com a fatia que as usa.
// D-PERM-53 (POL-5): `pessoas.folha.exportar` não está na tabela da ficha, que põe a interface sob
// `pessoas.folha.importar`. Exportar manda dado de colaborador (CPF, lotação, conselho) para fora do sistema, o que é
// outra decisão de acesso e outro registro na trilha; por isso é permissão própria, sensível.
import type { DeclaracaoPermissao } from './tipos.js';

const p = (
  codigo: string,
  descricao: string,

  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,

  concessaoPorPerfil: null,
  categoria: 'administrativa',
  criticidade: 'normal',
  escopos: [],
  ...extra,
});

export const PERMISSOES_FOLHA_M53: readonly DeclaracaoPermissao[] = [
  p('pessoas.folha.ler', 'Consultar a folha da competência e os lotes trocados com a folha externa'),
  p(
    'pessoas.folha.exportar',
    'Gerar e baixar o lote da competência para a folha externa (colaboradores, lotação, afastamentos, ponto e plantões)',

    { criticidade: 'sensivel' },
  ),
  p(
    'pessoas.folha.importar',
    'Importar o retorno da folha externa (folha líquida e encargos) e conferir contagem e soma',

    { categoria: 'financeira', criticidade: 'sensivel' },
  ),
  // M53.2 (D-ABRIR-532): o item `Gestão de pessoas > Folha de pagamento` e as duas telas da área (a folha da competência
  // e as rubricas e tabelas legais) abrem para quem tem QUALQUER parte da área no outro sistema: a folha mensal (as
  // opções de `pessoas.folha.ler`), os eventos (367/368, `pessoas.rubrica.ler`), a tabela de cálculo (370,
  // `pessoas.tabelaLegalFolha.ler`), os parâmetros (355) ou a integração (371). Só abre a área e o apoio (rótulos e o
  // estado da gravação): cada aba e cada dado seguem pedindo a sua permissão.
  p(
    'pessoas.folha.abrir',
    'Abrir a área da folha de pagamento (menu e telas); cada parte pede a sua permissão de consulta',
  ),
  // M53.1 (D-AFAST-531): o afastamento (motivo do domínio de afastamentos) é registrado no novo; a exportação o leva.
  p(
    'pessoas.afastamento.registrar',
    'Registrar, encerrar e cancelar o afastamento do colaborador (motivo, início e fim)',

    { criticidade: 'sensivel' },
  ),
  // M53.3 (F2, cálculo mensal). D-PERM-533 (POL-5): o salário contratual é dado do colaborador que só o departamento
  // pessoal vê (permissão própria, sensível, e não `pessoas.folha.ler`); quem processa a folha no outro sistema vê o
  // salário que entra nela. Os parâmetros da folha por empresa (percentuais, alíquotas patronais, papéis das rubricas)
  // seguem a opção dos parâmetros do módulo.
  p(
    'pessoas.folha.calcular',
    'Calcular, recalcular e descartar a folha mensal da competência (prévia e processamento gravado)',

    { categoria: 'financeira', criticidade: 'sensivel' },
  ),
  p(
    'pessoas.salario.ler',
    'Consultar o salário contratual do colaborador (vigências, dependentes e adicionais)',

    { criticidade: 'sensivel' },
  ),
  p(
    'pessoas.salario.editar',
    'Registrar nova vigência do salário contratual do colaborador (valor, dependentes e adicionais)',

    { categoria: 'financeira', criticidade: 'sensivel' },
  ),
  p(
    'pessoas.parametroFolha.editar',
    'Registrar nova vigência dos parâmetros da folha da empresa (percentuais, alíquotas patronais e rubricas do cálculo)',

    { categoria: 'financeira', criticidade: 'sensivel' },
  ),
  // M53.4 (F3, férias e 13º). D-PERM-534 (POL-5): consultar os períodos e a escala de férias não revela salário
  // (`pessoas.ferias.ler`, normal); os valores do recibo seguem `pessoas.salario.ler` (D-PERM-SAL-533). Programar (datas,
  // abono) e calcular o recibo são permissões separadas, como no outro sistema (lançamento × liberação de férias); o 13º
  // da empresa é processamento como a folha mensal (lista, detalhe e descarte pelas rotas do cálculo).
  p(
    'pessoas.ferias.ler',
    'Consultar os períodos aquisitivos, o saldo e a escala de férias dos colaboradores',
  ),
  p(
    'pessoas.ferias.programar',
    'Programar e cancelar as férias do colaborador (frações, abono pecuniário e adiantamento do 13º)',
  ),
  p(
    'pessoas.ferias.calcular',
    'Calcular, gravar e cancelar o recibo de férias do colaborador',

    { categoria: 'financeira', criticidade: 'sensivel' },
  ),
  p(
    'pessoas.decimo.calcular',
    'Calcular e descartar as parcelas do 13º salário da empresa (adiantamento e parcela final)',

    { categoria: 'financeira', criticidade: 'sensivel' },
  ),
  // M53.5 (F4, rescisão). D-PERM-535 (POL-5): consultar as rescisões e a fila dos desligados (datas, modalidade, situação)
  // não revela salário (`pessoas.rescisao.ler`, normal); os valores do termo seguem `pessoas.salario.ler` (D-PERM-SAL-533).
  // Calcular, gravar, recalcular e cancelar a rescisão é a permissão sensível, como o lançamento de rescisão do outro sistema.
  p('pessoas.rescisao.ler', 'Consultar os colaboradores desligados e as rescisões calculadas'),
  p(
    'pessoas.rescisao.calcular',
    'Calcular, gravar, recalcular e cancelar a rescisão do colaborador desligado',

    { categoria: 'financeira', criticidade: 'sensivel' },
  ),
  // M53.6 (F5, eSocial de tabela e não periódicos). D-PERM-536 (POL-5): a ficha propõe só `pessoas.esocial.ler` e
  // `.transmitir`; gerar o evento (e gravar a ficha do eSocial do colaborador e os parâmetros do empregador) é decisão
  // própria, sensível, porque o XML leva CPF, nome e endereço, como as tabelas e os parâmetros do módulo do outro
  // sistema. Consultar a lista de eventos, os lotes, as pendências e a conciliação não revela dado pessoal (normal).
  // Transmitir (montar e enviar lotes, registrar o retorno) é o painel de envio do outro sistema: em `producao` só com a
  // chave `pessoas.esocial` ligada (certificado do empregador como pré-requisito).
  p('pessoas.esocial.ler', 'Consultar os eventos, os lotes, as pendências e a conciliação do eSocial'),
  p(
    'pessoas.esocial.gerar',
    'Gerar e descartar eventos do eSocial, ver o XML e gravar a ficha do eSocial do colaborador e os parâmetros do empregador',

    { criticidade: 'sensivel' },
  ),
  p(
    'pessoas.esocial.transmitir',
    'Montar, enviar e cancelar lotes do eSocial e registrar o retorno (em produção, só com a transmissão liberada)',

    { criticidade: 'sensivel' },
  ),
  // M53.7 (F6, periódicos e fechamento). Fechar o período fixa a folha (nenhum recálculo até a reabertura) e libera os
  // periódicos do eSocial; reabrir desfaz isso, com motivo. É a liberação do mês e a abertura do mês/ano do outro
  // sistema. Gerar os periódicos segue `pessoas.esocial.gerar`; o S-1299 e o S-1298 também.
  p(
    'pessoas.folha.fechar',
    'Fechar e reabrir o período da folha (mensal e 13º) para os periódicos do eSocial',

    { categoria: 'financeira', criticidade: 'sensivel' },
  ),
  // M53.8 (F7, FGTS Digital e obrigações legais). Consultar as obrigações geradas, os parâmetros e a apuração do FGTS
  // (quantidades; os valores seguem `pessoas.salario.ler`) é o relatório do FGTS e os aplicativos do outro sistema.
  // D-PERM-OBR-538 (POL-5): gerar o arquivo, baixá-lo (leva CPF, NIS, nome e remuneração), registrar a entrega e gravar
  // os parâmetros das obrigações é a exportação delas: sensível.
  p(
    'pessoas.obrigacao.ler',
    'Consultar as obrigações legais geradas (FGTS Digital, SEFIP, CAGED e RAIS), os parâmetros e a apuração do FGTS',
  ),
  p(
    'pessoas.obrigacao.gerar',
    'Gerar e baixar os arquivos das obrigações legais, registrar a entrega e gravar os parâmetros das obrigações',

    { criticidade: 'sensivel' },
  ),
  // M53.9 (F8, títulos e fatos contábeis). Consultar a integração (o de-para, os lançamentos, o custo de pessoal por
  // centro de custo) é quem tem qualquer parte da integração no outro sistema. Configurar o de-para (credor,
  // classificação e vencimento de cada rotina) é a tabela de integração da folha (D-PERM-INTG-539: permissão própria,
  // porque decide para quem o dinheiro vai). Lançar os títulos é a rotina de integração (financeira, sensível).
  p(
    'pessoas.integracao.ler',
    'Consultar a integração da folha com o financeiro e o contábil (de-para, títulos lançados, custo de pessoal)',
  ),
  p(
    'pessoas.integracao.configurar',
    'Configurar o de-para da folha para o contas a pagar (credor, classificação gerencial e vencimento por rotina)',

    { categoria: 'financeira', criticidade: 'sensivel' },
  ),
  p(
    'pessoas.integracao.lancar',
    'Lançar no contas a pagar os títulos da folha (líquido e encargos) de um período fechado ou de um retorno conferido',

    { categoria: 'financeira', criticidade: 'sensivel' },
  ),
];
