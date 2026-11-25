// Contrato de efeito do prontuário de acesso restrito (F8, 03-PEP L93) contra o MariaDB real (cliente de teste). Massa
// SINTÉTICA: estabelecimento com o código do teste, motivo de pedido e um atendimento fictício do médico responsável
// (chaves de catálogo desligadas só no preparo); usuários, profissionais e paciente são ids já existentes do cliente de
// teste (só lidos; a restrição, os pedidos e as autorizações ficam no estabelecimento sintético e a senha criada pelo
// teste é removida na limpeza).
// Prova o que fica no banco: a configuração da unidade; a restrição (e a segunda recusada); o pedido pendente (e o
// duplicado recusado); a decisão por quem não tem alçada e pelo próprio solicitante recusada com 403; a aprovação pelo
// médico responsável cria a autorização com prazo; cada abertura numerada na contagem e na leitura do prontuário, e a
// que passa do limite recusada com 403 sem gravar; a revogação com motivo fecha o acesso; a senha do paciente só em
// resumo com sal, a troca substitui; a senha errada conta e não aprova, a certa aprova pelo paciente; o cancelamento
// pelo solicitante. A leitura normal do prontuário (PortaProntuarioPropria) recusa o restrito sem autorização (403),
// libera o responsável pela restrição e, depois da abertura contada, o autorizado (com o registro confidencial); a
// revogação fecha de novo. A diretoria clínica configurada recusa o médico sem o perfil; a revogação sem alçada é 403;
// o limite fica gravado na autorização (mudar a configuração depois não o altera).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaProntuarioPropria } from './prontuario-porta-propria.js';
import { PortaProntuarioRestritoPropria } from './prontuario-restrito-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const P = 'c2056rest';
/** Código do modelo sintético (o código de modelo é só maiúsculas, números e _). */
const MODELO = 'C2056REST_EVOL';

interface Massa {
  est: number;
  paciente: number;
  motivo: number;
  senhaBase: number;
  a: { id: number; login: string };
  b: { id: number; login: string };
  c: { id: number; login: string };
}

async function limpar(e: Escritor, paciente?: number, senhaBase?: number): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(
      `DELETE x FROM acesso_prontuario_restrito x JOIN autorizacao_acesso_prontuario_restrito a
          ON a.id = x.autorizacao_acesso_prontuario_restrito_id WHERE a.estabelecimento_id IN ${est}`,
      [P],
    );
    await e.executar(`DELETE FROM leitura_prontuario WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(
      `DELETE FROM autorizacao_acesso_prontuario_restrito WHERE estabelecimento_id IN ${est}`,
      [P],
    );
    await e.executar(`DELETE FROM pedido_acesso_prontuario_restrito WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM restricao_prontuario WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM configuracao_prontuario_restrito WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM registro_assistencial WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar('DELETE FROM motivo_acesso_prontuario_restrito WHERE codigo LIKE ?', [`${P}-%`]);
    await e.executar('DELETE FROM modelo_documento_clinico WHERE codigo = ?', [MODELO]);
    if (paciente !== undefined && senhaBase !== undefined)
      await e.executar('DELETE FROM senha_prontuario_paciente WHERE paciente_id = ? AND id > ?', [
        paciente,
        senhaBase,
      ]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('PortaProntuarioRestritoPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaProntuarioRestritoPropria;
  let prontuario: PortaProntuarioPropria;
  let m: Massa;
  let n = 0;
  const ctx = (login: string) => ({
    hospital: P,
    login,
    correlacao: P,
    chaveIdempotencia: `${P}-${Date.now()}-${++n}`,
  });
  const leitor = (u: { id: number }) => ({
    rede: CLIENTE,
    hospital: P,
    cliente: CLIENTE,
    estabelecimento: null,
    usuario: u.id,
    correlacao: P,
  });
  const lerProntuario = (u: { id: number }) => prontuario.listar(leitor(u), m.paciente, {}, 1, 50);
  const configuracao = (x: {
    autorizador?: 'medico_responsavel' | 'diretoria_clinica';
    limiteAcessos?: number | null;
  }) =>
    porta.configurar(ctx(m.b.login), {
      autorizador: x.autorizador ?? 'medico_responsavel',
      validadeHoras: 24,
      exigeSenhaPaciente: false,
      limiteAcessos: x.limiteAcessos === undefined ? 2 : x.limiteAcessos,
      exigeMotivo: true,
      avisaResponsavel: true,
    });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const status = async (p: Promise<unknown>): Promise<string> => {
    try {
      await p;
      return 'ok';
    } catch (e) {
      const x = (e as { problema?: { status?: number; codigo?: string } }).problema;
      if (!x) throw e;
      return `${x.status}:${x.codigo}`;
    }
  };
  const pedidoPendente = async () =>
    (
      await ler<{ id: number; versao: number }>(
        "SELECT id, versao FROM pedido_acesso_prontuario_restrito WHERE paciente_id = ? AND situacao = 'pendente' AND estabelecimento_id = ?",
        [m.paciente, m.est],
      )
    )[0]!;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    porta = new PortaProntuarioRestritoPropria(nucleo, CLIENTE);
    prontuario = new PortaProntuarioPropria(nucleo, CLIENTE);
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const comProf = await e.consultar(
        `SELECT u.id, u.login, MIN(up.profissional_id) AS prof FROM usuario u
           JOIN usuario_profissional up ON up.usuario_id = u.id AND up.excluido_em IS NULL
          WHERE u.excluido_em IS NULL GROUP BY u.id, u.login ORDER BY u.id LIMIT 2`,
      );
      const semProf = await e.uma(
        `SELECT id, login FROM usuario u WHERE excluido_em IS NULL
           AND NOT EXISTS (SELECT 1 FROM usuario_profissional up WHERE up.usuario_id = u.id) ORDER BY id LIMIT 1`,
      );
      const paciente = await e.uma('SELECT MIN(id) AS id FROM paciente WHERE excluido_em IS NULL');
      if (comProf.length < 2 || !semProf || !paciente?.['id'])
        throw new Error(
          'O cliente de teste precisa de dois usuários com profissional, um sem e um paciente.',
        );
      const base = await e.uma('SELECT COALESCE(MAX(id), 0) AS m FROM senha_prontuario_paciente');
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const motivo = await e.inserir(
        `INSERT INTO motivo_acesso_prontuario_restrito (codigo, descricao, tipo, criado_em)
         VALUES (?, 'Interconsulta (sintético)', 'solicitacao', ?)`,
        [`${P}-SOL`, agora],
      );
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        // O médico responsável (usuário B) atende o paciente nesta unidade.
        const atendimento = await e.inserir(
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
             carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em)
           VALUES (?, ?, ?, 999999991, 999999991, 999999991, ?, ?, ?)`,
          [est, `${P}-1`, Number(paciente['id']), Number(comProf[1]!['prof']), agora, agora],
        );
        // Dois registros sintéticos do paciente nesta unidade: um comum e um confidencial.
        const tipo = await e.uma('SELECT MIN(id) AS id FROM tipo_documento_clinico');
        const modelo = await e.inserir(
          `INSERT INTO modelo_documento_clinico (codigo, titulo, tipo_documento_clinico_id, tipo_registro, criado_em)
           VALUES (?, 'Evolução sintética', ?, 'evolucao', ?)`,
          [MODELO, Number(tipo?.['id'] ?? 999999991), agora],
        );
        for (const confidencial of [false, true])
          await e.inserir(
            `INSERT INTO registro_assistencial (estabelecimento_id, paciente_id, atendimento_id, modelo_documento_clinico_id,
               tipo_documento_clinico_id, autor_profissional_id, autor_usuario_id, data_hora_clinica, data_hora_lancamento,
               impressao_digital, texto_consolidado, confidencial, origem, situacao, criado_em)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sistema', 'finalizado', ?)`,
            [
              est,
              Number(paciente['id']),
              atendimento,
              modelo,
              Number(tipo?.['id'] ?? 999999991),
              Number(comProf[1]!['prof']),
              Number(comProf[1]!['id']),
              agora,
              agora,
              '0'.repeat(64),
              `Evolução sintética ${P}`,
              confidencial,
              agora,
            ],
          );
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
      const u = (x: Record<string, unknown>) => ({ id: Number(x['id']), login: String(x['login']) });
      return {
        est,
        paciente: Number(paciente['id']),
        motivo,
        senhaBase: Number(base?.['m'] ?? 0),
        a: u(comProf[0]!),
        b: u(comProf[1]!),
        c: u(semProf),
      };
    });
  });

  afterAll(async () => {
    if (m)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, (e) =>
        limpar(e, m.paciente, m.senhaBase),
      );
    await nucleo?.encerrar?.();
  });

  it('configura a unidade e restringe o prontuário (a segunda restrição recusa)', async () => {
    const cfg = await porta.configurar(ctx(m.b.login), {
      autorizador: 'medico_responsavel',
      validadeHoras: 24,
      exigeSenhaPaciente: false,
      limiteAcessos: 2,
      exigeMotivo: true,
      avisaResponsavel: true,
    });
    const [c] = await ler('SELECT * FROM configuracao_prontuario_restrito WHERE id = ?', [cfg.resultado.id]);
    expect(c).toMatchObject({
      estabelecimento_id: m.est,
      autorizador: 'medico_responsavel',
      limite_acessos: 2,
      criado_por: m.b.id,
    });
    expect(
      await status(
        porta.pedir(ctx(m.a.login), {
          paciente: m.paciente,
          motivo: m.motivo,
          justificativa: 'Interconsulta pedida pela equipe',
        }),
      ),
    ).toBe('409:sem-restricao');
    await porta.restringir(ctx(m.b.login), {
      paciente: m.paciente,
      modo: 'restrito',
      categoria: 'caso_sensivel',
      motivo: 'Caso sensível sintético',
    });
    expect(
      await status(
        porta.restringir(ctx(m.b.login), {
          paciente: m.paciente,
          modo: 'restrito',
          categoria: 'outro',
          motivo: 'Outra vez',
        }),
      ),
    ).toBe('409:ja-restrito');
    const rs = await ler(
      'SELECT ativo, responsavel_usuario_id FROM restricao_prontuario WHERE estabelecimento_id = ?',
      [m.est],
    );
    expect(rs).toEqual([{ ativo: 1, responsavel_usuario_id: m.b.id }]);
    // A leitura normal recusa quem não tem autorização; o responsável pela restrição lê, com o confidencial.
    expect(await status(lerProntuario(m.a))).toBe('403:sem-autorizacao');
    expect(await status(prontuario.resumo(leitor(m.c), m.paciente))).toBe('403:sem-autorizacao');
    expect((await lerProntuario(m.b)).registros).toHaveLength(2);
  });

  it('pedido pendente; duplicado recusa; sem autorização a abertura é 403; sem alçada é 403; o médico responsável aprova', async () => {
    const corpo = {
      paciente: m.paciente,
      motivo: m.motivo,
      justificativa: 'Interconsulta pedida pela equipe',
    };
    await porta.pedir(ctx(m.a.login), corpo);
    expect(await status(porta.pedir(ctx(m.a.login), corpo))).toBe('409:entrada-invalida');
    expect(await status(porta.pedir(ctx(m.c.login), corpo))).toBe('409:usuario-sem-profissional');
    expect(await status(porta.abrir(ctx(m.a.login), { paciente: m.paciente }))).toBe('403:sem-autorizacao');
    const p = await pedidoPendente();
    expect(
      await status(porta.decidir(ctx(m.c.login), { pedido: p.id, versao: p.versao, aprovar: true })),
    ).toBe('403:sem-alcada');
    expect(
      await status(porta.decidir(ctx(m.a.login), { pedido: p.id, versao: p.versao, aprovar: true })),
    ).toBe('403:sem-alcada');
    // Configurada a diretoria clínica, o médico responsável sem o perfil não aprova.
    await configuracao({ autorizador: 'diretoria_clinica' });
    expect(
      await status(porta.decidir(ctx(m.b.login), { pedido: p.id, versao: p.versao, aprovar: true })),
    ).toBe('403:sem-alcada');
    await configuracao({});
    const r = await porta.decidir(ctx(m.b.login), { pedido: p.id, versao: p.versao, aprovar: true });
    expect(r.resultado.situacao).toBe('aprovado');
    // Autorizado, mas ainda sem a abertura contada: a leitura normal orienta a abrir pela autorização.
    expect(await status(lerProntuario(m.a))).toBe('403:abrir-pela-autorizacao');
    const [ped] = await ler(
      `SELECT situacao, decisor_usuario_id, TIMESTAMPDIFF(HOUR, acesso_inicio_em, acesso_fim_em) AS horas
         FROM pedido_acesso_prontuario_restrito WHERE id = ?`,
      [p.id],
    );
    expect(ped).toEqual({ situacao: 'aprovado', decisor_usuario_id: m.b.id, horas: 24 });
    const [aut] = await ler(
      `SELECT autorizado_usuario_id, concedida_por, concedente_usuario_id, senha_conferida, limite_acessos,
              pedido_acesso_prontuario_restrito_id AS pedido FROM autorizacao_acesso_prontuario_restrito WHERE id = ?`,
      [r.resultado.autorizacao],
    );
    expect(aut).toEqual({
      autorizado_usuario_id: m.a.id,
      concedida_por: 'equipe_responsavel',
      concedente_usuario_id: m.b.id,
      senha_conferida: 0,
      limite_acessos: 2,
      pedido: p.id,
    });
  });

  it('conta as aberturas contra o limite; acima dele 403 sem gravar; revogada fecha o acesso', async () => {
    const r1 = await porta.abrir(ctx(m.a.login), { paciente: m.paciente });
    // Aberto pela autorização: a leitura normal libera, com o registro confidencial.
    expect((await lerProntuario(m.a)).registros).toHaveLength(2);
    const r2 = await porta.abrir(ctx(m.a.login), { paciente: m.paciente });
    expect([
      r1.resultado.numero,
      r1.resultado.restantes,
      r2.resultado.numero,
      r2.resultado.restantes,
    ]).toEqual([1, 1, 2, 0]);
    expect(await status(porta.abrir(ctx(m.a.login), { paciente: m.paciente }))).toBe('403:limite-atingido');
    // O limite é o gravado na autorização: a unidade passar a "sem limite" não reabre esta autorização.
    await configuracao({ limiteAcessos: null });
    expect(await status(porta.abrir(ctx(m.a.login), { paciente: m.paciente }))).toBe('403:limite-atingido');
    await configuracao({});
    const acessos = await ler<{ numero_acesso: number; usuario_id: number; tipo_acesso: string }>(
      `SELECT x.numero_acesso, x.usuario_id, l.tipo_acesso FROM acesso_prontuario_restrito x
         JOIN leitura_prontuario l ON l.id = x.leitura_prontuario_id WHERE x.paciente_id = ? AND l.estabelecimento_id = ?
        ORDER BY x.numero_acesso`,
      [m.paciente, m.est],
    );
    expect(acessos).toEqual([
      { numero_acesso: 1, usuario_id: m.a.id, tipo_acesso: 'acesso_restrito_autorizado' },
      { numero_acesso: 2, usuario_id: m.a.id, tipo_acesso: 'acesso_restrito_autorizado' },
    ]);
    const painel = await porta.painel({ hospital: P, login: m.a.login }, m.paciente);
    expect(painel.minha.permitido).toBe(false);
    expect(painel.autorizacoes[0]).toMatchObject({ acessos: 2, limite: 2, vigente: true });
    const a = painel.autorizacoes[0]!;
    // Sem alçada (nem quem concedeu, nem o autorizado, nem a diretoria, nem o médico responsável): 403.
    expect(
      await status(
        porta.revogar(ctx(m.c.login), { autorizacao: a.id, versao: a.versao, motivo: 'sem alçada' }),
      ),
    ).toBe('403:sem-alcada');
    expect(
      await status(porta.revogar(ctx(m.b.login), { autorizacao: a.id, versao: a.versao, motivo: 'curto' })),
    ).toBe('ok');
    const [rev] = await ler(
      `SELECT a.revogada_por_usuario_id, a.motivo_revogacao, p.situacao FROM autorizacao_acesso_prontuario_restrito a
         JOIN pedido_acesso_prontuario_restrito p ON p.id = a.pedido_acesso_prontuario_restrito_id WHERE a.id = ?`,
      [a.id],
    );
    expect(rev).toEqual({ revogada_por_usuario_id: m.b.id, motivo_revogacao: 'curto', situacao: 'revogado' });
    expect(await status(porta.abrir(ctx(m.a.login), { paciente: m.paciente }))).toBe('403:sem-autorizacao');
    expect(await status(lerProntuario(m.a))).toBe('403:sem-autorizacao');
  });

  it('senha do paciente só em resumo com sal; a errada conta e não aprova; a certa aprova pelo paciente', async () => {
    expect(await status(porta.definirSenha(ctx(m.c.login), { paciente: m.paciente, senha: '123456' }))).toBe(
      '409:entrada-invalida',
    );
    await porta.definirSenha(ctx(m.c.login), { paciente: m.paciente, senha: '738291' });
    await porta.definirSenha(ctx(m.c.login), { paciente: m.paciente, senha: '482915' });
    const senhas = await ler<{ situacao: string; senha_resumo: string }>(
      'SELECT situacao, senha_resumo FROM senha_prontuario_paciente WHERE paciente_id = ? AND id > ? ORDER BY id',
      [m.paciente, m.senhaBase],
    );
    expect(senhas.map((s) => s.situacao)).toEqual(['substituida', 'vigente']);
    for (const s of senhas) {
      expect(s.senha_resumo.startsWith('scrypt$')).toBe(true);
      expect(s.senha_resumo).not.toContain('482915');
      expect(s.senha_resumo).not.toContain('738291');
    }
    await porta.pedir(ctx(m.a.login), {
      paciente: m.paciente,
      motivo: m.motivo,
      justificativa: 'Retorno do paciente ao ambulatório',
    });
    let p = await pedidoPendente();
    const errada = await porta.decidir(ctx(m.c.login), {
      pedido: p.id,
      versao: p.versao,
      aprovar: true,
      pelopaciente: true,
      senhaPaciente: '000001',
    });
    expect(errada.resultado.situacao).toBe('senha-recusada');
    const [falha] = await ler(
      "SELECT tentativas_falhas FROM senha_prontuario_paciente WHERE paciente_id = ? AND situacao = 'vigente'",
      [m.paciente],
    );
    expect(falha).toEqual({ tentativas_falhas: 1 });
    p = await pedidoPendente();
    const certa = await porta.decidir(ctx(m.c.login), {
      pedido: p.id,
      versao: p.versao,
      aprovar: true,
      pelopaciente: true,
      senhaPaciente: '482915',
    });
    expect(certa.resultado.situacao).toBe('aprovado');
    const [aut] = await ler(
      'SELECT concedida_por, senha_conferida FROM autorizacao_acesso_prontuario_restrito WHERE id = ?',
      [certa.resultado.autorizacao],
    );
    expect(aut).toEqual({ concedida_por: 'paciente', senha_conferida: 1 });
    const [zerada] = await ler(
      "SELECT tentativas_falhas FROM senha_prontuario_paciente WHERE paciente_id = ? AND situacao = 'vigente'",
      [m.paciente],
    );
    expect(zerada).toEqual({ tentativas_falhas: 0 });
  });

  it('o solicitante cancela o próprio pedido; outro não; nada se apaga', async () => {
    const painel = await porta.painel({ hospital: P, login: m.b.login }, m.paciente);
    const vig = painel.autorizacoes.find((x) => x.vigente)!;
    await porta.revogar(ctx(m.b.login), {
      autorizacao: vig.id,
      versao: vig.versao,
      motivo: 'Fim da interconsulta',
    });
    await porta.pedir(ctx(m.a.login), {
      paciente: m.paciente,
      motivo: m.motivo,
      justificativa: 'Nova revisão do caso clínico',
    });
    const p = await pedidoPendente();
    expect(await status(porta.cancelarPedido(ctx(m.b.login), { pedido: p.id, versao: p.versao }))).toBe(
      '403:sem-alcada',
    );
    await porta.cancelarPedido(ctx(m.a.login), { pedido: p.id, versao: p.versao });
    const todos = await ler<{ situacao: string }>(
      'SELECT situacao FROM pedido_acesso_prontuario_restrito WHERE estabelecimento_id = ? ORDER BY id',
      [m.est],
    );
    expect(todos.map((x) => x.situacao)).toEqual(['revogado', 'revogado', 'cancelado']);
    const fila = await porta.fila({ hospital: P, login: m.b.login });
    expect(fila.pedidos).toEqual([]);
    expect(fila.configuracao).toMatchObject({ limiteAcessos: 2, daUnidade: true });
  });
});
