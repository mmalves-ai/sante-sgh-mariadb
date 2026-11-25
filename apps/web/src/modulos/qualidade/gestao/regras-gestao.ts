// Regras de tela da gestão da qualidade e dos envios regulatórios (M48, etapa 5; regras 9 e 10): a entrada de cada
// gravação montada e conferida pelos mesmos esquemas da API (o servidor decide; a tela só evita a ida e volta), as
// prévias que a tela mostra antes de gravar (pontuação GUT, conformidade do checklist, quórum) com as parcelas, e o
// que cada situação permite. Funções puras, testadas em regras-gestao.spec.ts.
import {
  type EficaciaControleRisco,
  type EncaminharManifestacaoEntrada,
  esquemaEncaminharManifestacao,
  esquemaPublicarDocumento,
  esquemaRegistrarAnaliseIndicador,
  esquemaRegistrarAuditoria,
  esquemaRegistrarComissao,
  esquemaRegistrarManifestacao,
  esquemaRegistrarNaoConformidade,
  esquemaRegistrarReuniaoComissao,
  esquemaRegistrarRisco,
  esquemaRegistrarTransmissaoEnvio,
  esquemaResponderManifestacao,
  esquemaRetirarDocumento,
  type ItemChecklistAuditoria,
  type PublicarDocumentoEntrada,
  type RegistrarAnaliseIndicadorEntrada,
  type RegistrarAuditoriaEntrada,
  type RegistrarComissaoEntrada,
  type RegistrarManifestacaoEntrada,
  type RegistrarNaoConformidadeEntrada,
  type RegistrarReuniaoComissaoEntrada,
  type RegistrarRiscoEntrada,
  type RegistrarTransmissaoEnvioEntrada,
  type ResponderManifestacaoEntrada,
  type RetirarDocumentoEntrada,
  type SituacaoRisco,
  type TipoControleRisco,
} from '@sgh/contratos';
import {
  competenciaAnterior,
  contaGut,
  eficaciaDosControles,
  MENSAGENS_RECUSA_GESTAO,
  numeroBr,
  pontuacaoGut,
  prioridadeGut,
  recusaControlesRisco,
  resultadoChecklist,
  temQuorum,
} from '@sgh/dominio-qualidade';
import type { z } from 'zod';
import { instanteDosCampos } from '../regras-qualidade.js';
import type {
  ComissaoTela,
  DocumentoTela,
  EnvioTela,
  IndicadorTela,
  ManifestacaoTela,
  NaoConformidadeTela,
  RiscoTela,
} from './api-gestao.js';

export type Montagem<T> =
  | { readonly ok: true; readonly entrada: T }
  | { readonly ok: false; readonly erros: Readonly<Record<string, string>> };

function conferir<S extends z.ZodTypeAny>(
  esquema: S,
  bruto: unknown,
  extras: Record<string, string> = {},
): Montagem<z.infer<S>> {
  const erros: Record<string, string> = { ...extras };
  const r = esquema.safeParse(bruto);
  if (!r.success)
    for (const i of r.error.issues) {
      const campo = String(i.path[0] ?? 'geral');
      erros[campo] ??= i.message;
    }
  return Object.keys(erros).length || !r.success
    ? { ok: false, erros }
    : { ok: true, entrada: r.data as z.infer<S> };
}
/** Tira o identificador que vai no endereço da rota (o esquema o pede só para a conferência). */
function sem<T extends object, K extends keyof T>(e: T, chave: K): Omit<T, K> {
  const r: Partial<T> = { ...e };
  delete r[chave];
  return r as Omit<T, K>;
}
const vazio = (x: string | null | undefined) => (x ?? '').trim() === '';
const ouNulo = (x: string | null | undefined) => (vazio(x) ? null : (x as string).trim());

// ── Competências ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A competência e as 11 anteriores (a mais recente primeiro), a partir de "AAAA-MM". */
export function competenciasRecentes(atual: string, quantas = 12): string[] {
  const r = [atual];
  while (r.length < quantas) r.push(competenciaAnterior(r.at(-1) as string));
  return r;
}
/** "2026-09" → "09/2026". */
export const competenciaBr = (c: string): string => `${c.slice(5, 7)}/${c.slice(0, 4)}`;
/** "2026-10-27" ou "2026-10-27T10:00" → "27/10/2026". */
export const dataBr = (d: string | null | undefined): string =>
  d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '';

// ── Documentos ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface FormularioDocumento {
  readonly codigo: string;
  readonly tipo: string;
  readonly titulo: string;
  readonly area: string;
  readonly conteudo: string;
  readonly resumoAlteracao: string;
  readonly elaboradoPor: string;
  readonly revisadoPor: string;
  readonly vigenciaAte: string | null;
  readonly exigeCiencia: boolean;
}

/** O formulário da nova revisão começa com a vigente (código, tipo e área fixos; o conteúdo para editar). */
export function formularioDaRevisao(d: DocumentoTela & { conteudo: string }): FormularioDocumento {
  return {
    codigo: d.codigo,
    tipo: d.tipo,
    titulo: d.titulo,
    area: d.area,
    conteudo: d.conteudo,
    resumoAlteracao: '',
    elaboradoPor: '',
    revisadoPor: '',
    vigenciaAte: null,
    exigeCiencia: d.exigeCiencia,
  };
}

/**
 * A publicação (quem publica é o aprovador da sessão). A nova revisão leva a vigente com a versão lida e exige o
 * resumo da alteração; o elaborador é outra pessoa (o servidor confere com o login da sessão).
 */
export function montarPublicacao(
  f: FormularioDocumento,
  substitui: { id: number; versao: number } | null,
): Montagem<PublicarDocumentoEntrada> {
  const extras: Record<string, string> = {};
  if (vazio(f.tipo)) extras.tipo = 'Escolha o tipo do documento.';
  if (substitui && vazio(f.resumoAlteracao)) extras.resumoAlteracao = 'Descreva o que mudou nesta revisão.';
  if (!f.vigenciaAte) extras.vigenciaAte = 'Informe a data da próxima revisão.';
  return conferir(
    esquemaPublicarDocumento,
    {
      codigo: f.codigo,
      tipo: f.tipo,
      titulo: f.titulo,
      area: f.area,
      conteudo: f.conteudo,
      resumoAlteracao: ouNulo(f.resumoAlteracao),
      elaboradoPor: f.elaboradoPor,
      revisadoPor: ouNulo(f.revisadoPor),
      vigenciaAte: f.vigenciaAte ?? '',
      exigeCiencia: f.exigeCiencia,
      substitui,
    },
    extras,
  );
}

export function montarRetirada(
  d: Pick<DocumentoTela, 'id' | 'versao'>,
  motivo: string,
): Montagem<Omit<RetirarDocumentoEntrada, 'documento'>> {
  const m = conferir(esquemaRetirarDocumento, { documento: d.id, versao: d.versao, motivo });
  return m.ok ? { ok: true, entrada: sem(m.entrada, 'documento') } : m;
}

/** O que o documento permite: ciência (vigente que exige e o usuário ainda não deu), revisar e retirar (vigente). */
export function acoesDoDocumento(
  d: Pick<DocumentoTela, 'situacao' | 'exigeCiencia' | 'cienteSessao'>,
  podePublicar: boolean,
  ligada: boolean,
): { ciencia: boolean; revisar: boolean; retirar: boolean } {
  const vigente = d.situacao === 'vigente' && ligada;
  return {
    ciencia: vigente && d.exigeCiencia && !d.cienteSessao,
    revisar: vigente && podePublicar,
    retirar: vigente && podePublicar,
  };
}

// ── Indicadores ──────────────────────────────────────────────────────────────────────────────────────────────────

/** O valor no formato da unidade da ficha ("12,5%", "4,2 dias", "2,4 por mil"). */
export function valorDoIndicador(v: number | null, unidade: IndicadorTela['ficha']['unidade']): string {
  if (v === null) return '—';
  if (unidade === 'percentual') return `${numeroBr(v)}%`;
  if (unidade === 'dias') return `${numeroBr(v)} dias`;
  if (unidade === 'densidade') return `${numeroBr(v)} por mil`;
  if (unidade === 'quantidade') return numeroBr(v, 0);
  if (unidade === 'minutos') return `${numeroBr(v)} min`;
  return numeroBr(v);
}

/** A classe visual da situação da meta (a cor nunca sozinha: o texto acompanha). */
export function classeDaMeta(s: IndicadorTela['situacaoMeta']): string {
  return {
    'na-meta': 'prazo prazo--cumprido',
    'fora-da-meta': 'prazo prazo--vencido',
    'sem-meta': 'selo selo--neutro',
    'sem-valor': 'selo selo--neutro',
  }[s];
}

export interface FormularioAnalise {
  readonly texto: string;
  readonly causas: string;
  readonly plano: string;
  readonly responsavel: string;
  readonly prazo: string | null;
}

/** A análise crítica: fora da meta, as causas, o plano, o responsável e o prazo são obrigatórios (regra 9). */
export function montarAnalise(
  i: Pick<IndicadorTela, 'competencia' | 'situacaoMeta' | 'analise'>,
  f: FormularioAnalise,
): Montagem<Omit<RegistrarAnaliseIndicadorEntrada, 'indicador'>> {
  const extras: Record<string, string> = {};
  if (i.situacaoMeta === 'fora-da-meta') {
    if (vazio(f.causas)) extras.causas = 'Fora da meta: descreva as causas.';
    if (vazio(f.plano)) extras.plano = 'Fora da meta: descreva o plano de ação.';
    if (vazio(f.responsavel)) extras.responsavel = 'Fora da meta: informe o responsável pelo plano.';
    if (!f.prazo) extras.prazo = 'Fora da meta: informe o prazo do plano.';
  }
  const m = conferir(
    esquemaRegistrarAnaliseIndicador,
    {
      analise: i.analise?.id ?? null,
      versao: i.analise?.versao ?? null,
      indicador: 'conferencia',
      competencia: i.competencia,
      texto: f.texto,
      causas: ouNulo(f.causas),
      plano: ouNulo(f.plano),
      responsavel: ouNulo(f.responsavel),
      prazo: f.prazo || null,
    },
    extras,
  );
  return m.ok ? { ok: true, entrada: sem(m.entrada, 'indicador') } : m;
}

// ── Auditorias ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface ItemChecklistForm {
  secao: string;
  requisito: string;
  resultado: string;
  evidencia: string;
}

export const itemVazio = (secao = ''): ItemChecklistForm => ({
  secao,
  requisito: '',
  resultado: '',
  evidencia: '',
});

/** O checklist de uma auditoria anterior como modelo: os mesmos requisitos e seções, sem resultado (DP-47.9). */
export function checklistDoModelo(itens: readonly ItemChecklistAuditoria[]): ItemChecklistForm[] {
  return itens.map((i) => ({ secao: i.secao ?? '', requisito: i.requisito, resultado: '', evidencia: '' }));
}

/** A conformidade parcial enquanto a auditoria é preenchida (a mesma conta do servidor, com as parcelas). */
export function previaChecklist(itens: readonly ItemChecklistForm[]) {
  return resultadoChecklist(
    itens
      .filter((i) => !vazio(i.resultado))
      .map((i) => ({ resultado: i.resultado as ItemChecklistAuditoria['resultado'] })),
  );
}

export interface FormularioAuditoria {
  readonly titulo: string;
  readonly area: string;
  readonly referencial: string;
  readonly realizadaEm: string | null;
  readonly auditores: string;
  readonly conclusao: string;
  readonly itens: readonly ItemChecklistForm[];
}

/** A auditoria: todo item respondido; o não conforme e o parcial com a evidência (o achado). */
export function montarAuditoria(f: FormularioAuditoria): Montagem<RegistrarAuditoriaEntrada> {
  const extras: Record<string, string> = {};
  if (vazio(f.referencial)) extras.referencial = 'Escolha o referencial da auditoria.';
  const itens = f.itens.filter((i) => !vazio(i.requisito));
  if (!itens.length) extras.itens = 'Inclua ao menos um requisito no checklist.';
  itens.forEach((i, k) => {
    if (vazio(i.resultado)) extras[`item${k + 1}`] = `Requisito ${k + 1}: escolha o resultado.`;
    else if ((i.resultado === 'naoConforme' || i.resultado === 'parcial') && vazio(i.evidencia))
      extras[`item${k + 1}`] = `Requisito ${k + 1}: descreva a evidência do achado.`;
  });
  return conferir(
    esquemaRegistrarAuditoria,
    {
      titulo: f.titulo,
      area: f.area,
      referencial: f.referencial,
      realizadaEm: f.realizadaEm ?? '',
      auditores: f.auditores,
      conclusao: f.conclusao,
      itens: itens.map((i) => ({
        requisito: i.requisito,
        secao: ouNulo(i.secao),
        resultado: i.resultado,
        evidencia: ouNulo(i.evidencia),
      })),
    },
    extras,
  );
}

// ── Comissões ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface MembroForm {
  nome: string;
  funcao: string;
  login: string;
}
export interface FormularioComissao {
  readonly tipo: string;
  readonly nome: string;
  readonly periodicidade: string;
  readonly ativa: boolean;
  readonly membros: readonly MembroForm[];
  /** Revisão do W0-04: a justificativa da alteração (obrigatória ao alterar; a composição anterior vai às versões). */
  readonly justificativa?: string;
}

export function formularioDaComissao(c: ComissaoTela | null): FormularioComissao {
  return c
    ? {
        tipo: c.tipo,
        nome: c.nome,
        periodicidade: c.periodicidade,
        ativa: c.ativa,
        membros: c.membros.map((m) => ({ nome: m.nome, funcao: m.funcao, login: m.login ?? '' })),
        justificativa: '',
      }
    : { tipo: '', nome: '', periodicidade: '', ativa: true, membros: [{ nome: '', funcao: '', login: '' }] };
}

export function montarComissao(
  f: FormularioComissao,
  c: Pick<ComissaoTela, 'id' | 'versao'> | null,
): Montagem<RegistrarComissaoEntrada> {
  const extras: Record<string, string> = {};
  if (vazio(f.tipo)) extras.tipo = 'Escolha o tipo da comissão.';
  if (vazio(f.periodicidade)) extras.periodicidade = 'Escolha a periodicidade das reuniões.';
  const membros = f.membros.filter((m) => !vazio(m.nome) || !vazio(m.funcao));
  if (!membros.length) extras.membros = 'Inclua ao menos um membro.';
  const nomes = membros.map((m) => m.nome.trim().toUpperCase());
  if (new Set(nomes).size !== nomes.length) extras.membros = 'O mesmo membro aparece duas vezes.';
  return conferir(
    esquemaRegistrarComissao,
    {
      comissao: c?.id ?? null,
      versao: c?.versao ?? null,
      tipo: f.tipo,
      nome: f.nome,
      periodicidade: f.periodicidade,
      ativa: f.ativa,
      membros: membros.map((m) => ({ nome: m.nome, funcao: m.funcao, login: ouNulo(m.login) })),
      justificativa: c ? (f.justificativa ?? '').trim() || null : null,
    },
    extras,
  );
}

export interface FormularioReuniao {
  readonly tipo: string;
  readonly data: string | null;
  readonly hora: string | null;
  readonly pauta: string;
  readonly ata: string;
  readonly presentes: readonly number[];
  readonly convidados: string;
  readonly deliberacoes: string;
}

/** O quórum (maioria simples dos membros) com as parcelas, a mesma regra do servidor. */
export function previaQuorum(membros: number, presentes: number): { quorum: boolean; conta: string } {
  return {
    quorum: temQuorum(membros, presentes),
    conta: `${presentes} presentes de ${membros} membros`,
  };
}

export function montarReuniao(
  f: FormularioReuniao,
  c: Pick<ComissaoTela, 'id' | 'versao' | 'membros'>,
): Montagem<Omit<RegistrarReuniaoComissaoEntrada, 'comissao'>> {
  const extras: Record<string, string> = {};
  const realizadaEm = instanteDosCampos(f.data, f.hora);
  if (!realizadaEm) extras.realizadaEm = 'Informe a data e a hora da reunião.';
  if (vazio(f.tipo)) extras.tipo = 'Escolha se a reunião é ordinária ou extraordinária.';
  if (!f.presentes.length) extras.presentes = 'Marque os membros presentes.';
  const m = conferir(
    esquemaRegistrarReuniaoComissao,
    {
      comissao: c.id,
      // As posições dos presentes valem para esta composição: o servidor recusa a comissão alterada depois.
      versaoComissao: c.versao,
      tipo: f.tipo,
      realizadaEm: realizadaEm ?? '',
      pauta: f.pauta,
      ata: f.ata,
      presentes: [...f.presentes].filter((p) => p < c.membros.length).sort((a, b) => a - b),
      convidados: ouNulo(f.convidados),
      deliberacoes: ouNulo(f.deliberacoes),
    },
    extras,
  );
  return m.ok ? { ok: true, entrada: sem(m.entrada, 'comissao') } : m;
}

// ── Riscos e não conformidades ───────────────────────────────────────────────────────────────────────────────────

/** A pontuação G × U × T e a prioridade, com a conta impressa (a mesma do servidor). */
export function previaGut(g: number, u: number, t: number) {
  if (![g, u, t].every((x) => Number.isInteger(x) && x >= 1 && x <= 5)) return null;
  const pontuacao = pontuacaoGut(g, u, t);
  return { pontuacao, prioridade: prioridadeGut(pontuacao), conta: contaGut(g, u, t) };
}

export function classeDaPrioridade(p: RiscoTela['prioridade']): string {
  return {
    critica: 'prazo prazo--vencido',
    alta: 'prazo prazo--venceEmBreve',
    moderada: 'selo selo--atencao',
    baixa: 'selo selo--neutro',
  }[p];
}

/** Um controle do risco na tela: nome (liga ao catálogo do hospital), tipo e eficácia avaliada. */
export interface ControleRiscoFormulario {
  nome: string;
  tipo: TipoControleRisco;
  eficacia: EficaciaControleRisco;
}

export const novoControleRisco = (): ControleRiscoFormulario => ({
  nome: '',
  tipo: 'preventivo',
  eficacia: 'naoAvaliado',
});

/** A eficácia do conjunto enquanto a pessoa preenche (a mesma conta da API), sem as linhas ainda sem nome. */
export const previaEficaciaControles = (lista: readonly ControleRiscoFormulario[]) =>
  eficaciaDosControles(lista.filter((c) => !vazio(c.nome)));

export interface FormularioRisco {
  readonly titulo: string;
  readonly descricao: string;
  readonly area: string;
  readonly categoria: string;
  readonly gravidade: number;
  readonly urgencia: number;
  readonly tendencia: number;
  readonly controles: string;
  readonly controlesLista: ControleRiscoFormulario[];
  readonly responsavel: string;
  readonly situacao: string;
  readonly reavaliarEm: string | null;
  readonly justificativa: string;
}

export function formularioDoRisco(r: RiscoTela | null): FormularioRisco {
  return r
    ? {
        titulo: r.titulo,
        descricao: r.descricao,
        area: r.area,
        categoria: r.categoria,
        gravidade: r.gravidade,
        urgencia: r.urgencia,
        tendencia: r.tendencia,
        controles: r.controles ?? '',
        controlesLista: r.controlesLista.map((c) => ({ nome: c.nome, tipo: c.tipo, eficacia: c.eficacia })),
        responsavel: r.responsavel,
        situacao: r.situacao,
        reavaliarEm: r.reavaliarEm,
        justificativa: r.justificativa ?? '',
      }
    : {
        titulo: '',
        descricao: '',
        area: '',
        categoria: '',
        gravidade: 0,
        urgencia: 0,
        tendencia: 0,
        controles: '',
        controlesLista: [],
        responsavel: '',
        situacao: 'identificado',
        reavaliarEm: null,
        justificativa: '',
      };
}

/** O risco: os três eixos de 1 a 5; o aceito e o encerrado com a justificativa. */
export function montarRisco(
  f: FormularioRisco,
  r: Pick<RiscoTela, 'id' | 'versao'> | null,
): Montagem<RegistrarRiscoEntrada> {
  const extras: Record<string, string> = {};
  if (vazio(f.categoria)) extras.categoria = 'Escolha a categoria do risco.';
  if (!previaGut(f.gravidade, f.urgencia, f.tendencia))
    extras.gut = 'Escolha a gravidade, a urgência e a tendência (1 a 5).';
  if ((f.situacao === 'aceito' || f.situacao === 'encerrado') && vazio(f.justificativa))
    extras.justificativa = 'Risco aceito ou encerrado: registre a justificativa.';
  if (!f.reavaliarEm) extras.reavaliarEm = 'Informe a data da próxima reavaliação.';
  if (f.controlesLista.some((c) => vazio(c.nome)))
    extras.controlesLista = 'Dê nome a cada controle ou retire a linha.';
  else {
    const recusa = recusaControlesRisco(f.controlesLista, f.situacao as SituacaoRisco);
    if (recusa) extras.controlesLista = MENSAGENS_RECUSA_GESTAO[recusa];
  }
  return conferir(
    esquemaRegistrarRisco,
    {
      risco: r?.id ?? null,
      versao: r?.versao ?? null,
      titulo: f.titulo,
      descricao: f.descricao,
      area: f.area,
      categoria: f.categoria,
      gravidade: f.gravidade,
      urgencia: f.urgencia,
      tendencia: f.tendencia,
      controles: ouNulo(f.controles),
      controlesLista: f.controlesLista.map((c) => ({
        nome: c.nome.trim(),
        tipo: c.tipo,
        eficacia: c.eficacia,
      })),
      responsavel: f.responsavel,
      situacao: f.situacao,
      reavaliarEm: f.reavaliarEm ?? '',
      justificativa: ouNulo(f.justificativa),
    },
    extras,
  );
}

export interface FormularioNaoConformidade {
  readonly origem: string;
  readonly idOrigem: string;
  readonly descricao: string;
  readonly area: string;
  readonly classificacao: string;
  readonly acaoImediata: string;
  readonly causa: string;
  readonly plano: string;
  readonly responsavel: string;
  readonly prazo: string | null;
  readonly situacao: string;
  readonly eficacia: string;
  readonly eficaciaTexto: string;
}

export function formularioDaNaoConformidade(
  n: NaoConformidadeTela | null,
  origem?: { origem: string; id: number | null; area?: string },
): FormularioNaoConformidade {
  if (n)
    return {
      origem: n.origem,
      idOrigem: n.idOrigem === null ? '' : String(n.idOrigem),
      descricao: n.descricao,
      area: n.area,
      classificacao: n.classificacao,
      acaoImediata: n.acaoImediata ?? '',
      causa: n.causa ?? '',
      plano: n.plano ?? '',
      responsavel: n.responsavel ?? '',
      prazo: n.prazo,
      situacao: n.situacao,
      eficacia: n.eficacia ?? '',
      eficaciaTexto: n.eficaciaTexto ?? '',
    };
  return {
    origem: origem?.origem ?? '',
    idOrigem: origem?.id ? String(origem.id) : '',
    descricao: '',
    area: origem?.area ?? '',
    classificacao: '',
    acaoImediata: '',
    causa: '',
    plano: '',
    responsavel: '',
    prazo: null,
    situacao: 'aberta',
    eficacia: '',
    eficaciaTexto: '',
  };
}

/** As origens que apontam um registro do Sante (as demais não levam o número). */
export const ORIGENS_COM_REGISTRO = ['auditoria', 'risco', 'ouvidoria', 'notificacao'] as const;

/**
 * O ciclo da não conformidade: em tratamento exige causa, plano, responsável e prazo; encerrada exige a eficácia
 * verificada (o servidor confere a passagem entre as situações).
 */
export function montarNaoConformidade(
  f: FormularioNaoConformidade,
  n: Pick<NaoConformidadeTela, 'id' | 'versao'> | null,
): Montagem<RegistrarNaoConformidadeEntrada> {
  const extras: Record<string, string> = {};
  if (vazio(f.origem)) extras.origem = 'Escolha a origem da não conformidade.';
  if (vazio(f.classificacao)) extras.classificacao = 'Escolha a classificação.';
  const comRegistro = (ORIGENS_COM_REGISTRO as readonly string[]).includes(f.origem);
  const idOrigem = comRegistro && !vazio(f.idOrigem) ? Number(f.idOrigem) : null;
  if (comRegistro && !vazio(f.idOrigem) && !(Number.isInteger(idOrigem) && (idOrigem ?? 0) > 0))
    extras.idOrigem = 'O número do registro de origem é um número inteiro.';
  if (f.situacao !== 'aberta') {
    if (vazio(f.causa)) extras.causa = 'Descreva a causa.';
    if (vazio(f.plano)) extras.plano = 'Descreva o plano de ação.';
    if (vazio(f.responsavel)) extras.responsavel = 'Informe o responsável.';
    if (!f.prazo) extras.prazo = 'Informe o prazo.';
  }
  if (f.situacao === 'encerrada' && vazio(f.eficacia))
    extras.eficacia = 'Para encerrar, registre a verificação da eficácia.';
  return conferir(
    esquemaRegistrarNaoConformidade,
    {
      naoConformidade: n?.id ?? null,
      versao: n?.versao ?? null,
      origem: f.origem,
      idOrigem,
      descricao: f.descricao,
      area: f.area,
      classificacao: f.classificacao,
      acaoImediata: ouNulo(f.acaoImediata),
      causa: ouNulo(f.causa),
      plano: ouNulo(f.plano),
      responsavel: ouNulo(f.responsavel),
      prazo: f.prazo || null,
      situacao: f.situacao,
      eficacia: vazio(f.eficacia) ? null : f.eficacia,
      eficaciaTexto: ouNulo(f.eficaciaTexto),
    },
    extras,
  );
}

// ── Ouvidoria ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface FormularioManifestacao {
  readonly canal: string;
  readonly tipo: string;
  readonly identificada: boolean;
  readonly paciente: number | null;
  readonly manifestante: string;
  readonly contato: string;
  readonly area: string;
  readonly relato: string;
  readonly data: string | null;
  readonly hora: string | null;
  readonly pesquisa: number | null;
}

/** A manifestação: a anônima não leva nada que identifique; a da pesquisa vem pelo canal da pesquisa. */
export function montarManifestacao(f: FormularioManifestacao): Montagem<RegistrarManifestacaoEntrada> {
  const extras: Record<string, string> = {};
  if (vazio(f.canal)) extras.canal = 'Escolha o canal de entrada.';
  if (vazio(f.tipo)) extras.tipo = 'Escolha o tipo da manifestação.';
  const recebidaEm = instanteDosCampos(f.data, f.hora);
  if (!recebidaEm) extras.recebidaEm = 'Informe a data e a hora do recebimento.';
  return conferir(
    esquemaRegistrarManifestacao,
    {
      canal: f.canal,
      tipo: f.tipo,
      identificada: f.identificada,
      paciente: f.identificada ? f.paciente : null,
      manifestante: f.identificada ? ouNulo(f.manifestante) : null,
      contato: f.identificada ? ouNulo(f.contato) : null,
      area: f.area,
      relato: f.relato,
      recebidaEm: recebidaEm ?? '',
      pesquisa: f.pesquisa,
    },
    extras,
  );
}

export function montarEncaminhamento(
  m: Pick<ManifestacaoTela, 'id' | 'versao'>,
  encaminhadaA: string,
  observacao: string,
): Montagem<Omit<EncaminharManifestacaoEntrada, 'manifestacao'>> {
  const r = conferir(esquemaEncaminharManifestacao, {
    manifestacao: m.id,
    versao: m.versao,
    encaminhadaA,
    observacao: ouNulo(observacao),
  });
  return r.ok ? { ok: true, entrada: sem(r.entrada, 'manifestacao') } : r;
}

/** Tipos em que a resposta diz se a manifestação procede (orienta a não conformidade). */
export const TIPOS_COM_PROCEDENCIA = ['reclamacao', 'denuncia'] as const;

export function montarResposta(
  m: Pick<ManifestacaoTela, 'id' | 'versao' | 'tipo'>,
  resposta: string,
  procedente: string,
): Montagem<Omit<ResponderManifestacaoEntrada, 'manifestacao'>> {
  const extras: Record<string, string> = {};
  const exige = (TIPOS_COM_PROCEDENCIA as readonly string[]).includes(m.tipo);
  if (exige && procedente === '') extras.procedente = 'Diga se a manifestação procede.';
  const r = conferir(
    esquemaResponderManifestacao,
    {
      manifestacao: m.id,
      versao: m.versao,
      resposta,
      procedente: exige ? procedente === 'sim' : null,
    },
    extras,
  );
  return r.ok ? { ok: true, entrada: sem(r.entrada, 'manifestacao') } : r;
}

/** O que a situação permite: encaminhar a aberta, responder a aberta ou a encaminhada. */
export function acoesDaManifestacao(
  s: ManifestacaoTela['situacao'],
  podeResponder: boolean,
): { encaminhar: boolean; responder: boolean } {
  return {
    encaminhar: podeResponder && s === 'aberta',
    responder: podeResponder && s !== 'respondida',
  };
}

export function classeDoPrazoManifestacao(e: ManifestacaoTela['estadoPrazo']): string {
  return {
    noPrazo: 'prazo',
    vencendo: 'prazo prazo--venceEmBreve',
    vencido: 'prazo prazo--vencido',
    cumprido: 'prazo prazo--cumprido',
    respondidaComAtraso: 'prazo prazo--venceEmBreve',
  }[e];
}

// ── Envios regulatórios ──────────────────────────────────────────────────────────────────────────────────────────

/** O resumo do envio em texto ("linhas: 7; analisados: 5"). */
export function textoDoResumo(r: Readonly<Record<string, number>>): string {
  return Object.entries(r)
    .map(([k, v]) => `${k}: ${numeroBr(v, 0)}`)
    .join('; ');
}

/** O envio atual de cada tipo e competência (o substituído fica no histórico). */
export function enviosAtuais(itens: readonly EnvioTela[]): EnvioTela[] {
  return itens.filter((e) => e.situacao !== 'substituido');
}

export interface FormularioTransmissao {
  readonly data: string | null;
  readonly hora: string | null;
  readonly protocolo: string;
  /** O resumo do arquivo transmitido (conferido com o gerado). */
  readonly hash: string;
}

/** A transmissão manual: o protocolo do portal e o resumo do arquivo transmitido, que tem de ser o do gerado. */
export function montarTransmissao(
  e: Pick<EnvioTela, 'id' | 'versao' | 'hash'>,
  f: FormularioTransmissao,
): Montagem<Omit<RegistrarTransmissaoEnvioEntrada, 'envio'>> {
  const extras: Record<string, string> = {};
  const transmitidoEm = instanteDosCampos(f.data, f.hora);
  if (!transmitidoEm) extras.transmitidoEm = 'Informe a data e a hora da transmissão.';
  const hash = f.hash.trim().toLowerCase();
  if (hash && hash !== e.hash)
    extras.hash =
      'O resumo informado não é o do arquivo gerado: gere de novo ou confira o arquivo transmitido.';
  const r = conferir(
    esquemaRegistrarTransmissaoEnvio,
    { envio: e.id, versao: e.versao, transmitidoEm: transmitidoEm ?? '', protocolo: f.protocolo, hash },
    extras,
  );
  return r.ok ? { ok: true, entrada: sem(r.entrada, 'envio') } : r;
}

/** Baixa um texto como arquivo no navegador (o CSV do envio, gerado de novo pelo servidor). */
export function baixarTexto(nome: string, conteudo: string, tipo = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}
