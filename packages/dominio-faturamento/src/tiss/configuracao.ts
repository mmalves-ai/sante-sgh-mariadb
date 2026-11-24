// Regras puras da configuração do padrão TISS por fonte pagadora e da numeração de guias (F3.1, 02-CAD linha 25).
// - configuração com vigência por estabelecimento e fonte pagadora: versão do padrão, identificação do prestador,
//   contratado, limites e agrupamentos do lote e serviços eletrônicos, conferidos todos de uma vez;
// - faixa de números de guia (da operadora ou sequência do hospital): sem sobreposição, cabendo no campo de 20
//   posições, consumida em ordem na emissão e marcada esgotada ao fim. Sem banco e sem HTTP.

/** Tipo de guia da faixa a partir do tipo da guia emitida (a internação usa a faixa "internacao"). */
export function tipoFaixaDaGuia(tipoGuia: string): string {
  return tipoGuia === 'resumo_internacao' ? 'internacao' : tipoGuia;
}

export const TIPOS_FAIXA_GUIA = [
  'consulta',
  'sp_sadt',
  'internacao',
  'honorario',
  'odontologia',
  'outras_despesas',
  'anexo',
] as const;

/** Limite de guias por lote do padrão (100). */
export const LIMITE_GUIAS_LOTE_PADRAO = 100;

export interface DadosConfiguracaoTiss {
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly registroAns: string | null;
  readonly identificacaoPrestador: 'cnpj' | 'cpf' | 'codigo_operadora';
  readonly codigoPrestadorOperadora: string | null;
  readonly cnpjContratado: string | null;
  readonly razaoSocialContratado: string | null;
  readonly limiteGuiasLote: number | null;
  readonly diasRetornoConsulta: number | null;
  readonly faturamentoEletronico: boolean;
  readonly reapresentacaoEletronica: boolean;
  readonly retornoEletronico: boolean;
  readonly elegibilidadeEletronica: boolean;
  readonly exigeElegibilidade: boolean;
  readonly somenteArquivo: boolean;
  readonly imprimeVersoGuia: boolean;
}

export function errosConfiguracaoTiss(
  d: DadosConfiguracaoTiss,
  cnpjConfere: (c: string) => boolean,
): string[] {
  const e: string[] = [];
  if (d.vigenciaFim !== null && d.vigenciaFim < d.vigenciaInicio) e.push('vigencia-invertida');
  if (d.registroAns !== null && !/^\d{6}$/.test(d.registroAns)) e.push('registro-ans-invalido');
  if (d.identificacaoPrestador === 'codigo_operadora' && !d.codigoPrestadorOperadora)
    e.push('codigo-prestador-obrigatorio');
  if (d.codigoPrestadorOperadora !== null && !/^[A-Za-z0-9./-]{1,20}$/.test(d.codigoPrestadorOperadora))
    e.push('codigo-prestador-invalido');
  if (d.cnpjContratado !== null && !cnpjConfere(d.cnpjContratado)) e.push('cnpj-contratado-invalido');
  if ((d.cnpjContratado === null) !== (d.razaoSocialContratado === null)) e.push('contratado-incompleto');
  if (d.limiteGuiasLote !== null && (d.limiteGuiasLote < 1 || d.limiteGuiasLote > LIMITE_GUIAS_LOTE_PADRAO))
    e.push('limite-lote-invalido');
  if (d.diasRetornoConsulta !== null && (d.diasRetornoConsulta < 0 || d.diasRetornoConsulta > 365))
    e.push('dias-retorno-invalido');
  if (d.reapresentacaoEletronica && !d.faturamentoEletronico)
    e.push('reapresentacao-sem-faturamento-eletronico');
  if (d.retornoEletronico && !d.faturamentoEletronico) e.push('retorno-sem-faturamento-eletronico');
  if (d.exigeElegibilidade === false && d.elegibilidadeEletronica)
    e.push('elegibilidade-eletronica-sem-exigencia');
  if (d.somenteArquivo && !d.faturamentoEletronico) e.push('somente-arquivo-sem-faturamento-eletronico');
  if (d.somenteArquivo && d.imprimeVersoGuia) e.push('verso-sem-guia-impressa');
  return e;
}

export interface Vigencia {
  readonly id?: number;
  readonly inicio: string;
  readonly fim: string | null;
}

/** As vigências já gravadas que cruzam a nova (fim nulo = sem fim). */
export function vigenciasQueCruzam(atuais: readonly Vigencia[], nova: Vigencia): Vigencia[] {
  return atuais.filter(
    (a) =>
      a.id !== nova.id &&
      (a.fim === null || a.fim >= nova.inicio) &&
      (nova.fim === null || nova.fim >= a.inicio),
  );
}

// ── Faixa de numeração ──

export interface DadosFaixa {
  readonly tipoGuia: string;
  readonly formaGeracao: 'faixa_operadora' | 'sequencial_hospital';
  readonly prefixo: string | null;
  readonly tamanhoFixo: number | null;
  readonly numeroInicial: number;
  readonly numeroFinal: number;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

export interface FaixaGravada {
  readonly id: number;
  readonly numeroInicial: number;
  readonly numeroFinal: number;
  readonly situacao: string;
}

/** Número da guia como vai no arquivo: prefixo + número com zeros à esquerda até o tamanho fixo. */
export function formatarNumeroGuia(
  prefixo: string | null,
  tamanhoFixo: number | null,
  numero: number,
): string {
  const n = String(numero);
  return `${prefixo ?? ''}${tamanhoFixo ? n.padStart(tamanhoFixo, '0') : n}`;
}

export function errosFaixa(d: DadosFaixa, existentes: readonly FaixaGravada[]): string[] {
  const e: string[] = [];
  if (!(TIPOS_FAIXA_GUIA as readonly string[]).includes(d.tipoGuia)) e.push('tipo-guia-invalido');
  if (!Number.isSafeInteger(d.numeroInicial) || d.numeroInicial < 1) e.push('numero-inicial-invalido');
  if (!Number.isSafeInteger(d.numeroFinal) || d.numeroFinal < d.numeroInicial) e.push('faixa-invertida');
  if (d.prefixo !== null && !/^[A-Za-z0-9]{1,10}$/.test(d.prefixo)) e.push('prefixo-invalido');
  if (d.tamanhoFixo !== null && (d.tamanhoFixo < 1 || String(d.numeroFinal).length > d.tamanhoFixo))
    e.push('tamanho-insuficiente');
  if (formatarNumeroGuia(d.prefixo, d.tamanhoFixo, d.numeroFinal).length > 20) e.push('numero-longo');
  if (d.vigenciaFim !== null && d.vigenciaFim < d.vigenciaInicio) e.push('vigencia-invertida');
  if (
    existentes.some(
      (x) =>
        x.situacao !== 'encerrada' && x.numeroInicial <= d.numeroFinal && d.numeroInicial <= x.numeroFinal,
    )
  )
    e.push('faixa-sobreposta');
  return e;
}

export interface FaixaEmUso {
  readonly id: number;
  readonly prefixo: string | null;
  readonly tamanhoFixo: number | null;
  readonly numeroFinal: number;
  readonly proximoNumero: number;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly situacao: string;
}

/** A faixa a consumir na data: ativa, vigente e com número sobrando; a de início mais antigo primeiro. */
export function faixaParaEmitir(faixas: readonly FaixaEmUso[], dia: string): FaixaEmUso | null {
  return (
    [...faixas]
      .filter(
        (f) =>
          f.situacao === 'ativa' &&
          f.vigenciaInicio <= dia &&
          (f.vigenciaFim === null || f.vigenciaFim >= dia) &&
          f.proximoNumero <= f.numeroFinal,
      )
      .sort((a, b) =>
        a.vigenciaInicio < b.vigenciaInicio ? -1 : a.vigenciaInicio > b.vigenciaInicio ? 1 : a.id - b.id,
      )[0] ?? null
  );
}

/** Consome o próximo número da faixa: o número formatado, o próximo a gravar e se a faixa esgotou. */
export function consumirFaixa(f: FaixaEmUso): {
  numero: string;
  proximo: number;
  esgotada: boolean;
  restantes: number;
} {
  const proximo = f.proximoNumero + 1;
  return {
    numero: formatarNumeroGuia(f.prefixo, f.tamanhoFixo, f.proximoNumero),
    proximo,
    esgotada: proximo > f.numeroFinal,
    restantes: Math.max(0, f.numeroFinal - f.proximoNumero),
  };
}

/** Aviso de faixa no fim (para pedir outra à operadora antes de faltar número): sobram 10% ou menos. */
export function faixaNoFim(f: {
  numeroInicial: number;
  numeroFinal: number;
  proximoNumero: number;
}): boolean {
  const total = f.numeroFinal - f.numeroInicial + 1;
  const sobra = f.numeroFinal - f.proximoNumero + 1;
  return sobra <= Math.max(1, Math.ceil(total * 0.1));
}
