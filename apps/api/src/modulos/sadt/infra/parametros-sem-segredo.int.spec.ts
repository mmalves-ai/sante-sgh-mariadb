// Parâmetros do setor na porta própria do SADT (MariaDB, cliente f22_o2): a leitura ainda não tem tabela no modelo
// (pedido do lote 02-09) e responde 409 "modelo-pendente" com o motivo, sem devolver nada (nenhuma credencial vaza por
// um retorno vazio ou parcial); a memória (dev/ci) devolve só campos sem segredo.
import { credenciaisNaResposta, SETORES_SADT } from '@sgh/contratos';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaSadtMemoria } from '../porta-memoria.js';
import type { PortaSadt } from '../porta.js';
import { PortaSadtPropria } from '../porta-propria.js';
import { contexto, limparMassaSadt, type MassaSadt, montarMassaSadt, SEM_BANCO } from '../aplicacao/copia.spec-util.js';

describe.skipIf(SEM_BANCO)('parâmetros do setor sem segredo', () => {
  let nucleo: NucleoProprio;
  let m: MassaSadt | null = null;
  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassaSadt(nucleo, 'S9Q');
  }, 60_000);
  afterAll(async () => {
    await limparMassaSadt(nucleo, m);
    await nucleo.encerrar();
  });

  it('banco: 409 com o motivo; memória: nenhuma credencial na resposta', async () => {
    const c = contexto(m!);
    const banco: PortaSadt = new PortaSadtPropria(nucleo);
    const memoria: PortaSadt = new PortaSadtMemoria({ estado: () => 'verde' });
    for (const s of SETORES_SADT) {
      const e = await banco.parametros(c, s.codigo, m!.base.login).catch((x: unknown) => x);
      expect((e as ErroOperacao).problema).toMatchObject({ status: 409, codigo: 'modelo-pendente' });
      const r = await memoria.parametros(c, s.codigo, m!.base.login);
      expect(credenciaisNaResposta(r)).toEqual([]);
    }
  });
});
