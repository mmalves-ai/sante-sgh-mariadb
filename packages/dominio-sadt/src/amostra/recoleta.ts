// Recoleta e sub-amostras (F3.5, 05-SADT linha 7). A recoleta é um fato próprio: nasce de uma amostra com motivo do
// cadastro, fica pendente até a nova coleta e liga a amostra nova à original (a original nunca é apagada). A sub-amostra
// (alíquota) sai da amostra primária recebida pelas regras do exame: cada regra diz a bancada ou o setor de destino e
// como as etiquetas se agrupam. Regra pura, sem banco.

export class RecusaAmostra extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

/** Situações (do banco) em que a amostra ainda pode pedir recoleta. */
const RECOLETAVEIS = new Set([
  'coletada',
  'em_transporte',
  'recebida',
  'triada',
  'aliquotada',
  'em_analise',
  'rejeitada',
]);

export interface MotivoRecoleta {
  readonly ativo: boolean;
  readonly geraNovaAmostra: boolean;
}

/** Situações em que a amostra já não atende exame nenhum (o vínculo com o exame fica só como histórico). */
export const AMOSTRA_INATIVA = ['rejeitada', 'cancelada', 'descartada'] as const;
const inativa = (s: string) => (AMOSTRA_INATIVA as readonly string[]).includes(s);

export interface FamiliaDaAmostra {
  /** A amostra pedida é uma alíquota (tem amostra primária). */
  readonly ehAliquota: boolean;
  /** As alíquotas da amostra primária, com a situação de cada uma. */
  readonly aliquotas: readonly { readonly id: number; readonly situacao: string }[];
}

/**
 * Confere o pedido de recoleta: a amostra precisa estar coletada (ou rejeitada), sem outra recoleta em aberto, e o
 * motivo ativo. A recoleta é uma nova coleta do paciente, por isso nasce sempre da amostra primária: pedida numa
 * alíquota, é recusada (a tela leva à primária). As alíquotas ainda ativas da primária são rejeitadas junto, para que
 * cada exame fique ligado a uma única amostra viva (a nova). Devolve o que rejeitar; nada é apagado.
 */
export function conferirRecoleta(
  situacaoAmostra: string,
  recoletaAberta: boolean,
  motivo: MotivoRecoleta | null,
  familia: FamiliaDaAmostra = { ehAliquota: false, aliquotas: [] },
): { readonly rejeitarOriginal: boolean; readonly rejeitarAliquotas: readonly number[] } {
  if (!motivo || !motivo.ativo)
    throw new RecusaAmostra('motivo-invalido', 'Escolha um motivo de recoleta ativo.');
  if (familia.ehAliquota)
    throw new RecusaAmostra(
      'recoleta-pela-primaria',
      'A recoleta é pedida pela amostra primária do paciente: as alíquotas dela são rejeitadas junto.',
    );
  if (!RECOLETAVEIS.has(situacaoAmostra))
    throw new RecusaAmostra('amostra-sem-recoleta', 'A amostra não está numa situação que permita recoleta.');
  if (recoletaAberta)
    throw new RecusaAmostra('recoleta-aberta', 'Já existe recoleta pendente para esta amostra.');
  return {
    rejeitarOriginal: situacaoAmostra !== 'rejeitada',
    rejeitarAliquotas: familia.aliquotas.filter((a) => !inativa(a.situacao)).map((a) => a.id),
  };
}

/** Passagens da recoleta pendente: a coleta só fecha a pendente, e o cancelamento pede motivo. */
export function conferirFechamentoRecoleta(
  situacao: string,
  acao: 'coletar' | 'cancelar',
  motivo?: string | null,
) {
  if (!['pendente', 'contato_realizado', 'agendada'].includes(situacao))
    throw new RecusaAmostra('recoleta-fechada', 'A recoleta já foi coletada ou cancelada.');
  if (acao === 'cancelar' && (motivo ?? '').trim().length < 5)
    throw new RecusaAmostra('motivo-obrigatorio', 'Informe o motivo do cancelamento da recoleta.');
}

/**
 * A identificação positiva na coleta da recoleta (meta 1 de segurança do paciente), com a mesma exigência da coleta
 * comum: os dois identificadores conferidos sempre e, no internado, a pulseira lida do próprio paciente. A estação de
 * coleta é obrigatória (vai para o evento da amostra nova).
 */
export function conferirColetaDaRecoleta(c: {
  readonly internado: boolean;
  readonly identificadoresConferidos: boolean;
  readonly pulseiraLida: string | null;
  /** Os códigos aceitos para a pulseira deste paciente (id com prefixo P, prontuário). */
  readonly pulseiraDoPaciente: readonly string[];
  readonly estacao: string | null;
}): void {
  if (!c.identificadoresConferidos)
    throw new RecusaAmostra(
      'coleta-nao-conferida',
      'Confira o nome completo e a data de nascimento com o paciente antes de coletar.',
    );
  if (!(c.estacao ?? '').trim())
    throw new RecusaAmostra('sem-estacao', 'Informe a estação ou o posto de coleta.');
  if (!c.internado) return;
  const lida = (c.pulseiraLida ?? '').trim().toUpperCase();
  if (!lida)
    throw new RecusaAmostra(
      'coleta-nao-conferida',
      'Leia a pulseira do paciente internado antes de coletar.',
    );
  const ok = c.pulseiraDoPaciente.some((p) => {
    const q = p.toUpperCase();
    return lida === q || lida.startsWith(`${q}|`);
  });
  if (!ok)
    throw new RecusaAmostra('pulseira-divergente', 'A pulseira lida não é do paciente desta recoleta.');
}

/**
 * O destino dos exames quando a recoleta é cancelada: "cancelar" cancela cada exame com o motivo de cancelamento do
 * cadastro (o exame sai da fila); "manter" deixa o exame pendente de coleta, com o aviso explícito da recoleta
 * cancelada (a coleta comum o retoma). A escolha é obrigatória.
 */
export function destinoDosExamesAoCancelar(
  destino: 'cancelar' | 'manter' | null | undefined,
  motivoCancelamentoExame: number | null | undefined,
): { readonly cancelarExames: boolean } {
  if (destino !== 'cancelar' && destino !== 'manter')
    throw new RecusaAmostra(
      'destino-obrigatorio',
      'Diga o que acontece com os exames: cancelar ou manter pendentes de coleta.',
    );
  if (destino === 'cancelar' && !motivoCancelamentoExame)
    throw new RecusaAmostra('motivo-invalido', 'Escolha o motivo de cancelamento dos exames.');
  return { cancelarExames: destino === 'cancelar' };
}

// ── Sub-amostras ─────────────────────────────────────────────────────────────────────────────────────────────

export interface ExameDaAmostra {
  readonly exameItem: number;
  readonly exame: number;
  readonly setor: number | null;
  readonly material: number;
}

export interface RegraSubamostra {
  readonly id: number;
  readonly exame: number;
  readonly setor: number;
  readonly material: number | null;
  readonly bancada: number | null;
  readonly destinoSetor: number | null;
  readonly geraSubamostra: boolean;
  readonly examePrimario: boolean;
  readonly agrupamento: 'por_exame' | 'por_bancada' | 'por_setor' | 'unico' | null;
}

export interface SubamostraPlanejada {
  readonly regra: number;
  readonly bancada: number | null;
  readonly setor: number | null;
  readonly exameItens: readonly number[];
}

/**
 * O plano das alíquotas da amostra primária: para cada exame, a regra do exame no setor (a do material da amostra
 * vence a genérica). Exame sem regra, ou com a regra que o deixa na primária, não gera alíquota. As alíquotas se
 * agrupam pela regra: uma por exame, por bancada, por setor de destino ou única para a regra.
 */
export function planoDeSubamostras(
  exames: readonly ExameDaAmostra[],
  regras: readonly RegraSubamostra[],
): SubamostraPlanejada[] {
  const grupos = new Map<
    string,
    { regra: number; bancada: number | null; setor: number | null; itens: number[] }
  >();
  for (const e of exames) {
    const candidatas = regras.filter(
      (r) =>
        r.exame === e.exame &&
        // O setor do item manda: item sem setor não pega regra de setor nenhum (evita a regra de outro estabelecimento).
        e.setor !== null &&
        r.setor === e.setor &&
        (r.material ?? e.material) === e.material,
    );
    const r = candidatas.find((x) => x.material !== null) ?? candidatas[0];
    if (!r || !r.geraSubamostra || r.examePrimario) continue;
    const setor = r.destinoSetor ?? r.setor;
    const ag = r.agrupamento ?? 'por_exame';
    const k =
      ag === 'por_exame'
        ? `e:${e.exameItem}`
        : ag === 'por_bancada'
          ? `b:${r.bancada ?? '-'}:${setor}`
          : ag === 'por_setor'
            ? `s:${setor}`
            : `u:${r.id}`;
    const g = grupos.get(k) ?? { regra: r.id, bancada: r.bancada, setor, itens: [] };
    g.itens.push(e.exameItem);
    grupos.set(k, g);
  }
  return [...grupos.values()].map((g) => ({
    regra: g.regra,
    bancada: g.bancada,
    setor: g.setor,
    exameItens: g.itens,
  }));
}

/** A amostra primária só se divide recebida (ou triada) e uma vez só: a já dividida diz isso, não "não recebida". */
export function conferirAliquotagem(
  situacao: string,
  jaTemFilhas: boolean,
  plano: readonly SubamostraPlanejada[],
) {
  if (jaTemFilhas || situacao === 'aliquotada')
    throw new RecusaAmostra('amostra-aliquotada', 'As alíquotas desta amostra já foram geradas.');
  if (!['recebida', 'triada'].includes(situacao))
    throw new RecusaAmostra(
      'amostra-nao-recebida',
      'Receba a amostra no laboratório antes de gerar as alíquotas.',
    );
  if (plano.length === 0)
    throw new RecusaAmostra('sem-regra-subamostra', 'Nenhum exame desta amostra tem regra de alíquota.');
}

// ── Posto de coleta (cadastro próprio) ──────────────────────────────────────────────────────────────────────
// O posto é o lugar onde a amostra é colhida: a sala do hospital (interno), a unidade fora dele (externo) ou a equipe
// que vai à casa do paciente (domiciliar). Diz qual setor de laboratório recebe as amostras e em que horário atende.
// A coleta registra o posto escolhido; fora do horário ela não é recusada (a coleta aconteceu e precisa ficar
// registrada): vira um aviso gravado na passagem da amostra.

export const TIPOS_DE_POSTO = ['interno', 'externo', 'domiciliar'] as const;
export type TipoDePosto = (typeof TIPOS_DE_POSTO)[number];

export interface CadastroDoPosto {
  readonly codigo: string;
  readonly descricao: string;
  readonly tipo: TipoDePosto;
  /** Setor de laboratório que recebe as amostras do posto. */
  readonly setorLaboratorio: number | null;
  /** Horário de atendimento (HH:MM); os dois ou nenhum. */
  readonly horarioInicio: string | null;
  readonly horarioFim: string | null;
  readonly funcionaFimDeSemana: boolean;
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

/**
 * Confere o cadastro do posto antes de gravar e devolve-o normalizado (código em maiúsculas, textos aparados): código
 * único no estabelecimento, descrição, tipo, setor de laboratório que recebe e horário coerente (fim depois do início).
 */
export function conferirCadastroDoPosto(
  p: CadastroDoPosto,
  codigosEmUso: readonly string[] = [],
): CadastroDoPosto {
  const codigo = p.codigo.trim().toUpperCase();
  const descricao = p.descricao.trim();
  if (!/^[A-Z0-9._-]{1,30}$/.test(codigo))
    throw new RecusaAmostra(
      'posto-codigo-invalido',
      'O código do posto tem de 1 a 30 letras, dígitos, ponto, hífen ou sublinhado.',
    );
  if (codigosEmUso.some((c) => c.trim().toUpperCase() === codigo))
    throw new RecusaAmostra('posto-codigo-repetido', 'Já existe posto de coleta com este código.');
  if (descricao.length < 3 || descricao.length > 150)
    throw new RecusaAmostra('posto-descricao-invalida', 'Descreva o posto com 3 a 150 caracteres.');
  if (!(TIPOS_DE_POSTO as readonly string[]).includes(p.tipo))
    throw new RecusaAmostra('posto-tipo-invalido', 'O posto é interno, externo ou domiciliar.');
  if (p.setorLaboratorio === null)
    throw new RecusaAmostra(
      'posto-sem-setor',
      'Escolha o setor de laboratório que recebe as amostras do posto.',
    );
  const inicio = p.horarioInicio?.trim() || null;
  const fim = p.horarioFim?.trim() || null;
  if ((inicio === null) !== (fim === null))
    throw new RecusaAmostra('posto-horario-incompleto', 'Informe o início e o fim do horário, ou nenhum.');
  if (inicio !== null && fim !== null) {
    if (!HORA.test(inicio) || !HORA.test(fim))
      throw new RecusaAmostra('posto-horario-invalido', 'O horário do posto vai no formato HH:MM.');
    if (minutos(fim) <= minutos(inicio))
      throw new RecusaAmostra('posto-horario-invalido', 'O fim do horário do posto vem depois do início.');
  }
  return { ...p, codigo, descricao, horarioInicio: inicio, horarioFim: fim };
}

export interface PostoNaColeta {
  readonly ativo: boolean;
  readonly horarioInicio: string | null;
  readonly horarioFim: string | null;
  readonly funcionaFimDeSemana: boolean;
}

export type AvisoDoPosto = 'fora-do-horario' | 'fim-de-semana';

/**
 * Confere o posto escolhido na coleta. O posto é opcional (a coleta à beira do leito não tem posto); o inexistente e o
 * inativo são recusados. Fora do horário ou em fim de semana em posto que não abre, a coleta segue com o aviso, que a
 * gravação guarda na passagem da amostra. `quando` é o relógio do estabelecimento: dia da semana (0 = domingo) e HH:MM.
 */
export function conferirPostoNaColeta(
  posto: PostoNaColeta | null,
  informado: boolean,
  quando: { readonly diaSemana: number; readonly hora: string },
): readonly AvisoDoPosto[] {
  if (!informado) return [];
  if (!posto)
    throw new RecusaAmostra('posto-inexistente', 'O posto de coleta não existe neste estabelecimento.');
  if (!posto.ativo) throw new RecusaAmostra('posto-inativo', 'O posto de coleta está inativo.');
  const avisos: AvisoDoPosto[] = [];
  if (!posto.funcionaFimDeSemana && (quando.diaSemana === 0 || quando.diaSemana === 6))
    avisos.push('fim-de-semana');
  if (posto.horarioInicio && posto.horarioFim && HORA.test(quando.hora)) {
    const agora = minutos(quando.hora);
    if (agora < minutos(posto.horarioInicio) || agora >= minutos(posto.horarioFim))
      avisos.push('fora-do-horario');
  }
  return avisos;
}

// ── Etiqueta da recoleta e da alíquota ──────────────────────────────────────────────────────────────────────
// Toda amostra nova sai com etiqueta: a da recoleta diz que é recoleta, a da alíquota diz qual é entre quantas. A
// primeira via usa a mesma chave da coleta comum (o clique repetido não imprime duas vezes); a reimpressão é uma via
// numerada, registrada na passagem da amostra.

export type TipoDeEtiqueta = 'coleta' | 'recoleta' | 'aliquota';

/** O tipo da etiqueta pelo que a amostra é: alíquota (tem primária), recoleta (repetição) ou coleta comum. */
export function tipoDaEtiqueta(a: {
  readonly ehAliquota: boolean;
  readonly repeticao: boolean;
}): TipoDeEtiqueta {
  return a.ehAliquota ? 'aliquota' : a.repeticao ? 'recoleta' : 'coleta';
}

export const LARGURA_LINHA_ETIQUETA = 18;

/**
 * A linha de exames da etiqueta (cabe em 18 caracteres): a marca do tipo ("RC" na recoleta; "A1/3" na alíquota 1 de 3)
 * e os códigos dos exames; os que não couberem viram "+n", nunca um código cortado ao meio.
 */
export function linhaDaEtiqueta(e: {
  readonly tipo: TipoDeEtiqueta;
  readonly exames: readonly string[];
  readonly indice?: number;
  readonly total?: number;
}): string {
  const marca =
    e.tipo === 'recoleta'
      ? 'RC'
      : e.tipo === 'aliquota'
        ? `A${Math.max(1, e.indice ?? 1)}/${Math.max(e.indice ?? 1, e.total ?? 1)}`
        : '';
  const codigos = e.exames.map((c) => c.trim()).filter(Boolean);
  let linha = marca;
  for (let i = 0; i < codigos.length; i += 1) {
    const resto = codigos.length - i - 1;
    const proxima = linha ? `${linha} ${codigos[i]}` : codigos[i]!;
    const reserva = resto > 0 ? ` +${resto}`.length : 0;
    if (proxima.length + reserva > LARGURA_LINHA_ETIQUETA) {
      const sobra = ` +${resto + 1}`;
      return linha
        ? `${linha}${sobra}`.slice(0, LARGURA_LINHA_ETIQUETA)
        : codigos[i]!.slice(0, LARGURA_LINHA_ETIQUETA);
    }
    linha = proxima;
  }
  return linha;
}

/**
 * A via a imprimir e a chave da fila. Amostra que já não atende exame (rejeitada, cancelada, descartada) não ganha
 * etiqueta. A primeira via tem a chave da coleta comum; a reimpressão pedida soma uma via.
 */
export function viaDaEtiqueta(
  codigo: string,
  situacao: string,
  viasImpressas: number,
  reimpressao: boolean,
): { readonly via: number; readonly chave: string } {
  if (inativa(situacao))
    throw new RecusaAmostra(
      'amostra-inativa',
      'A amostra foi rejeitada, cancelada ou descartada: não se imprime etiqueta dela.',
    );
  const via = reimpressao ? Math.max(1, viasImpressas) + 1 : 1;
  return { via, chave: via === 1 ? `amostra-${codigo}` : `amostra-${codigo}-v${via}` };
}
