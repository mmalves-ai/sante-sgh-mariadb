// Cadastro complementar do prestador da rede credenciada (08-SGO L101, C2-118; F7). Regras puras, sem banco:
// - o local de atendimento: CEP de 8 dígitos, logradouro e município obrigatórios, CNES de 7 dígitos quando houver,
//   coordenadas dentro da faixa, e-mail com formato; um só local principal por prestador (a porta passa o anterior a
//   não principal); o local sai desligado com data e motivo, nunca apagado;
// - a especialidade atendida: ao menos um regime (ambulatório, internação, urgência, hospital-dia), o local do próprio
//   prestador e ativo (ou todos os locais), sem repetir a mesma especialidade no mesmo local; o profissional (pessoa
//   física) só aparece no guia como especialista com o registro de qualificação de especialista (RQE: Resolução CFM
//   2.336/2023, publicidade médica);
// - a qualificação divulgada (programa de qualificação da rede, RN ANS 510/2022): o atributo vale para o tipo de
//   prestador (pessoa física, pessoa jurídica, hospital) e está vigente no início; o fim nunca antes do início;
// - a suspensão temporária: motivo do domínio, prestador credenciado e sem outra suspensão aberta no mesmo alcance,
//   reativação nunca antes do início; a situação (programada, ativa, encerrada) sai das datas;
// - o registro do descredenciamento: agendado (data futura) ou efetivado (hoje ou antes).

export const MOTIVOS_SUSPENSAO_PRESTADOR = [
  'documentacao_vencida',
  'auditoria',
  'qualidade',
  'pedido_prestador',
  'decisao_administrativa',
  'decisao_judicial',
  'outro',
] as const;
export type MotivoSuspensaoPrestador = (typeof MOTIVOS_SUSPENSAO_PRESTADOR)[number];

export interface ProblemaCadastroRede {
  readonly codigo: string;
  readonly campo: string;
  readonly detalhe: string;
}
const prob = (codigo: string, campo: string, detalhe: string): ProblemaCadastroRede => ({
  codigo,
  campo,
  detalhe,
});

const so = (v: string | null | undefined): string => (v ?? '').trim();

// ---- local de atendimento ----
export interface LocalAtendimentoEntrada {
  readonly nome: string | null;
  readonly cnes: string | null;
  readonly cep: string;
  readonly logradouro: string;
  readonly numero: string | null;
  readonly complemento: string | null;
  readonly bairro: string | null;
  readonly municipioIbge: number;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly telefone: string | null;
  readonly email: string | null;
  readonly acessivelCadeirante: boolean;
  readonly estacionamento: boolean;
  readonly principal: boolean;
  readonly divulga: boolean;
}

/** Só os dígitos do CEP. */
export const cepNormalizado = (v: string): string => v.replace(/\D/g, '');

export function problemasDoLocal(l: LocalAtendimentoEntrada): ProblemaCadastroRede[] {
  const r: ProblemaCadastroRede[] = [];
  if (!/^\d{8}$/.test(cepNormalizado(l.cep)))
    r.push(prob('cep-invalido', 'cep', 'Informe o CEP com 8 dígitos.'));
  if (!so(l.logradouro))
    r.push(prob('logradouro-obrigatorio', 'logradouro', 'Informe o logradouro do local.'));
  if (!Number.isInteger(l.municipioIbge) || l.municipioIbge < 1_000_000 || l.municipioIbge > 9_999_999)
    r.push(
      prob('municipio-invalido', 'municipioIbge', 'Informe o município pelo código do IBGE (7 dígitos).'),
    );
  const cnes = so(l.cnes);
  if (cnes && !/^\d{7}$/.test(cnes)) r.push(prob('cnes-invalido', 'cnes', 'O CNES tem 7 dígitos.'));
  if (l.latitude !== null && (l.latitude < -90 || l.latitude > 90))
    r.push(prob('latitude-invalida', 'latitude', 'A latitude vai de -90 a 90.'));
  if (l.longitude !== null && (l.longitude < -180 || l.longitude > 180))
    r.push(prob('longitude-invalida', 'longitude', 'A longitude vai de -180 a 180.'));
  if ((l.latitude === null) !== (l.longitude === null))
    r.push(prob('coordenada-incompleta', 'latitude', 'Informe a latitude e a longitude juntas.'));
  const email = so(l.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    r.push(prob('email-invalido', 'email', 'O e-mail do local não tem formato válido.'));
  return r;
}

export interface DesligamentoLocal {
  readonly desligadoEm: string;
  readonly motivo: string;
}
export function problemasDoDesligamento(
  local: { readonly ativo: boolean; readonly especialidadesAtivas: number },
  d: DesligamentoLocal,
  hoje: string,
): ProblemaCadastroRede[] {
  const r: ProblemaCadastroRede[] = [];
  if (!local.ativo) r.push(prob('local-ja-desligado', 'local', 'O local já está desligado.'));
  if (so(d.motivo).length < 10)
    r.push(prob('motivo-curto', 'motivo', 'Descreva o motivo (10 caracteres ou mais).'));
  if (d.desligadoEm < hoje)
    r.push(prob('desligamento-no-passado', 'desligadoEm', 'O desligamento vale de hoje em diante.'));
  if (local.especialidadesAtivas > 0)
    r.push(
      prob(
        'local-com-especialidades',
        'local',
        'Encerre antes as especialidades atendidas só neste local (o beneficiário deixaria de achá-las).',
      ),
    );
  return r;
}

// ---- especialidade atendida ----
export interface EspecialidadeEntrada {
  readonly especialidade: number;
  readonly local: number | null;
  readonly ambulatorio: boolean;
  readonly internacao: boolean;
  readonly urgencia: boolean;
  readonly hospitalDia: boolean;
  readonly adulto: boolean;
  readonly pediatrico: boolean;
  readonly rqe: string | null;
  readonly principal: boolean;
  readonly divulga: boolean;
}
export interface ContextoEspecialidade {
  /** 'F' pessoa física; 'J' pessoa jurídica. */
  readonly pessoa: 'F' | 'J';
  readonly locaisAtivos: ReadonlySet<number>;
  /** As já ativas do prestador, como `especialidade:local` (local vazio: todos). */
  readonly jaAtivas: ReadonlySet<string>;
}
export const chaveEspecialidade = (especialidade: number, local: number | null): string =>
  `${especialidade}:${local ?? ''}`;

export function problemasDaEspecialidade(
  e: EspecialidadeEntrada,
  c: ContextoEspecialidade,
): ProblemaCadastroRede[] {
  const r: ProblemaCadastroRede[] = [];
  if (!e.ambulatorio && !e.internacao && !e.urgencia && !e.hospitalDia)
    r.push(
      prob(
        'regime-obrigatorio',
        'ambulatorio',
        'Marque ao menos um regime: ambulatório, internação, urgência ou hospital-dia.',
      ),
    );
  if (!e.adulto && !e.pediatrico)
    r.push(
      prob('publico-obrigatorio', 'adulto', 'Marque o público atendido: adulto, pediátrico ou os dois.'),
    );
  if (e.local !== null && !c.locaisAtivos.has(e.local))
    r.push(prob('local-invalido', 'local', 'O local não é um local ativo deste prestador.'));
  if (c.jaAtivas.has(chaveEspecialidade(e.especialidade, e.local)))
    r.push(
      prob(
        'especialidade-repetida',
        'especialidade',
        'Esta especialidade já está ativa para o prestador neste local.',
      ),
    );
  const rqe = so(e.rqe);
  if (rqe && !/^[0-9A-Za-z./-]{1,30}$/.test(rqe))
    r.push(prob('rqe-invalido', 'rqe', 'O RQE tem só números, letras, ponto, barra ou hífen (até 30).'));
  if (c.pessoa === 'F' && e.divulga && !rqe)
    r.push(
      prob(
        'rqe-obrigatorio-para-divulgar',
        'rqe',
        'Para divulgar o profissional como especialista no guia, informe o RQE.',
      ),
    );
  return r;
}

// ---- qualificação divulgada ----
export interface AtributoQualificacao {
  readonly id: number;
  readonly pessoaFisica: boolean;
  readonly pessoaJuridica: boolean;
  readonly hospital: boolean;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}
export interface QualificacaoEntrada {
  readonly atributo: number;
  readonly nivel: string | null;
  readonly titulo: string | null;
  readonly divulga: boolean;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}
export function problemasDaQualificacao(
  q: QualificacaoEntrada,
  atributo: AtributoQualificacao | null,
  prestador: { readonly pessoa: 'F' | 'J'; readonly hospitalar: boolean },
  jaVigentes: ReadonlySet<number>,
): ProblemaCadastroRede[] {
  const r: ProblemaCadastroRede[] = [];
  if (!atributo) {
    r.push(prob('atributo-inexistente', 'atributo', 'O atributo de qualificação não está no catálogo.'));
    return r;
  }
  const aplica =
    (prestador.pessoa === 'F' && atributo.pessoaFisica) ||
    (prestador.pessoa === 'J' && (atributo.pessoaJuridica || (prestador.hospitalar && atributo.hospital)));
  if (!aplica)
    r.push(prob('atributo-nao-aplica', 'atributo', 'Este atributo não vale para este tipo de prestador.'));
  if (
    q.vigenciaInicio < atributo.vigenciaInicio ||
    (atributo.vigenciaFim !== null && q.vigenciaInicio > atributo.vigenciaFim)
  )
    r.push(
      prob(
        'atributo-fora-da-vigencia',
        'vigenciaInicio',
        'O atributo não estava vigente no início informado.',
      ),
    );
  if (q.vigenciaFim !== null && q.vigenciaFim < q.vigenciaInicio)
    r.push(prob('vigencia-invertida', 'vigenciaFim', 'O fim da validade não pode ser antes do início.'));
  if (jaVigentes.has(atributo.id))
    r.push(
      prob(
        'qualificacao-repetida',
        'atributo',
        'O prestador já tem este atributo vigente: encerre o anterior antes de registrar outro.',
      ),
    );
  return r;
}

/** A qualificação divulgada hoje: marcada para divulgar e dentro da validade. */
export function qualificacaoVigente(
  q: { readonly divulga: boolean; readonly vigenciaInicio: string; readonly vigenciaFim: string | null },
  hoje: string,
): boolean {
  return q.divulga && q.vigenciaInicio <= hoje && (q.vigenciaFim === null || q.vigenciaFim >= hoje);
}

// ---- suspensão ----
export type SituacaoSuspensao = 'programada' | 'ativa' | 'encerrada';
export function situacaoDaSuspensao(
  desde: string,
  reativadoEm: string | null,
  hoje: string,
): SituacaoSuspensao {
  if (desde > hoje) return 'programada';
  if (reativadoEm !== null && reativadoEm <= hoje) return 'encerrada';
  return 'ativa';
}

export interface SuspensaoEntrada {
  readonly motivo: string;
  readonly local: number | null;
  readonly desde: string;
  readonly reativacaoPrevista: string | null;
  readonly observacao: string | null;
}
export function problemasDaSuspensao(
  s: SuspensaoEntrada,
  c: {
    readonly credenciado: boolean;
    readonly locaisAtivos: ReadonlySet<number>;
    /** Os alcances com suspensão aberta (null: o prestador inteiro). */
    readonly abertas: readonly (number | null)[];
  },
  hoje: string,
): ProblemaCadastroRede[] {
  const r: ProblemaCadastroRede[] = [];
  if (!(MOTIVOS_SUSPENSAO_PRESTADOR as readonly string[]).includes(s.motivo))
    r.push(prob('motivo-invalido', 'motivo', 'Escolha o motivo da suspensão.'));
  if (!c.credenciado)
    r.push(prob('prestador-fora-da-rede', 'prestador', 'Só o prestador credenciado pode ser suspenso.'));
  if (s.local !== null && !c.locaisAtivos.has(s.local))
    r.push(prob('local-invalido', 'local', 'O local não é um local ativo deste prestador.'));
  if (s.desde < hoje) r.push(prob('suspensao-no-passado', 'desde', 'A suspensão vale de hoje em diante.'));
  if (s.reativacaoPrevista !== null && s.reativacaoPrevista < s.desde)
    r.push(
      prob('reativacao-antes-do-inicio', 'reativacaoPrevista', 'A reativação não pode ser antes do início.'),
    );
  if (c.abertas.includes(null) || (s.local === null ? c.abertas.length > 0 : c.abertas.includes(s.local)))
    r.push(
      prob(
        'suspensao-aberta',
        'local',
        'Já existe suspensão aberta que alcança este local: reative-a antes de abrir outra.',
      ),
    );
  if (s.motivo === 'outro' && so(s.observacao).length < 10)
    r.push(
      prob(
        'observacao-obrigatoria',
        'observacao',
        'No motivo "outro", descreva a causa (10 caracteres ou mais).',
      ),
    );
  return r;
}

export function problemasDaReativacaoPrestador(
  suspensao: { readonly desde: string; readonly situacao: SituacaoSuspensao | 'cancelada' },
  reativadoEm: string,
  hoje: string,
): ProblemaCadastroRede[] {
  const r: ProblemaCadastroRede[] = [];
  if (suspensao.situacao === 'encerrada' || suspensao.situacao === 'cancelada')
    r.push(prob('suspensao-encerrada', 'suspensao', 'A suspensão já foi encerrada.'));
  // A programada que ainda não começou é cancelada (a porta grava 'cancelada'); a data não precisa passar do início.
  if (suspensao.situacao !== 'programada' && reativadoEm < suspensao.desde)
    r.push(prob('reativacao-antes-do-inicio', 'reativadoEm', 'A reativação não pode ser antes do início.'));
  if (reativadoEm < hoje)
    r.push(prob('reativacao-no-passado', 'reativadoEm', 'A reativação vale de hoje em diante.'));
  return r;
}

/** A situação do registro do descredenciamento pela data efetiva. */
export function situacaoDoDescredenciamento(efetivoEm: string, hoje: string): 'agendado' | 'efetivado' {
  return efetivoEm > hoje ? 'agendado' : 'efetivado';
}

// ---- suspensão vigente (vale na autorização e na conta) ----
/** Um período de suspensão do prestador (local null: o prestador inteiro); reativadoEm é o primeiro dia de volta. */
export interface PeriodoSuspensao {
  readonly local: number | null;
  readonly desde: string;
  readonly reativadoEm: string | null;
}
/**
 * A suspensão que alcança o prestador no dia: a do prestador inteiro e, com o local informado, a desse local. A
 * cancelada não entra (quem lê já a deixa de fora); a reativada vale até a véspera da reativação.
 */
export function suspensaoNaData(
  suspensoes: readonly PeriodoSuspensao[],
  dia: string,
  local: number | null = null,
): PeriodoSuspensao | null {
  return (
    suspensoes.find(
      (s) =>
        (s.local === null || (local !== null && s.local === local)) &&
        s.desde <= dia &&
        (s.reativadoEm === null || s.reativadoEm > dia),
    ) ?? null
  );
}

// ---- equivalência do substituto no descredenciamento (Lei 9.656 art. 17 §1; RN 365) ----
/** O que o prestador oferece aos beneficiários: as especialidades atendidas e os municípios onde atende. */
export interface PerfilAtendimentoRede {
  readonly especialidades: ReadonlySet<number>;
  /** Os municípios dos locais ativos; sem local cadastrado, o município do cadastro do prestador. */
  readonly municipios: ReadonlySet<number>;
}
export interface SubstitutoParaConferir extends PerfilAtendimentoRede {
  readonly credenciado: boolean;
  readonly suspenso: boolean;
  /** Tem locais cadastrados, mas nenhum ativo. */
  readonly semLocalAtivo: boolean;
}
/** O substituto equivalente: credenciado, sem suspensão, com local ativo, as especialidades e os municípios do saído. */
export function problemasDoSubstituto(
  saido: PerfilAtendimentoRede,
  s: SubstitutoParaConferir,
): ProblemaCadastroRede[] {
  if (!s.credenciado)
    return [prob('substituto-nao-credenciado', 'substituto', 'O substituto não está credenciado na rede.')];
  const r: ProblemaCadastroRede[] = [];
  if (s.suspenso) r.push(prob('substituto-suspenso', 'substituto', 'O substituto está suspenso na rede.'));
  if (s.semLocalAtivo)
    r.push(
      prob('substituto-sem-local-ativo', 'substituto', 'O substituto não tem local de atendimento ativo.'),
    );
  const faltam = [...saido.especialidades].filter((e) => !s.especialidades.has(e));
  if (faltam.length)
    r.push(
      prob(
        'substituto-sem-especialidade',
        'substituto',
        `O substituto não atende ${faltam.length} especialidade(s) do prestador que sai.`,
      ),
    );
  const fora = [...saido.municipios].filter((m) => !s.municipios.has(m));
  if (fora.length)
    r.push(
      prob(
        'substituto-fora-do-municipio',
        'substituto',
        `O substituto não atende em ${fora.length} município(s) onde o prestador que sai atende.`,
      ),
    );
  return r;
}
