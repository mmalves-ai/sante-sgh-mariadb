// Seções configuráveis do sumário de alta (F3.3, linha 03-PEP L124): cada estabelecimento (ou o cliente inteiro)
// escolhe quais seções o sumário tem, em que ordem, quais são obrigatórias, por tipo de atendimento, e o recorte de
// tempo dos dados trazidos do episódio (atendimento inteiro, últimas 24 ou 72 horas, último registro).
// Regras puras: validação do cadastro na hora, resolução das seções que valem (a mais específica ganha), pendências
// das obrigatórias antes de finalizar e a janela de tempo de cada seção. Sem configuração, vale o conjunto padrão.
import type { SumarioAltaEstruturado } from '@sgh/contratos';

export const TIPOS_CONTEUDO_SECAO = [
  'texto_livre',
  'diagnosticos',
  'procedimentos',
  'exames',
  'medicamentos',
  'evolucao_clinica',
  'plano_terapeutico',
  'orientacoes',
  'alergias',
  'dispositivos',
  'condicao_alta',
] as const;
export type TipoConteudoSecao = (typeof TIPOS_CONTEUDO_SECAO)[number];

export const TIPOS_ATENDIMENTO_SECAO = [
  'todos',
  'internacao',
  'pronto_atendimento',
  'ambulatorio',
  'hospital_dia',
] as const;
export type TipoAtendimentoSecao = (typeof TIPOS_ATENDIMENTO_SECAO)[number];

export const PERIODOS_SECAO = [
  'atendimento_inteiro',
  'ultimas_24_horas',
  'ultimas_72_horas',
  'ultimo_registro',
] as const;
export type PeriodoSecao = (typeof PERIODOS_SECAO)[number];

/** Tipos que trazem dados do episódio e por isso aceitam recorte de tempo. */
export const TIPOS_COM_PERIODO: ReadonlySet<TipoConteudoSecao> = new Set([
  'diagnosticos',
  'procedimentos',
  'exames',
  'medicamentos',
  'evolucao_clinica',
  'dispositivos',
]);

export interface ComponenteSumario {
  readonly estabelecimento: number | null;
  readonly codigo: string;
  readonly descricao: string;
  readonly tipoConteudo: TipoConteudoSecao;
  readonly tipoAtendimento: TipoAtendimentoSecao;
  readonly ordem: number;
  readonly obrigatorio: boolean;
  readonly periodo: PeriodoSecao | null;
  /** Período próprio do cliente (cadastro de períodos); quando informado, vale no lugar do recorte fixo. */
  readonly periodoConsulta?: number | null;
  readonly ativo: boolean;
}

/** Período próprio do cliente, como a resolução precisa dele. */
export interface PeriodoProprio {
  readonly atendimentoInteiro: boolean;
  readonly horasRetroativas: number | null;
  readonly ativo: boolean;
}

export interface SecaoVigente {
  readonly codigo: string;
  readonly descricao: string;
  readonly tipoConteudo: TipoConteudoSecao;
  readonly ordem: number;
  readonly obrigatorio: boolean;
  readonly periodo: PeriodoSecao | null;
  /** Período próprio escolhido na seção (id) e as horas dele; nulo quando vale o recorte fixo. */
  readonly periodoConsulta?: number | null;
  readonly horasRetroativas?: number | null;
  /** De onde a seção veio: do estabelecimento, do cliente inteiro ou do conjunto padrão. */
  readonly origem: 'estabelecimento' | 'cliente' | 'padrao';
}

export interface ErroSecao {
  readonly campo: string;
  readonly codigo: string;
  readonly mensagem: string;
}

/** Conjunto padrão, quando nada está configurado: o mínimo que a regra de finalização já exigia. */
export const SECOES_PADRAO: readonly SecaoVigente[] = [
  {
    codigo: 'motivo',
    descricao: 'Motivo da internação',
    tipoConteudo: 'texto_livre',
    ordem: 10,
    obrigatorio: false,
    periodo: null,
    origem: 'padrao',
  },
  {
    codigo: 'diagnosticos',
    descricao: 'Diagnósticos',
    tipoConteudo: 'diagnosticos',
    ordem: 20,
    obrigatorio: true,
    periodo: 'atendimento_inteiro',
    origem: 'padrao',
  },
  {
    codigo: 'procedimentos',
    descricao: 'Procedimentos',
    tipoConteudo: 'procedimentos',
    ordem: 30,
    obrigatorio: false,
    periodo: 'atendimento_inteiro',
    origem: 'padrao',
  },
  {
    codigo: 'evolucao',
    descricao: 'Evolução',
    tipoConteudo: 'evolucao_clinica',
    ordem: 40,
    obrigatorio: false,
    periodo: 'atendimento_inteiro',
    origem: 'padrao',
  },
  {
    codigo: 'alergias',
    descricao: 'Alergias',
    tipoConteudo: 'alergias',
    ordem: 50,
    obrigatorio: false,
    periodo: null,
    origem: 'padrao',
  },
  {
    codigo: 'medicamentos',
    descricao: 'Medicamentos na alta',
    tipoConteudo: 'medicamentos',
    ordem: 60,
    obrigatorio: false,
    periodo: 'ultimo_registro',
    origem: 'padrao',
  },
  {
    codigo: 'plano',
    descricao: 'Plano pós-alta',
    tipoConteudo: 'plano_terapeutico',
    ordem: 70,
    obrigatorio: true,
    periodo: null,
    origem: 'padrao',
  },
  {
    codigo: 'condicao',
    descricao: 'Condição na alta',
    tipoConteudo: 'condicao_alta',
    ordem: 80,
    obrigatorio: true,
    periodo: null,
    origem: 'padrao',
  },
];

const CODIGO = /^[a-z0-9][a-z0-9_-]{0,29}$/;

/** Tipos sem campo próprio no sumário: o conteúdo é o texto da seção (em `secoes`, pelo código). */
export const TIPOS_DE_TEXTO: ReadonlySet<TipoConteudoSecao> = new Set([
  'texto_livre',
  'orientacoes',
  'exames',
  'dispositivos',
]);

/**
 * Piso legal: o diagnóstico é conteúdo mínimo do sumário de alta (CIT 33/2017; Portaria GM/MS 8.026/2025) e não sai
 * pela configuração. Tudo o mais (condição na alta, plano, seções próprias) segue o que o estabelecimento configurou.
 */
export const PISO_LEGAL_SUMARIO: readonly TipoConteudoSecao[] = ['diagnosticos'];

/** Validação do cadastro da seção, na hora (a tela mostra o erro no campo). */
export function validarComponenteSumario(c: Omit<ComponenteSumario, 'ativo'>): ErroSecao[] {
  const r: ErroSecao[] = [];
  if (!CODIGO.test(c.codigo))
    r.push({
      campo: 'codigo',
      codigo: 'codigo-invalido',
      mensagem: 'Use até 30 letras minúsculas, números, hífen ou sublinhado, sem espaço.',
    });
  if (!c.descricao.trim())
    r.push({ campo: 'descricao', codigo: 'descricao-vazia', mensagem: 'Informe o título da seção.' });
  if (c.periodo !== null && !TIPOS_COM_PERIODO.has(c.tipoConteudo))
    r.push({
      campo: 'periodo',
      codigo: 'periodo-sem-dados',
      mensagem: 'O recorte de tempo só vale para seções que trazem dados do episódio.',
    });
  if ((c.periodoConsulta ?? null) !== null && c.periodo !== null)
    r.push({
      campo: 'periodo',
      codigo: 'periodo-duplo',
      mensagem: 'Escolha o recorte fixo ou um período próprio, não os dois.',
    });
  if ((c.periodoConsulta ?? null) !== null && !TIPOS_COM_PERIODO.has(c.tipoConteudo))
    r.push({
      campo: 'periodo',
      codigo: 'periodo-sem-dados',
      mensagem: 'O recorte de tempo só vale para seções que trazem dados do episódio.',
    });
  if (c.ordem < 0 || c.ordem > 9999 || !Number.isInteger(c.ordem))
    r.push({ campo: 'ordem', codigo: 'ordem-invalida', mensagem: 'A ordem vai de 0 a 9999.' });
  return r;
}

function peso(c: ComponenteSumario): number {
  return (c.estabelecimento !== null ? 2 : 0) + (c.tipoAtendimento !== 'todos' ? 1 : 0);
}

/**
 * As seções que valem para o estabelecimento e o tipo de atendimento. Para cada código ganha a linha mais específica
 * (estabelecimento antes do cliente; tipo de atendimento antes de "todos"); se a mais específica está inativa, a seção
 * sai do sumário (é assim que um estabelecimento tira uma seção do cliente). Sem nenhuma linha que se aplique, vale o
 * conjunto padrão. O período próprio (ativo) vale no lugar do recorte fixo; retirado de uso, a seção volta a trazer o
 * atendimento inteiro.
 */
export function resolverSecoesSumario(
  componentes: readonly ComponenteSumario[],
  estabelecimento: number,
  tipo: TipoAtendimentoSecao,
  periodos: ReadonlyMap<number, PeriodoProprio> = new Map(),
): SecaoVigente[] {
  const aplicaveis = componentes.filter(
    (c) =>
      (c.estabelecimento === null || c.estabelecimento === estabelecimento) &&
      (c.tipoAtendimento === 'todos' || c.tipoAtendimento === tipo),
  );
  if (aplicaveis.length === 0) return [...SECOES_PADRAO];
  const porCodigo = new Map<string, ComponenteSumario>();
  for (const c of aplicaveis) {
    const a = porCodigo.get(c.codigo);
    if (!a || peso(c) > peso(a)) porCodigo.set(c.codigo, c);
  }
  return [...porCodigo.values()]
    .filter((c) => c.ativo)
    .map((c) => {
      const id = c.periodoConsulta ?? null;
      const p = id !== null ? periodos.get(id) : undefined;
      const proprio = id !== null && p !== undefined && p.ativo;
      return {
        codigo: c.codigo,
        descricao: c.descricao,
        tipoConteudo: c.tipoConteudo,
        ordem: c.ordem,
        obrigatorio: c.obrigatorio,
        periodo: proprio
          ? p.atendimentoInteiro
            ? ('atendimento_inteiro' as const)
            : null
          : id !== null
            ? ('atendimento_inteiro' as const)
            : c.periodo,
        periodoConsulta: proprio ? id : null,
        horasRetroativas: proprio && !p.atendimentoInteiro ? p.horasRetroativas : null,
        origem: c.estabelecimento !== null ? ('estabelecimento' as const) : ('cliente' as const),
      };
    })
    .sort((a, b) => a.ordem - b.ordem || a.descricao.localeCompare(b.descricao, 'pt-BR'));
}

const preenchido = (s: string | undefined) => (s?.trim().length ?? 0) > 0;

/** O texto da seção no sumário (pelo código), sem espaços nas pontas. */
export function textoDaSecao(s: SumarioAltaEstruturado, codigo: string): string {
  return (s.secoes ?? []).find((x) => x.codigo === codigo)?.texto.trim() ?? '';
}

/**
 * Se a seção tem conteúdo no sumário. Os tipos estruturados olham só o campo deles (um diagnóstico obrigatório não
 * passa com texto solto, sem CID); os tipos de texto olham o texto da seção pelo código (a seção "motivo" também o
 * motivo da internação).
 */
export function secaoPreenchida(secao: SecaoVigente, s: SumarioAltaEstruturado): boolean {
  switch (secao.tipoConteudo) {
    case 'diagnosticos':
      return s.diagnosticos.length > 0;
    case 'procedimentos':
      return s.procedimentos.length > 0;
    case 'medicamentos':
      return s.medicamentosAlta.length > 0;
    case 'alergias':
      return s.alergias.length > 0;
    case 'evolucao_clinica':
      return preenchido(s.evolucao);
    case 'plano_terapeutico':
      return preenchido(s.plano) || s.encaminhamentos.length > 0;
    case 'condicao_alta':
      return preenchido(s.condicaoAlta);
    case 'texto_livre':
      return (
        textoDaSecao(s, secao.codigo).length > 0 ||
        (secao.codigo === 'motivo' && preenchido(s.motivoInternacao))
      );
    default:
      return textoDaSecao(s, secao.codigo).length > 0;
  }
}

/** O campo do formulário da seção (os estruturados apontam para o campo próprio; os de texto, para a seção). */
export function campoDaSecao(secao: SecaoVigente): string {
  switch (secao.tipoConteudo) {
    case 'diagnosticos':
      return 'diagnosticos';
    case 'condicao_alta':
      return 'condicaoAlta';
    case 'plano_terapeutico':
      return 'plano';
    default:
      return `secao.${secao.codigo}`;
  }
}

/** As seções obrigatórias sem conteúdo: a finalização é recusada com a lista, campo a campo. */
export function pendenciasDasSecoes(
  secoes: readonly SecaoVigente[],
  s: SumarioAltaEstruturado,
): { campo: string; motivo: string }[] {
  return secoes
    .filter((x) => x.obrigatorio && !secaoPreenchida(x, s))
    .map((x) => ({ campo: campoDaSecao(x), motivo: `Preencha a seção "${x.descricao}".` }));
}

/**
 * O sumário só com o texto das seções vigentes de texto: código fora das seções que valem (ou de seção estruturada,
 * ou retirada de uso) é descartado, e o título é a descrição do cadastro, nunca o que veio do navegador.
 */
export function sumarioNasSecoes(
  s: SumarioAltaEstruturado,
  secoes: readonly SecaoVigente[],
): SumarioAltaEstruturado {
  const resto: SumarioAltaEstruturado = { ...s };
  delete resto.secoes;
  const r = secoes
    .filter((x) => TIPOS_DE_TEXTO.has(x.tipoConteudo))
    .map((x) => ({ codigo: x.codigo, titulo: x.descricao, texto: textoDaSecao(s, x.codigo) }))
    .filter((x) => x.texto.length > 0);
  return r.length ? { ...resto, secoes: r } : resto;
}

/**
 * A janela de tempo dos dados da seção. `ultimo_registro` devolve a janela do atendimento inteiro com `ultimo = true`
 * (quem monta pega só o registro mais recente). Horas próprias do cliente (cadastro de períodos) entram por
 * `horasRetroativas`, que vale sobre o código fixo.
 */
export function janelaDaSecao(
  periodo: PeriodoSecao | null,
  abertura: Date,
  alta: Date,
  horasRetroativas: number | null = null,
): { desde: Date; ate: Date; ultimo: boolean } {
  const horas =
    horasRetroativas ?? (periodo === 'ultimas_24_horas' ? 24 : periodo === 'ultimas_72_horas' ? 72 : null);
  if (horas === null) return { desde: abertura, ate: alta, ultimo: periodo === 'ultimo_registro' };
  const desde = new Date(alta.getTime() - horas * 3_600_000);
  return { desde: desde < abertura ? abertura : desde, ate: alta, ultimo: false };
}

/** Validação do cadastro de período: ou o atendimento inteiro, ou horas retroativas de 1 a 720. */
export function validarPeriodoConsulta(p: {
  codigo: string;
  descricao: string;
  atendimentoInteiro: boolean;
  horasRetroativas: number | null;
}): ErroSecao[] {
  const r: ErroSecao[] = [];
  if (!CODIGO.test(p.codigo))
    r.push({ campo: 'codigo', codigo: 'codigo-invalido', mensagem: 'Código sem espaço, até 30 caracteres.' });
  if (!p.descricao.trim())
    r.push({ campo: 'descricao', codigo: 'descricao-vazia', mensagem: 'Informe a descrição.' });
  if (
    !p.atendimentoInteiro &&
    (p.horasRetroativas === null || p.horasRetroativas < 1 || p.horasRetroativas > 720)
  )
    r.push({
      campo: 'horasRetroativas',
      codigo: 'horas-invalidas',
      mensagem: 'Informe de 1 a 720 horas, ou marque o atendimento inteiro.',
    });
  return r;
}
