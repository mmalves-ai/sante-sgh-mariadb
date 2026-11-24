// Família acesso-email (modulos-proprios-2): a porta de entrada por e-mail no BANCO PRÓPRIO.
//   - EnvioRecuperacaoPropria: o envio do "Esqueci a senha" (PortaEnvioRecuperacao) lendo o e-mail da conta ativa em
//     `usuario` (pessoa, não excluída) e mandando o link pela PortaEmailAcesso (captura local fora de produção);
//   - PreferenciaSegundoFatorPropria: a escolha do segundo fator do usuário (preferencia_segundo_fator, 02_ADM/96),
//     gravada pelo Executor com a trilha na mesma transação;
//   - SegundoFatorEmailUsuario: emite e confere o código de 6 dígitos ao e-mail do usuário (ServicoCodigoEmail);
//   - montarAcessoEmailProprio: monta, a partir do núcleo, os serviços que o controlador da entrada injeta
//     (SERVICO_RECUPERACAO_SENHA e SERVICO_TROCA_RAPIDA, com a PortaPinPropria) e os novos (código no e-mail e a
//     recuperação do administrador da plataforma). Quem liga é o app-base (arquivo compartilhado: integrador).
// O token, o código, a senha e os resumos nunca vão a log, resposta ou trilha.
import { randomUUID } from 'node:crypto';
import { definirOperacao, type Executor, type NucleoProprio, recusa, restricaoViolada } from '@sgh/nucleo';
import { z } from 'zod';
import type { RegistradorTrilha } from '../autorizacao/trilha.js';
import type { FonteConfiguracao } from '../modulos/config/public-api.js';
import type { ArmazemSessao } from './armazem.js';
import {
  contaUsuario,
  type DesfechoConferenciaCodigo,
  ehMetodoSegundoFator,
  type MetodoSegundoFator,
  ServicoCodigoEmail,
} from './codigo-email.js';
import { ENDERECO_EMAIL, type PortaEmailAcesso } from './email-acesso.js';
import { type NucleoPlataforma, nucleoPlataforma } from './fonte-plataforma.js';
import { PortaPinPropria, type ResolverEstabelecimentoPin } from './porta-pin-propria.js';
import { ServicoRecuperacaoPlataforma } from './recuperacao-plataforma.js';
import {
  type MensagemRecuperacao,
  type PortaEnvioRecuperacao,
  ServicoRecuperacaoSenha,
} from './recuperacao-senha.js';
import type { ServicoSessao } from './servico-sessao.js';
import {
  type FonteParametrosTrocaRapida,
  parametrosTrocaRapidaPelaConfiguracao,
  ServicoTrocaRapida,
} from './troca-rapida.js';

export type NucleoAcessoEmail = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;
export const TABELA_PREFERENCIA_SEGUNDO_FATOR = 'preferencia_segundo_fator';

const SQL_EMAIL_CONTA = `SELECT u.id, u.email FROM usuario u
 WHERE u.login = ? AND u.excluido_em IS NULL AND u.situacao = 'ativo' AND u.tipo_conta = 'pessoa'`;

/** O e-mail da conta ativa de pessoa (null: sem conta, inativa, de serviço ou sem e-mail válido). */
async function emailDaConta(
  nucleo: NucleoAcessoEmail,
  cliente: string,
  login: string,
): Promise<{ id: number; email: string } | null> {
  const r = await nucleo.lerSomente({ cliente, correlacao: 'acesso-email' }, (l) =>
    l.uma(SQL_EMAIL_CONTA, [login]),
  );
  const email = r ? String(r['email'] ?? '').trim() : '';
  return r && ENDERECO_EMAIL.test(email) ? { id: Number(r['id']), email } : null;
}

/** O envio do "Esqueci a senha" no banco próprio: falso quando a conta não existe, não está ativa ou não tem e-mail. */
export class EnvioRecuperacaoPropria implements PortaEnvioRecuperacao {
  constructor(
    private readonly nucleo: NucleoAcessoEmail,
    private readonly cliente: string,
    private readonly email: PortaEmailAcesso,
    /** Endereço da tela que recebe o token (ex.: https://host/recuperar-senha). */
    private readonly linkTela: string,
  ) {}

  async enviar(m: MensagemRecuperacao): Promise<boolean> {
    const conta = await emailDaConta(this.nucleo, this.cliente, m.login);
    if (!conta) return false;
    await this.email.enviar({
      para: conta.email,
      assunto: 'Recuperação de senha',
      texto:
        `Recebemos um pedido para redefinir a senha do usuário ${m.login} no estabelecimento ${m.estabelecimento}.\n\n` +
        `Para continuar, abra: ${this.linkTela}?token=${m.token}\n\n` +
        `O link vale por ${m.validadeMinutos} minutos e uma vez só. ` +
        'Se não foi você, ignore este e-mail: a senha atual continua valendo.\n',
    });
    return true;
  }
}

const ENTRADA = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));

/** Quem age e de onde, para a trilha da escolha do segundo fator. */
export interface AtorEscolha {
  readonly rede: string;
  readonly hospital: string;
  readonly login: string;
  readonly estacao: string | null;
  readonly correlacao: string;
}

/** A escolha do segundo fator do usuário (sem linha: aplicativo, o padrão de antes). */
export class PreferenciaSegundoFatorPropria {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoAcessoEmail,
    private readonly resolver: ResolverEstabelecimentoPin,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private onde(rede: string, hospital: string): { cliente: string; estabelecimento: number } {
    const r = this.resolver(rede, hospital);
    if (!r.cliente || r.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'O estabelecimento da sessão não está no banco do cliente.');
    return { cliente: r.cliente, estabelecimento: r.estabelecimento };
  }

  async metodo(rede: string, hospital: string, login: string): Promise<MetodoSegundoFator> {
    const o = this.onde(rede, hospital);
    const r = await this.nucleo.lerSomente(
      { cliente: o.cliente, estabelecimento: o.estabelecimento, correlacao: 'acesso-segundo-fator' },
      (l) =>
        l.uma(
          `SELECT p.metodo FROM preferencia_segundo_fator p JOIN usuario u ON u.id = p.usuario_id
            WHERE u.login = ? AND u.excluido_em IS NULL`,
          [login],
        ),
    );
    const m = r?.['metodo'];
    return ehMetodoSegundoFator(m) ? m : 'aplicativo';
  }

  /** Grava a escolha da própria conta (o chamador já reautenticou a sessão). Devolve o método anterior. */
  async escolher(a: AtorEscolha, metodo: MetodoSegundoFator): Promise<{ anterior: MetodoSegundoFator }> {
    if (!ehMetodoSegundoFator(metodo)) throw recusa('metodo-invalido', 'Método de segundo fator inválido.');
    const o = this.onde(a.rede, a.hospital);
    let alvo: number | null = null;
    let diferenca: string | null = null;
    const op = definirOperacao({
      nome: 'acesso.segundoFator.escolher',
      tabelas: [TABELA_PREFERENCIA_SEGUNDO_FATOR],
      entrada: ENTRADA,
      gravar: async (tx) => {
        const u = await tx.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [a.login]);
        if (!u) throw recusa('usuario-inexistente', 'A conta não existe neste cliente.');
        if (metodo === 'email') {
          const e = await tx.uma('SELECT email FROM usuario WHERE id = ?', [Number(u['id'])]);
          if (!ENDERECO_EMAIL.test(String(e?.['email'] ?? '').trim()))
            throw recusa('sem-email', 'Cadastre um e-mail na conta antes de escolher o código por e-mail.');
        }
        const [atual] = await tx.consultarParaAtualizar(
          'SELECT id, metodo, versao FROM preferencia_segundo_fator WHERE usuario_id = ?',
          [Number(u['id'])],
          { teto: 1 },
        );
        const anterior: MetodoSegundoFator = ehMetodoSegundoFator(atual?.['metodo'])
          ? (atual['metodo'] as MetodoSegundoFator)
          : 'aplicativo';
        if (atual) {
          alvo = Number(atual['id']);
          if (anterior !== metodo)
            await tx.alterar(TABELA_PREFERENCIA_SEGUNDO_FATOR, alvo, Number(atual['versao']), { metodo });
        } else {
          try {
            alvo = await tx.incluir(TABELA_PREFERENCIA_SEGUNDO_FATOR, { usuario_id: Number(u['id']), metodo });
          } catch (e) {
            if (restricaoViolada(e)?.tipo === 'unica')
              throw recusa('escolha-em-uso', 'Outro pedido gravou a escolha agora: tente de novo.');
            throw e;
          }
        }
        diferenca = `segundo fator: ${anterior} -> ${metodo}`;
        return { anterior };
      },
      alvo: () => ({ tabela: TABELA_PREFERENCIA_SEGUNDO_FATOR, id: alvo }),
      trilha: () => ({
        dados: {
          evento: 'acesso.segundo-fator.escolhido',
          recurso: 'acesso.sessao',
          operacao: 'acesso.segundoFator.escolher',
          resultado: 'sucesso',
          estacao: a.estacao,
          diferenca,
        },
      }),
    });
    const ator = await this.nucleo.lerSomente(
      { cliente: o.cliente, estabelecimento: o.estabelecimento, correlacao: 'acesso-segundo-fator' },
      (l) => l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [a.login]),
    );
    const r = await this.executor.executar(op, o.cliente, { login: a.login, metodo }, {
      cliente: o.cliente,
      estabelecimento: o.estabelecimento,
      usuario: ator ? Number(ator['id']) : null,
      correlacao: (a.correlacao || 'acesso-segundo-fator').slice(0, 64),
      chaveIdempotencia: `segundo-fator:${randomUUID()}`,
    });
    return r.resultado as { anterior: MetodoSegundoFator };
  }
}

/** O código de 6 dígitos ao e-mail do usuário do cliente (depois da senha conferida no login). */
export class SegundoFatorEmailUsuario {
  constructor(
    private readonly nucleo: NucleoAcessoEmail,
    private readonly cliente: (rede: string) => string,
    private readonly codigos: ServicoCodigoEmail,
  ) {}

  async emitir(rede: string, estabelecimento: string, login: string): Promise<{ validadeMinutos: number }> {
    const conta = await emailDaConta(this.nucleo, this.cliente(rede), login);
    return this.codigos.emitir(contaUsuario(rede, estabelecimento, login), conta?.email ?? null);
  }

  conferir(rede: string, estabelecimento: string, login: string, codigo: string): Promise<DesfechoConferenciaCodigo> {
    return this.codigos.conferir(contaUsuario(rede, estabelecimento, login), String(codigo ?? ''));
  }
}

export interface DependenciasAcessoEmail {
  readonly nucleo: NucleoAcessoEmail & Partial<NucleoPlataforma>;
  /** CLIENTE_PADRAO (o banco do cliente). */
  readonly cliente: string;
  readonly sessao: ServicoSessao;
  readonly armazem: ArmazemSessao;
  /** Envio do e-mail (emailAcessoDoAmbiente); null: recuperação e código por e-mail indisponíveis. */
  readonly email: PortaEmailAcesso | null;
  /** Configuração do cliente (chave acesso.recuperacaoSenha e parâmetros da troca rápida). */
  readonly configuracao: () => (FonteConfiguracao & FonteParametrosTrocaRapida) | null;
  /** Código do estabelecimento → id no banco do cliente (null: fora do cliente). */
  readonly estabelecimento: (hospital: string) => number | null;
  readonly trilha: RegistradorTrilha | null;
  /** Origem pública da web (ex.: https://host), para os links dos e-mails. */
  readonly urlPublica: string;
  /** Núcleo do banco plataforma (padrão: o próprio núcleo, quando lê a plataforma). */
  readonly plataforma?: NucleoPlataforma | null;
  readonly aviso?: (mensagem: string, campos: Record<string, unknown>) => void;
}

export interface ServicosAcessoEmail {
  readonly recuperacao: ServicoRecuperacaoSenha;
  readonly trocaRapida: ServicoTrocaRapida;
  readonly preferencia: PreferenciaSegundoFatorPropria;
  readonly codigoUsuario: SegundoFatorEmailUsuario | null;
  readonly recuperacaoPlataforma: ServicoRecuperacaoPlataforma | null;
}

/** Monta os serviços da entrada por e-mail e da troca rápida sobre o banco próprio. */
export function montarAcessoEmailProprio(d: DependenciasAcessoEmail): ServicosAcessoEmail {
  const aviso = d.aviso ?? (() => undefined);
  const base = d.urlPublica.replace(/\/+$/, '');
  const resolver: ResolverEstabelecimentoPin = (_rede, hospital) => ({
    cliente: d.cliente,
    estabelecimento: d.estabelecimento(hospital),
  });
  const executor = d.nucleo.criarExecutor();
  const envio = d.email ? new EnvioRecuperacaoPropria(d.nucleo, d.cliente, d.email, `${base}/recuperar-senha`) : null;
  const recuperacao = new ServicoRecuperacaoSenha(d.sessao, d.armazem, d.configuracao(), envio, d.trilha, aviso);
  const trocaRapida = new ServicoTrocaRapida(d.sessao, {
    porta: new PortaPinPropria(d.nucleo, resolver, executor),
    parametros: parametrosTrocaRapidaPelaConfiguracao(d.configuracao),
    trilha: d.trilha,
    aviso,
  });
  const codigos = d.email ? new ServicoCodigoEmail(d.armazem, d.email) : null;
  const np = d.plataforma !== undefined ? d.plataforma : nucleoPlataforma(d.nucleo);
  return {
    recuperacao,
    trocaRapida,
    preferencia: new PreferenciaSegundoFatorPropria(d.nucleo, resolver, executor),
    codigoUsuario: codigos ? new SegundoFatorEmailUsuario(d.nucleo, () => d.cliente, codigos) : null,
    recuperacaoPlataforma: np
      ? new ServicoRecuperacaoPlataforma(np, d.armazem, d.email, codigos, {
          linkTela: `${base}/plataforma/recuperar-senha`,
          aviso,
        })
      : null,
  };
}
