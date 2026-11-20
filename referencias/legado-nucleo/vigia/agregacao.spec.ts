import { describe, expect, it } from 'vitest';
import { agregar, alertaSchema, classificarAnexo, type LeituraMon } from './agregacao.js';

const leitura: LeituraMon = {
  banco: { oit: 100, oat: 150, ost: 150, proxima: 200 },
  anexos: [
    { id: 1, processo: '/usr/bin/node', marca: 'sgh:rede-teste:zz:api', propria: false },
    { id: 2, processo: 'C:\\SPDATA\\SGH.EXE', marca: null, propria: false },
    { id: 3, processo: '/usr/local/bin/node', marca: null, propria: false },
    { id: 4, processo: '/usr/bin/node', marca: 'sgh:rede-teste:zz:worker', propria: true },
    { id: 5, processo: '/opt/firebird/bin/isql', marca: null, propria: false },
    { id: 6, processo: '/usr/bin/node', marca: 'legado-simulado:1', propria: false },
  ],
  transacoes: [
    { anexo: 1, somenteLeitura: true, idadeMs: 7_000, propria: false },
    { anexo: 1, somenteLeitura: true, idadeMs: 100, propria: false },
    { anexo: 2, somenteLeitura: false, idadeMs: 60_000, propria: false },
    { anexo: 4, somenteLeitura: true, idadeMs: 5, propria: true },
    { anexo: 99, somenteLeitura: true, idadeMs: 5, propria: false },
  ],
  comandos: [
    { anexo: 2, estado: 1, idadeMs: 10 },
    { anexo: 3, estado: 2, idadeMs: 10 },
    { anexo: 2, estado: 2, idadeMs: 10 },
  ],
  travas: [
    { anexo: 2, travas: 40, esperas: 3, conflitos: 1 },
    { anexo: 2, travas: 2, esperas: 0, conflitos: 0 },
    { anexo: 1, travas: 0, esperas: 0, conflitos: 0 },
    { anexo: 4, travas: 9, esperas: 9, conflitos: 9 },
  ],
};

describe('agregação do coletor MON$', () => {
  it('classifica pela marca do novo e pelo executável do cliente', () => {
    expect(classificarAnexo({ processo: '/usr/bin/node', marca: 'sgh:r:e:api' })).toBe('novo');
    expect(classificarAnexo({ processo: 'C:\\SPDATA\\SGH.exe', marca: null })).toBe('spdata');
    expect(classificarAnexo({ processo: '/usr/bin/node', marca: null })).toBe('sante-api');
    expect(classificarAnexo({ processo: null, marca: 'legado-simulado:3' })).toBe('spdata-simulado');
    expect(classificarAnexo({ processo: '/bin/isql', marca: null })).toBe('outros');
  });

  it('agrega por sistema e por conexão do novo, sem a própria conexão do coletor; alerta aponta a conexão', () => {
    const c = agregar(leitura, {
      estabelecimento: 'zz',
      limiteTransacaoMs: 5_000,
      em: 'agora',
      duracaoMs: 12,
    });
    const s = Object.fromEntries(c.porSistema.map((x) => [x.sistema, x]));
    expect(s['novo']).toMatchObject({
      conexoes: 1,
      transacoes: 2,
      transacaoMaisLongaMs: 7_000,
      transacoesEscrita: 0,
    });
    expect(s['spdata']).toMatchObject({
      conexoes: 1,
      transacoes: 1,
      transacoesEscrita: 1,
      comandosAtivos: 1,
      comandosParados: 1,
      travas: 42,
      esperasPorTrava: 3,
      conflitos: 1,
    });
    // Parado (MON$STATE = 2) não conta como ativo; a própria conexão do coletor fica fora das travas.
    expect(s['sante-api']).toMatchObject({ conexoes: 1, comandosAtivos: 0, comandosParados: 1 });
    expect(s['novo']).toMatchObject({ travas: 0, esperasPorTrava: 0, conflitos: 0 });
    expect(s['outros']?.conexoes).toBe(1);
    expect(s['spdata-simulado']?.conexoes).toBe(1);
    expect(c.banco).toEqual({ oit: 100, oat: 150, ost: 150, proxima: 200, folgaOit: 100, folgaOat: 50 });
    expect(c.conexoesDoNovo).toEqual([
      {
        anexo: 1,
        marca: 'sgh:rede-teste:zz:api',
        transacoes: 2,
        transacoesEscrita: 0,
        transacaoMaisLongaMs: 7_000,
      },
    ]);
    expect(c.alertas).toEqual([
      {
        tipo: 'transacao-longa',
        estabelecimento: 'zz',
        anexo: 1,
        marca: 'sgh:rede-teste:zz:api',
        duracaoMs: 7_000,
        detalhe: 'transação do novo aberta há 7 s (limite 5 s)',
      },
    ]);
    // A transação longa do SPDATA é medida, mas não é alerta do novo.
    expect(c.alertas.some((a) => a.anexo === 2)).toBe(false);
  });

  it('leitura sem MON$RECORD_STATS: travas zeradas', () => {
    const semTravas: LeituraMon = {
      banco: leitura.banco,
      anexos: leitura.anexos,
      transacoes: leitura.transacoes,
      comandos: leitura.comandos,
    };
    const c = agregar(semTravas, { estabelecimento: 'zz', limiteTransacaoMs: 5_000, em: 'x', duracaoMs: 1 });
    expect(c.porSistema.every((x) => x.travas === 0 && x.esperasPorTrava === 0 && x.conflitos === 0)).toBe(
      true,
    );
  });

  it('alertas externos (schema reprovado) entram na mesma lista', () => {
    expect(alertaSchema('zz', 'homologado')).toBeNull();
    const a = alertaSchema('zz', 'divergente')!;
    const c = agregar(leitura, {
      estabelecimento: 'zz',
      limiteTransacaoMs: 60_000,
      em: 'x',
      duracaoMs: 1,
      alertasExternos: [a],
    });
    expect(c.alertas).toEqual([a]);
    expect(alertaSchema('zz', null)?.detalhe).toMatch(/não verificada/);
  });
});
