// F3.4 (04-INT linha 70): contrato de efeito da pré-internação contra o MariaDB real, cliente f22_o3, massa SINTÉTICA
// (massa-adt.spec-util.ts, marca J). Sem data, a pré-internação grava previsto_para NULO na fila de espera (situação
// em_espera), com a clínica assistencial, o plano e o vínculo da cirurgia; a lista põe as sem data por último; a
// correção confere a VERSÃO lida (não a data), passa a 'solicitado' e mantém a hora prevista; o CHECK
// ck_agendamento_internacao_previsto recusa a gravação incoerente; plano, CID e procedimento sem casamento: 422.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { ErroOperacao } from '@sgh/nucleo';
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

const P = 'L0304J';

describe.skipIf(SEM_BANCO_ADT)(`pré-internação: contrato de efeito (MariaDB, cliente ${CLIENTE_ADT})`, () => {
  let m: MassaAdt | null = null;
  let porta: PortaAdtPropria;
  const M = () => m!;
  const cfg = { clinica: 0 };
  const escrever = <T>(fn: Parameters<MassaAdt['nucleo']['escrever']>[1]) =>
    M().nucleo.escrever({ cliente: CLIENTE_ADT, correlacao: 'int-pre-internacao' }, fn) as Promise<T>;
  const adt = (op: string, entrada: unknown) =>
    porta
      .executar(contextoAdt(M()), op, entrada, { ...operacaoAdt(M()), reautenticadoEm: Date.now() })
      .then((r) => r.resultado as Record<string, unknown>);
  const linha = (paciente: number) =>
    lerAdt<{
      previsto_para: Date | null;
      situacao: string;
      clinica_assistencial_id: number;
      plano_fonte_pagadora_id: number | null;
      versao: number;
    }>(
      M(),
      'SELECT previsto_para, situacao, clinica_assistencial_id, plano_fonte_pagadora_id, agendamento_cirurgico_id, versao FROM agendamento_internacao WHERE estabelecimento_id = ? AND paciente_id = ? AND excluido_em IS NULL',
      [M().est, paciente],
    );
  const apagarAgendamentos = () =>
    escrever((e) => e.executar('DELETE FROM agendamento_internacao WHERE estabelecimento_id = ?', [M().est]));
  const corpo = (paciente: number, extra: Record<string, unknown> = {}) => ({
    paciente,
    convenio: M().convenio,
    plano: `${P}-PL`,
    especialidade: M().especialidade,
    medicoSolicitante: M().medico,
    clinica: cfg.clinica,
    carater: 'urgencia',
    ...extra,
  });
  const recusada = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (x) {
      return x instanceof ErroOperacao ? `${x.problema.status}:${String(x.problema.codigo)}` : String(x);
    }
    return 'aceita';
  };

  beforeAll(async () => {
    m = await prepararMassaAdt('J');
    porta = new PortaAdtPropria(M().nucleo);
    await apagarAgendamentos();
    Object.assign(
      cfg,
      await escrever(async (e) => {
        const agora = new Date();
        const garantir = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
          const l = await e.uma<{ id: number }>(sel, p);
          return l ? Number(l.id) : e.inserir(ins, pi);
        };
        const clinica = await garantir(
          'SELECT id FROM clinica_assistencial WHERE codigo = ?',
          [`${P}-CIR`],
          "INSERT INTO clinica_assistencial (codigo, descricao, natureza, criado_em) VALUES (?, 'CLINICA CIRURGICA SINTETICA', 'cirurgica', ?)",
          [`${P}-CIR`, agora],
        );
        await garantir(
          'SELECT id FROM plano_fonte_pagadora WHERE fonte_pagadora_id = ? AND codigo = ?',
          [M().convenio, `${P}-PL`],
          "INSERT INTO plano_fonte_pagadora (fonte_pagadora_id, codigo, descricao, criado_em) VALUES (?, ?, 'PLANO SINTETICO', ?)",
          [M().convenio, `${P}-PL`, agora],
        );
        await garantir(
          "SELECT id FROM sequencia_negocio WHERE estabelecimento_id = ? AND tipo = 'agendamento_internacao'",
          [M().est],
          "INSERT INTO sequencia_negocio (estabelecimento_id, tipo, proximo_valor, criado_em) VALUES (?, 'agendamento_internacao', 1, ?)",
          [M().est, agora],
        );
        return { clinica };
      }),
    );
  }, 120_000);

  afterAll(async () => {
    if (m) await apagarAgendamentos();
    await encerrarMassaAdt(m);
  });

  it('grava sem data (NULA, em_espera) com a clínica e o plano; lista por último; corrige pela versão e mantém a hora', async () => {
    const [semData, comData] = M().pacientes;
    await adt('internacao.preInternar', corpo(semData!));
    const daqui30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    await adt('internacao.preInternar', corpo(comData!, { dataPrevista: daqui30, horaPrevista: '14:30' }));

    const a = await linha(semData!);
    expect(a?.previsto_para).toBeNull();
    expect(a?.situacao).toBe('em_espera');
    expect(Number(a?.clinica_assistencial_id)).toBe(cfg.clinica);
    expect(a?.plano_fonte_pagadora_id).not.toBeNull();
    expect((await porta.preDoPaciente(contextoAdt(M()), semData!))?.clinica).toBe('C');

    const lista = await porta.preInternacoes(contextoAdt(M()), { situacao: 'todas' });
    const ordem = lista.itens.map((x) => x.paciente).filter((x) => x === semData || x === comData);
    expect(ordem).toEqual([comData, semData]);
    expect(lista.itens.find((x) => x.paciente === comData)?.horaPrevista).toBe('14:30');

    // O CHECK recusa a gravação incoerente (pendente com data, mas sem ela).
    expect(
      await recusada(
        escrever((e) =>
          e.executar(
            "UPDATE agendamento_internacao SET situacao = 'solicitado' WHERE estabelecimento_id = ? AND paciente_id = ?",
            [M().est, semData],
          ),
        ),
      ),
    ).not.toBe('aceita');

    // Versão velha: conflito, mesmo sem mudar a data.
    const v = Number(a?.versao);
    expect(
      await recusada(adt('internacao.corrigirPreInternacao', { paciente: semData, versao: v + 1 })),
    ).toBe('409:conflito-versao');
    await adt('internacao.corrigirPreInternacao', { paciente: semData, dataPrevista: daqui30, versao: v });
    const b = await linha(semData!);
    expect(b?.situacao).toBe('solicitado');
    expect(b?.previsto_para).not.toBeNull();
    expect(Number(b?.versao)).toBe(v + 1);

    // Só a data muda: a hora prevista (14:30) fica.
    const vc = Number((await linha(comData!))?.versao);
    const daqui31 = new Date(Date.now() + 31 * 86_400_000).toISOString().slice(0, 10);
    await adt('internacao.corrigirPreInternacao', { paciente: comData, dataPrevista: daqui31, versao: vc });
    const depois = await porta.preInternacoes(contextoAdt(M()), { situacao: 'todas' });
    const c = depois.itens.find((x) => x.paciente === comData);
    expect(c?.dataPrevista).toBe(daqui31);
    expect(c?.horaPrevista).toBe('14:30');
  });

  it('recusa com 422 o plano, o CID e o procedimento sem casamento (nada fica nulo em silêncio)', async () => {
    const pac = M().pacientes[2]!;
    expect(await recusada(adt('internacao.preInternar', corpo(pac, { plano: `${P}-NAO` })))).toBe(
      '422:plano-inexistente',
    );
    expect(await recusada(adt('internacao.preInternar', corpo(pac, { cid: 'Z9999' })))).toBe(
      '422:cid-inexistente',
    );
    expect(await recusada(adt('internacao.preInternar', corpo(pac, { procedimento: 9_999_999_901 })))).toBe(
      '422:procedimento-inexistente',
    );
    expect(await linha(pac)).toBeNull();
  });
});
