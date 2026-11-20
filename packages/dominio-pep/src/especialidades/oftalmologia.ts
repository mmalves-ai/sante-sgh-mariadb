// Oftalmologia (M45, etapa 6; ficha, seção 7 "Especialidades"; DP-32): o exame oftalmológico com a acuidade visual pelo
// cadastro de acuidade do estabelecimento, a pressão intraocular, a gonioscopia pela graduação do ângulo e os exames
// complementares do cadastro. Regras puras (a API aplica):
//   - valor nunca visto é recusado (regra 15): acuidade, graduação e exame só do cadastro;
//   - a acuidade decimal vem do próprio rótulo do cadastro ("20/40 (0,5)"); as medidas qualitativas (conta dedos,
//     movimento de mãos, percepção de luz) contam como abaixo de 0,05;
//   - a classificação usa o melhor olho com a melhor correção registrada (Decreto 5.296/2004, art. 5º: cegueira até
//     0,05; baixa visão de 0,3 a 0,05) e a OMS (sem deficiência a partir de 0,5);
//   - a pressão intraocular acima do limite (parâmetro; 21 mmHg) ou a assimetria de 5 mmHg ou mais entre os olhos alerta.
import type { ClassificacaoVisual, Olho, RegistrarExameOftalmologicoEntrada } from '@sgh/contratos';
import { recusar } from './comum.js';

export interface CadastroOftalmologia {
  readonly exames: ReadonlyMap<number, string>;
  readonly acuidades: ReadonlyMap<number, string>;
  readonly graduacoes: ReadonlyMap<number, string>;
}

/** O decimal da acuidade pelo rótulo do cadastro; `qualitativa` nas medidas sem tabela de optotipos. */
export function decimalDaAcuidade(rotulo: string): { decimal: number | null; qualitativa: boolean } {
  const t = rotulo.trim();
  const dec = /\((\d+)(?:,(\d+))?\)/.exec(t);
  if (dec) {
    const v = Number(`${dec[1]}.${dec[2] ?? '0'}`);
    // "Menor que 20/200 (0,1)": abaixo do valor do rótulo.
    return { decimal: /menor/i.test(t) ? v - 0.01 : v, qualitativa: false };
  }
  const snellen = /(\d+)\s*\/\s*(\d+)/.exec(t);
  if (snellen) return { decimal: Number(snellen[1]) / Number(snellen[2]), qualitativa: false };
  return { decimal: null, qualitativa: true };
}

/** A acuidade que vale para a classificação de um olho: a com correção, senão a sem correção. */
function melhorDoOlho(
  olho: RegistrarExameOftalmologicoEntrada['od'],
  cadastro: CadastroOftalmologia,
): number | null {
  const id = olho.acuidadeComCorrecao ?? olho.acuidadeSemCorrecao;
  if (id === null) return null;
  const rotulo = cadastro.acuidades.get(id);
  if (rotulo === undefined) return null;
  const d = decimalDaAcuidade(rotulo);
  return d.qualitativa ? 0.01 : d.decimal;
}

/** A classificação da visão pelo melhor olho (com a melhor correção registrada). */
export function classificarVisao(
  od: RegistrarExameOftalmologicoEntrada['od'],
  oe: RegistrarExameOftalmologicoEntrada['oe'],
  cadastro: CadastroOftalmologia,
): ClassificacaoVisual {
  const valores = [melhorDoOlho(od, cadastro), melhorDoOlho(oe, cadastro)].filter(
    (v): v is number => v !== null,
  );
  if (valores.length === 0) return 'sem-dado';
  const melhor = Math.max(...valores);
  if (melhor <= 0.05) return 'cegueira';
  if (melhor <= 0.3) return 'baixa-visao';
  if (melhor < 0.5) return 'reduzida';
  return 'normal';
}

const NOME_OLHO: Readonly<Record<Olho, string>> = { od: 'olho direito', oe: 'olho esquerdo' };

/** Os alertas da pressão intraocular (acima do limite; assimetria de 5 mmHg ou mais). */
export function alertasPio(od: number | null, oe: number | null, limite: number): string[] {
  const a: string[] = [];
  for (const [olho, v] of [
    ['od', od],
    ['oe', oe],
  ] as const) {
    if (v !== null && v > limite)
      a.push(
        `Pressão intraocular do ${NOME_OLHO[olho]} acima de ${limite} mmHg (${v} mmHg): hipertensão ocular.`,
      );
  }
  if (od !== null && oe !== null && Math.abs(od - oe) >= 5)
    a.push(`Assimetria da pressão intraocular entre os olhos de ${Math.abs(od - oe)} mmHg.`);
  return a;
}

/** Confere o exame contra o cadastro (regra 15) e o que não pode faltar; devolve a classificação e os alertas. */
export function conferirExameOftalmologico(
  e: RegistrarExameOftalmologicoEntrada,
  cadastro: CadastroOftalmologia,
  limitePio: number,
): { classificacao: ClassificacaoVisual; alertas: string[] } {
  for (const olho of ['od', 'oe'] as const) {
    const o = e[olho];
    for (const a of [o.acuidadeSemCorrecao, o.acuidadeComCorrecao])
      if (a !== null && !cadastro.acuidades.has(a))
        recusar(
          'valor-desconhecido',
          `Acuidade ${a} do ${NOME_OLHO[olho]} não existe no cadastro de acuidade.`,
        );
    if (o.gonioscopia !== null && !cadastro.graduacoes.has(o.gonioscopia))
      recusar(
        'valor-desconhecido',
        `Graduação ${o.gonioscopia} da gonioscopia do ${NOME_OLHO[olho]} não existe no cadastro.`,
      );
  }
  const vistos = new Set<string>();
  for (const x of e.exames) {
    if (!cadastro.exames.has(x.exame))
      recusar('valor-desconhecido', `Exame ${x.exame} não existe no cadastro de exames oftalmológicos.`);
    const k = `${x.exame}:${x.lado}`;
    if (vistos.has(k)) recusar('exame-repetido', 'O mesmo exame foi informado duas vezes para o mesmo olho.');
    vistos.add(k);
  }
  const temOlho = (['od', 'oe'] as const).some((k) =>
    Object.values(e[k]).some((v) => v !== null && v !== undefined),
  );
  if (!temOlho && e.exames.length === 0)
    recusar(
      'exame-vazio',
      'Registre ao menos a acuidade, a pressão, a gonioscopia ou um exame complementar.',
    );
  if ((e.od.pio !== null || e.oe.pio !== null) && e.metodoPio === null)
    recusar('metodo-pio-ausente', 'Informe o método da tonometria da pressão intraocular.');
  return {
    classificacao: classificarVisao(e.od, e.oe, cadastro),
    alertas: alertasPio(e.od.pio, e.oe.pio, limitePio),
  };
}
