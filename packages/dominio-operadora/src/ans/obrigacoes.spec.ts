// Etapa 7 do M56 (F6): as obrigações com a ANS. Dados SINTÉTICOS (documentos com dígito calculado sobre base inventada).
import { MENSAGENS_ANS } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { numeroCarteirinha } from '../carteirinha.js';
import type { DadosElegibilidade } from '../elegibilidade.js';
import { cnsDefinitivoSintetico, cpfSintetico } from '../sinteticos.js';
import {
  bloqueiaArquivo,
  competenciaEncerrada,
  documentoXml,
  el,
  escaparXml,
  mesesDoPeriodo,
  nomeArquivoAns,
  periodoDaCompetencia,
  planoDaGeracao,
  problema,
} from './comum.js';
import { arquivoDiops, faixaDeAtraso, problemasDiops, quadrosDiops } from './diops.js';
import { acoesDoEnvio, problemasDaTransmissao } from './envio.js';
import {
  arquivoMonitoramento,
  type GuiaMonitoramento,
  problemasMonitoramento,
  quadrosMonitoramento,
} from './monitoramento.js';
import {
  analisarAtendimentoSus,
  arquivoRessarcimento,
  type ItemRessarcimento,
  mensagemAns,
  noPrazo,
  prazoImpugnacao,
  problemasDaDecisao,
  problemasDoAviso,
  quadrosRessarcimento,
  todosDecididos,
  valorDevido,
} from './ressarcimento.js';
import { resultadoDoRetorno } from './retorno.js';
import {
  arquivoSib,
  type BeneficiarioSib,
  ccoSimulado,
  type MovimentoDerivado,
  ccoValido,
  descricaoMovimentoSib,
  movimentoSib,
  municipioValido,
  problemasSib,
  retratoSib,
  selecionarMovimentosSib,
  ufDoMunicipio,
} from './sib.js';
import {
  agregarSip,
  arquivoSip,
  GRUPO_DEMAIS_DESPESAS,
  grupoSipNaData,
  type ItemSip,
  quadrosSip,
} from './sip.js';
import { arquivoTps, calcularTps, quadrosTps, totalConfere, valorTpsVigente } from './tps.js';

const CAB = {
  registroAns: '999999',
  cnpj: '00000000000191',
  competencia: '2026-09',
  sequencial: 1,
  geradoEm: '2026-10-05',
  destino: 'simulador' as const,
};

const COMPLEMENTO = {
  logradouro: 'Rua Sintética',
  numero: '10',
  complemento: null,
  bairro: 'Centro',
  municipio: 4314902,
  cep: '90000000',
  resideExterior: false,
  dnv: null,
  coberturaParcial: false,
  itensExcluidos: false,
  cco: null,
  motivoCancelamento: null,
};

function benef(x: Partial<BeneficiarioSib> & { id: number }): BeneficiarioSib {
  return {
    carteirinha: String(1000000000000000 + x.id),
    nome: `PESSOA SINTETICA ${x.id}`,
    nascimento: '1980-05-10',
    sexo: 'F',
    cpf: cpfSintetico(String(100000000 + x.id).slice(0, 9)),
    cns: null,
    nomeMae: 'MAE SINTETICA',
    vinculo: 1,
    titular: null,
    inclusao: '2026-09-01',
    situacao: 'ativo',
    exclusao: null,
    produto: { id: 1, natureza: 'plano', registroAns: '123456789' },
    contrato: { id: 1, numero: 'C-1', tipo: 1, contratanteDoc: '00000000191' },
    complemento: COMPLEMENTO,
    ...x,
  };
}

describe('comum', () => {
  it('período, meses e competência encerrada', () => {
    expect(periodoDaCompetencia('SIB', '2026-02')).toEqual({ inicio: '2026-02-01', fim: '2026-02-28' });
    expect(periodoDaCompetencia('SIP', '2026-T4')).toEqual({ inicio: '2026-10-01', fim: '2026-12-31' });
    expect(periodoDaCompetencia('RESSARCIMENTO_SUS', '2026-10-02')).toEqual({
      inicio: '2026-10-02',
      fim: '2026-10-02',
    });
    expect(() => periodoDaCompetencia('SIP', '2026-09')).toThrow();
    expect(mesesDoPeriodo({ inicio: '2026-11-01', fim: '2027-01-31' }).map((m) => m.mes)).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
    ]);
    expect(competenciaEncerrada('SIB', '2026-09', '2026-09-30')).toBe(false);
    expect(competenciaEncerrada('SIB', '2026-09', '2026-10-01')).toBe(true);
    expect(competenciaEncerrada('RESSARCIMENTO_SUS', '2026-10-02', '2026-10-02')).toBe(true);
  });

  it('XML escapado, elemento vazio e opcional ausente', () => {
    expect(escaparXml(`a<b>&"'`)).toBe('a&lt;b&gt;&amp;&quot;&apos;');
    const x = documentoXml(el('raiz', [el('vazio'), el('t', 'A & B', { k: 'v"' }), null, [el('n', 1)]]));
    expect(x).toContain('<vazio/>');
    expect(x).toContain('<t k="v&quot;">A &amp; B</t>');
    expect(x).toContain('<n>1</n>');
    expect(x.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });

  it('nome do arquivo e o problema com a mensagem', () => {
    expect(nomeArquivoAns('SIB', '999999', '2026-09', 2)).toBe('SIB_999999_202609_002.xml');
    expect(nomeArquivoAns('MONITORAMENTO_TISS', '999999', '2026-09', 1)).toBe('MON_999999_202609_001.xml');
    expect(nomeArquivoAns('RESSARCIMENTO_SUS', '999999', '2026-10-02', 1)).toBe(
      'RES_999999_20261002_001.xml',
    );
    expect(problema('sem-cco', 'item', 'x').mensagem).toBe(MENSAGENS_ANS['sem-cco']);
    expect(problema('desconhecido').mensagem).toBe('desconhecido');
    expect(bloqueiaArquivo([problema('a', 'item')])).toBe(false);
    expect(bloqueiaArquivo([problema('a')])).toBe(true);
  });

  it('plano da geração: enviado bloqueia, gerado é substituído, aceito vira retificador', () => {
    const e = (
      id: number,
      situacao: 'gerado' | 'enviado' | 'aceito',
      competencia = '2026-T3',
      obrigacao = 'SIP' as const,
    ) => ({
      id,
      obrigacao,
      competencia,
      sequencial: id,
      situacao,
    });
    expect(planoDaGeracao('SIP', '2026-T3', [])).toEqual({
      recusa: null,
      sequencial: 1,
      substituir: [],
      retificador: false,
    });
    expect(planoDaGeracao('SIP', '2026-T3', [e(1, 'enviado')])).toEqual({ recusa: 'aguardando-retorno' });
    expect(planoDaGeracao('SIP', '2026-T3', [e(1, 'aceito'), e(2, 'gerado')])).toEqual({
      recusa: null,
      sequencial: 3,
      substituir: [2],
      retificador: true,
    });
    expect(planoDaGeracao('SIP', '2026-T3', [e(1, 'enviado', '2026-T2')])).toMatchObject({
      recusa: null,
      sequencial: 1,
    });
    // SIB: a operadora inteira (os movimentos são contra o último aceito).
    const sib = {
      id: 7,
      obrigacao: 'SIB' as const,
      competencia: '2026-08',
      sequencial: 1,
      situacao: 'enviado' as const,
    };
    expect(planoDaGeracao('SIB', '2026-09', [sib])).toEqual({ recusa: 'aguardando-retorno' });
    expect(planoDaGeracao('SIB', '2026-09', [{ ...sib, situacao: 'gerado' }])).toEqual({
      recusa: null,
      sequencial: 1,
      substituir: [7],
      retificador: false,
    });
  });
});

describe('envio: ações e transmissão', () => {
  it('ações por situação', () => {
    expect(acoesDoEnvio({ obrigacao: 'SIB', situacao: 'gerado', temArquivo: true, pago: false })).toEqual([
      'baixar',
      'transmitir',
    ]);
    expect(
      acoesDoEnvio({ obrigacao: 'RESSARCIMENTO_SUS', situacao: 'gerado', temArquivo: false, pago: false }),
    ).toEqual(['decidir']);
    expect(
      acoesDoEnvio({
        obrigacao: 'RESSARCIMENTO_SUS',
        situacao: 'gerado',
        temArquivo: false,
        pago: false,
        decidido: true,
      }),
    ).toEqual(['transmitir', 'decidir']);
    expect(acoesDoEnvio({ obrigacao: 'SIB', situacao: 'enviado', temArquivo: true, pago: false })).toEqual([
      'baixar',
      'retorno',
    ]);
    expect(acoesDoEnvio({ obrigacao: 'TPS', situacao: 'aceito', temArquivo: true, pago: false })).toEqual([
      'baixar',
      'pagar',
    ]);
    expect(acoesDoEnvio({ obrigacao: 'TPS', situacao: 'aceito', temArquivo: true, pago: true })).toEqual([
      'baixar',
    ]);
    expect(acoesDoEnvio({ obrigacao: 'SIP', situacao: 'aceito', temArquivo: true, pago: false })).toEqual([
      'baixar',
    ]);
  });

  it('recibo só na ANS', () => {
    expect(problemasDaTransmissao('ans', ' ')).toEqual(['sem-recibo']);
    expect(problemasDaTransmissao('ans', 'R1')).toEqual([]);
    expect(problemasDaTransmissao('simulador', 'R1')).toEqual(['recibo-no-simulador']);
    expect(problemasDaTransmissao('simulador', null)).toEqual([]);
  });
});

describe('SIB', () => {
  it('movimentos: inclusão, cancelamento, reativação, mudança contratual, retificação e nada', () => {
    const b = benef({ id: 1 });
    expect(movimentoSib(b, null)).toEqual({ movimento: 'inclusao', campos: [] });
    expect(movimentoSib({ ...b, situacao: 'excluido', exclusao: '2026-09-10' }, null)).toBeNull();
    expect(movimentoSib({ ...b, produto: { ...b.produto, natureza: 'cartaoDesconto' } }, null)).toBeNull();
    const aceito = retratoSib(b);
    expect(movimentoSib(b, aceito)).toBeNull();
    expect(movimentoSib({ ...b, situacao: 'suspenso' }, aceito)).toBeNull();
    expect(movimentoSib({ ...b, situacao: 'excluido', exclusao: '2026-09-10' }, aceito)?.movimento).toBe(
      'cancelamento',
    );
    const cancelado = { ...aceito, ativo: false };
    expect(movimentoSib(b, cancelado)?.movimento).toBe('reativacao');
    expect(movimentoSib({ ...b, situacao: 'excluido' }, cancelado)).toBeNull();
    expect(
      movimentoSib({ ...b, produto: { ...b.produto, registroAns: '987654321' } }, aceito)?.movimento,
    ).toBe('mudancaContratual');
    const r = movimentoSib(
      { ...b, nome: 'OUTRO NOME', complemento: { ...COMPLEMENTO, cep: '91000000' } },
      aceito,
    );
    expect(r).toEqual({ movimento: 'retificacao', campos: ['nome', 'cep'] });
    expect(descricaoMovimentoSib(r!)).toBe('Retificação: Nome, CEP');
    expect(descricaoMovimentoSib({ movimento: 'inclusao', campos: [] })).toBe('Inclusão');
  });

  it('conferência do beneficiário', () => {
    const hoje = '2026-10-05';
    const inc: MovimentoDerivado = { movimento: 'inclusao', campos: [] };
    expect(problemasSib(benef({ id: 1 }), inc, hoje)).toEqual([]);
    const cods = (b: BeneficiarioSib, m = inc, t?: Set<number>) =>
      problemasSib(b, m, hoje, t).map((p) => p.codigo);
    expect(cods(benef({ id: 1, cpf: null }))).toEqual(['cpf-obrigatorio']);
    expect(cods(benef({ id: 1, cpf: '12345678900' }))).toEqual(['cpf-invalido']);
    expect(cods(benef({ id: 1, cpf: null, nascimento: '2020-01-01' }))).toEqual(['sem-identificacao-menor']);
    expect(
      cods(benef({ id: 1, cpf: null, nascimento: '2020-01-01', cns: cnsDefinitivoSintetico('12345678901') })),
    ).toEqual([]);
    expect(cods(benef({ id: 1, cns: '123' }))).toEqual(['cns-invalido']);
    expect(cods(benef({ id: 1, complemento: null }))).toEqual(['sem-endereco']);
    expect(cods(benef({ id: 1, complemento: { ...COMPLEMENTO, municipio: 9999999 } }))).toEqual([
      'municipio-invalido',
    ]);
    expect(
      cods(benef({ id: 1, complemento: { ...COMPLEMENTO, logradouro: null, resideExterior: true } })),
    ).toEqual([]);
    expect(cods(benef({ id: 1, produto: { id: 1, natureza: 'plano', registroAns: null } }))).toEqual([
      'sem-registro-plano',
    ]);
    expect(cods(benef({ id: 1, contrato: { id: 1, numero: 'C', tipo: 2, contratanteDoc: '123' } }))).toEqual([
      'contratante-sem-cnpj',
    ]);
    const dep = benef({ id: 2, vinculo: 3, titular: { id: 1, carteirinha: '1', cco: null } });
    expect(cods(dep)).toEqual(['titular-sem-cco']);
    expect(cods(dep, inc, new Set([1]))).toEqual([]);
    const ret = { movimento: 'retificacao' as const, campos: ['nome' as const] };
    expect(cods(benef({ id: 1 }), ret)).toEqual(['sem-cco']);
    expect(cods(benef({ id: 1, complemento: { ...COMPLEMENTO, cco: '12' } }), ret)).toEqual(['cco-invalido']);
    const canc = { movimento: 'cancelamento' as const, campos: [] };
    expect(
      cods(benef({ id: 1, cpf: null, complemento: { ...COMPLEMENTO, cco: '123456789012' } }), canc),
    ).toEqual(['sem-motivo-cancelamento']);
  });

  it('seleção: titular antes do dependente, pendente fora, teto do arquivo', () => {
    const t = benef({ id: 10 });
    const d = benef({ id: 5, vinculo: 3, titular: { id: 10, carteirinha: t.carteirinha, cco: null } });
    const sem = benef({ id: 3, cpf: null });
    const extra = benef({ id: 20 });
    const s = selecionarMovimentosSib([d, sem, t, extra], new Map(), '2026-10-05', 2);
    expect(s.movimentos.map((m) => m.beneficiario.id)).toEqual([10, 5]);
    expect(s.movimentos.map((m) => m.ordem)).toEqual([1, 2]);
    expect(s.pendentes.map((p) => p.beneficiario.id)).toEqual([3]);
    expect(s.excedentes).toBe(1);
  });

  it('arquivo com inclusão, retificação e cancelamento', () => {
    const b = benef({ id: 1, complemento: { ...COMPLEMENTO, cco: '123456789012', motivoCancelamento: 8 } });
    const x = arquivoSib(CAB, [
      { ordem: 1, beneficiario: b, movimento: { movimento: 'inclusao', campos: [] }, retrato: retratoSib(b) },
      {
        ordem: 2,
        beneficiario: b,
        movimento: { movimento: 'retificacao', campos: ['nome'] },
        retrato: retratoSib(b),
      },
      {
        ordem: 3,
        beneficiario: { ...b, situacao: 'excluido', exclusao: '2026-09-20' },
        movimento: { movimento: 'cancelamento', campos: [] },
        retrato: retratoSib(b),
      },
    ]);
    expect(x).toContain('<mensagemSIB>');
    expect(x).toContain('<inclusao ordem="1" tipoMovimento="1">');
    expect(x).toContain('<campo>2</campo>');
    expect(x).toContain('<motivoCancelamento>8</motivoCancelamento>');
    expect(x).toContain('<quantidadeRegistros>3</quantidadeRegistros>');
    expect(x).toContain('<numeroPlanoANS>123456789</numeroPlanoANS>');
  });

  it('CCO, município e UF', () => {
    expect(ccoValido('123456789012')).toBe(true);
    expect(ccoValido('12345')).toBe(false);
    expect(ccoSimulado(42)).toBe('990000000042');
    expect(municipioValido(4314902)).toBe(true);
    expect(municipioValido(999)).toBe(false);
    expect(ufDoMunicipio(4314902)).toBe('43');
    expect(ufDoMunicipio(null)).toBeNull();
  });
});

describe('retorno da ANS', () => {
  const itens = [
    { id: 1, ordem: 1, tipo: 'inclusao', beneficiario: 10 },
    { id: 2, ordem: 2, tipo: 'retificacao', beneficiario: 11 },
  ];
  it('simulado: tudo aceito, CCO sintético na inclusão', () => {
    const r = resultadoDoRetorno('SIB', 'simulador', itens, { simular: true });
    expect(r).toMatchObject({ situacao: 'aceito' });
    if ('situacao' in r) expect(r.itens[0]?.cco).toBe(ccoSimulado(10));
    expect(resultadoDoRetorno('SIB', 'ans', itens, { simular: true }).problemas).toEqual([
      'simular-so-fora-de-producao',
    ]);
  });
  it('rejeitado, parcial, item de outro envio e CCO obrigatório', () => {
    expect(resultadoDoRetorno('SIP', 'ans', itens, { rejeitado: true })).toMatchObject({
      situacao: 'rejeitado',
    });
    const p = resultadoDoRetorno('SIB', 'ans', itens, {
      itens: [
        { ordem: 1, aceito: true, cco: '123456789012' },
        { ordem: 2, aceito: false, erro: 'campo inválido' },
      ],
    });
    expect(p).toMatchObject({ situacao: 'aceitoParcial' });
    if ('situacao' in p)
      expect(p.itens[1]).toEqual({ id: 2, aceito: false, cco: null, erro: 'campo inválido' });
    expect(
      resultadoDoRetorno('SIB', 'ans', itens, { itens: [{ ordem: 9, aceito: true }] }).problemas,
    ).toEqual(['item-de-outro-envio']);
    expect(resultadoDoRetorno('SIB', 'ans', itens, {}).problemas).toEqual(['cco-obrigatorio']);
    expect(
      resultadoDoRetorno('SIB', 'ans', itens, {
        itens: [
          { ordem: 1, aceito: false },
          { ordem: 2, aceito: false },
        ],
      }),
    ).toMatchObject({ situacao: 'rejeitado' });
  });
});

describe('SIP', () => {
  const vig = [
    { procedimento: 10101012, grupo: 3, inicio: '2010-01-01', fim: null },
    { procedimento: 40301010, grupo: 7, inicio: '2010-01-01', fim: '2020-12-31' },
  ];
  const item = (x: Partial<ItemSip>): ItemSip => ({
    beneficiario: 1,
    segmentacao: 'ambulatorial',
    uf: '43',
    dataExecucao: '2026-08-10',
    tabela: '22',
    codigo: '10101012',
    quantidade: 1,
    despesaCentavos: 10000,
    ...x,
  });
  it('grupo na data e agregação com os não classificados', () => {
    expect(grupoSipNaData(vig, 10101012, '2026-08-10')).toBe(3);
    expect(grupoSipNaData(vig, 40301010, '2026-08-10')).toBeNull();
    const r = agregarSip(
      [
        item({}),
        item({ beneficiario: 2, despesaCentavos: 5050 }),
        item({ codigo: '40301010' }),
        item({ tabela: '19', codigo: '123', uf: null }),
      ],
      vig,
      { ambulatorial: 40 },
    );
    expect(r.linhas).toEqual([
      {
        grupo: GRUPO_DEMAIS_DESPESAS,
        segmentacao: 'ambulatorial',
        uf: '43',
        eventos: 1,
        quantidade: 1,
        beneficiarios: 1,
        despesaCentavos: 10000,
      },
      {
        grupo: GRUPO_DEMAIS_DESPESAS,
        segmentacao: 'ambulatorial',
        uf: 'NI',
        eventos: 1,
        quantidade: 1,
        beneficiarios: 1,
        despesaCentavos: 10000,
      },
      {
        grupo: 3,
        segmentacao: 'ambulatorial',
        uf: '43',
        eventos: 2,
        quantidade: 2,
        beneficiarios: 2,
        despesaCentavos: 15050,
      },
    ]);
    expect(r.naoClassificados).toEqual([{ codigo: '40301010', eventos: 1 }]);
    expect(r.problemas.map((p) => p.codigo)).toEqual(['procedimento-sem-grupo']);
    const q = quadrosSip(r, new Map([[3, 'Consultas']]));
    expect(q[0]?.parcelas.map((p) => p.rotulo)).toEqual(['0 Demais despesas', '3 Consultas']);
    expect(q[0]?.total).toEqual({ rotulo: 'Total', valor: 350.5, quantidade: 4 });
    expect(totalConfere(q[0]!)).toBe(true);
    expect(q[1]?.total.quantidade).toBe(40);
    expect(
      quadrosSip(agregarSip([item({ codigo: '10101012' })], [{ ...vig[0]!, grupo: 9 }], {}), new Map())[0]
        ?.parcelas[0]?.rotulo,
    ).toBe('9 Grupo 9');
    const x = arquivoSip({ ...CAB, competencia: '2026-T3' }, r);
    expect(x).toContain('<grupo codigo="3" segmentacao="ambulatorial" uf="43">');
    expect(x).toContain('<despesa>150.50</despesa>');
  });
});

describe('DIOPS', () => {
  const periodo = { inicio: '2026-07-01', fim: '2026-09-30' };
  const balancete = {
    ativo: 1000,
    passivo: 600,
    patrimonioLiquido: 400,
    provisoesTecnicas: 100,
    responsavel: 'CONTADOR SINTETICO',
  };
  it('balancete equilibrado e faixas de atraso', () => {
    expect(problemasDiops(null).map((p) => p.codigo)).toEqual(['sem-balancete']);
    expect(problemasDiops(balancete)).toEqual([]);
    expect(problemasDiops({ ...balancete, ativo: 1000.01 }).map((p) => p.codigo)).toEqual([
      'balancete-desequilibrado',
    ]);
    expect(faixaDeAtraso('2026-09-10', '2026-09-30')).toBe('Até 30 dias');
    expect(faixaDeAtraso('2026-08-10', '2026-09-30')).toBe('De 31 a 60 dias');
    expect(faixaDeAtraso('2026-07-10', '2026-09-30')).toBe('De 61 a 90 dias');
    expect(faixaDeAtraso('2026-01-10', '2026-09-30')).toBe('Mais de 90 dias');
  });
  it('quadros com as parcelas e o arquivo', () => {
    const q = quadrosDiops({
      periodo,
      cobrancas: [
        {
          tipo: 1,
          competencia: '2026-07',
          valor: 300,
          situacao: 'paga',
          vencimento: '2026-07-10',
          pagoEm: '2026-07-09',
          valorPago: 300,
        },
        {
          tipo: 1,
          competencia: '2026-08',
          valor: 300,
          situacao: 'aberta',
          vencimento: '2026-08-10',
          pagoEm: null,
          valorPago: null,
        },
        {
          tipo: 2,
          competencia: '2026-09',
          valor: 50,
          situacao: 'paga',
          vencimento: '2026-09-10',
          pagoEm: '2026-10-02',
          valorPago: 50,
        },
        {
          tipo: 1,
          competencia: '2026-09',
          valor: 300,
          situacao: 'cancelada',
          vencimento: '2026-09-10',
          pagoEm: null,
          valorPago: null,
        },
        {
          tipo: 1,
          competencia: '2026-06',
          valor: 300,
          situacao: 'paga',
          vencimento: '2026-06-10',
          pagoEm: '2026-07-01',
          valorPago: 310,
        },
        {
          tipo: 9,
          competencia: '2026-07',
          valor: 1,
          situacao: 'renegociada',
          vencimento: '2026-07-10',
          pagoEm: null,
          valorPago: null,
        },
      ],
      contas: [
        { recebidaEm: '2026-08-01', apresentado: 1000, glosado: 100, situacao: 'paga' },
        { recebidaEm: '2026-08-02', apresentado: 500, glosado: 0, situacao: 'devolvida' },
        { recebidaEm: '2026-10-02', apresentado: 500, glosado: 0, situacao: 'recebida' },
      ],
      pagamentos: [
        { pagoEm: '2026-09-15', valor: 900 },
        { pagoEm: '2026-10-15', valor: 1 },
      ],
      beneficiarios: { 1: 30, 2: 10 },
      balancete,
    });
    expect(q.map((x) => x.titulo)).toHaveLength(7);
    expect(q[0]?.parcelas).toEqual([
      { rotulo: 'Mensalidade', valor: 600, quantidade: 2 },
      { rotulo: 'Coparticipação avulsa', valor: 50, quantidade: 1 },
      { rotulo: 'Tipo 9', valor: 1, quantidade: 1 },
    ]);
    expect(q[1]?.total).toEqual({ rotulo: 'Total', valor: 610, quantidade: 2 });
    expect(q[2]?.parcelas).toEqual([
      { rotulo: 'De 31 a 60 dias', valor: 300, quantidade: 1 },
      { rotulo: 'Até 30 dias', valor: 50, quantidade: 1 },
    ]);
    expect(q[3]?.total.valor).toBe(900);
    expect(q[4]?.parcelas.map((p) => p.valor)).toEqual([0, 0, 900]);
    expect(q[5]?.total.quantidade).toBe(40);
    for (const x of q.slice(0, 5)) expect(totalConfere(x)).toBe(true);
    const x = arquivoDiops({ ...CAB, competencia: '2026-T3' }, q, balancete);
    expect(x).toContain('<ativo>1000.00</ativo>');
    expect(x).toContain('rotulo="Mensalidade"');
    const sem = quadrosDiops({
      periodo,
      cobrancas: [],
      contas: [],
      pagamentos: [],
      beneficiarios: {},
      balancete: null,
    });
    expect(sem).toHaveLength(6);
  });
});

describe('TPS', () => {
  const vig = [
    { vigencia: '2000-01-01', valorAnual: 2, valorTrimestral: 0.5 },
    { vigencia: '2015-09-01', valorAnual: 5.39, valorTrimestral: 1.3475 },
  ];
  it('valor vigente, média, desconto e parcelas que somam o total', () => {
    expect(valorTpsVigente(vig, '2026-09-30')?.valorTrimestral).toBe(1.3475);
    expect(valorTpsVigente(vig, '2010-01-01')?.valorTrimestral).toBe(0.5);
    expect(valorTpsVigente(vig, '1999-01-01')).toBeNull();
    const r = calcularTps(
      [
        { produto: 1, nome: 'PLANO A', registroAns: '123456789', beneficiariosPorMes: [10, 10, 11] },
        { produto: 2, nome: 'PLANO B', registroAns: '987654321', beneficiariosPorMes: [100, 100, 100] },
      ],
      vig,
      '2026-09-30',
      [{ produto: 2, percentual: 50, motivo: 'ABRANGENCIA' }],
    );
    // 31/3 × 1,3475 = 13,924...; 100 × 1,3475 × 50% = 67,375 → 67,38.
    expect(r.linhas.map((l) => l.valorCentavos)).toEqual([1392, 6738]);
    expect(r.totalCentavos).toBe(8130);
    expect(r.problemas).toEqual([]);
    const q = quadrosTps(r);
    expect(q[0]?.parcelas[0]?.rotulo).toBe('PLANO A: média 10,33 (10 + 10 + 11 ÷ 3) × R$ 1,3475');
    expect(q[0]?.parcelas[1]?.rotulo).toContain('− 50,00%');
    expect(totalConfere(q[0]!)).toBe(true);
    const x = arquivoTps({ ...CAB, competencia: '2026-T3' }, r);
    expect(x).toContain('<valorTrimestral>1.3475</valorTrimestral>');
    expect(x).toContain('<total>81.30</total>');
  });
  it('sem valor vigente, desconto de outro plano, plano sem registro', () => {
    const r = calcularTps(
      [{ produto: 1, nome: 'A', registroAns: null, beneficiariosPorMes: [] }],
      [],
      '2026-09-30',
      [{ produto: 9, percentual: 10, motivo: 'X' }],
    );
    expect(r.problemas.map((p) => p.codigo)).toEqual([
      'sem-valor-tps',
      'desconto-de-outro-plano',
      'sem-registro-plano',
    ]);
    expect(r.totalCentavos).toBe(0);
    expect(arquivoTps(CAB, r)).toContain('<valorTrimestral/>');
  });
});

describe('monitoramento TISS', () => {
  const guia: GuiaMonitoramento = {
    protocolo: '202609000001',
    prestadorDocumento: '00000000000191',
    prestadorCnes: '1234567',
    numeroGuiaPrestador: 'G1',
    numeroGuiaOperadora: null,
    tipoGuia: 'consulta',
    carater: 'E',
    inicio: '2026-09-01',
    fim: '2026-09-01',
    beneficiario: {
      carteirinha: '1000000000000001',
      cns: null,
      sexo: 'F',
      nascimento: '1980-05-10',
      municipio: 4314902,
      cco: null,
    },
    carteirinhaApresentada: '1000000000000001',
    itens: [
      { tabela: '22', codigo: '10101012', quantidade: 1, informado: 100, glosado: 10 },
      { tabela: '22', codigo: '10101039', quantidade: 1, informado: 50.5, glosado: 0 },
    ],
  };
  it('quadro, pendência da guia sem beneficiário e arquivo', () => {
    const sem = { ...guia, numeroGuiaPrestador: 'G2', beneficiario: null };
    expect(problemasMonitoramento([guia, sem]).map((p) => p.referencia)).toEqual(['202609000001/G2']);
    const q = quadrosMonitoramento([guia, sem]);
    expect(q[0]?.total).toEqual({ rotulo: 'Valor liberado', valor: 281, quantidade: 2 });
    expect(totalConfere(q[0]!)).toBe(true);
    const x = arquivoMonitoramento(CAB, [guia, sem]);
    expect(x).toContain('<valorLiberado>90.00</valorLiberado>');
    expect(x).toContain('<valorInformado>150.50</valorInformado>');
    expect(x).toContain('<cnes>1234567</cnes>');
  });
});

describe('ressarcimento ao SUS', () => {
  const dados: DadosElegibilidade = {
    beneficiario: { situacao: 'ativo', inclusao: '2026-01-01' },
    contrato: { situacao: 'ativo', inicio: '2026-01-01', fim: null },
    produto: {
      situacao: 'ativo',
      natureza: 'plano',
      carencias: { urgencia: 1, partos: 300, demais: 180, cpt: 24 },
    },
  };
  const alvo = {
    carteirinha: numeroCarteirinha('999999', 1),
    dados,
    segmentacao: 'ambulatorialHospitalar' as const,
    coberturaParcial: false,
  };
  const aih = { tipo: 'AIH' as const, inicio: '2026-09-01' };
  it('prazo da impugnação', () => {
    expect(prazoImpugnacao('2026-10-01')).toBe('2026-10-31');
    expect(noPrazo('2026-10-01', '2026-10-31')).toBe(true);
    expect(noPrazo('2026-10-01', '2026-11-01')).toBe(false);
  });
  it('sugestões da análise', () => {
    expect(analisarAtendimentoSus(aih, alvo)).toBeNull();
    expect(analisarAtendimentoSus(aih, alvo, true)).toBe('duplicidade');
    expect(analisarAtendimentoSus(aih, null)).toBe('naoBeneficiario');
    expect(analisarAtendimentoSus(aih, { ...alvo, carteirinha: '1' })).toBe('naoBeneficiario');
    expect(
      analisarAtendimentoSus(aih, {
        ...alvo,
        dados: { ...dados, produto: { ...dados.produto, natureza: 'cartaoDesconto' } },
      }),
    ).toBe('cartaoDesconto');
    expect(analisarAtendimentoSus({ ...aih, inicio: '2025-12-01' }, alvo)).toBe('foraDaVigencia');
    expect(analisarAtendimentoSus({ ...aih, inicio: '2026-03-01' }, alvo)).toBe('carencia');
    const semDemais = {
      ...dados,
      produto: { ...dados.produto, carencias: { urgencia: 0, partos: 0, demais: 0, cpt: 24 } },
    };
    expect(analisarAtendimentoSus(aih, { ...alvo, dados: semDemais, coberturaParcial: true })).toBe('cpt');
    expect(analisarAtendimentoSus(aih, { ...alvo, segmentacao: 'ambulatorial' })).toBe('segmentacao');
    expect(
      analisarAtendimentoSus(
        { tipo: 'APAC', inicio: '2026-09-01' },
        { ...alvo, segmentacao: 'hospitalarSemObstetricia' },
      ),
    ).toBe('segmentacao');
    expect(
      analisarAtendimentoSus({ tipo: 'APAC', inicio: '2026-09-01' }, { ...alvo, segmentacao: null }),
    ).toBeNull();
  });
  it('aviso, decisão, valores e dossiê', () => {
    const at = (numero: string, inicio = '2026-09-01', fim = '2026-09-03') => ({
      tipo: 'AIH' as const,
      numero,
      inicio,
      fim,
    });
    expect(
      problemasDoAviso('2026-10-01', [
        at('1'),
        at('1'),
        at('2', '2026-09-05', '2026-09-01'),
        at('3', '2026-10-05', '2026-10-06'),
      ]),
    ).toEqual(['atendimento-repetido', 'periodo-invalido', 'atendimento-depois-do-aviso']);
    expect(problemasDaDecisao({ decisao: 'aceitar', motivo: null, justificativa: null }, false)).toEqual([]);
    expect(
      problemasDaDecisao({ decisao: 'impugnar', motivo: 'carencia', justificativa: null }, false),
    ).toEqual(['prazo-vencido']);
    expect(problemasDaDecisao({ decisao: 'impugnar', motivo: null, justificativa: null }, true)).toEqual([
      'impugnacao-sem-motivo',
    ]);
    expect(problemasDaDecisao({ decisao: 'impugnar', motivo: 'outro', justificativa: ' ' }, true)).toEqual([
      'impugnacao-sem-justificativa',
    ]);
    expect(
      problemasDaDecisao({ decisao: 'impugnar', motivo: 'carencia', justificativa: null }, true),
    ).toEqual([]);
    const base: ItemRessarcimento = {
      ordem: 1,
      tipo: 'AIH',
      numero: '1234567890123',
      identificacao: '1000000000000001',
      inicio: '2026-09-01',
      fim: '2026-09-03',
      procedimento: '0303010010',
      valor: 1000,
      sugestao: 'carencia',
      decisao: 'impugnar',
      motivo: 'carencia',
      justificativa: null,
      deferida: null,
    };
    const itens: ItemRessarcimento[] = [
      base,
      { ...base, ordem: 2, numero: '2', valor: 500.5, decisao: 'aceitar', motivo: null, sugestao: null },
      { ...base, ordem: 3, numero: '3', valor: 200, decisao: 'impugnar', deferida: false },
    ];
    expect(todosDecididos(itens)).toBe(true);
    expect(todosDecididos([{ decisao: 'pendente' }])).toBe(false);
    expect(todosDecididos([])).toBe(false);
    expect(valorDevido(itens)).toBe(700.5);
    const q = quadrosRessarcimento([...itens, { ...base, ordem: 4, decisao: 'pendente', valor: 1 }]);
    expect(q[0]?.parcelas.map((p) => p.valor)).toEqual([500.5, 1200, 1]);
    expect(q[0]?.total).toEqual({ rotulo: 'Total cobrado', valor: 1701.5, quantidade: 4 });
    expect(totalConfere(q[0]!)).toBe(true);
    const x = arquivoRessarcimento(
      { ...CAB, competencia: '2026-10-01' },
      { numero: '77', recebidoEm: '2026-10-01' },
      itens,
    );
    expect(x).toContain('<aviso>77</aviso>');
    expect(x).toContain('<fundamento>Carência contratual não cumprida na data do atendimento</fundamento>');
    expect(mensagemAns('prazo-vencido')).toBe(MENSAGENS_ANS['prazo-vencido']);
    expect(mensagemAns('x')).toBe('x');
  });
});
