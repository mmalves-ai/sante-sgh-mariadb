// Destino do corpo após o óbito (C1-112, 09-AREA linha 74): funerária, cartório de registro civil e liberação do corpo.
// Regras puras, sem banco:
//   - o cadastro da funerária do estabelecimento: nome, ao menos um telefone (o do plantão serve), e-mail com formato,
//     telefones só com dígitos (DDD + número, 10 ou 11 dígitos); nada se apaga: a funerária sai de uso;
//   - a escolha da funerária e do cartório na declaração de óbito: só em declaração não cancelada, e só funerária e
//     cartório em uso (o que saiu de uso continua nas declarações antigas, mas não entra em nenhuma nova escolha);
//   - a guarda e a liberação do corpo: em guarda → liberado (documentos conferidos, quem retira identificado: a
//     funerária ou a pessoa com CPF válido ou documento) → retirado (instante da retirada, nunca antes do óbito nem da
//     liberação); em guarda → encaminhado ao serviço de verificação de óbito ou ao instituto médico-legal; em guarda ou
//     liberado → cancelado, com motivo. O corpo só é liberado à família ou à funerária com a declaração de óbito emitida
//     e entregue (Lei 6.015/1973, art. 77: o sepultamento depende do registro do óbito com a declaração); sem ela, o
//     caminho é o encaminhamento ao serviço de verificação ou ao instituto médico-legal;
//   - a guarda é uma por atendimento e segue a declaração vigente (a não cancelada mais recente): se a declaração for
//     cancelada e outra emitida, a liberação usa a nova; a guarda cancelada (por engano ou porque o corpo voltou) é
//     reaberta, nunca apagada nem duplicada, e o óbito volta a ficar pendente de guarda.
import { cpfValido, somenteDigitos } from '@sgh/contratos';

export const SITUACOES_LIBERACAO_CORPO = [
  'em_guarda',
  'liberado',
  'retirado',
  'encaminhado_iml',
  'cancelado',
] as const;
export type SituacaoLiberacaoCorpo = (typeof SITUACOES_LIBERACAO_CORPO)[number];
export const ACOES_LIBERACAO_CORPO = ['liberar', 'retirar', 'encaminhar_iml', 'cancelar'] as const;
export type AcaoLiberacaoCorpo = (typeof ACOES_LIBERACAO_CORPO)[number];

export const MIN_MOTIVO_CANCELAMENTO_LIBERACAO = 10;
const FOLGA_MS = 5 * 60_000;

export interface ProblemaDestinoCorpo {
  readonly campo: string;
  readonly mensagem: string;
}
export type ResultadoDestinoCorpo<T> =
  ({ readonly ok: true } & T) | { readonly ok: false; readonly problemas: readonly ProblemaDestinoCorpo[] };

// ── Funerária ──

export interface EntradaFuneraria {
  readonly nome: string;
  readonly telefone?: string | null;
  readonly telefonePlantao?: string | null;
  readonly email?: string | null;
  readonly documentosExigidos?: string | null;
  readonly observacao?: string | null;
}
export interface FunerariaValidada {
  readonly nome: string;
  readonly telefone: string | null;
  readonly telefonePlantao: string | null;
  readonly email: string | null;
  readonly documentosExigidos: string | null;
  readonly observacao: string | null;
}

const vazioANulo = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t ? t : null;
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function telefone(v: string | null | undefined, campo: string, p: ProblemaDestinoCorpo[]): string | null {
  const t = vazioANulo(v);
  if (t === null) return null;
  const d = somenteDigitos(t);
  if (d.length < 10 || d.length > 11) {
    p.push({ campo, mensagem: 'Telefone com DDD: 10 ou 11 dígitos.' });
    return null;
  }
  return d;
}

/** Confere e normaliza a funerária antes de gravar (telefones só com dígitos, textos aparados). */
export function validarFuneraria(e: EntradaFuneraria): ResultadoDestinoCorpo<{ valor: FunerariaValidada }> {
  const p: ProblemaDestinoCorpo[] = [];
  const nome = (e.nome ?? '').trim().replace(/\s+/g, ' ');
  if (nome.length < 3 || nome.length > 150)
    p.push({ campo: 'nome', mensagem: 'O nome da funerária tem de 3 a 150 caracteres.' });
  const tel = telefone(e.telefone, 'telefone', p);
  const plantao = telefone(e.telefonePlantao, 'telefonePlantao', p);
  if (!p.some((x) => x.campo.startsWith('telefone')) && tel === null && plantao === null)
    p.push({ campo: 'telefone', mensagem: 'Informe ao menos um telefone (o do plantão serve).' });
  const email = vazioANulo(e.email);
  if (email !== null && (email.length > 254 || !EMAIL.test(email)))
    p.push({ campo: 'email', mensagem: 'E-mail inválido.' });
  const documentosExigidos = vazioANulo(e.documentosExigidos);
  if (documentosExigidos !== null && documentosExigidos.length > 1000)
    p.push({ campo: 'documentosExigidos', mensagem: 'Os documentos exigidos têm até 1000 caracteres.' });
  const observacao = vazioANulo(e.observacao);
  if (observacao !== null && observacao.length > 1000)
    p.push({ campo: 'observacao', mensagem: 'A observação tem até 1000 caracteres.' });
  if (p.length) return { ok: false, problemas: p };
  return {
    ok: true,
    valor: { nome, telefone: tel, telefonePlantao: plantao, email, documentosExigidos, observacao },
  };
}

// ── Destino na declaração de óbito ──

export interface EscolhaDestinoDeclaracao {
  readonly situacaoDeclaracao: 'rascunho' | 'emitida' | 'cancelada';
  /** Funerária escolhida (null: nenhuma ou retirada da escolha). */
  readonly funeraria: { readonly ativo: boolean } | null;
  readonly funerariaMudou: boolean;
  readonly cartorio: { readonly ativo: boolean } | null;
  readonly cartorioMudou: boolean;
}

/** A funerária e o cartório da declaração: declaração não cancelada; o que entra de novo tem de estar em uso. */
export function decidirDestinoDeclaracao(e: EscolhaDestinoDeclaracao): ResultadoDestinoCorpo<object> {
  const p: ProblemaDestinoCorpo[] = [];
  if (e.situacaoDeclaracao === 'cancelada')
    p.push({ campo: 'declaracao', mensagem: 'A declaração de óbito está cancelada.' });
  if (e.funerariaMudou && e.funeraria && !e.funeraria.ativo)
    p.push({ campo: 'funeraria', mensagem: 'A funerária escolhida está fora de uso.' });
  if (e.cartorioMudou && e.cartorio && !e.cartorio.ativo)
    p.push({ campo: 'cartorio', mensagem: 'O cartório escolhido está fora de uso.' });
  return p.length ? { ok: false, problemas: p } : { ok: true };
}

// ── Guarda e liberação do corpo ──

export interface EntradaGuardaCorpo {
  readonly obitoEm: Date;
  readonly entradaNecroterioEm: Date | null;
  readonly agora: Date;
  /** Situação da guarda que o atendimento já tem (null: nenhuma). */
  readonly guardaDoAtendimento: SituacaoLiberacaoCorpo | null;
}

/**
 * Abre a guarda do corpo: uma por atendimento; a cancelada é reaberta (`reabrir`), qualquer outra recusa; a entrada no
 * necrotério nunca antes do óbito nem no futuro.
 */
export function conferirAberturaGuarda(e: EntradaGuardaCorpo): ResultadoDestinoCorpo<{ reabrir: boolean }> {
  const p: ProblemaDestinoCorpo[] = [];
  if (e.guardaDoAtendimento !== null && e.guardaDoAtendimento !== 'cancelado')
    p.push({ campo: 'atendimento', mensagem: 'O corpo deste atendimento já tem guarda registrada.' });
  if (e.entradaNecroterioEm) {
    if (e.entradaNecroterioEm.getTime() < e.obitoEm.getTime())
      p.push({
        campo: 'entradaNecroterio',
        mensagem: 'A entrada no necrotério não pode ser antes do óbito.',
      });
    if (e.entradaNecroterioEm.getTime() > e.agora.getTime() + FOLGA_MS)
      p.push({ campo: 'entradaNecroterio', mensagem: 'A entrada no necrotério não pode ser no futuro.' });
  }
  return p.length
    ? { ok: false, problemas: p }
    : { ok: true, reabrir: e.guardaDoAtendimento === 'cancelado' };
}

/**
 * A declaração de óbito que vale para o atendimento: a não cancelada mais recente (maior id). É a que a guarda segue e a
 * que decide a liberação; null quando todas estão canceladas.
 */
export function declaracaoVigente<T extends { readonly id: number; readonly situacao: string }>(
  declaracoes: readonly T[],
): T | null {
  let r: T | null = null;
  for (const d of declaracoes) if (d.situacao !== 'cancelada' && (r === null || d.id > r.id)) r = d;
  return r;
}

export interface DadosAcaoLiberacao {
  readonly agora: Date;
  readonly obitoEm: Date;
  readonly liberadoEm?: Date | null;
  /** Declaração de óbito ligada: situação (null: sem declaração). */
  readonly declaracao: 'rascunho' | 'emitida' | 'cancelada' | null;
  readonly funeraria?: { readonly ativo: boolean } | null;
  readonly retiranteNome?: string | null;
  readonly retiranteCpf?: string | null;
  readonly retiranteDocumento?: string | null;
  readonly documentosConferidos?: boolean;
  readonly declaracaoEntregue?: boolean;
  readonly retiradaEm?: Date | null;
  readonly motivo?: string | null;
}

const DE: Record<AcaoLiberacaoCorpo, readonly SituacaoLiberacaoCorpo[]> = {
  liberar: ['em_guarda'],
  retirar: ['liberado'],
  encaminhar_iml: ['em_guarda'],
  cancelar: ['em_guarda', 'liberado'],
};
const PARA: Record<AcaoLiberacaoCorpo, SituacaoLiberacaoCorpo> = {
  liberar: 'liberado',
  retirar: 'retirado',
  encaminhar_iml: 'encaminhado_iml',
  cancelar: 'cancelado',
};

/** Decide a passagem da guarda do corpo; devolve a situação nova e o CPF normalizado de quem retira. */
export function decidirAcaoLiberacao(
  atual: SituacaoLiberacaoCorpo,
  acao: AcaoLiberacaoCorpo,
  d: DadosAcaoLiberacao,
): ResultadoDestinoCorpo<{ nova: SituacaoLiberacaoCorpo; retiranteCpf: string | null }> {
  if (!DE[acao].includes(atual))
    return {
      ok: false,
      problemas: [{ campo: 'situacao', mensagem: `A guarda na situação "${atual}" não aceita "${acao}".` }],
    };
  const p: ProblemaDestinoCorpo[] = [];
  let cpf: string | null = null;
  if (acao === 'liberar') {
    if (d.declaracao !== 'emitida')
      p.push({
        campo: 'declaracao',
        mensagem:
          'O corpo só é liberado com a declaração de óbito emitida; sem ela, encaminhe ao serviço de verificação ou ao instituto médico-legal.',
      });
    else if (!d.declaracaoEntregue)
      p.push({
        campo: 'declaracaoEntregue',
        mensagem: 'Registre a entrega da declaração de óbito a quem retira.',
      });
    if (!d.documentosConferidos)
      p.push({ campo: 'documentosConferidos', mensagem: 'Confira os documentos de quem retira.' });
    if (d.funeraria && !d.funeraria.ativo)
      p.push({ campo: 'funeraria', mensagem: 'A funerária escolhida está fora de uso.' });
    const nome = vazioANulo(d.retiranteNome);
    const doc = vazioANulo(d.retiranteDocumento);
    const cpfInf = vazioANulo(d.retiranteCpf);
    if (cpfInf !== null) {
      if (!cpfValido(cpfInf)) p.push({ campo: 'retiranteCpf', mensagem: 'CPF de quem retira inválido.' });
      else cpf = somenteDigitos(cpfInf);
    }
    if (nome === null) p.push({ campo: 'retiranteNome', mensagem: 'Informe o nome de quem retira o corpo.' });
    else if (cpfInf === null && doc === null)
      p.push({ campo: 'retiranteDocumento', mensagem: 'Informe o CPF ou outro documento de quem retira.' });
  }
  if (acao === 'retirar') {
    const r = d.retiradaEm ?? null;
    if (!r) p.push({ campo: 'retiradaEm', mensagem: 'Informe o instante da retirada.' });
    else {
      if (r.getTime() < d.obitoEm.getTime() || (d.liberadoEm && r.getTime() < d.liberadoEm.getTime()))
        p.push({ campo: 'retiradaEm', mensagem: 'A retirada não pode ser antes do óbito nem da liberação.' });
      if (r.getTime() > d.agora.getTime() + FOLGA_MS)
        p.push({ campo: 'retiradaEm', mensagem: 'A retirada não pode ser no futuro.' });
    }
  }
  if (acao === 'cancelar' && (vazioANulo(d.motivo)?.length ?? 0) < MIN_MOTIVO_CANCELAMENTO_LIBERACAO)
    p.push({
      campo: 'motivo',
      mensagem: `O motivo do cancelamento tem ao menos ${MIN_MOTIVO_CANCELAMENTO_LIBERACAO} caracteres.`,
    });
  if (p.length) return { ok: false, problemas: p };
  return { ok: true, nova: PARA[acao], retiranteCpf: cpf };
}

/** Pendências do destino do corpo, para a visão do paciente (o que ainda falta fazer). */
export function pendenciasDestinoCorpo(e: {
  readonly declaracao: 'rascunho' | 'emitida' | 'cancelada' | null;
  readonly funerariaEscolhida: boolean;
  readonly cartorioEscolhido: boolean;
  readonly guarda: SituacaoLiberacaoCorpo | null;
}): string[] {
  const r: string[] = [];
  if (e.declaracao === null || e.declaracao === 'cancelada') r.push('declaracao');
  else if (e.declaracao === 'rascunho') r.push('emitir-declaracao');
  if (e.guarda === 'encaminhado_iml' || e.guarda === 'retirado') return r;
  if (!e.funerariaEscolhida) r.push('funeraria');
  if (!e.cartorioEscolhido) r.push('cartorio');
  // A guarda cancelada volta a ser pendência: o corpo precisa de guarda (reaberta) e de destino.
  if (e.guarda === null || e.guarda === 'cancelado') r.push('guarda');
  else if (e.guarda === 'em_guarda') r.push('liberacao');
  else if (e.guarda === 'liberado') r.push('retirada');
  return r;
}
