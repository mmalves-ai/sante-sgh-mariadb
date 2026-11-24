// Regras de apresentação TISS por fonte pagadora (06-FAT linhas 29 e 30). Massa sintética, sem dado real.
import type { ContaTiss, ItemContaTiss } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  aplicarValoresPadrao,
  apresentarConta,
  conferirLotePelaRegra,
  escolherRegraApresentacao,
  escolherValoresPadrao,
  type ItemRegraApresentacao,
  itemDaRegra,
  ordenarGuias,
  type OrigemItemConta,
  type RegraApresentacao,
  validarValorPadraoCampo,
  type ValorPadraoCampo,
} from './apresentacao.js';

const regra = (x: Partial<RegraApresentacao> = {}): RegraApresentacao => ({
  id: 1,
  tipoContaId: null,
  registroAns: null,
  codigoContratadoOperadora: null,
  limiteGuiasLote: null,
  ordenacaoGuias: 'numero_guia',
  usaGuiaConsulta: true,
  agrupaItens: false,
  omiteGuiaSemValor: false,
  usaFaturamentoEletronico: true,
  ativo: true,
  ...x,
});
const ir = (x: Partial<ItemRegraApresentacao>): ItemRegraApresentacao => ({
  id: 1,
  grupoId: null,
  itemId: null,
  funcaoId: null,
  setorId: null,
  profissionalId: null,
  tipoGuia: null,
  codigoApresentacao: null,
  descricaoApresentacao: null,
  agrupa: false,
  agrupamentoData: null,
  naoExporta: false,
  ativo: true,
  ...x,
});
const item = (seq: number, x: Partial<ItemContaTiss> = {}): ItemContaTiss => ({
  sequencial: seq,
  tipo: 4,
  natureza: 'material',
  data: '2026-10-10',
  codigo: `C${seq}`,
  codigoTabela: '19',
  descricao: `ITEM ${seq}`,
  quantidade: 1,
  valorUnitario: 10,
  ...x,
});
const origem = (itemId: number, x: Partial<OrigemItemConta> = {}): OrigemItemConta => ({
  itemId,
  grupoId: 50,
  funcaoId: null,
  setorId: null,
  profissionalId: null,
  ...x,
});
const conta = (itens: ItemContaTiss[], x: Partial<ContaTiss> = {}): ContaTiss =>
  ({
    conta: 7,
    tipoGuia: 2,
    numeroGuia: 'G-7',
    carteira: 'X',
    atendimentoRN: false,
    inicio: { data: '2026-10-10', hora: '08:00:00' },
    fim: { data: '2026-10-10', hora: '09:00:00' },
    caraterAtendimento: '1',
    tipoConsulta: '1',
    tipoAtendimento: '23',
    senha: '',
    guiaSolicitacao: '',
    dataAutorizacao: '',
    tipoFaturamento: '4',
    tipoInternacao: '1',
    regimeInternacao: '1',
    motivoEncerramento: '',
    profissional: { conselho: '06', numeroConselho: '1', uf: '33', cbos: '225125' },
    profissionalNome: '',
    profissionalCodigo: '',
    itens,
    ...x,
  }) as ContaTiss;

describe('regra de apresentação da conta', () => {
  it('a regra do tipo da conta vence a geral; inativa não vale', () => {
    const geral = regra({ id: 1 });
    const daConta = regra({ id: 2, tipoContaId: 9 });
    expect(escolherRegraApresentacao([geral, daConta], 9)?.id).toBe(2);
    expect(escolherRegraApresentacao([geral, daConta], 8)?.id).toBe(1);
    expect(escolherRegraApresentacao([regra({ ativo: false })], null)).toBeNull();
  });

  it('o item da regra mais específico decide: item > função > grupo; restrições somam; tipo de guia filtra', () => {
    const regras = [
      ir({ id: 1, grupoId: 50, codigoApresentacao: 'G' }),
      ir({ id: 2, itemId: 3, codigoApresentacao: 'I' }),
      ir({ id: 3, grupoId: 50, profissionalId: 4, codigoApresentacao: 'GP' }),
      ir({ id: 4, itemId: 3, tipoGuia: 'honorario', codigoApresentacao: 'H' }),
    ];
    expect(itemDaRegra(regras, origem(3), 'sp_sadt')?.id).toBe(2);
    expect(itemDaRegra(regras, origem(3), 'honorario')?.id).toBe(4);
    expect(itemDaRegra(regras, origem(9, { profissionalId: 4 }), 'sp_sadt')?.id).toBe(3);
    expect(itemDaRegra(regras, origem(9), 'sp_sadt')?.id).toBe(1);
    expect(itemDaRegra(regras, origem(9, { grupoId: 51 }), 'sp_sadt')).toBeNull();
  });

  it('troca código e descrição, tira o item que não vai ao arquivo e renumera', () => {
    const r = apresentarConta(
      conta([item(1), item(2), item(3)]),
      [origem(1), origem(2), origem(3)],
      regra(),
      [
        ir({ id: 1, itemId: 1, codigoApresentacao: '90000001', descricaoApresentacao: 'APRESENTADO' }),
        ir({ id: 2, itemId: 2, naoExporta: true }),
      ],
    );
    expect(r.conta.itens.map((i) => [i.sequencial, i.codigo, i.descricao])).toEqual([
      [1, '90000001', 'APRESENTADO'],
      [2, 'C3', 'ITEM 3'],
    ]);
    expect([r.retirados, r.trocados, r.somados, r.omitida]).toEqual([1, 1, 0, false]);
  });

  it('soma lançamentos iguais por dia sem mudar o total; primeira e última data', () => {
    const itens = [
      item(1, { codigo: 'X', data: '2026-10-10', quantidade: 2 }),
      item(2, { codigo: 'X', data: '2026-10-11', quantidade: 1 }),
      item(3, { codigo: 'X', data: '2026-10-10', quantidade: 3 }),
      item(4, { codigo: 'X', data: '2026-10-10', valorUnitario: 11 }),
    ];
    const ori = itens.map((_, k) => origem(k + 1, { grupoId: 50 }));
    const porDia = apresentarConta(conta(itens), ori, regra(), [ir({ grupoId: 50, agrupa: true })]);
    expect(porDia.conta.itens.map((i) => [i.data, i.quantidade, i.valorUnitario])).toEqual([
      ['2026-10-10', 5, 10],
      ['2026-10-11', 1, 10],
      ['2026-10-10', 1, 11],
    ]);
    const total = (c: ContaTiss) => c.itens.reduce((s, i) => s + i.quantidade * i.valorUnitario, 0);
    expect(total(porDia.conta)).toBe(total(conta(itens)));
    const ultima = apresentarConta(conta(itens), ori, regra(), [
      ir({ grupoId: 50, agrupa: true, agrupamentoData: 'ultima_data' }),
    ]);
    expect(ultima.conta.itens[0]).toMatchObject({ data: '2026-10-11', quantidade: 6 });
    expect(ultima.somados).toBe(2);
  });

  it('a regra geral agrupa quando não há item da regra; guia zerada é omitida quando a fonte pede', () => {
    const r = apresentarConta(
      conta([item(1, { codigo: 'Y' }), item(2, { codigo: 'Y' })]),
      [origem(1), origem(2)],
      regra({ agrupaItens: true }),
      [],
    );
    expect(r.conta.itens).toHaveLength(1);
    const z = apresentarConta(
      conta([item(1, { valorUnitario: 0 })]),
      [origem(1)],
      regra({ omiteGuiaSemValor: true }),
      [],
    );
    expect(z.omitida).toBe(true);
    expect(apresentarConta(conta([item(1, { valorUnitario: 0 })]), [origem(1)], regra(), []).omitida).toBe(
      false,
    );
  });

  it('sem regra a conta passa igual; origem desencontrada é erro', () => {
    const c = conta([item(1)]);
    expect(
      apresentarConta(c, [origem(1)], null, [ir({ itemId: 1, naoExporta: true })]).conta.itens,
    ).toHaveLength(1);
    expect(() => apresentarConta(c, [], null, [])).toThrow(/1 itens na guia e 0 na origem/);
  });

  it('recusa do lote: sem faturamento eletrônico, sem guia de consulta, acima do limite', () => {
    expect(conferirLotePelaRegra(null, 2, 999)).toBeNull();
    expect(conferirLotePelaRegra(regra({ usaFaturamentoEletronico: false }), 2, 1)?.codigo).toBe(
      'fonte-sem-faturamento-eletronico',
    );
    expect(conferirLotePelaRegra(regra({ usaGuiaConsulta: false }), 1, 1)?.codigo).toBe(
      'fonte-sem-guia-consulta',
    );
    expect(conferirLotePelaRegra(regra({ usaGuiaConsulta: false }), 2, 1)).toBeNull();
    expect(conferirLotePelaRegra(regra({ limiteGuiasLote: 2 }), 2, 3)?.codigo).toBe('lote-acima-do-limite');
    expect(conferirLotePelaRegra(regra({ limiteGuiasLote: 2 }), 2, 2)).toBeNull();
  });

  it('ordena as guias pela regra, estável', () => {
    const g = [
      {
        conta: conta([], { numeroGuia: 'B', inicio: { data: '2026-10-01', hora: '10:00:00' } }),
        paciente: 'b',
      },
      {
        conta: conta([], { numeroGuia: 'A', inicio: { data: '2026-10-02', hora: '10:00:00' } }),
        paciente: 'a',
      },
    ];
    expect(ordenarGuias(g, 'numero_guia').map((x) => x.conta.numeroGuia)).toEqual(['A', 'B']);
    expect(ordenarGuias(g, 'data_atendimento').map((x) => x.conta.numeroGuia)).toEqual(['B', 'A']);
    expect(ordenarGuias(g, 'paciente').map((x) => x.paciente)).toEqual(['a', 'b']);
  });
});

const vp = (x: Partial<ValorPadraoCampo>): ValorPadraoCampo => ({
  id: 1,
  campo: 'tipoAtendimento',
  valor: '05',
  sobrepoe: false,
  estabelecimentoId: null,
  regraId: null,
  regimeId: null,
  origemId: null,
  itemId: null,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  ativo: true,
  ...x,
});
const ctx = {
  estabelecimentoId: 1,
  regraId: 3,
  regimeId: 2,
  origemId: null,
  itemIds: [10],
  data: '2026-10-10',
};

describe('valor padrão de campo', () => {
  it('valida campo, domínio TISS e vigência na hora', () => {
    expect(
      validarValorPadraoCampo({
        campo: 'tipoAtendimento',
        valor: '05',
        vigenciaInicio: '2026-01-01',
        vigenciaFim: null,
      }),
    ).toEqual({});
    const e = validarValorPadraoCampo({
      campo: 'inexistente',
      valor: 'x',
      vigenciaInicio: '2026-02-01',
      vigenciaFim: '2026-01-01',
    });
    expect(Object.keys(e).sort()).toEqual(['campo', 'vigenciaFim']);
    expect(
      validarValorPadraoCampo({
        campo: 'caraterAtendimento',
        valor: '3',
        vigenciaInicio: '2026-01-01',
        vigenciaFim: null,
      })['valor'],
    ).toMatch(/não existe no padrão TISS/);
  });

  it('o mais específico vence; fora da vigência, inativo ou de outro contexto não vale', () => {
    const lista = [
      vp({ id: 1, valor: '01' }),
      vp({ id: 2, valor: '02', regraId: 3 }),
      vp({ id: 3, valor: '03', itemId: 10 }),
      vp({ id: 4, valor: '04', itemId: 11 }),
      vp({ id: 5, valor: '06', itemId: 10, vigenciaFim: '2026-09-30' }),
      vp({ id: 6, valor: '07', itemId: 10, regimeId: 2, ativo: false }),
      vp({ id: 7, campo: 'caraterAtendimento', valor: '9' }),
    ];
    const m = escolherValoresPadrao(lista, ctx);
    expect(m.get('tipoAtendimento')?.id).toBe(3);
    expect(m.has('caraterAtendimento')).toBe(false);
    expect(
      escolherValoresPadrao([vp({ id: 1 }), vp({ id: 2, vigenciaInicio: '2026-05-01' })], ctx).get(
        'tipoAtendimento',
      )?.id,
    ).toBe(2);
  });

  it('preenche o que não veio do atendimento; só substitui o informado com sobrepoe', () => {
    const c = conta([item(1)]);
    const naoInformado = aplicarValoresPadrao(c, [vp({ valor: '05' })], ctx, new Set());
    expect(naoInformado.conta.tipoAtendimento).toBe('05');
    expect(naoInformado.aplicados).toEqual(['tipoAtendimento']);
    const informado = aplicarValoresPadrao(c, [vp({ valor: '05' })], ctx, new Set(['tipoAtendimento']));
    expect(informado.conta.tipoAtendimento).toBe('23');
    const sobrepoe = aplicarValoresPadrao(
      c,
      [vp({ valor: '05', sobrepoe: true })],
      ctx,
      new Set(['tipoAtendimento']),
    );
    expect(sobrepoe.conta.tipoAtendimento).toBe('05');
  });
});
