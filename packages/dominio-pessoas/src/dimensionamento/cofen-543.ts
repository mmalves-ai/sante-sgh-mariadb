// Dimensionamento de enfermagem pela Resolução COFEN 543/2017 (M52.3; ficha do M52, seção 8, regra 9: cobertura
// mínima e furo de escala pelo dimensionamento, com a classificação de pacientes do M45 ou a informada pela
// coordenação). A conta, com cada parcela impressa:
//   1. horas de enfermagem por categoria em 24 h = pacientes × horas da categoria (4, 6, 10, 10 e 18 h; art. 3º);
//      o NAS da terapia intensiva entra como horas = soma × 24 ÷ 100;
//   2. THE (total de horas de enfermagem) = soma das horas;
//   3. KM (constante de Marinho) = (DS ÷ jornada semanal) × (1 + IST), com DS = 7 e IST ≥ 15%, truncada em 4 casas;
//   4. QP (quantitativo de pessoal) = THE × KM; o total de profissionais é QP para cima;
//   5. enfermeiros = total × percentual da categoria de maior prevalência (art. 5º), para cima, com o mínimo de seis
//      quando a prevalente é cuidado mínimo ou intermediário (parâmetro); o resto são técnicos e auxiliares;
//   6. cobertura sugerida no turno (profissionais ao mesmo tempo) = THE ÷ 24 h, para cima.
// Empate na prevalência: vale a categoria de maior complexidade (o maior percentual de enfermeiros).
import {
  CATEGORIAS_SCP,
  type CalculoDimensionamento,
  type CategoriaScp,
  CODIGOS_CATEGORIA_SCP,
  DIAS_SEMANA_UNIDADE,
  IST_MINIMO,
  MINIMO_ENFERMEIROS_MINIMO_INTERMEDIARIO,
  PERCENTUAL_ENFERMEIROS_SCP,
} from '@sgh/contratos';

export interface EntradaDimensionamento {
  readonly pacientes: Readonly<Record<CategoriaScp, number>>;
  /** Soma do NAS dos pacientes de terapia intensiva (% do tempo de um profissional), 0 se não houver. */
  readonly nasSoma?: number;
  /** Pacientes classificados pelo NAS (contam como intensivos na prevalência). */
  readonly nasPacientes?: number;
  readonly jornadaSemanalHoras: number;
  readonly ist: number;
  readonly minimoEnfermeiros?: number;
}

const arred = (n: number, casas: number) => {
  const f = 10 ** casas;
  return Math.round(n * f + Number.EPSILON) / f;
};
/** Para cima, com tolerância de arredondamento binário (3,0000000001 vira 3, não 4). */
const teto = (n: number) => Math.ceil(arred(n, 6));
const br = (n: number) => String(n).replace('.', ',');
const pct = (n: number) => `${br(arred(n * 100, 2))}%`;

/**
 * KM = (DS ÷ jornada semanal) × (1 + IST), truncada em 4 casas como as tabelas da norma (com IST de 15%: 20 h = 0,4025;
 * 30 h = 0,2683; 36 h = 0,2236; 40 h = 0,2012; 44 h = 0,1829).
 */
export function constanteDeMarinho(jornadaSemanalHoras: number, ist: number): number {
  return Math.floor(arred((DIAS_SEMANA_UNIDADE / jornadaSemanalHoras) * (1 + ist), 8) * 10_000) / 10_000;
}

export function calcularDimensionamento(e: EntradaDimensionamento): CalculoDimensionamento {
  if (e.ist < IST_MINIMO) throw new Error('IST abaixo do mínimo de 15%.');
  if (!(e.jornadaSemanalHoras > 0)) throw new Error('Jornada semanal inválida.');
  const parcelas: string[] = [];
  const horasPorCategoria = {} as Record<CategoriaScp, number>;
  for (const c of CODIGOS_CATEGORIA_SCP) {
    const n = e.pacientes[c];
    horasPorCategoria[c] = n * CATEGORIAS_SCP[c].horas;
    if (n > 0)
      parcelas.push(
        `${CATEGORIAS_SCP[c].rotulo}: ${n} paciente(s) × ${CATEGORIAS_SCP[c].horas} h = ${horasPorCategoria[c]} h`,
      );
  }
  const nasSoma = arred(e.nasSoma ?? 0, 1);
  const nasHoras = arred((nasSoma * 24) / 100, 2);
  if (nasSoma > 0) parcelas.push(`NAS: soma ${br(nasSoma)}% × 24 h ÷ 100 = ${br(nasHoras)} h`);
  const somaScp = CODIGOS_CATEGORIA_SCP.reduce((s, c) => s + horasPorCategoria[c], 0);
  const totalHoras = arred(somaScp + nasHoras, 2);
  const termos = [
    ...CODIGOS_CATEGORIA_SCP.filter((c) => e.pacientes[c] > 0).map((c) => `${horasPorCategoria[c]}`),
    ...(nasSoma > 0 ? [br(nasHoras)] : []),
  ];
  parcelas.push(
    `THE (total de horas de enfermagem em 24 h) = ${termos.join(' + ') || '0'} = ${br(totalHoras)} h`,
  );

  const km = constanteDeMarinho(e.jornadaSemanalHoras, e.ist);
  parcelas.push(
    `KM (constante de Marinho) = (${DIAS_SEMANA_UNIDADE} dias ÷ ${br(e.jornadaSemanalHoras)} h) × (1 + ${pct(e.ist)}) = ${br(km)}`,
  );
  const quantitativo = arred(totalHoras * km, 2);
  const totalProfissionais = teto(quantitativo);
  parcelas.push(
    `QP (quantitativo de pessoal) = ${br(totalHoras)} × ${br(km)} = ${br(quantitativo)}, para cima: ${totalProfissionais} profissional(is)`,
  );

  // Prevalência: os pacientes do NAS contam como cuidado intensivo.
  const contagem = (c: CategoriaScp) => e.pacientes[c] + (c === 'intensivos' ? (e.nasPacientes ?? 0) : 0);
  let categoriaPrevalente: CategoriaScp | null = null;
  for (const c of CODIGOS_CATEGORIA_SCP) {
    if (contagem(c) === 0) continue;
    if (
      categoriaPrevalente === null ||
      contagem(c) > contagem(categoriaPrevalente) ||
      (contagem(c) === contagem(categoriaPrevalente) &&
        PERCENTUAL_ENFERMEIROS_SCP[c] >= PERCENTUAL_ENFERMEIROS_SCP[categoriaPrevalente])
    )
      categoriaPrevalente = c;
  }
  const percentualEnfermeiros = categoriaPrevalente ? PERCENTUAL_ENFERMEIROS_SCP[categoriaPrevalente] : 0;
  let enfermeiros = teto(totalProfissionais * percentualEnfermeiros);
  if (categoriaPrevalente) {
    parcelas.push(
      `Enfermeiros: categoria de maior prevalência ${CATEGORIAS_SCP[categoriaPrevalente].rotulo.toLowerCase()} (${contagem(categoriaPrevalente)} paciente(s)), ${pct(percentualEnfermeiros)} de ${totalProfissionais} = ${br(arred(totalProfissionais * percentualEnfermeiros, 2))}, para cima: ${enfermeiros}`,
    );
    const minimo = e.minimoEnfermeiros ?? MINIMO_ENFERMEIROS_MINIMO_INTERMEDIARIO;
    if (
      (categoriaPrevalente === 'minimos' || categoriaPrevalente === 'intermediarios') &&
      minimo > 0 &&
      enfermeiros < minimo &&
      totalProfissionais > 0
    ) {
      enfermeiros = Math.min(minimo, totalProfissionais);
      parcelas.push(`Mínimo de enfermeiros no cuidado mínimo e intermediário: ${enfermeiros}`);
    }
  }
  const tecnicos = totalProfissionais - enfermeiros;
  parcelas.push(`Técnicos e auxiliares de enfermagem = ${totalProfissionais} - ${enfermeiros} = ${tecnicos}`);
  const coberturaSugerida = teto(totalHoras / 24);
  parcelas.push(
    `Cobertura sugerida no turno (profissionais ao mesmo tempo) = ${br(totalHoras)} h ÷ 24 h = ${br(arred(totalHoras / 24, 2))}, para cima: ${coberturaSugerida}`,
  );
  return {
    pacientes: { ...e.pacientes },
    horasPorCategoria,
    nasSoma,
    nasHoras,
    totalHoras,
    km,
    quantitativo,
    totalProfissionais,
    categoriaPrevalente,
    percentualEnfermeiros,
    enfermeiros,
    tecnicos,
    coberturaSugerida,
    parcelas,
  };
}

/**
 * Os pacientes por categoria a partir da classificação do turno (Fugulin; o NAS vem à parte, como soma).
 * Uma classificação por paciente: quem tem Fugulin e NAS no mesmo turno conta uma vez só, pelo NAS
 * (o instrumento da terapia intensiva); `comOsDois` diz quantos pacientes estavam nesse caso.
 */
export function pacientesDaClassificacao(
  classificacoes: readonly {
    readonly paciente?: number | string | null;
    readonly instrumento: string;
    readonly categoria: string;
    readonly total: number;
  }[],
): { pacientes: Record<CategoriaScp, number>; nasSoma: number; nasPacientes: number; comOsDois: number } {
  const pacientes = Object.fromEntries(CODIGOS_CATEGORIA_SCP.map((c) => [c, 0])) as Record<
    CategoriaScp,
    number
  >;
  const comNas = new Set(
    classificacoes
      .filter((x) => x.instrumento === 'nas' && x.paciente !== undefined && x.paciente !== null)
      .map((x) => String(x.paciente)),
  );
  const comOsDois = new Set<string>();
  let nasSoma = 0;
  let nasPacientes = 0;
  for (const x of classificacoes) {
    if (x.instrumento === 'nas') {
      nasSoma += x.total;
      nasPacientes++;
    } else if (x.paciente !== undefined && x.paciente !== null && comNas.has(String(x.paciente)))
      comOsDois.add(String(x.paciente));
    else if ((CODIGOS_CATEGORIA_SCP as readonly string[]).includes(x.categoria))
      pacientes[x.categoria as CategoriaScp]++;
  }
  return { pacientes, nasSoma: arred(nasSoma, 1), nasPacientes, comOsDois: comOsDois.size };
}
