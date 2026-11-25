// Contrato de efeito da descrição cirúrgica assinada e das intercorrências (04-CC linha 96; F3.4, fatia F3.4-4) no
// cliente f22_o3, com massa SINTÉTICA (códigos "C0396"; nenhuma pessoa real): o rascunho com achados, salvar e assinar
// (situação, horários e conta da assinatura), a descrição assinada que não muda (recusa), o adendo que a deixa
// "retificada" com o texto original intacto, o achado retirado do rascunho marcado como excluído (nunca apagado), a
// intercorrência com sequência e profissional, as recusas (fora da equipe, participante retirado, anestesista que não
// descreve, fora da janela, sem conduta), o isolamento entre estabelecimentos (ato, descrição, leitura), a trilha de
// cada gravação e a leitura por ato e por paciente.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import type { ContextoAssinatura } from '../assinatura/porta.js';
import { PortaAssinaturaPropria } from '../assinatura/porta-propria.js';
import { PortaDescricaoCirurgicaPropria } from './descricao-cirurgica-porta.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'C0396';

interface Massa {
  est: number;
  usuario: number;
  outroUsuario: number;
  anestesistaUsuario: number;
  est2: number;
  ato2: number;
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
const ctx = (usuario = m.usuario, est = m.est): ContextoPortaM18 => ({
  cliente: CLIENTE,
  estabelecimento: est,
  usuario,
  correlacao: 'teste-f344',
});
const op = (usuario = m.usuario, est = m.est): ContextoOperacao => ({
  ...ctx(usuario, est),
  chaveIdempotencia: `t0396-${randomUUID()}`,
});
const exec = (o: string, e: unknown, usuario = m.usuario, est = m.est) =>
  porta.executar(ctx(usuario, est), o, e, op(usuario, est));
const codigo = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { problema?: { codigo?: string } }) => e.problema?.codigo ?? String(e),
  );

async function limpar(e: Escritor, est: number) {
  const atos = 'SELECT id FROM ato_cirurgico WHERE estabelecimento_id = ?';
  const ds = `SELECT id FROM descricao_cirurgica WHERE ato_cirurgico_id IN (${atos})`;
  // O documento do prontuário da descrição assinada e a assinatura ICP dele (prévia, tentativa, eventos) saem antes;
  // o envelope (referido pela descrição) sai depois dela.
  const docs = `SELECT id FROM documento_prontuario WHERE entidade_origem = 'descricao_cirurgica' AND estabelecimento_id = ?`;
  await e.executar(`DELETE FROM assinatura_icp WHERE documento_prontuario_id IN (${docs})`, [est]);
  await e.executar(`DELETE FROM previa_assinatura WHERE documento_prontuario_id IN (${docs})`, [est]);
  await e.executar(`DELETE FROM documento_prontuario_evento WHERE documento_prontuario_id IN (${docs})`, [
    est,
  ]);
  await e.executar(
    "DELETE FROM documento_prontuario WHERE entidade_origem = 'descricao_cirurgica' AND estabelecimento_id = ?",
    [est],
  );
  await e.executar(`DELETE FROM descricao_cirurgica_adendo WHERE descricao_cirurgica_id IN (${ds})`, [est]);
  await e.executar(`DELETE FROM descricao_cirurgica_achado WHERE descricao_cirurgica_id IN (${ds})`, [est]);
  await e.executar(`DELETE FROM descricao_cirurgica WHERE ato_cirurgico_id IN (${atos})`, [est]);
  const envelopes = 'SELECT id FROM documento_assinado WHERE estabelecimento_id = ?';
  await e.executar(`DELETE FROM assinatura_documento WHERE documento_assinado_id IN (${envelopes})`, [est]);
  await e.executar('DELETE FROM documento_assinado WHERE estabelecimento_id = ?', [est]);
  await e.executar('DELETE FROM arquivo WHERE chave_armazenamento LIKE ?', [`teste/${P}/%`]);
  // A notificação de evento adverso aberta pela intercorrência (e a linha do tempo dela) sai depois da intercorrência.
  const notas = await e.consultar<{ id: number }>(
    `SELECT notificacao_incidente_id AS id FROM intercorrencia_cirurgica
      WHERE ato_cirurgico_id IN (${atos}) AND notificacao_incidente_id IS NOT NULL`,
    [est],
  );
  await e.executar(`DELETE FROM intercorrencia_cirurgica WHERE ato_cirurgico_id IN (${atos})`, [est]);
  for (const { id } of notas) {
    await e.executar('DELETE FROM notificacao_incidente_evento WHERE notificacao_incidente_id = ?', [id]);
    await e.executar('DELETE FROM notificacao_incidente WHERE id = ?', [id]);
  }
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
  const estab = async (codigo: string) => {
    const id = await g(
      'SELECT id FROM estabelecimento WHERE codigo = ?',
      [codigo],
      'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
      [codigo, `ESTAB SINTETICO ${codigo}`, `ESTAB SINTETICO ${codigo}`, agora],
    );
    await limpar(e, id);
    return id;
  };
  const est = await estab(P);
  const est2 = await estab(`${P}B`);
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
  const anestesista = await prof(`ANESTESISTA SINTETICO ${P}`);
  const u1 = await usuario('c0396.cirurgiao');
  const u2 = await usuario('c0396.outro');
  const u3 = await usuario('c0396.anestesista');
  for (const [u, p, es] of [
    [u1, cirurgiao, est],
    [u2, outro, est],
    [u3, anestesista, est],
    [u1, cirurgiao, est2],
  ] as const)
    await g(
      'SELECT id FROM usuario_vinculo_profissional WHERE usuario_id = ? AND estabelecimento_id = ?',
      [u, es],
      'INSERT INTO usuario_vinculo_profissional (usuario_id, estabelecimento_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?, ?)',
      [u, es, p, '2020-01-01', agora],
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
  const carater = Number(
    (await e.uma<{ id: number }>('SELECT id FROM carater_cirurgia ORDER BY id LIMIT 1'))!.id,
  );
  // Funções com códigos próprios do teste: cirurgião (médica, grau TISS 00) e anestesista (médica, grau 06).
  const funcao = await cad('funcao_equipe_cirurgica', `${P}-CIR`, {
    funcao_medica: true,
    grau_participacao_tiss: '00',
  });
  const funcaoAnestesia = await cad('funcao_equipe_cirurgica', `${P}-ANE`, {
    funcao_medica: true,
    grau_participacao_tiss: '06',
  });
  const entrada = new Date(agora.getTime() - 3 * 3600_000);
  const saida = new Date(agora.getTime() - 3600_000);
  const atoEm = async (est: number) => {
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
    return ato;
  };
  const ato = await atoEm(est);
  const ato2 = await atoEm(est2);
  // O anestesista está na equipe viva, mas a função não descreve; o outro médico foi retirado da equipe.
  await e.inserir(
    'INSERT INTO participante_cirurgia (ato_cirurgico_id, sequencia, profissional_id, funcao_equipe_cirurgica_id, criado_em) VALUES (?, 2, ?, ?, ?)',
    [ato, anestesista, funcaoAnestesia, agora],
  );
  await e.inserir(
    'INSERT INTO participante_cirurgia (ato_cirurgico_id, sequencia, profissional_id, funcao_equipe_cirurgica_id, criado_em, excluido_em) VALUES (?, 3, ?, ?, ?, ?)',
    [ato, outro, funcao, agora, agora],
  );
  const achados = [
    await cad('achado_cirurgico_padrao', `${P}-A1`),
    await cad('achado_cirurgico_padrao', `${P}-A2`),
  ];
  const tipo = await cad('tipo_intercorrencia_cirurgica', `${P}-T1`, {
    exige_conduta: true,
    evento_adverso: false,
  });
  // Os cadastros da notificação ao núcleo de segurança do paciente (configuração do cliente; a intercorrência grave
  // abre a notificação de evento adverso), pelos vocabulários do contrato.
  await g(
    'SELECT id FROM tipo_incidente WHERE codigo = ?',
    ['cirurgia'],
    "INSERT INTO tipo_incidente (codigo, descricao, criado_em) VALUES ('cirurgia', 'Cirurgia ou procedimento', ?)",
    [agora],
  );
  await g(
    'SELECT id FROM classificacao_incidente WHERE codigo = ?',
    ['evento_adverso'],
    "INSERT INTO classificacao_incidente (codigo, descricao, ordem, criado_em) VALUES ('evento_adverso', 'Evento adverso', 3, ?)",
    [agora],
  );
  await g(
    'SELECT id FROM grau_dano WHERE codigo = ?',
    ['grave'],
    "INSERT INTO grau_dano (codigo, descricao, ordem, criado_em) VALUES ('grave', 'Grave', 53, ?)",
    [agora],
  );
  // Tipo de documento que a fila ICP conhece (código do cadastro do cliente) e a situação "lançado" do documento.
  await g(
    "SELECT id FROM tipo_documento_clinico WHERE codigo = 'registro-clinico'",
    [],
    "INSERT INTO tipo_documento_clinico (codigo, descricao, categoria, criado_em) VALUES ('registro-clinico', 'REGISTRO SINTETICO', 'registro_cirurgico', ?)",
    [agora],
  );
  await e.executar("UPDATE tipo_documento_clinico SET ativo = TRUE WHERE codigo = 'registro-clinico'");
  await g(
    "SELECT id FROM situacao_documento_prontuario WHERE categoria = 'lancado' AND ativo = TRUE LIMIT 1",
    [],
    "INSERT INTO situacao_documento_prontuario (codigo, descricao, categoria, criado_em) VALUES (?, 'LANCADO SINTETICO', 'lancado', ?)",
    [`${P}-LAN`, agora],
  );
  const tipoSemConduta = await cad('tipo_intercorrencia_cirurgica', `${P}-T2`, {
    exige_conduta: false,
    evento_adverso: true,
  });
  return {
    est,
    usuario: u1,
    outroUsuario: u2,
    anestesistaUsuario: u3,
    est2,
    ato2,
    paciente,
    cirurgiao,
    ato,
    achados,
    tipo,
    tipoSemConduta,
  };
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
    // Participante retirado da equipe (excluido_em): fora da equipe. Anestesista da equipe viva: a função não descreve.
    expect(await codigo(exec('cirurgia.salvarDescricao', base, m.outroUsuario))).toBe('fora-da-equipe');
    expect(await codigo(exec('cirurgia.salvarDescricao', base, m.anestesistaUsuario))).toBe(
      'funcao-nao-descreve',
    );
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
    expect(d!['documento_assinado_id']).toBeNull();
    // A descrição assinada entra no prontuário como documento do cirurgião, ligado à origem (é o que a fila ICP assina).
    const docs = await ler<Record<string, unknown>>(
      `SELECT dp.id, dp.paciente_id, dp.profissional_id, dp.titulo, dp.documento_assinado_id, t.codigo AS tipo,
              (SELECT COUNT(*) FROM documento_prontuario_evento ev WHERE ev.documento_prontuario_id = dp.id) AS eventos
         FROM documento_prontuario dp JOIN tipo_documento_clinico t ON t.id = dp.tipo_documento_clinico_id
        WHERE dp.entidade_origem = 'descricao_cirurgica' AND dp.entidade_origem_id = ?`,
      [id],
    );
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      paciente_id: m.paciente,
      profissional_id: m.cirurgiao,
      titulo: 'Descrição cirúrgica',
      documento_assinado_id: null,
      tipo: 'registro-clinico',
    });
    expect(Number(docs[0]!['eventos'])).toBe(1);
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
    // A grave abriu a notificação de evento adverso na mesma gravação, ligada à intercorrência, com o paciente e o
    // atendimento do ato, o tipo "cirurgia", o dano pela gravidade e a proposta "evento adverso" (o NSP triará).
    const nota = {
      id: Number(r2.resultado['notificacao']),
      protocolo: String(r2.resultado['protocoloNotificacao']),
    };
    expect(nota.protocolo).toMatch(/\S/);
    const [ligada] = await ler<Record<string, unknown>>(
      `SELECT i.notificacao_incidente_id AS nid, n.situacao, n.paciente_id, n.atendimento_id, n.anonima,
              n.notificador_usuario_id AS quem, t.codigo AS tipo, g.codigo AS dano, c.codigo AS classe,
              (SELECT COUNT(*) FROM notificacao_incidente_evento ev WHERE ev.notificacao_incidente_id = n.id) AS eventos
         FROM intercorrencia_cirurgica i
         JOIN notificacao_incidente n ON n.id = i.notificacao_incidente_id
         JOIN tipo_incidente t ON t.id = n.tipo_incidente_id
         JOIN grau_dano g ON g.id = n.percebido_grau_dano_id
         JOIN classificacao_incidente c ON c.id = n.classificacao_incidente_id
        WHERE i.id = ?`,
      [Number(r2.resultado['intercorrencia'])],
    );
    expect(ligada).toBeDefined();
    expect({
      nid: Number(ligada!['nid']),
      situacao: ligada!['situacao'],
      paciente: Number(ligada!['paciente_id']),
      anonima: Number(ligada!['anonima']),
      quem: Number(ligada!['quem']),
      tipo: ligada!['tipo'],
      dano: ligada!['dano'],
      classe: ligada!['classe'],
      eventos: Number(ligada!['eventos']),
    }).toEqual({
      nid: nota.id,
      situacao: 'recebida',
      paciente: m.paciente,
      anonima: 0,
      quem: m.usuario,
      tipo: 'cirurgia',
      dano: 'grave',
      classe: 'evento_adverso',
      eventos: 1,
    });
    expect(r.resultado['notificacao']).toBeNull();
    const [semNota] = await ler<Record<string, unknown>>(
      'SELECT notificacao_incidente_id AS nid FROM intercorrencia_cirurgica WHERE id = ?',
      [Number(r.resultado['intercorrencia'])],
    );
    expect(semNota!['nid']).toBeNull();
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
    expect(t.eu).toEqual({ profissional: m.cirurgiao, naEquipe: true, descreve: true });
    // A equipe lida é a viva: o retirado não aparece; o anestesista aparece, sem descrever.
    expect(t.equipe.map((x) => x.descreve)).toEqual([true, false]);
    const tAnest = (await porta.tela(ctx(m.anestesistaUsuario), m.ato))!;
    expect(tAnest.eu).toMatchObject({ naEquipe: true, descreve: false });
    expect((await porta.tela(ctx(m.outroUsuario), m.ato))!.eu.naEquipe).toBe(false);
    expect(t.descricoes).toHaveLength(1);
    expect(t.descricoes[0]).toMatchObject({ situacao: 'retificada', achados: [{ achado: m.achados[1] }] });
    expect(t.descricoes[0]!.adendos).toHaveLength(2);
    expect(t.descricoes[0]!.assinatura).toMatchObject({ nivel: 'eletronica-avancada', envelope: null });
    expect(t.descricoes[0]!.assinatura.documento).not.toBeNull();
    expect(t.intercorrencias).toHaveLength(2);
    expect(t.intercorrencias.map((i) => i.notificacao === null)).toEqual([true, false]);
    expect(await porta.tela(ctx(), 999999999)).toBeNull();
    const pac = await porta.doPaciente(ctx(), m.paciente);
    expect(pac[0]).toMatchObject({ ato: m.ato, situacao: 'retificada', adendos: 2, intercorrencias: 2 });
  });

  it('certificado ICP-Brasil: a conclusão da assinatura do documento liga o envelope na descrição', async () => {
    const [d] = await ler<{ id: number }>('SELECT id FROM descricao_cirurgica WHERE ato_cirurgico_id = ?', [
      m.ato,
    ]);
    const [doc] = await ler<{ id: number }>(
      "SELECT id FROM documento_prontuario WHERE entidade_origem = 'descricao_cirurgica' AND entidade_origem_id = ?",
      [d!.id],
    );
    // A prévia e a tentativa assinada, como o provedor de nuvem as deixa (certificado e PDF sintéticos).
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f344-icp' }, async (e) => {
      const agora = new Date();
      const arq = await e.inserir(
        `INSERT INTO arquivo (finalidade, nome_original, tipo_mime, tamanho_bytes, hash_sha256, chave_armazenamento, criado_em)
         VALUES ('previa-assinatura', 'previa.pdf', 'application/pdf', 10, ?, ?, ?)`,
        ['a'.repeat(64), `teste/${P}/${randomUUID()}`, agora],
      );
      await e.executar('DELETE FROM certificado_usuario WHERE usuario_id = ? AND impressao_digital = ?', [
        m.usuario,
        'c'.repeat(64),
      ]);
      const cert = await e.inserir(
        `INSERT INTO certificado_usuario (usuario_id, midia, nome_titular, cpf_titular, emissor, numero_serie,
           impressao_digital, valido_de, valido_ate, criado_em)
         VALUES (?, 'a1', 'CIRURGIAO SINTETICO', '00000000191', 'AC SINTETICA', ?, ?, ?, ?, ?)`,
        [
          m.usuario,
          `${P}-SERIE`,
          'c'.repeat(64),
          new Date(Date.now() - 86_400_000),
          new Date(Date.now() + 86_400_000 * 365),
          agora,
        ],
      );
      const previa = await e.inserir(
        `INSERT INTO previa_assinatura (estabelecimento_id, documento_prontuario_id, usuario_id, certificado_usuario_id,
           politica_icp, arquivo_id, hash_pdf, codigo_verificacao, assinar_em, criado_em)
         VALUES (?, ?, ?, ?, 'AD-RB', ?, ?, ?, ?, ?)`,
        [
          m.est,
          doc!.id,
          m.usuario,
          cert,
          arq,
          'b'.repeat(64),
          `${P}${randomUUID().slice(0, 8)}`,
          agora,
          agora,
        ],
      );
      await e.inserir(
        `INSERT INTO assinatura_icp (estabelecimento_id, origem_assinatura, documento_prontuario_id, usuario_id,
           certificado_usuario_id, midia, formato, politica_icp, hash_assinado, assinatura_cms, situacao,
           previa_assinatura_id, criado_em)
         VALUES (?, 'documento', ?, ?, ?, 'a1', 'pades', 'AD-RB', ?, 'cms-sintetico', 'assinada', ?, ?)`,
        [m.est, doc!.id, m.usuario, cert, 'd'.repeat(64), previa, agora],
      );
    });
    const assinatura = new PortaAssinaturaPropria(nucleo, CLIENTE);
    const ctxIcp = {
      rede: 'rede-sintetica',
      hospital: P,
      cliente: CLIENTE,
      estabelecimento: m.est,
      usuario: m.usuario,
    } as ContextoAssinatura;
    await assinatura.gravar(
      ctxIcp,
      (g) => g.gravarEventoAssinadoIcp({ hospital: P, usuario: 'c0396.cirurgiao' }, doc!.id, false),
      null,
    );
    const [dp] = await ler<{ envelope: number | null }>(
      'SELECT documento_assinado_id AS envelope FROM documento_prontuario WHERE id = ?',
      [doc!.id],
    );
    expect(dp!.envelope).not.toBeNull();
    const [dc] = await ler<Record<string, unknown>>(
      'SELECT documento_assinado_id, situacao, descricao_tecnica FROM descricao_cirurgica WHERE id = ?',
      [d!.id],
    );
    // O envelope é o mesmo do documento; o texto e a situação da descrição não mudam.
    expect(dc).toMatchObject({
      documento_assinado_id: dp!.envelope,
      situacao: 'retificada',
      descricao_tecnica: TEXTO,
    });
    const [env] = await ler<Record<string, unknown>>(
      `SELECT da.nivel_exigido, da.entidade, ad.nivel, ad.papel FROM documento_assinado da
         JOIN assinatura_documento ad ON ad.documento_assinado_id = da.id WHERE da.id = ?`,
      [dp!.envelope],
    );
    expect(env).toEqual({
      nivel_exigido: 'icp-brasil',
      entidade: 'documento_prontuario',
      nivel: 'icp-brasil',
      papel: 'autor',
    });
    const t = (await porta.tela(ctx(), m.ato))!;
    expect(t.descricoes[0]!.assinatura).toEqual({
      nivel: 'icp-brasil',
      documento: doc!.id,
      envelope: dp!.envelope,
    });
    // Concluir de novo não troca o envelope da descrição (uma vez, nunca troca).
    await assinatura.gravar(
      ctxIcp,
      (g) => g.gravarEventoAssinadoIcp({ hospital: P, usuario: 'c0396.cirurgiao' }, doc!.id, false),
      null,
    );
    const [dc2] = await ler<{ e: number }>(
      'SELECT documento_assinado_id AS e FROM descricao_cirurgica WHERE id = ?',
      [d!.id],
    );
    expect(dc2!.e).toBe(dp!.envelope);
  });

  it('isolamento entre estabelecimentos: ato, descrição e leituras de outro estabelecimento', async () => {
    const base = { versao: null, descricaoTecnica: TEXTO, achados: [] };
    // Ato do estabelecimento 2 pela sessão no estabelecimento 1: recusa sem revelar o ato.
    expect(await codigo(exec('cirurgia.salvarDescricao', { ...base, ato: m.ato2 }))).toBe(
      'registro-inexistente',
    );
    expect(
      await codigo(
        exec('cirurgia.registrarIntercorrencia', {
          ato: m.ato2,
          tipo: m.tipo,
          ocorridoEm: '2026-01-01 10:00',
          fase: 'intraoperatorio',
          gravidade: 'leve',
          conduta: 'x',
        }),
      ),
    ).toBe('registro-inexistente');
    expect(await porta.tela(ctx(), m.ato2)).toBeNull();
    // A descrição assinada no estabelecimento 2 (pela sessão de lá) não aceita adendo pela sessão do 1.
    const r = await exec(
      'cirurgia.salvarDescricao',
      { ...base, ato: m.ato2, assinar: true },
      m.usuario,
      m.est2,
    );
    const id2 = Number(r.resultado['descricao']);
    expect(
      await codigo(
        exec('cirurgia.adendoDescricao', {
          descricao: id2,
          texto: 'Complemento',
          motivo: 'Omissão no texto',
        }),
      ),
    ).toBe('registro-inexistente');
    const [k] = await ler<{ k: number }>(
      'SELECT COUNT(*) AS k FROM descricao_cirurgica_adendo WHERE descricao_cirurgica_id = ?',
      [id2],
    );
    expect(Number(k!.k)).toBe(0);
    // A visão por paciente só traz os atos do estabelecimento da sessão.
    const p1 = await porta.doPaciente(ctx(), m.paciente);
    expect(p1.map((x) => x.ato)).not.toContain(m.ato2);
    const p2 = await porta.doPaciente(ctx(m.usuario, m.est2), m.paciente);
    expect(p2.map((x) => x.ato)).toEqual([m.ato2]);
  });
});
