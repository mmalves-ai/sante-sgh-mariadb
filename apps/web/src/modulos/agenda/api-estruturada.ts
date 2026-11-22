// ADR 0009: cliente das telas da agenda estruturada (preço particular, cobertura por convênio e subplano,
// restrições e preparo, com o texto original ao lado), do credenciamento profissional × convênio e da origem do
// preço no lançamento do atendimento. Lê e grava pelos contratos de @sgh/contratos; as gravações vão com o CSRF e a
// Idempotency-Key (a mesma regra de api-agenda.ts). Não existe preço por médico em convênio (decisão 24): a regra
// editada aqui é sempre do PARTICULAR.
import {
  type AgendaEstruturada,
  type Credenciamento,
  type EntradaCredenciamento,
  type EntradaRegraPrecoParticular,
  esquemaAgendaEstruturada,
  esquemaCredenciamento,
  esquemaEntradaCredenciamento,
  esquemaEntradaRegraPrecoParticular,
  esquemaOpcoesCredenciamentoConvenio,
  esquemaResultadoAgenda,
  esquemaResultadoCalculoPreco,
  type OpcoesCredenciamentoConvenio,
  type ResultadoAgenda,
  type ResultadoCalculoPreco,
  SITUACOES_REVISAO_REGRA,
} from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };
const AGENDAS = '/api/agenda/consultas/agendas';
const REGRAS = '/api/agenda/consultas/precos-particulares';
const CREDENCIAMENTOS = '/api/cadastros/credenciamentos';
const CONVENIOS = '/api/cadastros/convenios';
const ATENDIMENTO = '/api/atendimento';

async function lerJson<T>(r: Response, esquema: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}
const ler = async <T>(url: string, esquema: z.ZodType<T>): Promise<T> =>
  lerJson(await fetch(url, { headers: JSON_ACEITO }), esquema);

async function gravar(
  url: string,
  corpo: unknown,
  chave: string,
  metodo: 'POST' | 'PUT' = 'POST',
): Promise<ResultadoAgenda> {
  const r = await fetch(url, {
    method: metodo,
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave,
    },
    body: JSON.stringify(corpo ?? {}),
  });
  return lerJson(r, esquemaResultadoAgenda);
}

const qs = (o: Record<string, string | number | null | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

const esquemaListaCredenciamentos = z.object({ itens: z.array(esquemaCredenciamento) });

/** Revisão de uma regra de preço particular: controle de colisão pela versão lida. */
export const esquemaRevisaoRegraPreco = z.object({
  versao: z.number().int().positive(),
  valores: z
    .object({
      valor: z.number().nonnegative().multipleOf(0.01),
      prioridade: z.number().int().min(0).max(65_535),
      vigenciaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      vigenciaFim: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable(),
      situacaoRevisao: z.enum(SITUACOES_REVISAO_REGRA),
      observacao: z.string().max(500).nullable(),
    })
    .partial(),
});
export type RevisaoRegraPreco = z.infer<typeof esquemaRevisaoRegraPreco>;

// ── Leituras ──
export const lerAgendaEstruturada = (agendaId: number, data?: string): Promise<AgendaEstruturada> =>
  ler(`${AGENDAS}/${agendaId}/estruturada${qs({ data })}`, esquemaAgendaEstruturada);
export const listarCredenciamentos = async (f: {
  profissionalId?: number;
  fontePagadoraId?: number;
}): Promise<Credenciamento[]> => (await ler(`${CREDENCIAMENTOS}${qs(f)}`, esquemaListaCredenciamentos)).itens;
export const lerOpcoesCredenciamento = (convenioCodigo: number): Promise<OpcoesCredenciamentoConvenio> =>
  ler(`${CONVENIOS}/${convenioCodigo}/credenciamento`, esquemaOpcoesCredenciamentoConvenio);
/** Prévia do preço e do credenciamento de um procedimento no atendimento (antes de lançar). */
export const calcularPrecoAtendimento = (reg: number, procedimento: number): Promise<ResultadoCalculoPreco> =>
  ler(`${ATENDIMENTO}/${reg}/preco${qs({ procedimento })}`, esquemaResultadoCalculoPreco);

// ── Gravações ──
export const incluirRegraPreco = (entrada: EntradaRegraPrecoParticular, chave: string) =>
  gravar(REGRAS, esquemaEntradaRegraPrecoParticular.parse(entrada), chave);
export const revisarRegraPreco = (regraId: number, revisao: RevisaoRegraPreco, chave: string) =>
  gravar(`${REGRAS}/${regraId}`, esquemaRevisaoRegraPreco.parse(revisao), chave, 'PUT');
export const incluirCredenciamento = (entrada: EntradaCredenciamento, chave: string) =>
  gravar(CREDENCIAMENTOS, esquemaEntradaCredenciamento.parse(entrada), chave);
export const definirOpcoesCredenciamento = (
  convenioCodigo: number,
  opcoes: Pick<OpcoesCredenciamentoConvenio, 'bloqueiaSemCredenciamento' | 'credenciaTodosAoCriar'>,
  chave: string,
) => gravar(`${CONVENIOS}/${convenioCodigo}/credenciamento`, opcoes, chave, 'PUT');
