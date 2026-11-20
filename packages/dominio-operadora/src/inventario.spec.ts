// Conferência do inventário da F0: contagem igual não aponta nada; tabela sem contagem, variação grande e
// beneficiário de verdade no outro sistema, sim.
import { INVENTARIO_OPERADORA } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { conferirInventario, semCarteiraNoOutroSistema } from './inventario.js';

const iguais = (): Record<string, number> =>
  Object.fromEntries(INVENTARIO_OPERADORA.map((t) => [t.tabela, t.linhas]));

describe('conferência do inventário', () => {
  it('contagens iguais às do retrato e os fictícios com 1 linha: nada a apontar', () => {
    const c = { ...iguais(), PSBENEFI: 1, PSVENDAS: 1 };
    const a = conferirInventario(c);
    expect(a).toEqual([]);
    expect(semCarteiraNoOutroSistema(a)).toBe(true);
  });

  it('variação pequena num domínio é cadastro; grande ou de zero, aponta', () => {
    const c = iguais();
    c['TBSIPANSPROC'] = 5800; // +0,6%
    c['CDDIAVENCCOB'] = 50; // 31 → 50
    const a = conferirInventario(c, [
      ...INVENTARIO_OPERADORA,
      {
        tabela: 'XVAZIA',
        tela: 'dominios',
        destino: 'crud',
        linhas: 0,
        gatilhos: 0,
        rotulo: 'Vazia',
        escrita: 'livre',
      },
    ]);
    expect(a).toEqual([
      { tipo: 'linhas-mudaram', tabela: 'CDDIAVENCCOB', antes: 31, agora: 50 },
      { tipo: 'tabela-sem-contagem', tabela: 'XVAZIA' },
    ]);
    const vazia = [
      {
        tabela: 'XVAZIA',
        tela: 'dominios',
        destino: 'crud',
        linhas: 0,
        gatilhos: 0,
        rotulo: 'Vazia',
        escrita: 'livre',
      },
    ] as const;
    expect(conferirInventario({ XVAZIA: 3 }, vazia)).toEqual([
      { tipo: 'linhas-mudaram', tabela: 'XVAZIA', antes: 0, agora: 3 },
    ]);
    expect(conferirInventario({ XVAZIA: 0 }, vazia)).toEqual([]);
  });

  it('beneficiário de verdade no outro sistema derruba a premissa da DP-11', () => {
    const a = conferirInventario({ ...iguais(), PSBENEFI: 40 });
    expect(a).toEqual([{ tipo: 'beneficiario-real', tabela: 'PSBENEFI', linhas: 40 }]);
    expect(semCarteiraNoOutroSistema(a)).toBe(false);
  });
});
