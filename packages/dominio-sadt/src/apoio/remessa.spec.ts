import { describe, expect, it } from 'vitest';
import {
  conferirAmostraParaRemessa,
  conferirCodigoApoio,
  conferirFatorConversao,
  conferirMeioEnvio,
  etiquetaDoApoio,
  RecusaApoio,
  situacaoDaRemessaDepois,
} from './remessa.js';

const codigo = (fn: () => unknown) => {
  try {
    fn();
    return 'passou';
  } catch (e) {
    return e instanceof RecusaApoio ? e.codigo : String(e);
  }
};

describe('remessa do laboratório de apoio', () => {
  it('fecha só a aberta, com itens e sem item sem de-para', () => {
    expect(situacaoDaRemessaDepois('aberta', 'fechar', { itens: 2 })).toBe('fechada');
    expect(codigo(() => situacaoDaRemessaDepois('aberta', 'fechar', { itens: 0 }))).toBe('remessa-vazia');
    expect(codigo(() => situacaoDaRemessaDepois('aberta', 'fechar', { itens: 2, semDePara: 1 }))).toBe(
      'remessa-sem-de-para',
    );
    expect(codigo(() => situacaoDaRemessaDepois('enviada', 'fechar', { itens: 2 }))).toBe(
      'remessa-nao-aberta',
    );
  });

  it('envia só a fechada; reabre a fechada; inclui só na aberta', () => {
    expect(situacaoDaRemessaDepois('fechada', 'enviar')).toBe('enviada');
    expect(codigo(() => situacaoDaRemessaDepois('aberta', 'enviar'))).toBe('remessa-nao-fechada');
    expect(situacaoDaRemessaDepois('fechada', 'reabrir')).toBe('aberta');
    expect(codigo(() => situacaoDaRemessaDepois('enviada', 'reabrir'))).toBe('remessa-nao-fechada');
    expect(codigo(() => situacaoDaRemessaDepois('fechada', 'incluir'))).toBe('remessa-nao-aberta');
  });

  it('cancela com motivo e nunca depois de enviada', () => {
    expect(
      situacaoDaRemessaDepois('fechada', 'cancelar', { itens: 1, motivo: 'Transporte indisponível' }),
    ).toBe('cancelada');
    expect(codigo(() => situacaoDaRemessaDepois('aberta', 'cancelar', { itens: 1, motivo: ' ' }))).toBe(
      'motivo-obrigatorio',
    );
    expect(
      codigo(() => situacaoDaRemessaDepois('enviada', 'cancelar', { itens: 1, motivo: 'Desistência' })),
    ).toBe('remessa-ja-enviada');
  });

  it('o meio de integração só para o apoio integrado', () => {
    expect(codigo(() => conferirMeioEnvio('manual', 'integracao'))).toBe('meio-incompativel');
    expect(codigo(() => conferirMeioEnvio('manual', 'manual'))).toBe('passou');
    expect(codigo(() => conferirMeioEnvio('servico_web', 'integracao'))).toBe('passou');
  });

  it('só a amostra coletada do exame do apoio, fora de outra remessa', () => {
    const ok = {
      doLaboratorio: true,
      amostraColetada: true,
      emOutraRemessa: false,
      situacaoExame: 'coletado',
    };
    expect(codigo(() => conferirAmostraParaRemessa(ok))).toBe('passou');
    expect(codigo(() => conferirAmostraParaRemessa({ ...ok, doLaboratorio: false }))).toBe(
      'exame-de-outro-apoio',
    );
    expect(codigo(() => conferirAmostraParaRemessa({ ...ok, amostraColetada: false }))).toBe(
      'amostra-nao-coletada',
    );
    expect(codigo(() => conferirAmostraParaRemessa({ ...ok, emOutraRemessa: true }))).toBe(
      'amostra-em-remessa',
    );
    expect(codigo(() => conferirAmostraParaRemessa({ ...ok, situacaoExame: 'cancelado' }))).toBe(
      'exame-cancelado',
    );
  });

  it('a etiqueta leva só identificadores e o código do apoio', () => {
    const e = etiquetaDoApoio({
      laboratorio: 'Apoio Sintético',
      codigoCliente: 'H01',
      remessa: 'RA-7',
      sequencia: 3,
      codigoBarras: 'AM0001',
      codigoExameApoio: 'GLI',
      codigoMaterialApoio: 'SOR',
    });
    expect(e.codigo).toBe('H01-RA-7-003');
    expect(e.linhas).toEqual([
      'Apoio Sintético',
      'Remessa RA-7 / 003',
      'Amostra AM0001',
      'Exame GLI / Material SOR',
    ]);
    expect(
      etiquetaDoApoio({
        ...{ laboratorio: 'X', remessa: 'R', sequencia: 1, codigoBarras: 'AM9' },
        codigoCliente: null,
        codigoExameApoio: 'G',
        codigoMaterialApoio: null,
      }).codigo,
    ).toBe('AM9');
    expect(
      codigo(() =>
        etiquetaDoApoio({
          laboratorio: 'X',
          codigoCliente: null,
          remessa: 'R',
          sequencia: 1,
          codigoBarras: 'AM9',
          codigoExameApoio: null,
          codigoMaterialApoio: null,
        }),
      ),
    ).toBe('sem-de-para');
  });

  it('o código no apoio e o fator de conversão', () => {
    expect(conferirCodigoApoio(' GLI-01 ')).toBe('GLI-01');
    expect(codigo(() => conferirCodigoApoio('com espaço'))).toBe('codigo-invalido');
    expect(conferirFatorConversao(0.0555)).toBe(0.0555);
    expect(codigo(() => conferirFatorConversao(0))).toBe('fator-invalido');
    expect(codigo(() => conferirFatorConversao(Number.NaN))).toBe('fator-invalido');
  });
});
