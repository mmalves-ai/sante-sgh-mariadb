// Porta PRÓPRIA da classificação de risco (F2.2): o banco do cliente pelo @sgh/nucleo. Leituras somente leitura,
// filtradas pelo estabelecimento da sessão e por excluido_em IS NULL. As gravações vão pelo Executor
// (classificacao-operacoes.ts): cada ação da tela é uma operação declarada (entrada validada, tabelas declaradas),
// com a trilha, o outbox e a idempotência (a Idempotency-Key do pedido) na mesma transação; várias operações de um
// mesmo pedido (ex.: a classificação e o evento da cor sobreposta) rodam numa transação só, cada uma num SAVEPOINT.
// O conteúdo publicado do protocolo vai em protocolo_classificacao_risco_versao.dados e é também desdobrado nas tabelas
// do modelo (fluxogramas, discriminadores e níveis da versão).
//
// Melhoria: a classificação grava o nível proposto e o final (sobreposição com justificativa por CHECK), o prazo do
// atendimento pelo tempo-alvo, a queixa, as respostas de cada discriminador e a aferição dos sinais ligada à
// classificação (afericao/afericao_valor), tudo numa transação.
// Melhoria: a reclassificação marca a anterior como "reclassificada" e exige o motivo (CHECK do banco); a sucessão é
// única (a anterior travada com FOR UPDATE).
// Melhoria: o vínculo profissional da sessão sai do cadastro (profissional e inscrição no conselho), pela pessoa.
// Melhoria: a licença do protocolo licenciado fica na versão publicada (registro, titular e validade); o aviso de
// estouro do tempo-alvo é gravado uma vez por chave (aviso_estouro_classificacao, UNIQUE); as metas, o checklist e o
// encerramento do protocolo gerenciado são registros únicos por item (inclusao_protocolo_registro), na transação do
// pedido e com a trilha. A impressão digital do conteúdo é recalculada na leitura.
import { CORES_RISCO } from '@sgh/contratos';
import {
  type ContextoOperacao,
  type Escritor,
  type Executor,
  gravarTrilha,
  type Leitor,
  type Linha,
  type Operacao,
  recusa,
  restricaoViolada,
  type ResultadoOperacao,
} from '@sgh/nucleo';
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
  txt,
  txtOuNull,
} from './banco.js';
import {
  codigosDosDiscriminadores,
  conferirPublicacao,
  json,
  opClassificar,
  opIncluirProtocolo,
  opPublicarGerenciado,
  opPublicarProtocolo,
  opRegistrarSinais,
  PARAMETRO_DO_SINAL,
  SINAIS,
  tipoDoBanco,
  tipoGerenciadoDoBanco,
  tipoGerenciadoNoBanco,
  vinculoDoLogin,
} from './classificacao-operacoes.js';
import type {
  ContextoClassificacao,
  GravadorClassificacao,
  PortaClassificacao,
  VinculoDaSessao,
} from './classificacao-porta.js';
import { impressaoDoConteudo } from './classificacao-servico.js';
import type { NucleoRecepcao } from './porta-propria.js';
import { impressaoGerenciado } from './protocolo-gerenciado-servico.js';
import type {
  ClassificacaoRegistrada,
  CorAnterior,
  GravacaoFeita,
  LiberacaoConsultada,
  NovaClassificacao,
  OpcaoPrioridadeVista,
  ProtocoloPaciente,
  PublicacaoGerenciado,
  PublicacaoProtocolo,
  NovaInclusaoProtocolo,
  NovoEventoProtocolo,
  SinaisVitais,
  TrilhaGravacao,
  VersaoGerenciado,
  VersaoProtocolo,
} from './tipos.js';

export { PARAMETRO_DO_SINAL, vinculoDoLogin };

const TETO = 5_000;
const CACHE_MS = 60_000;

const semSinais = (): SinaisVitais => ({
  pas: null,
  pad: null,
  fc: null,
  fr: null,
  temperatura: null,
  saturacao: null,
  glicemia: null,
  dor: null,
  glasgow: null,
});

export class PortaClassificacaoPropria implements PortaClassificacao {
  readonly destino = 'propria' as const;
  private readonly estabelecimentos = new Map<string, { est: EstabelecimentoDaSessao; em: number }>();

  constructor(
    private readonly nucleo: NucleoRecepcao,
    private readonly executor: Executor,
    /** Código do cliente (o banco cliente_<codigo>), da configuração da API (CLIENTE_PADRAO). */
    private readonly cliente: string,
    private readonly agora: () => number = Date.now,
  ) {}

  private async est(c: ContextoClassificacao): Promise<EstabelecimentoDaSessao> {
    const k = c.hospital;
    const x = this.estabelecimentos.get(k);
    if (x && this.agora() - x.em < CACHE_MS) return x.est;
    const est = await this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'classificacao' }, (l) =>
      estabelecimentoPorCodigo(l, c.hospital),
    );
    this.estabelecimentos.set(k, { est, em: this.agora() });
    return est;
  }

  private async ler<T>(
    c: ContextoClassificacao,
    fn: (l: Leitor, est: EstabelecimentoDaSessao) => Promise<T>,
  ): Promise<T> {
    const est = await this.est(c);
    return this.nucleo.lerSomente(
      { cliente: this.cliente, estabelecimento: est.id, correlacao: 'classificacao' },
      (l) => fn(l, est),
    );
  }

  // ── gravações ──────────────────────────────────────────────────────────────────────────────────

  async podeGravar(): Promise<LiberacaoConsultada> {
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(): Promise<GravacaoFeita> {
    throw recusa('operacao-desconhecida', 'A classificação grava pelas ações da própria tela.');
  }

  async gravar<T>(
    c: ContextoClassificacao,
    _trilha: TrilhaGravacao | ((r: T) => TrilhaGravacao) | null,
    fn: (g: GravadorClassificacao) => Promise<T>,
  ): Promise<T> {
    // A trilha de cada gravação é a da operação no Executor (ação real, escritas, evento da sessão em "dados").
    const g0 = c.gravacao;
    if (!g0)
      throw recusa(
        'contexto-incompleto',
        'A gravação da classificação pede o contexto da sessão (login, correlação e Idempotency-Key).',
      );
    const est = await this.est(c);
    const correlacao = g0.correlacao.slice(0, 64) || 'classificacao';
    return this.nucleo.escrever({ cliente: this.cliente, estabelecimento: est.id, correlacao }, async (e) => {
      const u = await e.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [g0.login]);
      if (!u) throw recusa('usuario-inexistente', 'O usuário da sessão não está no cadastro deste cliente.');
      const ctx: ContextoOperacao = {
        cliente: this.cliente,
        estabelecimento: est.id,
        usuario: num(u['id']),
        correlacao,
        chaveIdempotencia: g0.chaveIdempotencia,
        ...(g0.enderecoIp ? { enderecoIp: g0.enderecoIp } : {}),
        ...(g0.reautenticadoEm !== undefined ? { reautenticadoEm: g0.reautenticadoEm } : {}),
      };
      const sessao = { evento: g0.evento, recurso: g0.recurso, estacao: g0.estacao ?? null };
      const executar: Executa = async (op, entrada) =>
        (
          await this.executor.executar(
            { ...op, trilha: (x, r, cx) => ({ ...(op.trilha?.(x, r, cx) ?? {}), dados: sessao }) },
            this.cliente,
            entrada,
            ctx,
            { escritor: e },
          )
        ).resultado;
      return fn(new GravadorProprio(e, ctx, executar, new Date(this.agora()), est));
    });
  }

  // ── leituras ───────────────────────────────────────────────────────────────────────────────────

  async relogio(c: ContextoClassificacao): Promise<{ agora: string; hoje: string }> {
    const est = await this.est(c);
    const agora = horaCivil(new Date(this.agora()), est.fuso);
    return { agora, hoje: agora.slice(0, 10) };
  }

  vinculo(c: ContextoClassificacao, login: string): Promise<VinculoDaSessao | null> {
    return this.ler(c, async (l) => vinculoDoLogin(l, login));
  }

  versoes(c: ContextoClassificacao): Promise<VersaoProtocolo[]> {
    return this.ler(c, async (l, est) =>
      (await versoesDoEstabelecimento(l, est, null)).map((v) => semConteudo(v)),
    );
  }

  async versao(
    c: ContextoClassificacao,
    id: number,
  ): Promise<(VersaoProtocolo & { conteudo: unknown }) | null> {
    return this.ler(c, async (l, est) => (await versoesDoEstabelecimento(l, est, id))[0] ?? null);
  }

  classificacoes(
    c: ContextoClassificacao,
    cabecalhos: readonly string[],
  ): Promise<ClassificacaoRegistrada[]> {
    const ids = cabecalhos.map(Number).filter((x) => Number.isSafeInteger(x) && x > 0);
    if (ids.length === 0) return Promise.resolve([]);
    return this.ler(c, (l, est) =>
      classificacoesOnde(l, est, `cr.atendimento_id IN (${ids.map(() => '?').join(', ')})`, ids),
    );
  }

  classificacoesDoPaciente(c: ContextoClassificacao, paciente: number): Promise<ClassificacaoRegistrada[]> {
    return this.ler(c, (l, est) => classificacoesOnde(l, est, 'cr.paciente_id = ?', [paciente]));
  }

  classificacoesDoPeriodo(
    c: ContextoClassificacao,
    inicio: string,
    fim: string,
  ): Promise<ClassificacaoRegistrada[]> {
    return this.ler(c, (l, est) =>
      classificacoesOnde(l, est, 'cr.classificado_em >= ? AND cr.classificado_em < ?', [
        instanteDaHoraCivil(inicio, est.fuso),
        instanteDaHoraCivil(fim, est.fuso),
      ]),
    );
  }

  async sinaisRecentes(
    c: ContextoClassificacao,
    cabecalho: string,
    desde: string,
  ): Promise<SinaisVitais | null> {
    return (await this.sinaisRecentesDosAtendimentos(c, [{ cabecalho, desde }])).get(cabecalho) ?? null;
  }

  sinaisRecentesDosAtendimentos(
    c: ContextoClassificacao,
    itens: readonly { cabecalho: string; desde: string }[],
  ): Promise<Map<string, SinaisVitais>> {
    const validos = itens.filter((x) => Number(x.cabecalho) > 0);
    if (validos.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l, est) => {
      const r = new Map<string, SinaisVitais>();
      const ls = await l.consultar(
        `SELECT a.atendimento_id, a.aferido_em, pv.codigo, av.valor_numerico
           FROM afericao a JOIN afericao_valor av ON av.afericao_id = a.id AND av.excluido_em IS NULL
           JOIN parametro_vital pv ON pv.id = av.parametro_vital_id
          WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND av.nao_aferido = FALSE
            AND a.atendimento_id IN (${validos.map(() => '?').join(', ')})
          ORDER BY a.aferido_em, a.id, av.sequencia`,
        [est.id, ...validos.map((x) => Number(x.cabecalho))],
        { teto: TETO * 10 },
      );
      const desde = new Map(
        validos.map((x) => [Number(x.cabecalho), instanteDaHoraCivil(x.desde, est.fuso)]),
      );
      const campo = new Map(SINAIS.map((s) => [PARAMETRO_DO_SINAL[s], s]));
      for (const x of ls) {
        const at = num(x['atendimento_id']);
        if ((x['aferido_em'] as Date) < (desde.get(at) ?? new Date(0))) continue;
        const k = campo.get(txt(x['codigo']));
        if (!k || x['valor_numerico'] === null) continue;
        const atual = r.get(String(at)) ?? semSinais();
        r.set(String(at), { ...atual, [k]: Number(x['valor_numerico']) });
      }
      return r;
    });
  }

  historicoProntuario(
    c: ContextoClassificacao,
    paciente: number,
  ): Promise<{ registro: number; dataHora: string; opcao: string | null }[]> {
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `SELECT cr.id, cr.classificado_em, n.codigo FROM classificacao_risco cr
           JOIN nivel_prioridade n ON n.id = cr.nivel_prioridade_id
          WHERE cr.estabelecimento_id = ? AND cr.paciente_id = ? AND cr.excluido_em IS NULL AND cr.classificado_em IS NOT NULL
          ORDER BY cr.classificado_em DESC LIMIT 200`,
        [est.id, paciente],
      );
      return ls.map((x) => ({
        registro: num(x['id']),
        dataHora: horaCivil(x['classificado_em'] as Date, est.fuso),
        opcao: txtOuNull(x['codigo']),
      }));
    });
  }

  async opcoesPrioridadeVistas(): Promise<OpcaoPrioridadeVista[]> {
    // Os formulários antigos não existem no banco do produto: a classificação grava o nível direto.
    return [];
  }

  coresAnteriores(c: ContextoClassificacao): Promise<CorAnterior[]> {
    return this.ler(c, async (l) => {
      const ls = await l.consultar(
        `SELECT id, ordem, descricao, nome_cor, cor_hexadecimal FROM nivel_prioridade
          WHERE contexto = 'classificacao_risco' AND ativo = TRUE ORDER BY ordem`,
      );
      return ls.map((x) => ({
        id: num(x['id']),
        codigoProtocolo: num(x['ordem']),
        classificacao: txt(x['descricao']),
        corOriginal: txt(x['nome_cor']),
        corHex: txtOuNull(x['cor_hexadecimal']),
      }));
    });
  }

  async avisosGravados(c: ContextoClassificacao, chaves: readonly string[]): Promise<Set<string>> {
    if (chaves.length === 0) return new Set<string>();
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `SELECT a.chave FROM aviso_estouro_classificacao a
           JOIN classificacao_risco cr ON cr.id = a.classificacao_risco_id
          WHERE cr.estabelecimento_id = ? AND a.chave IN (${chaves.map(() => '?').join(', ')})`,
        [est.id, ...chaves],
        { teto: TETO },
      );
      return new Set(ls.map((x) => txt(x['chave'])));
    });
  }

  versoesGerenciadas(c: ContextoClassificacao): Promise<VersaoGerenciado[]> {
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `SELECT v.id, p.tipo, p.nome, v.numero_versao, v.motivo, v.dados, v.vigencia_inicio, ua.login AS autor
           FROM protocolo_gerenciado_versao v JOIN protocolo_gerenciado p ON p.id = v.protocolo_gerenciado_id
           LEFT JOIN usuario ua ON ua.id = v.usuario_id
          WHERE (p.estabelecimento_id = ? OR p.estabelecimento_id IS NULL) AND p.excluido_em IS NULL
          ORDER BY v.id DESC`,
        [est.id],
        { teto: TETO },
      );
      return ls.map((x) => {
        const conteudo = json(x['dados']);
        return {
          id: num(x['id']),
          tipo: tipoGerenciadoDoBanco(txt(x['tipo'])),
          versao: num(x['numero_versao']),
          nome: txt(x['nome']),
          notas: txt(x['motivo']),
          autor: txt(x['autor']),
          aprovador: txt(x['autor']),
          publicadoEm: horaCivil(x['vigencia_inicio'] as Date, est.fuso),
          impressao: impressaoGerenciado(conteudo as never),
          conteudo,
        };
      });
    });
  }

  protocolosDosAtendimentos(
    c: ContextoClassificacao,
    cabecalhos: readonly string[],
  ): Promise<ProtocoloPaciente[]> {
    const ids = cabecalhos.map(Number).filter((x) => Number.isSafeInteger(x) && x > 0);
    if (ids.length === 0) return Promise.resolve([]);
    return this.ler(c, (l, est) =>
      inclusoesOnde(l, est, `i.atendimento_id IN (${ids.map(() => '?').join(', ')})`, ids),
    );
  }

  protocolosDoPeriodo(c: ContextoClassificacao, inicio: string, fim: string): Promise<ProtocoloPaciente[]> {
    return this.ler(c, (l, est) =>
      inclusoesOnde(l, est, 'i.horario_zero_em >= ? AND i.horario_zero_em < ?', [
        instanteDaHoraCivil(inicio, est.fuso),
        instanteDaHoraCivil(fim, est.fuso),
      ]),
    );
  }

  async protocoloDoPaciente(c: ContextoClassificacao, id: number): Promise<ProtocoloPaciente | null> {
    return (await this.ler(c, (l, est) => inclusoesOnde(l, est, 'i.id = ?', [id])))[0] ?? null;
  }
}

/** A versão sem o conteúdo (a lista não leva o protocolo inteiro). */
function semConteudo(v: VersaoProtocolo & { conteudo: unknown }): VersaoProtocolo {
  const r: Partial<typeof v> = { ...v };
  delete r.conteudo;
  return r as VersaoProtocolo;
}

// ── Leituras ─────────────────────────────────────────────────────────────────────────────────────

async function versoesDoEstabelecimento(
  l: Leitor,
  est: EstabelecimentoDaSessao,
  id: number | null,
): Promise<(VersaoProtocolo & { conteudo: unknown })[]> {
  const ls = await l.consultar(
    `SELECT v.id, v.protocolo_classificacao_risco_id, v.numero_versao, p.tipo, p.nome, v.motivo_publicacao, v.dados,
            v.vigencia_inicio, v.licenca_valida_ate, ua.login AS autor, up.login AS aprovador
       FROM protocolo_classificacao_risco_versao v
       JOIN protocolo_classificacao_risco p ON p.id = v.protocolo_classificacao_risco_id AND p.excluido_em IS NULL
       LEFT JOIN usuario ua ON ua.id = v.usuario_id LEFT JOIN usuario up ON up.id = v.publicado_por_usuario_id
      WHERE EXISTS (SELECT 1 FROM protocolo_classificacao_estabelecimento pe
                     WHERE pe.protocolo_classificacao_risco_id = p.id AND pe.estabelecimento_id = ? AND pe.excluido_em IS NULL)
        ${id === null ? '' : 'AND v.id = ?'}
      ORDER BY v.id DESC`,
    id === null ? [est.id] : [est.id, id],
    { teto: TETO },
  );
  return ls.map((x) => {
    const conteudo = json(x['dados']);
    return {
      id: num(x['id']),
      protocolo: num(x['protocolo_classificacao_risco_id']),
      versao: num(x['numero_versao']),
      tipo: tipoDoBanco(txt(x['tipo'])),
      nome: txt(x['nome']),
      notas: txt(x['motivo_publicacao']),
      autor: txt(x['autor']),
      aprovador: txt(x['aprovador']),
      publicadoEm: horaCivil(x['vigencia_inicio'] as Date, est.fuso),
      licencaValidaAte: x['licenca_valida_ate'] ? dataIso(x['licenca_valida_ate']) : null,
      impressao: impressaoDoConteudo(conteudo as never),
      conteudo,
    };
  });
}

/** Código de cada discriminador da versão pela ordem do conteúdo publicado (fluxograma, sequência). */
async function classificacoesOnde(
  l: Leitor,
  est: EstabelecimentoDaSessao,
  onde: string,
  p: readonly unknown[],
): Promise<ClassificacaoRegistrada[]> {
  const ls = await l.consultar(
    `SELECT cr.id, cr.atendimento_id, cr.paciente_id, cr.protocolo_classificacao_risco_versao_id, f.codigo AS fluxograma,
            np.codigo AS cor_proposta, nf.codigo AS cor_final, cr.justificativa_sobreposicao, cr.anterior_classificacao_risco_id,
            mr.tipo AS motivo_tipo, cr.descricao_mudanca_quadro, cr.tempo_alvo_minutos, cr.registro_assistencial_id,
            cr.classificado_em, cr.inicio_em, ua.login AS autor, v.dados
       FROM classificacao_risco cr
       JOIN protocolo_classificacao_risco_versao v ON v.id = cr.protocolo_classificacao_risco_versao_id
       LEFT JOIN fluxograma_classificacao_risco f ON f.id = cr.fluxograma_classificacao_risco_id
       JOIN nivel_prioridade np ON np.id = cr.proposto_nivel_prioridade_id
       JOIN nivel_prioridade nf ON nf.id = cr.nivel_prioridade_id
       LEFT JOIN motivo_reclassificacao mr ON mr.id = cr.motivo_reclassificacao_id
       LEFT JOIN usuario ua ON ua.id = cr.criado_por
      WHERE cr.estabelecimento_id = ? AND cr.excluido_em IS NULL AND cr.situacao IN ('concluida','reclassificada') AND ${onde}
      ORDER BY cr.classificado_em, cr.id`,
    [est.id, ...p],
    { teto: TETO },
  );
  if (ls.length === 0) return [];
  const ids = ls.map((x) => num(x['id']));
  const marca = ids.map(() => '?').join(', ');
  const respostas = await l.consultar(
    `SELECT r.classificacao_risco_id, f.codigo AS fluxograma, d.sequencia, d.selecao_automatica
       FROM classificacao_risco_resposta r JOIN discriminador_classificacao_risco d ON d.id = r.discriminador_classificacao_risco_id
       JOIN fluxograma_classificacao_risco f ON f.id = d.fluxograma_classificacao_risco_id
      WHERE r.classificacao_risco_id IN (${marca}) AND r.excluido_em IS NULL AND r.resposta = 'sim'
      ORDER BY r.classificacao_risco_id, r.sequencia`,
    ids,
    { teto: TETO * 20 },
  );
  const sinais = await l.consultar(
    `SELECT a.classificacao_risco_id, pv.codigo, av.valor_numerico
       FROM afericao a JOIN afericao_valor av ON av.afericao_id = a.id AND av.excluido_em IS NULL
       JOIN parametro_vital pv ON pv.id = av.parametro_vital_id
      WHERE a.classificacao_risco_id IN (${marca}) AND a.excluido_em IS NULL`,
    ids,
    { teto: TETO * 20 },
  );
  const campo = new Map(SINAIS.map((s) => [PARAMETRO_DO_SINAL[s], s]));
  return ls.map((x) => {
    const id = num(x['id']);
    const codigos = codigosDosDiscriminadores(json(x['dados']));
    const minhas = respostas.filter((r) => num(r['classificacao_risco_id']) === id);
    const codigo = (r: Linha) => codigos.get(`${txt(r['fluxograma'])}:${num(r['sequencia'])}`) ?? '';
    const s = semSinais() as Record<keyof SinaisVitais, number | null>;
    for (const v of sinais.filter((y) => num(y['classificacao_risco_id']) === id)) {
      const k = campo.get(txt(v['codigo']));
      if (k && v['valor_numerico'] !== null) s[k] = Number(v['valor_numerico']);
    }
    const motivoTipo = txtOuNull(x['motivo_tipo']);
    const registro = numOuNull(x['registro_assistencial_id']);
    return {
      id,
      cabecalho: String(num(x['atendimento_id'])),
      reg: num(x['atendimento_id']),
      paciente: num(x['paciente_id']),
      versaoProtocolo: num(x['protocolo_classificacao_risco_versao_id']),
      fluxograma: txt(x['fluxograma']),
      discriminadores: minhas.map(codigo).filter(Boolean),
      automaticos: minhas
        .filter((r) => bool(r['selecao_automatica']))
        .map(codigo)
        .filter(Boolean),
      sinais: s,
      corProposta: txt(x['cor_proposta']),
      corFinal: txt(x['cor_final']),
      justificativa: txtOuNull(x['justificativa_sobreposicao']),
      motivo:
        x['anterior_classificacao_risco_id'] === null
          ? 'inicial'
          : motivoTipo === 'tempo_alvo_vencido'
            ? 'estouro'
            : 'mudanca_quadro',
      descricaoMudanca: txtOuNull(x['descricao_mudanca_quadro']),
      anterior: numOuNull(x['anterior_classificacao_risco_id']),
      tempoAlvoMin: num(x['tempo_alvo_minutos']),
      registroE08: registro,
      e08: registro === null ? 'desligado' : 'gravado',
      autor: txt(x['autor']),
      em: civilOuNull(x['classificado_em'] ?? x['inicio_em'], est.fuso) ?? '',
    };
  });
}

async function inclusoesOnde(
  l: Leitor,
  est: EstabelecimentoDaSessao,
  onde: string,
  p: readonly unknown[],
): Promise<ProtocoloPaciente[]> {
  const ls = await l.consultar(
    `SELECT i.id, i.atendimento_id, i.paciente_id, i.protocolo_gerenciado_id, i.forma_inclusao, i.horario_zero_em,
            i.criado_em, pg.tipo, ui.login AS incluido_por
       FROM inclusao_protocolo_paciente i JOIN protocolo_gerenciado pg ON pg.id = i.protocolo_gerenciado_id
       LEFT JOIN usuario ui ON ui.id = i.criado_por
      WHERE i.estabelecimento_id = ? AND i.excluido_em IS NULL AND ${onde}
      ORDER BY i.horario_zero_em, i.id`,
    [est.id, ...p],
    { teto: TETO },
  );
  if (ls.length === 0) return [];
  const ids = ls.map((x) => num(x['id']));
  const criterios = await l.consultar(
    `SELECT inclusao_protocolo_paciente_id, identificador FROM inclusao_protocolo_criterio
      WHERE inclusao_protocolo_paciente_id IN (${ids.map(() => '?').join(', ')}) AND excluido_em IS NULL
      ORDER BY inclusao_protocolo_paciente_id, sequencia`,
    ids,
    { teto: TETO * 10 },
  );
  const registros = await l.consultar(
    `SELECT r.id, r.inclusao_protocolo_paciente_id, r.tipo, r.codigo, r.situacao, r.ocorrido_em, r.prazo_em, r.motivo,
            r.criado_em, u.login
       FROM inclusao_protocolo_registro r LEFT JOIN usuario u ON u.id = r.usuario_id
      WHERE r.inclusao_protocolo_paciente_id IN (${ids.map(() => '?').join(', ')}) AND r.excluido_em IS NULL
      ORDER BY r.inclusao_protocolo_paciente_id, r.id`,
    ids,
    { teto: TETO * 10 },
  );
  return ls.map((x) => {
    const id = num(x['id']);
    const forma = txt(x['forma_inclusao']);
    return {
      id,
      cabecalho: String(num(x['atendimento_id'])),
      reg: num(x['atendimento_id']),
      paciente: num(x['paciente_id']),
      tipo: tipoGerenciadoDoBanco(txt(x['tipo'])),
      gerenciado: num(x['protocolo_gerenciado_id']),
      origem: forma === 'alerta_automatico' ? ('sugerido' as const) : ('enfermeiro' as const),
      sugeridoPor: null,
      criterios: criterios
        .filter((c) => num(c['inclusao_protocolo_paciente_id']) === id)
        .map((c) => txt(c['identificador'])),
      chegadaEm: horaCivil(x['horario_zero_em'] as Date, est.fuso),
      incluidoEm: horaCivil(x['criado_em'] as Date, est.fuso),
      incluidoPor: txt(x['incluido_por']),
      eventos: registros
        .filter((r) => num(r['inclusao_protocolo_paciente_id']) === id)
        .map((r) => ({
          id: num(r['id']),
          tipo: txt(r['tipo']) as 'meta' | 'checklist' | 'encerramento',
          codigo: txt(r['codigo']),
          situacao: txt(r['situacao']),
          quando: civilOuNull(r['ocorrido_em'], est.fuso),
          prazoEm: civilOuNull(r['prazo_em'], est.fuso),
          motivo: txtOuNull(r['motivo']),
          por: txt(r['login']),
          em: horaCivil(r['criado_em'] as Date, est.fuso),
        })),
    };
  });
}

// ── Gravador ─────────────────────────────────────────────────────────────────────────────────────

// A entrada vai bruta: a operação a valida (zod) antes de gravar.
type Executa = <E, S extends ResultadoOperacao>(op: Operacao<E, S>, entrada: unknown) => Promise<S>;

/** As gravações de um pedido: cada uma é uma operação do Executor, na transação do pedido. */
class GravadorProprio implements GravadorClassificacao {
  constructor(
    private readonly e: Escritor,
    private readonly ctx: ContextoOperacao,
    private readonly executar: Executa,
    private readonly instante: Date,
    private readonly est: EstabelecimentoDaSessao,
  ) {}

  /** A hora civil do estabelecimento ("AAAA-MM-DDTHH:MM" ou com segundos) como instante; nulo fica nulo. */
  private instanteDe(civil: string | null): Date | null {
    return civil === null
      ? null
      : instanteDaHoraCivil(civil.length === 16 ? `${civil}:00` : civil, this.est.fuso);
  }

  private async trilhaDireta(entidade: string, id: number, dados: Record<string, unknown>): Promise<void> {
    await gravarTrilha(this.e, {
      estabelecimento: this.ctx.estabelecimento,
      usuario: this.ctx.usuario,
      acao: 'operacao',
      entidade,
      entidadeId: id,
      dadosDepois: dados,
      motivo: null,
      enderecoIp: this.ctx.enderecoIp ?? null,
      correlacao: this.ctx.correlacao.slice(0, 64),
      ocorridoEm: this.instante,
    });
  }

  /** Evento próprio a mais na trilha (sem escrita de negócio: a cor sobreposta), na mesma transação. */
  async registrarEvento(t: TrilhaGravacao): Promise<void> {
    const u = await this.e.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [t.login]);
    await gravarTrilha(this.e, {
      estabelecimento: this.ctx.estabelecimento,
      usuario: u ? num(u['id']) : this.ctx.usuario,
      acao: 'operacao',
      entidade: t.tabela,
      entidadeId: t.id,
      dadosDepois: { evento: t.evento, recurso: t.recurso, estacao: t.estacao ?? null },
      motivo: t.motivo ?? null,
      enderecoIp: this.ctx.enderecoIp ?? null,
      correlacao: t.correlacao.slice(0, 64),
      ocorridoEm: this.instante,
    });
  }

  async publicarProtocolo(
    p: PublicacaoProtocolo,
  ): Promise<{ id: number; protocolo: number; versao: number }> {
    // A licença e o código longo são recusados antes de abrir a operação (mensagem de negócio, nada gravado).
    conferirPublicacao(p);
    const r = await this.executar(opPublicarProtocolo, p);
    return { id: r.id, protocolo: r.protocolo, versao: r.versao };
  }

  async classificar(x: NovaClassificacao): Promise<{ id: number; sinais: number }> {
    const r = await this.executar(opClassificar, x);
    return { id: r.id, sinais: r.sinais };
  }

  async registrarSinais(r: {
    cabecalho: string;
    paciente: number;
    sinais: SinaisVitais;
    horaSinais: string;
    autor: string;
  }): Promise<number> {
    if (SINAIS.every((s) => r.sinais[s] === null)) return 0;
    return (await this.executar(opRegistrarSinais, r)).sinais;
  }

  /** O aviso de estouro, uma vez por chave (a UNIQUE decide entre consumidores concorrentes). */
  async avisarEstouro(a: {
    chave: string;
    classificacao: number;
    reg: number;
    prazoEm: string;
  }): Promise<boolean> {
    const cr = await this.e.uma(
      'SELECT id FROM classificacao_risco WHERE id = ? AND estabelecimento_id = ?',
      [a.classificacao, this.ctx.estabelecimento],
    );
    if (!cr) throw recusa('registro-inexistente', 'A classificação não é deste estabelecimento.');
    try {
      await this.e.inserir(
        `INSERT INTO aviso_estouro_classificacao (classificacao_risco_id, chave, prazo_em, avisado_em, criado_em,
           criado_por, versao) VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [
          a.classificacao,
          a.chave,
          this.instanteDe(a.prazoEm),
          this.instante,
          this.instante,
          this.ctx.usuario,
        ],
      );
    } catch (erro) {
      // Outro consumidor avisou antes (a UNIQUE da chave decide); a transação segue.
      if (restricaoViolada(erro)?.nome === 'uq_aviso_estouro_classificacao_chave') return false;
      throw erro;
    }
    await this.trilhaDireta('classificacao_risco', a.classificacao, {
      aviso: 'estouro',
      chave: a.chave,
      reg: a.reg,
    });
    return true;
  }

  async publicarGerenciado(p: PublicacaoGerenciado): Promise<{ id: number; versao: number }> {
    tipoGerenciadoNoBanco(p.tipo);
    const r = await this.executar(opPublicarGerenciado, p);
    return { id: r.id, versao: r.versao };
  }

  async incluirProtocolo(p: NovaInclusaoProtocolo): Promise<number> {
    return (await this.executar(opIncluirProtocolo, p)).id;
  }

  /** A meta, o item do checklist ou o encerramento: uma vez cada, e nada depois do encerramento. */
  async registrarEventoProtocolo(p: NovoEventoProtocolo): Promise<number> {
    const inc = await this.e.consultarParaAtualizar(
      'SELECT id FROM inclusao_protocolo_paciente WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [p.protocoloPaciente, this.ctx.estabelecimento],
    );
    if (inc.length === 0)
      throw recusa('protocolo-inexistente', 'O protocolo do paciente não existe neste estabelecimento.');
    const feitos = await this.e.consultar(
      'SELECT tipo, codigo FROM inclusao_protocolo_registro WHERE inclusao_protocolo_paciente_id = ? AND excluido_em IS NULL',
      [p.protocoloPaciente],
    );
    if (feitos.some((k) => txt(k['tipo']) === 'encerramento'))
      throw recusa(
        p.tipoEvento === 'encerramento' ? 'ja-encerrado' : 'protocolo-encerrado',
        'O protocolo deste paciente já foi encerrado.',
      );
    if (feitos.some((k) => txt(k['tipo']) === p.tipoEvento && txt(k['codigo']) === p.codigo))
      throw recusa(
        'ja-registrado',
        'Este item do protocolo já foi registrado. Abra de novo para ver o registro.',
      );
    const u = await this.e.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [p.por]);
    if (!u) throw recusa('usuario-inexistente', 'O usuário não está no cadastro deste cliente.');
    const id = await this.e.inserir(
      `INSERT INTO inclusao_protocolo_registro (inclusao_protocolo_paciente_id, tipo, codigo, situacao, ocorrido_em,
         prazo_em, motivo, usuario_id, criado_em, criado_por, versao) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        p.protocoloPaciente,
        p.tipoEvento,
        p.codigo,
        p.situacao,
        this.instanteDe(p.ocorridoEm),
        this.instanteDe(p.prazoEm),
        p.motivo,
        num(u['id']),
        this.instante,
        this.ctx.usuario,
      ],
    );
    await this.trilhaDireta('inclusao_protocolo_registro', id, {
      protocoloPaciente: p.protocoloPaciente,
      tipo: p.tipoEvento,
      codigo: p.codigo,
      situacao: p.situacao,
    });
    return id;
  }
}

/** Cores do contrato (para conferência do cadastro de níveis nos testes). */
export const CODIGOS_NIVEL = CORES_RISCO.map((c) => c.codigo);
