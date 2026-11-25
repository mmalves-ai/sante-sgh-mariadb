// Integração das portas próprias do centro cirúrgico (lote 03-01) no cliente f22_o3 (onda 3), com massa SINTÉTICA
// (códigos "C0301"; nenhuma pessoa real): contrato de efeito do agendamento, da remarcação, do cancelamento, da
// permissão da sala e da gravação direta (solicitação, pendência e andamento) — linhas, versão, histórico e trilha —,
// as recusas (sala ocupada, versão vista, entrada inválida, outro estabelecimento), o registro do ato cirúrgico (ato,
// procedimentos, equipe, dispositivos) e as gravações da anestesia (APA, ficha, SRPA) e do bloco seguro (checklist e
// rastreio), com o reenvio da mesma chave. Também: as
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
import { PortaGradeSalaPropria } from './grade-sala-propria.js';
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
  atendimento: number;
  especialidade: number;
  modeloChecklist: number;
  local: number;
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
  const atos = `SELECT id FROM ato_cirurgico WHERE estabelecimento_id IN (${em})`;
  const fichas = `SELECT id FROM ficha_anestesica WHERE agendamento_cirurgico_id IN (${ags}) OR ato_cirurgico_id IN (${atos})`;
  const srpas = `SELECT id FROM registro_recuperacao_anestesica WHERE estabelecimento_id IN (${em})`;
  const lists = `SELECT id FROM checklist_cirurgia_segura WHERE agendamento_cirurgico_id IN (${ags}) OR ato_cirurgico_id IN (${atos})`;
  await e.executar(
    `DELETE FROM avaliacao_recuperacao_anestesica WHERE registro_recuperacao_anestesica_id IN (${srpas})`,
    ests,
  );
  await e.executar(`DELETE FROM registro_recuperacao_anestesica WHERE estabelecimento_id IN (${em})`, ests);
  for (const t of ['adendo', 'lacuna', 'passagem', 'marco', 'lancamento'])
    await e.executar(`DELETE FROM ${t}_ficha_anestesica WHERE ficha_anestesica_id IN (${fichas})`, [
      ...ests,
      ...ests,
    ]);
  await e.executar(`DELETE FROM ficha_anestesica WHERE id IN (SELECT id FROM (${fichas}) x)`, [
    ...ests,
    ...ests,
  ]);
  await e.executar(`DELETE FROM avaliacao_pre_anestesica WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(
    `DELETE FROM confirmacao_checklist_cirurgia WHERE checklist_cirurgia_segura_id IN (${lists})`,
    [...ests, ...ests],
  );
  await e.executar(`DELETE FROM checklist_cirurgia_segura WHERE id IN (SELECT id FROM (${lists}) x)`, [
    ...ests,
    ...ests,
  ]);
  await e.executar(`DELETE FROM movimento_paciente_bloco WHERE estabelecimento_id IN (${em})`, ests);
  for (const t of ['ato_cirurgico_dispositivo', 'participante_cirurgia', 'ato_cirurgico_procedimento'])
    await e.executar(`DELETE FROM ${t} WHERE ato_cirurgico_id IN (${atos})`, ests);
  await e.executar(`DELETE FROM ato_cirurgico WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM reagendamento_cirurgico WHERE agendamento_cirurgico_id IN (${ags})`, ests);
  await e.executar(
    `DELETE FROM agendamento_cirurgico_versao WHERE agendamento_cirurgico_id IN (${ags})`,
    ests,
  );
  await e.executar(`DELETE FROM codigo_painel_familia WHERE agendamento_cirurgico_id IN (${ags})`, ests);
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
  await e.executar(
    `DELETE g FROM grade_sala_cirurgica g JOIN sala_cirurgica s ON s.id = g.sala_cirurgica_id WHERE s.estabelecimento_id IN (${em})`,
    ests,
  );
  await e.executar(`DELETE FROM dia_nao_util WHERE estabelecimento_id IN (${em})`, ests);
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
      "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, 930392, 'ativo', ?)",
      [pfPac, agora],
    );
    // A massa de rodadas antigas pode ter ficado com outro prontuário: o caso de leituras procura por 930392.
    await e.executar(
      'UPDATE paciente SET numero_prontuario = 930392 WHERE id = ? AND numero_prontuario <> 930392',
      [paciente],
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
      [est, 'ato_cirurgico'],
      'INSERT INTO sequencia_negocio (estabelecimento_id, tipo, proximo_valor, criado_em) VALUES (?, ?, 1, ?)',
      [est, 'ato_cirurgico', agora],
    );
    await g(
      'SELECT id FROM sequencia_negocio WHERE estabelecimento_id = ? AND tipo = ?',
      [est, 'agendamento_cirurgico'],
      'INSERT INTO sequencia_negocio (estabelecimento_id, tipo, proximo_valor, criado_em) VALUES (?, ?, 1, ?)',
      [est, 'agendamento_cirurgico', agora],
    );
    // Massa do registro do ato, da anestesia e do bloco seguro.
    const cirurgiao = await prof(`CIRURGIAO SINTETICO ${P}`);
    const anestesista = await prof(`ANESTESISTA SINTETICO ${P}`);
    const convenio = await g(
      'SELECT id FROM fonte_pagadora WHERE codigo = ?',
      [P],
      "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, ?, 'operadora', 'ativa', ?)",
      [P, `OPERADORA ${P}`, agora],
    );
    const categoria = await g(
      'SELECT id FROM categoria_atendimento WHERE codigo = ?',
      [`${P}int`],
      "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, 'CATEGORIA SINTETICA', 'internacao', ?)",
      [`${P}int`, agora],
    );
    const caraterTiss = await g(
      'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
      [`${P}c`],
      "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES (?, 'CARATER SINTETICO', 'teste', ?)",
      [`${P}c`, agora],
    );
    const atendimento = await g(
      'SELECT id FROM atendimento WHERE estabelecimento_id = ? AND numero = ?',
      [est, `${P}-AT`],
      `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id, carater_atendimento_tiss_id,
         fonte_pagadora_id, profissional_id, entrada_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [est, `${P}-AT`, paciente, categoria, caraterTiss, convenio, cirurgiao, agora, agora],
    );
    const setor = await g(
      'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = ?',
      [est, `${P}-RPA`],
      "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, 'RECUPERACAO SINTETICA', 'assistencial', ?)",
      [est, `${P}-RPA`, agora],
    );
    await e.executar('UPDATE sala_cirurgica SET setor_funcional_id = ? WHERE estabelecimento_id = ?', [
      setor,
      est,
    ]);
    await g(
      'SELECT id FROM classificacao_asa WHERE classe = 2',
      [],
      "INSERT INTO classificacao_asa (codigo, descricao, classe, rotulo, criado_em) VALUES ('asa2', 'ASA II', 2, 'ASA II', ?)",
      [agora],
    );
    await g(
      "SELECT id FROM porte_cirurgico WHERE sigla = 'P' OR codigo = 'pequeno'",
      [],
      "INSERT INTO porte_cirurgico (codigo, descricao, sigla, criado_em) VALUES ('pequeno', 'PEQUENO', 'P', ?)",
      [agora],
    );
    await g(
      "SELECT id FROM classe_contaminacao_cirurgica WHERE classe = 'limpa'",
      [],
      "INSERT INTO classe_contaminacao_cirurgica (codigo, descricao, classe, criado_em) VALUES ('limpa', 'LIMPA', 'limpa', ?)",
      [agora],
    );
    await g(
      "SELECT id FROM tipo_sinal_monitorado WHERE codigo = 'fc'",
      [],
      "INSERT INTO tipo_sinal_monitorado (codigo, descricao, sigla, criado_em) VALUES ('fc', 'FREQUENCIA CARDIACA', 'FC', ?)",
      [agora],
    );
    const especialidade = await cad('especialidade_medica', `${P}-ESP`);
    const modeloChecklist = await g(
      'SELECT id FROM modelo_checklist_cirurgia WHERE estabelecimento_id = ? AND codigo = ?',
      [est, P],
      "INSERT INTO modelo_checklist_cirurgia (estabelecimento_id, codigo, descricao, numero_versao, tipo, vigencia_inicio, criado_em) VALUES (?, ?, 'CHECKLIST SINTETICO', 1, 'cirurgia_segura', '2020-01-01', ?)",
      [est, P, agora],
    );
    await g(
      "SELECT id FROM item_checklist_cirurgia WHERE modelo_checklist_cirurgia_id = ? AND codigo = 'identidade'",
      [modeloChecklist],
      "INSERT INTO item_checklist_cirurgia (modelo_checklist_cirurgia_id, codigo, momento, pergunta, ordem, criado_em) VALUES (?, 'identidade', 'inducao', 'IDENTIDADE CONFIRMADA?', 1, ?)",
      [modeloChecklist, agora],
    );
    const local = await g(
      'SELECT id FROM local_bloco WHERE codigo = ?',
      [`${P}-REC`],
      "INSERT INTO local_bloco (codigo, descricao, etapa_painel, criado_em) VALUES (?, 'RECEPCAO SINTETICA', 'preparo', ?)",
      [`${P}-REC`, agora],
    );
    await g(
      "SELECT id FROM tipo_movimento_bloco WHERE codigo = 'admissao'",
      [],
      "INSERT INTO tipo_movimento_bloco (codigo, descricao, efeito, criado_em) VALUES ('admissao', 'ENTRADA NO BLOCO', 'admissao', ?)",
      [agora],
    );
    await g(
      'SELECT id FROM usuario_vinculo_profissional WHERE usuario_id = ? AND estabelecimento_id = ?',
      [usuario, est],
      'INSERT INTO usuario_vinculo_profissional (usuario_id, estabelecimento_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?, ?)',
      [usuario, est, anestesista, '2020-01-01', agora],
    );
    return {
      atendimento,
      especialidade,
      modeloChecklist,
      local,
      est,
      outro,
      usuario,
      login,
      sala: await sala(est),
      salaOutro: await sala(outro),
      paciente,
      cirurgiao,
      anestesista,
      convenio,
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
    const r = await porta.executar(
      ctx(m.est),
      'cirurgia.agendarCirurgia',
      entradaAgendar('08:00'),
      op(m.est),
    );
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
      porta.executar(ctx(m.est), 'cirurgia.agendarCirurgia', entradaAgendar('08:30'), op(m.est)),
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
      hora: '10:00',
      justificativa: 'Troca de horário do teste',
      excecao: null,
    };
    await expect(
      porta.executar(
        ctx(m.est),
        'cirurgia.remarcarCirurgia',
        { ...base, lido: { sala: m.sala, data: amanha(), hora: '09:00' } },
        op(m.est),
      ),
    ).rejects.toMatchObject({ problema: { status: 409 } });
    await porta.executar(
      ctx(m.est),
      'cirurgia.remarcarCirurgia',
      { ...base, lido: { sala: m.sala, data: amanha(), hora: '08:00' } },
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
        hora: '14:00',
        duracaoMin: 90,
        reg: 0,
        pront: 930392,
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
    // O pedido interno não é de conta do portal: a retirada pelo portal recusa sem gravar.
    await expect(
      porta.gravarSgh(ctx(m.est), trilha, (g) =>
        g.retirarPedidoPortal({ id, acesso: 1, complemento: null, usuario: m.login }),
      ),
    ).rejects.toThrow(/registro-inexistente/);
  });

  it('pedido do portal do médico externo: a conta e o paciente informado, a alteração com a versão guardada e a retirada', async () => {
    const trilha = {
      estabelecimento: m.est,
      usuario: m.usuario,
      acao: 'inclusao' as const,
      entidade: 'tela',
      entidadeId: 0,
      correlacao: 'teste-08-portal',
    };
    // A conta do portal (sintética) do cirurgião: criada uma vez no cliente de teste.
    const login = `portal.${P.toLowerCase()}@exemplo.invalid`;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'conta-portal-08' }, async (e) => {
      const [pf] = await e.consultar('SELECT pessoa_fisica_id FROM profissional WHERE id = ?', [m.cirurgiao]);
      await e.executar(
        `INSERT INTO conta_portal_profissional_externo (profissional_id, pessoa_fisica_id, login, email, criado_em)
         SELECT ?, ?, ?, ?, NOW(3) FROM DUAL
          WHERE NOT EXISTS (SELECT 1 FROM conta_portal_profissional_externo WHERE login = ?)`,
        [m.cirurgiao, pf!['pessoa_fisica_id'], login, login, login],
      );
    });
    const [conta] = await ler<Record<string, unknown>>(
      'SELECT id FROM conta_portal_profissional_externo WHERE login = ?',
      [login],
    );
    const acesso = Number(conta!['id']);
    const id = await porta.gravarSgh(ctx(m.est), trilha, (g) =>
      g.solicitar({
        sala: m.sala,
        data: amanha(),
        hora: '15:00',
        duracaoMin: 60,
        reg: 0,
        pront: 0,
        idPaciente: null,
        procedimento: m.procedimento,
        convenio: m.convenio,
        cirurgiao: m.cirurgiao,
        carater: m.carater,
        anestesia: m.anestesia,
        observacao: null,
        usuario: m.login,
        portal: { acesso, paciente: `PACIENTE INFORMADO ${P}`, nascimento: '1980-02-03' },
      }),
    );
    const doPortal = await porta.estadosDoPortal(ctx(m.est), acesso, new Date().toISOString().slice(0, 10));
    expect(doPortal.map((x) => x.id)).toContain(id);
    expect(doPortal.find((x) => x.id === id)).toMatchObject({
      estado: 'solicitado',
      idPaciente: null,
      portal: { acesso, paciente: `PACIENTE INFORMADO ${P}`, nascimento: '1980-02-03' },
    });
    const alteracao = {
      id,
      acesso,
      versao: 1,
      sala: m.sala,
      data: amanha(),
      hora: '16:00',
      duracaoMin: 90,
      procedimento: m.procedimento,
      convenio: m.convenio,
      cirurgiao: m.cirurgiao,
      carater: m.carater,
      anestesia: m.anestesia,
      observacao: 'Ajuste de horário',
      paciente: `PACIENTE INFORMADO ${P}`,
      nascimento: '1980-02-03',
      motivo: 'Mudança de horário pedida pela equipe',
      usuario: m.login,
    };
    expect(await porta.gravarSgh(ctx(m.est), trilha, (g) => g.alterarPedidoPortal(alteracao))).toBe(2);
    // A versão vista ficou velha: a segunda alteração com versão 1 recusa.
    await expect(
      porta.gravarSgh(ctx(m.est), trilha, (g) => g.alterarPedidoPortal(alteracao)),
    ).rejects.toThrow(/versao-desatualizada/);
    const versoes = await porta.versoesDosPedidos(ctx(m.est), [id]);
    expect(versoes).toHaveLength(1);
    expect(versoes[0]).toMatchObject({ idEstado: id, versao: 1, duracaoMin: 60, motivo: alteracao.motivo });
    expect(versoes[0]!.inicio.slice(11, 16)).toBe('15:00');
    expect((await porta.estado(ctx(m.est), id))?.duracaoMin).toBe(90);
    // Outra conta não retira; a própria retira e o pedido fica cancelado.
    await expect(
      porta.gravarSgh(ctx(m.est), trilha, (g) =>
        g.retirarPedidoPortal({ id, acesso: acesso + 1, complemento: null, usuario: m.login }),
      ),
    ).rejects.toThrow(/registro-inexistente/);
    await porta.gravarSgh(ctx(m.est), trilha, (g) =>
      g.retirarPedidoPortal({ id, acesso, complemento: 'Paciente desistiu', usuario: m.login }),
    );
    expect(await porta.estado(ctx(m.est), id)).toMatchObject({ estado: 'cancelado' });
  });

  it('andamento no banco: confirmado → no bloco → em sala → realizado; volta proibida', async () => {
    const r = await porta.executar(
      ctx(m.est),
      'cirurgia.agendarCirurgia',
      entradaAgendar('18:00'),
      op(m.est),
    );
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
    await porta.gravarSgh(ctx(m.est), trilha, (g) =>
      g.mudarEstado({
        id,
        estado: 'no-bloco',
        visto: { estado: 'confirmado', versao: e1!.versao ?? null },
        usuario: m.login,
      }),
    );
    const eb = await porta.estado(ctx(m.est), id);
    expect(eb).toMatchObject({ estado: 'no-bloco', agendamento: id });
    await porta.gravarSgh(ctx(m.est), trilha, (g) =>
      g.mudarEstado({
        id,
        estado: 'em-sala',
        visto: { estado: 'no-bloco', versao: eb!.versao ?? null },
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
          hora: '15:00',
          duracaoMin: 60,
          reg: 0,
          pront: 930392,
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
    await expect(agendar('10:00', { data: ontem })).rejects.toThrow(/horario-passado/);
    const r = await agendar('20:00');
    const id = Number(r.resultado['agendamento']);
    const lido = { sala: m.sala, data: amanha(), hora: '20:00' };
    await expect(
      porta.executar(
        ctx(m.est),
        'cirurgia.remarcarCirurgia',
        {
          agendamento: id,
          sala: m.sala,
          data: amanha(),
          hora: '20:00',
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
    await expect(agendar('21:00')).rejects.toThrow(/sala-ocupada/);
    await expect(agendar('22:00', { duracaoMin: 20 })).rejects.toThrow(/duracao-abaixo-do-minimo/);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-03-01' }, async (e) => {
      await e.inserir(
        "INSERT INTO sala_cirurgica_procedimento (sala_cirurgica_id, procedimento_cirurgico_id, regra, criado_em) VALUES (?, ?, 'vedado', ?)",
        [m.sala, m.procedimento, new Date()],
      );
    });
    await expect(agendar('23:00')).rejects.toThrow(/procedimento-vedado-na-sala/);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-03-01' }, (e) =>
      limpar(e, [m.est, m.outro]),
    );
  });

  it('duas marcações concorrentes na mesma sala e horário: uma grava, a outra recusa (sala travada)', async () => {
    const r = await Promise.allSettled([
      porta.executar(ctx(m.est), 'cirurgia.agendarCirurgia', entradaAgendar('07:00'), op(m.est)),
      porta.executar(ctx(m.est), 'cirurgia.agendarCirurgia', entradaAgendar('07:00'), op(m.est)),
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

  it('registrar o ato: ato realizado, procedimentos com especialidade, equipe, dispositivos, ASA e pressão; agendamento uma vez só', async () => {
    const ag = await porta.executar(
      ctx(m.est),
      'cirurgia.agendarCirurgia',
      entradaAgendar('16:00'),
      op(m.est),
    );
    const agendamento = Number(ag.resultado['agendamento']);
    const uso = (usado: boolean, descricao: string | null = null) => ({ usado, descricao });
    const entrada = {
      agendamento,
      reg: m.atendimento,
      data: amanha(),
      sala: m.sala,
      convenio: m.convenio,
      porte: 'P',
      potencialContaminacao: 'L',
      carater: m.carater,
      tipoAnestesia: m.anestesia,
      inicio: '16:10',
      fim: '17:00',
      inicioAnestesia: '16:00',
      fimAnestesia: '17:10',
      cid10: 'K40.9',
      pressao: '120x80',
      pulso: 72,
      supuracao: false,
      usos: {
        tubo: uso(true, 'TUBO 7,5'),
        antimicrobiano: uso(false),
        sonda: uso(false),
        cateter: uso(false),
        puncao: uso(false),
      },
      procedimentos: [
        {
          procedimento: m.procedimento,
          especialidade: m.especialidade,
          tecnica: 1,
          equipe: {
            cirurgiao: { id: m.cirurgiao, cod: m.cirurgiao },
            anestesista: { id: m.anestesista, cod: m.anestesista },
          },
        },
      ],
      extensao: { entradaSala: '15:55', incisao: '16:10', saidaSala: '17:20', asa: 2, observacao: null },
      // Troca de anestesista no meio do ato (F3.4, 04-CC linha 95): o que entrou às 16:30 e o percentual padrão.
      participacao: { anestesista: { entrada: '16:30', saida: null, percentual: null } },
    };
    expect(await porta.podeGravar(ctx(m.est), 'cirurgia.registrarCirurgia')).toMatchObject({ pode: true });
    const r = await porta.executar(ctx(m.est), 'cirurgia.registrarCirurgia', entrada, op(m.est));
    const id = Number(r.resultado['cirurgia']);
    const [ato] = await ler<Record<string, unknown>>(
      `SELECT t.situacao, t.agendamento_cirurgico_id, t.pressao_sistolica, t.pressao_diastolica, t.frequencia_cardiaca,
              ca.classe AS asa, pc.sigla AS porte
         FROM ato_cirurgico t LEFT JOIN classificacao_asa ca ON ca.id = t.classificacao_asa_id
         LEFT JOIN porte_cirurgico pc ON pc.id = t.porte_cirurgico_id WHERE t.id = ?`,
      [id],
    );
    expect(ato).toMatchObject({
      situacao: 'realizado',
      agendamento_cirurgico_id: agendamento,
      pressao_sistolica: 120,
      pressao_diastolica: 80,
      frequencia_cardiaca: 72,
      asa: 2,
      porte: 'P',
    });
    expect(
      await ler(
        'SELECT especialidade_medica_id, principal, tecnica FROM ato_cirurgico_procedimento WHERE ato_cirurgico_id = ?',
        [id],
      ),
    ).toEqual([{ especialidade_medica_id: m.especialidade, principal: 1, tecnica: 'Videolaparoscopia' }]);
    expect(
      await ler(
        `SELECT f.codigo AS funcao, TIMESTAMPDIFF(MINUTE, t.entrada_sala_em, p.entrada_em) AS entrada,
                TIMESTAMPDIFF(MINUTE, t.entrada_sala_em, p.saida_em) AS saida, p.percentual_participacao AS perc
           FROM participante_cirurgia p JOIN funcao_equipe_cirurgica f ON f.id = p.funcao_equipe_cirurgica_id
           JOIN ato_cirurgico t ON t.id = p.ato_cirurgico_id
          WHERE p.ato_cirurgico_id = ? ORDER BY p.sequencia`,
        [id],
      ),
    ).toEqual([
      { funcao: 'cirurgiao', entrada: null, saida: null, perc: '100.0000' },
      { funcao: 'anestesista', entrada: 35, saida: null, perc: null },
    ]);
    // Hora do participante fora do tempo do paciente na sala: recusada antes de gravar.
    await expect(
      porta.executar(
        ctx(m.est),
        'cirurgia.registrarCirurgia',
        {
          ...entrada,
          agendamento: null,
          participacao: { cirurgiao: { entrada: '15:00', saida: null, percentual: null } },
        },
        op(m.est),
      ),
    ).rejects.toThrow(/participacao-invalida/);
    expect(
      await ler('SELECT dispositivo, descricao FROM ato_cirurgico_dispositivo WHERE ato_cirurgico_id = ?', [
        id,
      ]),
    ).toEqual([{ dispositivo: 'tubo', descricao: 'TUBO 7,5' }]);
    expect(
      await ler("SELECT id FROM trilha_auditoria WHERE entidade = 'ato_cirurgico' AND entidade_id = ?", [id]),
    ).not.toHaveLength(0);
    await expect(
      porta.executar(ctx(m.est), 'cirurgia.registrarCirurgia', entrada, op(m.est)),
    ).rejects.toThrow(/agendamento-ja-registrado/);
    await expect(
      porta.executar(
        ctx(m.est),
        'cirurgia.registrarCirurgia',
        { ...entrada, agendamento: null, fim: '16:05' },
        op(m.est),
      ),
    ).rejects.toThrow(/tempos-invalidos/);
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
    expect(await porta.pacientePorProntuario(ctx(m.est), 930392)).toEqual({
      id: m.paciente,
      nome: `PACIENTE SINTETICO ${P}`,
    });
  });
});

describe.skipIf(SEM_BANCO)('portas próprias da anestesia e do bloco seguro (f22_o3)', () => {
  const agendar = async (hora: string) =>
    Number(
      (await porta.executar(ctx(m.est), 'cirurgia.agendarCirurgia', entradaAgendar(hora), op(m.est)))
        .resultado['agendamento'],
    );
  const cirurgia = (agendamento: number) => ({
    agendamento,
    sala: m.sala,
    dataHora: `${amanha()}T18:00`,
    reg: m.atendimento,
    paciente: m.paciente,
  });

  it('APA, ficha e SRPA: gravam pelo Executor, a versão vista trava, o reenvio da chave não grava de novo', async () => {
    const an = new PortaAnestesiaPropria(nucleo);
    const agendamento = await agendar('18:00');
    expect(await an.podeGravar(ctx(m.est))).toMatchObject({ pode: true });
    expect((await an.dominios(ctx(m.est))).funcoesEquipe.map((f) => f.sigla)).toContain('anestesista');
    const apa = {
      ...cirurgia(agendamento),
      versaoVista: 0,
      avaliadoEm: `${amanha()}T07:00`,
      profissional: m.anestesista,
      asa: 2,
      emergencia: false,
      pesoKg: 70,
      alturaCm: 170,
      viaAerea: { mallampati: 2, mobilidadeCervicalReduzida: false },
      jejum: { liquidosClaros: `${amanha()}T05:00`, refeicaoLeve: `${amanha()}T00:00` },
      criteriosLee: ['cirurgia-alto-risco'],
      leePontos: 1,
      alergiasConferidas: true,
      comorbidades: null,
      medicacoes: null,
      exames: null,
      anestesiasAnteriores: null,
      plano: { texto: 'GERAL' },
      tipoAnestesia: m.anestesia,
      conclusao: 'apto-ressalvas',
      ressalvas: null,
      pendencias: [],
      usuario: m.login,
      chave: `t0301-apa-${randomUUID()}`,
    };
    const r1 = await an.gravarSgh(ctx(m.est), null, (g) => g.registrarApa(apa));
    expect(r1).toMatchObject({ versao: 1, repetida: false });
    expect(await an.gravarSgh(ctx(m.est), null, (g) => g.registrarApa(apa))).toMatchObject({
      id: r1.id,
      repetida: true,
    });
    await expect(
      an.gravarSgh(ctx(m.est), null, (g) => g.registrarApa({ ...apa, chave: `t0301-apa-${randomUUID()}` })),
    ).rejects.toThrow(/apa-mudou/);
    const [lida] = await an.apas(ctx(m.est), agendamento);
    expect(lida).toMatchObject({
      versao: 1,
      asa: 2,
      conclusao: 'apto-ressalvas',
      criteriosLee: ['cirurgia-alto-risco'],
    });
    expect(lida?.jejum['liquidosClaros']).toBe(`${amanha()}T05:00`);

    const aberta = await an.gravarSgh(ctx(m.est), null, async (g) => {
      await g.abrirFicha({
        ...cirurgia(agendamento),
        abertura: m.anestesista,
        abertaEm: `${amanha()}T18:00`,
        usuario: m.login,
        chave: null,
      });
      return g.ficha(agendamento);
    });
    expect(aberta).toMatchObject({ situacao: 'aberta', versao: 1, agendamento });
    const ficha = aberta!.id;
    const lote = {
      ficha,
      lancamentos: [{ parte: 'sinal' as const, momento: `${amanha()}T18:05`, tipo: 'fc', valor: 80 }],
      profissional: m.anestesista,
      usuario: m.login,
      chave: `t0301-l-${randomUUID()}`,
    };
    const l1 = await an.gravarSgh(ctx(m.est), null, (g) => g.lancar(lote));
    expect(await an.gravarSgh(ctx(m.est), null, (g) => g.lancar(lote))).toMatchObject({
      ids: l1.ids,
      repetida: true,
    });
    await an.gravarSgh(ctx(m.est), null, (g) =>
      g.subirVersao({
        ficha,
        versaoVista: 1,
        usuario: m.login,
        marco: { marco: 'inicioAnestesia', momento: `${amanha()}T18:02` },
      }),
    );
    await expect(
      an.gravarSgh(ctx(m.est), null, (g) => g.subirVersao({ ficha, versaoVista: 1, usuario: m.login })),
    ).rejects.toThrow(/ficha-mudou/);
    await an.gravarSgh(ctx(m.est), null, (g) =>
      g.justificar({
        ficha,
        inicio: `${amanha()}T18:10`,
        fim: `${amanha()}T18:20`,
        motivo: 'MONITOR SEM SINAL',
        profissional: m.anestesista,
        usuario: m.login,
        chave: null,
      }),
    );
    await an.gravarSgh(ctx(m.est), null, (g) =>
      g.subirVersao({ ficha, versaoVista: 2, usuario: m.login, situacao: 'encerrada' }),
    );
    await an.gravarSgh(ctx(m.est), null, (g) =>
      g.assinar({
        ficha,
        versaoVista: 3,
        profissional: m.anestesista,
        hash: 'a'.repeat(64),
        usuario: m.login,
      }),
    );
    await an.gravarSgh(ctx(m.est), null, (g) =>
      g.adendo({
        ficha,
        texto: 'ADENDO SINTETICO',
        profissional: m.anestesista,
        usuario: m.login,
        chave: null,
      }),
    );
    const f = await an.ficha(ctx(m.est), agendamento);
    expect(f).toMatchObject({ situacao: 'assinada', assinadaPor: m.anestesista, hash: 'a'.repeat(64) });
    expect(f?.marcos.inicioAnestesia).toBe(`${amanha()} 18:02`);
    expect(f?.lancamentos).toHaveLength(1);
    expect(f?.lacunas).toHaveLength(1);
    expect(f?.adendos.map((x) => x.texto)).toEqual(['ADENDO SINTETICO']);

    const srpa = (momento: 'admissao' | 'alta', ultimaVista: number) => ({
      ...cirurgia(agendamento),
      cirurgia: null,
      momento,
      em: `${amanha()}T${momento === 'admissao' ? '19:00' : '20:00'}`,
      aldrete: { atividade: 2, respiracao: 2, circulacao: 2, consciencia: 2, saturacao: 2 },
      dor: 2,
      nvpo: 0,
      pas: null,
      pad: null,
      fc: null,
      spo2: null,
      temperatura: 36.5,
      observacao: null,
      destino: momento === 'alta' ? ('unidade' as const) : null,
      motivoDestino: null,
      regraVersao: null,
      ultimaVista,
      profissional: m.anestesista,
      usuario: m.login,
      chave: null,
    });
    const s1 = await an.gravarSgh(ctx(m.est), null, (g) => g.registrarSrpa(srpa('admissao', 0)));
    await expect(an.gravarSgh(ctx(m.est), null, (g) => g.registrarSrpa(srpa('alta', 0)))).rejects.toThrow(
      /srpa-mudou/,
    );
    await an.gravarSgh(ctx(m.est), null, (g) => g.registrarSrpa(srpa('alta', s1.id)));
    expect((await an.srpa(ctx(m.est), agendamento)).map((x) => [x.momento, x.total, x.destino])).toEqual([
      ['admissao', 10, null],
      ['alta', 10, 'unidade'],
    ]);
    expect((await an.situacoes(ctx(m.est), [agendamento])).get(agendamento)).toEqual({
      apa: 'concluida',
      ficha: 'assinada',
      srpa: 'alta',
    });
  });

  it('checklist e rastreio: abre, confirma, conclui o momento, move o paciente com o código do painel', async () => {
    const bl = new PortaBlocoSeguroPropria(nucleo);
    const agendamento = await agendar('20:00');
    expect(await bl.podeGravar(ctx(m.est))).toMatchObject({ pode: true });
    const { id: checklist } = await bl.gravarSgh(ctx(m.est), null, (g) =>
      g.abrirChecklist({ ...cirurgia(agendamento), lista: m.modeloChecklist, usuario: m.login }),
    );
    const conf = {
      checklist,
      versaoVista: 1,
      momento: 'inducao' as const,
      em: `${amanha()}T20:01`,
      itens: [{ item: 'identidade', resposta: 'sim' as const, observacao: null }],
      profissional: null,
      usuario: m.login,
      chave: `t0301-c-${randomUUID()}`,
    };
    const c1 = await bl.gravarSgh(ctx(m.est), null, (g) => g.confirmarItens(conf));
    expect(c1).toMatchObject({ versao: 2, repetida: false });
    expect(await bl.gravarSgh(ctx(m.est), null, (g) => g.confirmarItens(conf))).toMatchObject({
      repetida: true,
    });
    await bl.gravarSgh(ctx(m.est), null, (g) =>
      g.concluirMomento({
        checklist,
        versaoVista: 2,
        momento: 'inducao',
        em: `${amanha()}T20:02`,
        usuario: m.login,
      }),
    );
    const k = await bl.checklist(ctx(m.est), agendamento);
    expect(k).toMatchObject({ situacao: 'aberto', versao: 3, inducaoEm: `${amanha()} 20:02` });
    expect(k?.confirmacoes.map((x) => [x.item, x.resposta, x.profissional])).toEqual([
      ['identidade', 'sim', m.anestesista],
    ]);

    const mov = {
      ...cirurgia(agendamento),
      ultimoVisto: 0,
      tipo: 'admissao' as const,
      local: m.local,
      localAnterior: null,
      salaCirurgica: null,
      em: `${amanha()}T19:50`,
      destino: null,
      observacao: null,
      estadoAgendamento: null,
      codigo: { dia: amanha(), sortear: () => 'K7Q2', validoAte: `${amanha()}T23:59` },
      usuario: m.login,
      chave: `t0301-m-${randomUUID()}`,
    };
    const m1 = await bl.gravarSgh(ctx(m.est), null, (g) => g.mover(mov));
    expect(m1).toMatchObject({ sequencia: 1, repetida: false, codigo: 'K7Q2' });
    expect(await bl.gravarSgh(ctx(m.est), null, (g) => g.movimentoPelaChave(mov.chave))).toMatchObject({
      id: m1.id,
    });
    expect(await bl.gravarSgh(ctx(m.est), null, (g) => g.mover(mov))).toMatchObject({
      id: m1.id,
      repetida: true,
    });
    await expect(
      bl.gravarSgh(ctx(m.est), null, (g) => g.mover({ ...mov, chave: `t0301-m-${randomUUID()}` })),
    ).rejects.toThrow(/rastreio-mudou/);
    expect((await bl.movimentos(ctx(m.est), agendamento)).map((x) => [x.tipo, x.local])).toEqual([
      ['admissao', m.local],
    ]);
    expect((await bl.codigos(ctx(m.est), `${amanha()}T20:00`, [agendamento])).get(agendamento)?.codigo).toBe(
      'K7Q2',
    );
  });

  it('grade da sala (04-CC linha 92): grava a faixa com trilha, a agenda recusa fora da grade e na reserva de outro cirurgião, inativar guarda a linha', async () => {
    // Começa sem as cirurgias dos casos anteriores (o checklist deixa uma às 20:00 de amanhã na mesma sala).
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-grade' }, (e) =>
      limpar(e, [m.est, m.outro]),
    );
    const grade = new PortaGradeSalaPropria(nucleo);
    const dia = ((new Date(`${amanha()}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    const faixa = { diaSemana: dia, inicio: '19:00', fim: '23:00', vigenciaInicio: '2020-01-01' };
    const trilhaSala = () =>
      ler("SELECT id FROM trilha_auditoria WHERE entidade = 'sala_cirurgica' AND entidade_id = ?", [m.sala]);
    const trilhaAntes = (await trilhaSala()).length;
    const r = await grade.executar(
      ctx(m.est),
      'cirurgia.gravarFaixaGrade',
      { sala: m.sala, ...faixa },
      op(m.est),
    );
    const id = Number(r.resultado['faixa']);
    const [linha] = await ler<Record<string, unknown>>(
      'SELECT dia_semana, ativo, versao FROM grade_sala_cirurgica WHERE id = ?',
      [id],
    );
    expect(linha).toMatchObject({ dia_semana: dia, versao: 1 });
    expect((await trilhaSala()).length).toBeGreaterThan(trilhaAntes);
    // Faixa cruzada no mesmo dia e a mesma sala lida de outro estabelecimento.
    await expect(
      grade.executar(
        ctx(m.est),
        'cirurgia.gravarFaixaGrade',
        { sala: m.sala, ...faixa, inicio: '17:00', fim: '20:00' },
        op(m.est),
      ),
    ).rejects.toThrow(/grade-faixa-cruzada/);
    expect(await grade.grade(ctx(m.outro), m.sala)).toBeNull();
    expect((await grade.grade(ctx(m.est), m.sala))?.faixas.map((f) => [f.inicio, f.fim, f.ativo])).toEqual([
      ['19:00', '23:00', true],
    ]);
    // Feriado do calendário único (cadastros > estrutura): a faixa que não vale em feriado fecha a sala no dia; a
    // que vale abre. O dia fica cadastrado até o fim do caso (o resultado não depende do calendário de amanhã).
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-feriado-grade' }, (e) =>
      e.inserir(
        "INSERT INTO dia_nao_util (descricao, abrangencia, estabelecimento_id, recorrencia, data, criado_em) VALUES ('FERIADO SINTETICO DA GRADE', 'estabelecimento', ?, 'data_unica', ?, ?)",
        [m.est, amanha(), new Date()],
      ),
    );
    await expect(
      porta.executar(ctx(m.est), 'cirurgia.agendarCirurgia', entradaAgendar('19:30'), op(m.est)),
    ).rejects.toThrow(/sala-fechada-na-grade/);
    // O mapa lê a mesma grade: no feriado a sala tem grade e está fechada (lista vazia).
    const abertaNa = async () =>
      (await grade.gradeAberta(ctx(m.est), amanha(), 1)).dias[0]?.salas.find((x) => x.sala === m.sala);
    expect((await grade.gradeAberta(ctx(m.est), amanha(), 1)).dias[0]?.feriado).toBe(true);
    expect((await abertaNa())?.faixas).toEqual([]);
    await grade.executar(
      ctx(m.est),
      'cirurgia.gravarFaixaGrade',
      { sala: m.sala, faixa: id, versao: 1, ...faixa, valeFeriado: true },
      op(m.est),
    );
    expect((await abertaNa())?.faixas).toEqual([
      { inicio: '19:00', fim: '23:00', especialidade: null, profissional: null },
    ]);
    expect((await grade.gradeAberta(ctx(m.outro), amanha(), 1)).dias[0]?.salas).toEqual([]);
    // A agenda confere a grade: fora dela e passando do fim recusa; dentro grava.
    await expect(
      porta.executar(ctx(m.est), 'cirurgia.agendarCirurgia', entradaAgendar('18:00'), op(m.est)),
    ).rejects.toThrow(/sala-fechada-na-grade/);
    await expect(
      porta.executar(ctx(m.est), 'cirurgia.agendarCirurgia', entradaAgendar('22:30'), op(m.est)),
    ).rejects.toThrow(/sala-fechada-na-grade/);
    const ag = await porta.executar(
      ctx(m.est),
      'cirurgia.agendarCirurgia',
      entradaAgendar('19:30'),
      op(m.est),
    );
    expect(Number(ag.resultado['agendamento'])).toBeGreaterThan(0);
    // Reservada a outro cirurgião: recusa o cirurgião do pedido.
    await grade.executar(
      ctx(m.est),
      'cirurgia.gravarFaixaGrade',
      { sala: m.sala, faixa: id, versao: 2, ...faixa, valeFeriado: true, profissional: m.anestesista },
      op(m.est),
    );
    await expect(
      porta.executar(ctx(m.est), 'cirurgia.agendarCirurgia', entradaAgendar('21:00'), op(m.est)),
    ).rejects.toThrow(/grade-reservada-cirurgiao/);
    // Inativar: a linha fica (ativo falso, versão nova), de outro estabelecimento é recusado; sem faixa ativa, não restringe.
    await expect(
      grade.executar(ctx(m.outro), 'cirurgia.inativarFaixaGrade', { faixa: id, versao: 3 }, op(m.outro)),
    ).rejects.toThrow(/faixa-inexistente/);
    await grade.executar(ctx(m.est), 'cirurgia.inativarFaixaGrade', { faixa: id, versao: 3 }, op(m.est));
    const [depois] = await ler<Record<string, unknown>>(
      'SELECT ativo, versao FROM grade_sala_cirurgica WHERE id = ?',
      [id],
    );
    expect(Number(depois?.['ativo'])).toBe(0);
    expect(Number(depois?.['versao'])).toBe(4);
    expect(await abertaNa()).toBeUndefined();
    const livre = await porta.executar(
      ctx(m.est),
      'cirurgia.agendarCirurgia',
      entradaAgendar('18:00'),
      op(m.est),
    );
    expect(Number(livre.resultado['agendamento'])).toBeGreaterThan(0);
  });
});
