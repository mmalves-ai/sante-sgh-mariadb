// Contrato de efeito do job da fila com o ERP corporativo no worker (F8, 08-INTG L136) contra o MariaDB real (cliente
// de teste f22_o3; massa SINTÉTICA com o código do teste, nenhuma pessoa real). Prova o que fica no banco: o ciclo do
// worker envia o lote gerado pelo simulador (enviado_em, protocolo SIM-<número>), aceita os itens com valor e
// contraparte (exportado com chave externa) e rejeita o zerado (rejeitado com a mensagem), o lote fica
// processado_com_erro com 1 erro e a versão sobe; o lote de outro estabelecimento e o já enviado não são tocados; o
// segundo ciclo não envia nada; o retorno repetido não muda nada (idempotente) e o rejeitado aceito depois vira
// exportado (processado). A trilha de cada gravação existe. Nada é apagado.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../teste/limpar-trilha.spec-util.js';
import { adaptadorErpSimuladoWorker, importarRetornoErp } from './fila.js';
import { FonteFilaErpPropria } from './fila-propria.js';
import { cicloFilaErp } from './fila.service.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const P = 'c2033wk';
const Q = 'c2033wq';

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo IN (?, ?))';
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(
      `DELETE FROM exportacao_erp_item WHERE exportacao_erp_id IN (SELECT x.id FROM (SELECT id FROM exportacao_erp WHERE estabelecimento_id IN ${est}) x)`,
      [P, Q],
    );
    await e.executar(`DELETE FROM exportacao_erp WHERE estabelecimento_id IN ${est}`, [P, Q]);
    await e.executar("DELETE FROM sistema_externo WHERE codigo = 'c2033-wk-erp'");
    await limparTrilhaDaMassa(e, { codigos: [P, Q] });
    await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, Q]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
}

describe.skipIf(SEM_BANCO)('Job da fila com o ERP no worker (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let fonte: FonteFilaErpPropria;
  let m: { est: number; outro: number; lote: number; loteOutro: number; loteEnviado: number };
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p));
  const lote = async (id: number) =>
    (
      await ler(
        'SELECT situacao, quantidade_erros, protocolo_externo, enviado_em, processado_em, versao FROM exportacao_erp WHERE id = ?',
        [id],
      )
    )[0]!;
  const itens = (id: number) =>
    ler(
      'SELECT sequencia, situacao, chave_externa, mensagem_retorno, versao FROM exportacao_erp_item WHERE exportacao_erp_id = ? ORDER BY sequencia',
      [id],
    );
  const alvo = () => ({ cliente: CLIENTE, id: m.est, codigo: P, fuso: 'America/Sao_Paulo' });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    fonte = new FonteFilaErpPropria(nucleo, CLIENTE);
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const novoEst = (codigo: string) =>
        e.inserir(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
           VALUES (?, 'Hospital Teste', 'Hospital sintético (fictício)', 'America/Sao_Paulo', ?)`,
          [codigo, agora],
        );
      const est = await novoEst(P);
      const outro = await novoEst(Q);
      const sis = await e.inserir(
        `INSERT INTO sistema_externo (codigo, nome, categoria, finalidade, criado_em)
         VALUES ('c2033-wk-erp', 'ERP corporativo (teste do worker)', 'erp', 'Gestão corporativa (teste)', ?)`,
        [agora],
      );
      const novoLote = async (
        estab: number,
        numero: string,
        situacao: string,
        valores: (number | null)[],
      ) => {
        const id = await e.inserir(
          `INSERT INTO exportacao_erp (estabelecimento_id, sistema_externo_id, numero, direcao, tipo, situacao,
             quantidade_registros, gerado_em, criado_em)
           VALUES (?, ?, ?, 'exportacao', 'estoque', ?, ?, ?, ?)`,
          [estab, sis, numero, situacao, valores.length, agora, agora],
        );
        let seq = 0;
        for (const v of valores)
          await e.executar(
            `INSERT INTO exportacao_erp_item (exportacao_erp_id, sequencia, entidade, entidade_id, valor, situacao,
               conteudo, criado_em)
             VALUES (?, ?, 'movimento_estoque', ?, ?, 'pendente', ?, ?)`,
            [id, ++seq, 900000 + seq, v, JSON.stringify({ layout: 'sgh-erp/1', valor: v }), agora],
          );
        return id;
      };
      return {
        est,
        outro,
        lote: await novoLote(est, 'ERP-C2033-1', 'gerado', [120.5, 0, 30.25]),
        loteOutro: await novoLote(outro, 'ERP-C2033-2', 'gerado', [10]),
        loteEnviado: await novoLote(est, 'ERP-C2033-3', 'enviado', [5]),
      };
    });
  });

  afterAll(async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await nucleo.encerrar();
  });

  it('o ciclo envia o lote gerado pelo simulador e grava o retorno item a item', async () => {
    const r = await cicloFilaErp(fonte, adaptadorErpSimuladoWorker, alvo());
    expect(r).toEqual({ enviados: 1, falhas: 0, itensAlterados: 3, rejeitados: 1 });
    const l = await lote(m.lote);
    expect(l).toMatchObject({
      situacao: 'processado_com_erro',
      quantidade_erros: 1,
      protocolo_externo: 'SIM-ERP-C2033-1',
    });
    expect(l['enviado_em']).not.toBeNull();
    expect(l['processado_em']).not.toBeNull();
    expect(Number(l['versao'])).toBe(3);
    const it = await itens(m.lote);
    expect(it.map((i) => i['situacao'])).toEqual(['exportado', 'rejeitado', 'exportado']);
    expect(it[0]!['chave_externa']).toBeTruthy();
    expect(it[1]!['chave_externa']).toBeNull();
    expect(it[1]!['mensagem_retorno']).toBeTruthy();
    // A trilha das duas gravações (envio e retorno) no estabelecimento da massa.
    const [t] = await ler(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND entidade = 'exportacao_erp' AND entidade_id = ?",
      [m.est, m.lote],
    );
    expect(Number(t!['n'])).toBeGreaterThanOrEqual(2);
  });

  it('não toca o lote de outro estabelecimento nem o já enviado; o segundo ciclo não envia nada', async () => {
    expect((await lote(m.loteOutro))['situacao']).toBe('gerado');
    expect((await lote(m.loteEnviado))['situacao']).toBe('enviado');
    expect(await cicloFilaErp(fonte, adaptadorErpSimuladoWorker, alvo())).toEqual({
      enviados: 0,
      falhas: 0,
      itensAlterados: 0,
      rejeitados: 0,
    });
    expect(Number((await lote(m.lote))['versao'])).toBe(3);
  });

  it('o retorno repetido não muda nada e o rejeitado aceito depois fecha o lote como processado', async () => {
    const antes = await itens(m.lote);
    const chave = String(antes[0]!['chave_externa']);
    const repetido = await importarRetornoErp(fonte, String(m.est), m.lote, 3, [
      { sequencia: 1, aceito: true, chaveExterna: chave, mensagem: null },
    ]);
    expect(repetido.mudancas).toHaveLength(0);
    expect(repetido.repetidos).toBe(1);
    expect(Number((await lote(m.lote))['versao'])).toBe(3);
    const corrigido = await importarRetornoErp(fonte, String(m.est), m.lote, 3, [
      { sequencia: 2, aceito: true, chaveExterna: 'ERP-CORRIGIDO-2', mensagem: null },
    ]);
    expect(corrigido.situacaoLote).toBe('processado');
    const l = await lote(m.lote);
    expect(l).toMatchObject({ situacao: 'processado', quantidade_erros: 0 });
    const depois = await itens(m.lote);
    expect(depois.map((i) => i['situacao'])).toEqual(['exportado', 'exportado', 'exportado']);
    expect(depois[1]!['chave_externa']).toBe('ERP-CORRIGIDO-2');
    expect(depois[0]!['versao']).toEqual(antes[0]!['versao']);
  });
});
