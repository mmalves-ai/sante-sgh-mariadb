// Regras das declarações periódicas da operadora (08-SGO L110): apuração da TPS, conferência cadastral da base da ANS e
// DMED. Massa sintética.
import { describe, expect, it } from 'vitest';
import {
  apurarTps,
  arquivoDmed,
  conferirCadastro,
  cpfValidoDmed,
  fimDoTrimestre,
  lerArquivoConferencia,
  montarDmed,
  prazoDmed,
  problemasDaCorrecao,
  problemasDaDeclaracao,
  problemasDoPassoDmed,
  problemasDoPassoTps,
  vencimentoTps,
} from './declaracoes.js';
import { calcularTps } from './tps.js';

const VIG = [{ vigencia: '2015-09-01', valorAnual: 5.39, valorTrimestral: 1.3475 }];

describe('apuração da TPS', () => {
  it('soma as parcelas por plano, vence no último dia útil até o dia 10 e guarda o valor por vida', () => {
    const r = calcularTps(
      [
        { produto: 1, nome: 'Plano A', registroAns: '123', beneficiariosPorMes: [10, 12, 14] },
        { produto: 2, nome: 'Plano B', registroAns: '456', beneficiariosPorMes: [3, 3, 3] },
      ],
      VIG,
      fimDoTrimestre(2026, 3),
    );
    const a = apurarTps(r, 2026, 3);
    expect(a.problemas).toEqual([]);
    expect(a.quantidadeVidas).toBe(15);
    expect(a.valorPorVida).toBe(1.3475);
    expect(a.parcelas.map((x) => x.valor)).toEqual([16.17, 4.04]);
    expect(a.valorTotal).toBe(20.21);
    // 10/09/2026 é quinta; 10/10/2026 cairia no sábado.
    expect(a.vencimento).toBe('2026-09-10');
    expect(vencimentoTps(2026, 4)).toBe('2026-12-10');
    expect(vencimentoTps(2027, 2)).toBe('2027-06-10');
    expect(vencimentoTps(2026, 1)).toBe('2026-03-10');
    expect(fimDoTrimestre(2026, 1)).toBe('2026-03-31');
  });
  it('sem valor vigente ou sem plano, recusa', () => {
    const r = calcularTps([], [], '2014-03-31');
    expect(apurarTps(r, 2014, 1).problemas.map((x) => x.codigo)).toEqual(['sem-valor-tps', 'sem-planos']);
  });
  it('passos: guia com número, pagamento com data e valor não menor, situação final não muda', () => {
    const h = '2026-11-25';
    expect(problemasDoPassoTps('apurada', 20, { para: 'guia_emitida' }, h)[0]?.codigo).toBe(
      'sem-numero-guia',
    );
    expect(problemasDoPassoTps('apurada', 20, { para: 'guia_emitida', nossoNumero: '1' }, h)).toEqual([]);
    expect(
      problemasDoPassoTps('guia_emitida', 20, { para: 'paga', dataPagamento: h, valorPago: 19.99 }, h)[0]
        ?.codigo,
    ).toBe('pago-menor');
    expect(
      problemasDoPassoTps(
        'guia_emitida',
        20,
        { para: 'paga', dataPagamento: '2026-12-01', valorPago: 20 },
        h,
      )[0]?.codigo,
    ).toBe('pagamento-futuro');
    expect(
      problemasDoPassoTps('guia_emitida', 20, { para: 'paga', dataPagamento: h, valorPago: 20 }, h),
    ).toEqual([]);
    expect(problemasDoPassoTps('paga', 20, { para: 'cancelada' }, h)[0]?.codigo).toBe('passo-invalido');
  });
});

describe('conferência cadastral da base da ANS', () => {
  const ARQ = [
    'cco;nome;nascimento;cpf;cns;registro_plano;situacao',
    '000000000011;Ana Sintética;10/05/1980;52998224725;;478081;ATIVO',
    '000000000022;Bruno Sintetico;2015-03-01;;;478081;INATIVO',
    '000000000099;Pessoa Fora;2000-01-01;;;478081;ATIVO',
    'quebrada;x',
  ].join('\n');
  it('lê o arquivo e aponta a linha fora do leiaute pelo número, sem o conteúdo', () => {
    const r = lerArquivoConferencia(ARQ);
    expect(r.registros).toHaveLength(3);
    expect(r.registros[0]).toMatchObject({ nascimento: '1980-05-10', cpf: '52998224725', ativo: true });
    expect(r.problemas).toEqual([
      { codigo: 'linha-invalida', campo: 'arquivo', detalhe: 'Linha 5 fora do leiaute.' },
    ]);
    expect(lerArquivoConferencia('cabecalho\n').problemas[0]?.codigo).toBe('arquivo-vazio');
  });
  it('confere pelo código de controle: não localizado dos dois lados, situação e campo (nome sem acento e caixa)', () => {
    const { registros } = lerArquivoConferencia(ARQ);
    const d = conferirCadastro(
      [
        {
          id: 1,
          cco: '000000000011',
          nome: 'ANA SINTETICA',
          nascimento: '1980-05-10',
          cpf: '52998224725',
          cns: null,
          registroPlano: '478081',
          ativo: true,
        },
        {
          id: 2,
          cco: '000000000022',
          nome: 'Bruno Sintetico',
          nascimento: '2015-03-02',
          cpf: null,
          cns: null,
          registroPlano: '478081',
          ativo: true,
        },
        {
          id: 3,
          cco: '000000000033',
          nome: 'Carla',
          nascimento: null,
          cpf: null,
          cns: null,
          registroPlano: '478081',
          ativo: true,
        },
        {
          id: 4,
          cco: null,
          nome: 'Sem SIB',
          nascimento: null,
          cpf: null,
          cns: null,
          registroPlano: null,
          ativo: true,
        },
      ],
      registros,
    );
    expect(d.map((x) => [x.beneficiario, x.tipo, x.campo])).toEqual([
      [2, 'situacao_divergente', 'situacao'],
      [2, 'campo_divergente', 'nascimento'],
      [null, 'nao_localizado_cadastro', null],
      [3, 'nao_localizado_ans', null],
    ]);
  });
  it('tratamento: ignorar exige justificativa; corrigida é final', () => {
    expect(problemasDaCorrecao('pendente', 'ignorada', ' ')[0]?.codigo).toBe('sem-justificativa');
    expect(problemasDaCorrecao('pendente', 'corrigir_cadastro', null)).toEqual([]);
    expect(problemasDaCorrecao('corrigida', 'pendente', null)[0]?.codigo).toBe('passo-invalido');
  });
});

describe('DMED', () => {
  it('prazo no último dia útil de fevereiro e CPF pelos dígitos', () => {
    expect(prazoDmed(2025)).toBe('2026-02-27');
    expect(prazoDmed(2026)).toBe('2027-02-26');
    expect(cpfValidoDmed('529.982.247-25')).toBe(true);
    expect(cpfValidoDmed('11111111111')).toBe(false);
  });
  it('soma por pessoa, titular antes dos dependentes, recusa titular sem CPF e dependente maior sem CPF', () => {
    const r = montarDmed(2025, [
      {
        beneficiario: 10,
        titular: null,
        nome: 'Titular',
        cpf: '52998224725',
        nascimento: '1980-01-01',
        centavos: 30000,
      },
      {
        beneficiario: 10,
        titular: null,
        nome: 'Titular',
        cpf: '52998224725',
        nascimento: '1980-01-01',
        centavos: 30050,
      },
      { beneficiario: 11, titular: 10, nome: 'Filho', cpf: null, nascimento: '2015-01-01', centavos: 15000 },
      { beneficiario: 12, titular: 10, nome: 'Cônjuge', cpf: null, nascimento: '1985-01-01', centavos: 0 },
      { beneficiario: 20, titular: null, nome: 'Outro', cpf: null, nascimento: '1970-01-01', centavos: 1000 },
      { beneficiario: 31, titular: 30, nome: 'Órfão', cpf: null, nascimento: '2000-01-01', centavos: 500 },
    ]);
    expect(r.itens.map((i) => [i.sequencia, i.beneficiario, i.tipo, i.valor])).toEqual([
      [1, 10, 'titular', 600.5],
      [2, 11, 'dependente', 150],
      [3, 20, 'titular', 10],
    ]);
    expect(r.totalCentavos).toBe(76050);
    expect(r.problemas.map((x) => x.codigo)).toEqual(['titular-sem-cpf', 'dependente-sem-titular']);
    const maior = montarDmed(2025, [
      { beneficiario: 1, titular: null, nome: 'T', cpf: '52998224725', nascimento: null, centavos: 100 },
      { beneficiario: 2, titular: 1, nome: 'D', cpf: null, nascimento: '2007-12-31', centavos: 100 },
    ]);
    expect(maior.problemas.map((x) => x.codigo)).toEqual(['dependente-sem-cpf']);
  });
  it('cabeçalho: ano encerrado, CPF do responsável e retificadora com recibo; passos com recibo na entrega', () => {
    const c = {
      anoCalendario: 2025,
      retificadora: true,
      reciboAnterior: null,
      responsavelCpf: '1',
      responsavelNome: '',
    };
    expect(problemasDaDeclaracao(c, '2026-01-10').map((x) => x.codigo)).toEqual([
      'cpf-responsavel',
      'sem-responsavel',
      'retificadora-sem-recibo',
    ]);
    expect(problemasDaDeclaracao({ ...c, anoCalendario: 2026 }, '2026-11-25')[0]?.codigo).toBe(
      'ano-invalido',
    );
    expect(problemasDoPassoDmed('gerada', 'transmitida', null)[0]?.codigo).toBe('sem-recibo');
    expect(problemasDoPassoDmed('gerada', 'transmitida', 'R1')).toEqual([]);
    expect(problemasDoPassoDmed('aceita', 'cancelada', null)[0]?.codigo).toBe('passo-invalido');
  });
  it('arquivo com os registros do leiaute e valores em centavos', () => {
    const r = montarDmed(2025, [
      { beneficiario: 1, titular: null, nome: 'T|X', cpf: '52998224725', nascimento: null, centavos: 12345 },
      { beneficiario: 2, titular: 1, nome: 'D', cpf: null, nascimento: '2015-03-01', centavos: 100 },
    ]);
    const a = arquivoDmed(
      {
        anoCalendario: 2025,
        anoReferencia: 2026,
        retificadora: false,
        reciboAnterior: null,
        responsavelCpf: '52998224725',
        responsavelNome: 'Resp',
        responsavelDdd: '11',
        responsavelTelefone: '30000000',
        responsavelEmail: null,
        cnpj: '00.000.000/0001-91',
        razaoSocial: 'Operadora',
        registroAns: '478081',
      },
      r.itens,
    ).split('\r\n');
    expect(a[0]).toBe('DMED|2026|2025|N||');
    expect(a[2]).toBe('DECPJ|00000000000191|Operadora|1|478081||N|52998224725|N||');
    expect(a[4]).toBe('TOP|52998224725|T X|12345|');
    expect(a[5]).toBe('DTOP||20150301|D||100|');
    expect(a[6]).toBe('FIMDmed|');
  });
});
