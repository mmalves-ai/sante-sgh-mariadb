// Contrato de efeito da LEITURA dos indicadores do atendimento na porta própria (F3.2, 02-REC linha 30) contra o
// MariaDB real: os atendimentos são abertos, conduzidos e encerrados pelas operações da porta e depois levados a um
// período antigo (2019), para a conta do período não depender do que outro teste abre hoje no mesmo estabelecimento.
// Prova: denominador com consulta, tipo e caráter, tempos do PA pelas marcas, evasão, observação (a troca de leito não
// conta duas vezes; acima de 24 horas), retorno em 72 horas (com a visita de referência antes do período), internação
// via PA pelo desfecho; o cancelado, outra unidade e outro estabelecimento ficam fora. Massa SINTÉTICA, limpa no fim.
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
  limparMassa,
  MARCA,
  type Massa,
  prepararMassa,
  SEM_BANCO,
} from '../cadastro/massa.spec-util.js';
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

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
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
