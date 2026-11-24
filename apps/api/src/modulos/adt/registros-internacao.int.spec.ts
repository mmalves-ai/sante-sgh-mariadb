// Contrato de efeito dos registros da internação (F3.4, 04-INT linhas 65, 67 e 68) contra o MariaDB real, cliente de
// teste (massa SINTÉTICA, marca R de massa-adt.spec-util.ts):
//   - a admissão grava o diagnóstico de entrada e a guia inicial; a tela soma o secundário e a causa externa; nada é
//     apagado e as recusas (repetido, causa externa fora do capítulo XX) não gravam;
//   - o acidente de trabalho conferido na hora (sem empregador, recusa) e gravado com a sequência;
//   - a prorrogação entra como nova linha do histórico com a validade seguinte e o autorizador; a guia inicial fica;
//   - os operadores da unidade: com a regra, quem não está liberado não admite; a lista vazia retira (exclusão lógica)
//     e devolve a unidade ao cargo.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE_ADT,
  contextoAdt,
  encerrarMassaAdt,
  lerAdt,
  type MassaAdt,
  operacaoAdt,
  prepararMassaAdt,
  SEM_BANCO_ADT,
} from './massa-adt.spec-util.js';
import { PortaAdtPropria } from './porta-propria.js';
import { lerRegistrosDaInternacao } from './registros-internacao.js';

const codigoDe = (e: unknown) =>
  (e as { problema?: { codigo?: string } }).problema?.codigo ?? (e as { codigo?: string }).codigo;

describe.skipIf(SEM_BANCO_ADT)(`registros da internação (MariaDB, cliente ${CLIENTE_ADT})`, () => {
  let m: MassaAdt | null = null;
  let porta: PortaAdtPropria;
  const M = () => m!;
  const conta = async (sql: string, p: unknown[]) =>
    Number((await lerAdt<{ n: number }>(M(), sql, p))?.n ?? 0);
  const executar = (op: string, entrada: unknown) =>
    porta
      .executar(contextoAdt(M()), op, entrada, { ...operacaoAdt(M()), reautenticadoEm: Date.now() })
      .then((r) => r.resultado as Record<string, unknown>);
  const internar = (paciente: number, leito: string, extra: Record<string, unknown> = {}) =>
    executar('internacao.internar', {
      paciente,
      leito: { bloco: 'B1', acomodacao: 'Q1', leito },
      convenio: M().convenio,
      acomodacaoPlano: 'ENFERMARIA',
      carater: 'urgencia',
      clinica: 'M',
      especialidade: M().especialidade,
      medicoAssistente: M().medico,
      medicoSolicitante: M().medico,
      cidPrincipal: M().cid,
      procedimento: M().procedimento,
      procedimentoOrigem: 'sigtap',
      centroCusto: 1,
      unidade: 1,
      origem: 'ambulatorio',
      caraterAdmissao: M().carater,
      caraterTiss: M().caraterTiss,
      categoriaAtendimento: M().categoria,
      modalidade: M().modalidade,
      ...extra,
    });
  const unidadeDaMassa = async () =>
    Number(
      (
        await lerAdt<{ u: number }>(
          M(),
          `SELECT lh.unidade_internacao_id AS u FROM leito_hospitalar lh JOIN acomodacao ac ON ac.id = lh.acomodacao_id
            WHERE lh.estabelecimento_id = ? AND ac.codigo = 'Q1' AND lh.codigo = ?`,
          [M().est, M().leitos[2]],
        )
      )?.u,
    );
  let internacao = 0;

  beforeAll(async () => {
    m = await prepararMassaAdt('R');
    porta = new PortaAdtPropria(M().nucleo);
  }, 60_000);
  afterAll(() => encerrarMassaAdt(m));

  it('admissão: diagnóstico de entrada e guia inicial no histórico', async () => {
    const r = await internar(M().pacientes[0]!, M().leitos[0]!, {
      guia: 'G-INICIAL',
      senhaConvenio: 'S1',
      diariasAutorizadas: 3,
    });
    internacao = Number(r['internacao']);
    expect(
      await lerAdt(
        M(),
        'SELECT tipo, sequencia, cid_termo_terminologia_id AS cid, profissional_id AS prof FROM diagnostico_internacao WHERE internacao_id = ?',
        [internacao],
      ),
    ).toMatchObject({ tipo: 'entrada', sequencia: 1, cid: M().cid, prof: M().medico });
    const g = await lerAdt<Record<string, unknown>>(
      M(),
      `SELECT g.tipo, g.sequencia, g.numero_guia, g.senha, g.diarias_autorizadas,
              DATEDIFF(g.fim_validade, g.inicio_validade) AS dias, DATE(i.data_hora_entrada) = g.inicio_validade AS na_entrada
         FROM guia_internacao g JOIN internacao i ON i.id = g.internacao_id WHERE g.internacao_id = ?`,
      [internacao],
    );
    expect(g).toMatchObject({
      tipo: 'inicial',
      sequencia: 1,
      numero_guia: 'G-INICIAL',
      senha: 'S1',
      diarias_autorizadas: 3,
      dias: 2,
    });
  });

  it('diagnósticos: secundário e causa externa pelas regras; repetido e causa externa fora do capítulo XX recusados', async () => {
    const outro = Number(
      (
        await lerAdt<{ id: number }>(
          M(),
          `SELECT t.id FROM termo_terminologia t JOIN terminologia tt ON tt.id = t.terminologia_id
            WHERE tt.codigo = 'cid10' AND t.id <> ? AND t.codigo_termo NOT REGEXP '^[VWXY]' LIMIT 1`,
          [M().cid],
        )
      )?.id,
    );
    const externa = Number(
      (
        await lerAdt<{ id: number }>(
          M(),
          `SELECT t.id FROM termo_terminologia t JOIN terminologia tt ON tt.id = t.terminologia_id
            WHERE tt.codigo = 'cid10' AND t.codigo_termo LIKE 'W19%' LIMIT 1`,
          [],
        )
      )?.id,
    );
    const trilhas = () =>
      conta("SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'internacao' AND entidade_id = ?", [
        internacao,
      ]);
    const trilhasAntes = await trilhas();
    const r = await executar('internacao.registrarDiagnostico', {
      internacao,
      cid: outro,
      tipo: 'secundario',
    });
    expect(r['sequencia']).toBe(2);
    await expect(
      executar('internacao.registrarDiagnostico', { internacao, cid: outro, tipo: 'secundario' }),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'diagnostico-invalido');
    await expect(
      executar('internacao.registrarDiagnostico', { internacao, cid: outro, tipo: 'causa_externa' }),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'diagnostico-invalido');
    if (externa > 0) {
      await executar('internacao.registrarDiagnostico', { internacao, cid: externa, tipo: 'causa_externa' });
      expect(
        await conta(
          "SELECT COUNT(*) AS n FROM diagnostico_internacao WHERE internacao_id = ? AND tipo = 'causa_externa'",
          [internacao],
        ),
      ).toBe(1);
    }
    expect(
      await conta('SELECT COUNT(*) AS n FROM diagnostico_internacao WHERE internacao_id = ?', [internacao]),
    ).toBe(externa > 0 ? 3 : 2);
    // Cada gravação aceita deixa a sua linha na trilha da internação (as recusas não).
    expect(await trilhas()).toBe(trilhasAntes + (externa > 0 ? 2 : 1));
  });

  it('acidente de trabalho: sem empregador recusa; com empregador grava a linha com a sequência', async () => {
    const hoje = new Date().toISOString().slice(0, 10);
    await expect(
      executar('internacao.registrarAcidente', { internacao, tipo: 'trabalho', ocorridoEm: `${hoje}T00:01` }),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'acidente-invalido');
    const r = await executar('internacao.registrarAcidente', {
      internacao,
      tipo: 'trabalho',
      ocorridoEm: `${hoje}T00:01`,
      empregadorCnpj: '11.222.333/0001-81',
      vinculo: 'empregado',
      numeroComunicacao: 'CAT-1',
    });
    expect(r['sequencia']).toBe(1);
    expect(
      await lerAdt(
        M(),
        'SELECT tipo_acidente, empregador_cnpj, vinculo_previdenciario, numero_comunicacao_acidente, ocorrido_em IS NOT NULL AS tem_data FROM acidente_internacao WHERE internacao_id = ?',
        [internacao],
      ),
    ).toMatchObject({
      tipo_acidente: 'trabalho',
      empregador_cnpj: '11222333000181',
      vinculo_previdenciario: 'empregado',
      numero_comunicacao_acidente: 'CAT-1',
      tem_data: 1,
    });
  });

  it('prorrogação: nova linha com a validade seguinte e o autorizador; a guia inicial continua; buraco recusado', async () => {
    const c = Number(
      (
        await lerAdt<{ id: number }>(
          M(),
          'SELECT id FROM conta_hospitalar WHERE estabelecimento_id = ? ORDER BY id DESC LIMIT 1',
          [M().est],
        )
      )?.id,
    );
    await expect(
      executar('internacao.registrarGuia', {
        internacao,
        conta: c,
        guia: 'G-BURACO',
        validadeDias: 2,
        inicio: '2099-01-01',
      }),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'guia-invalida');
    await executar('internacao.registrarGuia', {
      internacao,
      conta: c,
      guia: 'G-PRORROGA',
      senha: 'S2',
      validadeDias: 4,
      autorizador: 'AUDITORIA SINTETICA',
    });
    const linhas = await lerAdt<{ n: number; ini: string; pro: string; seguida: number }>(
      M(),
      `SELECT COUNT(*) AS n, MAX(CASE WHEN sequencia = 1 THEN numero_guia END) AS ini,
              MAX(CASE WHEN sequencia = 2 THEN CONCAT(tipo, '|', autorizador_nome, '|', diarias_autorizadas) END) AS pro,
              MAX(CASE WHEN sequencia = 2 THEN inicio_validade END) =
                DATE_ADD(MAX(CASE WHEN sequencia = 1 THEN fim_validade END), INTERVAL 1 DAY) AS seguida
         FROM guia_internacao WHERE internacao_id = ?`,
      [internacao],
    );
    expect(linhas).toMatchObject({
      n: 2,
      ini: 'G-INICIAL',
      pro: 'prorrogacao|AUDITORIA SINTETICA|4',
      seguida: 1,
    });
    expect(
      await lerAdt(M(), 'SELECT numero_guia, senha_autorizacao FROM internacao WHERE id = ?', [internacao]),
    ).toMatchObject({ numero_guia: 'G-PRORROGA', senha_autorizacao: 'S2' });
    const leitura = await porta.lerNoEstabelecimento(contextoAdt(M()), (l, est, fuso) =>
      lerRegistrosDaInternacao(l, est, fuso, internacao),
    );
    expect(leitura?.guias.map((g) => g.tipo)).toEqual(['inicial', 'prorrogacao']);
    expect(leitura?.diariasAutorizadas).toBe(7);
    expect(leitura?.acidentes).toHaveLength(1);
    expect(leitura?.diagnosticos[0]?.tipo).toBe('entrada');
  });

  it('operadores da unidade: com a regra, quem não está liberado não admite; lista vazia retira sem apagar', async () => {
    const unidade = await unidadeDaMassa();
    const outroUsuario = Number(
      (
        await lerAdt<{ id: number }>(M(), 'SELECT id FROM usuario WHERE id <> ? ORDER BY id LIMIT 1', [
          M().usuario,
        ])
      )?.id,
    );
    await executar('internacao.definirOperadoresUnidade', {
      unidade,
      operadores: [{ usuario: outroUsuario, podeAdmitir: true, podeTransferir: true, podeDarAlta: true }],
    });
    await expect(internar(M().pacientes[1]!, M().leitos[2]!)).rejects.toSatisfy(
      (e) => codigoDe(e) === 'unidade-sem-permissao',
    );
    const r = await executar('internacao.definirOperadoresUnidade', {
      unidade,
      operadores: [
        { usuario: outroUsuario, podeAdmitir: true, podeTransferir: true, podeDarAlta: true },
        { usuario: M().usuario, podeAdmitir: true, podeTransferir: false, podeDarAlta: false },
      ],
    });
    expect(r).toMatchObject({ incluidos: 1, alterados: 0, retirados: 0 });
    const i2 = Number((await internar(M().pacientes[1]!, M().leitos[2]!))['internacao']);
    expect(i2).toBeGreaterThan(0);
    const vazia = await executar('internacao.definirOperadoresUnidade', { unidade, operadores: [] });
    expect(vazia).toMatchObject({ retirados: 2 });
    expect(
      await conta(
        'SELECT COUNT(*) AS n FROM permissao_unidade_usuario WHERE unidade_internacao_id = ? AND excluido_em IS NOT NULL',
        [unidade],
      ),
    ).toBe(2);
  });
});
