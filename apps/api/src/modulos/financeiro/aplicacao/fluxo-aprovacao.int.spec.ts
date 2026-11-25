// F8, 07-FIN linha 65: contrato de efeito do fluxo de aprovação configurável contra o MariaDB real (massa SINTÉTICA
// "L0207" e códigos T2016). Prova o que fica no banco:
//   - o fluxo nasce inteiro (fluxo_aprovacao, etapa_fluxo_aprovacao, aprovador_etapa); o inválido e o de código repetido
//     não deixam nada; encerrar desliga o fluxo (vigência fechada) e o título sem fluxo segue a alçada (recusa sem-fluxo);
//   - o agrupador guarda os membros (membro_agrupador_aprovacao) e restringe o aprovador; as respostas padrão;
//   - título a pagar: submeter abre o pedido na primeira etapa exigida (a faixa da etapa decide); quem pediu não decide;
//     quem não é aprovador não decide; o celular só para o aprovador liberado; quórum "todos" segura a etapa; aprovar
//     até o fim autoriza o título (autorizado, autorizador e o pedido); reprovar pede justificativa e não autoriza;
//   - pedido de compra: submeter põe em aguardando aprovação; devolver volta a rascunho; aprovar grava quem e quando;
//   - contrato: aprovar põe em vigor;
//   - cada decisão guarda a etapa, a resposta padrão e o canal; a fila do aprovador traz só o que ele decide.
import { randomUUID } from 'node:crypto';
import type { Executor } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OPERACOES_FLUXO_APROVACAO, pendenciasDoAprovador } from '../fluxo-aprovacao-propria.js';
import {
  CLIENTE,
  codigoDaGravacao,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  SEM_BANCO,
  tituloDaMassa,
} from './massa-banco.spec-util.js';
import { PortaFinanceiroPropria } from '../porta-propria.js';

type Op = keyof typeof OPERACOES_FLUXO_APROVACAO;
const SUF = randomUUID().slice(0, 6).toUpperCase();
const cod = (c: string) => `T2016${c}${SUF}`;
const HOJE = new Date().toISOString().slice(0, 10);

describe.skipIf(SEM_BANCO)('fluxo de aprovação configurável (MariaDB)', () => {
  let m: MassaFinanceiro;
  let ex: Executor;
  let porta: PortaFinanceiroPropria;
  const resp: Record<'aprovo' | 'reprovo' | 'devolvo', number> = { aprovo: 0, reprovo: 0, devolvo: 0 };
  const fluxos: number[] = [];
  const compras: number[] = [];
  const contratos: number[] = [];

  const exec = async (op: Op, usuario: number, entrada: unknown) =>
    (
      await ex.executar(OPERACOES_FLUXO_APROVACAO[op] as never, CLIENTE, entrada, {
        ...m.ctx(usuario),
        chaveIdempotencia: `t2016-${randomUUID()}`,
      })
    ).resultado as Record<string, unknown>;
  const uma = (sql: string, p: unknown[]) =>
    m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't2016' }, (l) => l.uma(sql, p));
  const conta = async (sql: string, p: unknown[]) => Number((await uma(sql, p))?.['n'] ?? 0);
  const titulo = async (documento: number, valor: number) => {
    const c = m.ctx(m.lanca);
    const t = await porta.executar(c, 'financeiro.criarTituloPagar', tituloDaMassa(m, documento, valor), {
      ...c,
      chaveIdempotencia: `t2016-${randomUUID()}`,
    });
    return Number(t.resultado['titulo']);
  };
  const aprovador = (usuario: number, extra: Record<string, unknown> = {}) => ({
    usuario,
    papel: null,
    vigenciaInicio: '2026-01-01',
    aprovaPeloCelular: true,
    ...extra,
  });
  const decidir = (usuario: number, pedido: number, resposta: number, justificativa = '', canal = 'web') =>
    exec('decidir', usuario, { pedido, resposta, justificativa, canal });

  beforeAll(async () => {
    m = await montarMassa();
    ex = m.nucleo.criarExecutor();
    porta = new PortaFinanceiroPropria(m.nucleo);
    for (const [k, efeito] of [
      ['aprovo', 'aprova'],
      ['reprovo', 'reprova'],
      ['devolvo', 'devolve'],
    ] as const)
      resp[k] = Number(
        (
          await exec('salvarResposta', m.aprova, {
            codigo: cod(k.slice(0, 3).toUpperCase()),
            descricao: k,
            efeito,
          })
        )['resposta'],
      );
  });

  afterAll(async () => {
    if (!m) return;
    await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-t2016' }, async (e) => {
      const f = fluxos.length ? fluxos : [0];
      const q = f.map(() => '?').join(',');
      await e.executar(
        `DELETE d FROM decisao_aprovacao d JOIN pedido_aprovacao p ON p.id = d.pedido_aprovacao_id WHERE p.fluxo_aprovacao_id IN (${q})`,
        f,
      );
      await e.executar(`UPDATE titulo_pagar SET pedido_aprovacao_id = NULL WHERE estabelecimento_id = ?`, [
        m.est,
      ]);
      await e.executar(`DELETE FROM pedido_aprovacao WHERE fluxo_aprovacao_id IN (${q})`, f);
      await e.executar(
        `DELETE a FROM aprovador_etapa a JOIN etapa_fluxo_aprovacao t ON t.id = a.etapa_fluxo_aprovacao_id WHERE t.fluxo_aprovacao_id IN (${q})`,
        f,
      );
      await e.executar(
        `DELETE m FROM membro_agrupador_aprovacao m JOIN agrupador_aprovacao a ON a.id = m.agrupador_aprovacao_id WHERE a.codigo LIKE ?`,
        [`T2016%${SUF}`],
      );
      await e.executar('DELETE FROM agrupador_aprovacao WHERE codigo LIKE ?', [`T2016%${SUF}`]);
      await e.executar('DELETE FROM resposta_padrao_aprovacao WHERE codigo LIKE ?', [`T2016%${SUF}`]);
      if (compras.length)
        await e.executar(
          `DELETE FROM pedido_compra WHERE id IN (${compras.map(() => '?').join(',')})`,
          compras,
        );
      if (contratos.length)
        await e.executar(
          `DELETE FROM contrato_fornecedor WHERE id IN (${contratos.map(() => '?').join(',')})`,
          contratos,
        );
    });
    await limparMassa(m.nucleo, [m.est, m.outroEst]);
    await m.nucleo.encerrar();
  });

  it('fluxo inválido ou de código repetido não grava nada; o válido nasce com etapas e aprovadores', async () => {
    const antes = await conta('SELECT COUNT(*) AS n FROM fluxo_aprovacao WHERE codigo LIKE ?', [
      `T2016%${SUF}`,
    ]);
    expect(
      await codigoDaGravacao(
        exec('criarFluxo', m.aprova, {
          codigo: cod('BAD'),
          descricao: 'Sem aprovador',
          tipo: 'titulo_pagar',
          vigenciaInicio: '2026-01-01',
          etapas: [{ sequencia: 1, nome: 'Gestor', aprovadores: [] }],
        }),
      ),
    ).toBe('etapa-sem-aprovador');
    // O agrupador por credor: o gestor só aprova o título do fornecedor da massa.
    const ag = Number(
      (
        await exec('salvarAgrupador', m.aprova, {
          codigo: cod('AG'),
          descricao: 'Fornecedor da massa',
          criterio: 'credor',
          membros: [m.fornecedor],
        })
      )['agrupador'],
    );
    expect(
      await conta(
        'SELECT COUNT(*) AS n FROM membro_agrupador_aprovacao WHERE agrupador_aprovacao_id = ? AND ativo',
        [ag],
      ),
    ).toBe(1);
    const r = await exec('criarFluxo', m.aprova, {
      codigo: cod('TIT'),
      descricao: 'Título com diretoria acima de mil',
      tipo: 'titulo_pagar',
      prioridade: 1,
      vigenciaInicio: '2026-01-01',
      etapas: [
        { sequencia: 1, nome: 'Gestor', aprovadores: [aprovador(m.aprova, { agrupador: ag })] },
        {
          sequencia: 2,
          nome: 'Diretoria',
          valorMinimo: 1000,
          regraQuorum: 'todos',
          aprovadores: [aprovador(m.paga), aprovador(m.restrito, { aprovaPeloCelular: false })],
        },
      ],
    });
    fluxos.push(Number(r['fluxo']));
    expect(
      await codigoDaGravacao(
        exec('criarFluxo', m.aprova, {
          codigo: cod('TIT'),
          descricao: 'Repetido',
          tipo: 'titulo_pagar',
          vigenciaInicio: '2026-01-01',
          etapas: [{ sequencia: 1, nome: 'G', aprovadores: [aprovador(m.aprova)] }],
        }),
      ),
    ).toBe('codigo-repetido');
    expect(
      await conta('SELECT COUNT(*) AS n FROM fluxo_aprovacao WHERE codigo LIKE ?', [`T2016%${SUF}`]),
    ).toBe(antes + 1);
    expect(
      await conta(
        `SELECT COUNT(*) AS n FROM aprovador_etapa a JOIN etapa_fluxo_aprovacao e ON e.id = a.etapa_fluxo_aprovacao_id
          WHERE e.fluxo_aprovacao_id = ?`,
        [fluxos[0]],
      ),
    ).toBe(3);
  });

  it('título abaixo de mil: uma etapa; quem pediu e quem não é aprovador não decidem; aprovar pelo celular autoriza', async () => {
    const t = await titulo(2016001, 500);
    const s = await exec('submeter', m.lanca, { tipo: 'titulo_pagar', documento: t });
    const pedido = Number(s['pedido']);
    expect(s['etapas']).toBe(1);
    expect(await codigoDaGravacao(decidir(m.lanca, pedido, resp.aprovo))).toBe('aprovador-solicitante');
    expect(await codigoDaGravacao(decidir(m.paga, pedido, resp.aprovo))).toBe('sem-alcada');
    expect(await codigoDaGravacao(exec('submeter', m.lanca, { tipo: 'titulo_pagar', documento: t }))).toBe(
      'ja-em-aprovacao',
    );
    const fila = await m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't2016' }, (l) =>
      pendenciasDoAprovador(l, m.est, m.aprova),
    );
    expect(fila.find((x) => x.pedido === pedido)?.celular).toBe(true);
    const d = await decidir(m.aprova, pedido, resp.aprovo, '', 'celular');
    expect(d['situacao']).toBe('aprovado');
    const tt = await uma(
      'SELECT autorizado, autorizador_usuario_id, pedido_aprovacao_id FROM titulo_pagar WHERE id = ?',
      [t],
    );
    expect([
      Number(tt?.['autorizado']),
      Number(tt?.['autorizador_usuario_id']),
      Number(tt?.['pedido_aprovacao_id']),
    ]).toEqual([1, m.aprova, pedido]);
    const dec = await uma(
      'SELECT canal, resposta_padrao_aprovacao_id AS r, etapa_fluxo_aprovacao_id AS e, decisao FROM decisao_aprovacao WHERE pedido_aprovacao_id = ?',
      [pedido],
    );
    expect([dec?.['canal'], Number(dec?.['r']), dec?.['decisao']]).toEqual([
      'celular',
      resp.aprovo,
      'aprovado',
    ]);
    expect(Number(dec?.['e'])).toBeGreaterThan(0);
    const p = await uma(
      'SELECT situacao, concluido_em, etapa_fluxo_aprovacao_id FROM pedido_aprovacao WHERE id = ?',
      [pedido],
    );
    expect(p?.['situacao']).toBe('aprovado');
    expect(p?.['concluido_em']).not.toBeNull();
    expect(p?.['etapa_fluxo_aprovacao_id']).toBeNull();
  });

  it('título acima de mil: duas etapas, quórum "todos", celular não liberado; reprovar pede justificativa', async () => {
    const t = await titulo(2016002, 5000);
    const pedido = Number(
      (await exec('submeter', m.lanca, { tipo: 'titulo_pagar', documento: t }))['pedido'],
    );
    expect((await decidir(m.aprova, pedido, resp.aprovo))['situacao']).toBe('em_aprovacao');
    expect(await codigoDaGravacao(decidir(m.restrito, pedido, resp.aprovo, '', 'celular'))).toBe(
      'celular-nao-liberado',
    );
    const r1 = await decidir(m.restrito, pedido, resp.aprovo);
    expect([r1['situacao'], r1['faltam']]).toEqual(['em_aprovacao', 1]);
    expect(await codigoDaGravacao(decidir(m.restrito, pedido, resp.aprovo))).toBe('decisao-repetida');
    expect(await codigoDaGravacao(decidir(m.paga, pedido, resp.reprovo, 'ab'))).toBe(
      'justificativa-obrigatoria',
    );
    expect(
      await conta('SELECT COUNT(*) AS n FROM decisao_aprovacao WHERE pedido_aprovacao_id = ?', [pedido]),
    ).toBe(2);
    expect((await decidir(m.paga, pedido, resp.reprovo, 'Sem verba no mes'))['situacao']).toBe('reprovado');
    const p = await uma('SELECT situacao, motivo_conclusao, nivel_atual FROM pedido_aprovacao WHERE id = ?', [
      pedido,
    ]);
    expect([p?.['situacao'], p?.['motivo_conclusao'], Number(p?.['nivel_atual'])]).toEqual([
      'reprovado',
      'Sem verba no mes',
      2,
    ]);
    expect(Number((await uma('SELECT autorizado FROM titulo_pagar WHERE id = ?', [t]))?.['autorizado'])).toBe(
      0,
    );
    expect(
      await conta('SELECT COUNT(*) AS n FROM decisao_aprovacao WHERE pedido_aprovacao_id = ?', [pedido]),
    ).toBe(3);
  });

  it('pedido de compra: aguardando aprovação; devolver volta a rascunho; aprovar grava quem e quando', async () => {
    fluxos.push(
      Number(
        (
          await exec('criarFluxo', m.aprova, {
            codigo: cod('PC'),
            descricao: 'Compra',
            tipo: 'pedido_compra',
            vigenciaInicio: '2026-01-01',
            etapas: [{ sequencia: 1, nome: 'Suprimentos', aprovadores: [aprovador(m.aprova)] }],
          })
        )['fluxo'],
      ),
    );
    const pc = await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 't2016' }, (e) =>
      e.inserir(
        `INSERT INTO pedido_compra (estabelecimento_id, ano, numero, empresa_fornecedora_id, centro_custo_id, data_pedido,
                                    valor_total, situacao, criado_em, criado_por)
         VALUES (?, 2026, ?, ?, ?, ?, 1200, 'em_cotacao', NOW(3), ?)`,
        [m.est, 900000 + Math.floor(Math.random() * 99999), m.fornecedor, m.centro, HOJE, m.lanca],
      ),
    );
    compras.push(pc);
    const sit = async () =>
      await uma('SELECT situacao, aprovado_por_usuario_id FROM pedido_compra WHERE id = ?', [pc]);
    const p1 = Number((await exec('submeter', m.lanca, { tipo: 'pedido_compra', documento: pc }))['pedido']);
    expect((await sit())?.['situacao']).toBe('aguardando_aprovacao');
    expect((await decidir(m.aprova, p1, resp.devolvo, 'Rever a cotacao'))['situacao']).toBe('devolvido');
    expect((await sit())?.['situacao']).toBe('rascunho');
    const p2 = Number((await exec('submeter', m.lanca, { tipo: 'pedido_compra', documento: pc }))['pedido']);
    expect(p2).not.toBe(p1);
    expect((await decidir(m.aprova, p2, resp.aprovo))['situacao']).toBe('aprovado');
    const s = await sit();
    expect([s?.['situacao'], Number(s?.['aprovado_por_usuario_id'])]).toEqual(['aprovado', m.aprova]);
    // O pedido devolvido continua no histórico.
    expect(
      await conta(
        `SELECT COUNT(*) AS n FROM pedido_aprovacao WHERE entidade = 'pedido_compra' AND entidade_id = ?`,
        [pc],
      ),
    ).toBe(2);
  });

  it('contrato: aprovar põe em vigor; sem fluxo o título segue a alçada', async () => {
    fluxos.push(
      Number(
        (
          await exec('criarFluxo', m.aprova, {
            codigo: cod('CT'),
            descricao: 'Contrato',
            tipo: 'contrato_fornecedor',
            vigenciaInicio: '2026-01-01',
            etapas: [{ sequencia: 1, nome: 'Jurídico', aprovadores: [aprovador(m.aprova)] }],
          })
        )['fluxo'],
      ),
    );
    const ct = await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 't2016' }, (e) =>
      e.inserir(
        `INSERT INTO contrato_fornecedor (estabelecimento_id, numero, objeto, empresa_fornecedora_id, tipo, data_emissao,
                                          vigencia_inicio, valor_global, situacao, criado_em, criado_por)
         VALUES (?, ?, 'OBJETO SINTETICO T2016', ?, 'servico', ?, ?, 3000, 'rascunho', NOW(3), ?)`,
        [m.est, cod('CT'), m.fornecedor, HOJE, HOJE, m.lanca],
      ),
    );
    contratos.push(ct);
    const p = Number(
      (await exec('submeter', m.lanca, { tipo: 'contrato_fornecedor', documento: ct }))['pedido'],
    );
    expect((await decidir(m.aprova, p, resp.aprovo))['situacao']).toBe('aprovado');
    expect((await uma('SELECT situacao FROM contrato_fornecedor WHERE id = ?', [ct]))?.['situacao']).toBe(
      'vigente',
    );

    expect((await exec('encerrarFluxo', m.aprova, { fluxo: fluxos[0] }))['ativo']).toBe(false);
    const f = await uma('SELECT ativo, vigencia_fim FROM fluxo_aprovacao WHERE id = ?', [fluxos[0]]);
    expect(Number(f?.['ativo'])).toBe(0);
    expect(f?.['vigencia_fim']).not.toBeNull();
    const t = await titulo(2016003, 300);
    expect(await codigoDaGravacao(exec('submeter', m.lanca, { tipo: 'titulo_pagar', documento: t }))).toBe(
      'sem-fluxo',
    );
  });
});
