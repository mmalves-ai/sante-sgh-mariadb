<script setup lang="ts">
// Romaneio de entrega entre unidades (C1-120, 09-AREA linha 77): `/suprimentos/romaneios`. Numa tela só, quem expede
// junta as transferências que aguardam transporte (destino e cuidados à vista: controlado e termolábil), escolhe o
// veículo, o motorista, a transportadora e o frete e expede; na chegada, confere item a item (o que não foi entregue
// leva o motivo). O cadastro do motorista (CPF, habilitação, categorias, vencimento) e do veículo (placa nos padrões
// antigo e Mercosul, refrigerado, capacidade) fica nas abas ao lado. Cada passo é conferido na hora pela mesma regra do
// domínio que a API confere de novo antes de gravar. Nada é apagado: o cancelado e o inativo ficam no histórico.
import {
  type CategoriaHabilitacao,
  CATEGORIAS_HABILITACAO,
  conferirCancelamentoRomaneio,
  conferirConferencia,
  conferirExpedicao,
  conferirMontagem,
  conferirMotorista,
  conferirVeiculo,
  DESFECHOS_ITEM_ROMANEIO,
  type DesfechoItemRomaneio,
  type RecusaSuprimentos,
} from '@sgh/contratos/regras-suprimentos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, onMounted, reactive, ref } from 'vue';
import {
  cancelarRomaneio,
  conferirRomaneio,
  expedirRomaneio,
  gravarMotorista,
  gravarVeiculo,
  lerPainelRomaneio,
  lerRomaneio,
  montarRomaneio,
  type MotoristaTela,
  type PainelRomaneioTela,
  type RomaneioDetalheTela,
  type VeiculoTela,
} from '../api-romaneio.js';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { mensagensRomaneio as M, rotulosSituacaoRomaneio as S } from '../i18n-romaneio.js';
import { reais } from '../usar-suprimentos.js';

type Chave = keyof typeof M;
const k = (chave: Chave, p: Record<string, string | number> = {}): string =>
  M[chave].replace(/\{(\w+)\}/g, (_x, n: string) => String(p[n] ?? ''));

type Aba = 'romaneios' | 'montar' | 'motoristas' | 'veiculos';
const ABAS: readonly { id: Aba; rotulo: Chave }[] = [
  { id: 'romaneios', rotulo: 'abaRomaneios' },
  { id: 'montar', rotulo: 'abaMontar' },
  { id: 'motoristas', rotulo: 'abaMotoristas' },
  { id: 'veiculos', rotulo: 'abaVeiculos' },
];
const aba = ref<Aba>('romaneios');
const painel = ref<PainelRomaneioTela | null>(null);
const detalhe = ref<RomaneioDetalheTela | null>(null);
const carregando = ref(true);
const gravando = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);

const numeroOuNulo = (s: string): number | null =>
  s.trim() === '' ? null : Number(s.replace(/\./g, '').replace(',', '.'));
const idOuNulo = (s: string): number | null => (s ? Number(s) : null);
const dataHora = (v: string | null): string => (v ? new Date(v).toLocaleString('pt-BR') : '');

async function recarregar(): Promise<void> {
  try {
    painel.value = await lerPainelRomaneio();
    if (detalhe.value) detalhe.value = await lerRomaneio(detalhe.value.id);
  } catch (x) {
    erro.value = x;
  } finally {
    carregando.value = false;
  }
}
onMounted(recarregar);

async function executar(acao: () => Promise<{ mensagem: string }>, depois?: () => void): Promise<void> {
  gravando.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    mensagem.value = (await acao()).mensagem;
    depois?.();
    await recarregar();
  } catch (x) {
    erro.value = x;
  } finally {
    gravando.value = false;
  }
}

// ---- opções dos combos ----
const opcoesTransportadora = computed(() => [
  { valor: '', rotulo: k('nenhum') },
  ...(painel.value?.transportadoras ?? []).map((t) => ({ valor: String(t.id), rotulo: t.nome })),
]);
const opcoesVeiculo = computed(() => [
  { valor: '', rotulo: k('escolha') },
  ...(painel.value?.veiculos ?? [])
    .filter((v) => v.ativo)
    .map((v) => ({
      valor: String(v.id),
      rotulo: `${v.placa} · ${v.descricao}${v.refrigerado ? ` · ${k('refrigerado')}` : ''}`,
    })),
]);
const opcoesMotorista = computed(() => [
  { valor: '', rotulo: k('escolha') },
  ...(painel.value?.motoristas ?? [])
    .filter((m) => m.situacao === 'ativo')
    .map((m) => ({
      valor: String(m.id),
      rotulo: `${m.nome} · ${m.categorias.join('').toUpperCase()}${m.habilitacaoVencida ? ` · ${k('vencida')}` : ''}`,
    })),
]);

// ---- transporte comum à montagem e à expedição ----
const transporte = reactive({ veiculo: '', motorista: '', transportadora: '', frete: '' });
const transporteEntrada = () => ({
  veiculo: idOuNulo(transporte.veiculo),
  motorista: idOuNulo(transporte.motorista),
  transportadora: idOuNulo(transporte.transportadora),
  valorFrete: numeroOuNulo(transporte.frete),
});

// ---- montagem ----
const montagem = reactive({
  documentos: [] as number[],
  descricao: '',
  saidaPrevista: '',
  observacao: '',
});
const recusasMontagem = computed<RecusaSuprimentos[]>(() =>
  conferirMontagem(
    { documentos: montagem.documentos, valorFrete: numeroOuNulo(transporte.frete) },
    (painel.value?.transferencias ?? []).map((t) => ({
      documento: t.documento,
      situacaoDocumento: t.situacao,
      emOutroRomaneio: false,
    })),
  ),
);
function montar(): void {
  if (recusasMontagem.value.length) return;
  void executar(
    () =>
      montarRomaneio({
        ...transporteEntrada(),
        documentos: [...montagem.documentos],
        descricao: montagem.descricao.trim() || null,
        saidaPrevista: montagem.saidaPrevista || null,
        observacao: montagem.observacao.trim() || null,
      }),
    () => {
      montagem.documentos = [];
      montagem.descricao = '';
      montagem.observacao = '';
      aba.value = 'romaneios';
    },
  );
}

// ---- detalhe: expedição, conferência e cancelamento ----
const kmSaida = ref('');
const kmChegada = ref('');
const motivoCancelamento = ref('');
const desfechos = reactive<Record<number, { desfecho: string; motivo: string }>>({});

async function abrir(id: number): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    const d = await lerRomaneio(id);
    detalhe.value = d;
    transporte.veiculo = d.veiculoId ? String(d.veiculoId) : '';
    transporte.motorista = d.motoristaId ? String(d.motoristaId) : '';
    transporte.transportadora = d.transportadoraId ? String(d.transportadoraId) : '';
    transporte.frete = d.valorFrete === null ? '' : String(d.valorFrete).replace('.', ',');
    kmSaida.value = '';
    kmChegada.value = '';
    motivoCancelamento.value = '';
    for (const i of d.lista) desfechos[i.id] = { desfecho: '', motivo: '' };
  } catch (x) {
    erro.value = x;
  }
}

const recusasExpedicao = computed<RecusaSuprimentos[]>(() => {
  const d = detalhe.value;
  if (!d || !painel.value) return [];
  const v = painel.value.veiculos.find((x) => String(x.id) === transporte.veiculo);
  const m = painel.value.motoristas.find((x) => String(x.id) === transporte.motorista);
  return conferirExpedicao({
    situacao: d.situacao,
    itens: d.lista.length,
    veiculo: v
      ? {
          ativo: v.ativo,
          proprio: v.proprio,
          refrigerado: v.refrigerado,
          capacidadeCargaKg: v.capacidadeCargaKg,
        }
      : null,
    motorista: m
      ? {
          situacao: m.situacao,
          vencimentoHabilitacao: m.vencimentoHabilitacao,
          categorias: m.categorias,
          transportaControlado: m.transportaControlado,
        }
      : null,
    transportadora: idOuNulo(transporte.transportadora),
    levaControlado: d.levaControlado,
    levaTermolabil: d.levaTermolabil,
    quilometragemSaida: numeroOuNulo(kmSaida.value),
    hoje: painel.value.hoje,
  });
});
function expedir(): void {
  const d = detalhe.value;
  if (!d || recusasExpedicao.value.length) return;
  void executar(() =>
    expedirRomaneio(d.id, {
      versao: d.versao,
      quilometragemSaida: numeroOuNulo(kmSaida.value),
      ...transporteEntrada(),
    }),
  );
}

const desfechosEntrada = computed(() =>
  Object.entries(desfechos)
    .filter(([, v]) => v.desfecho)
    .map(([item, v]) => ({
      item: Number(item),
      desfecho: v.desfecho as DesfechoItemRomaneio,
      motivo: v.motivo.trim() || null,
    })),
);
const recusasConferencia = computed<RecusaSuprimentos[]>(() => {
  const d = detalhe.value;
  if (!d || d.situacao !== 'em_transito') return [];
  return conferirConferencia({
    situacao: d.situacao,
    itens: d.lista.map((i) => ({ id: i.id, situacao: i.situacao })),
    desfechos: desfechosEntrada.value,
    quilometragemSaida: d.quilometragemSaida,
    quilometragemChegada: numeroOuNulo(kmChegada.value),
  });
});
const opcoesDesfecho = [
  { valor: '', rotulo: k('escolha') },
  ...DESFECHOS_ITEM_ROMANEIO.map((d) => ({ valor: d, rotulo: S[d] ?? d })),
];
function conferir(): void {
  const d = detalhe.value;
  if (!d || recusasConferencia.value.length) return;
  void executar(() =>
    conferirRomaneio(d.id, {
      versao: d.versao,
      quilometragemChegada: numeroOuNulo(kmChegada.value),
      desfechos: desfechosEntrada.value,
    }),
  );
}

const recusasCancelamento = computed<RecusaSuprimentos[]>(() =>
  detalhe.value ? conferirCancelamentoRomaneio(detalhe.value.situacao, motivoCancelamento.value) : [],
);
function cancelar(): void {
  const d = detalhe.value;
  if (!d || recusasCancelamento.value.length) return;
  void executar(() => cancelarRomaneio(d.id, { versao: d.versao, motivo: motivoCancelamento.value.trim() }));
}

// ---- cadastro do motorista ----
const motoristaVazio = () => ({
  id: 0,
  versao: 0,
  nome: '',
  cpf: '',
  tipoVinculo: 'proprio' as 'proprio' | 'terceiro',
  transportadora: '',
  numeroHabilitacao: '',
  categorias: [] as CategoriaHabilitacao[],
  vencimentoHabilitacao: '',
  transportaControlado: false,
  ativo: true,
  motivoInativacao: '',
});
const motorista = reactive(motoristaVazio());
const motoristaEntrada = () => ({
  nome: motorista.nome.trim(),
  cpf: motorista.cpf.replace(/\D/g, ''),
  tipoVinculo: motorista.tipoVinculo,
  transportadora: idOuNulo(motorista.transportadora),
  numeroHabilitacao: motorista.numeroHabilitacao.trim(),
  categorias: [...motorista.categorias],
  vencimentoHabilitacao: motorista.vencimentoHabilitacao,
  transportaControlado: motorista.transportaControlado,
  ativo: motorista.ativo,
  motivoInativacao: motorista.motivoInativacao.trim() || null,
});
const recusasMotorista = computed(() => conferirMotorista(motoristaEntrada()));
function editarMotorista(m: MotoristaTela): void {
  Object.assign(motorista, motoristaVazio(), {
    id: m.id,
    versao: m.versao,
    nome: m.nome,
    tipoVinculo: m.tipoVinculo,
    transportadora: m.transportadora ? String(m.transportadora) : '',
    numeroHabilitacao: m.numeroHabilitacao,
    categorias: [...m.categorias],
    vencimentoHabilitacao: m.vencimentoHabilitacao,
    transportaControlado: m.transportaControlado,
    ativo: m.situacao === 'ativo',
    motivoInativacao: m.motivoInativacao ?? '',
  });
}
function gravarOMotorista(): void {
  if (recusasMotorista.value.length) return;
  const alvo = motorista.id ? { id: motorista.id, versao: motorista.versao } : null;
  void executar(
    () => gravarMotorista(motoristaEntrada(), alvo),
    () => Object.assign(motorista, motoristaVazio()),
  );
}

// ---- cadastro do veículo ----
const veiculoVazio = () => ({
  id: 0,
  versao: 0,
  codigo: '',
  descricao: '',
  placa: '',
  proprio: true,
  transportadora: '',
  refrigerado: false,
  capacidade: '',
  ativo: true,
  motivoInativacao: '',
});
const veiculo = reactive(veiculoVazio());
const veiculoEntrada = () => ({
  codigo: veiculo.codigo.trim(),
  descricao: veiculo.descricao.trim(),
  placa: veiculo.placa.trim(),
  proprio: veiculo.proprio,
  transportadora: idOuNulo(veiculo.transportadora),
  refrigerado: veiculo.refrigerado,
  capacidadeCargaKg: numeroOuNulo(veiculo.capacidade),
  ativo: veiculo.ativo,
  motivoInativacao: veiculo.motivoInativacao.trim() || null,
});
const recusasVeiculo = computed(() => conferirVeiculo(veiculoEntrada()));
function editarVeiculo(v: VeiculoTela): void {
  Object.assign(veiculo, veiculoVazio(), {
    id: v.id,
    versao: v.versao,
    codigo: v.codigo,
    descricao: v.descricao,
    placa: v.placa,
    proprio: v.proprio,
    transportadora: v.transportadora ? String(v.transportadora) : '',
    refrigerado: v.refrigerado,
    capacidade: v.capacidadeCargaKg === null ? '' : String(v.capacidadeCargaKg),
    ativo: v.ativo,
    motivoInativacao: v.motivoInativacao ?? '',
  });
}
function gravarOVeiculo(): void {
  if (recusasVeiculo.value.length) return;
  const alvo = veiculo.id ? { id: veiculo.id, versao: veiculo.versao } : null;
  void executar(
    () => gravarVeiculo(veiculoEntrada(), alvo),
    () => Object.assign(veiculo, veiculoVazio()),
  );
}
const opcoesVinculo = [
  { valor: 'proprio', rotulo: k('proprio') },
  { valor: 'terceiro', rotulo: k('terceiro') },
];
const opcoesFrota = [
  { valor: 'sim', rotulo: k('propria') },
  { valor: 'nao', rotulo: k('terceiro') },
];
</script>

<template>
  <section class="tela-agenda" aria-labelledby="romaneio-titulo" data-testid="tela-romaneios">
    <h1 id="romaneio-titulo">{{ k('titulo') }}</h1>
    <p>{{ k('texto') }}</p>
    <ErroSuprimentos :erro="erro" />
    <p v-if="mensagem" role="status" data-testid="romaneio-mensagem">{{ mensagem }}</p>
    <p v-if="carregando">{{ k('carregando') }}</p>

    <div role="tablist" class="filtros">
      <SanteBotao
        v-for="a in ABAS"
        :key="a.id"
        role="tab"
        :aria-selected="aba === a.id"
        :variante="aba === a.id ? 'primario' : 'secundario'"
        :rotulo="k(a.rotulo)"
        :data-testid="`romaneio-aba-${a.id}`"
        @click="aba = a.id"
      />
    </div>

    <template v-if="painel">
      <!-- Romaneios -->
      <div v-if="aba === 'romaneios'" role="tabpanel">
        <p v-if="painel.romaneios.length === 0" class="secundario" data-testid="romaneio-vazio">
          {{ k('semRomaneio') }}
        </p>
        <table v-else class="tabela" data-testid="romaneio-lista">
          <thead>
            <tr>
              <th scope="col">{{ k('numero') }}</th>
              <th scope="col">{{ k('situacao') }}</th>
              <th scope="col">{{ k('veiculo') }}</th>
              <th scope="col">{{ k('motorista') }}</th>
              <th scope="col">{{ k('itens') }}</th>
              <th scope="col">{{ k('pendentes') }}</th>
              <th scope="col">{{ k('saida') }}</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in painel.romaneios" :key="r.id" :data-testid="`romaneio-linha-${r.numero}`">
              <td>{{ r.numero }}</td>
              <td>{{ S[r.situacao] ?? r.situacao }}</td>
              <td>{{ r.veiculo ?? '' }}</td>
              <td>{{ r.motorista ?? '' }}</td>
              <td>{{ r.itens }}</td>
              <td>{{ r.pendentes }}</td>
              <td>{{ dataHora(r.saidaEm ?? r.saidaPrevistaEm) }}</td>
              <td>
                <SanteBotao
                  variante="secundario"
                  :rotulo="k('abrir')"
                  :data-testid="`romaneio-abrir-${r.numero}`"
                  @click="abrir(r.id)"
                />
              </td>
            </tr>
          </tbody>
        </table>

        <article v-if="detalhe" class="painel" data-testid="romaneio-detalhe">
          <h2>
            {{ k('detalhe', { numero: detalhe.numero }) }} · {{ S[detalhe.situacao] ?? detalhe.situacao }}
          </h2>
          <p v-if="detalhe.levaControlado" class="secundario">{{ k('levaControlado') }}</p>
          <p v-if="detalhe.levaTermolabil" class="secundario">{{ k('levaTermolabil') }}</p>
          <p v-if="detalhe.liberador" class="secundario">{{ k('liberador') }}: {{ detalhe.liberador }}</p>
          <p v-if="detalhe.conferente" class="secundario">{{ k('conferente') }}: {{ detalhe.conferente }}</p>
          <p v-if="detalhe.valorFrete !== null" class="secundario">
            {{ k('frete') }}: {{ reais(detalhe.valorFrete) }}
          </p>

          <!-- Expedição: aberto ou liberado -->
          <form
            v-if="detalhe.situacao === 'aberto' || detalhe.situacao === 'liberado'"
            class="filtros"
            data-testid="romaneio-expedicao"
            @submit.prevent="expedir"
          >
            <SanteSelecao
              v-model="transporte.veiculo"
              :rotulo="k('veiculo')"
              :opcoes="opcoesVeiculo"
              data-testid="romaneio-exp-veiculo"
            />
            <SanteSelecao
              v-model="transporte.motorista"
              :rotulo="k('motorista')"
              :opcoes="opcoesMotorista"
              data-testid="romaneio-exp-motorista"
            />
            <SanteSelecao
              v-model="transporte.transportadora"
              :rotulo="k('transportadora')"
              :opcoes="opcoesTransportadora"
              data-testid="romaneio-exp-transportadora"
            />
            <span class="campo">
              <label for="romaneio-exp-frete">{{ k('frete') }}</label>
              <input id="romaneio-exp-frete" v-model="transporte.frete" inputmode="decimal" />
            </span>
            <span class="campo">
              <label for="romaneio-km-saida">{{ k('kmSaida') }}</label>
              <input
                id="romaneio-km-saida"
                v-model="kmSaida"
                inputmode="numeric"
                data-testid="romaneio-km-saida"
              />
            </span>
            <SanteBotao
              tipo="submit"
              :rotulo="k('expedir')"
              :desabilitado="gravando || recusasExpedicao.length > 0"
              data-testid="romaneio-expedir"
            />
          </form>
          <ul v-if="recusasExpedicao.length" role="alert" data-testid="romaneio-recusas-expedicao">
            <li v-for="r in recusasExpedicao" :key="r.codigo">{{ r.mensagem }}</li>
          </ul>

          <table class="tabela" data-testid="romaneio-itens">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">{{ k('transferencia') }}</th>
                <th scope="col">{{ k('destino') }}</th>
                <th scope="col">{{ k('situacao') }}</th>
                <th scope="col">{{ k('recebedor') }}</th>
                <th v-if="detalhe.situacao === 'em_transito'" scope="col">{{ k('desfecho') }}</th>
                <th v-if="detalhe.situacao === 'em_transito'" scope="col">{{ k('motivo') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="i in detalhe.lista" :key="i.id" :data-testid="`romaneio-item-${i.sequencia}`">
                <td>{{ i.sequencia }}</td>
                <td>{{ i.numeroDocumento ?? '' }}</td>
                <td>{{ i.destinoUnidade }}{{ i.destinoLocal ? ` · ${i.destinoLocal}` : '' }}</td>
                <td>{{ S[i.situacao] ?? i.situacao }}</td>
                <td>{{ i.recebedor ?? '' }} {{ dataHora(i.entregueEm) }}</td>
                <template v-if="detalhe.situacao === 'em_transito'">
                  <td>
                    <SanteSelecao
                      v-if="i.situacao === 'pendente' && desfechos[i.id]"
                      v-model="desfechos[i.id]!.desfecho"
                      :rotulo="k('desfecho')"
                      ocultar-rotulo
                      :opcoes="opcoesDesfecho"
                      :data-testid="`romaneio-desfecho-${i.sequencia}`"
                    />
                  </td>
                  <td>
                    <input
                      v-if="i.situacao === 'pendente' && desfechos[i.id]"
                      v-model="desfechos[i.id]!.motivo"
                      :aria-label="k('motivo')"
                      :data-testid="`romaneio-motivo-${i.sequencia}`"
                    />
                  </td>
                </template>
              </tr>
            </tbody>
          </table>

          <!-- Conferência na chegada: em trânsito -->
          <form
            v-if="detalhe.situacao === 'em_transito'"
            class="filtros"
            data-testid="romaneio-conferencia"
            @submit.prevent="conferir"
          >
            <span class="campo">
              <label for="romaneio-km-chegada">{{ k('kmChegada') }}</label>
              <input
                id="romaneio-km-chegada"
                v-model="kmChegada"
                inputmode="numeric"
                data-testid="romaneio-km-chegada"
              />
            </span>
            <SanteBotao
              tipo="submit"
              :rotulo="k('conferir')"
              :desabilitado="gravando || desfechosEntrada.length === 0 || recusasConferencia.length > 0"
              data-testid="romaneio-conferir"
            />
          </form>
          <ul
            v-if="desfechosEntrada.length && recusasConferencia.length"
            role="alert"
            data-testid="romaneio-recusas-conferencia"
          >
            <li v-for="r in recusasConferencia" :key="r.codigo">{{ r.mensagem }}</li>
          </ul>

          <!-- Cancelamento: só antes da saída -->
          <form
            v-if="detalhe.situacao === 'aberto' || detalhe.situacao === 'liberado'"
            class="filtros"
            data-testid="romaneio-cancelamento"
            @submit.prevent="cancelar"
          >
            <span class="campo">
              <label for="romaneio-motivo-cancelamento">{{ k('motivoCancelamento') }}</label>
              <input
                id="romaneio-motivo-cancelamento"
                v-model="motivoCancelamento"
                data-testid="romaneio-motivo-cancelamento"
              />
            </span>
            <SanteBotao
              tipo="submit"
              variante="secundario"
              :rotulo="k('cancelar')"
              :desabilitado="gravando || recusasCancelamento.length > 0"
              data-testid="romaneio-cancelar"
            />
          </form>
          <SanteBotao variante="secundario" :rotulo="k('fechar')" @click="detalhe = null" />
        </article>
      </div>

      <!-- Montagem -->
      <div v-else-if="aba === 'montar'" role="tabpanel" data-testid="romaneio-montagem">
        <p
          v-if="painel.transferencias.length === 0"
          class="secundario"
          data-testid="romaneio-sem-transferencia"
        >
          {{ k('semTransferencia') }}
        </p>
        <table v-else class="tabela" data-testid="romaneio-transferencias">
          <thead>
            <tr>
              <th scope="col"></th>
              <th scope="col">{{ k('transferencia') }}</th>
              <th scope="col">{{ k('origem') }}</th>
              <th scope="col">{{ k('destino') }}</th>
              <th scope="col">{{ k('itens') }}</th>
              <th scope="col">{{ k('cuidados') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in painel.transferencias" :key="t.documento">
              <td>
                <input
                  v-model="montagem.documentos"
                  type="checkbox"
                  :value="t.documento"
                  :aria-label="`${k('transferencia')} ${t.numero}`"
                  :data-testid="`romaneio-transferencia-${t.numero}`"
                />
              </td>
              <td>{{ t.numero }}</td>
              <td>{{ t.origem }}</td>
              <td>{{ t.destinoUnidade }} · {{ t.destino }}</td>
              <td>{{ t.itens }}</td>
              <td>
                {{
                  [t.controlado ? k('controlado') : '', t.termolabil ? k('termolabil') : '']
                    .filter(Boolean)
                    .join(', ')
                }}
              </td>
            </tr>
          </tbody>
        </table>
        <p class="secundario">{{ k('selecionadas', { n: montagem.documentos.length }) }}</p>
        <form class="filtros" @submit.prevent="montar">
          <span class="campo">
            <label for="romaneio-descricao">{{ k('descricao') }}</label>
            <input id="romaneio-descricao" v-model="montagem.descricao" data-testid="romaneio-descricao" />
          </span>
          <span class="campo">
            <label for="romaneio-saida-prevista">{{ k('saidaPrevista') }}</label>
            <input id="romaneio-saida-prevista" v-model="montagem.saidaPrevista" type="datetime-local" />
          </span>
          <SanteSelecao
            v-model="transporte.veiculo"
            :rotulo="k('veiculo')"
            :opcoes="opcoesVeiculo"
            data-testid="romaneio-veiculo"
          />
          <SanteSelecao
            v-model="transporte.motorista"
            :rotulo="k('motorista')"
            :opcoes="opcoesMotorista"
            data-testid="romaneio-motorista"
          />
          <SanteSelecao
            v-model="transporte.transportadora"
            :rotulo="k('transportadora')"
            :opcoes="opcoesTransportadora"
            data-testid="romaneio-transportadora"
          />
          <span class="campo">
            <label for="romaneio-frete">{{ k('frete') }}</label>
            <input
              id="romaneio-frete"
              v-model="transporte.frete"
              inputmode="decimal"
              data-testid="romaneio-frete"
            />
          </span>
          <span class="campo">
            <label for="romaneio-observacao">{{ k('observacao') }}</label>
            <input id="romaneio-observacao" v-model="montagem.observacao" />
          </span>
          <SanteBotao
            tipo="submit"
            :rotulo="k('montar')"
            :desabilitado="gravando || recusasMontagem.length > 0"
            data-testid="romaneio-montar"
          />
        </form>
        <ul v-if="montagem.documentos.length && recusasMontagem.length" role="alert">
          <li v-for="r in recusasMontagem" :key="r.codigo">{{ r.mensagem }}</li>
        </ul>
      </div>

      <!-- Motoristas -->
      <div v-else-if="aba === 'motoristas'" role="tabpanel" data-testid="romaneio-motoristas">
        <table class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ k('nome') }}</th>
              <th scope="col">{{ k('vinculo') }}</th>
              <th scope="col">{{ k('categorias') }}</th>
              <th scope="col">{{ k('vencimento') }}</th>
              <th scope="col">{{ k('transportaControlado') }}</th>
              <th scope="col">{{ k('situacao') }}</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in painel.motoristas" :key="m.id">
              <td>{{ m.nome }}</td>
              <td>{{ m.tipoVinculo === 'terceiro' ? k('terceiro') : k('proprio') }}</td>
              <td>{{ m.categorias.join('').toUpperCase() }}</td>
              <td>
                {{ m.vencimentoHabilitacao.split('-').reverse().join('/')
                }}{{ m.habilitacaoVencida ? ` (${k('vencida')})` : '' }}
              </td>
              <td>{{ m.transportaControlado ? k('sim') : k('nao') }}</td>
              <td>{{ m.situacao }}</td>
              <td><SanteBotao variante="secundario" :rotulo="k('editar')" @click="editarMotorista(m)" /></td>
            </tr>
          </tbody>
        </table>
        <form class="filtros" data-testid="romaneio-form-motorista" @submit.prevent="gravarOMotorista">
          <span class="campo">
            <label for="mot-nome">{{ k('nome') }}</label>
            <input id="mot-nome" v-model="motorista.nome" data-testid="mot-nome" />
          </span>
          <span v-if="!motorista.id" class="campo">
            <label for="mot-cpf">{{ k('cpf') }}</label>
            <input id="mot-cpf" v-model="motorista.cpf" inputmode="numeric" data-testid="mot-cpf" />
          </span>
          <SanteSelecao
            v-model="motorista.tipoVinculo"
            :rotulo="k('vinculo')"
            :opcoes="opcoesVinculo"
            data-testid="mot-vinculo"
          />
          <SanteSelecao
            v-if="motorista.tipoVinculo === 'terceiro'"
            v-model="motorista.transportadora"
            :rotulo="k('transportadora')"
            :opcoes="opcoesTransportadora"
            data-testid="mot-transportadora"
          />
          <span class="campo">
            <label for="mot-habilitacao">{{ k('habilitacao') }}</label>
            <input
              id="mot-habilitacao"
              v-model="motorista.numeroHabilitacao"
              inputmode="numeric"
              data-testid="mot-habilitacao"
            />
          </span>
          <fieldset class="campo">
            <legend>{{ k('categorias') }}</legend>
            <label v-for="c in CATEGORIAS_HABILITACAO" :key="c">
              <input
                v-model="motorista.categorias"
                type="checkbox"
                :value="c"
                :data-testid="`mot-categoria-${c}`"
              />
              {{ c.toUpperCase() }}
            </label>
          </fieldset>
          <span class="campo">
            <label for="mot-vencimento">{{ k('vencimento') }}</label>
            <input
              id="mot-vencimento"
              v-model="motorista.vencimentoHabilitacao"
              type="date"
              data-testid="mot-vencimento"
            />
          </span>
          <label>
            <input v-model="motorista.transportaControlado" type="checkbox" data-testid="mot-controlado" />
            {{ k('transportaControlado') }}
          </label>
          <label>
            <input v-model="motorista.ativo" type="checkbox" data-testid="mot-ativo" />
            {{ k('ativo') }}
          </label>
          <span v-if="!motorista.ativo" class="campo">
            <label for="mot-motivo">{{ k('motivoInativacao') }}</label>
            <input id="mot-motivo" v-model="motorista.motivoInativacao" />
          </span>
          <SanteBotao
            tipo="submit"
            :rotulo="k('gravar')"
            :desabilitado="gravando || recusasMotorista.length > 0"
            data-testid="mot-gravar"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="k('novo')"
            @click="Object.assign(motorista, motoristaVazio())"
          />
        </form>
        <ul v-if="motorista.nome && recusasMotorista.length" role="alert" data-testid="mot-recusas">
          <li v-for="r in recusasMotorista" :key="r.codigo">{{ r.mensagem }}</li>
        </ul>
      </div>

      <!-- Veículos -->
      <div v-else role="tabpanel" data-testid="romaneio-veiculos">
        <table class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ k('codigo') }}</th>
              <th scope="col">{{ k('placa') }}</th>
              <th scope="col">{{ k('descricao') }}</th>
              <th scope="col">{{ k('frota') }}</th>
              <th scope="col">{{ k('refrigerado') }}</th>
              <th scope="col">{{ k('capacidade') }}</th>
              <th scope="col">{{ k('ativo') }}</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="v in painel.veiculos" :key="v.id">
              <td>{{ v.codigo }}</td>
              <td>{{ v.placa }}</td>
              <td>{{ v.descricao }}</td>
              <td>{{ v.proprio ? k('propria') : k('terceiro') }}</td>
              <td>{{ v.refrigerado ? k('sim') : k('nao') }}</td>
              <td>{{ v.capacidadeCargaKg ?? '' }}</td>
              <td>{{ v.ativo ? k('sim') : k('nao') }}</td>
              <td><SanteBotao variante="secundario" :rotulo="k('editar')" @click="editarVeiculo(v)" /></td>
            </tr>
          </tbody>
        </table>
        <form class="filtros" data-testid="romaneio-form-veiculo" @submit.prevent="gravarOVeiculo">
          <span class="campo">
            <label for="vei-codigo">{{ k('codigo') }}</label>
            <input id="vei-codigo" v-model="veiculo.codigo" data-testid="vei-codigo" />
          </span>
          <span class="campo">
            <label for="vei-descricao">{{ k('descricao') }}</label>
            <input id="vei-descricao" v-model="veiculo.descricao" data-testid="vei-descricao" />
          </span>
          <span class="campo">
            <label for="vei-placa">{{ k('placa') }}</label>
            <input id="vei-placa" v-model="veiculo.placa" data-testid="vei-placa" />
          </span>
          <SanteSelecao
            :model-value="veiculo.proprio ? 'sim' : 'nao'"
            :rotulo="k('frota')"
            :opcoes="opcoesFrota"
            data-testid="vei-frota"
            @update:model-value="(v: string) => (veiculo.proprio = v === 'sim')"
          />
          <SanteSelecao
            v-if="!veiculo.proprio"
            v-model="veiculo.transportadora"
            :rotulo="k('transportadora')"
            :opcoes="opcoesTransportadora"
            data-testid="vei-transportadora"
          />
          <label>
            <input v-model="veiculo.refrigerado" type="checkbox" data-testid="vei-refrigerado" />
            {{ k('refrigerado') }}
          </label>
          <span class="campo">
            <label for="vei-capacidade">{{ k('capacidade') }}</label>
            <input
              id="vei-capacidade"
              v-model="veiculo.capacidade"
              inputmode="numeric"
              data-testid="vei-capacidade"
            />
          </span>
          <label>
            <input v-model="veiculo.ativo" type="checkbox" data-testid="vei-ativo" />
            {{ k('ativo') }}
          </label>
          <span v-if="!veiculo.ativo" class="campo">
            <label for="vei-motivo">{{ k('motivoInativacao') }}</label>
            <input id="vei-motivo" v-model="veiculo.motivoInativacao" />
          </span>
          <SanteBotao
            tipo="submit"
            :rotulo="k('gravar')"
            :desabilitado="gravando || recusasVeiculo.length > 0"
            data-testid="vei-gravar"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="k('novo')"
            @click="Object.assign(veiculo, veiculoVazio())"
          />
        </form>
        <ul v-if="veiculo.codigo && recusasVeiculo.length" role="alert" data-testid="vei-recusas">
          <li v-for="r in recusasVeiculo" :key="r.codigo">{{ r.mensagem }}</li>
        </ul>
      </div>
    </template>
  </section>
</template>
