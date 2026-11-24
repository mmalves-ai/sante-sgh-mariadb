// Suporte técnico e "login como" (ADR 0021) no banco PRÓPRIO.
// - RepositorioPlataformaPropria: contas da plataforma e do suporte, atribuições, auditoria das contas e das sessões
//   "como" no banco plataforma (db/plataforma/0090), pelo núcleo (lerPlataforma/escreverPlataforma). Mesmo
//   comportamento da porta de memória: e-mail exato, ordem de inserção nas listas, eventos do mais novo ao mais velho,
//   sessões da mais nova à mais velha, leituras somadas por caminho, encerrar só a sessão aberta.
// - FonteComoEstabelecimentoPropria: grupos (perfis de acesso vigentes) e usuários ativos de cada estabelecimento e o
//   cruzamento com a trilha própria do cliente, pelo núcleo (só leitura). A correção das escritas do suporte depende
//   das imagens de correção, que o banco próprio não guarda: a prévia e o Corrigir são recusados (ErroCorrigir-
//   Indisponivel, 409 na rota) e nenhuma ação mostra imagem; nada é gravado no banco do cliente por esta fonte.
// Registro de auditoria nunca é apagado: nenhuma operação daqui apaga linha.
import type { Escritor, Leitor, Linha, NucleoProprio } from '@sgh/nucleo';
import type { NucleoPlataforma } from '../../sessao/fonte-plataforma.js';
import {
  ErroCorrigirIndisponivel,
  type FonteComoEstabelecimento,
  type RepositorioPlataforma,
} from './repositorio.js';
import type {
  AcaoLida,
  AcaoNova,
  AtribuicaoLida,
  ContaLida,
  ContaNova,
  CorrecaoFeita,
  EventoConta,
  EventoContaLido,
  GrupoAlvo,
  LeituraLida,
  LinhaCruzamento,
  MudancaConta,
  PassoCorrecao,
  SessaoComoLida,
  SessaoComoNova,
  UsuarioAlvo,
} from './tipos.js';

const bool = (v: unknown): boolean => v === true || Number(v) === 1;
const txt = (v: unknown): string => String(v ?? '');
const txtOuNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const data = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));
const dataOuNull = (v: unknown): Date | null => (v === null || v === undefined ? null : data(v));
/** Id da porta (texto) → id do banco; fora do formato não existe. */
const idBanco = (id: string): number | null => (/^[1-9]\d{0,18}$/.test(id) ? Number(id) : null);

/** Situação da ação: a forma da porta ↔ a do banco (nomes de negócio). */
const SITUACAO_NO_BANCO = {
  ok: 'concluida',
  error: 'erro',
  blocked: 'bloqueada',
  aborted: 'interrompida',
} as const satisfies Record<AcaoNova['status'], string>;
const SITUACAO_NA_PORTA: Record<string, AcaoNova['status']> = {
  concluida: 'ok',
  erro: 'error',
  bloqueada: 'blocked',
  interrompida: 'aborted',
};

/** Tamanho da chave de agregação das leituras (coluna caminho de sessao_suporte_leitura). */
export const CAMINHO_LEITURA_MAX = 700;

const COLUNAS_CONTA = `id, email, nome, papel, ativo, resumo_senha, segredo_segundo_fator, segundo_fator_ativo,
  convite_resumo, convite_valido_ate, criado_em`;

function contaDaLinha(l: Linha): ContaLida {
  return {
    id: txt(l['id']),
    email: txt(l['email']),
    nome: txtOuNull(l['nome']),
    papel: txt(l['papel']) === 'plataforma' ? 'PLATAFORMA' : 'SUPORTE',
    ativo: bool(l['ativo']),
    cifra: txtOuNull(l['resumo_senha']),
    totpEnv: txtOuNull(l['segredo_segundo_fator']),
    totpAtivo: bool(l['segundo_fator_ativo']),
    conviteHash: txtOuNull(l['convite_resumo']),
    conviteAte: dataOuNull(l['convite_valido_ate']),
    criadoEm: data(l['criado_em']),
  };
}

const SQL_SESSAO = `SELECT s.id, s.conta_plataforma_id, s.ator_tipo, s.rede, s.estabelecimento, s.alvo_login, s.motivo,
       s.modo, s.inicio, s.expira_em, s.fim, s.encerramento,
       (SELECT COUNT(*) FROM sessao_suporte_acao a WHERE a.sessao_suporte_id = s.id) AS escritas,
       (SELECT COUNT(*) FROM sessao_suporte_acao a WHERE a.sessao_suporte_id = s.id AND a.clinico) AS atos_clinicos
  FROM sessao_suporte s`;

function sessaoDaLinha(l: Linha): SessaoComoLida {
  return {
    id: txt(l['id']),
    idConta: txt(l['conta_plataforma_id']),
    atorTipo: txt(l['ator_tipo']) === 'plataforma' ? 'plataforma' : 'suporte',
    rede: txt(l['rede']),
    hospital: txt(l['estabelecimento']),
    alvoLogin: txt(l['alvo_login']),
    motivo: txtOuNull(l['motivo']),
    modo: txt(l['modo']) === 'acesso-total' ? 'acesso-total' : 'como',
    inicio: data(l['inicio']),
    expiraEm: data(l['expira_em']),
    fim: dataOuNull(l['fim']),
    encerramento: txtOuNull(l['encerramento']),
    escritas: Number(l['escritas'] ?? 0),
    atosClinicos: Number(l['atos_clinicos'] ?? 0),
  };
}

function acaoDaLinha(l: Linha): AcaoLida {
  return {
    id: txt(l['id']),
    sessao: txt(l['sessao_suporte_id']),
    metodo: txt(l['metodo']),
    caminho: txt(l['caminho']),
    status: SITUACAO_NA_PORTA[txt(l['situacao'])] ?? 'error',
    http: l['codigo_http'] === null || l['codigo_http'] === undefined ? null : Number(l['codigo_http']),
    clinico: bool(l['clinico']),
    naoReversivel: txtOuNull(l['nao_reversivel']),
    dataHora: data(l['ocorrido_em']),
  };
}

const duplicado = (e: unknown, chave: string): boolean =>
  e instanceof Error && /Duplicate entry|ER_DUP_ENTRY|1062/.test(e.message) && e.message.includes(chave);

export class RepositorioPlataformaPropria implements RepositorioPlataforma {
  readonly persistente = true;

  constructor(
    private readonly nucleo: NucleoPlataforma,
    private readonly agora: () => number = () => Date.now(),
  ) {}

  private ler<T>(correlacao: string, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerPlataforma(`suporte-${correlacao}`, fn);
  }
  private escrever<T>(correlacao: string, fn: (e: Escritor) => Promise<T>): Promise<T> {
    return this.nucleo.escreverPlataforma(`suporte-${correlacao}`, fn);
  }
  private quando(): Date {
    return new Date(this.agora());
  }

  private async evento(e: Escritor, ev: EventoConta): Promise<void> {
    const agora = this.quando();
    await e.inserir(
      `INSERT INTO conta_plataforma_evento
         (ator_conta_id, evento, conta_alvo_id, detalhe, estacao, ocorrido_em, criado_em, criado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ev.ator ? idBanco(ev.ator) : null,
        ev.evento,
        ev.contaAlvo ? idBanco(ev.contaAlvo) : null,
        ev.detalhe,
        ev.estacao,
        agora,
        agora,
        ev.ator ? idBanco(ev.ator) : null,
      ],
    );
  }

  async contaPorEmail(email: string): Promise<ContaLida | null> {
    // E-mail exato, como a porta de memória (a colação do banco ignora caixa e acentos).
    const l = await this.ler('conta-email', (x) =>
      x.uma(
        `SELECT ${COLUNAS_CONTA} FROM conta_plataforma WHERE email = ? AND CAST(email AS BINARY) = CAST(? AS BINARY)`,
        [email, email],
      ),
    );
    return l ? contaDaLinha(l) : null;
  }

  async contaPorId(id: string): Promise<ContaLida | null> {
    const n = idBanco(id);
    if (n === null) return null;
    const l = await this.ler('conta-id', (x) =>
      x.uma(`SELECT ${COLUNAS_CONTA} FROM conta_plataforma WHERE id = ?`, [n]),
    );
    return l ? contaDaLinha(l) : null;
  }

  async contaPorConvite(hash: string): Promise<ContaLida | null> {
    const l = await this.ler('conta-convite', (x) =>
      x.uma(
        `SELECT ${COLUNAS_CONTA} FROM conta_plataforma
          WHERE convite_resumo = ? AND CAST(convite_resumo AS BINARY) = CAST(? AS BINARY)`,
        [hash, hash],
      ),
    );
    return l ? contaDaLinha(l) : null;
  }

  async contas(): Promise<ContaLida[]> {
    const ls = await this.ler('contas', (x) =>
      x.consultar(`SELECT ${COLUNAS_CONTA} FROM conta_plataforma ORDER BY id`),
    );
    return ls.map(contaDaLinha);
  }

  async atribuicoes(idConta?: string): Promise<AtribuicaoLida[]> {
    if (idConta !== undefined && idConta !== '' && idBanco(idConta) === null) return [];
    const filtro = idConta ? ' AND conta_plataforma_id = ?' : '';
    const ls = await this.ler('atribuicoes', (x) =>
      x.consultar(
        `SELECT conta_plataforma_id, rede, estabelecimento FROM atribuicao_suporte WHERE ativo${filtro} ORDER BY id`,
        idConta ? [idBanco(idConta)] : [],
      ),
    );
    return ls.map((l) => ({
      idConta: txt(l['conta_plataforma_id']),
      rede: txt(l['rede']),
      hospital: txt(l['estabelecimento']),
    }));
  }

  async criarConta(c: ContaNova, evento: Omit<EventoConta, 'contaAlvo'>): Promise<string> {
    try {
      return await this.escrever('criar-conta', async (e) => {
        const agora = this.quando();
        const id = await e.inserir(
          `INSERT INTO conta_plataforma
             (email, nome, papel, ativo, resumo_senha, convite_resumo, convite_valido_ate, criado_em, criado_por)
           VALUES (?, ?, ?, TRUE, ?, ?, ?, ?, ?)`,
          [
            c.email,
            c.nome,
            c.papel === 'PLATAFORMA' ? 'plataforma' : 'suporte',
            c.cifra,
            c.conviteHash,
            c.conviteAte,
            agora,
            c.criadoPor ? idBanco(c.criadoPor) : null,
          ],
        );
        await this.evento(e, { ...evento, contaAlvo: String(id) });
        return String(id);
      });
    } catch (e) {
      if (duplicado(e, 'uq_conta_plataforma_email')) throw new Error('uq_conta_plataforma_email', { cause: e });
      throw e;
    }
  }

  async alterarConta(id: string, m: MudancaConta, evento: EventoConta | null): Promise<void> {
    const n = idBanco(id);
    if (n === null) throw new Error('conta_plataforma: conta não alterada.');
    const sets: string[] = [];
    const p: unknown[] = [];
    const por = (coluna: string, v: unknown) => {
      sets.push(`${coluna} = ?`);
      p.push(v);
    };
    if (m.ativo !== undefined) por('ativo', m.ativo);
    if (m.cifra !== undefined) por('resumo_senha', m.cifra);
    if (m.totpEnv !== undefined) por('segredo_segundo_fator', m.totpEnv);
    if (m.totpAtivo !== undefined) por('segundo_fator_ativo', m.totpAtivo);
    if (m.conviteHash !== undefined) por('convite_resumo', m.conviteHash);
    if (m.conviteAte !== undefined) por('convite_valido_ate', m.conviteAte);
    await this.escrever('alterar-conta', async (e) => {
      const agora = this.quando();
      const feito = await e.executar(
        `UPDATE conta_plataforma SET ${[...sets, 'alterado_em = ?', 'alterado_por = ?', 'versao = versao + 1'].join(', ')}
          WHERE id = ?`,
        [...p, agora, evento?.ator ? idBanco(evento.ator) : null, n],
      );
      if (feito !== 1) throw new Error('conta_plataforma: conta não alterada.');
      if (evento) await this.evento(e, evento);
    });
  }

  async definirAtribuicoes(
    id: string,
    rede: string,
    hospitais: readonly string[],
    evento: Omit<EventoConta, 'detalhe'>,
  ): Promise<{ ligados: string[]; desligados: string[] }> {
    const n = idBanco(id);
    if (n === null) throw new Error('atribuicao_suporte: conta inexistente.');
    return this.escrever('atribuicoes', async (e) => {
      const agora = this.quando();
      const ator = evento.ator ? idBanco(evento.ator) : null;
      const atuais = await e.consultarParaAtualizar(
        'SELECT id, estabelecimento, ativo FROM atribuicao_suporte WHERE conta_plataforma_id = ? AND rede = ? ORDER BY id',
        [n, rede],
      );
      const ligados: string[] = [];
      const desligados: string[] = [];
      const pedidos = new Set(hospitais);
      for (const a of atuais) {
        const h = txt(a['estabelecimento']);
        const quer = pedidos.has(h);
        pedidos.delete(h);
        if (bool(a['ativo']) !== quer) {
          (quer ? ligados : desligados).push(h);
          await e.executar(
            'UPDATE atribuicao_suporte SET ativo = ?, alterado_em = ?, alterado_por = ?, versao = versao + 1 WHERE id = ?',
            [quer, agora, ator, a['id']],
          );
        }
      }
      for (const h of pedidos) {
        await e.inserir(
          `INSERT INTO atribuicao_suporte (conta_plataforma_id, rede, estabelecimento, ativo, criado_em, criado_por)
           VALUES (?, ?, ?, TRUE, ?, ?)`,
          [n, rede, h, agora, ator],
        );
        ligados.push(h);
      }
      const r = { ligados: ligados.sort(), desligados: desligados.sort() };
      await this.evento(e, { ...evento, detalhe: JSON.stringify({ rede, ...r }) });
      return r;
    });
  }

  async eventosConta(limite = 200): Promise<EventoContaLido[]> {
    const ls = await this.ler('eventos', (x) =>
      x.consultar(
        `SELECT id, ator_conta_id, evento, conta_alvo_id, detalhe, estacao, ocorrido_em
           FROM conta_plataforma_evento ORDER BY id DESC LIMIT ?`,
        [Math.max(0, Math.floor(limite))],
      ),
    );
    return ls.map((l) => ({
      id: txt(l['id']),
      ator: txtOuNull(l['ator_conta_id']),
      evento: txt(l['evento']),
      contaAlvo: txtOuNull(l['conta_alvo_id']),
      detalhe: txtOuNull(l['detalhe']),
      estacao: txtOuNull(l['estacao']),
      dataHora: data(l['ocorrido_em']),
    }));
  }

  async registrarEventoConta(evento: EventoConta): Promise<void> {
    await this.escrever('evento', (e) => this.evento(e, evento));
  }

  async abrirSessaoComo(s: SessaoComoNova): Promise<{ id: string; inicio: Date; expiraEm: Date }> {
    const conta = idBanco(s.idConta);
    if (conta === null) throw new Error('sessao_suporte: conta inexistente.');
    const inicio = this.quando();
    const expiraEm = new Date(inicio.getTime() + s.minutos * 60_000);
    const id = await this.escrever('abrir-sessao', (e) =>
      e.inserir(
        `INSERT INTO sessao_suporte
           (conta_plataforma_id, ator_tipo, rede, estabelecimento, alvo_login, alvo_usuario_id, motivo, modo, inicio,
            expira_em, estacao, criado_em, criado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          conta,
          s.atorTipo,
          s.rede,
          s.hospital,
          s.alvoLogin,
          s.alvoId,
          s.motivo,
          s.modo ?? 'como',
          inicio,
          expiraEm,
          s.estacao,
          inicio,
          conta,
        ],
      ),
    );
    return { id: String(id), inicio, expiraEm };
  }

  /** O banco plataforma não tem outbox: como a memória, devolve false e o serviço manda o aviso pela fila. */
  registrarAvisoComo(): Promise<boolean> {
    return Promise.resolve(false);
  }

  async encerrarSessaoComo(id: string, motivo: string, por: string | null = null): Promise<boolean> {
    const n = idBanco(id);
    if (n === null) return false;
    const agora = this.quando();
    const feito = await this.escrever('encerrar-sessao', (e) =>
      e.executar(
        `UPDATE sessao_suporte SET fim = ?, encerramento = ?, encerrado_por = ?, alterado_em = ?, alterado_por = ?,
                versao = versao + 1
          WHERE id = ? AND fim IS NULL`,
        [agora, motivo, por ? idBanco(por) : null, agora, por ? idBanco(por) : null, n],
      ),
    );
    return feito === 1;
  }

  async sessaoComo(id: string): Promise<SessaoComoLida | null> {
    const n = idBanco(id);
    if (n === null) return null;
    const l = await this.ler('sessao', (x) => x.uma(`${SQL_SESSAO} WHERE s.id = ?`, [n]));
    return l ? sessaoDaLinha(l) : null;
  }

  async sessoesComo(filtro: { hospital?: string; idConta?: string; limite?: number }): Promise<SessaoComoLida[]> {
    const onde: string[] = [];
    const p: unknown[] = [];
    if (filtro.hospital) {
      onde.push('s.estabelecimento = ?');
      p.push(filtro.hospital);
    }
    if (filtro.idConta) {
      const n = idBanco(filtro.idConta);
      if (n === null) return [];
      onde.push('s.conta_plataforma_id = ?');
      p.push(n);
    }
    const ls = await this.ler('sessoes', (x) =>
      x.consultar(
        `${SQL_SESSAO}${onde.length ? ` WHERE ${onde.join(' AND ')}` : ''} ORDER BY s.id DESC LIMIT ?`,
        [...p, Math.max(0, Math.floor(filtro.limite ?? 200))],
      ),
    );
    return ls.map(sessaoDaLinha);
  }

  async registrarAcao(a: AcaoNova): Promise<string> {
    const s = idBanco(a.sessao);
    if (s === null) throw new Error('sessao_suporte_acao: sessão inexistente.');
    const agora = this.quando();
    const id = await this.escrever('acao', (e) =>
      e.inserir(
        `INSERT INTO sessao_suporte_acao
           (sessao_suporte_id, metodo, caminho, situacao, codigo_http, clinico, nao_reversivel, ocorrido_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [s, a.metodo, a.caminho, SITUACAO_NO_BANCO[a.status], a.http, a.clinico, a.naoReversivel, agora, agora],
      ),
    );
    return String(id);
  }

  async finalizarAcao(id: string, status: AcaoNova['status'], http: number | null): Promise<void> {
    const n = idBanco(id);
    if (n === null) return;
    const agora = this.quando();
    await this.escrever('finalizar-acao', (e) =>
      e.executar(
        `UPDATE sessao_suporte_acao SET situacao = ?, codigo_http = ?, alterado_em = ?, versao = versao + 1
          WHERE id = ?`,
        [SITUACAO_NO_BANCO[status], http, agora, n],
      ),
    );
  }

  async acoes(sessao: string): Promise<AcaoLida[]> {
    const n = idBanco(sessao);
    if (n === null) return [];
    const ls = await this.ler('acoes', (x) =>
      x.consultar(
        `SELECT id, sessao_suporte_id, metodo, caminho, situacao, codigo_http, clinico, nao_reversivel, ocorrido_em
           FROM sessao_suporte_acao WHERE sessao_suporte_id = ? ORDER BY id`,
        [n],
      ),
    );
    return ls.map(acaoDaLinha);
  }

  async somarLeituras(sessao: string, caminho: string, n: number, primeira: Date, ultima: Date): Promise<void> {
    const s = idBanco(sessao);
    if (s === null) return;
    const agora = this.quando();
    await this.escrever('leituras', (e) =>
      e.executar(
        `INSERT INTO sessao_suporte_leitura (sessao_suporte_id, caminho, quantidade, primeira_em, ultima_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE quantidade = quantidade + VALUES(quantidade), ultima_em = VALUES(ultima_em),
                                 alterado_em = VALUES(criado_em), versao = versao + 1`,
        [s, caminho.slice(0, CAMINHO_LEITURA_MAX), n, primeira, ultima, agora],
      ),
    );
  }

  async leituras(sessao: string): Promise<LeituraLida[]> {
    const s = idBanco(sessao);
    if (s === null) return [];
    const ls = await this.ler('ler-leituras', (x) =>
      x.consultar(
        `SELECT sessao_suporte_id, caminho, quantidade, primeira_em, ultima_em
           FROM sessao_suporte_leitura WHERE sessao_suporte_id = ? ORDER BY id`,
        [s],
      ),
    );
    return ls.map((l) => ({
      sessao: txt(l['sessao_suporte_id']),
      caminho: txt(l['caminho']),
      quantidade: Number(l['quantidade']),
      primeira: data(l['primeira_em']),
      ultima: data(l['ultima_em']),
    }));
  }
}

// ── O "como" no banco do cliente ───────────────────────────────────────────────────────────────

/** Conta ativa, sem bloqueio, dentro da validade e com vínculo vigente no estabelecimento (parâmetro: est). */
const CONTA_ALVO = `u.excluido_em IS NULL AND u.situacao = 'ativo' AND u.bloqueado_em IS NULL
  AND (u.expira_em IS NULL OR u.expira_em > UTC_TIMESTAMP(3))
  AND EXISTS (SELECT 1 FROM usuario_estabelecimento ue WHERE ue.usuario_id = u.id AND ue.estabelecimento_id = up.estabelecimento_id
              AND ue.excluido_em IS NULL AND ue.vigencia_inicio <= UTC_DATE()
              AND (ue.vigencia_fim IS NULL OR ue.vigencia_fim >= UTC_DATE()))`;
const PERFIL_VIGENTE = `up.estabelecimento_id = ? AND up.excluido_em IS NULL AND up.vigencia_inicio <= UTC_DATE()
  AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= UTC_DATE())`;

/** Limite de linhas do cruzamento com a trilha (a janela de uma sessão "como"). */
export const LIMITE_CRUZAMENTO = 5_000;

export const MENSAGEM_CORRECAO_INDISPONIVEL =
  'A correção das escritas do suporte não está disponível neste banco: ele não guarda as imagens de correção.';

export class FonteComoEstabelecimentoPropria implements FonteComoEstabelecimento {
  constructor(
    private readonly nucleo: Pick<NucleoProprio, 'lerSomente'>,
    /** Código do cliente na plataforma (o banco é cliente_<codigo>). */
    private readonly cliente: string,
  ) {}

  private ler<T>(correlacao: string, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: `suporte-como-${correlacao}` }, fn);
  }

  private async estabelecimento(l: Leitor, codigo: string): Promise<number | null> {
    const e = await l.uma<{ id: number }>(
      'SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
      [codigo],
    );
    return e ? Number(e.id) : null;
  }

  /** Os perfis de acesso vigentes no estabelecimento com quantos usuários ativos têm cada um, pelo código. */
  grupos(hospital: string): Promise<GrupoAlvo[]> {
    return this.ler('grupos', async (l) => {
      const est = await this.estabelecimento(l, hospital);
      if (est === null) return [];
      const ls = await l.consultar(
        `SELECT pa.codigo AS grupo, COUNT(DISTINCT u.id) AS usuarios
           FROM usuario_perfil up
           JOIN perfil_acesso pa ON pa.id = up.perfil_acesso_id AND pa.ativo AND pa.excluido_em IS NULL
           JOIN usuario u ON u.id = up.usuario_id
          WHERE ${PERFIL_VIGENTE} AND ${CONTA_ALVO}
          GROUP BY pa.codigo
          ORDER BY pa.codigo`,
        [est],
      );
      return ls.map((x) => ({ grupo: txt(x['grupo']), usuarios: Number(x['usuarios']) }));
    });
  }

  /** Os usuários ativos do estabelecimento com o perfil vigente (login e nome), pelo login. */
  usuarios(hospital: string, grupo: string): Promise<UsuarioAlvo[]> {
    return this.ler('usuarios', async (l) => {
      const est = await this.estabelecimento(l, hospital);
      if (est === null) return [];
      const ls = await l.consultar(
        `SELECT DISTINCT u.login, u.nome
           FROM usuario_perfil up
           JOIN perfil_acesso pa ON pa.id = up.perfil_acesso_id AND pa.ativo AND pa.excluido_em IS NULL
           JOIN usuario u ON u.id = up.usuario_id
          WHERE ${PERFIL_VIGENTE} AND pa.codigo = ? AND ${CONTA_ALVO}
          ORDER BY u.login`,
        [est, grupo],
      );
      return ls.map((x) => ({ login: txt(x['login']), nome: txt(x['nome']) }));
    });
  }

  /** Sem imagens de correção no banco próprio: nenhuma ação tem imagem (nada a corrigir). */
  imagensPorAcao(): Promise<Map<string, { imagens: number; corrigidas: number }>> {
    return Promise.resolve(new Map());
  }

  previa(): Promise<{ passos: PassoCorrecao[]; tabelas: string[] }> {
    return Promise.reject(new ErroCorrigirIndisponivel(MENSAGEM_CORRECAO_INDISPONIVEL));
  }

  corrigir(): Promise<CorrecaoFeita[]> {
    return Promise.reject(new ErroCorrigirIndisponivel(MENSAGEM_CORRECAO_INDISPONIVEL));
  }

  /**
   * A trilha própria do estabelecimento na janela da sessão, das linhas do usuário alvo. A gravação feita numa sessão
   * "como" leva a origem em dados_depois.origem (núcleo, como.ts): é a marca de autoria do suporte.
   */
  cruzamento(hospital: string, janela: { alvo: string; inicio: Date; fim: Date }): Promise<LinhaCruzamento[]> {
    return this.ler('cruzamento', async (l) => {
      const est = await this.estabelecimento(l, hospital);
      if (est === null) return [];
      const ls = await l.consultar(
        `SELECT t.id, t.ocorrido_em, u.login, t.endereco_ip,
                JSON_VALUE(t.dados_depois, '$.origem.sessao') AS origem
           FROM usuario u
           JOIN trilha_auditoria t ON t.usuario_id = u.id
          WHERE u.login = ? AND u.excluido_em IS NULL AND t.estabelecimento_id = ?
            AND t.ocorrido_em >= ? AND t.ocorrido_em <= ?
          ORDER BY t.ocorrido_em, t.id
          LIMIT ${LIMITE_CRUZAMENTO}`,
        [janela.alvo, est, janela.inicio, janela.fim],
      );
      return ls.map((x) => {
        const origem = txtOuNull(x['origem']);
        return {
          idTrilha: txt(x['id']),
          dataHora: dataOuNull(x['ocorrido_em']),
          usuarioLogin: txt(x['login']),
          tipo: null,
          estacao: txt(x['endereco_ip']),
          origem,
          doSuporte: origem !== null,
        };
      });
    });
  }
}
