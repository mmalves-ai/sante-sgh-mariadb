// Fonte do login do ADMINISTRADOR DA PLATAFORMA (decisão do dono 2026-11-20, b): a credencial fica no banco plataforma
// (db/plataforma/0002, credencial_administrador_plataforma, argon2id), nunca no banco de um cliente. No login ele
// escolhe o cliente (ou há um só) e entra nele com todas as permissões (autorizacaoDoAtorPlataforma). Nada de
// usuário-espelho no banco do cliente.
//
// Regras de segurança:
// - login inexistente ou sem credencial: a mesma resposta de senha errada, com o custo de uma conferência;
// - a senha é conferida ANTES de qualquer outra coisa: "conta-impedida" e "cliente-indisponivel" só depois dela (quem
//   não tem a senha não descobre contas nem clientes);
// - senha errada soma em tentativas_falhas, contada pela CREDENCIAL encontrada (o id), no banco plataforma, sem o
//   cliente: nenhuma grafia do login nem a API de outro cliente dá rodada nova. No limite arma bloqueado_ate e volta a
//   zero; com o bloqueio armado nada mais conta (ele vence sozinho). O login certo zera a contagem;
// - cliente ativo = situação implantação, homologação ou produção (suspenso e encerrado ficam fora).
// Nenhum log leva login, nome, e-mail ou senha.
import { conferirSenha } from '@sgh/dominio-acesso';
import type { Escritor, Leitor } from '@sgh/nucleo';
import type {
  AutenticacaoPlataforma,
  FontePlataforma,
  SituacaoAdministradorPlataforma,
} from './tipos-acesso.js';

/**
 * O que a fonte usa do núcleo: leitura e escrita no banco plataforma. É a forma de `NucleoProprio.lerPlataforma` e
 * `escreverPlataforma` (os testes trocam).
 */
export interface NucleoPlataforma {
  lerPlataforma<T>(correlacao: string, fn: (l: Leitor) => Promise<T>): Promise<T>;
  escreverPlataforma<T>(correlacao: string, fn: (e: Escritor) => Promise<T>, confirmar?: boolean): Promise<T>;
}

/** O núcleo dá acesso ao banco plataforma? (null: o login da plataforma fica indisponível, 503). */
export function nucleoPlataforma(nucleo: unknown): NucleoPlataforma | null {
  const n = nucleo as Partial<NucleoPlataforma> | null | undefined;
  return n && typeof n.lerPlataforma === 'function' && typeof n.escreverPlataforma === 'function'
    ? (n as NucleoPlataforma)
    : null;
}

/** Situações de plataforma.cliente em que o cliente atende (ck_cliente_situacao). */
export const SITUACOES_CLIENTE_ATIVO: readonly string[] = ['implantacao', 'homologacao', 'producao'];

/** Limite de senhas erradas seguidas e prazo do bloqueio da credencial da plataforma. */
export interface OpcoesFontePlataforma {
  readonly limiteTentativas: number;
  readonly bloqueioSegundos: number;
}
export const OPCOES_FONTE_PLATAFORMA_PADRAO: OpcoesFontePlataforma = {
  limiteTentativas: 5,
  bloqueioSegundos: 900,
};

const bool = (v: unknown): boolean => v === true || Number(v) === 1;
const data = (v: unknown): Date | null => (v instanceof Date ? v : v ? new Date(String(v)) : null);

interface LinhaCredencial {
  readonly id: unknown;
  readonly nome: unknown;
  readonly ativo: unknown;
  readonly resumo_senha: unknown;
  readonly troca_obrigatoria: unknown;
  readonly bloqueado_ate: unknown;
  readonly senha_alterada_em: unknown;
  [k: string]: unknown;
}

const SQL_CREDENCIAL = `SELECT a.id, a.nome, a.ativo, c.resumo_senha, c.troca_obrigatoria, c.bloqueado_ate,
       c.senha_alterada_em
  FROM credencial_administrador_plataforma c
  JOIN administrador_plataforma a ON a.id = c.administrador_plataforma_id`;

export class FontePlataformaPropria implements FontePlataforma {
  constructor(
    private readonly nucleo: NucleoPlataforma,
    private readonly agora: () => Date = () => new Date(),
    private readonly aviso: (mensagem: string, campos: Record<string, unknown>) => void = () => undefined,
    private readonly opcoes: OpcoesFontePlataforma = OPCOES_FONTE_PLATAFORMA_PADRAO,
  ) {}

  async clientes(): Promise<readonly string[]> {
    const linhas = await this.nucleo.lerPlataforma('plataforma-clientes', (l) =>
      l.consultar<{ codigo: string }>(
        `SELECT codigo FROM cliente WHERE situacao IN (${SITUACOES_CLIENTE_ATIVO.map(() => '?').join(', ')}) ORDER BY codigo`,
        SITUACOES_CLIENTE_ATIVO,
      ),
    );
    return linhas.map((x) => String(x.codigo));
  }

  private bloqueada(l: LinhaCredencial): boolean {
    const ate = data(l.bloqueado_ate);
    return ate !== null && ate.getTime() > this.agora().getTime();
  }

  private impedida(l: LinhaCredencial): boolean {
    return !bool(l.ativo) || this.bloqueada(l);
  }

  async autenticar(login: string, senha: string, cliente: string): Promise<AutenticacaoPlataforma> {
    const lido = await this.nucleo.lerPlataforma('plataforma-login', async (l) => {
      const cred = await l.uma<LinhaCredencial>(`${SQL_CREDENCIAL} WHERE c.login = ?`, [login]);
      const cli = await l.uma<{ situacao: string }>('SELECT situacao FROM cliente WHERE codigo = ?', [
        cliente,
      ]);
      return { cred, cli };
    });
    const { cred, cli } = lido;
    // Sempre uma conferência (login inexistente custa o mesmo que senha errada).
    const ok = await conferirSenha(senha, cred ? String(cred.resumo_senha) : null);
    if (!cred || !ok) {
      if (cred && !this.bloqueada(cred)) await this.contarFalha(Number(cred.id));
      return { desfecho: 'credencial-invalida' };
    }
    if (this.impedida(cred)) return { desfecho: 'conta-impedida' };
    await this.zerarFalhas(Number(cred.id));
    if (!cli || !SITUACOES_CLIENTE_ATIVO.includes(String(cli.situacao)))
      return { desfecho: 'cliente-indisponivel' };
    return {
      desfecho: 'ok',
      ator: {
        tipo: 'plataforma',
        idAdministrador: Number(cred.id),
        nomeExibicao: String(cred.nome),
        cliente,
        trocaObrigatoria: bool(cred.troca_obrigatoria),
        senhaAlteradaEm: data(cred.senha_alterada_em)?.getTime() ?? 0,
      },
    };
  }

  async conferir(idAdministrador: number, senha: string): Promise<boolean> {
    const cred = await this.nucleo.lerPlataforma('plataforma-reautenticar', (l) =>
      l.uma<LinhaCredencial>(`${SQL_CREDENCIAL} WHERE a.id = ?`, [idAdministrador]),
    );
    const ok = await conferirSenha(senha, cred ? String(cred.resumo_senha) : null);
    if (!cred) return false;
    if (!ok) {
      if (!this.bloqueada(cred)) await this.contarFalha(idAdministrador);
      return false;
    }
    if (this.impedida(cred)) return false;
    await this.zerarFalhas(idAdministrador);
    return true;
  }

  async situacao(idAdministrador: number): Promise<SituacaoAdministradorPlataforma | null> {
    const cred = await this.nucleo.lerPlataforma('plataforma-situacao', (l) =>
      l.uma<LinhaCredencial>(`${SQL_CREDENCIAL} WHERE a.id = ?`, [idAdministrador]),
    );
    if (!cred) return null;
    return { ativo: bool(cred.ativo), senhaAlteradaEm: data(cred.senha_alterada_em)?.getTime() ?? 0 };
  }

  async gravarSenha(
    idAdministrador: number,
    resumo: string,
    correlacao: string,
    cliente: string,
  ): Promise<number> {
    if (!resumo.startsWith('$argon2id$')) throw new Error('Resumo de senha fora do formato argon2id.');
    const agora = this.agora();
    return this.nucleo.escreverPlataforma(correlacao.slice(0, 64) || 'plataforma-senha', async (e) => {
      const n = await e.executar(
        `UPDATE credencial_administrador_plataforma
            SET resumo_senha = ?, senha_alterada_em = ?, troca_obrigatoria = FALSE, tentativas_falhas = 0,
                bloqueado_ate = NULL, alterado_em = ?, alterado_por = ?, versao = versao + 1
          WHERE administrador_plataforma_id = ?`,
        [resumo, agora, agora, idAdministrador, idAdministrador],
      );
      if (n !== 1) throw new Error('Credencial do administrador da plataforma não encontrada.');
      // Linha do tempo do cliente em que a troca aconteceu (sem a senha nem o resumo; o login não é dado pessoal
      // aqui, mas fica de fora: o id do administrador basta).
      const ev = await e.executar(
        `INSERT INTO cliente_evento (cliente_id, tipo, detalhe, ocorrido_em, administrador_plataforma_id, criado_em,
                                     criado_por)
         SELECT id, 'senha_administrador_trocada', JSON_OBJECT('correlacao', ?), ?, ?, ?, ?
           FROM cliente WHERE codigo = ?`,
        [correlacao.slice(0, 64), agora, idAdministrador, agora, idAdministrador, cliente],
      );
      if (ev !== 1) throw new Error('Cliente da troca de senha não encontrado na plataforma.');
      const lida = await e.uma<{ senha_alterada_em: unknown }>(
        'SELECT senha_alterada_em FROM credencial_administrador_plataforma WHERE administrador_plataforma_id = ?',
        [idAdministrador],
      );
      return data(lida?.senha_alterada_em)?.getTime() ?? 0;
    });
  }

  /**
   * Senha errada: soma na credencial; no limite arma o bloqueio e volta a zero (uma instrução: as atribuições leem o
   * valor anterior de tentativas_falhas, a primeira por ser a primeira e a segunda por bloqueado_ate ser outra
   * coluna). Falha de banco só avisa: a contagem do serviço de sessão continua valendo.
   */
  private async contarFalha(idAdministrador: number): Promise<void> {
    const limite = Math.max(1, this.opcoes.limiteTentativas);
    const ate = new Date(this.agora().getTime() + this.opcoes.bloqueioSegundos * 1000);
    try {
      await this.nucleo.escreverPlataforma('plataforma-login-falha', (e) =>
        e.executar(
          `UPDATE credencial_administrador_plataforma
              SET bloqueado_ate = IF(tentativas_falhas + 1 >= ?, ?, bloqueado_ate),
                  tentativas_falhas = IF(tentativas_falhas + 1 >= ?, 0, LEAST(tentativas_falhas + 1, 65535))
            WHERE administrador_plataforma_id = ?`,
          [limite, ate, limite, idAdministrador],
        ),
      );
    } catch (e) {
      this.aviso('plataforma: tentativa falha não contada', { erro: e instanceof Error ? e.name : 'erro' });
    }
  }

  /** Senha certa e conta liberada: a contagem volta a zero (o bloqueio vencido sai junto). */
  private async zerarFalhas(idAdministrador: number): Promise<void> {
    try {
      await this.nucleo.escreverPlataforma('plataforma-login-ok', (e) =>
        e.executar(
          `UPDATE credencial_administrador_plataforma SET tentativas_falhas = 0, bloqueado_ate = NULL
            WHERE administrador_plataforma_id = ? AND (tentativas_falhas <> 0 OR bloqueado_ate IS NOT NULL)`,
          [idAdministrador],
        ),
      );
    } catch (e) {
      this.aviso('plataforma: contagem de tentativas não zerada', {
        erro: e instanceof Error ? e.name : 'erro',
      });
    }
  }
}
