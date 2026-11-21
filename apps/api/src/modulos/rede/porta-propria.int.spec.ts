// Integração da porta própria do MPI da Rede contra o MariaDB real, no cliente de teste da onda 2 (f22_o2, banco
// cliente_f22_o2). Massa SINTÉTICA do lote 02-13 (prefixo F22L0213; nenhuma pessoa real): dois estabelecimentos do mesmo
// cliente, pacientes homônimos entre eles, um par suspeito aberto, uma unificação efetivada entre estabelecimentos, o
// prontuário da unidade de um paciente e um atendimento de um paciente em outra unidade (sem unificação nenhuma).
// Os estabelecimentos e o usuário de teste ficam (a trilha aponta para eles); o resto sai no fim.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroProblema } from '../../problema.filter.js';
import { ServicoMpiRede, type SessaoRede } from './aplicacao/servico.js';
import { PortaRedePropria } from './porta-propria.js';
import type { TrilhaRede } from './tipos-indice.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const REDE = 'rede-f22-0213';
const EST_A = 'f0213a';
const EST_B = 'f0213b';
const LOGIN = 'F22L0213.GESTOR';
/** Faixa dos prontuários sintéticos do lote (únicos no cliente). */
const PRONT = 9_021_300_000;
/** Sufixo das correlações desta execução (a trilha de execuções anteriores fica no banco). */
const RODADA = Date.now().toString(36);

interface Massa {
  estA: number;
  estB: number;
  usuario: number;
  p1a: number;
  p1b: number;
  p2a: number;
  p2b: number;
  p3a: number;
  p3b: number;
  p4b: number;
  p5a: number;
  p6a: number;
  p6b: number;
}

/** O prontuário da unidade (prontuario_estabelecimento) do p2b em EST_B. */
const PRONT_UNIDADE_P2B = 4021;

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: unknown }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

async function limpar(e: Escritor): Promise<void> {
  const ids = (
    await e.consultar<{ id: unknown }>('SELECT id FROM paciente WHERE numero_prontuario BETWEEN ? AND ?', [
      PRONT,
      PRONT + 99,
    ])
  ).map((x) => Number(x.id));
  const ests = (
    await e.consultar<{ id: unknown }>('SELECT id FROM estabelecimento WHERE codigo IN (?, ?)', [EST_A, EST_B])
  ).map((x) => Number(x.id));
  if (ests.length)
    await e.executar(`DELETE FROM marca_sincronismo WHERE estabelecimento_id IN (${ests.map(() => '?').join(', ')})`, ests);
  if (ids.length === 0) return;
  const q = ids.map(() => '?').join(', ');
  await e.executar(`DELETE FROM suspeita_duplicidade WHERE primeiro_paciente_id IN (${q}) OR segundo_paciente_id IN (${q})`, [...ids, ...ids]);
  await e.executar(`DELETE FROM unificacao_cadastro WHERE mantido_paciente_id IN (${q}) OR absorvido_paciente_id IN (${q})`, [...ids, ...ids]);
  await e.executar(`DELETE FROM chave_busca_nome WHERE entidade = 'paciente' AND registro_id IN (${q})`, ids);
  await e.executar(`DELETE FROM prontuario_estabelecimento WHERE paciente_id IN (${q})`, ids);
  await e.executar(`DELETE FROM atendimento WHERE paciente_id IN (${q})`, ids);
  const pessoas = (
    await e.consultar<{ p: unknown }>(`SELECT pessoa_fisica_id AS p FROM paciente WHERE id IN (${q})`, ids)
  ).map((x) => Number(x.p));
  await e.executar(`UPDATE paciente SET sobrevivente_paciente_id = NULL, situacao = 'ativo' WHERE id IN (${q})`, ids);
  await e.executar(`DELETE FROM paciente WHERE id IN (${q})`, ids);
  await e.executar(`DELETE FROM pessoa_fisica WHERE id IN (${pessoas.map(() => '?').join(', ')})`, pessoas);
}

describe.skipIf(SEM_BANCO)('porta própria do MPI da Rede contra o MariaDB (cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaRedePropria;
  let m: Massa;

  const ler = <T>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-f22l0213' }, (l) => l.consultar<T & Record<string, unknown>>(sql, p));

  function sessao(hospital: string, correlacao: string, extra: Partial<SessaoRede> = {}): SessaoRede {
    const est = hospital === EST_A ? m.estA : m.estB;
    return {
      rede: REDE,
      hospital,
      login: LOGIN,
      ...extra,
      trilha: (evento, operacao, alvo): TrilhaRede => ({
        estabelecimento: est,
        usuario: m.usuario,
        acao: 'operacao',
        entidade: 'suspeita_duplicidade',
        entidadeId: null,
        dadosDepois: { evento, recurso: 'rede.mpi', operacao, chave: alvo.chave },
        correlacao,
      }),
    };
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f22l0213' }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `Hospital sintético ${codigo}`, `Hospital sintético ${codigo} (fictício)`, agora],
        );
      const estA = await est(EST_A);
      const estB = await est(EST_B);
      const usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [LOGIN],
        'INSERT INTO usuario (login, nome, cpf, criado_em) VALUES (?, ?, ?, ?)',
        [LOGIN, 'Gestor sintético do lote 02-13', '90213000191', agora],
      );
      const sexo = await garantir(
        e,
        'SELECT id FROM sexo WHERE sigla = ?',
        ['F'],
        'INSERT INTO sexo (codigo, descricao, sigla, criado_em) VALUES (?, ?, ?, ?)',
        ['feminino', 'Feminino', 'F', agora],
      );
      let n = 0;
      const paciente = async (
        estab: number,
        nome: string,
        mae: string,
        nascimento: string,
        extra: { cpf?: string; situacao?: string; sobrevivente?: number } = {},
      ) => {
        const pf = await e.inserir(
          'INSERT INTO pessoa_fisica (nome, cpf, data_nascimento, sexo_id, nome_mae, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
          [nome, extra.cpf ?? null, nascimento, sexo, mae, agora],
        );
        const id = await e.inserir(
          `INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, cadastro_estabelecimento_id, situacao,
             sobrevivente_paciente_id, criado_em) VALUES (?, ?, ?, ?, ?, ?)`,
          [pf, PRONT + ++n, estab, extra.situacao ?? 'ativo', extra.sobrevivente ?? null, agora],
        );
        for (const [campo, texto] of [
          ['nome', nome],
          ['mae', mae],
        ] as const)
          for (const palavra of new Set(texto.split(' ')))
            await e.inserir(
              'INSERT INTO chave_busca_nome (entidade, registro_id, campo, palavra, fonetica, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
              ['paciente', id, campo, palavra, `F${palavra}`, agora],
            );
        return id;
      };
      const p1a = await paciente(estA, 'PACIENTE SINTETICA HOMONIMA', 'MAE SINTETICA UM', '1980-05-17');
      const p1b = await paciente(estB, 'PACIENTE SINTETICA HOMONIMA', 'MAE SINTETICA UM', '1980-05-17');
      const p2a = await paciente(estA, 'SEGUNDA SINTETICA PAR', 'MAE SINTETICA DOIS', '1975-02-03');
      const p2b = await paciente(estB, 'SEGUNDA SINTETICA PAR', 'MAE SINTETICA DOIS', '1975-02-03');
      const p3a = await paciente(estA, 'TERCEIRA SINTETICA UNIDA', 'MAE SINTETICA TRES', '1990-09-09');
      const p3b = await paciente(estB, 'TERCEIRA SINTETICA UNIDA', 'MAE SINTETICA TRES', '1990-09-09', {
        situacao: 'unificado',
        sobrevivente: p3a,
      });
      const p4b = await paciente(estB, 'QUARTA SINTETICA DOCUMENTO', 'MAE SINTETICA QUATRO', '1966-12-01', {
        cpf: '90213000205',
      });
      await e.inserir(
        `INSERT INTO suspeita_duplicidade (primeiro_paciente_id, segundo_paciente_id, escore, criterio_fonetica,
           criterio_nascimento, detectado_em, situacao, criado_em) VALUES (?, ?, 90, TRUE, TRUE, ?, 'aberto', ?)`,
        [Math.min(p2a, p2b), Math.max(p2a, p2b), agora, agora],
      );
      // p5a: cadastrado em A e atendido em B, sem unificação nenhuma (o aviso tem de aparecer em A).
      const p5a = await paciente(estA, 'QUINTA SINTETICA ATENDIDA', 'MAE SINTETICA CINCO', '1999-01-01');
      // p6a/p6b: par cujo registro em suspeita_duplicidade foi excluído logicamente (o ciclo não pode quebrar nele).
      const p6a = await paciente(estA, 'SEXTA SINTETICA EXCLUIDA', 'MAE SINTETICA SEIS', '1988-08-08');
      const p6b = await paciente(estB, 'SEXTA SINTETICA EXCLUIDA', 'MAE SINTETICA SEIS', '1988-08-08');
      await e.inserir(
        `INSERT INTO suspeita_duplicidade (primeiro_paciente_id, segundo_paciente_id, escore, criterio_fonetica,
           criterio_nascimento, detectado_em, situacao, criado_em, excluido_em) VALUES (?, ?, 70, TRUE, TRUE, ?, 'aberto', ?, ?)`,
        [Math.min(p6a, p6b), Math.max(p6a, p6b), agora, agora, agora],
      );
      await e.inserir(
        `INSERT INTO prontuario_estabelecimento (paciente_id, estabelecimento_id, tipo, numero_prontuario, aberto_em, criado_em)
         VALUES (?, ?, 'interno', ?, ?, ?)`,
        [p2b, estB, String(PRONT_UNIDADE_P2B), '2026-01-01', agora],
      );
      const ref = async (sql: string) => Number((await e.uma<{ id: unknown }>(sql, []))?.id);
      await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, situacao, entrada_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto', ?, ?)`,
        [
          estB,
          `F22L0213-${RODADA}`.slice(0, 20),
          p5a,
          await ref('SELECT id FROM categoria_atendimento ORDER BY id LIMIT 1'),
          await ref('SELECT id FROM carater_atendimento_tiss ORDER BY id LIMIT 1'),
          await ref('SELECT id FROM fonte_pagadora WHERE excluido_em IS NULL ORDER BY id LIMIT 1'),
          await ref('SELECT id FROM profissional WHERE excluido_em IS NULL ORDER BY id LIMIT 1'),
          new Date('2026-11-10T10:00:00Z'),
          agora,
        ],
      );
      await e.inserir(
        `INSERT INTO unificacao_cadastro (mantido_paciente_id, absorvido_paciente_id, unificado_em,
           unificado_por_usuario_id, justificativa, situacao, criado_em) VALUES (?, ?, ?, ?, ?, 'efetivada', ?)`,
        [p3a, p3b, agora, usuario, 'Mesma pessoa sintética', agora],
      );
      return { estA, estB, usuario, p1a, p1b, p2a, p2b, p3a, p3b, p4b, p5a, p6a, p6b };
    });
    porta = new PortaRedePropria(nucleo, CLIENTE, REDE);
    await porta.carregar();
  }, 120_000);

  afterAll(async () => {
    await nucleo?.escrever({ cliente: CLIENTE, correlacao: 'limpeza-f22l0213' }, limpar);
    await nucleo?.encerrar();
  });

  const ctxA = () => ({ rede: REDE, hospital: EST_A });
  const ctxB = () => ({ rede: REDE, hospital: EST_B });
  const chave = (a: number, b: number) => `${EST_A}:${a}|${EST_B}:${b}`;

  it('estabelecimentos do cliente e a rede configurada; outra rede e outro estabelecimento: 403', async () => {
    expect(porta.redeConfigurada()).toBe(REDE);
    const codigos = porta.estabelecimentos().map((e) => e.codigo);
    expect(codigos).toEqual(expect.arrayContaining([EST_A, EST_B]));
    await expect(porta.cadastrosPorIds({ rede: 'outra', hospital: EST_A }, [m.p1a])).rejects.toBeInstanceOf(ErroProblema);
    await expect(porta.cadastrosPorIds({ rede: REDE, hospital: 'naoexiste' }, [m.p1a])).rejects.toMatchObject({
      extras: { codigo: 'fora-da-rede' },
    });
  });

  it('cadastros: só os do estabelecimento do contexto, com a fonética do índice de busca e o unificado', async () => {
    const [a] = await porta.cadastrosPorIds(ctxA(), [m.p1a, m.p1b]);
    expect(a).toMatchObject({
      estabelecimento: EST_A,
      id: m.p1a,
      prontuario: PRONT + 1,
      nascimento: '1980-05-17',
      sexo: 'F',
      ativo: true,
      idUnificado: null,
      nomeFoneticoBanco: 'FHOMONIMA FPACIENTE FSINTETICA',
    });
    expect(await porta.cadastrosPorIds(ctxA(), [m.p1b])).toEqual([]);
    const [u] = await porta.cadastrosPorIds(ctxB(), [m.p3b]);
    expect(u).toMatchObject({ ativo: false, idUnificado: m.p3a });
    const lote = await porta.loteCadastros(ctxB(), 0, 2);
    expect(lote.itens.map((x) => x.id)).toEqual([m.p1b, m.p2b]);
    expect(lote.ultimoId).toBe(m.p2b);
    const alterados = await porta.cadastrosAlterados(ctxB(), new Date('2000-01-01T00:00:00Z'), 0, 10);
    expect(alterados.map((x) => x.id)).toEqual(expect.arrayContaining([m.p1b, m.p2b, m.p4b]));
  });

  it('procura: CPF, fonética com nascimento e fonética com a mãe, só no estabelecimento pedido', async () => {
    const [a] = await porta.cadastrosPorIds(ctxA(), [m.p1a]);
    const chaves = {
      cpf: null,
      cns: null,
      nomeFoneticoBanco: a?.nomeFoneticoBanco ?? null,
      maeFoneticaBanco: a?.maeFoneticaBanco ?? null,
      nascimento: a?.nascimento ?? null,
    };
    expect(await porta.procurarCandidatos(ctxB(), chaves)).toEqual([m.p1b]);
    expect(await porta.procurarCandidatos(ctxB(), { ...chaves, nascimento: null })).toEqual([m.p1b]);
    expect(await porta.procurarCandidatos(ctxA(), chaves)).toEqual([m.p1a]);
    expect(
      await porta.procurarCandidatos(ctxB(), {
        cpf: '90213000205',
        cns: null,
        nomeFoneticoBanco: null,
        maeFoneticaBanco: null,
        nascimento: null,
      }),
    ).toEqual([m.p4b]);
  });

  it('fila: o par suspeito visto dos dois estabelecimentos, por faixa, o par e as situações', async () => {
    const k = chave(m.p2a, m.p2b);
    const fa = await porta.fila(ctxA(), { situacao: 'aberto', pagina: 1, porPagina: 20 });
    expect(fa.itens.filter((x) => x.chave === k)).toEqual([
      expect.objectContaining({
        idLocal: m.p2a,
        estabelecimentoRemoto: EST_B,
        idRemoto: m.p2b,
        pontuacao: 90,
        criterios: ['nome_fonetico', 'nascimento'],
        situacao: 'aberto',
        origem: null,
      }),
    ]);
    // O prontuário da unidade (prontuario_estabelecimento), não o do cliente: mostrado e filtrado.
    expect(fa.itens.find((x) => x.chave === k)?.prontuarioRemoto).toBe(PRONT_UNIDADE_P2B);
    const fb = await porta.fila(ctxB(), { situacao: 'aberto', pagina: 1, porPagina: 20, prontuarioLocal: PRONT_UNIDADE_P2B });
    expect(fb.itens.map((x) => x.chave)).toEqual([k]);
    expect(fb.itens[0]?.prontuarioLocal).toBe(PRONT_UNIDADE_P2B);
    expect(fb.total).toBe(1);
    expect((await porta.fila(ctxB(), { situacao: 'aberto', pagina: 1, porPagina: 20, prontuarioLocal: PRONT + 4 })).total).toBe(0);
    expect((await porta.cadastrosPorIds(ctxB(), [m.p2b]))[0]?.prontuario).toBe(PRONT_UNIDADE_P2B);
    const vazia = await porta.fila(ctxA(), { situacao: 'aberto', pagina: 1, porPagina: 20, estabelecimentosRemotos: [] });
    expect(vazia.total).toBe(0);
    const faixas = await porta.filaPorFaixa(ctxA(), 'aberto', { estabelecimentoRemoto: EST_B });
    expect(faixas.alta).toBeGreaterThanOrEqual(1);
    expect((await porta.candidato(ctxB(), k))?.idLocal).toBe(m.p2b);
    expect(await porta.candidato(ctxA(), 'malformada')).toBeNull();
    expect((await porta.situacoes(ctxA(), [k])).get(k)).toBe('aberto');
  });

  it('vínculos: a unificação efetivada entre estabelecimentos, com a pessoa = o cadastro mantido', async () => {
    const k = chave(m.p3a, m.p3b);
    const [v] = await porta.vinculosDoCadastro(ctxB(), m.p3b);
    expect(v).toMatchObject({
      chave: k,
      pessoa: String(m.p3a),
      idLocal: m.p3b,
      estabelecimentoRemoto: EST_A,
      idRemoto: m.p3a,
      origem: 'humano',
      situacao: 'ativo',
      criadoPor: LOGIN,
    });
    expect((await porta.vinculo(ctxA(), k))?.idLocal).toBe(m.p3a);
    expect((await porta.pessoasDosCadastros(ctxA(), [m.p3a, m.p1a])).get(m.p3a)).toBe(String(m.p3a));
    expect((await porta.loteVinculos(ctxA(), 0, 10)).itens.map((x) => x.chave)).toContain(k);
    expect(await porta.cpfDoLogin(ctxA(), LOGIN)).toBe('90213000191');
    expect(await porta.atendimentos(ctxB(), PRONT + 6)).toEqual({
      atendimentos: 0,
      ultimoAtendimento: null,
      internacoes: 0,
      ultimaInternacao: null,
    });
  });

  it('decisão "outra pessoa" pelo serviço: a linha, a versão, a trilha e a idempotência na mesma transação', async () => {
    const k = chave(m.p2a, m.p2b);
    const servico = new ServicoMpiRede(porta, { aviso: (x) => console.error(x) });
    const r = await servico.decidir(sessao(EST_A, `f22l0213-outra-${RODADA}`), k, {
      decisao: 'outra_pessoa',
      justificativa: 'Pessoas diferentes (teste sintético)',
    });
    expect(r.bancos.map((b) => b.situacao)).toEqual(['gravado', 'gravado']);
    const [s] = await ler<{ situacao: string; versao: number; decidido_por_usuario_id: number; justificativa: string }>(
      'SELECT situacao, versao, decidido_por_usuario_id, justificativa FROM suspeita_duplicidade WHERE primeiro_paciente_id = ? AND segundo_paciente_id = ?',
      [Math.min(m.p2a, m.p2b), Math.max(m.p2a, m.p2b)],
    );
    expect(s).toMatchObject({ situacao: 'outra_pessoa', versao: 2, decidido_por_usuario_id: m.usuario });
    const trilhas = await ler<{ id: number; entidade: string; estabelecimento_id: number }>(
      'SELECT id, entidade, estabelecimento_id FROM trilha_auditoria WHERE correlacao = ? ORDER BY id',
      [`f22l0213-outra-${RODADA}`],
    );
    // Uma decisão, uma operação: uma trilha e uma idempotência (não uma por estabelecimento).
    expect(trilhas).toHaveLength(1);
    expect(trilhas[0]).toMatchObject({ entidade: 'suspeita_duplicidade', estabelecimento_id: m.estA });
    const idem = await ler<{ n: number }>(
      `SELECT COUNT(*) AS n FROM idempotencia_operacao WHERE operacao = 'rede.gravar-indice' AND trilha_auditoria_id = ?`,
      [trilhas[0]?.id],
    );
    expect(Number(idem[0]?.n)).toBe(1);
    expect((await porta.situacoes(ctxB(), [k])).get(k)).toBe('outra_pessoa');
    // De novo: o par já decidido é recusado antes de gravar.
    await expect(
      servico.decidir(sessao(EST_A, `f22l0213-outra2-${RODADA}`), k, { decisao: 'outra_pessoa', justificativa: 'De novo, teste' }),
    ).rejects.toMatchObject({ extras: { codigo: 'par-decidido' } });
  });

  it('"mesma pessoa" e desfazer: 409 unificar-no-cadastro, nada gravado', async () => {
    const servico = new ServicoMpiRede(porta, { aviso: (x) => console.error(x) });
    const k = chave(m.p1a, m.p1b);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f22l0213-par' }, (e) =>
      e.inserir(
        `INSERT INTO suspeita_duplicidade (primeiro_paciente_id, segundo_paciente_id, escore, detectado_em, situacao, criado_em)
         VALUES (?, ?, 80, ?, 'aberto', ?)`,
        [Math.min(m.p1a, m.p1b), Math.max(m.p1a, m.p1b), new Date(), new Date()],
      ),
    );
    await expect(
      servico.decidir(sessao(EST_A, `f22l0213-mesma-${RODADA}`), k, { decisao: 'mesma_pessoa' }),
    ).rejects.toMatchObject({ extras: { codigo: 'unificar-no-cadastro' } });
    await expect(
      servico.desfazer(sessao(EST_A, `f22l0213-desfazer-${RODADA}`), chave(m.p3a, m.p3b), {
        justificativa: 'Desfazer teste sintético',
        reabrir: false,
      }),
    ).rejects.toMatchObject({ extras: { codigo: 'unificar-no-cadastro' } });
    const t = await ler<{ n: number }>('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE correlacao IN (?, ?)', [
      `f22l0213-mesma-${RODADA}`,
      `f22l0213-desfazer-${RODADA}`,
    ]);
    expect(Number(t[0]?.n)).toBe(0);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-f22l0213-par' }, (e) =>
      e.executar('DELETE FROM suspeita_duplicidade WHERE primeiro_paciente_id = ? AND segundo_paciente_id = ?', [
        Math.min(m.p1a, m.p1b),
        Math.max(m.p1a, m.p1b),
      ]),
    );
  });

  it('ciclo de pareamento: o homônimo vai à fila (aberto), a marca de cada estabelecimento é gravada; repetir não duplica', async () => {
    const servico = new ServicoMpiRede(porta, { agora: () => new Date('2026-11-21T12:00:00.000Z'), aviso: (x) => console.error(x) });
    const s = sessao(EST_A, `f22l0213-ciclo-${RODADA}`, { liberados: new Set([EST_A, EST_B]) });
    const r = await servico.ciclo(s, 100);
    expect(r.lidos).toBeGreaterThanOrEqual(10);
    expect(r.automaticos).toBe(0);
    // O par excluído logicamente: o ciclo não quebra na chave única do par nem o recria (continua excluído, versão 1).
    const p6 = await ler<{ excluido_em: unknown; versao: number }>(
      'SELECT excluido_em, versao FROM suspeita_duplicidade WHERE primeiro_paciente_id = ? AND segundo_paciente_id = ?',
      [Math.min(m.p6a, m.p6b), Math.max(m.p6a, m.p6b)],
    );
    expect(p6).toHaveLength(1);
    expect(p6[0]?.excluido_em).not.toBeNull();
    expect(Number(p6[0]?.versao)).toBe(1);
    expect(r.marcas.map((x) => x.estabelecimento).sort()).toEqual([EST_A, EST_B]);
    const par = await ler<{ situacao: string; escore: number; versao: number }>(
      'SELECT situacao, escore, versao FROM suspeita_duplicidade WHERE primeiro_paciente_id = ? AND segundo_paciente_id = ?',
      [Math.min(m.p1a, m.p1b), Math.max(m.p1a, m.p1b)],
    );
    expect(par).toHaveLength(1);
    expect(par[0]?.situacao).toBe('aberto');
    const marcas = await ler<{ estabelecimento_id: number; valor_marca: string }>(
      `SELECT estabelecimento_id, valor_marca FROM marca_sincronismo WHERE sistema_origem = 'pareamento_rede'
         AND estabelecimento_id IN (?, ?) ORDER BY estabelecimento_id`,
      [m.estA, m.estB],
    );
    expect(marcas).toHaveLength(2);
    expect((await porta.marca(ctxB()))?.ultimoId).toBe(m.p6b);
    // O par decidido "outra pessoa" não volta; o segundo ciclo não lê nada novo e não duplica.
    const r2 = await servico.ciclo(s, 100);
    expect(r2.lidos).toBe(0);
    const n = await ler<{ n: number }>(
      `SELECT COUNT(*) AS n FROM suspeita_duplicidade WHERE primeiro_paciente_id IN (?, ?, ?, ?) OR segundo_paciente_id IN (?, ?, ?, ?)`,
      [m.p1a, m.p2a, m.p3a, m.p6a, m.p1b, m.p2b, m.p3b, m.p6b],
    );
    expect(Number(n[0]?.n)).toBe(3);
    const [p2] = await ler<{ situacao: string }>(
      'SELECT situacao FROM suspeita_duplicidade WHERE primeiro_paciente_id = ? AND segundo_paciente_id = ?',
      [Math.min(m.p2a, m.p2b), Math.max(m.p2a, m.p2b)],
    );
    expect(p2?.situacao).toBe('outra_pessoa');
  });

  it('aviso: o paciente cadastrado em A e atendido em B, sem unificação, é avisado em A (e não em B)', async () => {
    const servico = new ServicoMpiRede(porta, { aviso: (x) => console.error(x) });
    const liberados = new Set([EST_A, EST_B]);
    const acesso = async () => ({ pode: false, motivo: null });
    const a = await servico.avisoDoPaciente(sessao(EST_A, `f22l0213-aviso-${RODADA}`, { liberados }), m.p5a, acesso);
    expect(a.situacao).toBe('com-atendimentos');
    expect(a.estabelecimentos).toEqual([
      expect.objectContaining({ estabelecimento: EST_B, idRemoto: m.p5a, atendimentos: 1, ultimoAtendimento: '2026-11-10' }),
    ]);
    const b = await servico.avisoDoPaciente(sessao(EST_B, `f22l0213-aviso-${RODADA}`, { liberados }), m.p5a, acesso);
    expect(b.situacao).toBe('sem-vinculo');
    // A unificação efetivada entra como complemento: o p3b (absorvido pelo p3a) vê A, mesmo sem atendimento lá.
    const u = await servico.avisoDoPaciente(sessao(EST_B, `f22l0213-aviso-${RODADA}`, { liberados }), m.p3b, acesso);
    expect(u).toMatchObject({ situacao: 'sem-atendimentos', estabelecimentos: [expect.objectContaining({ estabelecimento: EST_A })] });
  });
});
