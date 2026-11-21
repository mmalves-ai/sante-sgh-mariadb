// Porta PRÓPRIA da recepção (F2.2): o banco do cliente (cliente_<codigo>) pelo @sgh/nucleo. Leituras em transação
// somente leitura, sempre filtradas pelo estabelecimento da sessão e por excluido_em IS NULL; gravações pelo Executor
// (operacoes.ts), com a trilha, o outbox e a idempotência na mesma transação. O cliente vem da configuração da API (CLIENTE_PADRAO); o
// estabelecimento e o usuário entram pelo id do banco do cliente (lidos pelo código e pelo login da sessão).
//
// Melhoria: a recepção, os locais, os serviços e os guichês vêm do cadastro do produto (ponto_recepcao,
// local_atendimento, gerador_senha, guiche_recepcao), com as restrições do banco; o guichê em uso é a ocupação
// vigente (ocupacao_guiche sem fim).
// Melhoria: indicadores calculados no servidor sobre as senhas do período, só com contagens e tempos (sem pessoa).
// Melhoria: a configuração da fila por serviço (intercalar, tempo-alvo, rótulo e exibição no totem) mora no próprio
// gerador_senha; os dispositivos do perfil Painel/Totem (dispositivo_recepcao) guardam só o resumo SHA-256 do token,
// com validade, revogação, último uso e a conferência do login substituído; os termos de consentimento da recepção
// são versões de termo_consentimento_modelo (tipos de atendimento preenchidos) e as assinaturas, imutáveis, ficam em
// termo_consentimento_recepcao (a revogação é fato novo com motivo).
// O dispositivo do tipo painel de TV de setor liga-se ao painel_tv que exibe (painel_tv_id), escolhido pela ordem do
// painel (portalOrdem) entre os painéis ativos do estabelecimento.
import { createHash, randomBytes } from 'node:crypto';
import {
  type AssinaturaTermo,
  codificarCp1252,
  conteudoCanonicoAssinatura,
  FINALIDADES_CONSENTIMENTO,
  type ModeloTermo,
  type SignatarioTermo,
  type TipoAtendimentoTermo,
  type VersaoModeloTermo,
} from '@sgh/contratos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  type Escritor,
  type Executor,
  gravarTrilha,
  type Leitor,
  type Linha,
  recusa,
} from '@sgh/nucleo';
import { ErroProblema } from '../../problema.filter.js';
import {
  bool,
  civilOuNull,
  dataIso,
  type EstabelecimentoDaSessao,
  estabelecimentoPorCodigo,
  horaCivil,
  instanteDaHoraCivil,
  num,
  numOuNull,
  senhaPorId,
  senhasDoDia,
  tipoServicoDoBanco,
  txt,
  txtOuNull,
} from './banco.js';
import { operacaoDaRecepcao } from './operacoes.js';
import { letraDaSituacao, prioridadeDaTela } from './tela-senha.js';
import type { GravadorRecepcao, PortaRecepcao } from './porta.js';
import type {
  AgendadoRecepcao,
  ContextoGravacao,
  ContextoRecepcao,
  DispositivoRecepcao,
  GeradorRecepcao,
  GravacaoFeita,
  GuicheEmUso,
  IndicadoresRecepcao,
  LiberacaoConsultada,
  LocalRecepcao,
  PacienteDaSenha,
  PainelTv,
  Recepcao,
  SenhaRecepcao,
  TrilhaGravacao,
} from './tipos.js';

/** O que a porta usa do NucleoProprio (os testes trocam). */
export interface NucleoRecepcao {
  lerSomente<T>(contexto: Partial<ContextoNucleo>, fn: (l: Leitor) => Promise<T>): Promise<T>;
  escrever<T>(
    contexto: Partial<ContextoNucleo>,
    fn: (e: Escritor) => Promise<T>,
    confirmar?: boolean,
  ): Promise<T>;
}

/** Intervalo mínimo entre duas marcas de último uso do mesmo dispositivo. */
const USO_DISPOSITIVO_MS = 10 * 60_000;

/** Teto de linhas dos indicadores (um período de senhas). */
const TETO_INDICADORES = 50_000;
/** Teto dos agendados do dia por consulta. */
const TETO_AGENDADOS = 300;

const CACHE_MS = 60_000;

export class PortaRecepcaoPropria implements PortaRecepcao {
  readonly destino = 'propria' as const;
  private readonly estabelecimentos = new Map<string, { est: EstabelecimentoDaSessao; em: number }>();
  private readonly usuarios = new Map<string, { id: number | null; em: number }>();

  constructor(
    private readonly nucleo: NucleoRecepcao,
    private readonly executor: Executor,
    /** Código do cliente (o banco cliente_<codigo>), da configuração da API (CLIENTE_PADRAO). */
    private readonly cliente: string,
    private readonly agora: () => number = Date.now,
  ) {}

  // ── contexto ───────────────────────────────────────────────────────────────────────────────────

  private base(_c: ContextoRecepcao, correlacao = 'recepcao'): Partial<ContextoNucleo> {
    return { cliente: this.cliente, correlacao };
  }

  private async est(c: ContextoRecepcao): Promise<EstabelecimentoDaSessao> {
    const k = c.hospital;
    const x = this.estabelecimentos.get(k);
    if (x && this.agora() - x.em < CACHE_MS) return x.est;
    const est = await this.nucleo.lerSomente(this.base(c), (l) => estabelecimentoPorCodigo(l, c.hospital));
    this.estabelecimentos.set(k, { est, em: this.agora() });
    return est;
  }

  private async usuario(c: ContextoRecepcao, login: string): Promise<number | null> {
    const k = login;
    const x = this.usuarios.get(k);
    if (x && this.agora() - x.em < CACHE_MS) return x.id;
    const u = await this.nucleo.lerSomente(this.base(c), (l) =>
      l.uma("SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL AND situacao = 'ativo'", [login]),
    );
    const id = u ? num(u['id']) : null;
    this.usuarios.set(k, { id, em: this.agora() });
    return id;
  }

  private async ler<T>(
    c: ContextoRecepcao,
    fn: (l: Leitor, est: EstabelecimentoDaSessao) => Promise<T>,
  ): Promise<T> {
    const est = await this.est(c);
    return this.nucleo.lerSomente({ ...this.base(c), estabelecimento: est.id }, (l) => fn(l, est));
  }

  private async contexto(c: ContextoRecepcao, g: ContextoGravacao): Promise<ContextoOperacao> {
    const est = await this.est(c);
    const usuario = await this.usuario(c, g.login);
    if (usuario === null)
      throw recusa('usuario-inexistente', 'O usuário da sessão não está ativo no cadastro deste cliente.');
    return {
      cliente: this.cliente,
      estabelecimento: est.id,
      usuario,
      correlacao: g.correlacao.slice(0, 64) || 'recepcao',
      chaveIdempotencia: g.chaveIdempotencia,
      ...(g.enderecoIp ? { enderecoIp: g.enderecoIp } : {}),
      ...(g.reautenticadoEm !== undefined ? { reautenticadoEm: g.reautenticadoEm } : {}),
    };
  }

  // ── gravações ──────────────────────────────────────────────────────────────────────────────────

  async podeGravar(c: ContextoRecepcao, operacao: string, login: string): Promise<LiberacaoConsultada> {
    const ctx = await this.contexto(c, {
      login,
      correlacao: 'pode-gravar',
      chaveIdempotencia: 'consulta-liberacao',
    });
    return this.executor.liberacao(operacaoDaRecepcao(operacao), ctx);
  }

  async executar(
    c: ContextoRecepcao,
    operacao: string,
    entrada: unknown,
    g: ContextoGravacao,
  ): Promise<GravacaoFeita> {
    const op = operacaoDaRecepcao(operacao);
    const ctx = await this.contexto(c, g);
    const r = await this.executor.executar(op, this.cliente, entrada, ctx);
    return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
  }

  async gravar<T>(
    c: ContextoRecepcao,
    trilha: TrilhaGravacao | ((r: T) => TrilhaGravacao),
    fn: (g: GravadorRecepcao) => Promise<T>,
  ): Promise<T> {
    const est = await this.est(c);
    const t0 = typeof trilha === 'function' ? null : trilha;
    const usuario = t0 ? await this.usuario(c, t0.login) : null;
    return this.nucleo.escrever(
      {
        cliente: this.cliente,
        estabelecimento: est.id,
        usuario,
        correlacao: (t0?.correlacao ?? 'recepcao').slice(0, 64),
      },
      async (e) => {
        const r = await fn(gravadorProprio(e, est, usuario, new Date(this.agora())));
        const t = typeof trilha === 'function' ? trilha(r) : trilha;
        await gravarTrilha(e, {
          estabelecimento: est.id,
          usuario: usuario ?? (await this.usuario(c, t.login)),
          acao: 'alteracao',
          entidade: t.tabela,
          entidadeId: t.id,
          dadosDepois: { evento: t.evento, recurso: t.recurso, estacao: t.estacao ?? null },
          motivo: t.motivo ?? null,
          correlacao: t.correlacao.slice(0, 64),
          ocorridoEm: new Date(this.agora()),
        });
        return r;
      },
    );
  }

  async marcarUsoDispositivo(c: ContextoRecepcao, id: number): Promise<void> {
    // Técnico, sem trilha: no máximo uma gravação a cada 10 minutos por dispositivo.
    const agora = new Date(this.agora());
    await this.nucleo.escrever({ ...this.base(c, 'dispositivo-uso') }, (e) =>
      e.executar(
        `UPDATE dispositivo_recepcao SET ultimo_uso_em = ?
          WHERE id = ? AND excluido_em IS NULL AND (ultimo_uso_em IS NULL OR ultimo_uso_em < ?)`,
        [agora, id, new Date(agora.getTime() - USO_DISPOSITIVO_MS)],
      ),
    );
  }

  // ── leituras ───────────────────────────────────────────────────────────────────────────────────

  async relogio(c: ContextoRecepcao): Promise<{ hoje: string; agora: string }> {
    const est = await this.est(c);
    const agora = horaCivil(new Date(this.agora()), est.fuso);
    return { hoje: agora.slice(0, 10), agora };
  }

  recepcoes(c: ContextoRecepcao): Promise<Recepcao[]> {
    return this.ler(c, async (l, est) => {
      const pontos = await l.consultar(
        'SELECT id, descricao FROM ponto_recepcao WHERE estabelecimento_id = ? AND excluido_em IS NULL AND ativo = TRUE ORDER BY descricao, id',
        [est.id],
      );
      const locais = await l.consultar(
        `SELECT id, ponto_recepcao_id, descricao, ativo, permite_encaminhamento FROM local_atendimento
          WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY descricao, id`,
        [est.id],
      );
      const geradores = await l.consultar(
        `SELECT g.id, g.ponto_recepcao_id, g.prefixo, g.descricao, g.tipo, g.ativo, g.gera_prioritaria, g.limite_dia,
                g.ordem_lista, g.intercalar_prioritarias, g.tempo_alvo_espera_minutos, g.rotulo_totem, g.exibe_no_totem
           FROM gerador_senha g JOIN ponto_recepcao p ON p.id = g.ponto_recepcao_id
          WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL ORDER BY g.descricao, g.id`,
        [est.id],
      );
      const guiches = await l.consultar(
        `SELECT gr.ponto_recepcao_id, gr.numero FROM guiche_recepcao gr JOIN ponto_recepcao p ON p.id = gr.ponto_recepcao_id
          WHERE p.estabelecimento_id = ? AND gr.excluido_em IS NULL AND gr.ativo = TRUE ORDER BY gr.numero`,
        [est.id],
      );
      return pontos.map((p): Recepcao => {
        const id = num(p['id']);
        const meus = locais.filter((x) => num(x['ponto_recepcao_id']) === id);
        const ativos = meus.filter((x) => bool(x['ativo'])).map((x) => num(x['id']));
        return {
          id,
          descricao: txt(p['descricao']),
          locais: meus.map((x): LocalRecepcao => ({
            id: num(x['id']),
            recepcao: id,
            cod: num(x['id']),
            descricao: txt(x['descricao']),
            ativo: bool(x['ativo']),
            // Encaminha aos outros locais ativos da recepção quando o local permite encaminhamento.
            encaminha: bool(x['permite_encaminhamento']) ? ativos.filter((y) => y !== num(x['id'])) : [],
          })),
          geradores: geradores
            .filter((g) => num(g['ponto_recepcao_id']) === id)
            .map((g): GeradorRecepcao => ({
              id: num(g['id']),
              recepcao: id,
              letra: txt(g['prefixo']),
              nome: txt(g['descricao']),
              tipo: tipoServicoDoBanco(txt(g['tipo'])),
              ativo: bool(g['ativo']),
              prioritaria: bool(g['gera_prioritaria']),
              limiteDia: numOuNull(g['limite_dia']),
              ordem: txt(g['ordem_lista']),
              intercalar: num(g['intercalar_prioritarias']),
              tempoAlvoMinutos: numOuNull(g['tempo_alvo_espera_minutos']),
              rotuloTotem: txtOuNull(g['rotulo_totem']),
              noTotem: bool(g['exibe_no_totem']),
            })),
          guiches: guiches.filter((g) => num(g['ponto_recepcao_id']) === id).map((g) => num(g['numero'])),
        };
      });
    });
  }

  guichesEmUso(c: ContextoRecepcao): Promise<GuicheEmUso[]> {
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `SELECT gr.ponto_recepcao_id, gr.numero, o.local_atendimento_id, u.login
           FROM ocupacao_guiche o JOIN guiche_recepcao gr ON gr.id = o.guiche_recepcao_id
           JOIN ponto_recepcao p ON p.id = gr.ponto_recepcao_id JOIN usuario u ON u.id = o.ocupante_usuario_id
          WHERE p.estabelecimento_id = ? AND o.fim_em IS NULL AND gr.excluido_em IS NULL
          ORDER BY gr.numero`,
        [est.id],
      );
      return ls.map((x) => ({
        recepcao: num(x['ponto_recepcao_id']),
        local: num(x['local_atendimento_id']),
        guiche: num(x['numero']),
        usuario: txt(x['login']),
      }));
    });
  }

  senhasDoDia(
    c: ContextoRecepcao,
    filtro: { recepcao?: number | null; geradores?: readonly number[] },
  ): Promise<{ senhas: SenhaRecepcao[]; cortada: boolean }> {
    return this.ler(c, (l, est) =>
      senhasDoDia(l, est, horaCivil(new Date(this.agora()), est.fuso).slice(0, 10), filtro),
    );
  }

  async senha(c: ContextoRecepcao, id: number): Promise<SenhaRecepcao | null> {
    const x = await this.ler(c, (l, est) => senhaPorId(l, est, id));
    if (!x) return null;
    // A versão e a situação gravada ficam na porta (servem às operações), fora do tipo da tela.
    const { versao, situacaoGravada, ...senha } = x;
    void versao;
    void situacaoGravada;
    return senha;
  }

  aFrente(c: ContextoRecepcao, id: number): Promise<number> {
    return this.ler(c, async (l, est) => {
      const x = await l.uma(
        `SELECT COUNT(*) AS n FROM senha_emitida s JOIN senha_emitida m ON m.id = ?
          WHERE s.estabelecimento_id = ? AND m.estabelecimento_id = ? AND s.data_referencia = m.data_referencia
            AND s.gerador_senha_id = m.gerador_senha_id AND s.id <> m.id AND s.situacao = 'aguardando'
            AND s.guiche_recepcao_id IS NULL AND s.emitida_em <= m.emitida_em AND s.excluido_em IS NULL`,
        [id, est.id, est.id],
      );
      return num(x?.['n']);
    });
  }

  agendados(
    c: ContextoRecepcao,
    f: {
      cpf?: string | null;
      marcacao?: { tipo: 'consulta' | 'exame'; id: number } | null;
      prontuario?: number | null;
      agenda?: string | null;
    },
  ): Promise<{ itens: AgendadoRecepcao[]; cortada: boolean }> {
    return this.ler(c, async (l, est) => {
      const hoje = horaCivil(new Date(this.agora()), est.fuso).slice(0, 10);
      const cond = [
        'm.estabelecimento_id = ?',
        'h.data_referencia = ?',
        'm.excluido_em IS NULL',
        'm.paciente_id IS NOT NULL',
      ];
      const p: unknown[] = [est.id, hoje];
      if (f.cpf) {
        cond.push('pf.cpf = ?');
        p.push(f.cpf.replace(/\D/g, ''));
      }
      if (f.marcacao) {
        cond.push('m.id = ?', f.marcacao.tipo === 'exame' ? "t.natureza = 'exame'" : "t.natureza <> 'exame'");
        p.push(f.marcacao.id);
      }
      if (f.prontuario) {
        cond.push('pa.numero_prontuario = ?');
        p.push(f.prontuario);
      }
      if (f.agenda) {
        cond.push('a.nome = ?');
        p.push(f.agenda);
      }
      const ls = await l.consultar(
        `SELECT m.id, t.natureza, h.inicio_em, a.nome AS agenda, pf.nome, pa.nome_social, pa.usa_nome_social,
                pa.numero_prontuario,
                (SELECT v.senha_emitida_id FROM senha_emitida_marcacao v
                  WHERE v.marcacao_horario_id = m.id AND v.excluido_em IS NULL LIMIT 1) AS senha
           FROM marcacao_horario m JOIN horario_agenda h ON h.id = m.horario_agenda_id
           JOIN agenda_servico a ON a.id = h.agenda_servico_id JOIN tipo_marcacao t ON t.id = m.tipo_marcacao_id
           JOIN paciente pa ON pa.id = m.paciente_id JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
          WHERE ${cond.join(' AND ')}
          ORDER BY h.inicio_em, m.id LIMIT ${TETO_AGENDADOS + 1}`,
        p,
        { teto: TETO_AGENDADOS + 1 },
      );
      return {
        cortada: ls.length > TETO_AGENDADOS,
        itens: ls.slice(0, TETO_AGENDADOS).map((x) => ({
          tipo: txt(x['natureza']) === 'exame' ? ('exame' as const) : ('consulta' as const),
          marcacao: num(x['id']),
          hora: horaCivil(x['inicio_em'] as Date, est.fuso).slice(11, 16),
          agenda: txt(x['agenda']),
          paciente: txt(x['nome']),
          nomeSocial: bool(x['usa_nome_social']) ? txtOuNull(x['nome_social']) : null,
          prontuario: num(x['numero_prontuario']),
          senha: numOuNull(x['senha']),
        })),
      };
    });
  }

  pacientesDasSenhas(c: ContextoRecepcao, ids: readonly number[]): Promise<Map<number, PacienteDaSenha>> {
    if (ids.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l, est) => {
      const lote = [...new Set(ids)].slice(0, 1_000);
      // A senha liga ao paciente pela identificação na recepção ou pela marcação da chegada.
      const ls = await l.consultar(
        `SELECT s.id, pf.nome, pa.nome_social, pa.usa_nome_social, pa.numero_prontuario
           FROM senha_emitida s
           LEFT JOIN senha_emitida_marcacao v ON v.senha_emitida_id = s.id AND v.excluido_em IS NULL
           LEFT JOIN marcacao_horario m ON m.id = v.marcacao_horario_id
           JOIN paciente pa ON pa.id = COALESCE(s.paciente_id, m.paciente_id)
           JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
          WHERE s.estabelecimento_id = ? AND s.id IN (${lote.map(() => '?').join(', ')})`,
        [est.id, ...lote],
      );
      return new Map(
        ls.map((x) => [
          num(x['id']),
          {
            nome: txt(x['nome']),
            nomeSocial: bool(x['usa_nome_social']) ? txtOuNull(x['nome_social']) : null,
            prontuario: num(x['numero_prontuario']),
          },
        ]),
      );
    });
  }

  async sigilosos(): Promise<ReadonlySet<number>> {
    // A marca de prontuário sigiloso ainda não tem coluna no cadastro do paciente (pedido registrado).
    return new Set<number>();
  }

  async fotos(): Promise<ReadonlyMap<number, string>> {
    // A foto do paciente é servida pelo módulo de arquivos (pessoa_fisica.foto_arquivo_id), fora deste módulo.
    return new Map<number, string>();
  }

  paineisTv(c: ContextoRecepcao): Promise<PainelTv[]> {
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `SELECT id, ordem, nome FROM painel_tv
          WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao = 'ativo' ORDER BY ordem, nome`,
        [est.id],
      );
      return ls.map((x) => ({ config: num(x['id']), ordem: num(x['ordem']), nome: txt(x['nome']) }));
    });
  }

  usuariosTecnicos(c: ContextoRecepcao): Promise<string[]> {
    return this.ler(c, async (l, est) => {
      // Contas de serviço com vínculo vigente no estabelecimento (dado do cliente: o vínculo é por estabelecimento).
      const ls = await l.consultar(
        `SELECT DISTINCT u.login FROM usuario u JOIN usuario_estabelecimento ue ON ue.usuario_id = u.id
          WHERE u.tipo_conta = 'servico' AND u.situacao = 'ativo' AND u.excluido_em IS NULL
            AND ue.estabelecimento_id = ? AND ue.excluido_em IS NULL ORDER BY u.login`,
        [est.id],
      );
      return ls.map((x) => txt(x['login']));
    });
  }

  indicadores(
    c: ContextoRecepcao,
    de: string,
    ate: string,
    recepcao: number | null,
  ): Promise<IndicadoresRecepcao> {
    return this.ler(c, async (l, est) => {
      const p: unknown[] = [est.id, de, ate];
      const filtroRecepcao = recepcao ? ' AND g.ponto_recepcao_id = ?' : '';
      if (recepcao) p.push(recepcao);
      const ls = await l.consultar(
        `SELECT s.id, s.gerador_senha_id, g.descricao AS servico, g.ponto_recepcao_id, s.situacao, s.prioritaria,
                gp.codigo AS grupo_codigo, s.data_referencia, s.emitida_em, s.encerrada_em, gr.numero AS guiche,
                (SELECT MIN(ev.ocorrido_em) FROM evento_senha ev JOIN acao_fluxo_senha a ON a.id = ev.acao_fluxo_senha_id
                  WHERE ev.senha_emitida_id = s.id AND a.codigo = 'chamar') AS chamada_em,
                (SELECT gr2.numero FROM evento_senha ev2 JOIN acao_fluxo_senha a2 ON a2.id = ev2.acao_fluxo_senha_id
                   JOIN guiche_recepcao gr2 ON gr2.id = ev2.guiche_recepcao_id
                  WHERE ev2.senha_emitida_id = s.id AND a2.codigo = 'chamar' ORDER BY ev2.ocorrido_em, ev2.id LIMIT 1) AS guiche_primeira,
                (SELECT COUNT(*) FROM evento_senha ev3 JOIN acao_fluxo_senha a3 ON a3.id = ev3.acao_fluxo_senha_id
                  WHERE ev3.senha_emitida_id = s.id AND a3.codigo = 'nao_localizado') AS nao_localizado,
                (SELECT COUNT(*) FROM atendimento_senha at WHERE at.senha_emitida_id = s.id AND at.excluido_em IS NULL) AS atendimentos
           FROM senha_emitida s JOIN gerador_senha g ON g.id = s.gerador_senha_id
           LEFT JOIN guiche_recepcao gr ON gr.id = s.guiche_recepcao_id
           LEFT JOIN grupo_prioridade_legal gp ON gp.id = s.grupo_prioridade_legal_id
          WHERE s.estabelecimento_id = ? AND s.data_referencia BETWEEN ? AND ? AND s.excluido_em IS NULL${filtroRecepcao}
          LIMIT ${TETO_INDICADORES}`,
        p,
        { teto: TETO_INDICADORES },
      );
      const conta = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);
      const porHora = new Map<number, number>();
      const porDia = new Map<
        string,
        { emitidas: number; liberadas: number; suspensas: number; atendidas: number }
      >();
      const porSituacao = new Map<string, number>();
      const prioridade = new Map<string, number>();
      const porServico = new Map<number, { servico: string; senhas: number }>();
      const tempos: IndicadoresRecepcao['tempos'] = [];
      let naoLocalizado = 0;
      for (const x of ls) {
        const emitida = horaCivil(x['emitida_em'] as Date, est.fuso);
        // Indicadores no vocabulário do contrato da tela (agregados: só contagens e tempos).
        const letra = letraDaSituacao(txt(x['situacao']), numOuNull(x['guiche']), null);
        const prio = prioridadeDaTela({
          prioritaria: bool(x['prioritaria']),
          grupo: txtOuNull(x['grupo_codigo']),
        });
        conta(porHora, Number(emitida.slice(11, 13)));
        const dia = dataIso(x['data_referencia']);
        const d = porDia.get(dia) ?? { emitidas: 0, liberadas: 0, suspensas: 0, atendidas: 0 };
        d.emitidas++;
        if (letra === 'L') d.liberadas++;
        if (letra === 'S') d.suspensas++;
        if (num(x['atendimentos']) > 0) d.atendidas++;
        porDia.set(dia, d);
        conta(porSituacao, letra);
        conta(prioridade, prio);
        const g = num(x['gerador_senha_id']);
        const sv = porServico.get(g) ?? { servico: txt(x['servico']), senhas: 0 };
        sv.senhas++;
        porServico.set(g, sv);
        naoLocalizado += num(x['nao_localizado']);
        tempos.push({
          prioridade: prio,
          emitidaEm: emitida,
          chamadaEm: x['chamada_em'] ? horaCivil(x['chamada_em'] as Date, est.fuso) : null,
          concluidaEm: x['encerrada_em'] ? horaCivil(x['encerrada_em'] as Date, est.fuso) : null,
          recepcao: num(x['ponto_recepcao_id']),
          guiche: numOuNull(x['guiche_primeira']),
        });
      }
      return {
        porHora: [...porHora].sort((a, b) => a[0] - b[0]).map(([hora, emitidas]) => ({ hora, emitidas })),
        porDia: [...porDia].sort((a, b) => a[0].localeCompare(b[0])).map(([data, v]) => ({ data, ...v })),
        porSituacao: [...porSituacao].map(([situacao, senhas]) => ({ situacao, senhas })),
        prioridade: [...prioridade].map(([p2, senhas]) => ({ prioridade: p2, senhas })),
        porServico: [...porServico].map(([gerador, v]) => ({ gerador, ...v })),
        tempos,
        naoLocalizado,
        total: ls.length,
      };
    });
  }

  dispositivos(c: ContextoRecepcao): Promise<DispositivoRecepcao[]> {
    return this.ler(c, (l, est) => dispositivosOnde(l, 'd.estabelecimento_id = ?', [est.id], this.agora()));
  }

  modelosTermo(c: ContextoRecepcao): Promise<ModeloTermo[]> {
    return this.ler(c, (l, est) => modelosTermoDo(l, est));
  }

  termosDoPaciente(c: ContextoRecepcao, prontuario: number): Promise<AssinaturaTermo[]> {
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `SELECT t.id, t.termo_consentimento_modelo_id, t.senha_emitida_id, t.tipo_atendimento, t.meio,
                t.tipo_assinante_id, t.nome_signatario, t.resumo_assinatura, t.assinado_em, t.revogado_em,
                t.motivo_revogacao, m.codigo, m.numero_versao, m.titulo, m.finalidade, pa.numero_prontuario,
                ur.login AS registrado_por, uv.login AS revogado_por
           FROM termo_consentimento_recepcao t
           JOIN termo_consentimento_modelo m ON m.id = t.termo_consentimento_modelo_id
           JOIN paciente pa ON pa.id = t.paciente_id
           LEFT JOIN usuario ur ON ur.id = t.criado_por LEFT JOIN usuario uv ON uv.id = t.revogado_por
          WHERE t.estabelecimento_id = ? AND pa.numero_prontuario = ? AND t.excluido_em IS NULL
          ORDER BY t.id DESC LIMIT ${TETO_TERMOS}`,
        [est.id, prontuario],
      );
      return ls.map((x): AssinaturaTermo => ({
        id: num(x['id']),
        modelo: num(x['termo_consentimento_modelo_id']),
        codigo: txt(x['codigo']),
        versao: num(x['numero_versao']),
        titulo: txt(x['titulo']),
        finalidade: finalidadeDoBanco(txt(x['finalidade']), txt(x['codigo'])),
        prontuario: num(x['numero_prontuario']),
        senha: numOuNull(x['senha_emitida_id']),
        tipoAtendimento: txtOuNull(x['tipo_atendimento']),
        meio: meioDoBanco(txt(x['meio'])),
        signatario: num(x['tipo_assinante_id']),
        nomeSignatario: txt(x['nome_signatario']),
        hash: txt(x['resumo_assinatura']),
        assinadoEm: horaCivil(x['assinado_em'] as Date, est.fuso),
        registradoPor: txt(x['registrado_por']),
        revogacao: x['revogado_em']
          ? {
              motivo: txt(x['motivo_revogacao']),
              usuario: txt(x['revogado_por']),
              em: horaCivil(x['revogado_em'] as Date, est.fuso),
            }
          : null,
      }));
    });
  }

  /** Quem assina: os papéis "paciente" e "responsável legal" do cadastro de tipos de assinante (o código é o id). */
  signatariosTermo(c: ContextoRecepcao): Promise<SignatarioTermo[]> {
    return this.ler(c, async (l) => {
      const ls = await l.consultar(
        `SELECT id, descricao FROM tipo_assinante WHERE ativo = TRUE AND papel IN ('paciente', 'responsavel_legal')
          ORDER BY papel = 'paciente' DESC, descricao, id`,
      );
      return ls.map((x) => ({ codigo: num(x['id']), rotulo: txt(x['descricao']) }));
    });
  }

  /** O dispositivo do token (pelo resumo SHA-256; o token nunca é guardado), em qualquer estabelecimento do cliente. */
  async dispositivoDoToken(token: string): Promise<DispositivoRecepcao | null> {
    const resumo = createHash('sha256').update(token).digest('hex');
    const ls = await this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'dispositivo-token' }, (l) =>
      dispositivosOnde(l, 'd.resumo_token = ?', [resumo], this.agora()),
    );
    return ls[0] ?? null;
  }

  /** Converte a hora civil do estabelecimento em instante (para filtros por hora informados pela tela). */
  async instante(c: ContextoRecepcao, civil: string): Promise<Date> {
    return instanteDaHoraCivil(civil, (await this.est(c)).fuso);
  }
}

/** Teto de termos assinados lidos por prontuário. */
const TETO_TERMOS = 500;

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

/** Finalidade do contrato (com hífen) e do banco (com sublinhado). */
const finalidadeNoBanco = (f: string) => f.replace(/-/g, '_');
/**
 * Finalidade lida do banco. O CHECK da tabela aceita também as finalidades do prontuário (geral, protecao_dados…),
 * que o contrato da recepção não tem: em vez de trocar o significado em silêncio, a leitura recusa e diz qual é.
 */
function finalidadeDoBanco(f: string, codigo: string): ModeloTermo['finalidade'] {
  const k = f.replace(/_/g, '-');
  if ((FINALIDADES_CONSENTIMENTO as readonly string[]).includes(k)) return k as ModeloTermo['finalidade'];
  throw recusa(
    'termo-finalidade-fora-do-contrato',
    `O termo ${codigo} tem a finalidade "${f}", que não é de termo da recepção (${FINALIDADES_CONSENTIMENTO.join(', ')}): corrija o cadastro do termo.`,
    { campos: ['finalidade'] },
  );
}

/** Meio da assinatura lido do banco (o CHECK só aceita tela e portal; outro valor é inconsistência, nunca 'tela'). */
function meioDoBanco(m: string): AssinaturaTermo['meio'] {
  if (m === 'tela' || m === 'portal') return m;
  throw recusa('termo-meio-desconhecido', `A assinatura tem o meio "${m}", fora de tela e portal.`, {
    campos: ['meio'],
  });
}

function tiposDoBanco(v: unknown): TipoAtendimentoTermo[] {
  const x = typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
  return Array.isArray(x) ? (x.map(String) as TipoAtendimentoTermo[]) : [];
}

/** Os dispositivos da condição (com os locais e os serviços ligados), no fuso do estabelecimento de cada um. */
async function dispositivosOnde(
  l: Leitor,
  onde: string,
  p: readonly unknown[],
  agoraMs: number,
): Promise<DispositivoRecepcao[]> {
  const ls = await l.consultar(
    `SELECT d.id, d.tipo, d.nome, d.ponto_recepcao_id, d.conteudo, d.voz, d.prefixo_token, d.valido_ate, d.revogado_em,
            d.ultimo_uso_em, d.login_substituido, d.conferido_em, d.criado_em, es.codigo AS hospital, pt.ordem AS painel_ordem,
            es.fuso_horario, ut.login AS tecnico, uc.login AS criador, uf.login AS conferidor
       FROM dispositivo_recepcao d JOIN estabelecimento es ON es.id = d.estabelecimento_id
       LEFT JOIN painel_tv pt ON pt.id = d.painel_tv_id
       LEFT JOIN usuario ut ON ut.id = d.tecnico_usuario_id LEFT JOIN usuario uc ON uc.id = d.criado_por
       LEFT JOIN usuario uf ON uf.id = d.conferido_por
      WHERE ${onde} AND d.excluido_em IS NULL ORDER BY d.id`,
    p,
  );
  if (ls.length === 0) return [];
  const ids = ls.map((x) => num(x['id']));
  const marcas = ids.map(() => '?').join(', ');
  const locais = await l.consultar(
    `SELECT dispositivo_recepcao_id AS d, local_atendimento_id AS v FROM dispositivo_recepcao_local
      WHERE dispositivo_recepcao_id IN (${marcas}) AND excluido_em IS NULL ORDER BY local_atendimento_id`,
    ids,
  );
  const geradores = await l.consultar(
    `SELECT dispositivo_recepcao_id AS d, gerador_senha_id AS v FROM dispositivo_recepcao_gerador
      WHERE dispositivo_recepcao_id IN (${marcas}) AND excluido_em IS NULL ORDER BY gerador_senha_id`,
    ids,
  );
  const de = (xs: Linha[], id: number) => xs.filter((y) => num(y['d']) === id).map((y) => num(y['v']));
  return ls.map((x) => {
    const id = num(x['id']);
    const fuso = txt(x['fuso_horario']) || 'America/Sao_Paulo';
    const validoAte = x['valido_ate'] as Date;
    return {
      id,
      hospital: txt(x['hospital']),
      tipo: txt(x['tipo']),
      nome: txt(x['nome']),
      recepcao: numOuNull(x['ponto_recepcao_id']),
      locais: de(locais, id),
      geradores: de(geradores, id),
      conteudo: txtOuNull(x['conteudo']),
      portalOrdem: numOuNull(x['painel_ordem']),
      usuarioTecnico: txtOuNull(x['tecnico']),
      voz: bool(x['voz']),
      criadoEm: horaCivil(x['criado_em'] as Date, fuso),
      criadoPor: txt(x['criador']),
      validoAte: horaCivil(validoAte, fuso),
      revogadoEm: civilOuNull(x['revogado_em'], fuso),
      ultimoUso: civilOuNull(x['ultimo_uso_em'], fuso),
      prefixo: txt(x['prefixo_token']),
      valido: !x['revogado_em'] && validoAte.getTime() > agoraMs,
      loginSubstituido: txtOuNull(x['login_substituido']),
      conferidoEm: civilOuNull(x['conferido_em'], fuso),
      conferidoPor: txtOuNull(x['conferidor']),
    };
  });
}

/** Os termos da recepção do estabelecimento: as versões de termo_consentimento_modelo com tipos de atendimento. */
async function modelosTermoDo(l: Leitor, est: EstabelecimentoDaSessao): Promise<ModeloTermo[]> {
  const ls = await l.consultar(
    `SELECT m.id, m.codigo, m.numero_versao, m.titulo, m.finalidade, m.tipos_atendimento, m.exigido_recepcao,
            m.texto_simples, m.resumo_texto, m.ativo, m.criado_em, u.login AS autor
       FROM termo_consentimento_modelo m LEFT JOIN usuario u ON u.id = m.criado_por
      WHERE m.estabelecimento_id = ? AND m.tipos_atendimento IS NOT NULL
      ORDER BY m.codigo, m.numero_versao DESC`,
    [est.id],
  );
  const contagem = await l.consultar(
    `SELECT termo_consentimento_modelo_id AS modelo, COUNT(*) AS n FROM termo_consentimento_recepcao
      WHERE estabelecimento_id = ? AND excluido_em IS NULL GROUP BY termo_consentimento_modelo_id`,
    [est.id],
  );
  const porModelo = new Map(contagem.map((x) => [num(x['modelo']), num(x['n'])]));
  const r = new Map<string, { m: Omit<ModeloTermo, 'versoes'>; versoes: VersaoModeloTermo[] }>();
  for (const x of ls) {
    const codigo = txt(x['codigo']);
    let k = r.get(codigo);
    if (!k) {
      // A primeira linha é a versão mais nova: a situação do código é a dela.
      k = {
        m: {
          codigo,
          finalidade: finalidadeDoBanco(txt(x['finalidade']), codigo),
          ativo: bool(x['ativo']),
          assinaturas: 0,
        },
        versoes: [],
      };
      r.set(codigo, k);
    }
    const texto = txt(x['texto_simples']);
    k.versoes.push({
      id: num(x['id']),
      versao: num(x['numero_versao']),
      titulo: txt(x['titulo']),
      tiposAtendimento: tiposDoBanco(x['tipos_atendimento']),
      exigido: bool(x['exigido_recepcao']),
      texto,
      hashTexto: txtOuNull(x['resumo_texto']) ?? sha256(codificarCp1252(texto)),
      criadoPor: txt(x['autor']),
      criadoEm: horaCivil(x['criado_em'] as Date, est.fuso),
    });
  }
  return [...r.values()].map(({ m, versoes }) => ({
    ...m,
    versoes,
    assinaturas: versoes.reduce((a, v) => a + (porModelo.get(v.id) ?? 0), 0),
  }));
}

/**
 * As gravações de configuração da recepção (fila, dispositivos e termos) na transação da trilha. Tudo filtrado pelo
 * estabelecimento da sessão; o que não é dele responde como inexistente.
 */
function gravadorProprio(
  e: Escritor,
  est: EstabelecimentoDaSessao,
  usuarioSessao: number | null,
  instante: Date,
): GravadorRecepcao {
  const idDoLogin = async (login: string, campo?: string): Promise<number> => {
    const u = await e.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [login]);
    if (!u)
      throw recusa(
        'usuario-inexistente',
        'O usuário não está no cadastro deste cliente.',
        campo ? { campos: [campo] } : undefined,
      );
    return num(u['id']);
  };
  const autor = async (login?: string) => (login ? await idDoLogin(login) : usuarioSessao);
  const validade = (dias: number) => new Date(instante.getTime() + dias * 86_400_000);
  const novoToken = () => {
    const token = randomBytes(32).toString('base64url');
    return { token, resumo: sha256(token), prefixo: token.slice(0, 8) };
  };

  /** Os ids pedidos que são do estabelecimento (local de atendimento ou serviço); falta algum: recusa. */
  const conferirDoEstabelecimento = async (
    tabela: 'local_atendimento' | 'gerador_senha',
    ids: readonly number[],
    campo: string,
  ) => {
    const unicos = [...new Set(ids)];
    if (unicos.length === 0) return unicos;
    const marcas = unicos.map(() => '?').join(', ');
    const sql =
      tabela === 'local_atendimento'
        ? `SELECT id FROM local_atendimento WHERE id IN (${marcas}) AND estabelecimento_id = ? AND excluido_em IS NULL`
        : `SELECT g.id FROM gerador_senha g JOIN ponto_recepcao p ON p.id = g.ponto_recepcao_id
            WHERE g.id IN (${marcas}) AND p.estabelecimento_id = ? AND p.excluido_em IS NULL`;
    const achados = await e.consultar(sql, [...unicos, est.id]);
    if (achados.length !== unicos.length)
      throw recusa('registro-inexistente', 'Há local ou serviço que não é deste estabelecimento.', {
        campos: [campo],
      });
    return unicos;
  };

  const conferirRecepcao = async (recepcao: number | null) => {
    if (recepcao === null) return;
    const p = await e.uma(
      'SELECT id FROM ponto_recepcao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [recepcao, est.id],
    );
    if (!p)
      throw recusa('registro-inexistente', 'A recepção não é deste estabelecimento.', {
        campos: ['recepcao'],
      });
  };

  /** Liga os locais e os serviços ao dispositivo: reativa os que voltam, inclui os novos e exclui os que saem. */
  const ligar = async (
    dispositivo: number,
    locais: readonly number[],
    geradores: readonly number[],
    usuario: number | null,
  ) => {
    for (const [tabela, coluna, ids] of [
      ['dispositivo_recepcao_local', 'local_atendimento_id', locais],
      ['dispositivo_recepcao_gerador', 'gerador_senha_id', geradores],
    ] as const) {
      for (const v of ids)
        await e.executar(
          `INSERT INTO ${tabela} (dispositivo_recepcao_id, ${coluna}, criado_em, criado_por, versao) VALUES (?, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE excluido_em = NULL, excluido_por = NULL, alterado_em = IF(excluido_em IS NULL, alterado_em, ?),
             alterado_por = IF(excluido_em IS NULL, alterado_por, ?), versao = IF(excluido_em IS NULL, versao, versao + 1)`,
          [dispositivo, v, instante, usuario, instante, usuario],
        );
      const fora = ids.length ? `AND ${coluna} NOT IN (${ids.map(() => '?').join(', ')})` : '';
      await e.executar(
        `UPDATE ${tabela} SET excluido_em = ?, excluido_por = ?, versao = versao + 1
          WHERE dispositivo_recepcao_id = ? AND excluido_em IS NULL ${fora}`,
        [instante, usuario, dispositivo, ...ids],
      );
    }
  };

  /** Atualiza o dispositivo vivo do estabelecimento; nenhum: recusa (inexistente ou revogado). */
  const atualizarDispositivo = async (
    id: number,
    sets: string,
    valores: readonly unknown[],
    vigente = false,
    mensagem = 'O dispositivo não existe ou já foi revogado.',
  ) => {
    const n = await e.executar(
      `UPDATE dispositivo_recepcao SET ${sets}, alterado_em = ?, alterado_por = ?, versao = versao + 1
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND revogado_em IS NULL
          ${vigente ? 'AND valido_ate > ?' : ''}`,
      [...valores, instante, usuarioSessao, id, est.id, ...(vigente ? [instante] : [])],
    );
    if (n === 0) throw recusa('dispositivo-revogado', mensagem);
  };

  /** As versões do código do termo, travadas, da mais nova à mais antiga; nenhuma: recusa. */
  const versoesDoCodigo = async (codigo: string) => {
    const vs = await e.consultarParaAtualizar(
      `SELECT id, numero_versao, finalidade, ativo FROM termo_consentimento_modelo
        WHERE estabelecimento_id = ? AND codigo = ? AND tipos_atendimento IS NOT NULL ORDER BY numero_versao DESC`,
      [est.id, codigo],
    );
    if (vs.length === 0) throw recusa('termo-inexistente', 'Termo não encontrado.');
    return vs;
  };

  const incluirVersao = async (
    x: {
      codigo: string;
      titulo: string;
      finalidade: string;
      tiposAtendimento: readonly string[];
      exigido: boolean;
      texto: string;
      ativo: boolean;
      usuario: string;
    },
    numero: number,
  ) =>
    e.inserir(
      `INSERT INTO termo_consentimento_modelo (estabelecimento_id, codigo, numero_versao, titulo, finalidade,
         texto_simples, tipos_atendimento, exigido_recepcao, resumo_texto, vigencia_inicio, ativo, criado_em,
         criado_por, versao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        est.id,
        x.codigo,
        numero,
        x.titulo,
        finalidadeNoBanco(x.finalidade),
        x.texto,
        JSON.stringify([...x.tiposAtendimento]),
        x.exigido,
        sha256(codificarCp1252(x.texto)),
        horaCivil(instante, est.fuso).slice(0, 10),
        x.ativo,
        instante,
        await idDoLogin(x.usuario),
      ],
    );

  return {
    gravarFilaCfg: async (x) => {
      const n = await e.executar(
        `UPDATE gerador_senha g JOIN ponto_recepcao p ON p.id = g.ponto_recepcao_id
            SET g.ordem_lista = ?, g.intercalar_prioritarias = ?, g.tempo_alvo_espera_minutos = ?, g.rotulo_totem = ?,
                g.exibe_no_totem = ?, g.alterado_em = ?, g.alterado_por = ?, g.versao = g.versao + 1
          WHERE g.id = ? AND g.ponto_recepcao_id = ? AND p.estabelecimento_id = ? AND p.excluido_em IS NULL`,
        [
          x.ordem,
          x.intercalar,
          x.tempoAlvoMinutos > 0 ? x.tempoAlvoMinutos : null,
          x.rotuloTotem,
          x.noTotem,
          instante,
          await autor(x.usuario),
          x.gerador,
          x.recepcao,
          est.id,
        ],
      );
      if (n === 0) throw recusa('registro-inexistente', 'O gerador de senha não existe mais.');
    },

    criarDispositivo: async (x) => {
      let painelTv: number | null = null;
      if (x.portalOrdem !== null) {
        if (x.tipo !== 'paineltv')
          throw recusa('painel-tv-so-no-tipo', 'Só o dispositivo do tipo painel de TV de setor exibe um painel de TV.', {
            campos: ['portalOrdem'],
          });
        const paineis = await e.consultar(
          `SELECT id FROM painel_tv
            WHERE estabelecimento_id = ? AND ordem = ? AND situacao = 'ativo' AND excluido_em IS NULL ORDER BY id`,
          [est.id, x.portalOrdem],
        );
        if (paineis.length !== 1)
          throw recusa(
            paineis.length === 0 ? 'painel-tv-inexistente' : 'painel-tv-ambiguo',
            paineis.length === 0
              ? 'Não há painel de TV ativo com esta ordem no estabelecimento.'
              : 'Há mais de um painel de TV ativo com esta ordem: ajuste a ordem dos painéis.',
            { campos: ['portalOrdem'] },
          );
        painelTv = num(paineis[0]!['id']);
      }
      await conferirRecepcao(x.recepcao);
      const locais = await conferirDoEstabelecimento('local_atendimento', x.locais, 'locais');
      const geradores = await conferirDoEstabelecimento('gerador_senha', x.geradores, 'geradores');
      const tecnico = x.usuarioTecnico ? await idDoLogin(x.usuarioTecnico, 'usuarioLegado') : null;
      const usuario = await autor(x.usuario);
      const t = novoToken();
      const id = await e.inserir(
        `INSERT INTO dispositivo_recepcao (estabelecimento_id, tipo, nome, ponto_recepcao_id, conteudo,
           tecnico_usuario_id, voz, resumo_token, prefixo_token, valido_ate, painel_tv_id, criado_em, criado_por, versao)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          est.id,
          x.tipo,
          x.nome,
          x.recepcao,
          x.conteudo,
          tecnico,
          x.voz,
          t.resumo,
          t.prefixo,
          validade(x.validadeDias),
          painelTv,
          instante,
          usuario,
        ],
      );
      await ligar(id, locais, geradores, usuario);
      return { id, token: t.token };
    },

    renovarDispositivo: async (x) => {
      const t = novoToken();
      await atualizarDispositivo(x.id, 'resumo_token = ?, prefixo_token = ?, valido_ate = ?', [
        t.resumo,
        t.prefixo,
        validade(x.validadeDias),
      ]);
      return t.token;
    },

    alterarDispositivo: async (x) => {
      // Token (resumo, prefixo) e validade ficam como estão.
      await conferirRecepcao(x.recepcao);
      const locais = await conferirDoEstabelecimento('local_atendimento', x.locais, 'locais');
      const geradores = await conferirDoEstabelecimento('gerador_senha', x.geradores, 'geradores');
      await atualizarDispositivo(x.id, 'nome = ?, ponto_recepcao_id = ?, conteudo = ?, voz = ?', [
        x.nome,
        x.recepcao,
        x.conteudo,
        x.voz,
      ]);
      await ligar(x.id, locais, geradores, usuarioSessao);
    },

    revogarDispositivo: async (x) => {
      await atualizarDispositivo(x.id, 'revogado_em = ?, revogado_por = ?', [
        instante,
        await autor(x.usuario),
      ]);
    },

    conferirDispositivo: async (x) => {
      const login = x.loginSubstituido.trim();
      const outro = await e.uma(
        `SELECT id FROM dispositivo_recepcao
          WHERE id <> ? AND estabelecimento_id = ? AND excluido_em IS NULL AND revogado_em IS NULL
            AND UPPER(login_substituido) = UPPER(?)`,
        [x.id, est.id, login],
      );
      if (outro)
        throw recusa(
          'login-ja-substituido',
          'Este login já está ligado a outro aparelho válido: revogue aquele antes.',
        );
      await atualizarDispositivo(
        x.id,
        'login_substituido = ?, conferido_em = ?, conferido_por = ?',
        [login, instante, await autor(x.usuario)],
        true,
        'O dispositivo não existe, foi revogado ou está fora da validade.',
      );
    },

    incluirModeloTermo: async (x) => {
      const ja = await e.uma(
        'SELECT id FROM termo_consentimento_modelo WHERE estabelecimento_id = ? AND codigo = ?',
        [est.id, x.codigo],
      );
      if (ja)
        throw recusa('termo-codigo-existe', 'Já existe um termo com este código: altere-o (nova versão).', {
          campos: ['codigo'],
        });
      return incluirVersao({ ...x, ativo: true }, 1);
    },

    novaVersaoModeloTermo: async (x) => {
      const vs = await versoesDoCodigo(x.codigo);
      const atual = vs[0]!;
      const ultima = num(atual['numero_versao']);
      if (ultima !== x.versaoVista)
        throw recusa('termo-concorrente', `Há uma versão mais nova (${ultima}): abra de novo e refaça.`);
      // A versão anterior fica no histórico, com a vigência encerrada hoje.
      await e.executar(
        `UPDATE termo_consentimento_modelo SET vigencia_fim = GREATEST(vigencia_inicio, ?), alterado_em = ?,
           alterado_por = ?, versao = versao + 1 WHERE id = ? AND vigencia_fim IS NULL`,
        [horaCivil(instante, est.fuso).slice(0, 10), instante, await idDoLogin(x.usuario), num(atual['id'])],
      );
      const id = await incluirVersao(
        {
          ...x,
          finalidade: txt(atual['finalidade']),
          ativo: bool(atual['ativo']),
        },
        ultima + 1,
      );
      return { id, versao: ultima + 1 };
    },

    situacaoModeloTermo: async (x) => {
      const vs = await versoesDoCodigo(x.codigo);
      if (bool(vs[0]!['ativo']) === x.ativo)
        throw recusa('termo-situacao', x.ativo ? 'O termo já está ativo.' : 'O termo já está inativo.');
      await e.executar(
        `UPDATE termo_consentimento_modelo SET ativo = ?, alterado_em = ?, alterado_por = ?, versao = versao + 1
          WHERE estabelecimento_id = ? AND codigo = ? AND tipos_atendimento IS NOT NULL`,
        [x.ativo, instante, await idDoLogin(x.usuario), est.id, x.codigo],
      );
    },

    excluirModeloTermo: async (x) => {
      const vs = await versoesDoCodigo(x.codigo);
      const ids = vs.map((v) => num(v['id']));
      const c = await e.uma(
        `SELECT COUNT(*) AS n FROM termo_consentimento_recepcao
          WHERE termo_consentimento_modelo_id IN (${ids.map(() => '?').join(', ')})`,
        ids,
      );
      const n = num(c?.['n'] ?? 0);
      if (n > 0)
        throw new ErroProblema(
          'recusa-de-negocio',
          409,
          'Não gravado',
          `O termo tem ${n} assinatura(s) de pacientes: não pode ser excluído. Inative-o.`,
          {
            codigo: 'com-dependentes',
            dependentes: [{ rotulo: 'Termos assinados', quantidade: n, amostra: [], origem: 'fk' }],
            total: n,
            podeInativar: true,
          },
        );
      // Código nunca assinado: as versões saem (a trilha guarda o motivo); outro uso do modelo barra pela chave.
      await e.executar(
        `DELETE FROM termo_consentimento_modelo WHERE id IN (${ids.map(() => '?').join(', ')})`,
        ids,
      );
    },

    assinarTermo: async (x) => {
      const v = await e.uma(
        `SELECT id, codigo, numero_versao, ativo, texto_simples, resumo_texto FROM termo_consentimento_modelo
          WHERE id = ? AND estabelecimento_id = ? AND tipos_atendimento IS NOT NULL`,
        [x.modelo, est.id],
      );
      if (!v) throw recusa('termo-inexistente', 'Termo não encontrado.', { campos: ['modelo'] });
      if (!bool(v['ativo'])) throw recusa('termo-inativo', 'O termo está inativo.', { campos: ['modelo'] });
      const nova = await e.uma(
        `SELECT id FROM termo_consentimento_modelo
          WHERE estabelecimento_id = ? AND codigo = ? AND numero_versao > ? AND tipos_atendimento IS NOT NULL LIMIT 1`,
        [est.id, txt(v['codigo']), num(v['numero_versao'])],
      );
      if (nova)
        throw recusa('termo-versao-antiga', 'Há uma versão mais nova deste termo: abra de novo.', {
          campos: ['modelo'],
        });
      const pa = await e.uma('SELECT id FROM paciente WHERE numero_prontuario = ?', [x.prontuario]);
      if (!pa) throw recusa('paciente-inexistente', 'Prontuário não encontrado.', { campos: ['prontuario'] });
      const sig = await e.uma(
        "SELECT id FROM tipo_assinante WHERE id = ? AND ativo = TRUE AND papel IN ('paciente', 'responsavel_legal')",
        [x.signatario],
      );
      if (!sig)
        throw recusa('signatario-inexistente', 'Quem assina não está no cadastro.', {
          campos: ['signatario'],
        });
      if (x.senha !== null) {
        const s = await e.uma('SELECT id FROM senha_emitida WHERE id = ? AND estabelecimento_id = ?', [
          x.senha,
          est.id,
        ]);
        if (!s)
          throw recusa('registro-inexistente', 'A senha não é deste estabelecimento.', { campos: ['senha'] });
      }
      // O instante vai ao segundo: a hora civil do conteúdo canônico é a mesma que a leitura devolve.
      const assinado = new Date(Math.floor(instante.getTime() / 1000) * 1000);
      const assinadoEm = horaCivil(assinado, est.fuso);
      const texto = txt(v['texto_simples']);
      const imagem = x.imagem ? Buffer.from(x.imagem, 'base64') : null;
      const hash = sha256(
        conteudoCanonicoAssinatura({
          modelo: x.modelo,
          hashTexto: txtOuNull(v['resumo_texto']) ?? sha256(codificarCp1252(texto)),
          prontuario: x.prontuario,
          senha: x.senha,
          tipoAtendimento: x.tipoAtendimento,
          meio: x.meio,
          signatario: x.signatario,
          nomeSignatario: x.nomeSignatario,
          assinadoEm,
          hashImagem: imagem ? sha256(imagem) : null,
        }),
      );
      const id = await e.inserir(
        `INSERT INTO termo_consentimento_recepcao (estabelecimento_id, termo_consentimento_modelo_id, paciente_id,
           senha_emitida_id, tipo_atendimento, meio, tipo_assinante_id, nome_signatario, resumo_assinatura,
           assinado_em, criado_em, criado_por, versao)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          est.id,
          x.modelo,
          num(pa['id']),
          x.senha,
          x.tipoAtendimento,
          x.meio,
          x.signatario,
          x.nomeSignatario,
          hash,
          assinado,
          instante,
          await idDoLogin(x.usuario),
        ],
      );
      return { id, hash };
    },

    revogarTermo: async (x) => {
      const usuario = await idDoLogin(x.usuario);
      const n = await e.executar(
        `UPDATE termo_consentimento_recepcao SET revogado_em = ?, revogado_por = ?, motivo_revogacao = ?,
           alterado_em = ?, alterado_por = ?, versao = versao + 1
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND revogado_em IS NULL`,
        [instante, usuario, x.motivo, instante, usuario, x.assinatura, est.id],
      );
      if (n > 0) return;
      const a = await e.uma(
        'SELECT id FROM termo_consentimento_recepcao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [x.assinatura, est.id],
      );
      if (!a) throw recusa('termo-inexistente', 'Termo assinado não encontrado.');
      throw recusa('termo-revogado', 'Este termo já foi revogado.');
    },
  };
}
