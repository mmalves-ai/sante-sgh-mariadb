// Classificação de risco externa (F3.9, linha 08-INTG L140): os perfis de prioridade enviados ao sistema de triagem
// (gestante, idoso, mobilidade reduzida) e o recebimento da classificação ligada ao atendimento do pronto atendimento.
// Toda classificação recebida fica registrada (nada é apagado): a que não confere entra como rejeitada com o motivo; a
// mais nova do atendimento vale e as anteriores ficam como substituídas. Tudo puro: a porta grava, o domínio decide.

export const CONDICOES_PREFERENCIAIS = [
  'gestante',
  'lactante',
  'idoso',
  'idoso_80',
  'deficiencia',
  'mobilidade_reduzida',
  'crianca_colo',
  'autismo',
  'obesidade',
  'outro',
] as const;
export type CondicaoPreferencial = (typeof CONDICOES_PREFERENCIAIS)[number];

export const SITUACOES_CLASSIFICACAO_EXTERNA = ['recebida', 'aplicada', 'rejeitada', 'substituida'] as const;
export type SituacaoClassificacaoExterna = (typeof SITUACOES_CLASSIFICACAO_EXTERNA)[number];

export interface ErroClassificacao {
  readonly campo: string;
  readonly codigo: string;
  readonly mensagem: string;
}
const erro = (campo: string, codigo: string, mensagem: string): ErroClassificacao => ({
  campo,
  codigo,
  mensagem,
});

export interface PerfilPrioridade {
  readonly codigo: string;
  readonly descricao: string;
  readonly codigoExterno: string | null;
  readonly condicaoPreferencial: CondicaoPreferencial | null;
  readonly ordemPrioridade: number;
  readonly ativo: boolean;
}

export function validarPerfilPrioridade(p: PerfilPrioridade): ErroClassificacao[] {
  const e: ErroClassificacao[] = [];
  if (!/^[a-z0-9_-]{1,30}$/i.test(p.codigo))
    e.push(erro('codigo', 'codigo-invalido', 'Código com até 30 letras, números, "-" ou "_".'));
  if (!p.descricao.trim()) e.push(erro('descricao', 'descricao-obrigatoria', 'Informe a descrição.'));
  if (p.ordemPrioridade < 0 || p.ordemPrioridade > 999)
    e.push(erro('ordemPrioridade', 'ordem-invalida', 'A ordem de prioridade vai de 0 a 999.'));
  return e;
}

/** O que vai ao sistema de triagem: os perfis ativos, na ordem de prioridade, com o código que ele conhece. */
export function perfisParaEnvio(
  perfis: readonly PerfilPrioridade[],
): { codigo: string; descricao: string; condicao: CondicaoPreferencial | null; ordem: number }[] {
  return perfis
    .filter((p) => p.ativo)
    .slice()
    .sort((a, b) => a.ordemPrioridade - b.ordemPrioridade || a.codigo.localeCompare(b.codigo))
    .map((p) => ({
      codigo: p.codigoExterno ?? p.codigo,
      descricao: p.descricao,
      condicao: p.condicaoPreferencial,
      ordem: p.ordemPrioridade,
    }));
}

/** Os perfis que cabem ao paciente pela idade e pelas condições registradas (para a fila da triagem). */
export function perfisDoPaciente(
  perfis: readonly PerfilPrioridade[],
  paciente: { readonly idadeAnos: number | null; readonly condicoes: readonly CondicaoPreferencial[] },
): PerfilPrioridade[] {
  const tem = new Set<CondicaoPreferencial>(paciente.condicoes);
  if (paciente.idadeAnos !== null && paciente.idadeAnos >= 60) tem.add('idoso');
  if (paciente.idadeAnos !== null && paciente.idadeAnos >= 80) tem.add('idoso_80');
  return perfis
    .filter((p) => p.ativo && p.condicaoPreferencial !== null && tem.has(p.condicaoPreferencial))
    .sort((a, b) => a.ordemPrioridade - b.ordemPrioridade);
}

export interface ClassificacaoRecebida {
  readonly identificadorExterno: string;
  readonly codigoPrioridade: string;
  readonly cor: string | null;
  readonly tempoAlvoMinutos: number | null;
  readonly classificadoEm: Date;
  readonly recebidoEm: Date;
}

export interface AtendimentoDaClassificacao {
  /** Existe no estabelecimento. */
  readonly existe: boolean;
  readonly prontoAtendimento: boolean;
  readonly entradaEm: Date | null;
  readonly encerrado: boolean;
}

/** Tolerância de relógio entre o sistema de triagem e o hospital. */
export const TOLERANCIA_RELOGIO_MS = 5 * 60_000;

/**
 * Motivos de rejeição da classificação recebida (vazio = aceita). A rejeitada também é gravada, com o motivo: a
 * integração nunca perde o que chegou.
 */
export function conferirClassificacaoRecebida(
  r: ClassificacaoRecebida,
  a: AtendimentoDaClassificacao,
): ErroClassificacao[] {
  const e: ErroClassificacao[] = [];
  if (!r.identificadorExterno.trim())
    e.push(erro('identificadorExterno', 'sem-identificador', 'A classificação veio sem identificador.'));
  if (!r.codigoPrioridade.trim())
    e.push(erro('codigoPrioridade', 'sem-prioridade', 'A classificação veio sem a prioridade.'));
  if (r.tempoAlvoMinutos !== null && (r.tempoAlvoMinutos < 0 || r.tempoAlvoMinutos > 1440))
    e.push(erro('tempoAlvoMinutos', 'tempo-alvo-invalido', 'Tempo-alvo fora de 0 a 1440 minutos.'));
  if (!a.existe) {
    e.push(erro('atendimento', 'atendimento-inexistente', 'Atendimento não encontrado no estabelecimento.'));
    return e;
  }
  if (!a.prontoAtendimento)
    e.push(erro('atendimento', 'nao-pronto-atendimento', 'O atendimento não é de pronto atendimento.'));
  if (a.encerrado) e.push(erro('atendimento', 'atendimento-encerrado', 'O atendimento já foi encerrado.'));
  if (r.classificadoEm.getTime() > r.recebidoEm.getTime() + TOLERANCIA_RELOGIO_MS)
    e.push(erro('classificadoEm', 'classificacao-futura', 'A classificação está com horário no futuro.'));
  if (a.entradaEm && r.classificadoEm.getTime() < a.entradaEm.getTime() - TOLERANCIA_RELOGIO_MS)
    e.push(erro('classificadoEm', 'antes-da-entrada', 'A classificação é anterior à entrada do paciente.'));
  return e;
}

/**
 * A situação de entrada da recebida e quem ela substitui: a mais nova (pelo horário da classificação) do atendimento
 * vale; as válidas anteriores passam a substituídas; a que chega atrasada (mais velha que a vigente) já entra
 * substituída.
 */
export function situacaoNaChegada(
  rejeitada: boolean,
  classificadoEm: Date,
  vigentes: readonly { readonly id: number; readonly classificadoEm: Date }[],
): { situacao: SituacaoClassificacaoExterna; substitui: number[] } {
  if (rejeitada) return { situacao: 'rejeitada', substitui: [] };
  const maisNova = vigentes.some((v) => v.classificadoEm.getTime() > classificadoEm.getTime());
  if (maisNova) return { situacao: 'substituida', substitui: [] };
  return { situacao: 'recebida', substitui: vigentes.map((v) => v.id) };
}

/** O prazo para o atendimento médico pela prioridade recebida. */
export function prazoAtendimento(classificadoEm: Date, tempoAlvoMinutos: number | null): Date | null {
  return tempoAlvoMinutos === null ? null : new Date(classificadoEm.getTime() + tempoAlvoMinutos * 60_000);
}

/** O que a aplicação de uma classificação recebida precisa conferir antes de gerar a classificação interna. */
export interface RecebidaParaAplicar {
  readonly situacao: SituacaoClassificacaoExterna;
  readonly cor: string | null;
  readonly tempoAlvoMinutos: number | null;
  readonly classificadoEm: Date;
  readonly queixaPrincipal: string | null;
  readonly descricaoPrioridade: string | null;
  readonly codigoPrioridade: string;
}

export interface PlanoAplicacao {
  readonly cor: string;
  readonly tempoAlvoMinutos: number;
  readonly prazo: Date;
  readonly queixa: string;
}

/**
 * Regra da aplicação (F3.9, 08-INTG L140): só a recebida vigente (situação `recebida`) vira classificação interna; a
 * cor e o tempo-alvo são obrigatórios (a classificação interna não existe sem nível nem prazo); o prazo conta da hora
 * em que o sistema de triagem classificou, não da hora da aplicação; sem queixa informada, a interna leva a
 * prioridade recebida como queixa, para nunca ficar vazia. Devolve os erros ou o plano a gravar.
 */
export function planoAplicacao(r: RecebidaParaAplicar): {
  erros: ErroClassificacao[];
  plano: PlanoAplicacao | null;
} {
  const erros: ErroClassificacao[] = [];
  if (r.situacao !== 'recebida')
    erros.push({
      campo: 'situacao',
      codigo: 'nao-vigente',
      mensagem:
        r.situacao === 'aplicada'
          ? 'Esta classificação já foi aplicada ao atendimento.'
          : 'Só a classificação recebida e vigente pode ser aplicada.',
    });
  if (!r.cor?.trim())
    erros.push({
      campo: 'cor',
      codigo: 'sem-cor',
      mensagem: 'A classificação recebida não traz a cor da prioridade.',
    });
  if (r.tempoAlvoMinutos === null || r.tempoAlvoMinutos < 0 || r.tempoAlvoMinutos > 1440)
    erros.push({
      campo: 'tempoAlvoMinutos',
      codigo: 'sem-tempo-alvo',
      mensagem: 'A classificação recebida não traz um tempo-alvo válido para o atendimento médico.',
    });
  if (erros.length > 0) return { erros, plano: null };
  const tempo = r.tempoAlvoMinutos!;
  const queixa =
    r.queixaPrincipal?.trim() ||
    `Classificação externa: ${r.descricaoPrioridade?.trim() || r.codigoPrioridade}`;
  return {
    erros,
    plano: {
      cor: r.cor!.trim(),
      tempoAlvoMinutos: tempo,
      prazo: prazoAtendimento(r.classificadoEm, tempo)!,
      queixa,
    },
  };
}
