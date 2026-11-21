// Porta do plantão realizado sobre o banco do cliente (MariaDB, pelo @sgh/nucleo; F2.2 lote 03-04), no modelo que já
// existe, sem tabela paralela:
//   - o realizado É o plantão (o id do realizado é o do plantão): informar grava entrada_registrada_em e
//     saida_registrada_em, situacao 'realizado' e revisado_* (quem registrou e quando);
//   - a decisão grava aprovado_* (quem decidiu, quando e o resultado): aprovado = verdadeiro aprova para pagamento ou
//     repasse; aprovado = falso com aprovado_em preenchido é a recusa, e o plantão volta a 'previsto' para novo registro.
//     Quem decide é outra pessoa (regra no domínio, conferirDecisaoRealizado; e conferida de novo aqui na transação);
//   - a tarifa por hora é a de valor_hora_plantao (regra geral por hora: sem profissional, grupo, especialidade, faixa
//     de horário ou tipo de dia); o valor do realizado aprovado é calculado na leitura pelo domínio (tarifaVigente e
//     valorRealizado), então a tarifa incluída depois vale para o aprovado ainda não lançado, sem passo de "valorar".
// Leituras em transação somente leitura, filtradas pelo estabelecimento da sessão; gravações por ação no Executor
// (gravacao-por-acao.ts: `pessoas.realizado.registrar`, `.decidir`, `.tarifa`), só na tabela da ação.
// Melhoria: o tipo de vínculo vem do vínculo de trabalho (regime trabalhista) ou do profissional (pessoa jurídica ou
// terceiro); o prestador do repasse é o profissional do plantão (id), como no repasse; os instantes ficam em UTC e
// voltam no fuso do estabelecimento; a regra dos quatro olhos vale também na transação (nunca decide quem registrou).
// Pendências de modelo (pedido em docs/obra/fatias/f22/saida/03-04.json), com as operações indisponíveis até o DDL:
//   - lançar no repasse e estornar: o plantão não guarda o lançamento (lancamento_repasse não tem o plantão) nem o
//     estorno; `repasse.lancarEvento` e o estorno respondem 409 `modelo-pendente`;
// A tarifa incluída grava o tipo de plantão (valor_hora_plantao.tipo_plantao); a tarifa sem tipo vale para todos os
// tipos (lida uma vez por tipo). A fonte do realizado (informado ou ponto) e o motivo da recusa ficam no plantão
// (fonte_realizado e motivo_recusa_realizado) e voltam na leitura.
import { tarifaVigente, valorRealizado } from '@sgh/dominio-pessoas';
import {
  ErroOperacao,
  type Executor,
  type Leitor,
  recusa,
  erroConflitoVersao,
  type TxOperacao,
} from '@sgh/nucleo';
import type { GravacaoFeita, LiberacaoGravacao, TrilhaDaGravacao } from '../../exames/public-api.js';
import {
  type AcaoGravacao,
  eventoDaTrilha,
  type ExtrasGravacao,
  gravarPorAcao,
} from './gravacao-por-acao.js';
import {
  civilDoUtc,
  contextoDe,
  dataIso,
  fusoDe,
  num,
  numOuNulo,
  texto,
  textoOuNulo,
  utcDoCivil,
  type NucleoEscala,
} from './porta-escala-propria.js';
import type { ContextoRealizado, GravadorRealizado, PortaRealizado } from './porta-realizado.js';
import type { RegistroPlantaoParaRealizado, RegistroRealizado, RegistroTarifaPlantao } from './tipos.js';

const pendente = (titulo: string, motivo: string) => new ErroOperacao(409, 'modelo-pendente', titulo, motivo);
const MOTIVO_LANCAMENTO =
  'O lançamento do plantão no repasse aguarda a ligação ao módulo do repasse (favorecido e evento do lançamento): o realizado aprovado fica no relatório, sem lançar.';
const MOTIVO_ESTORNO =
  'O estorno do realizado aguarda a ligação ao módulo do repasse (o lançamento negativo do estorno), que vem junto com o lançamento.';

/** Uma operação do Executor por ação da tela do realizado. */
export const ACOES_REALIZADO: Readonly<Record<string, AcaoGravacao>> = {
  'pessoas.realizado.registrado': { nome: 'pessoas.realizado.registrar', tabelas: ['plantao'] },
  'pessoas.realizado.decidido': { nome: 'pessoas.realizado.decidir', tabelas: ['plantao'] },
  'pessoas.realizado.estornado': { nome: 'pessoas.realizado.estornar', tabelas: ['plantao'] },
  'pessoas.tarifa_plantao.gravada': { nome: 'pessoas.realizado.tarifa', tabelas: ['valor_hora_plantao'] },
};

/** Tipos de plantão do modelo (ck_plantao_tipo): a tarifa sem tipo vale para cada um. */
const TIPOS_PLANTAO = ['presencial', 'sobreaviso', 'diarista'] as const;

const marcas = (k: number) => Array.from({ length: k }, () => '?').join(', ');

const SQL_VINCULO = `LEFT JOIN vinculo_trabalho v ON v.id = (SELECT v2.id FROM vinculo_trabalho v2
     WHERE v2.colaborador_id = p.colaborador_id AND v2.estabelecimento_id = p.estabelecimento_id AND v2.excluido_em IS NULL
     ORDER BY (v2.situacao IN ('ativo','afastado')) DESC, v2.data_admissao DESC, v2.id DESC LIMIT 1)`;

const SQL_PLANTAO = `SELECT p.id, p.escala_id, e.situacao AS estado_escala, e.setor_funcional_id, p.colaborador_id,
  p.profissional_id, col.nome, col.usuario_id, p.tipo, p.inicio_em, p.fim_em, p.situacao, v.id AS vinculo,
  v.regime_trabalhista, pr.recebe_por_pessoa_juridica
  FROM plantao p JOIN escala e ON e.id = p.escala_id
  LEFT JOIN colaborador col ON col.id = p.colaborador_id
  LEFT JOIN profissional pr ON pr.id = p.profissional_id
  ${SQL_VINCULO}
  WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND e.excluido_em IS NULL`;

/** O realizado é o plantão com o horário real registrado (revisado), fora do cancelado. */
const SQL_REALIZADO = `SELECT p.id, p.colaborador_id, p.setor_funcional_id, p.tipo, p.entrada_registrada_em,
  p.saida_registrada_em, p.observacao, p.revisado_em, ur.login AS informado_por, p.revisado_por_usuario_id,
  p.aprovado, p.aprovado_em, ua.login AS decidido_por, p.versao, v.id AS vinculo, p.fonte_realizado,
  p.motivo_recusa_realizado
  FROM plantao p
  LEFT JOIN usuario ur ON ur.id = p.revisado_por_usuario_id
  LEFT JOIN usuario ua ON ua.id = p.aprovado_por_usuario_id
  ${SQL_VINCULO}
  WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND p.situacao <> 'cancelado' AND p.revisado = TRUE
    AND p.entrada_registrada_em IS NOT NULL AND p.saida_registrada_em IS NOT NULL`;

/** A tarifa por hora geral do setor (ou de todos os setores), sem os recortes que a tela do realizado não usa. */
const SQL_TARIFA = `SELECT t.id, t.setor_funcional_id, t.tipo_plantao, t.vigencia_inicio, t.vigencia_fim, t.valor_hora,
  t.versao, u.login AS criado_por_login
  FROM valor_hora_plantao t LEFT JOIN usuario u ON u.id = t.criado_por
  WHERE t.estabelecimento_id = ? AND t.ativo = TRUE AND t.forma_pagamento = 'hora' AND t.profissional_id IS NULL
    AND t.grupo_setor_plantao_id IS NULL AND t.especialidade_medica_id IS NULL AND t.tipo_dia = 'todos'
    AND t.hora_inicio IS NULL AND t.valor_hora IS NOT NULL`;

const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';

function plantaoDe(r: Record<string, unknown>, fuso: string): RegistroPlantaoParaRealizado {
  const pj = verdadeiro(r['recebe_por_pessoa_juridica']);
  const situacao = texto(r['situacao']);
  return {
    plantao: num(r['id']),
    escala: num(r['escala_id']),
    estadoEscala: texto(r['estado_escala']),
    unidade: num(r['setor_funcional_id']),
    vinculo: num(r['vinculo']),
    pessoa: num(r['colaborador_id']),
    nome: texto(r['nome']),
    tipoVinculo:
      r['vinculo'] !== null && r['vinculo'] !== undefined
        ? texto(r['regime_trabalhista'])
        : pj
          ? 'pj'
          : 'terceiro',
    usuario: numOuNulo(r['usuario_id']),
    // O prestador do repasse é o profissional do plantão (id), como no módulo do repasse.
    registro: numOuNulo(r['profissional_id']),
    tipo: texto(r['tipo']),
    inicio: civilDoUtc(r['inicio_em'], fuso),
    fim: civilDoUtc(r['fim_em'], fuso),
    // Para o realizado, o plantão só se divide em cancelado ou não: o estado do realizado é lido à parte.
    situacao: situacao === 'cancelado' ? 'cancelado' : 'previsto',
  };
}

function tarifasDe(rs: readonly Record<string, unknown>[]): RegistroTarifaPlantao[] {
  return rs.flatMap((r) =>
    (r['tipo_plantao'] === null || r['tipo_plantao'] === undefined
      ? TIPOS_PLANTAO
      : [texto(r['tipo_plantao'])]
    ).map((tipo) => ({
      id: num(r['id']),
      tipo,
      unidade: numOuNulo(r['setor_funcional_id']),
      inicio: dataIso(r['vigencia_inicio']),
      fim: r['vigencia_fim'] === null || r['vigencia_fim'] === undefined ? null : dataIso(r['vigencia_fim']),
      valorHora: Number(r['valor_hora']),
      criadoPor: texto(r['criado_por_login']),
    })),
  );
}

function realizadoDe(
  r: Record<string, unknown>,
  fuso: string,
  tarifas: readonly RegistroTarifaPlantao[],
): RegistroRealizado {
  const inicio = civilDoUtc(r['entrada_registrada_em'], fuso);
  const fim = civilDoUtc(r['saida_registrada_em'], fuso);
  const minutos = Math.round(
    (instante(r['saida_registrada_em']) - instante(r['entrada_registrada_em'])) / 60000,
  );
  const decidido = r['aprovado_em'] !== null && r['aprovado_em'] !== undefined;
  const aprovado = decidido && verdadeiro(r['aprovado']);
  const situacao: RegistroRealizado['situacao'] = !decidido
    ? 'informado'
    : aprovado
      ? 'aprovado'
      : 'recusado';
  const t = aprovado
    ? tarifaVigente(tarifas, texto(r['tipo']), num(r['setor_funcional_id']), inicio.slice(0, 10))
    : null;
  const v = t ? valorRealizado(minutos, t.valorHora) : null;
  return {
    id: num(r['id']),
    plantao: num(r['id']),
    vinculo: num(r['vinculo']),
    pessoa: num(r['colaborador_id']),
    inicio,
    fim,
    minutos,
    origem: (textoOuNulo(r['fonte_realizado']) ?? 'informado') as RegistroRealizado['origem'],
    observacao: textoOuNulo(r['observacao']),
    situacao,
    informadoPor: texto(r['informado_por']),
    informadoEm: civilDoUtc(r['revisado_em'], fuso),
    decididoPor: decidido ? textoOuNulo(r['decidido_por']) : null,
    decididoEm: decidido ? civilDoUtc(r['aprovado_em'], fuso) : null,
    motivo: decidido && !aprovado ? textoOuNulo(r['motivo_recusa_realizado']) : null,
    tarifa: t?.id ?? null,
    valorHora: t?.valorHora ?? null,
    valor: v?.valor ?? null,
    lancamento: null,
    lancadoPor: null,
    versao: num(r['versao']),
    estorno: null,
  };
}

function instante(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  return Date.parse(`${String(v).replace(' ', 'T').slice(0, 23)}Z`);
}

/** Leituras comuns à transação somente leitura e à de gravação. */
const leitura = {
  async tarifas(l: Leitor, est: number): Promise<RegistroTarifaPlantao[]> {
    return tarifasDe(await l.consultar(`${SQL_TARIFA} ORDER BY t.vigencia_inicio, t.id`, [est]));
  },
  async realizados(
    l: Leitor,
    est: number,
    fuso: string,
    filtro: string,
    params: unknown[],
  ): Promise<RegistroRealizado[]> {
    const tarifas = await leitura.tarifas(l, est);
    return (
      await l.consultar(`${SQL_REALIZADO} ${filtro} ORDER BY p.entrada_registrada_em, p.id LIMIT 5000`, [
        est,
        ...params,
      ])
    ).map((r) => realizadoDe(r, fuso, tarifas));
  },
  async plantao(
    l: Leitor,
    est: number,
    fuso: string,
    id: number,
  ): Promise<RegistroPlantaoParaRealizado | null> {
    const r = await l.uma(`${SQL_PLANTAO} AND p.id = ?`, [est, id]);
    return r ? plantaoDe(r, fuso) : null;
  },
  async plantoesPorIds(
    l: Leitor,
    est: number,
    fuso: string,
    ids: readonly number[],
  ): Promise<RegistroPlantaoParaRealizado[]> {
    if (ids.length === 0) return [];
    return (
      await l.consultar(`${SQL_PLANTAO} AND p.id IN (${marcas(ids.length)}) ORDER BY p.id`, [est, ...ids])
    ).map((r) => plantaoDe(r, fuso));
  },
  async apuracao(
    l: Leitor,
    est: number,
    competencia: string,
  ): Promise<{ id: number; estado: string } | null> {
    const r = await l.uma(
      `SELECT id, situacao FROM apuracao_repasse
        WHERE estabelecimento_id = ? AND competencia = ? AND tipo_apuracao IN ('plantao','misto')
        ORDER BY id DESC LIMIT 1`,
      [est, `${competencia.slice(0, 7)}-01`],
    );
    return r ? { id: num(r['id']), estado: texto(r['situacao']) } : null;
  },
};

function gravadorSobre(
  tx: TxOperacao,
  est: number,
  usuario: number,
  fuso: string,
  x: ExtrasGravacao,
): GravadorRealizado {
  const agora = () => new Date();
  const umRealizado = async (id: number) =>
    (await leitura.realizados(tx, est, fuso, 'AND p.id = ?', [id]))[0] ?? null;
  return {
    plantao: (id) => leitura.plantao(tx, est, fuso, id),
    async realizadosDoPlantao(p) {
      const r = await umRealizado(p);
      return r ? [r] : [];
    },
    realizadosDaPessoa: (pessoa, de, ate) =>
      leitura.realizados(
        tx,
        est,
        fuso,
        'AND p.colaborador_id = ? AND p.entrada_registrada_em >= ? AND p.entrada_registrada_em < ? AND (p.aprovado_em IS NULL OR p.aprovado = TRUE)',
        [pessoa, utcDoCivil(de, fuso), utcDoCivil(ate, fuso)],
      ),
    realizado: (id) => umRealizado(id),
    tarifas: () => leitura.tarifas(tx, est),
    async incluirRealizado(r) {
      const l = (
        await tx.consultarParaAtualizar(
          `SELECT versao, situacao, aprovado, aprovado_em FROM plantao
            WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [r.plantao, est],
        )
      )[0];
      if (!l || texto(l['situacao']) === 'cancelado')
        throw recusa('plantao-inexistente', 'O plantão não existe ou foi cancelado.');
      if (l['aprovado_em'] !== null && verdadeiro(l['aprovado'])) throw erroConflitoVersao(['aprovado']);
      // Um realizado em vigor por plantão: o registro novo substitui o informado ou o recusado (a trilha guarda o anterior).
      await tx.alterar('plantao', r.plantao, num(l['versao']), {
        situacao: 'realizado',
        entrada_registrada_em: utcDoCivil(r.inicio, fuso),
        saida_registrada_em: utcDoCivil(r.fim, fuso),
        observacao: r.observacao,
        revisado: true,
        revisado_por_usuario_id: usuario,
        revisado_em: agora(),
        aprovado: false,
        aprovado_por_usuario_id: null,
        aprovado_em: null,
        fonte_realizado: r.origem,
        motivo_recusa_realizado: null,
      });
      x.dados['realizado'] = { minutos: r.minutos };
      return r.plantao;
    },
    async decidirRealizado(d) {
      const l = (
        await tx.consultarParaAtualizar(
          `SELECT versao, revisado, revisado_por_usuario_id, aprovado_em FROM plantao
            WHERE id = ? AND estabelecimento_id = ? AND situacao = 'realizado' AND excluido_em IS NULL`,
          [d.id, est],
        )
      )[0];
      if (!l || !verdadeiro(l['revisado']) || l['aprovado_em'] !== null || num(l['versao']) !== d.versao)
        throw erroConflitoVersao(['versao', 'situacao']);
      // Quatro olhos também na transação: quem registrou não decide.
      if (numOuNulo(l['revisado_por_usuario_id']) === usuario)
        throw recusa(
          'quatro-olhos',
          'Quem registrou o realizado não o aprova: outra pessoa da coordenação decide.',
        );
      const aprova = d.situacao === 'aprovado';
      await tx.alterar('plantao', d.id, d.versao, {
        aprovado: aprova,
        aprovado_por_usuario_id: usuario,
        aprovado_em: agora(),
        // A recusa devolve o plantão a previsto: a coordenação registra de novo.
        ...(aprova ? {} : { situacao: 'previsto', motivo_recusa_realizado: d.motivo }),
      });
      x.dados['decisao'] = { situacao: d.situacao, tarifa: d.tarifa, valorHora: d.valorHora, valor: d.valor };
    },
    async incluirTarifa(t) {
      if (!(TIPOS_PLANTAO as readonly string[]).includes(t.tipo))
        throw recusa(
          'tipo-plantao-invalido',
          'O tipo de plantão da tarifa é presencial, sobreaviso ou diarista.',
        );
      if (t.unidade !== null) {
        const u = await tx.uma('SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ?', [
          t.unidade,
          est,
        ]);
        if (!u) throw recusa('unidade-inexistente', 'O setor da tarifa não existe neste estabelecimento.');
      }
      // Tarifa geral por hora (sem profissional, grupo, especialidade, faixa de horário ou tipo de dia): a que a tela usa.
      return tx.incluir('valor_hora_plantao', {
        estabelecimento_id: est,
        descricao: `Valor da hora do plantão ${t.tipo}`,
        setor_funcional_id: t.unidade,
        tipo_plantao: t.tipo,
        tipo_dia: 'todos',
        forma_pagamento: 'hora',
        valor_hora: t.valorHora,
        vigencia_inicio: t.inicio,
        vigencia_fim: t.fim,
      });
    },
    async encerrarTarifa(t) {
      const l = (
        await tx.consultarParaAtualizar(
          'SELECT versao, vigencia_inicio, vigencia_fim FROM valor_hora_plantao WHERE id = ? AND estabelecimento_id = ?',
          [t.id, est],
        )
      )[0];
      if (!l) throw recusa('tarifa-inexistente', 'A tarifa não existe neste estabelecimento.');
      const fimAtual = l['vigencia_fim'] === null ? null : dataIso(l['vigencia_fim']);
      if (t.fim < dataIso(l['vigencia_inicio']) || (fimAtual !== null && t.fim > fimAtual))
        throw recusa('vigencia-invalida', 'O fim fica antes do início da tarifa ou depois do fim atual.');
      await tx.alterar('valor_hora_plantao', t.id, num(l['versao']), { vigencia_fim: t.fim });
    },
    // O valor do aprovado é calculado na leitura (tarifa vigente no dia): não há aprovado "sem valor" a valorar.
    realizadosSemValor: async () => [],
    plantoesPorIds: (ids) => leitura.plantoesPorIds(tx, est, fuso, ids),
    valorarRealizado: async () => false,
    apuracaoRepasse: (comp) => leitura.apuracao(tx, est, comp),
    async estornarRealizado() {
      throw pendente('Estorno indisponível', MOTIVO_ESTORNO);
    },
    async ligarEstorno() {
      throw pendente('Estorno indisponível', MOTIVO_ESTORNO);
    },
    async desfazerEstorno() {
      throw pendente('Estorno indisponível', MOTIVO_ESTORNO);
    },
    estornoLancado: async () => null,
  };
}

export class PortaRealizadoPropria implements PortaRealizado {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoEscala,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoRealizado, fn: (l: Leitor, est: number, fuso: string) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c, 'pessoas-realizado'), async (l) =>
      fn(l, est, await fusoDe(l, est)),
    );
  }

  /** O lançamento no repasse (`repasse.lancarEvento`) aguarda o modelo; as ações da tela gravam. */
  async podeGravar(_c: ContextoRealizado, operacao: string): Promise<LiberacaoGravacao> {
    return operacao === 'repasse.lancarEvento'
      ? { pode: false, codigo: 'modelo-pendente', motivo: MOTIVO_LANCAMENTO }
      : { pode: true, codigo: null, motivo: null };
  }
  async executar(): Promise<GravacaoFeita> {
    throw pendente('Lançamento no repasse indisponível', MOTIVO_LANCAMENTO);
  }
  async gravarSgh<T>(
    c: ContextoRealizado,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorRealizado) => Promise<T>,
  ): Promise<T> {
    const evento = eventoDaTrilha(trilha);
    const acao = evento !== null ? ACOES_REALIZADO[evento] : undefined;
    if (!acao)
      throw new ErroOperacao(
        500,
        'acao-desconhecida',
        'Ação sem operação',
        `A ação ${evento ?? '(sem evento)'} do realizado não tem operação declarada.`,
      );
    return gravarPorAcao(this.executor, c, 'pessoas-realizado', acao, trilha, (tx, est, usuario, fuso, x) =>
      fn(gravadorSobre(tx, est, usuario, fuso, x)),
    );
  }

  relogio(c: ContextoRealizado): Promise<{ hoje: string; agora: string }> {
    return this.ler(c, async (_l, _e, fuso) => {
      const agora = civilDoUtc(new Date(), fuso);
      return { hoje: agora.slice(0, 10), agora };
    });
  }
  plantoes(
    c: ContextoRealizado,
    f: { readonly de: string; readonly ate: string; readonly unidade?: number },
  ): Promise<RegistroPlantaoParaRealizado[]> {
    return this.ler(c, async (l, est, fuso) => {
      const p: unknown[] = [
        est,
        utcDoCivil(`${f.de}T00:00`, fuso),
        utcDoCivil(`${proximoDia(f.ate)}T00:00`, fuso),
      ];
      if (f.unidade !== undefined) p.push(f.unidade);
      return (
        await l.consultar(
          `${SQL_PLANTAO} AND e.situacao IN ('publicada','fechada') AND p.inicio_em >= ? AND p.inicio_em < ?${
            f.unidade !== undefined ? ' AND e.setor_funcional_id = ?' : ''
          } ORDER BY p.inicio_em, p.id LIMIT 2000`,
          p,
        )
      ).map((r) => plantaoDe(r, fuso));
    });
  }
  plantao(c: ContextoRealizado, id: number): Promise<RegistroPlantaoParaRealizado | null> {
    return this.ler(c, (l, est, fuso) => leitura.plantao(l, est, fuso, id));
  }
  plantoesPorIds(c: ContextoRealizado, ids: readonly number[]): Promise<RegistroPlantaoParaRealizado[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.ler(c, (l, est, fuso) => leitura.plantoesPorIds(l, est, fuso, ids));
  }
  realizadosDosPlantoes(c: ContextoRealizado, plantoes: readonly number[]): Promise<RegistroRealizado[]> {
    if (plantoes.length === 0) return Promise.resolve([]);
    return this.ler(c, (l, est, fuso) =>
      leitura.realizados(l, est, fuso, `AND p.id IN (${marcas(plantoes.length)})`, [...plantoes]),
    );
  }
  /** Os aprovados com início real no período [de, ate] (datas civis do estabelecimento). */
  realizadosAprovados(c: ContextoRealizado, de: string, ate: string): Promise<RegistroRealizado[]> {
    return this.ler(c, (l, est, fuso) =>
      leitura.realizados(
        l,
        est,
        fuso,
        'AND p.aprovado = TRUE AND p.aprovado_em IS NOT NULL AND p.entrada_registrada_em >= ? AND p.entrada_registrada_em < ?',
        [utcDoCivil(`${dataIso(de)}T00:00`, fuso), utcDoCivil(`${proximoDia(ate)}T00:00`, fuso)],
      ),
    );
  }
  realizado(c: ContextoRealizado, id: number): Promise<RegistroRealizado | null> {
    return this.ler(
      c,
      async (l, est, fuso) => (await leitura.realizados(l, est, fuso, 'AND p.id = ?', [id]))[0] ?? null,
    );
  }
  tarifas(c: ContextoRealizado): Promise<RegistroTarifaPlantao[]> {
    return this.ler(c, (l, est) => leitura.tarifas(l, est));
  }
  /** O código do prestador por registro: o registro é o profissional, e o prestador do repasse é o próprio profissional. */
  codigosDosRegistros(c: ContextoRealizado, registros: readonly number[]): Promise<Map<number, number>> {
    if (registros.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l) => {
      const rs = await l.consultar(
        `SELECT id FROM profissional WHERE id IN (${marcas(registros.length)}) AND excluido_em IS NULL`,
        [...registros],
      );
      return new Map(rs.map((r) => [num(r['id']), num(r['id'])]));
    });
  }
  /** A apuração do repasse de plantão da competência ("AAAA-MM") no estabelecimento, ou null. */
  apuracaoRepasse(c: ContextoRealizado, competencia: string): Promise<{ id: number; estado: string } | null> {
    return this.ler(c, (l, est) => leitura.apuracao(l, est, competencia));
  }
}

function proximoDia(data: string): string {
  const d = new Date(`${dataIso(data)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
