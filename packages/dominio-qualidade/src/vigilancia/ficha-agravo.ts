// Ficha SINAN pré-preenchida (ficha do M48, seção 4, "Ficha SINAN pré-preenchida"; regra 8). Os modelos de ficha do
// cadastro do estabelecimento têm o nome do CID do agravo (ex.: "A90/A92" dengue e chikungunya, "B19" hepatites
// virais, "B24/Menor" aids em menor de 13 anos) e as perguntas numeradas como a ficha impressa do Sinan; "Padrão/
// Individual" é a ficha individual genérica. O Sante preenche o que sabe (identificação, agravo, unidade, datas); o
// resto a vigilância completa na ficha impressa (o Sinan não tem API: DP-47.3, cap-12 §12.4).
import type { PerguntaFichaAgravo } from '@sgh/contratos';
import { normalizarTexto } from './gatilho-agravo.js';

export interface ModeloFichaAgravo {
  readonly id: number;
  readonly nome: string;
}

/** Modelos que não são de um agravo: o genérico e os de surto, epizootia e conclusão. */
const NAO_SAO_DE_AGRAVO = [
  'PADRAO/INDIVIDUAL',
  'EPIZOOTIA',
  'CONCLUSAO',
  'SURTO',
  'SURTO DTA',
  'ACOMPANHAMENTO SURTO',
];
const GENERICO = 'PADRAO/INDIVIDUAL';
/** Idade limite da ficha de aids em menor (Sinan: menores de 13 anos). */
export const IDADE_FICHA_MENOR = 13;

/**
 * Agrupamentos de CID que o Sinan notifica numa ficha só (o nome do modelo traz um CID do grupo): hepatites virais
 * (B15 a B19 → B19), tuberculose (A15 a A19 → A169), HIV e aids (B20 a B24 → B24), meningites (G00 a G03, A39, A87 →
 * G039) e sífilis congênita (A50 → A509).
 */
const GRUPOS: readonly { readonly de: readonly string[]; readonly para: string }[] = [
  { de: ['B15', 'B16', 'B17', 'B18', 'B19'], para: 'B19' },
  { de: ['A15', 'A16', 'A17', 'A18', 'A19'], para: 'A169' },
  { de: ['B20', 'B21', 'B22', 'B23', 'B24'], para: 'B24' },
  { de: ['G00', 'G01', 'G02', 'G03', 'A39', 'A87'], para: 'G039' },
  { de: ['A50'], para: 'A509' },
];

function cidDaFicha(cid: string): string {
  return GRUPOS.find((g) => g.de.includes(cid.slice(0, 3)))?.para ?? cid;
}

const ehCid = (t: string) => /^[A-Z]\d{2,3}$/.test(t);

/**
 * O modelo da ficha do CID: o de token de CID mais longo que casa (prefixo, nos dois sentidos para a categoria);
 * empate decidido pela idade (o "Menor" só abaixo de 13 anos). Sem modelo próprio, a ficha individual genérica.
 */
export function modeloDaFicha(
  cid: string,
  modelos: readonly ModeloFichaAgravo[],
  idadeAnos: number | null,
): { readonly modelo: ModeloFichaAgravo | null; readonly generica: boolean } {
  const alvo = cidDaFicha(cid);
  let melhor: { modelo: ModeloFichaAgravo; pontos: number } | null = null;
  for (const m of modelos) {
    const nome = normalizarTexto(m.nome);
    if (NAO_SAO_DE_AGRAVO.includes(nome)) continue;
    const partes = nome.split('/').map((p) => p.trim());
    const qualificadores = partes.filter((p) => !ehCid(p));
    const menor = qualificadores.includes('MENOR');
    if (menor && (idadeAnos === null || idadeAnos >= IDADE_FICHA_MENOR)) continue;
    for (const t of partes.filter(ehCid)) {
      const casa = alvo.startsWith(t) || (alvo.length === 3 && t.startsWith(alvo));
      if (!casa) continue;
      // Mais longo vence; no empate, o "Menor" (já filtrado pela idade) vence o geral.
      const pontos = (alvo.startsWith(t) ? t.length * 10 : alvo.length * 10 - 1) + (menor ? 1 : 0);
      if (!melhor || pontos > melhor.pontos) melhor = { modelo: m, pontos };
    }
  }
  if (melhor) return { modelo: melhor.modelo, generica: false };
  const g = modelos.find((m) => normalizarTexto(m.nome) === GENERICO) ?? null;
  return { modelo: g, generica: g !== null };
}

/** O que o Sante sabe para a ficha (sem nada além do necessário à notificação). */
export interface ContextoFichaAgravo {
  readonly dataNotificacao: string;
  readonly cid: string;
  readonly nomeCid: string;
  readonly unidadeNotificadora: string | null;
  readonly uf: string | null;
  readonly municipio: string | null;
  readonly paciente: {
    readonly nome: string;
    readonly nascimento: string | null;
    readonly sexo: 'M' | 'F' | null;
    readonly idadeAnos: number | null;
    readonly nomeMae: string | null;
    readonly cns: string | null;
  };
  readonly dataPrimeirosSintomas: string | null;
}

const dataBr = (d: string | null): string | null =>
  d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : null;

/** Regras de preenchimento pelo texto da pergunta (normalizado; o primeiro que casa). */
const REGRAS: readonly {
  readonly casa: (t: string) => boolean;
  readonly valor: (c: ContextoFichaAgravo) => string | null;
}[] = [
  { casa: (t) => t === 'DATA DA NOTIFICACAO', valor: (c) => dataBr(c.dataNotificacao) },
  { casa: (t) => t.startsWith('AGRAVO') || t === 'DOENCA', valor: (c) => c.nomeCid },
  { casa: (t) => t.startsWith('CODIGO (CID') || t === 'CID10' || t === 'CID 10', valor: (c) => c.cid },
  { casa: (t) => t === 'U.F.' || t === 'UF', valor: (c) => c.uf },
  { casa: (t) => t === 'MUNICIPIO DE NOTIFICACAO', valor: (c) => c.municipio },
  { casa: (t) => t.startsWith('UNIDADE DE SAUDE'), valor: (c) => c.unidadeNotificadora },
  { casa: (t) => t === 'DATA DOS PRIMEIROS SINTOMAS', valor: (c) => dataBr(c.dataPrimeirosSintomas) },
  { casa: (t) => t === 'NOME DO PACIENTE', valor: (c) => c.paciente.nome },
  { casa: (t) => t === 'DATA DE NASCIMENTO', valor: (c) => dataBr(c.paciente.nascimento) },
  {
    casa: (t) => t === 'IDADE',
    valor: (c) => (c.paciente.idadeAnos === null ? null : String(c.paciente.idadeAnos)),
  },
  { casa: (t) => t === 'IDADE UNIDADE', valor: (c) => (c.paciente.idadeAnos === null ? null : '4 - Ano') },
  {
    casa: (t) => t === 'SEXO',
    valor: (c) =>
      c.paciente.sexo === 'M' ? 'M - Masculino' : c.paciente.sexo === 'F' ? 'F - Feminino' : 'I - Ignorado',
  },
  { casa: (t) => t.startsWith('NUMERO DO CARTAO SUS'), valor: (c) => c.paciente.cns },
  { casa: (t) => t === 'NOME DA MAE', valor: (c) => c.paciente.nomeMae },
];

/** As perguntas do modelo, em ordem, com o valor que o Sante sabe. */
export function preencherFicha(
  perguntas: readonly { readonly codigo: number; readonly subcodigo: number; readonly texto: string }[],
  contexto: ContextoFichaAgravo,
): { readonly perguntas: PerguntaFichaAgravo[]; readonly preenchidas: number } {
  const ordenadas = [...perguntas].sort((a, b) => a.codigo - b.codigo || a.subcodigo - b.subcodigo);
  const r = ordenadas.map((p) => {
    const t = normalizarTexto(p.texto);
    const regra = REGRAS.find((x) => x.casa(t));
    const v = regra ? regra.valor(contexto) : null;
    return { codigo: p.codigo, subcodigo: p.subcodigo, texto: p.texto, valor: v && v.trim() ? v : null };
  });
  return { perguntas: r, preenchidas: r.filter((p) => p.valor !== null).length };
}

/** Idade em anos completos na data (nulo sem nascimento). */
export function idadeEmAnos(nascimento: string | null, naData: string): number | null {
  if (!nascimento || !/^\d{4}-\d{2}-\d{2}/.test(nascimento)) return null;
  const [an, mn, dn] = nascimento.slice(0, 10).split('-').map(Number) as [number, number, number];
  const [a, m, d] = naData.slice(0, 10).split('-').map(Number) as [number, number, number];
  const idade = a - an - (m < mn || (m === mn && d < dn) ? 1 : 0);
  return idade < 0 ? null : idade;
}
