// Logística entre unidades (09-AREA linha 77, C1-120) sobre o MariaDB do cliente pelo Executor do núcleo (trilha na
// mesma transação, versão conferida, Idempotency-Key honrada). As regras são do domínio
// (`@sgh/contratos/regras-suprimentos`, romaneio-entrega); aqui ficam a leitura, a trava das linhas e a gravação:
//   - motorista (com o cadastro único da pessoa física pelo CPF) e veiculo_entrega: o cadastro de quem leva e do quê;
//   - romaneio_entrega + romaneio_entrega_item: o romaneio montado com as transferências do estoque (documento_estoque
//     tipo transferencia, já existente) e o destino de cada uma (o local de destino e a unidade dele), o transporte
//     (veículo próprio com motorista ou transportadora contratada) e o frete;
//   - expedição: liberação e saída num passo (liberador, liberado_em, saida_em, quilometragem de saída);
//   - conferência por item na chegada: entregue (recebedor e hora), recusado, devolvido ou extraviado com o motivo; o
//     romaneio fecha entregue ou entregue em parte, com conferente, chegada e quilometragem, quando não sobra pendente;
//   - cancelamento só antes da saída, com o motivo na observação. Nada é apagado.
import {
  type CategoriaHabilitacao,
  CATEGORIAS_HABILITACAO,
  conferirCancelamentoEnvio,
  conferirCancelamentoRomaneio,
  conferirEnvioEntreUnidades,
  conferirConferencia,
  conferirExpedicao,
  conferirMontagem,
  conferirMotorista,
  conferirVeiculo,
  type DesfechoItem,
  type MotoristaEntrada,
  placaNormalizada,
  type RecusaSuprimentos,
  type SituacaoItemRomaneio,
  type SituacaoRomaneio,
  situacaoAposConferencia,
  type TransferenciaRomaneavel,
  type VeiculoEntrada,
} from '@sgh/contratos/regras-suprimentos';
import { somenteDigitos } from '@sgh/dominio-cadastro';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  garantirSequencia,
  type Leitor,
  type Linha,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import {
  exigirMesAberto,
  insumoAtivo,
  localDoEstabelecimento,
  lotesDaSaida,
  movimentar,
  TIPO_MOVIMENTO,
  tipoMovimentoId,
} from './porta-propria.js';

export const PORTA_ROMANEIO_ENTREGA = Symbol('PORTA_ROMANEIO_ENTREGA');
export const TABELAS_ROMANEIO_ENTREGA = [
  'romaneio_entrega',
  'romaneio_entrega_item',
  'motorista',
  'veiculo_entrega',
  'pessoa_fisica',
  'sequencia_negocio',
  // O envio entre unidades e o recebimento na conferência (documento, saldo, movimento e lotes do estoque).
  'documento_estoque',
  'documento_estoque_item',
  'movimento_estoque',
  'movimento_lote',
  'saldo_estoque',
  'saldo_lote',
  'lote_insumo',
] as const;
export const OPERACOES_ROMANEIO_ENTREGA = {
  motorista: 'suprimentos.romaneio.gravar-motorista',
  veiculo: 'suprimentos.romaneio.gravar-veiculo',
  montar: 'suprimentos.romaneio.montar',
  expedir: 'suprimentos.romaneio.expedir',
  conferir: 'suprimentos.romaneio.conferir',
  cancelar: 'suprimentos.romaneio.cancelar',
  enviar: 'suprimentos.romaneio.enviar-entre-unidades',
  cancelarEnvio: 'suprimentos.romaneio.cancelar-envio',
} as const;
const LIMITE = 200;

export interface MotoristaResumo {
  readonly id: number;
  readonly versao: number;
  readonly nome: string;
  readonly tipoVinculo: 'proprio' | 'terceiro';
  readonly transportadora: number | null;
  readonly numeroHabilitacao: string;
  readonly categorias: CategoriaHabilitacao[];
  readonly vencimentoHabilitacao: string;
  readonly habilitacaoVencida: boolean;
  readonly transportaControlado: boolean;
  readonly situacao: string;
  readonly motivoInativacao: string | null;
}

export interface VeiculoResumo {
  readonly id: number;
  readonly versao: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly placa: string;
  readonly proprio: boolean;
  readonly transportadora: number | null;
  readonly refrigerado: boolean;
  readonly capacidadeCargaKg: number | null;
  readonly ativo: boolean;
  readonly motivoInativacao: string | null;
}

export interface TransferenciaDisponivel {
  readonly documento: number;
  readonly numero: string;
  readonly situacao: string;
  readonly movimentadoEm: string | null;
  readonly origem: string;
  readonly destino: string;
  readonly destinoUnidade: string;
  readonly itens: number;
  readonly controlado: boolean;
  readonly termolabil: boolean;
}

export interface RomaneioResumo {
  readonly id: number;
  readonly versao: number;
  readonly numero: number;
  readonly descricao: string | null;
  readonly situacao: SituacaoRomaneio;
  readonly saidaPrevistaEm: string | null;
  readonly saidaEm: string | null;
  readonly chegadaEm: string | null;
  readonly veiculo: string | null;
  readonly motorista: string | null;
  readonly transportadora: string | null;
  readonly valorFrete: number | null;
  readonly itens: number;
  readonly pendentes: number;
  /** Itens pendentes que chegam a esta unidade (a conferência é de quem recebe). */
  readonly pendentesAqui: number;
  /** O romaneio é desta unidade (a origem expede e cancela). */
  readonly daUnidade: boolean;
}

export interface ItemRomaneio {
  readonly id: number;
  readonly sequencia: number;
  readonly documento: number | null;
  readonly numeroDocumento: string | null;
  readonly situacaoDocumento: string | null;
  readonly destinoUnidade: string;
  readonly destinoLocal: string | null;
  readonly volumes: number;
  readonly situacao: SituacaoItemRomaneio;
  readonly recebedor: string | null;
  readonly entregueEm: string | null;
  readonly observacao: string | null;
  readonly destinoAqui: boolean;
}

export interface RomaneioDetalhe extends RomaneioResumo {
  readonly veiculoId: number | null;
  readonly motoristaId: number | null;
  readonly transportadoraId: number | null;
  readonly quilometragemSaida: number | null;
  readonly quilometragemChegada: number | null;
  readonly liberador: string | null;
  readonly conferente: string | null;
  readonly observacao: string | null;
  readonly levaControlado: boolean;
  readonly levaTermolabil: boolean;
  readonly lista: readonly ItemRomaneio[];
}

export interface PainelRomaneio {
  readonly hoje: string;
  readonly romaneios: readonly RomaneioResumo[];
  readonly motoristas: readonly MotoristaResumo[];
  readonly veiculos: readonly VeiculoResumo[];
  readonly transportadoras: readonly { readonly id: number; readonly nome: string }[];
  readonly transferencias: readonly TransferenciaDisponivel[];
  /** Os locais ativos desta unidade (origem do envio). */
  readonly locais: readonly { readonly id: number; readonly nome: string }[];
  /** Os locais ativos das outras unidades do cliente (destino do envio). */
  readonly destinos: readonly { readonly id: number; readonly nome: string; readonly unidade: string }[];
  /** O saldo livre (sem o reservado) dos itens nos locais desta unidade, para escolher o que enviar. */
  readonly saldos: readonly {
    readonly local: number;
    readonly item: number;
    readonly nome: string;
    readonly livre: number;
  }[];
}

export interface EnvioEntrada {
  readonly origem: number;
  readonly destino: number;
  readonly itens: readonly { readonly item: number; readonly quantidade: number }[];
  readonly observacao: string | null;
}

export interface Transporte {
  readonly veiculo: number | null;
  readonly motorista: number | null;
  readonly transportadora: number | null;
  readonly valorFrete: number | null;
}

export interface MontagemEntrada extends Transporte {
  readonly documentos: readonly number[];
  readonly descricao: string | null;
  readonly saidaPrevista: string | null;
  readonly observacao: string | null;
}

export interface ExpedicaoEntrada extends Transporte {
  readonly versao: number;
  readonly quilometragemSaida: number | null;
}

export interface ConferenciaEntrada {
  readonly versao: number;
  readonly desfechos: readonly DesfechoItem[];
  readonly quilometragemChegada: number | null;
}

export interface PortaRomaneioEntrega {
  readonly destino: 'banco' | 'indisponivel';
  painel(c: ContextoPortaM18): Promise<PainelRomaneio>;
  detalhe(c: ContextoPortaM18, id: number): Promise<RomaneioDetalhe>;
  gravarMotorista(
    c: ContextoPortaM18,
    e: MotoristaEntrada,
    alvo: { id: number; versao: number } | null,
    chave: string,
  ): Promise<{ id: number }>;
  gravarVeiculo(
    c: ContextoPortaM18,
    e: VeiculoEntrada,
    alvo: { id: number; versao: number } | null,
    chave: string,
  ): Promise<{ id: number }>;
  montar(c: ContextoPortaM18, e: MontagemEntrada, chave: string): Promise<{ id: number; numero: number }>;
  expedir(c: ContextoPortaM18, id: number, e: ExpedicaoEntrada, chave: string): Promise<{ id: number }>;
  conferir(
    c: ContextoPortaM18,
    id: number,
    e: ConferenciaEntrada,
    chave: string,
  ): Promise<{ id: number; situacao: string }>;
  cancelar(
    c: ContextoPortaM18,
    id: number,
    versao: number,
    motivo: string,
    chave: string,
  ): Promise<{ id: number }>;
  enviar(c: ContextoPortaM18, e: EnvioEntrada, chave: string): Promise<{ id: number; numero: number }>;
  cancelarEnvio(
    c: ContextoPortaM18,
    documento: number,
    motivo: string,
    chave: string,
  ): Promise<{ id: number }>;
}

export function portaRomaneioEntregaIndisponivel(): PortaRomaneioEntrega {
  const falha = (): never => {
    throw new ErroProblema('indisponivel', 503, 'O romaneio de entrega exige o banco próprio.');
  };
  return {
    destino: 'indisponivel',
    painel: falha,
    detalhe: falha,
    gravarMotorista: falha,
    gravarVeiculo: falha,
    montar: falha,
    expedir: falha,
    conferir: falha,
    cancelar: falha,
    enviar: falha,
    cancelarEnvio: falha,
  };
}

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const tx_ = (v: unknown) => (v === null || v === undefined ? null : String(v));
const sim = (v: unknown) => v === true || Number(v) === 1;

function recusarTodas(rs: readonly RecusaSuprimentos[]): void {
  const [r] = rs;
  if (r)
    throw recusa(r.codigo, rs.map((x) => x.mensagem).join(' '), {
      campos: [...new Set(rs.flatMap((x) => x.campos ?? []))],
    });
}

const categoriasDe = (r: Linha): CategoriaHabilitacao[] =>
  CATEGORIAS_HABILITACAO.filter((c) => sim(r[`categoria_${c}`]));

/** Transferência ainda em romaneio ativo (item pendente ou entregue num romaneio não cancelado). */
const EM_ROMANEIO = `EXISTS (SELECT 1 FROM romaneio_entrega_item ri JOIN romaneio_entrega rr ON rr.id = ri.romaneio_entrega_id
   WHERE ri.documento_estoque_id = d.id AND ri.excluido_em IS NULL AND rr.excluido_em IS NULL
     AND rr.situacao <> 'cancelado' AND ri.situacao IN ('pendente', 'entregue'))`;

/** Carga com controlado e com termolábil (guarda em temperatura até 8 °C), pelos itens dos documentos. */
async function cargaDe(
  l: Pick<Leitor, 'uma'>,
  documentos: readonly number[],
): Promise<{ controlado: boolean; termolabil: boolean }> {
  if (documentos.length === 0) return { controlado: false, termolabil: false };
  const marcas = documentos.map(() => '?').join(', ');
  const r = await l.uma<Linha>(
    `SELECT MAX(i.controlado) AS controlado,
            MAX(CASE WHEN ca.tipo = 'temperatura' AND ca.temperatura_maxima <= 8 THEN 1 ELSE 0 END) AS termolabil
       FROM documento_estoque_item di JOIN insumo i ON i.id = di.insumo_id
       LEFT JOIN condicao_armazenamento ca ON ca.id = i.condicao_armazenamento_id
      WHERE di.documento_estoque_id IN (${marcas}) AND di.excluido_em IS NULL`,
    [...documentos],
  );
  return { controlado: sim(r?.['controlado']), termolabil: sim(r?.['termolabil']) };
}

const SQL_ROMANEIO = `SELECT r.id, r.versao, r.numero, r.descricao, r.situacao,
    DATE_FORMAT(r.saida_prevista_em, '%Y-%m-%dT%H:%i') AS saida_prevista_em,
    DATE_FORMAT(r.saida_em, '%Y-%m-%dT%H:%i') AS saida_em, DATE_FORMAT(r.chegada_em, '%Y-%m-%dT%H:%i') AS chegada_em,
    r.veiculo_entrega_id, CONCAT(v.placa, ' · ', v.descricao) AS veiculo, r.motorista_id, pf.nome AS motorista,
    r.transportadora_empresa_fornecedora_id, ef.razao_social AS transportadora, r.valor_frete,
    r.quilometragem_saida, r.quilometragem_chegada, ul.login AS liberador, uc.login AS conferente, r.observacao,
    (SELECT COUNT(*) FROM romaneio_entrega_item x WHERE x.romaneio_entrega_id = r.id AND x.excluido_em IS NULL) AS itens,
    (SELECT COUNT(*) FROM romaneio_entrega_item x WHERE x.romaneio_entrega_id = r.id AND x.excluido_em IS NULL
       AND x.situacao = 'pendente') AS pendentes,
    (SELECT COUNT(*) FROM romaneio_entrega_item x WHERE x.romaneio_entrega_id = r.id AND x.excluido_em IS NULL
       AND x.situacao = 'pendente' AND x.destino_estabelecimento_id = ?) AS pendentes_aqui,
    (r.estabelecimento_id = ?) AS da_unidade
   FROM romaneio_entrega r
   LEFT JOIN veiculo_entrega v ON v.id = r.veiculo_entrega_id
   LEFT JOIN motorista m ON m.id = r.motorista_id
   LEFT JOIN pessoa_fisica pf ON pf.id = m.pessoa_fisica_id
   LEFT JOIN empresa_fornecedora ef ON ef.id = r.transportadora_empresa_fornecedora_id
   LEFT JOIN usuario ul ON ul.id = r.liberador_usuario_id
   LEFT JOIN usuario uc ON uc.id = r.conferente_usuario_id
  WHERE r.excluido_em IS NULL AND (r.estabelecimento_id = ? OR EXISTS (SELECT 1 FROM romaneio_entrega_item y
     WHERE y.romaneio_entrega_id = r.id AND y.excluido_em IS NULL AND y.destino_estabelecimento_id = ?))`;
/** Os parâmetros do SQL_ROMANEIO: a unidade da sessão (origem que expede ou destino que confere). */
const naUnidade = (est: number) => [est, est, est, est];

const resumoDe = (r: Linha): RomaneioResumo => ({
  id: n(r['id']),
  versao: n(r['versao']),
  numero: n(r['numero']),
  descricao: tx_(r['descricao']),
  situacao: String(r['situacao']) as SituacaoRomaneio,
  saidaPrevistaEm: tx_(r['saida_prevista_em']),
  saidaEm: tx_(r['saida_em']),
  chegadaEm: tx_(r['chegada_em']),
  veiculo: tx_(r['veiculo']),
  motorista: tx_(r['motorista']),
  transportadora: tx_(r['transportadora']),
  valorFrete: nn(r['valor_frete']),
  itens: n(r['itens']),
  pendentes: n(r['pendentes']),
  pendentesAqui: n(r['pendentes_aqui']),
  daUnidade: sim(r['da_unidade']),
});

async function hojeDe(l: Pick<Leitor, 'uma'>): Promise<string> {
  const r = await l.uma<Linha>("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d') AS hoje", []);
  return String(r?.['hoje']);
}

async function motoristaDe(l: Pick<Leitor, 'uma'>, est: number, id: number) {
  const r = await l.uma<Linha>(
    `SELECT id, versao, situacao, DATE_FORMAT(vencimento_habilitacao, '%Y-%m-%d') AS vencimento, transporta_controlado,
            categoria_a, categoria_b, categoria_c, categoria_d, categoria_e
       FROM motorista WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [id, est],
  );
  if (!r)
    throw recusa('motorista-inexistente', 'O motorista não existe nesta unidade.', { campos: ['motorista'] });
  return {
    situacao: String(r['situacao']),
    vencimentoHabilitacao: String(r['vencimento']),
    categorias: categoriasDe(r),
    transportaControlado: sim(r['transporta_controlado']),
  };
}

async function veiculoDe(l: Pick<Leitor, 'uma'>, est: number, id: number) {
  const r = await l.uma<Linha>(
    `SELECT ativo, proprio, refrigerado, capacidade_carga_kg FROM veiculo_entrega
      WHERE id = ? AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)`,
    [id, est],
  );
  if (!r) throw recusa('veiculo-inexistente', 'O veículo não existe nesta unidade.', { campos: ['veiculo'] });
  return {
    ativo: sim(r['ativo']),
    proprio: sim(r['proprio']),
    refrigerado: sim(r['refrigerado']),
    capacidadeCargaKg: nn(r['capacidade_carga_kg']),
  };
}

async function transportadoraDe(
  l: Pick<Leitor, 'uma'>,
  id: number,
): Promise<{ pessoaJuridica: number | null }> {
  const r = await l.uma<Linha>(
    "SELECT pessoa_juridica_id FROM empresa_fornecedora WHERE id = ? AND situacao = 'ativo' AND excluido_em IS NULL",
    [id],
  );
  if (!r)
    throw recusa('transportadora-inexistente', 'A transportadora não existe ou não está ativa.', {
      campos: ['transportadora'],
    });
  return { pessoaJuridica: nn(r['pessoa_juridica_id']) };
}

export class PortaRomaneioEntregaPropria implements PortaRomaneioEntrega {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private contexto(c: ContextoPortaM18): ContextoNucleo & { estabelecimento: number } {
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    return {
      cliente: c.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: c.correlacao || 'romaneio-entrega',
    };
  }

  private async executar<
    R extends Readonly<Record<string, string | number | boolean | null>> & { id: number },
  >(
    c: ContextoPortaM18,
    nome: string,
    trilha: Record<string, unknown>,
    chave: string,
    gravar: (tx: TxOperacao, est: number, usuario: number | null) => Promise<R>,
    alvo: string,
  ): Promise<R> {
    const ctxN = this.contexto(c);
    const op = definirOperacao({
      nome,
      tabelas: [...TABELAS_ROMANEIO_ENTREGA],
      entrada: z.unknown(),
      gravar: (tx: TxOperacao) => gravar(tx, ctxN.estabelecimento, ctxN.usuario ?? null),
      alvo: (_e, r: R) => ({ tabela: alvo, id: r.id }),
      trilha: () => ({ dados: trilha, motivo: null }),
    });
    const ctx: ContextoOperacao = { ...ctxN, chaveIdempotencia: chave };
    const { resultado } = await this.executor.executar(op, c.cliente, trilha, ctx);
    return resultado as R;
  }

  painel(c: ContextoPortaM18): Promise<PainelRomaneio> {
    const ctx = this.contexto(c);
    const est = ctx.estabelecimento;
    return this.nucleo.lerSomente(ctx, async (l) => {
      const hoje = await hojeDe(l);
      const romaneios = await l.consultar<Linha>(
        `${SQL_ROMANEIO} ORDER BY r.situacao = 'em_transito' DESC, r.numero DESC LIMIT ${LIMITE}`,
        naUnidade(est),
      );
      const locais = await l.consultar<Linha>(
        `SELECT id, nome FROM local_estoque WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL
          ORDER BY nome LIMIT ${LIMITE}`,
        [est],
      );
      const saldos = await l.consultar<Linha>(
        `SELECT s.local_estoque_id, s.insumo_id, i.nome, s.quantidade - s.quantidade_reservada AS livre
           FROM saldo_estoque s JOIN insumo i ON i.id = s.insumo_id
          WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL AND s.quantidade - s.quantidade_reservada > 0
          ORDER BY i.nome LIMIT 1000`,
        [est],
      );
      const destinos = await l.consultar<Linha>(
        `SELECT lo.id, lo.nome, e.nome_fantasia AS unidade FROM local_estoque lo JOIN estabelecimento e ON e.id = lo.estabelecimento_id
          WHERE lo.estabelecimento_id <> ? AND lo.ativo = TRUE AND lo.excluido_em IS NULL
          ORDER BY e.nome_fantasia, lo.nome LIMIT ${LIMITE}`,
        [est],
      );
      const motoristas = await l.consultar<Linha>(
        `SELECT m.id, m.versao, pf.nome, m.tipo_vinculo, m.numero_habilitacao,
                DATE_FORMAT(m.vencimento_habilitacao, '%Y-%m-%d') AS vencimento, m.transporta_controlado, m.situacao,
                m.motivo_inativacao, m.categoria_a, m.categoria_b, m.categoria_c, m.categoria_d, m.categoria_e,
                (SELECT ef.id FROM empresa_fornecedora ef WHERE ef.pessoa_juridica_id = m.empresa_pessoa_juridica_id
                    AND ef.excluido_em IS NULL ORDER BY ef.id LIMIT 1) AS transportadora
           FROM motorista m JOIN pessoa_fisica pf ON pf.id = m.pessoa_fisica_id
          WHERE m.estabelecimento_id = ? AND m.excluido_em IS NULL ORDER BY pf.nome LIMIT ${LIMITE}`,
        [est],
      );
      const veiculos = await l.consultar<Linha>(
        `SELECT id, versao, codigo, descricao, placa, proprio, transportadora_empresa_fornecedora_id, refrigerado,
                capacidade_carga_kg, ativo, motivo_inativacao
           FROM veiculo_entrega WHERE estabelecimento_id = ? OR estabelecimento_id IS NULL ORDER BY descricao LIMIT ${LIMITE}`,
        [est],
      );
      const transportadoras = await l.consultar<Linha>(
        `SELECT id, COALESCE(nome_fantasia, razao_social) AS nome FROM empresa_fornecedora
          WHERE situacao = 'ativo' AND excluido_em IS NULL AND tipo_pessoa = 'juridica' ORDER BY nome LIMIT 500`,
        [],
      );
      const transf = await l.consultar<Linha>(
        `SELECT d.id, d.numero, d.situacao, DATE_FORMAT(d.movimentado_em, '%Y-%m-%dT%H:%i') AS movimentado_em,
                lo.nome AS origem, ld.nome AS destino, e.nome_fantasia AS destino_unidade,
                (SELECT COUNT(*) FROM documento_estoque_item di WHERE di.documento_estoque_id = d.id AND di.excluido_em IS NULL) AS itens,
                (SELECT MAX(i.controlado) FROM documento_estoque_item di JOIN insumo i ON i.id = di.insumo_id
                  WHERE di.documento_estoque_id = d.id AND di.excluido_em IS NULL) AS controlado,
                (SELECT MAX(CASE WHEN ca.tipo = 'temperatura' AND ca.temperatura_maxima <= 8 THEN 1 ELSE 0 END)
                   FROM documento_estoque_item di JOIN insumo i ON i.id = di.insumo_id
                   LEFT JOIN condicao_armazenamento ca ON ca.id = i.condicao_armazenamento_id
                  WHERE di.documento_estoque_id = d.id AND di.excluido_em IS NULL) AS termolabil
           FROM documento_estoque d
           JOIN local_estoque lo ON lo.id = d.origem_local_estoque_id
           JOIN local_estoque ld ON ld.id = d.destino_local_estoque_id
           JOIN estabelecimento e ON e.id = ld.estabelecimento_id
          WHERE d.estabelecimento_id = ? AND d.tipo = 'transferencia' AND d.excluido_em IS NULL
            AND d.situacao = 'aberto' AND ld.estabelecimento_id <> d.estabelecimento_id AND NOT ${EM_ROMANEIO}
          ORDER BY d.id DESC LIMIT ${LIMITE}`,
        [est],
      );
      return {
        hoje,
        romaneios: romaneios.map(resumoDe),
        motoristas: motoristas.map((r) => ({
          id: n(r['id']),
          versao: n(r['versao']),
          nome: String(r['nome']),
          tipoVinculo: String(r['tipo_vinculo']) as 'proprio' | 'terceiro',
          transportadora: nn(r['transportadora']),
          numeroHabilitacao: String(r['numero_habilitacao']),
          categorias: categoriasDe(r),
          vencimentoHabilitacao: String(r['vencimento']),
          habilitacaoVencida: String(r['vencimento']) < hoje,
          transportaControlado: sim(r['transporta_controlado']),
          situacao: String(r['situacao']),
          motivoInativacao: tx_(r['motivo_inativacao']),
        })),
        veiculos: veiculos.map((r) => ({
          id: n(r['id']),
          versao: n(r['versao']),
          codigo: String(r['codigo']),
          descricao: String(r['descricao']),
          placa: String(r['placa']),
          proprio: sim(r['proprio']),
          transportadora: nn(r['transportadora_empresa_fornecedora_id']),
          refrigerado: sim(r['refrigerado']),
          capacidadeCargaKg: nn(r['capacidade_carga_kg']),
          ativo: sim(r['ativo']),
          motivoInativacao: tx_(r['motivo_inativacao']),
        })),
        transportadoras: transportadoras.map((r) => ({ id: n(r['id']), nome: String(r['nome']) })),
        transferencias: transf.map((r) => ({
          documento: n(r['id']),
          numero: String(r['numero'] ?? r['id']),
          situacao: String(r['situacao']),
          movimentadoEm: tx_(r['movimentado_em']),
          origem: String(r['origem']),
          destino: String(r['destino']),
          destinoUnidade: String(r['destino_unidade'] ?? ''),
          itens: n(r['itens']),
          controlado: sim(r['controlado']),
          termolabil: sim(r['termolabil']),
        })),
        locais: locais.map((r) => ({ id: n(r['id']), nome: String(r['nome']) })),
        saldos: saldos.map((r) => ({
          local: n(r['local_estoque_id']),
          item: n(r['insumo_id']),
          nome: String(r['nome']),
          livre: n(r['livre']),
        })),
        destinos: destinos.map((r) => ({
          id: n(r['id']),
          nome: String(r['nome']),
          unidade: String(r['unidade'] ?? ''),
        })),
      };
    });
  }

  detalhe(c: ContextoPortaM18, id: number): Promise<RomaneioDetalhe> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) => {
      const r = await l.uma<Linha>(`${SQL_ROMANEIO} AND r.id = ?`, [...naUnidade(ctx.estabelecimento), id]);
      if (!r) throw recusa('nao-encontrado', 'O romaneio não existe nesta unidade.');
      const itens = await l.consultar<Linha>(
        `SELECT i.id, i.sequencia, i.documento_estoque_id, d.numero AS numero_documento, d.situacao AS situacao_documento,
                e.nome_fantasia AS destino_unidade, lo.nome AS destino_local, i.quantidade_volumes, i.situacao,
                u.login AS recebedor, DATE_FORMAT(i.entregue_em, '%Y-%m-%dT%H:%i') AS entregue_em, i.observacao,
                (i.destino_estabelecimento_id = ?) AS destino_aqui
           FROM romaneio_entrega_item i
           JOIN estabelecimento e ON e.id = i.destino_estabelecimento_id
           LEFT JOIN documento_estoque d ON d.id = i.documento_estoque_id
           LEFT JOIN local_estoque lo ON lo.id = i.destino_local_estoque_id
           LEFT JOIN usuario u ON u.id = i.recebedor_usuario_id
          WHERE i.romaneio_entrega_id = ? AND i.excluido_em IS NULL ORDER BY i.sequencia`,
        [ctx.estabelecimento, id],
      );
      const documentos = itens
        .map((x) => nn(x['documento_estoque_id']))
        .filter((x): x is number => x !== null);
      const carga = await cargaDe(l, documentos);
      return {
        ...resumoDe(r),
        veiculoId: nn(r['veiculo_entrega_id']),
        motoristaId: nn(r['motorista_id']),
        transportadoraId: nn(r['transportadora_empresa_fornecedora_id']),
        quilometragemSaida: nn(r['quilometragem_saida']),
        quilometragemChegada: nn(r['quilometragem_chegada']),
        liberador: tx_(r['liberador']),
        conferente: tx_(r['conferente']),
        observacao: tx_(r['observacao']),
        levaControlado: carga.controlado,
        levaTermolabil: carga.termolabil,
        lista: itens.map((x) => ({
          id: n(x['id']),
          sequencia: n(x['sequencia']),
          documento: nn(x['documento_estoque_id']),
          numeroDocumento: tx_(x['numero_documento']),
          situacaoDocumento: tx_(x['situacao_documento']),
          destinoUnidade: String(x['destino_unidade'] ?? ''),
          destinoLocal: tx_(x['destino_local']),
          volumes: n(x['quantidade_volumes']),
          situacao: String(x['situacao']) as SituacaoItemRomaneio,
          recebedor: tx_(x['recebedor']),
          entregueEm: tx_(x['entregue_em']),
          observacao: tx_(x['observacao']),
          destinoAqui: sim(x['destino_aqui']),
        })),
      };
    });
  }

  gravarMotorista(
    c: ContextoPortaM18,
    e: MotoristaEntrada,
    alvo: { id: number; versao: number } | null,
    chave: string,
  ) {
    // A trilha leva só o que é do cadastro do motorista: nunca o nome nem o CPF.
    const trilha = {
      motorista: alvo?.id ?? null,
      tipoVinculo: e.tipoVinculo,
      categorias: [...e.categorias],
      transportaControlado: e.transportaControlado,
      ativo: e.ativo,
    };
    return this.executar(
      c,
      OPERACOES_ROMANEIO_ENTREGA.motorista,
      trilha,
      chave,
      async (tx, est) => {
        recusarTodas(conferirMotorista(e));
        let empresa: number | null = null;
        if (e.tipoVinculo === 'terceiro' && e.transportadora !== null) {
          empresa = (await transportadoraDe(tx, e.transportadora)).pessoaJuridica;
          if (empresa === null)
            throw recusa(
              'transportadora-sem-cadastro',
              'A transportadora não tem o cadastro único da pessoa jurídica: complete o fornecedor.',
              { campos: ['transportadora'] },
            );
        }
        const valores = {
          tipo_vinculo: e.tipoVinculo,
          empresa_pessoa_juridica_id: empresa,
          numero_habilitacao: e.numeroHabilitacao,
          categoria_a: e.categorias.includes('a'),
          categoria_b: e.categorias.includes('b'),
          categoria_c: e.categorias.includes('c'),
          categoria_d: e.categorias.includes('d'),
          categoria_e: e.categorias.includes('e'),
          vencimento_habilitacao: e.vencimentoHabilitacao,
          transporta_controlado: e.transportaControlado,
          situacao: e.ativo ? 'ativo' : 'inativo',
          motivo_inativacao: e.ativo ? null : (e.motivoInativacao?.trim() ?? null),
        };
        if (alvo) {
          const m = await tx.uma<Linha>(
            'SELECT id FROM motorista WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
            [alvo.id, est],
          );
          if (!m) throw recusa('motorista-inexistente', 'O motorista não existe nesta unidade.');
          await tx.alterar('motorista', alvo.id, alvo.versao, valores);
          return { id: alvo.id };
        }
        const cpf = somenteDigitos(e.cpf);
        const p = await tx.uma<Linha>('SELECT id FROM pessoa_fisica WHERE cpf = ? ORDER BY id LIMIT 1', [
          cpf,
        ]);
        const pessoa = p ? n(p['id']) : await tx.incluir('pessoa_fisica', { nome: e.nome.trim(), cpf });
        const ja = await tx.uma<Linha>(
          'SELECT id FROM motorista WHERE estabelecimento_id = ? AND pessoa_fisica_id = ?',
          [est, pessoa],
        );
        if (ja)
          throw recusa('motorista-duplicado', 'Esta pessoa já é motorista desta unidade.', {
            campos: ['cpf'],
          });
        const id = await tx.incluir('motorista', {
          estabelecimento_id: est,
          pessoa_fisica_id: pessoa,
          ...valores,
        });
        return { id };
      },
      'motorista',
    );
  }

  gravarVeiculo(
    c: ContextoPortaM18,
    e: VeiculoEntrada,
    alvo: { id: number; versao: number } | null,
    chave: string,
  ) {
    const placa = placaNormalizada(e.placa);
    const trilha = { veiculo: alvo?.id ?? null, ...e, placa };
    return this.executar(
      c,
      OPERACOES_ROMANEIO_ENTREGA.veiculo,
      trilha,
      chave,
      async (tx, est) => {
        recusarTodas(conferirVeiculo(e));
        if (!e.proprio && e.transportadora !== null) await transportadoraDe(tx, e.transportadora);
        const repetido = await tx.uma<Linha>(
          'SELECT id FROM veiculo_entrega WHERE (placa = ? OR codigo = ?) AND id <> ?',
          [placa, e.codigo.trim(), alvo?.id ?? 0],
        );
        if (repetido)
          throw recusa('veiculo-duplicado', 'Já existe veículo com esta placa ou este código.', {
            campos: ['placa', 'codigo'],
          });
        const valores = {
          codigo: e.codigo.trim(),
          descricao: e.descricao.trim(),
          placa,
          proprio: e.proprio,
          transportadora_empresa_fornecedora_id: e.proprio ? null : e.transportadora,
          refrigerado: e.refrigerado,
          capacidade_carga_kg: e.capacidadeCargaKg,
          ativo: e.ativo,
          motivo_inativacao: e.ativo ? null : (e.motivoInativacao?.trim() ?? null),
        };
        if (alvo) {
          const v = await tx.uma<Linha>(
            'SELECT id FROM veiculo_entrega WHERE id = ? AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)',
            [alvo.id, est],
          );
          if (!v) throw recusa('veiculo-inexistente', 'O veículo não existe nesta unidade.');
          await tx.alterar('veiculo_entrega', alvo.id, alvo.versao, valores);
          return { id: alvo.id };
        }
        return { id: await tx.incluir('veiculo_entrega', { ...valores, estabelecimento_id: est }) };
      },
      'veiculo_entrega',
    );
  }

  /** Confere o transporte escolhido (veículo, motorista e transportadora desta unidade). */
  private async conferirTransporte(tx: TxOperacao, est: number, t: Transporte) {
    const veiculo = t.veiculo === null ? null : await veiculoDe(tx, est, t.veiculo);
    const motorista = t.motorista === null ? null : await motoristaDe(tx, est, t.motorista);
    if (t.transportadora !== null) await transportadoraDe(tx, t.transportadora);
    return { veiculo, motorista };
  }

  montar(c: ContextoPortaM18, e: MontagemEntrada, chave: string) {
    const trilha = { ...e, documentos: [...e.documentos] };
    return this.executar(
      c,
      OPERACOES_ROMANEIO_ENTREGA.montar,
      trilha,
      chave,
      async (tx, est, usuario) => {
        const marcas = e.documentos.map(() => '?').join(', ');
        const docs = e.documentos.length
          ? await tx.consultarParaAtualizar<Linha>(
              `SELECT d.id, d.situacao, ld.id AS destino_local, ld.estabelecimento_id AS destino_estabelecimento,
                      ${EM_ROMANEIO} AS em_romaneio, (ld.estabelecimento_id <> d.estabelecimento_id) AS entre_unidades
                 FROM documento_estoque d JOIN local_estoque ld ON ld.id = d.destino_local_estoque_id
                WHERE d.id IN (${marcas}) AND d.estabelecimento_id = ?
                  AND d.tipo = 'transferencia' AND d.excluido_em IS NULL`,
              [...e.documentos, est],
            )
          : [];
        const transferencias: TransferenciaRomaneavel[] = docs.map((d) => ({
          documento: n(d['id']),
          situacaoDocumento: String(d['situacao']),
          emOutroRomaneio: sim(d['em_romaneio']),
          entreUnidades: sim(d['entre_unidades']),
        }));
        recusarTodas(conferirMontagem(e, transferencias));
        await this.conferirTransporte(tx, est, e);
        const maior = await tx.uma<Linha>(
          'SELECT COALESCE(MAX(numero), 0) AS maior FROM romaneio_entrega WHERE estabelecimento_id = ?',
          [est],
        );
        await garantirSequencia(
          tx,
          { tipo: 'romaneio_entrega', estabelecimento: est, inicio: n(maior?.['maior']) + 1 },
          { usuario, agora: new Date() },
        );
        const numero = (await tx.proximoNumero('romaneio_entrega')).valor;
        const id = await tx.incluir('romaneio_entrega', {
          estabelecimento_id: est,
          numero,
          descricao: e.descricao?.trim() || null,
          saida_prevista_em: e.saidaPrevista ? `${e.saidaPrevista.replace('T', ' ')}:00` : null,
          veiculo_entrega_id: e.veiculo,
          motorista_id: e.motorista,
          transportadora_empresa_fornecedora_id: e.transportadora,
          valor_frete: e.valorFrete,
          situacao: 'aberto',
          observacao: e.observacao?.trim() || null,
        });
        let sequencia = 0;
        for (const documento of e.documentos) {
          const d = docs.find((x) => n(x['id']) === documento)!;
          sequencia += 1;
          await tx.incluir('romaneio_entrega_item', {
            romaneio_entrega_id: id,
            sequencia,
            documento_estoque_id: documento,
            destino_estabelecimento_id: n(d['destino_estabelecimento']),
            destino_local_estoque_id: n(d['destino_local']),
            quantidade_volumes: 1,
            situacao: 'pendente',
          });
        }
        return { id, numero };
      },
      'romaneio_entrega',
    );
  }

  /**
   * O romaneio travado: o da unidade que expede (origem) ou, na conferência, o que traz item para a unidade da sessão
   * (a chegada é conferida por quem recebe).
   */
  private async romaneioTravado(tx: TxOperacao, est: number, id: number, chegada = false) {
    const [r] = await tx.consultarParaAtualizar<Linha>(
      chegada
        ? `SELECT r.id, r.versao, r.situacao, r.quilometragem_saida, r.observacao FROM romaneio_entrega r
            WHERE r.id = ? AND r.excluido_em IS NULL AND EXISTS (SELECT 1 FROM romaneio_entrega_item y
              WHERE y.romaneio_entrega_id = r.id AND y.excluido_em IS NULL AND y.destino_estabelecimento_id = ?)`
        : `SELECT id, versao, situacao, quilometragem_saida, observacao FROM romaneio_entrega
            WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [id, est],
    );
    if (!r) throw recusa('nao-encontrado', 'O romaneio não existe nesta unidade.');
    return {
      versao: n(r['versao']),
      situacao: String(r['situacao']) as SituacaoRomaneio,
      quilometragemSaida: nn(r['quilometragem_saida']),
      observacao: tx_(r['observacao']),
    };
  }

  private async itensTravados(tx: TxOperacao, id: number) {
    const rs = await tx.consultarParaAtualizar<Linha>(
      `SELECT id, versao, situacao, documento_estoque_id, destino_estabelecimento_id FROM romaneio_entrega_item
        WHERE romaneio_entrega_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
      [id],
    );
    return rs.map((r) => ({
      id: n(r['id']),
      versao: n(r['versao']),
      situacao: String(r['situacao']) as SituacaoItemRomaneio,
      documento: nn(r['documento_estoque_id']),
      destino: n(r['destino_estabelecimento_id']),
    }));
  }

  expedir(c: ContextoPortaM18, id: number, e: ExpedicaoEntrada, chave: string) {
    return this.executar(
      c,
      OPERACOES_ROMANEIO_ENTREGA.expedir,
      { romaneio: id, ...e },
      chave,
      async (tx, est, usuario) => {
        const r = await this.romaneioTravado(tx, est, id);
        if (r.versao !== e.versao)
          throw recusa('conflito-versao', 'O romaneio mudou desde a leitura: recarregue a tela.');
        const itens = await this.itensTravados(tx, id);
        const { veiculo, motorista } = await this.conferirTransporte(tx, est, e);
        const carga = await cargaDe(
          tx,
          itens.map((i) => i.documento).filter((x): x is number => x !== null),
        );
        recusarTodas(
          conferirExpedicao({
            situacao: r.situacao,
            itens: itens.length,
            veiculo,
            motorista,
            transportadora: e.transportadora,
            levaControlado: carga.controlado,
            levaTermolabil: carga.termolabil,
            quilometragemSaida: e.quilometragemSaida,
            hoje: await hojeDe(tx),
          }),
        );
        if (e.valorFrete !== null && !(e.valorFrete >= 0))
          throw recusa('romaneio-frete', 'O frete não pode ser negativo.', { campos: ['valorFrete'] });
        const agora = new Date();
        await tx.alterar('romaneio_entrega', id, e.versao, {
          veiculo_entrega_id: e.veiculo,
          motorista_id: e.motorista,
          transportadora_empresa_fornecedora_id: e.transportadora,
          valor_frete: e.valorFrete,
          quilometragem_saida: e.quilometragemSaida,
          liberador_usuario_id: usuario,
          liberado_em: agora,
          saida_em: agora,
          situacao: 'em_transito',
        });
        return { id };
      },
      'romaneio_entrega',
    );
  }

  conferir(c: ContextoPortaM18, id: number, e: ConferenciaEntrada, chave: string) {
    return this.executar(
      c,
      OPERACOES_ROMANEIO_ENTREGA.conferir,
      { romaneio: id, ...e, desfechos: e.desfechos.map((d) => ({ ...d })) },
      chave,
      async (tx, est, usuario) => {
        const r = await this.romaneioTravado(tx, est, id, true);
        if (r.versao !== e.versao)
          throw recusa('conflito-versao', 'O romaneio mudou desde a leitura: recarregue a tela.');
        const itens = await this.itensTravados(tx, id);
        // Cada unidade confere só o que chegou para ela.
        recusarTodas(
          conferirConferencia({
            situacao: r.situacao,
            itens: itens.filter((i) => i.destino === est),
            desfechos: e.desfechos,
            quilometragemSaida: r.quilometragemSaida,
            quilometragemChegada: e.quilometragemChegada,
          }),
        );
        const agora = new Date();
        const hoje = await hojeDe(tx);
        for (const d of e.desfechos) {
          const i = itens.find((x) => x.id === d.item)!;
          // O entregue dá o recebimento da transferência: sai da origem e entra no destino, na mesma transação. O não
          // entregue deixa o envio em aberto na origem, livre para outro romaneio ou para o cancelamento do envio.
          if (d.desfecho === 'entregue' && i.documento !== null)
            await receberEnvio(tx, i.documento, usuario, hoje);
          await tx.alterar('romaneio_entrega_item', i.id, i.versao, {
            situacao: d.desfecho,
            recebedor_usuario_id: d.desfecho === 'entregue' ? usuario : null,
            entregue_em: d.desfecho === 'entregue' ? agora : null,
            observacao: d.motivo?.trim() || null,
          });
        }
        const finais = itens.map((i) => e.desfechos.find((d) => d.item === i.id)?.desfecho ?? i.situacao);
        const situacao = situacaoAposConferencia(finais);
        await tx.alterar(
          'romaneio_entrega',
          id,
          e.versao,
          situacao === 'em_transito'
            ? { quilometragem_chegada: e.quilometragemChegada }
            : {
                situacao,
                chegada_em: agora,
                conferente_usuario_id: usuario,
                conferido_em: agora,
                quilometragem_chegada: e.quilometragemChegada,
              },
        );
        return { id, situacao };
      },
      'romaneio_entrega',
    );
  }

  cancelar(c: ContextoPortaM18, id: number, versao: number, motivo: string, chave: string) {
    return this.executar(
      c,
      OPERACOES_ROMANEIO_ENTREGA.cancelar,
      { romaneio: id, versao, motivo },
      chave,
      async (tx, est) => {
        const r = await this.romaneioTravado(tx, est, id);
        recusarTodas(conferirCancelamentoRomaneio(r.situacao, motivo));
        const nota = `Cancelado: ${motivo.trim()}`;
        await tx.alterar('romaneio_entrega', id, versao, {
          situacao: 'cancelado',
          observacao: (r.observacao ? `${r.observacao}\n${nota}` : nota).slice(0, 4000),
        });
        return { id };
      },
      'romaneio_entrega',
    );
  }
  enviar(c: ContextoPortaM18, e: EnvioEntrada, chave: string) {
    const trilha = { ...e, itens: e.itens.map((i) => ({ ...i })) };
    return this.executar(
      c,
      OPERACOES_ROMANEIO_ENTREGA.enviar,
      trilha,
      chave,
      async (tx, est, usuario) => {
        const hoje = await hojeDe(tx);
        await localDoEstabelecimento(tx, est, e.origem, 'origem');
        const destino = await tx.uma<Linha>(
          'SELECT id, estabelecimento_id FROM local_estoque WHERE id = ? AND ativo = TRUE AND excluido_em IS NULL',
          [e.destino],
        );
        recusarTodas(
          conferirEnvioEntreUnidades({
            origemUnidade: est,
            destinoUnidade: destino ? n(destino['estabelecimento_id']) : null,
            itens: e.itens,
          }),
        );
        await exigirMesAberto(tx, est, hoje);
        // O envio entre unidades é o documento de saída por transferência em aberto: o saldo só sai da origem na
        // conferência do romaneio (entregue), quando entra no local da outra unidade.
        const maior = await tx.uma<Linha>(
          'SELECT COALESCE(MAX(numero), 0) AS maior FROM documento_estoque WHERE estabelecimento_id = ?',
          [est],
        );
        await garantirSequencia(
          tx,
          { tipo: 'documento_estoque', estabelecimento: est, inicio: n(maior?.['maior']) + 1 },
          { usuario: usuario, agora: new Date() },
        );
        const numero = await tx.proximoNumero('documento_estoque');
        const id = await tx.incluir('documento_estoque', {
          estabelecimento_id: est,
          numero: numero.valor,
          tipo: 'transferencia',
          tipo_movimento_estoque_id: await tipoMovimentoId(tx, TIPO_MOVIMENTO.transferenciaSaida),
          origem_local_estoque_id: e.origem,
          destino_local_estoque_id: e.destino,
          movimentado_em: new Date(),
          consolidado: false,
          situacao: 'aberto',
          observacao: e.observacao?.trim() || null,
        });
        let sequencia = 0;
        for (const it of e.itens) {
          const insumo = await insumoAtivo(tx, it.item);
          await exigirLivre(tx, est, e.origem, it.item, it.quantidade, String(insumo['nome']));
          const lotes = await lotesDaSaida(
            tx,
            est,
            e.origem,
            insumo,
            it.quantidade,
            [],
            hoje,
            undefined,
            'libera',
          );
          const partes = lotes.length ? lotes : [{ id: null, quantidade: it.quantidade }];
          for (const l of partes) {
            const li = l.id
              ? await tx.uma<Linha>('SELECT validade FROM lote_insumo WHERE id = ?', [l.id])
              : null;
            await tx.incluir('documento_estoque_item', {
              documento_estoque_id: id,
              sequencia: ++sequencia,
              insumo_id: it.item,
              unidade_medida_id: n(insumo['estoque_unidade_medida_id']),
              quantidade: l.quantidade,
              lote_insumo_id: l.id,
              data_validade: li?.['validade'] ?? null,
            });
          }
        }
        return { id, numero: numero.valor };
      },
      'documento_estoque',
    );
  }

  cancelarEnvio(c: ContextoPortaM18, documento: number, motivo: string, chave: string) {
    return this.executar(
      c,
      OPERACOES_ROMANEIO_ENTREGA.cancelarEnvio,
      { documento, motivo },
      chave,
      async (tx, est) => {
        const [d] = await tx.consultarParaAtualizar<Linha>(
          `SELECT d.id, d.versao, d.situacao, d.observacao, ${EM_ROMANEIO} AS em_romaneio
             FROM documento_estoque d JOIN local_estoque ld ON ld.id = d.destino_local_estoque_id
            WHERE d.id = ? AND d.estabelecimento_id = ? AND d.tipo = 'transferencia' AND d.excluido_em IS NULL
              AND ld.estabelecimento_id <> d.estabelecimento_id`,
          [documento, est],
        );
        if (!d) throw recusa('envio-inexistente', 'O envio entre unidades não existe nesta unidade.');
        recusarTodas(
          conferirCancelamentoEnvio({
            situacaoDocumento: String(d['situacao']),
            emRomaneioAtivo: sim(d['em_romaneio']),
            motivo,
          }),
        );
        const nota = `Cancelado: ${motivo.trim()}`;
        await tx.alterar('documento_estoque', documento, n(d['versao']), {
          situacao: 'cancelado',
          observacao: (d['observacao'] ? `${String(d['observacao'])} | ${nota}` : nota).slice(0, 2000),
        });
        return { id: documento };
      },
      'documento_estoque',
    );
  }
}

/** O saldo livre (sem o reservado para a separação) do item no local basta para a quantidade. */
async function exigirLivre(
  tx: TxOperacao,
  est: number,
  local: number,
  insumo: number,
  quantidade: number,
  nome: string,
): Promise<void> {
  const s = await tx.uma<Linha>(
    `SELECT quantidade - quantidade_reservada AS livre FROM saldo_estoque
      WHERE local_estoque_id = ? AND insumo_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [local, insumo, est],
  );
  if (Math.round(n(s?.['livre']) * 10_000) < Math.round(quantidade * 10_000))
    throw recusa('saldo-insuficiente', `Saldo livre insuficiente na origem para o item ${nome}.`, {
      campos: ['itens'],
    });
}

/**
 * O recebimento do envio entre unidades, na conferência do item entregue: cada linha sai do local de origem (unidade
 * que enviou, pelo custo médio) e entra no local de destino (a outra unidade) pelo mesmo valor, com os lotes do envio;
 * o documento fica concluído com o recebedor. O mês tem de estar aberto nas duas unidades.
 */
async function receberEnvio(tx: TxOperacao, documento: number, usuario: number | null, hoje: string) {
  const [d] = await tx.consultarParaAtualizar<Linha>(
    `SELECT d.id, d.versao, d.situacao, d.estabelecimento_id, d.origem_local_estoque_id, d.destino_local_estoque_id,
            ld.estabelecimento_id AS destino_estabelecimento
       FROM documento_estoque d JOIN local_estoque ld ON ld.id = d.destino_local_estoque_id
      WHERE d.id = ? AND d.tipo = 'transferencia' AND d.excluido_em IS NULL`,
    [documento],
  );
  if (!d || d['situacao'] !== 'aberto')
    throw recusa('envio-recebido', `A transferência ${documento} já foi recebida ou cancelada.`);
  const origem = n(d['estabelecimento_id']);
  const destino = n(d['destino_estabelecimento']);
  await exigirMesAberto(tx, origem, hoje);
  await exigirMesAberto(tx, destino, hoje);
  const tipoSai = await tipoMovimentoId(tx, TIPO_MOVIMENTO.transferenciaSaida);
  const tipoEntra = await tipoMovimentoId(tx, TIPO_MOVIMENTO.transferenciaEntrada);
  const itens = await tx.consultarParaAtualizar<Linha>(
    `SELECT di.id, di.versao, di.insumo_id, di.quantidade, di.lote_insumo_id, i.nome
       FROM documento_estoque_item di JOIN insumo i ON i.id = di.insumo_id
      WHERE di.documento_estoque_id = ? AND di.excluido_em IS NULL ORDER BY di.sequencia`,
    [documento],
  );
  let total = 0;
  for (const it of itens) {
    const insumo = n(it['insumo_id']);
    const quantidade = n(it['quantidade']);
    const local = n(d['origem_local_estoque_id']);
    const alvo = n(d['destino_local_estoque_id']);
    await exigirLivre(tx, origem, local, insumo, quantidade, String(it['nome']));
    const lotes = it['lote_insumo_id'] ? [{ id: n(it['lote_insumo_id']), quantidade }] : [];
    const comum = { insumo, quantidade, lotes, hoje, documento, documentoItem: n(it['id']) };
    const sai = await movimentar(tx, origem, {
      ...comum,
      local,
      natureza: 'saida',
      tipoMovimento: tipoSai,
      contrapartida: alvo,
    });
    await movimentar(tx, destino, {
      ...comum,
      local: alvo,
      natureza: 'entrada',
      tipoMovimento: tipoEntra,
      valorEntrada: sai.valor,
      contrapartida: local,
    });
    total += sai.valor;
    await tx.alterar('documento_estoque_item', n(it['id']), n(it['versao']), {
      quantidade_atendida: quantidade,
      movimento_estoque_id: sai.id,
      valor_total: sai.valor,
      custo_unitario: quantidade > 0 ? Math.round((sai.valor / quantidade) * 1_000_000) / 1_000_000 : 0,
    });
  }
  const agora = new Date();
  await tx.alterar('documento_estoque', documento, n(d['versao']), {
    situacao: 'concluido',
    consolidado: true,
    movimentado_em: agora,
    concluido_em: agora,
    concluido_usuario_id: usuario,
    valor_total: Math.round(total * 100) / 100,
  });
}
