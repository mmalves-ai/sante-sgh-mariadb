// Reuso do dialisador na hemodiálise (03-PEP linha 146), no banco do cliente. As regras são as puras de
// @sgh/dominio-pep (hemodialise/reuso-dialisador.ts); aqui ficam a leitura e a gravação. Contrato de efeito:
//   - abrir: `dialisador` em uso do paciente (etiqueta única no estabelecimento, método, limite de reusos pelo teto do
//     método, volume interno inicial, quem abriu); recusa o segundo em uso do mesmo paciente;
//   - reprocessar: `reuso_dialisador` com a sequência seguinte, os volumes (inicial e atual), os dois testes do
//     desinfetante, o método, o agente, as linhas, o profissional responsável (o vínculo do usuário) e o resultado do
//     domínio (`aprovado`); aprovado soma o reuso no dialisador (`reusos_realizados`); volume abaixo de 80% grava o
//     reprocessamento reprovado E descarta o dialisador na mesma transação, com o motivo;
//   - descartar / desativar: situação com data, usuário e motivo (nada apagado);
//   - cancelar reprocessamento: situação 'cancelado' com o motivo; o aprovado devolve o reuso ao dialisador.
// A sessão de hemodiálise (`sessao_hemodialise_id`) fica nula: a sessão ainda não tem tela.
import {
  avaliarReprocessamento,
  type AvaliacaoReprocessamento,
  conferirAberturaDialisador,
  conferirCancelamentoReuso,
  conferirDesativacaoDialisador,
  conferirDescarteDialisador,
  type ErroCampoDialisador,
  limitePadraoReusos,
  METODOS_LIMPEZA_DIALISADOR,
  METODOS_REPROCESSAMENTO,
  type MetodoLimpezaDialisador,
  RESULTADOS_TESTE_DESINFETANTE,
  type ResultadoTesteDesinfetante,
  type SituacaoDialisador,
  type SituacaoReusoDialisador,
} from '@sgh/dominio-pep';
import { ErroOperacao, type Leitor, type TxOperacao } from '@sgh/nucleo';
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

export const PORTA_DIALISADOR = Symbol('PORTA_DIALISADOR');
export const OPERACOES_DIALISADOR = {
  abrir: 'pep.dialisador.abrir',
  reprocessar: 'pep.dialisador.reprocessar',
  descartar: 'pep.dialisador.descartar',
  desativar: 'pep.dialisador.desativar',
  cancelarReprocessamento: 'pep.dialisador.cancelar-reprocessamento',
} as const;
const TABELAS = ['dialisador', 'reuso_dialisador'];

export interface ReprocessamentoLido {
  readonly id: number;
  readonly sequencia: number;
  readonly reprocessadoEm: string;
  readonly volumeInicialMl: number | null;
  readonly volumeAtualMl: number | null;
  readonly testePreEnxague: string | null;
  readonly testePosEnxague: string | null;
  readonly metodo: string;
  readonly agente: string | null;
  readonly linhasDescartadas: boolean;
  readonly aprovado: boolean;
  readonly responsavel: string;
  readonly observacao: string | null;
  readonly situacao: SituacaoReusoDialisador;
  readonly motivoCancelamento: string | null;
  readonly versao: number;
}

export interface DialisadorLido {
  readonly id: number;
  readonly paciente: number;
  readonly pacienteNome: string;
  readonly prontuario: number | null;
  readonly identificacao: string;
  readonly insumo: number | null;
  readonly modelo: string | null;
  readonly metodo: MetodoLimpezaDialisador;
  readonly volumeInicialMl: number | null;
  readonly limiteReusos: number;
  readonly reusosRealizados: number;
  readonly abertoEm: string;
  readonly fechadoEm: string | null;
  readonly situacao: SituacaoDialisador;
  readonly motivo: string | null;
  readonly versao: number;
  readonly reprocessamentos: ReprocessamentoLido[];
}

export interface ResultadoReprocessamento {
  readonly id: number;
  readonly sequencia: number;
  readonly aprovado: boolean;
  readonly descartado: boolean;
  readonly ultimoReuso: boolean;
  readonly reusosRealizados: number;
  readonly reprovacoes: string[];
}

const FMT = "'%Y-%m-%dT%H:%i'";
const NOME_PACIENTE = `CASE WHEN pa.usa_nome_social AND pa.nome_social IS NOT NULL THEN pa.nome_social
                   WHEN pf.usa_nome_social AND pf.nome_social IS NOT NULL THEN pf.nome_social
                   ELSE pf.nome END`;
const SQL_DIALISADOR = `SELECT d.id, d.paciente_id, ${NOME_PACIENTE} AS paciente_nome, pa.numero_prontuario,
    d.identificacao, d.insumo_id, i.nome AS modelo, d.metodo_limpeza, d.volume_inicial_ml, d.limite_reusos,
    d.reusos_realizados, DATE_FORMAT(d.aberto_em, ${FMT}) AS aberto_em, DATE_FORMAT(d.fechado_em, ${FMT}) AS fechado_em,
    DATE_FORMAT(d.desativado_em, ${FMT}) AS desativado_em, d.situacao, d.motivo_descarte, d.motivo_desativacao, d.versao
  FROM dialisador d
  JOIN paciente pa ON pa.id = d.paciente_id
  JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
  LEFT JOIN insumo i ON i.id = d.insumo_id
 WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL`;
const SQL_REUSOS = `SELECT r.id, r.dialisador_id, r.sequencia, DATE_FORMAT(r.reprocessado_em, ${FMT}) AS reprocessado_em,
    r.volume_priming_inicial_ml, r.volume_priming_atual_ml, r.teste_peroxido_pre_lavagem, r.teste_peroxido_pos_lavagem,
    r.metodo_reprocessamento, r.agente_desinfetante, r.linhas_descartadas, r.aprovado, r.observacao, r.situacao,
    r.motivo_cancelamento, r.versao, COALESCE(pr.nome_exibicao, pf.nome) AS responsavel
  FROM reuso_dialisador r
  JOIN profissional pr ON pr.id = r.responsavel_profissional_id
  JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
 WHERE r.excluido_em IS NULL`;

function reusoLido(r: Record<string, unknown>): ReprocessamentoLido {
  return {
    id: num(r['id']),
    sequencia: num(r['sequencia']),
    reprocessadoEm: String(r['reprocessado_em']),
    volumeInicialMl: numOuNull(r['volume_priming_inicial_ml']),
    volumeAtualMl: numOuNull(r['volume_priming_atual_ml']),
    testePreEnxague: txtOuNull(r['teste_peroxido_pre_lavagem']),
    testePosEnxague: txtOuNull(r['teste_peroxido_pos_lavagem']),
    metodo: String(r['metodo_reprocessamento']),
    agente: txtOuNull(r['agente_desinfetante']),
    linhasDescartadas: bool(r['linhas_descartadas']),
    aprovado: bool(r['aprovado']),
    responsavel: String(r['responsavel']),
    observacao: txtOuNull(r['observacao']),
    situacao: String(r['situacao']) as SituacaoReusoDialisador,
    motivoCancelamento: txtOuNull(r['motivo_cancelamento']),
    versao: num(r['versao']),
  };
}

function dialisadorLido(r: Record<string, unknown>, reusos: ReprocessamentoLido[]): DialisadorLido {
  const situacao = String(r['situacao']) as SituacaoDialisador;
  return {
    id: num(r['id']),
    paciente: num(r['paciente_id']),
    pacienteNome: String(r['paciente_nome'] ?? ''),
    prontuario: numOuNull(r['numero_prontuario']),
    identificacao: String(r['identificacao']),
    insumo: numOuNull(r['insumo_id']),
    modelo: txtOuNull(r['modelo']),
    metodo: String(r['metodo_limpeza']) as MetodoLimpezaDialisador,
    volumeInicialMl: numOuNull(r['volume_inicial_ml']),
    limiteReusos: num(r['limite_reusos']),
    reusosRealizados: num(r['reusos_realizados']),
    abertoEm: String(r['aberto_em']),
    fechadoEm: txtOuNull(situacao === 'desativado' ? r['desativado_em'] : r['fechado_em']),
    situacao,
    motivo: txtOuNull(situacao === 'desativado' ? r['motivo_desativacao'] : r['motivo_descarte']),
    versao: num(r['versao']),
    reprocessamentos: reusos,
  };
}

function recusarErros(titulo: string, erros: readonly ErroCampoDialisador[]): void {
  if (erros.length) throw recusaRegra(titulo, erros);
}

// ── Entrada da API (a forma; as regras clínicas ficam no domínio) ──
const motivo = z.string().trim().min(5).max(500);
const versao = z.number().int().positive();
const volume = z.number().int().positive().max(1000).nullable().default(null);
export const esquemaAbrirDialisador = z
  .object({
    paciente: z.number().int().positive(),
    identificacao: z.string().trim().min(1).max(30),
    insumo: z.number().int().positive().nullable().default(null),
    metodo: z.enum(METODOS_LIMPEZA_DIALISADOR),
    limiteReusos: z.number().int().min(0).max(100).nullable().default(null),
    volumeInicialMl: volume,
  })
  .strict();
const teste = z.enum(RESULTADOS_TESTE_DESINFETANTE).nullable().default(null);
export const esquemaReprocessar = z
  .object({
    metodo: z.enum(METODOS_REPROCESSAMENTO),
    volumeAtualMl: volume,
    testePreEnxague: teste,
    testePosEnxague: teste,
    agente: z.string().trim().max(60).nullable().default(null),
    linhasDescartadas: z.boolean().default(true),
    observacao: z.string().trim().max(2000).nullable().default(null),
    versao,
  })
  .strict();
const esquemaMotivoVersao = z.object({ motivo, versao }).strict();

export class PortaDialisadorPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'pep.dialisador');
  }

  private async comReusos(l: Leitor, linhas: Record<string, unknown>[]): Promise<DialisadorLido[]> {
    if (!linhas.length) return [];
    const ids = linhas.map((r) => num(r['id']));
    const reusos = await l.consultar(
      `${SQL_REUSOS} AND r.dialisador_id IN (${ids.map(() => '?').join(', ')}) ORDER BY r.sequencia DESC`,
      ids,
    );
    return linhas.map((d) =>
      dialisadorLido(d, reusos.filter((r) => num(r['dialisador_id']) === num(d['id'])).map(reusoLido)),
    );
  }

  /** Visão por paciente: todos os dialisadores dele no estabelecimento (o em uso primeiro), com os reprocessamentos. */
  doPaciente(c: ContextoPortaPropria, paciente: number): Promise<DialisadorLido[]> {
    return this.ler(c, 'doPaciente', async (l, est) => {
      const p = await l.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [paciente]);
      if (!p) throw naoEncontrado('Paciente');
      const rs = await l.consultar(
        `${SQL_DIALISADOR} AND d.paciente_id = ? ORDER BY d.situacao = 'em_uso' DESC, d.aberto_em DESC, d.id DESC LIMIT 200`,
        [est.id, paciente],
      );
      return this.comReusos(l, rs);
    });
  }

  /** A sala de reprocessamento: os dialisadores em uso do estabelecimento, pela etiqueta. */
  emUso(c: ContextoPortaPropria): Promise<DialisadorLido[]> {
    return this.ler(c, 'emUso', async (l, est) => {
      const rs = await l.consultar(
        `${SQL_DIALISADOR} AND d.situacao = 'em_uso' ORDER BY d.identificacao LIMIT 500`,
        [est.id],
      );
      return this.comReusos(l, rs);
    });
  }

  async abrir(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number; limiteReusos: number }> {
    const e = entradaValida(esquemaAbrirDialisador, entrada);
    return this.gravar(c, OPERACOES_DIALISADOR.abrir, ['dialisador'], async (tx, est, usuario) => {
      const [p] = await tx.consultarParaAtualizar(
        'SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL',
        [e.paciente],
      );
      if (!p) throw naoEncontrado('Paciente');
      if (e.insumo !== null) {
        const i = await tx.uma('SELECT id FROM insumo WHERE id = ? AND excluido_em IS NULL', [e.insumo]);
        if (!i) throw naoEncontrado('Modelo do dialisador');
      }
      const [emUso] = await tx.consultar(
        `SELECT COUNT(*) AS n FROM dialisador
          WHERE estabelecimento_id = ? AND paciente_id = ? AND situacao = 'em_uso' AND excluido_em IS NULL`,
        [est.id, e.paciente],
      );
      recusarErros(
        'Abertura recusada',
        conferirAberturaDialisador(
          {
            identificacao: e.identificacao,
            metodo: e.metodo,
            limiteReusos: e.limiteReusos,
            volumeInicialMl: e.volumeInicialMl,
          },
          num(emUso?.['n']),
        ),
      );
      const repetida = await tx.uma(
        'SELECT id FROM dialisador WHERE estabelecimento_id = ? AND identificacao = ?',
        [est.id, e.identificacao],
      );
      if (repetida)
        throw recusaRegra('Abertura recusada', [
          {
            campo: 'identificacao',
            mensagem: 'Esta etiqueta já foi usada em outro dialisador do estabelecimento.',
          },
        ]);
      const limiteReusos = e.limiteReusos ?? limitePadraoReusos(e.metodo);
      const id = await tx.incluir('dialisador', {
        estabelecimento_id: est.id,
        paciente_id: e.paciente,
        insumo_id: e.insumo,
        identificacao: e.identificacao,
        volume_inicial_ml: e.volumeInicialMl,
        limite_reusos: limiteReusos,
        reusos_realizados: 0,
        metodo_limpeza: e.metodo,
        aberto_em: new Date(),
        aberto_por_usuario_id: usuario,
        situacao: 'em_uso',
      });
      return { tabela: 'dialisador', id, limiteReusos };
    });
  }

  private async travarDialisador(tx: TxOperacao, est: number, id: number) {
    const [d] = await tx.consultarParaAtualizar<Record<string, unknown>>(
      `SELECT id, situacao, metodo_limpeza, limite_reusos, reusos_realizados, volume_inicial_ml, versao
         FROM dialisador WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [id, est],
    );
    if (!d) throw naoEncontrado('Dialisador');
    return d;
  }

  async reprocessar(
    c: ContextoPortaPropria,
    dialisador: number,
    entrada: unknown,
  ): Promise<ResultadoReprocessamento> {
    const e = entradaValida(esquemaReprocessar, entrada);
    return this.gravar(
      c,
      OPERACOES_DIALISADOR.reprocessar,
      ['dialisador', 'reuso_dialisador'],
      async (tx, est, usuario) => {
        const d = await this.travarDialisador(tx, est.id, dialisador);
        if (num(d['versao']) !== e.versao)
          throw new ErroOperacao(
            409,
            'conflito-versao',
            'Registro alterado por outra pessoa',
            'Releia o dialisador.',
          );
        const prof = await tx.uma(
          'SELECT profissional_id FROM usuario_profissional WHERE usuario_vigente_id = ?',
          [usuario],
        );
        if (!prof?.['profissional_id'])
          throw recusaRegra('Reprocessamento recusado', [
            {
              campo: 'responsavel',
              mensagem: 'O usuário não tem vínculo profissional: o reprocessamento pede um responsável.',
            },
          ]);
        const avaliado: AvaliacaoReprocessamento = avaliarReprocessamento(
          {
            situacao: String(d['situacao']) as SituacaoDialisador,
            metodo: String(d['metodo_limpeza']) as MetodoLimpezaDialisador,
            limiteReusos: num(d['limite_reusos']),
            reusosRealizados: num(d['reusos_realizados']),
            volumeInicialMl: numOuNull(d['volume_inicial_ml']),
          },
          {
            metodo: e.metodo,
            volumeAtualMl: e.volumeAtualMl,
            testePreEnxague: e.testePreEnxague,
            testePosEnxague: e.testePosEnxague,
          },
        );
        recusarErros('Reprocessamento recusado', avaliado.erros);
        const ult = await tx.uma(
          'SELECT COALESCE(MAX(sequencia), 0) AS n FROM reuso_dialisador WHERE dialisador_id = ?',
          [dialisador],
        );
        const sequencia = num(ult?.['n']) + 1;
        const agora = new Date();
        const id = await tx.incluir('reuso_dialisador', {
          dialisador_id: dialisador,
          sequencia,
          sessao_hemodialise_id: null,
          reprocessado_em: agora,
          volume_priming_inicial_ml: Math.round(num(d['volume_inicial_ml'])),
          volume_priming_atual_ml: e.volumeAtualMl,
          teste_peroxido_pre_lavagem: e.testePreEnxague as ResultadoTesteDesinfetante,
          teste_peroxido_pos_lavagem: e.testePosEnxague as ResultadoTesteDesinfetante,
          metodo_reprocessamento: e.metodo,
          agente_desinfetante: e.agente || null,
          linhas_descartadas: e.linhasDescartadas,
          aprovado: avaliado.aprovado,
          responsavel_profissional_id: num(prof['profissional_id']),
          observacao: e.observacao || null,
          situacao: 'valido',
        });
        if (avaliado.aprovado || avaliado.descartar)
          await tx.alterar('dialisador', dialisador, e.versao, {
            reusos_realizados: avaliado.reusosDepois,
            ...(avaliado.descartar
              ? {
                  situacao: 'descartado',
                  fechado_em: agora,
                  fechado_por_usuario_id: usuario,
                  motivo_descarte: avaliado.motivoDescarte,
                }
              : {}),
          });
        return {
          tabela: 'reuso_dialisador',
          id,
          sequencia,
          aprovado: avaliado.aprovado,
          descartado: avaliado.descartar,
          ultimoReuso: avaliado.ultimoReuso,
          reusosRealizados: avaliado.reusosDepois,
          reprovacoes: avaliado.reprovacoes,
        };
      },
    );
  }

  async descartar(c: ContextoPortaPropria, dialisador: number, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(esquemaMotivoVersao, entrada);
    return this.gravar(c, OPERACOES_DIALISADOR.descartar, ['dialisador'], async (tx, est, usuario) => {
      const d = await this.travarDialisador(tx, est.id, dialisador);
      recusarErros(
        'Descarte recusado',
        conferirDescarteDialisador(String(d['situacao']) as SituacaoDialisador, x.motivo),
      );
      await tx.alterar('dialisador', dialisador, x.versao, {
        situacao: 'descartado',
        fechado_em: new Date(),
        fechado_por_usuario_id: usuario,
        motivo_descarte: x.motivo,
      });
      return { tabela: 'dialisador', id: dialisador };
    });
  }

  async desativar(c: ContextoPortaPropria, dialisador: number, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(esquemaMotivoVersao, entrada);
    return this.gravar(c, OPERACOES_DIALISADOR.desativar, ['dialisador'], async (tx, est, usuario) => {
      const d = await this.travarDialisador(tx, est.id, dialisador);
      const v = await tx.uma(
        "SELECT COUNT(*) AS n FROM reuso_dialisador WHERE dialisador_id = ? AND situacao = 'valido' AND excluido_em IS NULL",
        [dialisador],
      );
      recusarErros(
        'Desativação recusada',
        conferirDesativacaoDialisador(String(d['situacao']) as SituacaoDialisador, num(v?.['n']), x.motivo),
      );
      await tx.alterar('dialisador', dialisador, x.versao, {
        situacao: 'desativado',
        desativado_em: new Date(),
        desativado_por_usuario_id: usuario,
        motivo_desativacao: x.motivo,
      });
      return { tabela: 'dialisador', id: dialisador };
    });
  }

  async cancelarReprocessamento(
    c: ContextoPortaPropria,
    reuso: number,
    entrada: unknown,
  ): Promise<{ id: number }> {
    const x = entradaValida(esquemaMotivoVersao, entrada);
    return this.gravar(
      c,
      OPERACOES_DIALISADOR.cancelarReprocessamento,
      ['dialisador', 'reuso_dialisador'],
      async (tx, est) => {
        const r = await tx.uma(
          `SELECT r.id, r.dialisador_id FROM reuso_dialisador r JOIN dialisador d ON d.id = r.dialisador_id
            WHERE r.id = ? AND d.estabelecimento_id = ? AND r.excluido_em IS NULL`,
          [reuso, est.id],
        );
        if (!r) throw naoEncontrado('Reprocessamento');
        const dialisador = num(r['dialisador_id']);
        const d = await this.travarDialisador(tx, est.id, dialisador);
        const [atual] = await tx.consultarParaAtualizar<Record<string, unknown>>(
          'SELECT id, situacao, aprovado FROM reuso_dialisador WHERE id = ?',
          [reuso],
        );
        const ultimoId = await tx.uma(
          `SELECT id FROM reuso_dialisador WHERE dialisador_id = ? AND situacao = 'valido' AND excluido_em IS NULL
            ORDER BY sequencia DESC LIMIT 1`,
          [dialisador],
        );
        recusarErros(
          'Cancelamento recusado',
          conferirCancelamentoReuso({
            situacao: String(atual?.['situacao']) as SituacaoReusoDialisador,
            ehUltimoValido: num(ultimoId?.['id']) === reuso,
            situacaoDialisador: String(d['situacao']) as SituacaoDialisador,
            motivo: x.motivo,
          }),
        );
        await tx.alterar('reuso_dialisador', reuso, x.versao, {
          situacao: 'cancelado',
          motivo_cancelamento: x.motivo,
        });
        if (bool(atual?.['aprovado']))
          await tx.alterar('dialisador', dialisador, num(d['versao']), {
            reusos_realizados: Math.max(0, num(d['reusos_realizados']) - 1),
          });
        return { tabela: 'reuso_dialisador', id: reuso };
      },
    );
  }
}
