// Porta do balanço hídrico sobre o banco do cliente (MariaDB, pelo @sgh/nucleo): o balanço do paciente por janela de
// 24 horas (balanco_hidrico_paciente, criado no primeiro lançamento da janela), os lançamentos de ganho e perda
// (balanco_lancamento, com o estorno como lançamento novo que aponta o estornado) e os fechamentos parcial e de 24
// horas (balanco_fechamento). As checagens que entram no balanço vêm dos horários administrados de itens que integram o
// balanço (tipo_item_prescricao.integra_balanco_hidrico); a diurese, a temperatura e o peso, das aferições.
// Toda leitura filtra o estabelecimento da sessão e os registros excluídos.
// Melhoria: o saldo do fechamento é conferido pelo banco (CHECK saldo = ganhos − perdas − insensíveis); o fechamento
// relê os lançamentos vigentes na transação e recusa se mudaram desde a tela; o estorno nunca altera o original.
// Melhoria: o balanço de 24 horas fechado é retrato: na transação, com o fechamento total travado, recusa o lançamento
// e o estorno na janela fechada ('janela-fechada') e o segundo fechamento total ('ja-fechado'), com os mesmos códigos
// da porta em memória (a tela também confere pelas janelas fechadas, conferirLancamento do domínio); o sinal importado
// no fechamento só vem de aferição deste estabelecimento e do paciente do balanço.
// O ganho da checagem entra no fechamento ligado ao horário da prescrição (balanco_lancamento.horario_administracao_id),
// uma vez só; o lançamento manual guarda a chave do ato (chave_ato) e o reenvio do mesmo pedido devolve o já gravado.
import type { DominiosBalanco, FechamentoBalancoLido, LancamentoBalancoLido } from '@sgh/contratos';
import { createHash } from 'node:crypto';
import { type Executor, type Leitor, recusa, type TxOperacao } from '@sgh/nucleo';
import { type LiberacaoGravacao, portaIndisponivel, type TrilhaDaGravacao } from '../exames/public-api.js';
import {
  booleano,
  civilDe,
  estabelecimentoDe,
  exigirProfissional,
  fusoDe,
  instanteDe,
  LOGIN_DE,
  marcadores,
  num,
  numOuNulo,
  texto,
  textoOuNulo,
} from './banco-apoio.js';
import {
  type ContextoBalanco,
  type GravadorBalanco,
  METODOS_PORTA_BALANCO,
  type PortaBalanco,
} from './balanco-porta.js';
import { afericaoDoSinal, gravacaoDireta } from './gravacao-direta.js';
import { letraDaSituacao } from './operacoes.js';
import type { PortaEnfermagem } from './porta.js';
import type { NucleoEnfermagem } from './porta-propria.js';
import type { ChecagemParaBalanco, Internado, PendenteDoFechamento, SinaisParaBalanco } from './tipos.js';

type Linha = Record<string, unknown>;

const TETO_LANCAMENTOS = 2_000;
const INTENSIDADES = [1, 2, 3, 4].map((n) => ({ codigo: n, nome: `${n}+` }));

const SQL_LANCAMENTOS = `
  SELECT l.id, l.sentido, l.fonte_lancamento, l.grupo_balanco_hidrico_id, v.codigo AS via, l.intensidade, l.aspecto,
         l.estimado, l.volume_ml, l.ocorrido_em, l.descricao, l.afericao_id, l.estornado_balanco_lancamento_id,
         l.motivo_estorno, l.registrado_sem_conexao, l.registrado_em, b.atendimento_id, l.horario_administracao_id,
         (SELECT e.id FROM balanco_lancamento e WHERE e.estornado_balanco_lancamento_id = l.id
           AND e.excluido_em IS NULL LIMIT 1) AS estornado_por,
         (SELECT av.id FROM afericao_valor av WHERE av.afericao_id = l.afericao_id AND av.excluido_em IS NULL
           ORDER BY av.sequencia LIMIT 1) AS sinal,
         ${LOGIN_DE('l.criado_por')} AS login
    FROM balanco_lancamento l
    JOIN balanco_hidrico_paciente b ON b.id = l.balanco_hidrico_paciente_id
    LEFT JOIN via_de_uso v ON v.id = l.via_de_uso_id
   WHERE b.estabelecimento_id = ? AND b.excluido_em IS NULL AND l.excluido_em IS NULL`;

function lancamentoDe(r: Linha, fuso: string): LancamentoBalancoLido & { readonly atendimento: number } {
  const sentido = r['sentido'] === 'perda' ? 'perda' : 'ganho';
  const grupo = numOuNulo(r['grupo_balanco_hidrico_id']);
  return {
    id: num(r['id']),
    sentido,
    origem:
      (['manual', 'checagem', 'sinal', 'estorno'] as const).find((o) => o === r['fonte_lancamento']) ??
      'manual',
    grupo: sentido === 'ganho' ? grupo : null,
    via: textoOuNulo(r['via']),
    tipoEliminacao: sentido === 'perda' ? grupo : null,
    intensidade: numOuNulo(r['intensidade']),
    aspecto: textoOuNulo(r['aspecto']),
    estimado: booleano(r['estimado']),
    volumeMl: num(r['volume_ml']),
    horaReal: (civilDe(r['ocorrido_em'], fuso) ?? '').slice(0, 16),
    descricao: textoOuNulo(r['descricao']),
    horario: numOuNulo(r['horario_administracao_id']),
    sinal: numOuNulo(r['sinal']),
    estornado: numOuNulo(r['estornado_balanco_lancamento_id']),
    estornadoPor: numOuNulo(r['estornado_por']),
    motivo: textoOuNulo(r['motivo_estorno']),
    origemOffline: booleano(r['registrado_sem_conexao']),
    usuario: texto(r['login']),
    gravadoEm: civilDe(r['registrado_em'], fuso) ?? '',
    atendimento: num(r['atendimento_id']),
  };
}

/** A chave do ato no banco (até 80 caracteres): a chave longa vira o seu resumo. */
const chaveDoAto = (chave: string) =>
  chave.length <= 80 ? chave : createHash('sha256').update(chave).digest('hex');

export class PortaBalancoPropria implements PortaBalanco {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoEnfermagem,
    private readonly enfermagem: PortaEnfermagem,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoBalanco, fn: (l: Leitor, est: number, fuso: string) => Promise<T>): Promise<T> {
    const est = estabelecimentoDe(c);
    return this.nucleo.lerSomente(
      {
        cliente: c.cliente,
        estabelecimento: c.estabelecimento,
        usuario: c.usuario,
        correlacao: c.correlacao || 'balanco',
      },
      async (l) => fn(l, est, await fusoDe(l, est)),
    );
  }

  async podeGravar(): Promise<LiberacaoGravacao> {
    // O balanço grava só por gravação direta (lançar, estornar e fechar), conferida pela liberação da tela.
    return { pode: false, codigo: 'operacao-desconhecida', motivo: 'O balanço não tem operação de receita.' };
  }

  async executar(): Promise<never> {
    throw recusa('operacao-desconhecida', 'O balanço grava pelos lançamentos e fechamentos.');
  }

  gravarSgh<T>(
    c: ContextoBalanco,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorBalanco) => Promise<T>,
  ): Promise<T> {
    return gravacaoDireta(this.executor, c, {
      nome: 'enfermagem.balanco.gravacao',
      tabelas: ['balanco_hidrico_paciente', 'balanco_lancamento', 'balanco_fechamento'],
      trilha,
      gravador: (tx, est) => gravadorBalanco(tx, est),
      fn,
    });
  }

  relogio(c: ContextoBalanco): Promise<string> {
    return this.enfermagem.relogio(c);
  }

  internado(c: ContextoBalanco, atendimento: number): Promise<Internado | null> {
    return this.enfermagem.internado(c, atendimento);
  }

  entrada(c: ContextoBalanco, atendimento: number): Promise<string | null> {
    return this.ler(c, async (l, est, fuso) => {
      const r = await l.uma(
        'SELECT entrada_em FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [atendimento, est],
      );
      return r ? (civilDe(r['entrada_em'], fuso) ?? '').slice(0, 16) || null : null;
    });
  }

  dominios(c: ContextoBalanco): Promise<DominiosBalanco> {
    return this.ler(c, async (l) => {
      // Os cadastros do balanço e as vias são da rede inteira (domínios sem estabelecimento).
      const grupos = await l.consultar(
        "SELECT id, descricao, tipo, ativo FROM grupo_balanco_hidrico WHERE tipo IN ('ganho', 'perda') ORDER BY ordem, id",
      );
      const tipos = await l.consultar(
        'SELECT parcial FROM tipo_fechamento_balanco WHERE ativo ORDER BY parcial DESC, id',
      );
      const vias = await l.consultar(
        'SELECT codigo, descricao FROM via_de_uso WHERE ativo ORDER BY ordem, descricao',
      );
      return {
        grupos: grupos
          .filter((g) => g['tipo'] === 'ganho' && booleano(g['ativo']))
          .map((g) => ({ codigo: num(g['id']), nome: texto(g['descricao']) })),
        tiposEliminacao: grupos
          .filter((g) => g['tipo'] === 'perda')
          .map((g) => ({
            codigo: num(g['id']),
            nome: texto(g['descricao']),
            ativo: booleano(g['ativo']),
            pedeIntensidade: false,
            aceitaEstimado: true,
            pedeAspecto: false,
          })),
        intensidades: INTENSIDADES,
        tiposFechamento: [...new Set(tipos.map((t) => (booleano(t['parcial']) ? 1 : 2)))].map((codigo) => ({
          codigo,
          nome: codigo === 1 ? 'Parcial' : '24 horas',
        })),
        vias: vias.map((v) => ({ codigo: texto(v['codigo']), nome: texto(v['descricao']) })),
      };
    });
  }

  checagens(
    c: ContextoBalanco,
    o: { atendimento: number; de: string; ate: string },
  ): Promise<{ itens: ChecagemParaBalanco[]; cortada: boolean }> {
    return this.ler(c, async (l, est, fuso) => {
      const rs = await l.consultar(
        `SELECT h.id, t.categoria AS tipo, sc.categoria, h.suspenso, pi.descricao, pm.dose, up.sigla, v.sigla AS via,
                h.situacao_checagem_em, h.administrado_em, h.quantidade_administrada
           FROM horario_administracao h
           JOIN situacao_checagem sc ON sc.id = h.situacao_checagem_id
           JOIN prescricao_item pi ON pi.id = h.prescricao_item_id
           JOIN tipo_item_prescricao t ON t.id = pi.tipo_item_prescricao_id AND t.integra_balanco_hidrico
           LEFT JOIN prescricao_item_medicamento pm ON pm.prescricao_item_id = pi.id AND pm.excluido_em IS NULL
           LEFT JOIN unidade_prescricao up ON up.id = COALESCE(pm.unidade_prescricao_id, pi.unidade_prescricao_id)
           LEFT JOIN via_de_uso v ON v.id = pi.via_de_uso_id
          WHERE h.estabelecimento_id = ? AND h.excluido_em IS NULL AND h.atendimento_id = ?
            AND sc.categoria IN ('administrado', 'administrado_parcial')
            AND h.administrado_em >= ? AND h.administrado_em < ?
          ORDER BY h.administrado_em, h.id LIMIT ?`,
        [est, o.atendimento, instanteDe(o.de, fuso), instanteDe(o.ate, fuso), TETO_LANCAMENTOS + 1],
      );
      return {
        itens: rs.slice(0, TETO_LANCAMENTOS).map((r) => ({
          horario: num(r['id']),
          tipo: texto(r['tipo']),
          situacao: letraDaSituacao(r['categoria'], r['suspenso']),
          descricao: texto(r['descricao']),
          dose: numOuNulo(r['dose']),
          unidadeDose: textoOuNulo(r['sigla']),
          via: textoOuNulo(r['via']),
          checadoEm: civilDe(r['situacao_checagem_em'], fuso),
          horaReal: civilDe(r['administrado_em'], fuso),
          quantidade: numOuNulo(r['quantidade_administrada']),
          volumeInfundidoMl: null,
        })),
        cortada: rs.length > TETO_LANCAMENTOS,
      };
    });
  }

  lancamentos(
    c: ContextoBalanco,
    o: { atendimento: number; de: string; ate: string },
  ): Promise<{ itens: LancamentoBalancoLido[]; cortada: boolean }> {
    return this.ler(c, async (l, est, fuso) => {
      const rs = await l.consultar(
        `${SQL_LANCAMENTOS} AND b.atendimento_id = ? AND l.ocorrido_em >= ? AND l.ocorrido_em < ?
          ORDER BY l.ocorrido_em, l.id LIMIT ?`,
        [est, o.atendimento, instanteDe(o.de, fuso), instanteDe(o.ate, fuso), TETO_LANCAMENTOS + 1],
      );
      return {
        itens: rs.slice(0, TETO_LANCAMENTOS).map((r) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars -- descarta o atendimento do lançamento
          const { atendimento: _a, ...x } = lancamentoDe(r, fuso);
          return x;
        }),
        cortada: rs.length > TETO_LANCAMENTOS,
      };
    });
  }

  lancamento(c: ContextoBalanco, id: number) {
    return this.ler(c, async (l, est, fuso) => {
      const r = await l.uma(`${SQL_LANCAMENTOS} AND l.id = ?`, [est, id]);
      return r ? lancamentoDe(r, fuso) : null;
    });
  }

  origensLancadas(
    c: ContextoBalanco,
    o: { horarios: readonly number[]; sinais: readonly number[] },
  ): Promise<{ horarios: Set<number>; sinais: Set<number> }> {
    if (o.sinais.length === 0) return Promise.resolve({ horarios: new Set(), sinais: new Set() });
    return this.ler(c, async (l, est) => {
      const rs = await l.consultar(
        `SELECT av.id FROM afericao_valor av
           JOIN balanco_lancamento bl ON bl.afericao_id = av.afericao_id AND bl.excluido_em IS NULL
           JOIN balanco_hidrico_paciente b ON b.id = bl.balanco_hidrico_paciente_id AND b.estabelecimento_id = ?
          WHERE av.id IN (${marcadores(o.sinais.length)})`,
        [est, ...o.sinais],
      );
      return { horarios: new Set(), sinais: new Set(rs.map((r) => num(r['id']))) };
    });
  }

  fechamentos(c: ContextoBalanco, atendimento: number): Promise<FechamentoBalancoLido[]> {
    return this.ler(c, async (l, est, fuso) => {
      const rs = await l.consultar(
        `SELECT f.id, f.tipo, f.inicio_em, f.fim_em, f.fechado_em, f.total_ganhos_ml, f.total_perdas_ml,
                f.perda_insensivel_ml, f.saldo_ml, f.formula_perda_insensivel, f.peso_kg, b.hora_fechamento,
                ${LOGIN_DE('f.criado_por')} AS login,
                (SELECT COUNT(*) FROM balanco_lancamento x WHERE x.balanco_hidrico_paciente_id = b.id
                  AND x.excluido_em IS NULL AND x.ocorrido_em >= f.inicio_em AND x.ocorrido_em <= f.fim_em) AS lancamentos,
                (SELECT COALESCE(SUM(x.volume_ml), 0) FROM balanco_lancamento x
                   JOIN afericao_valor av ON av.afericao_id = x.afericao_id
                   JOIN parametro_vital pv ON pv.id = av.parametro_vital_id AND pv.codigo = 'diurese'
                  WHERE x.balanco_hidrico_paciente_id = b.id AND x.excluido_em IS NULL AND x.fonte_lancamento = 'sinal'
                    AND x.ocorrido_em >= f.inicio_em AND x.ocorrido_em <= f.fim_em) AS diurese
           FROM balanco_fechamento f
           JOIN balanco_hidrico_paciente b ON b.id = f.balanco_hidrico_paciente_id
          WHERE b.estabelecimento_id = ? AND b.atendimento_id = ? AND b.excluido_em IS NULL AND f.excluido_em IS NULL
            AND f.situacao = 'valido'
          ORDER BY f.fim_em DESC, f.id DESC LIMIT 200`,
        [est, atendimento],
      );
      return rs.map((r) => {
        const diurese = num(r['diurese']);
        const peso = numOuNulo(r['peso_kg']);
        const horas =
          (new Date(r['fim_em'] as Date).getTime() - new Date(r['inicio_em'] as Date).getTime()) / 3_600_000;
        const debito = peso && horas > 0 ? Math.round((diurese / peso / horas) * 100) / 100 : null;
        return {
          id: num(r['id']),
          tipo: r['tipo'] === 'total' ? ('total' as const) : ('parcial' as const),
          inicio: (civilDe(r['inicio_em'], fuso) ?? '').slice(0, 16),
          fim: (civilDe(r['fim_em'], fuso) ?? '').slice(0, 16),
          horaCorte: texto(r['hora_fechamento']).slice(0, 5),
          ganhosMl: num(r['total_ganhos_ml']),
          perdasMl: num(r['total_perdas_ml']),
          insensiveisMl: num(r['perda_insensivel_ml']),
          saldoMl: num(r['saldo_ml']),
          diureseMl: diurese,
          pesoKg: peso,
          debitoUrinario: debito,
          oliguria: debito !== null && debito < 0.5,
          formula: texto(r['formula_perda_insensivel']),
          lancamentos: num(r['lancamentos']),
          parcelas: '',
          usuario: texto(r['login']),
          gravadoEm: civilDe(r['fechado_em'], fuso) ?? '',
        };
      });
    });
  }

  sinais(c: ContextoBalanco, o: { paciente: number; de: string; ate: string }): Promise<SinaisParaBalanco> {
    return this.ler(c, async (l, est, fuso) => {
      const rs = await l.consultar(
        `SELECT v.id, pv.codigo, v.valor_numerico, a.aferido_em
           FROM afericao a
           JOIN afericao_valor v ON v.afericao_id = a.id AND v.excluido_em IS NULL AND NOT v.nao_aferido
           JOIN parametro_vital pv ON pv.id = v.parametro_vital_id AND pv.codigo IN ('diurese', 'temperatura', 'peso')
          WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.paciente_id = ?
            AND a.aferido_em >= ? AND a.aferido_em < ?
          ORDER BY a.aferido_em, v.id LIMIT 5000`,
        [est, o.paciente, instanteDe(o.de, fuso), instanteDe(o.ate, fuso)],
      );
      const diurese = rs
        .filter((r) => r['codigo'] === 'diurese')
        .map((r) => ({
          id: num(r['id']),
          valor: num(r['valor_numerico']),
          horaReal: (civilDe(r['aferido_em'], fuso) ?? '').slice(0, 16),
        }));
      const temps = rs.filter((r) => r['codigo'] === 'temperatura').map((r) => num(r['valor_numerico']));
      const pesos = rs.filter((r) => r['codigo'] === 'peso');
      const ultimoPeso = pesos.at(-1);
      return {
        diurese,
        temperaturaMaxima: temps.length ? Math.max(...temps) : null,
        peso: ultimoPeso
          ? {
              valor: num(ultimoPeso['valor_numerico']),
              quando: (civilDe(ultimoPeso['aferido_em'], fuso) ?? '').slice(0, 16),
            }
          : null,
      };
    });
  }
}

/** O gravador do balanço sobre a transação do Executor. */
function gravadorBalanco(tx: TxOperacao, est: number): GravadorBalanco {
  const fusoP = fusoDe(tx, est);
  /** O balanço da janela de 24 horas do atendimento (criado no primeiro lançamento da janela). */
  const balancoDaJanela = async (
    atendimento: number,
    paciente: number,
    janelaInicio: string,
  ): Promise<number> => {
    const fuso = await fusoP;
    const inicio = instanteDe(janelaInicio, fuso);
    // O balanço da janela que contém o início (ou o do mesmo dia de referência: um por atendimento e dia).
    const [b] = await tx.consultarParaAtualizar<{ id: number }>(
      `SELECT id FROM balanco_hidrico_paciente
        WHERE estabelecimento_id = ? AND atendimento_id = ? AND excluido_em IS NULL
          AND ((inicio_janela_em <= ? AND fim_janela_em > ?) OR data_referencia = ?)
        ORDER BY inicio_janela_em DESC LIMIT 1`,
      [est, atendimento, inicio, inicio, janelaInicio.slice(0, 10)],
    );
    if (b) return Number(b.id);
    const setor = await tx.uma<{ setor_funcional_id: number | null }>(
      `SELECT u.setor_funcional_id FROM ocupacao_leito o JOIN internacao i ON i.id = o.internacao_id
         JOIN unidade_internacao u ON u.id = o.unidade_internacao_id
        WHERE i.atendimento_id = ? AND o.estabelecimento_id = ? AND o.excluido_em IS NULL
        ORDER BY o.data_hora_fim IS NULL DESC, o.data_hora_inicio DESC LIMIT 1`,
      [atendimento, est],
    );
    const setorId =
      setor?.setor_funcional_id ??
      (
        await tx.uma<{ setor_funcional_id: number | null }>(
          'SELECT setor_funcional_id FROM atendimento WHERE id = ? AND estabelecimento_id = ?',
          [atendimento, est],
        )
      )?.setor_funcional_id ??
      null;
    if (setorId === null)
      throw recusa(
        'cadastro-incompleto',
        'O atendimento não tem o setor (leito ou setor do atendimento) para o balanço.',
      );
    return tx.incluir('balanco_hidrico_paciente', {
      estabelecimento_id: est,
      atendimento_id: atendimento,
      paciente_id: paciente,
      setor_funcional_id: Number(setorId),
      data_referencia: janelaInicio.slice(0, 10),
      inicio_janela_em: inicio,
      fim_janela_em: new Date(inicio.getTime() + 24 * 3_600_000),
      hora_fechamento: `${janelaInicio.slice(11, 16)}:00`,
    });
  };
  /** O fechamento de 24 horas válido do balanço da janela, travado na transação (nulo se a janela está aberta). */
  const fechamentoTotal = async (balanco: number) => {
    const [f] = await tx.consultarParaAtualizar<{ id: number }>(
      `SELECT id FROM balanco_fechamento
        WHERE balanco_hidrico_paciente_id = ? AND tipo = 'total' AND situacao = 'valido' AND excluido_em IS NULL
        ORDER BY id LIMIT 1`,
      [balanco],
    );
    return f ? Number(f.id) : null;
  };
  const viaId = async (via: string | null) => {
    if (!via) return null;
    const v = await tx.uma<{ id: number }>('SELECT id FROM via_de_uso WHERE codigo = ?', [via]);
    if (!v) throw recusa('via-inexistente', 'A via informada não está no cadastro.');
    return Number(v.id);
  };
  /**
   * O ganho de um horário checado (administrado) entra no balanço uma vez só: o horário tem de ser do atendimento, estar
   * administrado e não ter lançamento vigente (não estornado) ligado a ele; senão a tela mudou e o fechamento recusa.
   */
  const ganhoDaChecagem = async (
    p: PendenteDoFechamento,
    o: { balanco: number; paciente: number; profissional: number; fuso: string },
  ) => {
    const { balanco, paciente, profissional, fuso } = o;
    const [h] = await tx.consultarParaAtualizar<Linha>(
      `SELECT h.id, h.prescricao_item_id, pi.via_de_uso_id, pi.item_prescritivel_id,
              (SELECT COUNT(*) FROM balanco_lancamento l
                WHERE l.horario_administracao_id = h.id AND l.excluido_em IS NULL AND l.fonte_lancamento <> 'estorno'
                  AND NOT EXISTS (SELECT 1 FROM balanco_lancamento e WHERE e.estornado_balanco_lancamento_id = l.id
                                   AND e.excluido_em IS NULL)) AS ja
         FROM horario_administracao h
         JOIN situacao_checagem sc ON sc.id = h.situacao_checagem_id
         JOIN prescricao_item pi ON pi.id = h.prescricao_item_id
         JOIN atendimento a ON a.id = h.atendimento_id
        WHERE h.id = ? AND h.estabelecimento_id = ? AND h.excluido_em IS NULL AND a.paciente_id = ?
          AND sc.categoria IN ('administrado', 'administrado_parcial')`,
      [p.referencia, est, paciente],
    );
    if (!h || num(h['ja']) > 0)
      throw recusa(
        'balanco-mudou',
        'Um ganho da checagem já entrou no balanço ou deixou de estar administrado: confira e feche de novo.',
      );
    return tx.incluir('balanco_lancamento', {
      balanco_hidrico_paciente_id: balanco,
      sentido: 'ganho',
      grupo_balanco_hidrico_id: p.grupo,
      via_de_uso_id: p.via ? await viaId(p.via) : numOuNulo(h['via_de_uso_id']),
      item_prescritivel_id: numOuNulo(h['item_prescritivel_id']),
      prescricao_item_id: num(h['prescricao_item_id']),
      horario_administracao_id: num(h['id']),
      volume_ml: p.volumeMl,
      descricao: p.descricao.slice(0, 120),
      ocorrido_em: instanteDe(p.horaReal, fuso),
      registrado_em: new Date(),
      fonte_lancamento: 'checagem',
      profissional_id: profissional,
    });
  };
  return {
    async lancar(x) {
      const profissional = await exigirProfissional(tx, tx.contexto, est);
      const chave = x.chave ? chaveDoAto(x.chave) : null;
      if (chave) {
        const [ja] = await tx.consultarParaAtualizar<Linha>(
          `SELECT l.id, l.profissional_id, b.atendimento_id FROM balanco_lancamento l
             JOIN balanco_hidrico_paciente b ON b.id = l.balanco_hidrico_paciente_id
            WHERE b.estabelecimento_id = ? AND l.chave_ato = ? AND l.excluido_em IS NULL
            LIMIT 1`,
          [est, chave],
        );
        if (
          ja &&
          (num(ja['atendimento_id']) !== x.atendimento || num(ja['profissional_id']) !== profissional)
        )
          throw recusa(
            'chave-reutilizada',
            'A chave deste pedido já foi usada em outro lançamento: refaça o lançamento na tela.',
          );
        if (ja) return { id: num(ja['id']), repetida: true };
      }
      const balanco = await balancoDaJanela(x.atendimento, x.paciente, x.janelaInicio);
      if ((await fechamentoTotal(balanco)) !== null)
        throw recusa(
          'janela-fechada',
          'O balanço de 24 horas desta hora já foi fechado: o lançamento não entra mais nele.',
        );
      const id = await tx.incluir('balanco_lancamento', {
        balanco_hidrico_paciente_id: balanco,
        sentido: x.sentido,
        grupo_balanco_hidrico_id: x.sentido === 'ganho' ? x.grupo : x.tipoEliminacao,
        via_de_uso_id: await viaId(x.via),
        intensidade: x.intensidade,
        aspecto: x.aspecto,
        estimado: x.estimado,
        volume_ml: x.volumeMl,
        descricao: x.descricao,
        ocorrido_em: instanteDe(x.horaReal, await fusoP),
        registrado_em: new Date(),
        fonte_lancamento: 'manual',
        registrado_sem_conexao: x.origemOffline,
        profissional_id: profissional,
        chave_ato: chave,
      });
      return { id, repetida: false };
    },
    async estornar(x) {
      const profissional = await exigirProfissional(tx, tx.contexto, est);
      const [o] = await tx.consultarParaAtualizar<Linha>(
        `SELECT l.id, l.balanco_hidrico_paciente_id, l.sentido, l.grupo_balanco_hidrico_id, l.volume_ml, l.ocorrido_em,
                l.fonte_lancamento, b.atendimento_id,
                (SELECT COUNT(*) FROM balanco_lancamento e WHERE e.estornado_balanco_lancamento_id = l.id
                  AND e.excluido_em IS NULL) AS estornos
           FROM balanco_lancamento l JOIN balanco_hidrico_paciente b ON b.id = l.balanco_hidrico_paciente_id
          WHERE l.id = ? AND b.estabelecimento_id = ? AND l.excluido_em IS NULL`,
        [x.id, est],
      );
      if (!o || num(o['atendimento_id']) !== x.atendimento)
        throw recusa('nao-encontrado', 'O lançamento não foi encontrado neste atendimento.');
      if (o['fonte_lancamento'] === 'estorno')
        throw recusa('estorno-de-estorno', 'Um estorno não se estorna.');
      if (num(o['estornos']) > 0) throw recusa('ja-estornado', 'O lançamento já foi estornado.');
      if ((await fechamentoTotal(num(o['balanco_hidrico_paciente_id']))) !== null)
        throw recusa(
          'janela-fechada',
          'O balanço de 24 horas deste lançamento já foi fechado: o lançamento não se estorna mais.',
        );
      return tx.incluir('balanco_lancamento', {
        balanco_hidrico_paciente_id: num(o['balanco_hidrico_paciente_id']),
        sentido: texto(o['sentido']),
        grupo_balanco_hidrico_id: numOuNulo(o['grupo_balanco_hidrico_id']),
        volume_ml: num(o['volume_ml']),
        ocorrido_em: o['ocorrido_em'],
        registrado_em: new Date(),
        fonte_lancamento: 'estorno',
        estornado_balanco_lancamento_id: x.id,
        motivo_estorno: x.motivo.slice(0, 200),
        profissional_id: profissional,
      });
    },
    async fechar(f) {
      const profissional = await exigirProfissional(tx, tx.contexto, est);
      const fuso = await fusoP;
      const inicio = instanteDe(f.inicio, fuso);
      const fim = instanteDe(f.fim, fuso);
      const balanco = await balancoDaJanela(f.atendimento, f.paciente, f.inicio);
      if (f.tipo === 'total' && (await fechamentoTotal(balanco)) !== null)
        throw recusa('ja-fechado', 'O balanço de 24 horas desta janela já foi fechado.');
      // Os lançamentos vigentes da janela, relidos na transação: diferentes dos que a tela viu, recusa.
      const vigentes = await tx.consultarParaAtualizar<{ id: number }>(
        `SELECT l.id FROM balanco_lancamento l JOIN balanco_hidrico_paciente b ON b.id = l.balanco_hidrico_paciente_id
          WHERE b.estabelecimento_id = ? AND b.atendimento_id = ? AND l.excluido_em IS NULL
            AND l.fonte_lancamento <> 'estorno'
            AND NOT EXISTS (SELECT 1 FROM balanco_lancamento e WHERE e.estornado_balanco_lancamento_id = l.id
                             AND e.excluido_em IS NULL)
            AND l.ocorrido_em >= ? AND (l.ocorrido_em < ? OR (? AND l.ocorrido_em = ?))`,
        [est, f.atendimento, inicio, fim, f.fimInclusivo === true, fim],
      );
      const vistos = new Set(f.lancamentosVistos);
      if (vigentes.length !== vistos.size || vigentes.some((v) => !vistos.has(Number(v.id))))
        throw recusa(
          'balanco-mudou',
          'Os lançamentos mudaram desde que a tela foi aberta: confira e feche de novo.',
        );
      const importados: number[] = [];
      for (const p of f.pendentes) {
        if (p.origem === 'checagem') {
          importados.push(await ganhoDaChecagem(p, { balanco, paciente: f.paciente, profissional, fuso }));
          continue;
        }
        const afericao = await afericaoDoSinal(tx, est, p.referencia, f.paciente);
        importados.push(
          await tx.incluir('balanco_lancamento', {
            balanco_hidrico_paciente_id: balanco,
            sentido: p.sentido,
            grupo_balanco_hidrico_id: p.sentido === 'ganho' ? p.grupo : p.tipoEliminacao,
            afericao_id: afericao,
            volume_ml: p.volumeMl,
            descricao: p.descricao.slice(0, 120),
            ocorrido_em: instanteDe(p.horaReal, fuso),
            registrado_em: new Date(),
            fonte_lancamento: 'sinal',
            profissional_id: profissional,
          }),
        );
      }
      const id = await tx.incluir('balanco_fechamento', {
        balanco_hidrico_paciente_id: balanco,
        tipo: f.tipo,
        inicio_em: inicio,
        fim_em: fim,
        fechado_em: new Date(),
        total_ganhos_ml: f.ganhosMl,
        total_perdas_ml: f.perdasMl,
        perda_insensivel_ml: f.insensiveisMl,
        saldo_ml: f.saldoMl,
        formula_perda_insensivel: f.formula.slice(0, 30) || 'nenhuma',
        peso_kg: f.pesoKg,
        profissional_id: profissional,
      });
      return { id, importados };
    },
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaBalancoIndisponivel(): PortaBalanco {
  return portaIndisponivel<PortaBalanco>(METODOS_PORTA_BALANCO);
}
