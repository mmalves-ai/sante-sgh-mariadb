// Contrato de efeito do óbito registrado no cadastro na ADMISSÃO e na PRÉ-INTERNAÇÃO (F7, 02-CAD linha 13) contra o
// MariaDB real (cliente de teste; f22_o3 por padrão), massa SINTÉTICA (massa-adt.spec-util.ts, marca F). Prova o que
// fica no banco: com o paciente marcado como falecido (atributo da declaração de óbito ou situação 'obito'), as operações
// internacao.internar e internacao.preInternar são recusadas com 'paciente-falecido' e NADA é gravado (nem
// atendimento, nem internação, nem pré-internação, nem ocupação de leito). Desfeita a marca (declaração cancelada), a
// mesma admissão grava. A marca sai no fim. SGH_NUCLEO_SEM_BANCO=1 pula.
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

describe.skipIf(SEM_BANCO_ADT)(
  `óbito registrado barra a admissão e a pré-internação (MariaDB, cliente ${CLIENTE_ADT})`,
  () => {
    let m: MassaAdt | null = null;
    let porta: PortaAdtPropria;
    const M = () => m!;
    const num = async (sql: string, p: unknown[]) =>
      Number((await lerAdt<{ n: number }>(M(), sql, p))?.n ?? 0);
    const escrever = (fn: Parameters<MassaAdt['nucleo']['escrever']>[1]) =>
      M().nucleo.escrever({ cliente: CLIENTE_ADT, correlacao: 'int-c1029-preparo' }, fn);
    const marcar = (paciente: number, o: { falecido: boolean; situacao?: string }) =>
      escrever(async (e) => {
        await e.executar('UPDATE paciente SET falecido = ?, data_hora_obito = ?, situacao = ? WHERE id = ?', [
          o.falecido,
          o.falecido ? new Date('2026-11-20T12:00:00Z') : null,
          o.situacao ?? 'ativo',
          paciente,
        ]);
      });
    const adt = (op: string, entrada: Record<string, unknown>) =>
      porta
        .executar(contextoAdt(M()), op, entrada, { ...operacaoAdt(M()), reautenticadoEm: Date.now() })
        .then((r) => r.resultado as Record<string, unknown>);
    const internar = (paciente: number, leito: string) =>
      adt('internacao.internar', {
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
      });
    const preInternar = (paciente: number) =>
      adt('internacao.preInternar', {
        paciente,
        convenio: M().convenio,
        especialidade: M().especialidade,
        medicoSolicitante: M().medico,
        // A recusa vem antes da conferência do plano e da clínica no banco: bastam valores válidos no contrato.
        plano: 'PLANO SINTETICO',
        clinica: 1,
        carater: 'urgencia',
      });
    const falecido = {
      problema: expect.objectContaining({ codigo: 'paciente-falecido', campos: ['paciente'] }),
    };
    const retrato = async (paciente: number) => ({
      atendimentos: await num('SELECT COUNT(*) AS n FROM atendimento WHERE paciente_id = ?', [paciente]),
      internacoes: await num('SELECT COUNT(*) AS n FROM internacao WHERE paciente_id = ?', [paciente]),
      preInternacoes: await num('SELECT COUNT(*) AS n FROM agendamento_internacao WHERE paciente_id = ?', [
        paciente,
      ]),
      ocupacoes: await num('SELECT COUNT(*) AS n FROM ocupacao_leito WHERE estabelecimento_id = ?', [
        M().est,
      ]),
    });

    beforeAll(async () => {
      m = await prepararMassaAdt('F');
      porta = new PortaAdtPropria(M().nucleo);
    });

    afterAll(async () => {
      if (m) for (const p of M().pacientes) await marcar(p, { falecido: false }).catch(() => undefined);
      await encerrarMassaAdt(m);
    });

    it('falecido pela declaração: admissão e pré-internação recusadas e nada é gravado', async () => {
      const [p1] = M().pacientes;
      await marcar(p1!, { falecido: true });
      const antes = await retrato(p1!);
      await expect(internar(p1!, '01')).rejects.toMatchObject(falecido);
      await expect(preInternar(p1!)).rejects.toMatchObject(falecido);
      expect(await retrato(p1!)).toEqual(antes);
    });

    it("situação 'obito' sem declaração ligada também recusa, sem gravar", async () => {
      const [, p2] = M().pacientes;
      await marcar(p2!, { falecido: false, situacao: 'obito' });
      const antes = await retrato(p2!);
      await expect(internar(p2!, '02')).rejects.toMatchObject(falecido);
      await expect(preInternar(p2!)).rejects.toMatchObject(falecido);
      expect(await retrato(p2!)).toEqual(antes);
    });

    it('desfeita a marca (declaração cancelada), a mesma admissão grava atendimento, internação e leito', async () => {
      const [p1] = M().pacientes;
      await marcar(p1!, { falecido: false });
      const antes = await retrato(p1!);
      const r = await internar(p1!, '01');
      expect(Number(r['internacao'])).toBeGreaterThan(0);
      const depois = await retrato(p1!);
      expect(depois.atendimentos).toBe(antes.atendimentos + 1);
      expect(depois.internacoes).toBe(antes.internacoes + 1);
      expect(depois.ocupacoes).toBe(antes.ocupacoes + 1);
    });
  },
);
