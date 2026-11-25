// Contrato de efeito do aviso de representação na admissão (F3.1, 02-CAD linha 4) contra o MariaDB real, com a massa
// SINTÉTICA da internação (a marca R, a mesma dos registros da internação; nenhuma pessoa real): o incapaz sem curador e o menor sem representante são
// internados (a urgência não espera o cadastro) e o resultado da operação leva o aviso para a recepção regularizar a
// ficha; o adulto capaz interna sem aviso. O aviso sai do servidor, sem depender da tela nem da permissão de leitura do
// cadastro. Requer a migração 03_CAD/96_incapacidade_paciente no cliente. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
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

describe.skipIf(SEM_BANCO_ADT)(`aviso de representação na admissão (MariaDB, cliente ${CLIENTE_ADT})`, () => {
  let m: MassaAdt | null = null;
  let porta: PortaAdtPropria;
  const M = () => m!;
  const num = async (sql: string, p: unknown[]) =>
    Number((await lerAdt<{ n: number }>(M(), sql, p))?.n ?? -1);
  const escrever = (sql: string, p: unknown[]) =>
    M().nucleo.escrever({ cliente: CLIENTE_ADT, correlacao: 'int-0301r-representacao' }, (e) =>
      e.executar(sql, p),
    );
  const nascimento = (paciente: number, data: string | null) =>
    escrever(
      'UPDATE pessoa_fisica pf JOIN paciente pa ON pa.pessoa_fisica_id = pf.id SET pf.data_nascimento = ? WHERE pa.id = ?',
      [data, paciente],
    );
  const limpar = async () => {
    const ids = M().pacientes;
    const em = ids.map(() => '?').join(', ');
    await escrever(`DELETE FROM incapacidade_paciente WHERE paciente_id IN (${em})`, [...ids]);
    await escrever(`DELETE FROM responsavel_paciente WHERE paciente_id IN (${em})`, [...ids]);
    for (const id of ids) await nascimento(id, null);
  };
  const internar = (paciente: number, leito: string) =>
    porta
      .executar(
        contextoAdt(M()),
        'internacao.internar',
        {
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
        },
        { ...operacaoAdt(M()), reautenticadoEm: Date.now() },
      )
      .then((r) => r.resultado as Record<string, unknown>);
  const ativa = (internacao: unknown, paciente: number) =>
    num("SELECT COUNT(*) AS n FROM internacao WHERE id = ? AND paciente_id = ? AND situacao = 'ativa'", [
      internacao,
      paciente,
    ]);

  beforeAll(async () => {
    m = await prepararMassaAdt('R');
    porta = new PortaAdtPropria(M().nucleo);
    await limpar();
  }, 180_000);

  afterAll(async () => {
    if (m) await limpar().catch(() => undefined);
    await encerrarMassaAdt(m);
  });

  it('o incapaz sem curador é internado e o resultado avisa', async () => {
    const [incapaz] = M().pacientes;
    await nascimento(incapaz!, '1980-05-17');
    await escrever(
      `INSERT INTO incapacidade_paciente (paciente_id, vigencia_inicio, documento_tipo, documento_data, criado_em)
         VALUES (?, '2025-02-10', 'laudo_medico', '2025-02-10', ?)`,
      [incapaz, new Date()],
    );
    const r = await internar(incapaz!, M().leitos[0]!);
    expect(Number(r['internacao'])).toBeGreaterThan(0);
    expect(r['alertaRepresentacao']).toBe('incapaz-sem-curador');
    expect(String(r['alertaRepresentacaoMotivo'])).toContain('sem curador vigente');
    expect(await ativa(r['internacao'], incapaz!)).toBe(1);
  });

  it('o menor sem representante é internado e o resultado avisa', async () => {
    const menor = M().pacientes[1]!;
    const ha10 = new Date();
    ha10.setFullYear(ha10.getFullYear() - 10);
    await nascimento(menor, ha10.toISOString().slice(0, 10));
    const r = await internar(menor, M().leitos[1]!);
    expect(Number(r['internacao'])).toBeGreaterThan(0);
    expect(r['alertaRepresentacao']).toBe('menor-sem-representante');
    expect(String(r['alertaRepresentacaoMotivo'])).toContain('menor de idade');
    expect(await ativa(r['internacao'], menor)).toBe(1);
  });

  it('o adulto capaz é internado sem aviso', async () => {
    const adulto = M().pacientes[2]!;
    await nascimento(adulto, '1975-08-20');
    const r = await internar(adulto, M().leitos[2]!);
    expect(Number(r['internacao'])).toBeGreaterThan(0);
    expect(r['alertaRepresentacao']).toBeUndefined();
    expect(r['alertaRepresentacaoMotivo']).toBeUndefined();
    expect(await ativa(r['internacao'], adulto)).toBe(1);
  });
});
