// Integração das portas próprias do OPME e da manipulação contra o MariaDB real (cliente f22_o3; massa SINTÉTICA,
// nenhuma pessoa real): a marca de OPME e de consignado do cadastro, o local sugerido com saldo de OPME (próprio ou
// consignado) só no estabelecimento da sessão, e as capelas com os grupos e a situação. Pendências: 409
// modelo-pendente com o motivo. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { CLASSE_OPME } from '@sgh/contratos';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaManipulacaoPropria } from './manipulacao-porta-propria.js';
import {
  codigoDe,
  contexto,
  limparMassa,
  type MassaSuprimentos,
  montarMassa,
  SEM_BANCO,
} from './massa-propria.spec-util.js';
import { PortaOpmePropria } from './opme-porta-propria.js';

describe.skipIf(SEM_BANCO)('portas próprias do OPME e da manipulação (MariaDB, cliente f22_o3)', () => {
  let nucleo: NucleoProprio;
  let m: MassaSuprimentos;
  let opme: PortaOpmePropria;
  let manipulacao: PortaManipulacaoPropria;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    opme = new PortaOpmePropria(nucleo);
    manipulacao = new PortaManipulacaoPropria(nucleo);
  }, 60_000);
  afterAll(async () => {
    await limparMassa(nucleo, m);
    await nucleo.encerrar();
  });

  it('OPME: classe, consignado e local com saldo no estabelecimento da sessão', async () => {
    const c = contexto(m);
    expect(await opme.classeDoItem(c, m.insumoOpme)).toBe(CLASSE_OPME);
    expect(await opme.classeDoItem(c, m.insumo)).toBeNull();
    expect(await opme.itemConsignado(c, m.insumoOpme)).toBe(true);
    expect(await opme.itemConsignado(c, m.insumo)).toBe(false);
    // O consignado conta (saldo próprio 0, consignado 2); o local A1 não tem OPME.
    expect(await opme.localComSaldo(c, [m.localA, m.localA2])).toBe(m.localA2);
    expect(await opme.localComSaldo(c, [m.localA])).toBeNull();
    // O local de A não existe para B.
    expect(await opme.localComSaldo(contexto(m, m.estB), [m.localA2])).toBeNull();
    expect(await codigoDe(opme.solicitacoesDoPeriodo())).toBe('modelo-pendente');
    expect(await opme.podeGravar()).toMatchObject({ pode: false });
  });

  it('manipulação: capelas do estabelecimento com grupos e situação', async () => {
    const capelas = await manipulacao.capelas(contexto(m));
    const minhas = capelas.filter((x) => x.nome.startsWith('CAPELA C'));
    expect(minhas).toHaveLength(2);
    expect(minhas.find((x) => x.id === m.capelaA)).toEqual({
      id: m.capelaA,
      nome: 'CAPELA CA',
      funcionando: true,
      manipulando: true,
      grupos: [{ id: m.grupoManipulacao, nome: 'GRUPO SINTETICO' }],
    });
    expect(minhas.find((x) => x.nome === 'CAPELA CM')).toMatchObject({
      funcionando: false,
      manipulando: false,
      grupos: [],
    });
    const deB = await manipulacao.capelas(contexto(m, m.estB));
    expect(deB.map((x) => x.nome)).toContain('CAPELA CB');
    expect(deB.map((x) => x.id)).not.toContain(m.capelaA);
    expect(await codigoDe(manipulacao.ordens())).toBe('modelo-pendente');
    // A avaliação farmacêutica do item prescrito lê avaliacao_farmaceutica(_item): item sem avaliação, null.
    expect(await manipulacao.avaliacao(contexto(m), 999_999_999)).toBeNull();
  });
});
