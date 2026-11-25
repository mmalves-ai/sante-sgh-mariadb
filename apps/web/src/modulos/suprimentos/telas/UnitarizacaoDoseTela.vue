<script setup lang="ts">
// Fracionamento e unitarização de dose (C2-092, 05-SUP linha 11): `/farmacia/unitarizacao`. Numa tela só: as regras
// de fracionamento do insumo (cadastro com a validação na hora, ativação sem apagar), a ordem (regra, local, lote de
// origem filtrado pelo local e pelo insumo da regra, capela quando a regra exige, doses e perda conferidas contra o
// rendimento previsto e a validade da dose calculada pela RDC 67/2007 antes de gravar, a mesma regra da API), as
// etiquetas das doses emitidas com o lote de origem, o rastreio dose → ordem → lote pela leitura do código e as
// últimas ordens. Nada é apagado: a regra é inativada, a ordem e as doses ficam no histórico.
import type { ItemBusca } from '@sgh/contratos';
import {
  conferirRegraFracionamento,
  conferirUnitarizacao,
  rendimentoPrevisto,
  sobraDaOrdem,
  validadeDaDose,
} from '@sgh/contratos/regras-suprimentos';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { pode } from '../../../casca/sessao/pode.js';
import { novaChaveContrato } from '../api-contrato.js';
import {
  ativarRegraFracionamento,
  executarOrdemUnitarizacao,
  type OrdemGravadaTela,
  type OrdemUnitarizacaoEntradaTela,
  painelUnitarizacao,
  type RastreioDoseTela,
  type RegraFracionamentoTela,
  rastrearDose,
  salvarRegraFracionamento,
} from '../api-unitarizacao.js';
import BuscaItem from '../componentes/BuscaItem.vue';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { mensagensUnitarizacao as M } from '../i18n-unitarizacao.js';

const fmt = (s: string, v: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_x, k: string) => String(v[k] ?? ''));
const qtd = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const dataBr = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
const quandoBr = (d: string | null) => (d ? `${dataBr(d)} ${d.slice(11, 16)}` : '');
const numero = (s: string) => {
  const v = Number(String(s).replace(',', '.'));
  return s.trim() !== '' && Number.isFinite(v) ? v : NaN;
};

const podeGravar = computed(() => pode('suprimentos.manipulacao.abrir'));
const cliente = useQueryClient();
const erro = ref<unknown>(null);
const aviso = ref('');
const CHAVE_PAINEL = ['suprimentos', 'unitarizacao'];
const painel = useQuery({ queryKey: CHAVE_PAINEL, queryFn: painelUnitarizacao });
const recarregar = () => cliente.invalidateQueries({ queryKey: CHAVE_PAINEL });

// ------------------------------------------------ regra de fracionamento
const origem = ref<ItemBusca | null>(null);
const resultante = ref<ItemBusca | null>(null);
const rQtdOrigem = ref('1');
const rRendimento = ref('');
const rUnidade = ref<number | null>(null);
const rValidadeHoras = ref('');
const rExigeCapela = ref(false);
const rReaproveita = ref(true);
const opcoesUnidade = computed(() => [
  { valor: null as number | null, rotulo: M.escolha },
  ...(painel.data.value?.unidades ?? []).map((u) => ({ valor: u.id as number | null, rotulo: u.sigla })),
]);
const recusasRegra = computed(() => {
  if (!origem.value || !resultante.value) return [];
  const horas = rValidadeHoras.value.trim() === '' ? null : numero(rValidadeHoras.value);
  return conferirRegraFracionamento({
    origem: origem.value.codigo,
    resultante: resultante.value.codigo,
    quantidadeOrigem: numero(rQtdOrigem.value),
    rendimento: numero(rRendimento.value),
    validadeHoras: horas,
  });
});
const regraValida = computed(
  () => !!origem.value && !!resultante.value && rUnidade.value !== null && recusasRegra.value.length === 0,
);
let chaveRegra = novaChaveContrato('unit-regra');
const gravacaoRegra = useMutation({
  mutationFn: () =>
    salvarRegraFracionamento(
      {
        origem: (origem.value as ItemBusca).codigo,
        resultante: (resultante.value as ItemBusca).codigo,
        quantidadeOrigem: numero(rQtdOrigem.value),
        rendimento: numero(rRendimento.value),
        unidade: rUnidade.value as number,
        validadeHoras: rValidadeHoras.value.trim() === '' ? null : numero(rValidadeHoras.value),
        exigeCapela: rExigeCapela.value,
        reaproveitaSobra: rReaproveita.value,
      },
      chaveRegra,
    ),
  onSuccess: async (r) => {
    erro.value = null;
    aviso.value = r.mensagem;
    chaveRegra = novaChaveContrato('unit-regra');
    origem.value = resultante.value = null;
    rRendimento.value = rValidadeHoras.value = '';
    await recarregar();
  },
  onError: (x) => {
    erro.value = x;
  },
});
const ativacao = useMutation({
  mutationFn: (r: RegraFracionamentoTela) =>
    ativarRegraFracionamento(r.id, { ativa: !r.ativa, versaoVista: r.versao }),
  onSuccess: async (r) => {
    erro.value = null;
    aviso.value = r.mensagem;
    await recarregar();
  },
  onError: (x) => {
    erro.value = x;
  },
});

// ------------------------------------------------ ordem
const regraId = ref<number | null>(null);
const tipo = ref<OrdemUnitarizacaoEntradaTela['tipo']>('fracionamento');
const localId = ref<number | null>(null);
const loteId = ref<number | null>(null);
const capelaId = ref<number | null>(null);
const oQtdOrigem = ref('1');
const oDoses = ref('');
const oPerda = ref('0');
const oEstabilidade = ref('');
const rupturaLacre = ref(true);
const observacao = ref('');

const regraEscolhida = computed(() => painel.data.value?.regras.find((r) => r.id === regraId.value) ?? null);
const opcoesRegra = computed(() => [
  { valor: null as number | null, rotulo: M.escolha },
  ...(painel.data.value?.regras ?? [])
    .filter((r) => r.ativa)
    .map((r) => ({ valor: r.id as number | null, rotulo: `${r.origemNome} → ${r.resultanteNome}` })),
]);
const opcoesTipo = computed(() =>
  Object.entries(M.ordem.tipos).map(([valor, rotulo]) => ({
    valor: valor as OrdemUnitarizacaoEntradaTela['tipo'],
    rotulo,
  })),
);
const opcoesLocal = computed(() => [
  { valor: null as number | null, rotulo: M.escolha },
  ...(painel.data.value?.locais ?? []).map((l) => ({ valor: l.id as number | null, rotulo: l.nome })),
]);
const lotesDoLocal = computed(() =>
  (painel.data.value?.lotes ?? []).filter(
    (l) => l.local === localId.value && l.insumo === regraEscolhida.value?.origem,
  ),
);
const opcoesLote = computed(() => [
  { valor: null as number | null, rotulo: M.escolha },
  ...lotesDoLocal.value.map((l) => ({
    valor: l.id as number | null,
    rotulo: fmt(M.ordem.loteRotulo, { numero: l.numero, validade: dataBr(l.validade), saldo: qtd(l.saldo) }),
  })),
]);
const opcoesCapela = computed(() => [
  { valor: null as number | null, rotulo: M.nenhum },
  ...(painel.data.value?.capelas ?? []).map((c) => ({ valor: c.id as number | null, rotulo: c.nome })),
]);
watch([regraId, localId], () => {
  if (!lotesDoLocal.value.some((l) => l.id === loteId.value)) loteId.value = null;
});
watch([regraEscolhida, oQtdOrigem], () => {
  const r = regraEscolhida.value;
  if (r && oDoses.value === '') {
    const p = Math.floor(rendimentoPrevisto(r, numero(oQtdOrigem.value)));
    if (p > 0) oDoses.value = String(p);
  }
});

const loteEscolhido = computed(() => lotesDoLocal.value.find((l) => l.id === loteId.value) ?? null);
const previsto = computed(() =>
  regraEscolhida.value ? rendimentoPrevisto(regraEscolhida.value, numero(oQtdOrigem.value)) : 0,
);
const sobra = computed(() =>
  regraEscolhida.value
    ? sobraDaOrdem(regraEscolhida.value, numero(oQtdOrigem.value), numero(oDoses.value), numero(oPerda.value))
    : 0,
);
const estabilidade = computed(() => (oEstabilidade.value.trim() === '' ? null : numero(oEstabilidade.value)));
const validade = computed(() => {
  const p = painel.data.value;
  const l = loteEscolhido.value;
  if (!p || !l || !regraEscolhida.value) return undefined;
  return validadeDaDose({
    executadaEm: p.agora.slice(0, 16),
    validadeOriginal: l.validade.slice(0, 10),
    validadeHoras: regraEscolhida.value.validadeHoras,
    percentual: estabilidade.value,
  });
});
const recusasOrdem = computed(() => {
  const p = painel.data.value;
  const r = regraEscolhida.value;
  if (!p || !r) return [];
  const l = loteEscolhido.value;
  return conferirUnitarizacao({
    regra: r,
    tipo: tipo.value,
    quantidadeOrigem: numero(oQtdOrigem.value),
    doses: numero(oDoses.value),
    perda: numero(oPerda.value),
    capela: capelaId.value,
    lote: l
      ? { validade: l.validade.slice(0, 10), situacao: 'liberado', bloqueado: false, saldo: l.saldo }
      : null,
    hoje: p.hoje,
    percentualEstabilidade: estabilidade.value,
    observacao: observacao.value.trim() || null,
  });
});
const ordemValida = computed(
  () =>
    !!regraEscolhida.value &&
    localId.value !== null &&
    loteId.value !== null &&
    recusasOrdem.value.length === 0 &&
    !!validade.value,
);
const emitida = ref<OrdemGravadaTela | null>(null);
let chaveOrdem = novaChaveContrato('unit-ordem');
const execucao = useMutation({
  mutationFn: () =>
    executarOrdemUnitarizacao(
      {
        regra: regraId.value as number,
        tipo: tipo.value,
        local: localId.value as number,
        lote: loteId.value as number,
        capela: capelaId.value,
        quantidadeOrigem: numero(oQtdOrigem.value),
        doses: numero(oDoses.value),
        perda: numero(oPerda.value),
        rupturaLacre: rupturaLacre.value,
        percentualEstabilidade: estabilidade.value,
        observacao: observacao.value.trim() || null,
      },
      chaveOrdem,
    ),
  onSuccess: async (r) => {
    erro.value = null;
    aviso.value = r.mensagem;
    emitida.value = r;
    chaveOrdem = novaChaveContrato('unit-ordem');
    loteId.value = null;
    oDoses.value = '';
    oPerda.value = '0';
    observacao.value = '';
    await recarregar();
  },
  onError: (x) => {
    erro.value = x;
  },
});

// ------------------------------------------------ rastreio
const codigo = ref('');
const codigoOk = computed(() => /^[A-Za-z0-9]{2,100}$/.test(codigo.value.trim()));
const rastreio = ref<RastreioDoseTela | null>(null);
async function rastrear(): Promise<void> {
  if (!codigoOk.value) return;
  erro.value = null;
  try {
    rastreio.value = await rastrearDose(codigo.value.trim());
  } catch (x) {
    rastreio.value = null;
    erro.value = x;
  }
}
const imprimir = () => window.print();
</script>

<template>
  <section class="tela-agenda" aria-labelledby="unit-titulo" data-testid="tela-farmacia-unitarizacao">
    <h1 id="unit-titulo">{{ M.titulo }}</h1>
    <p>{{ M.texto }}</p>
    <ErroSuprimentos v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="unit-aviso">{{ aviso }}</p>
    <p v-if="!painel.data.value && !painel.error.value">{{ M.carregando }}</p>
    <ErroSuprimentos v-if="painel.error.value" :erro="painel.error.value" />

    <template v-if="painel.data.value">
      <!-- ------------------------------------------------ rastreio -->
      <form class="painel filtros" data-testid="unit-rastreio" @submit.prevent="rastrear">
        <h2>{{ M.rastreio.titulo }}</h2>
        <label class="campo">
          <span>{{ M.rastreio.codigo }}</span>
          <input v-model="codigo" autocomplete="off" data-testid="unit-rastreio-codigo" />
        </label>
        <span v-if="codigo && !codigoOk" role="alert" data-testid="unit-rastreio-invalido">
          {{ M.rastreio.invalido }}
        </span>
        <button type="submit" class="botao" :disabled="!codigoOk">{{ M.rastreio.buscar }}</button>
      </form>
      <div v-if="rastreio" class="painel" data-testid="unit-rastreio-resultado">
        <p data-testid="unit-rastreio-dose">
          {{
            fmt(M.rastreio.dose, {
              id: rastreio.dose.identificador,
              insumo: rastreio.dose.insumo,
              q: qtd(rastreio.dose.quantidade),
              unidade: rastreio.dose.unidade,
              validade: dataBr(rastreio.dose.validadeNova),
              situacao: rastreio.dose.situacao,
            })
          }}
        </p>
        <p>
          {{
            fmt(M.rastreio.ordem, {
              numero: rastreio.ordem.numero,
              tipo: M.ordem.tipos[rastreio.ordem.tipo] ?? rastreio.ordem.tipo,
              quando: quandoBr(rastreio.ordem.executadaEm),
              quem: rastreio.ordem.farmaceutico ?? '-',
              capela: rastreio.ordem.capela ?? '-',
            })
          }}
        </p>
        <p data-testid="unit-rastreio-lote">
          {{
            rastreio.loteOrigem
              ? fmt(M.rastreio.lote, {
                  numero: rastreio.loteOrigem.numero,
                  insumo: rastreio.loteOrigem.insumo,
                  validade: dataBr(rastreio.loteOrigem.validade),
                  fabricante: rastreio.loteOrigem.fabricante ?? '-',
                })
              : M.rastreio.semLote
          }}
        </p>
        <p>{{ fmt(M.rastreio.irmas, { n: rastreio.irmas.length }) }}</p>
        <ul>
          <li v-for="i in rastreio.irmas" :key="i.identificador">{{ i.identificador }} · {{ i.situacao }}</li>
        </ul>
      </div>

      <!-- ------------------------------------------------ ordem -->
      <form
        v-if="podeGravar"
        class="painel"
        data-testid="unit-ordem"
        :aria-label="M.ordem.titulo"
        @submit.prevent="ordemValida && execucao.mutate()"
      >
        <h2>{{ M.ordem.titulo }}</h2>
        <div class="filtros">
          <SanteSelecao
            v-model="regraId"
            :rotulo="M.ordem.regra"
            :opcoes="opcoesRegra"
            class="campo"
            data-testid="unit-ordem-regra"
          />
          <SanteSelecao
            v-model="tipo"
            :rotulo="M.ordem.tipo"
            :opcoes="opcoesTipo"
            class="campo"
            data-testid="unit-ordem-tipo"
          />
          <SanteSelecao
            v-model="localId"
            :rotulo="M.ordem.local"
            :opcoes="opcoesLocal"
            class="campo"
            data-testid="unit-ordem-local"
          />
          <SanteSelecao
            v-model="loteId"
            :rotulo="M.ordem.lote"
            :opcoes="opcoesLote"
            class="campo"
            data-testid="unit-ordem-lote"
          />
          <SanteSelecao
            v-model="capelaId"
            :rotulo="M.ordem.capela"
            :opcoes="opcoesCapela"
            class="campo"
            data-testid="unit-ordem-capela"
          />
        </div>
        <p v-if="regraEscolhida && localId !== null && lotesDoLocal.length === 0" data-testid="unit-sem-lote">
          {{ M.ordem.semLote }}
        </p>
        <div class="filtros">
          <label class="campo">
            <span>{{ M.ordem.quantidadeOrigem }}</span>
            <input v-model="oQtdOrigem" inputmode="decimal" data-testid="unit-ordem-qtd" />
          </label>
          <label class="campo">
            <span>{{ M.ordem.doses }}</span>
            <input v-model="oDoses" inputmode="numeric" data-testid="unit-ordem-doses" />
          </label>
          <label class="campo">
            <span>{{ M.ordem.perda }}</span>
            <input v-model="oPerda" inputmode="decimal" data-testid="unit-ordem-perda" />
          </label>
          <label class="campo">
            <span>{{ M.ordem.estabilidade }}</span>
            <input v-model="oEstabilidade" inputmode="decimal" data-testid="unit-ordem-estabilidade" />
          </label>
          <label class="campo">
            <input v-model="rupturaLacre" type="checkbox" data-testid="unit-ordem-lacre" />
            <span>{{ M.ordem.rupturaLacre }}</span>
          </label>
        </div>
        <label class="campo">
          <span>{{ M.ordem.observacao }}</span>
          <textarea v-model="observacao" maxlength="2000" rows="2" data-testid="unit-ordem-observacao" />
        </label>
        <div data-testid="unit-ordem-resumo">
          <p v-if="regraEscolhida">{{ fmt(M.ordem.previsto, { n: qtd(previsto) }) }}</p>
          <p v-if="regraEscolhida && sobra > 0" data-testid="unit-ordem-sobra">
            {{
              fmt(regraEscolhida.reaproveitaSobra ? M.ordem.sobraReaproveitada : M.ordem.sobraDescarte, {
                n: qtd(sobra),
              })
            }}
          </p>
          <p v-if="validade" data-testid="unit-ordem-validade">
            {{ fmt(M.ordem.validade, { data: dataBr(validade) }) }}
          </p>
          <p v-else-if="validade === null" role="alert">{{ M.ordem.esgotada }}</p>
        </div>
        <ul v-if="recusasOrdem.length" data-testid="unit-ordem-recusas">
          <li v-for="r in recusasOrdem" :key="r.codigo" role="alert">{{ r.mensagem }}</li>
        </ul>
        <button
          type="submit"
          class="botao"
          :disabled="!ordemValida || execucao.isPending.value"
          data-testid="unit-ordem-executar"
        >
          {{ execucao.isPending.value ? M.ordem.executando : M.ordem.executar }}
        </button>
      </form>

      <!-- ------------------------------------------------ etiquetas emitidas -->
      <div v-if="emitida" class="painel" data-testid="unit-rotulos">
        <h2>{{ M.rotulos.titulo }}</h2>
        <button type="button" class="botao" @click="imprimir">{{ M.rotulos.imprimir }}</button>
        <ul>
          <li v-for="d in emitida.doses" :key="d.id" :data-testid="`unit-rotulo-${d.identificador}`">
            <strong>{{ d.legivel }}</strong>
            <span v-for="(l, i) in d.linhas" :key="i"> · {{ l }}</span>
          </li>
        </ul>
      </div>

      <!-- ------------------------------------------------ regras -->
      <section class="painel" aria-labelledby="unit-regras-titulo" data-testid="unit-regras">
        <h2 id="unit-regras-titulo">{{ M.regras.titulo }}</h2>
        <p v-if="painel.data.value.regras.length === 0">{{ M.regras.vazia }}</p>
        <ul v-else>
          <li v-for="r in painel.data.value.regras" :key="r.id" :data-testid="`unit-regra-${r.id}`">
            {{
              fmt(M.regras.resumo, {
                q: qtd(r.quantidadeOrigem),
                origem: r.origemNome,
                r: qtd(r.rendimento),
                sigla: r.unidadeSigla,
                dose: r.resultanteNome,
              })
            }}
            · {{ r.ativa ? M.regras.ativa : M.regras.inativa }}
            <button
              v-if="podeGravar"
              type="button"
              class="link"
              :data-testid="`unit-regra-ativacao-${r.id}`"
              :disabled="ativacao.isPending.value"
              @click="ativacao.mutate(r)"
            >
              {{ r.ativa ? M.regras.inativar : M.regras.ativar }}
            </button>
          </li>
        </ul>
        <form
          v-if="podeGravar"
          data-testid="unit-regra-form"
          :aria-label="M.regras.nova"
          @submit.prevent="regraValida && gravacaoRegra.mutate()"
        >
          <h3>{{ M.regras.nova }}</h3>
          <p v-if="origem" data-testid="unit-regra-origem">
            {{ M.regras.origem }}: {{ origem.nome }}
            <button type="button" class="link" @click="origem = null">{{ M.regras.trocar }}</button>
          </p>
          <BuscaItem
            v-else
            :rotulo="M.regras.origem"
            testid="unit-busca-origem"
            @escolher="origem = $event"
          />
          <p v-if="resultante" data-testid="unit-regra-resultante">
            {{ M.regras.resultante }}: {{ resultante.nome }}
            <button type="button" class="link" @click="resultante = null">{{ M.regras.trocar }}</button>
          </p>
          <BuscaItem
            v-else
            :rotulo="M.regras.resultante"
            testid="unit-busca-resultante"
            @escolher="resultante = $event"
          />
          <div class="filtros">
            <label class="campo">
              <span>{{ M.regras.quantidadeOrigem }}</span>
              <input v-model="rQtdOrigem" inputmode="decimal" data-testid="unit-regra-qtd" />
            </label>
            <label class="campo">
              <span>{{ M.regras.rendimento }}</span>
              <input v-model="rRendimento" inputmode="decimal" data-testid="unit-regra-rendimento" />
            </label>
            <SanteSelecao
              v-model="rUnidade"
              :rotulo="M.regras.unidade"
              :opcoes="opcoesUnidade"
              class="campo"
              data-testid="unit-regra-unidade"
            />
            <label class="campo">
              <span>{{ M.regras.validadeHoras }}</span>
              <input v-model="rValidadeHoras" inputmode="numeric" data-testid="unit-regra-validade" />
            </label>
            <label class="campo">
              <input v-model="rExigeCapela" type="checkbox" data-testid="unit-regra-capela" />
              <span>{{ M.regras.exigeCapela }}</span>
            </label>
            <label class="campo">
              <input v-model="rReaproveita" type="checkbox" data-testid="unit-regra-sobra" />
              <span>{{ M.regras.reaproveitaSobra }}</span>
            </label>
          </div>
          <ul v-if="recusasRegra.length" data-testid="unit-regra-recusas">
            <li v-for="r in recusasRegra" :key="r.codigo" role="alert">{{ r.mensagem }}</li>
          </ul>
          <button
            type="submit"
            class="botao"
            :disabled="!regraValida || gravacaoRegra.isPending.value"
            data-testid="unit-regra-salvar"
          >
            {{ M.regras.salvar }}
          </button>
        </form>
      </section>

      <!-- ------------------------------------------------ últimas ordens -->
      <section class="painel" aria-labelledby="unit-ordens-titulo">
        <h2 id="unit-ordens-titulo">{{ M.ordens.titulo }}</h2>
        <p v-if="painel.data.value.ordens.length === 0">{{ M.ordens.vazia }}</p>
        <table v-else class="tabela" data-testid="unit-ordens">
          <thead>
            <tr>
              <th>{{ M.ordens.colunas.numero }}</th>
              <th>{{ M.ordens.colunas.quando }}</th>
              <th>{{ M.ordens.colunas.origem }}</th>
              <th>{{ M.ordens.colunas.lote }}</th>
              <th>{{ M.ordens.colunas.dose }}</th>
              <th>{{ M.ordens.colunas.doses }}</th>
              <th>{{ M.ordens.colunas.perda }}</th>
              <th>{{ M.ordens.colunas.sobra }}</th>
              <th>{{ M.ordens.colunas.validade }}</th>
              <th>{{ M.ordens.colunas.situacao }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="o in painel.data.value.ordens" :key="o.id">
              <td>{{ o.numero }}</td>
              <td>{{ quandoBr(o.executadaEm) }}</td>
              <td>{{ o.origemNome }}</td>
              <td>{{ o.loteOrigem }}</td>
              <td>{{ o.resultanteNome }}</td>
              <td>{{ o.doses }}</td>
              <td>{{ qtd(o.perda) }}</td>
              <td>{{ qtd(o.sobra ?? 0) }}</td>
              <td>{{ dataBr(o.validadeDose) }}</td>
              <td>{{ o.situacao }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </section>
</template>
