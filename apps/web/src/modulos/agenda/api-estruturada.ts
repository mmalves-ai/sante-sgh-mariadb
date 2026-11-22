// ADR 0009: cliente das telas da agenda estruturada (preço particular, cobertura por convênio e subplano,
// restrições e preparo, com o texto original ao lado), do credenciamento profissional × convênio e da origem do
// preço no lançamento do atendimento. Lê e grava pelos contratos de @sgh/contratos; as gravações vão com o CSRF e a
// Idempotency-Key (a mesma regra de api-agenda.ts). Não existe preço por médico em convênio (decisão 24): a regra
// editada aqui é sempre do PARTICULAR.
import {
  type AgendaEstruturada,
  type Credenciamento,
  type EntradaCoberturaAgenda,
  type EntradaCredenciamento,
  type EntradaPreparoAgenda,
  type EntradaRegraPrecoParticular,
  type EntradaRestricaoAgenda,
  esquemaAgendaEstruturada,
  esquemaCredenciamento,
  esquemaEntradaCoberturaAgenda,
  esquemaEntradaCredenciamento,
  esquemaEntradaPreparoAgenda,
  esquemaEntradaRestricaoAgenda,
  esquemaEntradaRegraPrecoParticular,
  esquemaOpcoesCredenciamentoConvenio,
  esquemaResultadoAgenda,
  esquemaResultadoCalculoPreco,
  esquemaVerificacaoCredenciamento,
  type OpcoesCredenciamentoConvenio,
  type ResultadoAgenda,
  type ResultadoCalculoPreco,
  SITUACOES_REVISAO_REGRA,
  type VerificacaoCredenciamento,
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
  // vazia: criar convênio (POST /api/convenios) foi publicado na volta 2
];

/** Tipos de fonte pagadora (o CHECK de fonte_pagadora.tipo). */
export const TIPOS_FONTE_PAGADORA = [
  'operadora',
  'seguradora',
  'autogestao',
  'cooperativa',
  'medicina_grupo',
  'filantropia',
  'particular',
  'publico',
  'empresa',
  'convenio_proprio',
  'outro',
] as const;

/**
 * Criação de convênio pela tela (o esquemaConvenioNovo do agenda-preco.servico.ts, estrito): a API grava a fonte
 * pagadora e, com credenciaTodosAoCriar, credencia os profissionais ativos desde dataInicioRelacao (decisão 26).
 */
export const esquemaEntradaNovoConvenio = z
  .object({
    codigo: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._-]{1,30}$/),
    nome: z.string().trim().min(2).max(150),
    tipo: z.enum(TIPOS_FONTE_PAGADORA),
    registroAns: z
      .string()
      .trim()
      .regex(/^\d{1,10}$/)
      .nullable(),
    bloqueiaSemCredenciamento: z.boolean(),
    credenciaTodosAoCriar: z.boolean(),
    dataInicioRelacao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((e) => e.tipo !== 'particular' || (!e.bloqueiaSemCredenciamento && !e.credenciaTodosAoCriar), {
    message: 'O particular não tem credenciamento.',
    path: ['credenciaTodosAoCriar'],
  });
export type EntradaNovoConvenio = z.infer<typeof esquemaEntradaNovoConvenio>;

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
/** Credenciamento do profissional no convênio (e plano) na data: nenhum, alerta ou bloqueio (decisão 25). */
export const verificarCredenciamento = (f: {
  profissionalId: number;
  fontePagadoraId: number;
  planoId?: number | null;
  data?: string;
}): Promise<VerificacaoCredenciamento> =>
  ler(
    `${CREDENCIAMENTOS}/verificacao${qs({
      profissional: f.profissionalId,
      convenio: f.fontePagadoraId,
      plano: f.planoId ?? null,
      data: f.data ?? hojeIso(),
    })}`,
    esquemaVerificacaoCredenciamento,
  );
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
/** Regras da agenda (a regra manual entra confirmada; o texto de origem é opcional). O id da agenda vai na URL. */
const semAgenda = <T extends { agendaId: number }>(e: T): Omit<T, 'agendaId'> => {
  const resto: Partial<T> = { ...e };
  delete resto.agendaId;
  return resto as Omit<T, 'agendaId'>;
};
export const incluirCobertura = (entrada: EntradaCoberturaAgenda, chave: string) => {
  const e = esquemaEntradaCoberturaAgenda.parse(entrada);
  return gravar(`${AGENDAS}/${e.agendaId}/coberturas`, semAgenda(e), chave);
};
export const incluirRestricao = (entrada: EntradaRestricaoAgenda, chave: string) => {
  const e = esquemaEntradaRestricaoAgenda.parse(entrada);
  return gravar(`${AGENDAS}/${e.agendaId}/restricoes`, semAgenda(e), chave);
};
export const incluirPreparo = (entrada: EntradaPreparoAgenda, chave: string) => {
  const e = esquemaEntradaPreparoAgenda.parse(entrada);
  return gravar(`${AGENDAS}/${e.agendaId}/preparos`, semAgenda(e), chave);
};
/** Criar convênio (decisão 26). A resposta traz { id, credenciados }. */
export const criarConvenio = (entrada: EntradaNovoConvenio, chave: string) =>
  gravar(CONVENIOS, esquemaEntradaNovoConvenio.parse(entrada), chave);
