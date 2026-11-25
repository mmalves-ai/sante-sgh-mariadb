// Prescrição digital por plataforma externa (F8, 08-INTG L132): regras puras do envio da receita assinada a uma
// plataforma de prescrição digital e do retorno da receita validável (identificador, código e endereço de validação).
// Padrões públicos: a receita digital vale com assinatura ICP-Brasil (CFM 2.299/2021; Lei 14.063/2020, art. 13) e é
// conferida pela farmácia no validador do ITI; a de medicamento sujeito a controle especial segue a ANVISA (Portaria
// SVS/MS 344/1998 e a RDC da receita eletrônica). A plataforma é um adaptador genérico por sistema externo, escolhida
// por configuração do cliente; fora de produção o worker usa o simulador desta mesma regra. Sem banco, sem HTTP.
import { createHash } from 'node:crypto';

/** Tipo da mensagem na fila de saída: o envio da receita à plataforma. */
export const EVENTO_PRESCRICAO_DIGITAL_ENVIO = 'integracao.prescricao_digital.envio';
/** Tipo da mensagem na fila de saída: o cancelamento da receita já enviada. */
export const EVENTO_PRESCRICAO_DIGITAL_CANCELAMENTO = 'integracao.prescricao_digital.cancelamento';

export const SITUACOES_PRESCRICAO_DIGITAL = [
  'pendente',
  'enviada',
  'aceita',
  'rejeitada',
  'dispensada',
  'cancelada',
  'erro',
] as const;
export type SituacaoPrescricaoDigital = (typeof SITUACOES_PRESCRICAO_DIGITAL)[number];

/** Situações em que o envio está vivo: o mesmo documento não vai de novo à mesma plataforma. */
export const SITUACOES_PRESCRICAO_VIVAS: readonly SituacaoPrescricaoDigital[] = [
  'pendente',
  'enviada',
  'aceita',
  'dispensada',
];

/** Categorias de sistema externo que podem ser plataforma de prescrição digital. */
export const CATEGORIAS_PLATAFORMA_PRESCRICAO = ['prontuario', 'assinatura', 'outro'] as const;

export interface ErroPrescricaoDigital {
  readonly campo: string;
  readonly codigo: string;
  readonly mensagem: string;
}

export interface DocumentoParaEnvio {
  /** Situação da receita no PEP (rascunho, emitida, suspensa, cancelada). */
  readonly situacaoReceita: string;
  /** Situação do documento assinado da receita (null: a receita não foi assinada). */
  readonly situacaoDocumento: string | null;
  /** Nível da assinatura válida do prescritor (null: sem assinatura válida). */
  readonly nivelAssinatura: string | null;
  /** O signatário da assinatura válida é o prescritor da receita. */
  readonly assinadaPeloPrescritor: boolean;
  /** Validade da receita (AAAA-MM-DD) e a data local de hoje. */
  readonly validadeAte: string | null;
  readonly hoje: string;
}

export interface PlataformaParaEnvio {
  readonly ativa: boolean;
  readonly categoria: string;
  /** Há parceiro ativo do tipo API ligado ao sistema (quem o worker entrega). */
  readonly parceiroApiAtivo: boolean;
}

/** Confere se a receita pode ir à plataforma; vazio quando pode. */
export function conferirEnvioPrescricaoDigital(
  doc: DocumentoParaEnvio,
  plataforma: PlataformaParaEnvio | null,
  enviosDoDocumento: readonly { readonly situacao: string; readonly plataformaMesma: boolean }[],
): ErroPrescricaoDigital[] {
  const erros: ErroPrescricaoDigital[] = [];
  if (doc.situacaoReceita !== 'emitida')
    erros.push({
      campo: 'receita',
      codigo: 'receita-nao-emitida',
      mensagem: 'Só a receita emitida vai à plataforma (rascunho, suspensa ou cancelada não).',
    });
  if (doc.situacaoDocumento !== 'assinado')
    erros.push({
      campo: 'receita',
      codigo: 'receita-sem-assinatura',
      mensagem: 'A receita tem de estar assinada antes do envio à plataforma.',
    });
  else if (doc.nivelAssinatura !== 'icp-brasil')
    erros.push({
      campo: 'receita',
      codigo: 'assinatura-nao-icp',
      mensagem: 'A receita digital exige assinatura com certificado ICP-Brasil (CFM 2.299/2021).',
    });
  else if (!doc.assinadaPeloPrescritor)
    erros.push({
      campo: 'receita',
      codigo: 'assinatura-de-outro',
      mensagem: 'A receita tem de estar assinada pelo próprio prescritor.',
    });
  if (doc.validadeAte !== null && doc.validadeAte < doc.hoje)
    erros.push({ campo: 'receita', codigo: 'receita-vencida', mensagem: 'A receita está vencida.' });
  if (!plataforma)
    erros.push({
      campo: 'plataforma',
      codigo: 'plataforma-nao-encontrada',
      mensagem: 'Escolha a plataforma de prescrição digital.',
    });
  else if (
    !plataforma.ativa ||
    !(CATEGORIAS_PLATAFORMA_PRESCRICAO as readonly string[]).includes(plataforma.categoria)
  )
    erros.push({
      campo: 'plataforma',
      codigo: 'plataforma-inativa',
      mensagem: 'A plataforma escolhida não está ativa para prescrição digital.',
    });
  else if (!plataforma.parceiroApiAtivo)
    erros.push({
      campo: 'plataforma',
      codigo: 'plataforma-sem-parceiro',
      mensagem: 'A plataforma não tem parceiro de API ativo para a entrega.',
    });
  if (
    enviosDoDocumento.some(
      (e) => e.plataformaMesma && (SITUACOES_PRESCRICAO_VIVAS as readonly string[]).includes(e.situacao),
    )
  )
    erros.push({
      campo: 'receita',
      codigo: 'envio-repetido',
      mensagem: 'A receita já foi enviada a esta plataforma; cancele o envio antes de mandar de novo.',
    });
  return erros;
}

/** Confere o cancelamento do envio; a receita já dispensada na farmácia não se cancela. */
export function conferirCancelamentoPrescricaoDigital(
  situacao: string,
  motivo: string,
): ErroPrescricaoDigital[] {
  const erros: ErroPrescricaoDigital[] = [];
  if (situacao === 'cancelada')
    erros.push({ campo: 'situacao', codigo: 'ja-cancelada', mensagem: 'O envio já está cancelado.' });
  else if (situacao === 'dispensada')
    erros.push({
      campo: 'situacao',
      codigo: 'ja-dispensada',
      mensagem: 'A receita já foi dispensada na farmácia; não se cancela mais.',
    });
  if (motivo.trim().length < 10)
    erros.push({
      campo: 'motivo',
      codigo: 'motivo-curto',
      mensagem: 'Informe o motivo do cancelamento (10 caracteres ou mais).',
    });
  return erros;
}

/** O cancelamento só vai à plataforma quando ela já conhece a receita (o identificador externo foi devolvido). */
export const cancelamentoVaiAPlataforma = (identificadorExterno: string | null): boolean =>
  identificadorExterno !== null && identificadorExterno !== '';

export interface PedidoPrescricaoDigital {
  readonly evento: typeof EVENTO_PRESCRICAO_DIGITAL_ENVIO | typeof EVENTO_PRESCRICAO_DIGITAL_CANCELAMENTO;
  readonly envio: number;
  readonly estabelecimento: string;
  readonly receita: {
    readonly numero: string;
    readonly emitidaEm: string;
    readonly validadeAte: string | null;
  };
  readonly documento: {
    readonly codigoVerificacao: string;
    readonly hash: string;
    readonly arquivo: number;
  } | null;
  readonly identificadorExterno: string | null;
  readonly motivo: string | null;
}

/** O conteúdo JSON que vai à plataforma (sem o texto clínico: o documento vai pelo arquivo assinado e o resumo). */
export function montarPedidoPrescricaoDigital(p: PedidoPrescricaoDigital): string {
  return JSON.stringify({
    versao: '1',
    evento: p.evento,
    envio: p.envio,
    estabelecimento: p.estabelecimento,
    receita: p.receita,
    documento: p.documento,
    identificadorExterno: p.identificadorExterno,
    motivo: p.motivo,
  });
}

export interface RetornoPrescricaoDigital {
  readonly situacao: 'aceita' | 'rejeitada' | 'dispensada' | 'cancelada';
  readonly identificadorExterno: string | null;
  readonly codigoValidacao: string | null;
  readonly urlValidacao: string | null;
  readonly situacaoExterna: string | null;
  readonly motivo: string | null;
}

/** Lê a resposta da plataforma (JSON); null quando não confere. */
export function lerRetornoPrescricaoDigital(corpo: unknown): RetornoPrescricaoDigital | null {
  if (!corpo || typeof corpo !== 'object') return null;
  const o = corpo as Record<string, unknown>;
  const t = (v: unknown, max: number): string | null =>
    typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null;
  const situacao = t(o['situacao'], 30);
  if (
    situacao !== 'aceita' &&
    situacao !== 'rejeitada' &&
    situacao !== 'dispensada' &&
    situacao !== 'cancelada'
  )
    return null;
  return {
    situacao,
    identificadorExterno: t(o['identificador'], 100),
    codigoValidacao: t(o['codigoValidacao'], 100),
    urlValidacao: t(o['urlValidacao'], 500),
    situacaoExterna: t(o['situacaoExterna'], 60) ?? situacao,
    motivo: t(o['motivo'], 500),
  };
}

export type EfeitoRetorno =
  | { readonly acao: 'ignorar'; readonly motivo: string }
  | { readonly acao: 'recusar'; readonly erro: ErroPrescricaoDigital }
  | { readonly acao: 'aplicar'; readonly situacao: SituacaoPrescricaoDigital };

/**
 * O efeito do retorno na situação do envio: a aceita exige identificador, código e endereço https de validação; o
 * envio cancelado aqui fica cancelado (retorno atrasado é ignorado, nada se sobrescreve); a dispensada é final.
 */
export function efeitoDoRetornoPrescricao(atual: string, r: RetornoPrescricaoDigital): EfeitoRetorno {
  if (atual === 'dispensada') return { acao: 'ignorar', motivo: 'receita já dispensada' };
  if (atual === 'cancelada' && r.situacao !== 'cancelada')
    return { acao: 'ignorar', motivo: 'envio cancelado no hospital' };
  if (r.situacao === 'aceita') {
    const urlOk = !!r.urlValidacao && /^https:\/\/[^\s]+$/.test(r.urlValidacao);
    if (!r.identificadorExterno || !r.codigoValidacao || !urlOk)
      return {
        acao: 'recusar',
        erro: {
          campo: 'retorno',
          codigo: 'retorno-incompleto',
          mensagem: 'A plataforma aceitou sem identificador, código ou endereço de validação https.',
        },
      };
  }
  return { acao: 'aplicar', situacao: r.situacao };
}

/**
 * O simulador da plataforma (fora de produção): a resposta determinística pela chave do envio. O endereço de
 * validação é de domínio reservado (.invalid, RFC 2606): nunca leva a um serviço real.
 */
export function simularRetornoPrescricaoDigital(conteudo: string): RetornoPrescricaoDigital {
  const pedido = JSON.parse(conteudo) as { evento?: string; envio?: number; identificadorExterno?: string };
  const h = createHash('sha256')
    .update(`prescricao-digital:${String(pedido.envio)}`)
    .digest('hex');
  const identificador = `SIM-${h.slice(0, 12).toUpperCase()}`;
  if (pedido.evento === EVENTO_PRESCRICAO_DIGITAL_CANCELAMENTO)
    return {
      situacao: 'cancelada',
      identificadorExterno: pedido.identificadorExterno ?? identificador,
      codigoValidacao: null,
      urlValidacao: null,
      situacaoExterna: 'cancelada',
      motivo: null,
    };
  const codigo = String(parseInt(h.slice(12, 20), 16) % 1_000_000).padStart(6, '0');
  return {
    situacao: 'aceita',
    identificadorExterno: identificador,
    codigoValidacao: codigo,
    urlValidacao: `https://validar.prescricao-simulada.invalid/receita/${identificador}`,
    situacaoExterna: 'emitida',
    motivo: null,
  };
}
