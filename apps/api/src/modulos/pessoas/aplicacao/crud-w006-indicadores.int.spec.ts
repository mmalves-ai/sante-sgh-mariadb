// W0-06, parte 7c (programa CRUD completo, M4 de mercado, aceite 10) sobre a cópia (transação DESFEITA): o painel de
// indicadores de pessoas lido pelo SQL real das leituras de @sgh/legado (`lerBaseIndicadores`, a mesma função da porta
// do banco) e calculado pelo domínio, conferido contra a base de teste conferida à mão em
// packages/dominio-pessoas/src/indicadores/indicadores-pessoas.spec.ts (os mesmos números).
// A base é montada nas tabelas SGH_ de um estabelecimento SINTÉTICO ('W06IND', que não existe na cópia), com IDs
// negativos (nenhum generator é consumido) e com os distratores que as leituras têm de deixar de fora: vínculo admitido
// depois do período, fechamento do ponto reaberto, linha da folha que não é hora extra e processo substituído, turma
// encerrada fora do período e participante ausente, acidente de trajeto e acidente anulado, censo fora do período,
// dimensionamento antigo do setor (só liga o bloco) e dimensionamento posterior ao período.
// Nada do sistema anterior é lido nem escrito (somenteSgh) e as contagens do estabelecimento sintético voltam a zero
// depois do ROLLBACK.
import { calcularIndicadoresPessoas } from '@sgh/dominio-pessoas';
import { type Leitor, setoresIndicadoresPesSgh, somenteSgh } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../../acesso/aplicacao/copia.spec-util.js';
import { lerBaseIndicadores } from '../indicadores/porta-indicadores-legado.js';

const H = 'W06IND';
const TABELAS = [
  'SGH_PES_VINCULO',
  'SGH_PES_PONTO_FECHAMENTO',
  'SGH_PES_FOLHA_PROCESSO',
  'SGH_PES_FOLHA_CALCULO',
  'SGH_PES_CURSO',
  'SGH_PES_TREINAMENTO',
  'SGH_PES_TREIN_PARTICIPANTE',
  'SGH_PES_ACIDENTE',
  'SGH_INT_CENSO_DIA',
  'SGH_PES_DIMENSIONAMENTO',
] as const;

/** Valor com a conversão no SQL (o driver quer Date/bigint; o texto passa pelo VARCHAR). */
type Convertido = { readonly sql: string; readonly v: string };
const D = (v: string): Convertido => ({ sql: 'CAST(CAST(? AS VARCHAR(10)) AS DATE)', v });
const TS = (v: string): Convertido => ({ sql: 'CAST(CAST(? AS VARCHAR(24)) AS TIMESTAMP)', v });
const B = (v: number): Convertido => ({ sql: 'CAST(CAST(? AS VARCHAR(20)) AS BIGINT)', v: String(v) });
const ehConvertido = (x: unknown): x is Convertido => typeof x === 'object' && x !== null && 'sql' in x;

const CLI = { ID_TBUNIDAD: 10, SETOR: 'Clínica' };
const UTI = { ID_TBUNIDAD: 20, SETOR: 'UTI' };
const QUEM = 'SGH.TESTE';
const min = (h: number) => h * 60;

describe.skipIf(!PODE_ESCREVER)('W0-06: painel de indicadores de pessoas (cópia, transação desfeita)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('o SQL real das leituras entrega a base que o domínio calcula com os números conferidos à mão; os distratores ficam fora', async () => {
    const contar = async (l: Pick<Leitor, 'consultar'>) => {
      const r: Record<string, number> = {};
      for (const t of TABELAS) {
        const [x] = await l.consultar(`SELECT COUNT(*) N FROM ${t} WHERE HOSPITAL = ?`, [H], { teto: 1 });
        r[t] = Number(x?.['N'] ?? 0);
      }
      return r;
    };
    const antes = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-w006-7c-antes' }, (e) =>
      contar(e),
    );
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-w006-7c-painel' }, async (e) => {
      const s0 = somenteSgh(e);
      const ins = async (tabela: string, linha: Record<string, unknown>) => {
        const cols = Object.keys(linha);
        const vals = Object.values(linha);
        await s0.executar(
          `INSERT INTO ${tabela} (${cols.join(', ')}) VALUES (${vals.map((x) => (ehConvertido(x) ? x.sql : '?')).join(', ')})`,
          vals.map((x) => (ehConvertido(x) ? x.v : x)),
        );
      };

      // Vínculos (IDs -906070001…): os 8 da base de teste e um admitido depois do período (fora).
      const vinculo = async (
        id: number,
        setor: typeof CLI,
        cargo: string,
        admissao: string,
        desligamento: string | null = null,
      ) =>
        ins('SGH_PES_VINCULO', {
          ID: B(id),
          HOSPITAL: H,
          PESSOA: B(id),
          CPF_HMAC: `w06ind${String(-id)}`.padEnd(64, '0'),
          CPF_CIFRADO: 'sintetico',
          NOME: `COLABORADOR SINTETICO ${-id}`,
          TIPO: 'clt',
          CARGO: cargo,
          CARGA_SEMANAL: 36,
          ID_TBCENCUS: 1,
          ...setor,
          ADMISSAO: D(admissao),
          ...(desligamento
            ? {
                DESLIGAMENTO: D(desligamento),
                ID_FPTIPORESC: 1,
                MOTIVO_DESLIG: 'Desligamento sintetico',
                DESLIGADO_POR: QUEM,
              }
            : {}),
          CRIADO_POR: QUEM,
          ALTERADO_POR: QUEM,
        });
      const ENF = 'Enfermeiro';
      const ADM = 'Auxiliar administrativo';
      await vinculo(-906070001, CLI, ENF, '2025-01-01');
      await vinculo(-906070002, CLI, ADM, '2025-06-01', '2026-02-10');
      await vinculo(-906070003, CLI, ADM, '2026-02-15');
      await vinculo(-906070004, CLI, ADM, '2024-01-01');
      await vinculo(-906070005, UTI, ENF, '2020-01-01');
      await vinculo(-906070006, UTI, ADM, '2020-01-01');
      await vinculo(-906070007, UTI, ADM, '2020-01-01', '2026-03-31');
      await vinculo(-906070008, UTI, ADM, '2026-01-01');
      await vinculo(-906070009, CLI, ADM, '2026-04-10');

      // Ponto: fechamentos com os minutos por classe (1 normais, 3 extras, 7 falta). Clínica: 600 h trabalhadas da
      // enfermagem + 380 h; UTI: 1800 h da enfermagem + 250 h. Um fechamento reaberto (fora) com horas absurdas.
      const fechamento = async (
        id: number,
        vinc: number,
        competencia: string,
        classes: Record<string, number>,
      ) =>
        ins('SGH_PES_PONTO_FECHAMENTO', {
          ID: B(id),
          HOSPITAL: H,
          ID_VINCULO: B(vinc),
          COMPETENCIA: competencia,
          ACAO: 'fechado',
          HASH_ESPELHO: 'f'.repeat(64),
          TOTAIS: JSON.stringify({ classes }),
          REGISTRADO_POR: QUEM,
        });
      await fechamento(-906071001, -906070001, '2026-01', { '1': min(590), '3': min(10) });
      await fechamento(-906071002, -906070004, '2026-02', { '1': min(370), '3': min(10), '7': min(40) });
      await fechamento(-906071003, -906070005, '2026-03', { '1': min(1700), '3': min(100) });
      await fechamento(-906071004, -906070006, '2026-01', { '1': min(250), '7': min(50) });
      await fechamento(-906071005, -906070007, '2026-02', { '1': min(9999), '3': min(999) });
      await ins('SGH_PES_PONTO_FECHAMENTO', {
        ID: B(-906071006),
        HOSPITAL: H,
        ID_VINCULO: B(-906070007),
        COMPETENCIA: '2026-02',
        ACAO: 'reaberto',
        REF: B(-906071005),
        TEXTO: 'Reaberto na integracao sintetica',
        REGISTRADO_POR: QUEM,
      });

      // Folha: horas extras de 500,00 na Clínica (300,00 + 200,00) e 1.500,00 na UTI; o salário-base e o processo
      // substituído ficam fora.
      const processo = async (id: number, situacao: string, numero: number) =>
        ins('SGH_PES_FOLHA_PROCESSO', {
          ID: B(id),
          HOSPITAL: H,
          COD_EMP: 1,
          COMPETENCIA: '2026-02',
          NUMERO: numero,
          SITUACAO: situacao,
          COLABORADORES: 4,
          FORA_DA_FOLHA: 0,
          PROVENTOS: B(0),
          DESCONTOS: B(0),
          LIQUIDO: B(0),
          INSS: B(0),
          IRRF: B(0),
          FGTS: B(0),
          INSS_PATRONAL: B(0),
          RAT: B(0),
          TERCEIROS: B(0),
          VIG_TABELA_LEGAL: D('2026-01-01'),
          VIG_PARAMETROS: D('2026-01-01'),
          RESUMO: 'r'.repeat(64),
          CALCULADO_POR: QUEM,
        });
      await processo(-906072001, 'calculada', 2);
      await processo(-906072002, 'substituida', 1);
      const calculo = async (id: number, proc: number, vinc: number, papel: string, cent: number) =>
        ins('SGH_PES_FOLHA_CALCULO', {
          ID: B(id),
          HOSPITAL: H,
          ID_PROCESSO: B(proc),
          ID_VINCULO: B(vinc),
          ID_TBCENCUS: 1,
          DIAS_PAGOS: 30,
          PAPEL: papel,
          TIPO: 'provento',
          ID_FPEVENTO: 1,
          QUANTIDADE: 60,
          UNIDADE: 'minutos',
          VALOR_CENTAVOS: B(cent),
          MEMORIA: 'integracao sintetica',
        });
      await calculo(-906073001, -906072001, -906070001, 'horaExtra50', 30_000);
      await calculo(-906073002, -906072001, -906070004, 'horaExtra100', 20_000);
      await calculo(-906073003, -906072001, -906070005, 'horaExtra50', 150_000);
      await calculo(-906073004, -906072001, -906070001, 'salarioBase', 999_999);
      await calculo(-906073005, -906072002, -906070005, 'horaExtra50', 777_777);

      // Treinamento: Clínica 2 presentes × 15 h = 30 h; UTI 15 h + 5 h = 20 h; ausente e turma de abril ficam fora.
      await ins('SGH_PES_CURSO', {
        ID: B(-906074001),
        HOSPITAL: H,
        CODIGO: 'W06IND-1',
        TITULO: 'Curso sintetico',
        CONTEUDO: 'Conteudo sintetico',
        CATEGORIA: 'outro',
        CARGA_MIN: 900,
        CRIADO_POR: QUEM,
        ALTERADO_POR: QUEM,
      });
      const turma = async (id: number, fim: string, carga: number) =>
        ins('SGH_PES_TREINAMENTO', {
          ID: B(id),
          HOSPITAL: H,
          ID_CURSO: B(-906074001),
          INICIO: D(fim),
          FIM: D(fim),
          CARGA_MIN: carga,
          INSTRUTOR: 'Instrutor sintetico',
          MODALIDADE: 'presencial',
          SITUACAO: 'encerrada',
          CRIADO_POR: QUEM,
          ALTERADO_POR: QUEM,
        });
      await turma(-906075001, '2026-02-20', 900);
      await turma(-906075002, '2026-03-05', 300);
      await turma(-906075003, '2026-04-20', 900);
      const participante = async (id: number, t: number, vinc: number, presenca: string) =>
        ins('SGH_PES_TREIN_PARTICIPANTE', {
          ID: B(id),
          HOSPITAL: H,
          ID_TREINAMENTO: B(t),
          ID_VINCULO: B(vinc),
          PRESENCA: presenca,
          CRIADO_POR: QUEM,
          ALTERADO_POR: QUEM,
        });
      await participante(-906076001, -906075001, -906070001, 'presente');
      await participante(-906076002, -906075001, -906070004, 'presente');
      await participante(-906076003, -906075001, -906070005, 'presente');
      await participante(-906076004, -906075002, -906070006, 'presente');
      await participante(-906076005, -906075001, -906070008, 'ausente');
      await participante(-906076006, -906075003, -906070001, 'presente');

      // SESMT: um acidente típico com afastamento na UTI; o de trajeto e o anulado ficam fora.
      const acidente = async (id: number, vinc: number, tipo: string, extra: Record<string, unknown> = {}) =>
        ins('SGH_PES_ACIDENTE', {
          ID: B(id),
          HOSPITAL: H,
          ID_VINCULO: B(vinc),
          OCORRIDO_EM: TS('2026-03-10 08:00:00'),
          TIPO: tipo,
          LOCAL_OCORRENCIA: 'Local sintetico',
          DESCRICAO: 'Acidente sintetico da integracao',
          PROFILAXIA: 'nao-indicada',
          CAT_PRAZO: D('2026-03-11'),
          CRIADO_POR: QUEM,
          ALTERADO_POR: QUEM,
          ...extra,
        });
      await acidente(-906077001, -906070005, 'tipico', { AFASTAMENTO: 'T' });
      await acidente(-906077002, -906070006, 'trajeto');
      await acidente(-906077003, -906070001, 'tipico', {
        ESTADO: 'encerrado',
        ENCERRADO_EM: TS('2026-03-12 08:00:00'),
        ENCERRADO_POR: QUEM,
        MOTIVO_ENCERRA: 'Anulado: registro em duplicidade',
        ANULADO_EM: TS('2026-03-12 08:00:00'),
        ANULADO_POR: QUEM,
      });

      // Dimensionamento: a Clínica tem um registro antigo (liga o bloco W6A) e o vigente (W6B, 2 mínimos + 2
      // intermediários); a UTI, o vigente (W6U, 5 intensivos) e um posterior ao período (fora).
      const dimensionamento = async (
        id: number,
        setor: typeof CLI,
        data: string,
        bloco: string,
        p: Record<string, number>,
      ) =>
        ins('SGH_PES_DIMENSIONAMENTO', {
          ID: B(id),
          HOSPITAL: H,
          ...setor,
          DATA_REF: D(data),
          TURNO: 'manha',
          FONTE: 'informada',
          UNIDADE_INTERNACAO: bloco,
          ...p,
          JORNADA_SEMANAL: 36,
          IST: 0.15,
          THE: 0,
          KM: 0,
          QP: 0,
          TOTAL_PROF: 0,
          ENFERMEIROS: 0,
          TECNICOS: 0,
          PERC_ENFERMEIROS: 0,
          COB_SUGERIDA: 0,
          PARCELAS: '[]',
          CALCULADO_POR: QUEM,
        });
      await dimensionamento(-906078001, CLI, '2026-01-05', 'W6A', { P_MINIMOS: 9 });
      await dimensionamento(-906078002, CLI, '2026-02-01', 'W6B', { P_MINIMOS: 2, P_INTERMEDIARIOS: 2 });
      await dimensionamento(-906078003, UTI, '2026-01-10', 'W6U', { P_INTENSIVOS: 5 });
      await dimensionamento(-906078004, UTI, '2026-04-15', 'W6U', { P_INTENSIVOS: 99 });

      // Censo: W6A 60 pacientes-dia, W6B 40 (os dois na Clínica), W6U 90; abril fica fora.
      const censo = async (id: number, data: string, bloco: string, internados: number) =>
        ins('SGH_INT_CENSO_DIA', {
          ID: B(id),
          HOSPITAL: H,
          DATA_CENSO: D(data),
          BLOCO: bloco,
          ACOMODACAO: 'APTO',
          ID_TBTIPOACOMOD: 1,
          HORA_FECHAMENTO: 24,
          INTERNADOS: internados,
          ADMISSOES: 0,
          ALTAS_DOMICILIAR: 0,
          OBITOS: 0,
          ALTAS_TRANSF_EXTERNA: 0,
          ALTAS_INT_DOMICILIAR: 0,
          ALTAS_EVASAO_PEDIDO: 0,
          ALTAS_ENCERRAMENTO: 0,
          TRANSF_ENTRADA: 0,
          TRANSF_SAIDA: 0,
          LEITOS_OPERACIONAIS: 40,
          VERSAO_CALCULO: 1,
        });
      await censo(-906079001, '2026-01-10', 'W6A', 30);
      await censo(-906079002, '2026-01-11', 'W6A', 30);
      await censo(-906079003, '2026-02-10', 'W6B', 40);
      await censo(-906079004, '2026-03-01', 'W6U', 45);
      await censo(-906079005, '2026-03-02', 'W6U', 45);
      await censo(-906079006, '2026-04-01', 'W6U', 999);

      const ler = <T>(fn: (l: Leitor) => Promise<T>) => fn(e);
      const recorte = { inicio: '2026-01-01', fim: '2026-03-31', hospital: H, setor: null };
      const todo = await lerBaseIndicadores(ler, H, recorte);
      const soUti = await lerBaseIndicadores(ler, H, { ...recorte, setor: 20 });
      return {
        setores: await setoresIndicadoresPesSgh(e, H),
        todo,
        soUti,
        contagem: await contar(e),
      };
    });

    expect(antes).toEqual(Object.fromEntries(TABELAS.map((t) => [t, 0])));
    expect(r.contagem['SGH_PES_VINCULO']).toBe(9);
    expect(r.setores).toEqual([
      { codigo: 10, rotulo: 'Clínica' },
      { codigo: 20, rotulo: 'UTI' },
    ]);

    // A base lida: todas as fontes disponíveis, os distratores fora.
    const { base, indisponiveis } = r.todo;
    expect(indisponiveis).toEqual([]);
    expect(base.vinculos).toHaveLength(8);
    const porSetor = <T extends { nomeSetor: string }>(xs: readonly T[]) =>
      [...xs].sort((x, y) => x.nomeSetor.localeCompare(y.nomeSetor, 'pt-BR'));
    expect(
      porSetor(base.ponto).map((p) => [
        p.nomeSetor,
        p.horasPrevistas,
        p.horasTrabalhadas,
        p.horasAusencia,
        p.horasExtras,
        p.horasEnfermagem,
      ]),
    ).toEqual([
      ['Clínica', 1000, 980, 40, 20, 600],
      ['UTI', 2000, 2050, 50, 100, 1800],
    ]);
    expect(porSetor(base.folhaHorasExtras).map((x) => [x.nomeSetor, x.valorCent])).toEqual([
      ['Clínica', 50_000],
      ['UTI', 150_000],
    ]);
    expect(porSetor(base.treinamento).map((x) => [x.nomeSetor, x.horas])).toEqual([
      ['Clínica', 30],
      ['UTI', 20],
    ]);
    expect(base.acidentes.map((x) => [x.nomeSetor, x.quantidade, x.comAfastamento])).toEqual([['UTI', 1, 1]]);
    expect(porSetor(base.censo).map((x) => [x.nomeSetor, x.pacientesDia])).toEqual([
      ['Clínica', 100],
      ['UTI', 90],
    ]);
    expect(
      porSetor(base.dimensionamento).map((x) => [
        x.nomeSetor,
        x.pacientes.minimos,
        x.pacientes.intermediarios,
        x.pacientes.intensivos,
      ]),
    ).toEqual([
      ['Clínica', 2, 2, 0],
      ['UTI', 0, 0, 5],
    ]);

    // O domínio sobre a base lida: os números conferidos à mão (indicadores-pessoas.spec.ts).
    const i = Object.fromEntries(calcularIndicadoresPessoas(base).map((x) => [x.ficha.codigo, x]));
    const parcelas = (c: string) =>
      porSetor(i[c]!.parcelas).map((p) => [p.nomeSetor, p.numerador, p.denominador, p.valor]);
    expect(parcelas('turnover')).toEqual([
      ['Clínica', 1, 3, 33.33],
      ['UTI', 1, 4, 25],
    ]);
    expect([i['turnover']!.numerador, i['turnover']!.denominador, i['turnover']!.valor]).toEqual([
      2, 7, 28.57,
    ]);
    expect(i['turnover']!.conta).toBe('(1 + 1) ÷ (3 + 4) × 100 = 2 ÷ 7 × 100 = 28,57%');
    expect([i['absenteismo']!.numerador, i['absenteismo']!.denominador, i['absenteismo']!.valor]).toEqual([
      90, 3000, 3,
    ]);
    expect(porSetor(i['horasExtras']!.parcelas).map((p) => p.valor)).toEqual([2.04, 4.88]);
    expect(i['horasExtras']!.valor).toBe(3.96);
    expect(i['horasExtras']!.complementos).toEqual([
      { rotulo: 'Horas extras no período', valor: '120 h' },
      { rotulo: 'Valor pago na folha', valor: 'R$ 2.000,00' },
    ]);
    const enf = i['horasEnfermagemPacienteDia']!;
    expect(porSetor(enf.parcelas).map((p) => [p.nomeSetor, p.valor, p.referencia])).toEqual([
      ['Clínica', 6, 5],
      ['UTI', 20, 18],
    ]);
    expect([enf.numerador, enf.denominador, enf.valor, enf.referencia, enf.razaoReferencia]).toEqual([
      2400, 190, 12.63, 11.16, 1.13,
    ]);
    expect(i['treinamentoPerCapita']!.valor).toBe(7.14);
    expect(porSetor(i['acidentesTrabalho']!.parcelas).map((p) => p.valor)).toEqual([0, 487.8]);
    expect(i['acidentesTrabalho']!.valor).toBe(330.03);

    // O recorte de um setor só traz o setor (o censo e o dimensionamento também).
    const u = r.soUti.base;
    expect(r.soUti.indisponiveis).toEqual([]);
    expect(
      [u.vinculos, u.ponto, u.folhaHorasExtras, u.treinamento, u.acidentes, u.censo, u.dimensionamento]
        .flat()
        .every((x) => x.nomeSetor === 'UTI'),
    ).toBe(true);
    expect(u.vinculos).toHaveLength(4);
    expect(u.censo.map((x) => x.pacientesDia)).toEqual([90]);

    // Desfeito: nada do estabelecimento sintético sobra.
    const final = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-w006-7c-final' }, (e) =>
      contar(e),
    );
    expect(final).toEqual(antes);
  }, 600_000);
});
