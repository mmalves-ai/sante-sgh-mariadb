// Contrato de efeito da entrega aos equipamentos do laboratório (C3-004, 05-SADT linha 13) contra o MariaDB real
// (cliente de teste). Massa SINTÉTICA: estabelecimento com o código do teste, interface ASTM apontando para um
// equipamento simulado no loopback e pedidos só com códigos fictícios.
// Prova o que fica no banco: o pedido pendente entregue ao equipamento por TCP (E1381) vira 'enviada' com o recibo e a
// tentativa somada; a falha de transporte soma a tentativa e reagenda (continua 'pendente', com o erro); no teto vira
// 'erro'; pelo simulador da central o resultado sintético entra como mensagem de entrada 'pendente' marcada como vinda
// do equipamento, uma vez só (a segunda volta não duplica); o resultado recebido pelo ouvinte também não duplica.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import type { AddressInfo } from 'node:net';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  escrever,
  garantirCliente,
  garantirEstabelecimento,
  SEM_BANCO,
} from '../importadores/integracao.spec-util.js';
import {
  cicloEntregaEquipamento,
  gravarResultadoRecebido,
  ouvinteEquipamento,
  PONTO_PEDIDO_EQUIPAMENTO,
  TENTATIVAS_ENTREGA_EQUIPAMENTO,
  transporteReal,
  transporteSimulado,
} from './entrega-equipamento.js';

describe.skipIf(SEM_BANCO)('entrega aos equipamentos (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let est = 0;
  let interfaceId = 0;
  let porta = 0;
  const recebidas: string[] = [];
  const servidor = ouvinteEquipamento('astm', async (r) => void recebidas.push(r.chave));
  const linha = (id: number) =>
    escrever(nucleo, (e) =>
      e.uma<Record<string, unknown>>(
        'SELECT situacao, tentativas, resposta, erro, proxima_tentativa_em FROM integracao_mensagem WHERE id = ?',
        [id],
      ),
    );
  const pedido = (amostra: string, tentativas = 0) =>
    escrever(nucleo, (e) =>
      e.inserir(
        `INSERT INTO integracao_mensagem (estabelecimento_id, ponto, direcao, situacao, tentativas, entidade, entidade_id,
           referencia_externa, conteudo, criado_em, versao) VALUES (?, ?, 'saida', 'pendente', ?, 'interface_equipamento', ?, ?, ?, ?, 1)`,
        [
          est,
          PONTO_PEDIDO_EQUIPAMENTO,
          tentativas,
          interfaceId,
          amostra,
          JSON.stringify({ amostra, urgente: false, testes: [{ codigo: 'GLI' }], astm: null }),
          new Date(),
        ],
      ),
    );
  const limpar = (e: Parameters<Parameters<typeof escrever>[1]>[0]) =>
    e.executar(
      `DELETE FROM integracao_mensagem WHERE estabelecimento_id = ? AND entidade = 'interface_equipamento'`,
      [est],
    );

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    porta = await new Promise<number>((ok) =>
      servidor.listen(0, '127.0.0.1', () => ok((servidor.address() as AddressInfo).port)),
    );
    await escrever(nucleo, async (e) => {
      est = await garantirEstabelecimento(e, 'c3004eq');
      await limpar(e);
      await e.executar('DELETE FROM interface_equipamento WHERE estabelecimento_id = ?', [est]);
      await e.executar('DELETE FROM equipamento_analitico WHERE estabelecimento_id = ?', [est]);
      await e.executar("DELETE FROM setor_diagnostico WHERE estabelecimento_id = ? AND codigo = 'SD-C3004'", [
        est,
      ]);
      await e.executar("DELETE FROM modelo_comunicacao WHERE codigo = 'ASTM-C3004'");
      const setor = await e.inserir(
        "INSERT INTO setor_diagnostico (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, 'SD-C3004', 'Laboratório sintético', 'laboratorio', ?)",
        [est, new Date()],
      );
      const modelo = await e.inserir(
        `INSERT INTO modelo_comunicacao (codigo, descricao, ativo, meio, padrao_mensagem, sentido, modo, criado_em, versao)
         VALUES ('ASTM-C3004', 'ASTM por rede (teste)', TRUE, 'rede', 'astm', 'bidirecional', 'online', ?, 1)`,
        [new Date()],
      );
      const eq = await e.inserir(
        `INSERT INTO equipamento_analitico (estabelecimento_id, codigo, descricao, setor_diagnostico_id, criado_em, versao)
         VALUES (?, 'EQ-C3004', 'Analisador sintético', ?, ?, 1)`,
        [est, setor, new Date()],
      );
      interfaceId = await e.inserir(
        `INSERT INTO interface_equipamento (estabelecimento_id, codigo, descricao, equipamento_analitico_id,
           modelo_comunicacao_id, protocolo, endereco_host, porta, criado_em, versao)
         VALUES (?, 'IF-C3004', 'Interface sintética', ?, ?, 'astm', '127.0.0.1', ?, ?, 1)`,
        [est, eq, modelo, porta, new Date()],
      );
    });
  }, 60_000);

  afterAll(async () => {
    servidor.close();
    if (!nucleo) return;
    await escrever(nucleo, async (e) => {
      await limpar(e);
      await e.executar('DELETE FROM interface_equipamento WHERE estabelecimento_id = ?', [est]);
      await e.executar('DELETE FROM equipamento_analitico WHERE estabelecimento_id = ?', [est]);
      await e.executar("DELETE FROM setor_diagnostico WHERE estabelecimento_id = ? AND codigo = 'SD-C3004'", [
        est,
      ]);
      await e.executar("DELETE FROM modelo_comunicacao WHERE codigo = 'ASTM-C3004'");
    });
    await nucleo.encerrar();
  });

  it('entrega por TCP vira enviada; a falha soma a tentativa e reagenda; no teto, erro', async () => {
    const ok = await pedido('AM-OK');
    const r = await cicloEntregaEquipamento(nucleo, CLIENTE, transporteReal('desenvolvimento'), {
      estabelecimento: est,
    });
    expect(r).toMatchObject({ lidas: 1, enviadas: 1, falhas: 0 });
    expect(await linha(ok)).toMatchObject({
      situacao: 'enviada',
      tentativas: 1,
      resposta: '{"recibo":"ASTM-4"}',
    });

    await escrever(nucleo, (e) =>
      e.executar('UPDATE interface_equipamento SET porta = 1 WHERE id = ?', [interfaceId]),
    );
    const falha = await pedido('AM-FALHA');
    const quase = await pedido('AM-TETO', TENTATIVAS_ENTREGA_EQUIPAMENTO - 1);
    const f = await cicloEntregaEquipamento(nucleo, CLIENTE, transporteReal('desenvolvimento'), {
      estabelecimento: est,
    });
    expect(f).toMatchObject({ lidas: 2, enviadas: 0, falhas: 2 });
    const l = await linha(falha);
    expect(l).toMatchObject({ situacao: 'pendente', tentativas: 1, erro: 'conexao-recusada' });
    expect(l?.['proxima_tentativa_em']).not.toBeNull();
    expect(await linha(quase)).toMatchObject({
      situacao: 'erro',
      tentativas: TENTATIVAS_ENTREGA_EQUIPAMENTO,
    });
    // reagendada: o próximo ciclo imediato não a pega
    const de = await cicloEntregaEquipamento(nucleo, CLIENTE, transporteReal('desenvolvimento'), {
      estabelecimento: est,
    });
    expect(de.lidas).toBe(0);
    await escrever(nucleo, (e) =>
      e.executar('UPDATE interface_equipamento SET porta = ? WHERE id = ?', [porta, interfaceId]),
    );
  });

  it('simulador: o resultado sintético entra como entrada pendente vinda do equipamento, sem duplicar', async () => {
    const id = await pedido('AM-SIM');
    const r = await cicloEntregaEquipamento(nucleo, CLIENTE, transporteSimulado, { estabelecimento: est });
    expect(r).toMatchObject({ lidas: 1, enviadas: 1, resultados: 1 });
    const entrada = await escrever(nucleo, (e) =>
      e.consultar(
        `SELECT situacao, conteudo FROM integracao_mensagem
          WHERE entidade = 'interface_equipamento' AND entidade_id = ? AND direcao = 'entrada' AND referencia_externa = ?`,
        [interfaceId, `SIM-${id}`],
      ),
    );
    expect(entrada).toHaveLength(1);
    expect(entrada[0]?.['situacao']).toBe('pendente');
    const c = JSON.parse(String(entrada[0]?.['conteudo'])) as {
      origem: string;
      amostras: { amostra: string }[];
    };
    expect(c.origem).toBe('equipamento');
    expect(c.amostras[0]?.amostra).toBe('AM-SIM');
    expect(
      (await cicloEntregaEquipamento(nucleo, CLIENTE, transporteSimulado, { estabelecimento: est })).lidas,
    ).toBe(0);
    const g = await escrever(nucleo, (e) =>
      gravarResultadoRecebido(e, {
        estabelecimento: est,
        interfaceId,
        chave: `SIM-${id}`,
        amostras: [],
        agora: new Date(),
      }),
    );
    expect(g.nova).toBe(false);
  });
});
