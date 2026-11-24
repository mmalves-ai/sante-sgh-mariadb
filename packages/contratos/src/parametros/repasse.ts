// Parâmetros do repasse médico (M33; ficha, regras 2, 4, 6 e 7; DP-33 parte "Repasse" sem resposta → POL-1 com o
// padrão de mercado de respostas/faturamento.md, FAT-10, ou o que os dados da cópia mostram). A resposta da DP-33
// troca o valor sem mudar código. As tabelas de INSS, IRRF e ISS não têm padrão: sem a tabela vigente definida, o RPA
// não é emitido (nunca constante no código, regra 7).
import type { DefinicaoParametro } from './definicoes.js';

const PAR_DE_TABELA =
  '^$|^\\d+(\\.\\d{1,2})?:\\d{1,2}(\\.\\d{1,2})?:\\d+(\\.\\d{1,2})?(;\\d+(\\.\\d{1,2})?:\\d{1,2}(\\.\\d{1,2})?:\\d+(\\.\\d{1,2})?)*$';

export const PARAMETROS_REPASSE: readonly DefinicaoParametro[] = [
  {
    chave: 'repasse.douradoMetaPct',
    modulo: 'repasse',
    descricao:
      'Meta de acerto do teste dourado do repasse (itens recalculados iguais ao gravado), em %; a aprovar até a DP-33',
    tipo: 'inteiro',
    padrao: '97',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 50,
    maximo: 100,
    dono: 'repasse',
    origem: 'ficha do M33, regra 2 (padrão igual à régua de honorários do M30; "a aprovar" até a DP-33)',
  },
  {
    chave: 'repasse.basePadrao',
    modulo: 'repasse',
    descricao: 'Base do repasse quando a regra não diz: cobrado, recebido (pago + recurso deferido) ou misto',
    tipo: 'lista',
    padrao: 'cobrado',
    opcoes: ['cobrado', 'recebido', 'misto'],
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    dono: 'repasse',
    origem:
      'ficha do M33, regra 4; DP-33 sem resposta: a base foi inferida dos dados (no pc, só as linhas de valor faturado da apuração têm valor); o padrão de mercado (FAT-10) é o recebido',
  },
  {
    chave: 'repasse.estornoEmGlosa',
    modulo: 'repasse',
    descricao: 'Glosa mantida depois do repasse gera estorno no período seguinte',
    tipo: 'booleano',
    padrao: 'true',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    dono: 'repasse',
    origem: 'ficha do M33, regras 6 e "Estorno não apaga"; FAT-10 (POL-1): glosa mantida estorna o repasse',
  },
  {
    chave: 'repasse.momentoProducao',
    modulo: 'repasse',
    descricao:
      'Quando o item da conta com profissional executor vira produção do repasse: no lançamento do item ou no fechamento da conta',
    tipo: 'lista',
    padrao: 'lancamento',
    opcoes: ['lancamento', 'fechamento'],
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    dono: 'repasse',
    origem:
      'F3, motores (docs/analise/06: a produção do repasse nasce do item faturado); prática de mercado: produção no lançamento, com o fechamento completando o que faltou',
  },
  {
    chave: 'repasse.adicionalModo',
    modulo: 'repasse',
    descricao:
      'Como o adicional de feriado e de fim de semana da regra entra: sobre o valor (valor × (1 + adicional)) ou somado em pontos ao percentual',
    tipo: 'lista',
    padrao: 'sobre-valor',
    opcoes: ['sobre-valor', 'pontos'],
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    dono: 'repasse',
    origem:
      'ficha do M33, regra 6; FAT-10 (POL-1): acréscimo da regra. No pc nenhuma regra usa adicional (0 de 105.430)',
  },
  {
    chave: 'repasse.feriados',
    modulo: 'repasse',
    descricao: 'Feriados que valem para o adicional de feriado (datas AAAA-MM-DD separadas por vírgula)',
    tipo: 'texto',
    padrao: '',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    formato: {
      expressao: '^$|^\\d{4}-\\d{2}-\\d{2}(,\\d{4}-\\d{2}-\\d{2})*$',
      mensagem: 'Use datas AAAA-MM-DD separadas por vírgula (ex.: 2026-12-25,2027-01-01).',
    },
    dono: 'repasse',
    origem: 'ficha do M33, regra 6 (sem padrão: sem feriado cadastrado, só o fim de semana conta)',
  },
  {
    chave: 'repasse.inssAliquotaPct',
    modulo: 'repasse',
    descricao:
      'Alíquota do INSS retido do contribuinte individual no RPA, em % (vigência pelo valor do parâmetro)',
    tipo: 'texto',
    padrao: '',
    niveis: ['estabelecimento', 'empresa', 'rede'],
    critico: true,
    formato: { expressao: '^$|^\\d{1,2}(\\.\\d{1,2})?$', mensagem: 'Use a alíquota em % (ex.: 11).' },
    dono: 'contas a pagar',
    origem: 'ficha do M33, regra 7 (sem padrão: o RPA não é emitido sem a alíquota vigente)',
  },
  {
    chave: 'repasse.inssTeto',
    modulo: 'repasse',
    descricao:
      'Teto do salário de contribuição do INSS no mês, em reais (o acúmulo entre as empresas que somam impostos conta)',
    tipo: 'texto',
    padrao: '',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    formato: { expressao: '^$|^\\d{1,6}(\\.\\d{1,2})?$', mensagem: 'Use o valor em reais (ex.: 8157.41).' },
    dono: 'contas a pagar',
    origem: 'ficha do M33, regra 7 (sem padrão)',
  },
  {
    chave: 'repasse.irrfTabela',
    modulo: 'repasse',
    descricao:
      'Tabela progressiva do IRRF vigente: faixas "até:alíquota:dedução" separadas por ponto e vírgula, a última com até 0 (sem limite)',
    tipo: 'texto',
    padrao: '',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    formato: {
      expressao: PAR_DE_TABELA,
      mensagem: 'Use até:alíquota:dedução por faixa (ex.: 2428.80:0:0;2826.65:7.5:182.16;0:27.5:908.73).',
    },
    dono: 'contas a pagar',
    origem: 'ficha do M33, regra 7 (sem padrão)',
  },
  {
    chave: 'repasse.issAliquotaPct',
    modulo: 'repasse',
    descricao: 'Alíquota do ISS do município retido no RPA, em %',
    tipo: 'texto',
    padrao: '',
    niveis: ['estabelecimento', 'empresa', 'rede'],
    critico: true,
    formato: { expressao: '^$|^\\d{1,2}(\\.\\d{1,2})?$', mensagem: 'Use a alíquota em % (ex.: 5).' },
    dono: 'contas a pagar',
    origem: 'ficha do M33, regra 7 (sem padrão; ISS do município do estabelecimento)',
  },
];
