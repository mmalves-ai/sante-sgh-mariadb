// Cliente da manutenção corretiva com oficina e conserto externo (C2-089, 04-HOT L135): o cadastro das oficinas (pessoas
// com função, alçada do aprovador e vigência; serviços), o orçamento da OS com a decisão do aprovador, a remessa do
// equipamento ao fornecedor e o retorno, e o painel das remessas abertas. O servidor é a fonte: as respostas são
// conferidas só na forma. Toda gravação vai com o CSRF e uma Idempotency-Key por intenção de gravar.
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { enviar, ler, novaChave, qs } from '../exames/api-exames.js';

const B = '/api/manutencao';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

export type FuncaoMembro = 'tecnico' | 'supervisor' | 'aprovador' | 'recepcao';
export const FUNCOES_MEMBRO: readonly FuncaoMembro[] = ['tecnico', 'supervisor', 'aprovador', 'recepcao'];

export interface MembroDaOficina {
  readonly id: number | null;
  readonly usuario: number;
  readonly login: string;
  readonly nome: string;
  readonly funcao: FuncaoMembro;
  readonly alcada: number | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
}
export interface ServicoDaOficina {
  readonly servico: number;
  readonly codigo: string;
  readonly nome: string;
  readonly tempoPadraoMinutos: number | null;
  readonly ativo: boolean;
}
export interface Oficina {
  readonly id: number;
  readonly versao: number;
  readonly codigo: string;
  readonly nome: string;
  readonly terceirizada: boolean;
  readonly fornecedor: number | null;
  readonly fornecedorNome: string | null;
  readonly especialidade: number | null;
  readonly especialidadeNome: string | null;
  readonly email: string | null;
  readonly telefone: string | null;
  readonly ramal: string | null;
  readonly notificaPorEmail: boolean;
  readonly exigeAvaliacao: boolean;
  readonly ativo: boolean;
  readonly ordensAbertas: number;
}
export interface OficinaDetalhe extends Oficina {
  readonly membros: readonly MembroDaOficina[];
  readonly servicos: readonly ServicoDaOficina[];
}
export interface OpcaoSimples {
  readonly id: number;
  readonly codigo: string;
  readonly nome: string;
}
export interface OpcoesOficina {
  readonly especialidades: readonly OpcaoSimples[];
  readonly servicos: readonly OpcaoSimples[];
}
export interface OficinaParaGravar {
  readonly versao?: number;
  readonly codigo: string;
  readonly nome: string;
  readonly terceirizada: boolean;
  readonly fornecedor: number | null;
  readonly especialidade: number | null;
  readonly email: string | null;
  readonly telefone: string | null;
  readonly ramal: string | null;
  readonly notificaPorEmail: boolean;
  readonly exigeAvaliacao: boolean;
  readonly ativo: boolean;
  readonly membros: readonly {
    readonly login: string;
    readonly funcao: FuncaoMembro;
    readonly alcada: number | null;
    readonly vigenciaInicio: string;
    readonly vigenciaFim: string | null;
  }[];
  readonly servicos: readonly { readonly servico: number; readonly tempoPadraoMinutos: number | null }[];
}

export type SituacaoOrcamento = 'pendente' | 'aprovado' | 'reprovado' | 'substituido';
export interface OrcamentoDaOs {
  readonly id: number;
  readonly versao: number;
  readonly fornecedor: number | null;
  readonly fornecedorNome: string | null;
  readonly descricao: string;
  readonly valor: number;
  readonly prazoDias: number | null;
  readonly validade: string | null;
  readonly situacao: SituacaoOrcamento;
  readonly registradoPor: number;
  readonly registradoPorNome: string;
  readonly registradoEm: string;
  readonly decididoPorNome: string | null;
  readonly decididoEm: string | null;
  readonly justificativa: string | null;
}
export type CfopRemessa = '5915' | '6915';
export type ResultadoRetorno = 'consertado' | 'sem_conserto';
export interface RemessaDaOs {
  readonly id: number;
  readonly versao: number;
  readonly fornecedor: number;
  readonly fornecedorNome: string;
  readonly orcamento: number | null;
  readonly termoSaida: string;
  readonly notaFiscalRemessa: string | null;
  readonly cfop: CfopRemessa | null;
  readonly enviadoEm: string;
  readonly enviadoPorNome: string;
  readonly previsaoRetorno: string | null;
  readonly situacao: 'enviado' | 'retornado';
  readonly retornadoEm: string | null;
  readonly notaFiscalRetorno: string | null;
  readonly resultado: ResultadoRetorno | null;
  readonly observacaoRetorno: string | null;
  readonly atrasada: boolean;
}
export interface CorretivaExterna {
  readonly os: number;
  readonly versaoOs: number;
  readonly situacaoOs: string;
  readonly oficina: number | null;
  readonly oficinaNome: string | null;
  readonly equipamento: number | null;
  readonly orcamentos: readonly OrcamentoDaOs[];
  readonly remessas: readonly RemessaDaOs[];
}
export interface RemessaAberta {
  readonly os: number;
  readonly numero: string;
  readonly equipamento: string;
  readonly fornecedor: string;
  readonly enviadoEm: string;
  readonly previsaoRetorno: string | null;
  readonly atrasada: boolean;
}
export interface ResultadoCorretiva {
  readonly ok: true;
  readonly id: number;
  readonly versao?: number;
  readonly versaoOs?: number;
  readonly mensagem: string;
}

const resultado = confiar<ResultadoCorretiva>();
const chave = (rotulo: string) => novaChave(`c2089.${rotulo}`);

// ── Oficinas ───────────────────────────────────────────────────────────────────────────────────────────────────────
export const listarOficinas = (termo: string | null, inativas: boolean) =>
  ler(`${B}/oficinas${qs({ termo, inativas: inativas || null })}`, z.array(confiar<Oficina>()));
export const lerOpcoesOficina = () => ler(`${B}/oficinas/opcoes`, confiar<OpcoesOficina>());
export const lerOficina = (id: number) => ler(`${B}/oficinas/${id}`, confiar<OficinaDetalhe>());
export const incluirOficina = (corpo: OficinaParaGravar) =>
  enviar(`${B}/oficinas`, corpo, resultado, chave('oficina'));
/** Alteração pela versão lida (PUT; versão velha devolve 409). */
export async function alterarOficina(id: number, corpo: OficinaParaGravar): Promise<ResultadoCorretiva> {
  const r = await fetch(`${B}/oficinas/${id}`, {
    method: 'PUT',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave('oficina-alterar'),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as ResultadoCorretiva;
}

// ── Orçamento, remessa e retorno da OS ─────────────────────────────────────────────────────────────────────────────
export const lerCorretivaExterna = (os: number) =>
  ler(`${B}/os/${os}/corretiva-externa`, confiar<CorretivaExterna>());
export const registrarOrcamento = (
  os: number,
  corpo: {
    versaoOs: number;
    fornecedor: number | null;
    descricao: string;
    valor: number;
    prazoDias: number | null;
    validade: string | null;
  },
) => enviar(`${B}/os/${os}/orcamentos`, corpo, resultado, chave('orcamento'));
export const decidirOrcamento = (
  orcamento: number,
  corpo: { versao: number; decisao: 'aprovado' | 'reprovado'; justificativa: string | null },
) => enviar(`${B}/orcamentos/${orcamento}/decisao`, corpo, resultado, chave('decisao'));
export const enviarRemessa = (
  os: number,
  corpo: {
    versaoOs: number;
    fornecedor: number;
    termo: string;
    notaFiscal: string | null;
    cfop: CfopRemessa | null;
    previsaoRetorno: string | null;
  },
) => enviar(`${B}/os/${os}/remessas`, corpo, resultado, chave('remessa'));
export const registrarRetorno = (
  remessa: number,
  corpo: {
    versao: number;
    retornadoEm: string | null;
    notaFiscal: string | null;
    resultado: ResultadoRetorno;
    observacao: string | null;
  },
) => enviar(`${B}/remessas/${remessa}/retorno`, corpo, resultado, chave('retorno'));
export const lerRemessasAbertas = () => ler(`${B}/remessas/abertas`, z.array(confiar<RemessaAberta>()));
