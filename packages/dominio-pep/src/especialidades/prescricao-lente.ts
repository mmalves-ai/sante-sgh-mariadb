// Prescrição de lentes (03-PEP linha 139): óculos ou lentes de contato pelo oftalmologista, com o grau de cada olho, a
// adição para perto, a distância pupilar e, na lente de contato, a curva base e o diâmetro. Regras puras (a API grava,
// a tela confere na hora com as mesmas funções):
//   - o grau anda em passos de 0,25 dioptria (o padrão de fabricação das lentes oftálmicas, ABNT NBR ISO 21987); esférico
//     de -30 a +30, cilíndrico de -10 a +10, prisma até 20 dioptrias prismáticas com a base, adição de +0,50 a +4,00;
//   - o eixo (0 a 180 graus) acompanha o cilindro e só existe com ele;
//   - bifocal e multifocal pedem a adição; óculos só de longe não a leva;
//   - lente de contato leva a curva base e o diâmetro e não leva prisma; óculos não levam curva nem diâmetro;
//   - ao menos um olho com grau; a validade não fica antes da emissão (padrão: um ano);
//   - a prescrição nunca é apagada: só a emitida se cancela, com motivo (fica no histórico do paciente).
// Melhorias: a transposição do cilindro (positivo ↔ negativo) e o equivalente esférico para a leitura do grau.

export const TIPOS_LENTE = ['oculos', 'lente_contato'] as const;
export type TipoLente = (typeof TIPOS_LENTE)[number];
export const USOS_LENTE = ['longe', 'perto', 'intermediario', 'bifocal', 'multifocal'] as const;
export type UsoLente = (typeof USOS_LENTE)[number];
/** Base do prisma: nasal (interna), temporal (externa), superior ou inferior. */
export const BASES_PRISMA = ['interna', 'externa', 'superior', 'inferior'] as const;
export type BasePrisma = (typeof BASES_PRISMA)[number];
export type SituacaoPrescricaoLente = 'rascunho' | 'emitida' | 'cancelada';

/** Validade padrão da prescrição, em meses. */
export const VALIDADE_PADRAO_LENTE_MESES = 12;

export interface GrauOlho {
  readonly esferico: number | null;
  readonly cilindrico: number | null;
  readonly eixo: number | null;
  readonly prisma: number | null;
  readonly basePrisma: BasePrisma | null;
  /** Acuidade visual corrigida, como medida ("20/20", "1,0"). */
  readonly acuidade: string | null;
}

export interface PrescricaoLenteEntrada {
  readonly tipo: TipoLente;
  readonly uso: UsoLente;
  readonly od: GrauOlho;
  readonly oe: GrauOlho;
  readonly adicao: number | null;
  readonly distanciaPupilarMm: number | null;
  readonly curvaBase: number | null;
  readonly diametro: number | null;
  /** "AAAA-MM-DD"; null: a validade padrão. */
  readonly validadeAte: string | null;
  readonly observacao: string | null;
}

export interface ErroCampoLente {
  readonly campo: string;
  readonly mensagem: string;
}

const NOME_OLHO = { od: 'olho direito', oe: 'olho esquerdo' } as const;
const multiplo = (v: number, passo: number) => Math.abs(Math.round(v / passo) * passo - v) < 1e-9;
const temGrau = (o: GrauOlho) =>
  (o.esferico !== null && o.esferico !== 0) || (o.cilindrico !== null && o.cilindrico !== 0);

/** Soma meses a "AAAA-MM-DD" (fim de mês ajustado: 31/01 + 1 mês = 28 ou 29/02). */
export function somarMesesLente(dia: string, meses: number): string {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number];
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

/** A validade que vale: a informada ou a padrão a partir do dia da emissão. */
export function validadeDaLente(e: Pick<PrescricaoLenteEntrada, 'validadeAte'>, hoje: string): string {
  return e.validadeAte ?? somarMesesLente(hoje, VALIDADE_PADRAO_LENTE_MESES);
}

/** Transposição do cilindro: o mesmo grau escrito com o cilindro de sinal trocado. */
export function transporGrau(o: Pick<GrauOlho, 'esferico' | 'cilindrico' | 'eixo'>): {
  esferico: number | null;
  cilindrico: number | null;
  eixo: number | null;
} {
  if (o.cilindrico === null || o.cilindrico === 0 || o.eixo === null) return { ...o };
  return {
    esferico: Math.round(((o.esferico ?? 0) + o.cilindrico) * 100) / 100,
    cilindrico: -o.cilindrico,
    eixo: o.eixo > 90 ? o.eixo - 90 : o.eixo + 90,
  };
}

/** Equivalente esférico (esférico + metade do cilindro), arredondado ao quarto de dioptria. */
export function equivalenteEsferico(o: Pick<GrauOlho, 'esferico' | 'cilindrico'>): number | null {
  if (o.esferico === null && o.cilindrico === null) return null;
  const v = (o.esferico ?? 0) + (o.cilindrico ?? 0) / 2;
  return Math.round(v * 4) / 4;
}

function faixa(
  erros: ErroCampoLente[],
  campo: string,
  v: number | null,
  min: number,
  max: number,
  passo: number,
  nome: string,
): void {
  if (v === null) return;
  if (!Number.isFinite(v) || v < min || v > max)
    erros.push({ campo, mensagem: `${nome}: de ${min} a ${max}.` });
  else if (!multiplo(v, passo))
    erros.push({ campo, mensagem: `${nome}: em passos de ${String(passo).replace('.', ',')}.` });
}

/**
 * Confere a prescrição antes da emissão; devolve a lista de erros por campo (vazia: pode emitir). `hoje` é o dia do
 * estabelecimento ("AAAA-MM-DD").
 */
export function conferirPrescricaoLente(e: PrescricaoLenteEntrada, hoje: string): ErroCampoLente[] {
  const erros: ErroCampoLente[] = [];
  if (!TIPOS_LENTE.includes(e.tipo)) erros.push({ campo: 'tipo', mensagem: 'Tipo de lente desconhecido.' });
  if (!USOS_LENTE.includes(e.uso)) erros.push({ campo: 'uso', mensagem: 'Uso da lente desconhecido.' });
  for (const k of ['od', 'oe'] as const) {
    const o = e[k];
    const nome = NOME_OLHO[k];
    faixa(erros, `${k}.esferico`, o.esferico, -30, 30, 0.25, `Esférico do ${nome}`);
    faixa(erros, `${k}.cilindrico`, o.cilindrico, -10, 10, 0.25, `Cilíndrico do ${nome}`);
    faixa(erros, `${k}.prisma`, o.prisma, 0, 20, 0.25, `Prisma do ${nome}`);
    const comCilindro = o.cilindrico !== null && o.cilindrico !== 0;
    if (comCilindro && o.eixo === null)
      erros.push({ campo: `${k}.eixo`, mensagem: `Informe o eixo do cilindro do ${nome}.` });
    if (o.eixo !== null) {
      if (!comCilindro)
        erros.push({ campo: `${k}.eixo`, mensagem: `Eixo do ${nome} sem cilindro: retire o eixo.` });
      else if (!Number.isInteger(o.eixo) || o.eixo < 0 || o.eixo > 180)
        erros.push({ campo: `${k}.eixo`, mensagem: `Eixo do ${nome}: graus inteiros de 0 a 180.` });
    }
    if (o.prisma !== null && o.prisma > 0) {
      if (e.tipo === 'lente_contato')
        erros.push({ campo: `${k}.prisma`, mensagem: 'Lente de contato não leva prisma.' });
      else if (o.basePrisma === null)
        erros.push({ campo: `${k}.basePrisma`, mensagem: `Informe a base do prisma do ${nome}.` });
    } else if (o.basePrisma !== null)
      erros.push({ campo: `${k}.basePrisma`, mensagem: `Base do prisma do ${nome} sem prisma.` });
    if (o.acuidade !== null && o.acuidade.trim().length > 10)
      erros.push({ campo: `${k}.acuidade`, mensagem: `Acuidade do ${nome}: até 10 caracteres.` });
  }
  if (!temGrau(e.od) && !temGrau(e.oe))
    erros.push({
      campo: 'od.esferico',
      mensagem: 'Informe o grau (esférico ou cilíndrico) de ao menos um olho.',
    });
  faixa(erros, 'adicao', e.adicao, 0.5, 4, 0.25, 'Adição');
  if ((e.uso === 'bifocal' || e.uso === 'multifocal') && e.adicao === null)
    erros.push({ campo: 'adicao', mensagem: 'Lente bifocal ou multifocal precisa da adição para perto.' });
  if (e.uso === 'longe' && e.adicao !== null)
    erros.push({ campo: 'adicao', mensagem: 'Lente só para longe não leva adição.' });
  faixa(erros, 'distanciaPupilarMm', e.distanciaPupilarMm, 40, 80, 0.5, 'Distância pupilar (mm)');
  if (e.tipo === 'lente_contato') {
    if (e.curvaBase === null)
      erros.push({ campo: 'curvaBase', mensagem: 'Lente de contato precisa da curva base.' });
    if (e.diametro === null)
      erros.push({ campo: 'diametro', mensagem: 'Lente de contato precisa do diâmetro.' });
    faixa(erros, 'curvaBase', e.curvaBase, 6.5, 10, 0.05, 'Curva base (mm)');
    faixa(erros, 'diametro', e.diametro, 8, 16, 0.1, 'Diâmetro (mm)');
  } else {
    if (e.curvaBase !== null)
      erros.push({ campo: 'curvaBase', mensagem: 'Óculos não levam curva base de lente de contato.' });
    if (e.diametro !== null)
      erros.push({ campo: 'diametro', mensagem: 'Óculos não levam diâmetro de lente de contato.' });
  }
  if (e.validadeAte !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.validadeAte))
      erros.push({ campo: 'validadeAte', mensagem: 'Validade em data (AAAA-MM-DD).' });
    else if (e.validadeAte < hoje)
      erros.push({ campo: 'validadeAte', mensagem: 'A validade não pode ficar antes da emissão.' });
    else if (e.validadeAte > somarMesesLente(hoje, 60))
      erros.push({ campo: 'validadeAte', mensagem: 'A validade vai até cinco anos da emissão.' });
  }
  if (e.observacao !== null && e.observacao.length > 1000)
    erros.push({ campo: 'observacao', mensagem: 'Observação: até 1000 caracteres.' });
  return erros;
}

/** Confere o cancelamento: só a emitida se cancela, e com motivo. */
export function conferirCancelamentoLente(
  situacao: SituacaoPrescricaoLente,
  motivo: string,
): ErroCampoLente[] {
  const erros: ErroCampoLente[] = [];
  if (situacao !== 'emitida')
    erros.push({ campo: 'situacao', mensagem: 'Só a prescrição emitida pode ser cancelada.' });
  if (motivo.trim().length < 5)
    erros.push({ campo: 'motivo', mensagem: 'Informe o motivo do cancelamento (ao menos 5 caracteres).' });
  return erros;
}

/** A prescrição vale para aviar: emitida e dentro da validade. */
export function lenteVigente(
  x: { situacao: SituacaoPrescricaoLente; validadeAte: string | null },
  hoje: string,
): boolean {
  return x.situacao === 'emitida' && (x.validadeAte === null || x.validadeAte >= hoje);
}
