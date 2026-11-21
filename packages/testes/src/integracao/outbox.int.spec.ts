// Mensagem de saída (outbox) do núcleo sobre o MariaDB real (cliente f22_o5), em transação desfeita. Substitui o spec
// do outbox sobre a cópia do sistema de origem (tabela de saída da cópia, relay rodando no escritor da cópia):
//   - a mensagem nasce na MESMA transação do negócio, como 'saida' e 'pendente', sem tentativa, ligada à entidade e
//     ao estabelecimento da sessão: é o ponto de partida do relay do worker;
//   - a carga leva só ids e códigos: o nome gravado no negócio não vai para a mensagem (LGPD);
//   - outra conexão não enxerga a mensagem antes da confirmação (o relay nunca publica o que pode ser desfeito);
//   - depois do ROLLBACK, nem a mensagem nem a linha do negócio ficam.
// O relay (falha do Valkey, nova tentativa, publicação uma vez só) é provado em apps/worker/src/relay-outbox.int.spec.ts.
// Saída só com contagens e ids (dados sintéticos).
// Melhoria: a carga sem dado de pessoa é conferida no banco, no conteúdo gravado, e não só no objeto em memória.
// Melhoria: a invisibilidade antes do COMMIT é provada com uma segunda conexão real (isolamento do MariaDB).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Ambiente,
  codigoSintetico,
  contar,
  ctx,
  ctxOperacao,
  desfeito,
  incluirEstabelecimento,
  MARCA,
  num,
  prepararAmbiente,
  SEM_BANCO,
} from './escrita.spec-util.js';

/** Todos os valores folha de uma carga JSON. */
function folhas(v: unknown): unknown[] {
  if (v === null || typeof v !== 'object') return [v];
  return Object.values(v as Record<string, unknown>).flatMap(folhas);
}

describe.skipIf(SEM_BANCO)(
  'mensagem de saída do núcleo no MariaDB (cliente f22_o5, transação desfeita)',
  () => {
    let a: Ambiente;
    beforeAll(async () => {
      a = await prepararAmbiente();
    });
    afterAll(async () => {
      await a?.nucleo.encerrar();
    });

    it('nasce pendente na transação do negócio, só com ids, invisível a outra conexão e desfeita com o ROLLBACK', async () => {
      const codigo = codigoSintetico();
      const nome = `Hospital ${MARCA} ${codigo}`;
      const c = ctxOperacao(a);
      let mensagem = 0;
      const r = await desfeito(a, async (e) => {
        const s = await a.executor.executar(incluirEstabelecimento, c.cliente, { codigo, nome }, c, {
          escritor: e,
        });
        const id = num(s.resultado['id']);
        mensagem = num(s.eventos[0]);
        const linha = await e.uma<{
          direcao: string;
          situacao: string;
          tentativas: number;
          entidade_id: number | null;
          estabelecimento_id: number | null;
          conteudo: string | null;
        }>(
          `SELECT direcao, situacao, tentativas, entidade_id, estabelecimento_id, conteudo
           FROM integracao_mensagem WHERE id = ?`,
          [mensagem],
        );
        const conteudo = String(linha?.conteudo ?? '');
        let valores: unknown[];
        try {
          valores = folhas(JSON.parse(conteudo));
        } catch {
          valores = [conteudo];
        }
        // Segunda conexão, com a transação do negócio ainda aberta: não pode ver a mensagem.
        const vistaDeFora = await a.nucleo.lerSomente(ctx(a, 'int-outbox-fora'), (l) =>
          contar(l, 'SELECT COUNT(*) AS n FROM integracao_mensagem WHERE id = ?', [mensagem]),
        );
        return {
          eventos: s.eventos.length,
          direcao: linha?.direcao,
          situacao: linha?.situacao,
          tentativas: num(linha?.tentativas),
          daEntidade: num(linha?.entidade_id) === id,
          carregaOId: valores.some((v) => num(v) === id),
          semNome: !conteudo.includes(MARCA),
          soIdsECodigos: valores.every(
            (v) =>
              v === null ||
              typeof v === 'number' ||
              typeof v === 'boolean' ||
              /^[A-Za-z0-9._:-]{0,64}$/.test(String(v)),
          ),
          vistaDeFora,
        };
      });
      expect(r).toEqual({
        eventos: 1,
        direcao: 'saida',
        situacao: 'pendente',
        tentativas: 0,
        daEntidade: true,
        carregaOId: true,
        semNome: true,
        soIdsECodigos: true,
        vistaDeFora: 0,
      });
      const restou = await a.nucleo.lerSomente(ctx(a), async (l) => ({
        mensagem: await contar(l, 'SELECT COUNT(*) AS n FROM integracao_mensagem WHERE id = ?', [mensagem]),
        negocio: await contar(l, 'SELECT COUNT(*) AS n FROM estabelecimento WHERE codigo = ?', [codigo]),
      }));
      expect(restou).toEqual({ mensagem: 0, negocio: 0 });
    });
  },
);
