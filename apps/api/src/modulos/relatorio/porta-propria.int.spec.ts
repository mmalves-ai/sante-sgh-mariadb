// Integração da porta própria dos relatórios contra o MariaDB real (cliente f22_o4, já criado pela obra da onda 4).
// Massa SINTÉTICA com códigos "R0404" (nenhuma pessoa real). Contrato de efeito de cada gravação: as linhas no modelo,
// a versão, a trilha da operação (com o evento do ciclo e o valor anterior mascarado) e as recusas (grupo e papel
// desconhecidos, relatório fora do catálogo, envio já feito, outro estabelecimento). As consultas do catálogo rodam
// contra o esquema real. A mesma bateria do envio agendado e da execução roda na memória e no banco. No fim, a massa
// de negócio é apagada; ficam o estabelecimento e o usuário de teste, que a trilha (só inclusão) referencia.
// Cada relatório do catálogo do produto roda contra o esquema real (todas as variantes). O DATETIME vai ao banco em
// UTC e volta na hora local; a trava otimista recusa a versão velha (memória e banco). O pedido de relatório novo:
// com a tabela pedido_relatorio, o ciclo inteiro; sem ela (pedida ao modelo pelo lote 04-04), a recusa explícita.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { RELATORIOS_CATALOGO } from '@sgh/contratos';
import { type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import {
  CODIGOS_COM_CONSULTA_PROPRIA,
  CONSULTAS_PROPRIAS,
  conferirSqlDoCatalogo,
  curvaAbc,
  vagasDaEscala,
} from './infra/consultas-catalogo.js';
import { localParaUtc, paraBanco, utcParaLocal } from './infra/fuso.js';
import {
  type ContextoRelatorio,
  type DadosAgendamento,
  ErroRelatorio,
  type PortaRelatorio,
} from './porta.js';
import { PortaRelatorioMemoria } from './porta-memoria.js';
import { horaNoBanco, PortaRelatorioPropria, relogioNoFuso } from './porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'R0404';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]) {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? { id: Number(l.id), novo: false } : { id: await e.inserir(ins, pi), novo: true };
}
const codigoDe = (e: unknown): string | null =>
  e instanceof ErroOperacao
    ? String(e.problema['codigo'] ?? '')
    : e instanceof ErroRelatorio
      ? e.motivo
      : null;
const erroDe = (p: Promise<unknown>) => p.then(() => null, codigoDe);

describe('consultas do catálogo (sem banco)', () => {
  it('cada SQL é um SELECT literal com os parâmetros certos; escrita e comentário recusados', () => {
    // Os 19 relatórios do catálogo do produto têm consulta sobre o banco próprio, e cada variante passa na conferência.
    expect([...CODIGOS_COM_CONSULTA_PROPRIA].sort()).toEqual(RELATORIOS_CATALOGO.map((r) => r.codigo).sort());
    for (const c of Object.values(CONSULTAS_PROPRIAS))
      for (const sql of Object.values(c.sql)) {
        expect(sql).toMatch(/^SELECT\s/);
        expect(sql).not.toMatch(/;|--|#|\$\{/);
      }
    expect(() => conferirSqlDoCatalogo('SELECT 1 FROM x WHERE a = ?', 1)).not.toThrow();
    expect(() => conferirSqlDoCatalogo('DELETE FROM x', 0)).toThrow(ErroRelatorio);
    expect(() => conferirSqlDoCatalogo('SELECT 1; DROP TABLE x', 0)).toThrow(/ponto e vírgula/);
    expect(() => conferirSqlDoCatalogo('SELECT 1 FROM x WHERE a = ?', 2)).toThrow(/parâmetro/);
    expect(() => horaNoBanco('24:60')).toThrow();
    expect(() => horaNoBanco('0730')).toThrow();
    expect(horaNoBanco('07:30')).toBe('07:30:00');
    expect(relogioNoFuso('America/Sao_Paulo', new Date('2026-10-28T12:00:00Z')).agora).toBe(
      '2026-10-28T09:00:00',
    );
    // Hora local ↔ UTC (ida e volta).
    const local = new Date('2030-01-07T07:30:00Z');
    expect(localParaUtc(local, 'America/Sao_Paulo').toISOString()).toBe('2030-01-07T10:30:00.000Z');
    expect(utcParaLocal(localParaUtc(local, 'America/Sao_Paulo'), 'America/Sao_Paulo')).toEqual(local);
  });

  it('curva ABC: a classe da faixa em que o item entra (o primeiro é sempre A); sem consumo fica fora', () => {
    const r = curvaAbc([
      { item: 1, nomeItem: 'A1', quantidade: 1, valor: 85 },
      { item: 2, nomeItem: 'B1', quantidade: 1, valor: 10 },
      { item: 3, nomeItem: 'C1', quantidade: 1, valor: 5 },
      { item: 4, nomeItem: 'Devolvido', quantidade: -1, valor: -2 },
    ]);
    expect(r.map((x) => [x['item'], x['classe'], x['acumulado']])).toEqual([
      [1, 'A', 85],
      [2, 'B', 95],
      [3, 'C', 100],
    ]);
  });

  it('vagas da escala: (fim − início − intervalo) ÷ duração, para baixo, × vagas por horário', () => {
    expect(
      vagasDaEscala({ inicioMin: 480, fimMin: 720, intervaloMin: 30, duracaoMin: 20, vagasPorHorario: 2 }),
    ).toBe(20);
    expect(
      vagasDaEscala({ inicioMin: 480, fimMin: 720, intervaloMin: 0, duracaoMin: null, vagasPorHorario: 1 }),
    ).toBeNull();
  });
});

/** Os valores padrão de cada parâmetro do relatório (o dia de hoje para data e mês). */
function valoresPadrao(
  r: (typeof RELATORIOS_CATALOGO)[number],
  hoje: string,
): Record<string, string | number> {
  const v: Record<string, string | number> = {};
  for (const p of r.parametros) {
    if (p.tipo === 'data') v[p.campo] = hoje;
    else if (p.tipo === 'mes') v[p.campo] = hoje.slice(0, 7);
    else if (p.padrao !== undefined) v[p.campo] = p.tipo === 'inteiro' ? Number(p.padrao) : p.padrao;
  }
  return v;
}
/** Para cada filtro que o relatório tem, a variante com ele ligado. */
const VARIANTES: Readonly<Record<string, string | number>> = {
  convenio: 1,
  local: 1,
  tipo: 'I',
  regua: 'data-do-item',
  situacao: 'todas',
};

describe.skipIf(SEM_BANCO)('porta própria dos relatórios (MariaDB, cliente f22_o4)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaRelatorio;
  const ids = {
    est: 0,
    outroEst: 0,
    usuario: 0,
    modulo: 0,
    papel: 0,
    lista: 0,
    triPendente: 0,
    triRestrita: 0,
    privado: 0,
  };
  /** Os códigos de origem da triagem sintética (a chave de negócio da proposta é o código no estabelecimento). */
  const ORIGEM = { pendente: 904041, restrita: 904042, nova: 904043 } as const;
  const criados: { tabela: string; id: number }[] = [];
  const relatorios: Record<string, number> = {};
  let temPedido = false;
  let ctx: ContextoRelatorio;
  let outro: ContextoRelatorio;
  const trilha = (entidade: string, id: string | null = null): TrilhaDaGravacao => ({
    estabelecimento: ctx.estabelecimento,
    usuario: ctx.usuario,
    acao: 'operacao',
    entidade,
    entidadeId: id ? Number(id) : null,
    dadosDepois: { evento: 'teste-0404' },
    correlacao: ctx.correlacao,
  });
  const ler = <T>(sql: string, p: unknown[]) => nucleo.lerSomente(ctx, (l) => l.uma(sql, p) as Promise<T>);
  const contarTrilha = async () =>
    Number(
      (
        await ler<{ n: number }>('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE correlacao = ?', [
          ctx.correlacao,
        ])
      )?.n,
    );
  const envio = (x: Partial<DadosAgendamento> = {}): DadosAgendamento => ({
    relatorio: 'atendimentosPorDia',
    titulo: `Envio ${P} ${Math.random().toString(36).slice(2, 8)}`,
    parametros: { inicio: 'inicioDoMes', fim: 'hoje' },
    grupos: [],
    enderecos: ['diretoria@exemplo.invalid'],
    periodicidade: 'semanal',
    hora: '07:30',
    diaSemana: 2,
    diaMes: null,
    ...x,
  });

  const limpar = (e: Escritor) =>
    (async () => {
      const est = [ids.est, ids.outroEst];
      await e.executar(
        'DELETE v FROM envio_relatorio v JOIN agendamento_relatorio a ON a.id = v.agendamento_relatorio_id WHERE a.estabelecimento_id IN (?, ?)',
        est,
      );
      await e.executar('DELETE FROM execucao_relatorio WHERE estabelecimento_id IN (?, ?)', est);
      await e.executar(
        'DELETE d FROM agendamento_relatorio_destinatario d JOIN agendamento_relatorio a ON a.id = d.agendamento_relatorio_id WHERE a.estabelecimento_id IN (?, ?)',
        est,
      );
      await e.executar('DELETE FROM agendamento_relatorio WHERE estabelecimento_id IN (?, ?)', est);
      await e.executar('DELETE FROM triagem_relatorio_legado WHERE estabelecimento_id IN (?, ?)', est);
      if (temPedido) await e.executar('DELETE FROM pedido_relatorio WHERE estabelecimento_id IN (?, ?)', est);
      await e.executar('DELETE FROM relatorio_permissao WHERE usuario_id = ?', [ids.usuario]);
      for (const c of [...criados].reverse())
        await e.executar(`DELETE FROM ${c.tabela} WHERE id = ?`, [c.id]).catch(() => 0);
    })();

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-04-04' }, async (e) => {
      const agora = new Date();
      const guardar = (tabela: string, r: { id: number; novo: boolean }) => {
        if (r.novo) criados.push({ tabela, id: r.id });
        return r.id;
      };
      const est = async (codigo: string) =>
        (
          await garantir(
            e,
            'SELECT id FROM estabelecimento WHERE codigo = ?',
            [codigo],
            'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
            [codigo, `ESTAB ${codigo} SINTETICO`, `ESTAB ${codigo} SINTETICO`, agora],
          )
        ).id;
      ids.est = await est(P);
      ids.outroEst = await est(`${P}B`);
      ids.usuario = (
        await garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          ['r0404.teste'],
          "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
          ['r0404.teste', 'USUARIO SINTETICO R0404', agora],
        )
      ).id;
      await limpar(e);
      criados.length = 0;
      ids.modulo = guardar(
        'modulo_sistema',
        await garantir(
          e,
          'SELECT id FROM modulo_sistema WHERE codigo = ?',
          [`${P}-REL`],
          'INSERT INTO modulo_sistema (codigo, descricao, criado_em) VALUES (?, ?, ?)',
          [`${P}-REL`, `MODULO ${P} SINTETICO`, agora],
        ),
      );
      // O catálogo do produto (sem estabelecimento), como o carregador versionado o deixa (pedido do lote 04-04).
      for (const { codigo } of RELATORIOS_CATALOGO)
        relatorios[codigo] = guardar(
          'relatorio',
          await garantir(
            e,
            'SELECT id FROM relatorio WHERE codigo = ? AND estabelecimento_id IS NULL',
            [codigo],
            "INSERT INTO relatorio (codigo, titulo, modulo_sistema_id, consulta_definicao, criado_em) VALUES (?, ?, ?, 'infra/consultas-catalogo.ts', ?)",
            [codigo, `RELATORIO ${codigo} ${P}`, ids.modulo, agora],
          ),
        );
      // Relatório próprio do OUTRO estabelecimento: a triagem deste nunca pode ligar-se a ele.
      ids.privado = guardar(
        'relatorio',
        await garantir(
          e,
          'SELECT id FROM relatorio WHERE codigo = ?',
          [`${P}-PRIV`],
          "INSERT INTO relatorio (estabelecimento_id, codigo, titulo, modulo_sistema_id, consulta_definicao, criado_em) VALUES (?, ?, ?, ?, 'sintetico', ?)",
          [ids.outroEst, `${P}-PRIV`, `RELATORIO PRIVADO ${P}`, ids.modulo, agora],
        ),
      );
      ids.papel = guardar(
        'papel_seguranca',
        await garantir(
          e,
          'SELECT id FROM papel_seguranca WHERE codigo = ?',
          [`${P}-FAT`],
          'INSERT INTO papel_seguranca (codigo, nome, criado_em) VALUES (?, ?, ?)',
          // O nome do papel é o da área de faturamento do domínio (PAPEIS_TRIAGEM): é por ele que a triagem acha a área.
          [`${P}-FAT`, 'gerente de faturamento', agora],
        ),
      );
      ids.lista = guardar(
        'lista_distribuicao_email',
        await garantir(
          e,
          'SELECT id FROM lista_distribuicao_email WHERE estabelecimento_id = ? AND codigo = ?',
          [ids.est, `${P}-DIR`],
          'INSERT INTO lista_distribuicao_email (estabelecimento_id, codigo, nome, criado_em) VALUES (?, ?, ?, ?)',
          [ids.est, `${P}-DIR`, `LISTA ${P} SINTETICA`, agora],
        ),
      );
      ids.triPendente = await e.inserir(
        'INSERT INTO triagem_relatorio_legado (estabelecimento_id, codigo, nome, quantidade_parametros, criado_em) VALUES (?, ?, ?, 2, ?)',
        [ids.est, String(ORIGEM.pendente), `Relatorio de origem ${P} um`, agora],
      );
      ids.triRestrita = await e.inserir(
        `INSERT INTO triagem_relatorio_legado (estabelecimento_id, codigo, nome, acesso_restrito, destino, marco, artefato,
           relatorio_id, situacao, area, motivo, decidido_em, criado_em)
         VALUES (?, ?, ?, TRUE, 'catalogo', 'M34', 'internadosNaData', ?, 'proposta', 'leitos', 'Sintetico', ?, ?)`,
        [
          ids.est,
          String(ORIGEM.restrita),
          `Relatorio de origem ${P} dois`,
          relatorios['internadosNaData'],
          agora,
          agora,
        ],
      );
      temPedido = !!(await e.uma(
        "SELECT 1 AS x FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'pedido_relatorio'",
      ));
    });
    porta = new PortaRelatorioPropria(nucleo);
    const base = { cliente: CLIENTE, usuario: ids.usuario, rede: 'rede-teste' };
    ctx = { ...base, estabelecimento: ids.est, hospital: P, correlacao: `t0404-${Date.now()}` };
    outro = { ...base, estabelecimento: ids.outroEst, hospital: `${P}B`, correlacao: `t0404b-${Date.now()}` };
  }, 60_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo
        .escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-04-04' }, limpar)
        .catch(() => undefined);
      await nucleo.encerrar();
    }
  });

  it('o relógio no fuso do estabelecimento e as consultas do catálogo contra o esquema real', async () => {
    const { hoje } = await porta.relogio(ctx);
    expect(hoje).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const o = { teto: 100, tempoMaximoMs: 10_000 };
    expect((await porta.executar(ctx, 'internadosNaData', { dia: hoje }, o)).linhas).toEqual([]);
    expect((await porta.executar(ctx, 'atendimentosPorDia', { inicio: hoje, fim: hoje }, o)).linhas).toEqual(
      [],
    );
    const conv = await porta.executar(
      ctx,
      'atendimentosPorConvenio',
      { inicio: hoje, fim: hoje, convenio: 1 },
      o,
    );
    expect(conv).toEqual({ linhas: [], variante: 'convenio' });
    // Cada relatório do catálogo, e cada variante de filtro dele, roda contra o esquema real sem erro.
    const falhas: string[] = [];
    let execucoes = 0;
    for (const r of RELATORIOS_CATALOGO) {
      const base = valoresPadrao(r, hoje);
      const conjuntos = [
        base,
        ...r.parametros
          .filter((p) => p.campo in VARIANTES)
          .map((p) => ({ ...base, [p.campo]: VARIANTES[p.campo]! })),
      ];
      for (const v of conjuntos) {
        execucoes++;
        await porta.executar(ctx, r.codigo, v, o).then(
          (x) => expect(Array.isArray(x.linhas)).toBe(true),
          (e: unknown) =>
            falhas.push(`${r.codigo} ${JSON.stringify(v)}: ${String((e as Error).message).slice(0, 200)}`),
        );
      }
    }
    expect(falhas).toEqual([]);
    expect(execucoes).toBeGreaterThan(RELATORIOS_CATALOGO.length);
  });

  it('envio agendado: inclusão com destinatários, versão e trilha; grupo desconhecido e relatório fora recusados', async () => {
    const antes = await contarTrilha();
    const id = await porta.gravarSgh(
      ctx,
      (i: string) => trilha('agendamento_relatorio', i),
      (g) =>
        g.criarAgendamento(envio({ grupos: [`${P}-DIR`] }), 'r0404.teste', new Date('2030-01-07T07:30:00Z')),
    );
    const a = await porta.agendamento(ctx, id);
    expect(a).toMatchObject({
      relatorio: 'atendimentosPorDia',
      grupos: [`${P}-DIR`],
      enderecos: ['diretoria@exemplo.invalid'],
      hora: '07:30',
      diaSemana: 2,
      ativo: true,
      dono: 'r0404.teste',
      falhasSeguidas: 0,
      ultimaSituacao: null,
    });
    expect(a?.proximoEnvio?.toISOString()).toBe('2030-01-07T07:30:00.000Z');
    // No banco, em UTC (ADR 0002): a hora local do estabelecimento convertida pelo fuso dele.
    const f = await ler<{ fuso: string | null; proximo: string }>(
      `SELECT e.fuso_horario AS fuso, DATE_FORMAT(a.proximo_envio_em, '%Y-%m-%d %H:%i:%s.%f') AS proximo
         FROM agendamento_relatorio a JOIN estabelecimento e ON e.id = a.estabelecimento_id WHERE a.id = ?`,
      [Number(id)],
    );
    expect(f?.proximo.slice(0, 23)).toBe(
      paraBanco(localParaUtc(new Date('2030-01-07T07:30:00Z'), f?.fuso || 'America/Sao_Paulo')),
    );
    const linha = await ler<{ versao: number; hora_envio: string; entrega: string }>(
      'SELECT versao, CAST(hora_envio AS CHAR) AS hora_envio, entrega FROM agendamento_relatorio WHERE id = ?',
      [Number(id)],
    );
    expect(linha).toMatchObject({ versao: 1, hora_envio: '07:30:00', entrega: 'link' });
    expect(await contarTrilha()).toBe(antes + 1);
    expect(
      await erroDe(
        porta.gravarSgh(ctx, trilha('agendamento_relatorio'), (g) =>
          g.criarAgendamento(envio({ grupos: ['NAO-EXISTE'] }), 'r0404.teste', new Date()),
        ),
      ),
    ).toBe('grupo-desconhecido');
    expect(
      await erroDe(
        porta.gravarSgh(ctx, trilha('agendamento_relatorio'), (g) =>
          g.criarAgendamento(envio({ relatorio: 'naoCadastrado' }), 'r0404.teste', new Date()),
        ),
      ),
    ).toBe('relatorio-nao-cadastrado');
    expect(await contarTrilha()).toBe(antes + 1);
    // Outro estabelecimento não vê o envio.
    expect(await porta.agendamento(outro, id)).toBeNull();
  });

  it('alteração com o evento do ciclo na trilha (endereços mascarados) e o resultado dos envios pelo histórico', async () => {
    const id = await porta.gravarSgh(
      ctx,
      (i: string) => trilha('agendamento_relatorio', i),
      (g) => g.criarAgendamento(envio(), 'r0404.teste', new Date('2030-01-07T07:30:00Z')),
    );
    await porta.gravarSgh(ctx, trilha('agendamento_relatorio', id), async (g) => {
      const anterior = await g.lerAgendamentoTravado(id);
      const k = await g.alterarAgendamento(
        id,
        { ...envio({ hora: '18:15' }), ativo: false },
        'r0404.teste',
        null,
      );
      await g.registrarEvento(
        { alvo: 'agendamento', id, evento: 'desativacao', antes: anterior, motivo: 'Teste de desativacao' },
        'r0404.teste',
      );
      return k;
    });
    const a = await porta.agendamento(ctx, id);
    expect(a).toMatchObject({
      ativo: false,
      hora: '18:15',
      proximoEnvio: null,
      enderecos: ['diretoria@exemplo.invalid'],
    });
    const ev = await porta.eventos(ctx, 'agendamento', id);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      evento: 'desativacao',
      motivo: 'Teste de desativacao',
      por: 'r0404.teste',
    });
    expect(ev[0]?.antes).not.toContain('diretoria@exemplo.invalid');
    const v = await ler<{ versao: number; ativos: number; total: number }>(
      `SELECT a.versao, (SELECT COUNT(*) FROM agendamento_relatorio_destinatario d WHERE d.agendamento_relatorio_id = a.id AND d.excluido_em IS NULL) AS ativos,
              (SELECT COUNT(*) FROM agendamento_relatorio_destinatario d WHERE d.agendamento_relatorio_id = a.id) AS total
         FROM agendamento_relatorio a WHERE a.id = ?`,
      [Number(id)],
    );
    expect(v).toMatchObject({ versao: 2, ativos: 1, total: 2 });
    const resultado = (situacao: 'enviado' | 'falhou') =>
      porta.gravarSgh(ctx, trilha('agendamento_relatorio', id), (g) =>
        g.registrarResultadoEnvio(id, {
          situacao,
          falha: situacao === 'falhou' ? 'Servidor de e-mail fora' : null,
          falhasSeguidas: 0,
          proximoEnvio: new Date('2030-01-14T07:30:00Z'),
        }),
      );
    await resultado('enviado');
    await resultado('falhou');
    await resultado('falhou');
    expect(await porta.agendamento(ctx, id)).toMatchObject({
      ultimaSituacao: 'falhou',
      ultimaFalha: 'Servidor de e-mail fora',
      falhasSeguidas: 2,
    });
    expect((await porta.agendamento(ctx, id))?.ultimoEnvio).not.toBeNull();
    expect(await porta.dependencias(ctx, 'agendamento', id)).toEqual([
      { grupo: 'envios e execuções registrados', quantidade: 3, origem: 'fk' },
      { grupo: 'envio já feito', quantidade: 1, origem: 'logica' },
    ]);
    expect(
      await porta.gravarSgh(ctx, trilha('agendamento_relatorio', id), (g) => g.excluirAgendamento(id)),
    ).toBe(0);
    const h = await porta.historicoOrigem(ctx);
    expect(h.porAno.reduce((s, x) => s + x.quantidade, 0)).toBe(3);
    // O envio que nunca rodou sai de vez (os destinatários com ele).
    const novo = await porta.gravarSgh(
      ctx,
      (i: string) => trilha('agendamento_relatorio', i),
      (g) => g.criarAgendamento(envio(), 'r0404.teste', new Date('2030-01-07T07:30:00Z')),
    );
    expect(
      await porta.gravarSgh(ctx, trilha('agendamento_relatorio', novo), (g) => g.excluirAgendamento(novo)),
    ).toBe(1);
    expect(await porta.agendamento(ctx, novo)).toBeNull();
  });

  it('triagem: proposta, aceite da área com papel dono, resumo e acesso herdado pela permissão', async () => {
    const r = await porta.gravarSgh(ctx, trilha('triagem_relatorio_legado'), (g) =>
      g.gravarPropostas([
        {
          id: ORIGEM.pendente,
          nome: `Relatorio de origem ${P} um`,
          modulo: 0,
          destino: 'catalogo',
          marco: 'M34',
          artefato: 'atendimentosPorDia',
          papelDono: `${P}-FAT`,
          onda: 1,
          regra: 'regra sintetica',
          motivo: 'motivo sintetico',
        },
      ]),
    );
    expect(r).toEqual({ incluidas: 0, atualizadas: 1, preservadas: 0 });
    // Inclusão seguida de nova proposta do mesmo relatório de origem: acha pelo código (sem duplicar a linha); o
    // relatório próprio de outro estabelecimento nunca é ligado.
    const nova = (destino: string, artefato: string) =>
      porta.gravarSgh(ctx, trilha('triagem_relatorio_legado'), (g) =>
        g.gravarPropostas([
          {
            id: ORIGEM.nova,
            nome: `Relatorio de origem ${P} tres`,
            modulo: 0,
            destino,
            marco: 'M34',
            artefato,
            papelDono: `${P}-FAT`,
            onda: 1,
            regra: 'regra sintetica',
            motivo: 'motivo sintetico',
          },
        ]),
      );
    expect(await nova('descartado', 'sem uso')).toEqual({ incluidas: 1, atualizadas: 0, preservadas: 0 });
    expect(await nova('catalogo', `${P}-PRIV`)).toEqual({ incluidas: 0, atualizadas: 1, preservadas: 0 });
    expect(
      await ler<{ n: number; rel: number | null }>(
        'SELECT COUNT(*) AS n, MAX(relatorio_id) AS rel FROM triagem_relatorio_legado WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, String(ORIGEM.nova)],
      ),
    ).toMatchObject({ n: 1, rel: null });
    // Toda triagem decidida tem área dona, pela chave do domínio (o papel de segurança é o da área de faturamento).
    expect(
      await ler<{ n: number }>(
        "SELECT COUNT(*) AS n FROM triagem_relatorio_legado WHERE estabelecimento_id = ? AND codigo IN (?, ?) AND area = 'faturamento'",
        [ids.est, String(ORIGEM.pendente), String(ORIGEM.nova)],
      ),
    ).toMatchObject({ n: 2 });
    expect(
      await erroDe(
        porta.gravarSgh(ctx, trilha('triagem_relatorio_legado'), (g) =>
          g.gravarPropostas([
            {
              id: ORIGEM.nova + 1000,
              nome: `Relatorio de origem ${P} sem area`,
              modulo: 0,
              destino: 'descartado',
              marco: null,
              artefato: 'sem uso',
              papelDono: 'papel fora das areas',
              onda: 1,
              regra: 'regra sintetica',
              motivo: 'motivo sintetico',
            },
          ]),
        ),
      ),
    ).toBe('triagem-sem-area');
    expect(await porta.umaTriagem(ctx, ids.triPendente)).toMatchObject({
      destino: 'catalogo',
      situacao: 'proposta',
      papelDono: `${P}-FAT`,
      parametros: 2,
    });
    const decisao = {
      destino: 'catalogo',
      marco: 'M34',
      artefato: 'atendimentosPorDia',
      onda: 1,
      motivo: 'Area confirmou',
    };
    expect(
      await erroDe(
        porta.gravarSgh(ctx, trilha('triagem_relatorio_legado'), (g) =>
          g.decidirTriagem(ids.triPendente, { ...decisao, papelDono: 'papel inexistente' }, 'r0404.teste'),
        ),
      ),
    ).toBe('papel-desconhecido');
    expect(
      await porta.gravarSgh(ctx, trilha('triagem_relatorio_legado'), (g) =>
        g.decidirTriagem(ids.triPendente, { ...decisao, papelDono: `${P}-FAT` }, 'r0404.teste'),
      ),
    ).toBe(1);
    // A área aceitou o destino proposto: o aceite é dela; a decisão segue a da proposta (sem autor humano).
    const t = await porta.umaTriagem(ctx, ids.triPendente);
    expect(t).toMatchObject({
      situacao: 'confirmada',
      aceitoPor: 'r0404.teste',
      decididoPor: null,
      motivo: 'Area confirmou',
    });
    expect(t?.aceitoEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Mudar o destino é decidir: a decisão nova também é da área.
    expect(
      await porta.gravarSgh(ctx, trilha('triagem_relatorio_legado'), (g) =>
        g.decidirTriagem(ids.triPendente, { ...decisao, marco: 'M35', papelDono: `${P}-FAT` }, 'r0404.teste'),
      ),
    ).toBe(1);
    expect(await porta.umaTriagem(ctx, ids.triPendente)).toMatchObject({
      marco: 'M35',
      decididoPor: 'r0404.teste',
      aceitoPor: 'r0404.teste',
    });
    const resumo = await porta.resumoTriagem(ctx);
    expect(resumo).toMatchObject({ total: 3, semDestino: 0, confirmadas: 1, porDestino: { catalogo: 3 } });
    expect((await porta.triagem(ctx, { situacao: 'confirmada', pagina: 0, tamanho: 10 })).total).toBe(1);
    expect(await porta.umaTriagem(outro, ids.triPendente)).toBeNull();
    // Todos os de origem restritos: só com a permissão do relatório.
    expect(await porta.acessoDeOrigem(ctx, 'internadosNaData', 'r0404.teste')).toEqual({
      relatorios: 1,
      restrito: true,
      permitido: false,
    });
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'permissao-teste-04-04' }, (e) =>
      e.inserir('INSERT INTO relatorio_permissao (relatorio_id, usuario_id, criado_em) VALUES (?, ?, ?)', [
        relatorios['internadosNaData'],
        ids.usuario,
        new Date(),
      ]),
    );
    expect((await porta.acessoDeOrigem(ctx, 'internadosNaData', 'r0404.teste')).permitido).toBe(true);
    expect(await porta.acessoDeOrigem(ctx, 'atendimentosPorDia', 'r0404.teste')).toMatchObject({
      restrito: false,
    });
  });

  it('pedido de relatório novo: ciclo inteiro com a tabela; sem ela, recusa explícita', async () => {
    const dados = {
      titulo: `Pedido ${P}`,
      descricao: 'Descricao sintetica do relatorio pedido',
      finalidade: 'Finalidade sintetica',
      area: 'Diretoria',
      prazo: '2030-01-31',
    };
    if (!temPedido) {
      expect(await erroDe(porta.pedidos(ctx, {}))).toBe('pedido-indisponivel');
      expect(
        await erroDe(
          porta.gravarSgh(ctx, trilha('pedido_relatorio'), (g) => g.criarPedido(dados, 'r0404.teste')),
        ),
      ).toBe('pedido-indisponivel');
      return;
    }
    const id = await porta.gravarSgh(
      ctx,
      (i: string) => trilha('pedido_relatorio', i),
      (g) => g.criarPedido(dados, 'r0404.teste'),
    );
    const lido = await porta.pedido(ctx, id);
    expect(lido).toMatchObject({ ...dados, situacao: 'aberto', solicitante: 'r0404.teste', versao: 1 });
    expect(await porta.pedido(outro, id)).toBeNull();
    // Trava otimista: a versão velha é recusada; a certa grava e sobe a versão.
    expect(
      await erroDe(
        porta.gravarSgh(ctx, trilha('pedido_relatorio', id), (g) =>
          g.alterarPedido(id, { ...dados, titulo: 'Outro titulo' }, 'r0404.teste', 7),
        ),
      ),
    ).toBe('conflito-versao');
    expect(
      await porta.gravarSgh(ctx, trilha('pedido_relatorio', id), (g) =>
        g.alterarPedido(id, { ...dados, titulo: `Pedido ${P} corrigido` }, 'r0404.teste', 1),
      ),
    ).toBe(1);
    expect(await porta.pedido(ctx, id)).toMatchObject({ titulo: `Pedido ${P} corrigido`, versao: 2 });
    await porta.gravarSgh(ctx, trilha('pedido_relatorio', id), async (g) => {
      const antes = await g.lerPedidoTravado(id);
      await g.cancelarPedido(id, 'Nao precisa mais', 'r0404.teste', 2);
      await g.registrarEvento(
        { alvo: 'pedido', id, evento: 'cancelamento', antes, motivo: 'Nao precisa mais' },
        '',
      );
      return 1;
    });
    const cancelado = await porta.pedido(ctx, id);
    expect(cancelado).toMatchObject({ motivoCancelamento: 'Nao precisa mais', canceladoPor: 'r0404.teste' });
    // A mesma base de tempo (UTC no banco, hora local na leitura): criado e cancelado no mesmo minuto.
    expect(Math.abs(cancelado!.canceladoEm!.getTime() - cancelado!.criadoEm.getTime())).toBeLessThan(120_000);
    expect(
      await porta.gravarSgh(ctx, trilha('pedido_relatorio', id), (g) => g.alterarPedido(id, dados, '')),
    ).toBe(0);
    expect(await porta.gravarSgh(ctx, trilha('pedido_relatorio', id), (g) => g.excluirPedido(id))).toBe(0);
    expect((await porta.eventos(ctx, 'pedido', id)).map((e) => e.evento)).toEqual(['cancelamento']);
    // Resposta do curador e exclusão só do nunca atendido.
    const outroPedido = await porta.gravarSgh(
      ctx,
      (i: string) => trilha('pedido_relatorio', i),
      (g) => g.criarPedido(dados, 'r0404.teste'),
    );
    expect(
      await porta.gravarSgh(ctx, trilha('pedido_relatorio', outroPedido), (g) =>
        g.responderPedido(
          outroPedido,
          { situacao: 'publicado', relatorio: 'atendimentosPorDia', resposta: 'Ja existe no catalogo' },
          'r0404.teste',
        ),
      ),
    ).toBe(1);
    expect(await porta.pedido(ctx, outroPedido)).toMatchObject({
      situacao: 'publicado',
      relatorio: 'atendimentosPorDia',
      respondidoPor: 'r0404.teste',
    });
    expect(
      await porta.gravarSgh(ctx, trilha('pedido_relatorio', outroPedido), (g) =>
        g.excluirPedido(outroPedido),
      ),
    ).toBe(0);
    const terceiro = await porta.gravarSgh(
      ctx,
      (i: string) => trilha('pedido_relatorio', i),
      (g) => g.criarPedido(dados, 'r0404.teste'),
    );
    expect(
      await porta.gravarSgh(outro, trilha('pedido_relatorio', terceiro), (g) => g.excluirPedido(terceiro)),
    ).toBe(0);
    expect(
      await porta.gravarSgh(ctx, trilha('pedido_relatorio', terceiro), (g) => g.excluirPedido(terceiro)),
    ).toBe(1);
    expect(await porta.pedido(ctx, terceiro)).toBeNull();
  });

  it('01-ADM L82: a exportação grava a justificativa no motivo da execução', async () => {
    const just = 'Auditoria do convênio de janeiro';
    const x = await porta.gravarSgh(
      ctx,
      (i: string) => trilha('execucao_relatorio', i),
      (g) =>
        g.registrarExecucao({
          relatorio: 'atendimentosPorDia',
          tipo: 'exportacao',
          formato: 'csv',
          usuario: 'r0404.teste',
          parametros: '{"fim":"2030-01-31","inicio":"2030-01-01"}',
          linhas: 3,
          duracaoMs: 8,
          dadoPessoal: true,
          mascarado: false,
          justificativa: just,
          situacao: 'ok',
          agendamento: null,
        }),
    );
    const l = await ler<Record<string, unknown>>('SELECT motivo FROM execucao_relatorio WHERE id = ?', [x]);
    expect(l?.['motivo']).toBe(just);
  });

  describe('a mesma bateria na memória e no banco', () => {
    const fabricas: [string, () => { porta: PortaRelatorio; c: ContextoRelatorio }][] = [
      ['memoria', () => ({ porta: new PortaRelatorioMemoria(null), c: ctx })],
      ['banco', () => ({ porta, c: ctx })],
    ];
    it.each(fabricas)(
      '%s: o envio criado volta igual e a execução fica registrada',
      async (_nome, fabrica) => {
        const { porta: p, c } = fabrica();
        const dados = envio();
        const id = await p.gravarSgh(
          c,
          (i: string) => trilha('agendamento_relatorio', i),
          (g) => g.criarAgendamento(dados, 'r0404.teste', new Date('2030-02-04T07:30:00Z')),
        );
        expect(await p.agendamento(c, id)).toMatchObject({
          relatorio: dados.relatorio,
          titulo: dados.titulo,
          enderecos: [...dados.enderecos],
          periodicidade: 'semanal',
          hora: '07:30',
          ativo: true,
        });
        const x = await p.gravarSgh(
          c,
          (i: string) => trilha('execucao_relatorio', i),
          (g) =>
            g.registrarExecucao({
              relatorio: 'atendimentosPorDia',
              tipo: 'execucao',
              formato: 'grade',
              usuario: 'r0404.teste',
              parametros: '{"fim":"2030-01-31","inicio":"2030-01-01"}',
              linhas: 3,
              duracaoMs: 12.4,
              dadoPessoal: false,
              mascarado: false,
              justificativa: null,
              situacao: 'ok',
              agendamento: null,
            }),
        );
        const lidas = await p.execucoes(c, { relatorio: 'atendimentosPorDia', limite: 10 });
        expect(lidas.find((e) => e.id === x)).toMatchObject({
          tipo: 'execucao',
          formato: 'grade',
          linhas: 3,
          situacao: 'ok',
        });
      },
    );
    it.each(fabricas)(
      '%s: a alteração com a versão velha é recusada (conflito-versao); com a certa grava',
      async (_nome, fabrica) => {
        const { porta: p, c } = fabrica();
        const id = await p.gravarSgh(
          c,
          (i: string) => trilha('agendamento_relatorio', i),
          (g) => g.criarAgendamento(envio(), 'r0404.teste', new Date('2030-02-04T07:30:00Z')),
        );
        const alterar = (versao: number) =>
          p.gravarSgh(c, trilha('agendamento_relatorio', id), (g) =>
            g.alterarAgendamento(
              id,
              { ...envio({ hora: '09:00' }), ativo: true },
              'r0404.teste',
              null,
              versao,
            ),
          );
        expect(await erroDe(alterar(99))).toBe('conflito-versao');
        expect(await alterar(1)).toBe(1);
        expect(await erroDe(alterar(1))).toBe('conflito-versao');
        expect(await p.agendamento(c, id)).toMatchObject({ hora: '09:00' });
      },
    );
    it('no banco, a execução registrada em UTC (o instante real, não a hora local)', async () => {
      const r = await ler<{ d: number }>(
        'SELECT ABS(TIMESTAMPDIFF(SECOND, ocorrido_em, UTC_TIMESTAMP())) AS d FROM execucao_relatorio WHERE estabelecimento_id = ? ORDER BY id DESC LIMIT 1',
        [ids.est],
      );
      expect(Number(r?.d)).toBeLessThan(300);
    });
    it('no banco, só o resumo SHA-256 dos parâmetros', async () => {
      const r = await ler<{ p: string }>(
        'SELECT CAST(parametros AS CHAR) AS p FROM execucao_relatorio WHERE estabelecimento_id = ? ORDER BY id DESC LIMIT 1',
        [ids.est],
      );
      expect(JSON.parse(r?.p ?? '{}')).toEqual({ resumo: expect.stringMatching(/^[0-9a-f]{64}$/) });
    });
  });
});
