// Contrato de efeito da LEITURA dos indicadores do atendimento na porta própria (F3.2, 02-REC linha 30) contra o
// MariaDB real: os atendimentos são abertos, conduzidos e encerrados pelas operações da porta e depois levados a um
// período antigo (2019), para a conta do período não depender do que outro teste abre hoje no mesmo estabelecimento.
// Prova: denominador com consulta, tipo e caráter, tempos do PA pelas marcas, evasão, observação (a troca de leito não
// conta duas vezes; acima de 24 horas), retorno em 72 horas (com a visita de referência antes do período), internação
// via PA pelo desfecho e pela internação nascida da ficha (admissão feita pela operação da internação com a ficha do
// PA como origem; a ficha com as duas marcas conta uma vez e a internação excluída não conta); o cancelado, outra
// unidade e outro estabelecimento ficam fora. Massa SINTÉTICA, limpa no fim.
import { calcularIndicadoresAgregados } from '@sgh/dominio-atendimento';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CEP_TESTE,
  CLIENTE_F22,
  CODIGO_ESTAB_OUTRO,
  contextoGravacao,
  contextoPorta,
  cpfSintetico,
  garantir,
  limparMassa,
  MARCA,
  type Massa,
  prepararMassa,
  SEM_BANCO,
} from '../cadastro/massa.spec-util.js';
import { PortaAdtPropria } from '../adt/porta-propria.js';
import { PortaCadastroPropria } from '../cadastro/porta-propria.js';
import { inicioDoDia, PortaAtendimentoPropria } from './porta-propria.js';

describe.skipIf(SEM_BANCO)('indicadores do atendimento na porta própria contra o MariaDB', () => {
  let nucleo: NucleoProprio;
  let porta: PortaAtendimentoPropria;
  let m: Massa | null = null;
  let paciente = 0;
  let fuso = 'America/Sao_Paulo';
  const PERIODO = { inicio: '2019-03-10', fim: '2019-03-12' };

  const escrever = (sql: string, p: readonly unknown[]) =>
    nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f32-01-indicadores' }, (w) => w.executar(sql, p));
  /** O instante do dia e da hora civis no fuso do estabelecimento. */
  const em = (dia: string, hora: number, minuto = 0) =>
    new Date(inicioDoDia(dia, fuso).getTime() + (hora * 60 + minuto) * 60_000);

  /** O que a admissão da internação deixa no estabelecimento da massa sai antes da limpeza do lote (ordem das chaves). */
  const limparInternacoes = async () => {
    if (!m) return;
    const est = [m.estabelecimento];
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f32-01-indicadores' }, async (e) => {
      const internacoes = 'SELECT id FROM internacao WHERE estabelecimento_id = ?';
      await e.executar(
        'DELETE FROM periodo_situacao_leito WHERE leito_hospitalar_id IN (SELECT id FROM leito_hospitalar WHERE estabelecimento_id = ?)',
        est,
      );
      await e.executar(`DELETE FROM diagnostico_internacao WHERE internacao_id IN (${internacoes})`, est);
      await e.executar('DELETE FROM ocupacao_leito WHERE estabelecimento_id = ?', est);
      await e.executar('DELETE FROM internacao WHERE estabelecimento_id = ?', est);
      await e.executar('UPDATE atendimento SET pai_atendimento_id = NULL WHERE estabelecimento_id = ?', est);
    });
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    await limparInternacoes();
    await limparMassa(nucleo, m);
    porta = new PortaAtendimentoPropria(nucleo, CLIENTE_F22);
    const cad = new PortaCadastroPropria(nucleo, CLIENTE_F22);
    const r = await cad.cadastrar(
      contextoPorta(m),
      {
        nome: `PACIENTE INDICADOR ${MARCA}`,
        nascimento: '1981-06-07',
        sexo: 'F',
        cpf: cpfSintetico('990102177'),
        naturalidade: 'BELO HORIZONTE',
        ufNaturalidade: 'MG',
        cep: CEP_TESTE,
      },
      contextoGravacao(m),
    );
    paciente = r.resultado.idPaciente;
    const f = await nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: 'f32-01-indicadores' }, (l) =>
      l.uma<{ f: unknown }>('SELECT fuso_horario AS f FROM estabelecimento WHERE id = ?', [
        m!.estabelecimento,
      ]),
    );
    if (f?.f) fuso = String(f.f);
  });

  afterAll(async () => {
    await limparInternacoes().catch(() => undefined);
    await limparMassa(nucleo, m).catch(() => undefined);
    await nucleo?.encerrar();
  });

  /** Abre pela operação e leva a entrada e as marcas do PA ao dia e à hora pedidos. */
  const abrir = async (tipo: 'consulta' | 'pa', dia: string, hora: number) => {
    const mm = m!;
    const a = await porta.executar(
      contextoPorta(mm),
      'atendimento.abrirAtendimento',
      {
        tipo,
        paciente,
        convenio: mm.fonte,
        matricula: '123456',
        profissional: mm.profissional,
        especialidade: mm.especialidade,
        unidade: mm.unidade,
        centroCusto: mm.centroCusto,
        procedimento: mm.procedimento,
        cidPrincipal: mm.cid,
        carater: tipo === 'pa' ? 'urgencia' : 'eletivo',
        local: mm.local,
      },
      contextoGravacao(mm),
    );
    const reg = Number(a.resultado['reg']);
    await escrever('UPDATE atendimento SET entrada_em = ? WHERE id = ?', [em(dia, hora), reg]);
    return { reg, cabecalho: String(a.resultado['cabecalho']), dia, hora };
  };
  /** As marcas do PA nos minutos fixos depois da entrada (a conta dos tempos fica exata). */
  const MINUTOS = {
    abertura: 0,
    chamada: 10,
    atendimento_medico: 30,
    observacao: 40,
    decisao: 50,
    saida: 60,
  };
  const fixarMarcas = async (a: { reg: number; dia: string; hora: number }) => {
    for (const [etapa, min] of Object.entries(MINUTOS))
      await escrever(
        'UPDATE atendimento_etapa_pa SET ocorrida_em = ? WHERE atendimento_id = ? AND etapa = ?',
        [em(a.dia, a.hora, min), a.reg, etapa],
      );
  };
  const encerrar = (reg: number, desfecho: string) =>
    porta.executar(
      contextoPorta(m!),
      'atendimento.encerrarAtendimento',
      { atendimento: reg, desfecho, profissional: m!.profissional },
      contextoGravacao(m!),
    );

  it('lê do banco os agregados do período e a conta do indicador fecha com as parcelas', async () => {
    const mm = m!;
    const c = contextoPorta(mm);
    await abrir('consulta', '2019-03-10', 8);
    // Visita de referência do retorno em 72 horas: antes do período, nunca no denominador.
    await abrir('pa', '2019-03-07', 20);
    // PA 1: chamado, atendido e com alta (73 horas depois da referência: não é retorno).
    const p1 = await abrir('pa', '2019-03-10', 21);
    for (const evento of ['chamar', 'atender'] as const)
      await porta.executar(
        c,
        'atendimento.conduzirNoConsultorio',
        { atendimento: p1.reg, local: mm.local, evento },
        contextoGravacao(mm),
      );
    await encerrar(p1.reg, 'alta');
    await fixarMarcas(p1);
    // PA 2: observação com troca de leito (uma observação só) e evasão.
    const p2 = await abrir('pa', '2019-03-12', 9);
    const trilha = {
      estabelecimento: mm.estabelecimento,
      usuario: mm.usuario,
      acao: 'operacao' as const,
      entidade: 'atendimento',
      entidadeId: p2.reg,
      correlacao: 'f32-01-indicadores-obs',
    };
    await porta.gravarSgh(c, trilha, async (g) => {
      await g.alocarObservacao({
        cabecalho: p2.cabecalho,
        reg: p2.reg,
        leito: mm.leitos[0]!,
        usuario: mm.login,
      });
      const saida = await g.liberarObservacao({
        cabecalho: p2.cabecalho,
        usuario: mm.login,
        justificativa: 'Troca de leito: teste',
        limiteHoras: 24,
        transferencia: true,
      });
      return g.alocarObservacao({
        cabecalho: p2.cabecalho,
        reg: p2.reg,
        leito: mm.leitos[1]!,
        usuario: mm.login,
        anterior: saida.id,
        motivoTransferencia: 'teste',
      });
    });
    await encerrar(p2.reg, 'evasao');
    await fixarMarcas(p2);
    // A observação de 30 horas: a entrada no dia da ficha e a saída 30 horas depois (nas duas ocupações da troca).
    await escrever(
      'UPDATE ocupacao_leito_observacao SET data_hora_entrada = ?, data_hora_saida = ? WHERE atendimento_id = ?',
      [em(p2.dia, p2.hora), em(p2.dia, p2.hora + 30), p2.reg],
    );
    // PA 3: excluído (lógico): continua no banco e fica fora da conta.
    const p3 = await abrir('pa', '2019-03-11', 10);
    await escrever("UPDATE atendimento SET situacao = 'cancelado' WHERE id = ?", [p3.reg]);
    // PA 4: internação pelo desfecho.
    const p4 = await abrir('pa', '2019-03-11', 12);
    await encerrar(p4.reg, 'internacao');
    await fixarMarcas(p4);

    const dados = await porta.indicadores(c, PERIODO);
    // O que ficou no banco, contado direto: 4 fichas válidas no período, 1 cancelada, 2 ocupações do mesmo paciente.
    const contar = (sql: string, p: readonly unknown[]) =>
      nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: 'f32-01-indicadores' }, async (l) =>
        Number((await l.uma<{ n: unknown }>(sql, p))?.n ?? 0),
      );
    const noPeriodo =
      'SELECT COUNT(*) AS n FROM atendimento WHERE estabelecimento_id = ? AND entrada_em >= ? AND entrada_em < ?';
    const limites = [mm.estabelecimento, em('2019-03-10', 0), em('2019-03-13', 0)];
    expect(await contar(noPeriodo, limites)).toBe(5);
    expect(await contar(`${noPeriodo} AND situacao = 'cancelado'`, limites)).toBe(1);
    expect(
      await contar('SELECT COUNT(*) AS n FROM ocupacao_leito_observacao WHERE atendimento_id = ?', [p2.reg]),
    ).toBe(2);

    expect(dados.paTotal).toBe(3);
    expect(dados.porTipo.reduce((t, g) => t + g.total, 0)).toBe(4);
    expect(dados.observacoes).toEqual([{ cabecalho: p2.cabecalho, minutos: 30 * 60 }]);
    expect(dados.visitasPa).toHaveLength(4);
    expect(dados.visitasPa).toContainEqual({ paciente: String(paciente), data: '2019-03-07', hora: '20:00' });
    expect(dados.internacoesPa).toEqual({ viaDesfecho: 1, viaEncaminhamento: 0, total: 1 });
    expect(
      dados.marcasPa
        .filter((x) => x.cabecalho === p1.cabecalho)
        .map((x) => x.etapa)
        .sort(),
    ).toEqual(['abertura', 'atendimentoMedico', 'decisao', 'saida']);

    const i = calcularIndicadoresAgregados(PERIODO, dados);
    expect(i.atendimentos).toBe(4);
    expect(i.requisicoesLaboratorio).toBe(0);
    expect(i.porTipo.map((x) => [x.rotulo, x.total])).toEqual([
      ['Pronto atendimento', 3],
      ['Consulta', 1],
    ]);
    expect(i.porCarater.map((x) => x.total)).toEqual([1, 3, 0]);
    expect(i.pa).toMatchObject({
      atendimentos: 3,
      comMarcas: 3,
      portaMedicoMedianaMin: 30,
      portaDecisaoMedianaMin: 50,
      permanenciaMedianaMin: 60,
      evasoes: 1,
      comDesfecho: 3,
      taxaEvasao: 33.3,
      observacoes: 1,
      observacoesAcima24h: 1,
      retorno72h: 2,
      retorno72hDenominador: 3,
      internacoes: 1,
      internacoesViaDesfecho: 1,
      internacoesViaEncaminhamento: 0,
    });
    expect(i.desfechos.filter((d) => d.total > 0).map((d) => [d.desfecho, d.total])).toEqual([
      ['alta', 1],
      ['internacao', 1],
      ['evasao', 1],
    ]);
    expect(i.semMarcas).toBe(0);
  });

  it('internação via PA: a internação nascida da ficha conta pelo encaminhamento, uma vez por ficha', async () => {
    const mm = m!;
    const c = contextoPorta(mm);
    const MAIO = { inicio: '2019-05-10', fim: '2019-05-12' };
    // O mapa de leitos do estabelecimento da massa e os cadastros que a admissão pede (lê o que existe ou inclui).
    const apoio = await nucleo.escrever(
      { cliente: CLIENTE_F22, correlacao: 'f32-01-indicadores' },
      async (e) => {
        const agora = new Date();
        const est = mm.estabelecimento;
        const situacao = (base: string, permite: boolean) =>
          garantir(
            e,
            'SELECT id FROM situacao_leito WHERE situacao_base = ? ORDER BY id LIMIT 1',
            [base],
            'INSERT INTO situacao_leito (codigo, descricao, situacao_base, permite_ocupacao, criado_em) VALUES (?, ?, ?, ?, ?)',
            [`${MARCA}-${base}`, `${base.toUpperCase()} ${MARCA}`, base, permite, agora],
          );
        const livre = await situacao('livre', true);
        await situacao('ocupado', false);
        const categoriaAcomodacao = await garantir(
          e,
          'SELECT id FROM categoria_acomodacao WHERE codigo = ?',
          [`${MARCA}-ENF`],
          "INSERT INTO categoria_acomodacao (codigo, descricao, tipo, criado_em) VALUES (?, ?, 'enfermaria', ?)",
          [`${MARCA}-ENF`, `ENFERMARIA ${MARCA}`, agora],
        );
        const ui = await garantir(
          e,
          'SELECT id FROM unidade_internacao WHERE estabelecimento_id = ? AND codigo = ?',
          [est, 'UI1'],
          "INSERT INTO unidade_internacao (estabelecimento_id, unidade_assistencial_id, codigo, descricao, tipo, criado_em) VALUES (?, ?, 'UI1', 'ENFERMARIA SINTETICA', 'enfermaria', ?)",
          [est, mm.unidade, agora],
        );
        const bloco = await garantir(
          e,
          'SELECT id FROM bloco_internacao WHERE estabelecimento_id = ? AND codigo = ?',
          [est, 'B1'],
          "INSERT INTO bloco_internacao (estabelecimento_id, codigo, nome, criado_em) VALUES (?, 'B1', 'BLOCO SINTETICO', ?)",
          [est, agora],
        );
        const ac = await garantir(
          e,
          'SELECT id FROM acomodacao WHERE estabelecimento_id = ? AND codigo = ?',
          [est, 'Q1'],
          "INSERT INTO acomodacao (estabelecimento_id, bloco_internacao_id, unidade_internacao_id, categoria_acomodacao_id, codigo, nome, quantidade_leitos, criado_em) VALUES (?, ?, ?, ?, 'Q1', 'QUARTO 1', 2, ?)",
          [est, bloco, ui, categoriaAcomodacao, agora],
        );
        for (const codigo of ['01', '02'])
          await garantir(
            e,
            'SELECT id FROM leito_hospitalar WHERE unidade_internacao_id = ? AND codigo = ?',
            [ui, codigo],
            'INSERT INTO leito_hospitalar (estabelecimento_id, unidade_internacao_id, acomodacao_id, bloco_internacao_id, codigo, situacao_leito_id, ativo, criado_em) VALUES (?, ?, ?, ?, ?, ?, TRUE, ?)',
            [est, ui, ac, bloco, codigo, livre, agora],
          );
        await e.executar('UPDATE leito_hospitalar SET situacao_leito_id = ? WHERE estabelecimento_id = ?', [
          livre,
          est,
        ]);
        await garantir(
          e,
          "SELECT id FROM sequencia_negocio WHERE tipo = 'internacao' AND estabelecimento_id = ?",
          [est],
          "INSERT INTO sequencia_negocio (estabelecimento_id, tipo, proximo_valor, incremento, ativo, criado_em, versao) VALUES (?, 'internacao', 1, 1, TRUE, ?, 1)",
          [est, agora],
        );
        const sigtap = await e.uma<{ id: unknown }>(
          'SELECT id FROM procedimento_sigtap WHERE ativo = TRUE ORDER BY id LIMIT 1',
          [],
        );
        return {
          carater: await garantir(
            e,
            'SELECT id FROM carater_admissao WHERE urgencia = TRUE AND ativo = TRUE ORDER BY id LIMIT 1',
            [],
            'INSERT INTO carater_admissao (codigo, descricao, urgencia, criado_em) VALUES (?, ?, TRUE, ?)',
            [`${MARCA}-URG`, `URGENCIA ${MARCA}`, agora],
          ),
          caraterTiss: await garantir(
            e,
            'SELECT id FROM carater_atendimento_tiss WHERE urgencia = TRUE ORDER BY id LIMIT 1',
            [],
            "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, urgencia, criado_em) VALUES ('ZU', ?, 'teste', TRUE, ?)",
            [`URGENCIA ${MARCA}`, agora],
          ),
          categoria: await garantir(
            e,
            "SELECT id FROM categoria_atendimento WHERE tipo_base = 'internacao' AND ativo = TRUE ORDER BY id LIMIT 1",
            [],
            "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'internacao', ?)",
            [`${MARCA}-INT`, `INTERNACAO ${MARCA}`, agora],
          ),
          modalidade: await garantir(
            e,
            "SELECT id FROM modalidade_internacao WHERE classificacao = 'clinica' ORDER BY id LIMIT 1",
            [],
            "INSERT INTO modalidade_internacao (codigo, descricao, classificacao, criado_em) VALUES (?, ?, 'clinica', ?)",
            [`${MARCA}-CLI`, `CLINICA ${MARCA}`, agora],
          ),
          procedimento: sigtap ? Number(sigtap.id) : mm.procedimento,
          procedimentoOrigem: sigtap ? ('sigtap' as const) : ('item' as const),
        };
      },
    );
    const adt = new PortaAdtPropria(nucleo);
    /** A admissão pela operação da internação, com a ficha do PA como atendimento de origem. */
    const internar = async (pacienteId: number, leito: string, origem: number) => {
      const r = await adt.executar(
        c,
        'internacao.internar',
        {
          paciente: pacienteId,
          leito: { bloco: 'B1', acomodacao: 'Q1', leito },
          convenio: mm.fonte,
          acomodacaoPlano: 'ENFERMARIA',
          carater: 'urgencia',
          clinica: 'M',
          especialidade: mm.especialidade,
          medicoAssistente: mm.profissional,
          medicoSolicitante: mm.profissional,
          cidPrincipal: mm.cid,
          procedimento: apoio.procedimento,
          procedimentoOrigem: apoio.procedimentoOrigem,
          centroCusto: 1,
          unidade: 1,
          origem: 'ambulatorio',
          atendimentoOrigem: origem,
          caraterAdmissao: apoio.carater,
          caraterTiss: apoio.caraterTiss,
          categoriaAtendimento: apoio.categoria,
          modalidade: apoio.modalidade,
        },
        { ...contextoGravacao(mm), reautenticadoEm: Date.now() },
      );
      return Number((r.resultado as Record<string, unknown>)['internacao']);
    };
    const cad = new PortaCadastroPropria(nucleo, CLIENTE_F22);
    const outro = await cad.cadastrar(
      c,
      {
        nome: `PACIENTE INDICADOR DOIS ${MARCA}`,
        nascimento: '1975-02-03',
        sexo: 'M',
        cpf: cpfSintetico('990102178'),
        naturalidade: 'BELO HORIZONTE',
        ufNaturalidade: 'MG',
        cep: CEP_TESTE,
      },
      contextoGravacao(mm),
    );
    const paciente2 = outro.resultado.idPaciente;
    const abrirPa = async (pacienteId: number, dia: string, hora: number) => {
      const antes = paciente;
      paciente = pacienteId;
      try {
        return await abrir('pa', dia, hora);
      } finally {
        paciente = antes;
      }
    };
    // Q1: só o desfecho de internação (nenhuma internação nasceu da ficha).
    const q1 = await abrirPa(paciente, '2019-05-10', 9);
    await encerrar(q1.reg, 'internacao');
    // Q2: só o encaminhamento (a ficha segue sem desfecho e a internação nasce dela).
    const q2 = await abrirPa(paciente, '2019-05-11', 9);
    const i2 = await internar(paciente, '01', q2.reg);
    // Q3: o desfecho e o encaminhamento na mesma ficha (conta uma vez no total).
    const q3 = await abrirPa(paciente2, '2019-05-12', 9);
    await encerrar(q3.reg, 'internacao');
    const i3 = await internar(paciente2, '02', q3.reg);

    // O que a admissão deixou no banco: duas internações, cada uma num atendimento filho da ficha do PA.
    const ler = (sql: string, p: readonly unknown[]) =>
      nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: 'f32-01-indicadores' }, (l) =>
        l.consultar(sql, p),
      );
    const filhos = await ler(
      `SELECT i.id AS internacao, f.pai_atendimento_id AS pai FROM internacao i JOIN atendimento f ON f.id = i.atendimento_id
        WHERE i.estabelecimento_id = ? ORDER BY i.id`,
      [mm.estabelecimento],
    );
    expect(filhos.map((f) => [Number(f['internacao']), Number(f['pai'])])).toEqual([
      [i2, q2.reg],
      [i3, q3.reg],
    ]);

    const dados = await porta.indicadores(c, MAIO);
    // O atendimento da internação não é do atendimento externo: fica fora do denominador.
    expect(dados.paTotal).toBe(3);
    expect(dados.porTipo.reduce((t, g) => t + g.total, 0)).toBe(3);
    expect(dados.internacoesPa).toEqual({ viaDesfecho: 2, viaEncaminhamento: 2, total: 3 });
    expect(calcularIndicadoresAgregados(MAIO, dados).pa).toMatchObject({
      atendimentos: 3,
      internacoes: 3,
      internacoesViaDesfecho: 2,
      internacoesViaEncaminhamento: 2,
    });
    // O dia de cada ficha: a parcela sai da ficha certa.
    expect((await porta.indicadores(c, { inicio: '2019-05-11', fim: '2019-05-11' })).internacoesPa).toEqual({
      viaDesfecho: 0,
      viaEncaminhamento: 1,
      total: 1,
    });
    // A internação excluída (exclusão lógica: continua no banco) deixa de contar pelo encaminhamento.
    await escrever('UPDATE internacao SET excluido_em = ? WHERE id = ?', [new Date(), i3]);
    expect((await porta.indicadores(c, MAIO)).internacoesPa).toEqual({
      viaDesfecho: 2,
      viaEncaminhamento: 1,
      total: 3,
    });
    // O período de março (primeiro teste) não vê as internações de maio.
    expect((await porta.indicadores(c, PERIODO)).internacoesPa).toEqual({
      viaDesfecho: 1,
      viaEncaminhamento: 0,
      total: 1,
    });
  });

  it('o recorte: um dia só, a unidade, e outro estabelecimento não vê nada', async () => {
    const mm = m!;
    const c = contextoPorta(mm);
    const dia = await porta.indicadores(c, { inicio: '2019-03-11', fim: '2019-03-11' });
    // No dia 11 só a ficha da internação vale (a cancelada do mesmo dia fica fora).
    expect(dia.paTotal).toBe(1);
    expect(dia.desfechos).toEqual([{ desfecho: 'internacao', tipoAte: 11, total: 1 }]);
    expect((await porta.indicadores(c, { ...PERIODO, unidade: mm.unidade })).paTotal).toBe(3);
    const outraUnidade = await porta.indicadores(c, { ...PERIODO, unidade: mm.unidade + 900_000 });
    expect(outraUnidade.porTipo).toEqual([]);
    expect(outraUnidade.visitasPa).toEqual([]);
    const outro = await porta.indicadores(
      { ...c, estabelecimento: mm.outroEstabelecimento, hospital: CODIGO_ESTAB_OUTRO },
      PERIODO,
    );
    expect(outro).toMatchObject({ porTipo: [], desfechos: [], marcasPa: [], observacoes: [], paTotal: 0 });
    expect(outro.internacoesPa).toEqual({ viaDesfecho: 0, viaEncaminhamento: 0, total: 0 });
  });
});
