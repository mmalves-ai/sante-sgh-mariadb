// Habilitações, serviços e classificações SUS do estabelecimento e regras por tipo de prestador (F7, 06-SUS linha 61).
// Regras puras: a vigência por competência (primeiro dia do mês ao último), a recusa de sobreposição da mesma
// habilitação ou do mesmo serviço, a exigência de leitos quando a habilitação os pede, o prestador do serviço
// terceirizado, o alvo das regras, a conciliação com o cadastro nacional de estabelecimentos (o que entra, o que se
// encerra na véspera da competência e o que pede decisão), a lista vigente numa competência (que a compatibilidade
// usa no lugar do parâmetro de texto), a permissão por tipo de prestador (a regra mais específica vale; empate,
// vedação) e o serviço e classificação automáticos da produção (menor prioridade primeiro). Nada é apagado: a
// habilitação que sai do cadastro nacional é encerrada.

export interface ProblemaEstabelecimentoSus {
  readonly campo: string;
  readonly mensagem: string;
}

export interface VigenciaSus {
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const diaValido = (d: string): boolean => {
  if (!DIA.test(d)) return false;
  const x = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(x.getTime()) && x.toISOString().slice(0, 10) === d;
};
const somarDiasSus = (d: string, n: number): string => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const mesSeguinte = (d: string): string => {
  const [a, m] = [Number(d.slice(0, 4)), Number(d.slice(5, 7))];
  return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, '0')}-01`;
};
/** Último dia do mês da data dada. */
export const fimDoMesSus = (d: string): string => somarDiasSus(mesSeguinte(d), -1);

/** O primeiro e o último dia da competência AAAAMM (null quando a competência é inválida). */
export function diasDaCompetenciaSus(competencia: string): { inicio: string; fim: string } | null {
  if (!/^\d{6}$/.test(competencia)) return null;
  const mes = Number(competencia.slice(4));
  if (mes < 1 || mes > 12) return null;
  const inicio = `${competencia.slice(0, 4)}-${competencia.slice(4)}-01`;
  return { inicio, fim: fimDoMesSus(inicio) };
}

/** A vigência alcança algum dia da competência. */
export function vigenteNaCompetenciaSus(v: VigenciaSus, competencia: string): boolean {
  const c = diasDaCompetenciaSus(competencia);
  if (!c) return false;
  return v.vigenciaInicio <= c.fim && (v.vigenciaFim === null || v.vigenciaFim >= c.inicio);
}

const sobrepoe = (a: VigenciaSus, b: VigenciaSus): boolean =>
  a.vigenciaInicio <= (b.vigenciaFim ?? '9999-12-31') && b.vigenciaInicio <= (a.vigenciaFim ?? '9999-12-31');

/** Código como a compatibilidade compara ("0801" e "801" são o mesmo). */
export const normalHabilitacao = (c: string): string => String(Number(c.trim()) || 0);

function conferirVigencia(v: VigenciaSus, p: ProblemaEstabelecimentoSus[]): boolean {
  if (!diaValido(v.vigenciaInicio)) {
    p.push({ campo: 'vigenciaInicio', mensagem: 'Informe o início da vigência (data válida).' });
    return false;
  }
  if (v.vigenciaInicio.slice(8) !== '01')
    p.push({ campo: 'vigenciaInicio', mensagem: 'A vigência começa no primeiro dia da competência.' });
  if (v.vigenciaFim !== null) {
    if (!diaValido(v.vigenciaFim)) {
      p.push({ campo: 'vigenciaFim', mensagem: 'O fim da vigência não é uma data válida.' });
      return false;
    }
    if (v.vigenciaFim !== fimDoMesSus(v.vigenciaFim))
      p.push({ campo: 'vigenciaFim', mensagem: 'A vigência termina no último dia da competência.' });
    if (v.vigenciaFim < v.vigenciaInicio)
      p.push({ campo: 'vigenciaFim', mensagem: 'O fim da vigência é anterior ao início.' });
  }
  return true;
}

export interface HabilitacaoEstabelecimentoVigencia extends VigenciaSus {
  readonly id?: number;
  readonly codigo: string;
}

export interface NovaHabilitacaoEstabelecimento extends VigenciaSus {
  readonly codigo: string;
  readonly exigeLeitos: boolean;
  readonly leitosHabilitados: number | null;
  readonly numeroPortaria: string | null;
  readonly dataPortaria: string | null;
}

/** Confere uma habilitação do estabelecimento contra as outras da mesma habilitação (a própria fica de fora). */
export function conferirHabilitacaoEstabelecimento(
  e: NovaHabilitacaoEstabelecimento,
  existentes: readonly HabilitacaoEstabelecimentoVigencia[],
  propria: number | null = null,
): ProblemaEstabelecimentoSus[] {
  const p: ProblemaEstabelecimentoSus[] = [];
  if (!/^\d{1,6}$/.test(e.codigo.trim()))
    p.push({ campo: 'codigo', mensagem: 'O código da habilitação tem de 1 a 6 dígitos.' });
  const ok = conferirVigencia(e, p);
  if (e.exigeLeitos && (e.leitosHabilitados === null || e.leitosHabilitados <= 0))
    p.push({
      campo: 'leitosHabilitados',
      mensagem: 'Esta habilitação exige a quantidade de leitos habilitados.',
    });
  if (e.leitosHabilitados !== null && (e.leitosHabilitados < 0 || e.leitosHabilitados > 9999))
    p.push({ campo: 'leitosHabilitados', mensagem: 'Leitos habilitados de 0 a 9999.' });
  if (e.dataPortaria !== null) {
    if (!diaValido(e.dataPortaria))
      p.push({ campo: 'dataPortaria', mensagem: 'A data da portaria não é uma data válida.' });
    else if (!e.numeroPortaria?.trim())
      p.push({ campo: 'numeroPortaria', mensagem: 'Informe o número da portaria que tem essa data.' });
  }
  if (ok && /^\d{1,6}$/.test(e.codigo.trim())) {
    const cod = normalHabilitacao(e.codigo);
    const outra = existentes.find(
      (x) => x.id !== propria && normalHabilitacao(x.codigo) === cod && sobrepoe(x, e),
    );
    if (outra)
      p.push({
        campo: 'vigenciaInicio',
        mensagem: `A habilitação ${e.codigo.trim()} já está cadastrada nesse período (desde ${outra.vigenciaInicio}).`,
      });
  }
  return p;
}

/** As habilitações vigentes na competência, normalizadas como a compatibilidade compara. */
export function habilitacoesNaCompetencia(
  lista: readonly HabilitacaoEstabelecimentoVigencia[],
  competencia: string,
): ReadonlySet<string> {
  return new Set(
    lista.filter((h) => vigenteNaCompetenciaSus(h, competencia)).map((h) => normalHabilitacao(h.codigo)),
  );
}

/**
 * As habilitações que a crítica da competência usa: as do cadastro do estabelecimento quando há cadastro; sem nenhuma
 * linha cadastrada, as do parâmetro de texto (transição de quem ainda não cadastrou).
 */
export function habilitacoesDaCompetencia(
  cadastradas: readonly HabilitacaoEstabelecimentoVigencia[] | undefined,
  competencia: string,
  doParametro: ReadonlySet<string>,
): ReadonlySet<string> {
  if (!cadastradas || cadastradas.length === 0) return doParametro;
  return habilitacoesNaCompetencia(cadastradas, competencia);
}

export interface HabilitacaoDoCnes {
  readonly codigo: string;
  readonly vigenciaInicio?: string | null;
  readonly vigenciaFim?: string | null;
  readonly numeroPortaria?: string | null;
  readonly dataPortaria?: string | null;
  readonly leitosHabilitados?: number | null;
}

export interface ConciliacaoCnes {
  readonly incluir: readonly (HabilitacaoDoCnes & { vigenciaInicio: string; vigenciaFim: string | null })[];
  readonly encerrar: readonly { id: number; codigo: string; vigenciaFim: string }[];
  /** Saíram do cadastro nacional mas começaram na própria competência ou depois: decisão de quem confere. */
  readonly conflitos: readonly { id: number; codigo: string; motivo: string }[];
  readonly mantidas: number;
}

/**
 * Concilia as habilitações do estabelecimento com a lista do cadastro nacional da competência: as que faltam entram
 * (do primeiro dia da competência, salvo a vigência dada), as abertas que saíram se encerram na véspera da
 * competência e as que já batem ficam como estão.
 */
export function conciliarHabilitacoesCnes(
  atuais: readonly (HabilitacaoEstabelecimentoVigencia & { id: number })[],
  cnes: readonly HabilitacaoDoCnes[],
  competencia: string,
): ConciliacaoCnes {
  const c = diasDaCompetenciaSus(competencia);
  if (!c) throw new Error('competência inválida');
  const vigentes = atuais.filter((a) => vigenteNaCompetenciaSus(a, competencia));
  const doCnes = new Map<string, HabilitacaoDoCnes>();
  for (const h of cnes) if (/^\d{1,6}$/.test(h.codigo.trim())) doCnes.set(normalHabilitacao(h.codigo), h);
  const incluir: ConciliacaoCnes['incluir'][number][] = [];
  let mantidas = 0;
  for (const [cod, h] of doCnes) {
    if (vigentes.some((a) => normalHabilitacao(a.codigo) === cod)) {
      mantidas++;
      continue;
    }
    incluir.push({ ...h, vigenciaInicio: h.vigenciaInicio ?? c.inicio, vigenciaFim: h.vigenciaFim ?? null });
  }
  const vespera = somarDiasSus(c.inicio, -1);
  const encerrar: { id: number; codigo: string; vigenciaFim: string }[] = [];
  const conflitos: { id: number; codigo: string; motivo: string }[] = [];
  for (const a of vigentes) {
    if (doCnes.has(normalHabilitacao(a.codigo))) continue;
    if (a.vigenciaInicio > vespera)
      conflitos.push({
        id: a.id,
        codigo: a.codigo,
        motivo: 'Começou na competência e não está no cadastro nacional: confira e encerre ou mantenha.',
      });
    else if (a.vigenciaFim === null || a.vigenciaFim > vespera)
      encerrar.push({ id: a.id, codigo: a.codigo, vigenciaFim: vespera });
  }
  return { incluir, encerrar, conflitos, mantidas };
}

export const CARACTERISTICAS_SERVICO_SUS = ['proprio', 'terceirizado'] as const;
export type CaracteristicaServicoSus = (typeof CARACTERISTICAS_SERVICO_SUS)[number];

export interface ServicoEstabelecimentoVigencia extends VigenciaSus {
  readonly id?: number;
  readonly servicoClassificacao: number;
  readonly ativo?: boolean;
}

export interface NovoServicoEstabelecimento extends VigenciaSus {
  readonly servicoClassificacao: number;
  readonly caracteristica: CaracteristicaServicoSus;
  readonly prestadorExterno: number | null;
}

/** Confere um serviço e classificação do estabelecimento (terceirizado pede o prestador; sem sobreposição). */
export function conferirServicoEstabelecimento(
  e: NovoServicoEstabelecimento,
  existentes: readonly ServicoEstabelecimentoVigencia[],
  propria: number | null = null,
): ProblemaEstabelecimentoSus[] {
  const p: ProblemaEstabelecimentoSus[] = [];
  const ok = conferirVigencia(e, p);
  if (e.caracteristica === 'terceirizado' && e.prestadorExterno === null)
    p.push({ campo: 'prestadorExterno', mensagem: 'O serviço terceirizado pede o prestador que o executa.' });
  if (e.caracteristica === 'proprio' && e.prestadorExterno !== null)
    p.push({ campo: 'prestadorExterno', mensagem: 'O serviço próprio não tem prestador externo.' });
  if (ok) {
    const outra = existentes.find(
      (x) =>
        x.id !== propria &&
        x.ativo !== false &&
        x.servicoClassificacao === e.servicoClassificacao &&
        sobrepoe(x, e),
    );
    if (outra)
      p.push({
        campo: 'vigenciaInicio',
        mensagem: `Esse serviço e classificação já está cadastrado nesse período (desde ${outra.vigenciaInicio}).`,
      });
  }
  return p;
}

export interface AlvoRegraSus {
  readonly procedimento: number | null;
  readonly grupo: number | null;
  readonly servicoClassificacao: number | null;
}

export interface NovaRegraPrestadorSus extends VigenciaSus, AlvoRegraSus {
  readonly tipoPrestador: number;
}

/** Confere a regra por tipo de prestador: algum alvo (procedimento, grupo ou serviço) e vigência por competência. */
export function conferirRegraPrestador(e: NovaRegraPrestadorSus): ProblemaEstabelecimentoSus[] {
  const p: ProblemaEstabelecimentoSus[] = [];
  if (e.procedimento === null && e.grupo === null && e.servicoClassificacao === null)
    p.push({ campo: 'procedimento', mensagem: 'Indique o procedimento, o grupo ou o serviço da regra.' });
  conferirVigencia(e, p);
  return p;
}

export interface RegraPrestadorSus extends VigenciaSus, AlvoRegraSus {
  readonly id: number;
  readonly estabelecimento: number | null;
  readonly tipoPrestador: number;
  readonly naturezaJuridica: number | null;
  readonly instrumento: number | null;
  readonly permitido: boolean;
}

export interface ProducaoParaRegraSus {
  readonly estabelecimento: number;
  readonly tipoPrestador: number;
  readonly naturezaJuridica: number | null;
  readonly procedimento: number;
  readonly grupo: number | null;
  readonly servicoClassificacao: number | null;
  readonly instrumento: number | null;
}

const pesoAlvo = (r: AlvoRegraSus): number =>
  r.procedimento !== null ? 3 : r.servicoClassificacao !== null ? 2 : 1;

/**
 * Se a produção é permitida pelas regras do tipo de prestador na competência. Sem regra que alcance, null (sem
 * restrição). Vale a mais específica: a do estabelecimento antes da geral, o procedimento antes do serviço e este antes
 * do grupo, a natureza e o instrumento informados antes dos abertos; no empate, a vedação.
 */
export function permissaoPorTipoPrestador(
  regras: readonly RegraPrestadorSus[],
  x: ProducaoParaRegraSus,
  competencia: string,
): { permitido: boolean; regra: number } | null {
  const alcanca = regras.filter(
    (r) =>
      vigenteNaCompetenciaSus(r, competencia) &&
      r.tipoPrestador === x.tipoPrestador &&
      (r.estabelecimento === null || r.estabelecimento === x.estabelecimento) &&
      (r.naturezaJuridica === null || r.naturezaJuridica === x.naturezaJuridica) &&
      (r.instrumento === null || r.instrumento === x.instrumento) &&
      (r.procedimento === null || r.procedimento === x.procedimento) &&
      (r.grupo === null || r.grupo === x.grupo) &&
      (r.servicoClassificacao === null || r.servicoClassificacao === x.servicoClassificacao),
  );
  if (alcanca.length === 0) return null;
  const peso = (r: RegraPrestadorSus) =>
    (r.estabelecimento !== null ? 100 : 0) +
    pesoAlvo(r) * 10 +
    (r.naturezaJuridica !== null ? 2 : 0) +
    (r.instrumento !== null ? 1 : 0);
  const ordenadas = [...alcanca].sort(
    (a, b) => peso(b) - peso(a) || Number(a.permitido) - Number(b.permitido) || a.id - b.id,
  );
  const r = ordenadas[0]!;
  return { permitido: r.permitido, regra: r.id };
}

export interface NovaRegraServicoClassificacaoSus {
  readonly servicoClassificacao: number;
  readonly procedimento: number | null;
  readonly grupo: number | null;
  readonly setor: number | null;
  readonly local: number | null;
  readonly urgencia: boolean;
  readonly prioridade: number;
}

/** Confere a regra do serviço e classificação automático: algum alvo e prioridade de 1 a 999. */
export function conferirRegraServicoClassificacao(
  e: NovaRegraServicoClassificacaoSus,
): ProblemaEstabelecimentoSus[] {
  const p: ProblemaEstabelecimentoSus[] = [];
  if (e.procedimento === null && e.grupo === null && e.setor === null && e.local === null)
    p.push({
      campo: 'procedimento',
      mensagem: 'Indique o procedimento, o grupo, o setor ou o local da regra.',
    });
  if (!Number.isInteger(e.prioridade) || e.prioridade < 1 || e.prioridade > 999)
    p.push({ campo: 'prioridade', mensagem: 'A prioridade vai de 1 a 999 (menor é aplicada primeiro).' });
  return p;
}

export interface RegraServicoClassificacaoSus extends NovaRegraServicoClassificacaoSus {
  readonly id: number;
  readonly ativo: boolean;
}

/** O serviço e classificação que a produção recebe: a regra ativa que alcança, de menor prioridade (empate: a mais antiga). */
export function servicoClassificacaoAutomatico(
  regras: readonly RegraServicoClassificacaoSus[],
  x: {
    procedimento: number;
    grupo: number | null;
    setor: number | null;
    local: number | null;
    urgencia: boolean;
  },
): { servicoClassificacao: number; regra: number } | null {
  const r = regras
    .filter(
      (r) =>
        r.ativo &&
        (!r.urgencia || x.urgencia) &&
        (r.procedimento === null || r.procedimento === x.procedimento) &&
        (r.grupo === null || r.grupo === x.grupo) &&
        (r.setor === null || r.setor === x.setor) &&
        (r.local === null || r.local === x.local),
    )
    .sort((a, b) => a.prioridade - b.prioridade || a.id - b.id)[0];
  return r ? { servicoClassificacao: r.servicoClassificacao, regra: r.id } : null;
}
