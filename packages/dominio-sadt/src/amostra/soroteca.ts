// Soroteca (F8, 05-SADT linha 9): guarda da amostra em equipamento e suporte (rack, caixa), retirada com motivo,
// devolução, prazo de descarte pela regra do estabelecimento e expurgo registrado. A guarda segue a boa prática da
// RDC 786/2023 da ANVISA (retenção da amostra pelo prazo definido pelo laboratório, com rastreio da posição e de quem
// mexeu). O expurgo só marca o descarte: nada se apaga, e cada passo vira um movimento. Regra pura, sem banco.

export class RecusaSoroteca extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export type SituacaoGuarda = 'guardada' | 'retirada' | 'descartada';
export type AbrangenciaDescarte = 'geral' | 'exame' | 'resultado' | 'fonte_pagadora';
export type ComparadorDescarte =
  'igual' | 'diferente' | 'menor' | 'menor_igual' | 'maior' | 'maior_igual' | 'entre' | 'contem';
export type FinalidadeRetirada =
  'reteste' | 'pesquisa' | 'prazo_vencido' | 'descarte' | 'transferencia' | 'outro';

/** Situações da amostra que podem entrar na soroteca: já coletada e ainda viva (nem rejeitada, cancelada ou descartada). */
const GUARDAVEIS = new Set([
  'coletada',
  'em_transporte',
  'recebida',
  'triada',
  'aliquotada',
  'em_analise',
  'analisada',
  'armazenada',
]);

// ── Cadastro ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface EquipamentoEntrada {
  readonly temperaturaMinima: number | null;
  readonly temperaturaMaxima: number | null;
}

export function conferirEquipamento(e: EquipamentoEntrada): void {
  if (
    e.temperaturaMinima !== null &&
    e.temperaturaMaxima !== null &&
    e.temperaturaMinima > e.temperaturaMaxima
  )
    throw new RecusaSoroteca(
      'temperatura-invertida',
      'A temperatura mínima do equipamento não pode passar da máxima.',
    );
}

export interface Suporte {
  readonly quantidadeLinhas: number;
  readonly quantidadeColunas: number;
}

export function conferirSuporte(s: Suporte): void {
  if (!Number.isInteger(s.quantidadeLinhas) || s.quantidadeLinhas < 1)
    throw new RecusaSoroteca('suporte-sem-linhas', 'O suporte precisa de ao menos uma linha.');
  if (!Number.isInteger(s.quantidadeColunas) || s.quantidadeColunas < 1)
    throw new RecusaSoroteca('suporte-sem-colunas', 'O suporte precisa de ao menos uma coluna.');
}

export interface RegraDescarte {
  readonly id: number;
  readonly abrangencia: AbrangenciaDescarte;
  readonly exame: number | null;
  readonly comparador: ComparadorDescarte | null;
  readonly valorTexto: string | null;
  readonly fontePagadora: number | null;
  readonly diasGuarda: number;
  readonly prioridade: number;
  readonly ativo: boolean;
}

/** A regra de descarte é completa para a sua abrangência (o mesmo que o CHECK do banco, dito antes de gravar). */
export function conferirRegraDescarte(r: Omit<RegraDescarte, 'id' | 'ativo'>): void {
  if (!Number.isInteger(r.diasGuarda) || r.diasGuarda < 1)
    throw new RecusaSoroteca('dias-invalidos', 'O prazo de guarda é de ao menos um dia.');
  if ((r.abrangencia === 'exame' || r.abrangencia === 'resultado') && r.exame === null)
    throw new RecusaSoroteca('regra-sem-exame', 'Escolha o exame da regra.');
  if (r.abrangencia === 'resultado' && (r.comparador === null || !r.valorTexto?.trim()))
    throw new RecusaSoroteca(
      'regra-sem-comparacao',
      'A regra pelo resultado precisa do comparador e do valor.',
    );
  if (r.abrangencia === 'resultado' && r.comparador === 'entre' && faixa(r.valorTexto ?? '') === null)
    throw new RecusaSoroteca('faixa-invalida', 'Informe a faixa como "mínimo;máximo" (ex.: 10;20).');
  if (r.abrangencia === 'fonte_pagadora' && r.fontePagadora === null)
    throw new RecusaSoroteca('regra-sem-fonte', 'Escolha a fonte pagadora da regra.');
}

// ── Prazo de descarte ─────────────────────────────────────────────────────────────────────────────────────────

const numero = (v: string): number | null => {
  const t = v.trim().replace(',', '.');
  if (t === '' || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
};
const faixa = (v: string): [number, number] | null => {
  const [a, b, ...resto] = v.split(';');
  if (resto.length > 0 || a === undefined || b === undefined) return null;
  const x = numero(a);
  const y = numero(b);
  return x === null || y === null || x > y ? null : [x, y];
};

/** O resultado atende a comparação da regra (numérica quando os dois lados são números; senão, pelo texto). */
export function resultadoAtende(
  comparador: ComparadorDescarte,
  valorRegra: string,
  resultado: string,
): boolean {
  const r = resultado.trim();
  if (comparador === 'contem') return r.toLowerCase().includes(valorRegra.trim().toLowerCase());
  if (comparador === 'entre') {
    const f = faixa(valorRegra);
    const v = numero(r);
    return f !== null && v !== null && v >= f[0] && v <= f[1];
  }
  const a = numero(r);
  const b = numero(valorRegra);
  if (a !== null && b !== null) {
    switch (comparador) {
      case 'igual':
        return a === b;
      case 'diferente':
        return a !== b;
      case 'menor':
        return a < b;
      case 'menor_igual':
        return a <= b;
      case 'maior':
        return a > b;
      case 'maior_igual':
        return a >= b;
    }
  }
  const iguais = r.toLowerCase() === valorRegra.trim().toLowerCase();
  if (comparador === 'igual') return iguais;
  if (comparador === 'diferente') return !iguais;
  return false;
}

export interface ContextoDescarte {
  /** Exames da amostra. */
  readonly exames: readonly number[];
  readonly fontePagadora: number | null;
  /** Resultados já digitados dos exames da amostra (valor em texto). */
  readonly resultados: readonly { readonly exame: number; readonly valor: string }[];
}

/** A regra que vale para a amostra: entre as ativas que se aplicam, a de maior prioridade; no empate, o maior prazo. */
export function regraDescarteAplicavel(
  regras: readonly RegraDescarte[],
  c: ContextoDescarte,
): RegraDescarte | null {
  const aplica = (r: RegraDescarte): boolean => {
    if (!r.ativo) return false;
    switch (r.abrangencia) {
      case 'geral':
        return true;
      case 'exame':
        return r.exame !== null && c.exames.includes(r.exame);
      case 'fonte_pagadora':
        return r.fontePagadora !== null && r.fontePagadora === c.fontePagadora;
      case 'resultado':
        return (
          r.exame !== null &&
          r.comparador !== null &&
          c.resultados.some(
            (x) => x.exame === r.exame && resultadoAtende(r.comparador!, r.valorTexto ?? '', x.valor),
          )
        );
    }
  };
  let escolhida: RegraDescarte | null = null;
  for (const r of regras.filter(aplica)) {
    if (
      escolhida === null ||
      r.prioridade > escolhida.prioridade ||
      (r.prioridade === escolhida.prioridade && r.diasGuarda > escolhida.diasGuarda)
    )
      escolhida = r;
  }
  return escolhida;
}

/** Dia (AAAA-MM-DD) somado de `dias` (calendário civil, sem fuso). */
export function somarDiasDaGuarda(dia: string, dias: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new RecusaSoroteca('data-invalida', 'Data inválida.');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Descarte previsto: o dia da guarda mais o prazo da regra; sem regra que se aplique, não há prazo (fica sem expurgo). */
export function descartePrevisto(diaDaGuarda: string, regra: RegraDescarte | null): string | null {
  return regra === null ? null : somarDiasDaGuarda(diaDaGuarda, regra.diasGuarda);
}

// ── Posição no suporte ────────────────────────────────────────────────────────────────────────────────────────

export interface Posicao {
  readonly linha: number;
  readonly coluna: number;
}

const chave = (p: Posicao) => `${p.linha}:${p.coluna}`;

/** A posição cabe no suporte e está livre (duas amostras guardadas nunca dividem a mesma posição). */
export function conferirPosicao(s: Suporte, p: Posicao, ocupadas: readonly Posicao[]): void {
  if (
    !Number.isInteger(p.linha) ||
    !Number.isInteger(p.coluna) ||
    p.linha < 1 ||
    p.coluna < 1 ||
    p.linha > s.quantidadeLinhas ||
    p.coluna > s.quantidadeColunas
  )
    throw new RecusaSoroteca(
      'posicao-fora',
      `A posição ${p.linha}-${p.coluna} não existe no suporte (${s.quantidadeLinhas} linhas × ${s.quantidadeColunas} colunas).`,
    );
  if (ocupadas.some((o) => chave(o) === chave(p)))
    throw new RecusaSoroteca('posicao-ocupada', `A posição ${p.linha}-${p.coluna} já tem amostra guardada.`);
}

/** A primeira posição livre do suporte, linha a linha (a tela já sugere, sem o usuário contar o rack). */
export function primeiraPosicaoLivre(s: Suporte, ocupadas: readonly Posicao[]): Posicao | null {
  const ja = new Set(ocupadas.map(chave));
  for (let linha = 1; linha <= s.quantidadeLinhas; linha++)
    for (let coluna = 1; coluna <= s.quantidadeColunas; coluna++)
      if (!ja.has(chave({ linha, coluna }))) return { linha, coluna };
  return null;
}

// ── Guarda, retirada, devolução e expurgo ─────────────────────────────────────────────────────────────────────

export function conferirGuarda(situacaoAmostra: string, jaGuardada: boolean): void {
  if (!GUARDAVEIS.has(situacaoAmostra))
    throw new RecusaSoroteca(
      'amostra-nao-guardavel',
      'Só a amostra coletada e ainda em uso entra na soroteca (rejeitada, cancelada ou descartada não).',
    );
  if (jaGuardada) throw new RecusaSoroteca('amostra-ja-guardada', 'A amostra já está guardada na soroteca.');
}

export interface MotivoRetirada {
  readonly ativo: boolean;
  readonly definitiva: boolean;
  readonly finalidade: FinalidadeRetirada;
}

/** Retirada com motivo do cadastro: a definitiva encerra a guarda; a provisória (reteste, pesquisa) permite devolver. */
export function conferirRetirada(situacao: SituacaoGuarda, motivo: MotivoRetirada | null): void {
  if (situacao !== 'guardada')
    throw new RecusaSoroteca('nao-guardada', 'Só a amostra guardada pode ser retirada.');
  if (!motivo || !motivo.ativo)
    throw new RecusaSoroteca('motivo-invalido', 'Escolha um motivo de retirada ativo.');
}

/** Devolução: só a retirada provisória volta (o motivo da última retirada não pode ser definitivo). */
export function conferirDevolucao(situacao: SituacaoGuarda, motivoDaRetirada: MotivoRetirada | null): void {
  if (situacao !== 'retirada')
    throw new RecusaSoroteca('nao-retirada', 'Só a amostra retirada pode voltar à soroteca.');
  if (motivoDaRetirada?.definitiva)
    throw new RecusaSoroteca(
      'retirada-definitiva',
      'A retirada foi definitiva: a amostra não volta à soroteca.',
    );
}

/** O expurgo pede motivo do tipo prazo vencido ou descarte. */
export function conferirMotivoExpurgo(motivo: MotivoRetirada | null): void {
  if (!motivo || !motivo.ativo || (motivo.finalidade !== 'prazo_vencido' && motivo.finalidade !== 'descarte'))
    throw new RecusaSoroteca(
      'motivo-expurgo',
      'O expurgo pede um motivo ativo de prazo vencido ou de descarte.',
    );
}

export interface GuardaParaExpurgo {
  readonly id: number;
  readonly situacao: SituacaoGuarda;
  readonly descartePrevistoEm: string | null;
}

/** As guardas vencidas no dia: guardadas, com prazo de descarte até hoje (sem prazo, nunca entram). */
export function vencidasParaExpurgo<T extends GuardaParaExpurgo>(guardas: readonly T[], hoje: string): T[] {
  return guardas.filter(
    (g) => g.situacao === 'guardada' && g.descartePrevistoEm !== null && g.descartePrevistoEm <= hoje,
  );
}

/** O expurgo só confirma guardas da lista vencida: uma guarda fora do prazo ou já mexida é recusada. */
export function conferirExpurgo(escolhidas: readonly number[], vencidas: readonly GuardaParaExpurgo[]): void {
  if (escolhidas.length === 0)
    throw new RecusaSoroteca('expurgo-vazio', 'Escolha ao menos uma amostra vencida para o expurgo.');
  const ok = new Set(vencidas.map((g) => g.id));
  const fora = escolhidas.filter((id) => !ok.has(id));
  if (fora.length > 0)
    throw new RecusaSoroteca(
      'expurgo-fora-do-prazo',
      `${fora.length} amostra(s) escolhida(s) não estão vencidas ou já saíram da soroteca.`,
    );
}
