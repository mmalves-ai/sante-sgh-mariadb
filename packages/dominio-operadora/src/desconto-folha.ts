// Desconto em folha da mensalidade (08-SGO L97, C3-028): a remessa da competência à contratante (órgão ou empresa que
// desconta do salário do titular), o arquivo enviado, a leitura do retorno e a conciliação que baixa as cobranças.
// Regras puras (sem banco): o que entra na remessa e o que fica de fora com crítica; a ordem de alocação do valor
// descontado (da competência mais antiga para a mais nova, por matrícula funcional); as recusas do retorno (linha
// ilegível, matrícula fora da remessa ou repetida, desconto acima do enviado); o ciclo da remessa.
// Prática de mercado: o desconto em folha é um repasse da contratante; o que ela não descontou volta para a cobrança
// comum (fica em aberto), e o desconto parcial baixa só a parte descontada, com o saldo na remessa seguinte.

export const SITUACOES_REMESSA_FOLHA = [
  'gerada',
  'enviada',
  'retorno_recebido',
  'conferida',
  'cancelada',
] as const;
export type SituacaoRemessaFolha = (typeof SITUACOES_REMESSA_FOLHA)[number];

export const TIPOS_REMESSA_FOLHA = ['mensal', 'decimo_terceiro', 'complementar'] as const;
export type TipoRemessaFolha = (typeof TIPOS_REMESSA_FOLHA)[number];

export type SituacaoItemFolha =
  | 'pendente'
  | 'descontado'
  | 'descontado_parcial'
  | 'nao_descontado'
  | 'baixado_manual';

const PASSAGENS: Readonly<Record<SituacaoRemessaFolha, readonly SituacaoRemessaFolha[]>> = {
  gerada: ['enviada', 'cancelada'],
  enviada: ['retorno_recebido', 'cancelada'],
  retorno_recebido: ['conferida'],
  conferida: [],
  cancelada: [],
};

/** A remessa pode passar de `de` para `para`? (a que já teve retorno não é cancelada: as baixas já foram feitas). */
export function podePassarRemessaFolha(de: SituacaoRemessaFolha, para: SituacaoRemessaFolha): boolean {
  return PASSAGENS[de].includes(para);
}

/** Uma cobrança em aberto (ou com saldo) do contrato que desconta em folha, candidata à remessa. */
export interface CobrancaParaFolha {
  readonly fatura: number;
  readonly numero: string;
  readonly beneficiario: number | null;
  readonly matriculaFuncional: string | null;
  readonly percentualFolha: number | null;
  /** Primeiro dia da competência da cobrança (AAAA-MM-DD). */
  readonly competencia: string;
  readonly vencimento: string;
  /** O que falta pagar: valor total menos o já pago (desconto parcial anterior). */
  readonly saldo: number;
  /** A cobrança já está num item pendente de outra remessa não cancelada. */
  readonly emOutraRemessa: boolean;
}

export interface ItemRemessaFolha {
  readonly sequencia: number;
  readonly fatura: number;
  readonly numero: string;
  readonly beneficiario: number;
  readonly matriculaFuncional: string;
  readonly percentualFolha: number | null;
  readonly competencia: string;
  readonly valorEnviado: number;
  /** A parte do valor enviado que é de competência anterior à da remessa (mensalidade em atraso). */
  readonly valorAtrasado: number;
}

export type CodigoCriticaFolha = 'sem-responsavel' | 'sem-matricula' | 'ja-em-remessa' | 'sem-saldo';

export interface CriticaRemessaFolha {
  readonly fatura: number;
  readonly numero: string;
  readonly codigo: CodigoCriticaFolha;
  readonly mensagem: string;
}

export interface MontagemRemessaFolha {
  readonly itens: readonly ItemRemessaFolha[];
  readonly criticas: readonly CriticaRemessaFolha[];
  readonly valorTotal: number;
  readonly valorAtrasado: number;
}

const centavos = (v: number) => Math.round(v * 100) / 100;
const MENSAGEM: Readonly<Record<CodigoCriticaFolha, string>> = {
  'sem-responsavel': 'A cobrança não tem beneficiário responsável: o desconto em folha é do titular.',
  'sem-matricula': 'O beneficiário não tem matrícula funcional na contratante.',
  'ja-em-remessa': 'A cobrança já está em outra remessa ainda sem retorno.',
  'sem-saldo': 'A cobrança não tem saldo a descontar.',
};

/** Primeiro dia da competência AAAA-MM. */
export function inicioCompetenciaFolha(competencia: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)) throw new RangeError('competência AAAA-MM');
  return `${competencia}-01`;
}

/**
 * Monta a remessa da competência: entra a cobrança com saldo, de competência até a da remessa, do titular com
 * matrícula funcional e que não está noutra remessa pendente; o resto fica de fora com a crítica. Ordem: matrícula,
 * competência (a mais antiga primeiro), número.
 */
export function montarRemessaFolha(
  cobrancas: readonly CobrancaParaFolha[],
  competencia: string,
): MontagemRemessaFolha {
  const inicio = inicioCompetenciaFolha(competencia);
  const criticas: CriticaRemessaFolha[] = [];
  const aceitas: (CobrancaParaFolha & { beneficiario: number; matriculaFuncional: string })[] = [];
  for (const c of cobrancas) {
    if (c.competencia > inicio) continue;
    const codigo: CodigoCriticaFolha | null =
      c.saldo <= 0
        ? 'sem-saldo'
        : c.emOutraRemessa
          ? 'ja-em-remessa'
          : c.beneficiario === null
            ? 'sem-responsavel'
            : !c.matriculaFuncional?.trim()
              ? 'sem-matricula'
              : null;
    if (codigo) criticas.push({ fatura: c.fatura, numero: c.numero, codigo, mensagem: MENSAGEM[codigo] });
    else
      aceitas.push({
        ...c,
        beneficiario: c.beneficiario as number,
        matriculaFuncional: (c.matriculaFuncional as string).trim(),
      });
  }
  aceitas.sort(
    (a, b) =>
      a.matriculaFuncional.localeCompare(b.matriculaFuncional) ||
      a.competencia.localeCompare(b.competencia) ||
      a.numero.localeCompare(b.numero),
  );
  const itens = aceitas.map<ItemRemessaFolha>((c, i) => ({
    sequencia: i + 1,
    fatura: c.fatura,
    numero: c.numero,
    beneficiario: c.beneficiario,
    matriculaFuncional: c.matriculaFuncional,
    percentualFolha: c.percentualFolha,
    competencia: c.competencia,
    valorEnviado: centavos(c.saldo),
    valorAtrasado: c.competencia < inicio ? centavos(c.saldo) : 0,
  }));
  return {
    itens,
    criticas,
    valorTotal: centavos(itens.reduce((s, i) => s + i.valorEnviado, 0)),
    valorAtrasado: centavos(itens.reduce((s, i) => s + i.valorAtrasado, 0)),
  };
}

/** O arquivo da remessa à contratante (leiaute padrão: CSV com ";", valores com ponto decimal, uma linha por item). */
export function arquivoRemessaFolha(competencia: string, itens: readonly ItemRemessaFolha[]): string {
  const linhas = ['matricula;competencia;cobranca;competencia_cobranca;valor;valor_atrasado'];
  for (const i of itens)
    linhas.push(
      [
        i.matriculaFuncional,
        competencia,
        i.numero,
        i.competencia.slice(0, 7),
        i.valorEnviado.toFixed(2),
        i.valorAtrasado.toFixed(2),
      ].join(';'),
    );
  return `${linhas.join('\n')}\n`;
}

export interface LinhaRetornoFolha {
  readonly linha: number;
  readonly matricula: string;
  readonly valor: number;
}

export interface ProblemaRetornoFolha {
  readonly codigo:
    | 'retorno-vazio'
    | 'linha-ilegivel'
    | 'matricula-fora-da-remessa'
    | 'matricula-repetida'
    | 'desconto-acima-do-enviado';
  readonly linha: number | null;
  readonly mensagem: string;
}

const valorDoTexto = (t: string): number | null => {
  const s = t.trim().replace(/\s/g, '');
  if (!/^\d+([.,]\d{1,2})?$/.test(s)) return null;
  return Number(s.replace(',', '.'));
};

/**
 * Lê o arquivo de retorno da contratante: uma linha por matrícula, "matrícula;valor descontado" (separador ";" ou
 * ","; vírgula ou ponto decimal; o cabeçalho, se houver, é pulado). A linha que não se lê vira problema (sem valor).
 */
export function lerRetornoFolha(texto: string): {
  linhas: LinhaRetornoFolha[];
  problemas: ProblemaRetornoFolha[];
} {
  const linhas: LinhaRetornoFolha[] = [];
  const problemas: ProblemaRetornoFolha[] = [];
  texto.split(/\r?\n/).forEach((bruta, i) => {
    const t = bruta.trim();
    if (!t) return;
    const partes = t.split(';').length >= 2 ? t.split(';') : t.split(',');
    if (i === 0 && /matr/i.test(partes[0] ?? '')) return;
    const matricula = (partes[0] ?? '').trim();
    const valor = partes.length === 2 ? valorDoTexto(partes[1] ?? '') : null;
    if (!matricula || valor === null)
      problemas.push({
        codigo: 'linha-ilegivel',
        linha: i + 1,
        mensagem: `A linha ${i + 1} não está no leiaute "matrícula;valor descontado".`,
      });
    else linhas.push({ linha: i + 1, matricula, valor });
  });
  if (!linhas.length && !problemas.length)
    problemas.push({ codigo: 'retorno-vazio', linha: null, mensagem: 'O retorno não tem linhas.' });
  return { linhas, problemas };
}

export interface ItemConciliadoFolha {
  readonly sequencia: number;
  readonly fatura: number;
  readonly valorDescontado: number;
  readonly situacao: Exclude<SituacaoItemFolha, 'pendente' | 'baixado_manual'>;
}

export interface ConciliacaoRetornoFolha {
  readonly itens: readonly ItemConciliadoFolha[];
  readonly problemas: readonly ProblemaRetornoFolha[];
  readonly valorDescontado: number;
  readonly descontados: number;
  readonly parciais: number;
  readonly naoDescontados: number;
}

/**
 * Concilia o retorno com os itens da remessa: o valor descontado de cada matrícula é alocado nos itens dela da
 * competência mais antiga para a mais nova (a mensalidade em atraso é quitada antes). A matrícula que não está na
 * remessa, a repetida e o desconto acima do enviado são problemas (o retorno inteiro é recusado). A matrícula da
 * remessa ausente no retorno fica não descontada.
 */
export function conciliarRetornoFolha(
  itens: readonly Pick<ItemRemessaFolha, 'sequencia' | 'fatura' | 'matriculaFuncional' | 'competencia' | 'valorEnviado'>[],
  linhas: readonly LinhaRetornoFolha[],
): ConciliacaoRetornoFolha {
  const problemas: ProblemaRetornoFolha[] = [];
  const porMatricula = new Map<string, typeof itens>();
  for (const i of itens) porMatricula.set(i.matriculaFuncional, [...(porMatricula.get(i.matriculaFuncional) ?? []), i]);
  const descontado = new Map<string, number>();
  for (const l of linhas) {
    const doItem = porMatricula.get(l.matricula);
    if (!doItem) {
      problemas.push({
        codigo: 'matricula-fora-da-remessa',
        linha: l.linha,
        mensagem: `A matrícula da linha ${l.linha} não está na remessa.`,
      });
      continue;
    }
    if (descontado.has(l.matricula)) {
      problemas.push({
        codigo: 'matricula-repetida',
        linha: l.linha,
        mensagem: `A matrícula da linha ${l.linha} já veio noutra linha do retorno.`,
      });
      continue;
    }
    const enviado = centavos(doItem.reduce((s, i) => s + i.valorEnviado, 0));
    if (l.valor > enviado + 0.004)
      problemas.push({
        codigo: 'desconto-acima-do-enviado',
        linha: l.linha,
        mensagem: `O desconto da linha ${l.linha} passa do valor enviado (${enviado.toFixed(2)}).`,
      });
    descontado.set(l.matricula, l.valor);
  }
  const saida: ItemConciliadoFolha[] = [];
  for (const [matricula, doItem] of porMatricula) {
    let resto = descontado.get(matricula) ?? 0;
    const ordem = [...doItem].sort((a, b) => a.competencia.localeCompare(b.competencia) || a.sequencia - b.sequencia);
    for (const i of ordem) {
      const v = centavos(Math.min(resto, i.valorEnviado));
      resto = centavos(resto - v);
      saida.push({
        sequencia: i.sequencia,
        fatura: i.fatura,
        valorDescontado: v,
        situacao: v <= 0 ? 'nao_descontado' : v < i.valorEnviado ? 'descontado_parcial' : 'descontado',
      });
    }
  }
  saida.sort((a, b) => a.sequencia - b.sequencia);
  return {
    itens: saida,
    problemas,
    valorDescontado: centavos(saida.reduce((s, i) => s + i.valorDescontado, 0)),
    descontados: saida.filter((i) => i.situacao === 'descontado').length,
    parciais: saida.filter((i) => i.situacao === 'descontado_parcial').length,
    naoDescontados: saida.filter((i) => i.situacao === 'nao_descontado').length,
  };
}
