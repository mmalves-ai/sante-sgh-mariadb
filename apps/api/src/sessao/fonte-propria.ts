// Fonte de acesso PRÓPRIA (F2-L): o login sobre o banco do cliente (cliente_<codigo>), só leitura, pelo Leitor de
// @sgh/nucleo. Credencial em argon2id (@sgh/dominio-acesso, cifra-plataforma); política de senha, perfis, termo e
// concessões das tabelas do produto. As gravações do login (tentativas no banco, último acesso, troca de senha)
// passam pelo Executor do núcleo, fora daqui.
//
// Regras de segurança:
// - login inexistente, sem vínculo vigente com o estabelecimento ou estabelecimento fora da lista: a mesma resposta de
//   senha errada, com o custo de uma conferência de senha (sem enumeração de contas);
// - conta sem credencial (nunca definida ou excluída): também a resposta de senha errada, com o mesmo custo; o primeiro
//   acesso vai por convite ou redefinição, nunca pelo formulário de login;
// - "conta-impedida" só depois da senha conferida;
// - o recálculo da autorização e os dados da sessão exigem conta ativa, sem bloqueio, dentro da validade e com vínculo
//   vigente no estabelecimento (quem é bloqueado ou desvinculado perde tudo no próximo recálculo);
// - negação explícita (perfil_acao.permitido falso) prevalece sobre qualquer perfil, inclusive o administrador;
// - recorte de acesso que a sessão não sabe aplicar, ou só de consulta, fecha em vez de abrir (falha fechada);
// - nenhuma coluna do banco do cliente dá acesso total: o administrador da plataforma entra pelo banco plataforma
//   (decisão do dono 2026-11-20, b; sessao/fonte-plataforma.ts e ServicoSessao.entrarPlataforma). O perfil "administrador" do cliente concede as ações ativas do catálogo DO
//   CLIENTE (acao_sistema), com a segregação de sempre.
// Nenhum log leva login, nome ou senha: só códigos e contagens.
import { ESCOPOS_SEM_RESTRICAO, esquemaCodigoEstabelecimento } from '@sgh/contratos';
import { conferirSenha, type PerfilConcedido, type PermissaoDoPerfil } from '@sgh/dominio-acesso';
import type { Ambiente, EstadoPool, Leitor, Linha } from '@sgh/nucleo';
import type { DadosAutorizacao, EscoposAcesso } from '../autorizacao/servico-autorizacao.js';
import type { FonteAcesso } from './fonte-acesso.js';
import { lerRedePadrao } from './rede.js';
import {
  type Autenticacao,
  CONFIG_LOGIN_PADRAO,
  type ConfigLogin,
  type ContaAcesso,
  type DadosSessao,
  type SaudeEstabelecimento,
  type SituacaoTermoAcesso,
} from './tipos-acesso.js';

/** O que a fonte usa do NucleoProprio (os testes trocam). */
export interface NucleoLeitura {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  estadosDosPools(): EstadoPool[];
}

export type AvisoFonte = (mensagem: string, campos: Record<string, unknown>) => void;

/** Lista de estabelecimentos relida depois deste prazo (na próxima autenticação ou configuração). */
export const RELEITURA_ESTABELECIMENTOS_MS = 60_000;
/** Teto de linhas das leituras do catálogo de ações (o produto tem alguns milhares). */
const TETO_ACOES = 100_000;

/** Escopo da sessão por tipo_escopo_acesso (pelo código ou pela entidade de recorte). */
const CHAVE_ESCOPO: Readonly<Record<string, keyof EscoposAcesso>> = {
  unidade: 'unidades',
  unidade_atendimento: 'unidades',
  local: 'locais',
  local_atendimento: 'locais',
  convenio: 'convenios',
  fonte_pagadora: 'convenios',
  centro_custo: 'centrosCusto',
  local_estoque: 'locaisEstoque',
  conta_bancaria: 'contasBancarias',
  tipo_agenda: 'tiposAgenda',
  categoria_agenda: 'tiposAgenda',
  tipo_prontuario: 'tiposProntuario',
};

interface Estabelecimento {
  readonly id: number;
  readonly codigo: string;
  readonly nome: string;
}

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown): boolean => v === true || Number(v) === 1;
const data = (v: unknown): Date | null => (v instanceof Date ? v : v ? new Date(String(v)) : null);

export class FonteAcessoPropria implements FonteAcesso {
  private lista: readonly Estabelecimento[] = [];
  private lidaEm = 0;
  private conectado = false;
  private motivo: string | null = 'estabelecimentos ainda não lidos';

  constructor(
    private readonly nucleo: NucleoLeitura,
    /** Código do cliente na plataforma (o banco é cliente_<codigo>). */
    readonly cliente: string,
    readonly rede: string,
    private readonly aviso: AvisoFonte = () => {},
    private readonly agora: () => number = () => Date.now(),
  ) {}

  get estabelecimentos(): readonly { readonly codigo: string }[] {
    return this.lista;
  }

  private ler<T>(fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'fonte-acesso-propria' }, fn);
  }

  /** Lê os estabelecimentos ativos do cliente (código fora do formato da sessão fica de fora, com aviso). */
  async carregar(): Promise<void> {
    try {
      const linhas = await this.ler((l) =>
        l.consultar<{ id: number; codigo: string; nome_fantasia: string }>(
          'SELECT id, codigo, nome_fantasia FROM estabelecimento WHERE ativo AND excluido_em IS NULL ORDER BY codigo',
        ),
      );
      const validos = linhas.filter((e) => esquemaCodigoEstabelecimento.safeParse(e.codigo).success);
      if (validos.length < linhas.length)
        this.aviso('estabelecimentos com código fora do formato da sessão ficaram fora do login', {
          cliente: this.cliente,
          quantidade: linhas.length - validos.length,
        });
      this.lista = validos.map((e) => ({ id: num(e.id), codigo: e.codigo, nome: e.nome_fantasia }));
      this.conectado = true;
      this.motivo = null;
    } catch (erro) {
      // A lista anterior fica (falha passageira do banco não esvazia o seletor); a saúde mostra o motivo neutro.
      this.conectado = false;
      this.motivo = 'banco do cliente indisponível';
      this.aviso('falha ao ler os estabelecimentos do cliente', {
        cliente: this.cliente,
        erro: (erro as Error).name,
      });
    } finally {
      this.lidaEm = this.agora();
    }
  }

  private async atualizada(): Promise<void> {
    if (!this.conectado || this.agora() - this.lidaEm > RELEITURA_ESTABELECIMENTOS_MS) await this.carregar();
  }

  private estabelecimento(codigo: string): Estabelecimento | null {
    return this.lista.find((e) => e.codigo === codigo) ?? null;
  }

  saude(): SaudeEstabelecimento[] {
    return this.lista.map((e) => ({
      codigo: e.codigo,
      nomeConfigurado: e.nome,
      disponivel: this.conectado,
      motivo: this.conectado ? null : this.motivo,
      conectado: this.conectado,
    }));
  }

  /** Estado dos pools do núcleo (a rota de saúde mostra). */
  pools(): EstadoPool[] {
    return this.nucleo.estadosDosPools();
  }

  async autenticar(codigo: string, login: string, senha: string): Promise<Autenticacao> {
    await this.atualizada();
    const est = this.estabelecimento(codigo);
    const nomeLogin = login.trim();
    const linha =
      est && nomeLogin
        ? await this.ler((l) =>
            l.uma(
              `SELECT u.id, u.login, u.nome, u.nome_social, u.situacao, u.bloqueado_em, u.expira_em,
                      u.exige_troca_senha,
                      c.id AS credencial, c.resumo_senha, c.troca_obrigatoria, c.senha_alterada_em,
                      c.expira_em AS credencial_expira_em
                 FROM usuario u
                 JOIN usuario_estabelecimento ue
                   ON ue.usuario_id = u.id AND ue.estabelecimento_id = ? AND ue.excluido_em IS NULL
                  AND ue.vigencia_inicio <= UTC_DATE() AND (ue.vigencia_fim IS NULL OR ue.vigencia_fim >= UTC_DATE())
                 LEFT JOIN credencial_usuario c ON c.usuario_id = u.id AND c.excluido_em IS NULL
                WHERE u.login = ? AND u.excluido_em IS NULL
                LIMIT 1`,
              [est.id, nomeLogin],
            ),
          )
        : null;
    if (!linha) {
      // Sem conta (ou sem vínculo): o mesmo custo de uma conferência, a mesma resposta de senha errada.
      await conferirSenha(senha, null);
      return { desfecho: 'credencial-invalida' };
    }
    const conta = this.contaDe(linha);
    if (conta.semCifra) {
      // Sem credencial: indistinguível de senha errada (sem enumeração de contas).
      await conferirSenha(senha, null);
      return { desfecho: 'credencial-invalida' };
    }
    if (!(await conferirSenha(senha, String(linha['resumo_senha']))))
      return { desfecho: 'credencial-invalida' };
    if (!conta.ativo || conta.bloqueado) return { desfecho: 'conta-impedida', conta };
    return { desfecho: 'ok', conta };
  }

  private contaDe(l: Linha): ContaAcesso {
    const agora = this.agora();
    const expira = data(l['expira_em']);
    const credencialExpira = data(l['credencial_expira_em']);
    const semCifra = l['credencial'] === null || l['credencial'] === undefined;
    return {
      login: String(l['login']),
      id: num(l['id']),
      nomeExibicao: String(l['nome_social'] ?? '').trim() || String(l['nome']),
      ativo: l['situacao'] === 'ativo' && (expira === null || expira.getTime() > agora),
      bloqueado: l['bloqueado_em'] !== null || l['situacao'] === 'bloqueado',
      senhaAlteradaEm: semCifra ? null : data(l['senha_alterada_em']),
      semCifra,
      trocaObrigatoria:
        !semCifra &&
        (bool(l['troca_obrigatoria']) ||
          bool(l['exige_troca_senha']) ||
          (credencialExpira !== null && credencialExpira.getTime() <= agora)),
    };
  }

  async configLogin(codigo: string): Promise<ConfigLogin> {
    await this.atualizada();
    const est = this.estabelecimento(codigo);
    const p = est
      ? await this.ler((l) => l.uma('SELECT * FROM politica_senha WHERE estabelecimento_id = ?', [est.id]))
      : null;
    if (!p) {
      this.aviso('estabelecimento sem política de senha: vale o padrão seguro do produto', {
        cliente: this.cliente,
        estabelecimento: codigo,
      });
      return CONFIG_LOGIN_PADRAO;
    }
    return configDaPolitica(p);
  }

  async dadosDeSessao(codigo: string, login: string, config?: ConfigLogin): Promise<DadosSessao> {
    const est = this.estabelecimento(codigo);
    const cfg = config ?? (await this.configLogin(codigo));
    if (!est) return { papeis: [], unidades: [], termo: SEM_TERMO, config: cfg };
    return this.ler(async (l) => {
      const usuario = await contaVigente(l, est.id, login);
      if (usuario === null) return { papeis: [], unidades: [], termo: SEM_TERMO, config: cfg };
      const perfis = await l.consultar<{ id: number; nome: string }>(
        `SELECT DISTINCT p.id, p.nome
           FROM usuario_perfil up
           JOIN perfil_acesso p ON p.id = up.perfil_acesso_id AND p.ativo AND p.excluido_em IS NULL
          WHERE up.usuario_id = ? AND up.estabelecimento_id = ? AND up.excluido_em IS NULL
            AND up.vigencia_inicio <= UTC_DATE() AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= UTC_DATE())
          ORDER BY p.id`,
        [usuario, est.id],
      );
      // Termo vigente do sistema: o do estabelecimento vence o geral; o mais recente.
      const termo = await l.uma<{ id: number; periodicidade_aceite_dias: number | null }>(
        `SELECT id, periodicidade_aceite_dias
           FROM termo_uso_versao
          WHERE publico = 'sistema' AND situacao = 'publicado' AND excluido_em IS NULL
            AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)
            AND vigencia_inicio <= UTC_TIMESTAMP(3) AND (vigencia_fim IS NULL OR vigencia_fim > UTC_TIMESTAMP(3))
          ORDER BY estabelecimento_id IS NULL, vigencia_inicio DESC, id DESC
          LIMIT 1`,
        [est.id],
      );
      let situacao: SituacaoTermoAcesso = SEM_TERMO;
      if (termo) {
        const aceite = await l.uma<{ em: Date | null }>(
          `SELECT MAX(a.ocorrido_em) AS em
             FROM aceite_termo_uso a
            WHERE a.termo_uso_versao_id = ? AND a.usuario_id = ? AND a.valido AND a.revogado_em IS NULL`,
          [termo.id, usuario],
        );
        const dias = numOuNull(termo.periodicidade_aceite_dias) ?? cfg.quantidadePeriodoTermo;
        const periodico =
          dias !== null && dias > 0 && (cfg.termoPeriodico || termo.periodicidade_aceite_dias !== null);
        situacao = {
          vigente: true,
          aceitoEm: data(aceite?.em),
          periodico,
          quantidadePeriodo: periodico ? dias : null,
          tipoPeriodo: periodico ? 'D' : null,
        };
      }
      return {
        papeis: perfis.map((p) => ({ codigo: num(p.id), nome: p.nome })),
        // Sem unidade de atendimento abaixo do estabelecimento neste marco: a sessão abre no estabelecimento.
        unidades: [],
        termo: situacao,
        config: cfg,
      };
    });
  }

  /** As flags do banco de origem (terceiro argumento da porta) não existem no banco do cliente: não são lidas. */
  async dadosDeAutorizacao(codigo: string, login: string): Promise<DadosAutorizacao> {
    const est = this.estabelecimento(codigo);
    if (!est) return semAutorizacao();
    return this.ler(async (l) => {
      const usuario = await contaVigente(l, est.id, login);
      if (usuario === null) return semAutorizacao();
      const perfis = await l.consultar<{
        id: number;
        codigo: string;
        administrador: unknown;
        inicio: Date | string;
        fim: Date | string | null;
      }>(
        `SELECT p.id, p.codigo, p.administrador, up.vigencia_inicio AS inicio, up.vigencia_fim AS fim
           FROM usuario_perfil up
           JOIN perfil_acesso p ON p.id = up.perfil_acesso_id AND p.ativo AND p.excluido_em IS NULL
            AND (p.estabelecimento_id IS NULL OR p.estabelecimento_id = ?)
          WHERE up.usuario_id = ? AND up.estabelecimento_id = ? AND up.excluido_em IS NULL
            AND up.vigencia_inicio <= UTC_DATE() AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= UTC_DATE())`,
        [est.id, usuario, est.id],
      );
      if (perfis.length === 0) return semAutorizacao();
      const ids = [...new Set(perfis.map((p) => num(p.id)))];
      const marcas = ids.map(() => '?').join(',');
      // Permitidas e negadas dos perfis vigentes, com o módulo e o tipo (para os recortes de acesso).
      const linhas = await l.consultar<{
        perfil: string;
        acao: string;
        permitido: unknown;
        modulo: number | null;
        tipo: string;
      }>(
        `SELECT p.codigo AS perfil, a.codigo AS acao, pa.permitido, a.modulo_sistema_id AS modulo, a.tipo_acao AS tipo
           FROM perfil_acesso p
           JOIN perfil_acao pa ON pa.perfil_acesso_id = p.id AND pa.excluido_em IS NULL
           JOIN acao_sistema a ON a.id = pa.acao_sistema_id AND a.ativo AND a.permissionavel
          WHERE p.id IN (${marcas})`,
        ids,
        { teto: TETO_ACOES },
      );
      const meta = new Map<string, MetaAcao>();
      const negadas = new Set<string>();
      const acoes: PermissaoDoPerfil[] = [];
      for (const a of linhas) {
        meta.set(a.acao, { modulo: numOuNull(a.modulo), tipo: a.tipo });
        if (bool(a.permitido)) acoes.push({ perfil: a.perfil, permissao: a.acao });
        else negadas.add(a.acao);
      }
      const administradores = [...new Set(perfis.filter((p) => bool(p.administrador)).map((p) => p.codigo))];
      if (administradores.length > 0) {
        const todas = await l.consultar<{ codigo: string; modulo: number | null; tipo: string }>(
          `SELECT codigo, modulo_sistema_id AS modulo, tipo_acao AS tipo
             FROM acao_sistema WHERE ativo AND permissionavel`,
          [],
          { teto: TETO_ACOES },
        );
        for (const a of todas) meta.set(a.codigo, { modulo: numOuNull(a.modulo), tipo: a.tipo });
        for (const perfil of administradores)
          for (const a of todas) acoes.push({ perfil, permissao: a.codigo });
      }
      const recortes = await l.consultar<LinhaRecorte>(
        `SELECT t.codigo, t.entidade, t.modulo_sistema_id AS modulo, ue.entidade_id, ue.pode_operar
           FROM usuario_escopo ue
           JOIN tipo_escopo_acesso t ON t.id = ue.tipo_escopo_acesso_id AND t.ativo
          WHERE ue.usuario_id = ? AND ue.estabelecimento_id = ? AND ue.excluido_em IS NULL
            AND ue.vigencia_inicio <= UTC_DATE() AND (ue.vigencia_fim IS NULL OR ue.vigencia_fim >= UTC_DATE())`,
        [usuario, est.id],
        { teto: TETO_ACOES },
      );
      const { escopos, cortes } = this.escoposDe(recortes);
      // Falha fechada: o recorte que a sessão não aplica retira as ações do módulo dele (todas, se o recorte vale
      // para todos os módulos ou se a ação não tem módulo); o recorte só de consulta retira as que não são "ver".
      for (const a of acoes) {
        const m = meta.get(a.permissao);
        if (cortes.some((c) => cortada(c, m))) negadas.add(a.permissao);
      }
      return {
        concessoes: { ...CONCESSOES_PROPRIAS },
        escopos,
        restricaoVinculo: false,
        perfisConcedidos: perfis.map((p): PerfilConcedido => ({
          perfil: p.codigo,
          inicio: inicioDoDia(p.inicio),
          fim: fimDoDia(p.fim),
        })),
        mapaPerfis: [],
        acoesDoPerfil: acoes.filter((a) => !negadas.has(a.permissao)),
        acoesNegadas: [...negadas].sort(),
      };
    });
  }

  private escoposDe(linhas: readonly LinhaRecorte[]): { escopos: EscoposAcesso; cortes: Corte[] } {
    const r: Record<keyof EscoposAcesso, string[]> = {
      unidades: [],
      locais: [],
      convenios: [],
      centrosCusto: [],
      locaisEstoque: [],
      contasBancarias: [],
      tiposAgenda: [],
      tiposProntuario: [],
    };
    const cortes: Corte[] = [];
    let semLugar = 0;
    let soConsulta = 0;
    for (const e of linhas) {
      const modulo = numOuNull(e.modulo);
      const chave = CHAVE_ESCOPO[e.codigo] ?? CHAVE_ESCOPO[e.entidade];
      if (!chave) {
        semLugar++;
        cortes.push({ modulo, soOperacao: false });
        continue;
      }
      const id = String(num(e.entidade_id));
      if (!r[chave].includes(id)) r[chave].push(id);
      // A sessão não separa consulta de operação por registro: o recorte só de consulta tira a operação do módulo.
      if (!bool(e.pode_operar)) {
        soConsulta++;
        cortes.push({ modulo, soOperacao: true });
      }
    }
    if (semLugar > 0)
      this.aviso('recortes de acesso de tipo sem lugar na sessão: as ações do módulo do recorte foram retiradas', {
        cliente: this.cliente,
        quantidade: semLugar,
      });
    if (soConsulta > 0)
      this.aviso('recortes de acesso só de consulta: as ações de operação do módulo do recorte foram retiradas', {
        cliente: this.cliente,
        quantidade: soConsulta,
      });
    return { escopos: r, cortes };
  }
}

type LinhaRecorte = {
  readonly codigo: string;
  readonly entidade: string;
  readonly modulo: number | null;
  readonly entidade_id: number;
  readonly pode_operar: unknown;
};

interface MetaAcao {
  readonly modulo: number | null;
  readonly tipo: string;
}

/** Retirada por recorte: o módulo (null: todos) e se tira só a operação (o que não é "ver"). */
interface Corte {
  readonly modulo: number | null;
  readonly soOperacao: boolean;
}

/** Sem metadado ou sem módulo na ação: não dá para provar que está fora do recorte, então é retirada. */
function cortada(c: Corte, m: MetaAcao | undefined): boolean {
  const doModulo = c.modulo === null || !m || m.modulo === null || m.modulo === c.modulo;
  return doModulo && (!c.soOperacao || !m || m.tipo !== 'ver');
}

/** Id da conta ativa, sem bloqueio, dentro da validade e com vínculo vigente no estabelecimento (ou null). */
async function contaVigente(l: Leitor, estabelecimento: number, login: string): Promise<number | null> {
  const u = await l.uma<{ id: number }>(
    `SELECT u.id
       FROM usuario u
       JOIN usuario_estabelecimento ue
         ON ue.usuario_id = u.id AND ue.estabelecimento_id = ? AND ue.excluido_em IS NULL
        AND ue.vigencia_inicio <= UTC_DATE() AND (ue.vigencia_fim IS NULL OR ue.vigencia_fim >= UTC_DATE())
      WHERE u.login = ? AND u.excluido_em IS NULL AND u.situacao = 'ativo' AND u.bloqueado_em IS NULL
        AND (u.expira_em IS NULL OR u.expira_em > UTC_TIMESTAMP(3))
      LIMIT 1`,
    [estabelecimento, login],
  );
  return u ? num(u.id) : null;
}

/** Sem o grupo, as opções, os papéis e as flags do banco de origem: tudo vem dos perfis do cliente. */
const CONCESSOES_PROPRIAS = Object.freeze({
  grupo: null,
  opcoesGrupo: [],
  opcoesPapel: [],
  papeis: [],
  flags: [],
  conselho: false,
});

const SEM_TERMO: SituacaoTermoAcesso = Object.freeze({
  vigente: false,
  aceitoEm: null,
  periodico: false,
  quantidadePeriodo: null,
  tipoPeriodo: null,
});

/** Sem perfil vigente no estabelecimento: nenhuma ação do cliente (só as concessões gerais do catálogo). */
function semAutorizacao(): DadosAutorizacao {
  return {
    concessoes: { ...CONCESSOES_PROPRIAS },
    escopos: { ...ESCOPOS_SEM_RESTRICAO },
    restricaoVinculo: false,
    perfisConcedidos: [],
    mapaPerfis: [],
    acoesDoPerfil: [],
  };
}

function diaUtc(v: Date | string): Date {
  const d = v instanceof Date ? v : new Date(String(v));
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function inicioDoDia(v: Date | string): Date {
  return diaUtc(v);
}

/** vigencia_fim é o último dia válido (inclusivo): o perfil vale até o fim dele. */
function fimDoDia(v: Date | string | null): Date | null {
  return v === null ? null : new Date(diaUtc(v).getTime() + 86_400_000);
}

/** politica_senha → ConfigLogin (a forma que @sgh/dominio-acesso espera). */
export function configDaPolitica(p: Linha): ConfigLogin {
  const maiuscula = bool(p['exige_maiuscula']);
  const minuscula = bool(p['exige_minuscula']);
  const periodico = bool(p['exige_aceite_periodico']);
  const aviso = numOuNull(p['aviso_fim_sessao_minutos']);
  return {
    senha: {
      minimoCaracteres: num(p['tamanho_minimo']),
      exigeLetra: maiuscula || minuscula,
      exigeNumero: bool(p['exige_numero']),
      exigeEspecial: bool(p['exige_especial']),
      exigeMinuscula: minuscula,
      exigeMaiuscula: maiuscula,
      periodoTrocaDias: numOuNull(p['validade_dias']),
      // O banco guarda o reuso por quantidade (senhas_recentes_bloqueadas), conferido na troca pelo histórico.
      periodoReutilizacaoDias: null,
    },
    tempo: {
      inatividadeSegundos: num(p['inatividade_sessao_minutos']) * 60,
      avisoSegundos: aviso === null ? null : aviso * 60,
    },
    limiteTentativas: num(p['tentativas_ate_bloqueio']),
    termoPeriodico: periodico,
    quantidadePeriodoTermo: periodico ? numOuNull(p['periodicidade_aceite_dias']) : null,
    tipoPeriodoTermo: periodico ? 'D' : null,
    sante: null,
  };
}

/**
 * A fonte própria do cliente padrão (CLIENTE_PADRAO) na rede padrão (REDE_PADRAO), já com os estabelecimentos lidos.
 * Sem cliente ou sem rede: erro (a partida é recusada com a mensagem).
 */
export async function criarFonteAcessoPropria(
  nucleo: NucleoLeitura,
  env: Ambiente,
  aviso?: AvisoFonte,
): Promise<FonteAcessoPropria> {
  const cliente = env['CLIENTE_PADRAO']?.trim() ?? '';
  if (!cliente) throw new Error('CLIENTE_PADRAO ausente: a fonte própria lê o banco desse cliente.');
  const rede = lerRedePadrao(env);
  if (!rede) throw new Error('REDE_PADRAO ausente: a fonte própria atende a rede padrão do ambiente.');
  const fonte = new FonteAcessoPropria(nucleo, cliente, rede, aviso);
  await fonte.carregar();
  return fonte;
}
