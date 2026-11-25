import { describe, expect, it } from 'vitest';
import {
  cartaoAplicavel,
  cartaoVigente,
  chaveItemCartao,
  itensParaGasto,
  sugestaoParaMapa,
  validarCartaoPreferencia,
  type EntradaCartaoPreferencia,
} from './cartao-preferencia.js';

const base: EntradaCartaoPreferencia = {
  cirurgiao: 7,
  procedimento: 3,
  tempoMinutos: 90,
  itens: [{ natureza: 'material', insumo: 11, quantidade: 2 }],
};
const campos = (e: EntradaCartaoPreferencia) => validarCartaoPreferencia(e).map((p) => p.campo);

describe('validarCartaoPreferencia', () => {
  it('aceita o cartão completo', () => {
    expect(
      validarCartaoPreferencia({
        ...base,
        tamanhoLuva: '7,5',
        itens: [
          { natureza: 'material', insumo: 11, quantidade: 2 },
          { natureza: 'instrumental', caixaInstrumental: 4, quantidade: 1 },
          { natureza: 'equipamento', equipamento: 9, quantidade: 1 },
          { natureza: 'fio', descricao: 'Poliglactina 3-0', quantidade: 3 },
          { natureza: 'outro', descricao: 'Coxim de gel', quantidade: 1 },
        ],
      }),
    ).toEqual([]);
  });

  it('exige o cirurgião e algum conteúdo', () => {
    expect(campos({ cirurgiao: null, itens: [] })).toEqual(['cirurgiao', 'itens']);
  });

  it('recusa tempo fora da faixa e luva sem tamanho válido', () => {
    expect(campos({ ...base, tempoMinutos: 3 })).toEqual(['tempoMinutos']);
    expect(campos({ ...base, tempoMinutos: 1441 })).toEqual(['tempoMinutos']);
    expect(campos({ ...base, tamanhoLuva: '12' })).toEqual(['tamanhoLuva']);
    expect(campos({ ...base, tamanhoLuva: '8' })).toEqual([]);
  });

  it('confere a referência pela natureza, a descrição livre, a quantidade e o repetido', () => {
    expect(campos({ ...base, itens: [{ natureza: 'instrumental', insumo: 11, quantidade: 1 }] })).toEqual([
      'itens.0',
      'itens.0.descricao',
    ]);
    expect(campos({ ...base, itens: [{ natureza: 'equipamento', quantidade: 1 }] })).toEqual([
      'itens.0.descricao',
    ]);
    expect(campos({ ...base, itens: [{ natureza: 'material', insumo: 11, quantidade: 0 }] })).toEqual([
      'itens.0.quantidade',
    ]);
    expect(
      campos({
        ...base,
        itens: [
          { natureza: 'material', insumo: 11, quantidade: 1 },
          { natureza: 'medicamento', insumo: 11, quantidade: 1 },
        ],
      }),
    ).toEqual(['itens.1']);
    expect(
      chaveItemCartao({ natureza: 'outro', descricao: ' Coxim ', quantidade: 1 }) ===
        chaveItemCartao({ natureza: 'outro', descricao: 'coxim', quantidade: 2 }),
    ).toBe(true);
  });
});

describe('cartaoAplicavel', () => {
  const cartoes = [
    { id: 1, cirurgiao: 7, procedimento: null, ativo: true },
    { id: 2, cirurgiao: 7, procedimento: 3, ativo: true },
    { id: 3, cirurgiao: 7, procedimento: 4, ativo: false },
    { id: 4, cirurgiao: 8, procedimento: 3, ativo: true },
  ];
  it('o do procedimento ganha; sem ele (ou fora de uso), o geral; de outro cirurgião, nada', () => {
    expect(cartaoAplicavel(cartoes, 7, 3)?.id).toBe(2);
    expect(cartaoAplicavel(cartoes, 7, 4)?.id).toBe(1);
    expect(cartaoAplicavel(cartoes, 7, null)?.id).toBe(1);
    expect(cartaoAplicavel(cartoes, 9, 3)).toBeNull();
    expect(cartaoAplicavel(cartoes, 8, 5)).toBeNull();
  });
});

describe('sugestões do cartão', () => {
  it('mapa: sala, tempo e posição (vazios como nulo)', () => {
    expect(sugestaoParaMapa({ sala: 2, tempoMinutos: 60 })).toEqual({
      sala: 2,
      tempoMinutos: 60,
      posicao: null,
    });
  });
  it('gasto de sala: só os produtos do estoque, somados', () => {
    expect(
      itensParaGasto([
        { natureza: 'material', insumo: 11, quantidade: 2 },
        { natureza: 'instrumental', caixaInstrumental: 4, quantidade: 1 },
        { natureza: 'fio', insumo: 12, quantidade: 1 },
        { natureza: 'outro', descricao: 'Coxim', quantidade: 1 },
      ]),
    ).toEqual([
      { insumo: 11, quantidade: 2 },
      { insumo: 12, quantidade: 1 },
    ]);
  });
});

describe('grupo, vigência e kit padrão', () => {
  const base = { cirurgiao: 7, itens: [], tempoMinutos: 60 };
  it('recusa procedimento e grupo juntos e a vigência invertida ou inválida', () => {
    const campos = (e: Parameters<typeof validarCartaoPreferencia>[0]) =>
      validarCartaoPreferencia(e).map((p) => p.campo);
    expect(campos({ ...base, procedimento: 3, grupo: 2 })).toEqual(['grupo']);
    expect(campos({ ...base, grupo: 2, vigenciaInicio: '2026-12-01', vigenciaFim: '2026-11-30' })).toEqual([
      'vigenciaFim',
    ]);
    expect(campos({ ...base, vigenciaInicio: '2026-02-30' })).toEqual(['vigenciaInicio']);
    expect(campos({ ...base, vigenciaInicio: '2026-11-01', vigenciaFim: '2026-11-01' })).toEqual([]);
  });

  it('o kit aceita só o cadastro de kit e entra repetido uma vez só', () => {
    const item = { natureza: 'kit' as const, kit: 4, quantidade: 1 };
    expect(validarCartaoPreferencia({ ...base, itens: [item] })).toEqual([]);
    expect(
      validarCartaoPreferencia({ ...base, itens: [{ natureza: 'kit', insumo: 4, quantidade: 1 }] }).length,
    ).toBeGreaterThan(0);
    expect(
      validarCartaoPreferencia({ ...base, itens: [item, item] }).some((p) => p.mensagem.includes('repetido')),
    ).toBe(true);
  });

  it('aplicável: procedimento, depois grupo, depois geral, só na vigência da data do ato', () => {
    const c = (id: number, x: object) => ({
      id,
      cirurgiao: 7,
      procedimento: null,
      grupo: null,
      ativo: true,
      vigenciaInicio: null,
      vigenciaFim: null,
      ...x,
    });
    const cartoes = [
      c(1, {}),
      c(2, { grupo: 5 }),
      c(3, { procedimento: 30, vigenciaInicio: '2026-11-10', vigenciaFim: '2026-11-20' }),
    ];
    expect(cartaoAplicavel(cartoes, 7, 30, { grupo: 5, data: '2026-11-15' })?.id).toBe(3);
    expect(cartaoAplicavel(cartoes, 7, 30, { grupo: 5, data: '2026-11-21' })?.id).toBe(2);
    expect(cartaoAplicavel(cartoes, 7, 30, { grupo: 6, data: '2026-11-21' })?.id).toBe(1);
    expect(cartaoAplicavel(cartoes, 7, 31, {})?.id).toBe(1);
    expect(cartaoVigente({ vigenciaInicio: '2026-11-10', vigenciaFim: null }, '2026-11-09')).toBe(false);
    expect(cartaoVigente({ vigenciaInicio: '2026-11-10', vigenciaFim: null }, null)).toBe(true);
  });

  it('gasto de sala: o kit abre nos produtos dele, vezes a quantidade, somando com o avulso', () => {
    const kits = new Map([
      [
        4,
        [
          { insumo: 10, quantidade: 2 },
          { insumo: 11, quantidade: 0.5 },
        ],
      ],
    ]);
    expect(
      itensParaGasto(
        [
          { natureza: 'material', insumo: 10, quantidade: 1 },
          { natureza: 'kit', kit: 4, quantidade: 3 },
        ],
        kits,
      ),
    ).toEqual([
      { insumo: 10, quantidade: 7 },
      { insumo: 11, quantidade: 1.5 },
    ]);
  });
});
