// W1-01 (parte 11b2): o SERVIÇO da troca rápida de usuário por PIN (D-W101-36). A regra é a do domínio
// (dominio-acesso/usuario/troca-rapida.ts); aqui o servidor:
// - define/troca e retira o PIN da própria pessoa só com a senha conferida (reautenticação da sessão), cifrando o PIN
//   com Argon2id (o mesmo da credencial forte) antes de chegar à porta (SGH_ACESSO_PIN, 1209);
// - o gestor retira o PIN de outro usuário (ficha) com motivo;
// - confere a troca: parâmetros, conta, PIN definido e livre, login forte HOJE nesta estação; o PIN errado soma falha e
//   bloqueia no teto; o certo abre a sessão nova pelo ServicoSessao e a anterior da estação fica bloqueada.
// Toda recusa da troca responde com a MESMA mensagem genérica (não revela se a conta existe nem por que falhou); o
// código fica só na trilha própria. Nunca o PIN nem o hash em mensagem, log ou trilha.
import {
  definicaoParametro,
  EVENTOS_AUDITAVEIS,
  type SituacaoPinTela,
  type ValorParametro,
} from '@sgh/contratos';
import {
  tetoFalhasPin,
  avaliarTrocaRapida,
  cifrarSenha,
  conferirSenha,
  PADRAO_TROCA_RAPIDA,
  type ParametrosTrocaRapida,
  validarNovoPin,
} from '@sgh/dominio-acesso';
import { resolverParametro, valorTipado } from '@sgh/dominio-config';
import { ErroOperacao } from '@sgh/nucleo';
import type { RegistradorTrilha } from '../autorizacao/trilha.js';
import type { PortaPin, TrilhaPin } from './porta-pin.js';
import {
  diaCivilSessao,
  ErroSessao,
  type OrigemPedido,
  type ResultadoLogin,
  type ServicoSessao,
} from './servico-sessao.js';

/** O que a troca rápida lê da configuração: os valores dos parâmetros do estabelecimento (sem o módulo inteiro). */
export interface FonteParametrosTrocaRapida {
  valoresParametro(rede: string, hospital: string): Promise<readonly ValorParametro[]>;
}

export const PARAMETROS_TROCA_RAPIDA = {
  ligada: 'acesso.trocaRapida.ligada',
  cracha: 'acesso.trocaRapida.cracha',
  digitosPin: 'acesso.trocaRapida.digitosPin',
  tentativasPin: 'acesso.trocaRapida.tentativasPin',
} as const;

export const MENSAGEM_TROCA_RECUSADA =
  'Usuário ou PIN não conferem. A troca rápida vale só para quem definiu o PIN e entrou com a senha hoje nesta estação.';

const INDISPONIVEL = 'A troca rápida está indisponível no momento.';

/** Os quatro parâmetros do estabelecimento, cada um caindo no padrão quando não resolve. */
export function parametrosTrocaRapidaPelaConfiguracao(
  fonte: () => FonteParametrosTrocaRapida | null,
  agora: () => number = () => Date.now(),
): (rede: string, hospital: string) => Promise<ParametrosTrocaRapida> {
  return async (rede, hospital) => {
    const f = fonte();
    const valores = f ? await f.valoresParametro(rede, hospital).catch(() => null) : null;
    const ler = (chave: string): unknown => {
      const def = definicaoParametro(chave);
      if (!def) return undefined;
      try {
        return valorTipado(
          def,
          valores
            ? resolverParametro(
                def,
                valores,
                { rede, empresa: null, estabelecimento: hospital, unidade: null, perfis: [], usuario: '' },
                new Date(agora()),
              ).valor
            : def.padrao,
        );
      } catch {
        return undefined;
      }
    };
    const bool = (v: unknown, p: boolean) => (typeof v === 'boolean' ? v : p);
    const int = (v: unknown, p: number, min: number, max: number) =>
      typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : p;
    const P = PADRAO_TROCA_RAPIDA;
    return {
      ligada: bool(ler(PARAMETROS_TROCA_RAPIDA.ligada), P.ligada),
      cracha: bool(ler(PARAMETROS_TROCA_RAPIDA.cracha), P.cracha),
      digitosPin: int(ler(PARAMETROS_TROCA_RAPIDA.digitosPin), P.digitosPin, 4, 8),
      tentativasPin: int(ler(PARAMETROS_TROCA_RAPIDA.tentativasPin), P.tentativasPin, 1, 10),
    };
  };
}

export interface ConfigTrocaRapida {
  readonly porta: PortaPin;
  readonly parametros: (rede: string, hospital: string) => Promise<ParametrosTrocaRapida>;
  readonly trilha?: RegistradorTrilha | null;
  /** Data de nascimento (AAAA-MM-DD) para recusar o PIN derivado dela; ausente: sem a data. */
  readonly nascimento?: (hospital: string, login: string) => Promise<string | null>;
  readonly agora?: () => number;
  /** Testes: cifra/conferência mais baratas; o padrão é o Argon2id da identidade. */
  readonly cifrar?: (pin: string) => Promise<string>;
  readonly conferir?: (pin: string, hash: string | null) => Promise<boolean>;
  readonly aviso?: (mensagem: string, campos: Record<string, unknown>) => void;
}

/** O que a tela "Segurança" mostra do PIN (sem o hash): o contrato da API. */
export type { SituacaoPinTela };

export class ServicoTrocaRapida {
  private readonly agora: () => number;
  private readonly cifrar: (pin: string) => Promise<string>;
  private readonly conferir: (pin: string, hash: string | null) => Promise<boolean>;
  private readonly aviso: (mensagem: string, campos: Record<string, unknown>) => void;

  constructor(
    private readonly sessao: ServicoSessao,
    private readonly cfg: ConfigTrocaRapida,
  ) {
    this.agora = cfg.agora ?? (() => Date.now());
    this.cifrar = cfg.cifrar ?? ((pin) => cifrarSenha(pin));
    this.conferir = cfg.conferir ?? conferirSenha;
    this.aviso = cfg.aviso ?? (() => undefined);
  }

  get destino(): PortaPin['destino'] {
    return this.cfg.porta.destino;
  }

  /** A sessão ativa, própria (não "como"). */
  private async registroProprio(id: string, rede: string | null) {
    const lido = await this.sessao.ler(id, rede);
    if (!lido) throw new ErroSessao('sessao-encerrada', 'Sessão encerrada; entre de novo.');
    const r = lido.registro;
    if (r.bloqueada) throw new ErroSessao('sessao-bloqueada', 'Sessão bloqueada; confirme a senha.');
    if (r.como)
      throw new ErroSessao(
        'pin-recusado',
        'O PIN é pessoal: não se define numa sessão de suporte.',
        'pin-como',
      );
    return r;
  }

  private trilhaPin(
    r: { rede: string; estabelecimento: string; login: string },
    evento: string,
    operacao: string,
    origem: OrigemPedido,
  ): TrilhaPin {
    return {
      rede: r.rede,
      hospital: r.estabelecimento,
      usuario: r.login,
      evento,
      recurso: 'acesso.sessao',
      operacao,
      resultado: 'sucesso',
      estacao: origem.estacao.slice(0, 80),
      correlacao: origem.correlacao.slice(0, 64),
    };
  }

  /** Erro da porta: recusa da gravação (409) vira recusa do PIN; o resto, indisponível. */
  private traduzir(e: unknown): never {
    if (e instanceof ErroSessao) throw e;
    if (e instanceof ErroOperacao && e.problema.status === 409)
      throw new ErroSessao('pin-recusado', e.problema.detail ?? 'PIN recusado.', e.problema.codigo);
    throw new ErroSessao('indisponivel', INDISPONIVEL);
  }

  async situacao(id: string, rede: string | null): Promise<SituacaoPinTela> {
    const r = await this.registroProprio(id, rede);
    const p = await this.cfg.parametros(r.rede, r.estabelecimento);
    const s = await this.cfg.porta
      .situacao(r.rede, r.estabelecimento, r.login)
      .catch((e) => this.traduzir(e));
    return {
      ligada: p.ligada,
      digitosPin: p.digitosPin,
      definido: s.definido,
      bloqueado: s.bloqueado,
      criadoEm: s.criadoEm ? s.criadoEm.toISOString() : null,
    };
  }

  /** Define ou troca o próprio PIN: a senha confere (reautenticação, conta no limite de tentativas) antes de tudo. */
  async definir(
    id: string,
    rede: string | null,
    entrada: { pin: string; senha: string },
    origem: OrigemPedido,
  ): Promise<SituacaoPinTela> {
    await this.registroProprio(id, rede);
    await this.sessao.reautenticar(id, rede, entrada.senha, origem);
    const r = await this.registroProprio(id, rede);
    const p = await this.cfg.parametros(r.rede, r.estabelecimento);
    if (!p.ligada)
      throw new ErroSessao('troca-rapida-desligada', 'A troca rápida de usuário está desligada.');
    const nascimento = this.cfg.nascimento
      ? await this.cfg.nascimento(r.estabelecimento, r.login).catch(() => null)
      : null;
    const recusas = validarNovoPin(entrada.pin, { login: r.login, nascimento, parametros: p });
    const primeira = recusas[0];
    if (primeira)
      throw new ErroSessao('pin-recusado', recusas.map((x) => x.mensagem).join(' '), primeira.codigo);
    const hashPhc = await this.cifrar(entrada.pin);
    await this.cfg.porta
      .definir(
        r.rede,
        r.estabelecimento,
        {
          idUsuario: Number(r.idUsuario),
          login: r.login,
          hashPhc,
          por: r.login,
          motivo: 'definido pela própria pessoa',
        },
        this.trilhaPin(r, EVENTOS_AUDITAVEIS.pinDefinido.codigo, 'definir-pin', origem),
      )
      .catch((e) => this.traduzir(e));
    return this.situacao(id, rede);
  }

  /** Retira o próprio PIN (com a senha). */
  async retirar(
    id: string,
    rede: string | null,
    entrada: { senha: string },
    origem: OrigemPedido,
  ): Promise<SituacaoPinTela> {
    await this.registroProprio(id, rede);
    await this.sessao.reautenticar(id, rede, entrada.senha, origem);
    const r = await this.registroProprio(id, rede);
    await this.cfg.porta
      .retirar(
        r.rede,
        r.estabelecimento,
        { login: r.login, por: r.login, motivo: 'retirado pela própria pessoa' },
        this.trilhaPin(r, EVENTOS_AUDITAVEIS.pinRetirado.codigo, 'retirar-pin', origem),
      )
      .catch((e) => this.traduzir(e));
    return this.situacao(id, rede);
  }

  /** A situação do PIN de outro usuário (ficha do gestor); sem o hash. */
  async situacaoDoUsuario(
    g: { rede: string; estabelecimento: string },
    alvo: string,
  ): Promise<SituacaoPinTela> {
    const p = await this.cfg.parametros(g.rede, g.estabelecimento);
    const s = await this.cfg.porta.situacao(g.rede, g.estabelecimento, alvo).catch((e) => this.traduzir(e));
    return {
      ligada: p.ligada,
      digitosPin: p.digitosPin,
      definido: s.definido,
      bloqueado: s.bloqueado,
      criadoEm: s.criadoEm ? s.criadoEm.toISOString() : null,
    };
  }

  /** O gestor de acessos retira o PIN de outro usuário (ficha); quem chama já conferiu a permissão e a senha. */
  async retirarDoUsuario(
    g: { rede: string; estabelecimento: string; login: string },
    alvo: string,
    motivo: string,
    origem: OrigemPedido,
  ): Promise<{ anterior: 'definido' | 'bloqueado' }> {
    const m = motivo.trim();
    if (m.length < 10)
      throw new ErroSessao('pin-recusado', 'Informe o motivo (ao menos 10 caracteres).', 'motivo');
    const res = await this.cfg.porta
      .retirar(
        g.rede,
        g.estabelecimento,
        { login: alvo, por: g.login, motivo: m.slice(0, 200) },
        this.trilhaPin(g, EVENTOS_AUDITAVEIS.pinRetirado.codigo, 'retirar-pin-gestor', origem),
      )
      .catch((e) => this.traduzir(e));
    return { anterior: res.anterior };
  }

  private async evento(
    evento: string,
    r: { rede: string; estabelecimento: string; login: string },
    origem: OrigemPedido,
    resultado: 'sucesso' | 'falha',
    codigo?: string,
  ): Promise<void> {
    if (!this.cfg.trilha) return;
    try {
      await this.cfg.trilha.registrar({
        evento,
        rede: r.rede,
        hospital: r.estabelecimento,
        usuario: r.login,
        estacao: origem.estacao,
        correlacao: origem.correlacao,
        recurso: 'acesso.sessao',
        resultado,
        ...(codigo ? { chaveNaturalAlvo: `troca-rapida:${codigo}` } : {}),
      });
    } catch (e) {
      this.aviso('trilha: evento da troca rápida não registrado', {
        evento,
        erro: e instanceof Error ? e.name : 'erro',
      });
    }
  }

  /**
   * A troca rápida: o estabelecimento é o da sessão anterior da estação (ou o informado, sem sessão). Recusa genérica;
   * PIN errado conta falha e bloqueia no teto (trilha da porta); certo abre a sessão nova e bloqueia a anterior.
   */
  async trocar(
    entrada: { login: string; pin: string; estabelecimento?: string | undefined },
    redeDoEndereco: string | null,
    idAnterior: string | null,
    origem: OrigemPedido,
  ): Promise<ResultadoLogin> {
    const anterior = idAnterior ? await this.sessao.ler(idAnterior, redeDoEndereco) : null;
    const estabelecimento = anterior?.registro.estabelecimento ?? entrada.estabelecimento ?? '';
    const login = entrada.login.trim();
    const rede = this.sessao.rede;
    const alvo = { rede, estabelecimento, login };
    const p = await this.cfg.parametros(rede, estabelecimento);
    if (!p.ligada)
      throw new ErroSessao('troca-rapida-desligada', 'A troca rápida de usuário está desligada.');
    const recusar = async (codigo: string): Promise<never> => {
      await this.evento(EVENTOS_AUDITAVEIS.loginFalho.codigo, alvo, origem, 'falha', codigo);
      throw new ErroSessao('troca-rapida-recusada', MENSAGEM_TROCA_RECUSADA, 'troca-rapida');
    };
    if (!login || !estabelecimento) return recusar('entrada');
    // W1-01 (revisão): a estação é o POSTO (cookie emitido no login forte), não o IP; atrás de NAT ou proxy o IP é o
    // mesmo para toda a rede. Sem o cookie do posto, ou sem a sessão anterior aberta NESTE posto, não há troca.
    if (!origem.posto) return recusar('sem-posto');
    if (!anterior) return recusar('sem-sessao-no-posto');
    if (anterior.registro.posto !== origem.posto) return recusar('posto-divergente');
    if (anterior && anterior.registro.login === login) return recusar('mesmo-usuario');
    let conta: { ativo: boolean; bloqueado: boolean } | null = null;
    try {
      await this.sessao.conferirAlvoComo(estabelecimento, login, redeDoEndereco);
      conta = { ativo: true, bloqueado: false };
    } catch (e) {
      if (!(e instanceof ErroSessao) || e.tipo !== 'credencial-invalida') throw e;
    }
    const vivo = conta
      ? await this.cfg.porta.vivo(rede, estabelecimento, login).catch((e) => this.traduzir(e))
      : null;
    const recusa = avaliarTrocaRapida({
      parametros: p,
      hoje: diaCivilSessao(this.agora()),
      estacao: `POSTO:${origem.posto}`,
      conta,
      pin: { definido: Boolean(vivo), bloqueado: Boolean(vivo?.bloqueado) },
      loginsFortes: conta ? await this.sessao.loginsFortes(rede, estabelecimento, login) : [],
    });
    // Mesmo custo da conferência quando não há o que conferir (não revela pela demora).
    if (recusa || !vivo) {
      await this.conferir(entrada.pin, null);
      return recusar(recusa?.codigo ?? 'sem-pin');
    }
    const certo = await this.conferir(entrada.pin, vivo.hashPhc);
    // Revisão (achado 4): a gravação decide a contagem e o bloqueio de forma atômica (FALHAS = FALHAS + 1 no PIN ainda
    // livre); a falha lida antes da conferência serve só para a regra de entrada, nunca para o valor gravado.
    const r = await this.cfg.porta
      .conferencia(
        rede,
        estabelecimento,
        { id: vivo.id, login, certo, teto: tetoFalhasPin(p) },
        this.trilhaPin(
          alvo,
          certo ? EVENTOS_AUDITAVEIS.trocaRapida.codigo : EVENTOS_AUDITAVEIS.pinBloqueado.codigo,
          certo ? 'conferir-pin' : 'bloquear-pin',
          origem,
        ),
      )
      .catch((e) => this.traduzir(e));
    if (!certo)
      return recusar(
        r.bloqueouAgora ? 'pin-bloqueado-agora' : r.falhas === null ? 'pin-bloqueado' : 'pin-errado',
      );
    // Certo, mas uma tentativa paralela bloqueou (ou o PIN mudou) entre a leitura e a gravação: não entra.
    if (!r.aceito) return recusar('pin-bloqueado');
    const res = await this.sessao.entrarPorTrocaRapida(
      { estabelecimento, login },
      redeDoEndereco,
      idAnterior,
      origem,
    );
    await this.evento(EVENTOS_AUDITAVEIS.trocaRapida.codigo, alvo, origem, 'sucesso');
    return res;
  }
}
