// W1-01 (parte 7), "Esqueci a senha" em autosserviço (mercado b; SBIS NGS1 por analogia ao dado sensível):
//   - o pedido (estabelecimento + login) responde SEMPRE a mesma mensagem, no mesmo tempo (o envio e a trilha correm
//     depois da resposta): ninguém descobre se a conta existe;
//   - limite de pedidos por hora por conta e por origem, contados ANTES de saber se a conta existe (a recusa 429 é a
//     mesma para qualquer login);
//   - o token tem 32 bytes aleatórios, vai só ao e-mail institucional pela porta de envio (o servidor de notificações),
//     fica guardado só como resumo SHA-256, vale `VALIDADE_TOKEN_RECUPERACAO_SEG` e é consumido de forma atômica (uso
//     único); um pedido novo da mesma conta invalida o anterior;
//   - usar o token gera a senha provisória da redefinição (receita acesso.redefinirSenha pelo executor, a política e o
//     reuso conferidos) e a troca fica obrigatória no próximo acesso;
//   - a chave `acesso.recuperacaoSenha` (com o pré-requisito do e-mail institucional) e a porta de envio decidem se o
//     botão aparece: desligada, a tela não mostra o "Esqueci a senha" e o pedido é recusado igual para todos.
// Senha, token e resumo nunca vão a log nem à trilha (a trilha do pedido leva só o login).
import { createHash, randomBytes } from 'node:crypto';
import {
  type DisponibilidadeRecuperacaoSenha,
  EVENTOS_AUDITAVEIS,
  type PedirRecuperacaoSenha,
  RESPOSTA_RECUPERACAO_SENHA,
  type RespostaPedidoRecuperacaoSenha,
  type ResultadoRecuperacaoSenha,
} from '@sgh/contratos';
import type { RegistradorTrilha } from '../autorizacao/trilha.js';
import type { FonteConfiguracao } from '../modulos/config/public-api.js';
import { ligadaNoEstabelecimento } from '../modulos/sadt/aplicacao/liberacao.js';
import { ErroProblema } from '../problema.filter.js';
import type { ArmazemSessao } from './armazem.js';
import { ErroSessao, type OrigemPedido, type ServicoSessao } from './servico-sessao.js';

export const CHAVE_RECUPERACAO_SENHA = 'acesso.recuperacaoSenha';
/** Validade do link do e-mail (15 minutos). */
export const VALIDADE_TOKEN_RECUPERACAO_SEG = 15 * 60;
/** Pedidos por conta em uma hora. */
export const PEDIDOS_POR_CONTA_HORA = 3;
/** Pedidos por origem (IP) em uma hora. */
export const PEDIDOS_POR_ORIGEM_HORA = 20;
const HORA_SEG = 3600;

/** O que o servidor de notificações recebe (o login e o token; o endereço é dele, lido da conta institucional). */
export interface MensagemRecuperacao {
  readonly rede: string;
  readonly estabelecimento: string;
  readonly login: string;
  readonly token: string;
  readonly validadeMinutos: number;
}

/**
 * Envio ao e-mail institucional (servidor de notificações, dependência do dono). Devolve se enviou: falso quando a
 * conta não existe, está bloqueada ou não tem e-mail institucional (o token é então descartado).
 */
export interface PortaEnvioRecuperacao {
  enviar(m: MensagemRecuperacao): Promise<boolean>;
}

/** Dev/ci: guarda as mensagens em memória (nada sai da VM); `existe` diz que contas "têm" e-mail. */
export function envioRecuperacaoMemoria(
  existe: (estabelecimento: string, login: string) => boolean = () => true,
): PortaEnvioRecuperacao & { readonly enviadas: MensagemRecuperacao[] } {
  const enviadas: MensagemRecuperacao[] = [];
  return {
    enviadas,
    enviar(m) {
      if (!existe(m.estabelecimento, m.login)) return Promise.resolve(false);
      enviadas.push(m);
      return Promise.resolve(true);
    },
  };
}

interface TokenGuardado {
  readonly estabelecimento: string;
  readonly login: string;
}

const resumo = (s: string) => createHash('sha256').update(s).digest('hex');
/** A conta como a entrada compara: um contador só por usuário, qualquer caixa. */
const contaNormalizada = (login: string) => login.trim().toUpperCase();

export class ServicoRecuperacaoSenha {
  private readonly emCurso = new Set<Promise<void>>();

  /** Testes: espera os envios que correm depois da resposta. */
  async aguardarEnvios(): Promise<void> {
    await Promise.all([...this.emCurso]);
  }

  constructor(
    private readonly sessao: ServicoSessao,
    private readonly armazem: ArmazemSessao,
    private readonly configuracao: FonteConfiguracao | null,
    private readonly envio: PortaEnvioRecuperacao | null,
    private readonly trilha: RegistradorTrilha | null,
    private readonly aviso: (mensagem: string, campos: Record<string, unknown>) => void = () => undefined,
  ) {}

  /** O "Esqueci a senha" aparece? (porta de envio, troca de senha pelo novo e a chave no estabelecimento) */
  async disponivel(rede: string, estabelecimento: string): Promise<DisponibilidadeRecuperacaoSenha> {
    if (!this.envio || !this.sessao.trocaSenhaDisponivel || !/^[a-z0-9]{1,10}$/.test(estabelecimento))
      return { disponivel: false };
    return {
      disponivel: await ligadaNoEstabelecimento(
        this.configuracao,
        rede,
        estabelecimento,
        CHAVE_RECUPERACAO_SENHA,
        '',
      ),
    };
  }

  private indisponivel(): ErroProblema {
    return new ErroProblema(
      'operacao-bloqueada',
      409,
      'Recuperação de senha indisponível',
      'A recuperação de senha não está disponível neste estabelecimento. Procure o gestor de acessos.',
    );
  }

  private chaveToken(rede: string, token: string): string {
    return `${rede}:recuperacao-senha:token:${resumo(token)}`;
  }

  private chaveUltimo(rede: string, estabelecimento: string, login: string): string {
    return `${rede}:recuperacao-senha:ultimo:${estabelecimento}:${contaNormalizada(login)}`;
  }

  /** Conta o pedido; acima do limite, a mesma recusa para qualquer login. */
  private async contar(chave: string, limite: number): Promise<void> {
    const n = await this.armazem.incrementar(chave, HORA_SEG);
    if (n > limite)
      throw new ErroProblema(
        'muitas-tentativas',
        429,
        'Muitos pedidos',
        'Aguarde e tente de novo mais tarde.',
      );
  }

  async pedir(
    rede: string,
    p: PedirRecuperacaoSenha,
    ip: string | null,
    origem: OrigemPedido,
  ): Promise<RespostaPedidoRecuperacaoSenha> {
    if (!(await this.disponivel(rede, p.estabelecimento)).disponivel) throw this.indisponivel();
    const envio = this.envio;
    if (!envio) throw this.indisponivel();
    await this.contar(
      `${rede}:recuperacao-senha:origem:${resumo(String(ip ?? 'sem-ip')).slice(0, 32)}`,
      PEDIDOS_POR_ORIGEM_HORA,
    );
    await this.contar(
      `${rede}:recuperacao-senha:conta:${p.estabelecimento}:${contaNormalizada(p.login)}`,
      PEDIDOS_POR_CONTA_HORA,
    );
    const token = randomBytes(32).toString('base64url');
    const chave = this.chaveToken(rede, token);
    const ultimo = this.chaveUltimo(rede, p.estabelecimento, p.login);
    const guardado: TokenGuardado = { estabelecimento: p.estabelecimento, login: p.login };
    // Depois da resposta: o tempo dela não depende de a conta existir.
    const tarefa = new Promise<void>((pronto) => setImmediate(pronto)).then(async () => {
      try {
        const anterior = await this.armazem.consumir(ultimo);
        if (anterior) await this.armazem.apagar(anterior);
        await this.armazem.gravar(chave, JSON.stringify(guardado), VALIDADE_TOKEN_RECUPERACAO_SEG);
        const enviou = await envio.enviar({
          rede,
          estabelecimento: p.estabelecimento,
          login: p.login,
          token,
          validadeMinutos: VALIDADE_TOKEN_RECUPERACAO_SEG / 60,
        });
        if (enviou) await this.armazem.gravar(ultimo, chave, VALIDADE_TOKEN_RECUPERACAO_SEG);
        else await this.armazem.apagar(chave);
        await this.trilha?.registrar({
          evento: EVENTOS_AUDITAVEIS.senhaRecuperacaoPedida.codigo,
          rede,
          hospital: p.estabelecimento,
          usuario: p.login.slice(0, 31),
          estacao: origem.estacao.slice(0, 80),
          correlacao: origem.correlacao,
          recurso: 'acesso.sessao',
          resultado: enviou ? 'sucesso' : 'falha',
        });
      } catch (e) {
        await this.armazem.apagar(chave).catch(() => undefined);
        this.aviso('recuperação de senha: envio falhou', {
          erro: e instanceof Error ? e.name : 'desconhecido',
        });
      }
    });
    this.emCurso.add(tarefa);
    void tarefa.finally(() => this.emCurso.delete(tarefa));
    return { mensagem: RESPOSTA_RECUPERACAO_SENHA };
  }

  /** O token do e-mail (uso único) vira a senha provisória; a troca fica obrigatória no próximo acesso. */
  async usar(rede: string, token: string, origem: OrigemPedido): Promise<ResultadoRecuperacaoSenha> {
    const bruto = await this.armazem.consumir(this.chaveToken(rede, token));
    if (!bruto)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Link inválido ou vencido',
        'O link de recuperação é inválido, já foi usado ou venceu. Peça outro em "Esqueci a senha".',
      );
    const t = JSON.parse(bruto) as TokenGuardado;
    await this.armazem.apagar(this.chaveUltimo(rede, t.estabelecimento, t.login)).catch(() => undefined);
    if (!(await this.disponivel(rede, t.estabelecimento)).disponivel) throw this.indisponivel();
    try {
      return await this.sessao.redefinirPorRecuperacao(rede, t.estabelecimento, t.login, origem);
    } catch (e) {
      if (e instanceof ErroSessao)
        throw new ErroProblema('operacao-bloqueada', 409, 'Senha não redefinida', e.detalhe);
      throw e;
    }
  }
}
