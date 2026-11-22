// Tipos de negócio das telas do M10 (Administração › Acesso, Organização e parâmetros, Auditoria e privacidade;
// Cadastros › Estrutura): o que a fonte devolve aos controladores, com vocabulário neutro (booleano, data ISO, id
// numérico, número de negócio). Substituem os tipos lidos do sistema de origem (F2.2, lote 02-05).
// Melhoria: o contexto das gravações leva o usuário por id e a chave de idempotência do núcleo (nada de login como
// chave da trilha).
// Melhoria: a trilha é uma só (trilha_auditoria do produto); a junção de duas trilhas e o "espelho" das tabelas de
// origem saíram (ADR 0003: nada de convivência).
import { esquemaAlterarFlagsUsuario, esquemaAlterarUsuario, esquemaCriarUsuario } from '@sgh/contratos';
import { z } from 'zod';

/** Contexto de leitura da fonte: a rede, o estabelecimento (código) da sessão e a correlação da requisição. */
export interface Ctx {
  readonly rede: string;
  readonly hospital: string;
  readonly traceId: string;
}

/** Contexto de uma gravação da gestão (o operador da sessão; o estabelecimento pode ser outro da mesma rede). */
export interface ContextoGestao {
  readonly rede: string;
  readonly hospital: string;
  readonly correlacao: string;
  readonly login: string;
  /** usuario.id do operador (null: conta sintética ou administrador da plataforma). */
  readonly usuario: number | null;
  readonly chaveIdempotencia: string;
  readonly estacao: string;
  readonly reautenticadoEm?: number;
}

/** A linha da trilha que a tela pede às gravações que não passam pelo Executor (memória e registrador da API). */
export interface TrilhaGestao {
  readonly rede: string;
  readonly hospital: string;
  readonly usuario: string;
  readonly evento: string;
  readonly recurso: string;
  readonly operacao: string;
  readonly resultado: 'sucesso' | 'falha';
  readonly estacao: string;
  readonly correlacao: string;
}

/** Estado de uma operação de gravação no produto: existe e está ligada, ou ainda não tem implementação. */
export interface EstadoOperacaoGestao {
  readonly estado: 'ligada' | 'pendente' | null;
  readonly ligada: boolean;
  readonly motivo: string | null;
}

export class ErroSetor extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroSetor';
  }
}

export class ErroPedido extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroPedido';
  }
}

// ── Acesso ─────────────────────────────────────────────────────────────────────────────────────────────────────
export interface FiltroUsuarios {
  readonly busca?: string;
  readonly grupo?: string;
  readonly situacao?: 'todos' | 'ativos' | 'inativos' | 'bloqueados';
  readonly pagina: number;
  readonly porPagina: number;
}

export interface UsuarioLinha {
  readonly login: string;
  readonly nome: string | null;
  /** O perfil principal do usuário (código do perfil de acesso). */
  readonly grupo: string | null;
  readonly ativo: boolean;
  readonly bloqueado: boolean;
  readonly ultimoAcesso: string | null;
}

export interface ItemEscopo {
  readonly valor: string;
  readonly rotulo: string;
}

export interface PapelUsuario {
  readonly papel: number;
  readonly nome: string;
  readonly ativo: boolean;
}

export interface FichaUsuario {
  readonly login: string;
  readonly id: number;
  readonly nome: string | null;
  readonly grupo: string | null;
  readonly ativo: boolean;
  readonly bloqueado: boolean;
  readonly cpfInformado: boolean;
  /** O CPF em 11 dígitos, só quando pedido (`opcoes.cpf`); null sem o pedido ou sem CPF. */
  readonly cpf: string | null;
  readonly senhaDefinida: boolean;
  /** A versão do registro (trava otimista), como texto, conferida pela gravação. */
  readonly versao: readonly string[];
  readonly grupoAtivo: boolean | null;
  readonly papeis: readonly PapelUsuario[];
  readonly escopos: Readonly<Record<string, readonly ItemEscopo[]>>;
  readonly escoposConsulta: { centrosCusto: number; locaisEstoque: number; contasBancarias: number };
  readonly flags: readonly { coluna: string; letra: string | null }[];
  readonly conexoes: readonly { modulo: number; nome: string; ultima: string }[];
  readonly termo: { aceitouVigente: boolean; aceitoEm: string | null };
  readonly historicoSenha: { trocas: number; ultima: string | null } | null;
  readonly profissionalVinculado: { id: number; nome: string } | null;
}

export interface ContaCpf {
  readonly login: string;
  readonly nome: string | null;
  readonly grupo: string | null;
  readonly ativo: boolean;
  readonly bloqueado: boolean;
}

export interface ContaRede extends ContaCpf {
  readonly perfis: string[];
}

export interface GrupoLido {
  readonly nome: string;
  readonly ativo: boolean;
  readonly usuariosAtivos: number;
}

/** Uma ação do catálogo do sistema (o nó da árvore de permissões). */
export interface AcaoMenu {
  readonly id: number;
  readonly modulo: number;
  readonly indice: number;
  readonly nivel: number;
  readonly ativo: boolean;
  readonly avulsa: boolean;
  readonly nome: string;
  readonly titulo: string;
}

export interface ModuloSistema {
  readonly id: number;
  readonly sistema: string;
  readonly executavel: string | null;
  readonly nome: string;
}

export interface PoliticaLogin {
  readonly senha: {
    readonly minimoCaracteres: number | null;
    readonly exigeLetra: boolean;
    readonly exigeNumero: boolean;
    readonly exigeEspecial: boolean;
    readonly exigeMinuscula: boolean;
    readonly exigeMaiuscula: boolean;
    readonly periodoTrocaDias: number | null;
    readonly periodoReutilizacaoDias: number | null;
  };
  readonly tempo: { readonly inatividadeSegundos: number | null; readonly avisoSegundos: number | null };
  readonly limiteTentativas: number | null;
  readonly termoPeriodico: boolean;
  readonly quantidadePeriodoTermo: number | null;
  readonly tipoPeriodoTermo: 'dias' | null;
}

export interface TermoVigenteLido {
  readonly id: number;
  readonly texto: string;
  readonly desde: string;
  readonly aceites: number;
  readonly ultimos: { login: string; em: string }[];
}

export interface VersaoTermoLida {
  readonly id: number;
  readonly desde: string;
  readonly vigente: boolean;
  readonly publicadoPor: string;
  readonly aceites: number;
}

export interface VersaoTermoDetalhe {
  readonly id: number;
  readonly texto: string;
  readonly desde: string;
  readonly vigente: boolean;
  readonly aceites: number;
  readonly pagina: number;
  readonly itens: readonly { login: string; em: string }[];
}

export interface QuebraVidro {
  readonly id: string;
  readonly login: string;
  readonly idPaciente: number | null;
  readonly prontuario: number | null;
  readonly motivo: string | null;
  readonly justificativa: string | null;
  readonly inicio: Date | null;
  readonly fim: Date | null;
  readonly revisao: { classificacao: string; por: string; em: Date } | null;
}

export interface PedidoSetor {
  readonly rede: string;
  readonly hospital: string;
  readonly idUsuario: number;
  readonly login: string;
  readonly bloco: string;
  readonly por: string;
}

// ── Estrutura ──────────────────────────────────────────────────────────────────────────────────────────────────
export interface EstruturaLida {
  readonly empresa: { codigo: number; nome: string; cnpj: string | null; ativa: boolean } | null;
  readonly hospital: {
    codigo: number;
    nome: string;
    cnes: number | null;
    cnpj: string | null;
    municipio: string | null;
    uf: string | null;
    esfera: string | null;
    complexidade: string | null;
    fusoHorario: string | null;
  } | null;
  readonly unidades: readonly { codigo: number; nome: string; cnes: number | null; ativa: boolean }[];
}

export interface AcomodacaoLida {
  readonly bloco: string;
  readonly acomodacao: string;
  readonly nome: string;
  readonly andar: number | null;
  readonly leitosPrevistos: number | null;
  readonly sexo: string | null;
  readonly tipo: number | null;
  readonly convenio: string | null;
  readonly centroCusto: number | null;
  readonly localConta: number | null;
  readonly versao: number;
}

export interface LeitoLido {
  readonly id: number;
  readonly bloco: string;
  readonly acomodacao: string;
  readonly leito: string;
  readonly ativo: boolean;
  readonly ocupado: boolean;
  readonly ramal: number | null;
  readonly andar: number | null;
  readonly versao: number;
}

export interface LeitosLidos {
  readonly blocos: readonly { bloco: string; nome: string; andares: number | null }[];
  readonly acomodacoes: readonly AcomodacaoLida[];
  readonly leitos: readonly LeitoLido[];
  readonly opcoes: {
    tipos: { valor: number; rotulo: string }[];
    centrosCusto: { valor: number; rotulo: string }[];
    locaisConta: { valor: number; rotulo: string }[];
    tiposTiss: { valor: number; rotulo: string }[];
  };
}

export interface LocaisComplementos {
  readonly guiches: readonly { numero: number; recepcao: string }[];
  /** null: sem tabela no modelo próprio (pedido registrado); nunca um zero inventado. */
  readonly horarios: number | null;
  readonly encaminhamentos: number;
  readonly pesquisados: number | null;
}

// ── Consultas ──────────────────────────────────────────────────────────────────────────────────────────────────
export interface AlertaLido {
  readonly id: number;
  readonly nome: string;
  readonly ativo: boolean;
  readonly origem: 'paciente' | 'sistema';
  readonly exibicao: number | null;
  readonly idadeInicial: number | null;
  readonly idadeFinal: number | null;
  readonly cenario: string | null;
  readonly gatilhos: { opcao: string; evento: string }[];
  readonly usuarios: number;
}

export interface ServidoresEmail {
  readonly servidores: {
    id: number;
    servidor: string;
    porta: number;
    ssl: boolean;
    usuarioDefinido: boolean;
    senhaDefinida: boolean;
  }[];
  readonly modulos: { id: number; nome: string }[];
}

export interface DadosFiscaisLidos {
  readonly codigo: number;
  readonly nome: string;
  readonly cnpj: string | null;
  readonly inscricaoEstadual: string | null;
  readonly inscricaoMunicipal: string | null;
  readonly cnae: string | null;
  readonly municipio: string | null;
  readonly uf: string | null;
  readonly optanteSimples: boolean;
  readonly registroAns: number | null;
  readonly tipoEmpresa: string | null;
  readonly cooperativa: string | null;
  readonly construtora: string | null;
  readonly ativa: boolean;
}

export interface BackupLido {
  readonly situacoes: { id: number; descricao: string }[];
  readonly procedimentos: { id: number; descricao: string }[];
}

// ── Auditoria ──────────────────────────────────────────────────────────────────────────────────────────────────
export interface FiltroTrilha {
  readonly hospital: string;
  /** Início do período (inclusivo) e fim exclusivo (dia seguinte ao último), AAAA-MM-DD. */
  readonly inicio: string;
  readonly fimExclusivo: string;
  readonly usuario?: string;
  readonly evento?: string;
  readonly paciente?: number;
  /** Quantas linhas trazer (a página pedida mais uma, para o "tem mais"). */
  readonly limite: number;
}

export interface LinhaTrilhaLida {
  readonly id: string;
  readonly dataHora: string;
  readonly usuario: string | null;
  readonly acao: string;
  readonly opcao: string | null;
  readonly criticidade: string | null;
  readonly estacao: string | null;
  readonly alvo: string | null;
  readonly paciente: number | null;
  readonly resultado: string | null;
  readonly atorReal: string | null;
}

export interface AcessoProntuarioLido extends LinhaTrilhaLida {
  readonly atendimento: number | null;
  readonly prontuario: number | null;
}

/** Um tipo de registro excluído (a entidade do registro_excluido), com o rótulo da tela. */
export interface RegistroAuditoria {
  readonly chave: string;
  readonly rotulo: string;
  /** O registro guarda quem excluiu. */
  readonly comUsuario: boolean;
}

export interface FiltroRegistros {
  readonly inicio: string;
  readonly fimExclusivo: string;
  readonly usuario?: string;
  readonly pagina: number;
  readonly porPagina: number;
}

export interface RegistroExclusaoLido {
  readonly dataHora: string;
  readonly usuario: string | null;
  readonly registro: number | null;
  readonly justificativa: string | null;
}

export interface ConexaoLida {
  readonly dataHora: string;
  readonly usuario: string;
  readonly modulo: number;
  readonly nome: string;
}

export interface ExclusoesLidas {
  tipos: { chave: string; rotulo: string; quantidade: number }[];
  conexoes: { modulo: number; nome: string; usuarios: number }[];
}

/** Chave de um tipo de registro excluído: o nome da entidade no modelo (minúsculas e _). */
export const CHAVE_REGISTRO = /^[a-z][a-z0-9_]{0,63}$/;

/** O tipo de registro pela chave (a entidade); o rótulo é a entidade legível. */
export function registroDaChave(chave: string): RegistroAuditoria | null {
  if (!CHAVE_REGISTRO.test(chave)) return null;
  const rotulo = chave.replace(/_/g, ' ');
  return { chave, rotulo: rotulo.charAt(0).toUpperCase() + rotulo.slice(1), comUsuario: true };
}

export interface PedidoTitularLido {
  readonly id: string;
  readonly protocolo: string;
  readonly tipo: string;
  readonly canal: string;
  readonly situacao: string;
  /** null: titular que não é paciente (pedido pelo portal ou por integração). */
  readonly idPaciente: number | null;
  readonly prontuario: number | null;
  readonly abertoEm: Date;
  readonly prazo: Date;
  readonly identidadeVerificada: boolean;
  readonly fundamento: string | null;
  readonly decididoPor: string | null;
  readonly decididoEm: Date | null;
  readonly registradoPor: string;
  readonly versao: number;
  readonly motivoCancelamento: string | null;
}

export interface NovoPedido {
  readonly rede: string;
  readonly hospital: string;
  /** O titular pelo número do prontuário ou pelo id do paciente; um dos dois. */
  readonly idPaciente?: number;
  readonly prontuario?: number;
  readonly tipo: string;
  readonly canal: string;
  readonly descricao: string | null;
  readonly por: string;
  readonly prazoDias: number;
  /** usuario.id de quem registra e a chave de idempotência do pedido. */
  readonly usuario?: number | null;
  readonly chave?: string;
}

export interface DecisaoPedido {
  readonly id: string;
  readonly acao: 'confirmar-identidade' | 'atender' | 'negar';
  readonly fundamento: string | null;
  readonly resposta: string | null;
  readonly por: string;
  readonly usuario?: number | null;
  readonly chave?: string;
  /** Regra pura da transição (@sgh/dominio-acesso), aplicada sobre a linha travada; devolve a recusa ou null. */
  readonly conferir: (p: PedidoTitularLido) => string | null;
}

// ── Operações de gravação da gestão (nome → entrada e trilha) ────────────────────────────────────────────────────
const livre = z.record(z.string(), z.unknown());
const login = z.string().trim().min(1).max(60);

/** As operações de gravação da gestão de acesso e da organização, com a entrada e o evento da trilha. */
export const OPERACOES_GESTAO: Readonly<
  Record<string, { readonly evento: string; readonly recurso: string; readonly entrada: z.ZodType }>
> = {
  'acesso.criarUsuario': {
    evento: 'acesso.usuario.criado',
    recurso: 'acesso.usuario',
    entrada: esquemaCriarUsuario,
  },
  'acesso.alterarUsuario': {
    evento: 'acesso.usuario.alterado',
    recurso: 'acesso.usuario',
    entrada: esquemaAlterarUsuario,
  },
  'acesso.alterarFlagsUsuario': {
    evento: 'acesso.usuario.alterado',
    recurso: 'acesso.usuario',
    entrada: esquemaAlterarFlagsUsuario,
  },
  'acesso.bloquearUsuario': {
    evento: 'acesso.usuario.bloqueado',
    recurso: 'acesso.usuario',
    entrada: z.object({ login, motivo: z.string().max(500).optional() }).strict(),
  },
  'acesso.desbloquearUsuario': {
    evento: 'acesso.usuario.desbloqueado',
    recurso: 'acesso.usuario',
    entrada: z.object({ login, motivo: z.string().max(500).optional() }).strict(),
  },
  'acesso.publicarTermo': {
    evento: 'acesso.termo.publicado',
    recurso: 'acesso.termo',
    entrada: z
      .object({ termoAnterior: z.number().int().nullable(), texto: z.string().min(1).max(1_000_000) })
      .passthrough(),
  },
  'acesso.aceitarTermo': {
    evento: 'acesso.termo.aceito',
    recurso: 'acesso.termo',
    entrada: z.object({ termo: z.number().int().positive() }).passthrough(),
  },
  'acesso.concederOpcoesGrupo': { evento: 'acesso.grupo.alterado', recurso: 'acesso.grupo', entrada: livre },
  'acesso.revogarOpcoesGrupo': { evento: 'acesso.grupo.alterado', recurso: 'acesso.grupo', entrada: livre },
  'acesso.concederPapelUsuario': {
    evento: 'acesso.usuario.alterado',
    recurso: 'acesso.usuario',
    entrada: livre,
  },
  'acesso.revogarPapelUsuario': {
    evento: 'acesso.usuario.alterado',
    recurso: 'acesso.usuario',
    entrada: livre,
  },
  'acesso.reativarPapelUsuario': {
    evento: 'acesso.usuario.alterado',
    recurso: 'acesso.usuario',
    entrada: livre,
  },
  'acesso.trocarGrupoUsuario': {
    evento: 'acesso.usuario.alterado',
    recurso: 'acesso.usuario',
    entrada: livre,
  },
  'organizacao.incluirAcomodacao': {
    evento: 'organizacao.leito.alterado',
    recurso: 'organizacao.leito',
    entrada: livre,
  },
  'organizacao.alterarAcomodacao': {
    evento: 'organizacao.leito.alterado',
    recurso: 'organizacao.leito',
    entrada: livre,
  },
  'organizacao.incluirLeito': {
    evento: 'organizacao.leito.alterado',
    recurso: 'organizacao.leito',
    entrada: livre,
  },
  'organizacao.alterarLeito': {
    evento: 'organizacao.leito.alterado',
    recurso: 'organizacao.leito',
    entrada: livre,
  },
  'organizacao.inativarLeito': {
    evento: 'organizacao.leito.alterado',
    recurso: 'organizacao.leito',
    entrada: livre,
  },
  'organizacao.reativarLeito': {
    evento: 'organizacao.leito.alterado',
    recurso: 'organizacao.leito',
    entrada: livre,
  },
};
