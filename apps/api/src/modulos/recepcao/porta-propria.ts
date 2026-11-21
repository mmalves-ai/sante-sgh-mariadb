// Porta PRÓPRIA da recepção (F2.2): o banco do cliente (cliente_<codigo>) pelo @sgh/nucleo. Leituras em transação
// somente leitura, sempre filtradas pelo estabelecimento da sessão e por excluido_em IS NULL; gravações pelo Executor
// (operacoes.ts), com a trilha, o outbox e a idempotência na mesma transação. O cliente vem da configuração da API (CLIENTE_PADRAO); o
// estabelecimento e o usuário entram pelo id do banco do cliente (lidos pelo código e pelo login da sessão).
//
// Melhoria: a recepção, os locais, os serviços e os guichês vêm do cadastro do produto (ponto_recepcao,
// local_atendimento, gerador_senha, guiche_recepcao), com as restrições do banco; o guichê em uso é a ocupação
// vigente (ocupacao_guiche sem fim).
// Melhoria: indicadores calculados no servidor sobre as senhas do período, só com contagens e tempos (sem pessoa).
// Pendências do modelo (pedidos ao integrador, docs/obra/fatias/f22/saida/01-01.json): a configuração da fila por
// serviço (intercalar, tempo-alvo, rótulo e exibição no totem), os dispositivos do perfil Painel/Totem (token,
// validade, revogação) e os termos de consentimento da recepção não têm tabela no modelo: as gravações respondem
// "modelo-pendente" e as leituras devolvem vazio, sem contorno.
import type { AssinaturaTermo, ModeloTermo, SignatarioTermo } from '@sgh/contratos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  type Escritor,
  type Executor,
  gravarTrilha,
  type Leitor,
  recusa,
} from '@sgh/nucleo';
import {
  bool,
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

/** Recusa das gravações que esperam tabela do modelo (pedido registrado ao integrador). */
export function modeloPendente(recurso: string): never {
  throw recusa(
    'modelo-pendente',
    `${recurso} ainda não tem tabela no banco do produto: a gravação fica indisponível até a migração do modelo.`,
  );
}

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
        const r = await fn(gravadorSemModelo());
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

  async marcarUsoDispositivo(): Promise<void> {
    // Dispositivos sem tabela no modelo (pedido registrado): nada a marcar.
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
                g.ordem_lista
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
              // Sem coluna no modelo (pedido registrado): os padrões da fila.
              intercalar: 2,
              tempoAlvoMinutos: null,
              rotuloTotem: null,
              noTotem: true,
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

  async dispositivos(): Promise<DispositivoRecepcao[]> {
    return [];
  }

  async modelosTermo(): Promise<ModeloTermo[]> {
    return [];
  }

  async termosDoPaciente(): Promise<AssinaturaTermo[]> {
    return [];
  }

  async signatariosTermo(): Promise<SignatarioTermo[]> {
    return [];
  }

  async dispositivoDoToken(): Promise<DispositivoRecepcao | null> {
    return null;
  }

  /** Converte a hora civil do estabelecimento em instante (para filtros por hora informados pela tela). */
  async instante(c: ContextoRecepcao, civil: string): Promise<Date> {
    return instanteDaHoraCivil(civil, (await this.est(c)).fuso);
  }
}

/** Gravador das configurações cujo modelo ainda falta (pedido registrado ao integrador). */
function gravadorSemModelo(): GravadorRecepcao {
  return {
    gravarFilaCfg: () => modeloPendente('A configuração da fila por serviço'),
    criarDispositivo: () => modeloPendente('O dispositivo do perfil Painel/Totem'),
    renovarDispositivo: () => modeloPendente('O dispositivo do perfil Painel/Totem'),
    alterarDispositivo: () => modeloPendente('O dispositivo do perfil Painel/Totem'),
    revogarDispositivo: () => modeloPendente('O dispositivo do perfil Painel/Totem'),
    conferirDispositivo: () => modeloPendente('O dispositivo do perfil Painel/Totem'),
    incluirModeloTermo: () => modeloPendente('O termo de consentimento da recepção'),
    novaVersaoModeloTermo: () => modeloPendente('O termo de consentimento da recepção'),
    situacaoModeloTermo: () => modeloPendente('O termo de consentimento da recepção'),
    excluirModeloTermo: () => modeloPendente('O termo de consentimento da recepção'),
    assinarTermo: () => modeloPendente('O termo de consentimento da recepção'),
    revogarTermo: () => modeloPendente('O termo de consentimento da recepção'),
  };
}
