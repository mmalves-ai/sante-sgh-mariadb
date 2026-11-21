// Tipos de negócio da identidade (M59-F2): a conta, a credencial forte, o segundo fator e a política do segundo fator,
// como a porta os entrega ao serviço. Sem coluna antiga, sem S/N, sem sentinela: booleano, data e id.
// "Senha anterior" é a credencial guardada num algoritmo mais fraco que o Argon2id (bcrypt ou scrypt, vinda da
// migração). Decisão (lote 02-03): o sistema só confere Argon2id; no banco, a senha anterior é de REDEFINIÇÃO
// OBRIGATÓRIA pelo gestor (redefinicaoObrigatoria), nunca convertida no login. A conversão no primeiro login só existe
// na fonte sintética do dev/ci, que confere a senha anterior por conta própria.
// Nada de senha, resumo de senha ou segredo sai daqui: só a situação.

/** A conta e a situação da senha anterior (sem valor nenhum). */
export interface ContaIdentidade {
  readonly login: string;
  readonly id: number;
  readonly nomeExibicao: string;
  readonly ativo: boolean;
  readonly bloqueado: boolean;
  /** Perfis de acesso vigentes no estabelecimento (códigos, para a tela) ou null. */
  readonly grupo: string | null;
  /** Há senha anterior (algoritmo mais fraco que o Argon2id) a converter. */
  readonly senhaPresente: boolean;
  readonly criptografada: boolean;
  readonly comSalt: boolean;
  readonly senhaAlteradaEm: Date | null;
  /**
   * A credencial está num algoritmo que o sistema não confere (não Argon2id): o login recusa sem conferir nada e só a
   * redefinição pelo gestor devolve o acesso. Ausente: a senha anterior, se houver, é conferida pela fonte de acesso.
   */
  readonly redefinicaoObrigatoria?: boolean;
}

/** A credencial forte viva (Argon2id), sem o resumo da senha. */
export interface CredencialForte {
  readonly id: string;
  readonly algoritmo: string;
  /** "m=65536,t=3,p=1": só os parâmetros. */
  readonly parametros: string;
  /** 'senha-provisoria' obriga a troca no próximo acesso. */
  readonly origem: string;
  readonly criadaEm: Date;
}

export type SituacaoSegundoFatorRegistrado = 'pendente' | 'ativo' | 'revogado';

export interface SegundoFatorRegistrado {
  readonly id: string;
  readonly situacao: SituacaoSegundoFatorRegistrado;
  /** Segredo TOTP cifrado em envelope (só o serviço com a chave mestra decifra). */
  readonly segredoEnvelope: string;
  readonly digitos: number;
  readonly passoSegundos: number;
  readonly criadoEm: Date | null;
  readonly confirmadoEm: Date | null;
  readonly ultimaVerificacao: Date | null;
}

export type AlvoPolitica2fa = 'perfil' | 'grupo' | 'todos';

export interface LinhaPolitica2faRegistrada {
  readonly id: string;
  readonly hospital: string;
  readonly alvo: AlvoPolitica2fa;
  readonly valor: string | null;
  readonly onda: 1 | 2;
  /** AAAA-MM-DD. */
  readonly inicio: string;
  readonly prazoAdesaoDias: number;
  readonly motivo: string;
  readonly criadaPor: string;
  readonly criadaEm: Date | null;
  readonly encerradaEm: Date | null;
  /**
   * 'cadastro-perfil': a exigência vem do perfil de acesso (exige segundo fator ou privilegiado), sem início nem prazo
   * definidos pelo gestor: vale como ADESÃO sem prazo (entrar e cadastrar), nunca como obrigatório imediato. Ausente:
   * linha da política por onda.
   */
  readonly origem?: 'politica' | 'cadastro-perfil';
}

export interface UsuarioIdentidadeRegistrado extends ContaIdentidade {
  readonly forteEm: Date | null;
  readonly forteAlgoritmo: string | null;
  readonly segundoFator: SituacaoSegundoFatorRegistrado | 'ausente';
}

/** Grupo de contagem agregada (só classes; o serviço classifica com a regra pura e põe em faixa). */
export interface GrupoContagemIdentidade {
  readonly senhaPresente: boolean;
  readonly criptografada: boolean;
  readonly comSalt: boolean;
  readonly forteVigente: boolean;
  readonly segundoFator: SituacaoSegundoFatorRegistrado | 'ausente';
  readonly n: number;
}

/** De onde veio a credencial viva; 'senha-provisoria' obriga a troca no próximo acesso. */
export type OrigemCredencialForte = 'primeiro-login' | 'troca-senha' | 'senha-provisoria';

export interface NovaCredencialForte {
  readonly idUsuario: number;
  readonly login: string;
  /** Texto PHC do Argon2id (o sal vai dentro). */
  readonly hashPhc: string;
  readonly algoritmo: string;
  readonly parametros: string;
  readonly origem: OrigemCredencialForte;
}

export interface NovaLinhaPolitica2fa {
  readonly hospital: string;
  readonly alvo: AlvoPolitica2fa;
  readonly valor: string | null;
  readonly onda: 1 | 2;
  readonly inicio: string;
  readonly prazoAdesaoDias: number;
  readonly motivo: string;
  readonly criadaPor: string;
}

export interface AlteracaoPolitica2fa {
  readonly id: string;
  readonly hospital: string;
  readonly por: string;
  readonly alvo: AlvoPolitica2fa;
  readonly valor: string | null;
  readonly prazoAdesaoDias: number;
  readonly motivo: string;
}

/** Quem age e de onde, para a trilha da gravação (o evento auditável e a correlação). */
export interface TrilhaIdentidade {
  readonly rede: string;
  readonly hospital: string;
  readonly usuario: string;
  /** Id da conta de quem age (o contexto da gravação). */
  readonly idUsuario: number;
  readonly evento: string;
  readonly recurso: string;
  readonly operacao: string;
  readonly resultado: string;
  readonly estacao: string | null;
  readonly correlacao: string;
}
