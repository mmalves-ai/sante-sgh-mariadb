import { describe, expect, it } from 'vitest';
import {
  conferirKitsAgendamento,
  conferirRetiradaMaterial,
  kitJaNaLista,
  linhasKitAgendamento,
  listaMaterialAberta,
  materialRetiravelPeloKit,
  type KitPadraoDoAgendamento,
} from './kit-agendamento.js';

const padroes: KitPadraoDoAgendamento[] = [
  { procedimentoAgendamento: 1, kit: 10, quantidadeKits: 2 },
  { procedimentoAgendamento: 2, kit: 20, quantidadeKits: 1 },
];

describe('listaMaterialAberta', () => {
  it('aberta até o paciente estar no bloco; fechada depois de começar, ao terminar e ao cancelar', () => {
    for (const s of ['solicitado', 'em_analise', 'agendado', 'confirmado', 'no_bloco'])
      expect(listaMaterialAberta(s)).toBe(true);
    for (const s of ['em_andamento', 'realizado', 'cancelado', 'suspenso', 'reprovado'])
      expect(listaMaterialAberta(s)).toBe(false);
  });
});

describe('linhasKitAgendamento', () => {
  it('sem escolha, entram todos os padrões com a quantidade de kits do vínculo', () => {
    expect(linhasKitAgendamento(padroes, [])).toEqual([
      { procedimentoAgendamento: 1, kit: 10, quantidade: 2 },
      { procedimentoAgendamento: 2, kit: 20, quantidade: 1 },
    ]);
  });
  it('o kit que já está na lista (mesmo procedimento) não entra de novo', () => {
    const materiais = [{ kit: 10, procedimentoAgendamento: 1 }];
    expect(kitJaNaLista(padroes[0]!, materiais)).toBe(true);
    expect(linhasKitAgendamento(padroes, materiais).map((l) => l.kit)).toEqual([20]);
  });
  it('o mesmo kit em outro procedimento conta como outro', () => {
    expect(kitJaNaLista(padroes[0]!, [{ kit: 10, procedimentoAgendamento: 2 }])).toBe(false);
  });
  it('linha sem kit não conta como kit na lista', () => {
    expect(kitJaNaLista(padroes[0]!, [{ kit: null, procedimentoAgendamento: 1 }])).toBe(false);
  });
  it('com escolha, só os escolhidos entram', () => {
    expect(linhasKitAgendamento(padroes, [], [{ kit: 20, procedimentoAgendamento: 2 }])).toEqual([
      { procedimentoAgendamento: 2, kit: 20, quantidade: 1 },
    ]);
  });
  it('padrão repetido entra uma vez; quantidade inválida vira 1', () => {
    const p = [
      { procedimentoAgendamento: 1, kit: 10, quantidadeKits: 0 },
      { procedimentoAgendamento: 1, kit: 10, quantidadeKits: 3 },
    ];
    expect(linhasKitAgendamento(p, [])).toEqual([{ procedimentoAgendamento: 1, kit: 10, quantidade: 1 }]);
  });
});

describe('conferirKitsAgendamento', () => {
  const campos = (s: string, e: { kit: number; procedimentoAgendamento: number }[]) =>
    conferirKitsAgendamento(s, padroes, e).map((p) => p.campo);
  it('escolha válida em agendamento aberto passa', () => {
    expect(campos('agendado', [{ kit: 10, procedimentoAgendamento: 1 }])).toEqual([]);
  });
  it('recusa a lista fechada, a escolha vazia, o repetido e o kit fora do padrão, juntos', () => {
    expect(campos('realizado', [])).toEqual(['situacao', 'kits']);
    expect(
      campos('agendado', [
        { kit: 10, procedimentoAgendamento: 1 },
        { kit: 10, procedimentoAgendamento: 1 },
        { kit: 10, procedimentoAgendamento: 2 },
      ]),
    ).toEqual(['kits.1', 'kits.2']);
  });
  const kit = { natureza: 'kit', solicitacaoOpme: null, implantePermanente: false };
  it('a retirada só com a lista aberta', () => {
    expect(conferirRetiradaMaterial('confirmado', kit)).toEqual([]);
    expect(conferirRetiradaMaterial('em_andamento', kit).map((p) => p.campo)).toEqual(['situacao']);
  });
  it('a retirada só vale para a linha de kit: OPME, implante e outras naturezas são recusados', () => {
    for (const natureza of ['opme', 'material', 'instrumental', 'medicamento', 'rouparia'])
      expect(conferirRetiradaMaterial('agendado', { ...kit, natureza }).map((p) => p.campo)).toEqual([
        'natureza',
      ]);
    expect(conferirRetiradaMaterial('agendado', { ...kit, solicitacaoOpme: 7 }).map((p) => p.campo)).toEqual([
      'natureza',
    ]);
    expect(
      conferirRetiradaMaterial('agendado', { ...kit, implantePermanente: true }).map((p) => p.campo),
    ).toEqual(['natureza']);
    expect(conferirRetiradaMaterial('realizado', { ...kit, natureza: 'opme' }).map((p) => p.campo)).toEqual([
      'situacao',
      'natureza',
    ]);
    expect(materialRetiravelPeloKit(kit)).toBe(true);
    expect(materialRetiravelPeloKit({ ...kit, natureza: 'opme' })).toBe(false);
  });
});
