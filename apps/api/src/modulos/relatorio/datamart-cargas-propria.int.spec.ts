// Contrato de efeito do controle da carga do data mart na administração (01-REL L113) sobre o MariaDB real (cliente
// f22_o1, pelo caminho que a API serve: PortaCargasDataMartPropria). Confere:
//   - o pedido grava a carga manual completa em execução, com o usuário, a marcação `pedido = aguardando`, a versão 1
//     e a trilha; a lista a mostra aguardando o worker, com quem pediu;
//   - o segundo pedido com a carga aberta é recusado (409 carga-em-andamento) e não grava outra;
//   - fechada pelo worker (as colunas que a porta do worker grava), a lista mostra a situação, as linhas e a duração,
//     e o detalhe as etapas;
//   - a carga aberta há mais do que o teto aparece interrompida e não bloqueia o pedido seguinte;
//   - o outro estabelecimento não vê as cargas deste.
// Massa sintética (estabelecimentos f106a e f106b, usuário de serviço), apagada no fim com a trilha.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaCargasDataMartPropria } from './datamart-cargas-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o1';
const P = 'C1106';
const A = 'f106a';
const B = 'f106b';
const LOGIN = 'c1106.servico';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: unknown }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO)('cargas do data mart na administração (01-REL L113): contrato de efeito', () => {
  const nucleo = new NucleoProprio();
  const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: P }, fn);
  const ler = (sql: string, p: unknown[]) => escrever((e) => e.consultar<Record<string, unknown>>(sql, p));
  let estA = 0;
  let estB = 0;
  let usuario = 0;
  let porta: PortaCargasDataMartPropria;
  const ctx = (hospital = A) => ({ cliente: CLIENTE, hospital, usuario, correlacao: P });

  async function limpar(): Promise<void> {
    await escrever(async (e) => {
      for (const id of [estA, estB].filter((x) => x > 0)) {
        await e.executar(
          'DELETE x FROM carga_data_mart_etapa x JOIN carga_data_mart c ON c.id = x.carga_data_mart_id WHERE c.estabelecimento_id = ?',
          [id],
        );
        await e.executar('DELETE FROM carga_data_mart WHERE estabelecimento_id = ?', [id]);
      }
      await limparTrilhaDaMassa(e, { codigos: [A, B] });
    });
  }

  beforeAll(async () => {
    const agora = new Date();
    await escrever(async (e) => {
      const est = (c: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [c],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [c, `Teste sintético ${P}`, `Teste sintético ${P}`, agora],
        );
      estA = await est(A);
      estB = await est(B);
      usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [LOGIN],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        [LOGIN, `Usuário sintético ${P}`, agora],
      );
    });
    await limpar();
    porta = new PortaCargasDataMartPropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    await limpar().catch(() => undefined);
    await nucleo.encerrar();
  });

  it('o pedido grava a carga manual aguardando o worker, com o usuário e a trilha', async () => {
    const r = await porta.pedir(ctx());
    expect(r.situacao).toBe('aguardando');
    const [c] = await ler(
      `SELECT estabelecimento_id, assunto, tipo_carga, disparo, situacao, usuario_id, versao, concluido_em,
              JSON_UNQUOTE(JSON_EXTRACT(dados, '$.pedido')) AS pedido, criado_em IS NOT NULL AS criado, criado_por
         FROM carga_data_mart WHERE id = ?`,
      [r.id],
    );
    expect(c).toMatchObject({
      assunto: 'data_mart',
      tipo_carga: 'completa',
      disparo: 'manual',
      situacao: 'em_execucao',
      concluido_em: null,
      pedido: 'aguardando',
    });
    expect([c!['estabelecimento_id'], c!['usuario_id'], c!['versao'], c!['criado']].map(Number)).toEqual([
      estA,
      usuario,
      1,
      1,
    ]);
    const [t] = await ler(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'carga_data_mart' AND entidade_id = ?",
      [r.id],
    );
    expect(Number(t!['n'])).toBeGreaterThanOrEqual(1);
    const lista = await porta.listar(ctx());
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({
      id: r.id,
      disparo: 'manual',
      situacao: 'aguardando',
      pedidoPor: `Usuário sintético ${P}`,
      duracaoMs: null,
      etapas: 0,
    });
    expect(await porta.listar(ctx(B))).toHaveLength(0);
  });

  it('o segundo pedido com a carga aberta é recusado e não grava outra', async () => {
    const recusa = await porta.pedir(ctx()).then(
      () => null,
      (e: { problema?: { codigo?: string; status?: number } }) => e.problema,
    );
    expect(recusa).toMatchObject({ codigo: 'carga-em-andamento', status: 409 });
    expect(await ler('SELECT id FROM carga_data_mart WHERE estabelecimento_id = ?', [estA])).toHaveLength(1);
  });

  it('fechada pelo worker, a lista mostra a situação, as linhas e a duração, e o detalhe as etapas', async () => {
    const [c] = await ler('SELECT id, ocorrido_em FROM carga_data_mart WHERE estabelecimento_id = ?', [estA]);
    const id = Number(c!['id']);
    const v = c!['ocorrido_em'];
    const inicio = v instanceof Date ? v : new Date(String(v).replace(' ', 'T') + 'Z');
    const fim = new Date(inicio.getTime() + 65);
    await escrever(async (e) => {
      await e.executar(
        `INSERT INTO carga_data_mart_etapa (carga_data_mart_id, sequencia, tipo_objeto, objeto_carga, iniciado_em,
                concluido_em, duracao_ms, linhas_gravadas, situacao, criado_em)
         VALUES (?, 1, 'fato', 'fato_internacao', ?, ?, 65, 12, 'concluida', ?)`,
        [id, inicio, fim, fim],
      );
      await e.executar(
        `UPDATE carga_data_mart SET situacao = 'concluida', concluido_em = ?, linhas_lidas = 12, linhas_gravadas = 12,
                linhas_rejeitadas = 0, dados = ?, versao = versao + 1 WHERE id = ?`,
        [fim, JSON.stringify({ pedido: 'iniciado', etapas: 1, fatos: 1 }), id],
      );
    });
    const [x] = await porta.listar(ctx());
    expect(x).toMatchObject({ id, situacao: 'concluida', linhasGravadas: 12, duracaoMs: 65, etapas: 1 });
    const d = await porta.detalhe(ctx(), id);
    expect(d.itens).toEqual([
      {
        sequencia: 1,
        tipoObjeto: 'fato',
        objeto: 'fato_internacao',
        linhas: 12,
        duracaoMs: 65,
        situacao: 'concluida',
      },
    ]);
    const outro = await porta.detalhe(ctx(B), id).then(
      () => null,
      (e: { problema?: { status?: number } }) => e.problema?.status,
    );
    expect(outro).toBe(404);
  });

  it('a carga aberta há mais do que o teto aparece interrompida e não bloqueia o pedido seguinte', async () => {
    const velha = new Date(Date.now() - 7 * 3_600_000);
    const id = await escrever((e) =>
      e.inserir(
        `INSERT INTO carga_data_mart (estabelecimento_id, assunto, tipo_carga, disparo, ocorrido_em, situacao, criado_em)
         VALUES (?, 'data_mart', 'completa', 'agendado', ?, 'em_execucao', ?)`,
        [estA, velha, velha],
      ),
    );
    expect((await porta.listar(ctx())).find((x) => x.id === id)?.situacao).toBe('interrompida');
    const r = await porta.pedir(ctx());
    expect(r.id).toBeGreaterThan(id);
    const lista = await porta.listar(ctx());
    expect(lista.map((x) => x.situacao)).toEqual(['aguardando', 'concluida', 'interrompida']);
  });
});
