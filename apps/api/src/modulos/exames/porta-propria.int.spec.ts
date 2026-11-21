// Integração da porta própria da agenda de exames contra o MariaDB real (cliente f22_o1, já criado pela obra da
// onda 1). Massa SINTÉTICA com códigos "L0105" (nenhuma pessoa real). Contrato de efeito de cada gravação: linhas,
// versão, trilha e outbox; e as recusas (horário ocupado, entrada inválida, outro estabelecimento, última fonte,
// marcação de agenda que não é de exame, horário extra no mesmo início). A bateria comum de gerar, marcar, cancelar e
// remarcar roda sobre as duas fábricas (memória e banco) num describe.each.
// No fim, a massa de negócio é apagada; ficam o estabelecimento e o usuário de teste, que a trilha (só inclusão)
// referencia. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { type ContextoNucleo, type ContextoOperacao, type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContextoPortaM18 } from './apoio-gravacao.js';
import type { PortaExame } from './porta.js';
import { PortaExameMemoria } from './porta-memoria.js';
import { PortaExamePropria } from './porta-propria.js';
import { civil, instanteCivil } from './relogio.js';

const CLIENTE = 'f22_o1';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L0105';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

function codigoDe(e: unknown): string | null {
  return e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : null;
}

describe.skipIf(SEM_BANCO)('porta própria da agenda de exames (MariaDB, cliente f22_o1)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaExamePropria;
  const ids = {
    est: 0,
    outroEst: 0,
    usuario: 0,
    agenda: 0,
    fonte: 0,
    fonte2: 0,
    paciente: 0,
    pessoa: 0,
    exame: 0,
    catExame: 0,
    catConsulta: 0,
  };
  let ctx: ContextoNucleo;
  const dia = civil(new Date(Date.now() + 3 * 86_400_000)).data;
  const opCtx = (c: ContextoNucleo = ctx): ContextoOperacao => ({ ...c, chaveIdempotencia: `t0105-${randomUUID()}` });

  const limpar = (e: Escritor) =>
    (async () => {
      const a = [ids.agenda];
      await e.executar(
        `DELETE cm FROM cancelamento_marcacao cm JOIN marcacao_horario m ON m.id = cm.marcacao_horario_id
          JOIN horario_agenda h ON h.id = m.horario_agenda_id WHERE h.agenda_servico_id = ?`,
        a,
      );
      await e.executar(
        `DELETE i FROM marcacao_horario_item i JOIN marcacao_horario m ON m.id = i.marcacao_horario_id
          JOIN horario_agenda h ON h.id = m.horario_agenda_id WHERE h.agenda_servico_id = ?`,
        a,
      );
      await e.executar('UPDATE marcacao_horario SET remarcada_marcacao_horario_id = NULL WHERE estabelecimento_id = ?', [
        ids.est,
      ]);
      await e.executar(
        `DELETE m FROM marcacao_horario m JOIN horario_agenda h ON h.id = m.horario_agenda_id
          WHERE h.agenda_servico_id = ?`,
        a,
      );
      await e.executar('DELETE FROM horario_agenda WHERE agenda_servico_id = ?', a);
      await e.executar('DELETE FROM geracao_grade WHERE agenda_servico_id = ?', a);
      await e.executar('DELETE FROM agenda_fonte_pagadora WHERE agenda_servico_id = ?', a);
      await e.executar('DELETE FROM agenda_escala WHERE agenda_servico_id = ?', a);
      await e.executar('UPDATE agenda_servico SET categoria_agenda_id = ? WHERE id = ?', [ids.catExame, ids.agenda]);
    })();

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe('cliente_f22_o1');
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-01-05' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `ESTAB ${codigo} SINTETICO`, `ESTAB ${codigo} SINTETICO`, agora],
        );
      ids.est = await est(P);
      ids.outroEst = await est(`${P}B`);
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['l0105.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['l0105.teste', 'USUARIO SINTETICO L0105', agora],
      );
      const cat = await garantir(
        e,
        'SELECT id FROM categoria_agenda WHERE codigo = ?',
        [`${P}-EXA`],
        "INSERT INTO categoria_agenda (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'exame', ?)",
        [`${P}-EXA`, 'EXAMES SINTETICOS', agora],
      );
      ids.catExame = cat;
      ids.catConsulta = await garantir(
        e,
        'SELECT id FROM categoria_agenda WHERE codigo = ?',
        [`${P}-CON`],
        "INSERT INTO categoria_agenda (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'consulta', ?)",
        [`${P}-CON`, 'CONSULTAS SINTETICAS', agora],
      );
      const setor = await garantir(
        e,
        'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-SADT`],
        "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, ?, 'apoio_diagnostico', ?)",
        [ids.est, `${P}-SADT`, 'SADT SINTETICO', agora],
      );
      ids.agenda = await garantir(
        e,
        'SELECT id FROM agenda_servico WHERE estabelecimento_id = ? AND nome = ?',
        [ids.est, `ULTRASSOM ${P}`],
        `INSERT INTO agenda_servico (estabelecimento_id, nome, categoria_agenda_id, setor_funcional_id,
           duracao_horario_minutos, criado_em) VALUES (?, ?, ?, ?, 20, ?)`,
        [ids.est, `ULTRASSOM ${P}`, cat, setor, agora],
      );
      const fonte = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM fonte_pagadora WHERE codigo = ?',
          [codigo],
          "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, ?, 'operadora', 'ativa', ?)",
          [codigo, `OPERADORA ${codigo} SINTETICA`, agora],
        );
      ids.fonte = await fonte(`${P}-A`);
      ids.fonte2 = await fonte(`${P}-B`);
      ids.pessoa = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [`PACIENTE SINTETICO ${P}`],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        [`PACIENTE SINTETICO ${P}`, agora],
      );
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [ids.pessoa],
        "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, ?, 'ativo', ?)",
        [ids.pessoa, 910_105_001, agora],
      );
      ids.exame = await garantir(
        e,
        'SELECT id FROM exame WHERE codigo = ?',
        [`${P}-USG`],
        "INSERT INTO exame (codigo, sigla, nome, tipo_servico, criado_em) VALUES (?, ?, ?, 'outro', ?)",
        [`${P}-USG`, 'USGL', 'ULTRASSONOGRAFIA SINTETICA', agora],
      );
      await garantir(
        e,
        "SELECT id FROM tipo_marcacao WHERE natureza = 'exame' AND ativo = TRUE ORDER BY id LIMIT 1",
        [],
        "INSERT INTO tipo_marcacao (codigo, descricao, natureza, criado_em) VALUES (?, 'EXAME', 'exame', ?)",
        [`${P}-EXAME`, agora],
      );
      for (const s of ['aguardando', 'cancelada'])
        await garantir(
          e,
          'SELECT id FROM situacao_marcacao WHERE significado = ? AND ativo = TRUE ORDER BY ordem, id LIMIT 1',
          [s],
          'INSERT INTO situacao_marcacao (codigo, descricao, significado, criado_em) VALUES (?, ?, ?, ?)',
          [`${P}-${s}`.slice(0, 30), s.toUpperCase(), s, agora],
        );
      await garantir(
        e,
        "SELECT id FROM canal_marcacao WHERE codigo = 'telefone'",
        [],
        "INSERT INTO canal_marcacao (codigo, descricao, criado_em) VALUES ('telefone', 'TELEFONE', ?)",
        [agora],
      );
      for (const m of ['PAC-DESISTIU', 'PAC-OUTRA-DATA'])
        await garantir(
          e,
          'SELECT id FROM motivo_cancelamento_operacao WHERE codigo = ?',
          [m],
          'INSERT INTO motivo_cancelamento_operacao (codigo, descricao, criado_em) VALUES (?, ?, ?)',
          [m, m === 'PAC-DESISTIU' ? 'Paciente desistiu' : 'Paciente pediu outra data', agora],
        );
      await garantir(
        e,
        "SELECT id FROM sequencia_negocio WHERE tipo = 'marcacao_horario' AND estabelecimento_id = ?",
        [ids.est],
        "INSERT INTO sequencia_negocio (estabelecimento_id, tipo, prefixo, criado_em) VALUES (?, 'marcacao_horario', 'MX-', ?)",
        [ids.est, agora],
      );
      await limpar(e);
    });
    ctx = { cliente: CLIENTE, estabelecimento: ids.est, usuario: ids.usuario, correlacao: 'teste-01-05' };
    porta = new PortaExamePropria(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    if (ids.agenda) await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-01-05' }, limpar);
    await nucleo.encerrar();
  });

  const ler = <T>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conferencia-01-05' }, (l) => l.consultar<T & Record<string, unknown>>(sql, p));

  it('lista a agenda de exames do estabelecimento (e não a de outro)', async () => {
    const ags = await porta.agendas(ctx);
    const a = ags.find((x) => x.id === ids.agenda);
    expect(a).toMatchObject({ ativa: true, duracao: '0020', convenios: 0 });
    expect(await porta.agendas({ ...ctx, estabelecimento: ids.outroEst })).not.toContainEqual(
      expect.objectContaining({ id: ids.agenda }),
    );
  });

  it('gera a grade pelo Executor: geração, horários, trilha e outbox; a mesma chave não grava de novo', async () => {
    const entrada = {
      agenda: ids.agenda,
      de: dia,
      ate: dia,
      duracao: '0020',
      horarios: ['0800', '0820', '0840'].map((hora) => ({ data: dia, hora })),
      escala: [{ semana: 2, duracao: '0020', horaInicio: '0800', horaFim: '0900', intervaloInicio: '0000', intervaloFim: '0000' }],
      semanas: ['F', 'T', 'T', 'T', 'T', 'T', 'F'],
    };
    const c = opCtx();
    const r = await porta.executar(ctx, 'agenda.gerarGradeExame', entrada, c);
    expect(r.repetida).toBe(false);
    expect(r.resultado['horarios']).toBe(3);
    expect(r.trilha).toBeGreaterThan(0);
    const h = await ler('SELECT situacao, vagas_ocupadas, versao FROM horario_agenda WHERE agenda_servico_id = ?', [ids.agenda]);
    expect(h).toHaveLength(3);
    expect(h.every((x) => x['situacao'] === 'livre' && Number(x['versao']) === 1)).toBe(true);
    const [g] = await ler('SELECT situacao, horarios_gerados FROM geracao_grade WHERE id = ?', [r.resultado['geracao']]);
    expect(g).toMatchObject({ situacao: 'concluida', horarios_gerados: 3 });
    const [t] = await ler('SELECT entidade, estabelecimento_id FROM trilha_auditoria WHERE id = ?', [r.trilha]);
    expect(t).toMatchObject({ entidade: 'geracao_grade', estabelecimento_id: ids.est });
    const out = await ler("SELECT id FROM integracao_mensagem WHERE tipo = 'agenda.exame.grade_gerada' AND correlacao = ?", [
      c.correlacao,
    ]).catch(() => null);
    if (out) expect(out.length).toBeGreaterThan(0);
    const de2 = await porta.executar(ctx, 'agenda.gerarGradeExame', entrada, c);
    expect(de2.repetida).toBe(true);
    expect(await ler('SELECT id FROM horario_agenda WHERE agenda_servico_id = ?', [ids.agenda])).toHaveLength(3);
    const vagas = await porta.vagas(ctx, { agendas: [ids.agenda], de: dia, ate: dia });
    expect(vagas.itens.map((v) => v.hora)).toEqual(['0800', '0820', '0840']);
  });

  it('marca o exame: marcação numerada, item do exame, horário ocupado com nova versão; recusa o horário ocupado', async () => {
    const entrada = {
      agenda: ids.agenda,
      data: dia,
      hora: '0800',
      paciente: ids.paciente,
      convenio: ids.fonte,
      exame: ids.exame,
      solicitante: null,
      retorno: false,
      canal: 'telefone',
    };
    const r = await porta.executar(ctx, 'agenda.agendarExame', entrada, opCtx());
    const id = Number(r.resultado['marcacao']);
    const [m] = await ler('SELECT numero, versao, paciente_id FROM marcacao_horario WHERE id = ?', [id]);
    expect(String(m?.['numero'])).toMatch(/^MX-/);
    expect(await ler('SELECT exame_id FROM marcacao_horario_item WHERE marcacao_horario_id = ?', [id])).toEqual([
      expect.objectContaining({ exame_id: ids.exame }),
    ]);
    const [h] = await ler(
      'SELECT h.situacao, h.vagas_ocupadas, h.versao FROM horario_agenda h JOIN marcacao_horario m ON m.horario_agenda_id = h.id WHERE m.id = ?',
      [id],
    );
    expect(h).toMatchObject({ situacao: 'ocupado', vagas_ocupadas: 1, versao: 2 });
    const grade = await porta.horarios(ctx, ids.agenda, dia, dia);
    expect(grade.itens[0]).toMatchObject({ hora: '0800', estado: 'marcado', marcacao: id });
    const lista = await porta.marcacoesDoDia(ctx, dia, ids.agenda);
    expect(lista.itens).toContainEqual(expect.objectContaining({ id, estado: 'marcado', atendido: false, temSenha: false }));
    const det = await porta.marcacao(ctx, id);
    expect(det?.marcacao.prontuario).toBe(910_105_001);
    const ext = await porta.extensoes(ctx, [id]);
    expect(ext.get(id)).toMatchObject({ idExame: ids.exame, canal: 'telefone', retorno: false });
    const erro = await porta.executar(ctx, 'agenda.agendarExame', entrada, opCtx()).catch((e) => e);
    expect(codigoDe(erro)).toBe('horario-ocupado');
  });

  it('recusa entrada inválida e agenda de outro estabelecimento', async () => {
    const invalida = await porta
      .executar(ctx, 'agenda.agendarExame', { agenda: ids.agenda, data: 'amanha' }, opCtx())
      .catch((e) => e);
    expect(codigoDe(invalida)).toBe('entrada-invalida');
    const outro = { ...ctx, estabelecimento: ids.outroEst };
    const fora = await porta
      .executar(
        outro,
        'agenda.agendarExame',
        {
          agenda: ids.agenda,
          data: dia,
          hora: '0820',
          paciente: ids.paciente,
          convenio: ids.fonte,
          exame: null,
          solicitante: null,
          retorno: false,
          canal: 'telefone',
        },
        opCtx(outro),
      )
      .catch((e) => e);
    expect(codigoDe(fora)).toBe('registro-inexistente');
  });

  it('cancela: cancelamento gravado, marcação cancelada e horário livre; e remarca ligando as duas marcações', async () => {
    const [m] = await ler<{ id: number }>(
      `SELECT m.id FROM marcacao_horario m JOIN horario_agenda h ON h.id = m.horario_agenda_id
        WHERE h.agenda_servico_id = ? ORDER BY m.id LIMIT 1`,
      [ids.agenda],
    );
    const id = Number(m?.id);
    await porta.executar(
      ctx,
      'agenda.cancelarExame',
      { marcacao: id, motivo: 'PAC-DESISTIU', solicitante: 'paciente' },
      opCtx(),
    );
    const [cm] = await ler('SELECT horario_liberado, responsavel_usuario_id FROM cancelamento_marcacao WHERE marcacao_horario_id = ?', [id]);
    expect(cm).toMatchObject({ responsavel_usuario_id: ids.usuario });
    const [h] = await ler(
      'SELECT h.situacao, h.vagas_ocupadas FROM horario_agenda h JOIN marcacao_horario m ON m.horario_agenda_id = h.id WHERE m.id = ?',
      [id],
    );
    expect(h).toMatchObject({ situacao: 'livre', vagas_ocupadas: 0 });
    const canc = await porta.cancelamentos(ctx, { de: civil(new Date()).data, ate: civil(new Date()).data, agendas: [ids.agenda], pagina: 1, porPagina: 50 });
    expect(canc.total).toBeGreaterThanOrEqual(1);
    const nova = await porta.executar(
      ctx,
      'agenda.agendarExame',
      {
        agenda: ids.agenda,
        data: dia,
        hora: '0820',
        paciente: ids.paciente,
        convenio: ids.fonte,
        exame: null,
        solicitante: null,
        retorno: false,
        canal: 'telefone',
      },
      opCtx(),
    );
    const antiga = Number(nova.resultado['marcacao']);
    const r = await porta.executar(
      ctx,
      'agenda.remarcarExame',
      { marcacao: antiga, destino: { agenda: ids.agenda, data: dia, hora: '0840' }, modo: 'liberar', canal: 'telefone' },
      opCtx(),
    );
    const [nv] = await ler('SELECT remarcada_marcacao_horario_id FROM marcacao_horario WHERE id = ?', [r.resultado['marcacao']]);
    expect(Number(nv?.['remarcada_marcacao_horario_id'])).toBe(antiga);
    const [cc] = await ler('SELECT nova_marcacao_horario_id FROM cancelamento_marcacao WHERE marcacao_horario_id = ?', [antiga]);
    expect(Number(cc?.['nova_marcacao_horario_id'])).toBe(Number(r.resultado['marcacao']));
  });

  it('fontes pagadoras da agenda: inclui, recusa tirar a última sem confirmar e tira com a confirmação', async () => {
    await porta.executar(ctx, 'agenda.definirCoberturaExame', { agenda: ids.agenda, convenio: ids.fonte2, acao: 'incluir' }, opCtx());
    expect((await porta.convenios(ctx, ids.agenda)).map((x) => x.codigo)).toEqual([ids.fonte2]);
    const ultima = await porta
      .executar(ctx, 'agenda.definirCoberturaExame', { agenda: ids.agenda, convenio: ids.fonte2, acao: 'remover' }, opCtx())
      .catch((e) => e);
    expect(codigoDe(ultima)).toBe('ultima-linha');
    await porta.executar(
      ctx,
      'agenda.definirCoberturaExame',
      { agenda: ids.agenda, convenio: ids.fonte2, acao: 'remover', confirmarAceitarTodos: true },
      opCtx(),
    );
    expect(await porta.convenios(ctx, ids.agenda)).toEqual([]);
    const [l] = await ler('SELECT versao, excluido_por FROM agenda_fonte_pagadora WHERE agenda_servico_id = ?', [ids.agenda]);
    expect(l).toMatchObject({ versao: 2, excluido_por: ids.usuario });
  });

  it('cancelar ou remarcar pela agenda de exames não alcança marcação de agenda de consulta', async () => {
    const marcada = await porta.executar(
      ctx,
      'agenda.agendarExame',
      {
        agenda: ids.agenda,
        data: dia,
        hora: '0800',
        paciente: ids.paciente,
        convenio: ids.fonte,
        exame: null,
        solicitante: null,
        retorno: false,
        canal: 'telefone',
      },
      opCtx(),
    );
    const id = Number(marcada.resultado['marcacao']);
    const trocar = (cat: number) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-01-05-natureza' }, (e) =>
        e.executar('UPDATE agenda_servico SET categoria_agenda_id = ? WHERE id = ?', [cat, ids.agenda]),
      );
    await trocar(ids.catConsulta);
    try {
      const canc = await porta
        .executar(ctx, 'agenda.cancelarExame', { marcacao: id, motivo: 'PAC-DESISTIU', solicitante: 'paciente' }, opCtx())
        .catch((e) => e);
      expect(codigoDe(canc)).toBe('registro-inexistente');
      const rem = await porta
        .executar(
          ctx,
          'agenda.remarcarExame',
          { marcacao: id, destino: { agenda: ids.agenda, data: dia, hora: '0840' }, modo: 'liberar', canal: 'telefone' },
          opCtx(),
        )
        .catch((e) => e);
      expect(codigoDe(rem)).toBe('registro-inexistente');
    } finally {
      await trocar(ids.catExame);
    }
    const [m] = await ler('SELECT s.significado FROM marcacao_horario m JOIN situacao_marcacao s ON s.id = m.situacao_marcacao_id WHERE m.id = ?', [id]);
    expect(m?.['significado']).not.toBe('cancelada');
  });

  it('gerar de novo: reativa o horário excluído (mesma linha) e recusa com mensagem o horário extra no mesmo início', async () => {
    const dia2 = civil(new Date(Date.now() + 5 * 86_400_000)).data;
    const gerar = (hora: string) =>
      porta.executar(
        ctx,
        'agenda.gerarGradeExame',
        {
          agenda: ids.agenda,
          de: dia2,
          ate: dia2,
          duracao: '0020',
          horarios: [{ data: dia2, hora }],
          escala: [{ semana: 2, duracao: '0020', horaInicio: '0900', horaFim: '1000', intervaloInicio: '0000', intervaloFim: '0000' }],
          semanas: ['T', 'T', 'T', 'T', 'T', 'T', 'T'],
        },
        opCtx(),
      );
    const g1 = await gerar('0900');
    const [h1] = await ler<{ id: number }>('SELECT id FROM horario_agenda WHERE geracao_grade_id = ?', [g1.resultado['geracao']]);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-01-05-exclui' }, (e) =>
      e.executar('UPDATE horario_agenda SET excluido_em = NOW(3), versao = versao + 1 WHERE id = ?', [h1?.id]),
    );
    expect((await porta.horarios(ctx, ids.agenda, dia2, dia2)).itens).toEqual([]);
    const g2 = await gerar('0900');
    const [h2] = await ler('SELECT id, excluido_em, geracao_grade_id, situacao, versao FROM horario_agenda WHERE id = ?', [h1?.id]);
    expect(h2).toMatchObject({ excluido_em: null, situacao: 'livre', versao: 3 });
    expect(Number(h2?.['geracao_grade_id'])).toBe(Number(g2.resultado['geracao']));
    expect(await ler('SELECT id FROM horario_agenda WHERE agenda_servico_id = ? AND data_referencia = ?', [ids.agenda, dia2])).toHaveLength(1);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-01-05-extra' }, (e) =>
      e.executar(
        `INSERT INTO horario_agenda (estabelecimento_id, agenda_servico_id, data_referencia, inicio_em, fim_em, tipo_horario, criado_em)
         VALUES (?, ?, ?, ?, ?, 'extra', NOW(3))`,
        [ids.est, ids.agenda, dia2, instanteCivil(dia2, '0920'), instanteCivil(dia2, '0940')],
      ),
    );
    expect(codigoDe(await gerar('0920').catch((e) => e))).toBe('previa-desatualizada');
    expect(await porta.horariosExistentes(ctx, ids.agenda, dia2, dia2)).toEqual([`${dia2} 0900`, `${dia2} 0920`].sort());
  });

  it('escala com pausa, vagas e feriado: a porta entrega tudo e a geração grava as vagas e o pedido de feriados', async () => {
    const dia3 = civil(new Date(Date.now() + 6 * 86_400_000)).data;
    const semana = new Date(`${dia3}T00:00:00Z`).getUTCDay() + 1;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-01-05-escala' }, (e) =>
      e.executar(
        `INSERT INTO agenda_escala (agenda_servico_id, dia_semana, hora_inicio, hora_fim, intervalo_inicio, intervalo_fim,
           vagas_por_horario, atende_feriado, vigencia_inicio, criado_em)
         VALUES (?, ?, '10:00', '11:00', '10:20', '10:40', 2, TRUE, ?, NOW(3))`,
        [ids.agenda, semana, civil(new Date()).data],
      ),
    );
    expect(await porta.escala(ctx, ids.agenda, { de: dia3, ate: dia3 })).toEqual([
      expect.objectContaining({ semana, horaInicio: '1000', horaFim: '1100', intervaloInicio: '1020', intervaloFim: '1040', vagas: 2, atendeFeriado: true }),
    ]);
    expect(await porta.feriados(ctx, dia3, dia3)).toBeNull();
    const r = await porta.executar(
      ctx,
      'agenda.gerarGradeExame',
      {
        agenda: ids.agenda,
        de: dia3,
        ate: dia3,
        duracao: '0020',
        horarios: [{ data: dia3, hora: '1000' }, { data: dia3, hora: '1040' }],
        escala: [{ semana, duracao: '0020', horaInicio: '1000', horaFim: '1100', intervaloInicio: '1020', intervaloFim: '1040' }],
        semanas: ['T', 'T', 'T', 'T', 'T', 'T', 'T'],
        incluirFeriados: true,
      },
      opCtx(),
    );
    const hs = await ler('SELECT vagas FROM horario_agenda WHERE geracao_grade_id = ? ORDER BY inicio_em', [r.resultado['geracao']]);
    expect(hs.map((h) => Number(h['vagas']))).toEqual([2, 2]);
    const [g] = await ler('SELECT inclui_feriados FROM geracao_grade WHERE id = ?', [r.resultado['geracao']]);
    expect(Number(g?.['inclui_feriados'])).toBe(1);
  });

  it('a operação desligada responde que não pode gravar', async () => {
    const p = await porta.podeGravar(ctx, 'agenda.agendarExameSemProntuario');
    expect(p.pode).toBe(false);
    expect((await porta.podeGravar(ctx, 'agenda.agendarExame')).pode).toBe(true);
  });
  // Bateria comum (memória × banco): gerar, marcar, cancelar e remarcar com o mesmo contrato e as mesmas recusas.
  interface Fabrica {
    porta: PortaExame;
    ctx: ContextoPortaM18;
    agenda: number;
    paciente: number;
    convenio: number;
    exame: number;
  }
  const fabricas: [string, () => Fabrica][] = [
    [
      'memória',
      () => ({
        porta: new PortaExameMemoria(
          null,
          async () => [{ id: 501, nome: 'PACIENTE SINTETICO', prontuario: 9001, telefone: null, celular: null, ativo: true }],
          () => ({ hoje: civil(new Date()).data, hhmm: '0000' }),
        ),
        ctx: { cliente: 'sintetico', estabelecimento: 1, usuario: 7, correlacao: 'bateria-01-05' },
        agenda: 951,
        paciente: 501,
        convenio: 10,
        exame: 7001,
      }),
    ],
    [
      'banco',
      () => ({ porta, ctx, agenda: ids.agenda, paciente: ids.paciente, convenio: ids.fonte, exame: ids.exame }),
    ],
  ];

  describe.each(fabricas)('bateria comum da porta de exames (%s)', (_nome, fabrica) => {
    const dia4 = civil(new Date(Date.now() + 60 * 86_400_000)).data;
    const horas = ['0700', '0720', '0740'];
    const op = (f: Fabrica): ContextoOperacao => ({ ...(f.ctx as ContextoNucleo), chaveIdempotencia: `t0105-b-${randomUUID()}` });
    const marcar = (f: Fabrica, hora: string) =>
      f.porta.executar(
        f.ctx,
        'agenda.agendarExame',
        {
          agenda: f.agenda,
          data: dia4,
          hora,
          paciente: f.paciente,
          convenio: f.convenio,
          exame: f.exame,
          solicitante: null,
          retorno: false,
          canal: 'telefone',
        },
        op(f),
      );
    const estados = async (f: Fabrica) =>
      Object.fromEntries((await f.porta.horarios(f.ctx, f.agenda, dia4, dia4)).itens.map((h) => [h.hora, h.estado]));

    it('gera, marca, recusa o ocupado, cancela e remarca liberando o horário antigo', async () => {
      const f = fabrica();
      const gerar = {
        agenda: f.agenda,
        de: dia4,
        ate: dia4,
        duracao: '0020',
        horarios: horas.map((hora) => ({ data: dia4, hora })),
        escala: [{ semana: 2, duracao: '0020', horaInicio: '0700', horaFim: '0800', intervaloInicio: '0000', intervaloFim: '0000' }],
        semanas: ['T', 'T', 'T', 'T', 'T', 'T', 'T'],
      };
      const g = await f.porta.executar(f.ctx, 'agenda.gerarGradeExame', gerar, op(f));
      expect(g.resultado['horarios']).toBe(3);
      expect(await estados(f)).toEqual({ '0700': 'vago', '0720': 'vago', '0740': 'vago' });
      expect(codigoDe(await f.porta.executar(f.ctx, 'agenda.gerarGradeExame', gerar, op(f)).catch((e) => e))).toBe(
        'previa-desatualizada',
      );
      const m1 = Number((await marcar(f, '0700')).resultado['marcacao']);
      expect((await estados(f))['0700']).toBe('marcado');
      expect(codigoDe(await marcar(f, '0700').catch((e) => e))).toBe('horario-ocupado');
      await f.porta.executar(f.ctx, 'agenda.cancelarExame', { marcacao: m1, motivo: 'PAC-DESISTIU', solicitante: 'paciente' }, op(f));
      expect((await estados(f))['0700']).toBe('vago');
      const m2 = Number((await marcar(f, '0720')).resultado['marcacao']);
      const r = await f.porta.executar(
        f.ctx,
        'agenda.remarcarExame',
        { marcacao: m2, destino: { agenda: f.agenda, data: dia4, hora: '0740' }, modo: 'liberar', canal: 'telefone' },
        op(f),
      );
      expect(Number(r.resultado['marcacao'])).not.toBe(m2);
      expect(await estados(f)).toEqual({ '0700': 'vago', '0720': 'vago', '0740': 'marcado' });
    });
  });
});
