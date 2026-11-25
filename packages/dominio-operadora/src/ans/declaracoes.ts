// Declarações periódicas da operadora além dos envios (08-SGO L110; F78.08): a apuração guardada da taxa de saúde
// suplementar (TPS, Lei 9.961/2000, art. 20, I: por beneficiário, recolhida por trimestre até o último dia útil do
// primeiro decêndio de março, junho, setembro e dezembro), a conferência cadastral da base que a ANS devolve (o cadastro
// próprio contra a base da agência, pelo código de controle operacional) e a declaração de serviços médicos e de saúde
// à Receita (DMED, IN RFB 985/2009: por titular e dependente, o que a pessoa física pagou no ano-calendário, entregue até
// o último dia útil de fevereiro do ano seguinte). Regras puras: a porta só guarda o que sai daqui.
import type { ResultadoTps } from './tps.js';

export interface ProblemaDeclaracao {
  readonly codigo: string;
  readonly campo: string;
  readonly detalhe: string;
}
const p = (codigo: string, campo: string, detalhe: string): ProblemaDeclaracao => ({
  codigo,
  campo,
  detalhe,
});

const z2 = (n: number) => String(n).padStart(2, '0');
const dataUtc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** O último dia útil (segunda a sexta) na data ou antes dela. Feriado local é conferido pelo responsável. */
export function ultimoDiaUtilAte(data: string): string {
  const d = dataUtc(data);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return iso(d);
}

// ---------------------------------------------------------------- TPS ----------------------------------------------

export type SituacaoApuracaoTps = 'apurada' | 'guia_emitida' | 'paga' | 'cancelada';

/** O último dia do trimestre (a data da vigência do valor por vida e do último mês contado). */
export function fimDoTrimestre(ano: number, trimestre: number): string {
  const mes = trimestre * 3;
  return iso(new Date(Date.UTC(ano, mes, 0)));
}

/** Vencimento da TPS do trimestre: último dia útil até o dia 10 do último mês do trimestre (art. 20, § 1º). */
export function vencimentoTps(ano: number, trimestre: number): string {
  return ultimoDiaUtilAte(`${ano}-${z2(trimestre * 3)}-10`);
}

export interface ApuracaoTps {
  readonly problemas: readonly ProblemaDeclaracao[];
  readonly quantidadeVidas: number;
  readonly valorPorVida: number;
  readonly valorTotal: number;
  readonly vigencia: string | null;
  readonly vencimento: string;
  /** A conta de cada plano, impressa (a soma das parcelas é o total). */
  readonly parcelas: readonly { readonly plano: string; readonly media: number; readonly valor: number }[];
}

export function apurarTps(r: ResultadoTps, ano: number, trimestre: number): ApuracaoTps {
  const problemas: ProblemaDeclaracao[] = [];
  if (!Number.isInteger(trimestre) || trimestre < 1 || trimestre > 4)
    problemas.push(p('trimestre-invalido', 'trimestre', 'O trimestre vai de 1 a 4.'));
  if (!r.vigencia)
    problemas.push(p('sem-valor-tps', 'trimestre', 'Não há valor por vida vigente no fim do trimestre.'));
  if (r.linhas.length === 0)
    problemas.push(p('sem-planos', 'operadora', 'A operadora não tem plano com beneficiário no trimestre.'));
  const parcelas = r.linhas.map((l) => ({ plano: l.nome, media: l.media, valor: l.valorCentavos / 100 }));
  return {
    problemas,
    quantidadeVidas: Math.round(r.linhas.reduce((a, l) => a + l.media, 0)),
    valorPorVida: r.vigencia?.valorTrimestral ?? 0,
    valorTotal: r.totalCentavos / 100,
    vigencia: r.vigencia?.vigencia ?? null,
    vencimento: vencimentoTps(ano, trimestre),
    parcelas,
  };
}

export interface PassoTps {
  readonly para: 'guia_emitida' | 'paga' | 'cancelada';
  readonly nossoNumero?: string | null | undefined;
  readonly vencimento?: string | null | undefined;
  readonly dataPagamento?: string | null | undefined;
  readonly valorPago?: number | null | undefined;
}

/** Os passos da apuração: guia emitida (com o número), paga (data e valor, nunca menor que o apurado), cancelada. */
export function problemasDoPassoTps(
  atual: SituacaoApuracaoTps,
  total: number,
  x: PassoTps,
  hoje: string,
): ProblemaDeclaracao[] {
  const r: ProblemaDeclaracao[] = [];
  const permitidos: Record<SituacaoApuracaoTps, readonly string[]> = {
    apurada: ['guia_emitida', 'paga', 'cancelada'],
    guia_emitida: ['paga', 'cancelada'],
    paga: [],
    cancelada: [],
  };
  if (!permitidos[atual].includes(x.para))
    return [p('passo-invalido', 'situacao', `A apuração ${atual} não pode passar a ${x.para}.`)];
  if (x.para === 'guia_emitida' && !x.nossoNumero?.trim())
    r.push(p('sem-numero-guia', 'nossoNumero', 'Informe o número de identificação da guia.'));
  if (x.para === 'paga') {
    if (!x.dataPagamento) r.push(p('sem-data-pagamento', 'dataPagamento', 'Informe a data do pagamento.'));
    else if (x.dataPagamento > hoje)
      r.push(p('pagamento-futuro', 'dataPagamento', 'O pagamento não pode ser em data futura.'));
    if (x.valorPago === null || x.valorPago === undefined || x.valorPago <= 0)
      r.push(p('sem-valor-pago', 'valorPago', 'Informe o valor pago.'));
    else if (Math.round(x.valorPago * 100) < Math.round(total * 100))
      r.push(p('pago-menor', 'valorPago', 'O valor pago é menor que o apurado.'));
  }
  return r;
}

// --------------------------------------------------------- conferência cadastral -----------------------------------

export interface RegistroConferencia {
  readonly cco: string;
  readonly nome: string;
  readonly nascimento: string | null;
  readonly cpf: string | null;
  readonly cns: string | null;
  readonly registroPlano: string | null;
  readonly ativo: boolean;
}
export interface BeneficiarioConferencia extends Omit<RegistroConferencia, 'cco'> {
  readonly id: number;
  readonly cco: string | null;
}

export type TipoDivergencia =
  'nao_localizado_cadastro' | 'nao_localizado_ans' | 'campo_divergente' | 'situacao_divergente';

export interface Divergencia {
  readonly beneficiario: number | null;
  readonly cco: string | null;
  readonly tipo: TipoDivergencia;
  readonly campo: string | null;
  readonly valorCadastro: string | null;
  readonly valorAns: string | null;
  readonly ativoNaAns: boolean | null;
}

const soDigitos = (v: string | null) => (v ?? '').replace(/\D/g, '');
const nomeComparavel = (v: string | null) =>
  (v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();

/** Lê a data do arquivo (AAAA-MM-DD ou DD/MM/AAAA). */
function dataDoArquivo(v: string): string | null {
  const t = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * O arquivo da conferência em texto separado por ponto e vírgula, com cabeçalho: código de controle, nome,
 * nascimento, CPF, CNS, registro do plano na agência e situação (ATIVO ou INATIVO). Linha inválida vira problema com o
 * número da linha (nunca o conteúdo).
 */
export function lerArquivoConferencia(texto: string): {
  registros: RegistroConferencia[];
  problemas: ProblemaDeclaracao[];
} {
  const linhas = texto.replace(/^\uFEFF/, '').split(/\r?\n/);
  const registros: RegistroConferencia[] = [];
  const problemas: ProblemaDeclaracao[] = [];
  const vistos = new Set<string>();
  linhas.forEach((l, i) => {
    if (i === 0 || !l.trim()) return;
    const c = l.split(';').map((x) => x.trim());
    const [cco = '', nome = '', nasc = '', cpf = '', cns = '', plano = '', sit = ''] = c;
    const nascimento = nasc ? dataDoArquivo(nasc) : null;
    const situacao = sit.toUpperCase();
    if (
      c.length < 7 ||
      !/^\d{1,12}$/.test(cco) ||
      !nome ||
      (nasc && !nascimento) ||
      !/^(ATIVO|INATIVO)$/.test(situacao)
    ) {
      problemas.push(p('linha-invalida', 'arquivo', `Linha ${i + 1} fora do leiaute.`));
      return;
    }
    if (vistos.has(cco)) {
      problemas.push(p('cco-repetido', 'arquivo', `Linha ${i + 1}: código de controle repetido.`));
      return;
    }
    vistos.add(cco);
    registros.push({
      cco,
      nome,
      nascimento,
      cpf: soDigitos(cpf) || null,
      cns: soDigitos(cns) || null,
      registroPlano: plano || null,
      ativo: situacao === 'ATIVO',
    });
  });
  if (registros.length === 0 && problemas.length === 0)
    problemas.push(p('arquivo-vazio', 'arquivo', 'O arquivo não tem registro.'));
  return { registros, problemas };
}

/**
 * Confere o cadastro próprio contra a base da agência, pelo código de controle: o registro da agência sem
 * beneficiário no cadastro, o beneficiário ativo com código que a agência não devolveu, a situação diferente e cada
 * campo diferente (nome sem acento e caixa, nascimento, CPF, CNS e registro do plano). Sem código de controle, o
 * beneficiário ainda não foi aceito no SIB e fica fora (a pendência é do SIB).
 */
export function conferirCadastro(
  cadastro: readonly BeneficiarioConferencia[],
  ans: readonly RegistroConferencia[],
): Divergencia[] {
  const porCco = new Map<string, BeneficiarioConferencia>();
  for (const b of cadastro) if (b.cco) porCco.set(soDigitos(b.cco), b);
  const r: Divergencia[] = [];
  const naAns = new Set<string>();
  for (const a of ans) {
    const cco = soDigitos(a.cco);
    naAns.add(cco);
    const b = porCco.get(cco);
    if (!b) {
      r.push({
        beneficiario: null,
        cco: a.cco,
        tipo: 'nao_localizado_cadastro',
        campo: null,
        valorCadastro: null,
        valorAns: null,
        ativoNaAns: a.ativo,
      });
      continue;
    }
    const base = { beneficiario: b.id, cco: a.cco, ativoNaAns: a.ativo };
    if (b.ativo !== a.ativo)
      r.push({
        ...base,
        tipo: 'situacao_divergente',
        campo: 'situacao',
        valorCadastro: b.ativo ? 'ativo' : 'inativo',
        valorAns: a.ativo ? 'ativo' : 'inativo',
      });
    const campos: [string, string | null, string | null, (v: string | null) => string][] = [
      ['nome', b.nome, a.nome, nomeComparavel],
      ['nascimento', b.nascimento, a.nascimento, (v) => v ?? ''],
      ['cpf', b.cpf, a.cpf, soDigitos],
      ['cns', b.cns, a.cns, soDigitos],
      ['registroPlano', b.registroPlano, a.registroPlano, soDigitos],
    ];
    for (const [campo, vc, va, norm] of campos)
      if (norm(vc) !== norm(va))
        r.push({ ...base, tipo: 'campo_divergente', campo, valorCadastro: vc, valorAns: va });
  }
  for (const b of cadastro)
    if (b.cco && b.ativo && !naAns.has(soDigitos(b.cco)))
      r.push({
        beneficiario: b.id,
        cco: b.cco,
        tipo: 'nao_localizado_ans',
        campo: null,
        valorCadastro: null,
        valorAns: null,
        ativoNaAns: null,
      });
  return r;
}

export type CorrecaoDivergencia =
  'pendente' | 'corrigir_cadastro' | 'retificar_ans' | 'corrigida' | 'ignorada';

/** O tratamento da divergência: encaminhar (corrigir o cadastro ou retificar na agência), concluir ou ignorar com motivo. */
export function problemasDaCorrecao(
  atual: CorrecaoDivergencia,
  para: CorrecaoDivergencia,
  justificativa: string | null,
): ProblemaDeclaracao[] {
  const permitidos: Record<CorrecaoDivergencia, readonly CorrecaoDivergencia[]> = {
    pendente: ['corrigir_cadastro', 'retificar_ans', 'corrigida', 'ignorada'],
    corrigir_cadastro: ['corrigida', 'ignorada', 'retificar_ans'],
    retificar_ans: ['corrigida', 'ignorada', 'corrigir_cadastro'],
    corrigida: [],
    ignorada: [],
  };
  if (!permitidos[atual].includes(para))
    return [p('passo-invalido', 'correcao', `A divergência ${atual} não pode passar a ${para}.`)];
  if (para === 'ignorada' && !justificativa?.trim())
    return [p('sem-justificativa', 'justificativa', 'Diga por que a divergência fica sem correção.')];
  return [];
}

// ---------------------------------------------------------------- DMED ---------------------------------------------

/** Idade a partir da qual o CPF do dependente é exigido no leiaute (conferir a cada ano com o programa da Receita). */
export const IDADE_CPF_DEPENDENTE_DMED = 18;

/** Prazo de entrega da declaração do ano-calendário: último dia útil de fevereiro do ano seguinte. */
export function prazoDmed(anoCalendario: number): string {
  return ultimoDiaUtilAte(iso(new Date(Date.UTC(anoCalendario + 1, 2, 0))));
}

export function cpfValidoDmed(cpf: string | null): boolean {
  const d = soDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

export interface PagamentoDmed {
  readonly beneficiario: number;
  /** Titular do dependente; nulo no próprio titular. */
  readonly titular: number | null;
  readonly nome: string;
  readonly cpf: string | null;
  readonly nascimento: string | null;
  /** O que a pessoa pagou no ano (o rateio da fatura paga), em centavos. */
  readonly centavos: number;
}

export interface ItemDmed {
  readonly sequencia: number;
  readonly beneficiario: number;
  readonly titular: number | null;
  readonly tipo: 'titular' | 'dependente';
  readonly nome: string;
  readonly cpf: string | null;
  readonly nascimento: string | null;
  readonly valor: number;
}

const idadeEm = (nascimento: string, data: string) => {
  const [an, mn, dn] = nascimento.split('-').map(Number) as [number, number, number];
  const [a, m, d] = data.split('-').map(Number) as [number, number, number];
  return a - an - (m < mn || (m === mn && d < dn) ? 1 : 0);
};

/**
 * Os itens da declaração: o que cada pessoa pagou no ano, somado por beneficiário, titular antes dos seus
 * dependentes (ordem do leiaute). Pagamento zero sai. Problemas: titular sem CPF válido; dependente com a idade do
 * leiaute em 31/12 sem CPF válido; dependente cujo titular não pagou nada no ano (o leiaute pede o titular).
 */
export function montarDmed(
  anoCalendario: number,
  pagamentos: readonly PagamentoDmed[],
): { itens: ItemDmed[]; problemas: ProblemaDeclaracao[]; totalCentavos: number } {
  const soma = new Map<number, PagamentoDmed & { centavos: number }>();
  for (const x of pagamentos) {
    const a = soma.get(x.beneficiario);
    soma.set(x.beneficiario, { ...x, centavos: (a?.centavos ?? 0) + x.centavos });
  }
  const com = [...soma.values()].filter((x) => x.centavos > 0);
  const titulares = com.filter((x) => x.titular === null).sort((a, b) => a.beneficiario - b.beneficiario);
  const problemas: ProblemaDeclaracao[] = [];
  const itens: ItemDmed[] = [];
  const fim = `${anoCalendario}-12-31`;
  for (const t of titulares) {
    if (!cpfValidoDmed(t.cpf))
      problemas.push(p('titular-sem-cpf', 'cpf', `Beneficiário ${t.beneficiario}: titular sem CPF válido.`));
    itens.push({ ...t, sequencia: itens.length + 1, tipo: 'titular', valor: t.centavos / 100 });
    for (const d of com
      .filter((x) => x.titular === t.beneficiario)
      .sort((a, b) => a.beneficiario - b.beneficiario)) {
      if (d.nascimento && idadeEm(d.nascimento, fim) >= IDADE_CPF_DEPENDENTE_DMED && !cpfValidoDmed(d.cpf))
        problemas.push(
          p('dependente-sem-cpf', 'cpf', `Beneficiário ${d.beneficiario}: dependente maior sem CPF válido.`),
        );
      itens.push({ ...d, sequencia: itens.length + 1, tipo: 'dependente', valor: d.centavos / 100 });
    }
  }
  const ids = new Set(titulares.map((t) => t.beneficiario));
  for (const d of com.filter((x) => x.titular !== null && !ids.has(x.titular)))
    problemas.push(
      p('dependente-sem-titular', 'titular', `Beneficiário ${d.beneficiario}: o titular não pagou no ano.`),
    );
  return { itens, problemas, totalCentavos: itens.reduce((a, i) => a + Math.round(i.valor * 100), 0) };
}

export interface CabecalhoDmed {
  readonly anoCalendario: number;
  readonly anoReferencia: number;
  readonly retificadora: boolean;
  readonly reciboAnterior: string | null;
  readonly responsavelCpf: string;
  readonly responsavelNome: string;
  readonly responsavelDdd: string | null;
  readonly responsavelTelefone: string | null;
  readonly responsavelEmail: string | null;
  readonly cnpj: string;
  readonly razaoSocial: string;
  readonly registroAns: string;
}

export function problemasDaDeclaracao(
  c: Pick<
    CabecalhoDmed,
    'anoCalendario' | 'retificadora' | 'reciboAnterior' | 'responsavelCpf' | 'responsavelNome'
  >,
  hoje: string,
): ProblemaDeclaracao[] {
  const r: ProblemaDeclaracao[] = [];
  if (
    !Number.isInteger(c.anoCalendario) ||
    c.anoCalendario >= Number(hoje.slice(0, 4)) ||
    c.anoCalendario < 2009
  )
    r.push(p('ano-invalido', 'anoCalendario', 'O ano-calendário é um ano já encerrado (desde 2009).'));
  if (!cpfValidoDmed(c.responsavelCpf))
    r.push(p('cpf-responsavel', 'responsavelCpf', 'CPF do responsável inválido.'));
  if (!c.responsavelNome.trim()) r.push(p('sem-responsavel', 'responsavelNome', 'Informe o responsável.'));
  if (c.retificadora && !c.reciboAnterior)
    r.push(
      p('retificadora-sem-recibo', 'retificadora', 'A retificadora exige a declaração entregue com recibo.'),
    );
  return r;
}

export type SituacaoDmed = 'em_preparacao' | 'gerada' | 'transmitida' | 'aceita' | 'rejeitada' | 'cancelada';

export function problemasDoPassoDmed(
  atual: SituacaoDmed,
  para: SituacaoDmed,
  recibo: string | null,
): ProblemaDeclaracao[] {
  const permitidos: Record<SituacaoDmed, readonly SituacaoDmed[]> = {
    em_preparacao: ['gerada', 'cancelada'],
    gerada: ['transmitida', 'cancelada'],
    transmitida: ['aceita', 'rejeitada'],
    aceita: [],
    rejeitada: [],
    cancelada: [],
  };
  if (!permitidos[atual].includes(para))
    return [p('passo-invalido', 'situacao', `A declaração ${atual} não pode passar a ${para}.`)];
  if (para === 'transmitida' && !recibo?.trim())
    return [p('sem-recibo', 'numeroRecibo', 'Informe o número do recibo da entrega.')];
  return [];
}

const campo = (v: string | number | null | undefined) => String(v ?? '').replace(/[|\r\n]/g, ' ');
const centavos = (v: number) => String(Math.round(v * 100));

/** O arquivo da declaração, em registros separados por barra vertical (DMED, RESPO, DECPJ, OPPAS, TOP, DTOP, FIMDmed). */
export function arquivoDmed(c: CabecalhoDmed, itens: readonly ItemDmed[]): string {
  const l: string[] = [
    ['DMED', c.anoReferencia, c.anoCalendario, c.retificadora ? 'S' : 'N', c.reciboAnterior ?? '']
      .map(campo)
      .join('|') + '|',
    [
      'RESPO',
      soDigitos(c.responsavelCpf),
      c.responsavelNome,
      c.responsavelDdd ?? '',
      c.responsavelTelefone ?? '',
      '',
      '',
      c.responsavelEmail ?? '',
    ]
      .map(campo)
      .join('|') + '|',
    [
      'DECPJ',
      soDigitos(c.cnpj),
      c.razaoSocial,
      '1',
      soDigitos(c.registroAns),
      '',
      'N',
      soDigitos(c.responsavelCpf),
      'N',
      '',
    ]
      .map(campo)
      .join('|') + '|',
    'OPPAS|',
  ];
  for (const i of itens)
    l.push(
      i.tipo === 'titular'
        ? ['TOP', soDigitos(i.cpf), i.nome, centavos(i.valor)].map(campo).join('|') + '|'
        : ['DTOP', soDigitos(i.cpf), (i.nascimento ?? '').replace(/-/g, ''), i.nome, '', centavos(i.valor)]
            .map(campo)
            .join('|') + '|',
    );
  l.push('FIMDmed|');
  return l.join('\r\n') + '\r\n';
}
