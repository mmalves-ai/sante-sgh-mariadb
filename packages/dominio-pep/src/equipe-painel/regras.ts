// Regras do painel do profissional, da configuração do prontuário por setor e da equipe assistencial (F3.3, linhas
// 03-PEP L90, L91 e L94 da análise). Domínio puro: sem banco nem I/O; a porta própria grava o que estas regras aceitam.
//   - Pacientes acompanhados: o profissional marca e desmarca; desmarcar encerra o período (fim), nunca apaga.
//   - Colunas do painel: só as do catálogo, sem repetição, no mínimo duas; ficam no banco por usuário (troca de
//     computador não perde o painel).
//   - Configuração por setor: a do setor e tipo de atendimento vence a do setor para "todos", que vence o padrão do
//     estabelecimento; a tolerância do retroativo só existe com o retroativo permitido. A gravação do registro clínico
//     confere o retroativo e a assinatura exigida pela configuração que vale (03-PEP L91). A regra é institucional
//     (estabelecimento e setor), nunca preferência do usuário (CFM 1.638/2002 e 1.821/2007, SBIS NGS2).
//   - Equipe assistencial: um único responsável principal vigente por atendimento, e a função de responsável é de
//     categoria médica; o mesmo profissional não entra duas vezes na mesma função ao mesmo tempo; a saída grava o fim
//     e o motivo (histórico nunca apagado). Quem está na equipe vigente tem vínculo com o paciente e recebe pendências
//     quando marcado para recebê-las. Só entra quem tem lotação vigente no estabelecimento, com categoria que
//     combina com a da função (pelo CBO da lotação); a especialidade só em função médica e só uma do profissional.
//   - A equipe vale enquanto o atendimento está aberto: no fim do atendimento ela se encerra (e os membros vigentes
//     saem com o motivo), e o vínculo pela equipe deixa de valer.
import type { CategoriaAssistencial } from '@sgh/contratos';

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

export interface ErroRegraPainel {
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
): ErroRegraPainel[] {
  const erros: ErroRegraPainel[] = [];
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
export function validarColunasPainel(
  colunas: readonly string[],
  catalogo: readonly string[],
): ErroRegraPainel[] {
  const erros: ErroRegraPainel[] = [];
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

/**
 * O padrão do estabelecimento, quando o setor não tem configuração: o registro retroativo é aceito com justificativa
 * (acima da tolerância em minutos do parâmetro `pep.evolucao.toleranciaRetroativoMinutos`, regra do serviço de
 * registro), sem limite em horas; a proibição e o limite em horas são regra do SETOR. A assinatura exigida vem do
 * parâmetro `pep.prontuario.assinaturaExigida` do estabelecimento; sem ele (ou com valor fora da lista), a do código.
 */
export function configuracaoPadraoDoEstabelecimento(
  assinatura: string | null | undefined,
): ConfiguracaoProntuario {
  return {
    ...CONFIGURACAO_PRONTUARIO_PADRAO,
    permiteRetroativo: true,
    toleranciaRetroativoHoras: null,
    assinaturaExigida: ASSINATURAS_EXIGIDAS.includes(assinatura as AssinaturaExigida)
      ? (assinatura as AssinaturaExigida)
      : CONFIGURACAO_PRONTUARIO_PADRAO.assinaturaExigida,
  };
}

/** O tipo do atendimento na configuração do prontuário, a partir do fluxo do atendimento (telessaúde: só "todos"). */
export function tipoProntuarioDoAtendimento(tipoBase: string | null | undefined): TipoAtendimentoProntuario {
  const t = String(tipoBase ?? '');
  return t !== 'todos' && TIPOS_ATENDIMENTO_PRONTUARIO.includes(t as TipoAtendimentoProntuario)
    ? (t as TipoAtendimentoProntuario)
    : 'todos';
}

/**
 * A gravação do registro clínico pela configuração que vale (setor e tipo, setor ou estabelecimento): o horário clínico
 * dentro da regra do retroativo, e a assinatura digital ICP-Brasil exigida só com certificado vigente do autor (a
 * assinatura eletrônica é a da própria sessão autenticada; "nenhuma" não pede nada). Devolve a primeira recusa.
 */
export function conferirRegistroPelaConfiguracao(
  c: ConfiguracaoProntuario,
  x: {
    readonly ocorridoEm: Date;
    readonly agora: Date;
    readonly certificadoIcpVigente: boolean;
    /** A tolerância do estabelecimento (`pep.evolucao.toleranciaRetroativoMinutos`), a mesma do horário do serviço. */
    readonly toleranciaMinutos: number;
  },
): ErroRegraPainel | null {
  const r = avaliarRetroativo(c, x.ocorridoEm, x.agora, x.toleranciaMinutos);
  if (!r.permitido)
    return {
      campo: 'dataHoraClinica',
      codigo: 'retroativo-fora-da-regra',
      mensagem: r.motivo ?? 'O horário clínico está fora da regra do retroativo do setor.',
    };
  if (c.assinaturaExigida === 'digital_icp' && !x.certificadoIcpVigente)
    return {
      campo: 'assinatura',
      codigo: 'assinatura-icp-exigida',
      mensagem:
        'Este setor exige assinatura digital ICP-Brasil: cadastre um certificado vigente antes de finalizar o registro.',
    };
  return null;
}

/**
 * O que a gravação deixa de assinatura, pela configuração que vale: com a digital ICP-Brasil exigida, o registro não se
 * dá por assinado na sessão; nasce com o documento do prontuário aguardando a assinatura ICP do autor (pendência na fila
 * de assinatura, CFM 1.821/2007 e SBIS NGS2). A eletrônica é a da sessão autenticada; "nenhuma" não pede nada.
 */
export function assinaturaNaGravacao(c: ConfiguracaoProntuario): 'pendente-icp' | 'sessao' | 'dispensada' {
  if (c.assinaturaExigida === 'digital_icp') return 'pendente-icp';
  return c.assinaturaExigida === 'eletronica' ? 'sessao' : 'dispensada';
}

/** Padrão do código quando o setor não tem configuração: sem retroativo e assinatura eletrônica. */
export const CONFIGURACAO_PRONTUARIO_PADRAO: ConfiguracaoProntuario = {
  permiteRetroativo: false,
  toleranciaRetroativoHoras: null,
  assinaturaExigida: 'eletronica',
  exigeEvolucaoMedica: false,
  exigeEvolucaoEnfermagem: false,
};

export function validarConfiguracaoSetor(c: ConfiguracaoSetor): ErroRegraPainel[] {
  const erros: ErroRegraPainel[] = [];
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

/**
 * O registro com data clínica anterior a agora cabe na regra do setor? Até a tolerância em minutos do estabelecimento
 * (`pep.evolucao.toleranciaRetroativoMinutos`, 0 a 1440) o registro não é retroativo, com a mesma conta do horário do
 * serviço (minutos arredondados, retroativo acima da tolerância); acima dela, vale a regra do setor (permitido e o
 * limite em horas).
 */
export function avaliarRetroativo(
  c: ConfiguracaoProntuario,
  ocorridoEm: Date,
  agora: Date,
  toleranciaMinutos: number,
): { readonly permitido: boolean; readonly motivo: string | null } {
  const atrasoMs = agora.getTime() - ocorridoEm.getTime();
  const tolerancia = Number.isFinite(toleranciaMinutos) ? Math.min(1440, Math.max(0, toleranciaMinutos)) : 0;
  if (Math.round(atrasoMs / 60_000) <= tolerancia) return { permitido: true, motivo: null };
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
  /** Categorias (pelo CBO) das lotações vigentes do profissional NO estabelecimento; vazia = sem vínculo com ele. */
  readonly categoriasNoEstabelecimento: readonly (CategoriaAssistencial | null)[];
  readonly especialidade: number | null;
  /** Especialidades ativas do cadastro do profissional. */
  readonly especialidadesDoProfissional: readonly number[];
}

const MULTIPROFISSIONAIS: readonly CategoriaAssistencial[] = [
  'fisioterapia',
  'nutricao',
  'psicologia',
  'fonoaudiologia',
  'odontologia',
  'farmacia',
  'servico-social',
];

/** A categoria do profissional combina com a da função? (administrativa aceita qualquer lotação) */
export function categoriaCombinaComFuncao(
  funcao: CategoriaFuncaoEquipe,
  categorias: readonly (CategoriaAssistencial | null)[],
): boolean {
  if (funcao === 'administrativa') return categorias.length > 0;
  if (funcao === 'medica') return categorias.includes('medico');
  if (funcao === 'enfermagem') return categorias.includes('enfermagem');
  return categorias.some((c) => c !== null && MULTIPROFISSIONAIS.includes(c));
}

export const vigentes = (membros: readonly MembroEquipe[]): MembroEquipe[] =>
  membros.filter((m) => m.fim === null);

/** Inclusão na equipe: função ativa, sem repetir profissional na mesma função e um só responsável principal. */
export function validarInclusaoMembro(atuais: readonly MembroEquipe[], novo: NovoMembro): ErroRegraPainel[] {
  const erros: ErroRegraPainel[] = [];
  const v = vigentes(atuais);
  if (!novo.funcao.ativo)
    erros.push({ campo: 'funcao', codigo: 'funcao-inativa', mensagem: 'A função está inativa.' });
  if (novo.categoriasNoEstabelecimento.length === 0)
    erros.push({
      campo: 'profissional',
      codigo: 'profissional-sem-lotacao',
      mensagem: 'O profissional não tem lotação vigente neste estabelecimento.',
    });
  else if (!categoriaCombinaComFuncao(novo.funcao.categoria, novo.categoriasNoEstabelecimento))
    erros.push({
      campo: 'profissional',
      codigo: 'categoria-incompativel',
      mensagem: 'A categoria do profissional não combina com a da função.',
    });
  if (novo.especialidade !== null && novo.funcao.categoria !== 'medica')
    erros.push({
      campo: 'especialidade',
      codigo: 'especialidade-sem-funcao-medica',
      mensagem: 'A especialidade só vale em função médica.',
    });
  else if (novo.especialidade !== null && !novo.especialidadesDoProfissional.includes(novo.especialidade))
    erros.push({
      campo: 'especialidade',
      codigo: 'especialidade-de-outro',
      mensagem: 'A especialidade não está no cadastro do profissional.',
    });
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
export function validarSaidaMembro(membro: MembroEquipe | undefined, motivo: string): ErroRegraPainel[] {
  if (!membro) return [{ campo: 'membro', codigo: 'membro-inexistente', mensagem: 'Membro não encontrado.' }];
  const erros: ErroRegraPainel[] = [];
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

/** O atendimento ainda está aberto (a equipe vale)? Encerrado, cancelado ou com saída gravada: não. */
export function atendimentoAberto(situacao: string, saidaEm: string | Date | null): boolean {
  return saidaEm === null && situacao !== 'encerrado' && situacao !== 'cancelado';
}

/** Encerramento da equipe no fim do atendimento: recusa equipe já encerrada; devolve os membros vigentes a fechar. */
export function planoEncerramentoEquipe(
  situacao: string,
  membros: readonly MembroEquipe[],
): { readonly erros: ErroRegraPainel[]; readonly membrosAEncerrar: number[] } {
  if (situacao === 'encerrada')
    return {
      erros: [{ campo: 'equipe', codigo: 'equipe-encerrada', mensagem: 'A equipe já foi encerrada.' }],
      membrosAEncerrar: [],
    };
  return { erros: [], membrosAEncerrar: vigentes(membros).map((m) => m.id) };
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

// ── Fim do atendimento, equipe padrão e fila de pendências (03-PEP L94, C2-064) ─────────────────────

/** Motivo gravado nos membros fechados pelo fim do atendimento (alta ou encerramento); a reabertura o reconhece. */
export const MOTIVO_FIM_DO_ATENDIMENTO = 'Fim do atendimento';

/**
 * Cancelamento da alta: a equipe volta a valer. Quem saiu JUNTO com o fim do atendimento (mesmo instante e motivo do
 * encerramento automático) volta como participação NOVA; a antiga fica no histórico. Quem saiu antes, por outro
 * motivo, não volta.
 */
export function planoReaberturaEquipe(
  situacao: string,
  fimEquipe: string | null,
  membros: readonly (MembroEquipe & { readonly motivoSaida: string | null })[],
): { readonly reabrir: boolean; readonly membrosAVoltar: number[] } {
  if (situacao !== 'encerrada' || fimEquipe === null) return { reabrir: false, membrosAVoltar: [] };
  const fim = fimEquipe.slice(0, 19);
  const voltam = membros.filter(
    (m) => m.fim !== null && m.fim.slice(0, 19) === fim && m.motivoSaida === MOTIVO_FIM_DO_ATENDIMENTO,
  );
  // Nunca dois responsáveis: se um responsável voltaria junto com outro já vigente, o vigente prevalece.
  const temResponsavel = vigentes(membros).some((m) => m.responsavelPrincipal);
  return {
    reabrir: true,
    membrosAVoltar: voltam.filter((m) => !(m.responsavelPrincipal && temResponsavel)).map((m) => m.id),
  };
}

export interface MembroPadrao {
  readonly sequencia: number;
  readonly funcao: number;
  readonly profissional: number | null;
  readonly responsavel: boolean;
}

export interface EquipePadraoNova {
  readonly nome: string;
  readonly setor: number | null;
  readonly especialidade: number | null;
  readonly membros: readonly {
    readonly funcao: FuncaoEquipe;
    readonly profissional: number | null;
    readonly responsavel: boolean;
  }[];
}

/** Equipe padrão do setor ou serviço: nome, alvo (setor ou especialidade), membros sem repetir e um só responsável. */
export function validarEquipePadrao(x: EquipePadraoNova): ErroRegraPainel[] {
  const erros: ErroRegraPainel[] = [];
  const nome = x.nome.trim();
  if (nome.length < 3 || nome.length > 100)
    erros.push({
      campo: 'nome',
      codigo: 'nome-invalido',
      mensagem: 'O nome da equipe padrão vai de 3 a 100 caracteres.',
    });
  if (x.setor === null && x.especialidade === null)
    erros.push({
      campo: 'setor',
      codigo: 'padrao-sem-alvo',
      mensagem: 'Informe o setor ou a especialidade da equipe padrão.',
    });
  if (!x.membros.length)
    erros.push({
      campo: 'membros',
      codigo: 'padrao-vazio',
      mensagem: 'A equipe padrão precisa de pelo menos um membro.',
    });
  const chaves = x.membros
    .filter((m) => m.profissional !== null)
    .map((m) => `${m.profissional}:${m.funcao.id}`);
  if (new Set(chaves).size !== chaves.length)
    erros.push({
      campo: 'membros',
      codigo: 'membro-repetido',
      mensagem: 'O mesmo profissional aparece duas vezes na mesma função.',
    });
  const responsaveis = x.membros.filter((m) => m.responsavel);
  if (responsaveis.length > 1)
    erros.push({
      campo: 'membros',
      codigo: 'responsavel-duplicado',
      mensagem: 'A equipe padrão tem um só responsável.',
    });
  if (responsaveis.some((m) => m.funcao.categoria !== 'medica'))
    erros.push({
      campo: 'membros',
      codigo: 'responsavel-nao-medico',
      mensagem: 'O responsável tem de ser de função médica.',
    });
  if (x.membros.some((m) => !m.funcao.ativo))
    erros.push({
      campo: 'membros',
      codigo: 'funcao-inativa',
      mensagem: 'Há função inativa na equipe padrão.',
    });
  return erros;
}

export interface EquipePadraoResumo {
  readonly id: number;
  readonly setor: number | null;
  readonly especialidade: number | null;
  readonly sugerir: boolean;
  readonly ativo: boolean;
}

/** As equipes padrão que servem ao atendimento: ativas; primeiro as do setor, depois as da especialidade. */
export function padroesDoAtendimento<T extends EquipePadraoResumo>(
  padroes: readonly T[],
  setor: number | null,
  especialidade: number | null,
): T[] {
  const ativos = padroes.filter((p) => p.ativo);
  const doSetor = ativos.filter((p) => setor !== null && p.setor === setor);
  const daEsp = ativos.filter(
    (p) =>
      !doSetor.includes(p) && especialidade !== null && p.especialidade === especialidade && p.setor === null,
  );
  return [...doSetor, ...daEsp];
}

/**
 * Aplicar a equipe padrão ao atendimento: inclui os membros nomeados que ainda não estão (mesmo profissional e
 * função), um só responsável; a função reservada sem profissional e a repetida ficam de fora com o motivo.
 */
export function planoEquipePadrao(
  atuais: readonly MembroEquipe[],
  modelo: readonly MembroPadrao[],
): {
  readonly incluir: MembroPadrao[];
  readonly ignorados: { readonly sequencia: number; readonly codigo: string }[];
} {
  const v = vigentes(atuais);
  let temResponsavel = v.some((m) => m.responsavelPrincipal);
  const incluir: MembroPadrao[] = [];
  const ignorados: { sequencia: number; codigo: string }[] = [];
  for (const m of [...modelo].sort((a, b) => a.sequencia - b.sequencia)) {
    if (m.profissional === null)
      ignorados.push({ sequencia: m.sequencia, codigo: 'funcao-sem-profissional' });
    else if (v.some((x) => x.profissional === m.profissional && x.funcao === m.funcao))
      ignorados.push({ sequencia: m.sequencia, codigo: 'ja-na-equipe' });
    else if (m.responsavel && temResponsavel)
      ignorados.push({ sequencia: m.sequencia, codigo: 'responsavel-duplicado' });
    else {
      if (m.responsavel) temResponsavel = true;
      incluir.push(m);
    }
  }
  return { incluir, ignorados };
}

/**
 * A fila de pendências pela equipe: dos atendimentos abertos, aqueles em que o profissional é destinatário (marcado
 * para receber ou responsável principal), com o papel dele.
 */
export function filaDePendenciasDaEquipe<T extends { readonly membros: readonly MembroEquipe[] }>(
  equipes: readonly T[],
  profissionais: readonly number[],
): (T & { readonly responsavel: boolean })[] {
  return equipes
    .filter((e) => destinatariosDePendencias(e.membros).some((p) => profissionais.includes(p)))
    .map((e) => ({
      ...e,
      responsavel: vigentes(e.membros).some(
        (m) => m.responsavelPrincipal && profissionais.includes(m.profissional),
      ),
    }));
}
