// Tipos e regras puras do estado sintético do acesso (F2-L): política de senha do produto, limites de sessão,
// exceções de dormência, conferência de conselho, mapa de perfis, pedidos de acesso, recertificação e RH. Trazidos
// da versão anterior do produto para que a fonte sintética (dev/ci e testes) não dependa do pacote antigo; a
// gravação real vai para as operações do núcleo na F2.2. Nada aqui lê banco.
import type { AcaoRecert, DecisaoRecert, EscopoRecert, SituacaoCampanhaRecert } from '@sgh/dominio-acesso';

/** As regras de uma versão (mesma forma que PoliticaSenhaSante do domínio, sem a versão). */
export interface RegrasPoliticaSenha {
  readonly minimoCaracteres: number;
  readonly exigeEspecial: boolean;
  readonly exigeMinuscula: boolean;
  readonly exigeMaiuscula: boolean;
  readonly trocaDias: number;
  readonly reusoDias: number;
  readonly recusaNome: boolean;
  readonly recusaNascimento: boolean;
  readonly recusaComuns: boolean;
  readonly senhasProibidas: readonly string[];
}

export interface PoliticaSenhaVigenteLida extends RegrasPoliticaSenha {
  readonly versao: number;
}

export interface VersaoPoliticaSenhaLida extends RegrasPoliticaSenha {
  readonly id: string;
  readonly versao: number;
  readonly vigenteDesde: Date | null;
  readonly motivo: string;
  readonly criadoPor: string;
  readonly criadoEm: Date | null;
  readonly situacao: 'publicada' | 'cancelada';
  readonly canceladaEm: Date | null;
  readonly canceladaPor: string | null;
  readonly motivoCancelamento: string | null;
}

export interface NovaPoliticaSenha extends RegrasPoliticaSenha {
  readonly hospital: string;
  readonly vigenteDesde: Date;
  readonly motivo: string;
  readonly por: string;
}

/** A lista local: uma por linha, sem vazias nem repetidas (a ordem de entrada fica). */
export function normalizarSenhasProibidas(lista: readonly string[]): string[] {
  return [...new Set(lista.map((x) => x.trim()).filter((x) => x.length > 0))];
}

/**
 * O que muda de `antes` para `depois`, campo a campo, com o valor anterior ("CAMPO: antes -> depois"). A lista local
 * de senhas proibidas entra só pela contagem (o conteúdo nunca vai à trilha). Sem `antes`: "nenhuma" (a primeira).
 */
const CAMPOS: readonly [keyof RegrasPoliticaSenha, string][] = [
  ['minimoCaracteres', 'MINIMO_CARACTERES'],
  ['exigeEspecial', 'EXIGE_ESPECIAL'],
  ['exigeMinuscula', 'EXIGE_MINUSCULA'],
  ['exigeMaiuscula', 'EXIGE_MAIUSCULA'],
  ['trocaDias', 'TROCA_DIAS'],
  ['reusoDias', 'REUSO_DIAS'],
  ['recusaNome', 'RECUSA_NOME'],
  ['recusaNascimento', 'RECUSA_NASCIMENTO'],
  ['recusaComuns', 'RECUSA_COMUNS'],
];

/** Valor do campo na diferença (vocabulário neutro: sim/nao, nunca S/N). */
const VALOR = (v: unknown) => (typeof v === 'boolean' ? (v ? 'sim' : 'nao') : String(v));

export function diferencaPoliticaSenha(
  antes: RegrasPoliticaSenha | null,
  depois: RegrasPoliticaSenha,
): string[] {
  const d: string[] = [];
  for (const [campo, coluna] of CAMPOS) {
    const a = antes ? VALOR(antes[campo]) : 'nenhuma';
    const b = VALOR(depois[campo]);
    if (a !== b) d.push(`${coluna}: ${a} -> ${b}`);
  }
  const qa = antes ? antes.senhasProibidas.length : 0;
  const igualLista =
    antes !== null &&
    antes.senhasProibidas.length === depois.senhasProibidas.length &&
    antes.senhasProibidas.every((x, i) => x === depois.senhasProibidas[i]);
  if (!igualLista && (antes !== null || depois.senhasProibidas.length > 0))
    d.push(`SENHAS_PROIBIDAS: ${qa} -> ${depois.senhasProibidas.length} itens`);
  return d;
}

/** Uma linha do histórico (a mais nova primeiro na leitura). */
export interface RegistroLimiteSessaoLido {
  readonly id: string;
  readonly perfil: string;
  /** null: retirado (sem limite próprio). */
  readonly limite: number | null;
  readonly situacao: 'vigente' | 'retirado';
  readonly motivo: string;
  readonly criadoPor: string;
  readonly criadoEm: Date | null;
}

export interface NovoLimiteSessao {
  readonly hospital: string;
  readonly perfil: string;
  /** null: retirar o limite do perfil. */
  readonly limite: number | null;
  readonly motivo: string;
  readonly por: string;
}

/** Os limites em vigor: a linha mais nova de cada perfil, sem as retiradas . */
export function limitesVigentes(historico: readonly RegistroLimiteSessaoLido[]): Record<string, number> {
  const visto = new Set<string>();
  const r: Record<string, number> = {};
  for (const x of [...historico].sort((a, b) => Number(b.id) - Number(a.id))) {
    if (visto.has(x.perfil)) continue;
    visto.add(x.perfil);
    if (x.situacao === 'vigente' && x.limite !== null) r[x.perfil] = x.limite;
  }
  return r;
}

export interface ExcecaoDormenciaLida {
  readonly id: string;
  readonly login: string;
  /** Último dia (AAAA-MM-DD); null sem prazo ou retirada. */
  readonly ate: string | null;
  readonly situacao: 'vigente' | 'retirada';
  readonly motivo: string;
  readonly criadoPor: string;
  readonly criadoEm: Date | null;
}

export interface NovaExcecaoDormencia {
  readonly hospital: string;
  readonly login: string;
  /** null: sem prazo. Ignorado ao retirar. */
  readonly ate: string | null;
  readonly retirar: boolean;
  readonly motivo: string;
  readonly por: string;
}

export const SITUACOES_CONSELHO = ['ativo', 'inativo', 'suspenso', 'cancelado', 'nao-localizado'] as const;

export const FONTES_CONFERENCIA_CONSELHO = ['portal-conselho', 'documento', 'declaracao', 'outra'] as const;
export type SituacaoConselho = (typeof SITUACOES_CONSELHO)[number];
export type FonteConferenciaConselho = (typeof FONTES_CONFERENCIA_CONSELHO)[number];

/** Registro de conselho do papel ativo do usuário (o número só para a pessoa conferir na fonte). */
export interface RegistroConselhoUsuario {
  readonly registro: number;
  readonly sigla: string | null;
  readonly numero: string | null;
  readonly uf: string | null;
  readonly ocupacao: string | null;
}

export interface ConferenciaConselhoLida {
  readonly id: string;
  readonly login: string;
  readonly registro: number;
  readonly situacao: SituacaoConselho;
  /** Dia da consulta à fonte (AAAA-MM-DD). */
  readonly conferidoEm: string;
  readonly fonte: FonteConferenciaConselho;
  readonly observacao: string;
  readonly criadoPor: string;
  readonly criadoEm: Date | null;
}

export interface NovaConferenciaConselho {
  readonly hospital: string;
  readonly login: string;
  readonly registro: number;
  readonly situacao: SituacaoConselho;
  readonly conferidoEm: string;
  readonly fonte: FonteConferenciaConselho;
  readonly observacao: string;
  readonly por: string;
  /** Hoje no fuso do estabelecimento (AAAA-MM-DD): a consulta não pode ser no futuro. */
  readonly hoje: string;
}

/** A conferência que vale de cada registro: a linha mais nova. */
export function conferenciasConselhoVigentes(
  historico: readonly ConferenciaConselhoLida[],
): Map<number, ConferenciaConselhoLida> {
  const r = new Map<number, ConferenciaConselhoLida>();
  for (const x of [...historico].sort((a, b) => Number(b.id) - Number(a.id)))
    if (!r.has(x.registro)) r.set(x.registro, x);
  return r;
}

export interface AlteracaoPerfilLida {
  readonly id: string;
  readonly inicioAntes: Date;
  readonly fimAntes: Date | null;
  readonly motivoAntes: string | null;
  readonly inicio: Date;
  readonly fim: Date | null;
  readonly motivo: string;
  readonly justificativa: string;
  readonly alteradoPor: string;
  readonly alteradoEm: Date;
}

export interface DecisaoMapaLida {
  readonly id: string;
  readonly situacaoAntes: 'proposta' | 'aprovada' | 'recusada' | null;
  readonly aprovadoPorAntes: string | null;
  readonly situacao: 'proposta' | 'aprovada' | 'recusada';
  readonly motivo: string | null;
  readonly usuariosAfetados: number | null;
  readonly decididoPor: string;
  readonly decididoEm: Date | null;
}

/**
 * Mudar a decisão de uma linha que já existe sem motivo (tirar uma aprovação, reverter ou conceder uma recusa, voltar a
 * proposta): recusado antes de gravar. Só a linha nova dispensa o motivo.
 */
export class ErroMotivoMapa extends Error {
  constructor() {
    super('Informe o motivo (5 caracteres ou mais) para mudar a decisão do mapa.');
  }
}

/** A decisão muda uma linha que já existia (e então exige o motivo). */
export const mapaMudaDecisao = (situacaoAntes: string | null, situacao: string): boolean =>
  situacaoAntes !== null && situacaoAntes !== situacao;

export type SituacaoPedidoAcesso =
  'pendente' | 'aprovado-setor' | 'aprovado' | 'concedido' | 'recusado' | 'cancelado';

export interface PedidoAcessoGravado {
  readonly id: string;
  readonly login: string;
  readonly perfil: string;
  readonly setor: string;
  readonly inicio: string;
  readonly fim: string;
  readonly motivo: string;
  readonly situacao: SituacaoPedidoAcesso;
  readonly criadoEm: Date | null;
  readonly setorPor: string | null;
  readonly setorEm: Date | null;
  readonly acessosPor: string | null;
  readonly acessosEm: Date | null;
  readonly fechadoPor: string | null;
  readonly fechadoEm: Date | null;
  readonly motivoFechamento: string | null;
  readonly concessao: string | null;
}

/** A regra do domínio sobre o pedido lido sob trava; null = aceita. */
export type ValidarPedidoAcesso = (p: PedidoAcessoGravado) => { codigo: string; mensagem: string } | null;

export interface NovoPedidoAcessoGravar {
  readonly hospital: string;
  readonly login: string;
  readonly perfil: string;
  readonly setor: string;
  readonly inicio: string;
  readonly fim: string;
  readonly motivo: string;
  /** Hoje (AAAA-MM-DD) pelo relógio do servidor. */
  readonly hoje: string;
}

export interface DecisaoPedidoAcessoGravar {
  readonly hospital: string;
  readonly pedido: string;
  readonly decisao: 'aprovar' | 'recusar';
  readonly motivo: string;
  readonly por: string;
}

export interface FiltroPedidosAcesso {
  /** Só os pedidos deste login. */
  readonly login?: string;
  /** Só estas situações. */
  readonly situacoes?: readonly SituacaoPedidoAcesso[];
}

/** Teto de contas numa campanha (o hospital grande tem poucos milhares de contas ativas). */
export const ITENS_RECERT_MAXIMO = 5000;

export interface ItemRecertNovo {
  readonly login: string;
  readonly grupo: string | null;
  readonly perfis: readonly string[];
}

/** A regra da decisão (validarDecisaoRecert do domínio) sobre a campanha e o item lidos sob trava; null = aceita. */
export type ValidarDecisaoRecert = (
  situacao: SituacaoCampanhaRecert,
  item: ItemRecertLido,
) => { codigo: string; mensagem: string } | null;

export interface CampanhaRecertLida {
  readonly id: string;
  readonly escopo: EscopoRecert;
  readonly alvo: string | null;
  readonly prazo: string;
  readonly motivo: string;
  readonly situacao: SituacaoCampanhaRecert;
  readonly criadoPor: string;
  readonly criadoEm: Date | null;
  readonly fechadoPor: string | null;
  readonly fechadoEm: Date | null;
  readonly motivoFechamento: string | null;
}

export interface ItemRecertLido {
  readonly id: string;
  readonly login: string;
  readonly grupo: string | null;
  readonly perfis: string[];
  readonly decisao: DecisaoRecert | null;
  readonly acao: AcaoRecert | null;
  readonly perfil: string | null;
  readonly motivo: string | null;
  readonly decididoPor: string | null;
  readonly decididoEm: Date | null;
}

export interface NovaCampanhaRecertGravar {
  readonly hospital: string;
  readonly escopo: EscopoRecert;
  readonly alvo: string | null;
  readonly prazo: string;
  readonly motivo: string;
  readonly por: string;
  /** Hoje (AAAA-MM-DD) pelo relógio do servidor, para conferir o prazo. */
  readonly hoje: string;
  readonly itens: readonly ItemRecertNovo[];
}

export interface DecisaoRecertGravar {
  readonly hospital: string;
  readonly campanha: string;
  readonly login: string;
  readonly decisao: DecisaoRecert;
  readonly acao: AcaoRecert | null;
  readonly perfil: string | null;
  readonly motivo: string;
  readonly por: string;
}

export interface FechamentoRecertGravar {
  readonly hospital: string;
  readonly campanha: string;
  readonly situacao: 'encerrada' | 'cancelada';
  readonly motivo: string;
  readonly por: string;
}

export type TipoTarefaRhSgh = 'criar-acesso' | 'revisar-acesso' | 'suspender-acesso';

export interface VinculoRhLido {
  readonly id: number;
  readonly nome: string;
  readonly cargo: string;
  readonly funcao: string | null;
  readonly setor: string | null;
  readonly admissao: string;
  readonly desligamento: string | null;
  readonly usuario: number | null;
  /** Login do usuário do vínculo (null: sem usuário). */
  readonly login: string | null;
}

export interface MudancaRhLida {
  readonly id: number;
  readonly vinculo: number;
  readonly tipo: string;
  readonly vigencia: string;
  readonly antes: string | null;
  readonly depois: string | null;
}

export interface AfastamentoRhLido {
  readonly vinculo: number;
  /** 'ferias:<id das férias>' ou 'afastamento:<id do afastamento>' (estável: identifica a tarefa). */
  readonly ref: string;
  readonly natureza: 'ferias' | 'afastamento';
  readonly inicio: string;
  readonly fim: string | null;
}

export interface PerfilCargoRhLido {
  readonly id: string;
  readonly cargo: string;
  /** null: retirado. */
  readonly perfil: string | null;
  readonly situacao: 'vigente' | 'retirado';
  readonly motivo: string;
  readonly criadoPor: string;
  readonly criadoEm: Date | null;
}

export interface NovoPerfilCargoRh {
  readonly hospital: string;
  /** A chave normalizada (chaveCargoRh do domínio). */
  readonly cargo: string;
  /** null: retirar a sugestão do cargo. */
  readonly perfil: string | null;
  readonly motivo: string;
  readonly por: string;
}

export interface ResolucaoRhSghLida {
  readonly id: string;
  readonly tipo: TipoTarefaRhSgh;
  readonly vinculo: number;
  readonly ref: string;
  readonly situacao: 'feita' | 'dispensada';
  readonly login: string | null;
  readonly motivo: string;
  readonly resolvidoPor: string;
  readonly resolvidoEm: Date | null;
}

export interface NovaResolucaoRh {
  readonly hospital: string;
  readonly tipo: TipoTarefaRhSgh;
  readonly vinculo: number;
  readonly ref: string;
  readonly situacao: 'feita' | 'dispensada';
  readonly login: string | null;
  readonly motivo: string;
  readonly por: string;
}

export interface DadosRhLidos {
  readonly vinculos: VinculoRhLido[];
  readonly mudancas: MudancaRhLida[];
  readonly afastamentos: AfastamentoRhLido[];
  readonly resolucoes: ResolucaoRhSghLida[];
  readonly perfisCargo: PerfilCargoRhLido[];
}
