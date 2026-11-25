// Escala de execução do diagnóstico no banco do cliente (F3.5, 05-SADT linha 19): os plantões de quem executa ou lauda
// por setor, os dias e horários, e os exames atendidos com o limite por turno e as vagas reservadas a grupo prioritário.
// A regra mora em @sgh/dominio-sadt (escala/execucao.ts): a conferência da escala com todos os problemas por campo e o
// choque de horário do mesmo profissional (ou sala) em qualquer setor; aqui fica a leitura e a gravação do que a regra
// decide. Nada se apaga: a escala que sai de uso tem a vigência encerrada (fica no histórico).
import {
  conferirEscala,
  conflitosDoExecutante,
  DIAS_DE_ESPERA_NA_FILA,
  type EscalaExecucao,
  esperaNoDia,
  type ExameDaEscala,
  executantesDoExame,
  type GrupoPrioridade,
  idadeEm,
  type NaFila,
  ordenarFilaDoSetor,
  type PlantaoEscala,
  prioridadeDoPaciente,
  somarDias,
} from '@sgh/dominio-sadt';
import {
  type ContextoNucleo,
  definirOperacao,
  type Executor,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { civil, FUSO_PADRAO, instanteCivil, relogioNoFuso } from '../../exames/relogio.js';
import type { NucleoSadt } from '../porta-propria.js';
import type { ContextoSadt } from '../porta.js';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const dataIso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const hora = (v: unknown) => texto(v).slice(0, 5);
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');

/** Os limites de uma escala: a leitura dimensiona o teto de linhas por eles (passar do teto é erro no núcleo). */
export const MAX_PLANTOES_DA_ESCALA = 60;
export const MAX_EXAMES_DA_ESCALA = 1000;
/** Quantas escalas uma leitura traz (as vigentes primeiro). */
const MAX_ESCALAS_NA_LEITURA = 2000;
/** Quantos exames a fila do setor devolve por leitura (os primeiros da ordem de chamada). */
export const LIMITE_DA_FILA = 200;
/** Quantos nomes a busca dos combos devolve por digitação. */
const LIMITE_DA_BUSCA = 30;

const id = z.number().int().positive();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const esquemaEscalaExecucao = z.object({
  setor: id,
  profissional: id.nullable().default(null),
  recurso: id.nullable().default(null),
  papel: z.enum(['executa', 'lauda']).default('executa'),
  descricao: z.string().trim().max(150),
  vigenciaInicio: data,
  vigenciaFim: data.nullable().default(null),
  atendeFeriado: z.boolean().default(false),
  plantoes: z
    .array(
      z.object({
        diaSemana: z.number().int().nullable().default(null),
        data: data.nullable().default(null),
        inicio: z.string(),
        fim: z.string(),
        capacidade: z.number().int(),
      }),
    )
    .max(MAX_PLANTOES_DA_ESCALA),
  exames: z
    .array(
      z.object({
        exame: id,
        limitePorTurno: z.number().int().nullable().default(null),
        grupoPrioridade: id.nullable().default(null),
        vagasReservadas: z.number().int().default(0),
      }),
    )
    .max(MAX_EXAMES_DA_ESCALA),
});
export type EntradaEscalaExecucao = z.infer<typeof esquemaEscalaExecucao>;

export const esquemaEncerrarEscala = z.object({ vigenciaFim: data, versao: z.number().int().min(1) });

export const TABELAS_ESCALA_EXECUCAO = [
  'escala_execucao',
  'escala_execucao_dia',
  'escala_execucao_exame',
] as const;

export interface EscalaExecucaoGravada extends EscalaExecucao {
  readonly id: number;
  /** Os nomes de quem executa (a tela não carrega o cadastro inteiro de profissionais para mostrar a grade). */
  readonly profissionalNome: string | null;
  readonly recursoNome: string | null;
  readonly papel: 'executa' | 'lauda';
  readonly atendeFeriado: boolean;
  readonly versao: number;
}

/** Um nome do cadastro para os combos da tela da escala. */
export interface OpcaoDaEscala {
  readonly id: number;
  readonly nome: string;
}

/**
 * O que a tela da escala precisa para montar os combos pequenos, numa leitura só. O profissional e o exame não vêm
 * aqui: são cadastros de milhares de linhas e a tela os busca por digitação (`buscar`).
 */
export interface OpcoesDaEscala {
  readonly setores: OpcaoDaEscala[];
  readonly recursos: OpcaoDaEscala[];
  readonly gruposPrioridade: OpcaoDaEscala[];
  /** O dia civil do estabelecimento (a grade abre na semana dele). */
  readonly hoje: string;
}

/** O recorte da leitura das escalas. */
export interface RecorteDasEscalas {
  /** Com o setor: traz também as escalas dos outros setores, sem a lista de exames (só para o choque de horário). */
  readonly outros?: boolean;
  /** Só as escalas que ainda valem nesta data ou depois (padrão: sete dias antes de hoje). */
  readonly desde?: string | null;
}

/** Quem está de plantão para o exame agora (a escala e o executante dela). */
export interface ExecutanteAgora {
  readonly escala: number;
  readonly descricao: string;
  readonly profissional: number | null;
  readonly recurso: number | null;
  readonly profissionalNome: string | null;
  readonly recursoNome: string | null;
}

/** O exame pedido que espera a execução no setor, já na posição em que deve ser chamado. */
export interface ItemDaFilaDoSetor extends NaFila {
  readonly posicao: number;
  readonly requisicao: string;
  readonly paciente: string;
  readonly exame: number;
  readonly exameNome: string;
  readonly situacao: string;
  /** O grupo de prioridade legal que valeu na ordem (nulo: sem prioridade). */
  readonly grupoPrioridade: number | null;
  readonly grupoPrioridadeNome: string | null;
  /** Quem executa este exame agora pela escala (vazio: ninguém escalado para ele nesta hora). */
  readonly executantes: ExecutanteAgora[];
}

export interface FilaDoSetor {
  readonly setor: number;
  /** O dia e a hora civis do estabelecimento usados na conta. */
  readonly data: string;
  readonly hora: string;
  readonly itens: ItemDaFilaDoSetor[];
  /** Quantos exames esperam hoje no setor (os `itens` são os primeiros da ordem, até o limite da leitura). */
  readonly total: number;
  /** Quantos exames pedidos ficaram para trás sem execução (fora da fila de hoje; pendência a resolver). */
  readonly antigos: number;
  /** Quantos exames mostrados não têm ninguém escalado agora. */
  readonly semExecutante: number;
}

/**
 * O exame que espera a execução: pedido, autorizado ou agendado (o colhido ou em análise já saiu da fila). A fila é
 * a do DIA (regra esperaNoDia do domínio): o exame com horário marcado espera no dia do horário, e a chegada dele é
 * a chegada registrada na recepção (sem ela, a hora marcada); o pedido sem horário espera no dia previsto para a
 * coleta (ou no do pedido) e no seguinte, e a chegada dele é a hora do pedido.
 */
const SITUACOES_NA_FILA = ['solicitado', 'autorizado', 'agendado'] as const;

/** A recusa da regra: todos os problemas de uma vez, cada um no seu campo (a tela marca na hora). */
const recusaDaRegra = (codigo: string, mensagem: string, campos: readonly string[]) =>
  recusa(codigo, mensagem, { campos: [...new Set(campos)] });

export class ServicoEscalaExecucao {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoSadt,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ctxNucleo(c: ContextoSadt): ContextoNucleo {
    return {
      cliente: c.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: (c.correlacao || 'sadt').slice(0, 64),
    };
  }

  private est(c: ContextoSadt): number {
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    return c.estabelecimento;
  }

  private async gravar(
    c: ContextoSadt,
    nome: string,
    fn: (tx: TxOperacao, est: number) => Promise<number>,
  ): Promise<{ id: number }> {
    const est = this.est(c);
    let gravado: number | null = null;
    const op = definirOperacao({
      nome,
      tabelas: TABELAS_ESCALA_EXECUCAO,
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        gravado = await fn(tx, est);
        return { id: gravado };
      },
      alvo: () => ({ tabela: 'escala_execucao', id: gravado }),
      trilha: () => ({ dados: { evento: nome }, motivo: null }),
    });
    const chave = `sadt-escala:${c.chaveIdempotencia ?? randomUUID()}`;
    const r = await this.executor.executar(
      op,
      c.cliente,
      { chave },
      { ...this.ctxNucleo(c), chaveIdempotencia: chave },
    );
    return { id: gravado ?? n(r.resultado['id']) };
  }

  private async hojeDe(l: Leitor, est: number): Promise<string> {
    const fuso = await l.uma('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
    return relogioNoFuso(String(fuso?.['fuso_horario'] || FUSO_PADRAO)).hoje;
  }

  /**
   * As escalas do estabelecimento (de um setor, se pedido), as vigentes primeiro, com os plantões e os exames. Só as
   * que ainda valem a partir de `desde`: a encerrada há mais tempo fica no cadastro e não pesa na leitura.
   */
  listar(
    c: ContextoSadt,
    setor: number | null = null,
    recorte: RecorteDasEscalas = {},
  ): Promise<EscalaExecucaoGravada[]> {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.ctxNucleo(c), async (l) => {
      const desde = recorte.desde ?? somarDias(await this.hojeDe(l, est), -7);
      return recorte.outros && setor !== null
        ? escalasDe(l, est, { desde, examesSoDoSetor: setor })
        : escalasDe(l, est, { setor, desde });
    });
  }

  /** Os nomes para os combos pequenos da tela (setores, salas e grupos prioritários) e o dia de hoje. */
  opcoes(c: ContextoSadt): Promise<OpcoesDaEscala> {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.ctxNucleo(c), async (l) => {
      const nomes = async (sql: string, p: unknown[], teto: number): Promise<OpcaoDaEscala[]> =>
        (await l.consultar(`${sql} LIMIT ${teto}`, p, { teto })).map((r: Linha) => ({
          id: n(r['id']),
          nome: texto(r['nome']),
        }));
      return {
        setores: await nomes(
          `SELECT id, nome FROM setor_diagnostico
            WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL ORDER BY nome, id`,
          [est],
          500,
        ),
        recursos: await nomes(
          `SELECT id, descricao AS nome FROM recurso_agendavel
            WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL ORDER BY descricao, id`,
          [est],
          1000,
        ),
        gruposPrioridade: await nomes(
          'SELECT id, descricao AS nome FROM grupo_prioridade_legal WHERE ativo = TRUE ORDER BY peso, id',
          [],
          100,
        ),
        hoje: await this.hojeDe(l, est),
      };
    });
  }

  /**
   * A busca por digitação dos combos grandes (o exame e o profissional): os primeiros nomes que têm todas as palavras
   * digitadas, em ordem alfabética. Sem termo, os primeiros do cadastro. Nunca traz o cadastro inteiro.
   */
  buscar(c: ContextoSadt, tipo: 'exame' | 'profissional', termo: string): Promise<OpcaoDaEscala[]> {
    this.est(c);
    const palavras = termo
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 6)
      .map((p) => `%${p.replace(/[\\%_]/g, (x) => `\\${x}`)}%`);
    const nome = tipo === 'exame' ? 'ex.nome' : "COALESCE(NULLIF(pr.nome_exibicao, ''), pf.nome)";
    const de =
      tipo === 'exame'
        ? 'FROM exame ex WHERE ex.ativo = TRUE AND ex.excluido_em IS NULL'
        : `FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
          WHERE pr.situacao = 'ativo' AND pr.excluido_em IS NULL`;
    const chave = tipo === 'exame' ? 'ex.id' : 'pr.id';
    return this.nucleo.lerSomente(this.ctxNucleo(c), async (l) =>
      (
        await l.consultar(
          `SELECT ${chave} AS id, ${nome} AS nome ${de} ${palavras.map(() => `AND ${nome} LIKE ?`).join(' ')}
            ORDER BY nome, id LIMIT ${LIMITE_DA_BUSCA}`,
          palavras,
          { teto: LIMITE_DA_BUSCA },
        )
      ).map((r: Linha) => ({ id: n(r['id']), nome: texto(r['nome']) })),
    );
  }

  /**
   * A fila do setor na ordem de chamada: os exames que esperam a execução HOJE (regra esperaNoDia), com a urgência do
   * pedido, a prioridade legal do paciente (a de idade pela data de nascimento, as demais pela condição registrada e
   * vigente) e a chegada. O servidor corta a leitura nos primeiros `limite` pela mesma chave da regra (urgência,
   * peso da prioridade, chegada), conta o total do dia e os pedidos antigos que ficaram sem execução; a ordem final
   * é a do domínio (ordenarFilaDoSetor). Cada exame traz quem está escalado para ele agora. `agora` e `limite` só
   * são passados em teste.
   */
  fila(
    c: ContextoSadt,
    setor: number,
    agora: Date = new Date(),
    limite: number = LIMITE_DA_FILA,
  ): Promise<FilaDoSetor> {
    const est = this.est(c);
    const corte = Math.max(1, Math.min(LIMITE_DA_FILA, Math.trunc(limite)));
    return this.nucleo.lerSomente(this.ctxNucleo(c), async (l) => {
      const s = await l.uma(
        `SELECT sd.id, e.fuso_horario FROM setor_diagnostico sd JOIN estabelecimento e ON e.id = sd.estabelecimento_id
          WHERE sd.id = ? AND sd.estabelecimento_id = ? AND sd.excluido_em IS NULL`,
        [setor, est],
      );
      if (!s) throw recusa('setor-inexistente', 'O setor do diagnóstico não existe neste estabelecimento.');
      const fuso = String(s['fuso_horario'] || FUSO_PADRAO);
      const { hoje, hora: horaAgora } = relogioNoFuso(fuso, agora);
      // O dia civil do estabelecimento em instantes: do começo do primeiro dia da espera ao fim de hoje.
      const inicio = instanteCivil(somarDias(hoje, -DIAS_DE_ESPERA_NA_FILA), '00:00', fuso);
      const fim = instanteCivil(somarDias(hoje, 1), '00:00', fuso);
      const de = `FROM exame_item ei
           JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id AND r.excluido_em IS NULL
                                  AND r.situacao <> 'cancelada'
           LEFT JOIN marcacao_horario mh ON mh.id = r.marcacao_horario_id
           LEFT JOIN horario_agenda ha ON ha.id = mh.horario_agenda_id`;
      const onde = `WHERE r.estabelecimento_id = ? AND COALESCE(ei.setor_diagnostico_id, r.setor_diagnostico_id) = ?
            AND ei.excluido_em IS NULL AND ei.situacao IN (${lista(SITUACOES_NA_FILA.length)})`;
      const pOnde = [est, setor, ...SITUACOES_NA_FILA];
      const referencia = 'COALESCE(r.coleta_prevista_em, r.solicitado_em)';
      const deHoje = `((ha.id IS NOT NULL AND ha.data_referencia = ?)
                    OR (ha.id IS NULL AND ${referencia} >= ? AND ${referencia} < ?))`;
      const pHoje = [hoje, inicio, fim];
      const antigo = `((ha.id IS NOT NULL AND ha.data_referencia < ?) OR (ha.id IS NULL AND ${referencia} < ?))`;
      const conta = await l.uma(
        `SELECT COALESCE(SUM(${deHoje}), 0) AS total, COALESCE(SUM(${antigo}), 0) AS antigos ${de} ${onde}`,
        [...pHoje, hoje, inicio, ...pOnde],
      );
      const total = n(conta?.['total']);
      const antigos = n(conta?.['antigos']);
      const vazia = { setor, data: hoje, hora: horaAgora, itens: [], total, antigos, semExecutante: 0 };
      if (!total) return vazia;
      // O peso da prioridade só serve ao corte da leitura; quem decide o grupo e a ordem é a regra do domínio.
      const linhas = await l.consultar(
        `SELECT ei.id, ei.exame_id, ex.nome AS exame_nome, ei.situacao, r.numero, r.paciente_id, r.solicitado_em,
                r.coleta_prevista_em, DATE_FORMAT(ha.data_referencia, '%Y-%m-%d') AS agendado_para,
                CASE WHEN ha.id IS NOT NULL THEN COALESCE(mh.chegada_em, ha.inicio_em) ELSE r.solicitado_em END
                  AS chegada,
                (ei.urgente = TRUE OR r.prioridade <> 'rotina') AS urgente,
                CASE WHEN pf.usa_nome_social = TRUE AND COALESCE(pf.nome_social, '') <> '' THEN pf.nome_social
                     ELSE pf.nome END AS paciente,
                DATE_FORMAT(pf.data_nascimento, '%Y-%m-%d') AS nascimento,
                (SELECT MIN(g.peso) FROM grupo_prioridade_legal g
                  WHERE g.ativo = TRUE
                    AND ((g.idade_minima IS NOT NULL AND pf.data_nascimento IS NOT NULL AND pf.data_nascimento <= ?
                          AND TIMESTAMPDIFF(YEAR, pf.data_nascimento, ?) >= g.idade_minima)
                      OR EXISTS (SELECT 1 FROM paciente_prioridade_legal pp
                                  WHERE pp.paciente_id = r.paciente_id AND pp.grupo_prioridade_legal_id = g.id
                                    AND pp.excluido_em IS NULL AND pp.vigencia_inicio <= ?
                                    AND (pp.vigencia_fim IS NULL OR pp.vigencia_fim >= ?)))) AS peso_corte
           ${de}
           JOIN exame ex ON ex.id = ei.exame_id
           JOIN paciente p ON p.id = r.paciente_id
           JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          ${onde} AND ${deHoje}
          ORDER BY urgente DESC, (peso_corte IS NULL), peso_corte, chegada, ei.id
          LIMIT ${corte}`,
        [hoje, hoje, hoje, hoje, ...pOnde, ...pHoje],
        { teto: corte },
      );
      const dia = (v: unknown): string | null =>
        v === null || v === undefined ? null : civil(new Date(v as string | Date), fuso).data;
      // A regra do domínio confere o recorte do banco (o mesmo dia civil, pelo fuso do estabelecimento).
      const doDia = linhas.filter(
        (r: Linha) =>
          esperaNoDia(
            {
              pedidoEm: dia(r['solicitado_em'])!,
              previstoPara: dia(r['coleta_prevista_em']),
              agendadoPara: r['agendado_para'] === null ? null : texto(r['agendado_para']),
            },
            hoje,
          ) === 'hoje',
      );
      if (!doDia.length) return vazia;
      const grupos = (
        await l.consultar(
          'SELECT id, peso, idade_minima, descricao FROM grupo_prioridade_legal WHERE ativo = TRUE',
          [],
        )
      ).map((g: Linha) => ({
        id: n(g['id']),
        peso: n(g['peso']),
        idadeMinima: nn(g['idade_minima']),
        nome: texto(g['descricao']),
      }));
      const pacientes = [...new Set(doDia.map((r: Linha) => n(r['paciente_id'])))];
      const registros = await l.consultar(
        `SELECT paciente_id, grupo_prioridade_legal_id FROM paciente_prioridade_legal
          WHERE excluido_em IS NULL AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
            AND paciente_id IN (${lista(pacientes.length)})`,
        [hoje, hoje, ...pacientes],
        { teto: 10000 },
      );
      const registradosDe = (paciente: number): number[] =>
        registros
          .filter((x: Linha) => n(x['paciente_id']) === paciente)
          .map((x: Linha) => n(x['grupo_prioridade_legal_id']));
      // Só as escalas do setor que valem hoje (ou na véspera, pelo plantão que vira a noite), com os exames da fila.
      const escalas = await escalasDe(l, est, {
        setor,
        desde: somarDias(hoje, -1),
        ate: hoje,
        exames: [...new Set(doDia.map((r: Linha) => n(r['exame_id'])))],
      });
      const candidatos = doDia.map((r: Linha) => {
        const grupo = prioridadeDoPaciente(
          grupos as readonly GrupoPrioridade[],
          idadeEm(r['nascimento'] === null ? null : texto(r['nascimento']), hoje),
          registradosDe(n(r['paciente_id'])),
        );
        const exame = n(r['exame_id']);
        return {
          id: n(r['id']),
          urgente: Boolean(Number(r['urgente'] ?? 0)),
          ordemPrioridade: grupo?.peso ?? null,
          chegada: new Date(r['chegada'] as string | Date).toISOString(),
          requisicao: texto(r['numero']),
          paciente: texto(r['paciente']),
          exame,
          exameNome: texto(r['exame_nome']),
          situacao: texto(r['situacao']),
          grupoPrioridade: grupo?.id ?? null,
          grupoPrioridadeNome: grupo ? (grupos.find((g) => g.id === grupo.id)?.nome ?? null) : null,
          executantes: executantesDoExame(escalas, setor, exame, hoje, horaAgora).map((e) => {
            const g = e as EscalaExecucaoGravada;
            return {
              escala: g.id,
              descricao: g.descricao,
              profissional: g.profissional,
              recurso: g.recurso,
              profissionalNome: g.profissionalNome,
              recursoNome: g.recursoNome,
            };
          }),
        };
      });
      const itens = ordenarFilaDoSetor(candidatos).map((x, i) => ({ ...x, posicao: i + 1 }));
      return {
        setor,
        data: hoje,
        hora: horaAgora,
        itens,
        total,
        antigos,
        semExecutante: itens.filter((x) => x.executantes.length === 0).length,
      };
    });
  }

  /** Inclui a escala: a regra confere tudo e o choque com outra escala do mesmo executante em qualquer setor. */
  async incluir(c: ContextoSadt, entrada: unknown): Promise<{ id: number }> {
    const e = esquemaEscalaExecucao.parse(entrada);
    const problemas = conferirEscala(e);
    if (problemas.length)
      throw recusaDaRegra(
        'escala-invalida',
        problemas.map((p) => p.mensagem).join(' '),
        problemas.map((p) => p.campo),
      );
    return this.gravar(c, 'sadt.escala.incluida', async (tx, est) => {
      const s = await tx.uma('SELECT id FROM setor_diagnostico WHERE id = ? AND excluido_em IS NULL', [
        e.setor,
      ]);
      if (!s) throw recusa('setor-inexistente', 'O setor do diagnóstico não existe.');
      if (e.exames.length) {
        const k = await tx.uma(
          `SELECT COUNT(*) n FROM exame WHERE excluido_em IS NULL AND id IN (${lista(e.exames.length)})`,
          e.exames.map((x) => x.exame),
        );
        if (n(k?.['n']) !== e.exames.length) throw recusa('exame-inexistente', 'Algum exame não existe.');
      }
      // O choque com as escalas do mesmo executante (em qualquer setor do estabelecimento) que ainda valem na
      // vigência da nova. A trava é no cadastro do executante: dois cadastros ao mesmo tempo para a mesma pessoa ou
      // sala esperam um pelo outro, mesmo quando ainda não há escala nenhuma dela. Só os plantões são lidos.
      if (e.profissional !== null)
        await tx.consultarParaAtualizar('SELECT id FROM profissional WHERE id = ?', [e.profissional]);
      if (e.recurso !== null)
        await tx.consultarParaAtualizar('SELECT id FROM recurso_agendavel WHERE id = ?', [e.recurso]);
      const outras = await escalasDe(tx, est, {
        executante: { profissional: e.profissional, recurso: e.recurso },
        desde: e.vigenciaInicio,
        exames: [],
        trava: tx,
      });
      const choques = conflitosDoExecutante(e, outras);
      if (choques.length)
        throw recusaDaRegra(
          'escala-conflito',
          `O plantão ${choques[0]!.plantao + 1} choca com a escala "${choques[0]!.descricao}" do mesmo executante.`,
          choques.map((x) => `plantoes.${x.plantao}`),
        );
      const novo = await tx.incluir('escala_execucao', {
        estabelecimento_id: est,
        setor_diagnostico_id: e.setor,
        profissional_id: e.profissional,
        recurso_agendavel_id: e.recurso,
        papel: e.papel,
        descricao: e.descricao,
        vigencia_inicio: e.vigenciaInicio,
        vigencia_fim: e.vigenciaFim,
        atende_feriado: e.atendeFeriado,
        ativo: true,
      });
      let seq = 0;
      for (const p of e.plantoes)
        await tx.incluir('escala_execucao_dia', {
          escala_execucao_id: novo,
          sequencia: ++seq,
          dia_semana: p.diaSemana,
          data_especifica: p.data,
          hora_inicio: `${p.inicio}:00`,
          hora_fim: `${p.fim}:00`,
          capacidade: p.capacidade,
          ativo: true,
        });
      for (const x of e.exames)
        await tx.incluir('escala_execucao_exame', {
          escala_execucao_id: novo,
          exame_id: x.exame,
          limite_por_turno: x.limitePorTurno,
          grupo_prioridade_legal_id: x.grupoPrioridade,
          vagas_reservadas_prioridade: x.vagasReservadas,
          ativo: true,
        });
      return novo;
    });
  }

  /** Encerra a vigência da escala (nunca apaga; o fim não fica antes do início nem antes de um plantão avulso já dado). */
  async encerrar(c: ContextoSadt, escala: number, entrada: unknown): Promise<{ id: number }> {
    const e = esquemaEncerrarEscala.parse(entrada);
    const versao = e.versao;
    return this.gravar(c, 'sadt.escala.encerrada', async (tx, est) => {
      const [r] = await tx.consultarParaAtualizar(
        `SELECT id, versao, vigencia_inicio, vigencia_fim FROM escala_execucao
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [escala, est],
      );
      if (!r) throw recusa('nao-encontrado', 'A escala não existe neste estabelecimento.');
      if (n(r['versao']) !== versao)
        throw recusa('versao-mudou', 'A escala mudou desde que foi aberta; recarregue.');
      const inicio = dataIso(r['vigencia_inicio'])!;
      if (e.vigenciaFim < inicio)
        throw recusa('vigencia-invalida', 'O fim da vigência não pode ser antes do início.');
      const atual = dataIso(r['vigencia_fim']);
      if (atual !== null && atual <= e.vigenciaFim)
        throw recusa('ja-encerrada', 'A escala já termina nesta data ou antes.');
      await tx.alterar('escala_execucao', escala, versao, { vigencia_fim: e.vigenciaFim });
      return escala;
    });
  }
}

/** O recorte da leitura das escalas do estabelecimento (sem recorte: todas as não excluídas). */
interface FiltroDasEscalas {
  /** Só as escalas deste setor. */
  readonly setor?: number | null;
  /** Só as que ainda valem nesta data ou depois (sem fim de vigência, ou com o fim nela ou depois). */
  readonly desde?: string | null;
  /** Só as que já começaram até esta data. */
  readonly ate?: string | null;
  /** Só as do mesmo profissional ou da mesma sala (o choque de horário). */
  readonly executante?: { readonly profissional: number | null; readonly recurso: number | null };
  /** Só estes exames de cada escala (lista vazia: nenhum exame é lido). Sem a lista: todos. */
  readonly exames?: readonly number[];
  /** A lista de exames só das escalas deste setor (as dos outros setores vêm sem ela). */
  readonly examesSoDoSetor?: number;
  /** Na gravação, as escalas lidas ficam travadas até o fim. */
  readonly trava?: TxOperacao | null;
}

async function escalasDe(l: Leitor, est: number, f: FiltroDasEscalas = {}): Promise<EscalaExecucaoGravada[]> {
  const onde: string[] = [];
  const p: unknown[] = [est];
  if (f.setor !== undefined && f.setor !== null) {
    onde.push('AND s.setor_diagnostico_id = ?');
    p.push(f.setor);
  }
  if (f.desde) {
    onde.push('AND (s.vigencia_fim IS NULL OR s.vigencia_fim >= ?)');
    p.push(f.desde);
  }
  if (f.ate) {
    onde.push('AND s.vigencia_inicio <= ?');
    p.push(f.ate);
  }
  if (f.executante) {
    const { profissional, recurso } = f.executante;
    const partes: string[] = [];
    if (profissional !== null) {
      partes.push('s.profissional_id = ?');
      p.push(profissional);
    }
    if (recurso !== null) {
      partes.push('s.recurso_agendavel_id = ?');
      p.push(recurso);
    }
    onde.push(partes.length ? `AND (${partes.join(' OR ')})` : 'AND FALSE');
  }
  // A leitura tem limite no próprio comando (as vigentes primeiro) e teto igual: nunca vira erro de teto.
  const sqlCab = `SELECT s.id, s.setor_diagnostico_id, s.profissional_id, s.recurso_agendavel_id, s.papel, s.descricao,
            s.vigencia_inicio, s.vigencia_fim, s.atende_feriado, s.ativo, s.versao,
            (SELECT COALESCE(NULLIF(pr.nome_exibicao, ''), pf.nome)
               FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
              WHERE pr.id = s.profissional_id) AS profissional_nome,
            (SELECT ra.descricao FROM recurso_agendavel ra WHERE ra.id = s.recurso_agendavel_id) AS recurso_nome
       FROM escala_execucao s
      WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL ${onde.join(' ')}
      ORDER BY (s.vigencia_fim IS NULL) DESC, s.vigencia_fim DESC, s.descricao, s.id
      LIMIT ${MAX_ESCALAS_NA_LEITURA}`;
  const cab = f.trava
    ? await f.trava.consultarParaAtualizar(sqlCab, p, { teto: MAX_ESCALAS_NA_LEITURA })
    : await l.consultar(sqlCab, p, { teto: MAX_ESCALAS_NA_LEITURA });
  if (!cab.length) return [];
  const ids = cab.map((r) => n(r['id']));
  // Os tetos acompanham o que a gravação aceita por escala: a leitura cresce com o cadastro sem virar erro.
  const dias = await l.consultar(
    `SELECT escala_execucao_id, dia_semana, data_especifica, hora_inicio, hora_fim, capacidade
       FROM escala_execucao_dia
      WHERE escala_execucao_id IN (${lista(ids.length)}) AND ativo AND excluido_em IS NULL
      ORDER BY escala_execucao_id, sequencia`,
    ids,
    { teto: ids.length * MAX_PLANTOES_DA_ESCALA },
  );
  const comExames =
    f.examesSoDoSetor === undefined
      ? ids
      : cab.filter((r) => n(r['setor_diagnostico_id']) === f.examesSoDoSetor).map((r) => n(r['id']));
  const soEstes = f.exames === undefined ? null : [...f.exames];
  const exames =
    !comExames.length || (soEstes !== null && !soEstes.length)
      ? []
      : await l.consultar(
          `SELECT escala_execucao_id, exame_id, limite_por_turno, grupo_prioridade_legal_id, vagas_reservadas_prioridade
             FROM escala_execucao_exame
            WHERE escala_execucao_id IN (${lista(comExames.length)}) AND ativo AND excluido_em IS NULL
              ${soEstes !== null ? `AND exame_id IN (${lista(soEstes.length)})` : ''}
            ORDER BY escala_execucao_id, id`,
          [...comExames, ...(soEstes ?? [])],
          // Um exame aparece uma vez por escala (chave única): o teto é o produto, nunca passa.
          { teto: comExames.length * (soEstes !== null ? soEstes.length : MAX_EXAMES_DA_ESCALA) },
        );
  const plantoesDe = (k: number): PlantaoEscala[] =>
    dias
      .filter((d: Linha) => n(d['escala_execucao_id']) === k)
      .map((d: Linha) => ({
        diaSemana: nn(d['dia_semana']),
        data: dataIso(d['data_especifica']),
        inicio: hora(d['hora_inicio']),
        fim: hora(d['hora_fim']),
        capacidade: n(d['capacidade']),
      }));
  const examesDe = (k: number): ExameDaEscala[] =>
    exames
      .filter((x: Linha) => n(x['escala_execucao_id']) === k)
      .map((x: Linha) => ({
        exame: n(x['exame_id']),
        limitePorTurno: nn(x['limite_por_turno']),
        grupoPrioridade: nn(x['grupo_prioridade_legal_id']),
        vagasReservadas: n(x['vagas_reservadas_prioridade']),
      }));
  return cab.map((r: Linha) => {
    const k = n(r['id']);
    return {
      id: k,
      setor: n(r['setor_diagnostico_id']),
      profissional: nn(r['profissional_id']),
      recurso: nn(r['recurso_agendavel_id']),
      profissionalNome: r['profissional_nome'] == null ? null : texto(r['profissional_nome']),
      recursoNome: r['recurso_nome'] == null ? null : texto(r['recurso_nome']),
      papel: texto(r['papel']) === 'lauda' ? 'lauda' : 'executa',
      descricao: texto(r['descricao']),
      vigenciaInicio: dataIso(r['vigencia_inicio'])!,
      vigenciaFim: dataIso(r['vigencia_fim']),
      atendeFeriado: Boolean(Number(r['atende_feriado'] ?? 0)),
      ativa: Boolean(Number(r['ativo'] ?? 0)),
      versao: n(r['versao']),
      plantoes: plantoesDe(k),
      exames: examesDe(k),
    };
  });
}
