// F3.7 (06-FAT linha 34): o recurso de glosa vira a guia de recurso TISS 04.03.00 (RECURSO_GLOSA) por item, validada no
// XSD oficial antes de guardar; o que falta para montar é listado em português; os itens vão em lotes por fonte
// pagadora e lote de origem. Massa sintética (nenhuma pessoa real).
import { describe, expect, it } from 'vitest';
import { criarMontadorRecurso, guardaXmlMemoria } from '../tiss/montador.js';
import { lotesDeRecurso } from './recurso-lote.js';
import {
  faltasDoRecursoTiss,
  type ItemRecursoTiss,
  type OrigemRecursoTiss,
  recursoTissDoLote,
} from './recurso-tiss.js';

const origem: OrigemRecursoTiss = {
  numeroLote: '000000000123',
  numeroProtocolo: '456789',
  registroAns: '999998',
  codigoPrestador: 'PREST-TESTE',
  nomeOperadora: 'OPERADORA FICTICIA DE TESTE',
};
const item = (x: Partial<ItemRecursoTiss> = {}): ItemRecursoTiss => ({
  numeroGuia: 'G-0001',
  numeroGuiaOperadora: null,
  senha: null,
  data: '2026-10-02',
  codigoTabela: '22',
  codigo: '10101012',
  descricao: 'Consulta ficticia de teste',
  codigoGlosa: '1001',
  valorRecursado: 120.5,
  justificativa: 'Procedimento autorizado pela senha da guia (texto ficticio).',
  ...x,
});

describe('recurso de glosa na TISS: faltas, montagem por guia e XSD', () => {
  it('sem faltas com o lote de origem protocolado, o cadastro e os itens completos', () => {
    expect(faltasDoRecursoTiss(origem, [item()])).toEqual([]);
  });

  it('lista o que impede a guia de recurso: lote, protocolo, cadastro e itens', () => {
    const f = faltasDoRecursoTiss(
      { ...origem, numeroLote: null, numeroProtocolo: 'ABC', registroAns: '12', codigoPrestador: ' ' },
      [item({ numeroGuia: null, codigoGlosa: null, codigo: '', data: null })],
    );
    expect(f).toEqual([
      'o lote TISS em que a conta foi apresentada',
      'o protocolo do lote de origem numérico, com até 12 dígitos',
      'o registro ANS da operadora (6 dígitos)',
      'o código do prestador na operadora',
      'o número da guia de origem de cada item',
      'o motivo da glosa (código de 4 dígitos da terminologia) de cada item',
      'o código do procedimento ou da despesa de cada item',
      'a data de realização de cada item',
    ]);
    expect(faltasDoRecursoTiss({ ...origem, numeroProtocolo: null }, [])).toEqual([
      'o protocolo da operadora no lote de origem',
      'ao menos um item recorrido',
    ]);
  });

  it('agrupa os itens por guia de origem, em sequência, com o lote sem zeros e o total por guia', () => {
    const r = recursoTissDoLote('0000000007', '2026-11-20', origem, [
      item(),
      item({ numeroGuia: 'G-0002', numeroGuiaOperadora: 'OP-9', senha: 'S1', valorRecursado: 10 }),
      item({ codigo: '30101010', valorRecursado: 0.25 }),
    ]);
    expect(r.numeroGuiaRecurso).toBe('7');
    expect(r.numeroLote).toBe('123');
    expect(r.numeroProtocolo).toBe('456789');
    expect(
      r.guias.map((g) => [g.numeroGuiaOrigem, g.valorRecursado, g.itens?.map((i) => i.sequencial)]),
    ).toEqual([
      ['G-0001', 120.75, [1, 2]],
      ['G-0002', 10, [1]],
    ]);
    expect(r.guias[1]).toMatchObject({ numeroGuiaOperadora: 'OP-9', senha: 'S1' });
  });

  it('o XML do recurso por item passa no XSD 04.03.00 e é guardado uma vez, pela chave do lote do recurso', async () => {
    const guarda = guardaXmlMemoria();
    const montar = criarMontadorRecurso(guarda);
    const r = recursoTissDoLote('0000000007', '2026-11-20', origem, [
      item(),
      item({ numeroGuia: 'G-0002', numeroGuiaOperadora: 'OP-9', senha: 'S1', valorRecursado: 10 }),
      item({ codigo: '30101010', codigoTabela: '19', valorRecursado: 0.25 }),
    ]);
    const m = await montar({
      hospital: '1',
      convenio: 5,
      numeroLote: '000000000042',
      prestador: { registroAns: '999998', codigoPrestador: 'PREST-TESTE' },
      recurso: r,
      agora: new Date('2026-11-20T12:00:00Z'),
    });
    expect(m.erros).toEqual([]);
    expect(m.valido).toBe(true);
    expect(m.guias).toBe(2);
    expect(m.valor).toBe(130.75);
    expect(m.chaveObjeto).toMatch(/^1\/tiss\/recursos\/5\/000000000042-[0-9a-f]{16}\.xml$/);
    const xml = new TextDecoder('latin1').decode(guarda.objetos.get(m.chaveObjeto)!);
    expect(xml).toContain('<ans:tipoTransacao>RECURSO_GLOSA</ans:tipoTransacao>');
    expect(xml.match(/<ans:itensGuia>/g)).toHaveLength(3);
    expect(xml).toContain('<ans:valorTotalRecursado>130.75</ans:valorTotalRecursado>');
    expect(xml).toContain('<ans:numeroProtocolo>456789</ans:numeroProtocolo>');
  });

  it('XSD recusa (motivo fora da terminologia): nada é guardado e o erro volta explicado', async () => {
    const guarda = guardaXmlMemoria();
    const montar = criarMontadorRecurso(guarda);
    const m = await montar({
      hospital: '1',
      convenio: 5,
      numeroLote: '000000000043',
      prestador: { registroAns: '999998', codigoPrestador: 'PREST-TESTE' },
      recurso: recursoTissDoLote('8', '2026-11-20', origem, [item({ codigoGlosa: '0000' })]),
      agora: new Date('2026-11-20T12:00:00Z'),
    });
    expect(m.valido).toBe(false);
    expect(m.erros.length).toBeGreaterThan(0);
    expect(m.explicacao.length).toBe(m.erros.length);
    expect(guarda.objetos.size).toBe(0);
  });

  it('lote de recurso por fonte pagadora e por lote de origem (a guia de recurso cita um protocolo)', () => {
    const l = lotesDeRecurso([
      { fontePagadora: 1, loteOrigem: 10, i: 'a' },
      { fontePagadora: 1, loteOrigem: 11, i: 'b' },
      { fontePagadora: 1, loteOrigem: 10, i: 'c' },
      { fontePagadora: 1, loteOrigem: null, i: 'd' },
    ]);
    expect(l.map((x) => [x.loteOrigem, x.itens.map((y) => y.i)])).toEqual([
      [10, ['a', 'c']],
      [11, ['b']],
      [null, ['d']],
    ]);
  });
});
