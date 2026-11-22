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
// Rotas do AgendaPrecoController (apps/api/src/modulos/precos/agenda-preco.controller.ts, prefixo global 'api').
// O spec confere cada URL chamada aqui contra os decoradores do controller; as que a API ainda não tem ficam na lista
// ROTAS_PENDENTES_API (lote API), e o teste falha quando uma delas passa a existir ou quando surge outra fora da lista.
const AGENDAS = '/api/agendas';
const REGRAS = '/api/precos-particulares';
const CREDENCIAMENTOS = '/api/credenciamentos';
const CONVENIOS = '/api/convenios';
const ATENDIMENTO = '/api/atendimento';

/** Rotas que as telas usam e a API ainda não publica (pedidas ao lote API). Formato "MÉTODO /api/caminho/:id". */
export const ROTAS_PENDENTES_API: readonly string[] = [
  // vazia: a revisão da regra (PUT) e a prévia do atendimento foram publicadas na conferência final da rodada
];

/** Mensagem da gravação quando a API devolve só o resultado da operação (sem a mensagem). */
const MENSAGEM_GRAVADO = 'Gravado.';

const hojeIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

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
  // O controller devolve o resultado da operação (ex.: { id }); aceita também o envelope da agenda.
  const devolvido = await lerJson(r, z.unknown());
  const envelope = esquemaResultadoAgenda.safeParse(devolvido);
  if (envelope.success) return envelope.data;
  const resultado = esquemaResultadoAgenda.shape.resultado.safeParse(devolvido);
  return {
    ok: true,
    resultado: resultado.success ? resultado.data : {},
    repetida: false,
    mensagem: MENSAGEM_GRAVADO,
  };
}

const qs = (o: Record<string, string | number | null | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

const esquemaListaCredenciamentos = z.array(esquemaCredenciamento);

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
/** Credenciamentos vigentes na data (hoje, por padrão). A API devolve a lista pura. */
export const listarCredenciamentos = (f: {
  profissionalId?: number;
  fontePagadoraId?: number;
  data?: string;
}): Promise<Credenciamento[]> =>
  ler(
    `${CREDENCIAMENTOS}${qs({ profissional: f.profissionalId, convenio: f.fontePagadoraId, data: f.data ?? hojeIso() })}`,
    esquemaListaCredenciamentos,
  );
export const lerOpcoesCredenciamento = (convenioCodigo: number): Promise<OpcoesCredenciamentoConvenio> =>
  ler(`${CONVENIOS}/${convenioCodigo}/opcoes-credenciamento`, esquemaOpcoesCredenciamentoConvenio);
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
) => gravar(`${CONVENIOS}/${convenioCodigo}/opcoes-credenciamento`, opcoes, chave, 'PUT');
