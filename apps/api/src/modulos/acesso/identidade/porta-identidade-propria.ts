// Porta PRÓPRIA da identidade (M59-F2) sobre o banco do cliente, pelo @sgh/nucleo: a conta (usuario, com o vínculo
// vigente em usuario_estabelecimento e os perfis de usuario_perfil), a credencial (credencial_usuario), o segundo
// fator (segundo_fator_usuario) e a exigência do segundo fator por perfil (perfil_acesso.exige_segundo_fator).
// Leituras só leitura; gravações pelo Executor (trilha, outbox e idempotência na mesma transação), com trava otimista
// pela versão. Nada de senha, resumo de senha ou segredo vai a log, trilha ou resposta.
// Melhoria: a conta só é alcançada com vínculo vigente no estabelecimento da sessão (o gestor não mexe em conta de
//   outro estabelecimento) e a conta vencida (usuario.expira_em) conta como bloqueada.
// Melhoria: a credencial é uma por conta e quem a grava é a porta da senha (troca e redefinição). Aqui, gravarForte só
//   converte uma credencial que ainda não é Argon2id (nunca regrava a que a porta da senha acabou de gravar: versão +1
//   e uma trilha por ação), confere o vínculo da conta alvo com o estabelecimento e leva o AUTOR (o gestor, na
//   redefinição) como usuário da trilha.
// Decisão: credencial não Argon2id (bcrypt/scrypt da migração) é de redefinição obrigatória (redefinicaoObrigatoria):
//   o sistema não confere esses algoritmos, então o login recusa sem tentar e a gestão a mostra como "a redefinir".
// Melhoria: a conferência do código é anti-repetição no próprio UPDATE (o mesmo passo TOTP não vale duas vezes,
//   mesmo com dois logins simultâneos), e a revogação descarta o segredo.
// Melhoria: a exigência do segundo fator vem do cadastro do perfil (perfil_acesso.exige_segundo_fator OU privilegiado,
//   como diz o DDL), por estabelecimento ou da rede inteira, como ADESÃO sem prazo (origem 'cadastro-perfil'): quem
//   não tem segundo fator entra e é levado ao cadastro; o obrigatório vem da política por onda (politica_segundo_fator).
// Melhoria: a política por onda (início, prazo de adesão, alvo por perfil ou todos) é só por inclusão: encerrar marca
//   quem, quando e o motivo; alterar encerra a vigente ("Alterada: <motivo>") e liga a nova (substituida_por_id) na
//   mesma transação. O modelo próprio não tem grupos: a política por grupo é recusada (sem-grupos).
// Melhoria: o segredo do autenticador fica cifrado em envelope na coluna própria (segredo_cifrado); a referência ao
//   cofre fica nula. As linhas antigas, com o envelope em referencia_cofre (prefixo "envelope:"), continuam lidas.
import { TOTP_PADRAO } from '@sgh/dominio-acesso';
import {
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  type ResultadoOperacao,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PortaIdentidade } from './servico-identidade.js';
import type {
  ContaIdentidade,
  CredencialForte,
  GrupoContagemIdentidade,
  LinhaPolitica2faRegistrada,
  SegundoFatorRegistrado,
  SituacaoSegundoFatorRegistrado,
  TrilhaIdentidade,
  UsuarioIdentidadeRegistrado,
} from './tipos-identidade.js';

/** O mínimo do núcleo que a porta usa (os testes trocam). */
export type NucleoIdentidade = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

type Linha = Record<string, unknown>;
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1' || v === BigInt(1);
const data = (v: unknown): Date | null => (v instanceof Date ? v : v ? new Date(String(v)) : null);
const dia = (v: unknown): string =>
  v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    : texto(v).slice(0, 10);

/** Prefixo do envelope cifrado nas linhas antigas, que o guardavam em referencia_cofre. */
const PREFIXO_ENVELOPE = 'envelope:';
/** Marca do segredo descartado na revogação (o segredo cifrado é apagado). */
const SEGREDO_DESCARTADO = 'descartado';
const TIPO_AUTENTICADOR = 'aplicativo_autenticador';
const FORTE = 'argon2id';
const TETO_PAGINA = 200;

/** Vínculo vigente da conta com o estabelecimento (u = usuario). */
const SQL_VINCULO = `EXISTS (SELECT 1 FROM usuario_estabelecimento ue
   WHERE ue.usuario_id = u.id AND ue.estabelecimento_id = ? AND ue.excluido_em IS NULL
     AND ue.vigencia_inicio <= CURRENT_DATE AND (ue.vigencia_fim IS NULL OR ue.vigencia_fim >= CURRENT_DATE))`;
/** Perfis vigentes da conta no estabelecimento, para a tela. */
const SQL_PERFIS = `(SELECT GROUP_CONCAT(pa.codigo ORDER BY pa.codigo SEPARATOR ', ')
    FROM usuario_perfil up JOIN perfil_acesso pa ON pa.id = up.perfil_acesso_id AND pa.excluido_em IS NULL
   WHERE up.usuario_id = u.id AND up.estabelecimento_id = ? AND up.excluido_em IS NULL
     AND up.vigencia_inicio <= CURRENT_DATE AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= CURRENT_DATE))`;
/** A situação do segundo fator mais recente do autenticador. */
const SQL_SITUACAO_2FA = `(SELECT f.situacao FROM segundo_fator_usuario f
   WHERE f.usuario_id = u.id AND f.tipo = '${TIPO_AUTENTICADOR}' AND f.excluido_em IS NULL
   ORDER BY f.id DESC LIMIT 1)`;
const SQL_CONTA = `SELECT u.id, u.login, u.nome, u.nome_social, u.situacao,
       (u.expira_em IS NOT NULL AND u.expira_em < NOW(3)) AS vencida,
       c.id AS credencial_id, c.algoritmo, c.senha_alterada_em, ${SQL_PERFIS} AS perfis
  FROM usuario u
  LEFT JOIN credencial_usuario c ON c.usuario_id = u.id AND c.excluido_em IS NULL`;
/** Classe da senha em SQL, a mesma regra de situacaoCredencial (@sgh/dominio-acesso) sobre a credencial única. */
const SQL_CLASSE_SENHA = `CASE WHEN c.id IS NULL THEN 'sem-senha' WHEN c.algoritmo = '${FORTE}' THEN 'forte'
  ELSE 'legado-cifrada' END`;

function contaDe(r: Linha): ContaIdentidade {
  const login = texto(r['login']);
  const anterior =
    r['credencial_id'] !== null && r['credencial_id'] !== undefined && texto(r['algoritmo']) !== FORTE;
  const situacao = texto(r['situacao']);
  const perfis = texto(r['perfis']).slice(0, 150);
  return {
    login,
    id: Number(r['id']),
    nomeExibicao: texto(r['nome_social']).trim() || texto(r['nome']).trim() || login,
    ativo: situacao === 'ativo',
    bloqueado: situacao === 'bloqueado' || verdadeiro(r['vencida']),
    grupo: perfis || null,
    senhaPresente: anterior,
    criptografada: anterior,
    comSalt: anterior,
    senhaAlteradaEm: anterior ? data(r['senha_alterada_em']) : null,
    redefinicaoObrigatoria: anterior,
  };
}

/** "m=…,t=…,p=…" do texto PHC do Argon2id (o resumo não sai da porta). */
function parametrosDoPhc(phc: string): string {
  const m = /\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(phc);
  return m ? `m=${m[1]},t=${m[2]},p=${m[3]}` : '';
}

function forteDe(r: Linha): CredencialForte | null {
  const criadaEm = data(r['senha_alterada_em']);
  if (!criadaEm || texto(r['algoritmo']) !== FORTE) return null;
  return {
    id: texto(r['id']),
    algoritmo: FORTE,
    parametros: parametrosDoPhc(texto(r['resumo_senha'])),
    origem: verdadeiro(r['troca_obrigatoria']) ? 'senha-provisoria' : 'definida',
    criadaEm,
  };
}

function situacao2fa(v: unknown): SituacaoSegundoFatorRegistrado {
  const s = texto(v);
  // 'suspenso' não vale no login nem na tela: é como revogado até o gestor reativar.
  return s === 'ativo' ? 'ativo' : s === 'pendente' ? 'pendente' : 'revogado';
}

function segundoFatorDe(r: Linha): SegundoFatorRegistrado {
  const ref = texto(r['referencia_cofre']);
  const cifrado = texto(r['segredo_cifrado']);
  return {
    id: texto(r['id']),
    situacao: situacao2fa(r['situacao']),
    segredoEnvelope: cifrado || (ref.startsWith(PREFIXO_ENVELOPE) ? ref.slice(PREFIXO_ENVELOPE.length) : ''),
    digitos: TOTP_PADRAO.digitos,
    passoSegundos: TOTP_PADRAO.passoSegundos,
    criadoEm: data(r['cadastrado_em']),
    confirmadoEm: data(r['confirmado_em']),
    ultimaVerificacao: data(r['ultimo_uso_em']),
  };
}

/** Entrada das gravações: a chave do pedido e o alvo (os valores sensíveis ficam no fecho, nunca na idempotência). */
const ENTRADA = z.object({ chave: z.string().min(1).max(120) });

export class PortaIdentidadePropria implements PortaIdentidade {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;
  private readonly estabelecimentos = new Map<string, number>();

  constructor(
    private readonly nucleo: NucleoIdentidade,
    /** Código do cliente na plataforma (o banco é cliente_<codigo>); vem da configuração, nunca fixo no código. */
    private readonly cliente: string,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(fn: (l: Leitor) => Promise<T>, correlacao = 'acesso-identidade'): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao }, fn);
  }

  /** O id do estabelecimento pelo código da sessão (null: inexistente ou excluído). */
  private async idEstabelecimento(l: Leitor, h: string): Promise<number | null> {
    const guardado = this.estabelecimentos.get(h);
    if (guardado) return guardado;
    const r = await l.uma<{ id: number }>(
      'SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
      [h],
    );
    if (!r) return null;
    this.estabelecimentos.set(h, Number(r.id));
    return Number(r.id);
  }

  private async exigirEstabelecimento(l: Leitor, h: string): Promise<number> {
    const est = await this.idEstabelecimento(l, h);
    if (est === null) throw recusa('sem-estabelecimento', 'Estabelecimento da sessão inexistente.');
    return est;
  }

  /** Grava pelo Executor: a operação declara as tabelas; a trilha leva o evento e nunca valor sensível. */
  private async gravar<T extends ResultadoOperacao>(
    h: string,
    usuario: number,
    correlacao: string,
    nome: string,
    tabela: string,
    fn: (tx: TxOperacao, est: number) => Promise<T & { id: number | null }>,
    trilha: Record<string, unknown>,
  ): Promise<T & { id: number | null }> {
    const est = await this.ler((l) => this.exigirEstabelecimento(l, h));
    const chave = `identidade:${randomUUID()}`;
    const op = definirOperacao({
      nome,
      tabelas: [tabela],
      entrada: ENTRADA,
      gravar: (tx: TxOperacao) => fn(tx, est),
      alvo: (_e, r) => ({ tabela, id: typeof r.id === 'number' ? r.id : null }),
      trilha: () => ({ dados: trilha }),
    });
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: est,
      usuario,
      correlacao: correlacao.slice(0, 64) || 'acesso-identidade',
      chaveIdempotencia: chave,
    };
    const r = await this.executor.executar(op, this.cliente, { chave }, ctx);
    return r.resultado;
  }

  // ── conta e credencial ───────────────────────────────────────────────────────────────────────

  /** As tabelas da identidade fazem parte do modelo: prontas quando o estabelecimento existe. */
  prontas = (h: string) => this.ler(async (l) => (await this.idEstabelecimento(l, h)) !== null);

  conta = (h: string, login: string) =>
    this.ler(async (l) => {
      const est = await this.idEstabelecimento(l, h);
      if (est === null) return null;
      const r = await l.uma(`${SQL_CONTA} WHERE u.login = ? AND u.excluido_em IS NULL AND ${SQL_VINCULO}`, [
        est,
        login,
        est,
      ]);
      return r ? contaDe(r) : null;
    });

  private lerForte(l: Leitor, login: string, id: number) {
    return l.uma(
      `SELECT c.id, c.algoritmo, c.resumo_senha, c.senha_alterada_em, c.troca_obrigatoria
         FROM credencial_usuario c JOIN usuario u ON u.id = c.usuario_id
        WHERE c.usuario_id = ? AND u.login = ? AND c.excluido_em IS NULL AND u.excluido_em IS NULL`,
      [id, login],
    );
  }

  forte = (_h: string, login: string, id: number) =>
    this.ler(async (l) => {
      const r = await this.lerForte(l, login, id);
      return r ? forteDe(r) : null;
    });

  autenticarForte: PortaIdentidade['autenticarForte'] = (_h, login, id, senha, conferir) =>
    this.ler(async (l) => {
      const r = await this.lerForte(l, login, id);
      const credencial = r ? forteDe(r) : null;
      if (!r || !credencial) return null;
      // O resumo só existe dentro desta chamada: vai ao conferidor, que devolve sim ou não.
      return { confere: await conferir(senha, texto(r['resumo_senha']) || null), credencial };
    });

  /**
   * Converte para Argon2id a credencial que ainda não é Argon2id. A credencial já forte (gravada pela porta da senha
   * na mesma ação) ou ausente não é tocada: nada de segunda versão nem de segunda trilha. A conta alvo precisa de
   * vínculo vigente com o estabelecimento da sessão; o usuário da trilha é o autor (t.idUsuario), não o alvo.
   */
  gravarForte: PortaIdentidade['gravarForte'] = async (h, c, t) => {
    const atual = await this.ler((l) =>
      l.uma('SELECT algoritmo FROM credencial_usuario WHERE usuario_id = ? AND excluido_em IS NULL', [
        c.idUsuario,
      ]),
    );
    if (!atual || texto(atual['algoritmo']) === FORTE) return;
    await this.gravar(
      h,
      t.idUsuario,
      t.correlacao,
      'acesso.identidade.converter-credencial',
      'credencial_usuario',
      async (tx, est) => {
        const [alvo] = await tx.consultarParaAtualizar(
          `SELECT u.id FROM usuario u WHERE u.id = ? AND u.login = ? AND u.excluido_em IS NULL AND ${SQL_VINCULO}`,
          [c.idUsuario, c.login, est],
        );
        if (!alvo)
          throw recusa(
            'fora-do-estabelecimento',
            'A conta não tem vínculo vigente com este estabelecimento.',
          );
        const [cred] = await tx.consultarParaAtualizar(
          'SELECT id, versao, algoritmo, excluido_em FROM credencial_usuario WHERE usuario_id = ?',
          [c.idUsuario],
        );
        if (!cred || (cred['excluido_em'] !== null && cred['excluido_em'] !== undefined))
          throw recusa(
            'credencial-excluida',
            'A credencial da conta foi excluída: o acesso volta por redefinição.',
          );
        // Corrida com a porta da senha: já forte, nada a converter.
        if (texto(cred['algoritmo']) === FORTE) return { id: Number(cred['id']) };
        const troca = c.origem !== 'primeiro-login';
        await tx.alterar('credencial_usuario', Number(cred['id']), Number(cred['versao']), {
          algoritmo: FORTE,
          resumo_senha: c.hashPhc,
          ...(troca
            ? { senha_alterada_em: new Date(), troca_obrigatoria: c.origem === 'senha-provisoria' }
            : {}),
          tentativas_invalidas: 0,
          ultima_tentativa_invalida_em: null,
        });
        return { id: Number(cred['id']) };
      },
      { evento: t.evento, origem: c.origem, algoritmo: FORTE, contaAlvo: c.idUsuario },
    );
  };

  // ── segundo fator ────────────────────────────────────────────────────────────────────────────

  segundoFator = (_h: string, login: string, id: number) =>
    this.ler(async (l) => {
      const r = await l.uma(
        `SELECT f.id, f.situacao, f.referencia_cofre, f.segredo_cifrado, f.cadastrado_em, f.confirmado_em, f.ultimo_uso_em
           FROM segundo_fator_usuario f JOIN usuario u ON u.id = f.usuario_id
          WHERE f.usuario_id = ? AND u.login = ? AND f.tipo = ? AND f.excluido_em IS NULL
          ORDER BY f.id DESC LIMIT 1`,
        [id, login, TIPO_AUTENTICADOR],
      );
      return r ? segundoFatorDe(r) : null;
    });

  iniciar2fa: PortaIdentidade['iniciar2fa'] = async (h, c, t) => {
    const r = await this.gravar(
      h,
      t.idUsuario,
      t.correlacao,
      'acesso.identidade.iniciar-segundo-fator',
      'segundo_fator_usuario',
      async (tx) => {
        const vivos = await tx.consultarParaAtualizar(
          `SELECT id, situacao, versao FROM segundo_fator_usuario
            WHERE usuario_id = ? AND tipo = ? AND excluido_em IS NULL AND situacao IN ('pendente', 'ativo')
            ORDER BY id DESC`,
          [c.idUsuario, TIPO_AUTENTICADOR],
        );
        if (vivos.some((v) => v['situacao'] === 'ativo')) return { id: null, ja: true };
        const agora = new Date();
        const pendente = vivos[0];
        if (pendente) {
          await tx.alterar('segundo_fator_usuario', Number(pendente['id']), Number(pendente['versao']), {
            segredo_cifrado: c.segredoEnvelope,
            referencia_cofre: null,
            cadastrado_em: agora,
          });
          return { id: Number(pendente['id']), ja: false };
        }
        const id = await tx.incluir('segundo_fator_usuario', {
          usuario_id: c.idUsuario,
          tipo: TIPO_AUTENTICADOR,
          nome_dispositivo: 'Aplicativo autenticador',
          segredo_cifrado: c.segredoEnvelope,
          situacao: 'pendente',
          preferencial: false,
          cadastrado_em: agora,
        });
        return { id, ja: false };
      },
      { evento: t.evento },
    );
    return r.ja || r.id === null ? null : { id: String(r.id) };
  };

  /** Muda a situação de um segundo fator do estabelecimento da sessão, se estiver numa das situações de origem. */
  private async mudar2fa(
    h: string,
    id: string,
    t: TrilhaIdentidade,
    nome: string,
    de: readonly string[],
    valores: (agora: Date) => Record<string, unknown>,
  ): Promise<boolean> {
    if (!/^\d{1,18}$/.test(id)) return false;
    const r = await this.gravar(
      h,
      t.idUsuario,
      t.correlacao,
      nome,
      'segundo_fator_usuario',
      async (tx, est) => {
        const [f] = await tx.consultarParaAtualizar(
          `SELECT f.id, f.situacao, f.versao FROM segundo_fator_usuario f JOIN usuario u ON u.id = f.usuario_id
            WHERE f.id = ? AND f.excluido_em IS NULL AND ${SQL_VINCULO}`,
          [Number(id), est],
        );
        if (!f || !de.includes(texto(f['situacao']))) return { id: null, mudou: false };
        await tx.alterar('segundo_fator_usuario', Number(f['id']), Number(f['versao']), valores(new Date()));
        return { id: Number(f['id']), mudou: true };
      },
      { evento: t.evento },
    );
    return r.mudou === true;
  }

  confirmar2fa: PortaIdentidade['confirmar2fa'] = (h, id, t) =>
    this.mudar2fa(h, id, t, 'acesso.identidade.confirmar-segundo-fator', ['pendente'], (agora) => ({
      situacao: 'ativo',
      confirmado_em: agora,
      preferencial: true,
    }));

  revogar2fa: PortaIdentidade['revogar2fa'] = (h, id, t) =>
    this.mudar2fa(h, id, t, 'acesso.identidade.revogar-segundo-fator', ['pendente', 'ativo'], (agora) => ({
      situacao: 'revogado',
      revogado_em: agora,
      motivo_revogacao: t.evento.slice(0, 500),
      preferencial: false,
      referencia_cofre: SEGREDO_DESCARTADO,
      segredo_cifrado: null,
    }));

  /** Anti-repetição: grava o passo só se for posterior ao último usado (no próprio UPDATE). */
  marcar2fa: PortaIdentidade['marcar2fa'] = async (h, id, instante) => {
    if (!/^\d{1,18}$/.test(id)) return false;
    const dono = await this.ler((l) =>
      l.uma<{ usuario_id: number }>('SELECT usuario_id FROM segundo_fator_usuario WHERE id = ?', [
        Number(id),
      ]),
    );
    if (!dono) return false;
    const r = await this.gravar(
      h,
      Number(dono.usuario_id),
      'acesso-identidade-login',
      'acesso.identidade.conferir-segundo-fator',
      'segundo_fator_usuario',
      async (tx) => {
        const n = await tx.executar(
          `UPDATE segundo_fator_usuario SET ultimo_uso_em = ?, versao = versao + 1, alterado_em = ?, alterado_por = ?
            WHERE id = ? AND situacao = 'ativo' AND excluido_em IS NULL
              AND (ultimo_uso_em IS NULL OR ultimo_uso_em < ?)`,
          [instante, new Date(), Number(dono.usuario_id), Number(id), instante],
        );
        return { id: Number(id), marcou: n === 1 };
      },
      { evento: 'acesso.segundofator.conferido' },
    );
    return r.marcou === true;
  };

  // ── política do segundo fator ────────────────────────────────────────────────────────────────

  /**
   * A exigência pelo cadastro do perfil (do estabelecimento ou da rede inteira): exige segundo fator ou privilegiado.
   * Origem 'cadastro-perfil': o serviço a trata como adesão sem prazo (entrar e cadastrar), nunca como obrigatório.
   */
  politicas = (h: string) =>
    this.ler(async (l) => {
      const est = await this.idEstabelecimento(l, h);
      if (est === null) return [];
      const linhas = await l.consultar(
        `SELECT id, codigo, COALESCE(ativado_em, DATE(criado_em)) AS inicio, criado_em
           FROM perfil_acesso
          WHERE (exige_segundo_fator OR privilegiado) AND ativo AND excluido_em IS NULL
            AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)
          ORDER BY id DESC`,
        [est],
        { teto: 500 },
      );
      const ondas = await l.consultar(
        `SELECT p.id, p.alvo, pa.codigo, p.onda, DATE_FORMAT(p.inicio, '%Y-%m-%d') AS inicio, p.prazo_adesao_dias, p.motivo,
                u.login AS criada_por, p.criado_em, p.encerrada_em
           FROM politica_segundo_fator p LEFT JOIN perfil_acesso pa ON pa.id = p.perfil_acesso_id
           LEFT JOIN usuario u ON u.id = p.criado_por
          WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL
          ORDER BY p.id DESC`,
        [est],
        { teto: 500 },
      );
      const porOnda = ondas.map((r): LinhaPolitica2faRegistrada => ({
        id: texto(r['id']),
        hospital: h,
        alvo: texto(r['alvo']) === 'todos' ? 'todos' : 'perfil',
        valor: texto(r['alvo']) === 'todos' ? null : texto(r['codigo']),
        onda: Number(r['onda']) === 2 ? 2 : 1,
        inicio: texto(r['inicio']),
        prazoAdesaoDias: Number(r['prazo_adesao_dias']),
        motivo: texto(r['motivo']),
        criadaPor: texto(r['criada_por']),
        criadaEm: data(r['criado_em']),
        encerradaEm: data(r['encerrada_em']),
      }));
      return [
        ...porOnda,
        ...linhas.map((r): LinhaPolitica2faRegistrada => ({
          id: `perfil-${texto(r['id'])}`,
          hospital: h,
          alvo: 'perfil',
          valor: texto(r['codigo']),
          onda: 1,
          inicio: dia(r['inicio']),
          prazoAdesaoDias: 0,
          motivo: 'Exigência do cadastro do perfil de acesso: adesão, sem prazo',
          criadaPor: '',
          criadaEm: data(r['criado_em']),
          encerradaEm: null,
          origem: 'cadastro-perfil',
        })),
      ];
    });

  /** O perfil do alvo da política (do estabelecimento ou da rede inteira); 'todos' não tem perfil; grupo não existe. */
  private async perfilDaPolitica(
    tx: TxOperacao,
    est: number,
    alvo: string,
    valor: string | null,
  ): Promise<number | null> {
    if (alvo === 'todos') return null;
    if (alvo !== 'perfil')
      throw recusa(
        'sem-grupos',
        'O modelo próprio não tem grupos: a política vale por perfil ou para todos.',
      );
    const p = await tx.uma<{ id: number }>(
      `SELECT id FROM perfil_acesso WHERE codigo = ? AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)
         AND excluido_em IS NULL ORDER BY estabelecimento_id IS NULL LIMIT 1`,
      [valor ?? '', est],
    );
    if (!p)
      throw recusa('perfil-inexistente', 'O perfil da política não está cadastrado neste estabelecimento.');
    return Number(p.id);
  }

  /** A linha vigente da política por onda, travada (null: inexistente, encerrada ou de outro estabelecimento). */
  private async politicaTravada(tx: TxOperacao, est: number, id: string): Promise<Linha | null> {
    if (!/^\d{1,18}$/.test(id)) return null;
    const [p] = await tx.consultarParaAtualizar(
      `SELECT id, versao, onda, inicio FROM politica_segundo_fator
        WHERE id = ? AND estabelecimento_id = ? AND encerrada_em IS NULL AND excluido_em IS NULL`,
      [Number(id), est],
    );
    return p ?? null;
  }

  incluirPolitica: PortaIdentidade['incluirPolitica'] = async (h, p, t) => {
    const r = await this.gravar(
      h,
      t.idUsuario,
      t.correlacao,
      'acesso.identidade.incluir-politica-segundo-fator',
      'politica_segundo_fator',
      async (tx, est) => ({
        id: await tx.incluir('politica_segundo_fator', {
          estabelecimento_id: est,
          alvo: p.alvo,
          perfil_acesso_id: await this.perfilDaPolitica(tx, est, p.alvo, p.valor),
          onda: p.onda,
          inicio: p.inicio,
          prazo_adesao_dias: p.prazoAdesaoDias,
          motivo: p.motivo.slice(0, 500),
        }),
      }),
      {
        evento: t.evento,
        alvo: p.alvo,
        valor: p.valor,
        onda: p.onda,
        inicio: p.inicio,
        prazoAdesaoDias: p.prazoAdesaoDias,
      },
    );
    return { id: String(r.id) };
  };

  encerrarPolitica: PortaIdentidade['encerrarPolitica'] = async (h, c, t) => {
    const r = await this.gravar(
      h,
      t.idUsuario,
      t.correlacao,
      'acesso.identidade.encerrar-politica-segundo-fator',
      'politica_segundo_fator',
      async (tx, est) => {
        const atual = await this.politicaTravada(tx, est, c.id);
        if (!atual) return { id: null, encerrou: false };
        await tx.alterar('politica_segundo_fator', Number(atual['id']), Number(atual['versao']), {
          encerrada_em: new Date(),
          encerrada_por_usuario_id: t.idUsuario,
          motivo_encerramento: c.motivo.slice(0, 500),
        });
        return { id: Number(atual['id']), encerrou: true };
      },
      { evento: t.evento, motivo: c.motivo.slice(0, 500) },
    );
    return r.encerrou === true;
  };

  alterarPolitica: PortaIdentidade['alterarPolitica'] = async (h, a, t) => {
    const r = await this.gravar(
      h,
      t.idUsuario,
      t.correlacao,
      'acesso.identidade.alterar-politica-segundo-fator',
      'politica_segundo_fator',
      async (tx, est) => {
        const atual = await this.politicaTravada(tx, est, a.id);
        if (!atual) return { id: null, anterior: null };
        const nova = await tx.incluir('politica_segundo_fator', {
          estabelecimento_id: est,
          alvo: a.alvo,
          perfil_acesso_id: await this.perfilDaPolitica(tx, est, a.alvo, a.valor),
          onda: Number(atual['onda']),
          inicio: dia(atual['inicio']),
          prazo_adesao_dias: a.prazoAdesaoDias,
          motivo: a.motivo.slice(0, 500),
        });
        await tx.alterar('politica_segundo_fator', Number(atual['id']), Number(atual['versao']), {
          encerrada_em: new Date(),
          encerrada_por_usuario_id: t.idUsuario,
          motivo_encerramento: `Alterada: ${a.motivo}`.slice(0, 500),
          substituida_por_id: nova,
        });
        return { id: nova, anterior: String(atual['id']) };
      },
      { evento: t.evento, alvo: a.alvo, valor: a.valor, prazoAdesaoDias: a.prazoAdesaoDias },
    );
    return r.id === null || r.anterior === null ? null : { id: String(r.id), anterior: r.anterior };
  };

  // ── gestão ───────────────────────────────────────────────────────────────────────────────────

  usuarios: PortaIdentidade['usuarios'] = (h, f) =>
    this.ler(async (l) => {
      const est = await this.idEstabelecimento(l, h);
      if (est === null) return { itens: [], temMais: false };
      const tamanho = Math.min(Math.max(f.tamanho, 1), TETO_PAGINA);
      const inicio = (Math.max(f.pagina, 1) - 1) * tamanho;
      const params: unknown[] = [est, est];
      const condicoes = ['u.excluido_em IS NULL', SQL_VINCULO];
      const busca = (f.busca ?? '').trim();
      if (busca) {
        condicoes.push('(u.login LIKE ? OR u.nome LIKE ?)');
        const prefixo = `${busca.replace(/[\\%_]/g, (x) => `\\${x}`)}%`;
        params.push(prefixo, prefixo);
      }
      if (f.senha) {
        condicoes.push(`(${SQL_CLASSE_SENHA}) = ?`);
        params.push(f.senha);
      }
      params.push(tamanho + 1, inicio);
      const linhas = await l.consultar(
        `SELECT q.*, ${SQL_SITUACAO_2FA.replace(/u\.id/g, 'q.id')} AS f2 FROM (
           ${SQL_CONTA}
            WHERE ${condicoes.join(' AND ')} ORDER BY u.login LIMIT ? OFFSET ?) q ORDER BY q.login`,
        params,
        { teto: tamanho + 1 },
      );
      const itens = linhas.slice(0, tamanho).map((r): UsuarioIdentidadeRegistrado => {
        const forte = texto(r['algoritmo']) === FORTE;
        return {
          ...contaDe(r),
          forteEm: forte ? data(r['senha_alterada_em']) : null,
          forteAlgoritmo:
            r['credencial_id'] === null || r['credencial_id'] === undefined ? null : texto(r['algoritmo']),
          segundoFator: r['f2'] === null || r['f2'] === undefined ? 'ausente' : situacao2fa(r['f2']),
        };
      });
      return { itens, temMais: linhas.length > tamanho };
    });

  /** Contagens das contas ativas com vínculo vigente, agrupadas por classe. */
  contagens = (h: string) =>
    this.ler(async (l) => {
      const est = await this.idEstabelecimento(l, h);
      if (est === null) return [];
      const linhas = await l.consultar(
        `SELECT anterior, forte, f2, COUNT(*) AS n FROM (
           SELECT (c.id IS NOT NULL AND c.algoritmo <> '${FORTE}') AS anterior,
                  (c.id IS NOT NULL AND c.algoritmo = '${FORTE}') AS forte,
                  ${SQL_SITUACAO_2FA} AS f2
             FROM usuario u LEFT JOIN credencial_usuario c ON c.usuario_id = u.id AND c.excluido_em IS NULL
            WHERE u.excluido_em IS NULL AND u.situacao = 'ativo'
              AND (u.expira_em IS NULL OR u.expira_em >= NOW(3)) AND ${SQL_VINCULO}) x
          GROUP BY anterior, forte, f2`,
        [est],
        { teto: 100 },
      );
      return linhas.map((r): GrupoContagemIdentidade => {
        const anterior = verdadeiro(r['anterior']);
        return {
          senhaPresente: anterior,
          criptografada: anterior,
          comSalt: anterior,
          forteVigente: verdadeiro(r['forte']),
          segundoFator: r['f2'] === null || r['f2'] === undefined ? 'ausente' : situacao2fa(r['f2']),
          n: Number(r['n']),
        };
      });
    });
}
