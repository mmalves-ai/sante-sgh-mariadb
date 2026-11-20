// Referência congelada (ficha do M26, regra 5; cap-05b §5.10): o laudo leva a faixa de referência vigente no dia do
// exame, por sexo e idade, pela versão do valor de referência do legado (histórico por elemento e por exame). O
// resultado já gravado guarda a versão usada (os IDs do histórico): ela vale sempre. Para o resultado novo, a versão
// vigente é a última gravada até o fim do dia do exame; sem histórico até lá, a do cadastro atual. A faixa do legado
// é texto livre ("12,0 a 16,0", "< 5", "Homens: 13 a 17 / Mulheres: 12 a 16"): a leitura extrai os limites quando dá;
// o que não dá fica sem destaque (nunca inventa faixa).

export interface VersaoReferencia {
  readonly id: number;
  /** Data e hora da gravação da versão (ISO). */
  readonly gravadaEm: string;
  readonly texto: string | null;
  readonly minimo: number | null;
  readonly maximo: number | null;
  readonly unidade: string | null;
}

export interface CadastroReferencia {
  readonly texto: string | null;
  readonly minimo: number | null;
  readonly maximo: number | null;
  readonly unidade: string | null;
}

export interface ReferenciaEscolhida {
  readonly fonte: 'historicoElemento' | 'historicoExame' | 'cadastro' | 'nenhuma';
  readonly versaoId: number | null;
  readonly versaoEm: string | null;
  readonly texto: string | null;
  readonly minimo: number | null;
  readonly maximo: number | null;
  readonly unidade: string | null;
}

const fimDoDia = (data: string) => `${data.slice(0, 10)}T23:59:59.999Z`;

/** A versão vigente até o fim do dia do exame (a última gravada até lá), ou null. */
export function versaoVigente(
  versoes: readonly VersaoReferencia[],
  dataExame: string,
): VersaoReferencia | null {
  const limite = fimDoDia(dataExame);
  let melhor: VersaoReferencia | null = null;
  for (const v of versoes) {
    if (v.gravadaEm > limite) continue;
    if (!melhor || v.gravadaEm > melhor.gravadaEm || (v.gravadaEm === melhor.gravadaEm && v.id > melhor.id))
      melhor = v;
  }
  return melhor;
}

/**
 * A referência do elemento no dia do exame: a versão já usada pelo resultado gravado (quando tem); senão a vigente do
 * histórico do elemento, depois a do exame, depois o cadastro atual.
 */
export function referenciaDoDia(e: {
  readonly dataExame: string;
  readonly usadaNoResultado?: number | null;
  readonly historicoElemento: readonly VersaoReferencia[];
  readonly historicoExame: readonly VersaoReferencia[];
  readonly cadastro: CadastroReferencia | null;
}): ReferenciaEscolhida {
  const comoEscolhida = (
    fonte: 'historicoElemento' | 'historicoExame',
    v: VersaoReferencia,
  ): ReferenciaEscolhida => ({
    fonte,
    versaoId: v.id,
    versaoEm: v.gravadaEm,
    texto: v.texto,
    minimo: v.minimo,
    maximo: v.maximo,
    unidade: v.unidade,
  });
  if (e.usadaNoResultado) {
    const v = e.historicoElemento.find((x) => x.id === e.usadaNoResultado);
    if (v) return comoEscolhida('historicoElemento', v);
  }
  const el = versaoVigente(e.historicoElemento, e.dataExame);
  if (el) return comoEscolhida('historicoElemento', el);
  const ex = versaoVigente(e.historicoExame, e.dataExame);
  if (ex) return comoEscolhida('historicoExame', ex);
  if (e.cadastro && (e.cadastro.texto || e.cadastro.minimo !== null || e.cadastro.maximo !== null))
    return { fonte: 'cadastro', versaoId: null, versaoEm: null, ...e.cadastro };
  return {
    fonte: 'nenhuma',
    versaoId: null,
    versaoEm: null,
    texto: null,
    minimo: null,
    maximo: null,
    unidade: null,
  };
}

const NUM = String.raw`(-?\d+(?:[.,]\d+)?)`;
const num = (s: string) => Number(s.replace(',', '.'));

/** Os limites de um texto de faixa ("12,0 a 16,0", "< 5", "até 200", "> 40"), quando a forma é reconhecida. */
export function limitesDoTexto(
  s: string | null | undefined,
): { minimo: number | null; maximo: number | null } | null {
  if (!s) return null;
  const t = s.toLowerCase().replace(/\s+/g, ' ').trim();
  let m = new RegExp(`${NUM} ?(?:a|-|até|ate) ?${NUM}`).exec(t);
  if (m) return { minimo: num(m[1]!), maximo: num(m[2]!) };
  m = new RegExp(`(?:<=|<|até|ate|inferior a|menor que) ?${NUM}`).exec(t);
  if (m) return { minimo: null, maximo: num(m[1]!) };
  m = new RegExp(`(?:>=|>|superior a|maior que|acima de) ?${NUM}`).exec(t);
  if (m) return { minimo: num(m[1]!), maximo: null };
  return null;
}

const SEXO_M = /^(homens?|masculino|masc\.?|m)\s*[:=-]/i;
const SEXO_F = /^(mulheres?|feminino|fem\.?|f)\s*[:=-]/i;
const IDADE = /(\d+)\s*(?:a|-|até|ate)\s*(\d+)\s*anos/i;

/**
 * A linha da faixa que vale para o sexo e a idade do paciente (texto com uma linha por sexo ou por faixa etária);
 * sem linha própria, o texto inteiro. Os limites saem da linha escolhida.
 */
export function faixaDoPaciente(
  texto: string | null,
  paciente: { readonly sexo: 'M' | 'F' | null; readonly idadeAnos: number | null },
): { readonly texto: string | null; readonly minimo: number | null; readonly maximo: number | null } {
  if (!texto) return { texto: null, minimo: null, maximo: null };
  const linhas = texto
    .split(/\r?\n|\s\/\s|;/)
    .map((l) => l.trim())
    .filter(Boolean);
  let escolhida: string | null = null;
  if (paciente.sexo) {
    const re = paciente.sexo === 'M' ? SEXO_M : SEXO_F;
    escolhida = linhas.find((l) => re.test(l)) ?? null;
  }
  if (!escolhida && paciente.idadeAnos !== null) {
    escolhida =
      linhas.find((l) => {
        const m = IDADE.exec(l);
        return m !== null && paciente.idadeAnos! >= Number(m[1]) && paciente.idadeAnos! <= Number(m[2]);
      }) ?? null;
  }
  const t = escolhida ?? (linhas.length === 1 ? linhas[0]! : texto.trim());
  const sem = t.replace(SEXO_M, '').replace(SEXO_F, '').replace(IDADE, '');
  const l = limitesDoTexto(sem);
  return { texto: t, minimo: l?.minimo ?? null, maximo: l?.maximo ?? null };
}

/** Fora da faixa: abaixo ou acima do mínimo e do máximo da referência. */
export function foraDaReferencia(
  valor: number | null,
  ref: { readonly minimo: number | null; readonly maximo: number | null },
): 'abaixo' | 'acima' | null {
  if (valor === null) return null;
  if (ref.minimo !== null && valor < ref.minimo) return 'abaixo';
  if (ref.maximo !== null && valor > ref.maximo) return 'acima';
  return null;
}
