// Contrato de efeito da descrição cirúrgica assinada e das intercorrências (04-CC linha 96; F3.4, fatia F3.4-4) no
// cliente f22_o3, com massa SINTÉTICA (códigos "C0396"; nenhuma pessoa real): o rascunho com achados, salvar e assinar
// (situação, horários e conta da assinatura), a descrição assinada que não muda (recusa), o adendo que a deixa
// "retificada" com o texto original intacto, o achado retirado do rascunho marcado como excluído (nunca apagado), a
// intercorrência com sequência e profissional, as recusas (fora da equipe, fora da janela, sem conduta), a trilha de
// cada gravação e a leitura por ato e por paciente.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { PortaDescricaoCirurgicaPropria } from './descricao-cirurgica-porta.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'C0396';

interface Massa {
  est: number;
  usuario: number;
  outroUsuario: number;
  paciente: number;
  cirurgiao: number;
  ato: number;
  achados: number[];
  tipo: number;
  tipoSemConduta: number;
}

const nucleo = new NucleoProprio();
let m: Massa;
let porta: PortaDescricaoCirurgicaPropria;
const ctx = (usuario = m.usuario): ContextoPortaM18 => ({
  cliente: CLIENTE,
  estabelecimento: m.est,
  usuario,
  correlacao: 'teste-f344',
});
const op = (usuario = m.usuario): ContextoOperacao => ({
  ...ctx(usuario),
  chaveIdempotencia: `t0396-${randomUUID()}`,
});
const exec = (o: string, e: unknown, usuario = m.usuario) => porta.executar(ctx(usuario), o, e, op(usuario));
const codigo = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { problema?: { codigo?: string } }) => e.problema?.codigo ?? String(e),
  );

async function limpar(e: Escritor, est: number) {
  const atos = 'SELECT id FROM ato_cirurgico WHERE estabelecimento_id = ?';
  const ds = `SELECT id FROM descricao_cirurgica WHERE ato_cirurgico_id IN (${atos})`;
  await e.executar(`DELETE FROM descricao_cirurgica_adendo WHERE descricao_cirurgica_id IN (${ds})`, [est]);
  await e.executar(`DELETE FROM descricao_cirurgica_achado WHERE descricao_cirurgica_id IN (${ds})`, [est]);
  await e.executar(`DELETE FROM descricao_cirurgica WHERE ato_cirurgico_id IN (${atos})`, [est]);
  await e.executar(`DELETE FROM intercorrencia_cirurgica WHERE ato_cirurgico_id IN (${atos})`, [est]);
  await e.executar(`DELETE FROM participante_cirurgia WHERE ato_cirurgico_id IN (${atos})`, [est]);
  await e.executar('DELETE FROM ato_cirurgico WHERE estabelecimento_id = ?', [est]);
}

async function montar(e: Escritor): Promise<Massa> {
  const agora = new Date();
  const g = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
    const l = await e.uma<{ id: number }>(sel, p);
    return l ? Number(l.id) : e.inserir(ins, pi);
  };
  const cad = (tabela: string, codigo: string, extra: Record<string, unknown> = {}) => {
    const ks = Object.keys(extra);
    return g(
      `SELECT id FROM ${tabela} WHERE codigo = ?`,
      [codigo],
      `INSERT INTO ${tabela} (codigo, descricao${ks.map((k) => `, ${k}`).join('')}, criado_em) VALUES (?, ?${ks.map(() => ', ?').join('')}, ?)`,
      [codigo, `${codigo} SINTETICO`, ...ks.map((k) => extra[k]), agora],
    );
  };
  const est = await g(
    'SELECT id FROM estabelecimento WHERE codigo = ?',
    [P],
    'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
    [P, 'ESTAB SINTETICO DESCRICAO', 'ESTAB SINTETICO DESCRICAO', agora],
  );
  await limpar(e, est);
  const usuario = async (login: string) =>
    g(
      'SELECT id FROM usuario WHERE login = ?',
      [login],
      "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
      [login, `USUARIO SINTETICO ${login}`, agora],
    );
  const pessoa = (nome: string) =>
    g(
      'SELECT id FROM pessoa_fisica WHERE nome = ?',
      [nome],
      'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
      [nome, agora],
    );
  const prof = async (nome: string) =>
    g(
      'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
      [await pessoa(nome)],
      "INSERT INTO profissional (pessoa_fisica_id, tipo, atua_cirurgiao, criado_em) VALUES (?, 'corpo_clinico', TRUE, ?)",
      [await pessoa(nome), agora],
    );
  const pf = await pessoa(`PACIENTE SINTETICO ${P}`);
  const paciente = await g(
    'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
    [pf],
    "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, 930396, 'ativo', ?)",
    [pf, agora],
  );
  const cirurgiao = await prof(`CIRURGIAO SINTETICO ${P}`);
  const outro = await prof(`OUTRO MEDICO SINTETICO ${P}`);
  const u1 = await usuario('c0396.cirurgiao');
  const u2 = await usuario('c0396.outro');
  for (const [u, p] of [
    [u1, cirurgiao],
    [u2, outro],
  ] as const)
    await g(
      'SELECT id FROM usuario_vinculo_profissional WHERE usuario_id = ? AND estabelecimento_id = ?',
      [u, est],
      'INSERT INTO usuario_vinculo_profissional (usuario_id, estabelecimento_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?, ?)',
      [u, est, p, '2020-01-01', agora],
    );
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
  const ua = await g(
    'SELECT id FROM unidade_assistencial WHERE estabelecimento_id = ? AND codigo = ?',
    [est, 'CC1'],
    "INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em) VALUES (?, 'CC1', 'BLOCO SINTETICO', 'centro_cirurgico', ?)",
    [est, agora],
  );
  const uc = await g(
    'SELECT id FROM unidade_cirurgica WHERE unidade_assistencial_id = ?',
    [ua],
    'INSERT INTO unidade_cirurgica (estabelecimento_id, unidade_assistencial_id, funciona_24_horas, criado_em) VALUES (?, ?, TRUE, ?)',
    [est, ua, agora],
  );
  const sala = await g(
    'SELECT id FROM sala_cirurgica WHERE estabelecimento_id = ? AND codigo = ?',
    [est, 'S1'],
    "INSERT INTO sala_cirurgica (estabelecimento_id, unidade_cirurgica_id, codigo, descricao, situacao, criado_em) VALUES (?, ?, 'S1', 'SALA SINTETICA 1', 'ativa', ?)",
    [est, uc, agora],
  );
  const carater = Number(
    (await e.uma<{ id: number }>('SELECT id FROM carater_cirurgia ORDER BY id LIMIT 1'))!.id,
  );
  const funcao = await cad('funcao_equipe_cirurgica', 'cirurgiao');
  const entrada = new Date(agora.getTime() - 3 * 3600_000);
  const saida = new Date(agora.getTime() - 3600_000);
  const ato = await e.inserir(
    `INSERT INTO ato_cirurgico (estabelecimento_id, numero, atendimento_id, paciente_id, sala_cirurgica_id, carater_cirurgia_id,
       entrada_sala_em, inicio_cirurgia_em, fim_cirurgia_em, saida_sala_em, situacao, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'realizado', ?)`,
    [
      est,
      `${P}-${Date.now() % 1e6}`,
      atendimento,
      paciente,
      sala,
      carater,
      entrada,
      entrada,
      saida,
      saida,
      agora,
    ],
  );
  await e.inserir(
    'INSERT INTO participante_cirurgia (ato_cirurgico_id, sequencia, profissional_id, funcao_equipe_cirurgica_id, criado_em) VALUES (?, 1, ?, ?, ?)',
    [ato, cirurgiao, funcao, agora],
  );
  const achados = [
    await cad('achado_cirurgico_padrao', `${P}-A1`),
    await cad('achado_cirurgico_padrao', `${P}-A2`),
  ];
  const tipo = await cad('tipo_intercorrencia_cirurgica', `${P}-T1`, {
    exige_conduta: true,
    evento_adverso: false,
  });
  const tipoSemConduta = await cad('tipo_intercorrencia_cirurgica', `${P}-T2`, {
    exige_conduta: false,
    evento_adverso: true,
  });
  return { est, usuario: u1, outroUsuario: u2, paciente, cirurgiao, ato, achados, tipo, tipoSemConduta };
}

const TEXTO = 'Incisão mediana, dissecção por planos, hemostasia rigorosa e síntese por planos.';

describe.skipIf(SEM_BANCO)('descrição cirúrgica e intercorrências (banco próprio)', () => {
  beforeAll(async () => {
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f344' }, (e) => montar(e));
    porta = new PortaDescricaoCirurgicaPropria(nucleo);
  }, 60_000);
  afterAll(async () => {
    await nucleo.encerrar();
  });

  const ler = <T>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-f344' }, (l) => l.consultar(sql, p)) as Promise<
      T[]
    >;

  it('rascunho, troca de achado (excluído, nunca apagado), assinatura e recusa de alterar a assinada', async () => {
    const base = { versao: null, ato: m.ato, descricaoTecnica: 'curta', achados: [{ achado: m.achados[0] }] };
    const r1 = await exec('cirurgia.salvarDescricao', base);
    const id = Number(r1.resultado['descricao']);
    // Fora da equipe: recusa.
    expect(await codigo(exec('cirurgia.salvarDescricao', base, m.outroUsuario))).toBe('fora-da-equipe');
    // Assinar com a técnica curta: recusa com o código da pendência.
    expect(await codigo(exec('cirurgia.salvarDescricao', { ...base, versao: 1, assinar: true }))).toBe(
      'descricao-tecnica-curta',
    );
    await exec('cirurgia.salvarDescricao', {
      ...base,
      versao: 1,
      descricaoTecnica: TEXTO,
      sangramentoMl: 120,
      envioAnatomopatologico: true,
      descricaoPecas: 'Vesícula biliar',
      achados: [{ achado: m.achados[1], complemento: 'Aderências' }],
      assinar: true,
    });
    const [d] = await ler<Record<string, unknown>>('SELECT * FROM descricao_cirurgica WHERE id = ?', [id]);
    expect(d).toMatchObject({
      situacao: 'assinada',
      cirurgiao_profissional_id: m.cirurgiao,
      assinado_por_usuario_id: m.usuario,
      concluido_por_usuario_id: m.usuario,
      descricao_tecnica: TEXTO,
      sangramento_estimado_ml: 120,
      descricao_pecas: 'Vesícula biliar',
      versao: 2,
    });
    expect(d!['assinada_em']).not.toBeNull();
    const achados = await ler<Record<string, unknown>>(
      'SELECT achado_cirurgico_padrao_id AS a, complemento, excluido_em FROM descricao_cirurgica_achado WHERE descricao_cirurgica_id = ? ORDER BY sequencia',
      [id],
    );
    expect(achados).toHaveLength(2);
    expect(achados[0]!['excluido_em']).not.toBeNull();
    expect(achados[1]).toMatchObject({ a: m.achados[1], complemento: 'Aderências', excluido_em: null });
    // Assinada não muda.
    expect(
      await codigo(exec('cirurgia.salvarDescricao', { ...base, versao: 2, descricaoTecnica: TEXTO })),
    ).toBe('descricao-assinada');
    // Trilha na mesma transação.
    const [t] = await ler<{ k: number }>(
      "SELECT COUNT(*) AS k FROM trilha_auditoria WHERE entidade = 'descricao_cirurgica' AND entidade_id = ?",
      [String(id)],
    );
    expect(Number(t!.k)).toBeGreaterThanOrEqual(2);
  });

  it('adendo pelo autor deixa a descrição retificada e o texto original intacto', async () => {
    const [d] = await ler<{ id: number }>('SELECT id FROM descricao_cirurgica WHERE ato_cirurgico_id = ?', [
      m.ato,
    ]);
    const id = Number(d!.id);
    expect(
      await codigo(
        exec(
          'cirurgia.adendoDescricao',
          { descricao: id, texto: 'Complemento', motivo: 'Esquecido' },
          m.outroUsuario,
        ),
      ),
    ).toBe('descricao-de-outro-cirurgiao');
    await exec('cirurgia.adendoDescricao', {
      descricao: id,
      texto: 'Dreno tubular à direita.',
      motivo: 'Omissão no texto',
    });
    await exec('cirurgia.adendoDescricao', {
      descricao: id,
      texto: 'Peça identificada.',
      motivo: 'Complemento',
    });
    const [x] = await ler<Record<string, unknown>>(
      'SELECT situacao, descricao_tecnica FROM descricao_cirurgica WHERE id = ?',
      [id],
    );
    expect(x).toMatchObject({ situacao: 'retificada', descricao_tecnica: TEXTO });
    const ads = await ler<Record<string, unknown>>(
      'SELECT sequencia, motivo, usuario_id FROM descricao_cirurgica_adendo WHERE descricao_cirurgica_id = ? ORDER BY sequencia',
      [id],
    );
    expect(ads.map((a) => Number(a['sequencia']))).toEqual([1, 2]);
    expect(Number(ads[0]!['usuario_id'])).toBe(m.usuario);
  });

  it('intercorrência: grava com sequência e profissional; recusa fora da janela e sem conduta', async () => {
    const civil = (d: Date) =>
      new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(d);
    const dentro = civil(new Date(Date.now() - 2 * 3600_000));
    const base = { ato: m.ato, tipo: m.tipo, ocorridoEm: dentro, fase: 'intraoperatorio', gravidade: 'leve' };
    expect(await codigo(exec('cirurgia.registrarIntercorrencia', base))).toBe('conduta-obrigatoria');
    expect(
      await codigo(
        exec('cirurgia.registrarIntercorrencia', {
          ...base,
          conduta: 'x',
          ocorridoEm: civil(new Date(Date.now() - 10 * 3600_000)),
        }),
      ),
    ).toBe('fora-da-janela');
    const r = await exec('cirurgia.registrarIntercorrencia', { ...base, conduta: 'Atropina 0,5 mg' });
    expect(r.resultado['pedeNotificacao']).toBe(false);
    const r2 = await exec('cirurgia.registrarIntercorrencia', {
      ...base,
      tipo: m.tipoSemConduta,
      gravidade: 'grave',
      descricao: 'Sangramento importante',
    });
    expect(r2.resultado['pedeNotificacao']).toBe(true);
    const ints = await ler<Record<string, unknown>>(
      'SELECT sequencia, registrado_por_profissional_id AS p, gravidade FROM intercorrencia_cirurgica WHERE ato_cirurgico_id = ? ORDER BY sequencia',
      [m.ato],
    );
    expect(ints.map((i) => [Number(i['sequencia']), Number(i['p']), i['gravidade']])).toEqual([
      [1, m.cirurgiao, 'leve'],
      [2, m.cirurgiao, 'grave'],
    ]);
  });

  it('leitura do ato e visão por paciente', async () => {
    const t = (await porta.tela(ctx(), m.ato))!;
    expect(t.eu).toEqual({ profissional: m.cirurgiao, naEquipe: true });
    expect(t.descricoes).toHaveLength(1);
    expect(t.descricoes[0]).toMatchObject({ situacao: 'retificada', achados: [{ achado: m.achados[1] }] });
    expect(t.descricoes[0]!.adendos).toHaveLength(2);
    expect(t.intercorrencias).toHaveLength(2);
    expect(await porta.tela(ctx(), 999999999)).toBeNull();
    const pac = await porta.doPaciente(ctx(), m.paciente);
    expect(pac[0]).toMatchObject({ ato: m.ato, situacao: 'retificada', adendos: 2, intercorrencias: 2 });
  });
});
