// Contrato de efeito da F78.04-1 (04-INT linhas 74, 75 e 78) contra o MariaDB real (cliente de teste), num
// estabelecimento SINTÉTICO. Atendimento, internação, paciente, usuário e profissional são ids já existentes do
// cliente (só lidos); o resto é massa sintética apagada no fim. Prova o que fica no banco:
//   - formulários de declaração de óbito: lote recebido (uma linha por número), lote repetido recusado, conciliação
//     (formulário 'utilizado' ligado à declaração de mesmo número e a declaração apontando o formulário), uso em
//     declaração cancelada recusado, extravio só com motivo, cancelamento e devolução das vias;
//   - auditoria do isolamento: critérios em ordem, auditoria concluída com conformidade e percentual calculados e uma
//     linha por critério, critério faltando recusado, visão por paciente e cancelamento com motivo (nunca apagada);
//   - regulação: quadro clínico com sequência, evento de evolução e sinais vigentes na solicitação; eventos com a
//     situação anterior e a nova, marcas de regulada e encerrada, versão velha recusada e solicitação encerrada sem
//     quadro novo. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaControlesAssistenciaisPropria } from './controles-assistenciais-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const P = 'f78041';

interface Massa {
  est: number;
  usuario: number;
  paciente: number;
  profissional: number;
  declaracao: number;
  declaracaoCancelada: number;
  tipo: number;
  isolamento: number;
  solicitacao: number;
  suporte: number;
}

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    const auds = `(SELECT a.id FROM auditoria_isolamento a JOIN isolamento_paciente i ON i.id = a.isolamento_paciente_id WHERE i.estabelecimento_id IN ${est})`;
    await e.executar(`DELETE FROM auditoria_isolamento_item WHERE auditoria_isolamento_id IN ${auds}`, [P]);
    await e.executar(
      `DELETE FROM auditoria_isolamento WHERE isolamento_paciente_id IN (SELECT id FROM isolamento_paciente WHERE estabelecimento_id IN ${est})`,
      [P],
    );
    await e.executar(
      'DELETE FROM criterio_auditoria_isolamento WHERE tipo_precaucao_id IN (SELECT id FROM tipo_precaucao WHERE codigo = ?)',
      [P],
    );
    const sols = `(SELECT id FROM solicitacao_regulacao WHERE estabelecimento_id IN ${est})`;
    await e.executar(`DELETE FROM evento_regulacao WHERE solicitacao_regulacao_id IN ${sols}`, [P]);
    await e.executar(`DELETE FROM quadro_clinico_regulacao WHERE solicitacao_regulacao_id IN ${sols}`, [P]);
    for (const t of [
      'aviso_clinico',
      'solicitacao_regulacao',
      'isolamento_paciente',
      'formulario_declaracao_obito',
      'declaracao_obito',
    ])
      await e.executar(`DELETE FROM ${t} WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar('DELETE FROM tipo_precaucao WHERE codigo = ?', [P]);
    await e.executar('DELETE FROM central_reguladora WHERE sigla = ?', [P.toUpperCase()]);
    await e.executar('DELETE FROM suporte_oxigenio WHERE codigo = ?', [P]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('PortaControlesAssistenciaisPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaControlesAssistenciaisPropria;
  let m: Massa;
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const uma = async (sql: string, p: unknown[] = []) => (await ler(sql, p))[0]!;
  const falha = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return `${String(e)} ${JSON.stringify(e)}`;
    }
    throw new Error('era para recusar');
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const prof = await e.uma('SELECT MIN(id) AS id FROM profissional WHERE excluido_em IS NULL');
      const int = await e.uma(
        'SELECT id, atendimento_id, paciente_id FROM internacao WHERE excluido_em IS NULL ORDER BY id LIMIT 1',
      );
      if (!usuario?.['id'] || !prof?.['id'] || !int?.['id'])
        throw new Error('O cliente de teste precisa de usuário, profissional e internação.');
      const paciente = Number(int['paciente_id']);
      const atendimento = Number(int['atendimento_id']);
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const declarar = (numero: string, situacao: 'emitida' | 'cancelada') =>
        e.inserir(
          `INSERT INTO declaracao_obito (estabelecimento_id, atendimento_id, paciente_id, numero, obito_em, profissional_id,
             situacao, emitida_em, cancelada_em, motivo_cancelamento, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            est,
            atendimento,
            paciente,
            numero,
            agora,
            Number(prof['id']),
            situacao,
            agora,
            situacao === 'cancelada' ? agora : null,
            situacao === 'cancelada' ? 'Sintético: cancelada no preparo' : null,
            agora,
          ],
        );
      const tipo = await e.inserir(
        'INSERT INTO tipo_precaucao (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [P, `Precaução sintética ${P}`, agora],
      );
      const isolamento = await e.inserir(
        `INSERT INTO isolamento_paciente (estabelecimento_id, paciente_id, atendimento_id, internacao_id, tipo_precaucao_id,
           motivo_precaucao, data_hora_inicio, situacao, criado_em) VALUES (?, ?, ?, ?, ?, 'kpc', ?, 'ativo', ?)`,
        [est, paciente, atendimento, Number(int['id']), tipo, agora, agora],
      );
      const central = await e.inserir(
        "INSERT INTO central_reguladora (sigla, nome, esfera, forma_conexao, criado_em) VALUES (?, ?, 'estadual', 'manual', ?)",
        [P.toUpperCase(), `CENTRAL SINTETICA ${P}`, agora],
      );
      const solicitacao = await e.inserir(
        `INSERT INTO solicitacao_regulacao (estabelecimento_id, central_reguladora_id, sentido, situacao, solicitado_em,
           paciente_id, criado_em) VALUES (?, ?, 'saida', 'solicitada', ?, ?, ?)`,
        [est, central, agora, paciente, agora],
      );
      const suporte = await e.inserir(
        'INSERT INTO suporte_oxigenio (codigo, descricao, ativo, invasivo, criado_em) VALUES (?, ?, TRUE, FALSE, ?)',
        [P, `Máscara sintética ${P}`, agora],
      );
      return {
        est,
        usuario: Number(usuario['id']),
        paciente,
        profissional: Number(prof['id']),
        declaracao: await declarar('7800001', 'emitida'),
        declaracaoCancelada: await declarar('7800002', 'cancelada'),
        tipo,
        isolamento,
        solicitacao,
        suporte,
      };
    });
    porta = new PortaControlesAssistenciaisPropria(nucleo, CLIENTE);
  }, 60_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  });

  it('formulários de óbito: lote, conciliação, uso recusado, extravio, cancelamento e devolução', async () => {
    const r = await porta.receberLote(ctx(), {
      inicial: '7800001',
      final: '7800004',
      lote: 'L-1',
      recebidoEm: '2026-11-20',
      orgao: 'Secretaria municipal sintética',
    });
    expect(r.quantidade).toBe(4);
    const linhas = await ler(
      'SELECT numero, situacao, lote_recebimento FROM formulario_declaracao_obito WHERE estabelecimento_id = ? ORDER BY numero',
      [m.est],
    );
    expect(linhas.map((l) => [l['numero'], l['situacao'], l['lote_recebimento']])).toEqual([
      ['7800001', 'disponivel', 'L-1'],
      ['7800002', 'disponivel', 'L-1'],
      ['7800003', 'disponivel', 'L-1'],
      ['7800004', 'disponivel', 'L-1'],
    ]);
    expect(
      await falha(
        porta.receberLote(ctx(), { inicial: '7800004', final: '7800005', recebidoEm: '2026-11-20' }),
      ),
    ).toContain('já estão cadastrados');

    const c = await porta.conciliarUsos(ctx());
    expect(c).toMatchObject({ ligados: 1, semFormulario: 0 });
    const f1 = await uma(
      "SELECT id, situacao, declaracao_obito_id, utilizado_em, responsavel_profissional_id FROM formulario_declaracao_obito WHERE estabelecimento_id = ? AND numero = '7800001'",
      [m.est],
    );
    expect(f1['situacao']).toBe('utilizado');
    expect(Number(f1['declaracao_obito_id'])).toBe(m.declaracao);
    expect(f1['utilizado_em']).not.toBeNull();
    expect(Number(f1['responsavel_profissional_id'])).toBe(m.profissional);
    const d = await uma('SELECT formulario_declaracao_obito_id FROM declaracao_obito WHERE id = ?', [
      m.declaracao,
    ]);
    expect(Number(d['formulario_declaracao_obito_id'])).toBe(Number(f1['id']));

    const id = async (numero: string) =>
      uma('SELECT id, versao FROM formulario_declaracao_obito WHERE estabelecimento_id = ? AND numero = ?', [
        m.est,
        numero,
      ]);
    const f2 = await id('7800002');
    expect(
      await falha(
        porta.acaoFormulario(ctx(), Number(f2['id']), {
          acao: 'usar',
          declaracao: m.declaracaoCancelada,
          versao: Number(f2['versao']),
        }),
      ),
    ).toContain('cancelada');
    const f3 = await id('7800003');
    expect(
      await falha(
        porta.acaoFormulario(ctx(), Number(f3['id']), { acao: 'extraviar', versao: Number(f3['versao']) }),
      ),
    ).toContain('motivo');
    await porta.acaoFormulario(ctx(), Number(f3['id']), {
      acao: 'extraviar',
      motivo: 'Não encontrado no bloco ao conferir',
      versao: Number(f3['versao']),
    });
    await porta.acaoFormulario(ctx(), Number(f2['id']), {
      acao: 'cancelar',
      motivo: 'Formulário rasurado no preenchimento',
      versao: Number(f2['versao']),
    });
    const f2b = await id('7800002');
    await porta.acaoFormulario(ctx(), Number(f2['id']), { acao: 'devolver', versao: Number(f2b['versao']) });
    const fim = await ler(
      'SELECT numero, situacao, motivo_cancelamento FROM formulario_declaracao_obito WHERE estabelecimento_id = ? ORDER BY numero',
      [m.est],
    );
    expect(fim.map((l) => [l['situacao'], l['motivo_cancelamento'] !== null])).toEqual([
      ['utilizado', false],
      ['devolvido', true],
      ['extraviado', true],
      ['disponivel', false],
    ]);
    const lista = await porta.formulariosObito(ctx());
    expect(lista.resumo.porSituacao).toMatchObject({
      utilizado: 1,
      devolvido: 1,
      extraviado: 1,
      disponivel: 1,
    });
    expect(lista.itens[0]!.declaracao?.id).toBe(m.declaracao);
  });

  it('auditoria do isolamento: critérios, auditoria calculada com itens, recusa, visão por paciente e cancelamento', async () => {
    const c1 = await porta.incluirCriterio(ctx(), {
      tipoPrecaucao: m.tipo,
      descricao: 'Placa de sinalização na porta',
      validadeDias: 3,
    });
    const c2 = await porta.incluirCriterio(ctx(), {
      tipoPrecaucao: m.tipo,
      descricao: 'Avental disponível na entrada',
      acao: 'alertar',
    });
    const c3 = await porta.incluirCriterio(ctx(), {
      tipoPrecaucao: m.tipo,
      descricao: 'Higiene das mãos observada',
    });
    expect([c1.ordem, c2.ordem, c3.ordem]).toEqual([1, 2, 3]);
    const pend = await porta.isolamentosParaAuditar(ctx());
    expect(pend.itens).toHaveLength(1);
    expect(pend.itens[0]).toMatchObject({ isolamento: m.isolamento, auditoriaPendente: true, criterios: 3 });

    expect(
      await falha(
        porta.auditar(ctx(), {
          isolamento: m.isolamento,
          respostas: [{ criterio: c1.id, resposta: 'conforme' }],
        }),
      ),
    ).toContain('faltam 2');
    const r = await porta.auditar(ctx(), {
      isolamento: m.isolamento,
      respostas: [
        { criterio: c3.id, resposta: 'conforme' },
        { criterio: c2.id, resposta: 'nao_conforme', naoConformidade: 'Sem avental', acaoCorretiva: 'Repor' },
        { criterio: c1.id, resposta: 'conforme' },
      ],
    });
    expect(r).toMatchObject({ geral: 'nao_conforme', percentual: 66.6667 });
    expect(r.alertas).toHaveLength(1);
    // O critério "alertar" não conforme deixa aviso pendente para a CCIH, ligado à auditoria.
    expect(r.aviso).not.toBeNull();
    const av = await uma(
      'SELECT paciente_id, prioridade, situacao, modulo_origem, entidade_origem, entidade_origem_chave, mensagem FROM aviso_clinico WHERE id = ?',
      [r.aviso],
    );
    expect(av).toMatchObject({
      prioridade: 'alta',
      situacao: 'pendente',
      modulo_origem: 'qualidade.ccih',
      entidade_origem: 'auditoria_isolamento',
    });
    expect(Number(av['paciente_id'])).toBe(m.paciente);
    expect(Number(av['entidade_origem_chave'])).toBe(r.id);
    expect(String(av['mensagem'])).toContain('Avental');
    expect((await porta.avisosIsolamento(ctx())).itens.map((x) => x.id)).toEqual([r.aviso]);
    const a = await uma(
      'SELECT situacao, conformidade_geral, percentual_conformidade, auditor_usuario_id, internacao_id FROM auditoria_isolamento WHERE id = ?',
      [r.id],
    );
    expect(a).toMatchObject({ situacao: 'concluida', conformidade_geral: 'nao_conforme' });
    expect(Number(a['percentual_conformidade'])).toBeCloseTo(66.6667, 4);
    expect(Number(a['auditor_usuario_id'])).toBe(m.usuario);
    const itens = await ler(
      'SELECT sequencia, criterio_auditoria_isolamento_id, resposta, nao_conformidade FROM auditoria_isolamento_item WHERE auditoria_isolamento_id = ? ORDER BY sequencia',
      [r.id],
    );
    expect(itens.map((i) => [Number(i['criterio_auditoria_isolamento_id']), i['resposta']])).toEqual([
      [c1.id, 'conforme'],
      [c2.id, 'nao_conforme'],
      [c3.id, 'conforme'],
    ]);
    expect((await porta.isolamentosParaAuditar(ctx())).itens[0]!.auditoriaPendente).toBe(false);

    const vis = await porta.auditoriasDoPaciente(ctx(), m.paciente);
    expect(vis.itens).toHaveLength(1);
    expect(vis.itens[0]!.respostas).toHaveLength(3);
    await porta.cancelarAuditoria(ctx(), r.id, { motivo: 'Auditoria lançada no leito errado', versao: 1 });
    const cancelada = await uma(
      'SELECT situacao, observacao, excluido_em FROM auditoria_isolamento WHERE id = ?',
      [r.id],
    );
    expect(cancelada['situacao']).toBe('cancelada');
    expect(String(cancelada['observacao'])).toContain('leito errado');
    expect(cancelada['excluido_em']).toBeNull();
    // Auditoria cancelada: o aviso dela sai da lista da CCIH, cancelado (não apagado).
    expect((await uma('SELECT situacao FROM aviso_clinico WHERE id = ?', [r.aviso]))['situacao']).toBe(
      'cancelado',
    );
    expect((await porta.avisosIsolamento(ctx())).itens).toHaveLength(0);

    // Nova auditoria com o critério "bloquear" não conforme: aviso crítico; a CCIH resolve com a providência.
    const c4 = await porta.incluirCriterio(ctx(), {
      tipoPrecaucao: m.tipo,
      descricao: 'Quarto privativo garantido',
      acao: 'bloquear',
    });
    const r2 = await porta.auditar(ctx(), {
      isolamento: m.isolamento,
      respostas: [
        { criterio: c1.id, resposta: 'conforme' },
        { criterio: c2.id, resposta: 'conforme' },
        { criterio: c3.id, resposta: 'conforme' },
        { criterio: c4.id, resposta: 'nao_conforme', naoConformidade: 'Quarto dividido' },
      ],
    });
    const lista = await porta.avisosIsolamento(ctx());
    expect(lista.itens).toHaveLength(1);
    expect(lista.itens[0]).toMatchObject({ id: r2.aviso, prioridade: 'critica', auditoria: r2.id });
    expect(
      await falha(
        Promise.resolve().then(() =>
          porta.resolverAvisoIsolamento(ctx(), r2.aviso!, { providencia: 'ok', versao: 1 }),
        ),
      ),
    ).toContain('providencia');
    await porta.resolverAvisoIsolamento(ctx(), r2.aviso!, {
      providencia: 'Paciente remanejado para quarto privativo',
      versao: 1,
    });
    const resolvido = await uma(
      'SELECT situacao, resolvido_em, resolvido_usuario_id, detalhes FROM aviso_clinico WHERE id = ?',
      [r2.aviso],
    );
    expect(resolvido['situacao']).toBe('resolvido');
    expect(resolvido['resolvido_em']).not.toBeNull();
    expect(Number(resolvido['resolvido_usuario_id'])).toBe(m.usuario);
    expect(String(resolvido['detalhes'])).toContain('quarto privativo');
    expect((await porta.avisosIsolamento(ctx())).itens).toHaveLength(0);
    expect((await porta.avisosIsolamento(ctx(), true)).itens).toHaveLength(2);
    expect(
      await falha(
        porta.resolverAvisoIsolamento(ctx(), r2.aviso!, { providencia: 'De novo resolvido', versao: 2 }),
      ),
    ).toContain('encerrado');
  });

  it('regulação: quadro clínico, eventos com situação, versão velha recusada e encerrada sem quadro novo', async () => {
    const q = await porta.registrarQuadro(ctx(), m.solicitacao, {
      quadroClinico: 'Dispneia progressiva, febre há dois dias, em máscara.',
      condicaoGeral: 'estavel',
      suporteOxigenio: m.suporte,
      fracaoInspirada: 60,
      saturacao: 88,
      frequenciaCardiaca: 110,
      necessitaIsolamento: true,
      germeMultirresistente: 'Enterobactéria produtora de carbapenemase',
      versao: 1,
    });
    expect(q).toMatchObject({ sequencia: 1, sugerida: 'grave' });
    expect(q.aviso).toContain('grave');
    const quadro = await uma(
      'SELECT sequencia, condicao_geral, saturacao_oxigenio, suporte_oxigenio_id, necessita_isolamento FROM quadro_clinico_regulacao WHERE id = ?',
      [q.id],
    );
    expect(Number(quadro['saturacao_oxigenio'])).toBe(88);
    expect(Number(quadro['suporte_oxigenio_id'])).toBe(m.suporte);
    const sol = await uma(
      'SELECT saturacao_oxigenio, isolamento_necessario, versao FROM solicitacao_regulacao WHERE id = ?',
      [m.solicitacao],
    );
    expect(Number(sol['saturacao_oxigenio'])).toBe(88);
    expect(Number(sol['versao'])).toBe(2);
    expect(Number(sol['isolamento_necessario'])).toBe(1);

    // Segundo quadro, parcial (só a frequência cardíaca): os sinais vigentes que ele não traz continuam na solicitação.
    const q2 = await porta.registrarQuadro(ctx(), m.solicitacao, {
      quadroClinico: 'Evolução: melhora da dispneia.',
      condicaoGeral: 'estavel',
      frequenciaCardiaca: 96,
      versao: 2,
    });
    expect(q2.sequencia).toBe(2);
    const sol2 = await uma(
      'SELECT saturacao_oxigenio, suporte_oxigenio_id, fracao_inspirada_oxigenio, frequencia_cardiaca, isolamento_necessario, resumo_clinico, versao FROM solicitacao_regulacao WHERE id = ?',
      [m.solicitacao],
    );
    expect(Number(sol2['saturacao_oxigenio'])).toBe(88);
    expect(Number(sol2['suporte_oxigenio_id'])).toBe(m.suporte);
    expect(Number(sol2['fracao_inspirada_oxigenio'])).toBe(60);
    expect(Number(sol2['frequencia_cardiaca'])).toBe(96);
    expect(Number(sol2['isolamento_necessario'])).toBe(1);
    expect(String(sol2['resumo_clinico'])).toContain('melhora');
    expect(Number(sol2['versao'])).toBe(3);
    const q2linha = await uma(
      'SELECT saturacao_oxigenio, frequencia_cardiaca FROM quadro_clinico_regulacao WHERE id = ?',
      [q2.id],
    );
    expect(q2linha['saturacao_oxigenio']).toBeNull();
    expect(Number(q2linha['frequencia_cardiaca'])).toBe(96);

    await porta.registrarEvento(ctx(), m.solicitacao, {
      tipo: 'mudanca_situacao',
      situacaoNova: 'em_analise',
      versao: 3,
    });
    expect(
      await falha(
        porta.registrarEvento(ctx(), m.solicitacao, {
          tipo: 'resposta',
          situacaoNova: 'autorizada',
          observacao: 'Vaga liberada',
          versao: 3,
        }),
      ),
    ).toContain('versao');
    await porta.registrarEvento(ctx(), m.solicitacao, {
      tipo: 'resposta',
      situacaoNova: 'autorizada',
      observacao: 'Vaga liberada no hospital de referência',
      versao: 4,
    });
    const aut = await uma(
      'SELECT situacao, regulado_em, encerrado_em, mensagem_central FROM solicitacao_regulacao WHERE id = ?',
      [m.solicitacao],
    );
    expect(aut).toMatchObject({ situacao: 'autorizada', encerrado_em: null });
    expect(aut['regulado_em']).not.toBeNull();
    expect(String(aut['mensagem_central'])).toContain('Vaga liberada');
    await porta.registrarEvento(ctx(), m.solicitacao, {
      tipo: 'cancelamento',
      observacao: 'Paciente transferido por meios próprios',
      versao: 5,
    });
    const fim = await uma('SELECT situacao, encerrado_em FROM solicitacao_regulacao WHERE id = ?', [
      m.solicitacao,
    ]);
    expect(fim['situacao']).toBe('cancelada');
    expect(fim['encerrado_em']).not.toBeNull();
    expect(
      await falha(
        porta.registrarQuadro(ctx(), m.solicitacao, {
          quadroClinico: 'Nova evolução depois do cancelamento.',
          condicaoGeral: 'estavel',
          versao: 6,
        }),
      ),
    ).toContain('encerrada');
    const eventos = await ler(
      'SELECT tipo_evento, situacao_anterior, situacao_nova, usuario_id, enviado_em FROM evento_regulacao WHERE solicitacao_regulacao_id = ? ORDER BY id',
      [m.solicitacao],
    );
    expect(eventos.map((e) => [e['tipo_evento'], e['situacao_anterior'], e['situacao_nova']])).toEqual([
      ['evolucao_clinica', 'solicitada', 'solicitada'],
      ['evolucao_clinica', 'solicitada', 'solicitada'],
      ['mudanca_situacao', 'solicitada', 'em_analise'],
      ['resposta', 'em_analise', 'autorizada'],
      ['cancelamento', 'autorizada', 'cancelada'],
    ]);
    expect(eventos.every((e) => Number(e['usuario_id']) === m.usuario && e['enviado_em'] === null)).toBe(
      true,
    );
    const t = await porta.linhaDoTempoRegulacao(ctx(), m.solicitacao);
    expect(t.quadros).toHaveLength(2);
    expect(t.eventos).toHaveLength(5);
    expect(t.solicitacao.situacao).toBe('cancelada');
  });
});
