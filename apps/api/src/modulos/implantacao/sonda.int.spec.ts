// Integração da porta própria da sonda da implantação contra o MariaDB real (cliente f22_o2, já criado pela obra da
// onda 2). Só leitura: nada é gravado. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaSondaPropria } from './sonda.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';

describe.skipIf(SEM_BANCO)('porta própria da sonda (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
  });
  afterAll(async () => {
    await nucleo?.encerrar();
  });

  it('saude: o banco do cliente responde', async () => {
    expect(await new PortaSondaPropria(nucleo, CLIENTE).bancoResponde()).toBe(true);
  });

  it('estabelecimentos: códigos dos ativos e não excluídos, iguais à contagem do banco', async () => {
    const porta = new PortaSondaPropria(nucleo, CLIENTE);
    const codigos = await porta.estabelecimentos();
    const n = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't' }, (l) =>
      l.uma<{ n: number }>('SELECT COUNT(*) AS n FROM estabelecimento WHERE ativo AND excluido_em IS NULL'),
    );
    expect(codigos.length).toBe(Number(n?.n));
    for (const c of codigos) expect(typeof c).toBe('string');
  });

  it('cliente inexistente: a saúde falha sem subir erro', async () => {
    expect(await new PortaSondaPropria(nucleo, 'cliente_que_nao_existe_x').bancoResponde()).toBe(false);
  });
});
