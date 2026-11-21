// Integração da porta, do executor e do serviço PRÓPRIOS do saneamento dos perfis de acesso amplo contra o MariaDB
// real, no cliente de teste da onda 2 (f22_o2). Massa SINTÉTICA do lote 02-04 (estabelecimento l0204e e outro l0204f,
// contas teste.l0204.*, o perfil amplo MASTER_SEM_FINANCEIRO do estabelecimento E da rede com o mesmo código, o perfil
// L0204_TRABALHO e ações do catálogo do cliente), idempotente no beforeAll e limpa no afterAll (menos a trilha, que é
// só de inclusão).
// Contrato de efeito: o plano (inclusão, aprovação, reserva, conclusão e descarte, com a trilha), a troca de perfil
// (vigência encerrada e a nova aberta), o bloqueio (situação, data e linha do tempo da conta), a retirada das ações
// (exclusão lógica) e as recusas (item que exige aprovação não é reservado nem aplicado antes de aprovado; conta com
// perfil em outro estabelecimento não é bloqueada; conta fora do perfil; entrada inválida; sem reautenticação).
// Tabelas pedidas por DDL (saida/02-04.json): sem a migração aplicada, o teste cria saneamento_acesso_item e
// uso_acao_usuario no esquema de teste a partir do DDL do PRÓPRIO pedido, marca-as no COMMENT e as apaga no fim. Sem o
// DDL nem a tabela, os testes que dependem dela aparecem como PULADOS (it.skipIf), nunca como aprovados.
// SGH_NUCLEO_SEM_BANCO=1 pula o arquivo.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ExecutorSaneamentoProprio,
  PortaSaneamentoPropria,
  TABELA_PLANO_SANEAMENTO,
  TABELA_USO_ACOES,
  USO_INDISPONIVEL,
} from './porta-propria.js';
import type { TrilhaSaneamento } from './porta.js';
import { type AtorSaneamento, type ContextoExecucaoSaneamento, OPERACOES_SANEAMENTO, ServicoSaneamento } from './servico.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const BANCO = `cliente_${CLIENTE}`;
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const RAIZ = fileURLToPath(new URL('../../../../../../', import.meta.url));
const MARCA = '[teste-l0204]';
const EST = 'l0204e';
const OUTRO = 'l0204f';
const AMPLO = 'MASTER_SEM_FINANCEIRO';
const TRABALHO = 'L0204_TRABALHO';
const GESTOR = 'teste.l0204.gestor';
const AREA = 'teste.l0204.area';
const A = 'teste.l0204.a';
const B = 'teste.l0204.b';
const C = 'teste.l0204.c';
const E = 'teste.l0204.e';
const CONTAS = [GESTOR, AREA, A, B, C, E];
/** Motivo único por rodada: a chave do plano é determinística (estado + conteúdo) e a massa é apagada entre rodadas. */
const RODADA = `rodada ${Date.now()}`;

/** SQL como root no banco de teste (só DDL das tabelas pedidas e a conferência delas). */
function sqlRoot(entrada: string, ...args: string[]): string {
  return execFileSync(`${RAIZ}tools/db/sql.sh`, [BANCO, ...args], { input: entrada, encoding: 'utf8' });
}
/** null: a tabela não existe; senão o comentário dela. */
function comentario(tabela: string): string | null {
  const r = sqlRoot(
    '',
    '-N',
    '-e',
    `SELECT TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${BANCO}' AND TABLE_NAME = '${tabela}'`,
  ).trim();
  return r === '' ? null : r;
}
/** O DDL de cada tabela pedida pelo lote (o próprio pedido ao integrador é a fonte). */
function ddlsDoPedido(): Map<string, string> {
  const p = `${RAIZ}docs/obra/fatias/f22/saida/02-04.json`;
  const r = new Map<string, string>();
  if (!existsSync(p)) return r;
  const d = JSON.parse(readFileSync(p, 'utf8')) as { pedidos?: { tipo?: string; tabela?: string; ddl?: string }[] };
  for (const x of d.pedidos ?? []) if (x.tipo === 'ddl' && x.tabela && x.ddl) r.set(x.tabela, x.ddl);
  return r;
}
const DDL = SEM_BANCO ? new Map<string, string>() : ddlsDoPedido();
const INICIAL = SEM_BANCO
  ? { plano: null, uso: null }
  : { plano: comentario(TABELA_PLANO_SANEAMENTO), uso: comentario(TABELA_USO_ACOES) };
const doBanco = (c: string | null) => c !== null && !c.includes(MARCA);
const PLANO_POSSIVEL = !SEM_BANCO && (INICIAL.plano !== null || DDL.has(TABELA_PLANO_SANEAMENTO));
const USO_POSSIVEL = !SEM_BANCO && (INICIAL.uso !== null || DDL.has(TABELA_USO_ACOES));
/** O uso da migração (não o do teste) existe: o caminho "sem a tabela do uso" não pode ser exercitado. */
const USO_DO_BANCO = doBanco(INICIAL.uso);

/** Cria a tabela pelo DDL do pedido, marcada; devolve true se foi criada pelo teste (e deve ser apagada). */
function garantirTabela(tabela: string): boolean {
  const c = comentario(tabela);
  if (c !== null) return !doBanco(c);
  const ddl = DDL.get(tabela);
  if (!ddl) throw new Error(`sem DDL do pedido para ${tabela}`);
  sqlRoot(`${ddl}\nALTER TABLE ${tabela} COMMENT = 'Tabela de teste do lote 02-04 ${MARCA}';\n`);
  return true;
}
function apagarSeDoTeste(tabela: string): void {
  const c = comentario(tabela);
  if (c !== null && !doBanco(c)) sqlRoot(`DROP TABLE ${tabela};\n`);
}

describe.skipIf(SEM_BANCO)('saneamento próprio contra o MariaDB (cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaSaneamentoPropria;
  let executor: ExecutorSaneamentoProprio;
  const ids = { est: 0, outro: 0, amplo: 0, amploRede: 0, trabalho: 0, amploOutro: 0, acoes: [] as number[] };
  const usu: Record<string, number> = {};
  let marco = new Date();

  async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
    const l = await e.uma<{ id: number }>(sel, p);
    return l ? Number(l.id) : e.inserir(ins, pi);
  }
  async function existe(e: Escritor, tabela: string): Promise<boolean> {
    const t = await e.uma<{ n: number }>(
      'SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      [tabela],
    );
    return Number(t?.n) === 1;
  }
  async function limpar(e: Escritor) {
    if (!ids.est) return;
    const contas = Object.values(usu);
    if (await existe(e, TABELA_PLANO_SANEAMENTO))
      await e.executar(`DELETE FROM ${TABELA_PLANO_SANEAMENTO} WHERE estabelecimento_id IN (?, ?)`, [ids.est, ids.outro]);
    if (await existe(e, TABELA_USO_ACOES))
      await e.executar(`DELETE FROM ${TABELA_USO_ACOES} WHERE estabelecimento_id IN (?, ?)`, [ids.est, ids.outro]);
    await e.executar('DELETE FROM usuario_perfil WHERE estabelecimento_id IN (?, ?)', [ids.est, ids.outro]);
    await e.executar('DELETE FROM perfil_acao WHERE perfil_acesso_id IN (?, ?, ?)', [ids.amplo, ids.trabalho, ids.amploOutro]);
    if (contas.length) {
      await e.executar(`DELETE FROM usuario_situacao_historico WHERE usuario_id IN (${contas.map(() => '?').join(', ')})`, contas);
      await e.executar(
        `UPDATE usuario SET situacao = 'ativo', bloqueado_em = NULL WHERE id IN (${contas.map(() => '?').join(', ')})`,
        contas,
      );
    }
    // A trilha_auditoria é só de inclusão (a conta da API não apaga): as linhas da massa ficam, presas aos dois
    // estabelecimentos fictícios.
  }
  const linha = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l0204-conferir' }, (l) => l.uma(sql, p));
  const trilha = (usuario = GESTOR): TrilhaSaneamento => ({
    rede: 'teste',
    hospital: EST,
    usuario,
    evento: 'acesso.saneamento.teste',
    recurso: 'acesso.saneamento',
    operacao: 'teste',
    resultado: 'sucesso',
    estacao: null,
    correlacao: `teste-l0204-${Date.now()}`,
  });
  const ctx = (chave: string, reautenticado = true): ContextoExecucaoSaneamento => ({
    hospital: EST,
    login: GESTOR,
    correlacao: `teste-l0204-${chave}`,
    estacao: null,
    chaveIdempotencia: `l0204-${chave}-${Date.now()}`,
    ...(reautenticado ? { reautenticadoEm: Date.now() } : {}),
  });
  const nova = (login: string, exigeAprovacao: boolean) => ({
    hospital: EST,
    grupoOrigem: AMPLO,
    idUsuario: usu[login] ?? null,
    login,
    decisao: 'trocar-grupo' as const,
    grupoDestino: TRABALHO,
    perdasTotal: 2,
    perdasUsadas: exigeAprovacao ? 1 : 0,
    exigeAprovacao,
    motivo: `Decisão sintética do teste, ${RODADA}`,
    criadoPor: GESTOR,
  });

  beforeAll(async () => {
    // Sobra de uma rodada interrompida: a tabela do uso criada pelo teste começa ausente.
    apagarSeDoTeste(TABELA_USO_ACOES);
    if (PLANO_POSSIVEL) garantirTabela(TABELA_PLANO_SANEAMENTO);
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(BANCO);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-l0204' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `Hospital sintético ${codigo}`, `Hospital sintético ${codigo} (fictício)`, agora],
        );
      ids.est = await est(EST);
      ids.outro = await est(OUTRO);
      for (const login of CONTAS)
        usu[login] = await garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          [login],
          'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
          [login, `USUARIO SINTETICO ${login.toUpperCase()}`, agora],
        );
      const perfil = (estab: number | null, codigo: string) =>
        garantir(
          e,
          estab === null
            ? 'SELECT id FROM perfil_acesso WHERE estabelecimento_id IS NULL AND codigo = ?'
            : 'SELECT id FROM perfil_acesso WHERE estabelecimento_id = ? AND codigo = ?',
          estab === null ? [codigo] : [estab, codigo],
          'INSERT INTO perfil_acesso (estabelecimento_id, codigo, nome, criado_em) VALUES (?, ?, ?, ?)',
          [estab, codigo, `Perfil sintético ${codigo}`, agora],
        );
      ids.amplo = await perfil(ids.est, AMPLO);
      ids.amploRede = await perfil(null, AMPLO);
      ids.trabalho = await perfil(ids.est, TRABALHO);
      ids.amploOutro = await perfil(ids.outro, AMPLO);
      const acoes = await e.consultar<{ id: number }>('SELECT id FROM acao_sistema WHERE ativo ORDER BY id LIMIT 3', []);
      expect(acoes.length).toBe(3);
      ids.acoes = acoes.map((x) => Number(x.id));
      await limpar(e);
      // O amplo do estabelecimento tem as três ações; o de trabalho, a primeira. A, B e C estão no amplo do
      // estabelecimento; E, no amplo da REDE com o mesmo código; C também no amplo do outro estabelecimento.
      for (const a of ids.acoes)
        await e.executar('INSERT INTO perfil_acao (perfil_acesso_id, acao_sistema_id, criado_em) VALUES (?, ?, ?)', [ids.amplo, a, agora]);
      await e.executar('INSERT INTO perfil_acao (perfil_acesso_id, acao_sistema_id, criado_em) VALUES (?, ?, ?)', [
        ids.trabalho,
        ids.acoes[0],
        agora,
      ]);
      const atribuir = (login: string, p: number, estab: number) =>
        e.executar(
          'INSERT INTO usuario_perfil (usuario_id, perfil_acesso_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?, ?)',
          [usu[login], p, estab, '2026-01-01', agora],
        );
      for (const login of [A, B, C]) await atribuir(login, ids.amplo, ids.est);
      await atribuir(E, ids.amploRede, ids.est);
      await atribuir(C, ids.amploOutro, ids.outro);
      await e.executar("UPDATE usuario SET situacao = 'inativo' WHERE id = ?", [usu[B]]);
      marco = new Date(Date.now() - 1);
    });
    porta = new PortaSaneamentoPropria(nucleo, CLIENTE);
    executor = new ExecutorSaneamentoProprio(nucleo, CLIENTE);
  }, 180_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-l0204' }, (e) => limpar(e));
      await nucleo.encerrar();
    }
    if (!SEM_BANCO) {
      apagarSeDoTeste(TABELA_USO_ACOES);
      apagarSeDoTeste(TABELA_PLANO_SANEAMENTO);
    }
  });

  it('lê o grupo amplo (perfil do estabelecimento e da rede com o mesmo código): contas, ativas, ações e títulos', async () => {
    const [g, inexistente] = await porta.grupos(EST, [AMPLO, 'L0204_NAO_EXISTE']);
    expect(g).toEqual({ grupo: AMPLO, existe: true, ativo: true, usuarios: 4, ativos: 3, opcoes: 3 });
    expect(inexistente).toMatchObject({ existe: false, usuarios: 0 });
    const lista = await porta.usuarios(EST, AMPLO);
    expect(lista.map((u) => u.login)).toEqual([A, C, E, B]); // inativos por último
    expect(lista.find((u) => u.login === B)).toMatchObject({ ativo: false, bloqueado: false, grupo: AMPLO });
    expect(await porta.usuario(EST, A)).toMatchObject({ login: A, idUsuario: usu[A], grupo: AMPLO, ativo: true, emOutroEstabelecimento: false });
    expect(await porta.usuario(EST, E)).toMatchObject({ grupo: AMPLO, emOutroEstabelecimento: false });
    expect(await porta.usuario(EST, C)).toMatchObject({ grupo: AMPLO, emOutroEstabelecimento: true });
    expect(await porta.usuario(EST, 'teste.l0204.nao-existe')).toBeNull();
    const com = await porta.gruposComOpcoes(EST);
    expect(com.find((x) => x.grupo === AMPLO)?.opcoes).toEqual(ids.acoes);
    expect(com.find((x) => x.grupo === TRABALHO)?.opcoes).toEqual([ids.acoes[0]]);
    expect([...(await porta.titulos(EST, ids.acoes)).keys()].sort((a, b) => a - b)).toEqual(ids.acoes);
    // Outro estabelecimento não vaza: no l0204f só C tem o amplo.
    expect((await porta.grupos(OUTRO, [AMPLO]))[0]).toMatchObject({ usuarios: 1 });
    expect(await porta.pronto(EST)).toBe(PLANO_POSSIVEL);
  });

  it.skipIf(USO_DO_BANCO)('sem a tabela do uso, a leitura do uso lança "uso indisponível" (nunca um mapa vazio)', async () => {
    await expect(porta.uso(EST, AMPLO, marco)).rejects.toMatchObject({
      problema: expect.objectContaining({ codigo: USO_INDISPONIVEL, status: 503 }),
    });
  });

  it.skipIf(!USO_POSSIVEL)('com a tabela do uso: soma por conta e ação na janela, só das ativas do grupo; janela não coberta lança', async () => {
    const criada = garantirTabela(TABELA_USO_ACOES);
    try {
      const hoje = new Date().toISOString().slice(0, 10);
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-l0204-uso' }, async (e) => {
        const agora = new Date();
        const usar = (estab: number, login: string, acao: number | undefined, n: number) =>
          e.executar(
            `INSERT INTO ${TABELA_USO_ACOES} (estabelecimento_id, usuario_id, acao_sistema_id, dia, quantidade,
               primeiro_uso_em, ultimo_uso_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [estab, usu[login], acao, hoje, n, agora, agora, agora],
          );
        await usar(ids.est, A, ids.acoes[0], 2);
        await usar(ids.est, A, ids.acoes[1], 1);
        await usar(ids.est, E, ids.acoes[2], 4); // perfil da rede com o mesmo código
        await usar(ids.est, B, ids.acoes[0], 9); // inativa: fora
        await usar(ids.outro, A, ids.acoes[2], 5); // outro estabelecimento: fora
      });
      const uso = await porta.uso(EST, AMPLO, marco);
      expect(uso.get(A)).toEqual(new Map([[ids.acoes[0], 2], [ids.acoes[1], 1]]));
      expect(uso.get(E)).toEqual(new Map([[ids.acoes[2], 4]]));
      expect(uso.has(B)).toBe(false);
      // A contagem começou hoje: uma janela que começa antes não está coberta (uso não lido, falha fechada).
      await expect(porta.uso(EST, AMPLO, new Date(Date.now() - 10 * 86_400_000))).rejects.toMatchObject({
        problema: expect.objectContaining({ codigo: USO_INDISPONIVEL }),
      });
    } finally {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-l0204-uso-fim' }, (e) =>
        e.executar(`DELETE FROM ${TABELA_USO_ACOES} WHERE estabelecimento_id IN (?, ?)`, [ids.est, ids.outro]),
      );
      if (criada) apagarSeDoTeste(TABELA_USO_ACOES);
    }
  });

  it.skipIf(!PLANO_POSSIVEL)('plano pela porta: inclui, reserva, conclui e descarta com a trilha; item que exige aprovação não segue sem ela', async () => {
    // Sem exigência: reserva (uma vez), não descarta reservado, conclui; três gravações na trilha.
    const { id } = await porta.incluir(EST, nova(A, false), trilha());
    expect(await porta.item(EST, id)).toMatchObject({ situacao: 'proposto', login: A, grupoDestino: TRABALHO, criadoPor: GESTOR });
    expect(await porta.item(OUTRO, id)).toBeNull();
    expect(await porta.reservar(EST, { id, por: GESTOR }, trilha())).toBe(true);
    expect(await porta.reservar(EST, { id, por: GESTOR }, trilha())).toBe(false);
    expect(await porta.descartar(EST, { id, por: GESTOR }, trilha())).toBe(false);
    expect(await porta.concluir(EST, { id, por: GESTOR, resultado: 'aplicado', erro: null }, trilha())).toBe(true);
    expect(await porta.item(EST, id)).toMatchObject({ situacao: 'aplicado', aplicadoPor: GESTOR });
    // Só desta rodada: a trilha é só de inclusão e a tabela do teste, recriada, repete os ids.
    const t = await linha(
      'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = ? AND entidade_id = ? AND ocorrido_em >= ?',
      [TABELA_PLANO_SANEAMENTO, Number(id), marco],
    );
    expect(Number(t?.['n'])).toBe(3);
    expect((await porta.plano(EST, AMPLO)).map((i) => i.id)).toContain(id);

    // Com exigência: o proponente não aprova; sem aprovação não reserva nem conclui; o banco recusa "aplicado" sem
    // aprovador (CHECK do DDL); descarta.
    const x = await porta.incluir(EST, nova(C, true), trilha());
    await expect(
      porta.aprovar(EST, { id: x.id, area: 'Faturamento', aprovadoPor: GESTOR, motivo: 'Aprovação sintética' }, trilha()),
    ).rejects.toMatchObject({ problema: expect.objectContaining({ codigo: 'aprovacao-pelo-proponente' }) });
    expect(await porta.reservar(EST, { id: x.id, por: GESTOR }, trilha())).toBe(false);
    expect(await porta.concluir(EST, { id: x.id, por: GESTOR, resultado: 'aplicado', erro: null }, trilha())).toBe(false);
    await expect(
      nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-l0204-check' }, (e) =>
        e.executar(`UPDATE ${TABELA_PLANO_SANEAMENTO} SET situacao = 'aplicado' WHERE id = ?`, [Number(x.id)]),
      ),
    ).rejects.toThrow();
    expect(await porta.descartar(EST, { id: x.id, por: GESTOR }, trilha())).toBe(true);
    expect(await porta.descartar(EST, { id: x.id, por: GESTOR }, trilha())).toBe(false);
    expect(await porta.item(EST, x.id)).toMatchObject({ situacao: 'descartado' });
  });

  it.skipIf(!PLANO_POSSIVEL || USO_DO_BANCO)(
    'serviço sobre a porta própria: uso não lido exige aprovação; aplica só depois de aprovado (conta do perfil da rede)',
    async () => {
      const servico = new ServicoSaneamento({ porta, executor, administradoresMaximo: async () => 1 });
      const ator = (login: string): AtorSaneamento => ({
        rede: 'teste',
        hospital: EST,
        login,
        estacao: null,
        correlacao: `teste-l0204-servico-${login}`.slice(0, 64),
      });
      const sim = await servico.simular(ator(GESTOR), E, TRABALHO);
      expect(sim).toMatchObject({ grupoOrigem: AMPLO, usoLido: false, perdidasTotal: 2, perdidasUsadas: 0 });
      const item = await servico.incluir(ator(GESTOR), {
        login: E,
        decisao: 'trocar-grupo',
        grupoDestino: TRABALHO,
        motivo: `Troca sintética do teste, ${RODADA}`,
      });
      expect(item).toMatchObject({ situacao: 'proposto', exigeAprovacao: true, perdasTotal: 2 });
      const aplicar = () =>
        servico.aplicar(ator(GESTOR), item.id, { chaveIdempotencia: `l0204-apl-${Date.now()}`, reautenticadoEm: Date.now() });
      await expect(aplicar()).rejects.toMatchObject({ codigo: 'exige-aprovacao' });
      expect(await porta.reservar(EST, { id: item.id, por: GESTOR }, trilha())).toBe(false);
      expect(await servico.aprovar(ator(AREA), item.id, { area: 'Faturamento', motivo: `Aprovação sintética, ${RODADA}` })).toMatchObject({
        situacao: 'aprovado',
        aprovacao: { area: 'Faturamento', por: AREA },
      });
      expect((await aplicar()).item).toMatchObject({ situacao: 'aplicado', aplicadoPor: GESTOR });
      const ontem = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      expect(
        await linha(
          "SELECT DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim FROM usuario_perfil WHERE usuario_id = ? AND perfil_acesso_id = ?",
          [usu[E], ids.amploRede],
        ),
      ).toEqual({ fim: ontem });
      expect((await porta.usuario(EST, E))?.grupo).toBe(TRABALHO);
    },
  );

  it('troca o perfil: encerra o amplo (ontem) e abre o de trabalho (hoje), com a trilha da operação', async () => {
    await executor.executar(OPERACOES_SANEAMENTO.trocarGrupo, EST, { login: A, grupoOrigem: AMPLO, grupo: TRABALHO }, ctx('troca'));
    const ontem = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    expect(
      await linha(
        "SELECT DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim, versao FROM usuario_perfil WHERE usuario_id = ? AND perfil_acesso_id = ?",
        [usu[A], ids.amplo],
      ),
    ).toEqual({ fim: ontem, versao: 2 });
    expect(
      await linha(
        'SELECT vigencia_fim, motivo FROM usuario_perfil WHERE usuario_id = ? AND perfil_acesso_id = ? AND estabelecimento_id = ?',
        [usu[A], ids.trabalho, ids.est],
      ),
    ).toEqual({ vigencia_fim: null, motivo: 'Saneamento dos perfis de acesso amplo' });
    expect((await porta.usuario(EST, A))?.grupo).toBe(TRABALHO);
    const t = await linha(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'usuario_perfil' AND estabelecimento_id = ? AND usuario_id = ?",
      [ids.est, usu[GESTOR]],
    );
    expect(Number(t?.['n'])).toBeGreaterThanOrEqual(1);
    // De novo: a conta já não tem o amplo (recusa, nada gravado).
    await expect(
      executor.executar(OPERACOES_SANEAMENTO.trocarGrupo, EST, { login: A, grupoOrigem: AMPLO, grupo: TRABALHO }, ctx('troca2')),
    ).rejects.toMatchObject({ problema: expect.objectContaining({ codigo: 'usuario-fora-do-grupo', status: 409 }) });
  });

  it('recusa: perfil só de outro estabelecimento, entrada inválida e operação crítica sem reautenticação', async () => {
    // C tem o amplo do l0204e e o do l0204f; o destino de trabalho só existe no l0204e.
    await expect(
      executor.executar(
        OPERACOES_SANEAMENTO.trocarGrupo,
        OUTRO,
        { login: C, grupoOrigem: AMPLO, grupo: TRABALHO },
        { ...ctx('outro'), hospital: OUTRO },
      ),
    ).rejects.toMatchObject({ problema: expect.objectContaining({ codigo: 'destino-invalido' }) });
    await expect(
      executor.executar(OPERACOES_SANEAMENTO.retirarOpcoes, EST, { grupo: AMPLO, opcoes: [] }, ctx('vazia')),
    ).rejects.toMatchObject({ problema: expect.objectContaining({ status: 400 }) });
    await expect(
      executor.executar(OPERACOES_SANEAMENTO.bloquear, EST, { login: B, motivo: 'Sem reautenticar' }, ctx('sem-senha', false)),
    ).rejects.toMatchObject({ problema: expect.objectContaining({ status: 401 }) });
    expect(await linha('SELECT situacao FROM usuario WHERE id = ?', [usu[B]])).toEqual({ situacao: 'inativo' });
  });

  it('bloqueio: recusado a quem tem perfil em outro estabelecimento; grava a linha do tempo; retira ações (exclusão lógica)', async () => {
    await expect(
      executor.executar(OPERACOES_SANEAMENTO.bloquear, EST, { login: C, motivo: 'Saneamento sintético' }, ctx('bloqueio-c')),
    ).rejects.toMatchObject({ problema: expect.objectContaining({ codigo: 'conta-em-outro-estabelecimento' }) });
    expect(await linha('SELECT situacao FROM usuario WHERE id = ?', [usu[C]])).toEqual({ situacao: 'ativo' });

    await executor.executar(OPERACOES_SANEAMENTO.bloquear, EST, { login: B, motivo: 'Saneamento sintético' }, ctx('bloqueio'));
    const u = await linha('SELECT situacao, bloqueado_em IS NOT NULL AS com_data FROM usuario WHERE id = ?', [usu[B]]);
    expect(u).toMatchObject({ situacao: 'bloqueado' });
    expect(Number(u?.['com_data'])).toBe(1);
    expect(
      await linha(
        'SELECT situacao_anterior, situacao_nova, evento, responsavel_usuario_id FROM usuario_situacao_historico WHERE usuario_id = ?',
        [usu[B]],
      ),
    ).toEqual({ situacao_anterior: 'inativo', situacao_nova: 'bloqueado', evento: 'bloqueio', responsavel_usuario_id: usu[GESTOR] });
    await expect(
      executor.executar(OPERACOES_SANEAMENTO.bloquear, EST, { login: B, motivo: 'De novo' }, ctx('bloqueio2')),
    ).rejects.toMatchObject({ problema: expect.objectContaining({ codigo: 'ja-bloqueado' }) });

    await executor.executar(OPERACOES_SANEAMENTO.retirarOpcoes, EST, { grupo: AMPLO, opcoes: ids.acoes.slice(0, 2) }, ctx('retirar'));
    const [g] = await porta.grupos(EST, [AMPLO]);
    expect(g?.opcoes).toBe(1);
    const r = await linha(
      'SELECT COUNT(*) AS n FROM perfil_acao WHERE perfil_acesso_id = ? AND excluido_em IS NOT NULL AND excluido_por = ?',
      [ids.amplo, usu[GESTOR]],
    );
    expect(Number(r?.['n'])).toBe(2);
  });
});
