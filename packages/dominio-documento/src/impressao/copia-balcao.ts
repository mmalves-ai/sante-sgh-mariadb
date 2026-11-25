// Cópia do prontuário pedida e entregue no balcão (03-PEP L131; Resolução CFM 1.821/2007, Código de Ética Médica art.
// 88, LGPD art. 18 II e art. 19): quem pediu, por quê, de qual período, a autorização quando quem pede não é o
// paciente, a produção da cópia com o número de folhas e a entrega com quem recebeu, o vínculo com o paciente, o
// documento de identidade conferido, a procuração quando é procurador e o conteúdo entregue (folhas). Nada se apaga:
// a negativa leva o motivo, o cancelamento também, e a segunda cópia é um pedido novo. Regra pura: sem banco nem I/O.

import { cpfValido } from '../assinatura/certificado.js';

export const SOLICITANTES_COPIA_BALCAO = [
  'paciente',
  'representante_legal',
  'procurador',
  'familiar',
  'autoridade_judicial',
  'profissional',
  'outro',
] as const;
export type SolicitanteCopiaBalcao = (typeof SOLICITANTES_COPIA_BALCAO)[number];

export const VINCULOS_RECEBEDOR_COPIA = [
  'proprio_paciente',
  'conjuge',
  'pai_mae',
  'filho',
  'irmao',
  'responsavel_legal',
  'procurador',
  'herdeiro',
  'autoridade',
  'outro',
] as const;
export type VinculoRecebedorCopia = (typeof VINCULOS_RECEBEDOR_COPIA)[number];

export const FORMAS_ENTREGA_COPIA = ['presencial', 'correio', 'digital'] as const;
export type FormaEntregaCopia = (typeof FORMAS_ENTREGA_COPIA)[number];

export const FORMATOS_COPIA = ['impresso', 'digital'] as const;
export type FormatoCopia = (typeof FORMATOS_COPIA)[number];

export const SITUACOES_COPIA_BALCAO = [
  'solicitada',
  'em_analise',
  'autorizada',
  'em_producao',
  'pronta',
  'entregue',
  'negada',
  'cancelada',
] as const;
export type SituacaoCopiaBalcao = (typeof SITUACOES_COPIA_BALCAO)[number];

export const ACOES_COPIA_BALCAO = [
  'analisar',
  'autorizar',
  'produzir',
  'pronta',
  'negar',
  'cancelar',
] as const;
export type AcaoCopiaBalcao = (typeof ACOES_COPIA_BALCAO)[number];

/** LGPD art. 19 II: a declaração completa em até 15 dias do pedido; o hospital pode encurtar, nunca alongar. */
export const PRAZO_PADRAO_COPIA_DIAS = 15;
export const PRAZO_MAXIMO_COPIA_DIAS = 15;

export interface FalhaCopia {
  readonly campo: string;
  readonly mensagem: string;
}

const ENCERRADAS: readonly SituacaoCopiaBalcao[] = ['entregue', 'negada', 'cancelada'];

/** Quem pede pelo paciente precisa da autorização (termo, ordem judicial ou procuração digitalizada) para liberar. */
export const exigeAutorizacao = (s: SolicitanteCopiaBalcao): boolean => s !== 'paciente';

export interface PedidoCopiaBalcao {
  readonly solicitanteTipo: SolicitanteCopiaBalcao;
  readonly solicitanteNome: string;
  readonly solicitanteCpf: string | null;
  readonly solicitanteParentesco: string | null;
  readonly motivo: string;
  readonly periodoInicio: string | null;
  readonly periodoFim: string | null;
  readonly prazoDias: number;
  readonly formato: FormatoCopia;
  /** Procuração digitalizada no pedido (obrigatória quando quem pede é procurador). */
  readonly temProcuracao: boolean;
  /** Hoje, no fuso do estabelecimento (AAAA-MM-DD). */
  readonly hoje: string;
}

/** Confere o pedido feito no balcão; lista vazia: o pedido pode ser gravado. */
export function validarPedidoCopiaBalcao(p: PedidoCopiaBalcao): FalhaCopia[] {
  const f: FalhaCopia[] = [];
  if (p.solicitanteNome.trim().length < 3)
    f.push({ campo: 'solicitanteNome', mensagem: 'Informe o nome de quem pede a cópia.' });
  if (p.solicitanteCpf !== null && !cpfValido(p.solicitanteCpf))
    f.push({ campo: 'solicitanteCpf', mensagem: 'O CPF de quem pede não confere.' });
  if (p.solicitanteTipo !== 'paciente' && p.solicitanteTipo !== 'autoridade_judicial' && !p.solicitanteCpf)
    f.push({
      campo: 'solicitanteCpf',
      mensagem: 'Quem pede pelo paciente precisa ser identificado pelo CPF.',
    });
  if (
    (p.solicitanteTipo === 'familiar' || p.solicitanteTipo === 'representante_legal') &&
    (p.solicitanteParentesco ?? '').trim().length < 3
  )
    f.push({ campo: 'solicitanteParentesco', mensagem: 'Informe o parentesco ou a representação.' });
  if (p.solicitanteTipo === 'procurador' && !p.temProcuracao)
    f.push({ campo: 'procuracao', mensagem: 'O procurador apresenta a procuração, digitalizada no pedido.' });
  if (p.motivo.trim().length < 5)
    f.push({ campo: 'motivo', mensagem: 'Informe o motivo do pedido (ao menos 5 letras).' });
  if (p.periodoInicio && p.periodoFim && p.periodoFim < p.periodoInicio)
    f.push({ campo: 'periodoFim', mensagem: 'O fim do período é anterior ao início.' });
  if ((p.periodoInicio && p.periodoInicio > p.hoje) || (p.periodoFim && p.periodoFim > p.hoje))
    f.push({ campo: 'periodoFim', mensagem: 'O período pedido não pode estar no futuro.' });
  if (!Number.isInteger(p.prazoDias) || p.prazoDias < 1 || p.prazoDias > PRAZO_MAXIMO_COPIA_DIAS)
    f.push({
      campo: 'prazoDias',
      mensagem: `O prazo de entrega vai de 1 a ${PRAZO_MAXIMO_COPIA_DIAS} dias (LGPD, art. 19).`,
    });
  return f;
}

/** A data do prazo (AAAA-MM-DD) a partir de hoje. */
export function prazoDaCopia(hoje: string, dias: number): string {
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** O pedido em aberto passou do prazo. */
export const copiaAtrasada = (situacao: SituacaoCopiaBalcao, prazo: string, hoje: string): boolean =>
  !ENCERRADAS.includes(situacao) && prazo < hoje;

export interface AcaoSobreCopia {
  readonly acao: AcaoCopiaBalcao;
  readonly solicitanteTipo: SolicitanteCopiaBalcao;
  /** Já existe autorização digitalizada (no pedido ou nesta ação). */
  readonly temAutorizacao: boolean;
  readonly motivo: string | null;
}

/** A situação nova da cópia ou a recusa (a transição é a mesma na tela e na porta). */
export function transicaoCopia(
  atual: SituacaoCopiaBalcao,
  a: AcaoSobreCopia,
): { readonly situacao: SituacaoCopiaBalcao } | { readonly recusa: FalhaCopia } {
  const recusa = (campo: string, mensagem: string) => ({ recusa: { campo, mensagem } });
  if (ENCERRADAS.includes(atual))
    return recusa(
      'situacao',
      'O pedido já foi encerrado (entregue, negado ou cancelado): abra um pedido novo.',
    );
  switch (a.acao) {
    case 'analisar':
      return atual === 'solicitada'
        ? { situacao: 'em_analise' }
        : recusa('situacao', 'Só o pedido recém-recebido entra em análise.');
    case 'autorizar':
      if (atual !== 'solicitada' && atual !== 'em_analise')
        return recusa('situacao', 'O pedido já foi autorizado.');
      if (exigeAutorizacao(a.solicitanteTipo) && !a.temAutorizacao)
        return recusa(
          'autorizacao',
          'Quem pede não é o paciente: anexe a autorização do paciente, a ordem judicial ou a procuração.',
        );
      return { situacao: 'autorizada' };
    case 'produzir':
      return atual === 'autorizada'
        ? { situacao: 'em_producao' }
        : recusa('situacao', 'Autorize o pedido antes de produzir a cópia.');
    case 'pronta':
      return atual === 'autorizada' || atual === 'em_producao'
        ? { situacao: 'pronta' }
        : recusa('situacao', 'Autorize o pedido antes de marcar a cópia como pronta.');
    case 'negar':
      if (atual === 'pronta')
        return recusa('situacao', 'A cópia já está pronta: cancele o pedido com o motivo.');
      return (a.motivo ?? '').trim().length >= 5
        ? { situacao: 'negada' }
        : recusa('motivo', 'Informe o motivo da negativa (ao menos 5 letras).');
    case 'cancelar':
      return (a.motivo ?? '').trim().length >= 5
        ? { situacao: 'cancelada' }
        : recusa('motivo', 'Informe o motivo do cancelamento (ao menos 5 letras).');
  }
}

export interface EntregaCopia {
  readonly situacao: SituacaoCopiaBalcao;
  readonly solicitanteTipo: SolicitanteCopiaBalcao;
  readonly forma: FormaEntregaCopia;
  readonly recebedorNome: string;
  readonly vinculo: VinculoRecebedorCopia;
  readonly temTipoDocumento: boolean;
  readonly numeroDocumento: string;
  readonly temProcuracao: boolean;
  readonly quantidadeFolhas: number | null;
  readonly endereco: string | null;
}

/** Quem pode receber a cópia pedida por cada solicitante (além do procurador com procuração). */
const RECEBEDORES: Readonly<Record<SolicitanteCopiaBalcao, readonly VinculoRecebedorCopia[]>> = {
  paciente: ['proprio_paciente'],
  representante_legal: ['responsavel_legal', 'pai_mae', 'conjuge'],
  procurador: ['procurador'],
  familiar: ['conjuge', 'pai_mae', 'filho', 'irmao', 'herdeiro', 'responsavel_legal'],
  autoridade_judicial: ['autoridade'],
  profissional: ['outro', 'autoridade'],
  outro: ['outro', 'herdeiro', 'autoridade'],
};

/** Confere a entrega no balcão: só da cópia pronta, com quem recebeu identificado e com direito a receber. */
export function validarEntregaCopia(e: EntregaCopia): FalhaCopia[] {
  const f: FalhaCopia[] = [];
  if (e.situacao !== 'pronta')
    f.push({ campo: 'situacao', mensagem: 'Só a cópia pronta pode ser entregue.' });
  if (e.recebedorNome.trim().length < 3)
    f.push({ campo: 'recebedorNome', mensagem: 'Informe o nome de quem recebeu a cópia.' });
  if (!e.temTipoDocumento || e.numeroDocumento.trim().length < 4)
    f.push({
      campo: 'numeroDocumento',
      mensagem: 'Confira e registre o documento de identidade de quem recebeu (tipo e número).',
    });
  if (e.vinculo === 'procurador' && !e.temProcuracao)
    f.push({
      campo: 'procuracao',
      mensagem: 'Quem recebe como procurador apresenta a procuração digitalizada.',
    });
  if (e.vinculo !== 'procurador' && !RECEBEDORES[e.solicitanteTipo].includes(e.vinculo))
    f.push({
      campo: 'vinculo',
      mensagem: 'Quem recebe não tem vínculo para receber esta cópia: só com procuração do solicitante.',
    });
  if (e.quantidadeFolhas === null || !Number.isInteger(e.quantidadeFolhas) || e.quantidadeFolhas < 1)
    f.push({
      campo: 'quantidadeFolhas',
      mensagem: 'Informe o número de folhas entregues (conteúdo conferido).',
    });
  if (e.forma === 'correio' && (e.endereco ?? '').trim().length < 10)
    f.push({ campo: 'endereco', mensagem: 'A entrega pelo correio leva o endereço completo.' });
  return f;
}
