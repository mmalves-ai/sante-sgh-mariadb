// F8, 07-FIN linhas 68 e 69 (correção da revisão): estorno do encontro de contas, liquidação parcial da provisão,
// título já conciliado ou de outro credor, estender, cancelar ocorrência e encerrar a previsão.
import { describe, expect, it } from 'vitest';
import {
  conferirCancelamentoEncontro,
  conferirEstornoEncontro,
  desfazerCompensacaoParcela,
} from './encontro-contas.js';
import {
  conferirCancelamentoOcorrencia,
  conferirEncerramentoPrevisao,
  conferirTituloConciliacao,
  estenderPrevisao,
  gerarOcorrenciasPrevisao,
  liquidarProvisao,
} from './previsao-provisao.js';

const codigo = (r: unknown) => (r && typeof r === 'object' && 'codigo' in r ? r.codigo : null);

describe('estorno do encontro de contas', () => {
  it('só o efetivado, com motivo; o cancelamento do efetivado aponta para o estorno', () => {
    expect(
      codigo(conferirEstornoEncontro({ situacao: 'aguardando_aprovacao', motivo: 'erro de valor' })),
    ).toBe('encontro-nao-efetivado');
    expect(codigo(conferirEstornoEncontro({ situacao: 'efetivado', motivo: 'x' }))).toBe(
      'motivo-obrigatorio',
    );
    expect(conferirEstornoEncontro({ situacao: 'efetivado', motivo: 'erro de valor' })).toBeNull();
    const c = conferirCancelamentoEncontro({ situacao: 'efetivado', motivo: 'erro de valor' });
    expect(codigo(c)).toBe('encontro-fechado');
    expect((c as { mensagem: string }).mensagem).toMatch(/estorno/);
  });

  it('devolve o compensado ao saldo e volta a parcela a aberta ou parcial', () => {
    expect(
      desfazerCompensacaoParcela({ situacao: 'paga', saldo: 0, acumulado: 350, compensado: 350 }),
    ).toEqual({
      saldo: 350,
      acumulado: 0,
      situacao: 'aberta',
    });
    expect(
      desfazerCompensacaoParcela({ situacao: 'parcial', saldo: 50, acumulado: 150, compensado: 100 }),
    ).toEqual({ saldo: 150, acumulado: 50, situacao: 'parcial' });
    expect(
      codigo(desfazerCompensacaoParcela({ situacao: 'aberta', saldo: 100, acumulado: 0, compensado: 100 })),
    ).toBe('parcela-mudou');
    expect(
      codigo(
        desfazerCompensacaoParcela({ situacao: 'renegociada', saldo: 0, acumulado: 100, compensado: 100 }),
      ),
    ).toBe('parcela-mudou');
  });
});

describe('liquidação da provisão', () => {
  const v = { valorProvisionado: 5000, valorBaixado: 0, valorRevertido: 0, situacao: 'provisionada' };
  it('título menor que o saldo: parcial, previsto = consumido, diferença zero', () => {
    expect(liquidarProvisao(v, 2000)).toMatchObject({
      situacao: 'parcial',
      saldo: 3000,
      consumido: 2000,
      previsto: 2000,
      diferenca: 0,
    });
  });
  it('título maior que o saldo: fecha, previsto = saldo, diferença positiva', () => {
    expect(liquidarProvisao({ ...v, valorBaixado: 2000, situacao: 'parcial' }, 3500)).toMatchObject({
      situacao: 'liquidada',
      saldo: 0,
      consumido: 3000,
      previsto: 3000,
      diferenca: 500,
    });
  });
  it('título igual ao saldo: fecha sem diferença', () => {
    expect(liquidarProvisao(v, 5000)).toMatchObject({ situacao: 'liquidada', diferenca: 0, previsto: 5000 });
  });
});

describe('título para conciliar', () => {
  const nenhum = { fornecedor: null, profissional: null };
  it('recusa o título já conciliado e o de outro credor', () => {
    expect(codigo(conferirTituloConciliacao({ jaConciliado: true, esperado: nenhum, titulo: nenhum }))).toBe(
      'titulo-ja-conciliado',
    );
    expect(
      codigo(
        conferirTituloConciliacao({
          jaConciliado: false,
          esperado: { fornecedor: null, profissional: 7 },
          titulo: { fornecedor: 9, profissional: null },
        }),
      ),
    ).toBe('credor-diferente');
    expect(
      codigo(
        conferirTituloConciliacao({
          jaConciliado: false,
          esperado: { fornecedor: 3, profissional: null },
          titulo: { fornecedor: 4, profissional: null },
        }),
      ),
    ).toBe('credor-diferente');
  });
  it('aceita o mesmo credor e a previsão sem credor', () => {
    expect(
      conferirTituloConciliacao({
        jaConciliado: false,
        esperado: { fornecedor: 3, profissional: null },
        titulo: { fornecedor: 3, profissional: null },
      }),
    ).toBeNull();
    expect(
      conferirTituloConciliacao({
        jaConciliado: false,
        esperado: nenhum,
        titulo: { fornecedor: 3, profissional: null },
      }),
    ).toBeNull();
  });
});

describe('ciclo de vida da previsão', () => {
  const base = {
    periodicidade: 'mensal' as const,
    dataInicio: '2026-01-01',
    dataFim: null,
    diaVencimento: 10,
    valor: 100,
    ajuste: 'manter' as const,
  };
  it('estende mais 12 meses depois da última, continuando a sequência e as datas', () => {
    const primeiras = gerarOcorrenciasPrevisao(base) as { sequencia: number; dataEsperada: string }[];
    expect(primeiras).toHaveLength(12);
    const ultima = primeiras[primeiras.length - 1]!;
    const novas = estenderPrevisao({
      ...base,
      ativa: true,
      ultimaSequencia: ultima.sequencia,
      ultimaData: ultima.dataEsperada,
    }) as { sequencia: number; dataEsperada: string }[];
    expect(novas).toHaveLength(12);
    expect(novas[0]).toMatchObject({ sequencia: 13, dataEsperada: '2027-01-10' });
    expect(novas[11]).toMatchObject({ sequencia: 24, dataEsperada: '2027-12-10' });
  });
  it('recusa a encerrada, a única e a que já chegou ao fim', () => {
    const x = { ultimaSequencia: 12, ultimaData: '2026-12-10' };
    expect(codigo(estenderPrevisao({ ...base, ...x, ativa: false }))).toBe('previsao-encerrada');
    expect(codigo(estenderPrevisao({ ...base, ...x, ativa: true, periodicidade: 'unica' }))).toBe(
      'previsao-unica',
    );
    expect(codigo(estenderPrevisao({ ...base, ...x, ativa: true, dataFim: '2026-12-31' }))).toBe(
      'sem-ocorrencia-nova',
    );
  });
  it('cancelar ocorrência só aberta e com motivo; encerrar só ativa, com motivo e data válida', () => {
    expect(
      codigo(conferirCancelamentoOcorrencia({ situacao: 'realizada', motivo: 'contrato encerrado' })),
    ).toBe('previsao-fechada');
    expect(codigo(conferirCancelamentoOcorrencia({ situacao: 'aberta', motivo: 'x' }))).toBe(
      'motivo-obrigatorio',
    );
    expect(conferirCancelamentoOcorrencia({ situacao: 'aberta', motivo: 'contrato encerrado' })).toBeNull();
    const enc = { ativa: true, dataInicio: '2026-01-01', data: '2026-06-30', motivo: 'contrato encerrado' };
    expect(conferirEncerramentoPrevisao(enc)).toBeNull();
    expect(codigo(conferirEncerramentoPrevisao({ ...enc, ativa: false }))).toBe('previsao-encerrada');
    expect(codigo(conferirEncerramentoPrevisao({ ...enc, data: '2025-12-31' }))).toBe('periodo-invalido');
    expect(codigo(conferirEncerramentoPrevisao({ ...enc, motivo: '' }))).toBe('motivo-obrigatorio');
  });
});
