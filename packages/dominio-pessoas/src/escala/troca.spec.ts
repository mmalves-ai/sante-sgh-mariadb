// Regra 8, segunda parte (ficha do M52, seção 8): troca = pedido → aceite do colega → aprovação do coordenador. O
// pedido só da escala publicada e de plantão que não começou; um plantão em uma troca aberta por vez; quem é parte não
// aprova; a aprovação confere de novo que os plantões não mudaram.
import { describe, expect, it } from 'vitest';
import {
  conferirPassoDaTroca,
  conferirPedidoDeTroca,
  conferirPlantaoNaAprovacao,
  estadoDepois,
  type PedidoDeTroca,
  type SituacaoDoPasso,
} from './troca.js';

const agora = '2026-11-01T10:00';
const a = {
  id: 1,
  escala: 7,
  vinculo: 10,
  pessoa: 100,
  situacao: 'previsto',
  inicio: '2026-11-05T07:00',
  versao: 2,
};
const b = {
  id: 2,
  escala: 7,
  vinculo: 20,
  pessoa: 200,
  situacao: 'previsto',
  inicio: '2026-11-06T07:00',
  versao: 0,
};
const pedido = (x: Partial<PedidoDeTroca> = {}): PedidoDeTroca => ({
  tipo: 'troca',
  plantao: a,
  estadoEscala: 'publicada',
  versaoInformada: 2,
  colega: { vinculo: 20, pessoa: 200, ativo: true },
  plantaoColega: b,
  estadoEscalaColega: 'publicada',
  versaoColegaInformada: 0,
  emTrocaAberta: new Set(),
  agora,
  ...x,
});
const codigo = (c: { ok: boolean; codigo?: string }) => (c.ok ? 'ok' : c.codigo);

describe('pedido de troca', () => {
  it('troca e cessão válidas', () => {
    expect(conferirPedidoDeTroca(pedido()).ok).toBe(true);
    expect(
      conferirPedidoDeTroca(
        pedido({
          tipo: 'cessao',
          plantaoColega: null,
          estadoEscalaColega: null,
          versaoColegaInformada: null,
        }),
      ).ok,
    ).toBe(true);
  });

  it('recusas do plantão de quem pede', () => {
    expect(codigo(conferirPedidoDeTroca(pedido({ estadoEscala: 'rascunho' })))).toBe('escala-em-rascunho');
    expect(codigo(conferirPedidoDeTroca(pedido({ plantao: { ...a, situacao: 'cancelado' } })))).toBe(
      'plantao-cancelado',
    );
    expect(codigo(conferirPedidoDeTroca(pedido({ versaoInformada: 1 })))).toBe('desatualizado');
    expect(codigo(conferirPedidoDeTroca(pedido({ agora: '2026-11-05T07:00' })))).toBe('plantao-comecou');
    expect(
      codigo(conferirPedidoDeTroca(pedido({ colega: { vinculo: 20, pessoa: 200, ativo: false } }))),
    ).toBe('colega-inativo');
    expect(codigo(conferirPedidoDeTroca(pedido({ colega: { vinculo: 11, pessoa: 100, ativo: true } })))).toBe(
      'mesma-pessoa',
    );
    expect(codigo(conferirPedidoDeTroca(pedido({ emTrocaAberta: new Set([1]) })))).toBe('plantao-em-troca');
  });

  it('recusas do plantão do colega', () => {
    expect(codigo(conferirPedidoDeTroca(pedido({ tipo: 'cessao' })))).toBe('cessao-com-plantao');
    expect(codigo(conferirPedidoDeTroca(pedido({ plantaoColega: null })))).toBe('troca-sem-plantao');
    expect(codigo(conferirPedidoDeTroca(pedido({ plantaoColega: { ...b, id: 1 } })))).toBe('mesmo-plantao');
    expect(codigo(conferirPedidoDeTroca(pedido({ plantaoColega: { ...b, vinculo: 30 } })))).toBe(
      'plantao-de-outro',
    );
    expect(codigo(conferirPedidoDeTroca(pedido({ estadoEscalaColega: 'rascunho' })))).toBe(
      'escala-em-rascunho',
    );
    expect(codigo(conferirPedidoDeTroca(pedido({ plantaoColega: { ...b, situacao: 'cancelado' } })))).toBe(
      'plantao-cancelado',
    );
    expect(codigo(conferirPedidoDeTroca(pedido({ versaoColegaInformada: 5 })))).toBe('desatualizado');
    expect(
      codigo(conferirPedidoDeTroca(pedido({ plantaoColega: { ...b, inicio: '2026-11-01T09:00' } }))),
    ).toBe('plantao-comecou');
    expect(codigo(conferirPedidoDeTroca(pedido({ emTrocaAberta: new Set([2]) })))).toBe('plantao-em-troca');
  });
});

describe('passos da troca', () => {
  const s = (x: Partial<SituacaoDoPasso>): SituacaoDoPasso => ({
    estado: 'pedida',
    papel: 'colega',
    emNomeDe: false,
    aprova: false,
    colegaTemAcesso: true,
    ...x,
  });

  it('responder: o colega; a coordenação só quando o colega não tem acesso; quem pede, nunca', () => {
    expect(conferirPassoDaTroca('responder', s({})).ok).toBe(true);
    expect(codigo(conferirPassoDaTroca('responder', s({ estado: 'aceita' })))).toBe('troca-respondida');
    expect(codigo(conferirPassoDaTroca('responder', s({ papel: 'quemPediu', emNomeDe: true })))).toBe(
      'responder-o-proprio',
    );
    expect(codigo(conferirPassoDaTroca('responder', s({ papel: 'outro' })))).toBe('so-o-colega');
    expect(codigo(conferirPassoDaTroca('responder', s({ papel: 'outro', emNomeDe: true })))).toBe(
      'colega-com-acesso',
    );
    expect(
      conferirPassoDaTroca('responder', s({ papel: 'outro', emNomeDe: true, colegaTemAcesso: false })).ok,
    ).toBe(true);
  });

  it('decidir: só a aceita, por quem aprova e não é parte', () => {
    expect(conferirPassoDaTroca('decidir', s({ estado: 'aceita', papel: 'outro', aprova: true })).ok).toBe(
      true,
    );
    expect(
      codigo(conferirPassoDaTroca('decidir', s({ estado: 'pedida', papel: 'outro', aprova: true }))),
    ).toBe('troca-nao-aceita');
    expect(codigo(conferirPassoDaTroca('decidir', s({ estado: 'aceita', papel: 'outro' })))).toBe(
      'sem-permissao',
    );
    for (const papel of ['quemPediu', 'colega'] as const)
      expect(codigo(conferirPassoDaTroca('decidir', s({ estado: 'aceita', papel, aprova: true })))).toBe(
        'aprovar-a-propria',
      );
    // Quatro olhos: quem registrou o pedido ou o aceite (em nome de alguém) não aprova.
    expect(
      codigo(
        conferirPassoDaTroca(
          'decidir',
          s({ estado: 'aceita', papel: 'outro', aprova: true, registrouAlgumPasso: true }),
        ),
      ),
    ).toBe('aprovar-o-que-registrou');
  });

  it('cancelar: quem pediu ou a coordenação, antes da decisão', () => {
    expect(conferirPassoDaTroca('cancelar', s({ papel: 'quemPediu' })).ok).toBe(true);
    expect(conferirPassoDaTroca('cancelar', s({ estado: 'aceita', papel: 'outro', emNomeDe: true })).ok).toBe(
      true,
    );
    expect(codigo(conferirPassoDaTroca('cancelar', s({ papel: 'colega' })))).toBe('so-quem-pediu');
    for (const estado of ['aprovada', 'reprovada', 'recusada', 'cancelada'] as const)
      expect(codigo(conferirPassoDaTroca('cancelar', s({ estado, papel: 'quemPediu' })))).toBe(
        'troca-encerrada',
      );
  });

  it('o estado seguinte', () => {
    expect([estadoDepois('responder', true), estadoDepois('responder', false)]).toEqual([
      'aceita',
      'recusada',
    ]);
    expect([estadoDepois('decidir', true), estadoDepois('decidir', false)]).toEqual([
      'aprovada',
      'reprovada',
    ]);
    expect(estadoDepois('cancelar', true)).toBe('cancelada');
  });

  it('na aprovação, o plantão é o mesmo do pedido e ainda não começou', () => {
    expect(conferirPlantaoNaAprovacao(a, 2, 10, agora).ok).toBe(true);
    expect(codigo(conferirPlantaoNaAprovacao(null, 2, 10, agora))).toBe('troca-desatualizada');
    expect(codigo(conferirPlantaoNaAprovacao({ ...a, versao: 3 }, 2, 10, agora))).toBe('troca-desatualizada');
    expect(codigo(conferirPlantaoNaAprovacao({ ...a, situacao: 'cancelado' }, 2, 10, agora))).toBe(
      'troca-desatualizada',
    );
    expect(codigo(conferirPlantaoNaAprovacao({ ...a, vinculo: 20 }, 2, 10, agora))).toBe(
      'troca-desatualizada',
    );
    expect(codigo(conferirPlantaoNaAprovacao(a, 2, 10, '2026-11-05T08:00'))).toBe('plantao-comecou');
  });
});
