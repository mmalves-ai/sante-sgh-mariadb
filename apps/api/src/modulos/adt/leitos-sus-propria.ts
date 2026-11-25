// Leitos do sistema público (F78.04-2, 04-INT linha 79), no banco do cliente. As regras são as puras de
// @sgh/dominio-internacao (leitos-sus.ts); aqui ficam a leitura e a gravação. Contrato de efeito:
//   - habilitação: `habilitacao_leito_sus` do estabelecimento (código, nome, portaria, vigência, quantidade de leitos
//     habilitados, tipo de atendimento, uso fora do programa e aviso), conferida pelo domínio; encerrar grava o fim da
//     vigência com a versão lida (nada apagado);
//   - leito no programa: `leito_habilitado_sus` (habilitação, leito do estabelecimento, vigência) dentro da vigência da
//     habilitação e da quantidade habilitada; a saída do programa grava o fim (o histórico fica);
//   - capacidade contratada: uma linha NOVA em `capacidade_leito_sus` a cada inclusão, alteração ou retirada (operação,
//     retrato em `dados`, quem e quando); a vigente é a última da especialidade na competência; o teto de diárias
//     especiais vem do domínio (leitos × dias do mês). A liberação da crítica guarda o usuário que liberou.
import {
  capacidadeVigente,
  conferirCapacidadeSus,
  conferirFimVinculo,
  conferirHabilitacaoLeitoSus,
  conferirVinculoLeitoPrograma,
  type LinhaCapacidadeSus,
  type OperacaoCapacidadeSus,
  TIPOS_ATENDIMENTO_LEITO_SUS,
  tetoDiariasEspeciais,
  type VinculoLeitoPrograma,
} from '@sgh/dominio-internacao';
import { z } from 'zod';
import {
  bool,
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

export const PORTA_LEITOS_SUS = Symbol('PORTA_LEITOS_SUS');

const TABELAS = ['habilitacao_leito_sus', 'leito_habilitado_sus', 'capacidade_leito_sus'];

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dataIso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
const instanteIso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();

const esquemaHabilitacao = z
  .object({
    codigo: z.string().trim().min(1).max(30),
    nome: z.string().trim().min(1).max(150),
    descricao: z.string().max(500).nullable().default(null),
    habilitacaoSus: z.number().int().positive().nullable().default(null),
    numeroPortaria: z.string().trim().min(1).max(60).nullable().default(null),
    dataPortaria: dia.nullable().default(null),
    vigenciaInicio: dia,
    vigenciaFim: dia.nullable().default(null),
    quantidadeLeitosHabilitados: z.number().int().nullable().default(null),
    tipoAtendimento: z.enum(TIPOS_ATENDIMENTO_LEITO_SUS).default('internacao'),
    permiteUsoForaPrograma: z.boolean().default(false),
    avisaUsuario: z.boolean().default(false),
    observacao: z.string().max(2000).nullable().default(null),
  })
  .strict();
const esquemaFim = z.object({ vigenciaFim: dia, versao: z.number().int().positive() }).strict();
const esquemaVinculo = z
  .object({
    leito: z.number().int().positive(),
    vigenciaInicio: dia,
    vigenciaFim: dia.nullable().default(null),
  })
  .strict();
const esquemaCapacidade = z
  .object({
    especialidade: z.number().int().positive(),
    competencia: dia,
    quantidadeLeitos: z.number().int().default(0),
    criticaLiberada: z.boolean().default(false),
    excluir: z.boolean().default(false),
  })
  .strict();

export interface HabilitacaoLeitoSusLida {
  readonly id: number;
  readonly codigo: string;
  readonly nome: string;
  readonly descricao: string | null;
  readonly numeroPortaria: string | null;
  readonly dataPortaria: string | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly quantidadeLeitosHabilitados: number | null;
  readonly tipoAtendimento: string;
  readonly permiteUsoForaPrograma: boolean;
  readonly avisaUsuario: boolean;
  readonly ativo: boolean;
  readonly leitosNoPrograma: number;
  readonly versao: number;
}

export interface LeitoNoProgramaLido {
  readonly id: number;
  readonly leito: number;
  readonly leitoCodigo: string;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly versao: number;
}

export interface CapacidadeLida {
  readonly especialidade: number;
  readonly especialidadeDescricao: string;
  readonly terapiaIntensiva: boolean;
  readonly quantidadeLeitos: number;
  readonly criticaLiberada: boolean;
  readonly tetoDiarias: number;
  readonly historico: readonly {
    readonly id: number;
    readonly operacao: string;
    readonly quantidadeLeitos: number;
    readonly criticaLiberada: boolean;
    readonly ocorridoEm: string;
    readonly usuario: number | null;
  }[];
}

const linhaCapacidade = (r: Record<string, unknown>): LinhaCapacidadeSus => ({
  id: num(r['id']),
  especialidade: num(r['especialidade_leito_id']),
  competencia: dataIso(r['competencia'])!,
  quantidadeLeitos: num(r['quantidade_leitos']),
  criticaLiberada: bool(r['critica_liberada']),
  operacao: String(r['operacao']) as OperacaoCapacidadeSus,
  ocorridoEm: instanteIso(r['ocorrido_em']),
});

export class PortaLeitosSusPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'internacao.leitosSus');
  }

  /** As habilitações do estabelecimento, com os leitos no programa hoje. */
  habilitacoes(c: ContextoPortaPropria): Promise<HabilitacaoLeitoSusLida[]> {
    return this.ler(c, 'habilitacoes', async (l, est) =>
      (
        await l.consultar(
          `SELECT h.*, (SELECT COUNT(*) FROM leito_habilitado_sus v
                         WHERE v.habilitacao_leito_sus_id = h.id AND v.excluido_em IS NULL
                           AND v.vigencia_inicio <= CURRENT_DATE
                           AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)) AS no_programa
             FROM habilitacao_leito_sus h
            WHERE h.estabelecimento_id = ? AND h.excluido_em IS NULL
            ORDER BY h.ativo DESC, h.codigo LIMIT 500`,
          [est.id],
        )
      ).map((r) => ({
        id: num(r['id']),
        codigo: String(r['codigo']),
        nome: String(r['nome']),
        descricao: txtOuNull(r['descricao']),
        numeroPortaria: txtOuNull(r['numero_portaria']),
        dataPortaria: dataIso(r['data_portaria']),
        vigenciaInicio: dataIso(r['vigencia_inicio'])!,
        vigenciaFim: dataIso(r['vigencia_fim']),
        quantidadeLeitosHabilitados: numOuNull(r['quantidade_leitos_habilitados']),
        tipoAtendimento: String(r['tipo_atendimento']),
        permiteUsoForaPrograma: bool(r['permite_uso_fora_programa']),
        avisaUsuario: bool(r['avisa_usuario']),
        ativo: bool(r['ativo']),
        leitosNoPrograma: num(r['no_programa']),
        versao: num(r['versao']),
      })),
    );
  }

  async incluirHabilitacao(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaHabilitacao, entrada);
    const p = conferirHabilitacaoLeitoSus(e);
    if (p.length) throw recusaRegra('Habilitação recusada', p);
    return this.gravar(
      c,
      'internacao.leitossus.habilitacao.incluir',
      ['habilitacao_leito_sus'],
      async (tx, est) => {
        const ja = await tx.uma(
          'SELECT id FROM habilitacao_leito_sus WHERE estabelecimento_id = ? AND codigo = ?',
          [est.id, e.codigo],
        );
        if (ja)
          throw recusaRegra('Habilitação recusada', [
            { campo: 'codigo', mensagem: 'Já existe habilitação com este código no estabelecimento.' },
          ]);
        const id = await tx.incluir('habilitacao_leito_sus', {
          estabelecimento_id: est.id,
          habilitacao_sus_id: e.habilitacaoSus,
          codigo: e.codigo,
          nome: e.nome,
          descricao: e.descricao,
          numero_portaria: e.numeroPortaria,
          data_portaria: e.dataPortaria,
          vigencia_inicio: e.vigenciaInicio,
          vigencia_fim: e.vigenciaFim,
          quantidade_leitos_habilitados: e.quantidadeLeitosHabilitados,
          tipo_atendimento: e.tipoAtendimento,
          permite_uso_fora_programa: e.permiteUsoForaPrograma,
          avisa_usuario: e.avisaUsuario,
          observacao: e.observacao,
          ativo: true,
          origem: 'sistema',
        });
        return { tabela: 'habilitacao_leito_sus', id };
      },
    );
  }

  /** Encerra a vigência da habilitação; os leitos do programa sem fim (ou com fim depois) saem na mesma data. */
  async encerrarHabilitacao(c: ContextoPortaPropria, id: number, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaFim, entrada);
    return this.gravar(
      c,
      'internacao.leitossus.habilitacao.encerrar',
      ['habilitacao_leito_sus', 'leito_habilitado_sus'],
      async (tx, est) => {
        const h = await tx.uma(
          'SELECT vigencia_inicio, vigencia_fim FROM habilitacao_leito_sus WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [id, est.id],
        );
        if (!h) throw naoEncontrado('Habilitação');
        const p = conferirFimVinculo(
          {
            leito: 0,
            vigenciaInicio: dataIso(h['vigencia_inicio'])!,
            vigenciaFim: dataIso(h['vigencia_fim']),
          },
          e.vigenciaFim,
        );
        if (p.length) throw recusaRegra('Encerramento recusado', p);
        await tx.alterar('habilitacao_leito_sus', id, e.versao, { vigencia_fim: e.vigenciaFim });
        const abertos = await tx.consultarParaAtualizar<Record<string, unknown>>(
          `SELECT id, vigencia_inicio, versao FROM leito_habilitado_sus
            WHERE habilitacao_leito_sus_id = ? AND excluido_em IS NULL AND (vigencia_fim IS NULL OR vigencia_fim > ?)`,
          [id, e.vigenciaFim],
        );
        for (const v of abertos) {
          const fim =
            dataIso(v['vigencia_inicio'])! > e.vigenciaFim ? dataIso(v['vigencia_inicio'])! : e.vigenciaFim;
          await tx.alterar('leito_habilitado_sus', num(v['id']), num(v['versao']), { vigencia_fim: fim });
        }
        return { tabela: 'habilitacao_leito_sus', id };
      },
    );
  }

  /** Os leitos do programa (vigentes e passados), com o código do leito. */
  leitos(c: ContextoPortaPropria, habilitacao: number): Promise<LeitoNoProgramaLido[]> {
    return this.ler(c, 'leitos', async (l, est) =>
      (
        await l.consultar(
          `SELECT v.id, v.leito_hospitalar_id, lh.codigo, v.vigencia_inicio, v.vigencia_fim, v.versao
             FROM leito_habilitado_sus v
             JOIN habilitacao_leito_sus h ON h.id = v.habilitacao_leito_sus_id
             JOIN leito_hospitalar lh ON lh.id = v.leito_hospitalar_id
            WHERE v.habilitacao_leito_sus_id = ? AND h.estabelecimento_id = ? AND v.excluido_em IS NULL
            ORDER BY v.vigencia_fim IS NULL DESC, v.vigencia_inicio DESC, v.id DESC LIMIT 1000`,
          [habilitacao, est.id],
        )
      ).map((r) => ({
        id: num(r['id']),
        leito: num(r['leito_hospitalar_id']),
        leitoCodigo: String(r['codigo']),
        vigenciaInicio: dataIso(r['vigencia_inicio'])!,
        vigenciaFim: dataIso(r['vigencia_fim']),
        versao: num(r['versao']),
      })),
    );
  }

  async vincularLeito(
    c: ContextoPortaPropria,
    habilitacao: number,
    entrada: unknown,
  ): Promise<{ id: number }> {
    const e = entradaValida(esquemaVinculo, entrada);
    return this.gravar(
      c,
      'internacao.leitossus.leito.vincular',
      ['leito_habilitado_sus'],
      async (tx, est) => {
        const h = await tx.consultarParaAtualizar<Record<string, unknown>>(
          `SELECT vigencia_inicio, vigencia_fim, quantidade_leitos_habilitados, ativo FROM habilitacao_leito_sus
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [habilitacao, est.id],
        );
        const hab = h[0];
        if (!hab) throw naoEncontrado('Habilitação');
        const leito = await tx.uma(
          'SELECT id FROM leito_hospitalar WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [e.leito, est.id],
        );
        if (!leito) throw naoEncontrado('Leito');
        const vinculos: VinculoLeitoPrograma[] = (
          await tx.consultar(
            `SELECT leito_hospitalar_id, vigencia_inicio, vigencia_fim FROM leito_habilitado_sus
            WHERE habilitacao_leito_sus_id = ? AND excluido_em IS NULL`,
            [habilitacao],
          )
        ).map((r) => ({
          leito: num(r['leito_hospitalar_id']),
          vigenciaInicio: dataIso(r['vigencia_inicio'])!,
          vigenciaFim: dataIso(r['vigencia_fim']),
        }));
        const p = conferirVinculoLeitoPrograma({
          habilitacao: {
            vigenciaInicio: dataIso(hab['vigencia_inicio'])!,
            vigenciaFim: dataIso(hab['vigencia_fim']),
            quantidadeLeitosHabilitados: numOuNull(hab['quantidade_leitos_habilitados']),
          },
          habilitacaoAtiva: bool(hab['ativo']),
          vinculos,
          novo: e,
        });
        if (p.length) throw recusaRegra('Leito recusado no programa', p);
        const id = await tx.incluir('leito_habilitado_sus', {
          habilitacao_leito_sus_id: habilitacao,
          leito_hospitalar_id: e.leito,
          vigencia_inicio: e.vigenciaInicio,
          vigencia_fim: e.vigenciaFim,
        });
        return { tabela: 'leito_habilitado_sus', id };
      },
    );
  }

  /** O leito sai do programa: grava o fim do vínculo (o histórico fica). */
  async encerrarVinculo(c: ContextoPortaPropria, id: number, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaFim, entrada);
    return this.gravar(
      c,
      'internacao.leitossus.leito.encerrar',
      ['leito_habilitado_sus'],
      async (tx, est) => {
        const v = await tx.uma(
          `SELECT v.leito_hospitalar_id, v.vigencia_inicio, v.vigencia_fim FROM leito_habilitado_sus v
           JOIN habilitacao_leito_sus h ON h.id = v.habilitacao_leito_sus_id
          WHERE v.id = ? AND h.estabelecimento_id = ? AND v.excluido_em IS NULL`,
          [id, est.id],
        );
        if (!v) throw naoEncontrado('Leito no programa');
        const p = conferirFimVinculo(
          {
            leito: num(v['leito_hospitalar_id']),
            vigenciaInicio: dataIso(v['vigencia_inicio'])!,
            vigenciaFim: dataIso(v['vigencia_fim']),
          },
          e.vigenciaFim,
        );
        if (p.length) throw recusaRegra('Saída do programa recusada', p);
        await tx.alterar('leito_habilitado_sus', id, e.versao, { vigencia_fim: e.vigenciaFim });
        return { tabela: 'leito_habilitado_sus', id };
      },
    );
  }

  /** A capacidade vigente por especialidade na competência, com o teto de diárias e o histórico. */
  capacidade(c: ContextoPortaPropria, competencia: string): Promise<CapacidadeLida[]> {
    return this.ler(c, 'capacidade', async (l, est) => {
      const linhas = await l.consultar(
        `SELECT c.*, e.descricao, e.terapia_intensiva FROM capacidade_leito_sus c
           JOIN especialidade_leito e ON e.id = c.especialidade_leito_id
          WHERE c.estabelecimento_id = ? AND c.competencia = ?
          ORDER BY c.especialidade_leito_id, c.ocorrido_em, c.id`,
        [est.id, competencia],
      );
      const todas = linhas.map(linhaCapacidade);
      const especialidades = [...new Set(todas.map((x) => x.especialidade))];
      const saida: CapacidadeLida[] = [];
      for (const esp of especialidades) {
        const v = capacidadeVigente(todas, esp, competencia);
        const r = linhas.find((x) => num(x['especialidade_leito_id']) === esp)!;
        saida.push({
          especialidade: esp,
          especialidadeDescricao: String(r['descricao']),
          terapiaIntensiva: bool(r['terapia_intensiva']),
          quantidadeLeitos: v?.quantidadeLeitos ?? 0,
          criticaLiberada: v?.criticaLiberada ?? false,
          tetoDiarias: v ? tetoDiariasEspeciais(v.quantidadeLeitos, competencia) : 0,
          historico: linhas
            .filter((x) => num(x['especialidade_leito_id']) === esp)
            .map((x) => ({
              id: num(x['id']),
              operacao: String(x['operacao']),
              quantidadeLeitos: num(x['quantidade_leitos']),
              criticaLiberada: bool(x['critica_liberada']),
              ocorridoEm: instanteIso(x['ocorrido_em']),
              usuario: numOuNull(x['usuario_id']),
            })),
        });
      }
      return saida;
    });
  }

  /** Inclui, altera ou retira a capacidade: sempre uma linha nova (o histórico nunca é alterado). */
  async registrarCapacidade(
    c: ContextoPortaPropria,
    entrada: unknown,
  ): Promise<{ id: number; operacao: string; tetoDiarias: number }> {
    const e = entradaValida(esquemaCapacidade, entrada);
    return this.gravar(
      c,
      'internacao.leitossus.capacidade.registrar',
      ['capacidade_leito_sus'],
      async (tx, est, usuario) => {
        const esp = await tx.uma('SELECT id FROM especialidade_leito WHERE id = ?', [e.especialidade]);
        if (!esp) throw naoEncontrado('Especialidade de leito');
        const linhas = (
          await tx.consultarParaAtualizar<Record<string, unknown>>(
            `SELECT * FROM capacidade_leito_sus
            WHERE estabelecimento_id = ? AND especialidade_leito_id = ? AND competencia = ?`,
            [est.id, e.especialidade, e.competencia],
          )
        ).map(linhaCapacidade);
        const vigente = capacidadeVigente(linhas, e.especialidade, e.competencia);
        const r = conferirCapacidadeSus({ ...e, vigente });
        if (!r.operacao) throw recusaRegra('Capacidade recusada', r.problemas);
        const quantidade = r.operacao === 'exclusao' ? vigente!.quantidadeLeitos : e.quantidadeLeitos;
        const liberada = r.operacao === 'exclusao' ? false : e.criticaLiberada;
        const id = await tx.incluir('capacidade_leito_sus', {
          estabelecimento_id: est.id,
          especialidade_leito_id: e.especialidade,
          competencia: e.competencia,
          quantidade_leitos: quantidade,
          critica_liberada: liberada,
          liberada_por_usuario_id: liberada ? usuario : null,
          operacao: r.operacao,
          dados: JSON.stringify({
            anterior: vigente
              ? { quantidadeLeitos: vigente.quantidadeLeitos, criticaLiberada: vigente.criticaLiberada }
              : null,
            quantidadeLeitos: quantidade,
            criticaLiberada: liberada,
          }),
          ocorrido_em: new Date(),
          usuario_id: usuario,
        });
        return {
          tabela: 'capacidade_leito_sus',
          id,
          operacao: r.operacao,
          tetoDiarias: r.operacao === 'exclusao' ? 0 : tetoDiariasEspeciais(quantidade, e.competencia),
        };
      },
    );
  }
}
