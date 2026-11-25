// Aplicação das regras do acordo com a fonte pagadora no valor do item lançado na conta (06-FAT linha 1, passo 3).
// Puro: recebe o item já valorizado pela tabela (honorário, custo operacional e filme unitários) e as regras vigentes
// na data do item, e devolve as parcelas ajustadas, o que foi aplicado (para a memória do cálculo) e os efeitos que a
// operação precisa tratar (recusa pelo teto, alerta, autorização exigida, cobrança à parte, excedente transferido).
// Ordem: isento (zera e encerra) > alto custo com preço negociado (substitui o preço) > percentual por componente >
// desconto ou acréscimo por grupo de despesa > via de acesso (cirurgia múltipla) > teto (limite e excedente).
// Em cada tipo vale a regra mais específica que casa com o item (item > grupo > plano > demais dimensões).

export type RegimeRegra = 'ambulatorial' | 'externo' | 'internacao' | 'urgencia' | 'domiciliar';

export interface ItemParaAcordo {
  readonly item: number;
  readonly grupo: number | null;
  readonly subgrupo: number | null;
  readonly plano: number | null;
  readonly tabela: number | null;
  readonly regimeId: number | null;
  /** Regimes do atendimento no vocabulário das regras (a urgência pelo caráter entra junto do regime). */
  readonly regimes: readonly RegimeRegra[];
  readonly funcaoEquipe: number | null;
  readonly tipoConta: number | null;
  readonly quantidade: number;
  readonly honorario: number;
  readonly custoOperacional: number;
  readonly filme: number;
  /** Via de acesso e ordem do procedimento no mesmo ato (a partir de 1); nulas: não é cirurgia múltipla. */
  readonly via: number | null;
  readonly ordemNoAto: number | null;
  /** Já cobrado antes deste item: do mesmo item, do mesmo grupo e da conta inteira. */
  readonly jaCobrado: {
    readonly item: { readonly valor: number; readonly quantidade: number; readonly ocorrencias: number };
    readonly grupo: { readonly valor: number; readonly quantidade: number; readonly ocorrencias: number };
    readonly conta: { readonly valor: number; readonly quantidade: number; readonly ocorrencias: number };
  };
}

interface Alvo {
  readonly item?: number | null;
  readonly grupo?: number | null;
  readonly plano?: number | null;
}

export interface RegraPercentualCalc extends Alvo {
  readonly id: number;
  readonly tabela: number | null;
  readonly componente: string;
  readonly tipoPaciente: string;
  readonly funcaoEquipe: number | null;
  readonly tipoConta: number | null;
  readonly percentual: number | null;
  readonly valorFixo: number | null;
}
export interface RegraDescontoCalc {
  readonly id: number;
  readonly grupo: number;
  readonly subgrupo: number | null;
  readonly acrescimo: number;
  readonly desconto: number;
  readonly sobre: readonly string[];
  readonly regimes: readonly string[];
}
export interface RegraViaCalc {
  readonly id: number;
  readonly via: number;
  readonly ordem: number;
  readonly percentual: number;
  readonly item: number | null;
  readonly padraoDeTodas: boolean;
}
export interface RegraIsentoCalc extends Alvo {
  readonly id: number;
  readonly regime: number | null;
  readonly motivo: string;
}
export interface RegraTetoCalc extends Alvo {
  readonly id: number;
  readonly abrangencia: string;
  readonly valorTeto: number | null;
  readonly quantidadeMaxima: number | null;
  readonly ocorrenciasMaximas: number | null;
  readonly acao: string;
  readonly excedenteFonte: number | null;
  readonly excedentePlano: number | null;
}
export interface RegraAltoCustoCalc extends Alvo {
  readonly id: number;
  readonly regra: string;
  readonly valorNegociado: number | null;
}

export interface RegrasVigentesCalc {
  readonly percentuais: readonly RegraPercentualCalc[];
  readonly descontos: readonly RegraDescontoCalc[];
  readonly vias: readonly RegraViaCalc[];
  readonly isentos: readonly RegraIsentoCalc[];
  readonly tetos: readonly RegraTetoCalc[];
  readonly altoCusto: readonly RegraAltoCustoCalc[];
}

export interface RegraAplicada {
  readonly tipo: 'isento' | 'alto-custo' | 'percentual' | 'desconto' | 'via' | 'teto';
  readonly id: number;
  readonly efeito: string;
}

export interface ResultadoAcordo {
  /** Valores do item inteiro (já multiplicados pela quantidade). */
  readonly honorario: number;
  readonly custoOperacional: number;
  readonly filme: number;
  readonly total: number;
  readonly unitario: number;
  readonly isento: boolean;
  readonly cobrancaAParte: boolean;
  readonly exigeAutorizacao: boolean;
  /** O teto recusa o lançamento (bloquear lançamento ou atendimento). */
  readonly recusa: { readonly codigo: string; readonly mensagem: string } | null;
  readonly alertas: readonly string[];
  readonly excedente: {
    readonly valor: number;
    readonly fonte: number | null;
    readonly plano: number | null;
  } | null;
  readonly aplicadas: readonly RegraAplicada[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Uma dimensão nula da regra vale para todos; preenchida, tem de ser igual à do item. */
const casa = (regra: number | null | undefined, doItem: number | null) =>
  regra === null || regra === undefined || regra === doItem;

const peso = (a: Alvo & { readonly extra?: number }) =>
  (a.item ? 8 : 0) + (a.grupo ? 4 : 0) + (a.plano ? 2 : 0) + (a.extra ?? 0);

function maisEspecifica<T extends Alvo>(lista: readonly T[], extra: (r: T) => number = () => 0): T | null {
  let melhor: T | null = null;
  let pMelhor = -1;
  for (const r of lista) {
    const p = peso({ ...r, extra: extra(r) });
    if (p > pMelhor) {
      melhor = r;
      pMelhor = p;
    }
  }
  return melhor;
}

const alvoCasa = (r: Alvo, i: ItemParaAcordo) =>
  casa(r.item, i.item) && casa(r.grupo, i.grupo) && casa(r.plano, i.plano);

/** Aplica as regras do acordo ao item. Nada aqui grava: a operação guarda o resultado e a memória do cálculo. */
export function aplicarRegrasAcordo(i: ItemParaAcordo, regras: RegrasVigentesCalc): ResultadoAcordo {
  const aplicadas: RegraAplicada[] = [];
  const alertas: string[] = [];
  const q = i.quantidade;
  const base = {
    isento: false,
    cobrancaAParte: false,
    exigeAutorizacao: false,
    recusa: null,
    excedente: null,
  };

  // 1) Isento: o item não se cobra da fonte pagadora (fica na conta com valor zero e o motivo na memória).
  const isento = maisEspecifica(
    regras.isentos.filter((r) => alvoCasa(r, i) && casa(r.regime, i.regimeId)),
    (r) => (r.regime ? 1 : 0),
  );
  if (isento) {
    aplicadas.push({ tipo: 'isento', id: isento.id, efeito: `isento: ${isento.motivo}` });
    return {
      ...base,
      isento: true,
      honorario: 0,
      custoOperacional: 0,
      filme: 0,
      total: 0,
      unitario: 0,
      alertas,
      aplicadas,
    };
  }

  let hon = i.honorario;
  let co = i.custoOperacional;
  let fil = i.filme;
  let cobrancaAParte = false;
  let exigeAutorizacao = false;

  // 2) Alto custo: cada regra que casa vale (cobrança à parte, autorização exigida, preço negociado).
  for (const regra of ['preco_negociado', 'cobranca_a_parte', 'exige_autorizacao'] as const) {
    const ac = maisEspecifica(regras.altoCusto.filter((r) => r.regra === regra && alvoCasa(r, i)));
    if (!ac) continue;
    if (regra === 'preco_negociado' && ac.valorNegociado !== null) {
      hon = 0;
      fil = 0;
      co = ac.valorNegociado;
      aplicadas.push({ tipo: 'alto-custo', id: ac.id, efeito: `preço negociado ${ac.valorNegociado}` });
    } else if (regra === 'cobranca_a_parte') {
      cobrancaAParte = true;
      aplicadas.push({ tipo: 'alto-custo', id: ac.id, efeito: 'cobrança à parte' });
    } else if (regra === 'exige_autorizacao') {
      exigeAutorizacao = true;
      alertas.push('alto-custo-exige-autorizacao');
      aplicadas.push({ tipo: 'alto-custo', id: ac.id, efeito: 'autorização exigida' });
    }
  }
  const negociado = aplicadas.some((a) => a.tipo === 'alto-custo' && a.efeito.startsWith('preço negociado'));

  // 3) Percentual ou valor fixo por componente (o preço negociado do alto custo não se reajusta pelo percentual).
  if (!negociado) {
    const internado = i.regimes.includes('internacao');
    const doComponente = (c: string) =>
      maisEspecifica(
        regras.percentuais.filter(
          (r) =>
            r.componente === c &&
            alvoCasa(r, i) &&
            casa(r.tabela, i.tabela) &&
            casa(r.funcaoEquipe, i.funcaoEquipe) &&
            casa(r.tipoConta, i.tipoConta) &&
            (r.tipoPaciente === 'todos' || (r.tipoPaciente === 'internado') === internado),
        ),
        (r) => (r.funcaoEquipe ? 1 : 0) + (r.tipoConta ? 1 : 0) + (r.tabela ? 1 : 0),
      );
    const ajustar = (c: string, v: number): number => {
      const r = doComponente(c);
      if (!r) return v;
      if (r.valorFixo !== null) {
        aplicadas.push({ tipo: 'percentual', id: r.id, efeito: `${c}: valor fixo ${r.valorFixo}` });
        return r.valorFixo;
      }
      if (r.percentual !== null) {
        aplicadas.push({ tipo: 'percentual', id: r.id, efeito: `${c}: ${r.percentual}%` });
        return (v * r.percentual) / 100;
      }
      return v;
    };
    hon = ajustar('honorario', hon);
    co = ajustar('custo_operacional', co);
    fil = ajustar('filme', fil);
    const total = doComponente('total');
    if (total && total.percentual !== null) {
      hon = (hon * total.percentual) / 100;
      co = (co * total.percentual) / 100;
      fil = (fil * total.percentual) / 100;
      aplicadas.push({ tipo: 'percentual', id: total.id, efeito: `total: ${total.percentual}%` });
    }

    // 4) Desconto ou acréscimo por grupo de despesa, nas parcelas marcadas e nos regimes marcados.
    const desc = maisEspecifica(
      regras.descontos
        .filter(
          (r) =>
            r.grupo === i.grupo &&
            casa(r.subgrupo, i.subgrupo) &&
            r.regimes.some((g) => i.regimes.includes(g as RegimeRegra)),
        )
        .map((r) => ({ ...r, item: null, plano: null })),
      (r) => (r.subgrupo ? 1 : 0),
    );
    if (desc) {
      const fator = 1 + (desc.acrescimo - desc.desconto) / 100;
      if (desc.sobre.includes('honorario')) hon *= fator;
      if (desc.sobre.includes('custo_operacional')) co *= fator;
      if (desc.sobre.includes('filme')) fil *= fator;
      aplicadas.push({
        tipo: 'desconto',
        id: desc.id,
        efeito: desc.desconto ? `desconto ${desc.desconto}%` : `acréscimo ${desc.acrescimo}%`,
      });
    }

    // 5) Via de acesso: o percentual pela ordem do procedimento no mesmo ato (a regra da fonte vence a padrão).
    if (i.via !== null && i.ordemNoAto !== null) {
      const daVia = regras.vias.filter(
        (r) => r.via === i.via && r.ordem === Math.min(i.ordemNoAto ?? 1, ordemMaxima(regras.vias, i.via)),
      );
      const via =
        maisEspecifica(
          daVia.filter((r) => casa(r.item, i.item)).map((r) => ({ ...r, grupo: null, plano: null })),
          (r) => (r.padraoDeTodas ? 0 : 1),
        ) ?? null;
      if (via) {
        hon = (hon * via.percentual) / 100;
        aplicadas.push({
          tipo: 'via',
          id: via.id,
          efeito: `via ${i.ordemNoAto}º procedimento: ${via.percentual}%`,
        });
      }
    }
  }

  let honT = r2(hon * q);
  let coT = r2(co * q);
  let filT = r2(fil * q);
  let total = r2(honT + coT + filT);

  // 6) Teto: o limite por item, grupo ou conta, contando o que já foi cobrado antes deste item.
  let recusa: ResultadoAcordo['recusa'] = null;
  let excedente: ResultadoAcordo['excedente'] = null;
  for (const abr of ['item', 'grupo', 'conta'] as const) {
    const teto = maisEspecifica(
      regras.tetos.filter(
        (r) =>
          r.abrangencia === abr &&
          casa(r.plano, i.plano) &&
          (abr !== 'item' || r.item === i.item) &&
          (abr !== 'grupo' || r.grupo === i.grupo),
      ),
    );
    if (!teto) continue;
    const ja = i.jaCobrado[abr];
    const passaValor = teto.valorTeto !== null && ja.valor + total > teto.valorTeto;
    const passaQtd = teto.quantidadeMaxima !== null && ja.quantidade + q > teto.quantidadeMaxima;
    const passaOcorr = teto.ocorrenciasMaximas !== null && ja.ocorrencias + 1 > teto.ocorrenciasMaximas;
    if (!passaValor && !passaQtd && !passaOcorr) continue;
    const motivo = passaValor ? 'valor' : passaQtd ? 'quantidade' : 'ocorrências';
    if (teto.acao === 'bloquear_lancamento' || teto.acao === 'bloquear_atendimento') {
      recusa = {
        codigo: 'teto-do-acordo',
        mensagem: `O lançamento passa do teto do acordo (${abr}, ${motivo}).`,
      };
      aplicadas.push({ tipo: 'teto', id: teto.id, efeito: `recusa: teto de ${abr} (${motivo})` });
      break;
    }
    if (teto.acao === 'alertar') {
      alertas.push(`teto-${abr}-${motivo === 'ocorrências' ? 'ocorrencias' : motivo}`);
      aplicadas.push({ tipo: 'teto', id: teto.id, efeito: `alerta: teto de ${abr} (${motivo})` });
      continue;
    }
    // Transferir o excedente: a conta fica com o limite e a diferença vai à fonte (ou ao plano) do excedente.
    const permitido = passaValor
      ? Math.max(0, r2((teto.valorTeto ?? 0) - ja.valor))
      : passaQtd
        ? r2((total * Math.max(0, (teto.quantidadeMaxima ?? 0) - ja.quantidade)) / q)
        : 0;
    if (permitido < total) {
      const f = total > 0 ? permitido / total : 0;
      const sobra = r2(total - permitido);
      honT = r2(honT * f);
      coT = r2(coT * f);
      filT = r2(permitido - honT - coT);
      total = permitido;
      excedente = {
        valor: r2(((excedente as ResultadoAcordo['excedente'])?.valor ?? 0) + sobra),
        fonte: teto.excedenteFonte,
        plano: teto.excedentePlano,
      };
      aplicadas.push({
        tipo: 'teto',
        id: teto.id,
        efeito: `excedente ${sobra} transferido (teto de ${abr})`,
      });
    }
  }

  return {
    honorario: honT,
    custoOperacional: coT,
    filme: filT,
    total,
    unitario: q > 0 ? r2(total / q) : 0,
    isento: false,
    cobrancaAParte,
    exigeAutorizacao,
    recusa,
    alertas,
    excedente,
    aplicadas,
  };
}

/** A ordem acima da última cadastrada segue o percentual da última (o 5º procedimento paga como o "demais"). */
function ordemMaxima(vias: readonly RegraViaCalc[], via: number): number {
  return vias.filter((v) => v.via === via).reduce((m, v) => Math.max(m, v.ordem), 1);
}

/**
 * O regime das regras a partir do código oficial do regime do atendimento (terminologia TISS de regime de atendimento:
 * 01 ambulatorial, 02 domiciliar, 03 internação, 04 pronto-socorro) e do caráter de urgência. A descrição livre não
 * decide nada (cada cliente escreve a sua). Sem regime no atendimento, o paciente é externo; com um código fora da
 * terminologia, nenhum regime casa e volta o alerta 'regime-sem-mapeamento' (nunca se presume 'externo').
 */
export const REGIME_POR_CODIGO_TISS: Readonly<Record<string, RegimeRegra>> = {
  '01': 'ambulatorial',
  '02': 'domiciliar',
  '03': 'internacao',
  '04': 'urgencia',
};

export function regimesDoAtendimento(
  codigoTiss: string | null,
  urgencia: boolean,
): { regimes: RegimeRegra[]; alerta: string | null } {
  const out: RegimeRegra[] = [];
  let alerta: string | null = null;
  const cod = codigoTiss?.trim() ?? '';
  if (cod === '') out.push('externo');
  else {
    const r = REGIME_POR_CODIGO_TISS[cod.padStart(2, '0')];
    if (r) out.push(r);
    else alerta = 'regime-sem-mapeamento';
  }
  if (urgencia && !out.includes('urgencia')) out.push('urgencia');
  return { regimes: out, alerta };
}
