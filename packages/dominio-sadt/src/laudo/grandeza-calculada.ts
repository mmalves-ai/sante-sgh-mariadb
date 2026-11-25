// Grandeza calculada do laudo estruturado e o cadastro do laudo estruturado (F3.5, 05-SADT linha 17). Regras puras:
//   - a grandeza calculada (massa do ventrículo, fração de ejeção pelo método dos diâmetros, índice pela superfície
//     corporal) sai da fórmula vigente na data do exame, a partir das outras medidas do laudo e dos dados do paciente
//     (peso, altura, superfície corporal de Mosteller, idade em anos). Uma calculada pode usar outra (na ordem das
//     dependências; ciclo não calcula). O que não dá para calcular fica sem valor, com o motivo, nunca com zero;
//   - o valor digitado na grandeza que tem fórmula é ignorado: vale a conta (a tela mostra a conta na hora);
//   - o cadastro: seção, grandeza, faixa de referência (sem duas faixas iguais valendo no mesmo dia) e a nova versão
//     da fórmula (só grandeza calculada, variáveis do mesmo exame, sem autorreferência nem ciclo, nada retroativo, a
//     anterior encerrada na véspera).
import { calcularFormula, type CalculoFormula } from '../catalogo/analito-pop.js';
import { type FalhaCatalogo, validarFormula, vespera } from '../catalogo/regras.js';
import { idadeEmAnos } from '../catalogo/respostas-calculo.js';
import {
  type GrandezaDoLaudo,
  type PacienteDoExame,
  superficieCorporal,
  type ValorInformado,
} from './estruturado.js';

export const DADOS_PACIENTE_GRANDEZA = ['peso', 'altura', 'superficie_corporal', 'idade'] as const;
export type DadoPacienteGrandeza = (typeof DADOS_PACIENTE_GRANDEZA)[number];

export interface VariavelDaGrandeza {
  readonly identificador: string;
  readonly fonte: 'grandeza' | 'dado_paciente';
  /** A grandeza medida (ou calculada) do mesmo exame, quando a fonte é grandeza. */
  readonly grandeza: number | null;
  readonly dadoPaciente: string | null;
}

export interface FormulaDaGrandeza {
  /** A grandeza calculada. */
  readonly grandeza: number;
  readonly expressao: string;
  readonly casas: number | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly variaveis: readonly VariavelDaGrandeza[];
}

/** A fórmula que vale para cada grandeza na data do exame (a de início mais recente em vigor; uma por grandeza). */
export function formulasVigentes(
  formulas: readonly FormulaDaGrandeza[],
  dataExame: string,
): FormulaDaGrandeza[] {
  const porGrandeza = new Map<number, FormulaDaGrandeza>();
  for (const f of formulas) {
    if (f.vigenciaInicio > dataExame || (f.vigenciaFim !== null && f.vigenciaFim < dataExame)) continue;
    const atual = porGrandeza.get(f.grandeza);
    if (!atual || f.vigenciaInicio > atual.vigenciaInicio) porGrandeza.set(f.grandeza, f);
  }
  return [...porGrandeza.values()];
}

/** O dado do paciente como número para a conta (null quando o laudo não tem o dado). */
export function dadoDoPaciente(dado: string | null, p: PacienteDoExame): number | null {
  switch (dado) {
    case 'peso':
      return p.pesoKg && p.pesoKg > 0 ? p.pesoKg : null;
    case 'altura':
      return p.alturaCm && p.alturaCm > 0 ? p.alturaCm : null;
    case 'superficie_corporal':
      return superficieCorporal(p.pesoKg, p.alturaCm);
    case 'idade':
      return idadeEmAnos(p.idadeDias);
    default:
      return null;
  }
}

const ROTULO_DADO: Readonly<Record<string, string>> = {
  peso: 'o peso',
  altura: 'a altura',
  superficie_corporal: 'o peso e a altura',
  idade: 'a idade',
};

/**
 * Calcula cada grandeza com fórmula vigente na data do exame. `medidos` traz o número digitado de cada grandeza (o da
 * calculada é ignorado). Devolve, por grandeza calculada, o valor ou o motivo de não calcular.
 */
export function calcularGrandezas(
  formulas: readonly FormulaDaGrandeza[],
  medidos: ReadonlyMap<number, number | null>,
  p: PacienteDoExame,
): Map<number, CalculoFormula> {
  const vigentes = formulasVigentes(formulas, p.dataExame);
  const porGrandeza = new Map(vigentes.map((f) => [f.grandeza, f]));
  const pronto = new Map<number, CalculoFormula>();
  const abertos = new Set<number>();
  const calcular = (grandeza: number): CalculoFormula => {
    const ja = pronto.get(grandeza);
    if (ja) return ja;
    if (abertos.has(grandeza)) return { ok: false, motivo: 'As fórmulas do exame dependem uma da outra.' };
    const f = porGrandeza.get(grandeza) as FormulaDaGrandeza;
    abertos.add(grandeza);
    const valores: Record<string, number | null> = {};
    let motivo: string | null = null;
    for (const v of f.variaveis) {
      let valor: number | null = null;
      if (v.fonte === 'grandeza' && v.grandeza !== null) {
        if (porGrandeza.has(v.grandeza)) {
          const c = calcular(v.grandeza);
          if (c.ok) valor = c.valor;
          else motivo ??= `${v.identificador}: ${c.motivo}`;
        } else {
          valor = medidos.get(v.grandeza) ?? null;
          if (valor === null) motivo ??= `Falta a medida ${v.identificador}.`;
        }
      } else {
        valor = dadoDoPaciente(v.dadoPaciente, p);
        if (valor === null)
          motivo ??= `Falta ${ROTULO_DADO[v.dadoPaciente ?? ''] ?? 'o dado'} do paciente (${v.identificador}).`;
      }
      valores[v.identificador] = valor;
    }
    abertos.delete(grandeza);
    const r: CalculoFormula = motivo ? { ok: false, motivo } : calcularFormula(f.expressao, valores, f.casas);
    pronto.set(grandeza, r);
    return r;
  };
  for (const f of vigentes) calcular(f.grandeza);
  return pronto;
}

/**
 * As medidas do laudo com as calculadas no lugar: o valor digitado na grandeza com fórmula vigente sai e entra a
 * conta; a que não dá para calcular fica sem valor (a obrigatória barra a assinatura pela regra de sempre). A grandeza
 * marcada como calculada mas ainda sem fórmula no cadastro continua digitada.
 */
export function completarValoresCalculados(
  grandezas: readonly GrandezaDoLaudo[],
  valores: readonly ValorInformado[],
  formulas: readonly FormulaDaGrandeza[],
  p: PacienteDoExame,
): ValorInformado[] {
  const doExame = new Set(grandezas.filter((g) => g.calculada).map((g) => g.id));
  const validas = formulas.filter((f) => doExame.has(f.grandeza));
  if (!validas.length) return [...valores];
  const medidos = new Map<number, number | null>();
  for (const v of valores) if (!medidos.has(v.grandeza)) medidos.set(v.grandeza, v.numero);
  const contas = calcularGrandezas(validas, medidos, p);
  const r = valores.filter((v) => !contas.has(v.grandeza));
  for (const [grandeza, c] of contas) if (c.ok) r.push({ grandeza, numero: c.valor, texto: null });
  return r;
}

// ── Cadastro do laudo estruturado ───────────────────────────────────────────────────────────────────────────

const ordemValida = (o: number) => Number.isInteger(o) && o >= 1 && o <= 9999;

export interface SecaoLaudoCadastro {
  readonly codigo: string;
  readonly nome: string;
  readonly sigla: string | null;
  readonly ordem: number;
}

export function validarSecaoLaudo(s: SecaoLaudoCadastro): FalhaCatalogo[] {
  const f: FalhaCatalogo[] = [];
  if (!/^\S{1,30}$/.test(s.codigo.trim()))
    f.push({ campo: 'codigo', mensagem: 'Informe o código da seção (até 30 caracteres, sem espaço).' });
  if (s.nome.trim().length < 2 || s.nome.trim().length > 100)
    f.push({ campo: 'nome', mensagem: 'Informe o nome da seção (2 a 100 caracteres).' });
  if (s.sigla !== null && s.sigla.trim().length > 10)
    f.push({ campo: 'sigla', mensagem: 'A sigla tem até 10 caracteres.' });
  if (!ordemValida(s.ordem)) f.push({ campo: 'ordem', mensagem: 'A ordem vai de 1 a 9999.' });
  return f;
}

export interface GrandezaLaudoCadastro {
  readonly codigo: string;
  readonly descricao: string;
  readonly sigla: string | null;
  readonly casasDecimais: number | null;
  readonly ordem: number;
  readonly ativo: boolean;
  /** A grandeza já é variável de fórmula vigente de outra grandeza do exame. */
  readonly usadaEmFormula: boolean;
}

/** O código da grandeza é o campo `{{codigo}}` do modelo do laudo: letras, números e sublinhado. */
export function validarGrandezaLaudo(g: GrandezaLaudoCadastro): FalhaCatalogo[] {
  const f: FalhaCatalogo[] = [];
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,29}$/.test(g.codigo.trim()))
    f.push({
      campo: 'codigo',
      mensagem: 'O código começa por letra e leva só letras, números e sublinhado (até 30).',
    });
  if (g.descricao.trim().length < 2 || g.descricao.trim().length > 150)
    f.push({ campo: 'descricao', mensagem: 'Informe o nome da medida (2 a 150 caracteres).' });
  if (g.sigla !== null && g.sigla.trim().length > 10)
    f.push({ campo: 'sigla', mensagem: 'A sigla tem até 10 caracteres.' });
  if (
    g.casasDecimais !== null &&
    (!Number.isInteger(g.casasDecimais) || g.casasDecimais < 0 || g.casasDecimais > 6)
  )
    f.push({ campo: 'casasDecimais', mensagem: 'As casas decimais vão de 0 a 6.' });
  if (!ordemValida(g.ordem)) f.push({ campo: 'ordem', mensagem: 'A ordem vai de 1 a 9999.' });
  if (!g.ativo && g.usadaEmFormula)
    f.push({
      campo: 'ativo',
      mensagem: 'A medida entra na fórmula de outra medida do exame: troque a fórmula antes de inativar.',
    });
  return f;
}

export interface FaixaGrandezaCadastro {
  readonly id: number | null;
  readonly sexoId: number | null;
  readonly idadeMinimaDias: number | null;
  readonly idadeMaximaDias: number | null;
  readonly pesoMinimoKg: number | null;
  readonly pesoMaximoKg: number | null;
  readonly superficieMinima: number | null;
  readonly superficieMaxima: number | null;
  readonly referenciaMinima: number | null;
  readonly referenciaMaxima: number | null;
  readonly referenciaTexto: string | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
}

const invertido = (a: number | null, b: number | null) => a !== null && b !== null && a > b;
const negativo = (...xs: (number | null)[]) => xs.some((x) => x !== null && x < 0);
const mesmoRecorte = (a: FaixaGrandezaCadastro, b: FaixaGrandezaCadastro) =>
  a.sexoId === b.sexoId &&
  a.idadeMinimaDias === b.idadeMinimaDias &&
  a.idadeMaximaDias === b.idadeMaximaDias &&
  a.pesoMinimoKg === b.pesoMinimoKg &&
  a.pesoMaximoKg === b.pesoMaximoKg &&
  a.superficieMinima === b.superficieMinima &&
  a.superficieMaxima === b.superficieMaxima;
const cruzam = (a: FaixaGrandezaCadastro, b: FaixaGrandezaCadastro) =>
  (a.vigenciaFim === null || a.vigenciaFim >= b.vigenciaInicio) &&
  (b.vigenciaFim === null || b.vigenciaFim >= a.vigenciaInicio);

/**
 * A faixa de referência da grandeza como fica depois da gravação, contra as outras faixas ativas da mesma grandeza:
 * limites em ordem, alguma referência informada e nenhuma outra faixa do mesmo recorte (sexo, idade, peso, superfície)
 * valendo no mesmo dia, para a escolha da faixa do paciente nunca depender da ordem de gravação.
 */
export function validarFaixaGrandeza(
  f: FaixaGrandezaCadastro,
  outras: readonly FaixaGrandezaCadastro[],
): FalhaCatalogo[] {
  const r: FalhaCatalogo[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.vigenciaInicio))
    r.push({ campo: 'vigenciaInicio', mensagem: 'Informe o início da vigência.' });
  if (f.vigenciaFim !== null && f.vigenciaFim < f.vigenciaInicio)
    r.push({ campo: 'vigenciaFim', mensagem: 'O fim da vigência não vem antes do início.' });
  if (f.referenciaMinima === null && f.referenciaMaxima === null && !(f.referenciaTexto ?? '').trim())
    r.push({ campo: 'referenciaMinima', mensagem: 'Informe o mínimo, o máximo ou o texto da referência.' });
  if (invertido(f.referenciaMinima, f.referenciaMaxima))
    r.push({ campo: 'referenciaMaxima', mensagem: 'O máximo da referência é menor que o mínimo.' });
  if (invertido(f.idadeMinimaDias, f.idadeMaximaDias))
    r.push({ campo: 'idadeMaximaDias', mensagem: 'A idade máxima é menor que a mínima.' });
  if (invertido(f.pesoMinimoKg, f.pesoMaximoKg))
    r.push({ campo: 'pesoMaximoKg', mensagem: 'O peso máximo é menor que o mínimo.' });
  if (invertido(f.superficieMinima, f.superficieMaxima))
    r.push({ campo: 'superficieMaxima', mensagem: 'A superfície corporal máxima é menor que a mínima.' });
  if (
    negativo(
      f.idadeMinimaDias,
      f.idadeMaximaDias,
      f.pesoMinimoKg,
      f.pesoMaximoKg,
      f.superficieMinima,
      f.superficieMaxima,
    )
  )
    r.push({ campo: 'idadeMinimaDias', mensagem: 'Idade, peso e superfície corporal não são negativos.' });
  if (f.ativo && outras.some((o) => o.ativo && o.id !== f.id && mesmoRecorte(o, f) && cruzam(o, f)))
    r.push({
      campo: 'vigenciaInicio',
      mensagem:
        'Já existe faixa deste mesmo recorte valendo no período: encerre a vigência dela antes de abrir outra.',
    });
  return r;
}

export interface FormulaGrandezaNova {
  readonly expressao: string;
  readonly vigenciaInicio: string;
  readonly variaveis: readonly VariavelDaGrandeza[];
}

export interface ContextoFormulaGrandeza {
  readonly hoje: string;
  readonly grandezaAlvo: number;
  readonly calculada: boolean;
  /** As grandezas ativas do exame. */
  readonly grandezasDoExame: readonly number[];
  /** As fórmulas da grandeza ainda em vigor no início da nova. */
  readonly vigentes: readonly { id: number; vigenciaInicio: string; vigenciaFim: string | null }[];
  /** O que cada outra grandeza calculada do exame usa (para o ciclo). */
  readonly dependencias: readonly { grandeza: number; usa: readonly number[] }[];
}

export interface PlanoFormulaGrandeza {
  readonly falhas: readonly FalhaCatalogo[];
  readonly encerrar: readonly { id: number; vigenciaFim: string }[];
}

/** Nova versão da fórmula da grandeza calculada: confere e planeja o encerramento da anterior na véspera. */
export function planejarFormulaGrandeza(
  nova: FormulaGrandezaNova,
  ctx: ContextoFormulaGrandeza,
): PlanoFormulaGrandeza {
  const falhas: FalhaCatalogo[] = [
    ...validarFormula(
      nova.expressao,
      nova.variaveis.map((v) => v.identificador),
    ),
  ];
  if (!ctx.calculada)
    falhas.push({ campo: 'grandeza', mensagem: 'Só a medida marcada como calculada leva fórmula.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nova.vigenciaInicio))
    falhas.push({ campo: 'vigenciaInicio', mensagem: 'Informe o início da vigência.' });
  else if (nova.vigenciaInicio < ctx.hoje)
    falhas.push({
      campo: 'vigenciaInicio',
      mensagem: 'A fórmula nova não vale para trás: o laudo já assinado guarda a conta da época.',
    });
  for (const v of nova.variaveis) {
    const rot = `A variável ${v.identificador}`;
    if (v.fonte === 'grandeza') {
      if (v.grandeza === null) falhas.push({ campo: 'variaveis', mensagem: `${rot}: escolha a medida.` });
      else if (v.grandeza === ctx.grandezaAlvo)
        falhas.push({ campo: 'variaveis', mensagem: `${rot}: a fórmula não usa a própria medida.` });
      else if (!ctx.grandezasDoExame.includes(v.grandeza))
        falhas.push({ campo: 'variaveis', mensagem: `${rot}: a medida não é deste exame.` });
    } else if (!(DADOS_PACIENTE_GRANDEZA as readonly string[]).includes(v.dadoPaciente ?? ''))
      falhas.push({
        campo: 'variaveis',
        mensagem: `${rot}: o dado do paciente é peso, altura, superfície corporal ou idade.`,
      });
  }
  // Ciclo: a partir do que a nova usa, seguindo as outras fórmulas, não se volta à própria grandeza.
  const usa = new Map(ctx.dependencias.map((d) => [d.grandeza, d.usa]));
  const visto = new Set<number>();
  const pilha = nova.variaveis.flatMap((v) =>
    v.fonte === 'grandeza' && v.grandeza !== null ? [v.grandeza] : [],
  );
  while (pilha.length) {
    const g = pilha.pop() as number;
    if (g === ctx.grandezaAlvo) {
      if (!falhas.some((x) => x.mensagem.includes('própria medida')))
        falhas.push({
          campo: 'variaveis',
          mensagem: 'As fórmulas do exame ficariam dependendo uma da outra.',
        });
      break;
    }
    if (visto.has(g)) continue;
    visto.add(g);
    pilha.push(...(usa.get(g) ?? []));
  }
  const encerrar: { id: number; vigenciaFim: string }[] = [];
  for (const v of ctx.vigentes) {
    if (v.vigenciaInicio >= nova.vigenciaInicio)
      falhas.push({
        campo: 'vigenciaInicio',
        mensagem: 'Já existe fórmula com início igual ou posterior: a nova começa depois da vigente.',
      });
    else encerrar.push({ id: v.id, vigenciaFim: vespera(nova.vigenciaInicio) });
  }
  return { falhas, encerrar: falhas.length ? [] : encerrar };
}
