// F7, 08-INTG linha 131: troca por serviço web com o SUS (rastreamento de câncer e cadastro de prestador). Regras puras:
// o conteúdo de cada envio (montado só do que o serviço precisa: CNES, cartão nacional de saúde, exame ou ocupação), o
// envio repetido, quando um envio pode ir (pendente ou com erro de transporte, com teto de tentativas), a situação que a
// resposta deixa (aceito, aceito com crítica, rejeitado ou erro) com as críticas por campo, e o cancelamento com motivo.
// Nada é apagado: o envio cancelado ou rejeitado fica, e um novo envio é outra linha. O transporte (simulador fora de
// produção; o serviço do Ministério só com a chave de produção) é da API.
import { cnsValido, somenteDigitos } from '@sgh/contratos';
import { cboValido, cnesValido } from './identificacao-sus.js';

export const SERVICOS_WEB_SUS = ['rastreamento_cancer', 'cadastro_prestador'] as const;
export type ServicoWebSus = (typeof SERVICOS_WEB_SUS)[number];

/** Linhas de cuidado do rastreamento de câncer (colo do útero e mama). */
export const LINHAS_RASTREAMENTO_CANCER = ['colo_utero', 'mama'] as const;
export type LinhaRastreamentoCancer = (typeof LINHAS_RASTREAMENTO_CANCER)[number];

export const SITUACOES_ENVIO_WEB_SUS = [
  'pendente',
  'enviado',
  'aceito',
  'aceito_com_critica',
  'rejeitado',
  'cancelado',
  'erro',
] as const;
export type SituacaoEnvioWebSus = (typeof SITUACOES_ENVIO_WEB_SUS)[number];

/** Tentativas de envio de uma mesma linha; depois disso, cancela-se com motivo e registra-se outro envio. */
export const TETO_TENTATIVAS_WEB_SUS = 5;

export interface RecusaServicoWebSus {
  readonly codigo: string;
  readonly mensagem: string;
  readonly campos?: readonly string[];
}

const r = (codigo: string, mensagem: string, campos?: string[]): RecusaServicoWebSus => ({
  codigo,
  mensagem,
  ...(campos ? { campos } : {}),
});

export interface DadosRastreamentoCancer {
  readonly servico: 'rastreamento_cancer';
  readonly cnes: string | null;
  readonly linha: LinhaRastreamentoCancer;
  readonly cnsPaciente: string | null;
  readonly exameSituacao: string;
  readonly exameCodigo: string;
  readonly requisicaoNumero: string;
  readonly sequencia: number;
  /** Data do pedido (AAAA-MM-DD). */
  readonly solicitadoEm: string;
}

export interface DadosCadastroPrestador {
  readonly servico: 'cadastro_prestador';
  readonly cnes: string | null;
  readonly profissionalAtivo: boolean;
  readonly cnsProfissional: string | null;
  /** Ocupação principal (CBO de 6 dígitos), quando o profissional tem. */
  readonly cbo: string | null;
}

export type DadosServicoWebSus = DadosRastreamentoCancer | DadosCadastroPrestador;

export type PedidoServicoWebSus =
  | {
      readonly ok: true;
      readonly cnsInformado: string;
      readonly conteudo: Readonly<Record<string, unknown>>;
    }
  | { readonly ok: false; readonly recusa: RecusaServicoWebSus };

const cns = (v: string | null): string | null => {
  const d = somenteDigitos(v ?? '');
  return d.length === 15 ? d : null;
};

/** O conteúdo do envio, só com o que o serviço precisa; recusa com o campo quando falta ou é inválido. */
export function montarPedidoServicoWebSus(d: DadosServicoWebSus): PedidoServicoWebSus {
  if (!cnesValido(d.cnes))
    return {
      ok: false,
      recusa: r('cnes-invalido', 'O estabelecimento não tem CNES válido.', ['estabelecimento']),
    };
  const cnes = somenteDigitos(d.cnes ?? '').padStart(7, '0');
  if (d.servico === 'rastreamento_cancer') {
    const c = cns(d.cnsPaciente);
    if (!d.cnsPaciente?.trim())
      return {
        ok: false,
        recusa: r('cns-ausente', 'O paciente não tem cartão nacional de saúde no cadastro.', ['paciente']),
      };
    if (!c || !cnsValido(c))
      return {
        ok: false,
        recusa: r('cns-invalido', 'O cartão nacional de saúde do paciente é inválido.', ['paciente']),
      };
    if (d.exameSituacao === 'cancelado')
      return { ok: false, recusa: r('exame-cancelado', 'O exame foi cancelado.', ['exameItem']) };
    return {
      ok: true,
      cnsInformado: c,
      conteudo: {
        servico: d.servico,
        cnes,
        linha: d.linha,
        cnsPaciente: c,
        exame: {
          codigo: d.exameCodigo,
          requisicao: d.requisicaoNumero,
          sequencia: d.sequencia,
          solicitadoEm: d.solicitadoEm,
        },
      },
    };
  }
  if (!d.profissionalAtivo)
    return { ok: false, recusa: r('profissional-inativo', 'O profissional está inativo.', ['profissional']) };
  const c = cns(d.cnsProfissional);
  if (!c || !cnsValido(c))
    return {
      ok: false,
      recusa: r('cns-invalido', 'O profissional não tem cartão nacional de saúde válido.', ['profissional']),
    };
  const cbo = d.cbo && cboValido(d.cbo) ? d.cbo.trim().toUpperCase() : null;
  return { ok: true, cnsInformado: c, conteudo: { servico: d.servico, cnes, cnsProfissional: c, cbo } };
}

export interface EnvioExistenteWebSus {
  readonly id: number;
  readonly situacao: string;
}

/**
 * O envio repetido: o que está vivo (pendente, enviado ou com erro de transporte) segura o novo; no rastreamento, o
 * aceito também (o exame já está no serviço). Rejeitado e cancelado deixam registrar outro.
 */
export function conferirEnvioRepetidoWebSus(
  servico: ServicoWebSus,
  existentes: readonly EnvioExistenteWebSus[],
): RecusaServicoWebSus | null {
  const vivos = ['pendente', 'enviado', 'erro'];
  if (servico === 'rastreamento_cancer') vivos.push('aceito', 'aceito_com_critica');
  const x = existentes.find((e) => vivos.includes(e.situacao));
  return x
    ? r('envio-repetido', `Já existe o envio ${x.id} (${x.situacao}) para o mesmo registro.`, ['envio'])
    : null;
}

/** Só vai o pendente ou o que falhou no transporte, até o teto de tentativas. */
export function conferirEnvioWebSus(situacao: string, tentativas: number): RecusaServicoWebSus | null {
  if (situacao !== 'pendente' && situacao !== 'erro')
    return r('envio-nao-pendente', `O envio está ${situacao}: não há o que enviar.`, ['envio']);
  if (tentativas >= TETO_TENTATIVAS_WEB_SUS)
    return r(
      'tentativas-esgotadas',
      `O envio já tentou ${TETO_TENTATIVAS_WEB_SUS} vezes: cancele com o motivo e registre outro.`,
      ['envio'],
    );
  return null;
}

/** Só o que não chegou ao serviço ou foi rejeitado se cancela; o motivo é obrigatório. */
export function conferirCancelamentoWebSus(situacao: string, motivo: string): RecusaServicoWebSus | null {
  if (!['pendente', 'erro', 'rejeitado'].includes(situacao))
    return r('cancelamento-invalido', `O envio ${situacao} não pode ser cancelado.`, ['envio']);
  if (motivo.trim().length < 5)
    return r('motivo-obrigatorio', 'Informe o motivo do cancelamento (5 caracteres ou mais).', ['motivo']);
  return null;
}

export interface CriticaServicoWebSus {
  readonly tipo: 'aviso' | 'erro';
  readonly codigo: string | null;
  readonly campo: string | null;
  readonly mensagem: string;
}

/** A resposta do transporte: a que chegou ao serviço ou a falha de transporte (sem resposta). */
export type RespostaServicoWebSus =
  | {
      readonly chegou: true;
      readonly protocolo: string | null;
      readonly tipoProtocolo: string | null;
      readonly cnsConfirmado: string | null;
      readonly criticas: readonly CriticaServicoWebSus[];
    }
  | { readonly chegou: false; readonly mensagem: string };

export interface RetornoParaGravarWebSus {
  readonly tipo: 'sucesso' | 'aviso' | 'erro';
  readonly codigo: string | null;
  readonly campo: string | null;
  readonly mensagem: string;
}

export interface EfeitoRespostaWebSus {
  readonly situacao: SituacaoEnvioWebSus;
  readonly protocolo: string | null;
  readonly tipoProtocolo: string | null;
  readonly cnsConfirmado: string | null;
  readonly retornos: readonly RetornoParaGravarWebSus[];
}

/**
 * O que a resposta deixa: a falha de transporte fica "erro" (pode tentar de novo); crítica de erro, "rejeitado";
 * só avisos, "aceito_com_critica"; sem crítica, "aceito". Aceite sem protocolo não é aceite: fica "erro".
 */
export function efeitoDaRespostaWebSus(resp: RespostaServicoWebSus): EfeitoRespostaWebSus {
  if (!resp.chegou)
    return {
      situacao: 'erro',
      protocolo: null,
      tipoProtocolo: null,
      cnsConfirmado: null,
      retornos: [{ tipo: 'erro', codigo: 'transporte', campo: null, mensagem: resp.mensagem.slice(0, 1000) }],
    };
  const criticas: RetornoParaGravarWebSus[] = resp.criticas.map((c) => ({
    tipo: c.tipo,
    codigo: c.codigo,
    campo: c.campo,
    mensagem: c.mensagem.slice(0, 1000),
  }));
  const cnsConfirmado = cns(resp.cnsConfirmado);
  if (criticas.some((c) => c.tipo === 'erro'))
    return {
      situacao: 'rejeitado',
      protocolo: resp.protocolo,
      tipoProtocolo: resp.tipoProtocolo,
      cnsConfirmado,
      retornos: criticas,
    };
  if (!resp.protocolo?.trim())
    return {
      situacao: 'erro',
      protocolo: null,
      tipoProtocolo: null,
      cnsConfirmado: null,
      retornos: [
        ...criticas,
        {
          tipo: 'erro',
          codigo: 'sem-protocolo',
          campo: null,
          mensagem: 'O serviço respondeu sem protocolo.',
        },
      ],
    };
  const protocolo = resp.protocolo.trim().slice(0, 30);
  return {
    situacao: criticas.length > 0 ? 'aceito_com_critica' : 'aceito',
    protocolo,
    tipoProtocolo: resp.tipoProtocolo,
    cnsConfirmado,
    retornos:
      criticas.length > 0
        ? criticas
        : [{ tipo: 'sucesso', codigo: null, campo: null, mensagem: `Aceito com o protocolo ${protocolo}.` }],
  };
}
