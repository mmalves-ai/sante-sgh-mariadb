// Cadastro complementar da operadora (F7, 08-SGO linhas 93 a 95): responsáveis perante a ANS, setores internos,
// parâmetros gerais por operadora, aditivo e cancelamento do contrato, área de abrangência do produto, carências
// aplicadas ao beneficiário e o pedido de cartão. Regra pura, sem banco: a porta grava o que estas funções decidem.
// Padrões públicos: Lei 9.656/98 art. 12 V (tetos de carência: 24 horas na urgência, 300 dias no parto, 180 dias nos
// demais, 24 meses na cobertura parcial temporária), art. 13 II (cancelamento por inadimplência só com mais de 60
// dias e notificação até o 50º dia) e RN 412 da ANS (cancelamento a pedido do titular com efeito imediato).
// Melhoria: a troca de responsável encerra o anterior na véspera sozinha (um clique) e nunca sobrescreve o período;
// o parâmetro muda por vigência, sem apagar o valor antigo.

import { somarDias } from './carteirinha.js';

export interface ProblemaCadastro {
  readonly codigo: string;
  readonly campo: string;
  readonly detalhe: string;
}

const p = (codigo: string, campo: string, detalhe: string): ProblemaCadastro => ({ codigo, campo, detalhe });
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const dataValida = (d: string | null | undefined): d is string =>
  typeof d === 'string' && DATA.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

// ---- responsáveis da operadora ----

export const TIPOS_RESPONSAVEL_OPERADORA = [
  'representante_legal',
  'responsavel_tecnico',
  'administrador',
  'ouvidor',
  'atuario',
  'contador',
  'auditoria_independente',
  'responsavel_cadastro',
] as const;
export type TipoResponsavelOperadora = (typeof TIPOS_RESPONSAVEL_OPERADORA)[number];

/** Os papéis que a ANS pede com um só titular por vez (os demais admitem vários ao mesmo tempo). */
export const RESPONSAVEIS_UNICOS: readonly TipoResponsavelOperadora[] = [
  'representante_legal',
  'responsavel_tecnico',
  'ouvidor',
  'responsavel_cadastro',
];

export interface PeriodoResponsavel {
  readonly id: number;
  readonly tipo: TipoResponsavelOperadora;
  readonly inicio: string;
  readonly fim: string | null;
}

export interface NovoResponsavel {
  readonly tipo: string;
  readonly natureza: 'fisica' | 'juridica';
  readonly inicio: string;
  readonly fim: string | null;
  readonly numeroRegistro: string | null;
}

export interface PlanoResponsavel {
  readonly problemas: ProblemaCadastro[];
  /** Períodos anteriores do mesmo papel único encerrados na véspera do novo início. */
  readonly encerrar: { readonly id: number; readonly fim: string }[];
}

/** Confere o novo responsável e diz quais períodos do mesmo papel único se encerram na véspera. */
export function planoResponsavel(
  novo: NovoResponsavel,
  existentes: readonly PeriodoResponsavel[],
): PlanoResponsavel {
  const problemas: ProblemaCadastro[] = [];
  const tipo = novo.tipo as TipoResponsavelOperadora;
  if (!TIPOS_RESPONSAVEL_OPERADORA.includes(tipo))
    problemas.push(p('tipo-invalido', 'tipo', 'Papel do responsável fora da lista da ANS.'));
  if (!dataValida(novo.inicio))
    problemas.push(p('data-invalida', 'inicio', 'Informe o início do exercício.'));
  if (novo.fim !== null && (!dataValida(novo.fim) || novo.fim < novo.inicio))
    problemas.push(p('periodo-invalido', 'fim', 'O fim do exercício não pode ser antes do início.'));
  if (tipo === 'responsavel_tecnico' && !novo.numeroRegistro?.trim())
    problemas.push(
      p('registro-obrigatorio', 'numeroRegistro', 'O responsável técnico precisa do registro no conselho.'),
    );
  if (tipo === 'responsavel_tecnico' && novo.natureza !== 'fisica')
    problemas.push(p('natureza-invalida', 'natureza', 'O responsável técnico é sempre uma pessoa física.'));
  const encerrar: { id: number; fim: string }[] = [];
  if (problemas.length === 0 && RESPONSAVEIS_UNICOS.includes(tipo)) {
    for (const e of existentes) {
      if (e.tipo !== tipo) continue;
      const vigenteNoInicio = e.fim === null || e.fim >= novo.inicio;
      if (!vigenteNoInicio) continue;
      if (e.inicio >= novo.inicio)
        problemas.push(
          p(
            'periodo-sobreposto',
            'inicio',
            'Já há responsável deste papel a partir desta data; ajuste o início.',
          ),
        );
      else encerrar.push({ id: e.id, fim: somarDias(novo.inicio, -1) });
    }
  }
  return { problemas, encerrar: problemas.length ? [] : encerrar };
}

// ---- setores internos ----

export const TIPOS_DEPARTAMENTO_OPERADORA = [
  'autorizacao',
  'atendimento',
  'ouvidoria',
  'cadastro',
  'financeiro',
  'auditoria',
  'comercial',
  'regulacao',
  'outro',
] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface DadosDepartamento {
  readonly id: number | null;
  readonly codigo: string;
  readonly descricao: string;
  readonly tipo: string;
  readonly email: string | null;
  readonly emailsCopia: readonly string[];
  readonly superior: number | null;
}

/** Confere o setor; `superiores` é o mapa setor → setor superior, para recusar ciclo na hierarquia. */
export function problemasDoDepartamento(
  d: DadosDepartamento,
  superiores: ReadonlyMap<number, number | null>,
): ProblemaCadastro[] {
  const r: ProblemaCadastro[] = [];
  if (!/^[A-Za-z0-9._-]{1,30}$/.test(d.codigo))
    r.push(
      p('codigo-invalido', 'codigo', 'Código com letras, dígitos, ponto, hífen ou sublinhado (até 30).'),
    );
  if (!d.descricao.trim() || d.descricao.length > 150)
    r.push(p('descricao-invalida', 'descricao', 'Informe a descrição (até 150 caracteres).'));
  if (!(TIPOS_DEPARTAMENTO_OPERADORA as readonly string[]).includes(d.tipo))
    r.push(p('tipo-invalido', 'tipo', 'Tipo de setor fora da lista.'));
  if (d.email !== null && !EMAIL.test(d.email))
    r.push(p('email-invalido', 'email', 'E-mail do setor inválido.'));
  if (d.emailsCopia.some((e) => !EMAIL.test(e)))
    r.push(p('email-invalido', 'emailsCopia', 'Há e-mail de cópia inválido.'));
  if (d.superior !== null) {
    if (d.id !== null && d.superior === d.id)
      r.push(p('hierarquia-circular', 'superior', 'O setor não pode ser superior de si mesmo.'));
    else if (d.id !== null) {
      const vistos = new Set<number>();
      let atual: number | null = d.superior;
      while (atual !== null && !vistos.has(atual)) {
        if (atual === d.id) {
          r.push(p('hierarquia-circular', 'superior', 'O superior escolhido está abaixo deste setor.'));
          break;
        }
        vistos.add(atual);
        atual = superiores.get(atual) ?? null;
      }
    }
  }
  return r;
}

// ---- parâmetros gerais por operadora ----

type DefParametro =
  | {
      readonly tipo: 'inteiro';
      readonly min: number;
      readonly max: number;
      readonly padrao: number;
      readonly descricao: string;
    }
  | {
      readonly tipo: 'decimal';
      readonly min: number;
      readonly max: number;
      readonly padrao: number;
      readonly descricao: string;
    }
  | { readonly tipo: 'booleano'; readonly padrao: boolean; readonly descricao: string };

/** O catálogo fechado dos parâmetros da operadora, com tipo, faixa e valor padrão (o legal, quando há). */
export const PARAMETROS_OPERADORA = {
  dias_inadimplencia_cancelamento: {
    tipo: 'inteiro',
    min: 61,
    max: 365,
    padrao: 61,
    descricao: 'Dias de atraso a partir dos quais o contrato individual pode ser cancelado (lei: mais de 60)',
  },
  dia_limite_notificacao_inadimplencia: {
    tipo: 'inteiro',
    min: 1,
    max: 50,
    padrao: 50,
    descricao: 'Dia de atraso até o qual o beneficiário é notificado (lei: até o 50º)',
  },
  prazo_resposta_portabilidade_dias: {
    tipo: 'inteiro',
    min: 1,
    max: 10,
    padrao: 10,
    descricao: 'Prazo para responder ao pedido de portabilidade de carências',
  },
  prazo_cpt_meses: {
    tipo: 'inteiro',
    min: 1,
    max: 24,
    padrao: 24,
    descricao: 'Prazo da cobertura parcial temporária (lei: até 24 meses)',
  },
  validade_cartao_meses: {
    tipo: 'inteiro',
    min: 1,
    max: 120,
    padrao: 24,
    descricao: 'Validade do cartão do beneficiário',
  },
  cobra_segunda_via_cartao: {
    tipo: 'booleano',
    padrao: false,
    descricao: 'Cobra taxa na segunda via do cartão',
  },
  valor_taxa_segunda_via: {
    tipo: 'decimal',
    min: 0,
    max: 1000,
    padrao: 0,
    descricao: 'Valor da taxa da segunda via do cartão',
  },
} as const satisfies Record<string, DefParametro>;
export type ChaveParametroOperadora = keyof typeof PARAMETROS_OPERADORA;

/** Valida o valor do parâmetro pelo catálogo e devolve o texto normalizado que vai ao banco. */
export function valorDoParametro(
  chave: string,
  valor: unknown,
): { readonly valor: string } | { readonly problema: ProblemaCadastro } {
  const def = (PARAMETROS_OPERADORA as Record<string, DefParametro>)[chave];
  if (!def)
    return { problema: p('parametro-desconhecido', 'chave', 'Parâmetro fora do catálogo da operadora.') };
  if (def.tipo === 'booleano') {
    if (typeof valor !== 'boolean') return { problema: p('valor-invalido', 'valor', 'Informe sim ou não.') };
    return { valor: valor ? 'true' : 'false' };
  }
  const n =
    typeof valor === 'number' ? valor : typeof valor === 'string' && valor.trim() ? Number(valor) : NaN;
  if (!Number.isFinite(n) || (def.tipo === 'inteiro' && !Number.isInteger(n)))
    return {
      problema: p(
        'valor-invalido',
        'valor',
        def.tipo === 'inteiro' ? 'Informe um número inteiro.' : 'Informe um número.',
      ),
    };
  if (n < def.min || n > def.max)
    return { problema: p('valor-fora-da-faixa', 'valor', `O valor vai de ${def.min} a ${def.max}.`) };
  return { valor: def.tipo === 'decimal' ? n.toFixed(2) : String(n) };
}

/** O valor tipado lido do banco (ou o padrão, quando não há valor vigente). */
export function lerParametro(chave: ChaveParametroOperadora, bruto: string | null): number | boolean {
  const def: DefParametro = PARAMETROS_OPERADORA[chave];
  if (bruto === null) return def.padrao;
  return def.tipo === 'booleano' ? bruto === 'true' : Number(bruto);
}

// ---- aditivo do contrato ----

export const TIPOS_ADITIVO = [
  'troca_plano',
  'inclusao_plano',
  'exclusao_plano',
  'preco',
  'clausula',
  'vigencia',
  'renovacao',
  'adequacao_norma',
  'outro',
] as const;

export interface DadosAditivo {
  readonly tipo: string;
  readonly assinatura: string | null;
  readonly efeito: string;
  readonly planoAnterior: number | null;
  readonly planoNovo: number | null;
  readonly valorAnterior: number | null;
  readonly valorNovo: number | null;
  readonly novaVigenciaFim: string | null;
  readonly descricao: string;
}

export function problemasDoAditivo(
  a: DadosAditivo,
  contrato: { readonly inicio: string; readonly fim: string | null; readonly situacao: string },
): ProblemaCadastro[] {
  const r: ProblemaCadastro[] = [];
  if (!(TIPOS_ADITIVO as readonly string[]).includes(a.tipo))
    r.push(p('tipo-invalido', 'tipo', 'Tipo de aditivo fora da lista.'));
  if (contrato.situacao === 'encerrado')
    r.push(p('contrato-encerrado', 'contrato', 'Contrato encerrado não recebe aditivo.'));
  if (!dataValida(a.efeito)) r.push(p('data-invalida', 'efeito', 'Informe a data de efeito.'));
  else if (a.efeito < contrato.inicio)
    r.push(p('efeito-antes-do-contrato', 'efeito', 'O efeito não pode ser antes do início do contrato.'));
  if (
    a.assinatura !== null &&
    (!dataValida(a.assinatura) || (dataValida(a.efeito) && a.assinatura > a.efeito))
  )
    r.push(p('assinatura-invalida', 'assinatura', 'A assinatura é anterior ou igual ao efeito.'));
  if (!a.descricao.trim()) r.push(p('descricao-obrigatoria', 'descricao', 'Descreva a alteração acordada.'));
  if (a.tipo === 'troca_plano') {
    if (a.planoAnterior === null || a.planoNovo === null)
      r.push(p('planos-obrigatorios', 'planoNovo', 'A troca de plano precisa do plano anterior e do novo.'));
    else if (a.planoAnterior === a.planoNovo)
      r.push(p('planos-iguais', 'planoNovo', 'O plano novo é igual ao anterior.'));
  }
  if (
    (a.tipo === 'inclusao_plano' && a.planoNovo === null) ||
    (a.tipo === 'exclusao_plano' && a.planoAnterior === null)
  )
    r.push(
      p('plano-obrigatorio', a.tipo === 'inclusao_plano' ? 'planoNovo' : 'planoAnterior', 'Informe o plano.'),
    );
  if (a.tipo === 'preco' && a.valorNovo === null)
    r.push(p('valor-obrigatorio', 'valorNovo', 'Informe o valor novo.'));
  if ((a.valorAnterior ?? 0) < 0 || (a.valorNovo ?? 0) < 0)
    r.push(p('valor-invalido', 'valorNovo', 'Valor não pode ser negativo.'));
  if (a.tipo === 'vigencia' || a.tipo === 'renovacao') {
    if (!dataValida(a.novaVigenciaFim))
      r.push(p('vigencia-obrigatoria', 'novaVigenciaFim', 'Informe o novo fim de vigência.'));
    else if (a.novaVigenciaFim < a.efeito || (contrato.fim !== null && a.novaVigenciaFim <= contrato.fim))
      r.push(
        p('vigencia-invalida', 'novaVigenciaFim', 'O novo fim precisa ser depois do fim atual e do efeito.'),
      );
  }
  return r;
}

// ---- cancelamento do contrato ----

export const SOLICITANTES_CANCELAMENTO = [
  'titular',
  'contratante',
  'operadora',
  'inadimplencia',
  'fraude',
  'decisao_judicial',
  'obito',
] as const;

export interface PedidoCancelamento {
  readonly solicitante: string;
  readonly hoje: string;
  readonly dataEfeito: string | null;
  readonly diasAtraso: number | null;
  readonly avisoEntregueEm: string | null;
  readonly exigeNotificacao: boolean;
  readonly diasInadimplencia: number;
}

export interface PlanoCancelamento {
  readonly problemas: ProblemaCadastro[];
  readonly dataEfeito: string;
  readonly situacao: 'solicitado' | 'agendado';
}

/**
 * Decide a data de efeito e a situação do pedido de cancelamento.
 * - A pedido do titular ou do contratante: efeito imediato (na ciência), nunca retroativo.
 * - Inadimplência: só com atraso acima do limite e notificação entregue; o efeito nunca antes de 10 dias do aviso.
 */
export function planoCancelamento(x: PedidoCancelamento): PlanoCancelamento {
  const r: ProblemaCadastro[] = [];
  if (!(SOLICITANTES_CANCELAMENTO as readonly string[]).includes(x.solicitante))
    r.push(p('solicitante-invalido', 'solicitante', 'Solicitante fora da lista.'));
  const pedidoDoTitular = x.solicitante === 'titular' || x.solicitante === 'contratante';
  let efeito = x.dataEfeito ?? x.hoje;
  if (x.dataEfeito !== null && !dataValida(x.dataEfeito))
    r.push(p('data-invalida', 'dataEfeito', 'Data de efeito inválida.'));
  if (pedidoDoTitular && x.dataEfeito === null) efeito = x.hoje;
  if (dataValida(efeito) && efeito < x.hoje)
    r.push(p('efeito-retroativo', 'dataEfeito', 'O cancelamento não tem efeito retroativo.'));
  const inadimplencia = x.solicitante === 'inadimplencia' || x.exigeNotificacao;
  if (inadimplencia) {
    if (x.diasAtraso === null || x.diasAtraso < x.diasInadimplencia)
      r.push(
        p(
          'atraso-insuficiente',
          'diasAtraso',
          `O cancelamento por falta de pagamento exige ao menos ${x.diasInadimplencia} dias de atraso.`,
        ),
      );
    if (!dataValida(x.avisoEntregueEm))
      r.push(
        p('notificacao-obrigatoria', 'avisoEntregueEm', 'Registre a entrega da notificação ao beneficiário.'),
      );
    else if (dataValida(efeito) && efeito < somarDias(x.avisoEntregueEm, 10))
      r.push(p('prazo-notificacao', 'dataEfeito', 'O efeito vem ao menos 10 dias depois da notificação.'));
  }
  return { problemas: r, dataEfeito: efeito, situacao: efeito > x.hoje ? 'agendado' : 'solicitado' };
}

/** O pedido pode ser efetivado: solicitado ou agendado com a data de efeito alcançada. */
export function podeEfetivarCancelamento(
  situacao: string,
  dataEfeito: string,
  hoje: string,
): ProblemaCadastro | null {
  if (situacao !== 'solicitado' && situacao !== 'agendado')
    return p('situacao-invalida', 'situacao', 'Só o pedido solicitado ou agendado é efetivado.');
  if (dataEfeito > hoje) return p('efeito-futuro', 'dataEfeito', 'A data de efeito ainda não chegou.');
  return null;
}

// ---- área de abrangência do produto ----

export interface AreaAbrangencia {
  readonly tipo: 'municipio' | 'estado';
  readonly codigoIbge: string;
}

/** A lista de áreas é coerente com a abrangência registrada do produto (RN 543: nacional, estadual, municipal...). */
export function problemasDaAbrangencia(
  abrangencia: string,
  areas: readonly AreaAbrangencia[],
): ProblemaCadastro[] {
  const r: ProblemaCadastro[] = [];
  const estados = areas.filter((a) => a.tipo === 'estado');
  const municipios = areas.filter((a) => a.tipo === 'municipio');
  if (
    estados.some((a) => !/^\d{2}$/.test(a.codigoIbge)) ||
    municipios.some((a) => !/^\d{7}$/.test(a.codigoIbge))
  )
    r.push(
      p('codigo-ibge-invalido', 'areas', 'Código do IBGE inválido (2 dígitos no estado, 7 no município).'),
    );
  if (new Set(areas.map((a) => `${a.tipo}:${a.codigoIbge}`)).size !== areas.length)
    r.push(p('area-repetida', 'areas', 'Há área repetida.'));
  const exige = (ok: boolean, detalhe: string) => {
    if (!ok) r.push(p('abrangencia-incoerente', 'areas', detalhe));
  };
  switch (abrangencia) {
    case 'nacional':
      exige(areas.length === 0, 'O produto nacional cobre todo o país: não liste áreas.');
      break;
    case 'estadual':
      exige(
        estados.length === 1 && municipios.length === 0,
        'O produto estadual cobre exatamente um estado.',
      );
      break;
    case 'grupo_estados':
      exige(estados.length >= 2 && municipios.length === 0, 'O grupo de estados lista dois ou mais estados.');
      break;
    case 'municipal':
      exige(
        municipios.length === 1 && estados.length === 0,
        'O produto municipal cobre exatamente um município.',
      );
      break;
    case 'grupo_municipios':
      exige(
        municipios.length >= 2 && estados.length === 0,
        'O grupo de municípios lista dois ou mais municípios.',
      );
      break;
    default:
      r.push(p('abrangencia-desconhecida', 'abrangencia', 'Abrangência do produto fora da lista.'));
  }
  return r;
}

// ---- carências aplicadas ao beneficiário ----

export type CategoriaCarencia = 'urgencia' | 'parto' | 'demais' | 'cpt';
/** Teto legal em dias por categoria (Lei 9.656/98, art. 12 V; CPT 24 meses). */
export const TETO_CARENCIA_DIAS: Readonly<Record<CategoriaCarencia, number>> = {
  urgencia: 1,
  parto: 300,
  demais: 180,
  cpt: 730,
};

export const categoriaDoGrupo = (tipoCarencia: string): CategoriaCarencia =>
  tipoCarencia === 'urgencia_emergencia'
    ? 'urgencia'
    : tipoCarencia === 'parto'
      ? 'parto'
      : tipoCarencia === 'doenca_preexistente'
        ? 'cpt'
        : 'demais';

export interface CarenciaDoProduto {
  readonly grupo: number;
  readonly tipoCarencia: string;
  readonly dias: number;
  readonly isento: boolean;
}

export interface CarenciaAplicada {
  readonly grupo: number;
  readonly categoria: CategoriaCarencia;
  readonly inicio: string;
  readonly dias: number;
  readonly aproveitados: number;
  readonly cumpridaEm: string;
}

/**
 * As carências efetivas do beneficiário a partir da adesão: o prazo do produto limitado ao teto legal, menos os dias
 * aproveitados (portabilidade ou plano anterior), nunca abaixo de zero. Grupo isento não gera linha.
 */
export function carenciasAplicadas(
  adesao: string,
  doProduto: readonly CarenciaDoProduto[],
  aproveitamentoDias = 0,
): CarenciaAplicada[] {
  return doProduto
    .filter((c) => !c.isento)
    .map((c) => {
      const categoria = categoriaDoGrupo(c.tipoCarencia);
      const dias = Math.max(0, Math.min(c.dias, TETO_CARENCIA_DIAS[categoria]));
      const aproveitados = Math.max(0, Math.min(aproveitamentoDias, dias));
      return {
        grupo: c.grupo,
        categoria,
        inicio: adesao,
        dias,
        aproveitados,
        cumpridaEm: somarDias(adesao, dias - aproveitados),
      };
    });
}

// ---- pedido de cartão ----

export const SITUACOES_PEDIDO_CARTAO = ['solicitado', 'emitido', 'entregue', 'cancelado'] as const;
export type SituacaoPedidoCartao = (typeof SITUACOES_PEDIDO_CARTAO)[number];
const PASSOS_CARTAO: Readonly<Record<SituacaoPedidoCartao, readonly SituacaoPedidoCartao[]>> = {
  solicitado: ['emitido', 'cancelado'],
  emitido: ['entregue'],
  entregue: [],
  cancelado: [],
};

/** O passo do pedido de cartão é permitido (solicitado → emitido → entregue; solicitado → cancelado). */
export function passoDoPedidoCartao(de: string, para: string): ProblemaCadastro | null {
  const permitidos = PASSOS_CARTAO[de as SituacaoPedidoCartao];
  if (!permitidos) return p('situacao-invalida', 'situacao', 'Situação atual do pedido desconhecida.');
  return permitidos.includes(para as SituacaoPedidoCartao)
    ? null
    : p('passo-invalido', 'situacao', 'Este passo não é permitido para a situação atual do pedido.');
}

/** O pedido de segunda via exige motivo; a taxa só quando a operadora cobra. */
export function problemasDoPedidoCartao(x: {
  readonly primeiraVia: boolean;
  readonly motivo: number | null;
  readonly cobraTaxa: boolean;
  readonly valorTaxa: number | null;
}): ProblemaCadastro[] {
  const r: ProblemaCadastro[] = [];
  if (!x.primeiraVia && x.motivo === null)
    r.push(p('motivo-obrigatorio', 'motivo', 'A segunda via precisa do motivo.'));
  if (x.cobraTaxa && (x.valorTaxa === null || x.valorTaxa < 0))
    r.push(p('taxa-invalida', 'valorTaxa', 'Informe o valor da taxa.'));
  return r;
}
