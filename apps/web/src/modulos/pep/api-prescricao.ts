// Cliente das telas da prescrição eletrônica (M24), validado pelos contratos. As gravações vão com o CSRF e a
// Idempotency-Key (uma por intenção de gravar: repetir o pedido não grava duas vezes). Problem Details viram ErroApi;
// o código da recusa (ex.: outra-ativa-no-periodo) fica em `problema.codigo` para a tela mostrar o texto certo.
// Nada da prescrição é guardado no navegador: sem conexão, a tela avisa e não grava (regra offline da ficha).
import {
  type ConsultaCadastroPrescricao,
  esquemaCabecalhoProntuario,
  esquemaConsultaCadastroPrescricao,
  esquemaDetalheItem,
  esquemaFichaAntimicrobiano,
  esquemaFuturaLida,
  esquemaItemBuscado,
  esquemaItemPrescricao,
  esquemaLiberacaoProntuario,
  esquemaPrescricaoGravada,
  esquemaPrescricaoLida,
  esquemaReceitaAlta,
  esquemaPrescricaoResumo,
  esquemaProtocoloResumo,
  esquemaReconciliacaoLida,
  esquemaVerificacao,
  type FichaAntimicrobiano,
  type FuturaLida,
  type ItemBuscado,
  type ItemPrescricao,
  type PrescricaoGravada,
  type PrescricaoLida,
  type ReceitaAlta,
  type PrescricaoResumo,
  type ProtocoloResumo,
  type ReconciliacaoLida,
  type SecaoCadastroPrescricao,
  type Verificacao,
} from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChave } from './api-registro.js';

export { novaChave };

const JSON_ACEITO = { accept: 'application/json' };
const P = '/api/pep/prescricao';

async function lerJson<T>(r: Response, esquema: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}
const ler = async <T>(url: string, esquema: z.ZodType<T>, buscar: typeof fetch = fetch): Promise<T> =>
  lerJson(await buscar(url, { headers: JSON_ACEITO }), esquema);

async function enviar<T>(
  url: string,
  corpo: unknown,
  esquema: z.ZodType<T>,
  chave: string | null,
  buscar: typeof fetch = fetch,
): Promise<T> {
  const r = await buscar(url, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      ...(chave ? { 'idempotency-key': chave } : {}),
    },
    body: JSON.stringify(corpo ?? {}),
  });
  return lerJson(r, esquema);
}

const esquemaOpcao = z.object({ id: z.string(), nome: z.string(), grupo: z.string().nullable().optional() });
export type OpcaoPrescricao = z.infer<typeof esquemaOpcao>;
export const esquemaDominiosPrescricao = z.record(z.string(), z.array(esquemaOpcao));
export type DominiosPrescricao = z.infer<typeof esquemaDominiosPrescricao>;

const esquemaLiberacaoSituacao = esquemaLiberacaoProntuario.extend({
  reconciliacao: esquemaLiberacaoProntuario,
  antimicrobiano: esquemaLiberacaoProntuario,
  gravacao: z.object({ pode: z.boolean(), motivo: z.string().nullable() }),
});
export type LiberacaoPrescricao = z.infer<typeof esquemaLiberacaoSituacao>;

const esquemaPeriodo = z.object({ inicio: z.string(), fim: z.string(), ocupado: z.boolean() });
const esquemaDadosClinicos = z.object({
  pesoKg: z.number().nullable(),
  alturaCm: z.number().nullable(),
  dataPeso: z.string().nullable(),
  idadeAnos: z.number().nullable(),
  sexo: z.enum(['F', 'M']).nullable().default(null),
  creatinina: z.number().nullable(),
  dataCreatinina: z.string().nullable(),
  clearance: z.number().nullable(),
});
export type DadosClinicosTela = z.infer<typeof esquemaDadosClinicos>;
export const esquemaContextoPrescricao = z.object({
  /** Regra 12: o dado mais recente do paciente para o cálculo de dose e os alertas. */
  dadosClinicos: esquemaDadosClinicos.nullable().default(null),
  prescritor: z
    .object({ categoria: z.string(), nome: z.string().nullable(), coassinatura: z.boolean() })
    .nullable(),
  atendimentos: z.array(
    z.object({
      id: z.number().int(),
      numero: z.number().int().nullable(),
      tipo: z.string(),
      unidade: z.string().nullable(),
      leito: z.string().nullable(),
      periodos: z.object({ atual: esquemaPeriodo, seguinte: esquemaPeriodo }).nullable(),
      /** Regra 14: a vigente vence em breve sem a prescrição do período seguinte. */
      renovacaoPendente: z
        .object({ prescricao: z.number().int(), fim: z.string(), antecedenciaHoras: z.number() })
        .nullable()
        .default(null),
    }),
  ),
  agora: z.string(),
  cabecalho: esquemaCabecalhoProntuario,
  liberacao: esquemaLiberacaoProntuario,
  baseInteracoes: z.enum(['contratada', 'nao-contratada']),
  podeCriar: z.boolean(),
  podeSuspender: z.boolean(),
  podeRenovar: z.boolean(),
  podeCoassinar: z.boolean(),
});
export type ContextoPrescricaoTela = z.infer<typeof esquemaContextoPrescricao>;

export function lerLiberacaoPrescricao(buscar: typeof fetch = fetch): Promise<LiberacaoPrescricao> {
  return ler(`${P}/liberacao`, esquemaLiberacaoSituacao, buscar);
}
export function lerDominiosPrescricao(buscar: typeof fetch = fetch): Promise<DominiosPrescricao> {
  return ler(`${P}/dominios`, esquemaDominiosPrescricao, buscar);
}
export function buscarProdutos(termo: string, buscar: typeof fetch = fetch): Promise<ItemBuscado[]> {
  return ler(`${P}/produtos?termo=${encodeURIComponent(termo)}`, z.array(esquemaItemBuscado), buscar);
}
/** Com o paciente, a aplicabilidade pela idade, o peso, o sexo e a especialidade do prescritor. */
export function listarProtocolos(
  paciente: number | null = null,
  buscar: typeof fetch = fetch,
): Promise<ProtocoloResumo[]> {
  return ler(
    `${P}/protocolos${paciente ? `?paciente=${paciente}` : ''}`,
    z.array(esquemaProtocoloResumo),
    buscar,
  );
}
const esquemaItemProtocolo = z.object({
  id: z.number().int(),
  plano: z.number().int(),
  planoNome: z.string().nullable(),
  frequencia: z.number().int().nullable(),
  frequenciaNome: z.string().nullable(),
  via: z.string().nullable(),
  detalhe: z.record(z.string(), z.unknown()),
  /** O item pronto para o editor (null quando o tipo pede revisão manual). */
  sugestao: esquemaDetalheItem.nullable(),
});
export type ItemProtocolo = z.infer<typeof esquemaItemProtocolo>;
export function itensDoProtocolo(id: number, buscar: typeof fetch = fetch): Promise<ItemProtocolo[]> {
  return ler(`${P}/protocolos/${id}/itens`, z.array(esquemaItemProtocolo), buscar);
}
/**
 * Prescrição impressa em PDF/A (serviço de emissão); a reimpressão leva o motivo (2ª via). O PDF abre numa aba nova;
 * nada fica guardado no navegador (a URL do arquivo é revogada em seguida).
 */
export async function imprimirPrescricao(
  paciente: number,
  id: number,
  porque: string | null,
  buscar: typeof fetch = fetch,
): Promise<Blob> {
  // 01-ADM L82: o porquê vai sempre; o servidor decide se é a justificativa da 1ª via ou o motivo da nova via.
  const r = await buscar(`${P}/${paciente}/prescricoes/${id}/imprimir`, {
    method: 'POST',
    headers: { accept: 'application/pdf', 'content-type': 'application/json', 'x-csrf': tokenCsrf() },
    body: JSON.stringify(porque ? { justificativa: porque } : {}),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return r.blob();
}
export function abrirPdf(b: Blob): void {
  const url = URL.createObjectURL(b);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Cadastros de prescrição em consulta (kits, receitas padrão, itens não padronizados, parâmetros do item). */
export function lerCadastroPrescricao(
  secao: SecaoCadastroPrescricao,
  termo: string,
  buscar: typeof fetch = fetch,
): Promise<ConsultaCadastroPrescricao> {
  const q = termo.trim() ? `?termo=${encodeURIComponent(termo.trim().slice(0, 60))}` : '';
  return ler(`${P}/cadastros/${secao}${q}`, esquemaConsultaCadastroPrescricao, buscar);
}
export function lerContexto(paciente: number, buscar: typeof fetch = fetch): Promise<ContextoPrescricaoTela> {
  return ler(`${P}/${paciente}/contexto`, esquemaContextoPrescricao, buscar);
}
export function listarPrescricoes(
  paciente: number,
  atendimento: number,
  buscar: typeof fetch = fetch,
): Promise<PrescricaoResumo[]> {
  return ler(`${P}/${paciente}/atendimentos/${atendimento}`, z.array(esquemaPrescricaoResumo), buscar);
}
export function lerPrescricao(
  paciente: number,
  id: number,
  buscar: typeof fetch = fetch,
): Promise<PrescricaoLida> {
  return ler(`${P}/${paciente}/prescricoes/${id}`, esquemaPrescricaoLida, buscar);
}

/** Regra 15: as receitas da alta propostas dos medicamentos da prescrição (a emissão é a do receituário). */
export function lerReceitaAlta(
  paciente: number,
  id: number,
  buscar: typeof fetch = fetch,
): Promise<ReceitaAlta> {
  return ler(`${P}/${paciente}/prescricoes/${id}/receita-alta`, esquemaReceitaAlta, buscar);
}

export interface PedidoVerificacao {
  readonly atendimento: number;
  readonly periodo: 'atual' | 'seguinte';
  readonly itens: readonly ItemPrescricao[];
}
export function verificar(
  paciente: number,
  p: PedidoVerificacao,
  buscar: typeof fetch = fetch,
): Promise<Verificacao> {
  return enviar(`${P}/${paciente}/verificar`, p, esquemaVerificacao, null, buscar);
}

export interface PedidoPrescrever extends PedidoVerificacao {
  readonly dataHora: string;
  readonly justificativaRetroativo?: string;
  readonly observacaoGeral?: string;
  readonly prioridade: 'rotina' | 'urgente';
  readonly origem?: { prescricao: number; modo: 'copia' | 'renovacao' };
  readonly futuras?: readonly number[];
}
export function prescrever(
  paciente: number,
  p: PedidoPrescrever,
  chave: string,
  buscar: typeof fetch = fetch,
): Promise<PrescricaoGravada> {
  return enviar(`${P}/${paciente}/prescrever`, p, esquemaPrescricaoGravada, chave, buscar);
}
export function incluirItem(
  paciente: number,
  prescricao: number,
  p: { dataHora: string; item: ItemPrescricao },
  chave: string,
  buscar: typeof fetch = fetch,
): Promise<{ item: number }> {
  return enviar(
    `${P}/${paciente}/prescricoes/${prescricao}/itens`,
    p,
    z.object({ item: z.number() }),
    chave,
    buscar,
  );
}
export function suspenderItem(
  paciente: number,
  prescricao: number,
  item: number,
  p: { senha: string; justificativa: string; correcao?: ItemPrescricao },
  chave: string,
  buscar: typeof fetch = fetch,
): Promise<{ horarios: number }> {
  return enviar(
    `${P}/${paciente}/prescricoes/${prescricao}/itens/${item}/suspender`,
    p,
    z.object({ horarios: z.number() }),
    chave,
    buscar,
  );
}
export function suspenderPrescricao(
  paciente: number,
  prescricao: number,
  p: { senha: string; justificativa: string },
  chave: string,
  buscar: typeof fetch = fetch,
): Promise<{ horarios: number }> {
  return enviar(
    `${P}/${paciente}/prescricoes/${prescricao}/suspender`,
    p,
    z.object({ horarios: z.number() }),
    chave,
    buscar,
  );
}
export function coassinar(
  paciente: number,
  prescricao: number,
  senha: string,
  buscar: typeof fetch = fetch,
): Promise<{ ok: boolean }> {
  return enviar(
    `${P}/${paciente}/prescricoes/${prescricao}/coassinar`,
    { senha },
    z.object({ ok: z.boolean() }),
    null,
    buscar,
  );
}

const esquemaFuturas = z.object({
  futuras: z.array(esquemaFuturaLida),
  planejamentosAntigos: z.array(
    z.object({ id: z.number(), inicio: z.string().nullable(), fim: z.string().nullable() }),
  ),
});
export type FuturasLidas = z.infer<typeof esquemaFuturas>;
export function lerFuturas(
  paciente: number,
  atendimento: number,
  buscar: typeof fetch = fetch,
): Promise<FuturasLidas> {
  return ler(`${P}/${paciente}/futuras?atendimento=${atendimento}`, esquemaFuturas, buscar);
}
export function programarFutura(
  paciente: number,
  p: { atendimento: number; aPartirDe: string; item: ItemPrescricao; motivo?: string },
  buscar: typeof fetch = fetch,
): Promise<{ id: number }> {
  return enviar(`${P}/${paciente}/futuras`, p, z.object({ id: z.number() }), null, buscar);
}
export function cancelarFutura(
  paciente: number,
  id: number,
  motivo: string,
  buscar: typeof fetch = fetch,
): Promise<{ ok: boolean }> {
  return enviar(
    `${P}/${paciente}/futuras/${id}/cancelar`,
    { motivo },
    z.object({ ok: z.boolean() }),
    null,
    buscar,
  );
}
export type { FuturaLida };

export function lerReconciliacoes(
  paciente: number,
  atendimento: number,
  buscar: typeof fetch = fetch,
): Promise<ReconciliacaoLida[]> {
  return ler(
    `${P}/${paciente}/reconciliacao?atendimento=${atendimento}`,
    z.array(esquemaReconciliacaoLida),
    buscar,
  );
}
export function registrarReconciliacao(
  paciente: number,
  p: {
    atendimento: number;
    momento: ReconciliacaoLida['momento'];
    medicamentos: ReconciliacaoLida['medicamentos'];
  },
  buscar: typeof fetch = fetch,
): Promise<{ lote: number }> {
  return enviar(`${P}/${paciente}/reconciliacao`, p, z.object({ lote: z.number() }), null, buscar);
}

const esquemaARenovar = z.array(
  z.object({
    prescricao: z.number(),
    atendimento: z.number(),
    fim: z.string(),
    paciente: z.number(),
    nome: z.string(),
    unidade: z.number().nullable(),
    unidadeNome: z.string().nullable(),
    leito: z.string().nullable(),
  }),
);
/** As que vencem nas próximas horas (sem a do período seguinte), por unidade (null: todas). */
export function aRenovar(horas: number, unidade: number | null = null, buscar: typeof fetch = fetch) {
  return ler(
    `${P}/a-renovar?horas=${horas}${unidade !== null ? `&unidade=${unidade}` : ''}`,
    esquemaARenovar,
    buscar,
  );
}

// ── Farmácia clínica ─────────────────────────────────────────────────────────────────────────────────

const esquemaRegra = z.object({
  codigo: z.string(),
  tipo: z.string(),
  nivel: z.enum(['aviso', 'justificar', 'bloqueio']),
  versao: z.number(),
  vigenteDesde: z.string(),
  ativa: z.boolean(),
  descricao: z.string(),
  autor: z.string().optional(),
  criadaEm: z.string().nullable().optional(),
});
export type RegraAlertaTela = z.infer<typeof esquemaRegra>;
const esquemaRegras = z.object({
  padrao: z.array(esquemaRegra),
  versoes: z.array(esquemaRegra),
  baseInteracoes: z.enum(['contratada', 'nao-contratada']),
});
export type RegrasAlertaTela = z.infer<typeof esquemaRegras>;
export function lerRegras(buscar: typeof fetch = fetch): Promise<RegrasAlertaTela> {
  return ler('/api/farmacia-clinica/regras', esquemaRegras, buscar);
}
export function gravarRegra(
  r: Omit<RegraAlertaTela, 'versao' | 'autor' | 'criadaEm'> & { senha: string; justificativa: string },
  buscar: typeof fetch = fetch,
): Promise<{ id: number; versao: number }> {
  return enviar(
    '/api/farmacia-clinica/regras',
    r,
    z.object({ id: z.number(), versao: z.number() }),
    null,
    buscar,
  );
}
export function simular(
  p: { itens: readonly ItemPrescricao[]; alergiasPrincipios: readonly number[] },
  buscar: typeof fetch = fetch,
): Promise<{ alertas: Verificacao['alertas']; impede: boolean }> {
  return enviar(
    '/api/farmacia-clinica/simular',
    p,
    z.object({ alertas: esquemaVerificacao.shape.alertas, impede: z.boolean() }),
    null,
    buscar,
  );
}
export function listarFichas(
  paciente: number | null,
  buscar: typeof fetch = fetch,
): Promise<FichaAntimicrobiano[]> {
  return ler(
    `/api/farmacia-clinica/antimicrobianos${paciente ? `?paciente=${paciente}` : ''}`,
    z.array(esquemaFichaAntimicrobiano),
    buscar,
  );
}
export function registrarFicha(
  f: {
    paciente: number;
    atendimento: number;
    produto: number;
    indicacao: string;
    sitio: string;
    tipo: 'empirico' | 'dirigido' | 'profilatico';
    culturaColhida: boolean;
    diaTratamento: number;
  },
  buscar: typeof fetch = fetch,
): Promise<{ id: number }> {
  return enviar('/api/farmacia-clinica/antimicrobianos', f, z.object({ id: z.number() }), null, buscar);
}

// ── Enfermagem: horários-padrão ──────────────────────────────────────────────────────────────────────

const esquemaHorarios = z.object({
  regras: z.array(
    z.object({
      id: z.number(),
      tipoAtendimento: z.string(),
      horarioInicial: z.string().nullable(),
      considerar: z.number().nullable(),
      padrao: z.boolean(),
      grade: z.array(z.object({ doses: z.number(), horas: z.array(z.string()) })),
    }),
  ),
  blocos: z.array(z.object({ bloco: z.string(), regra: z.number() })),
  unidades: z.array(z.object({ unidade: z.number(), regra: z.number() })),
  porClasse: z.array(
    z.object({
      id: z.number(),
      unidade: z.number(),
      classe: z.string(),
      numDoses: z.number(),
      horarios: z.array(z.string()),
      vigenteDesde: z.string(),
      ativa: z.boolean(),
      autor: z.string(),
    }),
  ),
});
export type HorariosPadrao = z.infer<typeof esquemaHorarios>;
export function lerHorariosPadrao(buscar: typeof fetch = fetch): Promise<HorariosPadrao> {
  return ler('/api/enfermagem/horarios-padrao', esquemaHorarios, buscar);
}
export function gravarGradeClasse(
  g: {
    unidade: number;
    classe: string;
    numDoses: number;
    horarios: string[];
    vigenteDesde: string;
    ativa: boolean;
  },
  buscar: typeof fetch = fetch,
): Promise<{ id: number }> {
  return enviar('/api/enfermagem/horarios-padrao/classe', g, z.object({ id: z.number() }), null, buscar);
}

/** O item da tela confere com o contrato antes de ir ao servidor (a mesma validação do servidor). */
export function itemValido(i: unknown): i is ItemPrescricao {
  return esquemaItemPrescricao.safeParse(i).success;
}
