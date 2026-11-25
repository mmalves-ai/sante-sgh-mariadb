// Contrato de efeito da fila com o ERP corporativo (F8, 08-INTG L136) contra o MariaDB real (cliente de teste; massa
// SINTÉTICA com o código do teste, nenhuma pessoa real). Prova o que fica no banco: o sistema que não é ERP é recusado
// sem gravar; o lote de estoque do período grava exportacao_erp (gerado, número ERP- da sequência, contagem e soma) e um
// exportacao_erp_item pendente por movimento no layout canônico; gerar de novo no mesmo período é recusado (nada a
// exportar: já está num lote vivo); o envio pelo simulador grava o protocolo, aceita os itens com valor e rejeita o
// zerado (processado_com_erro, 1 erro); o retorno repetido não muda nada (idempotente) e o rejeitado corrigido pelo ERP
// vira exportado (processado); a conciliação recusa o total divergente e grava conciliado com o usuário; o lote novo
// cancelado antes do envio fica cancelado com os itens ignorados (nada é apagado).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaFilaErpPropria } from './fila-erp-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const P = 'c2033erp';

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(
      `DELETE FROM exportacao_erp_item WHERE exportacao_erp_id IN (SELECT x.id FROM (SELECT id FROM exportacao_erp WHERE estabelecimento_id IN ${est}) x)`,
      [P],
    );
    await e.executar(`DELETE FROM exportacao_erp WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM movimento_estoque WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM sequencia_negocio WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar("DELETE FROM sistema_externo WHERE codigo LIKE 'c2033-%'");
    await limparTrilhaDaMassa(e, { codigos: [P] });
    await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
}

describe.skipIf(SEM_BANCO)('Fila com o ERP corporativo (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaFilaErpPropria;
  let m: { est: number; usuario: number };
  const ctx = () => ({ cliente: CLIENTE, usuario: m.usuario, correlacao: P, hospital: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p));
  const lotes = () =>
    ler(
      'SELECT id, numero, situacao, quantidade_registros, quantidade_erros, valor_total, protocolo_externo, conciliado_por_usuario_id, versao FROM exportacao_erp WHERE estabelecimento_id = ? ORDER BY id',
      [m.est],
    );
  const itens = (lote: number) =>
    ler(
      'SELECT sequencia, entidade, situacao, chave_externa, valor, conteudo FROM exportacao_erp_item WHERE exportacao_erp_id = ? ORDER BY sequencia',
      [lote],
    );
  const erro = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return (e as { problema?: { status?: number; codigo?: string } }).problema ?? {};
    }
    throw new Error('Era para recusar.');
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    porta = new PortaFilaErpPropria(nucleo, CLIENTE);
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const us = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, 'Hospital Teste', 'Hospital sintético (fictício)', 'America/Sao_Paulo', ?)`,
        [P, agora],
      );
      await e.executar(
        `INSERT INTO sistema_externo (codigo, nome, categoria, finalidade, criado_em) VALUES
         ('c2033-erp', 'ERP corporativo (teste)', 'erp', 'Gestão corporativa (teste)', ?),
         ('c2033-lab', 'Laboratório (teste)', 'laboratorio', 'Exames (teste)', ?)`,
        [agora, agora],
      );
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        for (const [dia, valor] of [
          ['2026-10-03 10:00:00', 120.5],
          ['2026-10-10 08:00:00', 0],
          ['2026-10-20 09:30:00', 30.25],
          ['2026-11-02 09:30:00', 99],
        ] as const)
          await e.executar(
            `INSERT INTO movimento_estoque (estabelecimento_id, local_estoque_id, ocorrido_em, competencia,
               tipo_movimento_estoque_id, natureza, propriedade, insumo_id, unidade_medida_id, quantidade,
               quantidade_estoque, custo_unitario, valor_total, usuario_id, faturavel, origem, criado_em)
             VALUES (?, 1, ?, ?, 1, 'saida', 'proprio', 1, 1, 1, 1, ?, ?, ?, FALSE, 'sistema', ?)`,
            [est, dia, `${dia.slice(0, 7)}-01`, valor, valor, us!['id'], agora],
          );
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
      return { est, usuario: Number(us!['id']) };
    });
  });

  afterAll(async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await nucleo.encerrar();
  });

  it('recusa sistema que não é ERP e período invertido sem gravar nada', async () => {
    expect(
      await erro(
        porta.gerar(ctx(), {
          tipo: 'estoque',
          sistema: 'c2033-lab',
          inicio: '2026-10-01',
          fim: '2026-10-31',
        }),
      ),
    ).toMatchObject({ status: 422, codigo: 'sistema-nao-erp' });
    expect(
      await erro(
        porta.gerar(ctx(), {
          tipo: 'estoque',
          sistema: 'c2033-erp',
          inicio: '2026-10-31',
          fim: '2026-10-01',
        }),
      ),
    ).toMatchObject({ status: 422, codigo: 'periodo-invertido' });
    expect(await lotes()).toHaveLength(0);
  });

  it('gera o lote, envia pelo simulador, importa o retorno de forma idempotente e concilia', async () => {
    const g = await porta.gerar(ctx(), {
      tipo: 'estoque',
      sistema: 'c2033-erp',
      inicio: '2026-10-01',
      fim: '2026-10-31',
    });
    expect(g).toMatchObject({ quantidade: 3, valorTotal: 150.75, jaExportados: 0 });
    let [l] = await lotes();
    expect(l).toMatchObject({ situacao: 'gerado', quantidade_registros: 3, numero: 'ERP-1' });
    expect(Number(l!['valor_total'])).toBe(150.75);
    const it1 = await itens(g.id);
    expect(it1.map((i) => [i['sequencia'], i['entidade'], i['situacao']])).toEqual([
      [1, 'movimento_estoque', 'pendente'],
      [2, 'movimento_estoque', 'pendente'],
      [3, 'movimento_estoque', 'pendente'],
    ]);
    const conteudo =
      typeof it1[0]!['conteudo'] === 'string'
        ? JSON.parse(it1[0]!['conteudo'] as string)
        : it1[0]!['conteudo'];
    expect(conteudo).toMatchObject({ layout: 'sgh-erp/1', tipo: 'estoque', valor: 120.5 });

    // Mesmo período de novo: tudo já está num lote vivo.
    expect(
      await erro(
        porta.gerar(ctx(), {
          tipo: 'estoque',
          sistema: 'c2033-erp',
          inicio: '2026-10-01',
          fim: '2026-10-31',
        }),
      ),
    ).toMatchObject({ status: 422, codigo: 'sem-registros' });

    expect(await erro(porta.enviar(ctx(), g.id, { versao: 9 }))).toMatchObject({ status: 409 });
    const env = await porta.enviar(ctx(), g.id, { versao: Number(l!['versao']) });
    expect(env).toMatchObject({ situacao: 'processado_com_erro', alterados: 3 });
    [l] = await lotes();
    expect(l).toMatchObject({
      situacao: 'processado_com_erro',
      quantidade_erros: 1,
      protocolo_externo: 'SIM-ERP-1',
    });
    expect((await itens(g.id)).map((i) => [i['situacao'], i['chave_externa']])).toEqual([
      ['exportado', 'SIM-ERP-1-1'],
      ['rejeitado', null],
      ['exportado', 'SIM-ERP-1-3'],
    ]);

    // Retorno repetido: nada muda (nem a versão do lote).
    const rep = await porta.importarRetorno(ctx(), g.id, {
      itens: [
        { sequencia: 1, aceito: true, chaveExterna: 'SIM-ERP-1-1', mensagem: null },
        { sequencia: 3, aceito: true, chaveExterna: 'OUTRA', mensagem: null },
        { sequencia: 9, aceito: true, chaveExterna: 'X', mensagem: null },
      ],
    });
    expect(rep).toMatchObject({ alterados: 0, repetidos: 1, conflitos: [3], desconhecidos: [9] });
    expect((await lotes())[0]!['versao']).toBe(l!['versao']);

    // O ERP aceitou o rejeitado depois da correção.
    const cor = await porta.importarRetorno(ctx(), g.id, {
      itens: [{ sequencia: 2, aceito: true, chaveExterna: 'ERP-77', mensagem: null }],
    });
    expect(cor).toMatchObject({ situacao: 'processado', alterados: 1 });
    [l] = await lotes();
    expect(l).toMatchObject({ situacao: 'processado', quantidade_erros: 0 });

    expect(
      await erro(
        porta.conciliar(ctx(), g.id, { versao: Number(l!['versao']), valorInformado: 100, observacao: null }),
      ),
    ).toMatchObject({ status: 422, codigo: 'divergencia-valor' });
    const conc = await porta.conciliar(ctx(), g.id, {
      versao: Number(l!['versao']),
      valorInformado: 150.75,
      observacao: 'Conferido com o relatório do ERP',
    });
    expect(conc).toMatchObject({ exportados: 3, rejeitados: 0, valorExportado: 150.75 });
    [l] = await lotes();
    expect(l).toMatchObject({ situacao: 'conciliado', conciliado_por_usuario_id: m.usuario });
  });

  it('cancela o lote antes do envio com motivo, sem apagar: itens ignorados', async () => {
    const g = await porta.gerar(ctx(), {
      tipo: 'estoque',
      sistema: 'c2033-erp',
      inicio: '2026-11-01',
      fim: '2026-11-30',
    });
    const l = (await lotes()).find((x) => Number(x['id']) === g.id)!;
    expect(l['numero']).toBe('ERP-2');
    expect(
      await erro(porta.cancelar(ctx(), g.id, { versao: Number(l['versao']), motivo: 'curto' })),
    ).toMatchObject({
      status: 400,
    });
    expect(
      await porta.cancelar(ctx(), g.id, {
        versao: Number(l['versao']),
        motivo: 'Período fechado de novo pela controladoria',
      }),
    ).toMatchObject({ ignorados: 1 });
    expect((await lotes()).find((x) => Number(x['id']) === g.id)).toMatchObject({ situacao: 'cancelado' });
    expect((await itens(g.id)).map((i) => i['situacao'])).toEqual(['ignorado']);
    // O lote cancelado não segura o registro: ele pode ir num lote novo.
    expect(
      await porta.gerar(ctx(), {
        tipo: 'estoque',
        sistema: 'c2033-erp',
        inicio: '2026-11-01',
        fim: '2026-11-30',
      }),
    ).toMatchObject({ quantidade: 1 });
  });
});
