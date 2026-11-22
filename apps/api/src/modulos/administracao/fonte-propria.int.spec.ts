// Fonte própria do M10 no MariaDB real (cliente f22_o2, massa sintética "L0205"): todas as leituras respondem sobre o
// modelo do produto, sempre no estabelecimento da sessão; e o contrato de efeito das gravações pelo Executor
// (bloqueio e desbloqueio da conta inteira, termo de uso, setor, pedido do titular, revisão da quebra de vidro): a
// linha, a versão, a trilha e o outbox, e as recusas (a si mesmo, repetição, conflito, outro estabelecimento, último
// gestor, falta de permissão nos outros estabelecimentos). Só contagens e códigos; nenhum dado real.
import { randomUUID } from 'node:crypto';
import { ErroOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroProblema } from '../../problema.filter.js';
import { FonteAdministracaoPropria } from './fonte-propria.js';
import type { ContextoGestao, Ctx, TrilhaGestao } from './tipos.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L0205';
const CPF = '98765432100';

interface Massa {
  est: number;
  outro: number;
  gestor: number;
  alvo: number;
  alvo2: number;
  alvo3: number;
  gestorAcessos: number;
  administrador: number;
  paciente: number;
  emergencia: number;
}

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    if (e instanceof ErroOperacao) return String(e.problema.codigo ?? '');
    if (e instanceof ErroProblema) return String(e.extras?.['codigo'] ?? e.tipo);
    return `outro: ${(e as Error)?.message ?? ''}`;
  }
}

describe.skipIf(SEM_BANCO)('fonte própria da administração (MariaDB, cliente f22_o2)', () => {
  const nucleo = new NucleoProprio();
  let m: Massa;
  let fonte: FonteAdministracaoPropria;
  const c: Ctx = { rede: 'rede-sint', hospital: P, traceId: 'teste-02-05' };
  const t: TrilhaGestao = {
    rede: 'rede-sint',
    hospital: P,
    usuario: `${P}.GESTOR`,
    evento: 'teste',
    recurso: 'teste',
    operacao: 'teste',
    resultado: 'sucesso',
    estacao: 'teste',
    correlacao: 'teste-02-05',
  };
  const ctxG = (usuario: number, hospital = P): ContextoGestao => ({
    rede: 'rede-sint',
    hospital,
    correlacao: 'teste-02-05',
    login: `${P}.GESTOR`,
    usuario,
    chaveIdempotencia: `t0205-${randomUUID()}`,
    estacao: 'teste',
  });
  const ler = <T>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-02-05' }, (l) => l.uma(sql, p)) as Promise<T>;

  async function limpar(ests: number[]): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-02-05' }, async (e) => {
      const q = ests.map(() => '?').join(', ');
      const x = (sql: string) => e.executar(sql, [...ests]);
      await x(
        `DELETE r FROM revisao_acesso_emergencial r JOIN acesso_emergencial a ON a.id = r.acesso_emergencial_id WHERE a.estabelecimento_id IN (${q})`,
      );
      await x(`DELETE FROM acesso_emergencial WHERE estabelecimento_id IN (${q})`);
      await x(
        `DELETE h FROM pedido_titular_historico h JOIN pedido_titular p ON p.id = h.pedido_titular_id WHERE p.estabelecimento_id IN (${q})`,
      );
      await x(`DELETE FROM pedido_titular WHERE estabelecimento_id IN (${q})`);
      await x(
        `DELETE a FROM aceite_termo_uso a JOIN termo_uso_versao v ON v.id = a.termo_uso_versao_id WHERE v.estabelecimento_id IN (${q})`,
      );
      await x(`DELETE FROM termo_uso_versao WHERE estabelecimento_id IN (${q})`);
      await x(`DELETE FROM registro_excluido WHERE estabelecimento_id IN (${q})`);
      await x(`DELETE FROM usuario_escopo WHERE estabelecimento_id IN (${q})`);
      await x(`DELETE FROM bloco_internacao WHERE estabelecimento_id IN (${q})`);
      await e.executar(
        `DELETE up FROM usuario_perfil up JOIN perfil_acesso p ON p.id = up.perfil_acesso_id JOIN usuario u ON u.id = up.usuario_id
          WHERE u.login LIKE ? AND p.codigo IN (?, 'gestor-acessos')`,
        [`${P}.%`, `${P}-ADM`],
      );
      await x(
        `UPDATE usuario u JOIN usuario_estabelecimento ue ON ue.usuario_id = u.id SET u.situacao = 'ativo', u.bloqueado_em = NULL WHERE ue.estabelecimento_id IN (${q})`,
      );
    });
  }

  beforeAll(async () => {
    const banco = (await nucleo.cliente(CLIENTE)).banco;
    if (banco !== `cliente_${CLIENTE}`) throw new Error('Cliente de teste inesperado.');
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-02-05' }, async (e) => {
      const agora = new Date();
      const g = (sel: string, p: unknown[], ins: string, pi: unknown[]) => garantir(e, sel, p, ins, pi);
      const est = (cod: string) =>
        g(
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [cod],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [cod, `ESTAB ${cod} SINTETICO`, `ESTAB ${cod} SINTETICO`, agora],
        );
      const e1 = await est(P);
      const e2 = await est(`${P}B`);
      const usuario = (login: string, cpf: string | null) =>
        g(
          'SELECT id FROM usuario WHERE login = ?',
          [login],
          "INSERT INTO usuario (login, nome, cpf, dispensa_cpf, tipo_conta, criado_em) VALUES (?, ?, ?, ?, 'pessoa', ?)",
          [login, `USUARIO SINTETICO ${login}`, cpf, cpf === null, agora],
        );
      const gestor = await usuario(`${P}.GESTOR`, null);
      const alvo = await usuario(`${P}.ALVO`, CPF);
      const alvo2 = await usuario(`${P}.ALVO2`, null);
      const vinculo = (u: number, es: number) =>
        g(
          'SELECT id FROM usuario_estabelecimento WHERE usuario_id = ? AND estabelecimento_id = ?',
          [u, es],
          'INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
          [u, es, '2020-01-01', agora],
        );
      const alvo3 = await usuario(`${P}.ALVO3`, null);
      for (const u of [gestor, alvo, alvo2, alvo3]) await vinculo(u, e1);
      // ALVO3 tem acesso aos dois estabelecimentos (a mesma conta); o GESTOR também tem vínculo com o segundo.
      await vinculo(alvo3, e2);
      await vinculo(gestor, e2);
      const administrador = await g(
        'SELECT id FROM perfil_acesso WHERE codigo = ?',
        [`${P}-ADM`],
        'INSERT INTO perfil_acesso (codigo, nome, administrador, criado_em) VALUES (?, ?, TRUE, ?)',
        [`${P}-ADM`, `ADM ${P}`, agora],
      );
      const gestorAcessos = await g(
        "SELECT id FROM perfil_acesso WHERE codigo = 'gestor-acessos' ORDER BY estabelecimento_id IS NULL DESC, id LIMIT 1",
        [],
        "INSERT INTO perfil_acesso (codigo, nome, criado_em) VALUES ('gestor-acessos', 'GESTOR DE ACESSOS SINTETICO', ?)",
        [agora],
      );
      await g(
        "SELECT id FROM tipo_escopo_acesso WHERE entidade = 'bloco_internacao' AND ativo ORDER BY id LIMIT 1",
        [],
        "INSERT INTO tipo_escopo_acesso (codigo, descricao, entidade, criado_em) VALUES ('setor_internacao', 'Setor de internação', 'bloco_internacao', ?)",
        [agora],
      );
      const perfil = await g(
        'SELECT id FROM perfil_acesso WHERE codigo = ?',
        [`${P}-PERFIL`],
        'INSERT INTO perfil_acesso (codigo, nome, criado_em) VALUES (?, ?, ?)',
        [`${P}-PERFIL`, `PERFIL ${P}`, agora],
      );
      await g(
        'SELECT id FROM usuario_perfil WHERE usuario_id = ? AND perfil_acesso_id = ?',
        [alvo, perfil],
        'INSERT INTO usuario_perfil (usuario_id, perfil_acesso_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?, ?)',
        [alvo, perfil, e1, '2020-01-01', agora],
      );
      const pf = await g(
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [`PACIENTE SINTETICO ${P}`],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        [`PACIENTE SINTETICO ${P}`, agora],
      );
      const paciente = await g(
        'SELECT id FROM paciente WHERE numero_prontuario = ?',
        ['9020500'],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pf, '9020500', agora],
      );
      const motivo = await g(
        'SELECT id FROM motivo_acesso_emergencial WHERE codigo = ?',
        [`${P}-EMERG`],
        'INSERT INTO motivo_acesso_emergencial (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [`${P}-EMERG`, 'EMERGENCIA SINTETICA', agora],
      );
      return {
        est: e1,
        outro: e2,
        gestor,
        alvo,
        alvo2,
        alvo3,
        gestorAcessos,
        administrador,
        paciente,
        emergencia: motivo,
      };
    });
    await limpar([m.est, m.outro]);
    m.emergencia = await nucleo.escrever(
      { cliente: CLIENTE, correlacao: 'preparo-teste-02-05' },
      async (e) => {
        const agora = new Date();
        for (const [es, cod] of [
          [m.est, 'B1'],
          [m.outro, 'B2'],
        ] as const)
          await e.inserir(
            'INSERT INTO bloco_internacao (estabelecimento_id, codigo, nome, criado_em) VALUES (?, ?, ?, ?)',
            [es, `${P}${cod}`, `BLOCO SINTETICO ${cod}`, agora],
          );
        await e.inserir(
          `INSERT INTO registro_excluido (estabelecimento_id, entidade, entidade_id, operacao, justificativa, dados, ocorrido_em, usuario_id, criado_em)
         VALUES (?, 'atendimento', 1, 'exclusao', 'SINTETICO L0205', '{}', ?, ?, ?)`,
          [m.est, agora, m.gestor, agora],
        );
        return e.inserir(
          `INSERT INTO acesso_emergencial (estabelecimento_id, usuario_id, paciente_id, motivo_acesso_emergencial_id, justificativa,
           inicio_em, fim_em, criado_em) VALUES (?, ?, ?, ?, 'SINTETICO L0205', ?, ?, ?)`,
          [m.est, m.alvo, m.paciente, m.emergencia, agora, new Date(agora.getTime() + 3_600_000), agora],
        );
      },
    );
    fonte = new FonteAdministracaoPropria(nucleo, CLIENTE, {
      rede: 'rede-sint',
      log: (msg, campos) => console.info(`[02-05] executor: ${msg}`, JSON.stringify(campos)),
    });
    await fonte.carregar();
  }, 180_000);

  afterAll(async () => {
    if (m) await limpar([m.est, m.outro]);
    await nucleo.encerrar();
  });

  it('as leituras respondem sobre o modelo, no estabelecimento da sessão', async () => {
    const l = await fonte.listarUsuarios(c, { pagina: 1, porPagina: 50, busca: `${P}.` });
    expect(l.itens.map((x) => x.login).sort()).toEqual([
      `${P}.ALVO`,
      `${P}.ALVO2`,
      `${P}.ALVO3`,
      `${P}.GESTOR`,
    ]);
    expect(l.total).toBe(4);
    expect(l.itens.find((x) => x.login === `${P}.ALVO`)?.grupo).toBe(`${P}-PERFIL`);
    const f = await fonte.fichaUsuario(c, `${P}.ALVO`, false);
    expect(f).toMatchObject({
      id: m.alvo,
      cpfInformado: true,
      cpf: null,
      grupo: `${P}-PERFIL`,
      bloqueado: false,
    });
    expect((await fonte.fichaUsuario(c, `${P}.ALVO`, false, { cpf: true }))?.cpf).toBe(CPF);
    expect(await fonte.fichaUsuario({ ...c, hospital: `${P}B` }, `${P}.ALVO`, false)).toBeNull();
    const cpf = await fonte.painelCpf(c);
    // CPF único no banco (uq_usuario_cpf): nenhum login repetido; sem CPF, só as contas com a dispensa registrada.
    expect(cpf.duplicadas.filter((x) => x.login.startsWith(`${P}.`))).toHaveLength(0);
    expect(
      cpf.semCpf
        .filter((x) => x.login.startsWith(`${P}.`))
        .map((x) => x.login)
        .sort(),
    ).toEqual([`${P}.ALVO2`, `${P}.ALVO3`, `${P}.GESTOR`]);
    expect(JSON.stringify(cpf)).not.toContain(CPF);
    expect((await fonte.contasDoCpf(c, CPF)).map((x) => x.login)).toEqual([`${P}.ALVO`]);
    expect(fonte.redeDoAcesso(c).estabelecimentos.some((e) => e.codigo === P)).toBe(true);
    expect((await fonte.grupos(c)).some((g) => g.nome === `${P}-PERFIL` && g.usuariosAtivos === 1)).toBe(
      true,
    );
    expect((await fonte.estrutura(c)).hospital?.nome).toBe(`ESTAB ${P} SINTETICO`);
    expect(await fonte.pacientesDoProntuario(c, 9_020_500)).toEqual([m.paciente]);
    const hoje = await fonte.hoje(c);
    const fim = new Date(Date.parse(`${hoje}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);
    const ex = await fonte.exclusoes(c, '2020-01-01', fim);
    expect(ex.tipos).toEqual([{ chave: 'atendimento', rotulo: 'Atendimento', quantidade: 1 }]);
    const reg = await fonte.registrosExclusao(
      c,
      { chave: 'atendimento', rotulo: 'Atendimento', comUsuario: true },
      {
        inicio: '2020-01-01',
        fimExclusivo: fim,
        pagina: 1,
        porPagina: 10,
      },
    );
    expect(reg).toHaveLength(1);
    expect((await fonte.quebras(c)).map((q) => q.login)).toEqual([`${P}.ALVO`]);
    // As demais leituras respondem sem erro (SQL conferido contra o modelo).
    const filtro = { hospital: P, inicio: '2020-01-01', fimExclusivo: fim, limite: 10 };
    const r = await Promise.all([
      fonte.opcoesEscopo(c),
      fonte.setores(c, `${P}.ALVO`),
      fonte.arvore(c),
      fonte.opcoesDoGrupo(c, `${P}-PERFIL`),
      fonte.opcoesDoPapel(c, 1),
      fonte.papeis(c),
      fonte.politica(c),
      fonte.tiposAcessoProntuario(c),
      fonte.termoVigente(c),
      fonte.versoesTermo(c),
      fonte.leitos(c),
      fonte.locaisComplementos(c),
      fonte.alertas(c),
      fonte.email(c),
      fonte.fiscais(c),
      fonte.backup(c),
      fonte.trilha(c, filtro),
      fonte.acessosProntuario(c, filtro),
      fonte.conexoes(c, { inicio: '2020-01-01', fimExclusivo: fim, pagina: 1, porPagina: 10 }),
      fonte.pedidos(c),
    ]);
    console.info(`[02-05] ${r.length} leituras sem erro; ${l.total} usuários do estabelecimento sintético`);
  });

  it('bloquear e desbloquear: situação, versão e trilha; a si mesmo, repetido e outro estabelecimento recusados', async () => {
    const antes = await ler<{ versao: number }>('SELECT versao FROM usuario WHERE id = ?', [m.alvo]);
    expect(
      await codigo(fonte.executar('acesso.bloquearUsuario', { login: `${P}.ALVO` }, ctxG(m.gestor))),
    ).toBe('gravou');
    const depois = await ler<{ versao: number; situacao: string }>(
      'SELECT versao, situacao FROM usuario WHERE id = ?',
      [m.alvo],
    );
    expect(depois.situacao).toBe('bloqueado');
    expect(Number(depois.versao)).toBe(Number(antes.versao) + 1);
    const tr = await ler<{ n: number }>(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'usuario' AND entidade_id = ? AND estabelecimento_id = ?",
      [m.alvo, m.est],
    );
    expect(Number(tr.n)).toBeGreaterThan(0);
    expect(
      await codigo(fonte.executar('acesso.bloquearUsuario', { login: `${P}.ALVO` }, ctxG(m.gestor))),
    ).toBe('ja-bloqueado');
    expect(
      await codigo(fonte.executar('acesso.bloquearUsuario', { login: `${P}.GESTOR` }, ctxG(m.gestor))),
    ).toBe('a-si-mesmo');
    expect(
      await codigo(
        fonte.executar('acesso.bloquearUsuario', { login: `${P}.ALVO2` }, ctxG(m.gestor, `${P}B`)),
      ),
    ).toBe('usuario-inexistente');
    expect(
      await codigo(fonte.executar('acesso.desbloquearUsuario', { login: `${P}.ALVO` }, ctxG(m.gestor))),
    ).toBe('gravou');
    expect((await fonte.fichaUsuario(c, `${P}.ALVO`, false))?.bloqueado).toBe(false);
    expect(fonte.receita('acesso.criarUsuario').ligada).toBe(false);
    expect(await codigo(fonte.executar('acesso.criarUsuario', {}, ctxG(m.gestor)))).toBe('operacao-pendente');
  });

  it('o bloqueio é da conta: exige permissão em todos os estabelecimentos do vínculo e confere o último gestor em cada um', async () => {
    const motivo = 'Desligamento sintetico L0205';
    const bloquear = () =>
      fonte.executar('acesso.bloquearUsuario', { login: `${P}.ALVO3`, motivo }, ctxG(m.gestor));
    // O gestor não tem permissão no segundo estabelecimento do vínculo do alvo.
    expect(await codigo(bloquear())).toBe('exige-gestao-da-rede');
    const perfil = (u: number, p: number) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-02-05' }, (e) =>
        e.inserir(
          'INSERT INTO usuario_perfil (usuario_id, perfil_acesso_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?, ?)',
          [u, p, m.outro, '2020-01-01', new Date()],
        ),
      );
    await perfil(m.gestor, m.administrador);
    // Agora pode, mas o alvo é o único gestor de acessos do segundo estabelecimento.
    const concessao = await perfil(m.alvo3, m.gestorAcessos);
    expect(await codigo(bloquear())).toBe('ultimo-gestor-acessos');
    expect(
      (await ler<{ situacao: string }>('SELECT situacao FROM usuario WHERE id = ?', [m.alvo3])).situacao,
    ).toBe('ativo');
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-02-05' }, (e) =>
      e.executar('DELETE FROM usuario_perfil WHERE id = ?', [concessao]),
    );
    expect(await codigo(bloquear())).toBe('gravou');
    expect(
      (await ler<{ situacao: string }>('SELECT situacao FROM usuario WHERE id = ?', [m.alvo3])).situacao,
    ).toBe('bloqueado');
    // A mesma conta aparece bloqueada no outro estabelecimento (uma conta só).
    expect((await fonte.fichaUsuario({ ...c, hospital: `${P}B` }, `${P}.ALVO3`, false))?.bloqueado).toBe(
      true,
    );
    const tr = await ler<{ motivo: string }>(
      "SELECT motivo FROM trilha_auditoria WHERE entidade = 'usuario' AND entidade_id = ? ORDER BY id DESC LIMIT 1",
      [m.alvo3],
    );
    expect(tr.motivo).toBe(motivo);
    const ob = await ler<{ n: number }>(
      "SELECT COUNT(*) AS n FROM integracao_mensagem WHERE ponto = 'acesso.usuario.bloqueado' AND entidade = 'usuario' AND entidade_id = ?",
      [m.alvo3],
    );
    expect(Number(ob.n)).toBeGreaterThan(0);
  });

  it('setor: conceder e retirar em usuario_escopo, com trilha e outbox; repetição e outro estabelecimento recusados', async () => {
    const pedido = (bloco: string, idUsuario = m.alvo, login = `${P}.ALVO`, hospital = P) => ({
      rede: 'rede-sint',
      hospital,
      idUsuario,
      login,
      bloco,
      por: `${P}.GESTOR`,
    });
    const tt = () => ({ ...t, correlacao: `t0205-${randomUUID()}` });
    const setor = (p: ReturnType<typeof pedido>, acao: 'conceder' | 'retirar', cc = c) =>
      fonte.setor(cc, p, acao, tt());
    expect(await codigo(setor(pedido(`${P}B1`), 'conceder'))).toBe('gravou');
    const linha = await ler<{ id: number; versao: number; pode_operar: number }>(
      'SELECT id, versao, pode_operar FROM usuario_escopo WHERE usuario_id = ? AND estabelecimento_id = ?',
      [m.alvo, m.est],
    );
    expect(Number(linha.versao)).toBe(1);
    expect(Number(linha.pode_operar)).toBe(1);
    expect((await fonte.setores(c, `${P}.ALVO`)).map((x) => x.valor)).toEqual([`${P}B1`]);
    const tr = await ler<{ n: number }>(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'usuario_escopo' AND entidade_id = ? AND estabelecimento_id = ?",
      [linha.id, m.est],
    );
    expect(Number(tr.n)).toBe(1);
    const ob = await ler<{ n: number }>(
      "SELECT COUNT(*) AS n FROM integracao_mensagem WHERE ponto = 'acesso.usuario.setor_concedido' AND entidade_id = ?",
      [linha.id],
    );
    expect(Number(ob.n)).toBe(1);
    expect(await codigo(setor(pedido(`${P}B1`), 'conceder'))).toBe('ja-concedido');
    // Bloco de outro estabelecimento não existe para a sessão; usuário sem vínculo com o estabelecimento também não.
    expect(await codigo(setor(pedido(`${P}B2`), 'conceder'))).toBe('valor-inexistente');
    expect(
      await codigo(
        setor(pedido(`${P}B2`, m.alvo2, `${P}.ALVO2`, `${P}B`), 'conceder', { ...c, hospital: `${P}B` }),
      ),
    ).toBe('usuario-inexistente');
    expect(await codigo(setor(pedido(`${P}B1`), 'retirar'))).toBe('gravou');
    expect(await ler('SELECT id FROM usuario_escopo WHERE id = ?', [linha.id])).toBeNull();
    const ob2 = await ler<{ n: number }>(
      "SELECT COUNT(*) AS n FROM integracao_mensagem WHERE ponto = 'acesso.usuario.setor_retirado' AND entidade_id = ?",
      [linha.id],
    );
    expect(Number(ob2.n)).toBe(1);
    expect(await codigo(setor(pedido(`${P}B1`), 'retirar'))).toBe('nao-concedido');
  });

  it('termo de uso: publicar, conflito pela versão lida, aceitar uma vez só, segunda versão fecha a anterior', async () => {
    const r = await fonte.executar(
      'acesso.publicarTermo',
      { termoAnterior: null, texto: 'TERMO SINTETICO L0205 v1', motivo: 'Primeira versao sintetica' },
      { ...ctxG(m.gestor), reautenticadoEm: Date.now() },
    );
    const id = Number(r['id']);
    const v = await ler<{ hash_texto: string; estabelecimento_id: number }>(
      'SELECT hash_texto, estabelecimento_id FROM termo_uso_versao WHERE id = ?',
      [id],
    );
    expect(v.hash_texto).toMatch(/^[0-9a-f]{64}$/);
    expect(Number(v.estabelecimento_id)).toBe(m.est);
    expect(
      await codigo(
        fonte.executar(
          'acesso.publicarTermo',
          { termoAnterior: null, texto: 'outro', motivo: 'Conflito sintetico' },
          { ...ctxG(m.gestor), reautenticadoEm: Date.now() },
        ),
      ),
    ).toBe('termo-desatualizado');
    expect(await codigo(fonte.executar('acesso.aceitarTermo', { termo: id }, ctxG(m.alvo)))).toBe('gravou');
    expect(await codigo(fonte.executar('acesso.aceitarTermo', { termo: id }, ctxG(m.alvo)))).toBe(
      'ja-aceito',
    );
    expect((await fonte.termoVigente(c))?.aceites).toBe(1);
    expect(await fonte.termoAceito(c, `${P}.ALVO`, id)).toBe(true);
    expect((await fonte.versoesTermo(c)).find((x) => x.id === id)?.vigente).toBe(true);
    // Sem motivo: entrada inválida, nada gravado.
    expect(
      await codigo(
        fonte.executar(
          'acesso.publicarTermo',
          { termoAnterior: id, texto: 'v2' },
          { ...ctxG(m.gestor), reautenticadoEm: Date.now() },
        ),
      ),
    ).not.toBe('gravou');
    const antes = await ler<{ versao: number }>('SELECT versao FROM termo_uso_versao WHERE id = ?', [id]);
    const motivo = 'Segunda versao sintetica L0205';
    const r2 = await fonte.executar(
      'acesso.publicarTermo',
      { termoAnterior: id, texto: 'TERMO SINTETICO L0205 v2', motivo },
      { ...ctxG(m.gestor), reautenticadoEm: Date.now() },
    );
    const id2 = Number(r2['id']);
    const velha = await ler<{ versao: number; vigencia_fim: Date | null }>(
      'SELECT versao, vigencia_fim FROM termo_uso_versao WHERE id = ?',
      [id],
    );
    expect(Number(velha.versao)).toBe(Number(antes.versao) + 1);
    expect(velha.vigencia_fim).not.toBeNull();
    const nova = await ler<{ numero_versao: string; estabelecimento_id: number }>(
      'SELECT numero_versao, estabelecimento_id FROM termo_uso_versao WHERE id = ?',
      [id2],
    );
    expect(nova).toMatchObject({ numero_versao: '2' });
    expect(Number(nova.estabelecimento_id)).toBe(m.est);
    const tr = await ler<{ motivo: string }>(
      "SELECT motivo FROM trilha_auditoria WHERE entidade = 'termo_uso_versao' AND entidade_id = ? ORDER BY id DESC LIMIT 1",
      [id2],
    );
    expect(tr.motivo).toBe(motivo);
    const ob = await ler<{ n: number }>(
      "SELECT COUNT(*) AS n FROM integracao_mensagem WHERE ponto = 'acesso.termo.publicado' AND entidade_id = ?",
      [id2],
    );
    expect(Number(ob.n)).toBe(1);
    // A tela que ainda mostra a v1 recebe conflito; a vigente agora é a v2, sem aceites.
    expect(
      await codigo(
        fonte.executar(
          'acesso.publicarTermo',
          { termoAnterior: id, texto: 'v3 sintetica', motivo },
          { ...ctxG(m.gestor), reautenticadoEm: Date.now() },
        ),
      ),
    ).toBe('termo-desatualizado');
    expect(await fonte.termoVigente(c)).toMatchObject({ id: id2, aceites: 0 });
    expect((await fonte.versoesTermo(c)).find((x) => x.id === id)?.vigente).toBe(false);
  });

  it('pedido do titular: protocolo, histórico, transição conferida e outro estabelecimento sem acesso', async () => {
    const novo = {
      rede: 'rede-sint',
      hospital: P,
      prontuario: 9_020_500,
      tipo: 'acesso',
      canal: 'presencial',
      descricao: 'SINTETICO',
      por: `${P}.GESTOR`,
      prazoDias: 15,
      usuario: m.gestor,
    };
    const r = await fonte.registrarPedido(c, { ...novo, chave: `t0205-${randomUUID()}` }, t);
    expect(r.protocolo).toMatch(/^LGPD-\d+$/);
    const h = await ler<{ n: number }>(
      'SELECT COUNT(*) AS n FROM pedido_titular_historico WHERE pedido_titular_id = ?',
      [Number(r.id)],
    );
    expect(Number(h.n)).toBe(1);
    expect(
      await codigo(fonte.registrarPedido(c, { ...novo, canal: 'outro', chave: `t0205-${randomUUID()}` }, t)),
    ).toBe('canal-indisponivel');
    const decisao = (acao: 'confirmar-identidade' | 'negar', conferir = () => null as string | null) => ({
      id: r.id,
      acao,
      fundamento: acao === 'negar' ? 'obrigacao-legal' : null,
      resposta: null,
      por: `${P}.GESTOR`,
      usuario: m.gestor,
      chave: `t0205-${randomUUID()}`,
      conferir,
    });
    expect((await fonte.tratarPedido(c, decisao('confirmar-identidade'), t)).situacao).toBe(
      'identidade-verificada',
    );
    expect(
      await codigo(
        fonte.tratarPedido(
          c,
          decisao('negar', () => 'recusado pela regra'),
          t,
        ),
      ),
    ).toBe('transicao-recusada');
    expect(await codigo(fonte.tratarPedido({ ...c, hospital: `${P}B` }, decisao('negar'), t))).toBe(
      'pedido-inexistente',
    );
    expect((await fonte.tratarPedido(c, decisao('negar'), t)).situacao).toBe('negado');
    const p = (await fonte.pedidos(c)).find((x) => x.id === r.id)!;
    expect(p).toMatchObject({
      situacao: 'negado',
      fundamento: 'obrigacao-legal',
      identidadeVerificada: true,
      decididoPor: `${P}.GESTOR`,
    });
    // Atender: resposta, data, responsável, versão, histórico, trilha e outbox.
    const r2 = await fonte.registrarPedido(c, { ...novo, chave: `t0205-${randomUUID()}` }, t);
    const id2 = Number(r2.id);
    const tratar = (acao: 'confirmar-identidade' | 'atender') =>
      fonte.tratarPedido(
        c,
        {
          ...decisao('confirmar-identidade'),
          id: r2.id,
          acao,
          resposta: acao === 'atender' ? 'RESPOSTA SINTETICA' : null,
        },
        t,
      );
    await tratar('confirmar-identidade');
    expect((await tratar('atender')).situacao).toBe('atendido');
    const l = await ler<{
      situacao: string;
      versao: number;
      resposta: string;
      respondido_em: Date | null;
      responsavel_usuario_id: number;
    }>(
      'SELECT situacao, versao, resposta, respondido_em, responsavel_usuario_id FROM pedido_titular WHERE id = ?',
      [id2],
    );
    expect(l).toMatchObject({ situacao: 'atendido', resposta: 'RESPOSTA SINTETICA' });
    expect(Number(l.versao)).toBe(3);
    expect(l.respondido_em).not.toBeNull();
    expect(Number(l.responsavel_usuario_id)).toBe(m.gestor);
    const hist = await ler<{ n: number }>(
      'SELECT COUNT(*) AS n FROM pedido_titular_historico WHERE pedido_titular_id = ?',
      [id2],
    );
    expect(Number(hist.n)).toBe(3);
    const tr = await ler<{ n: number }>(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'pedido_titular' AND entidade_id = ?",
      [id2],
    );
    expect(Number(tr.n)).toBe(3);
    const ob = await ler<{ n: number }>(
      "SELECT COUNT(*) AS n FROM integracao_mensagem WHERE ponto = 'auditoria.pedido_titular.tratado' AND entidade_id = ?",
      [id2],
    );
    expect(Number(ob.n)).toBe(2);
    // Pedido que o modelo aceita e o contrato ainda não (oposição, titular sem cadastro de paciente): lido sem sentinela.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-02-05' }, (e) =>
      e.inserir(
        `INSERT INTO pedido_titular (estabelecimento_id, numero, titular_nome, tipo, canal_recebimento, descricao, recebido_em, prazo_em, criado_em)
         VALUES (?, ?, 'TITULAR SINTETICO', 'oposicao', 'portal', 'SINTETICO', ?, ?, ?)`,
        [m.est, `${P}-OPOSICAO`, new Date(), '2030-01-01', new Date()],
      ),
    );
    const op = (await fonte.pedidos(c)).find((x) => x.protocolo === `${P}-OPOSICAO`)!;
    expect(op).toMatchObject({ tipo: 'oposicao', idPaciente: null, situacao: 'aberto', fundamento: null });
  });

  it('revisão da quebra de vidro: uma por acesso, nunca do próprio', async () => {
    const id = String(m.emergencia);
    expect(
      await codigo(
        fonte.revisarQuebra(
          c,
          { idEmergencia: id, idUsuario: m.alvo, login: `${P}.ALVO`, classificacao: 'justificado' },
          t,
        ),
      ),
    ).toBe('a-si-mesmo');
    expect(
      await codigo(
        fonte.revisarQuebra(
          c,
          { idEmergencia: id, idUsuario: m.gestor, login: `${P}.GESTOR`, classificacao: 'justificado' },
          t,
        ),
      ),
    ).toBe('gravou');
    expect(
      await codigo(
        fonte.revisarQuebra(
          c,
          { idEmergencia: id, idUsuario: m.gestor, login: `${P}.GESTOR`, classificacao: 'nao-justificado' },
          t,
        ),
      ),
    ).toBe('ja-revisado');
    expect((await fonte.quebras(c))[0]?.revisao).toMatchObject({
      classificacao: 'justificado',
      por: `${P}.GESTOR`,
    });
    const rev = await ler<{ id: number }>(
      'SELECT id FROM revisao_acesso_emergencial WHERE acesso_emergencial_id = ?',
      [m.emergencia],
    );
    const ob = await ler<{ n: number }>(
      "SELECT COUNT(*) AS n FROM integracao_mensagem WHERE ponto = 'acesso.emergencia.revisada' AND entidade_id = ?",
      [rev.id],
    );
    expect(Number(ob.n)).toBe(1);
    // Do outro estabelecimento, o acesso de emergência não existe.
    expect(
      await codigo(
        fonte.revisarQuebra(
          { ...c, hospital: `${P}B` },
          { idEmergencia: id, idUsuario: m.gestor, login: `${P}.GESTOR`, classificacao: 'nao-justificado' },
          t,
        ),
      ),
    ).toBe('emergencia-inexistente');
  });
});
