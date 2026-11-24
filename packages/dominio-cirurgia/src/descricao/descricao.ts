// Descrição cirúrgica assinada e intercorrências do ato (04-CC linha 96; F3.4, fatia F3.4-4). Regras puras, sem banco:
// a operação as aplica aos dados relidos sob a transação e a tela as usa para mostrar, na hora, o que falta.
// Desenho próprio:
//   - a descrição é do cirurgião que participou do ato (uma por cirurgião, por ato) e só ele a edita e assina;
//   - salvar e assinar é um gesto só (sem a etapa "concluir" separada): a assinatura confere o conteúdo mínimo;
//   - assinada, a descrição não muda (documento do prontuário): correção ou complemento entra como adendo com motivo,
//     e a descrição passa a "retificada", com o texto original intacto;
//   - a intercorrência tem o horário conferido contra a janela do ato e a conduta exigida pelo tipo; a grave, o óbito
//     e o tipo marcado como evento adverso pedem a notificação ao núcleo de segurança do paciente.

/** Recusa de negócio da descrição ou da intercorrência (a operação a traduz para a recusa do núcleo). */
export interface RecusaDescricao {
  readonly codigo: string;
  readonly mensagem: string;
  readonly campos?: readonly string[];
}
export class ErroDescricaoCirurgica extends Error {
  constructor(readonly recusa: RecusaDescricao) {
    super(`${recusa.codigo}: ${recusa.mensagem}`);
    this.name = 'ErroDescricaoCirurgica';
  }
}
const recusa = (codigo: string, mensagem: string, extra: { campos?: readonly string[] } = {}) =>
  new ErroDescricaoCirurgica({ codigo, mensagem, ...extra });

export const SITUACOES_DESCRICAO = ['rascunho', 'concluida', 'assinada', 'retificada'] as const;
export type SituacaoDescricao = (typeof SITUACOES_DESCRICAO)[number];
export const FASES_INTERCORRENCIA = ['pre_inducao', 'inducao', 'intraoperatorio', 'recuperacao'] as const;
export type FaseIntercorrencia = (typeof FASES_INTERCORRENCIA)[number];
export const GRAVIDADES_INTERCORRENCIA = ['leve', 'moderada', 'grave', 'obito'] as const;
export type GravidadeIntercorrencia = (typeof GRAVIDADES_INTERCORRENCIA)[number];

/** Mínimo de letras da descrição técnica para assinar. */
export const MINIMO_DESCRICAO_TECNICA = 30;
/** Teto plausível do sangramento estimado (mL). */
export const TETO_SANGRAMENTO_ML = 20000;
/** Tolerância do horário da intercorrência antes da entrada em sala e depois da saída (minutos). */
export const TOLERANCIA_INTERCORRENCIA_MIN = 120;
/** Tolerância do relógio do aparelho para horário no futuro (minutos). */
export const TOLERANCIA_FUTURO_MIN = 5;

export interface ConteudoDescricao {
  readonly descricaoTecnica: string | null;
  readonly envioAnatomopatologico: boolean;
  readonly descricaoPecas: string | null;
  readonly sangramentoMl: number | null;
  readonly achados: readonly { readonly achado: number; readonly complemento: string | null }[];
}

export interface DescricaoAtual {
  readonly situacao: SituacaoDescricao;
  readonly cirurgiao: number;
  readonly versao: number;
}

export type PendenciaDescricao =
  'descricao-tecnica-curta' | 'pecas-sem-descricao' | 'sangramento-implausivel' | 'achado-repetido';

const vazio = (t: string | null | undefined) => !t || t.trim().length === 0;

/** O que falta no conteúdo (para salvar: só o que é inválido; para assinar: também o mínimo exigido). */
export function pendenciasDaDescricao(d: ConteudoDescricao, paraAssinar: boolean): PendenciaDescricao[] {
  const p: PendenciaDescricao[] = [];
  if (paraAssinar && (d.descricaoTecnica ?? '').trim().length < MINIMO_DESCRICAO_TECNICA)
    p.push('descricao-tecnica-curta');
  if (d.envioAnatomopatologico && vazio(d.descricaoPecas)) p.push('pecas-sem-descricao');
  if (
    d.sangramentoMl !== null &&
    (!Number.isInteger(d.sangramentoMl) || d.sangramentoMl < 0 || d.sangramentoMl > TETO_SANGRAMENTO_ML)
  )
    p.push('sangramento-implausivel');
  if (new Set(d.achados.map((a) => a.achado)).size !== d.achados.length) p.push('achado-repetido');
  return p;
}

const TEXTOS: Record<PendenciaDescricao, string> = {
  'descricao-tecnica-curta': `Descreva a técnica (ao menos ${MINIMO_DESCRICAO_TECNICA} letras) antes de assinar.`,
  'pecas-sem-descricao': 'Com peça enviada ao anatomopatológico, descreva as peças.',
  'sangramento-implausivel': `O sangramento estimado deve ser um número inteiro entre 0 e ${TETO_SANGRAMENTO_ML} mL.`,
  'achado-repetido': 'O mesmo achado foi escolhido duas vezes.',
};
export const textoPendenciaDescricao = (p: PendenciaDescricao) => TEXTOS[p];

/** O profissional da sessão participou do ato (é da equipe registrada)? Sem vínculo de profissional, recusa. */
export function conferirAutorDaDescricao(profissional: number | null, equipe: readonly number[]): number {
  if (profissional === null)
    throw recusa('sem-profissional', 'A sua conta não tem vínculo de profissional neste estabelecimento.');
  if (!equipe.includes(profissional))
    throw recusa(
      'fora-da-equipe',
      'Só quem está na equipe registrada do ato descreve a cirurgia. Confira a equipe no registro do ato.',
    );
  return profissional;
}

/** Salvar (e talvez assinar) a descrição: só o rascunho do próprio cirurgião, na versão vista, com conteúdo válido. */
export function conferirGravacaoDescricao(
  atual: DescricaoAtual | null,
  pedido: { readonly profissional: number; readonly versao: number | null; readonly assinar: boolean },
  conteudo: ConteudoDescricao,
): void {
  if (atual) {
    if (atual.cirurgiao !== pedido.profissional)
      throw recusa('descricao-de-outro-cirurgiao', 'A descrição é de outro cirurgião: só ele a altera.');
    if (atual.situacao === 'assinada' || atual.situacao === 'retificada')
      throw recusa('descricao-assinada', 'A descrição já foi assinada: inclua um adendo.');
    if (pedido.versao === null || pedido.versao !== atual.versao)
      throw recusa(
        'versao-desatualizada',
        `A descrição mudou desde que foi aberta (versão ${atual.versao}): atualize a tela e confira.`,
      );
  } else if (pedido.versao !== null)
    throw recusa('registro-inexistente', 'A descrição não existe mais: atualize a tela.');
  const p = pendenciasDaDescricao(conteudo, pedido.assinar);
  if (p.length > 0) throw recusa(p[0]!, textoPendenciaDescricao(p[0]!), { campos: p });
}

/** Adendo: só na descrição assinada, pelo próprio cirurgião, com texto e motivo. */
export function conferirAdendoDescricao(
  atual: DescricaoAtual | null,
  profissional: number | null,
  a: { readonly texto: string; readonly motivo: string },
): void {
  if (!atual) throw recusa('registro-inexistente', 'A descrição não existe.');
  if (atual.situacao !== 'assinada' && atual.situacao !== 'retificada')
    throw recusa('descricao-nao-assinada', 'A descrição ainda não foi assinada: altere o próprio texto.');
  if (profissional === null || profissional !== atual.cirurgiao)
    throw recusa('descricao-de-outro-cirurgiao', 'Só o cirurgião autor inclui adendo na descrição.');
  if (a.texto.trim().length < 5)
    throw recusa('texto-obrigatorio', 'Escreva o adendo (ao menos 5 letras).', { campos: ['texto'] });
  if (a.motivo.trim().length < 5)
    throw recusa('motivo-obrigatorio', 'Informe o motivo do adendo (ao menos 5 letras).', {
      campos: ['motivo'],
    });
}

export interface TipoIntercorrencia {
  readonly ativo: boolean;
  readonly exigeConduta: boolean;
  readonly eventoAdverso: boolean;
}

export interface JanelaDoAto {
  readonly entrada: Date | null;
  readonly saida: Date | null;
}

/**
 * Intercorrência: horário dentro da janela do ato (com tolerância), nunca no futuro; conduta quando o tipo exige;
 * descrição na grave e no óbito. Devolve se pede notificação de evento adverso.
 */
export function conferirIntercorrencia(
  i: {
    readonly ocorridoEm: Date;
    readonly gravidade: GravidadeIntercorrencia;
    readonly descricao: string | null;
    readonly conduta: string | null;
  },
  tipo: TipoIntercorrencia | null,
  janela: JanelaDoAto,
  agora: Date,
): { readonly pedeNotificacao: boolean } {
  if (!tipo || !tipo.ativo) throw recusa('tipo-inexistente', 'Escolha um tipo de intercorrência ativo.');
  const t = i.ocorridoEm.getTime();
  if (t > agora.getTime() + TOLERANCIA_FUTURO_MIN * 60_000)
    throw recusa('horario-futuro', 'O horário da intercorrência está no futuro.', { campos: ['ocorridoEm'] });
  const tol = TOLERANCIA_INTERCORRENCIA_MIN * 60_000;
  if (
    (janela.entrada && t < janela.entrada.getTime() - tol) ||
    (janela.saida && t > janela.saida.getTime() + tol)
  )
    throw recusa(
      'fora-da-janela',
      'O horário está fora do período do ato (entrada e saída da sala, com 2 horas de tolerância).',
      { campos: ['ocorridoEm'] },
    );
  if (tipo.exigeConduta && vazio(i.conduta))
    throw recusa('conduta-obrigatoria', 'Este tipo de intercorrência exige a conduta tomada.', {
      campos: ['conduta'],
    });
  const grave = i.gravidade === 'grave' || i.gravidade === 'obito';
  if (grave && vazio(i.descricao))
    throw recusa('descricao-obrigatoria', 'Descreva a intercorrência grave ou o óbito.', {
      campos: ['descricao'],
    });
  return { pedeNotificacao: grave || tipo.eventoAdverso };
}
