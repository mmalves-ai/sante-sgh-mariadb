// F8 (06-FAT linhas 13, 19 e 23): regras comerciais configuráveis da conta, com desenho próprio.
// - Linha 13: criação e quebra automática de contas. O faturista cadastra regras por origem da entrada, categoria do
//   atendimento, setor, acomodação, grupo ou item e fonte pagadora; o sistema escolhe a regra que vale para a situação
//   (vigente, ativa, sem exceção que a afaste), pela prioridade e, empatada, pela mais específica, e diz o porquê.
//   A quebra por período (diária, semanal, quinzenal, mensal) devolve o intervalo da conta em que a data cai.
// - Linha 19: desconto comercial por volume (faixas de volume da fatura, da competência ou da quantidade de contas;
//   percentual ou valor; geral ou só de um grupo, item ou setor) e franquia do acordo (em valor, em quantidade de
//   pontos ou em percentual de participação, com filtro de regime, vínculo do beneficiário e idade, e exceções).
// - Linha 23: cobrança de serviço acessório por regra: remoção em ambulância por quilômetro ou por trajeto (regra da
//   fonte pagadora antes da padrão) e ligação telefônica tarifada (por minuto iniciado, por segundo ou pelo valor do
//   tarifador; tipo não cobrável e ligação sem duração não entram na conta).
// Funções puras: a API lê, chama a regra e grava; a tela usa as mesmas validações enquanto se digita.

export type Id = number;
const r2 = (x: number) => Math.round(x * 100) / 100;
const vazio = (v: unknown) => v === null || v === undefined;

// ── Linha 13: criação e quebra de contas ──────────────────────────────────────────────────────────────

export const ACOES_REGRA_CONTA = ['criar_conta', 'quebrar_conta', 'transferir_item'] as const;
export type AcaoRegraConta = (typeof ACOES_REGRA_CONTA)[number];
export const PERIODICIDADES_CONTA = ['diaria', 'semanal', 'quinzenal', 'mensal'] as const;
export type PeriodicidadeConta = (typeof PERIODICIDADES_CONTA)[number];

/** Critérios que uma regra (e uma exceção) pode exigir; nulo é "qualquer". */
export interface CriteriosConta {
  readonly categoriaAtendimento?: Id | null;
  readonly origemEntrada?: Id | null;
  readonly categoriaAcomodacao?: Id | null;
  readonly setor?: Id | null;
  readonly grupo?: Id | null;
  readonly item?: Id | null;
  readonly fonteOrigem?: Id | null;
  readonly planoOrigem?: Id | null;
}
const CRITERIOS: readonly (keyof CriteriosConta)[] = [
  'categoriaAtendimento',
  'origemEntrada',
  'categoriaAcomodacao',
  'setor',
  'grupo',
  'item',
  'fonteOrigem',
  'planoOrigem',
];

export interface RegraCriacaoConta extends CriteriosConta {
  readonly id: Id;
  readonly acao: AcaoRegraConta;
  readonly horarioEspecial?: boolean | null;
  readonly fonteDestino?: Id | null;
  readonly planoDestino?: Id | null;
  readonly periodicidade?: PeriodicidadeConta | null;
  readonly prioridade: number;
  readonly vigenciaInicio: string;
  readonly ativo: boolean;
  readonly excecoes?: readonly CriteriosConta[];
}

/** A situação do atendimento (e do item, quando for a quebra por item) que se compara às regras. */
export interface SituacaoRegraConta extends CriteriosConta {
  readonly data: string;
  readonly horarioEspecial?: boolean;
}

/** Erros de cadastro da regra de criação ou quebra de conta (campo → mensagem). */
export function validarRegraConta(r: Partial<RegraCriacaoConta>): Record<string, string> {
  const erros: Record<string, string> = {};
  if (!r.acao || !ACOES_REGRA_CONTA.includes(r.acao)) erros['acao'] = 'Escolha a ação da regra.';
  if (r.acao !== 'quebrar_conta' && vazio(r.fonteDestino))
    erros['fonteDestino'] = 'Informe a fonte pagadora da conta criada.';
  if (r.acao === 'quebrar_conta' && vazio(r.periodicidade) && especificidade(r) === 0)
    erros['periodicidade'] = 'A quebra precisa de um período ou de um critério (setor, grupo, item, origem).';
  if (!vazio(r.periodicidade) && !PERIODICIDADES_CONTA.includes(r.periodicidade as PeriodicidadeConta))
    erros['periodicidade'] = 'Período inválido.';
  if (!vazio(r.planoDestino) && vazio(r.fonteDestino))
    erros['planoDestino'] = 'O plano de destino pede a fonte pagadora de destino.';
  if (!vazio(r.planoOrigem) && vazio(r.fonteOrigem))
    erros['planoOrigem'] = 'O plano de origem pede a fonte pagadora de origem.';
  if (!r.vigenciaInicio || !/^\d{4}-\d{2}-\d{2}$/.test(r.vigenciaInicio))
    erros['vigenciaInicio'] = 'Informe o início da vigência.';
  if (
    r.prioridade !== undefined &&
    (!Number.isInteger(r.prioridade) || r.prioridade < 0 || r.prioridade > 65535)
  )
    erros['prioridade'] = 'Prioridade de 0 a 65535.';
  (r.excecoes ?? []).forEach((x, i) => {
    if (especificidade(x) === 0) erros[`excecoes.${i}`] = 'A exceção precisa de ao menos um critério.';
  });
  return erros;
}

/** Quantos critérios a regra exige (quanto mais, mais específica). */
export function especificidade(r: CriteriosConta): number {
  return CRITERIOS.filter((c) => !vazio(r[c])).length;
}

function criteriosBatem(c: CriteriosConta, s: CriteriosConta): boolean {
  return CRITERIOS.every((k) => vazio(c[k]) || c[k] === s[k]);
}

/** Por que a regra não vale para a situação (nulo quando vale). */
export function motivoRegraNaoVale(r: RegraCriacaoConta, s: SituacaoRegraConta): string | null {
  if (!r.ativo) return 'inativa';
  if (r.vigenciaInicio > s.data.slice(0, 10)) return 'fora_da_vigencia';
  if (!criteriosBatem(r, s)) return 'criterio_diferente';
  if (!vazio(r.horarioEspecial) && r.horarioEspecial !== (s.horarioEspecial ?? false))
    return 'horario_especial_diferente';
  if ((r.excecoes ?? []).some((x) => especificidade(x) > 0 && criteriosBatem(x, s))) return 'excecao';
  return null;
}

export interface EscolhaRegraConta {
  readonly regra: RegraCriacaoConta | null;
  /** Cada regra avaliada, com o motivo de não valer (nulo = valeu). */
  readonly avaliadas: readonly { readonly id: Id; readonly motivo: string | null }[];
  readonly periodo: { readonly inicio: string; readonly fim: string } | null;
}

/**
 * A regra que vale: entre as que batem, a de menor número de prioridade; empatada, a mais específica; empatada, a
 * mais antiga (menor id). `acao` restringe a escolha (a criação na entrada, a quebra na rotina).
 */
export function escolherRegraConta(
  regras: readonly RegraCriacaoConta[],
  s: SituacaoRegraConta,
  acao?: AcaoRegraConta,
): EscolhaRegraConta {
  const candidatas = regras.filter((r) => !acao || r.acao === acao);
  const avaliadas = candidatas.map((r) => ({ id: r.id, motivo: motivoRegraNaoVale(r, s) }));
  const valem = candidatas
    .filter((_, i) => avaliadas[i]?.motivo === null)
    .sort((a, b) => a.prioridade - b.prioridade || especificidade(b) - especificidade(a) || a.id - b.id);
  const regra = valem[0] ?? null;
  const periodo = regra?.periodicidade ? periodoDaQuebra(regra.periodicidade, s.data) : null;
  return { regra, avaliadas, periodo };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** O intervalo (inclusive) da conta em que a data cai, pela periodicidade da quebra. Semana de segunda a domingo. */
export function periodoDaQuebra(p: PeriodicidadeConta, data: string): { inicio: string; fim: string } {
  const [a, m, d] = data.slice(0, 10).split('-').map(Number) as [number, number, number];
  const dia = new Date(Date.UTC(a, m - 1, d));
  if (p === 'diaria') return { inicio: iso(dia), fim: iso(dia) };
  if (p === 'semanal') {
    const desloc = (dia.getUTCDay() + 6) % 7;
    const ini = new Date(Date.UTC(a, m - 1, d - desloc));
    return { inicio: iso(ini), fim: iso(new Date(Date.UTC(a, m - 1, d - desloc + 6))) };
  }
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  if (p === 'quinzenal')
    return d <= 15
      ? { inicio: iso(new Date(Date.UTC(a, m - 1, 1))), fim: iso(new Date(Date.UTC(a, m - 1, 15))) }
      : { inicio: iso(new Date(Date.UTC(a, m - 1, 16))), fim: iso(new Date(Date.UTC(a, m - 1, ultimo))) };
  return { inicio: iso(new Date(Date.UTC(a, m - 1, 1))), fim: iso(new Date(Date.UTC(a, m - 1, ultimo))) };
}

// ── Linha 19: desconto por volume e franquia ──────────────────────────────────────────────────────────

export const BASES_VOLUME = ['valor_fatura', 'valor_competencia', 'quantidade_contas'] as const;
export type BaseVolume = (typeof BASES_VOLUME)[number];

export interface FaixaDesconto {
  readonly sequencia: number;
  readonly volumeInicial: number;
  readonly volumeFinal: number | null;
  readonly tipo: 'percentual' | 'valor';
  readonly percentual?: number | null;
  readonly valor?: number | null;
  readonly grupo?: Id | null;
  readonly item?: Id | null;
  readonly setor?: Id | null;
}

/** Erros das faixas: limites coerentes, desconto informado e sem sobreposição dentro do mesmo alvo. */
export function validarFaixasDesconto(faixas: readonly FaixaDesconto[]): Record<string, string> {
  const erros: Record<string, string> = {};
  if (faixas.length === 0) erros['faixas'] = 'Informe ao menos uma faixa.';
  faixas.forEach((f, i) => {
    if (!(f.volumeInicial >= 0)) erros[`faixas.${i}.volumeInicial`] = 'Volume inicial não pode ser negativo.';
    if (f.volumeFinal !== null && !(f.volumeFinal > f.volumeInicial))
      erros[`faixas.${i}.volumeFinal`] = 'O volume final tem de ser maior que o inicial.';
    if (f.tipo === 'percentual' && !(Number(f.percentual) >= 0 && Number(f.percentual) <= 100))
      erros[`faixas.${i}.percentual`] = 'Percentual de 0 a 100.';
    if (f.tipo === 'valor' && !(Number(f.valor) >= 0))
      erros[`faixas.${i}.valor`] = 'Informe o valor do desconto.';
  });
  const alvo = (f: FaixaDesconto) => `${f.grupo ?? ''}|${f.item ?? ''}|${f.setor ?? ''}`;
  faixas.forEach((f, i) =>
    faixas.forEach((g, j) => {
      if (j <= i || alvo(f) !== alvo(g)) return;
      const fimF = f.volumeFinal ?? Infinity;
      const fimG = g.volumeFinal ?? Infinity;
      if (f.volumeInicial < fimG && g.volumeInicial < fimF)
        erros[`faixas.${j}.volumeInicial`] = `A faixa ${g.sequencia} se sobrepõe à faixa ${f.sequencia}.`;
    }),
  );
  const seqs = faixas.map((f) => f.sequencia);
  if (new Set(seqs).size !== seqs.length) erros['faixas'] = 'Sequência repetida nas faixas.';
  return erros;
}

const noIntervalo = (f: FaixaDesconto, v: number) =>
  v >= f.volumeInicial && (f.volumeFinal === null || v < f.volumeFinal);

export interface LinhaDesconto {
  readonly grupo?: Id | null;
  readonly item?: Id | null;
  readonly setor?: Id | null;
  readonly valor: number;
}

export interface DescontoVolume {
  readonly volume: number;
  readonly desconto: number;
  /** As faixas usadas (sequência) e o valor de desconto de cada uma. */
  readonly faixas: readonly {
    readonly sequencia: number;
    readonly base: number;
    readonly desconto: number;
  }[];
}

/**
 * O desconto por volume sobre as linhas (itens da conta, ou uma linha só com o valor). Para cada linha vale a faixa do
 * volume mais específica para ela (item, depois grupo, depois setor, depois a geral). O percentual incide sobre a base
 * da faixa; o valor fixo entra uma vez por faixa, limitado à base. O desconto nunca passa do total.
 */
export function calcularDescontoVolume(
  faixas: readonly FaixaDesconto[],
  volume: number,
  linhas: readonly LinhaDesconto[],
): DescontoVolume {
  const vigentes = faixas.filter((f) => noIntervalo(f, volume));
  const nivel = (f: FaixaDesconto, l: LinhaDesconto): number => {
    if (!vazio(f.item)) return f.item === l.item ? 4 : -1;
    if (!vazio(f.grupo)) return f.grupo === l.grupo ? 3 : -1;
    if (!vazio(f.setor)) return f.setor === l.setor ? 2 : -1;
    return 1;
  };
  const bases = new Map<number, number>();
  for (const l of linhas) {
    let melhor: FaixaDesconto | null = null;
    let nm = 0;
    for (const f of vigentes) {
      const k = nivel(f, l);
      if (k > nm) [melhor, nm] = [f, k];
    }
    if (melhor) bases.set(melhor.sequencia, r2((bases.get(melhor.sequencia) ?? 0) + l.valor));
  }
  const total = r2(linhas.reduce((s, l) => s + l.valor, 0));
  const usadas = [...bases.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([sequencia, base]) => {
      const f = vigentes.find((x) => x.sequencia === sequencia) as FaixaDesconto;
      const d =
        f.tipo === 'percentual'
          ? r2((base * Number(f.percentual ?? 0)) / 100)
          : Math.min(base, Number(f.valor ?? 0));
      return { sequencia, base, desconto: r2(d) };
    });
  const desconto = Math.min(total, r2(usadas.reduce((s, u) => s + u.desconto, 0)));
  return { volume, desconto, faixas: usadas };
}

export const VINCULOS_BENEFICIARIO = ['titular', 'dependente', 'pensionista'] as const;
export type VinculoBeneficiario = (typeof VINCULOS_BENEFICIARIO)[number];

/**
 * O vínculo do beneficiário com o plano, lido da carteira do cadastro (nunca digitado na aplicação da franquia):
 * pensionista quando a carteira é de pensionista; senão titular ou dependente pela titularidade. Sem carteira, nulo.
 */
export function vinculoDaCarteira(
  carteira: { readonly titular: boolean; readonly pensionista: boolean } | null,
): VinculoBeneficiario | null {
  if (!carteira) return null;
  if (carteira.pensionista) return 'pensionista';
  return carteira.titular ? 'titular' : 'dependente';
}

export interface ExcecaoFranquia {
  readonly item?: Id | null;
  readonly grupo?: Id | null;
  readonly especialidade?: Id | null;
  readonly regime?: Id | null;
  readonly aplicaTitular: boolean;
  readonly aplicaDependente: boolean;
  readonly aplicaPensionista: boolean;
  readonly ativo: boolean;
}

export interface FranquiaContrato {
  readonly id: Id;
  readonly tipo: 'valor' | 'quantidade' | 'percentual';
  readonly valorFranquia?: number | null;
  readonly quantidadePontos?: number | null;
  readonly valorPonto?: number | null;
  readonly percentualParticipacao?: number | null;
  readonly valorParticipacao?: number | null;
  readonly regime?: Id | null;
  readonly item?: Id | null;
  readonly grupo?: Id | null;
  readonly aplicaTitular: boolean;
  readonly aplicaDependente: boolean;
  readonly aplicaPensionista: boolean;
  readonly idadeMinima?: number | null;
  readonly idadeMaxima?: number | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim?: string | null;
  readonly ativo: boolean;
  readonly excecoes?: readonly ExcecaoFranquia[];
}

/** Erros do cadastro da franquia, os mesmos que o banco conferiria, ditos campo a campo. */
export function validarFranquia(f: Partial<FranquiaContrato>): Record<string, string> {
  const erros: Record<string, string> = {};
  if (f.tipo === 'valor' && (vazio(f.valorFranquia) || !(Number(f.valorFranquia) >= 0)))
    erros['valorFranquia'] = 'Informe o valor da franquia.';
  if (f.tipo === 'quantidade' && (vazio(f.quantidadePontos) || !(Number(f.quantidadePontos) >= 0)))
    erros['quantidadePontos'] = 'Informe a quantidade de pontos.';
  if (f.tipo === 'quantidade' && vazio(f.valorPonto)) erros['valorPonto'] = 'Informe o valor do ponto.';
  if (
    f.tipo === 'percentual' &&
    !(Number(f.percentualParticipacao) >= 0 && Number(f.percentualParticipacao) <= 100)
  )
    erros['percentualParticipacao'] = 'Participação de 0 a 100%.';
  if (!f.tipo || !['valor', 'quantidade', 'percentual'].includes(f.tipo))
    erros['tipo'] = 'Escolha o tipo da franquia.';
  if (!vazio(f.idadeMinima) && !vazio(f.idadeMaxima) && Number(f.idadeMaxima) < Number(f.idadeMinima))
    erros['idadeMaxima'] = 'A idade máxima é menor que a mínima.';
  if (!f.vigenciaInicio) erros['vigenciaInicio'] = 'Informe o início da vigência.';
  if (f.vigenciaFim && f.vigenciaInicio && f.vigenciaFim < f.vigenciaInicio)
    erros['vigenciaFim'] = 'O fim da vigência é anterior ao início.';
  if (f.aplicaTitular === false && f.aplicaDependente === false && f.aplicaPensionista === false)
    erros['aplicaTitular'] = 'A franquia precisa valer para ao menos um vínculo.';
  (f.excecoes ?? []).forEach((x, i) => {
    if ([x.item, x.grupo, x.especialidade, x.regime].every(vazio))
      erros[`excecoes.${i}`] = 'A exceção precisa de item, grupo, especialidade ou regime.';
  });
  return erros;
}

export interface SituacaoFranquia {
  readonly data: string;
  readonly regime?: Id | null;
  readonly especialidade?: Id | null;
  readonly vinculo: VinculoBeneficiario;
  readonly idade: number | null;
}
export interface ItemFranquia {
  readonly item: Id;
  readonly grupo?: Id | null;
  readonly quantidade: number;
  readonly valor: number;
}

const aplicaAoVinculo = (
  x: { aplicaTitular: boolean; aplicaDependente: boolean; aplicaPensionista: boolean },
  v: VinculoBeneficiario,
) => (v === 'titular' ? x.aplicaTitular : v === 'dependente' ? x.aplicaDependente : x.aplicaPensionista);

/** Por que a franquia não vale para o atendimento (nulo quando vale). */
export function motivoFranquiaNaoVale(f: FranquiaContrato, s: SituacaoFranquia): string | null {
  const dia = s.data.slice(0, 10);
  if (!f.ativo) return 'inativa';
  if (f.vigenciaInicio > dia || (f.vigenciaFim && f.vigenciaFim < dia)) return 'fora_da_vigencia';
  if (!vazio(f.regime) && f.regime !== s.regime) return 'regime_diferente';
  if (!aplicaAoVinculo(f, s.vinculo)) return 'vinculo_nao_coberto';
  if (s.idade !== null && !vazio(f.idadeMinima) && s.idade < Number(f.idadeMinima)) return 'fora_da_idade';
  if (s.idade !== null && !vazio(f.idadeMaxima) && s.idade > Number(f.idadeMaxima)) return 'fora_da_idade';
  const excecaoGeral = (f.excecoes ?? []).some(
    (x) =>
      x.ativo &&
      vazio(x.item) &&
      vazio(x.grupo) &&
      aplicaAoVinculo(x, s.vinculo) &&
      (vazio(x.regime) || x.regime === s.regime) &&
      (vazio(x.especialidade) || x.especialidade === s.especialidade),
  );
  return excecaoGeral ? 'excecao' : null;
}

export interface ValorFranquia {
  readonly base: number;
  readonly quantidade: number;
  readonly valor: number;
  readonly itensConsiderados: readonly Id[];
}

/**
 * A franquia na conta (o valor que sai da cobrança à fonte pagadora e fica a cargo do beneficiário): sobre os itens
 * que a franquia alcança (item ou grupo, quando definidos) e que nenhuma exceção afasta. Em valor: até o limite; em
 * quantidade: os pontos consumidos até o limite vezes o valor do ponto; em percentual: a participação sobre a base.
 * A participação fixa soma nos três. O resultado nunca passa da base.
 */
export function calcularFranquia(
  f: FranquiaContrato,
  s: SituacaoFranquia,
  itens: readonly ItemFranquia[],
): ValorFranquia {
  const excluido = (i: ItemFranquia) =>
    (f.excecoes ?? []).some(
      (x) =>
        x.ativo &&
        aplicaAoVinculo(x, s.vinculo) &&
        ((!vazio(x.item) && x.item === i.item) || (!vazio(x.grupo) && x.grupo === i.grupo)) &&
        (vazio(x.regime) || x.regime === s.regime) &&
        (vazio(x.especialidade) || x.especialidade === s.especialidade),
    );
  const alcancados = itens.filter(
    (i) => (vazio(f.item) || f.item === i.item) && (vazio(f.grupo) || f.grupo === i.grupo) && !excluido(i),
  );
  const base = r2(alcancados.reduce((t, i) => t + i.valor, 0));
  const quantidade = alcancados.reduce((t, i) => t + i.quantidade, 0);
  let valor: number;
  if (f.tipo === 'valor') valor = Math.min(base, Number(f.valorFranquia ?? 0));
  else if (f.tipo === 'quantidade')
    valor = Math.min(quantidade, Number(f.quantidadePontos ?? 0)) * Number(f.valorPonto ?? 0);
  else valor = (base * Number(f.percentualParticipacao ?? 0)) / 100;
  valor += Number(f.valorParticipacao ?? 0);
  return {
    base,
    quantidade,
    valor: alcancados.length ? r2(Math.min(base, valor)) : 0,
    itensConsiderados: alcancados.map((i) => i.item),
  };
}

// ── Linha 23: serviço acessório (ambulância e ligação) ───────────────────────────────────────────────

export interface RegraAmbulancia {
  readonly id: Id;
  readonly fonte: Id | null;
  readonly categoria: Id;
  readonly forma: 'quilometro' | 'trajeto';
  readonly rota: Id | null;
  readonly item: Id;
  readonly ativo: boolean;
}
export interface PedidoRemocao {
  readonly fonte: Id;
  readonly categoria: Id;
  /** Trajeto cadastrado (cobrança por trajeto, ou a distância da cobrança por quilômetro). */
  readonly rota?: { readonly id: Id; readonly distanciaKm: number; readonly idaEVolta: boolean } | null;
  /** Quilômetros rodados (quando não vem do trajeto). */
  readonly km?: number | null;
  /** Remoção com volta (a distância do trajeto de só ida dobra). */
  readonly comVolta?: boolean;
}
export interface CobrancaRemocao {
  readonly regra: RegraAmbulancia | null;
  readonly quantidade: number;
  readonly erros: Record<string, string>;
}

/**
 * A regra da remoção: a do trajeto (fonte pagadora, depois padrão) quando há trajeto com regra, senão a por quilômetro
 * (fonte pagadora, depois padrão). Por trajeto cobra 1; por quilômetro cobra os km rodados ou a distância do trajeto
 * (dobrada quando há volta e o trajeto é só de ida).
 */
export function cobrancaRemocao(regras: readonly RegraAmbulancia[], p: PedidoRemocao): CobrancaRemocao {
  const daCategoria = regras.filter((r) => r.ativo && r.categoria === p.categoria);
  const pela = (forma: RegraAmbulancia['forma']) => {
    const c = daCategoria.filter(
      (r) => r.forma === forma && (forma === 'quilometro' || r.rota === p.rota?.id),
    );
    return c.find((r) => r.fonte === p.fonte) ?? c.find((r) => r.fonte === null) ?? null;
  };
  const porTrajeto = p.rota ? pela('trajeto') : null;
  if (porTrajeto) return { regra: porTrajeto, quantidade: 1, erros: {} };
  const porKm = pela('quilometro');
  if (!porKm)
    return {
      regra: null,
      quantidade: 0,
      erros: { categoria: 'Não há regra de cobrança para esta remoção.' },
    };
  const km = !vazio(p.km)
    ? Number(p.km)
    : p.rota
      ? p.rota.distanciaKm * (p.comVolta && !p.rota.idaEVolta ? 2 : 1)
      : NaN;
  if (!(km > 0))
    return { regra: porKm, quantidade: 0, erros: { km: 'Informe os quilômetros ou o trajeto.' } };
  return { regra: porKm, quantidade: Math.round(km * 10000) / 10000, erros: {} };
}

export const ABRANGENCIAS_LIGACAO = [
  'local',
  'interurbano',
  'internacional',
  'celular_local',
  'celular_interurbano',
  'gratuita',
] as const;
export type AbrangenciaLigacao = (typeof ABRANGENCIAS_LIGACAO)[number];

/** O tipo da ligação no registro a partir da abrangência do tipo tarifado. */
export function tipoDaLigacao(a: string): 'local' | 'interurbana' | 'celular' | 'internacional' | 'outra' {
  if (a === 'local') return 'local';
  if (a === 'interurbano') return 'interurbana';
  if (a === 'internacional') return 'internacional';
  if (a.startsWith('celular')) return 'celular';
  return 'outra';
}

export interface RegraLigacao {
  readonly id: Id;
  readonly itemMinuto: Id | null;
  readonly itemSegundo: Id | null;
  readonly assumeValorTarifador: boolean;
  readonly ativo: boolean;
}
export interface CobrancaLigacao {
  readonly cobra: boolean;
  readonly motivo: 'cobrada' | 'tipo_nao_cobravel' | 'sem_regra' | 'sem_duracao' | 'sem_valor_tarifador';
  readonly item: Id | null;
  readonly quantidade: number;
  /** Valor unitário vindo do tarifador (nulo: o preço é o da tabela do item). */
  readonly unitario: number | null;
}

/** Como a ligação entra na conta: por minuto iniciado, por segundo ou pelo valor do tarifador. */
export function cobrancaLigacao(
  regra: RegraLigacao | null,
  tipoCobravel: boolean,
  ligacao: { readonly duracaoSegundos: number; readonly valorTarifador: number | null },
): CobrancaLigacao {
  const nao = (motivo: CobrancaLigacao['motivo']): CobrancaLigacao => ({
    cobra: false,
    motivo,
    item: null,
    quantidade: 0,
    unitario: null,
  });
  if (!tipoCobravel) return nao('tipo_nao_cobravel');
  if (!regra || !regra.ativo) return nao('sem_regra');
  if (!(ligacao.duracaoSegundos > 0)) return nao('sem_duracao');
  const item = regra.itemMinuto ?? regra.itemSegundo;
  if (regra.assumeValorTarifador) {
    if (ligacao.valorTarifador === null || !(ligacao.valorTarifador >= 0) || item === null)
      return nao('sem_valor_tarifador');
    return { cobra: true, motivo: 'cobrada', item, quantidade: 1, unitario: r2(ligacao.valorTarifador) };
  }
  if (regra.itemSegundo !== null && regra.itemMinuto === null)
    return {
      cobra: true,
      motivo: 'cobrada',
      item: regra.itemSegundo,
      quantidade: ligacao.duracaoSegundos,
      unitario: null,
    };
  return {
    cobra: true,
    motivo: 'cobrada',
    item: regra.itemMinuto,
    quantidade: Math.ceil(ligacao.duracaoSegundos / 60),
    unitario: null,
  };
}
