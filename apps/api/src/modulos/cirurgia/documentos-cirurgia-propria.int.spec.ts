// Contrato de efeito dos documentos obrigatórios antes da cirurgia (F8, 04-CC linha 104) contra o MariaDB real
// (cliente de teste). Massa SINTÉTICA: estabelecimento com o código do teste, caráter eletivo fictício, uma cirurgia
// fictícia agendada para 2030 com um procedimento, dois tipos de documento fictícios (consentimento e exame) e um
// documento digitalizado fictício do paciente; usuário, paciente, profissional, procedimento e tipo de documento do
// arquivo são ids já existentes do cliente de teste (só os ids são lidos).
// Prova o que fica no banco: a configuração (tipo com código único e nunca exigido em toda cirurgia por aqui; tipo
// desativado e reativado pela versão, recusado com regra ativa neste ou em outro estabelecimento; regra do
// consentimento só aceita bloqueando; regra repetida recusada; desativar grava ativo falso e a versão, sem apagar); a
// leitura com os exigidos e o estado; a confirmação recusada com documento pendente; sem o consentimento, a ida direta
// de confirmado a realizado e o registro do ato cirúrgico do agendamento recusados sem escrita; o exame apresentado vence na data da cirurgia; a dispensa do
// consentimento na eletiva é recusada sem escrita; o apresentado leva o arquivo do digitalizado; cada registro é uma
// linha nova (sequência, conferente, instante), o recusado depois do apresentado volta a bloquear a entrada no bloco,
// e nada é apagado; a sessão de outro estabelecimento recebe 404 sem escrita.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import type { EstadoAgendamento } from '@sgh/dominio-cirurgia';
import { randomUUID } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaDocumentosCirurgiaPropria } from './documentos-cirurgia-propria.js';
import { PortaCirurgiaPropria } from './porta-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c1128dc';
const P2 = `${P}b`;
const TIPOS = [`${P}-TCLE`.toUpperCase(), `${P}-EXA`.toUpperCase(), `${P}-OUT`.toUpperCase()];

async function limpar(e: Escritor): Promise<void> {
  const est = 'SELECT id FROM estabelecimento WHERE codigo = ?';
  const ag = `SELECT id FROM agendamento_cirurgico WHERE estabelecimento_id = (${est})`;
  await e.executar(`DELETE FROM documento_cirurgia_apresentado WHERE agendamento_cirurgico_id IN (${ag})`, [
    P,
  ]);
  await e.executar(
    'DELETE FROM documento_exigido_cirurgia WHERE estabelecimento_id IN (SELECT id FROM estabelecimento WHERE codigo IN (?, ?))',
    [P, P2],
  );
  await e.executar(`DELETE FROM documento_digitalizado WHERE estabelecimento_id = (${est})`, [P]);
  await e.executar(`DELETE FROM arquivo WHERE estabelecimento_id = (${est})`, [P]);
  await e.executar(
    `DELETE FROM agendamento_cirurgico_procedimento WHERE agendamento_cirurgico_id IN (${ag})`,
    [P],
  );
  await e.executar(`DELETE FROM reagendamento_cirurgico WHERE agendamento_cirurgico_id IN (${ag})`, [P]);
  await e.executar(`DELETE FROM agendamento_cirurgico WHERE estabelecimento_id = (${est})`, [P]);
  await e.executar(`DELETE FROM sala_cirurgica WHERE estabelecimento_id = (${est})`, [P]);
  await e.executar(`DELETE FROM unidade_cirurgica WHERE estabelecimento_id = (${est})`, [P]);
  await e.executar(`DELETE FROM unidade_assistencial WHERE estabelecimento_id = (${est})`, [P]);
  await e.executar('DELETE FROM tipo_documento_pre_operatorio WHERE codigo IN (?, ?, ?)', TIPOS);
  await e.executar('DELETE FROM carater_cirurgia WHERE codigo = ?', [`${P}-ELE`]);
  await limparTrilhaDaMassa(e, { codigos: [P, P2] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, P2]);
}

describe.skipIf(SEM_BANCO)('PortaDocumentosCirurgiaPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaDocumentosCirurgiaPropria;
  let cirurgia: PortaCirurgiaPropria;
  let m: {
    usuario: number;
    login: string;
    est: number;
    ag: number;
    sala: number;
    procedimento: number;
    digitalizado: number;
    arquivo: number;
  };
  const tipo: Record<'tcle' | 'exa' | 'out', number> = { tcle: 0, exa: 0, out: 0 };
  const ctx = (hospital = P) => ({ cliente: CLIENTE, hospital, usuario: m.usuario, correlacao: P });
  const ctxCc = () => ({ cliente: CLIENTE, estabelecimento: m.est, usuario: m.usuario, correlacao: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<
      Record<string, unknown>[]
    >;
  const registros = () =>
    ler(
      `SELECT sequencia, tipo_documento_pre_operatorio_id AS tipo, situacao, arquivo_id AS arquivo,
              conferido_por_usuario_id AS conferente, conferido_em IS NOT NULL AS conferido, criado_por
         FROM documento_cirurgia_apresentado WHERE agendamento_cirurgico_id = ? ORDER BY sequencia`,
      [m.ag],
    );
  const situacao = async () =>
    String((await ler('SELECT situacao FROM agendamento_cirurgico WHERE id = ?', [m.ag]))[0]?.['situacao']);
  const mudar = async (estado: 'confirmado' | 'no-bloco' | 'realizado') => {
    const e = await cirurgia.estado(ctxCc(), m.ag);
    return cirurgia.gravarSgh(
      ctxCc(),
      {
        estabelecimento: m.est,
        usuario: m.usuario,
        acao: 'alteracao' as const,
        entidade: 'agendamento_cirurgico',
        entidadeId: m.ag,
        correlacao: P,
      },
      (g) =>
        g.mudarEstado({
          id: m.ag,
          estado,
          visto: { estado: e!.estado as EstadoAgendamento, versao: e!.versao ?? null },
          usuario: m.login,
        }),
    );
  };
  const recusa422 = { problema: { status: 422 } };
  // O ato cirúrgico do agendamento (registro com a incisão); a conferência dos documentos vem antes do atendimento.
  const registrarAto = () => {
    const sem = { usado: false, descricao: null };
    return cirurgia.executar(
      ctxCc(),
      'cirurgia.registrarCirurgia',
      {
        agendamento: m.ag,
        reg: m.ag,
        data: '2030-03-10',
        sala: m.sala,
        convenio: 0,
        porte: 'P',
        potencialContaminacao: 'L',
        carater: 1,
        tipoAnestesia: 0,
        inicio: '08:10',
        fim: '09:00',
        inicioAnestesia: null,
        fimAnestesia: null,
        cid10: null,
        pressao: null,
        pulso: null,
        supuracao: false,
        usos: { tubo: sem, antimicrobiano: sem, sonda: sem, cateter: sem, puncao: sem },
        procedimentos: [
          {
            procedimento: m.procedimento,
            especialidade: 1,
            tecnica: 1,
            equipe: { cirurgiao: { id: 1, cod: 1 } },
          },
        ],
        extensao: { entradaSala: '08:00', incisao: '08:10', saidaSala: '09:10', asa: null, observacao: null },
      },
      { ...ctxCc(), chaveIdempotencia: `${P}-${randomUUID()}` },
    );
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const um = async (sql: string) => Number((await e.uma(sql))?.['id'] ?? 0);
      const usuario = await um('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const login = String((await e.uma('SELECT login FROM usuario WHERE id = ?', [usuario]))?.['login']);
      const profissional = await um('SELECT MIN(id) AS id FROM profissional WHERE excluido_em IS NULL');
      const procedimento = await um('SELECT MIN(id) AS id FROM procedimento_cirurgico');
      const tipoArquivo = await um('SELECT MIN(id) AS id FROM tipo_documento_arquivo');
      const paciente = await um('SELECT MIN(id) AS id FROM paciente');
      if (!usuario || !profissional || !procedimento || !tipoArquivo || !paciente)
        throw new Error(
          'O cliente de teste precisa de usuário, profissional, procedimento, tipo e paciente.',
        );
      const novoEst = (codigo: string) =>
        e.inserir(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
           VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
          [codigo, `Hospital sintético ${codigo}`, `Hospital sintético ${codigo} (fictício)`, agora],
        );
      const est = await novoEst(P);
      await novoEst(P2);
      const carater = await e.inserir(
        "INSERT INTO carater_cirurgia (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'eletiva', ?)",
        [`${P}-ELE`, `CARATER SINTETICO ${P}`, agora],
      );
      const ua = await e.inserir(
        `INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em)
         VALUES (?, 'CC1', 'BLOCO SINTETICO', 'centro_cirurgico', ?)`,
        [est, agora],
      );
      const uc = await e.inserir(
        `INSERT INTO unidade_cirurgica (estabelecimento_id, unidade_assistencial_id, funciona_24_horas, criado_em)
         VALUES (?, ?, TRUE, ?)`,
        [est, ua, agora],
      );
      const sala = await e.inserir(
        `INSERT INTO sala_cirurgica (estabelecimento_id, unidade_cirurgica_id, codigo, descricao, situacao, criado_em)
         VALUES (?, ?, 'S1', 'SALA SINTETICA 1', 'ativa', ?)`,
        [est, uc, agora],
      );
      const ag = await e.inserir(
        `INSERT INTO agendamento_cirurgico (estabelecimento_id, numero, paciente_id, cirurgiao_profissional_id,
                                            carater_cirurgia_id, tipo_cobertura, solicitado_em, situacao,
                                            inicio_previsto_em, duracao_prevista_minutos, sala_cirurgica_id, criado_em)
         VALUES (?, ?, ?, ?, ?, 'particular', ?, 'agendado', '2030-03-10 08:00:00', 120, ?, ?)`,
        [est, `${P}-1`, paciente, profissional, carater, agora, sala, agora],
      );
      await e.inserir(
        `INSERT INTO agendamento_cirurgico_procedimento (agendamento_cirurgico_id, sequencia, procedimento_cirurgico_id,
                                                         principal, criado_em) VALUES (?, 1, ?, TRUE, ?)`,
        [ag, procedimento, agora],
      );
      const arquivo = await e.inserir(
        `INSERT INTO arquivo (estabelecimento_id, entidade, finalidade, nome_original, tipo_mime, tamanho_bytes,
                              hash_sha256, chave_armazenamento, imutavel, criado_em)
         VALUES (?, 'documento_digitalizado', 'digitalizacao', 'sintetico.pdf', 'application/pdf', 10, ?, ?, TRUE, ?)`,
        [est, 'c'.repeat(64), `${P}/sintetico.pdf`, agora],
      );
      const digitalizado = await e.inserir(
        `INSERT INTO documento_digitalizado (estabelecimento_id, paciente_id, tipo_documento_arquivo_id, arquivo_id,
                                             descricao, digitalizado_em, digitalizador_usuario_id, criado_em)
         VALUES (?, ?, ?, ?, 'TERMO SINTETICO', ?, ?, ?)`,
        [est, paciente, tipoArquivo, arquivo, agora, usuario, agora],
      );
      return { usuario, login, est, ag, sala, procedimento, digitalizado, arquivo };
    });
    porta = new PortaDocumentosCirurgiaPropria(nucleo, CLIENTE);
    cirurgia = new PortaCirurgiaPropria(nucleo);
  }, 60_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  });

  it('configura os tipos e as regras: consentimento só bloqueando; regra repetida recusada; desativar não apaga', async () => {
    await porta.incluirTipo(ctx(), {
      codigo: TIPOS[0],
      descricao: 'Termo sintético',
      categoria: 'consentimento',
    });
    const t = await ler('SELECT id, codigo FROM tipo_documento_pre_operatorio WHERE codigo IN (?, ?)', TIPOS);
    tipo.tcle = Number(t.find((x) => x['codigo'] === TIPOS[0])?.['id']);
    await expect(
      porta.incluirTipo(ctx(), { codigo: TIPOS[0], descricao: 'Repetido', categoria: 'outro' }),
    ).rejects.toMatchObject({ problema: { status: 409 } });
    await porta.incluirTipo(ctx(), { codigo: TIPOS[1], descricao: 'Exame sintético', categoria: 'exame' });
    tipo.exa = Number(
      (await ler('SELECT id FROM tipo_documento_pre_operatorio WHERE codigo = ?', [TIPOS[1]]))[0]?.['id'],
    );
    // A exigência em toda cirurgia não se cria pelo estabelecimento: o pedido com ela é recusado, sem escrita.
    await expect(
      porta.incluirTipo(ctx(), {
        codigo: TIPOS[2],
        descricao: 'Outro sintético',
        categoria: 'outro',
        obrigatorio: true,
      }),
    ).rejects.toMatchObject({ problema: { status: 400 } });
    expect(await ler('SELECT id FROM tipo_documento_pre_operatorio WHERE codigo = ?', [TIPOS[2]])).toEqual(
      [],
    );
    await porta.incluirTipo(ctx(), { codigo: TIPOS[2], descricao: 'Outro sintético', categoria: 'outro' });
    const versaoTipo = async (id: number) =>
      (await porta.configuracao(ctx())).tipos.find((x) => x.id === id)!;
    tipo.out = Number(
      (await ler('SELECT id FROM tipo_documento_pre_operatorio WHERE codigo = ?', [TIPOS[2]]))[0]?.['id'],
    );
    await porta.ativarTipo(ctx(), tipo.out, { versao: (await versaoTipo(tipo.out)).versao, ativo: false });
    await expect(
      porta.incluirRegra(ctx(), { tipo: tipo.out, procedimento: m.procedimento }),
    ).rejects.toMatchObject(recusa422);
    await porta.ativarTipo(ctx(), tipo.out, { versao: (await versaoTipo(tipo.out)).versao, ativo: true });
    expect(
      await ler(
        'SELECT codigo, ativo, obrigatorio, versao FROM tipo_documento_pre_operatorio WHERE codigo IN (?, ?, ?) ORDER BY codigo',
        TIPOS,
      ),
    ).toEqual(
      [
        { codigo: TIPOS[0], ativo: 1, obrigatorio: 0, versao: 1 },
        { codigo: TIPOS[1], ativo: 1, obrigatorio: 0, versao: 1 },
        { codigo: TIPOS[2], ativo: 1, obrigatorio: 0, versao: 3 },
      ].sort((a, b) => String(a.codigo).localeCompare(String(b.codigo))),
    );
    await expect(porta.incluirRegra(ctx(), { tipo: tipo.tcle })).rejects.toMatchObject(recusa422);
    await porta.incluirRegra(ctx(), { tipo: tipo.tcle, bloqueiaEntradaSala: true, geraPendencia: false });
    // O tipo com regra ativa (aqui e no outro hospital) não se desativa; a regra do outro hospital não vale aqui.
    await porta.incluirRegra(ctx(P2), { tipo: tipo.out, procedimento: m.procedimento });
    await expect(
      porta.ativarTipo(ctx(), tipo.out, { versao: (await versaoTipo(tipo.out)).versao, ativo: false }),
    ).rejects.toMatchObject(recusa422);
    await expect(
      porta.ativarTipo(ctx(), tipo.tcle, { versao: (await versaoTipo(tipo.tcle)).versao, ativo: false }),
    ).rejects.toMatchObject(recusa422);
    await porta.incluirRegra(ctx(), { tipo: tipo.exa, procedimento: m.procedimento, validadeDias: 30 });
    await expect(
      porta.incluirRegra(ctx(), { tipo: tipo.exa, procedimento: m.procedimento }),
    ).rejects.toMatchObject({ problema: { status: 409 } });
    await porta.incluirRegra(ctx(), { tipo: tipo.exa, validadeDias: 10 });
    const cfg = await porta.configuracao(ctx());
    const geral = cfg.regras.find((r) => r.tipo === tipo.exa && r.procedimento === null)!;
    await porta.ativarRegra(ctx(), geral.id, { versao: geral.versao, ativo: false });
    const regras = await ler(
      `SELECT tipo_documento_pre_operatorio_id AS tipo, procedimento_cirurgico_id AS proc, validade_dias AS v,
              bloqueia_entrada_sala AS b, gera_pendencia AS g, ativo, versao, criado_por
         FROM documento_exigido_cirurgia WHERE estabelecimento_id = ? ORDER BY id`,
      [m.est],
    );
    expect(
      regras.map((r) => [r['tipo'], r['proc'], r['v'], r['b'], r['g'], r['ativo'], r['versao']]),
    ).toEqual([
      [tipo.tcle, null, null, 1, 0, 1, 1],
      [tipo.exa, m.procedimento, 30, 0, 1, 1, 1],
      [tipo.exa, null, 10, 0, 1, 0, 2],
    ]);
    expect(regras.every((r) => Number(r['criado_por']) === m.usuario)).toBe(true);
  });

  it('lê os exigidos com o estado; outro hospital recebe 404 sem escrita', async () => {
    const d = await porta.documentos(ctx(), m.ag);
    expect(d.dataCirurgia).toBe('2030-03-10');
    expect(d.documentos.map((x) => [x.tipo, x.bloqueia, x.geraPendencia, x.validadeDias, x.estado])).toEqual(
      [
        [tipo.tcle, true, false, null, 'pendente'],
        [tipo.exa, false, true, 30, 'pendente'],
      ].sort((a, b) => Number(a[0]) - Number(b[0])),
    );
    expect(d.digitalizados.map((x) => x.id)).toEqual([m.digitalizado]);
    await expect(porta.documentos(ctx(P2), m.ag)).rejects.toMatchObject({ problema: { status: 404 } });
    await expect(
      porta.registrar(ctx(P2), m.ag, {
        tipo: tipo.exa,
        situacao: 'dispensado',
        observacao: 'justificativa longa',
      }),
    ).rejects.toMatchObject({ problema: { status: 404 } });
    expect(await registros()).toEqual([]);
  });

  it('a confirmação e a entrada no bloco seguem os documentos; cada registro é uma linha nova, nada apagado', async () => {
    await expect(mudar('confirmado')).rejects.toThrow(/documentos-pendentes|não é confirmada/);
    expect(await situacao()).toBe('agendado');
    const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    await porta.registrar(ctx(), m.ag, { tipo: tipo.exa, situacao: 'apresentado', apresentadoEm: hoje });
    expect((await porta.documentos(ctx(), m.ag)).documentos.find((x) => x.tipo === tipo.exa)?.estado).toBe(
      'vencido',
    );
    await expect(mudar('confirmado')).rejects.toThrow(/não é confirmada/);
    await porta.registrar(ctx(), m.ag, {
      tipo: tipo.exa,
      situacao: 'dispensado',
      observacao: 'Exame dispensado pelo cirurgião (sintético)',
    });
    await mudar('confirmado');
    expect(await situacao()).toBe('confirmado');
    await expect(
      porta.registrar(ctx(), m.ag, {
        tipo: tipo.tcle,
        situacao: 'dispensado',
        observacao: 'paciente sem acompanhante',
      }),
    ).rejects.toMatchObject(recusa422);
    await expect(mudar('no-bloco')).rejects.toThrow(/não começa/);
    // A ida direta de confirmado a realizado e o registro do ato com a incisão também exigem o consentimento.
    await expect(mudar('realizado')).rejects.toThrow(/realizada/);
    expect(await situacao()).toBe('confirmado');
    await expect(registrarAto()).rejects.toThrow(/documentos-pendentes|realizada/);
    expect(await ler('SELECT id FROM ato_cirurgico WHERE agendamento_cirurgico_id = ?', [m.ag])).toEqual([]);
    await porta.registrar(ctx(), m.ag, {
      tipo: tipo.tcle,
      situacao: 'apresentado',
      apresentadoEm: hoje,
      digitalizado: m.digitalizado,
    });
    await porta.registrar(ctx(), m.ag, {
      tipo: tipo.tcle,
      situacao: 'recusado',
      observacao: 'Assinatura ilegível no termo (sintético)',
    });
    await expect(mudar('no-bloco')).rejects.toThrow(/não começa/);
    await porta.registrar(ctx(), m.ag, { tipo: tipo.tcle, situacao: 'apresentado', apresentadoEm: hoje });
    await mudar('no-bloco');
    expect(await situacao()).toBe('no_bloco');
    const r = await registros();
    expect(r.map((x) => [x['sequencia'], x['tipo'], x['situacao'], x['arquivo']])).toEqual([
      [1, tipo.exa, 'apresentado', null],
      [2, tipo.exa, 'dispensado', null],
      [3, tipo.tcle, 'apresentado', m.arquivo],
      [4, tipo.tcle, 'recusado', null],
      [5, tipo.tcle, 'apresentado', null],
    ]);
    expect(r.every((x) => Number(x['conferente']) === m.usuario && Number(x['conferido']) === 1)).toBe(true);
    const trilha = await ler(
      `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'documento_cirurgia_apresentado'
          AND entidade_id IN (SELECT id FROM documento_cirurgia_apresentado WHERE agendamento_cirurgico_id = ?)`,
      [m.ag],
    );
    expect(Number(trilha[0]?.['n'])).toBe(5);
    const d = await porta.documentos(ctx(), m.ag);
    expect(d.historico).toHaveLength(5);
    expect(d.documentos.every((x) => x.estado === 'apresentado' || x.estado === 'dispensado')).toBe(true);
  });
});
