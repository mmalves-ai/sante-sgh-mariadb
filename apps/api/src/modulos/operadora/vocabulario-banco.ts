// Correspondência entre os códigos do contrato da operadora (@sgh/contratos: os códigos do padrão da ANS que a tela
// usa) e os valores que o banco do cliente guarda (texto de negócio conferido por CHECK no DDL). Só a porta própria usa;
// a regra de negócio continua no domínio. Um código sem valor no banco (ainda sem lugar no CHECK) fica de fora: a tela
// não o oferece e a gravação o recusa como domínio inválido (pedido de DDL registrado na saída do lote).
// Melhoria: o banco guarda o significado (ex.: 'assistencia_hospitalar'), não um número de tabela de outro sistema.

/** Mapa nos dois sentidos de um vocabulário fechado. */
export class Vocabulario<C extends number | string> {
  private readonly reverso: ReadonlyMap<string, C>;
  constructor(
    readonly paraBanco: Readonly<Record<C, string>>,
    leitura: Readonly<Record<string, C>> = {},
  ) {
    const r = new Map<string, C>();
    for (const [k, v] of Object.entries(paraBanco) as [string, string][])
      r.set(v, (/^\d+$/.test(k) ? Number(k) : k) as C);
    for (const [v, k] of Object.entries(leitura)) if (!r.has(v)) r.set(v, k);
    this.reverso = r;
  }
  /** Valor do banco do código (null: o banco ainda não aceita o código). */
  banco(c: C): string | null {
    return (this.paraBanco as Record<string, string>)[String(c)] ?? null;
  }
  /** Código do contrato do valor do banco (null: valor sem código no contrato). */
  codigo(v: unknown): C | null {
    return v === null || v === undefined ? null : (this.reverso.get(String(v)) ?? null);
  }
  /** Códigos aceitos pelo banco. */
  codigos(): C[] {
    return Object.keys(this.paraBanco).map((k) => (/^\d+$/.test(k) ? Number(k) : k) as C);
  }
}

// ---- rede credenciada ----

/** Classificação do estabelecimento na rede: 1 hospitalar, 2 alta complexidade, 3 demais. */
export const CLASSIFICACAO = new Vocabulario<number>(
  { 1: 'assistencia_hospitalar', 2: 'servico_alta_complexidade', 3: 'outros' },
  { servico_apoio_diagnostico: 3, clinica_ambulatorial: 3, consultorio: 3 },
);
export const CONTRATACAO = new Vocabulario<number>({ 1: 'direta', 2: 'indireta' });
export const DISPONIBILIDADE = new Vocabulario<number>({ 1: 'total', 2: 'parcial' });
export const ISENCAO_ONUS = new Vocabulario<number>({ 1: 'nao_informado', 2: 'isento', 3: 'nao_isento' });
/**
 * Modelo de remuneração: o CHECK do banco ainda não tem orçamentação (3), DRG (5) e os dois bundles (6, 7): pedido de
 * DDL na saída do lote. Até lá a tela não os oferece.
 */
export const REMUNERACAO = new Vocabulario<number>({ 1: 'procedimento', 2: 'pacote', 4: 'capitacao' });
export const FORMA_REAJUSTE = new Vocabulario<number>({
  1: 'ipca',
  2: 'igpm',
  3: 'inpc',
  4: 'outro_indice',
  5: 'livre_negociacao',
  6: 'formula_especifica',
  7: 'livre_negociacao_indice_contrato',
  8: 'variacao_tabela_referencia',
});
export const MOVIMENTO_REDE = new Vocabulario<number>({
  1: 'inclusao',
  2: 'alteracao',
  3: 'exclusao',
  4: 'reinclusao',
});
export const PESSOA = new Vocabulario<'F' | 'J'>({ F: 'fisica', J: 'juridica' });

// ---- operadora, produto, contrato e beneficiário ----

export const MODALIDADE = new Vocabulario<string>({
  medicinaGrupo: 'medicina_grupo',
  cooperativaMedica: 'cooperativa_medica',
  autogestao: 'autogestao',
  filantropia: 'filantropia',
  seguradora: 'seguradora',
  odontologiaGrupo: 'odontologia_grupo',
  cooperativaOdontologica: 'cooperativa_odontologica',
});
export const TIPO_CONTRATACAO = new Vocabulario<number>({
  1: 'individual_familiar',
  2: 'coletivo_empresarial',
  3: 'coletivo_adesao',
});
export const ABRANGENCIA = new Vocabulario<string>({
  municipal: 'municipal',
  grupoMunicipios: 'grupo_municipios',
  estadual: 'estadual',
  grupoEstados: 'grupo_estados',
  nacional: 'nacional',
});
export const SITUACAO_PRODUTO = new Vocabulario<string>(
  { ativo: 'ativo', suspenso: 'comercializacao_suspensa', cancelado: 'cancelado' },
  { em_registro: 'ativo' },
);
export const SITUACAO_CONTRATO = new Vocabulario<string>(
  { ativo: 'ativo', suspenso: 'suspenso', encerrado: 'encerrado' },
  { em_cancelamento: 'suspenso' },
);
export const TIPO_VIGENCIA = new Vocabulario<number>({ 1: 'determinada', 2: 'indeterminada' });
export const TIPO_COPARTICIPACAO = new Vocabulario<number>({ 1: 'nenhuma', 2: 'percentual', 3: 'valor_fixo' });
/** Carências do produto → tipo do grupo de prazo de carência (grupo_prazo_carencia.tipo_carencia). */
export const CARENCIAS = {
  urgencia: 'urgencia_emergencia',
  partos: 'parto',
  demais: 'outro',
  cpt: 'doenca_preexistente',
} as const;
/** Segmentação assistencial do produto → os indicadores da segmentação no catálogo da ANS. */
export const SEGMENTACOES: Readonly<
  Record<string, { amb: boolean; hosp: boolean; obst: boolean; odonto: boolean; referencia: boolean }>
> = {
  ambulatorial: { amb: true, hosp: false, obst: false, odonto: false, referencia: false },
  hospitalarSemObstetricia: { amb: false, hosp: true, obst: false, odonto: false, referencia: false },
  hospitalarComObstetricia: { amb: false, hosp: true, obst: true, odonto: false, referencia: false },
  ambulatorialHospitalar: { amb: true, hosp: true, obst: true, odonto: false, referencia: false },
  odontologico: { amb: false, hosp: false, obst: false, odonto: true, referencia: false },
  referencia: { amb: true, hosp: true, obst: true, odonto: false, referencia: true },
};
/** Sexo do beneficiário (contrato: F, M, I) → sigla do domínio de sexo do cadastro de pessoas. */
export const SEXO = new Vocabulario<string>({ F: 'F', M: 'M', I: 'I' });
