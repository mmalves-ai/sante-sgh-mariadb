// Campos obrigatórios do cadastro por estabelecimento, módulo de recepção, tipo de atendimento e fonte pagadora (F3.1,
// 02-CAD linha 2). Regra pura: a regra mais específica de cada campo vale (estabelecimento > fonte pagadora > módulo
// > tipo de atendimento); a regra inativa não vale. Os campos são os do contrato do cadastro do paciente (nomes de
// negócio da tela), nunca os códigos de coluna de um parâmetro antigo.
//   - Campos fixos (o modelo e o contrato exigem sempre): só aceitam "obrigatorio" ou "somente_leitura".
//   - No cadastro, falta o campo obrigatório vazio. Na alteração, falta o obrigatório que a tela manda apagar e é
//     recusada a mudança de campo "somente_leitura".

export const EXIGENCIAS_CAMPO = ['obrigatorio', 'opcional', 'oculto', 'somente_leitura'] as const;
export type ExigenciaCampo = (typeof EXIGENCIAS_CAMPO)[number];

export const TIPOS_ATENDIMENTO_REGRA = [
  'todos',
  'ambulatorial',
  'urgencia',
  'internacao',
  'externo',
  'domiciliar',
] as const;
export type TipoAtendimentoRegra = (typeof TIPOS_ATENDIMENTO_REGRA)[number];

/** Campos do cadastro do paciente que a regra pode citar, com o rótulo padrão da tela. */
export const CAMPOS_REGRA_PACIENTE: Readonly<Record<string, string>> = Object.freeze({
  nome: 'Nome',
  nascimento: 'Data de nascimento',
  sexo: 'Sexo',
  cpf: 'CPF',
  naturalidade: 'Naturalidade',
  cep: 'CEP',
  nomeMae: 'Nome da mãe',
  ufNaturalidade: 'UF da naturalidade',
  logradouro: 'Logradouro',
  numero: 'Número',
  complemento: 'Complemento',
  bairro: 'Bairro',
  celular: 'Celular',
  telefone: 'Telefone',
  email: 'E-mail',
  contatoNome: 'Nome do contato',
  contatoTelefone: 'Telefone do contato',
});

/** Exigidos sempre pelo modelo: a regra não os torna opcionais nem ocultos. */
export const CAMPOS_FIXOS_PACIENTE: readonly string[] = [
  'nome',
  'nascimento',
  'sexo',
  'cpf',
  'naturalidade',
  'cep',
];

export interface RegraCampo {
  readonly id?: number;
  readonly campo: string;
  /** Nulo: regra de toda a rede. */
  readonly estabelecimento: number | null;
  /** Nulo: todos os módulos de recepção. */
  readonly modulo: number | null;
  readonly tipoAtendimento: TipoAtendimentoRegra;
  /** Nulo: todas as fontes pagadoras. */
  readonly fontePagadora: number | null;
  readonly exigencia: ExigenciaCampo;
  readonly rotulo?: string | null;
  readonly ativo?: boolean;
}

export interface EscopoRegra {
  readonly estabelecimento: number | null;
  readonly modulo?: number | null;
  readonly tipoAtendimento?: TipoAtendimentoRegra | null;
  readonly fontePagadora?: number | null;
}

export interface CampoRecusado {
  readonly campo: string;
  readonly rotulo: string;
  readonly motivo: 'obrigatorio' | 'somente_leitura';
}

/** Erros de uma regra antes de gravar (lista vazia: válida). */
export function errosDaRegra(r: Pick<RegraCampo, 'campo' | 'exigencia' | 'tipoAtendimento'>): string[] {
  const erros: string[] = [];
  if (!(r.campo in CAMPOS_REGRA_PACIENTE)) erros.push('campo-desconhecido');
  if (!EXIGENCIAS_CAMPO.includes(r.exigencia)) erros.push('exigencia-invalida');
  if (!TIPOS_ATENDIMENTO_REGRA.includes(r.tipoAtendimento)) erros.push('tipo-atendimento-invalido');
  if (CAMPOS_FIXOS_PACIENTE.includes(r.campo) && (r.exigencia === 'opcional' || r.exigencia === 'oculto'))
    erros.push('campo-fixo');
  return erros;
}

/** Peso da regra no escopo; nulo quando a regra não se aplica a ele. */
export function especificidade(r: RegraCampo, e: EscopoRegra): number | null {
  if (r.ativo === false) return null;
  if (r.estabelecimento !== null && r.estabelecimento !== e.estabelecimento) return null;
  if (r.fontePagadora !== null && r.fontePagadora !== (e.fontePagadora ?? null)) return null;
  if (r.modulo !== null && r.modulo !== (e.modulo ?? null)) return null;
  if (r.tipoAtendimento !== 'todos' && r.tipoAtendimento !== (e.tipoAtendimento ?? null)) return null;
  return (
    (r.estabelecimento !== null ? 8 : 0) +
    (r.fontePagadora !== null ? 4 : 0) +
    (r.modulo !== null ? 2 : 0) +
    (r.tipoAtendimento !== 'todos' ? 1 : 0)
  );
}

/** A regra que vale para cada campo no escopo (a mais específica; empate: a de maior id, a mais nova). */
export function regrasNoEscopo(regras: readonly RegraCampo[], e: EscopoRegra): Map<string, RegraCampo> {
  const melhor = new Map<string, { r: RegraCampo; peso: number }>();
  for (const r of regras) {
    const peso = especificidade(r, e);
    if (peso === null) continue;
    const atual = melhor.get(r.campo);
    if (!atual || peso > atual.peso || (peso === atual.peso && (r.id ?? 0) > (atual.r.id ?? 0)))
      melhor.set(r.campo, { r, peso });
  }
  return new Map([...melhor].map(([c, x]) => [c, x.r]));
}

const vazio = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

// Campo que o cadastro pode declarar ausente: a declaração atende a obrigatoriedade (a mãe registrada como
// desconhecida não deixa o paciente sem saída, nem obriga a digitar um nome falso).
const DECLARADO_AUSENTE: Readonly<Record<string, string>> = Object.freeze({ nomeMae: 'maeDesconhecida' });
const falta = (dados: Readonly<Record<string, unknown>>, campo: string): boolean => {
  const declaracao = Object.prototype.hasOwnProperty.call(DECLARADO_AUSENTE, campo)
    ? DECLARADO_AUSENTE[campo]
    : undefined;
  return vazio(dados[campo]) && !(declaracao !== undefined && dados[declaracao] === true);
};

/**
 * Campos recusados pela regra. Cadastro: todo obrigatório vazio. Alteração: só os campos enviados (o obrigatório
 * mandado apagar; o somente leitura mandado mudar).
 */
export function camposRecusados(
  regras: readonly RegraCampo[],
  e: EscopoRegra,
  dados: Readonly<Record<string, unknown>>,
  modo: 'cadastro' | 'alteracao',
): CampoRecusado[] {
  const fora: CampoRecusado[] = [];
  for (const [campo, r] of regrasNoEscopo(regras, e)) {
    const rotulo = r.rotulo?.trim() || CAMPOS_REGRA_PACIENTE[campo] || campo;
    const enviado = Object.prototype.hasOwnProperty.call(dados, campo) && dados[campo] !== undefined;
    if (
      r.exigencia === 'obrigatorio' &&
      (modo === 'cadastro' ? falta(dados, campo) : enviado && falta(dados, campo))
    )
      fora.push({ campo, rotulo, motivo: 'obrigatorio' });
    if (r.exigencia === 'somente_leitura' && modo === 'alteracao' && enviado)
      fora.push({ campo, rotulo, motivo: 'somente_leitura' });
  }
  return fora.sort((a, b) => a.campo.localeCompare(b.campo));
}

// ── Abertura do atendimento (recepção, pronto atendimento, exames e internação) ──
// O atendimento só abre com o cadastro do paciente completo no escopo em que a recepção trabalha. A conferência é a
// mesma do cadastro novo (todo obrigatório do escopo preenchido); "somente leitura", "opcional" e "oculto" não
// impedem a abertura. O cadastro provisório (paciente ainda não identificado da urgência) nunca é barrado: a
// identificação fica pendente e o cadastro é completado depois.

/** Tipo de atendimento da regra pelo código do tipo com que a recepção abre o atendimento (nulo: só a regra geral). */
const TIPO_REGRA_DA_ABERTURA: Readonly<Record<string, TipoAtendimentoRegra>> = Object.freeze({
  consulta: 'ambulatorial',
  pa: 'urgencia',
  exame: 'externo',
  requisicaoLab: 'externo',
  internacao: 'internacao',
  domiciliar: 'domiciliar',
});

export function tipoAtendimentoDaAbertura(codigo: string | null | undefined): TipoAtendimentoRegra | null {
  return codigo && Object.prototype.hasOwnProperty.call(TIPO_REGRA_DA_ABERTURA, codigo)
    ? (TIPO_REGRA_DA_ABERTURA[codigo] as TipoAtendimentoRegra)
    : null;
}

export interface RecusaAberturaPorCadastro {
  readonly codigo: 'cadastro-incompleto';
  readonly detalhe: string;
  /** Os campos do cadastro que faltam, em ordem alfabética. */
  readonly campos: readonly string[];
  readonly pendentes: readonly { readonly campo: string; readonly rotulo: string }[];
}

/** Recusa da abertura do atendimento quando o cadastro do paciente não cumpre a regra do escopo (nulo: pode abrir). */
export function recusaAberturaPorCadastro(
  regras: readonly RegraCampo[],
  e: EscopoRegra,
  dados: Readonly<Record<string, unknown>>,
  opcoes: { readonly provisorio?: boolean } = {},
): RecusaAberturaPorCadastro | null {
  if (opcoes.provisorio) return null;
  const pendentes = camposRecusados(regras, e, dados, 'cadastro')
    .filter((f) => f.motivo === 'obrigatorio')
    .map(({ campo, rotulo }) => ({ campo, rotulo }));
  if (pendentes.length === 0) return null;
  return {
    codigo: 'cadastro-incompleto',
    detalhe: `Complete o cadastro do paciente antes de abrir o atendimento: ${pendentes.map((p) => p.rotulo).join(', ')}.`,
    campos: pendentes.map((p) => p.campo),
    pendentes,
  };
}
