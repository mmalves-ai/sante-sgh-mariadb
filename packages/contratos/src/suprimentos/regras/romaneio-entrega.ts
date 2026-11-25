// Logística entre unidades (09-AREA linha 77): o romaneio de entrega que leva as transferências do estoque de uma unidade
// a outra, com o motorista, o veículo próprio ou a transportadora contratada e o frete. Ciclo: aberto (montagem) →
// em trânsito (expedição: liberação e saída no mesmo passo) → entregue ou entregue em parte (conferência por item na
// chegada). O cancelamento só vale antes da saída; nada é apagado (o item do romaneio cancelado pode ir em outro).
// Prática de mercado (logística hospitalar e normas de transporte de medicamentos da vigilância sanitária): motorista com
// habilitação válida na data da saída e categoria compatível com o veículo (acima de 3,5 t, C, D ou E); medicamento
// controlado só com motorista habilitado ao transporte de controlados; item termolábil só em baú refrigerado; o item não
// entregue (recusado, devolvido ou extraviado) leva o motivo; a quilometragem de chegada não fica abaixo da de saída.
// Funções puras: a gravação confere de novo com as linhas travadas.
import { cpfValido } from '../../validacao/cpf.js';
import { recusa, type RecusaSuprimentos } from './recusa.js';

export const SITUACOES_ROMANEIO = [
  'aberto',
  'liberado',
  'em_transito',
  'entregue',
  'entregue_parcial',
  'cancelado',
] as const;
export type SituacaoRomaneio = (typeof SITUACOES_ROMANEIO)[number];
export const SITUACOES_ITEM_ROMANEIO = [
  'pendente',
  'entregue',
  'recusado',
  'devolvido',
  'extraviado',
] as const;
export type SituacaoItemRomaneio = (typeof SITUACOES_ITEM_ROMANEIO)[number];
export const DESFECHOS_ITEM_ROMANEIO = ['entregue', 'recusado', 'devolvido', 'extraviado'] as const;
export type DesfechoItemRomaneio = (typeof DESFECHOS_ITEM_ROMANEIO)[number];
export const CATEGORIAS_HABILITACAO = ['a', 'b', 'c', 'd', 'e'] as const;
export type CategoriaHabilitacao = (typeof CATEGORIAS_HABILITACAO)[number];

/** Acima deste peso bruto o veículo pede habilitação C, D ou E. */
export const CARGA_MAXIMA_CATEGORIA_B_KG = 3500;
export const MOTIVO_MINIMO_ROMANEIO = 5;
export const ITENS_MAXIMOS_ROMANEIO = 200;

const PLACA = /^[A-Z]{3}\d[A-Z0-9]\d{2}$/;
const HABILITACAO = /^\d{11}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

export interface MotoristaEntrada {
  readonly nome: string;
  readonly cpf: string;
  readonly tipoVinculo: 'proprio' | 'terceiro';
  /** Transportadora do motorista terceiro (o cadastro único dela vem pela empresa fornecedora). */
  readonly transportadora: number | null;
  readonly numeroHabilitacao: string;
  readonly categorias: readonly CategoriaHabilitacao[];
  readonly vencimentoHabilitacao: string;
  readonly transportaControlado: boolean;
  readonly ativo: boolean;
  readonly motivoInativacao: string | null;
}

/** O cadastro do motorista conferido na hora (a tela mostra todas as recusas juntas). */
export function conferirMotorista(e: MotoristaEntrada): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (!e.nome.trim()) r.push(recusa('motorista-nome', 'Informe o nome do motorista.', ['nome']));
  if (!cpfValido(e.cpf)) r.push(recusa('motorista-cpf', 'O CPF do motorista não é válido.', ['cpf']));
  if (!HABILITACAO.test(e.numeroHabilitacao))
    r.push(recusa('motorista-habilitacao', 'O número da habilitação tem 11 dígitos.', ['numeroHabilitacao']));
  if (e.categorias.length === 0)
    r.push(recusa('motorista-categoria', 'Marque ao menos uma categoria da habilitação.', ['categorias']));
  if (!DATA.test(e.vencimentoHabilitacao))
    r.push(recusa('motorista-vencimento', 'Informe o vencimento da habilitação.', ['vencimentoHabilitacao']));
  if (e.tipoVinculo === 'terceiro' && e.transportadora === null)
    r.push(
      recusa('motorista-transportadora', 'O motorista terceiro pede a transportadora.', ['transportadora']),
    );
  if (!e.ativo && (e.motivoInativacao?.trim().length ?? 0) < MOTIVO_MINIMO_ROMANEIO)
    r.push(
      recusa('motorista-motivo', 'A inativação pede o motivo (ao menos 5 caracteres).', ['motivoInativacao']),
    );
  return r;
}

export interface VeiculoEntrada {
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

/** A placa em maiúsculas, sem hífen nem espaço (padrão antigo ABC1234 ou o do Mercosul ABC1D23). */
export const placaNormalizada = (p: string): string => p.toUpperCase().replace(/[\s-]/g, '');

export function conferirVeiculo(e: VeiculoEntrada): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (!e.codigo.trim()) r.push(recusa('veiculo-codigo', 'Informe o código do veículo.', ['codigo']));
  if (!e.descricao.trim())
    r.push(recusa('veiculo-descricao', 'Informe a descrição do veículo.', ['descricao']));
  if (!PLACA.test(placaNormalizada(e.placa)))
    r.push(recusa('veiculo-placa', 'A placa não segue o padrão (ABC1234 ou ABC1D23).', ['placa']));
  if (!e.proprio && e.transportadora === null)
    r.push(
      recusa('veiculo-transportadora', 'O veículo de terceiro pede a transportadora dona dele.', [
        'transportadora',
      ]),
    );
  if (e.capacidadeCargaKg !== null && !(e.capacidadeCargaKg > 0))
    r.push(recusa('veiculo-capacidade', 'A capacidade de carga é maior que zero.', ['capacidadeCargaKg']));
  if (!e.ativo && (e.motivoInativacao?.trim().length ?? 0) < MOTIVO_MINIMO_ROMANEIO)
    r.push(
      recusa('veiculo-motivo', 'A inativação pede o motivo (ao menos 5 caracteres).', ['motivoInativacao']),
    );
  return r;
}

/** A transferência do estoque candidata a item do romaneio, como a porta a lê. */
export interface TransferenciaRomaneavel {
  readonly documento: number;
  readonly situacaoDocumento: string;
  /** Já está em outro romaneio não cancelado com item pendente ou entregue. */
  readonly emOutroRomaneio: boolean;
}

export interface MontagemRomaneio {
  readonly documentos: readonly number[];
  readonly valorFrete: number | null;
}

/** A montagem: ao menos uma transferência, sem repetir, cada uma aberta ao envio e fora de outro romaneio ativo. */
export function conferirMontagem(
  e: MontagemRomaneio,
  transferencias: readonly TransferenciaRomaneavel[],
): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (e.documentos.length === 0)
    r.push(
      recusa('romaneio-sem-itens', 'Escolha ao menos uma transferência para o romaneio.', ['documentos']),
    );
  if (e.documentos.length > ITENS_MAXIMOS_ROMANEIO)
    r.push(recusa('romaneio-itens-demais', 'O romaneio leva até 200 transferências.', ['documentos']));
  if (new Set(e.documentos).size !== e.documentos.length)
    r.push(recusa('romaneio-item-repetido', 'A mesma transferência entrou duas vezes.', ['documentos']));
  for (const d of e.documentos) {
    const t = transferencias.find((x) => x.documento === d);
    if (!t) {
      r.push(
        recusa('romaneio-transferencia-inexistente', `A transferência ${d} não existe nesta unidade.`, [
          'documentos',
        ]),
      );
      continue;
    }
    if (t.situacaoDocumento === 'cancelado' || t.situacaoDocumento === 'estornado')
      r.push(
        recusa('romaneio-transferencia-cancelada', `A transferência ${d} foi cancelada ou estornada.`, [
          'documentos',
        ]),
      );
    if (t.emOutroRomaneio)
      r.push(
        recusa('romaneio-transferencia-em-outro', `A transferência ${d} já está em outro romaneio.`, [
          'documentos',
        ]),
      );
  }
  if (e.valorFrete !== null && !(e.valorFrete >= 0))
    r.push(recusa('romaneio-frete', 'O frete não pode ser negativo.', ['valorFrete']));
  return r;
}

export interface MotoristaExpedicao {
  readonly situacao: string;
  readonly vencimentoHabilitacao: string;
  readonly categorias: readonly CategoriaHabilitacao[];
  readonly transportaControlado: boolean;
}

export interface VeiculoExpedicao {
  readonly ativo: boolean;
  readonly proprio: boolean;
  readonly refrigerado: boolean;
  readonly capacidadeCargaKg: number | null;
}

export interface Expedicao {
  readonly situacao: SituacaoRomaneio;
  readonly itens: number;
  readonly veiculo: VeiculoExpedicao | null;
  readonly motorista: MotoristaExpedicao | null;
  readonly transportadora: number | null;
  readonly levaControlado: boolean;
  readonly levaTermolabil: boolean;
  readonly quilometragemSaida: number | null;
  /** Data civil da saída (AAAA-MM-DD). */
  readonly hoje: string;
}

/** A expedição (liberação e saída num passo só): transporte definido, motorista apto e carga compatível. */
export function conferirExpedicao(e: Expedicao): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (e.situacao !== 'aberto' && e.situacao !== 'liberado')
    return [recusa('romaneio-nao-aberto', 'Só o romaneio aberto pode ser expedido.')];
  if (e.itens === 0) r.push(recusa('romaneio-sem-itens', 'O romaneio não tem transferência para levar.'));
  if (e.veiculo === null && e.transportadora === null)
    r.push(
      recusa('romaneio-sem-transporte', 'Informe o veículo ou a transportadora contratada.', [
        'veiculo',
        'transportadora',
      ]),
    );
  if (e.veiculo && !e.veiculo.ativo)
    r.push(recusa('romaneio-veiculo-inativo', 'O veículo está inativo.', ['veiculo']));
  if (e.veiculo && e.motorista === null)
    r.push(recusa('romaneio-sem-motorista', 'O veículo pede o motorista.', ['motorista']));
  if (e.motorista) {
    const m = e.motorista;
    if (m.situacao !== 'ativo')
      r.push(recusa('romaneio-motorista-inativo', 'O motorista não está ativo.', ['motorista']));
    if (m.vencimentoHabilitacao < e.hoje)
      r.push(
        recusa('romaneio-habilitacao-vencida', 'A habilitação do motorista está vencida.', ['motorista']),
      );
    const pesado = (e.veiculo?.capacidadeCargaKg ?? 0) > CARGA_MAXIMA_CATEGORIA_B_KG;
    const aceitas: readonly CategoriaHabilitacao[] = pesado ? ['c', 'd', 'e'] : ['b', 'c', 'd', 'e'];
    if (e.veiculo && !m.categorias.some((c) => aceitas.includes(c)))
      r.push(
        recusa(
          'romaneio-categoria',
          pesado
            ? 'O veículo de mais de 3,5 t pede habilitação C, D ou E.'
            : 'O veículo pede habilitação B, C, D ou E.',
          ['motorista'],
        ),
      );
    if (e.levaControlado && !m.transportaControlado)
      r.push(
        recusa(
          'romaneio-controlado',
          'A carga tem medicamento controlado: o motorista precisa estar habilitado a esse transporte.',
          ['motorista'],
        ),
      );
  }
  if (e.levaTermolabil && e.veiculo && !e.veiculo.refrigerado)
    r.push(
      recusa('romaneio-termolabil', 'A carga tem item termolábil: escolha um veículo com baú refrigerado.', [
        'veiculo',
      ]),
    );
  if (e.quilometragemSaida !== null && !(Number.isInteger(e.quilometragemSaida) && e.quilometragemSaida >= 0))
    r.push(
      recusa('romaneio-quilometragem', 'A quilometragem de saída é um inteiro.', ['quilometragemSaida']),
    );
  return r;
}

export interface DesfechoItem {
  readonly item: number;
  readonly desfecho: DesfechoItemRomaneio;
  readonly motivo: string | null;
}

export interface Conferencia {
  readonly situacao: SituacaoRomaneio;
  readonly itens: readonly { readonly id: number; readonly situacao: SituacaoItemRomaneio }[];
  readonly desfechos: readonly DesfechoItem[];
  readonly quilometragemSaida: number | null;
  readonly quilometragemChegada: number | null;
}

/** A conferência na chegada, por item: só no romaneio em trânsito, item pendente, motivo no que não foi entregue. */
export function conferirConferencia(c: Conferencia): RecusaSuprimentos[] {
  if (c.situacao !== 'em_transito')
    return [recusa('romaneio-nao-em-transito', 'Só o romaneio em trânsito recebe a conferência.')];
  const r: RecusaSuprimentos[] = [];
  if (c.desfechos.length === 0)
    r.push(recusa('conferencia-vazia', 'Marque o desfecho de ao menos um item.', ['desfechos']));
  if (new Set(c.desfechos.map((d) => d.item)).size !== c.desfechos.length)
    r.push(recusa('conferencia-item-repetido', 'O mesmo item foi conferido duas vezes.', ['desfechos']));
  for (const d of c.desfechos) {
    const i = c.itens.find((x) => x.id === d.item);
    if (!i) r.push(recusa('conferencia-item-inexistente', `O item ${d.item} não é deste romaneio.`));
    else if (i.situacao !== 'pendente')
      r.push(recusa('conferencia-item-conferido', `O item ${d.item} já foi conferido.`));
    if (d.desfecho !== 'entregue' && (d.motivo?.trim().length ?? 0) < MOTIVO_MINIMO_ROMANEIO)
      r.push(
        recusa('conferencia-motivo', `O item ${d.item} não entregue pede o motivo (ao menos 5 caracteres).`, [
          'motivo',
        ]),
      );
  }
  if (c.quilometragemChegada !== null) {
    if (!Number.isInteger(c.quilometragemChegada) || c.quilometragemChegada < 0)
      r.push(
        recusa('conferencia-quilometragem', 'A quilometragem de chegada é um inteiro.', [
          'quilometragemChegada',
        ]),
      );
    else if (c.quilometragemSaida !== null && c.quilometragemChegada < c.quilometragemSaida)
      r.push(
        recusa(
          'conferencia-quilometragem',
          `A quilometragem de chegada não fica abaixo da de saída (${c.quilometragemSaida}).`,
          ['quilometragemChegada'],
        ),
      );
  }
  return r;
}

/** A situação do romaneio depois da conferência: em trânsito enquanto há item pendente; senão entregue ou em parte. */
export function situacaoAposConferencia(itens: readonly SituacaoItemRomaneio[]): SituacaoRomaneio {
  if (itens.some((s) => s === 'pendente')) return 'em_transito';
  return itens.every((s) => s === 'entregue') ? 'entregue' : 'entregue_parcial';
}

/** O cancelamento: só antes da saída e com o motivo. */
export function conferirCancelamentoRomaneio(
  situacao: SituacaoRomaneio,
  motivo: string,
): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (situacao !== 'aberto' && situacao !== 'liberado')
    r.push(recusa('romaneio-nao-cancelavel', 'Depois da saída o romaneio não se cancela: confira os itens.'));
  if (motivo.trim().length < MOTIVO_MINIMO_ROMANEIO)
    r.push(recusa('romaneio-motivo', 'O cancelamento pede o motivo (ao menos 5 caracteres).', ['motivo']));
  return r;
}
