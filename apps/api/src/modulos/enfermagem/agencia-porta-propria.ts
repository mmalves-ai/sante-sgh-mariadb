// Porta da agência transfusional (imuno-hematologia, prova cruzada e estoque de bolsas) sobre o banco do cliente
// (MariaDB, pelo @sgh/nucleo): os exames do receptor em teste_imuno_hematologico (tipagem ABO e Rh, pesquisa de
// anticorpos irregulares e prova cruzada, com as leituras em JSON), as bolsas em bolsa_hemocomponente e o histórico da
// bolsa em movimento_bolsa (só inclusão). Toda leitura filtra o estabelecimento da sessão e os excluídos; os cadastros
// de grupo sanguíneo, fator Rh, hemocomponente e tipos são da rede inteira.
// Melhoria: a liberação do resultado é de outro profissional (recusa quem registrou); a bolsa repetida (número e
// hemocomponente no estabelecimento) é recusada pelo banco (UNIQUE); a trava otimista da bolsa pela versão; o
// fornecedor da bolsa é o serviço cadastrado (nada de nome livre).
// Melhoria: a prova cruzada só é compatível com o resultado negativo gravado; sem resultado ou inconclusiva, não conta
// como compatível (nunca libera a transfusão na dúvida). O exame com requisição só vale para a requisição deste
// estabelecimento e do mesmo paciente; a ordem do exame do paciente sai com o paciente travado (sem corrida).
// Melhoria: a correção da bolsa nunca apaga o antes: cada correção é um movimento_bolsa de alteração com a versão
// anterior (número, tipagem, validade e volume) e o motivo, lido em versoesBolsa; a observação da bolsa não muda.
// O motivo da invalidação do exame vai à trilha da gravação (lido dela) até a coluna do pedido existir.
// Dado da rede inteira: a tipagem ABO/Rh e a pesquisa de anticorpos do paciente sem requisição valem para o paciente
// em qualquer estabelecimento do cliente (a segurança transfusional pede o histórico do receptor); a liberação e a
// invalidação desse exame ficam com o estabelecimento que o registrou (o da trilha da inclusão).
// Pendências de modelo (pedido do lote 02-04): o exame do laboratório lançado na conta (examesLancados lê vazio); a
// prova cruzada na tabela própria prova_compatibilidade (receptor, amostra e bolsa com FK), no lugar do número da
// bolsa no JSON das leituras; o motivo da invalidação em coluna; a natureza 'correcao' no tipo de movimento.
import {
  type BolsaEstoqueLida,
  type CadastrosDoEstoque,
  classeDoHemocomponente,
  type EstadoImuno,
  type ExameImunoLancado,
  type FatorRh,
  type FiltroEstoque,
  type GrupoAbo,
  type ImunoHematologiaLida,
  type MovimentoBolsaLido,
  type ProvaCruzadaResumo,
  type ResultadoImunoResumo,
  type SituacaoBolsaEstoque,
  TIPO_DO_MOVIMENTO,
  TRANSICOES_BOLSA,
  type TipoExameImuno,
  type TipoMovimentoBolsa,
  type VersaoBolsaLida,
} from '@sgh/contratos';
import { type Executor, type Leitor, recusa, restricaoUnicaViolada, type TxOperacao } from '@sgh/nucleo';
import { type LiberacaoGravacao, portaIndisponivel, type TrilhaDaGravacao } from '../exames/public-api.js';
import {
  type ContextoAgencia,
  type FiltroImunoPorta,
  type GravadorAgencia,
  METODOS_PORTA_AGENCIA,
  type PortaAgencia,
} from './agencia-porta.js';
import {
  booleano,
  civilDe,
  estabelecimentoDe,
  exigirProfissional,
  fusoDe,
  instanteDe,
  LOGIN_DE,
  num,
  numOuNulo,
  texto,
  textoOuNulo,
} from './banco-apoio.js';
import { type AnotacaoGravacao, gravacaoDireta } from './gravacao-direta.js';
import type { NucleoEnfermagem } from './porta-propria.js';

type Linha = Record<string, unknown>;

const TETO = 500;
/** Código do tipo de teste no cadastro (tipo_teste_imuno_hematologico.codigo) por tipo de exame da tela. */
const CODIGO_TESTE: Readonly<Record<TipoExameImuno, string>> = {
  aboRh: 'abo_rh',
  pai: 'pai',
  provaCruzada: 'prova_cruzada',
};
const TIPO_DO_CODIGO = new Map(Object.entries(CODIGO_TESTE).map(([k, v]) => [v, k as TipoExameImuno]));
const METODO: Readonly<Record<string, string>> = {
  gelTeste: 'gel_teste',
  tubo: 'tubo',
  microplaca: 'microplaca',
};
const METODO_DA_TELA = new Map(Object.entries(METODO).map(([k, v]) => [v, k]));
/** Natureza do tipo de movimento (cadastro) por tipo de movimento da tela. */
const NATUREZA: Readonly<Record<TipoMovimentoBolsa, string>> = {
  recebimento: 'entrada',
  liberacao: 'liberacao',
  bloqueio: 'bloqueio',
  reserva: 'reserva',
  cancelamentoReserva: 'desbloqueio',
  descarte: 'descarte',
  devolucao: 'devolucao',
  transfusao: 'transfusao',
};

function lerJson(v: unknown): Record<string, unknown> {
  if (v === null || v === undefined) return {};
  if (typeof v === 'object') return v as Record<string, unknown>;
  try {
    return JSON.parse(String(v)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const SQL_IMUNO = `
  SELECT t.id, tt.codigo AS tipo, t.situacao, t.paciente_id, t.requisicao_transfusao_id, t.metodo, t.forma_entrada,
         gs.sigla AS abo, fr.sinal AS rh, t.resultado, t.resultado_texto, t.leituras, t.observacao, t.realizado_em,
         t.liberado_em, ${LOGIN_DE('t.criado_por')} AS registrado_por,
         COALESCE(t.motivo_invalidacao, (SELECT ta.motivo FROM trilha_auditoria ta WHERE ta.entidade = 'teste_imuno_hematologico'
           AND ta.entidade_id = t.id AND ta.motivo IS NOT NULL ORDER BY ta.id DESC LIMIT 1)) AS motivo_invalidacao,
         (SELECT us.login FROM usuario_vinculo_profissional v JOIN usuario us ON us.id = v.usuario_id
           WHERE v.profissional_id = t.liberado_por_profissional_id AND v.excluido_em IS NULL
           ORDER BY v.vigencia_inicio DESC LIMIT 1) AS liberado_por
    FROM teste_imuno_hematologico t
    JOIN tipo_teste_imuno_hematologico tt ON tt.id = t.tipo_teste_imuno_hematologico_id
    JOIN paciente p ON p.id = t.paciente_id
    LEFT JOIN grupo_sanguineo gs ON gs.id = t.grupo_sanguineo_id
    LEFT JOIN fator_rh fr ON fr.id = t.fator_rh_id
   WHERE t.excluido_em IS NULL AND (t.requisicao_transfusao_id IS NULL OR EXISTS (
         SELECT 1 FROM requisicao_transfusao r WHERE r.id = t.requisicao_transfusao_id AND r.estabelecimento_id = ?))`;
// O exame sem requisição é do paciente, para a rede inteira (ver o cabeçalho); com requisição, só a deste estabelecimento.

/** A prova cruzada pelo resultado gravado: negativo é compatível, positivo é incompatível; o resto não tem resultado. */
export function provaCruzadaDoResultado(resultado: unknown): 'compativel' | 'incompativel' | null {
  return resultado === 'negativo' ? 'compativel' : resultado === 'positivo' ? 'incompativel' : null;
}

const SQL_BOLSA = `
  SELECT b.id, b.numero, h.sigla AS hemocomponente, h.descricao AS hemocomponente_nome, gs.sigla AS abo, fr.sinal AS rh,
         b.volume_ml, b.validade_em, b.situacao, f.nome AS fornecedor, b.local_guarda_hemocomponente_id, b.irradiada,
         b.leucorreduzida, b.temperatura_recebimento_c, b.inspecao_aprovada, b.reservada_requisicao_transfusao_id,
         r.paciente_id AS reservada_paciente, b.recebida_em, ${LOGIN_DE('b.recebida_por_usuario_id')} AS recebida_por,
         b.versao
    FROM bolsa_hemocomponente b
    JOIN hemocomponente h ON h.id = b.hemocomponente_id
    JOIN grupo_sanguineo gs ON gs.id = b.grupo_sanguineo_id
    JOIN fator_rh fr ON fr.id = b.fator_rh_id
    LEFT JOIN servico_hemoterapia_fornecedor f ON f.id = b.servico_hemoterapia_fornecedor_id
    LEFT JOIN requisicao_transfusao r ON r.id = b.reservada_requisicao_transfusao_id
   WHERE b.estabelecimento_id = ? AND b.excluido_em IS NULL`;

const rhDoSinal = (s: unknown): FatorRh | null => (s === '+' ? 'positivo' : s === '-' ? 'negativo' : null);
const rhGravado = (s: unknown): FatorRh | null => (s === 'positivo' || s === 'negativo' ? s : null);
const aboDe = (s: unknown): GrupoAbo | null =>
  ['A', 'B', 'AB', 'O'].includes(texto(s)) ? (texto(s) as GrupoAbo) : null;

function imunoDe(r: Linha, fuso: string): ImunoHematologiaLida {
  const d = lerJson(r['leituras']);
  const tipo = TIPO_DO_CODIGO.get(texto(r['tipo'])) ?? 'aboRh';
  const abo = aboDe(r['abo']);
  const rh = rhDoSinal(r['rh']);
  return {
    id: num(r['id']),
    tipo,
    estado: (['registrado', 'liberado', 'invalidado'].includes(texto(r['situacao']))
      ? texto(r['situacao'])
      : 'registrado') as EstadoImuno,
    paciente: num(r['paciente_id']),
    requisicao: numOuNulo(r['requisicao_transfusao_id']),
    amostra: null,
    metodo: (METODO_DA_TELA.get(texto(r['metodo'])) ?? 'gelTeste') as ImunoHematologiaLida['metodo'],
    origem: r['forma_entrada'] === 'interface' ? 'equipamento' : 'digitado',
    tipagem: tipo === 'aboRh' ? { abo, rh } : null,
    direta: (d['direta'] as ImunoHematologiaLida['direta']) ?? null,
    reversa: (d['reversa'] as ImunoHematologiaLida['reversa']) ?? null,
    pai: tipo === 'pai' ? (r['resultado'] === 'positivo' ? 'positivo' : 'negativo') : null,
    anticorpos: tipo === 'pai' ? textoOuNulo(r['resultado_texto']) : null,
    bolsa: tipo === 'provaCruzada' ? textoOuNulo(d['bolsa']) : null,
    provaCruzada: tipo === 'provaCruzada' ? provaCruzadaDoResultado(r['resultado']) : null,
    faseAntiglobulina: tipo === 'provaCruzada' ? d['faseAntiglobulina'] === true : null,
    exameLancado: numOuNulo(d['exameLancado']),
    observacao: textoOuNulo(r['observacao']),
    registradoPor: texto(r['registrado_por']),
    registradoEm: civilDe(r['realizado_em'], fuso) ?? '',
    liberadoPor: textoOuNulo(r['liberado_por']),
    liberadoEm: civilDe(r['liberado_em'], fuso),
    motivoInvalidacao:
      r['situacao'] === 'invalidado' ? (textoOuNulo(r['motivo_invalidacao']) ?? textoOuNulo(d['motivoInvalidacao'])) : null,
  };
}

function bolsaDe(r: Linha, fuso: string, agora: string): BolsaEstoqueLida {
  const validade = civilDe(r['validade_em'], fuso) ?? '';
  const codigo = texto(r['hemocomponente']);
  return {
    id: num(r['id']),
    numero: texto(r['numero']),
    hemocomponente: {
      codigo,
      rotulo: texto(r['hemocomponente_nome']),
      classe: classeDoHemocomponente(codigo),
    },
    tipagem: { abo: aboDe(r['abo']), rh: rhDoSinal(r['rh']) },
    volumeMl: num(r['volume_ml']),
    validade,
    vencida: validade !== '' && validade < agora,
    situacao: texto(r['situacao']) as SituacaoBolsaEstoque,
    origem: texto(r['fornecedor']),
    local: num(r['local_guarda_hemocomponente_id']),
    irradiada: booleano(r['irradiada']),
    leucorreduzida: booleano(r['leucorreduzida']),
    temperaturaC: num(r['temperatura_recebimento_c']),
    inspecaoOk: booleano(r['inspecao_aprovada']),
    reservadaPara:
      r['reservada_requisicao_transfusao_id'] === null ||
      r['reservada_requisicao_transfusao_id'] === undefined
        ? null
        : {
            requisicao: num(r['reservada_requisicao_transfusao_id']),
            paciente: num(r['reservada_paciente']),
          },
    recebidaEm: civilDe(r['recebida_em'], fuso) ?? '',
    recebidaPor: texto(r['recebida_por']),
    ato: null,
    versao: num(r['versao']),
  };
}

export class PortaAgenciaPropria implements PortaAgencia {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoEnfermagem,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoAgencia, fn: (l: Leitor, est: number, fuso: string) => Promise<T>): Promise<T> {
    const est = estabelecimentoDe(c);
    return this.nucleo.lerSomente(
      {
        cliente: c.cliente,
        estabelecimento: c.estabelecimento,
        usuario: c.usuario,
        correlacao: c.correlacao || 'agencia',
      },
      async (l) => fn(l, est, await fusoDe(l, est)),
    );
  }

  async podeGravar(): Promise<LiberacaoGravacao> {
    return {
      pode: false,
      codigo: 'operacao-desconhecida',
      motivo: 'A agência grava pelos registros da tela.',
    };
  }

  async executar(): Promise<never> {
    throw recusa('operacao-desconhecida', 'A agência grava pelos registros da tela.');
  }

  gravarSgh<T>(
    c: ContextoAgencia,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorAgencia) => Promise<T>,
  ): Promise<T> {
    return gravacaoDireta(this.executor, c, {
      nome: 'enfermagem.agencia.gravacao',
      tabelas: ['teste_imuno_hematologico', 'bolsa_hemocomponente', 'movimento_bolsa'],
      trilha,
      gravador: (tx, est, an) => gravadorAgencia(tx, est, an),
      fn,
    });
  }

  imunos(
    c: ContextoAgencia,
    f: FiltroImunoPorta,
  ): Promise<{ itens: ImunoHematologiaLida[]; cortada: boolean }> {
    return this.ler(c, async (l, est, fuso) => {
      const filtros: string[] = [];
      const p: unknown[] = [est];
      if (f.id !== undefined) { filtros.push('t.id = ?'); p.push(f.id); }
      if (f.estado !== undefined) { filtros.push('t.situacao = ?'); p.push(f.estado); }
      if (f.tipo !== undefined)
        { filtros.push('tt.codigo = ?'); p.push(CODIGO_TESTE[f.tipo as TipoExameImuno] ?? '-'); }
      if (f.requisicao !== undefined) { filtros.push('t.requisicao_transfusao_id = ?'); p.push(f.requisicao); }
      if (f.paciente !== undefined) { filtros.push('t.paciente_id = ?'); p.push(f.paciente); }
      const rs = await l.consultar(
        `${SQL_IMUNO} ${filtros.length ? `AND ${filtros.join(' AND ')}` : ''} ORDER BY t.realizado_em DESC, t.id DESC LIMIT ?`,
        [...p, TETO + 1],
      );
      return { itens: rs.slice(0, TETO).map((r) => imunoDe(r, fuso)), cortada: rs.length > TETO };
    });
  }

  async resultadosDoPaciente(c: ContextoAgencia, paciente: number): Promise<ResultadoImunoResumo[]> {
    const { itens } = await this.imunos(c, { paciente });
    return itens
      .filter((i) => i.tipo !== 'provaCruzada')
      .map((i) => ({
        tipo: i.tipo,
        estado: i.estado,
        tipagem: i.tipagem,
        pai: i.pai,
        anticorpos: i.anticorpos,
        liberadoEm: i.liberadoEm,
      }));
  }

  async provas(c: ContextoAgencia, requisicao: number): Promise<ProvaCruzadaResumo[]> {
    const { itens } = await this.imunos(c, { requisicao, tipo: 'provaCruzada' });
    // A prova sem resultado (ou inconclusiva) fica de fora: nunca vira compatível, e a transfusão segue bloqueada
    // pela falta da prova compatível da bolsa.
    return itens.flatMap((i) =>
      i.provaCruzada === null
        ? []
        : [{ bolsa: i.bolsa ?? '', requisicao, estado: i.estado, resultado: i.provaCruzada }],
    );
  }

  estoque(c: ContextoAgencia, f: FiltroEstoque & { readonly agora: string }) {
    return this.ler(c, async (l, est, fuso) => {
      const filtros: string[] = [];
      const p: unknown[] = [est];
      if (f.situacao) { filtros.push('b.situacao = ?'); p.push(f.situacao); }
      if (f.hemocomponente) { filtros.push('h.sigla = ?'); p.push(f.hemocomponente); }
      if (f.abo) { filtros.push('gs.sigla = ?'); p.push(f.abo); }
      if (f.rh) { filtros.push('fr.sinal = ?'); p.push(f.rh === 'positivo' ? '+' : '-'); }
      if (f.numero) { filtros.push('b.numero = ?'); p.push(f.numero); }
      if (f.venceEmDias !== undefined)
        { filtros.push('b.validade_em <= ?'); p.push(new Date(instanteDe(f.agora, fuso).getTime() + f.venceEmDias * 86_400_000)); }
      if (!f.situacao) filtros.push("b.situacao IN ('quarentena', 'liberada', 'reservada')");
      const rs = await l.consultar(
        `${SQL_BOLSA} ${filtros.length ? `AND ${filtros.join(' AND ')}` : ''} ORDER BY b.validade_em, b.id LIMIT ?`,
        [...p, TETO + 1],
      );
      return { itens: rs.slice(0, TETO).map((r) => bolsaDe(r, fuso, f.agora)), cortada: rs.length > TETO };
    });
  }

  bolsa(c: ContextoAgencia, chave: { readonly id: number } | { readonly numero: string }, agora: string) {
    return this.ler(c, async (l, est, fuso) => {
      const r =
        'id' in chave
          ? await l.uma(`${SQL_BOLSA} AND b.id = ?`, [est, chave.id])
          : await l.uma(`${SQL_BOLSA} AND b.numero = ? ORDER BY b.id DESC LIMIT 1`, [est, chave.numero]);
      return r ? bolsaDe(r, fuso, agora) : null;
    });
  }

  movimentos(c: ContextoAgencia, bolsa: number): Promise<MovimentoBolsaLido[]> {
    return this.ler(c, async (l, est, fuso) => {
      const rs = await l.consultar(
        `SELECT m.id, m.dados, m.ocorrido_em, m.tipo_movimento_bolsa_id, m.motivo_devolucao_bolsa_id, m.observacao,
                ${LOGIN_DE('m.usuario_id')} AS login
           FROM movimento_bolsa m JOIN bolsa_hemocomponente b ON b.id = m.bolsa_hemocomponente_id
          WHERE m.bolsa_hemocomponente_id = ? AND b.estabelecimento_id = ? AND m.operacao = 'inclusao'
          ORDER BY m.ocorrido_em, m.id`,
        [bolsa, est],
      );
      return rs.map((r) => {
        const d = lerJson(r['dados']);
        return {
          id: num(r['id']),
          tipo: (texto(d['tipo']) || 'recebimento') as TipoMovimentoBolsa,
          situacaoAntes: (textoOuNulo(d['situacaoAntes']) as SituacaoBolsaEstoque | null) ?? null,
          situacaoDepois: texto(d['situacaoDepois']) as SituacaoBolsaEstoque,
          tipoCadastro: num(r['tipo_movimento_bolsa_id']),
          motivoCadastro: numOuNulo(r['motivo_devolucao_bolsa_id']),
          motivo: textoOuNulo(r['observacao']),
          requisicao: numOuNulo(d['requisicao']),
          usuario: texto(r['login']),
          em: civilDe(r['ocorrido_em'], fuso) ?? '',
        };
      });
    });
  }

  /** As versões anteriores da bolsa corrigida (os movimentos de alteração, na ordem). */
  versoesBolsa(c: ContextoAgencia, bolsa: number): Promise<VersaoBolsaLida[]> {
    return this.ler(c, async (l, est, fuso) => {
      const rs = await l.consultar(
        `SELECT m.id, m.dados, m.observacao, m.ocorrido_em, ${LOGIN_DE('m.usuario_id')} AS login
           FROM movimento_bolsa m JOIN bolsa_hemocomponente b ON b.id = m.bolsa_hemocomponente_id
          WHERE m.bolsa_hemocomponente_id = ? AND b.estabelecimento_id = ? AND b.excluido_em IS NULL
            AND m.operacao = 'alteracao'
          ORDER BY m.ocorrido_em, m.id`,
        [bolsa, est],
      );
      return rs.map((r, i): VersaoBolsaLida => {
        const d = lerJson(r['dados']);
        const antes = (d['antes'] ?? {}) as Record<string, unknown>;
        const tip = (antes['tipagem'] ?? {}) as Record<string, unknown>;
        return {
          versao: num(d['versao']) || i + 1,
          numero: texto(antes['numero']),
          tipagem: { abo: aboDe(tip['abo']), rh: rhGravado(tip['rh']) },
          validade: texto(antes['validade']),
          volumeMl: num(antes['volumeMl']),
          motivo: texto(r['observacao']),
          corrigidaPor: texto(r['login']),
          corrigidaEm: (civilDe(r['ocorrido_em'], fuso) ?? '').slice(0, 16),
        };
      });
    });
  }

  cadastrosDoEstoque(c: ContextoAgencia): Promise<CadastrosDoEstoque> {
    return this.ler(c, async (l, est) => {
      const locais = await l.consultar(
        'SELECT id, descricao FROM local_guarda_hemocomponente WHERE estabelecimento_id = ? AND ativo ORDER BY descricao LIMIT ?',
        [est, TETO + 1],
      );
      // Os motivos de devolução e descarte são da rede inteira.
      const motivos = await l.consultar(
        'SELECT id, descricao FROM motivo_devolucao_bolsa WHERE ativo ORDER BY descricao LIMIT ?',
        [TETO + 1],
      );
      const item = (r: Linha) => ({ codigo: num(r['id']), descricao: texto(r['descricao']) });
      return {
        locais: locais.slice(0, TETO).map(item),
        motivos: motivos.slice(0, TETO).map(item),
        cortada: locais.length > TETO || motivos.length > TETO,
      };
    });
  }

  examesLancados(): Promise<ExameImunoLancado[]> {
    return Promise.resolve([]);
  }
}

/** O gravador da agência sobre a transação do Executor. */
function gravadorAgencia(tx: TxOperacao, est: number, anotacao: AnotacaoGravacao): GravadorAgencia {
  const fusoP = fusoDe(tx, est);
  const idPor = async (sql: string, p: unknown[], falta: string) => {
    const r = await tx.uma<{ id: number }>(sql, p);
    if (!r) throw recusa('cadastro-incompleto', falta);
    return Number(r.id);
  };
  const grupo = (abo: string) =>
    idPor('SELECT id FROM grupo_sanguineo WHERE sigla = ?', [abo], 'O grupo sanguíneo não está no cadastro.');
  const fator = (rh: string) =>
    idPor(
      'SELECT id FROM fator_rh WHERE sinal = ?',
      [rh === 'positivo' ? '+' : '-'],
      'O fator Rh não está no cadastro.',
    );
  const tipoMovimento = (tipo: TipoMovimentoBolsa) =>
    idPor(
      'SELECT id FROM tipo_movimento_bolsa WHERE natureza = ? AND ativo ORDER BY id LIMIT 1',
      [NATUREZA[tipo]],
      `O cadastro dos movimentos da bolsa não tem a natureza "${NATUREZA[tipo]}".`,
    );
  const movimento = async (
    bolsa: number,
    tipo: TipoMovimentoBolsa,
    antes: SituacaoBolsaEstoque | null,
    depois: SituacaoBolsaEstoque,
    extra: {
      motivo?: string | null;
      motivoCadastro?: number | null;
      requisicao?: number | null;
      local?: number | null;
    } = {},
  ) =>
    tx.incluir('movimento_bolsa', {
      bolsa_hemocomponente_id: bolsa,
      operacao: 'inclusao',
      tipo_movimento_bolsa_id: await tipoMovimento(tipo),
      motivo_devolucao_bolsa_id: extra.motivoCadastro ?? null,
      local_guarda_hemocomponente_id: extra.local ?? null,
      observacao: extra.motivo ?? null,
      dados: JSON.stringify({
        tipo,
        situacaoAntes: antes,
        situacaoDepois: depois,
        requisicao: extra.requisicao ?? null,
      }),
      ocorrido_em: new Date(),
      usuario_id: tx.contexto.usuario,
    });
  const imunoTravado = async (id: number) => {
    const [t] = await tx.consultarParaAtualizar<Linha>(
      `SELECT t.id, t.versao, t.situacao, t.realizado_por_profissional_id, t.leituras, t.paciente_id
         FROM teste_imuno_hematologico t
        WHERE t.id = ? AND t.excluido_em IS NULL AND (
              (t.requisicao_transfusao_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM requisicao_transfusao r WHERE r.id = t.requisicao_transfusao_id AND r.estabelecimento_id = ?))
              OR (t.requisicao_transfusao_id IS NULL AND (
                SELECT ta.estabelecimento_id FROM trilha_auditoria ta
                 WHERE ta.entidade = 'teste_imuno_hematologico' AND ta.entidade_id = t.id ORDER BY ta.id LIMIT 1) = ?))`,
      [id, est, est],
    );
    if (!t) throw recusa('exame-inexistente', 'O exame imuno-hematológico não foi encontrado.');
    return t;
  };
  return {
    async registrarImuno(x) {
      if (x.requisicao !== null) {
        const req = await tx.uma<{ paciente_id: number }>(
          'SELECT paciente_id FROM requisicao_transfusao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [x.requisicao, est],
        );
        if (!req) throw recusa('requisicao-inexistente', 'A requisição de transfusão não é deste estabelecimento.');
        if (Number(req.paciente_id) !== x.paciente)
          throw recusa('requisicao-de-outro-paciente', 'A requisição de transfusão é de outro paciente.');
      }
      const profissional = await exigirProfissional(tx, tx.contexto, est);
      const tipoTeste = await idPor(
        'SELECT id FROM tipo_teste_imuno_hematologico WHERE codigo = ? AND ativo',
        [CODIGO_TESTE[x.tipo]],
        `O cadastro dos testes imuno-hematológicos não tem "${CODIGO_TESTE[x.tipo]}": peça a carga ao administrador.`,
      );
      // A ordem do exame do paciente: o paciente travado na transação serializa os registros dele (sem corrida).
      const [pac] = await tx.consultarParaAtualizar<{ id: number }>(
        'SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL',
        [x.paciente],
      );
      if (!pac) throw recusa('paciente-inexistente', 'O paciente não foi encontrado.');
      const seq = await tx.uma<{ n: number }>(
        'SELECT COALESCE(MAX(sequencia), 0) + 1 AS n FROM teste_imuno_hematologico WHERE paciente_id = ?',
        [x.paciente],
      );
      const tipagem = x.tipo === 'aboRh' ? x.tipagem : null;
      const leituras =
        x.tipo === 'aboRh'
          ? { direta: x.direta, reversa: x.reversa }
          : x.tipo === 'provaCruzada'
            ? { bolsa: x.bolsa, faseAntiglobulina: x.faseAntiglobulina }
            : {};
      const resultado =
        x.tipo === 'pai'
          ? x.resultado
          : x.tipo === 'provaCruzada'
            ? x.resultado === 'incompativel'
              ? 'positivo'
              : 'negativo'
            : null;
      const id = await tx.incluir('teste_imuno_hematologico', {
        paciente_id: x.paciente,
        requisicao_transfusao_id: x.requisicao,
        sequencia: Number(seq?.n ?? 1),
        tipo_teste_imuno_hematologico_id: tipoTeste,
        metodo: METODO[x.metodo] ?? 'gel_teste',
        forma_entrada: 'digitado',
        grupo_sanguineo_id: tipagem?.abo ? await grupo(tipagem.abo) : null,
        fator_rh_id: tipagem?.rh ? await fator(tipagem.rh) : null,
        resultado: x.tipo === 'aboRh' && !tipagem ? 'inconclusivo' : resultado,
        resultado_texto: x.tipo === 'pai' ? x.anticorpos : null,
        leituras: JSON.stringify({ ...leituras, exameLancado: x.exameLancado }),
        situacao: 'registrado',
        realizado_em: new Date(),
        realizado_por_profissional_id: profissional,
        observacao: x.observacao,
      });
      return { id, repetida: false };
    },
    async liberarImuno(x) {
      const t = await imunoTravado(x.id);
      if (t['situacao'] !== 'registrado')
        throw recusa('exame-nao-registrado', 'Só o resultado registrado é liberado.');
      const profissional = await exigirProfissional(tx, tx.contexto, est);
      if (num(t['realizado_por_profissional_id']) === profissional)
        throw recusa('mesmo-profissional', 'A liberação é de outro profissional, que confere o resultado.');
      await tx.alterar('teste_imuno_hematologico', x.id, num(t['versao']), {
        situacao: 'liberado',
        liberado_em: new Date(),
        liberado_por_profissional_id: profissional,
      });
      return { id: x.id };
    },
    async invalidarImuno(x) {
      const t = await imunoTravado(x.id);
      if (t['situacao'] === 'invalidado') throw recusa('exame-invalidado', 'O resultado já está invalidado.');
      const motivo = x.motivo.trim();
      if (!motivo) throw recusa('motivo-obrigatorio', 'A invalidação exige o motivo.');
      // O CHECK ck_teste_imuno_hematologico_invalidacao exige o motivo na linha invalidada.
      await tx.alterar('teste_imuno_hematologico', x.id, num(t['versao']), {
        situacao: 'invalidado',
        motivo_invalidacao: motivo.slice(0, 500),
      });
      anotacao.motivo = motivo;
      return { id: x.id };
    },
    async receberBolsa(x) {
      const hemo = await idPor(
        'SELECT id FROM hemocomponente WHERE sigla = ? AND ativo',
        [x.hemocomponente],
        'O hemocomponente não está no cadastro.',
      );
      const fornecedor = await idPor(
        'SELECT id FROM servico_hemoterapia_fornecedor WHERE estabelecimento_id = ? AND nome = ? AND ativo AND excluido_em IS NULL',
        [est, x.origem],
        'O serviço fornecedor da bolsa não está cadastrado neste estabelecimento.',
      );
      const local = await idPor(
        'SELECT id FROM local_guarda_hemocomponente WHERE id = ? AND estabelecimento_id = ? AND ativo',
        [x.local, est],
        'O local de armazenagem não está cadastrado neste estabelecimento.',
      );
      let id: number;
      try {
        id = await tx.incluir('bolsa_hemocomponente', {
          estabelecimento_id: est,
          numero: x.numero,
          hemocomponente_id: hemo,
          grupo_sanguineo_id: await grupo(x.tipagem.abo),
          fator_rh_id: await fator(x.tipagem.rh),
          volume_ml: x.volumeMl,
          validade_em: instanteDe(x.validade, await fusoP),
          recebida_em: new Date(),
          recebida_por_usuario_id: tx.contexto.usuario,
          servico_hemoterapia_fornecedor_id: fornecedor,
          irradiada: x.irradiada,
          leucorreduzida: x.leucorreduzida,
          temperatura_recebimento_c: x.temperaturaC,
          inspecao_aprovada: x.inspecaoOk,
          local_guarda_hemocomponente_id: local,
          situacao: x.situacao,
        });
      } catch (e) {
        if (restricaoUnicaViolada(e))
          throw recusa(
            'bolsa-repetida',
            'Esta bolsa (número e hemocomponente) já foi recebida neste estabelecimento.',
          );
        throw e;
      }
      await movimento(id, 'recebimento', null, x.situacao, { local });
      return { id, repetida: false };
    },
    async movimentarBolsa(x) {
      const [b] = await tx.consultarParaAtualizar<Linha>(
        'SELECT id, numero, situacao, versao FROM bolsa_hemocomponente WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [x.bolsa, est],
      );
      if (!b) throw recusa('bolsa-inexistente', 'A bolsa não foi encontrada no estoque.');
      const antes = texto(b['situacao']) as SituacaoBolsaEstoque;
      const regra = TRANSICOES_BOLSA[x.acao];
      if (!regra.de.includes(antes))
        throw recusa('situacao-bolsa', `A bolsa está ${antes}: a ação não vale nessa situação.`);
      if (x.acao === 'reservar' && x.requisicao === null)
        throw recusa('requisicao-obrigatoria', 'A reserva é para uma requisição.');
      const destino = regra.para === 'descartada' || regra.para === 'devolvida';
      const versao = await tx.alterar('bolsa_hemocomponente', num(b['id']), x.versao, {
        situacao: regra.para,
        reservada_requisicao_transfusao_id: regra.para === 'reservada' ? x.requisicao : null,
        ...(destino ? { destino_em: new Date(), motivo_devolucao_bolsa_id: x.motivoCadastro } : {}),
        ...(x.inspecaoConferida ? { inspecao_aprovada: true } : {}),
      });
      void versao;
      const id = await movimento(num(b['id']), TIPO_DO_MOVIMENTO[x.acao], antes, regra.para, {
        motivo: x.motivo,
        motivoCadastro: x.motivoCadastro,
        requisicao: x.requisicao,
      });
      return { id, situacao: regra.para, numero: texto(b['numero']), repetida: false };
    },
    async corrigirBolsa(x) {
      const [b] = await tx.consultarParaAtualizar<Linha>(
        `SELECT b.id, b.numero, b.situacao, b.validade_em, b.volume_ml, gs.sigla AS abo, fr.sinal AS rh,
                (SELECT COUNT(*) FROM movimento_bolsa m WHERE m.bolsa_hemocomponente_id = b.id
                  AND m.operacao = 'alteracao') AS correcoes
           FROM bolsa_hemocomponente b
           JOIN grupo_sanguineo gs ON gs.id = b.grupo_sanguineo_id
           JOIN fator_rh fr ON fr.id = b.fator_rh_id
          WHERE b.id = ? AND b.estabelecimento_id = ? AND b.excluido_em IS NULL`,
        [x.bolsa, est],
      );
      if (!b) throw recusa('bolsa-inexistente', 'A bolsa não foi encontrada no estoque.');
      if (!['quarentena', 'liberada'].includes(texto(b['situacao'])))
        throw recusa(
          'bolsa-usada',
          'A bolsa já foi reservada, usada ou baixada: não pode mais ser corrigida.',
        );
      const versao = await tx.alterar('bolsa_hemocomponente', x.bolsa, x.versao, {
        ...(x.numero !== undefined ? { numero: x.numero } : {}),
        ...(x.tipagem
          ? { grupo_sanguineo_id: await grupo(x.tipagem.abo), fator_rh_id: await fator(x.tipagem.rh) }
          : {}),
        ...(x.validade !== undefined ? { validade_em: instanteDe(x.validade, await fusoP) } : {}),
        ...(x.volumeMl !== undefined ? { volume_ml: x.volumeMl } : {}),
      });
      // A versão anterior fica no movimento de alteração (o histórico do recebimento corrigido), com o motivo.
      const situacao = texto(b['situacao']) as SituacaoBolsaEstoque;
      await tx.incluir('movimento_bolsa', {
        bolsa_hemocomponente_id: x.bolsa,
        operacao: 'alteracao',
        tipo_movimento_bolsa_id: await tipoMovimento('recebimento'),
        observacao: x.motivo.slice(0, 500),
        dados: JSON.stringify({
          tipo: 'correcao',
          situacaoAntes: situacao,
          situacaoDepois: situacao,
          versao: num(b['correcoes']) + 1,
          antes: {
            numero: texto(b['numero']),
            tipagem: { abo: aboDe(b['abo']), rh: rhDoSinal(b['rh']) },
            validade: civilDe(b['validade_em'], await fusoP) ?? '',
            volumeMl: num(b['volume_ml']),
          },
        }),
        ocorrido_em: new Date(),
        usuario_id: tx.contexto.usuario,
      });
      return { id: x.bolsa, numero: x.numero ?? texto(b['numero']), versao };
    },
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaAgenciaIndisponivel(): PortaAgencia {
  return portaIndisponivel<PortaAgencia>(METODOS_PORTA_AGENCIA);
}
