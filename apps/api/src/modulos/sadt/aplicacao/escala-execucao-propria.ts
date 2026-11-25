// Escala de execução do diagnóstico no banco do cliente (F3.5, 05-SADT linha 19): os plantões de quem executa ou lauda
// por setor, os dias e horários, e os exames atendidos com o limite por turno e as vagas reservadas a grupo prioritário.
// A regra mora em @sgh/dominio-sadt (escala/execucao.ts): a conferência da escala com todos os problemas por campo e o
// choque de horário do mesmo profissional (ou sala) em qualquer setor; aqui fica a leitura e a gravação do que a regra
// decide. Nada se apaga: a escala que sai de uso tem a vigência encerrada (fica no histórico).
import {
  conferirEscala,
  conflitosDoExecutante,
  type EscalaExecucao,
  type ExameDaEscala,
  executantesDoExame,
  type GrupoPrioridade,
  idadeEm,
  type NaFila,
  ordenarFilaDoSetor,
  type PlantaoEscala,
  prioridadeDoPaciente,
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
import { FUSO_PADRAO, relogioNoFuso } from '../../exames/relogio.js';
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
    .max(60),
  exames: z
    .array(
      z.object({
        exame: id,
        limitePorTurno: z.number().int().nullable().default(null),
        grupoPrioridade: id.nullable().default(null),
        vagasReservadas: z.number().int().default(0),
      }),
    )
    .max(300),
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
  readonly papel: 'executa' | 'lauda';
  readonly atendeFeriado: boolean;
  readonly versao: number;
}

/** Um nome do cadastro para os combos da tela da escala. */
export interface OpcaoDaEscala {
  readonly id: number;
  readonly nome: string;
}

/** O que a tela da escala precisa para montar os combos, numa leitura só. */
export interface OpcoesDaEscala {
  readonly setores: OpcaoDaEscala[];
  readonly profissionais: OpcaoDaEscala[];
  readonly recursos: OpcaoDaEscala[];
  readonly exames: OpcaoDaEscala[];
  readonly gruposPrioridade: OpcaoDaEscala[];
  /** O dia civil do estabelecimento (a grade abre na semana dele). */
  readonly hoje: string;
}

/** Quem está de plantão para o exame agora (a escala e o executante dela). */
export interface ExecutanteAgora {
  readonly escala: number;
  readonly descricao: string;
  readonly profissional: number | null;
  readonly recurso: number | null;
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
  /** Quantos exames da fila não têm ninguém escalado agora. */
  readonly semExecutante: number;
}

/** O exame que espera a execução: pedido, autorizado ou agendado (o colhido ou em análise já saiu da fila). */
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

  /** As escalas do estabelecimento (de um setor, se pedido), as vigentes primeiro, com os plantões e os exames. */
  listar(c: ContextoSadt, setor: number | null = null): Promise<EscalaExecucaoGravada[]> {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.ctxNucleo(c), (l) => escalasDe(l, est, setor));
  }

  /** Os nomes para os combos da tela (setores, quem executa, salas, exames e grupos prioritários) e o dia de hoje. */
  opcoes(c: ContextoSadt): Promise<OpcoesDaEscala> {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.ctxNucleo(c), async (l) => {
      const nomes = async (sql: string, p: unknown[], teto: number): Promise<OpcaoDaEscala[]> =>
        (await l.consultar(sql, p, { teto })).map((r: Linha) => ({ id: n(r['id']), nome: texto(r['nome']) }));
      const fuso = await l.uma('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
      return {
        setores: await nomes(
          `SELECT id, nome FROM setor_diagnostico
            WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL ORDER BY nome, id`,
          [est],
          500,
        ),
        profissionais: await nomes(
          `SELECT pr.id, COALESCE(NULLIF(pr.nome_exibicao, ''), pf.nome) AS nome
             FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
            WHERE pr.situacao = 'ativo' AND pr.excluido_em IS NULL ORDER BY nome, pr.id`,
          [],
          5000,
        ),
        recursos: await nomes(
          `SELECT id, descricao AS nome FROM recurso_agendavel
            WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL ORDER BY descricao, id`,
          [est],
          1000,
        ),
        exames: await nomes(
          'SELECT id, nome FROM exame WHERE ativo = TRUE AND excluido_em IS NULL ORDER BY nome, id',
          [],
          8000,
        ),
        gruposPrioridade: await nomes(
          'SELECT id, descricao AS nome FROM grupo_prioridade_legal WHERE ativo = TRUE ORDER BY peso, id',
          [],
          100,
        ),
        hoje: relogioNoFuso(String(fuso?.['fuso_horario'] || FUSO_PADRAO)).hoje,
      };
    });
  }

  /**
   * A fila do setor na ordem de chamada: os exames pedidos que esperam a execução, com a urgência do pedido, a
   * prioridade legal do paciente (a de idade pela data de nascimento, as demais pela condição registrada e vigente) e
   * a chegada (a hora do pedido). A ordem é a regra do domínio (ordenarFilaDoSetor); cada exame traz quem está
   * escalado para ele agora. `agora` só é passado em teste.
   */
  fila(c: ContextoSadt, setor: number, agora: Date = new Date()): Promise<FilaDoSetor> {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.ctxNucleo(c), async (l) => {
      const s = await l.uma(
        `SELECT sd.id, e.fuso_horario FROM setor_diagnostico sd JOIN estabelecimento e ON e.id = sd.estabelecimento_id
          WHERE sd.id = ? AND sd.estabelecimento_id = ? AND sd.excluido_em IS NULL`,
        [setor, est],
      );
      if (!s) throw recusa('setor-inexistente', 'O setor do diagnóstico não existe neste estabelecimento.');
      const { hoje, hora: horaAgora } = relogioNoFuso(String(s['fuso_horario'] || FUSO_PADRAO), agora);
      const linhas = await l.consultar(
        `SELECT ei.id, ei.exame_id, ex.nome AS exame_nome, ei.situacao, r.numero, r.paciente_id, r.solicitado_em,
                (ei.urgente = TRUE OR r.prioridade <> 'rotina') AS urgente,
                CASE WHEN pf.usa_nome_social = TRUE AND COALESCE(pf.nome_social, '') <> '' THEN pf.nome_social
                     ELSE pf.nome END AS paciente,
                DATE_FORMAT(pf.data_nascimento, '%Y-%m-%d') AS nascimento
           FROM exame_item ei
           JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id AND r.excluido_em IS NULL
                                  AND r.situacao <> 'cancelada'
           JOIN exame ex ON ex.id = ei.exame_id
           JOIN paciente p ON p.id = r.paciente_id
           JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE r.estabelecimento_id = ? AND COALESCE(ei.setor_diagnostico_id, r.setor_diagnostico_id) = ?
            AND ei.excluido_em IS NULL AND ei.situacao IN (${lista(SITUACOES_NA_FILA.length)})`,
        [est, setor, ...SITUACOES_NA_FILA],
        { teto: 2000 },
      );
      if (!linhas.length) return { setor, data: hoje, hora: horaAgora, itens: [], semExecutante: 0 };
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
      const pacientes = [...new Set(linhas.map((r: Linha) => n(r['paciente_id'])))];
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
      const escalas = await escalasDe(l, est, setor);
      const candidatos = linhas.map((r: Linha) => {
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
          chegada: new Date(r['solicitado_em'] as string | Date).toISOString(),
          requisicao: texto(r['numero']),
          paciente: texto(r['paciente']),
          exame,
          exameNome: texto(r['exame_nome']),
          situacao: texto(r['situacao']),
          grupoPrioridade: grupo?.id ?? null,
          grupoPrioridadeNome: grupo ? (grupos.find((g) => g.id === grupo.id)?.nome ?? null) : null,
          executantes: executantesDoExame(escalas, setor, exame, hoje, horaAgora).map((e) => ({
            escala: (e as EscalaExecucaoGravada).id,
            descricao: e.descricao,
            profissional: e.profissional,
            recurso: e.recurso,
          })),
        };
      });
      const itens = ordenarFilaDoSetor(candidatos).map((x, i) => ({ ...x, posicao: i + 1 }));
      return {
        setor,
        data: hoje,
        hora: horaAgora,
        itens,
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
      // O choque com as escalas ativas do mesmo executante (em qualquer setor do estabelecimento), sob trava.
      const outras = (await escalasDe(tx, est, null, tx)).filter(
        (o) =>
          (e.profissional !== null && o.profissional === e.profissional) ||
          (e.recurso !== null && o.recurso === e.recurso),
      );
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

async function escalasDe(
  l: Leitor,
  est: number,
  setor: number | null,
  trava: TxOperacao | null = null,
): Promise<EscalaExecucaoGravada[]> {
  // Na gravação, as escalas do estabelecimento ficam travadas até o fim (dois cadastros ao mesmo tempo não escapam).
  const consultarCab = (sql: string, p: unknown[]) =>
    trava ? trava.consultarParaAtualizar(sql, p) : l.consultar(sql, p);
  const cab = await consultarCab(
    `SELECT id, setor_diagnostico_id, profissional_id, recurso_agendavel_id, papel, descricao, vigencia_inicio,
            vigencia_fim, atende_feriado, ativo, versao
       FROM escala_execucao
      WHERE estabelecimento_id = ? AND excluido_em IS NULL ${setor !== null ? 'AND setor_diagnostico_id = ?' : ''}
      ORDER BY (vigencia_fim IS NULL) DESC, vigencia_fim DESC, descricao, id`,
    setor !== null ? [est, setor] : [est],
  );
  if (!cab.length) return [];
  const ids = cab.map((r) => n(r['id']));
  const dias = await l.consultar(
    `SELECT escala_execucao_id, dia_semana, data_especifica, hora_inicio, hora_fim, capacidade
       FROM escala_execucao_dia
      WHERE escala_execucao_id IN (${lista(ids.length)}) AND ativo AND excluido_em IS NULL
      ORDER BY escala_execucao_id, sequencia`,
    ids,
  );
  const exames = await l.consultar(
    `SELECT escala_execucao_id, exame_id, limite_por_turno, grupo_prioridade_legal_id, vagas_reservadas_prioridade
       FROM escala_execucao_exame
      WHERE escala_execucao_id IN (${lista(ids.length)}) AND ativo AND excluido_em IS NULL
      ORDER BY escala_execucao_id, id`,
    ids,
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
