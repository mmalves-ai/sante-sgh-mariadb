import { describe, expect, it } from 'vitest';
import {
  aplicarRegrasAcordo,
  type ItemParaAcordo,
  regimesDoAtendimento,
  type RegrasVigentesCalc,
} from './regras-acordo-calculo.js';

const zero = { valor: 0, quantidade: 0, ocorrencias: 0 };
const item = (x: Partial<ItemParaAcordo> = {}): ItemParaAcordo => ({
  item: 10,
  grupo: 2,
  subgrupo: null,
  plano: 7,
  tabela: 3,
  regimeId: 1,
  regimes: ['ambulatorial'],
  funcaoEquipe: null,
  tipoConta: null,
  quantidade: 2,
  honorario: 100,
  custoOperacional: 50,
  filme: 10,
  via: null,
  ordemNoAto: null,
  jaCobrado: { item: zero, grupo: zero, conta: zero },
  ...x,
});
const sem: RegrasVigentesCalc = {
  percentuais: [],
  descontos: [],
  vias: [],
  isentos: [],
  tetos: [],
  altoCusto: [],
};
const pct = (x: Record<string, unknown>) => ({
  id: 1,
  tabela: null,
  componente: 'honorario',
  tipoPaciente: 'todos',
  funcaoEquipe: null,
  tipoConta: null,
  percentual: null,
  valorFixo: null,
  item: null,
  grupo: null,
  plano: null,
  ...x,
});
const teto = (x: Record<string, unknown>) => ({
  id: 9,
  abrangencia: 'item',
  item: 10,
  grupo: null,
  plano: null,
  valorTeto: null,
  quantidadeMaxima: null,
  ocorrenciasMaximas: null,
  acao: 'alertar',
  excedenteFonte: null,
  excedentePlano: null,
  ...x,
});

describe('aplicarRegrasAcordo', () => {
  it('sem regra o item fica pelo preço da tabela', () => {
    const r = aplicarRegrasAcordo(item(), sem);
    expect([r.honorario, r.custoOperacional, r.filme, r.total, r.unitario]).toEqual([200, 100, 20, 320, 160]);
    expect(r.aplicadas).toEqual([]);
  });

  it('isento zera o item e guarda o motivo; a regra de outro plano não vale', () => {
    const r = aplicarRegrasAcordo(item(), {
      ...sem,
      isentos: [
        { id: 4, item: null, grupo: 2, plano: 8, regime: null, motivo: 'outro plano' },
        { id: 5, item: null, grupo: 2, plano: null, regime: null, motivo: 'incluso na diária' },
      ],
    });
    expect(r.isento).toBe(true);
    expect(r.total).toBe(0);
    expect(r.aplicadas).toEqual([{ tipo: 'isento', id: 5, efeito: 'isento: incluso na diária' }]);
  });

  it('percentual por componente: a regra do item vence a do grupo; valor fixo substitui', () => {
    const r = aplicarRegrasAcordo(item(), {
      ...sem,
      percentuais: [
        pct({ id: 1, grupo: 2, percentual: 50 }),
        pct({ id: 2, item: 10, percentual: 80 }),
        pct({ id: 3, componente: 'filme', valorFixo: 4 }),
      ],
    });
    expect(r.honorario).toBe(160);
    expect(r.filme).toBe(8);
    expect(r.aplicadas.map((a) => a.id)).toEqual([2, 3]);
  });

  it('percentual só do internado não vale no ambulatorial', () => {
    const r = aplicarRegrasAcordo(item(), {
      ...sem,
      percentuais: [pct({ tipoPaciente: 'internado', percentual: 10 })],
    });
    expect(r.honorario).toBe(200);
  });

  it('desconto por grupo só nas parcelas e regimes marcados', () => {
    const regra = {
      id: 6,
      grupo: 2,
      subgrupo: null,
      acrescimo: 0,
      desconto: 10,
      sobre: ['custo_operacional'],
      regimes: ['ambulatorial'],
    };
    const r = aplicarRegrasAcordo(item(), { ...sem, descontos: [regra] });
    expect([r.honorario, r.custoOperacional]).toEqual([200, 90]);
    const fora = aplicarRegrasAcordo(item({ regimes: ['internacao'] }), { ...sem, descontos: [regra] });
    expect(fora.custoOperacional).toBe(100);
  });

  it('via de acesso: o 2º procedimento do ato paga o percentual da ordem; acima da última, segue a última', () => {
    const vias = [
      { id: 11, via: 1, ordem: 1, percentual: 100, item: null, padraoDeTodas: true },
      { id: 12, via: 1, ordem: 2, percentual: 50, item: null, padraoDeTodas: true },
      { id: 13, via: 1, ordem: 2, percentual: 70, item: null, padraoDeTodas: false },
    ];
    const r = aplicarRegrasAcordo(item({ via: 1, ordemNoAto: 2 }), { ...sem, vias });
    expect(r.honorario).toBe(140);
    const quarto = aplicarRegrasAcordo(item({ via: 1, ordemNoAto: 4 }), { ...sem, vias });
    expect(quarto.honorario).toBe(140);
  });

  it('alto custo: preço negociado substitui o preço e não leva percentual; cobrança à parte e autorização marcam', () => {
    const r = aplicarRegrasAcordo(item(), {
      ...sem,
      percentuais: [pct({ percentual: 10 })],
      altoCusto: [
        { id: 21, item: 10, grupo: null, plano: null, regra: 'preco_negociado', valorNegociado: 1000 },
        { id: 22, item: 10, grupo: null, plano: null, regra: 'cobranca_a_parte', valorNegociado: null },
        { id: 23, item: null, grupo: 2, plano: null, regra: 'exige_autorizacao', valorNegociado: null },
      ],
    });
    expect([r.total, r.unitario, r.honorario]).toEqual([2000, 1000, 0]);
    expect(r.cobrancaAParte).toBe(true);
    expect(r.exigeAutorizacao).toBe(true);
    expect(r.alertas).toContain('alto-custo-exige-autorizacao');
  });

  it('teto que bloqueia recusa o lançamento; o que alerta só avisa', () => {
    const bloq = aplicarRegrasAcordo(item(), {
      ...sem,
      tetos: [teto({ valorTeto: 300, acao: 'bloquear_lancamento' })],
    });
    expect(bloq.recusa?.codigo).toBe('teto-do-acordo');
    const alerta = aplicarRegrasAcordo(item(), { ...sem, tetos: [teto({ quantidadeMaxima: 1 })] });
    expect(alerta.recusa).toBeNull();
    expect(alerta.alertas).toEqual(['teto-item-quantidade']);
  });

  it('teto que transfere: a conta fica com o limite e o excedente vai à fonte do excedente', () => {
    const r = aplicarRegrasAcordo(
      item({ jaCobrado: { item: { valor: 200, quantidade: 1, ocorrencias: 1 }, grupo: zero, conta: zero } }),
      {
        ...sem,
        tetos: [
          teto({ valorTeto: 400, acao: 'transferir_excedente', excedenteFonte: 77, excedentePlano: null }),
        ],
      },
    );
    expect(r.total).toBe(200);
    expect(r.honorario + r.custoOperacional + r.filme).toBeCloseTo(200, 2);
    expect(r.excedente).toEqual({ valor: 120, fonte: 77, plano: null });
  });

  it('regime das regras pela descrição do regime e pela urgência do caráter', () => {
    expect(regimesDoAtendimento('Internação', false)).toEqual(['internacao']);
    expect(regimesDoAtendimento('Ambulatorial', true)).toEqual(['ambulatorial', 'urgencia']);
    expect(regimesDoAtendimento(null, false)).toEqual(['externo']);
  });
});
