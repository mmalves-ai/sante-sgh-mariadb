// Regras do painel do profissional, da configuração do prontuário por setor e da equipe assistencial (F3.3, linhas
// 03-PEP L90, L91 e L94 da análise). Domínio puro: sem banco nem I/O; a porta própria grava o que estas regras aceitam.
//   - Pacientes acompanhados: o profissional marca e desmarca; desmarcar encerra o período (fim), nunca apaga.
//   - Colunas do painel: só as do catálogo, sem repetição, no mínimo duas; ficam no banco por usuário (troca de
//     computador não perde o painel).
//   - Configuração por setor: a do setor e tipo de atendimento vence a do setor para "todos", que vence o padrão do
//     estabelecimento; a tolerância do retroativo só existe com o retroativo permitido.
//   - Equipe assistencial: um único responsável principal vigente por atendimento, e a função de responsável é de
//     categoria médica; o mesmo profissional não entra duas vezes na mesma função ao mesmo tempo; a saída grava o fim
//     e o motivo (histórico nunca apagado). Quem está na equipe vigente tem vínculo com o paciente e recebe pendências
//     quando marcado para recebê-las.

export type TipoAtendimentoProntuario =
  'todos' | 'internacao' | 'pronto_atendimento' | 'ambulatorio' | 'hospital_dia' | 'externo';
export const TIPOS_ATENDIMENTO_PRONTUARIO: readonly TipoAtendimentoProntuario[] = [
  'todos',
  'internacao',
  'pronto_atendimento',
  'ambulatorio',
  'hospital_dia',
  'externo',
];
export type AssinaturaExigida = 'nenhuma' | 'eletronica' | 'digital_icp';
export const ASSINATURAS_EXIGIDAS: readonly AssinaturaExigida[] = ['nenhuma', 'eletronica', 'digital_icp'];

export interface ErroRegra {
  readonly campo: string;
  readonly codigo: string;
  readonly mensagem: string;
}

// ── Pacientes acompanhados e colunas ─────────────────────────────────────────────────────────────

export interface AcompanhamentoVigente {
  readonly paciente: number;
  readonly fim: string | null;
}

/** Marcar o paciente: recusa o que já está acompanhado (vigente) e o motivo longo demais. */
export function validarAcompanhar(
  vigentes: readonly AcompanhamentoVigente[],
  paciente: number,
  motivo: string | null,
): ErroRegra[] {
  const erros: ErroRegra[] = [];
  if (!Number.isSafeInteger(paciente) || paciente <= 0)
    erros.push({ campo: 'paciente', codigo: 'paciente-invalido', mensagem: 'Paciente inválido.' });
  if (vigentes.some((v) => v.paciente === paciente && v.fim === null))
    erros.push({
      campo: 'paciente',
      codigo: 'ja-acompanhado',
      mensagem: 'O paciente já está na sua lista de acompanhados.',
    });
  if (motivo !== null && motivo.trim().length > 500)
    erros.push({ campo: 'motivo', codigo: 'motivo-longo', mensagem: 'O motivo passa de 500 caracteres.' });
  return erros;
}

/** Colunas válidas do painel: do catálogo, sem repetição e no mínimo duas, na ordem escolhida. */
export function validarColunasPainel(colunas: readonly string[], catalogo: readonly string[]): ErroRegra[] {
  const erros: ErroRegra[] = [];
  const fora = colunas.filter((c) => !catalogo.includes(c));
  if (fora.length)
    erros.push({
      campo: 'colunas',
      codigo: 'coluna-desconhecida',
      mensagem: `Coluna desconhecida: ${fora.join(', ')}.`,
    });
  if (new Set(colunas).size !== colunas.length)
    erros.push({ campo: 'colunas', codigo: 'coluna-repetida', mensagem: 'Há coluna repetida.' });
  if (colunas.length < 2)
    erros.push({ campo: 'colunas', codigo: 'colunas-minimas', mensagem: 'Escolha pelo menos duas colunas.' });
  return erros;
}

// ── Configuração do prontuário por setor ─────────────────────────────────────────────────────────

export interface ConfiguracaoProntuario {
  readonly permiteRetroativo: boolean;
  /** Atraso máximo aceito, em horas; nulo com retroativo permitido = sem limite. */
  readonly toleranciaRetroativoHoras: number | null;
  readonly assinaturaExigida: AssinaturaExigida;
  readonly exigeEvolucaoMedica: boolean;
  readonly exigeEvolucaoEnfermagem: boolean;
}

export interface ConfiguracaoSetor extends ConfiguracaoProntuario {
  readonly setor: number;
  readonly tipoAtendimento: TipoAtendimentoProntuario;
  readonly ativo: boolean;
}

/** Padrão do estabelecimento quando o setor não tem configuração: sem retroativo e assinatura eletrônica. */
export const CONFIGURACAO_PRONTUARIO_PADRAO: ConfiguracaoProntuario = {
  permiteRetroativo: false,
  toleranciaRetroativoHoras: null,
  assinaturaExigida: 'eletronica',
  exigeEvolucaoMedica: false,
  exigeEvolucaoEnfermagem: false,
};

export function validarConfiguracaoSetor(c: ConfiguracaoSetor): ErroRegra[] {
  const erros: ErroRegra[] = [];
  if (!TIPOS_ATENDIMENTO_PRONTUARIO.includes(c.tipoAtendimento))
    erros.push({
      campo: 'tipoAtendimento',
      codigo: 'tipo-invalido',
      mensagem: 'Tipo de atendimento inválido.',
    });
  if (!ASSINATURAS_EXIGIDAS.includes(c.assinaturaExigida))
    erros.push({
      campo: 'assinaturaExigida',
      codigo: 'assinatura-invalida',
      mensagem: 'Assinatura inválida.',
    });
  if (!c.permiteRetroativo && c.toleranciaRetroativoHoras !== null)
    erros.push({
      campo: 'toleranciaRetroativoHoras',
      codigo: 'tolerancia-sem-retroativo',
      mensagem: 'A tolerância só vale com o registro retroativo permitido.',
    });
  const t = c.toleranciaRetroativoHoras;
  if (t !== null && (!Number.isInteger(t) || t < 1 || t > 720))
    erros.push({
      campo: 'toleranciaRetroativoHoras',
      codigo: 'tolerancia-fora',
      mensagem: 'A tolerância vai de 1 a 720 horas.',
    });
  return erros;
}

/**
 * A configuração que vale para o setor e o tipo de atendimento: a do tipo exato, senão a do setor para "todos", senão
 * o padrão do estabelecimento. Configuração inativa não conta. Devolve também de onde veio (para a tela explicar).
 */
export function resolverConfiguracaoProntuario(
  linhas: readonly ConfiguracaoSetor[],
  setor: number | null,
  tipo: TipoAtendimentoProntuario,
  padrao: ConfiguracaoProntuario = CONFIGURACAO_PRONTUARIO_PADRAO,
): { readonly configuracao: ConfiguracaoProntuario; readonly origem: 'setor-tipo' | 'setor' | 'padrao' } {
  const doSetor = linhas.filter((l) => l.ativo && setor !== null && l.setor === setor);
  const exata = tipo !== 'todos' ? doSetor.find((l) => l.tipoAtendimento === tipo) : undefined;
  if (exata) return { configuracao: exata, origem: 'setor-tipo' };
  const geral = doSetor.find((l) => l.tipoAtendimento === 'todos');
  if (geral) return { configuracao: geral, origem: 'setor' };
  return { configuracao: padrao, origem: 'padrao' };
}

/** O registro com data clínica anterior a agora cabe na regra do setor? (horas cheias de atraso contra a tolerância) */
export function avaliarRetroativo(
  c: ConfiguracaoProntuario,
  ocorridoEm: Date,
  agora: Date,
): { readonly permitido: boolean; readonly motivo: string | null } {
  const atrasoMs = agora.getTime() - ocorridoEm.getTime();
  if (atrasoMs <= 15 * 60_000) return { permitido: true, motivo: null };
  if (!c.permiteRetroativo) return { permitido: false, motivo: 'Este setor não aceita registro retroativo.' };
  if (c.toleranciaRetroativoHoras !== null && atrasoMs > c.toleranciaRetroativoHoras * 3_600_000)
    return {
      permitido: false,
      motivo: `O registro passa da tolerância de ${c.toleranciaRetroativoHoras} h do setor.`,
    };
  return { permitido: true, motivo: null };
}

// ── Equipe assistencial ──────────────────────────────────────────────────────────────────────────

export type CategoriaFuncaoEquipe = 'medica' | 'enfermagem' | 'multiprofissional' | 'administrativa';

export interface FuncaoEquipe {
  readonly id: number;
  readonly categoria: CategoriaFuncaoEquipe;
  readonly responsavelPrincipal: boolean;
  readonly ativo: boolean;
}

export interface MembroEquipe {
  readonly id: number;
  readonly profissional: number;
  readonly funcao: number;
  readonly responsavelPrincipal: boolean;
  readonly recebeNotificacao: boolean;
  readonly inicio: string;
  readonly fim: string | null;
}

export interface NovoMembro {
  readonly profissional: number;
  readonly funcao: FuncaoEquipe;
  readonly recebeNotificacao: boolean;
}

export const vigentes = (membros: readonly MembroEquipe[]): MembroEquipe[] =>
  membros.filter((m) => m.fim === null);

/** Inclusão na equipe: função ativa, sem repetir profissional na mesma função e um só responsável principal. */
export function validarInclusaoMembro(atuais: readonly MembroEquipe[], novo: NovoMembro): ErroRegra[] {
  const erros: ErroRegra[] = [];
  const v = vigentes(atuais);
  if (!novo.funcao.ativo)
    erros.push({ campo: 'funcao', codigo: 'funcao-inativa', mensagem: 'A função está inativa.' });
  if (novo.funcao.responsavelPrincipal && novo.funcao.categoria !== 'medica')
    erros.push({
      campo: 'funcao',
      codigo: 'responsavel-nao-medico',
      mensagem: 'O responsável principal tem de ser de função médica.',
    });
  if (v.some((m) => m.profissional === novo.profissional && m.funcao === novo.funcao.id))
    erros.push({
      campo: 'profissional',
      codigo: 'membro-repetido',
      mensagem: 'O profissional já está na equipe com esta função.',
    });
  if (novo.funcao.responsavelPrincipal && v.some((m) => m.responsavelPrincipal))
    erros.push({
      campo: 'funcao',
      codigo: 'responsavel-duplicado',
      mensagem: 'A equipe já tem responsável principal; encerre a participação dele antes.',
    });
  return erros;
}

/** Saída da equipe: membro vigente e motivo (de 3 a 500 caracteres). */
export function validarSaidaMembro(membro: MembroEquipe | undefined, motivo: string): ErroRegra[] {
  if (!membro) return [{ campo: 'membro', codigo: 'membro-inexistente', mensagem: 'Membro não encontrado.' }];
  const erros: ErroRegra[] = [];
  if (membro.fim !== null)
    erros.push({ campo: 'membro', codigo: 'membro-encerrado', mensagem: 'A participação já foi encerrada.' });
  const m = motivo.trim();
  if (m.length < 3 || m.length > 500)
    erros.push({
      campo: 'motivo',
      codigo: 'motivo-invalido',
      mensagem: 'Informe o motivo da saída (3 a 500).',
    });
  return erros;
}

/** Vínculo pela equipe: o profissional está na equipe vigente do paciente. */
export function temVinculoPelaEquipe(membros: readonly MembroEquipe[], profissional: number): boolean {
  return vigentes(membros).some((m) => m.profissional === profissional);
}

/** Quem recebe as pendências do paciente: os vigentes marcados e sempre o responsável principal. */
export function destinatariosDePendencias(membros: readonly MembroEquipe[]): number[] {
  return [
    ...new Set(
      vigentes(membros)
        .filter((m) => m.recebeNotificacao || m.responsavelPrincipal)
        .map((m) => m.profissional),
    ),
  ];
}
