// Contrato de efeito do contato ativo com o paciente antes da consulta (02-REC linha 39, C2-040) contra o MariaDB real
// (cliente de teste). A cadeia: marcação aguardando → resposta negativa à confirmação (a "não" da mensagem, gravada em
// confirmacao_marcacao como recusada) → a fila da central põe essa marcação em primeiro → a central liga e registra
// "desistiu" → a marcação fica cancelada com o motivo "desistência do paciente", o horário volta a livre e o contato
// fica realizado. Outra marcação: "não atendeu" → contato sem sucesso e a próxima tentativa programada sozinha → a
// tentativa programada é feita com "confirmou" → a marcação fica confirmada. Sem a permissão de cancelar, a desistência
// é recusada e nada muda. Programar e cancelar o programado (nunca apaga). Histórico por paciente.
// Pendentes: o registro que confirma ou cancela encerra os demais pendentes da marcação; o pendente de outra marcação é
// recusado; programar em marcação que não aguarda é recusado; o pendente órfão (marcação confirmada por outro caminho)
// aparece entre os programados como de consulta encerrada. A vaga liberada pela desistência sinaliza os pedidos da
// lista de espera que servem ao horário (o aguardando da mesma agenda conta; o cancelado não).
// Massa SINTÉTICA (estabelecimento, paciente, agenda e marcações fictícios), limpa antes e depois.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { ContatoAtivoPropria } from './contato-ativo.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const P = 'c2040t';
const NOME_PAC = 'c2040 Paciente sintético';

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar(
    `DELETE FROM contato_ativo WHERE estabelecimento_id IN ${est} AND anterior_contato_ativo_id IS NOT NULL`,
    [P],
  );
  for (const t of [
    'contato_ativo',
    'lista_espera',
    'cancelamento_marcacao',
    'confirmacao_marcacao',
    'marcacao_horario',
    'horario_agenda',
    'agenda_servico',
  ])
    await e.executar(`DELETE FROM ${t} WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar("DELETE FROM categoria_agenda WHERE codigo = 'c2040-cat'");
  const pf = '(SELECT x.id FROM (SELECT id FROM pessoa_fisica WHERE nome = ?) x)';
  await e.executar(`DELETE FROM telefone_pessoa WHERE pessoa_fisica_id IN ${pf}`, [NOME_PAC]);
  await e.executar(`DELETE FROM paciente WHERE pessoa_fisica_id IN ${pf}`, [NOME_PAC]);
  await e.executar('DELETE FROM pessoa_fisica WHERE nome = ?', [NOME_PAC]);
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('02-REC L39 contato ativo antes da consulta (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: ContatoAtivoPropria;
  let m: {
    login: string;
    paciente: number;
    m1: number;
    m2: number;
    h1: number;
    m3: number;
    orfao: number;
  };
  const agora = new Date();
  const em = (horas: number) => new Date(agora.getTime() + horas * 3_600_000);
  let n = 0;
  const ctx = (podeCancelar = true) => ({
    hospital: P,
    login: m.login,
    correlacao: P,
    chaveIdempotencia: `${P}-${Date.now()}-${++n}`,
    podeCancelar,
  });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const erro = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return (e as { problema?: { status?: number; codigo?: string } }).problema ?? {};
    }
    throw new Error('Era para recusar.');
  };
  const situacao = async (id: number) =>
    String(
      (
        await ler(
          `SELECT s.significado FROM marcacao_horario mh JOIN situacao_marcacao s ON s.id = mh.situacao_marcacao_id
            WHERE mh.id = ?`,
          [id],
        )
      )[0]!['significado'],
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    porta = new ContatoAtivoPropria(nucleo, CLIENTE, () => new Date());
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const u = (await e.uma('SELECT id, login FROM usuario WHERE excluido_em IS NULL ORDER BY id LIMIT 1'))!;
      const usuario = u['id'];
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, 'Hospital Teste', 'Hospital sintético (fictício)', 'America/Sao_Paulo', ?)`,
        [P, agora],
      );
      const pf = await e.inserir('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
        NOME_PAC,
        agora,
      ]);
      const pront = await e.uma('SELECT COALESCE(MAX(numero_prontuario), 0) + 1 AS n FROM paciente');
      const paciente = await e.inserir(
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pf, pront!['n'], agora],
      );
      await e.executar(
        `INSERT INTO telefone_pessoa (pessoa_fisica_id, sequencia, tipo_telefone_id, ddd, numero, principal, criado_em)
         VALUES (?, 1, 1, '11', '999990040', TRUE, ?)`,
        [pf, agora],
      );
      for (const sig of ['confirmada', 'recusada']) {
        const ja = await e.uma('SELECT id FROM situacao_confirmacao WHERE significado = ? AND ativo', [sig]);
        if (!ja)
          await e.executar(
            'INSERT INTO situacao_confirmacao (codigo, descricao, significado, criado_em) VALUES (?, ?, ?, ?)',
            [`c2040-${sig}`, `Sintética ${sig}`, sig, agora],
          );
      }
      const cat = await e.inserir(
        "INSERT INTO categoria_agenda (codigo, descricao, criado_em) VALUES ('c2040-cat', 'Categoria sintética', ?)",
        [agora],
      );
      const agenda = await e.inserir(
        `INSERT INTO agenda_servico (estabelecimento_id, nome, categoria_agenda_id, profissional_id,
         duracao_horario_minutos, criado_em)
         VALUES (?, 'Clínica sintética C2040', ?, (SELECT MIN(id) FROM profissional WHERE excluido_em IS NULL), 15, ?)`,
        [est, cat, agora],
      );
      const aguardando = (await e.uma(
        "SELECT id FROM situacao_marcacao WHERE significado = 'aguardando' ORDER BY id LIMIT 1",
      ))!['id'];
      const canal = (await e.uma('SELECT MIN(id) AS id FROM canal_marcacao'))!['id'];
      const tipo = (await e.uma('SELECT MIN(id) AS id FROM tipo_marcacao'))!['id'];
      const fonte = (await e.uma('SELECT MIN(id) AS id FROM fonte_pagadora'))!['id'];
      const marcacao = async (k: number, inicio: Date) => {
        const h = await e.inserir(
          `INSERT INTO horario_agenda (estabelecimento_id, agenda_servico_id, data_referencia, inicio_em, fim_em,
           situacao, vagas_ocupadas, criado_em) VALUES (?, ?, ?, ?, ?, 'ocupado', 1, ?)`,
          [
            est,
            agenda,
            inicio.toISOString().slice(0, 10),
            inicio,
            new Date(inicio.getTime() + 900_000),
            agora,
          ],
        );
        const id = await e.inserir(
          `INSERT INTO marcacao_horario (estabelecimento_id, numero, horario_agenda_id, paciente_id, tipo_marcacao_id,
           situacao_marcacao_id, canal_marcacao_id, fonte_pagadora_id, duracao_minutos, marcado_em,
           responsavel_usuario_id, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 15, ?, ?, ?)`,
          [est, `C2040-${k}`, h, paciente, tipo, aguardando, canal, fonte, agora, usuario, agora],
        );
        return { id, h };
      };
      // m1: daqui a 30 h; m2: daqui a 50 h. A m2 recebeu "não" na mensagem de confirmação (resposta negativa).
      const a = await marcacao(1, em(30));
      const b = await marcacao(2, em(50));
      const recusada = (await e.uma(
        "SELECT id FROM situacao_confirmacao WHERE significado = 'recusada' AND ativo ORDER BY ordem, id LIMIT 1",
      ))!['id'];
      await e.executar(
        `INSERT INTO confirmacao_marcacao (estabelecimento_id, marcacao_horario_id, tentativa, canal_marcacao_id,
         situacao_confirmacao_id, automatica, solicitada_em, respondida_em, observacao, criado_em)
         VALUES (?, ?, 1, ?, ?, TRUE, ?, ?, 'Resposta negativa na mensagem (sintética).', ?)`,
        [est, b.id, canal, recusada, agora, agora, agora],
      );
      // m3: daqui a 40 h, confirmada por outro caminho (a resposta "sim" da mensagem) com um pendente que ficou órfão.
      const c = await marcacao(3, em(40));
      await e.executar(
        `UPDATE marcacao_horario SET situacao_marcacao_id =
           (SELECT id FROM situacao_marcacao WHERE significado = 'confirmada' AND ativo ORDER BY ordem, id LIMIT 1)
          WHERE id = ?`,
        [c.id],
      );
      const orfao = await e.inserir(
        `INSERT INTO contato_ativo (estabelecimento_id, paciente_id, marcacao_horario_id, canal, motivo, situacao,
         programado_para, criado_em) VALUES (?, ?, ?, 'telefone', 'lembrete', 'pendente', ?, ?)`,
        [est, paciente, c.id, em(-1), agora],
      );
      // Lista de espera da agenda: um pedido aguardando (serve à vaga) e um cancelado (não conta).
      for (const sit of ['aguardando', 'cancelado'])
        await e.executar(
          `INSERT INTO lista_espera (estabelecimento_id, paciente_id, agenda_servico_id, situacao, entrada_em,
           responsavel_usuario_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [est, paciente, agenda, sit, agora, usuario, agora],
        );
      return {
        login: String(u['login']),
        paciente,
        m1: a.id,
        m2: b.id,
        h1: b.h,
        m3: c.id,
        orfao: Number(orfao),
      };
    });
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, (e) => limpar(e));
    await nucleo.encerrar();
  });

  it('fila → desistência cancela e libera a vaga; não atendeu → nova tentativa → confirmou', async () => {
    const resultados = await porta.resultados(ctx());
    expect(resultados.map((r) => r.codigo)).toEqual(
      expect.arrayContaining(['confirmou', 'desistiu', 'nao_atendeu', 'numero_errado']),
    );
    expect(resultados.find((r) => r.codigo === 'desistiu')!.efeitoMarcacao).toBe('cancelar');

    // 1) A fila: a resposta negativa (m2) vem antes da consulta mais próxima (m1).
    const f = await porta.fila(ctx(), 3);
    expect(f.itens.map((i) => i.marcacao)).toEqual([m.m2, m.m1]);
    expect(f.itens[0]).toMatchObject({ respostaNegativa: true, tentativas: 0, telefone: '11999990040' });
    // O pendente órfão da m3 (confirmada pela mensagem) aparece entre os programados, como de consulta encerrada.
    expect(f.programados.map((x) => [x.id, x.marcacaoEncerrada])).toEqual([[m.orfao, true]]);

    // 2) Sem a permissão de cancelar, a desistência é recusada e nada muda.
    const base = {
      paciente: m.paciente,
      canal: 'telefone',
      motivo: 'confirmacao_marcacao',
      contatoEm: new Date().toISOString(),
    };
    // Um contato programado na m2 (lembrete), que a desistência vai encerrar.
    const pm2 = await porta.programar(ctx(), {
      paciente: m.paciente,
      marcacao: m.m2,
      canal: 'whatsapp',
      motivo: 'lembrete',
      programadoPara: em(10).toISOString(),
    });
    const semPermissao = await erro(
      porta.registrar(ctx(false), { ...base, marcacao: m.m2, resultado: 'desistiu' }),
    );
    expect(semPermissao.codigo).toBe('sem-permissao-cancelar');
    expect(await situacao(m.m2)).toBe('aguardando');

    // 3) A central liga e o paciente desiste: cancelada com o motivo, horário livre, contato realizado.
    const d = await porta.registrar(ctx(), {
      ...base,
      marcacao: m.m2,
      resultado: 'desistiu',
      descricao: 'Paciente viaja na data (sintético).',
    });
    expect(d.resultado).toMatchObject({
      efeito: 'cancelar',
      novaTentativa: null,
      pendentesEncerrados: 1,
      esperaCompativel: 1,
    });
    const encerrado = await ler('SELECT situacao, descricao FROM contato_ativo WHERE id = ?', [
      pm2.resultado.contato,
    ]);
    expect(encerrado[0]).toMatchObject({ situacao: 'cancelado' });
    expect(String(encerrado[0]!['descricao'])).toMatch(/desistência/);
    // Programar na marcação cancelada é recusado (o pendente ficaria fora da fila).
    expect(
      (
        await erro(
          porta.programar(ctx(), {
            paciente: m.paciente,
            marcacao: m.m2,
            canal: 'telefone',
            motivo: 'lembrete',
            programadoPara: em(5).toISOString(),
          }),
        )
      ).codigo,
    ).toBe('programacao-invalida');
    expect(await situacao(m.m2)).toBe('cancelada');
    const canc = await ler(
      `SELECT mc.codigo, c.solicitante, c.horario_liberado FROM cancelamento_marcacao c
         JOIN motivo_cancelamento_operacao mc ON mc.id = c.motivo_cancelamento_operacao_id
        WHERE c.marcacao_horario_id = ?`,
      [m.m2],
    );
    expect(canc).toEqual([{ codigo: 'desistencia_paciente', solicitante: 'paciente', horario_liberado: 1 }]);
    const h = await ler('SELECT situacao, vagas_ocupadas FROM horario_agenda WHERE id = ?', [m.h1]);
    expect(h[0]).toMatchObject({ situacao: 'livre', vagas_ocupadas: 0 });
    const c1 = await ler(
      `SELECT c.situacao, r.codigo, c.usuario_id IS NOT NULL AS com_usuario FROM contato_ativo c
         JOIN resultado_contato r ON r.id = c.resultado_contato_id WHERE c.id = ?`,
      [d.resultado.contato],
    );
    expect(c1[0]).toMatchObject({ situacao: 'realizado', codigo: 'desistiu', com_usuario: 1 });
    // De novo na mesma marcação: já cancelada, recusa.
    expect(
      (await erro(porta.registrar(ctx(), { ...base, marcacao: m.m2, resultado: 'desistiu' }))).codigo,
    ).toBe('marcacao-encerrada');

    // 4) Na m1, não atendeu: sem sucesso e a próxima tentativa programada sozinha (4 h depois).
    const na = await porta.registrar(ctx(), { ...base, marcacao: m.m1, resultado: 'nao_atendeu' });
    expect(na.resultado.efeito).toBe(null);
    expect(na.resultado.novaTentativa).toBeGreaterThan(0);
    const pend = await ler(
      'SELECT situacao, anterior_contato_ativo_id AS anterior, programado_para FROM contato_ativo WHERE id = ?',
      [na.resultado.novaTentativa],
    );
    expect(pend[0]).toMatchObject({ situacao: 'pendente', anterior: na.resultado.contato });
    expect(new Date(pend[0]!['programado_para'] as string).getTime()).toBeGreaterThan(
      Date.now() + 3 * 3_600_000,
    );
    expect(await situacao(m.m1)).toBe('aguardando');
    const f2 = await porta.fila(ctx(), 3);
    expect(f2.itens.map((i) => i.marcacao)).toEqual([m.m1]);
    expect(f2.itens[0]).toMatchObject({ tentativas: 1, contatoPendente: na.resultado.novaTentativa });

    // O pendente da m1 não pode ser feito com outra marcação (nem sem marcação).
    expect(
      (
        await erro(
          porta.registrar(ctx(), {
            ...base,
            motivo: 'busca_ativa',
            marcacao: null,
            pendente: na.resultado.novaTentativa,
            resultado: 'nao_atendeu',
          }),
        )
      ).codigo,
    ).toBe('pendente-de-outra-marcacao');
    // Outro pendente na m1 (lembrete por SMS), que a confirmação vai encerrar.
    const pm1 = await porta.programar(ctx(), {
      paciente: m.paciente,
      marcacao: m.m1,
      canal: 'sms',
      motivo: 'lembrete',
      programadoPara: em(6).toISOString(),
    });

    // 5) A tentativa programada é feita: confirmou. O programado vira realizado (sem linha nova) e a marcação confirma.
    const ok = await porta.registrar(ctx(), {
      ...base,
      marcacao: m.m1,
      pendente: na.resultado.novaTentativa,
      canal: 'whatsapp',
      resultado: 'confirmou',
    });
    expect(ok.resultado).toMatchObject({
      contato: na.resultado.novaTentativa,
      efeito: 'confirmar',
      pendentesEncerrados: 1,
      esperaCompativel: null,
    });
    expect(
      (await ler('SELECT situacao FROM contato_ativo WHERE id = ?', [pm1.resultado.contato]))[0],
    ).toEqual({
      situacao: 'cancelado',
    });
    expect(await situacao(m.m1)).toBe('confirmada');
    const conf = await ler(
      `SELECT c.automatica, s.significado, c.observacao FROM confirmacao_marcacao c
         JOIN situacao_confirmacao s ON s.id = c.situacao_confirmacao_id WHERE c.marcacao_horario_id = ?`,
      [m.m1],
    );
    expect(conf).toEqual([
      { automatica: 0, significado: 'confirmada', observacao: 'Confirmada no contato ativo da central.' },
    ]);
    expect((await porta.fila(ctx(), 3)).itens).toEqual([]);
    // O órfão da m3 é cancelado pela central.
    await porta.cancelar(ctx(), { id: m.orfao, motivo: 'Consulta já confirmada pela mensagem.' });

    // 6) Programar uma busca ativa sem marcação e cancelar o programado (fica, com a situação cancelado).
    const pr = await porta.programar(ctx(), {
      paciente: m.paciente,
      canal: 'telefone',
      motivo: 'busca_ativa',
      programadoPara: em(2).toISOString(),
      assunto: 'Retorno do exame (sintético)',
    });
    expect((await porta.fila(ctx(), 3)).programados.map((x) => x.id)).toEqual([pr.resultado.contato]);
    expect(
      (
        await erro(
          porta.programar(ctx(), {
            paciente: m.paciente,
            canal: 'telefone',
            motivo: 'lembrete',
            programadoPara: em(-5).toISOString(),
          }),
        )
      ).codigo,
    ).toBe('programacao-invalida');
    await porta.cancelar(ctx(), { id: pr.resultado.contato, motivo: 'Paciente já retornou.' });
    expect((await erro(porta.cancelar(ctx(), { id: pr.resultado.contato, motivo: 'De novo.' }))).codigo).toBe(
      'contato-ja-feito',
    );

    // 7) Visão por paciente: os 7 contatos (desistiu, não atendeu, confirmou; os pendentes encerrados da m1 e da m2, o
    // órfão e o programado cancelados), nada apagado.
    const hist = await porta.historico(ctx(), m.paciente);
    expect(hist.map((x) => x.situacao).sort()).toEqual([
      'cancelado',
      'cancelado',
      'cancelado',
      'cancelado',
      'realizado',
      'realizado',
      'sem_sucesso',
    ]);
    // A trilha: as gravações do contato ficaram na trilha de auditoria, na mesma transação.
    const trilha = await ler(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE correlacao = ? AND entidade = 'contato_ativo'",
      [P],
    );
    expect(Number(trilha[0]!['n'])).toBeGreaterThanOrEqual(4);
  }, 120_000);
});
