// Contrato de efeito da rotina da carga do data mart sobre o MariaDB real (01-ADM L115; cliente f22_o5): antes da hora
// da carga nada é aberto; depois dela a carga do dia fica em carga_data_mart (agendada, completa, concluída com
// rejeição, linhas somadas, versão 2, trilha) com uma etapa por dimensão e fato (carga_data_mart_etapa); a segunda volta
// do mesmo dia não abre outra; a abertura concorrente do mesmo dia é recusada; no dia seguinte a falha do carregador
// fica registrada (falhou, mensagem sem valores, concluída) e não se repete; o outro estabelecimento não é tocado.
// Massa sintética (dois estabelecimentos f528*), apagada no fim com a trilha. SGH_NUCLEO_SEM_BANCO=1 pula.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaDataMartPropria } from './datamart-carga-propria.js';
import {
  carregadorIndisponivel,
  cicloDataMart,
  type CarregadorDataMart,
  pedidosDataMart,
} from './datamart-carga.service.js';
import {
  CLIENTE,
  escrever,
  garantirCliente,
  garantirEstabelecimento,
  garantirUsuario,
  SEM_BANCO,
} from './importadores/integracao.spec-util.js';
import type { AlvoEstabelecimento } from './servico-worker.js';
import { limparTrilhaDaMassa } from './teste/limpar-trilha.spec-util.js';

const FUSO = 'America/Sao_Paulo';
// 01:00 local (antes da hora da carga), 05:00 local, 09:00 local do mesmo dia e 05:00 local do dia seguinte.
const CEDO = new Date('2026-11-25T04:00:00.000Z');
const DIA1 = new Date('2026-11-25T08:00:00.000Z');
const DIA1_TARDE = new Date('2026-11-25T12:00:00.000Z');
const DIA2 = new Date('2026-11-26T08:00:00.000Z');

const sintetico: CarregadorDataMart = async () => [
  { objeto: 'fato_internacao', linhas: 12, duracaoMs: 40 },
  { objeto: 'fato_item_conta', linhas: 30, rejeitadas: 2, duracaoMs: 25 },
  { objeto: 'carga', linhas: 1, duracaoMs: 1 },
];

describe.skipIf(SEM_BANCO)('carga do data mart registrada pelo worker (f22_o5)', () => {
  let nucleo: NucleoProprio;
  let est: AlvoEstabelecimento;
  let outro: AlvoEstabelecimento;

  const ler = (sql: string, p: unknown[]) => escrever(nucleo, (e) => e.consultar(sql, p));

  async function limpar(): Promise<void> {
    await escrever(nucleo, async (e) => {
      for (const id of [est?.id, outro?.id].filter(Boolean)) {
        await e.executar(
          'DELETE x FROM carga_data_mart_etapa x JOIN carga_data_mart c ON c.id = x.carga_data_mart_id WHERE c.estabelecimento_id = ?',
          [id],
        );
        await e.executar('DELETE FROM carga_data_mart WHERE estabelecimento_id = ?', [id]);
      }
      await limparTrilhaDaMassa(e, { codigos: ['f528k', 'f528m'] });
    });
  }

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    const a = await escrever(nucleo, (e) => garantirEstabelecimento(e, 'f528k'));
    const b = await escrever(nucleo, (e) => garantirEstabelecimento(e, 'f528m'));
    est = { cliente: CLIENTE, id: a, codigo: 'f528k', fuso: FUSO };
    outro = { cliente: CLIENTE, id: b, codigo: 'f528m', fuso: FUSO };
    await limpar();
  });

  afterAll(async () => {
    if (!nucleo) return;
    await limpar();
    await nucleo.encerrar();
  });

  it('antes da hora da carga nada é aberto', async () => {
    const porta = new PortaDataMartPropria(nucleo, CLIENTE);
    expect(await cicloDataMart(porta, CLIENTE, est, sintetico, CEDO)).toEqual({
      devida: false,
      carga: null,
      situacao: null,
      linhas: 0,
    });
    expect(await ler('SELECT id FROM carga_data_mart WHERE estabelecimento_id = ?', [est.id])).toHaveLength(
      0,
    );
  });

  it('registra a carga do dia com as etapas, a situação e a trilha; uma vez por dia', async () => {
    const porta = new PortaDataMartPropria(nucleo, CLIENTE);
    const fim = new Date(DIA1.getTime() + 66);
    const r = await cicloDataMart(porta, CLIENTE, est, sintetico, DIA1, () => fim);
    expect(r).toMatchObject({ devida: true, situacao: 'concluida_com_rejeicao', linhas: 43 });
    const [c] = await ler(
      `SELECT id, assunto, tipo_carga, disparo, situacao, linhas_lidas, linhas_gravadas, linhas_rejeitadas,
              mensagem_erro, usuario_id, versao, criado_em IS NOT NULL AS criado, alterado_em IS NOT NULL AS alterado,
              concluido_em >= ocorrido_em AS ordem, JSON_EXTRACT(dados, '$.fatos') AS fatos
         FROM carga_data_mart WHERE estabelecimento_id = ?`,
      [est.id],
    );
    expect(c).toMatchObject({
      id: r.carga,
      assunto: 'data_mart',
      tipo_carga: 'completa',
      disparo: 'agendado',
      situacao: 'concluida_com_rejeicao',
      mensagem_erro: null,
      usuario_id: null,
    });
    expect(
      [c!['linhas_lidas'], c!['linhas_gravadas'], c!['linhas_rejeitadas'], c!['versao'], c!['fatos']].map(
        Number,
      ),
    ).toEqual([45, 43, 2, 2, 2]);
    expect([c!['criado'], c!['alterado'], c!['ordem']].map(Number)).toEqual([1, 1, 1]);
    const etapas = await ler(
      `SELECT sequencia, tipo_objeto, objeto_carga, linhas_gravadas, duracao_ms, situacao, versao
         FROM carga_data_mart_etapa WHERE carga_data_mart_id = ? ORDER BY sequencia`,
      [r.carga],
    );
    expect(
      etapas.map((x) => [
        Number(x['sequencia']),
        x['tipo_objeto'],
        x['objeto_carga'],
        Number(x['linhas_gravadas']),
        Number(x['duracao_ms']),
        x['situacao'],
        Number(x['versao']),
      ]),
    ).toEqual([
      [1, 'fato', 'fato_internacao', 12, 40, 'concluida', 1],
      [2, 'fato', 'fato_item_conta', 30, 25, 'concluida', 1],
      [3, 'dimensao', 'carga', 1, 1, 'concluida', 1],
    ]);
    const [t] = await ler(
      `SELECT COUNT(*) AS n FROM trilha_auditoria
        WHERE (entidade = 'carga_data_mart' AND entidade_id = ?) OR (entidade = 'estabelecimento' AND entidade_id = ?)`,
      [r.carga, est.id],
    );
    expect(Number(t!['n'])).toBeGreaterThanOrEqual(2);

    // A segunda volta do mesmo dia não abre outra; a abertura concorrente do dia é recusada.
    expect((await cicloDataMart(porta, CLIENTE, est, sintetico, DIA1_TARDE)).devida).toBe(false);
    expect(await porta.abrir(est, DIA1_TARDE, new Date('2026-11-25T03:00:00.000Z'))).toBeNull();
    expect(await ler('SELECT id FROM carga_data_mart WHERE estabelecimento_id = ?', [est.id])).toHaveLength(
      1,
    );
    expect(await ler('SELECT id FROM carga_data_mart WHERE estabelecimento_id = ?', [outro.id])).toHaveLength(
      0,
    );
  });

  it('no dia seguinte a falha do carregador fica registrada sem valores e não se repete', async () => {
    const porta = new PortaDataMartPropria(nucleo, CLIENTE);
    const r = await cicloDataMart(porta, CLIENTE, est, carregadorIndisponivel, DIA2, () => DIA2);
    expect(r).toMatchObject({ devida: true, situacao: 'falhou', linhas: 0 });
    const [c] = await ler(
      'SELECT situacao, linhas_gravadas, mensagem_erro, concluido_em IS NOT NULL AS fechada FROM carga_data_mart WHERE id = ?',
      [r.carga],
    );
    expect(c!['situacao']).toBe('falhou');
    expect(Number(c!['linhas_gravadas'])).toBe(0);
    expect(Number(c!['fechada'])).toBe(1);
    expect(String(c!['mensagem_erro'])).toMatch(/^Error: leituras da carga do data mart/);
    expect(
      await ler('SELECT id FROM carga_data_mart_etapa WHERE carga_data_mart_id = ?', [r.carga]),
    ).toHaveLength(0);
    expect(
      (await cicloDataMart(porta, CLIENTE, est, sintetico, new Date(DIA2.getTime() + 3_600_000))).devida,
    ).toBe(false);
  });

  it('o pedido manual da administração (01-REL L113) é assumido uma vez, carregado e fechado com o usuário', async () => {
    const porta = new PortaDataMartPropria(nucleo, CLIENTE);
    const usuario = await escrever(nucleo, (e) => garantirUsuario(e, 'f528.datamart'));
    const pedido = new Date('2026-11-26T15:00:00.000Z');
    const id = await escrever(nucleo, (e) =>
      e.inserir(
        `INSERT INTO carga_data_mart (estabelecimento_id, assunto, tipo_carga, disparo, ocorrido_em, situacao, usuario_id,
                dados, criado_em)
         VALUES (?, 'data_mart', 'completa', 'manual', ?, 'em_execucao', ?, '{"pedido":"aguardando"}', ?)`,
        [est.id, pedido, usuario, pedido],
      ),
    );
    expect(await porta.pedidosAguardando(outro)).toEqual([]);
    expect(await porta.pedidosAguardando(est)).toEqual([id]);
    const fim = new Date(pedido.getTime() + 70);
    const feitos = await pedidosDataMart(porta, CLIENTE, est, sintetico, () => fim);
    expect(feitos).toEqual([{ devida: true, carga: id, situacao: 'concluida_com_rejeicao', linhas: 43 }]);
    const [c] = await ler(
      `SELECT disparo, situacao, usuario_id, linhas_gravadas, versao, concluido_em >= ocorrido_em AS ordem,
              JSON_UNQUOTE(JSON_EXTRACT(dados, '$.pedido')) AS pedido, JSON_EXTRACT(dados, '$.etapas') AS etapas
         FROM carga_data_mart WHERE id = ?`,
      [id],
    );
    expect(c).toMatchObject({ disparo: 'manual', situacao: 'concluida_com_rejeicao', pedido: 'iniciado' });
    expect(
      [c!['usuario_id'], c!['linhas_gravadas'], c!['versao'], c!['ordem'], c!['etapas']].map(Number),
    ).toEqual([usuario, 43, 3, 1, 3]);
    expect(await ler('SELECT id FROM carga_data_mart_etapa WHERE carga_data_mart_id = ?', [id])).toHaveLength(
      3,
    );
    // Já assumido: nem a lista nem uma segunda tentativa o pegam de novo.
    expect(await porta.pedidosAguardando(est)).toEqual([]);
    expect(await porta.assumir(est, id)).toBe(false);
    expect(await pedidosDataMart(porta, CLIENTE, est, sintetico)).toEqual([]);
    const [t] = await ler(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'carga_data_mart' AND entidade_id = ?",
      [id],
    );
    expect(Number(t!['n'])).toBeGreaterThanOrEqual(2);
  });
  it('o pedido manual aberto na hora da agendada segura a agendada: só uma carga aberta', async () => {
    const porta = new PortaDataMartPropria(nucleo, CLIENTE);
    const hora = new Date('2026-11-27T08:00:00.000Z');
    const desde = new Date('2026-11-27T03:00:00.000Z');
    const pedido = new Date(hora.getTime() - 60_000);
    const usuario = await escrever(nucleo, (e) => garantirUsuario(e, 'f528.datamart'));
    const id = await escrever(nucleo, (e) =>
      e.inserir(
        `INSERT INTO carga_data_mart (estabelecimento_id, assunto, tipo_carga, disparo, ocorrido_em, situacao, usuario_id,
                dados, criado_em)
         VALUES (?, 'data_mart', 'completa', 'manual', ?, 'em_execucao', ?, '{"pedido":"aguardando"}', ?)`,
        [outro.id, pedido, usuario, pedido],
      ),
    );
    const abertas = async () =>
      Number(
        (
          await ler(
            "SELECT COUNT(*) AS n FROM carga_data_mart WHERE estabelecimento_id = ? AND situacao = 'em_execucao'",
            [outro.id],
          )
        )[0]!['n'],
      );
    // Aguardando: a agendada não abre.
    expect(await porta.abrir(outro, hora, desde)).toBeNull();
    // Assumido por outro processo do worker (iniciado): continua sem abrir, nem pelo ciclo.
    expect(await porta.assumir(outro, id)).toBe(true);
    expect(await porta.abrir(outro, hora, desde)).toBeNull();
    expect((await cicloDataMart(porta, CLIENTE, outro, sintetico, hora)).carga).toBeNull();
    expect(await abertas()).toBe(1);
    expect(
      await ler("SELECT id FROM carga_data_mart WHERE estabelecimento_id = ? AND disparo = 'agendado'", [
        outro.id,
      ]),
    ).toHaveLength(0);
    // A manual aberta há mais do que o teto (interrompida) não segura mais a agendada.
    await escrever(nucleo, (e) =>
      e.executar('UPDATE carga_data_mart SET ocorrido_em = ? WHERE id = ?', [
        new Date(hora.getTime() - 7 * 3_600_000),
        id,
      ]),
    );
    const agendada = await porta.abrir(outro, hora, desde);
    expect(agendada).toBeGreaterThan(0);
    expect(await porta.abrir(outro, hora, desde)).toBeNull();
  });
});
