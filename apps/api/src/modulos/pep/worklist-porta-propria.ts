// Porta PRÓPRIA das leituras da fila do médico (M27) sobre o banco do cliente (MariaDB, pelo @sgh/nucleo), só leitura:
//   - previsão de alta: `internacao.data_prevista_alta` (a vigente; as revisões ficam em previsao_alta) das internações
//     ativas ou em alta médica da fila;
//   - resultados liberados (ou retificados) dos pacientes da fila desde o início da janela: `resultado_exame`, ligado ao
//     estabelecimento pela requisição (`exame_item` → `requisicao_exame.estabelecimento_id`);
//   - prescrições a renovar: as médicas vigentes ou futuras dos atendimentos da fila que terminam a partir de agora; a
//     regra (vence na janela sem a do período seguinte) é a do domínio (`vencemNoTurno`, @sgh/dominio-pep, regra 14 do
//     M24), a mesma da prescrição; a porta só converte a vigência do banco (instante UTC, fim exclusivo) para a hora
//     civil do estabelecimento em minutos inclusivos (início no teto do minuto; fim no último minuto em vigor, fim − 1 ms).
//     Assim a seguinte que começa no fim da vigente (ou 1 ms / 1 min depois) cobre a vigente.
// Toda leitura filtra o estabelecimento da sessão e a exclusão lógica; SQL parametrizado, nomes literais, listas de ids
// validadas (inteiros positivos, sem repetição, com teto). O banco guarda instantes em UTC; as datas e horas saem no
// fuso do estabelecimento (estabelecimento.fuso_horario), e a janela da hora civil é convertida para o instante.
// PENDÊNCIA DO MARCO (degradação registrada, pedido do lote 04-02): o modelo não registra a visualização do resultado
// pelo médico (`visualizacao_resultado_exame`, DDL pedido); até lá `vistoPeloMedico` é falso e o resultado conta como
// novo até a ciência ou o fim da janela, mesmo já aberto. O `FiltroWorklist.login` fica para essa leitura (por
// usuário/profissional da sessão), e a gravação na abertura do resultado é da porta própria dos documentos (pendente).
// O marco não fecha com esta pendência sem o registro no ESTADO/ficha.
// Melhoria: o resultado é do estabelecimento da sessão (pela requisição); outro estabelecimento não entra na fila.
// Melhoria: só a prescrição médica entra na pendência "prescrição a renovar" (a fila é do médico).
// Melhoria: a previsão de alta é a vigente da internação, sem ler a internação excluída, cancelada ou já com alta.
import { ErroOperacao, type Leitor } from '@sgh/nucleo';
import { type PrescricaoDoAtendimento, vencemNoTurno } from '@sgh/dominio-pep';
import type { ContextoDocs } from './documentos-porta.js';
import { dataHora, fusoValido } from './registro-porta-propria.js';
import type {
  FiltroWorklist,
  LeiturasDaWorklist,
  PortaWorklist,
  PrescricaoARenovar,
  PrevisaoAltaDaFila,
  ResultadoDaFila,
} from './worklist-porta.js';

/** O que a porta usa do NucleoProprio (os testes trocam). */
export interface NucleoLeituraWorklist {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
}

/** Teto de ids por lista (a fila tem até 100 pacientes). */
export const TETO_IDS_WORKLIST = 500;
/** Teto de linhas lidas por consulta. */
export const TETO_LINHAS_WORKLIST = 10_000;
const DIA = 86_400_000;

/** Ids válidos (inteiros positivos), sem repetição e no teto. */
export function idsValidos(ids: readonly number[]): number[] {
  return [...new Set(ids)].filter((i) => Number.isSafeInteger(i) && i > 0).slice(0, TETO_IDS_WORKLIST);
}
const marcadores = (n: number): string => Array.from({ length: n }, () => '?').join(', ');

/**
 * Hora civil do estabelecimento (AAAA-MM-DDTHH:MM[:SS]) como instante (UTC). Duas aproximações pelo deslocamento do
 * fuso naquele instante (cobre a troca de horário). Formato inválido: 422.
 */
export function instanteDoLocal(local: string, fuso: string): Date {
  const alvo = Date.parse(`${local.slice(0, 19)}Z`);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(local) || Number.isNaN(alvo))
    throw new ErroOperacao(
      422,
      'data-invalida',
      'Data inválida',
      'A hora da janela não está no formato AAAA-MM-DDTHH:MM:SS.',
    );
  let t = alvo;
  for (let i = 0; i < 2; i++) {
    const visto = Date.parse(`${dataHora(new Date(t), fuso) ?? ''}Z`);
    if (Number.isNaN(visto)) break;
    t += alvo - visto;
  }
  return new Date(t);
}

const comoData = (v: unknown): Date | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

interface Estabelecimento {
  readonly id: number;
  readonly fuso: string;
}

export class PortaWorklistPropria implements PortaWorklist {
  readonly destino = 'proprio' as const;

  constructor(
    private readonly nucleo: NucleoLeituraWorklist,
    /** Cliente desta API (configuração; um banco por cliente), quando o contexto da sessão não o traz. */
    private readonly cliente: string,
  ) {}

  private ler<T>(
    c: ContextoDocs,
    rotulo: string,
    fn: (l: Leitor, est: Estabelecimento) => Promise<T>,
  ): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: c.cliente || this.cliente, correlacao: c.correlacao || `pep.worklist.${rotulo}` },
      async (l) => fn(l, await this.estabelecimento(l, c)),
    );
  }

  /** O estabelecimento da sessão: pelo id do contexto ou, sem ele, pelo código. */
  private async estabelecimento(l: Leitor, c: ContextoDocs): Promise<Estabelecimento> {
    const e =
      c.estabelecimento !== null && c.estabelecimento !== undefined
        ? await l.uma<{ id: unknown; fuso_horario: unknown }>(
            'SELECT id, fuso_horario FROM estabelecimento WHERE id = ? AND excluido_em IS NULL',
            [c.estabelecimento],
          )
        : await l.uma<{ id: unknown; fuso_horario: unknown }>(
            'SELECT id, fuso_horario FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
            [c.hospital],
          );
    if (!e)
      throw new ErroOperacao(
        404,
        'estabelecimento-inexistente',
        'Estabelecimento não encontrado',
        'O estabelecimento da sessão não existe neste cliente.',
      );
    return { id: Number(e.id), fuso: fusoValido(e.fuso_horario) };
  }

  async leituras(c: ContextoDocs, f: FiltroWorklist): Promise<LeiturasDaWorklist> {
    const internacoes = idsValidos(f.internacoes);
    const pacientes = idsValidos(f.pacientes);
    const desde = f.desde.toISOString().slice(0, 10);
    return this.ler(c, 'leituras', async (l, est) => {
      const previsoesAlta: PrevisaoAltaDaFila[] = [];
      if (internacoes.length > 0) {
        const linhas = await l.consultar(
          `SELECT id, DATE_FORMAT(data_prevista_alta, '%Y-%m-%d') AS previsao
             FROM internacao
            WHERE estabelecimento_id = ? AND id IN (${marcadores(internacoes.length)})
              AND excluido_em IS NULL AND situacao IN ('ativa', 'alta_medica') AND data_prevista_alta IS NOT NULL`,
          [est.id, ...internacoes],
          { teto: TETO_IDS_WORKLIST },
        );
        for (const x of linhas)
          previsoesAlta.push({ internacao: Number(x['id']), previsao: String(x['previsao']) });
      }
      const resultados: ResultadoDaFila[] = [];
      if (pacientes.length > 0) {
        // Um dia antes da data civil: o corte exato é feito no fuso do estabelecimento, abaixo.
        const corte = new Date(f.desde.getTime() - DIA);
        const linhas = await l.consultar(
          `SELECT r.id, r.paciente_id, r.liberado_em
             FROM resultado_exame r
             JOIN exame_item i ON i.id = r.exame_item_id AND i.excluido_em IS NULL
             JOIN requisicao_exame q ON q.id = i.requisicao_exame_id AND q.excluido_em IS NULL
            WHERE q.estabelecimento_id = ? AND r.paciente_id IN (${marcadores(pacientes.length)})
              AND r.excluido_em IS NULL AND r.situacao IN ('liberado', 'retificado') AND r.liberado_em >= ?
            ORDER BY r.liberado_em DESC, r.id DESC`,
          [est.id, ...pacientes, corte],
          { teto: TETO_LINHAS_WORKLIST },
        );
        for (const x of linhas) {
          const liberadoEm = dataHora(x['liberado_em'], est.fuso)?.slice(0, 10) ?? null;
          if (liberadoEm && liberadoEm >= desde)
            resultados.push({
              paciente: Number(x['paciente_id']),
              exame: Number(x['id']),
              liberadoEm,
              vistoPeloMedico: false,
            });
        }
      }
      return { previsoesAlta, resultados };
    });
  }

  async aRenovar(
    c: ContextoDocs,
    atendimentos: readonly number[],
    agora: string,
    ate: string,
  ): Promise<PrescricaoARenovar[]> {
    const ids = idsValidos(atendimentos);
    if (ids.length === 0) return [];
    return this.ler(c, 'a-renovar', async (l, est) => {
      const inicio = instanteDoLocal(agora, est.fuso);
      const linhas = await l.consultar(
        `SELECT id, atendimento_id, situacao, vigencia_inicio_em, vigencia_fim_em
           FROM prescricao
          WHERE estabelecimento_id = ? AND atendimento_id IN (${marcadores(ids.length)})
            AND excluido_em IS NULL AND tipo = 'medica' AND situacao IN ('vigente', 'futura')
            AND vigencia_fim_em >= ?`,
        [est.id, ...ids, inicio],
        { teto: TETO_LINHAS_WORKLIST },
      );
      const candidatas: PrescricaoDoAtendimento[] = [];
      const fimDoBanco = new Map<number, Date>();
      for (const x of linhas) {
        const i = comoData(x['vigencia_inicio_em']);
        const f = comoData(x['vigencia_fim_em']);
        const situacao = x['situacao'];
        if (!i || !f || (situacao !== 'vigente' && situacao !== 'futura')) continue;
        // Início → primeiro minuto inteiro em vigor (teto); fim exclusivo do banco → último minuto em vigor (fim − 1 ms):
        // o formato do domínio (minutos inclusivos). A seguinte que começa no instante do fim fica no minuto seguinte.
        const inicioLocal = dataHora(new Date(Math.ceil(i.getTime() / 60_000) * 60_000), est.fuso);
        const fimLocal = dataHora(new Date(f.getTime() - 1), est.fuso);
        if (!inicioLocal || !fimLocal) continue;
        const id = Number(x['id']);
        fimDoBanco.set(id, f);
        candidatas.push({
          id,
          atendimento: Number(x['atendimento_id']),
          vigencia: { inicio: inicioLocal, fim: fimLocal },
          suspensa: false,
        });
      }
      return vencemNoTurno(candidatas, agora, ate).map((p) => ({
        atendimento: p.atendimento,
        fim: dataHora(fimDoBanco.get(p.id), est.fuso),
      }));
    });
  }
}
