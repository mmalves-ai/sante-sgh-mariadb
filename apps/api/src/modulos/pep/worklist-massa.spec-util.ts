// Massa SINTÉTICA da fila do médico (lote 04-02) no cliente de teste f22_o4, para os testes de integração da porta
// própria e do serviço. Nenhum dado de pessoa: estabelecimentos com o código do teste, ids de paciente e de atendimento
// fictícios. As tabelas que a porta lê (internacao, requisicao_exame, exame_item, resultado_exame e prescricao) recebem
// linhas com as chaves estrangeiras de catálogo desligadas SÓ na transação do preparo (a porta não lê esses catálogos);
// os CHECKs do modelo continuam valendo. A limpeza apaga tudo pelos estabelecimentos do teste.
import type { Escritor, NucleoProprio } from '@sgh/nucleo';

export const CLIENTE_F22_O4 = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const HORA = 3_600_000;
const DIA = 24 * HORA;

export interface MassaWorklist {
  readonly estA: number;
  readonly estB: number;
  readonly agora: Date;
  readonly pac1: number;
  readonly pac2: number;
  /** Internações: com previsão (A), de outro estabelecimento (B), excluída (X) e sem previsão. */
  readonly int: { readonly a: number; readonly b: number; readonly x: number; readonly semPrevisao: number };
  /** Resultados: os dois que entram na fila (A) e os que ficam de fora. */
  readonly res: {
    readonly novo: number;
    readonly pac2: number;
    readonly antigo: number;
    readonly digitado: number;
    readonly outroEst: number;
    readonly excluido: number;
  };
  /** Atendimentos: 1 a renovar; 2 com a seguinte; 3 fora da janela; 4 de outro estabelecimento; 5 excluída; 6 enfermagem. */
  readonly atd: readonly [number, number, number, number, number, number];
  /** Fim da prescrição a renovar (atendimento 1). */
  readonly fimARenovar: Date;
}

/** Apaga a massa do prefixo (estabelecimentos `<p>` e `<p>b`). */
export async function limparMassaWorklist(e: Escritor, p: string): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo IN (?, ?))';
  const cods = [p, `${p}b`];
  await e.executar(
    `DELETE r FROM resultado_exame r JOIN exame_item i ON i.id = r.exame_item_id
       JOIN requisicao_exame q ON q.id = i.requisicao_exame_id WHERE q.estabelecimento_id IN ${est}`,
    cods,
  );
  await e.executar(
    `DELETE i FROM exame_item i JOIN requisicao_exame q ON q.id = i.requisicao_exame_id
      WHERE q.estabelecimento_id IN ${est}`,
    cods,
  );
  await e.executar(`DELETE FROM requisicao_exame WHERE estabelecimento_id IN ${est}`, cods);
  await e.executar(`DELETE FROM internacao WHERE estabelecimento_id IN ${est}`, cods);
  await e.executar(`DELETE FROM prescricao WHERE estabelecimento_id IN ${est}`, cods);
  await e.executar(`DELETE FROM trilha_auditoria WHERE estabelecimento_id IN ${est}`, cods);
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', cods);
}

/** Monta a massa do prefixo `p` (estabelecimentos `<p>` e `<p>b`); `base` separa os ids fictícios entre os arquivos. */
export async function montarMassaWorklist(nucleo: NucleoProprio, p: string, base: number): Promise<MassaWorklist> {
  return nucleo.escrever({ cliente: CLIENTE_F22_O4, correlacao: `preparo-${p}` }, async (e) => {
    await limparMassaWorklist(e, p);
    const agora = new Date();
    const em = (ms: number) => new Date(agora.getTime() + ms);
    const est = (codigo: string) =>
      e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [codigo, `Hospital sintético ${codigo}`, `Hospital sintético ${codigo} (fictício)`, agora],
      );
    const estA = await est(p);
    const estB = await est(`${p}b`);
    const pac1 = base + 1;
    const pac2 = base + 2;
    await e.executar('SET FOREIGN_KEY_CHECKS = 0');
    try {
      let n = 0;
      const internacao = (estab: number, previsao: string | null, excluida = false) =>
        e.inserir(
          `INSERT INTO internacao (estabelecimento_id, numero, atendimento_id, paciente_id, data_hora_entrada,
             carater_admissao_id, modalidade_internacao_id, unidade_internacao_id, acomodacao_id, especialidade_medica_id,
             medico_assistente_profissional_id, fonte_pagadora_id, data_prevista_alta, situacao, excluido_em, criado_em)
           VALUES (?, ?, ?, ?, ?, 1, 1, 1, 1, 1, 1, 1, ?, 'ativa', ?, ?)`,
          // Uma internação vigente por paciente (chave do modelo): pacientes fictícios distintos; a porta lê pelo id.
          [estab, `${p}-${++n}`, base + 100 + n, base + 200 + n, em(-2 * DIA), previsao, excluida ? agora : null, agora],
        );
      const int = {
        a: await internacao(estA, '2026-12-01'),
        b: await internacao(estB, '2026-12-02'),
        x: await internacao(estA, '2026-12-03', true),
        semPrevisao: await internacao(estA, null),
      };
      const resultado = async (
        estab: number,
        paciente: number,
        o: { liberado?: Date | null; situacao?: string; excluido?: boolean },
      ) => {
        const req = await e.inserir(
          `INSERT INTO requisicao_exame (estabelecimento_id, numero, paciente_id, atendimento_id, setor_diagnostico_id,
             solicitante_profissional_id, fonte_pagadora_id, solicitado_em, criado_em)
           VALUES (?, ?, ?, ?, 1, 1, 1, ?, ?)`,
          [estab, `${p}-r${++n}`, paciente, base + 10, em(-3 * DIA), agora],
        );
        const item = await e.inserir(
          'INSERT INTO exame_item (requisicao_exame_id, sequencia, exame_id, criado_em) VALUES (?, 1, 1, ?)',
          [req, agora],
        );
        const liberado = o.liberado === undefined ? em(-HORA) : o.liberado;
        return e.inserir(
          `INSERT INTO resultado_exame (exame_item_id, paciente_id, setor_diagnostico_id, resultado_em, situacao,
             liberado_em, autoliberado, excluido_em, criado_em)
           VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`,
          [
            item,
            paciente,
            em(-2 * HORA),
            o.situacao ?? 'liberado',
            liberado,
            liberado !== null,
            o.excluido ? agora : null,
            agora,
          ],
        );
      };
      const res = {
        novo: await resultado(estA, pac1, {}),
        pac2: await resultado(estA, pac2, { liberado: em(-2 * HORA) }),
        antigo: await resultado(estA, pac1, { liberado: em(-40 * DIA) }),
        digitado: await resultado(estA, pac1, { liberado: null, situacao: 'digitado' }),
        outroEst: await resultado(estB, pac1, {}),
        excluido: await resultado(estA, pac1, { excluido: true }),
      };
      const atd = [base + 11, base + 12, base + 13, base + 14, base + 15, base + 16] as const;
      let numero = 0;
      const prescricao = (
        estab: number,
        atendimento: number,
        situacao: 'vigente' | 'futura',
        inicio: Date,
        fim: Date,
        o: { tipo?: string; excluida?: boolean } = {},
      ) =>
        e.inserir(
          `INSERT INTO prescricao (estabelecimento_id, numero, paciente_id, atendimento_id, prescritor_profissional_id,
             tipo, situacao, prescrito_em, vigencia_inicio_em, vigencia_fim_em, excluido_em, criado_em)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
          [
            estab,
            base + ++numero,
            pac1,
            atendimento,
            o.tipo ?? 'medica',
            situacao,
            inicio,
            inicio,
            fim,
            o.excluida ? agora : null,
            agora,
          ],
        );
      const fimARenovar = em(3 * HORA);
      await prescricao(estA, atd[0], 'vigente', em(-21 * HORA), fimARenovar);
      await prescricao(estA, atd[1], 'vigente', em(-22 * HORA), em(2 * HORA));
      await prescricao(estA, atd[1], 'futura', em(2 * HORA), em(26 * HORA));
      await prescricao(estA, atd[2], 'vigente', em(-14 * HORA), em(10 * HORA));
      await prescricao(estB, atd[3], 'vigente', em(-21 * HORA), em(3 * HORA));
      await prescricao(estA, atd[4], 'vigente', em(-21 * HORA), em(3 * HORA), { excluida: true });
      await prescricao(estA, atd[5], 'vigente', em(-21 * HORA), em(3 * HORA), { tipo: 'enfermagem' });
      return { estA, estB, agora, pac1, pac2, int, res, atd, fimARenovar };
    } finally {
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    }
  });
}
