// Integração das portas próprias do centro cirúrgico (lote 03-01) no cliente f22_o3 (onda 3), com massa SINTÉTICA
// (códigos "C0301"; nenhuma pessoa real): contrato de efeito do agendamento, da remarcação, do cancelamento, da
// permissão da sala e da gravação direta (solicitação, pendência e andamento) — linhas, versão, histórico e trilha —,
// as recusas (sala ocupada, versão vista, entrada inválida, outro estabelecimento, operação pendente do modelo) e as
// leituras da anestesia e do bloco seguro (gravações destas recusam com modelo-pendente, sem gravar nada). Também: as
// regras de horário do domínio sob a trava da sala (passado, mesmo horário, vedado, duração mínima, preparo da sala),
// duas marcações concorrentes, o andamento confirmado → em sala → realizado com o estado e a versão vistos, a chave de
// idempotência da requisição na gravação direta e a trilha pela tabela real.
import { randomUUID } from 'node:crypto';
import { MOTIVOS_CANCELAMENTO_CIRURGIA } from '@sgh/contratos';
import { type ContextoOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { PortaAnestesiaPropria } from './anestesia-porta-propria.js';
import { PortaBlocoSeguroPropria } from './bloco-seguro-porta-propria.js';
import { PortaCirurgiaPropria } from './porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'C0301';
const MOTIVO = MOTIVOS_CANCELAMENTO_CIRURGIA[0]!.codigo;

interface Massa {
  est: number;
  outro: number;
  usuario: number;
  login: string;
  sala: number;
  salaOutro: number;
  paciente: number;
  cirurgiao: number;
  anestesista: number;
  convenio: number;
  carater: number;
  anestesia: number;
  procedimento: number;
}

const nucleo = new NucleoProprio();
let m: Massa;
let porta: PortaCirurgiaPropria;
const ctx = (est: number): ContextoPortaM18 => ({
  cliente: CLIENTE,
  estabelecimento: est,
  usuario: m.usuario,
  correlacao: 'teste-03-01',
});
const op = (est: number): ContextoOperacao => ({ ...ctx(est), chaveIdempotencia: `t0301-${randomUUID()}` });

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

async function limpar(e: Escritor, ests: readonly number[]) {
  const em = ests.map(() => '?').join(', ');
  const ags = `SELECT id FROM agendamento_cirurgico WHERE estabelecimento_id IN (${em})`;
  await e.executar(`DELETE FROM reagendamento_cirurgico WHERE agendamento_cirurgico_id IN (${ags})`, ests);
  await e.executar(
    `DELETE FROM pendencia_agendamento_cirurgico WHERE agendamento_cirurgico_id IN (${ags})`,
    ests,
  );
  await e.executar(
    `DELETE FROM agendamento_cirurgico_equipe WHERE agendamento_cirurgico_id IN (${ags})`,
    ests,
  );
  await e.executar(
    `DELETE FROM agendamento_cirurgico_procedimento WHERE agendamento_cirurgico_id IN (${ags})`,
    ests,
  );
  await e.executar(`DELETE FROM agendamento_cirurgico WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(
    `DELETE sp FROM sala_cirurgica_procedimento sp JOIN sala_cirurgica s ON s.id = sp.sala_cirurgica_id WHERE s.estabelecimento_id IN (${em})`,
    ests,
  );
  await e.executar(
    `UPDATE sala_cirurgica SET tempo_preparo_minutos = 0, tempo_minimo_minutos = NULL, intervalo_minimo_minutos = NULL WHERE estabelecimento_id IN (${em})`,
    ests,
  );
  await e.executar(
    `DELETE ps FROM permissao_sala_usuario ps JOIN sala_cirurgica s ON s.id = ps.sala_cirurgica_id WHERE s.estabelecimento_id IN (${em})`,
    ests,
  );
}

beforeAll(async () => {
  if (SEM_BANCO) return;
  m = await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-03-01' }, async (e) => {
    const agora = new Date();
    const g = (sel: string, p: unknown[], ins: string, pi: unknown[]) => garantir(e, sel, p, ins, pi);
    const cad = (tabela: string, codigo: string, extra: Record<string, unknown> = {}) => {
      const ks = Object.keys(extra);
      return g(
        `SELECT id FROM ${tabela} WHERE codigo = ?`,
        [codigo],
        `INSERT INTO ${tabela} (codigo, descricao${ks.map((k) => `, ${k}`).join('')}, criado_em) VALUES (?, ?${ks.map(() => ', ?').join('')}, ?)`,
        [codigo, `${codigo} ${P}`, ...ks.map((k) => extra[k]), agora],
      );
    };
    const estab = (cod: string) =>
      g(
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [cod],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [cod, 'ESTAB SINTETICO BLOCO', 'ESTAB SINTETICO BLOCO', agora],
      );
    const est = await estab(P);
    const outro = await estab(`${P}X`);
    await limpar(e, [est, outro]);
    const login = 'c0301.teste';
    const usuario = await g(
      'SELECT id FROM usuario WHERE login = ?',
      [login],
      "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
      [login, `USUARIO SINTETICO ${P}`, agora],
    );
    const sala = async (estId: number) => {
      const ua = await g(
        'SELECT id FROM unidade_assistencial WHERE estabelecimento_id = ? AND codigo = ?',
        [estId, 'CC1'],
        "INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em) VALUES (?, 'CC1', 'BLOCO SINTETICO', 'centro_cirurgico', ?)",
        [estId, agora],
      );
      const uc = await g(
        'SELECT id FROM unidade_cirurgica WHERE unidade_assistencial_id = ?',
        [ua],
        'INSERT INTO unidade_cirurgica (estabelecimento_id, unidade_assistencial_id, funciona_24_horas, criado_em) VALUES (?, ?, TRUE, ?)',
        [estId, ua, agora],
      );
      return g(
        'SELECT id FROM sala_cirurgica WHERE estabelecimento_id = ? AND codigo = ?',
        [estId, 'S1'],
        "INSERT INTO sala_cirurgica (estabelecimento_id, unidade_cirurgica_id, codigo, descricao, situacao, criado_em) VALUES (?, ?, 'S1', 'SALA SINTETICA 1', 'ativa', ?)",
        [estId, uc, agora],
      );
    };
    const pessoa = (nome: string) =>
      g(
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [nome],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        [nome, agora],
      );
    const pfPac = await pessoa(`PACIENTE SINTETICO ${P}`);
    const paciente = await g(
      'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
      [pfPac],
      "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, 930301, 'ativo', ?)",
      [pfPac, agora],
    );
    const prof = async (nome: string) => {
      const pf = await pessoa(nome);
      return g(
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pf],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, atua_cirurgiao, atua_anestesista, criado_em) VALUES (?, 'corpo_clinico', TRUE, TRUE, ?)",
        [pf, agora],
      );
    };
    for (const f of ['cirurgiao', 'anestesista', 'auxiliar1', 'instrumentador', 'circulante', 'pediatra'])
      await cad('funcao_equipe_cirurgica', f);
    await cad('motivo_suspensao_cirurgia', MOTIVO, { responsavel: 'administrativo', aplicacao: 'todas' });
    await cad('tipo_pendencia_cirurgica', 'apa');
    await g(
      'SELECT id FROM sequencia_negocio WHERE estabelecimento_id = ? AND tipo = ?',
      [est, 'agendamento_cirurgico'],
      'INSERT INTO sequencia_negocio (estabelecimento_id, tipo, proximo_valor, criado_em) VALUES (?, ?, 1, ?)',
      [est, 'agendamento_cirurgico', agora],
    );
    return {
      est,
      outro,
      usuario,
      login,
      sala: await sala(est),
      salaOutro: await sala(outro),
      paciente,
      cirurgiao: await prof(`CIRURGIAO SINTETICO ${P}`),
      anestesista: await prof(`ANESTESISTA SINTETICO ${P}`),
      convenio: await g(
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [P],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, ?, 'operadora', 'ativa', ?)",
        [P, `OPERADORA ${P}`, agora],
      ),
      carater: await cad('carater_cirurgia', `${P}-ELE`),
      anestesia: await cad('tipo_anestesia', `${P}-GER`),
      procedimento: await cad('procedimento_cirurgico', `${P}-PROC`),
    };
  });
  porta = new PortaCirurgiaPropria(nucleo);
});

afterAll(async () => {
  if (SEM_BANCO) return;
  await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-03-01' }, (e) =>
    limpar(e, [m.est, m.outro]),
  );
  await nucleo.encerrar();
});

const amanha = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const entradaAgendar = (hora: string, extra: Record<string, unknown> = {}) => ({
  sala: m.sala,
  data: amanha(),
  hora,
  duracaoMin: 60,
  paciente: m.paciente,
  reg: 0,
  atendimento: 'I',
  especialidade: 0,
  convenio: m.convenio,
  procedimento: m.procedimento,
  anestesia: m.anestesia,
  equipe: {
    cirurgiao: { id: m.cirurgiao, cod: m.cirurgiao },
    anestesista: { id: m.anestesista, cod: m.anestesista },
  },
  carater: m.carater,
  ...extra,
});
const ler = <T>(sql: string, p: unknown[]) =>
  nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conferencia-03-01' }, (l) =>
    l.consultar(sql, p),
  ) as Promise<T[]>;

describe.skipIf(SEM_BANCO)('porta própria do centro cirúrgico (f22_o3)', () => {
  it('a permissão da sala: incluir grava a linha e a sala fica permitida ao login', async () => {
    await porta.executar(
      ctx(m.est),
      'cirurgia.definirSalaUsuario',
      { sala: m.sala, usuario: m.login, acao: 'incluir' },
      op(m.est),
    );
    const salas = await porta.salas(ctx(m.est), m.login);
    expect(salas.find((s) => s.codigo === m.sala)).toMatchObject({ permitida: true, usuarios: 1 });
    expect((await porta.usuariosDaSala(ctx(m.est), m.sala)).map((u) => u.login)).toEqual([m.login]);
  });

  it('agendar: a linha, o procedimento principal, a equipe pela função, o histórico e a trilha; a leitura do mapa', async () => {
    const r = await porta.executar(ctx(m.est), 'cirurgia.agendarCirurgia', entradaAgendar('0800'), op(m.est));
    const id = Number(r.resultado['agendamento']);
    expect(r.repetida).toBe(false);
    expect(r.trilha).not.toBeNull();
    const [a] = await ler<Record<string, unknown>>(
      'SELECT situacao, versao, sala_cirurgica_id, numero FROM agendamento_cirurgico WHERE id = ?',
      [id],
    );
    expect(a).toMatchObject({ situacao: 'agendado', versao: 1, sala_cirurgica_id: m.sala });
    expect(
      await ler(
        'SELECT procedimento_cirurgico_id FROM agendamento_cirurgico_procedimento WHERE agendamento_cirurgico_id = ? AND principal = TRUE',
        [id],
      ),
    ).toHaveLength(1);
    expect(
      await ler('SELECT id FROM agendamento_cirurgico_equipe WHERE agendamento_cirurgico_id = ?', [id]),
    ).toHaveLength(2);
    expect(
      await ler(
        "SELECT id FROM reagendamento_cirurgico WHERE agendamento_cirurgico_id = ? AND operacao = 'inclusao'",
        [id],
      ),
    ).toHaveLength(1);
    expect(
      await ler(
        "SELECT id FROM trilha_auditoria WHERE entidade = 'agendamento_cirurgico' AND entidade_id = ?",
        [id],
      ),
    ).not.toHaveLength(0);
    const lido = await porta.agendamento(ctx(m.est), id);
    expect(lido).toMatchObject({
      sala: m.sala,
      inicio: `${amanha()} 08:00`,
      duracaoMin: 60,
      procedimento: m.procedimento,
      paciente: `PACIENTE SINTETICO ${P}`,
    });
    expect(lido?.pares['ID_CRM']).toBe(m.cirurgiao);
    expect(lido?.pares['ID_ANEST']).toBe(m.anestesista);
    const { itens } = await porta.agendamentos(ctx(m.est), amanha(), amanha(), [m.sala]);
    expect(itens.map((x) => x.id)).toContain(id);
    expect((await porta.historico(ctx(m.est), m.sala, `${amanha()} 08:00`)).map((h) => h.operacao)).toEqual([
      'A',
    ]);
  });

  it('recusas: sala ocupada, entrada inválida e o mesmo pedido em outro estabelecimento', async () => {
    await expect(
      porta.executar(ctx(m.est), 'cirurgia.agendarCirurgia', entradaAgendar('0830'), op(m.est)),
    ).rejects.toThrow(/sala-ocupada/);
    await expect(
      porta.executar(ctx(m.est), 'cirurgia.agendarCirurgia', { sala: m.sala }, op(m.est)),
    ).rejects.toMatchObject({ problema: { status: 400 } });
    const { itens } = await porta.agendamentos(ctx(m.est), amanha(), amanha(), null);
    const id = itens[0]!.id;
    expect(await porta.estado(ctx(m.outro), id)).toBeNull();
    await expect(
      porta.executar(
        ctx(m.outro),
        'cirurgia.cancelarCirurgia',
        {
          agendamento: id,
          motivo: MOTIVO,
          complemento: 'teste de outro estabelecimento',
          solicitante: 'hospital',
        },
        op(m.outro),
      ),
    ).rejects.toMatchObject({ problema: { status: 404 } });
  });

  it('remarcar: a versão vista diferente recusa; a certa move, sobe a versão e grava o histórico', async () => {
    const { itens } = await porta.agendamentos(ctx(m.est), amanha(), amanha(), null);
    const id = itens[0]!.id;
    const base = {
      agendamento: id,
      sala: m.sala,
      data: amanha(),
      hora: '1000',
      justificativa: 'Troca de horário do teste',
      excecao: null,
    };
    await expect(
      porta.executar(
        ctx(m.est),
        'cirurgia.remarcarCirurgia',
        { ...base, lido: { sala: m.sala, data: amanha(), hora: '0900' } },
        op(m.est),
      ),
    ).rejects.toMatchObject({ problema: { status: 409 } });
    await porta.executar(
      ctx(m.est),
      'cirurgia.remarcarCirurgia',
      { ...base, lido: { sala: m.sala, data: amanha(), hora: '0800' } },
      op(m.est),
    );
    const [a] = await ler<Record<string, unknown>>('SELECT versao FROM agendamento_cirurgico WHERE id = ?', [
      id,
    ]);
    expect(Number(a!['versao'])).toBe(2);
    expect((await porta.agendamento(ctx(m.est), id))?.inicio).toBe(`${amanha()} 10:00`);
  });

  it('cancelar: a situação, o instante e o motivo; a lista de cancelados', async () => {
    const { itens } = await porta.agendamentos(ctx(m.est), amanha(), amanha(), null);
    const id = itens[0]!.id;
    await porta.executar(
      ctx(m.est),
      'cirurgia.cancelarCirurgia',
      {
        agendamento: id,
        motivo: MOTIVO,
        complemento: 'Cancelado pelo teste sintético',
        solicitante: 'hospital',
      },
      op(m.est),
    );
    const [a] = await ler<Record<string, unknown>>(
      'SELECT situacao, cancelado_em, motivo_suspensao_cirurgia_id FROM agendamento_cirurgico WHERE id = ?',
      [id],
    );
    expect(a!['situacao']).toBe('cancelado');
    expect(a!['cancelado_em']).not.toBeNull();
    expect(a!['motivo_suspensao_cirurgia_id']).not.toBeNull();
    const hoje = new Date().toISOString().slice(0, 10);
    expect((await porta.cancelados(ctx(m.est), hoje, amanha())).itens.map((x) => x.id)).toContain(id);
  });

  it('gravação direta: solicitar, a pendência e o andamento, com a trilha na mesma transação', async () => {
    const trilha = {
      estabelecimento: m.est,
      usuario: m.usuario,
      acao: 'inclusao' as const,
      entidade: 'agendamento_cirurgico',
      entidadeId: null,
      correlacao: 'teste-03-01',
    };
    const id = await porta.gravarSgh(ctx(m.est), trilha, (g) =>
      g.solicitar({
        sala: m.sala,
        data: amanha(),
        hora: '1400',
        duracaoMin: 90,
        reg: 0,
        pront: 930301,
        idPaciente: m.paciente,
        procedimento: m.procedimento,
        convenio: m.convenio,
        cirurgiao: m.cirurgiao,
        carater: m.carater,
        anestesia: m.anestesia,
        observacao: null,
        usuario: m.login,
      }),
    );
    expect(await porta.estado(ctx(m.est), id)).toMatchObject({
      estado: 'solicitado',
      agendamento: null,
      pendenciasAbertas: 0,
    });
    await porta.gravarSgh(ctx(m.est), trilha, (g) =>
      g.gravarPendencia({
        idEstado: id,
        idCcagenda: null,
        tipo: 'apa',
        situacao: 'pendente',
        observacao: 'Falta a APA',
        usuario: m.login,
      }),
    );
    expect(await porta.pendencias(ctx(m.est), id)).toMatchObject([{ tipo: 'apa', situacao: 'aberta' }]);
    const visto = await porta.estado(ctx(m.est), id);
    expect(visto).toMatchObject({ estado: 'solicitado', pendenciasAbertas: 1 });
    await porta.gravarSgh(ctx(m.est), trilha, (g) =>
      g.mudarEstado({
        id,
        estado: 'suspenso',
        visto: { estado: 'solicitado', versao: visto!.versao ?? null },
        usuario: m.login,
      }),
    );
    expect(await porta.estado(ctx(m.est), id)).toMatchObject({ estado: 'suspenso' });
    // A versão vista ficou para trás: conflito, sem gravar.
    await expect(
      porta.gravarSgh(ctx(m.est), trilha, (g) =>
        g.mudarEstado({
          id,
          estado: 'solicitado',
          visto: { estado: 'suspenso', versao: visto!.versao ?? null },
          usuario: m.login,
        }),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'conflito-versao' } });
    // A trilha leva a tabela gravada (pendência e agendamento), não o nome passado pela tela.
    const trilhaPend = await ler('SELECT id FROM trilha_auditoria WHERE entidade = ? AND correlacao = ?', [
      'pendencia_agendamento_cirurgico',
      'teste-03-01',
    ]);
    expect(trilhaPend).not.toHaveLength(0);
    await expect(
      porta.gravarSgh(ctx(m.est), trilha, (g) =>
        g.retirarPedidoPortal({ id, acesso: 1, complemento: null, usuario: m.login }),
      ),
    ).rejects.toThrow(/modelo-pendente/);
    await expect(
      porta.gravarSgh(ctx(m.est), trilha, (g) =>
        g.retirarPedidoPortal({ id, acesso: 1, complemento: null, usuario: m.login }),
      ),
    ).rejects.toThrow(/modelo-pendente/);
  });

  it('andamento no banco: confirmado → em sala → realizado; "no bloco" fica indisponível com o motivo; volta proibida', async () => {
    const r = await porta.executar(ctx(m.est), 'cirurgia.agendarCirurgia', entradaAgendar('1800'), op(m.est));
    const id = Number(r.resultado['agendamento']);
    const trilha = {
      estabelecimento: m.est,
      usuario: m.usuario,
      acao: 'alteracao' as const,
      entidade: 'tela',
      entidadeId: id,
      correlacao: 'teste-03-01',
    };
    const e1 = await porta.estado(ctx(m.est), id);
    expect(e1).toMatchObject({ estado: 'confirmado', agendamento: id });
    await expect(
      porta.gravarSgh(ctx(m.est), trilha, (g) =>
        g.mudarEstado({
          id,
          estado: 'no-bloco',
          visto: { estado: 'confirmado', versao: e1!.versao ?? null },
          usuario: m.login,
        }),
      ),
    ).rejects.toThrow(/modelo-pendente/);
    await porta.gravarSgh(ctx(m.est), trilha, (g) =>
      g.mudarEstado({
        id,
        estado: 'em-sala',
        visto: { estado: 'confirmado', versao: e1!.versao ?? null },
        usuario: m.login,
      }),
    );
    const e2 = await porta.estado(ctx(m.est), id);
    expect(e2).toMatchObject({ estado: 'em-sala' });
    await porta.gravarSgh(ctx(m.est), trilha, (g) =>
      g.mudarEstado({
        id,
        estado: 'realizado',
        visto: { estado: 'em-sala', versao: e2!.versao ?? null },
        usuario: m.login,
      }),
    );
    const [a] = await ler<Record<string, unknown>>(
      'SELECT situacao FROM agendamento_cirurgico WHERE id = ?',
      [id],
    );
    expect(a!['situacao']).toBe('realizado');
    await expect(
      porta.gravarSgh(ctx(m.est), trilha, (g) =>
        g.mudarEstado({ id, estado: 'solicitado', usuario: m.login }),
      ),
    ).rejects.toThrow(/estado-invalido/);
    // A trilha da gravação direta é do agendamento (tabela real), mesmo com a entidade "tela" vinda de fora.
    expect(await ler("SELECT id FROM trilha_auditoria WHERE entidade = 'tela'", [])).toHaveLength(0);
    expect(
      await ler(
        "SELECT id FROM trilha_auditoria WHERE entidade = 'agendamento_cirurgico' AND entidade_id = ? AND correlacao = 'teste-03-01'",
        [id],
      ),
    ).not.toHaveLength(0);
  });

  it('a gravação direta com a mesma chave de idempotência não grava de novo', async () => {
    const trilha = {
      estabelecimento: m.est,
      usuario: m.usuario,
      acao: 'inclusao' as const,
      entidade: 'agendamento_cirurgico',
      entidadeId: null,
      correlacao: 'teste-03-01',
    };
    const c = { ...ctx(m.est), chaveIdempotencia: `t0301-${randomUUID()}` };
    const pedir = () =>
      porta.gravarSgh(c, trilha, (g) =>
        g.solicitar({
          sala: m.sala,
          data: amanha(),
          hora: '1500',
          duracaoMin: 60,
          reg: 0,
          pront: 930301,
          idPaciente: m.paciente,
          procedimento: m.procedimento,
          convenio: m.convenio,
          cirurgiao: m.cirurgiao,
          carater: m.carater,
          anestesia: m.anestesia,
          observacao: 'idempotencia',
          usuario: m.login,
        }),
      );
    const a = await pedir();
    const b = await pedir();
    expect(b).toBe(a);
    expect(
      await ler(
        "SELECT id FROM agendamento_cirurgico WHERE estabelecimento_id = ? AND observacao = 'idempotencia'",
        [m.est],
      ),
    ).toHaveLength(1);
  });

  it('regras de horário sob a trava da sala: passado, mesmo horário, vedado, duração mínima e preparo da sala', async () => {
    const ontem = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const agendar = (hora: string, extra: Record<string, unknown> = {}) =>
      porta.executar(ctx(m.est), 'cirurgia.agendarCirurgia', entradaAgendar(hora, extra), op(m.est));
    await expect(agendar('1000', { data: ontem })).rejects.toThrow(/horario-passado/);
    const r = await agendar('2000');
    const id = Number(r.resultado['agendamento']);
    const lido = { sala: m.sala, data: amanha(), hora: '2000' };
    await expect(
      porta.executar(
        ctx(m.est),
        'cirurgia.remarcarCirurgia',
        {
          agendamento: id,
          sala: m.sala,
          data: amanha(),
          hora: '2000',
          justificativa: 'Mesmo horário',
          excecao: null,
          lido,
        },
        op(m.est),
      ),
    ).rejects.toThrow(/mesmo-horario/);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-03-01' }, async (e) => {
      await e.executar(
        'UPDATE sala_cirurgica SET tempo_preparo_minutos = 45, tempo_minimo_minutos = 30 WHERE id = ?',
        [m.sala],
      );
    });
    // 21:00 começa depois do fim (21:00) mas dentro do preparo de 45 min da sala.
    await expect(agendar('2100')).rejects.toThrow(/sala-ocupada/);
    await expect(agendar('2200', { duracaoMin: 20 })).rejects.toThrow(/duracao-abaixo-do-minimo/);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-03-01' }, async (e) => {
      await e.inserir(
        "INSERT INTO sala_cirurgica_procedimento (sala_cirurgica_id, procedimento_cirurgico_id, regra, criado_em) VALUES (?, ?, 'vedado', ?)",
        [m.sala, m.procedimento, new Date()],
      );
    });
    await expect(agendar('2300')).rejects.toThrow(/procedimento-vedado-na-sala/);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-03-01' }, (e) =>
      limpar(e, [m.est, m.outro]),
    );
  });

  it('duas marcações concorrentes na mesma sala e horário: uma grava, a outra recusa (sala travada)', async () => {
    const r = await Promise.allSettled([
      porta.executar(ctx(m.est), 'cirurgia.agendarCirurgia', entradaAgendar('0700'), op(m.est)),
      porta.executar(ctx(m.est), 'cirurgia.agendarCirurgia', entradaAgendar('0700'), op(m.est)),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const recusada = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(String(recusada.reason)).toMatch(/sala-ocupada/);
    const ontem = new Date(Date.now() - 86_400_000);
    expect(
      await ler(
        'SELECT id FROM agendamento_cirurgico WHERE sala_cirurgica_id = ? AND inicio_previsto_em > ?',
        [m.sala, ontem],
      ),
    ).toHaveLength(1);
  });

  it('o registro do ato pela tela fica indisponível com o motivo (modelo pendente), sem gravar', async () => {
    expect(await porta.podeGravar(ctx(m.est), 'cirurgia.registrarCirurgia')).toMatchObject({
      pode: false,
      codigo: 'modelo-pendente',
    });
    await expect(porta.executar(ctx(m.est), 'cirurgia.registrarCirurgia', {}, op(m.est))).rejects.toThrow(
      /modelo-pendente/,
    );
    expect(await porta.podeGravar(ctx(m.est), 'cirurgia.agendarCirurgia')).toMatchObject({ pode: true });
  });

  it('leituras de catálogo: opções, profissionais, procedimentos e paciente', async () => {
    const o = await porta.opcoes(ctx(m.est));
    expect(o.caracteres.map((x) => x.codigo)).toContain(m.carater);
    expect((await porta.nomesProfissionais(ctx(m.est), [m.cirurgiao])).get(m.cirurgiao)).toBe(
      `CIRURGIAO SINTETICO ${P}`,
    );
    expect((await porta.buscarProcedimentos(ctx(m.est), `${P}-PROC`)).map((x) => x.codigo)).toContain(
      m.procedimento,
    );
    expect(await porta.pacientePorProntuario(ctx(m.est), 930301)).toEqual({
      id: m.paciente,
      nome: `PACIENTE SINTETICO ${P}`,
    });
  });
});

describe.skipIf(SEM_BANCO)('portas próprias da anestesia e do bloco seguro (f22_o3)', () => {
  it('lêem do banco e recusam a gravação com o motivo do modelo pendente', async () => {
    const an = new PortaAnestesiaPropria(nucleo);
    const bl = new PortaBlocoSeguroPropria(nucleo);
    const { itens } = await porta.agendamentos(ctx(m.est), amanha(), amanha(), null);
    const id = itens[0]?.id ?? 0;
    expect((await an.dominios(ctx(m.est))).funcoesEquipe.map((f) => f.sigla)).toContain('anestesista');
    expect(await an.ficha(ctx(m.est), id)).toBeNull();
    expect(await an.apas(ctx(m.est), id)).toEqual([]);
    expect(await an.podeGravar()).toMatchObject({ pode: false, codigo: 'modelo-pendente' });
    await expect(an.gravarSgh(ctx(m.est), null, async () => 1)).rejects.toThrow(/modelo-pendente/);
    expect(await bl.checklist(ctx(m.est), id)).toBeNull();
    expect(await bl.movimentos(ctx(m.est), id)).toEqual([]);
    expect(await bl.podeGravar()).toMatchObject({ pode: false, codigo: 'modelo-pendente' });
    await expect(bl.gravarSgh(ctx(m.est), null, async () => 1)).rejects.toThrow(/modelo-pendente/);
  });
});
