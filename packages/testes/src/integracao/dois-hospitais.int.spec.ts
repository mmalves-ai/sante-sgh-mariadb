// Regra 18: cada hospital no seu banco. Painel e indicadores leem pela conexão do estabelecimento da sessão (a
// conexão é conferida pelo código); o consolidado da Rede só no M57. HS-1: só o estabelecimento pc tem cópia;
// a parte hs fica em Bloqueio (o teste a pula com o motivo).
import { lerLeiturasPainel } from '@sgh/legado';
import { afterAll, describe, expect, it } from 'vitest';
import { codigos, criarNucleo } from './escrita.spec-util.js';

const nucleo = codigos.length > 0 ? criarNucleo() : null;
afterAll(async () => {
  await nucleo?.encerrar();
});

describe.skipIf(!nucleo)('cada hospital no seu banco', () => {
  it('a leitura de cada estabelecimento sai da conexão dele', async () => {
    const disponiveis = (await nucleo!.partida()).filter((s) => s.disponivel).map((s) => s.codigo);
    for (const cod of codigos) {
      if (!disponiveis.includes(cod)) {
        console.log(
          `[${cod}] sem cópia no ar: Bloqueio HS-1 (a parte deste estabelecimento fica para quando houver cópia)`,
        );
        continue;
      }
      const r = await nucleo!.lerSomente(
        { rede: nucleo!.rede, hospital: cod, traceId: 'int-m16-hospitais' },
        async (l) => ({
          hospital: l.hospital,
          leitos: (await lerLeiturasPainel(l)).leitos.length,
        }),
      );
      expect(r.hospital).toBe(cod);
      console.log(`[${cod}] painel do próprio banco: ${r.leitos} leitos`);
    }
    // Um contexto de outra rede é recusado (ARQ-2).
    await expect(
      nucleo!.lerSomente({ rede: 'outra-rede', hospital: codigos[0]!, traceId: 'x' }, async () => 1),
    ).rejects.toThrow();
  });
});
