// Regra 11 da ficha do M46 (etapa 4): a ordem de manipulação só a partir do item validado pela farmácia (M29), com a
// capela, o grupo, o insumo e o lote válidos, a validade da sobra pela regra versionada, a dupla conferência por outra
// pessoa e a baixa do insumo (a saída do estoque do M28) só depois da conferência aprovada.
import { REGRA_SOBRA_MANIPULACAO } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  type AberturaParaConferir,
  conferirAberturaManipulacao,
  conferirBaixaManipulacao,
  conferirConferenciaManipulacao,
  itemValidadoPelaFarmacia,
  limiteValidadeSobra,
  situacaoDepoisDaConferencia,
} from '../index.js';

const base: AberturaParaConferir = {
  avaliacao: { estado: 'decidido', decisao: 'valido' },
  ordemEmCurso: false,
  capela: { funcionando: true, grupos: [1] },
  grupo: 1,
  insumoExiste: true,
  loteNoLocal: true,
  quantidade: 2,
  validadeInsumo: '2026-12-31',
  validadeSobra: '2026-10-26T18:00',
  agora: '2026-10-26T10:00',
};
const codigos = (a: Partial<AberturaParaConferir>) =>
  conferirAberturaManipulacao({ ...base, ...a }).map((r) => r.codigo);

describe('ordem de manipulação (regra 11)', () => {
  it('nasce só do item validado: decisão "válido" do farmacêutico ou aprovação automática pela regra', () => {
    expect(itemValidadoPelaFarmacia({ estado: 'decidido', decisao: 'valido' })).toBe(true);
    expect(itemValidadoPelaFarmacia({ estado: 'automatico', decisao: null })).toBe(true);
    expect(itemValidadoPelaFarmacia({ estado: 'pendente', decisao: null })).toBe(false);
    expect(itemValidadoPelaFarmacia({ estado: 'decidido', decisao: 'nao-aprovado' })).toBe(false);
    expect(itemValidadoPelaFarmacia(null)).toBe(false);
    expect(codigos({})).toEqual([]);
    expect(codigos({ avaliacao: null })).toEqual(['item-nao-validado']);
    expect(codigos({ avaliacao: { estado: 'decidido', decisao: 'pendencia-revisao-medica' } })).toEqual([
      'item-nao-validado',
    ]);
  });

  it('uma ordem em curso por item; a capela do cadastro em funcionamento e o grupo dela', () => {
    expect(codigos({ ordemEmCurso: true })).toEqual(['ordem-em-curso']);
    expect(codigos({ capela: null })).toEqual(['capela-inexistente']);
    expect(codigos({ capela: { funcionando: false, grupos: [1] } })).toEqual(['capela-parada']);
    expect(codigos({ grupo: 9 })).toEqual(['grupo-de-outra-capela']);
    expect(codigos({ grupo: null })).toEqual([]);
  });

  it('o insumo do cadastro, o lote no local e não vencido, a quantidade positiva', () => {
    expect(codigos({ insumoExiste: false })).toEqual(['insumo-inexistente']);
    expect(codigos({ loteNoLocal: false })).toEqual(['lote-fora-do-local']);
    expect(codigos({ validadeInsumo: '2026-10-25' })).toContain('lote-vencido');
    expect(codigos({ validadeInsumo: '2026-10-26', validadeSobra: null })).toEqual([]);
    expect(codigos({ quantidade: 0 })).toEqual(['quantidade-invalida']);
  });

  it('a validade da sobra: depois do preparo, no máximo as horas da regra e nunca depois da validade do lote', () => {
    expect(REGRA_SOBRA_MANIPULACAO.horasMaximas).toBe(24);
    expect(limiteValidadeSobra('2026-10-26T10:00', '2026-12-31')).toBe('2026-10-27T10:00');
    expect(limiteValidadeSobra('2026-10-26T10:00', '2026-10-26')).toBe('2026-10-26T23:59');
    expect(codigos({ validadeSobra: '2026-10-26T09:59' })).toEqual(['sobra-no-passado']);
    expect(codigos({ validadeSobra: '2026-10-27T10:00' })).toEqual([]);
    expect(codigos({ validadeSobra: '2026-10-27T10:01' })).toEqual(['sobra-acima-da-regra']);
    expect(codigos({ validadeInsumo: '2026-10-26', validadeSobra: '2026-10-27T08:00' })).toEqual([
      'sobra-acima-da-regra',
    ]);
    expect(codigos({ validadeSobra: null })).toEqual([]);
  });

  it('a dupla conferência é de outro farmacêutico, só na ordem preparada; a reprovação leva o motivo', () => {
    const c = {
      situacao: 'aberta' as const,
      preparadoPor: 'FARM.A',
      conferente: 'FARM.B',
      resultado: 'aprovada' as const,
      observacao: null,
    };
    expect(conferirConferenciaManipulacao(c)).toEqual([]);
    expect(conferirConferenciaManipulacao({ ...c, conferente: 'farm.a ' }).map((r) => r.codigo)).toEqual([
      'mesma-pessoa',
    ]);
    expect(conferirConferenciaManipulacao({ ...c, situacao: 'conferida' }).map((r) => r.codigo)).toEqual([
      'ordem-ja-conferida',
    ]);
    expect(conferirConferenciaManipulacao({ ...c, resultado: 'reprovada' }).map((r) => r.codigo)).toEqual([
      'sem-motivo',
    ]);
    expect(
      conferirConferenciaManipulacao({
        ...c,
        resultado: 'reprovada',
        observacao: 'Volume final diferente da prescrição',
      }),
    ).toEqual([]);
    expect(situacaoDepoisDaConferencia('aprovada')).toBe('conferida');
    expect(situacaoDepoisDaConferencia('reprovada')).toBe('reprovada');
  });

  it('a baixa é a saída do insumo e da quantidade da ordem, só depois da conferência aprovada e uma vez', () => {
    const b = {
      situacao: 'conferida' as const,
      insumo: 10,
      quantidade: 2,
      itemSaida: 10,
      quantidadeSaida: 2,
    };
    expect(conferirBaixaManipulacao(b)).toEqual([]);
    expect(conferirBaixaManipulacao({ ...b, situacao: 'aberta' }).map((r) => r.codigo)).toEqual([
      'ordem-nao-conferida',
    ]);
    expect(conferirBaixaManipulacao({ ...b, situacao: 'reprovada' }).map((r) => r.codigo)).toEqual([
      'ordem-nao-conferida',
    ]);
    expect(conferirBaixaManipulacao({ ...b, situacao: 'baixada' }).map((r) => r.codigo)).toEqual([
      'ordem-ja-baixada',
    ]);
    expect(conferirBaixaManipulacao({ ...b, itemSaida: 11 }).map((r) => r.codigo)).toEqual([
      'saida-diferente-da-ordem',
    ]);
    expect(conferirBaixaManipulacao({ ...b, quantidadeSaida: 2.001 }).map((r) => r.codigo)).toEqual([
      'saida-diferente-da-ordem',
    ]);
    // Revisão do M46.4: a saída com lote é a do lote e da validade registrados na ordem, um lote só e a quantidade toda.
    const l = { ...b, loteInsumo: 'LT-SINT-1', validadeInsumo: '2027-03-31' };
    const lote = { lote: 'lt-sint-1 ', validade: '2027-03-31', quantidade: 2 };
    expect(conferirBaixaManipulacao({ ...l, lotesSaida: [] })).toEqual([]);
    expect(conferirBaixaManipulacao({ ...l, lotesSaida: [lote] })).toEqual([]);
    for (const lotesSaida of [
      [{ ...lote, lote: 'LT-OUTRO' }],
      [{ ...lote, validade: '2027-04-30' }],
      [{ ...lote, quantidade: 1 }],
      [
        { ...lote, quantidade: 1 },
        { ...lote, quantidade: 1 },
      ],
    ])
      expect(conferirBaixaManipulacao({ ...l, lotesSaida }).map((r) => r.codigo)).toEqual([
        'saida-diferente-da-ordem',
      ]);
    expect(
      conferirBaixaManipulacao({ ...b, loteInsumo: null, lotesSaida: [lote] }).map((r) => r.codigo),
    ).toEqual(['saida-diferente-da-ordem']);
  });
});
