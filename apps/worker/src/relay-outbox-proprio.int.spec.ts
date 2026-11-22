// Integração do relay da fila comum de saída sobre o MariaDB real (cliente f22_o5; lote F2.2 05-16). Contrato de efeito:
// a mensagem publicada fica enviada (processada_em, versão + 1); a que falhou soma a tentativa com a próxima tentativa no
// futuro e não volta no ciclo seguinte; a esgotada vai a erro com o motivo em código. Massa sintética no estabelecimento
// fo516r (só ids e códigos); a massa é apagada no fim. SGH_NUCLEO_SEM_BANCO=1 pula.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  escrever,
  garantirCliente,
  garantirEstabelecimento,
  SEM_BANCO,
} from './importadores/integracao.spec-util.js';
import { cicloRelayOutbox, MAX_TENTATIVAS_RELAY } from './relay-outbox-proprio.js';
import { dadosDoJobOutbox, type PendenteOutbox } from './relay-outbox.js';

describe.skipIf(SEM_BANCO)('relay da fila comum de saída sobre o banco próprio (f22_o5)', () => {
  let nucleo: NucleoProprio;
  let est = 0;
  const marca = `f516-${Date.now()}`;
  const ids: number[] = [];
  const linha = (id: number) =>
    escrever(nucleo, (e) =>
      e.uma(
        'SELECT situacao, tentativas, proxima_tentativa_em, processada_em, erro, versao FROM integracao_mensagem WHERE id = ?',
        [id],
      ),
    );

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    await escrever(nucleo, async (e) => {
      est = await garantirEstabelecimento(e, 'fo516r');
      await e.executar("DELETE FROM integracao_mensagem WHERE estabelecimento_id = ? AND direcao = 'saida'", [
        est,
      ]);
      for (const n of [1, 2, 3])
        ids.push(
          await e.inserir(
            `INSERT INTO integracao_mensagem (estabelecimento_id, ponto, direcao, situacao, tentativas, referencia_externa,
               conteudo, criado_em, versao) VALUES (?, 'teste.sintetico', 'saida', 'pendente', ?, ?, ?, ?, 1)`,
            [
              est,
              n === 3 ? MAX_TENTATIVAS_RELAY - 1 : 0,
              `${marca}-${n}`,
              JSON.stringify({ item: n, ok: true }),
              new Date(),
            ],
          ),
        );
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    await escrever(nucleo, (e) =>
      e.executar('DELETE FROM integracao_mensagem WHERE estabelecimento_id = ?', [est]),
    );
    await nucleo.encerrar();
  });

  it('publica e marca enviada; a falha espera; a esgotada vai a erro', async () => {
    const publicados: PendenteOutbox[] = [];
    const r = await cicloRelayOutbox(
      nucleo,
      CLIENTE,
      async (ev) => {
        if (ev.chave !== `${marca}-1`) throw new Error('fila fora (simulado)');
        publicados.push(ev);
      },
      { estabelecimento: est },
    );
    expect(r).toEqual({ lidos: 3, publicados: 1, falhas: 2, esgotados: 1 });
    expect(publicados[0]).toMatchObject({ cliente: CLIENTE, hospital: 'fo516r', tipo: 'teste.sintetico' });
    expect(dadosDoJobOutbox(publicados[0]!)).toEqual({ item: 1, ok: 1, hospital: 'fo516r' });
    const [a, b, c] = [await linha(ids[0]!), await linha(ids[1]!), await linha(ids[2]!)];
    expect(a).toMatchObject({ situacao: 'enviada', versao: 2 });
    expect(a!['processada_em']).not.toBeNull();
    expect(b).toMatchObject({
      situacao: 'pendente',
      tentativas: 1,
      versao: 2,
      erro: 'publicacao-falhou:Error',
    });
    expect(new Date(String(b!['proxima_tentativa_em'])).getTime()).toBeGreaterThan(Date.now());
    expect(c).toMatchObject({ situacao: 'erro', tentativas: MAX_TENTATIVAS_RELAY });
    // A que espera não volta no ciclo seguinte; a enviada e a esgotada também não.
    const de_novo = await cicloRelayOutbox(nucleo, CLIENTE, async () => undefined, { estabelecimento: est });
    expect(de_novo.lidos).toBe(0);
  });
});
