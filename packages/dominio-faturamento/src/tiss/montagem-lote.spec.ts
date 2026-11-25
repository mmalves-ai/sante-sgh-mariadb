// Regra 3 do M31: a conta vira a guia do tipo do lote; o cabeçalho leva o registro ANS, o código do prestador e o CNES;
// o epílogo, o hash MD5; mat/med, diárias e taxas vão em outras despesas. Contas SINTÉTICAS.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  cabecalhoDoLote,
  type ContaTiss,
  type DadosPrestador,
  faltasDoPrestador,
  montarGuia,
  montarLote,
  montarRecurso,
  naturezaPadrao,
  TABELA_PADRAO,
} from './montagem.js';
import { conferirHashEpilogo } from './lote.js';
import { type ArquivoEsquema, carregarEsquemas, conferirLote } from './validacao.js';

let esquemas: ArquivoEsquema[];
beforeAll(async () => {
  esquemas = await carregarEsquemas();
});

const prestador: DadosPrestador = {
  registroAns: '999999',
  codigoPrestador: 'PRESTTESTE01',
  cnes: '9999999',
  nome: 'HOSPITAL FICTÍCIO DE TESTE',
};

const item = (sequencial: number, tipo: number, valor: number, medicamento = false) => {
  const natureza = naturezaPadrao(tipo, medicamento);
  return {
    sequencial,
    tipo,
    natureza,
    data: '2026-10-18',
    codigo: String(40_000_000 + sequencial),
    codigoTabela: TABELA_PADRAO[natureza],
    descricao: `ITEM FICTÍCIO ${sequencial} — TESTE`,
    quantidade: tipo === 4 ? 2.5 : 1,
    valorUnitario: valor,
  };
};

const conta = (tipoGuia: 1 | 2 | 3 | 4, n = 1): ContaTiss => ({
  conta: 9000 + n,
  tipoGuia,
  numeroGuia: `SINT-${tipoGuia}-${n}`,
  carteira: 'SINTETICO0000001',
  atendimentoRN: false,
  inicio: { data: '2026-10-10', hora: '08:00:00' },
  fim: { data: '2026-10-15', hora: '12:00:00' },
  caraterAtendimento: '1',
  tipoConsulta: '1',
  tipoAtendimento: '23',
  senha: '',
  guiaSolicitacao: '',
  dataAutorizacao: '',
  tipoFaturamento: '4',
  tipoInternacao: '1',
  regimeInternacao: '1',
  motivoEncerramento: '12',
  profissional: { conselho: '06', numeroConselho: '000000', uf: '33', cbos: '225125' },
  profissionalNome: 'PROFISSIONAL FICTÍCIO',
  profissionalCodigo: '',
  itens: [item(1, 3, 100), item(2, 2, 250), item(3, 1, 30), item(4, 4, 8, false), item(5, 4, 12, true)],
});

describe('montagem-lote', () => {
  it('natureza e tabela padrão pelo TIPO', () => {
    expect(naturezaPadrao(1)).toBe('taxa');
    expect(naturezaPadrao(2)).toBe('procedimento');
    expect(naturezaPadrao(3)).toBe('procedimento');
    expect(naturezaPadrao(4)).toBe('material');
    expect(naturezaPadrao(4, true)).toBe('medicamento');
    expect(TABELA_PADRAO.medicamento).toBe('20');
  });

  it('SP/SADT: procedimentos e outras despesas separados', () => {
    const g = montarGuia(conta(2), prestador);
    expect(g.tipo).toBe('sp-sadt');
    if (g.tipo !== 'sp-sadt') return;
    expect(g.itens).toHaveLength(2);
    expect(g.despesas?.map((d) => d.codigoDespesa)).toEqual(['07', '03', '02']);
  });

  it('consulta, resumo e honorário', () => {
    expect(montarGuia(conta(1), prestador).tipo).toBe('consulta');
    const r = montarGuia(conta(3), prestador);
    expect(r.tipo).toBe('resumo-internacao');
    if (r.tipo === 'resumo-internacao') expect(r.senha).toBe('SINT-3-1');
    const h = montarGuia(conta(4), prestador);
    expect(h.tipo).toBe('honorario');
    if (h.tipo === 'honorario') expect(h.itens).toHaveLength(1);
  });

  it('consulta sem procedimento usa o primeiro item', () => {
    const c = { ...conta(1), itens: [item(1, 1, 50)] };
    const g = montarGuia(c, prestador);
    if (g.tipo === 'consulta') expect(g.valor).toBe(50);
  });

  it.each([1, 2, 3, 4] as const)('lote do tipo %i: cabeçalho, hash e XSD 04.03.00', async (tipo) => {
    const m = montarLote(
      prestador,
      '000000000123',
      '000000000077',
      [conta(tipo, 1), conta(tipo, 2)],
      new Date('2026-10-23T13:14:15Z'),
    );
    expect(m.xml).toContain('<ans:registroANS>999999</ans:registroANS>');
    expect(m.xml).toContain('<ans:codigoPrestadorNaOperadora>PRESTTESTE01</ans:codigoPrestadorNaOperadora>');
    expect(m.xml).toContain('<ans:numeroLote>123</ans:numeroLote>');
    expect(m.xml).toContain('<ans:sequencialTransacao>77</ans:sequencialTransacao>');
    expect(conferirHashEpilogo(m.xml).confere).toBe(true);
    const c = await conferirLote(m, esquemas);
    expect(c.erros).toEqual([]);
  });

  it('resumo de internação: o indicador de acidente da conta vai ao XML; sem ele, 9 (não acidente)', async () => {
    const acidente = montarLote(
      prestador,
      '000000000124',
      '000000000078',
      [
        { ...conta(3, 1), indicadorAcidente: '0' },
        { ...conta(3, 2), indicadorAcidente: '1' },
      ],
      new Date('2026-10-23T13:14:15Z'),
    );
    expect(acidente.xml).toContain('<ans:indicadorAcidente>0</ans:indicadorAcidente>');
    expect(acidente.xml).toContain('<ans:indicadorAcidente>1</ans:indicadorAcidente>');
    expect(acidente.xml).not.toContain('<ans:indicadorAcidente>9</ans:indicadorAcidente>');
    expect((await conferirLote(acidente, esquemas)).erros).toEqual([]);
    const sem = montarLote(
      prestador,
      '000000000125',
      '000000000079',
      [conta(3, 1)],
      new Date('2026-10-23T13:14:15Z'),
    );
    expect(sem.xml).toContain('<ans:indicadorAcidente>9</ans:indicadorAcidente>');
  });

  it('recurso de glosa montado com o cabeçalho do prestador', async () => {
    const m = montarRecurso(
      prestador,
      '5',
      {
        numeroGuiaRecurso: 'SINT-R-1',
        nomeOperadora: 'OPERADORA FICTÍCIA',
        numeroLote: '123',
        numeroProtocolo: '456',
        data: '2026-10-20',
        guias: [
          { numeroGuiaOrigem: 'SINT-2-1', codigoGlosa: '1001', justificativa: 'Teste.', valorRecursado: 10 },
        ],
      },
      new Date('2026-10-23T10:00:00Z'),
    );
    expect((await conferirLote(m, esquemas)).estado).toBe('pronto');
  });

  it('cabeçalho: data e hora da transação em UTC; sequencial sem zeros', () => {
    expect(cabecalhoDoLote(prestador, '000000000009', new Date('2026-01-02T03:04:05Z'))).toMatchObject({
      sequencialTransacao: '9',
      data: '2026-01-02',
      hora: '03:04:05',
    });
  });

  it('faltas do cadastro do prestador', () => {
    expect(faltasDoPrestador(prestador)).toEqual([]);
    expect(faltasDoPrestador({ registroAns: '12', cnes: 'x' })).toHaveLength(2);
    expect(faltasDoPrestador({})).toHaveLength(3);
  });
});
