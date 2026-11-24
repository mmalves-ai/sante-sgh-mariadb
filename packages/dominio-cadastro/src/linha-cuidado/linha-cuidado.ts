// Programas de saúde e linhas de cuidado do paciente (F8, 02-CAD linha 11): regras puras da inscrição e da mudança de
// estado. Desenho próprio: a inscrição nasce no estado de entrada do hospital (o marcado como padrão; sem ele, o de
// natureza "incluído"), muda de estado só pelos caminhos permitidos e, ao chegar a um estado final (alta, abandono,
// transferência, óbito) ou a um estado marcado para encerrar, fecha a vigência com o motivo. Nada é apagado: a volta do
// paciente ao programa é uma inscrição nova, e cada mudança vira uma linha do histórico. Datas AAAA-MM-DD.

export const TIPOS_ESTADO_LINHA = [
  'incluido',
  'ativo',
  'suspenso',
  'alta',
  'abandono',
  'transferido',
  'obito',
] as const;
export type TipoEstadoLinha = (typeof TIPOS_ESTADO_LINHA)[number];

/** Estados finais: a inscrição encerra ao chegar a eles. */
export const ESTADOS_FINAIS: readonly TipoEstadoLinha[] = ['alta', 'abandono', 'transferido', 'obito'];

/** Para onde cada natureza de estado pode ir. Final não sai: voltar ao programa é inscrição nova. */
export const TRANSICOES_LINHA: Readonly<Record<TipoEstadoLinha, readonly TipoEstadoLinha[]>> = {
  incluido: ['ativo', 'suspenso', 'alta', 'abandono', 'transferido', 'obito'],
  ativo: ['suspenso', 'alta', 'abandono', 'transferido', 'obito'],
  suspenso: ['ativo', 'alta', 'abandono', 'transferido', 'obito'],
  alta: [],
  abandono: [],
  transferido: [],
  obito: [],
};

export interface RecusaLinha {
  readonly codigo: string;
  readonly campo: string;
  readonly mensagem: string;
}

export interface EstadoLinha {
  readonly id: number;
  readonly tipo: TipoEstadoLinha;
  readonly padraoAtivacao: boolean;
  readonly encerraInscricao: boolean;
  readonly ativo: boolean;
}

/** O estado em que a inscrição nasce: o padrão ativo do hospital; sem ele, o primeiro de natureza "incluído" ou "ativo". */
export function estadoDeEntrada(estados: readonly EstadoLinha[]): EstadoLinha | null {
  const vivos = estados.filter((e) => e.ativo && !e.encerraInscricao && !ESTADOS_FINAIS.includes(e.tipo));
  return (
    vivos.find((e) => e.padraoAtivacao) ??
    vivos.find((e) => e.tipo === 'incluido') ??
    vivos.find((e) => e.tipo === 'ativo') ??
    null
  );
}

/** A inscrição encerra ao entrar neste estado. */
export function encerraAoEntrar(e: Pick<EstadoLinha, 'tipo' | 'encerraInscricao'>): boolean {
  return e.encerraInscricao || ESTADOS_FINAIS.includes(e.tipo);
}

export interface EntradaInscricao {
  readonly linhaAtiva: boolean;
  readonly exigeReferencia: boolean;
  readonly referencia: number | null;
  readonly vigenciaInicio: string;
  readonly hoje: string;
  readonly nascimento: string | null;
  /** Inscrição viva (não encerrada) do paciente na mesma linha e no mesmo estabelecimento. */
  readonly inscricaoViva: boolean;
  /** Faixa etária da linha em anos inteiros, quando a linha restringe; null sem restrição. */
  readonly faixa: { readonly minima: number | null; readonly maxima: number | null } | null;
  readonly pacienteFalecido: boolean;
}

/** Idade em anos completos na data. */
export function idadeEm(nascimento: string, data: string): number {
  const [an, mn, dn] = nascimento.split('-').map(Number) as [number, number, number];
  const [ad, md, dd] = data.split('-').map(Number) as [number, number, number];
  return ad - an - (md < mn || (md === mn && dd < dn) ? 1 : 0);
}

export function conferirInscricao(e: EntradaInscricao): RecusaLinha[] {
  const r: RecusaLinha[] = [];
  if (!e.linhaAtiva)
    r.push({
      codigo: 'linha-inativa',
      campo: 'linha',
      mensagem: 'O programa está inativo e não recebe inscrição.',
    });
  if (e.pacienteFalecido)
    r.push({
      codigo: 'paciente-falecido',
      campo: 'paciente',
      mensagem: 'Paciente com óbito registrado não é inscrito.',
    });
  if (e.inscricaoViva)
    r.push({
      codigo: 'inscricao-viva',
      campo: 'linha',
      mensagem: 'O paciente já está inscrito neste programa; mude o estado da inscrição existente.',
    });
  if (e.exigeReferencia && !e.referencia)
    r.push({
      codigo: 'referencia-obrigatoria',
      campo: 'referencia',
      mensagem: 'Este programa exige o profissional de referência.',
    });
  if (e.vigenciaInicio > e.hoje)
    r.push({
      codigo: 'inicio-futuro',
      campo: 'vigenciaInicio',
      mensagem: 'A inscrição não começa no futuro.',
    });
  if (e.nascimento && e.vigenciaInicio < e.nascimento)
    r.push({
      codigo: 'inicio-antes-nascimento',
      campo: 'vigenciaInicio',
      mensagem: 'A inscrição não começa antes do nascimento.',
    });
  if (e.faixa && e.nascimento) {
    const idade = idadeEm(e.nascimento, e.vigenciaInicio);
    if (
      (e.faixa.minima !== null && idade < e.faixa.minima) ||
      (e.faixa.maxima !== null && idade > e.faixa.maxima)
    )
      r.push({
        codigo: 'fora-da-faixa-etaria',
        campo: 'linha',
        mensagem: 'A idade do paciente está fora da faixa etária do programa.',
      });
  }
  return r;
}

export interface EntradaMudancaEstado {
  readonly atual: TipoEstadoLinha;
  readonly atualId: number;
  readonly novo: EstadoLinha;
  readonly inscricaoEncerrada: boolean;
  readonly data: string;
  readonly hoje: string;
  /** Data (AAAA-MM-DD) em que o paciente entrou no estado atual. */
  readonly estadoDesde: string;
  readonly motivo: string | null;
}

export function conferirMudancaEstado(e: EntradaMudancaEstado): RecusaLinha[] {
  const r: RecusaLinha[] = [];
  if (e.inscricaoEncerrada)
    return [
      {
        codigo: 'inscricao-encerrada',
        campo: 'estado',
        mensagem: 'A inscrição está encerrada; para voltar ao programa, faça uma inscrição nova.',
      },
    ];
  if (!e.novo.ativo)
    r.push({ codigo: 'estado-inativo', campo: 'estado', mensagem: 'O estado escolhido está inativo.' });
  if (e.novo.id === e.atualId)
    r.push({ codigo: 'estado-igual', campo: 'estado', mensagem: 'A inscrição já está neste estado.' });
  else if (!TRANSICOES_LINHA[e.atual].includes(e.novo.tipo))
    r.push({
      codigo: 'transicao-invalida',
      campo: 'estado',
      mensagem: 'Esta mudança de estado não é permitida a partir do estado atual.',
    });
  if (e.data > e.hoje)
    r.push({ codigo: 'data-futura', campo: 'data', mensagem: 'A mudança não tem data futura.' });
  if (e.data < e.estadoDesde)
    r.push({
      codigo: 'data-antes-do-estado-atual',
      campo: 'data',
      mensagem: 'A mudança não pode ser anterior à entrada no estado atual.',
    });
  const motivo = (e.motivo ?? '').trim();
  if ((encerraAoEntrar(e.novo) || e.novo.tipo === 'suspenso') && motivo.length < 5)
    r.push({
      codigo: 'motivo-obrigatorio',
      campo: 'motivo',
      mensagem: 'Escreva o motivo (ao menos 5 letras) para suspender ou encerrar a inscrição.',
    });
  return r;
}

/** Contagem do painel do programa: inscrições vivas por natureza do estado. */
export function totaisPorEstado(
  linhas: readonly { readonly tipo: TipoEstadoLinha; readonly encerrada: boolean }[],
): { vivas: number; encerradas: number; porEstado: Partial<Record<TipoEstadoLinha, number>> } {
  const porEstado: Partial<Record<TipoEstadoLinha, number>> = {};
  let vivas = 0;
  let encerradas = 0;
  for (const l of linhas) {
    porEstado[l.tipo] = (porEstado[l.tipo] ?? 0) + 1;
    if (l.encerrada) encerradas += 1;
    else vivas += 1;
  }
  return { vivas, encerradas, porEstado };
}
