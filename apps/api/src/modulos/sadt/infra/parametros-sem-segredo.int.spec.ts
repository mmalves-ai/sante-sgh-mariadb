// Parâmetros do setor na porta própria do SADT (MariaDB): a leitura vem de parametro_definicao `sadt.*` com o valor
// efetivo (usuário, estabelecimento, rede, padrão) e nenhuma credencial vai na resposta (o modelo guarda segredo no
// cofre, nunca em parâmetro); a memória (dev/ci) devolve só campos sem segredo.
import { credenciaisNaResposta, SETORES_SADT } from '@sgh/contratos';
import { NucleoProprio } from '@sgh/nucleo';
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

  it('banco e memória: nenhuma credencial na resposta', async () => {
    const c = contexto(m!);
    const banco: PortaSadt = new PortaSadtPropria(nucleo);
    const memoria: PortaSadt = new PortaSadtMemoria({ estado: () => 'verde' });
    for (const s of SETORES_SADT) {
      const b = await banco.parametros(c, s.codigo, m!.base.login);
      expect(b.campos.every((x) => x.campo.startsWith('sadt.'))).toBe(true);
      expect(credenciaisNaResposta(b)).toEqual([]);
      const r = await memoria.parametros(c, s.codigo, m!.base.login);
      expect(credenciaisNaResposta(r)).toEqual([]);
    }
  });
});
