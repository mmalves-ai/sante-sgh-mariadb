// Comuns das telas da manutenção e engenharia clínica (M55, etapa 1): os rótulos do vocabulário para os combos, as datas
// e os instantes como a tela mostra e digita, o texto dos prazos, os valores em reais digitados, a URL do QR da
// etiqueta, as abas da lista de OS conforme o perfil, os rascunhos dos formulários com o corpo estrito de cada
// gravação e a conferência pelo MESMO esquema do servidor (a tela avisa antes; o servidor confere de novo), e as contas
// dos indicadores com as parcelas impressas (regra 3).
import {
  ATIVIDADES_PLANO,
  CAUSAS_FALHA,
  CLASSES_RISCO,
  COBERTURAS_CONTRATO,
  CRITICIDADES_EQUIPAMENTO,
  EXECUTORES,
  NATUREZAS_ABERTURA,
  NATUREZAS_OS,
  PRIORIDADES_OS,
  RESULTADOS_EXECUCAO,
  SITUACOES_EQUIPAMENTO,
  SITUACOES_OS,
  SITUACOES_PLANO,
  SITUACOES_PRAZO_OS,
  TIPOS_EQUIPAMENTO,
  TIPOS_RECURSO_AGENDA,
  type ApoioManutencao,
  type ClasseRisco,
  type CriticidadeEquipamento,
  type EquipamentoDetalhe,
  type IndicadoresManutencao,
  type PrazoOs,
  type SituacaoEquipamento,
  type TipoEquipamento,
  type TipoRecursoAgenda,
  lerHoraDigitada,
} from '@sgh/contratos';
import type { z } from 'zod';

export type Opcao<V> = { readonly valor: V; readonly rotulo: string };

const opcoesDe = <K extends string>(mapa: Readonly<Record<K, string>>, so?: readonly K[]): Opcao<K>[] =>
  (Object.keys(mapa) as K[]).filter((k) => !so || so.includes(k)).map((k) => ({ valor: k, rotulo: mapa[k] }));

/** Opções com o "Todos" (valor nulo) na frente, para os filtros. */
export const comTodos = <V>(rotulo: string, opcoes: readonly Opcao<V>[]): Opcao<V | null>[] => [
  { valor: null, rotulo },
  ...opcoes,
];

export const OPCOES = {
  tipo: opcoesDe(TIPOS_EQUIPAMENTO),
  criticidade: opcoesDe(CRITICIDADES_EQUIPAMENTO),
  classeRisco: opcoesDe(CLASSES_RISCO),
  situacaoEquipamento: opcoesDe(SITUACOES_EQUIPAMENTO),
  recursoTipo: opcoesDe(TIPOS_RECURSO_AGENDA),
  natureza: opcoesDe(NATUREZAS_OS),
  naturezaAbertura: opcoesDe(NATUREZAS_OS, NATUREZAS_ABERTURA),
  prioridade: opcoesDe(PRIORIDADES_OS),
  situacaoOs: opcoesDe(SITUACOES_OS),
  andamento: opcoesDe(SITUACOES_OS, ['emAtendimento', 'aguardandoPeca', 'aguardandoTerceiro']),
  executor: opcoesDe(EXECUTORES),
  causa: opcoesDe(CAUSAS_FALHA),
  atividade: opcoesDe(ATIVIDADES_PLANO),
  resultado: opcoesDe(RESULTADOS_EXECUCAO),
  cobertura: opcoesDe(COBERTURAS_CONTRATO),
  unidadePeriodo: [
    { valor: 'meses', rotulo: 'meses' },
    { valor: 'dias', rotulo: 'dias' },
  ] as Opcao<'meses' | 'dias'>[],
};

export const ROTULOS = {
  tipo: TIPOS_EQUIPAMENTO,
  criticidade: CRITICIDADES_EQUIPAMENTO,
  classeRisco: CLASSES_RISCO,
  situacaoEquipamento: SITUACOES_EQUIPAMENTO,
  recursoTipo: TIPOS_RECURSO_AGENDA,
  natureza: NATUREZAS_OS,
  prioridade: PRIORIDADES_OS,
  situacaoOs: SITUACOES_OS,
  prazo: SITUACOES_PRAZO_OS,
  executor: EXECUTORES,
  causa: CAUSAS_FALHA,
  atividade: ATIVIDADES_PLANO,
  resultado: RESULTADOS_EXECUCAO,
  situacaoPlano: SITUACOES_PLANO,
  cobertura: COBERTURAS_CONTRATO,
} as const;

// ── Datas, instantes e valores ──────────────────────────────────────────────────────────────────────────────────────
const dois = (n: number) => String(n).padStart(2, '0');

/** Hoje no relógio do navegador (AAAA-MM-DD); a tela recebe o do servidor quando o apoio chega. */
export const hojeLocal = (d = new Date()) =>
  `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
/** Agora no relógio do navegador (AAAA-MM-DDTHH:MM). */
export const agoraLocal = (d = new Date()) => `${hojeLocal(d)}T${dois(d.getHours())}:${dois(d.getMinutes())}`;

/** "2026-10-28" → "28/10/2026". */
export const dataBr = (d: string | null | undefined) =>
  d ? d.slice(0, 10).split('-').reverse().join('/') : '';
/** "2026-10-28T09:05" → "28/10/2026 09:05". */
export const instanteBr = (i: string | null | undefined) =>
  i ? `${dataBr(i.slice(0, 10))}${i.length >= 16 ? ` ${i.slice(11, 16)}` : ''}` : '';

/** Data (AAAA-MM-DD) e hora (HH:MM) dos campos num instante; incompleto é nulo. */
export function juntarInstante(data: string | null, hora: string | null): string | null {
  // A hora digitada passa pelo auxiliar neutro (`lerHoraDigitada`: "8:30" e "0830" viram "08:30"); hora inválida não
  // forma instante (o campo fica incompleto e a tela pede a correção).
  let h: string | null;
  try {
    h = hora === null ? null : lerHoraDigitada(hora);
  } catch {
    return null;
  }
  if (!data || !h || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;
  return `${data}T${h}`;
}
/** O instante separado nos dois campos. */
export const separarInstante = (i: string | null) => ({
  data: i ? i.slice(0, 10) : null,
  hora: i && i.length >= 16 ? i.slice(11, 16) : null,
});

/** Minutos em texto curto: "45 min", "3 h 05 min", "2 dias 4 h". */
export function textoMinutos(m: number): string {
  const total = Math.abs(Math.round(m));
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const min = total % 60;
  if (h < 48) return min === 0 ? `${h} h` : `${h} h ${dois(min)} min`;
  const dias = Math.floor(h / 24);
  const resto = h % 24;
  return resto === 0 ? `${dias} dias` : `${dias} dias ${resto} h`;
}

/** O prazo como a tela mostra: a chave do texto e o tempo (quando a etapa não acabou). */
export function textoDoPrazo(p: PrazoOs): { chave: string; tempo: string } {
  if (p.situacao === 'cumprido') return { chave: 'manutencao.prazo.cumprido', tempo: '' };
  if (p.situacao === 'descumprido') return { chave: 'manutencao.prazo.descumprido', tempo: '' };
  const m = p.restanteMinutos ?? 0;
  return m < 0
    ? { chave: 'manutencao.prazo.vencidoHa', tempo: textoMinutos(m) }
    : { chave: 'manutencao.prazo.restante', tempo: textoMinutos(m) };
}

/** Reais com duas casas no padrão brasileiro. */
export const reais = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
/** Número com duas casas ("1.234,56"). */
export const numero2 = (v: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Valor em reais digitado ("1.234,56", "1234.5", "R$ 10"); vazio é 0; inválido é nulo. */
export function reaisDigitados(texto: string): number | null {
  const t = texto.trim().replace(/\s|R\$/g, '');
  if (!t) return 0;
  let normal: string;
  if (t.includes(',')) normal = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) normal = t.replace(/\./g, '');
  else normal = t;
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return null;
  const v = Number(normal);
  return Number.isFinite(v) && v <= 99_999_999.99 ? v : null;
}

/** Inteiro positivo digitado, ou nulo. */
export function inteiroDigitado(texto: string): number | null {
  const t = texto.trim();
  if (!/^\d{1,10}$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && Number.isSafeInteger(n) ? n : null;
}

/** O endereço que o QR da etiqueta abre: a lista de OS já com o chamado deste equipamento (D-QR-55). */
export const urlDoQr = (origem: string, codigo: string) =>
  `${origem.replace(/\/$/, '')}/manutencao/os?abrir=${encodeURIComponent(codigo)}`;

// ── Abas da lista de OS ─────────────────────────────────────────────────────────────────────────────────────────────
export type AbaOs = 'minhas' | 'doSetor' | 'todas';

/** "Abertas por mim" sempre; "Do meu setor" para quem tem setor no cadastro; "Todas" para quem atende ou encerra. */
export function abasDaPessoa(a: Pick<ApoioManutencao, 'meusSetores' | 'pode'>): AbaOs[] {
  const r: AbaOs[] = ['minhas'];
  if (a.meusSetores.length > 0) r.push('doSetor');
  if (a.pode.atender || a.pode.encerrar) r.push('todas');
  return r;
}

/** A aba inicial: quem atende começa em "Todas"; os outros, nas que abriu. */
export const abaInicial = (a: Pick<ApoioManutencao, 'meusSetores' | 'pode'>): AbaOs =>
  a.pode.atender || a.pode.encerrar ? 'todas' : 'minhas';

// ── Conferência pelo esquema do servidor ────────────────────────────────────────────────────────────────────────────
/** A primeira mensagem de cada campo, pelo mesmo esquema Zod do servidor; vazio: pode enviar. */
/** A mensagem padrão do Zod (em inglês) nunca chega à tela: vira o texto da aplicação pelo código do problema. */
const PROBLEMA_PADRAO: Readonly<Record<string, string>> = {
  invalid_type: 'Preencha este campo.',
  invalid_value: 'Escolha uma das opções.',
  invalid_union: 'Escolha uma das opções.',
  too_small: 'Valor abaixo do mínimo.',
  too_big: 'Valor acima do máximo.',
};
const ehMensagemPadrao = (m: string) => /^(Invalid|Too (small|big)|Expected|Unrecognized)/.test(m);

export function problemasDe(esquema: z.ZodType, corpo: unknown): Record<string, string> {
  const r = esquema.safeParse(corpo);
  if (r.success) return {};
  const p: Record<string, string> = {};
  for (const i of r.error.issues) {
    const campo = i.path.map(String).join('.') || '_';
    p[campo] ??= ehMensagemPadrao(i.message) ? (PROBLEMA_PADRAO[i.code] ?? 'Valor inválido.') : i.message;
  }
  return p;
}

const textoOuNulo = (t: string) => (t.trim() === '' ? null : t.trim());

// ── Equipamento ─────────────────────────────────────────────────────────────────────────────────────────────────────
export interface RascunhoEquipamento {
  codigo: string;
  nome: string;
  tipo: TipoEquipamento;
  criticidade: CriticidadeEquipamento;
  classeRisco: ClasseRisco | null;
  fabricante: string;
  modelo: string;
  numeroSerie: string;
  registroAnvisa: string;
  unidade: number | null;
  centroCusto: number | null;
  localizacao: string;
  recursoTipo: TipoRecursoAgenda | null;
  recursoId: number | null;
  bemPatrimonial: number | null;
  instalacao: string | null;
  garantiaAte: string | null;
  situacao: SituacaoEquipamento;
  motivo: string;
}

export const rascunhoEquipamentoVazio = (): RascunhoEquipamento => ({
  codigo: '',
  nome: '',
  tipo: 'medico',
  criticidade: 'media',
  classeRisco: null,
  fabricante: '',
  modelo: '',
  numeroSerie: '',
  registroAnvisa: '',
  unidade: null,
  centroCusto: null,
  localizacao: '',
  recursoTipo: null,
  recursoId: null,
  bemPatrimonial: null,
  instalacao: null,
  garantiaAte: null,
  situacao: 'ativo',
  motivo: '',
});

/** O rascunho a partir da ficha lida (para alterar). */
export function rascunhoDoEquipamento(e: EquipamentoDetalhe): RascunhoEquipamento {
  return {
    codigo: e.codigo,
    nome: e.nome,
    tipo: e.tipo,
    criticidade: e.criticidade,
    classeRisco: e.classeRisco,
    fabricante: e.fabricante ?? '',
    modelo: e.modelo ?? '',
    numeroSerie: e.numeroSerie ?? '',
    registroAnvisa: e.registroAnvisa ?? '',
    unidade: e.unidade ? Number(e.unidade.codigo) : null,
    centroCusto: e.setor ? Number(e.setor.codigo) : null,
    localizacao: e.localizacao ?? '',
    recursoTipo: e.recurso?.tipo ?? null,
    recursoId: e.recurso?.id ?? null,
    bemPatrimonial: e.bemPatrimonial,
    instalacao: e.instalacao,
    garantiaAte: e.garantiaAte,
    situacao: e.situacao,
    motivo: '',
  };
}

/** O corpo do cadastro (sem `id`, `versao` e `motivo`) ou da alteração (com eles). */
export function corpoDoEquipamento(r: RascunhoEquipamento, alteracao?: { id: number; versao: number }) {
  const base = {
    codigo: r.codigo.trim(),
    nome: r.nome.trim(),
    tipo: r.tipo,
    criticidade: r.criticidade,
    classeRisco: r.tipo === 'medico' ? r.classeRisco : null,
    fabricante: textoOuNulo(r.fabricante),
    modelo: textoOuNulo(r.modelo),
    numeroSerie: textoOuNulo(r.numeroSerie),
    registroAnvisa: textoOuNulo(r.registroAnvisa),
    unidade: r.unidade,
    centroCusto: r.centroCusto,
    localizacao: textoOuNulo(r.localizacao),
    recurso: r.recursoTipo && r.recursoId ? { tipo: r.recursoTipo, id: r.recursoId } : null,
    bemPatrimonial: r.bemPatrimonial,
    instalacao: r.instalacao,
    garantiaAte: r.garantiaAte,
    situacao: r.situacao,
  };
  return alteracao
    ? { ...base, id: alteracao.id, versao: alteracao.versao, motivo: textoOuNulo(r.motivo) }
    : base;
}

// ── Abertura da OS ──────────────────────────────────────────────────────────────────────────────────────────────────
export interface RascunhoAbertura {
  natureza: 'corretiva' | 'predial';
  equipamento: number | null;
  centroCusto: number | null;
  local: string;
  descricao: string;
  prioridadeSugerida: 'emergencia' | 'alta' | 'media' | 'baixa';
  equipamentoParado: boolean;
  contato: string;
}

export const rascunhoAberturaVazio = (centroCusto: number | null = null): RascunhoAbertura => ({
  natureza: 'corretiva',
  equipamento: null,
  centroCusto,
  local: '',
  descricao: '',
  prioridadeSugerida: 'media',
  equipamentoParado: false,
  contato: '',
});

export const corpoDaAbertura = (r: RascunhoAbertura) => ({
  natureza: r.natureza,
  equipamento: r.equipamento,
  codigoEquipamento: null,
  centroCusto: r.centroCusto,
  local: textoOuNulo(r.local),
  descricao: r.descricao.trim(),
  prioridadeSugerida: r.prioridadeSugerida,
  equipamentoParado: r.equipamento !== null && r.equipamentoParado,
  contato: textoOuNulo(r.contato),
});

/** Os setores que a pessoa pode escolher ao abrir: os do cadastro dela ou, sem restrição, todos os ativos. */
export function setoresDaAbertura(a: Pick<ApoioManutencao, 'setores' | 'meusSetores'>): Opcao<number>[] {
  const ativos = a.setores.filter((s) => s.ativo);
  const meus = a.meusSetores.length > 0 ? ativos.filter((s) => a.meusSetores.includes(s.codigo)) : ativos;
  return meus.map((s) => ({ valor: s.codigo, rotulo: `${s.nome} (${s.codigo})` }));
}

// ── Conclusão da OS ─────────────────────────────────────────────────────────────────────────────────────────────────
export interface RascunhoConclusao {
  causa: keyof typeof CAUSAS_FALHA | null;
  solucao: string;
  inicioData: string | null;
  inicioHora: string | null;
  fimData: string | null;
  fimHora: string | null;
  voltaData: string | null;
  voltaHora: string | null;
  custoPecas: string;
  custoMaoDeObra: string;
  custoTerceiros: string;
  laudo: string;
}

export const rascunhoConclusaoVazio = (hoje: string): RascunhoConclusao => ({
  causa: null,
  solucao: '',
  inicioData: hoje,
  inicioHora: null,
  fimData: hoje,
  fimHora: null,
  voltaData: null,
  voltaHora: null,
  custoPecas: '',
  custoMaoDeObra: '',
  custoTerceiros: '',
  laudo: '',
});

/** O corpo da conclusão; o custo digitado inválido vai como texto para o esquema recusar com a mensagem do campo. */
export function corpoDaConclusao(r: RascunhoConclusao, versao: number, comParada: boolean) {
  const custo = (t: string) => reaisDigitados(t) ?? t;
  const laudo = r.laudo.trim();
  return {
    versao,
    causa: r.causa,
    solucao: r.solucao.trim(),
    inicioReparo: juntarInstante(r.inicioData, r.inicioHora),
    fimReparo: juntarInstante(r.fimData, r.fimHora),
    voltaAoUso: comParada ? juntarInstante(r.voltaData, r.voltaHora) : null,
    custoPecas: custo(r.custoPecas),
    custoMaoDeObra: custo(r.custoMaoDeObra),
    custoTerceiros: custo(r.custoTerceiros),
    laudo: laudo === '' ? null : (inteiroDigitado(laudo) ?? laudo),
  };
}

// ── Plano e execução ────────────────────────────────────────────────────────────────────────────────────────────────
export interface RascunhoPlano {
  atividade: keyof typeof ATIVIDADES_PLANO;
  quantidade: string;
  unidade: 'meses' | 'dias';
  dataBase: string | null;
  antecedencia: string;
  procedimento: string;
  executor: 'interno' | 'contrato';
  cobertura: number | null;
}

export const rascunhoPlanoVazio = (hoje: string): RascunhoPlano => ({
  atividade: 'preventiva',
  quantidade: '6',
  unidade: 'meses',
  dataBase: hoje,
  antecedencia: '',
  procedimento: '',
  executor: 'interno',
  cobertura: null,
});

export function corpoDoPlano(r: RascunhoPlano, equipamento: number) {
  const q = inteiroDigitado(r.quantidade);
  const a = r.antecedencia.trim();
  return {
    equipamento,
    atividade: r.atividade,
    periodicidade: { quantidade: q ?? r.quantidade, unidade: r.unidade },
    dataBase: r.dataBase,
    antecedenciaDias: a === '' ? null : /^\d{1,3}$/.test(a) ? Number(a) : a,
    procedimento: textoOuNulo(r.procedimento),
    executor: r.executor,
    cobertura: r.executor === 'contrato' ? r.cobertura : null,
  };
}

export interface RascunhoExecucao {
  data: string | null;
  resultado: keyof typeof RESULTADOS_EXECUCAO;
  laudo: string;
  certificadoPadrao: string;
  observacao: string;
}

export const rascunhoExecucaoVazio = (hoje: string): RascunhoExecucao => ({
  data: hoje,
  resultado: 'aprovado',
  laudo: '',
  certificadoPadrao: '',
  observacao: '',
});

export function corpoDaExecucao(r: RascunhoExecucao, versao: number) {
  const laudo = r.laudo.trim();
  return {
    versao,
    data: r.data,
    resultado: r.resultado,
    laudo: laudo === '' ? null : (inteiroDigitado(laudo) ?? laudo),
    certificadoPadrao: textoOuNulo(r.certificadoPadrao),
    observacao: textoOuNulo(r.observacao),
  };
}

// ── Contrato de manutenção ──────────────────────────────────────────────────────────────────────────────────────────
export interface RascunhoCobertura {
  fornecedor: number | null;
  numero: string;
  cobertura: keyof typeof COBERTURAS_CONTRATO;
  inicio: string | null;
  fim: string | null;
  equipamentos: number[];
  slaHoras: string;
  valorMensal: string;
}

export const rascunhoCoberturaVazio = (hoje: string): RascunhoCobertura => ({
  fornecedor: null,
  numero: '',
  cobertura: 'integral',
  inicio: hoje,
  fim: null,
  equipamentos: [],
  slaHoras: '',
  valorMensal: '',
});

export function corpoDaCobertura(r: RascunhoCobertura) {
  const sla = r.slaHoras.trim();
  const valor = r.valorMensal.trim();
  return {
    fornecedor: r.fornecedor,
    numero: r.numero.trim(),
    cobertura: r.cobertura,
    inicio: r.inicio,
    fim: r.fim,
    equipamentos: r.equipamentos,
    slaHoras: sla === '' ? null : /^\d{1,3}$/.test(sla) ? Number(sla) : sla,
    valorMensal: valor === '' ? null : (reaisDigitados(valor) ?? valor),
    contrato: null,
  };
}

// ── Indicadores ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** As três contas com as parcelas impressas (regra 3); sem falha ou sem reparo, a conta não se faz. */
export function contasDosIndicadores(i: IndicadoresManutencao) {
  const p = i.parcelas;
  return {
    disponibilidade:
      i.disponibilidade === null
        ? null
        : { operacao: numero2(p.horasOperacao), periodo: numero2(p.horasPeriodo) },
    mtbf: i.mtbf === null ? null : { operacao: numero2(p.horasOperacao), falhas: String(p.falhas) },
    mttr: i.mttr === null ? null : { reparo: numero2(p.horasReparo), reparos: String(p.reparos) },
  };
}

/** Primeiro dia do mês da data (o período padrão dos indicadores). */
export const inicioDoMes = (hoje: string) => `${hoje.slice(0, 7)}-01`;
