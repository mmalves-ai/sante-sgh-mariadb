// Regras de tela da etapa 2 do M48 (puras, testadas em regras-seguranca.spec.ts): montar as entradas da análise, da
// ação 5W2H, do registro de vigilância de produto e do andamento a partir dos formulários (com o texto da falta, antes
// de ir ao servidor, que confere de novo), o formulário da notificação a partir de uma sugestão e o texto de um
// indicador do painel sempre com as parcelas (numerador e denominador impressos; regra 5 da ficha).
import {
  type Acao5w2h,
  type AcaoPlanoLida,
  type AnaliseLida,
  type AreaVigilanciaProduto,
  type CategoriaIshikawa,
  type CondutaProduto,
  type ConteudoAnalise,
  esquema5w2h,
  esquemaRegistrarAnalise,
  esquemaRegistrarQueixaTecnica,
  type FatorContribuinte,
  type IndicadorPainel,
  type MetodoAnalise,
  type RegistrarAnaliseEntrada,
  type RegistrarQueixaTecnicaEntrada,
  SITUACOES_VIGILANCIA_PRODUTO,
  type SituacaoVigilanciaProduto,
  type SugestaoNotificacao,
  type TipoIncidente,
  TIPOS_VIGILANCIA_PRODUTO,
  type TipoVigilanciaProduto,
} from '@sgh/contratos';
import { mensagensSeguranca as M } from './i18n-seguranca.js';

export type Montagem<T> = { ok: true; entrada: T } | { ok: false; campo: string; mensagem: string };

// ── Análise ──────────────────────────────────────────────────────────────────────────────────────────

export interface FormularioAnalise {
  metodo: MetodoAnalise;
  porques: string[];
  causas: { categoria: CategoriaIshikawa; texto: string }[];
  cronologia: string;
  problemas: { descricao: string; fatores: FatorContribuinte[] }[];
  causaRaiz: string;
  fatores: FatorContribuinte[];
  licoes: string;
  semAcaoJustificativa: string;
  concluir: boolean;
}

/** O formulário a partir da análise gravada (ou vazio, com os 5 porquês e uma linha de cada método). */
export function formularioDaAnalise(a: AnaliseLida | null): FormularioAnalise {
  const f: FormularioAnalise = {
    metodo: a?.metodo ?? 'cincoPorques',
    porques: ['', ''],
    causas: [{ categoria: 'metodo', texto: '' }],
    cronologia: '',
    problemas: [{ descricao: '', fatores: [] }],
    causaRaiz: a?.causaRaiz ?? '',
    fatores: [...(a?.fatores ?? [])],
    licoes: a?.licoes ?? '',
    semAcaoJustificativa: a?.semAcaoJustificativa ?? '',
    concluir: false,
  };
  const c = a?.conteudo;
  if (c?.metodo === 'cincoPorques') f.porques = [...c.porques];
  if (c?.metodo === 'ishikawa') f.causas = c.causas.map((x) => ({ ...x }));
  if (c?.metodo === 'londres') {
    f.cronologia = c.cronologia;
    f.problemas = c.problemas.map((p) => ({ descricao: p.descricao, fatores: [...p.fatores] }));
  }
  return f;
}

const preenchido = (s: string) => s.trim().length > 0;
const ouNulo = (s: string) => (s.trim() ? s.trim() : null);

function conteudoDe(f: FormularioAnalise): ConteudoAnalise {
  if (f.metodo === 'ishikawa')
    return {
      metodo: 'ishikawa',
      causas: f.causas.filter((c) => preenchido(c.texto)).map((c) => ({ ...c, texto: c.texto.trim() })),
    };
  if (f.metodo === 'londres')
    return {
      metodo: 'londres',
      cronologia: f.cronologia.trim(),
      problemas: f.problemas
        .filter((p) => preenchido(p.descricao) || p.fatores.length > 0)
        .map((p) => ({ descricao: p.descricao.trim(), fatores: [...p.fatores] })),
    };
  return { metodo: 'cincoPorques', porques: f.porques.filter(preenchido).map((p) => p.trim()) };
}

export function montarAnalise(
  f: FormularioAnalise,
  notificacao: number,
  versao: number,
): Montagem<RegistrarAnaliseEntrada> {
  const r = esquemaRegistrarAnalise.safeParse({
    notificacao,
    versao,
    conteudo: conteudoDe(f),
    causaRaiz: ouNulo(f.causaRaiz),
    fatores: [...f.fatores],
    licoes: ouNulo(f.licoes),
    concluir: f.concluir,
    semAcaoJustificativa: ouNulo(f.semAcaoJustificativa),
  });
  if (r.success) return { ok: true, entrada: r.data };
  const p = r.error.issues[0]?.path ?? [];
  const campo = String(p[0] ?? 'conteudo');
  if (campo === 'conteudo')
    return {
      ok: false,
      campo,
      mensagem: p[1] === 'cronologia' ? M.analise.falta.cronologia : M.analise.falta.conteudo,
    };
  const mensagens: Readonly<Record<string, string>> = M.analise.falta;
  return { ok: false, campo, mensagem: mensagens[campo] ?? M.analise.falta.geral };
}

// ── Ação 5W2H ────────────────────────────────────────────────────────────────────────────────────────

export interface FormularioAcao {
  oQue: string;
  porQue: string;
  onde: string;
  quando: string | null;
  quem: string;
  como: string;
  quanto: string;
}

export function formularioDaAcao(a?: AcaoPlanoLida | null): FormularioAcao {
  return {
    oQue: a?.oQue ?? '',
    porQue: a?.porQue ?? '',
    onde: a?.onde ?? '',
    quando: a?.quando ?? null,
    quem: a?.quem ?? '',
    como: a?.como ?? '',
    quanto: a?.quanto ?? '',
  };
}

export function montarAcao(f: FormularioAcao): Montagem<Acao5w2h> {
  const r = esquema5w2h.safeParse({
    oQue: f.oQue,
    porQue: f.porQue,
    onde: f.onde,
    quando: f.quando ?? '',
    quem: f.quem,
    como: f.como,
    quanto: ouNulo(f.quanto),
  });
  if (r.success) return { ok: true, entrada: r.data };
  const campo = String(r.error.issues[0]?.path[0] ?? 'oQue');
  const mensagens: Readonly<Record<string, string>> = M.plano.falta;
  return { ok: false, campo, mensagem: mensagens[campo] ?? M.plano.falta.geral };
}

// ── Vigilância de produto ────────────────────────────────────────────────────────────────────────────

export interface FormularioQueixa {
  area: AreaVigilanciaProduto;
  tipo: TipoVigilanciaProduto | '';
  item: number | null;
  produto: string;
  lote: string;
  serie: string;
  fabricante: string;
  registroAnvisa: string;
  descricao: string;
  alerta: string;
  conduta: CondutaProduto;
}

export const formularioQueixaVazio = (): FormularioQueixa => ({
  area: 'tecnovigilancia',
  tipo: '',
  item: null,
  produto: '',
  lote: '',
  serie: '',
  fabricante: '',
  registroAnvisa: '',
  descricao: '',
  alerta: '',
  conduta: 'nenhuma',
});

/** Os tipos que cabem na área (reação adversa e inefetividade só em medicamento; evento adverso só em produto). */
export const tiposDaArea = (area: AreaVigilanciaProduto) =>
  TIPOS_VIGILANCIA_PRODUTO.filter((t) => (t.areas as readonly string[]).includes(area));

type Abrir = Extract<RegistrarQueixaTecnicaEntrada, { acao: 'abrir' }>;
type Andamento = Extract<RegistrarQueixaTecnicaEntrada, { acao: 'andamento' }>;

export function montarQueixa(f: FormularioQueixa, notificacao: number | null): Montagem<Abrir> {
  if (!f.tipo || !tiposDaArea(f.area).some((t) => t.codigo === f.tipo))
    return { ok: false, campo: 'tipo', mensagem: M.vigilancia.falta.tipo };
  const r = esquemaRegistrarQueixaTecnica.safeParse({
    acao: 'abrir',
    area: f.area,
    tipo: f.tipo,
    item: f.item,
    produto: f.item === null ? ouNulo(f.produto) : null,
    lote: ouNulo(f.lote),
    serie: ouNulo(f.serie),
    fabricante: ouNulo(f.fabricante),
    registroAnvisa: ouNulo(f.registroAnvisa),
    descricao: f.descricao,
    notificacao,
    alerta: f.tipo === 'alertaSanitario' ? ouNulo(f.alerta) : null,
    conduta: f.conduta,
  });
  if (r.success && r.data.acao === 'abrir') return { ok: true, entrada: r.data };
  const campo = r.success ? 'geral' : String(r.error.issues[0]?.path[0] ?? 'geral');
  const mensagens: Readonly<Record<string, string>> = M.vigilancia.falta;
  return { ok: false, campo, mensagem: mensagens[campo] ?? M.vigilancia.falta.geral };
}

export function montarAndamento(
  f: { situacao: SituacaoVigilanciaProduto; conduta: CondutaProduto; notivisaNumero: string; texto: string },
  id: number,
  versao: number,
): Montagem<Andamento> {
  const r = esquemaRegistrarQueixaTecnica.safeParse({
    acao: 'andamento',
    id,
    versao,
    situacao: f.situacao,
    conduta: f.conduta,
    notivisaNumero: ouNulo(f.notivisaNumero),
    texto: f.texto,
  });
  if (r.success && r.data.acao === 'andamento') return { ok: true, entrada: r.data };
  const campo = r.success ? 'geral' : String(r.error.issues[0]?.path[0] ?? 'geral');
  const mensagens: Readonly<Record<string, string>> = M.vigilancia.falta;
  return { ok: false, campo, mensagem: mensagens[campo] ?? M.vigilancia.falta.geral };
}

/** As situações para onde o registro pode andar (a atual e as seguintes; a situação só anda para a frente). */
export function situacoesSeguintes(atual: SituacaoVigilanciaProduto) {
  const i = SITUACOES_VIGILANCIA_PRODUTO.findIndex((s) => s.codigo === atual);
  return SITUACOES_VIGILANCIA_PRODUTO.slice(Math.max(0, i));
}

// ── Sugestão automática ──────────────────────────────────────────────────────────────────────────────

/** O que a sugestão preenche no formulário "Notificar incidente" (o usuário confere e completa). */
export function formularioDaSugestao(s: SugestaoNotificacao): {
  tipo: TipoIncidente;
  chegouAoPaciente: 'sim' | 'nao';
  descricao: string;
  data: string;
  hora: string;
} {
  return {
    tipo: s.tipo,
    chegouAoPaciente: s.chegouAoPaciente ? 'sim' : 'nao',
    descricao: s.descricao,
    data: s.quando.slice(0, 10),
    hora: s.quando.slice(11, 16),
  };
}

// ── Painel ───────────────────────────────────────────────────────────────────────────────────────────

const pct = (v: number) =>
  `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/** "12 de 40 (30,0%)"; sem denominador, "0 de 0 (sem dado no período)": as parcelas sempre impressas. */
export function textoDoIndicador(
  i: Pick<IndicadorPainel, 'numerador' | 'denominador' | 'percentual'>,
): string {
  const parcelas = `${String(i.numerador)} de ${String(i.denominador)}`;
  return i.percentual === null ? `${parcelas} (${M.painel.semDado})` : `${parcelas} (${pct(i.percentual)})`;
}

export function textoDaMeta(i: Pick<IndicadorPainel, 'meta'>): string {
  return i.meta === null ? M.painel.semMeta : pct(i.meta);
}

/** A comparação com a meta (todos os indicadores do painel são "quanto maior, melhor"); null sem meta ou sem dado. */
export function comparacaoComMeta(
  i: Pick<IndicadorPainel, 'percentual' | 'meta'>,
): 'atingida' | 'abaixo' | null {
  if (i.meta === null || i.percentual === null) return null;
  return i.percentual >= i.meta ? 'atingida' : 'abaixo';
}

/** A data local AAAA-MM-DD em DD/MM/AAAA. */
export function dataCurta(d: string | null | undefined): string {
  if (!d) return '-';
  const [a, m, dia] = d.slice(0, 10).split('-');
  return `${dia ?? ''}/${m ?? ''}/${a ?? ''}`;
}
