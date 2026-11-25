<!--
  C2-042 (03-PEP L134): protocolos gerenciados (sepse, dor torácica, AVC) com os critérios de entrada avaliados pelo
  sistema, o alerta de paciente elegível e as etapas com meta de tempo. Uma tela só, por paciente: o alerta no topo,
  os protocolos em andamento com as metas vencidas e, ao abrir um, as etapas com o relógio (concluir em um clique; a
  meta perdida pede a justificativa na hora). Abaixo, a configuração (critérios, fórmula, etapas, metas de mercado).
-->
<script setup lang="ts">
import { TIPOS_SINAL_VITAL } from '@sgh/contratos';
import { problemaDaFormula, TIPOS_ETAPA } from '@sgh/dominio-enfermagem';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ajustarMeta,
  aplicarModelo,
  cancelarEtapa,
  concluirEtapa,
  type EtapaDaInclusao,
  gravarFormula,
  inativarCriterio,
  incluirCriterio,
  incluirEtapa,
  iniciarEtapas,
  lerDefinicao,
  lerElegiveis,
  lerEtapas,
  lerInclusoes,
  lerProtocolos,
  type PedidoCriterio,
} from '../api-protocolo-criterios.js';
import ErroEnfermagem from '../componentes/ErroEnfermagem.vue';

const { t } = useI18n();
const qc = useQueryClient();
const k = (s: string) => `enfermagem.protocoloCriterios.${s}`;

const elegiveis = useQuery({ queryKey: ['protocolo-criterios', 'elegiveis'], queryFn: lerElegiveis });
const inclusoes = useQuery({ queryKey: ['protocolo-criterios', 'inclusoes'], queryFn: lerInclusoes });
const aberta = ref<number | null>(null);
const etapas = useQuery({
  queryKey: computed(() => ['protocolo-criterios', 'etapas', aberta.value]),
  queryFn: () => lerEtapas(aberta.value!),
  enabled: computed(() => aberta.value !== null),
});

const mensagem = ref('');
const erro = ref<unknown>(null);
async function gravar(acao: () => Promise<{ mensagem: string }>): Promise<boolean> {
  erro.value = null;
  try {
    mensagem.value = (await acao()).mensagem;
    await qc.invalidateQueries({ queryKey: ['protocolo-criterios'] });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  }
}

// ── Etapas do paciente ──
const textos = ref<Record<number, string>>({});
const perdida = (e: EtapaDaInclusao) => e.estado === 'vencida';
const textoCurto = (id: number) => (textos.value[id] ?? '').trim().length < 10;
const concluir = (e: EtapaDaInclusao) =>
  gravar(() => concluirEtapa(e.id, e.versao, perdida(e) ? (textos.value[e.id] ?? '').trim() : null));
const cancelar = (e: EtapaDaInclusao) =>
  gravar(() => cancelarEtapa(e.id, e.versao, (textos.value[e.id] ?? '').trim()));

// ── Configuração ──
const protocolos = useQuery({ queryKey: ['protocolo-criterios', 'protocolos'], queryFn: lerProtocolos });
const escolhido = ref('');
const opcoesProtocolo = computed(() => [
  { valor: '', rotulo: t(k('nenhum')) },
  ...(protocolos.data.value ?? []).map((p) => ({ valor: String(p.id), rotulo: `${p.nome} (${p.situacao})` })),
]);
const protocolo = computed(() => Number(escolhido.value) || null);
const definicao = useQuery({
  queryKey: computed(() => ['protocolo-criterios', 'definicao', protocolo.value]),
  queryFn: () => lerDefinicao(protocolo.value!),
  enabled: computed(() => protocolo.value !== null),
});
const formula = ref('');
watch(
  () => definicao.data.value,
  (d) => {
    formula.value = d?.protocolo.formula ?? '';
  },
);
const grupos = computed(() => [
  ...new Set(
    (definicao.data.value?.criterios ?? [])
      .filter((c) => c.ativo && c.finalidade === 'entrada')
      .map((c) => c.grupo ?? `criterio_${c.sequencia}`),
  ),
]);
const problemaFormula = computed(() =>
  formula.value.trim() ? problemaDaFormula(formula.value, grupos.value) : null,
);

const novo = ref({
  grupo: '',
  categoria: 'sinal_vital',
  campo: 'fc',
  termo: '',
  minimo: '',
  maximo: '',
  validade: '',
  descricao: '',
});
const opcoesCategoria = computed(() =>
  (['sinal_vital', 'escala', 'diagnostico', 'idade'] as const).map((c) => ({
    valor: c,
    rotulo: t(k(`categorias.${c}`)),
  })),
);
const opcoesCampo = computed(() => TIPOS_SINAL_VITAL.map((c) => ({ valor: c, rotulo: c })));
const numero = (v: string): number | null => (v.trim() === '' ? null : Number(v.replace(',', '.')));
const problemaCriterio = computed(() => {
  const n = novo.value;
  if (n.grupo && !/^[a-z][a-z0-9_]{0,59}$/.test(n.grupo)) return t(k('problemas.grupo'));
  const [mi, ma] = [numero(n.minimo), numero(n.maximo)];
  if (mi !== null && ma !== null && ma < mi) return t(k('problemas.faixa'));
  if (n.categoria !== 'diagnostico' && mi === null && ma === null) return t(k('problemas.valor'));
  return null;
});
function incluirNovoCriterio() {
  const n = novo.value;
  const dias = n.categoria === 'idade';
  const c: PedidoCriterio = {
    grupo: n.grupo || null,
    categoria: n.categoria as PedidoCriterio['categoria'],
    campo: n.categoria === 'sinal_vital' || n.categoria === 'escala' ? n.campo : null,
    termo: n.categoria === 'diagnostico' ? numero(n.termo) : null,
    valorMinimo: dias ? null : numero(n.minimo),
    valorMaximo: dias ? null : numero(n.maximo),
    validadeHoras: numero(n.validade),
    descricao: n.descricao.trim() || null,
  };
  const corpo = dias ? { ...c, idadeMinimaDias: numero(n.minimo), idadeMaximaDias: numero(n.maximo) } : c;
  void gravar(() => incluirCriterio(protocolo.value!, corpo as PedidoCriterio));
}
const motivos = ref<Record<number, string>>({});

const novaEtapa = ref({ nome: '', tipo: 'exame', meta: '', obrigatoria: 'sim' });
const opcoesTipoEtapa = computed(() =>
  TIPOS_ETAPA.map((x) => ({ valor: x, rotulo: t(k(`tiposEtapa.${x}`)) })),
);
const opcoesObrigatoria = computed(() => [
  { valor: 'sim', rotulo: t(k('obrigatoria')) },
  { valor: 'nao', rotulo: t(k('opcional')) },
]);
const metas = ref<Record<number, string>>({});
</script>

<template>
  <section class="tela-enfermagem" aria-labelledby="pc-titulo">
    <h1 id="pc-titulo">{{ t(k('titulo')) }}</h1>
    <p>{{ t(k('texto')) }}</p>
    <p v-if="mensagem" role="status" data-testid="pc-mensagem">{{ mensagem }}</p>
    <ErroEnfermagem v-if="erro" :erro="erro" />

    <h2>{{ t(k('elegiveis')) }}</h2>
    <SanteBotao :rotulo="t(k('atualizar'))" data-testid="pc-avaliar" @acionar="elegiveis.refetch()" />
    <ErroEnfermagem v-if="elegiveis.isError.value" :erro="elegiveis.error.value" />
    <template v-else-if="elegiveis.data.value">
      <p>{{ t(k('avaliados'), { n: elegiveis.data.value.avaliados }) }}</p>
      <p v-if="!elegiveis.data.value.alertas.length" data-testid="pc-sem-elegiveis">
        {{ t(k('semElegiveis')) }}
      </p>
      <ul v-else class="lista" data-testid="pc-elegiveis">
        <li
          v-for="a in elegiveis.data.value.alertas"
          :key="`${a.atendimento}-${a.protocolo}`"
          class="alerta-elegivel"
        >
          <strong>{{ a.nome }}</strong> · {{ a.nomePaciente }} ·
          {{ t(k('atendimento'), { numero: a.numeroAtendimento }) }} · {{ t(k('desde')) }}
          {{ a.desde ?? t(k('nenhum')) }}
          <span v-if="a.mensagem"> · {{ a.mensagem }}</span>
          <br />
          {{ t(k('criterios')) }}: {{ a.criteriosAtendidos.join('; ') }}
        </li>
      </ul>
    </template>

    <h2>{{ t(k('abertos')) }}</h2>
    <ErroEnfermagem v-if="inclusoes.isError.value" :erro="inclusoes.error.value" />
    <p v-else-if="inclusoes.data.value && !inclusoes.data.value.itens.length">{{ t(k('semAbertos')) }}</p>
    <table v-else-if="inclusoes.data.value" class="tabela" data-testid="pc-abertos">
      <thead>
        <tr>
          <th>{{ t(k('paciente')) }}</th>
          <th>{{ t(k('protocolo')) }}</th>
          <th>{{ t(k('horarioZero')) }}</th>
          <th>{{ t(k('pendentes')) }}</th>
          <th>{{ t(k('vencidas')) }}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="i in inclusoes.data.value.itens" :key="i.inclusao">
          <td>{{ i.nomePaciente }} · {{ t(k('atendimento'), { numero: i.numeroAtendimento }) }}</td>
          <td>{{ i.protocolo }}</td>
          <td>{{ i.horarioZero }}</td>
          <td>{{ i.pendentes }} / {{ i.etapas }}</td>
          <td :class="{ vencida: i.vencidas > 0 }">{{ i.vencidas }}</td>
          <td>
            <SanteBotao
              :rotulo="t(k('verEtapas'))"
              :data-testid="`pc-ver-${i.inclusao}`"
              @acionar="aberta = i.inclusao"
            />
          </td>
        </tr>
      </tbody>
    </table>

    <section v-if="aberta !== null && etapas.data.value" aria-live="polite" data-testid="pc-etapas">
      <h3>{{ t(k('etapasDe'), { nome: etapas.data.value.nomeProtocolo }) }}</h3>
      <p>
        {{ t(k('horarioZero')) }}: {{ etapas.data.value.horarioZero }} ·
        {{ t(k('resumo'), { cumpridas: etapas.data.value.cumpridas, perdidas: etapas.data.value.perdidas }) }}
      </p>
      <template v-if="!etapas.data.value.etapas.length">
        <p>{{ t(k('semEtapas')) }}</p>
        <SanteBotao
          :rotulo="t(k('iniciarEtapas'))"
          data-testid="pc-iniciar"
          @acionar="gravar(() => iniciarEtapas(aberta!))"
        />
      </template>
      <table v-else class="tabela">
        <thead>
          <tr>
            <th>{{ t(k('etapa')) }}</th>
            <th>{{ t(k('prazo')) }}</th>
            <th>{{ t(k('situacao')) }}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in etapas.data.value.etapas" :key="e.id" :data-testid="`pc-etapa-${e.sequencia}`">
            <td>
              {{ e.nome }} <span v-if="!e.obrigatoria">({{ t(k('opcional')) }})</span>
            </td>
            <td>
              {{ e.prazoMetaEm ?? t(k('nenhum')) }}
              <span v-if="e.minutosRestantes !== null">
                · {{ t(k('minutos'), { n: e.minutosRestantes }) }}</span
              >
            </td>
            <td :class="`estado-${e.estado}`">{{ t(k(`estados.${e.estado}`)) }}</td>
            <td>
              <template v-if="e.situacao === 'em_andamento'">
                <label :for="`pc-texto-${e.id}`">{{
                  perdida(e) ? t(k('justificativa')) : t(k('motivo'))
                }}</label>
                <input
                  :id="`pc-texto-${e.id}`"
                  v-model="textos[e.id]"
                  maxlength="1000"
                  :data-testid="`pc-texto-${e.sequencia}`"
                />
                <SanteBotao
                  :rotulo="t(k('concluir'))"
                  :desabilitado="perdida(e) && textoCurto(e.id)"
                  :data-testid="`pc-concluir-${e.sequencia}`"
                  @acionar="concluir(e)"
                />
                <SanteBotao
                  v-if="!e.obrigatoria"
                  :rotulo="t(k('cancelar'))"
                  :desabilitado="textoCurto(e.id)"
                  :data-testid="`pc-cancelar-${e.sequencia}`"
                  @acionar="cancelar(e)"
                />
              </template>
              <span v-else>{{ e.observacao ?? '' }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <template v-if="etapas.data.value.criterios.length">
        <h4>{{ t(k('retrato')) }}</h4>
        <ul class="lista">
          <li v-for="(c, i) in etapas.data.value.criterios" :key="i" :class="{ atendido: c.atendido }">
            {{ c.descricao }} · {{ c.valorEncontrado ?? t(k('nenhum')) }}
          </li>
        </ul>
      </template>
    </section>

    <h2>{{ t(k('configuracao')) }}</h2>
    <ErroEnfermagem v-if="protocolos.isError.value" :erro="protocolos.error.value" />
    <SanteSelecao
      v-model="escolhido"
      :rotulo="t(k('escolherProtocolo'))"
      :opcoes="opcoesProtocolo"
      data-testid="pc-protocolo"
    />
    <template v-if="protocolo !== null && definicao.data.value">
      <SanteBotao
        v-if="definicao.data.value.protocolo.temModelo"
        :rotulo="t(k('aplicarModelo'))"
        data-testid="pc-modelo"
        @acionar="gravar(() => aplicarModelo(protocolo!))"
      />

      <h3>{{ t(k('criterios')) }}</h3>
      <table class="tabela" data-testid="pc-criterios">
        <tbody>
          <tr v-for="c in definicao.data.value.criterios" :key="c.id" :class="{ inativo: !c.ativo }">
            <td>{{ c.grupo ?? `criterio_${c.sequencia}` }}</td>
            <td>{{ t(k(`categorias.${c.categoria}`)) }}</td>
            <td>{{ c.descricao ?? c.campo ?? c.termo }}</td>
            <td>
              <template v-if="c.ativo">
                <label :for="`pc-mot-${c.id}`">{{ t(k('motivoInativar')) }}</label>
                <input :id="`pc-mot-${c.id}`" v-model="motivos[c.id]" maxlength="300" />
                <SanteBotao
                  :rotulo="t(k('inativar'))"
                  :desabilitado="(motivos[c.id] ?? '').trim().length < 10"
                  @acionar="gravar(() => inativarCriterio(c.id, c.versao, (motivos[c.id] ?? '').trim()))"
                />
              </template>
              <span v-else>{{ t(k('inativo')) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="campos">
        <label
          >{{ t(k('grupo')) }} <input v-model="novo.grupo" maxlength="60" data-testid="pc-grupo"
        /></label>
        <SanteSelecao
          v-model="novo.categoria"
          :rotulo="t(k('categoria'))"
          :opcoes="opcoesCategoria"
          data-testid="pc-categoria"
        />
        <SanteSelecao
          v-if="novo.categoria === 'sinal_vital'"
          v-model="novo.campo"
          :rotulo="t(k('campo'))"
          :opcoes="opcoesCampo"
          data-testid="pc-campo"
        />
        <label v-if="novo.categoria === 'escala'"
          >{{ t(k('campo')) }} <input v-model="novo.campo" maxlength="60"
        /></label>
        <label v-if="novo.categoria === 'diagnostico'"
          >{{ t(k('termo')) }} <input v-model="novo.termo" inputmode="numeric"
        /></label>
        <label v-if="novo.categoria !== 'diagnostico'"
          >{{ t(k('minimo')) }} <input v-model="novo.minimo" inputmode="decimal" data-testid="pc-minimo"
        /></label>
        <label v-if="novo.categoria !== 'diagnostico'"
          >{{ t(k('maximo')) }} <input v-model="novo.maximo" inputmode="decimal" data-testid="pc-maximo"
        /></label>
        <label>{{ t(k('validade')) }} <input v-model="novo.validade" inputmode="numeric" /></label>
        <label
          >{{ t(k('descricao')) }} <input v-model="novo.descricao" maxlength="500" data-testid="pc-descricao"
        /></label>
      </div>
      <p v-if="problemaCriterio" role="alert" data-testid="pc-problema-criterio">{{ problemaCriterio }}</p>
      <SanteBotao
        :rotulo="t(k('incluirCriterio'))"
        :desabilitado="!!problemaCriterio"
        data-testid="pc-incluir-criterio"
        @acionar="incluirNovoCriterio"
      />

      <h3>{{ t(k('formula')) }}</h3>
      <p>{{ t(k('formulaAjuda')) }}</p>
      <label for="pc-formula">{{ t(k('formula')) }}</label>
      <input id="pc-formula" v-model="formula" class="largo" maxlength="4000" data-testid="pc-formula" />
      <p v-if="problemaFormula" role="alert" data-testid="pc-problema-formula">{{ problemaFormula }}</p>
      <SanteBotao
        :rotulo="t(k('gravarFormula'))"
        :desabilitado="!!problemaFormula"
        data-testid="pc-gravar-formula"
        @acionar="
          gravar(() =>
            gravarFormula(protocolo!, definicao.data.value!.protocolo.versao, formula.trim() || null),
          )
        "
      />

      <h3>{{ t(k('etapa')) }}</h3>
      <table class="tabela" data-testid="pc-etapas-config">
        <tbody>
          <tr v-for="e in definicao.data.value.etapas" :key="e.id">
            <td>{{ e.sequencia }}. {{ e.nome }}</td>
            <td>{{ t(k(`tiposEtapa.${e.tipo}`)) }}</td>
            <td>{{ e.obrigatoria ? t(k('obrigatoria')) : t(k('opcional')) }}</td>
            <td>
              <label :for="`pc-meta-${e.id}`">{{ t(k('meta')) }}</label>
              <input
                :id="`pc-meta-${e.id}`"
                v-model="metas[e.id]"
                inputmode="numeric"
                :placeholder="String(e.metaMinutos ?? '')"
              />
              <SanteBotao
                :rotulo="t(k('gravarMeta'))"
                :desabilitado="!metas[e.id]"
                @acionar="gravar(() => ajustarMeta(e.id, e.versao, numero(metas[e.id] ?? ''), e.obrigatoria))"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <div class="campos">
        <label
          >{{ t(k('nomeEtapa')) }}
          <input v-model="novaEtapa.nome" maxlength="150" data-testid="pc-nome-etapa"
        /></label>
        <SanteSelecao
          v-model="novaEtapa.tipo"
          :rotulo="t(k('tipoEtapa'))"
          :opcoes="opcoesTipoEtapa"
          data-testid="pc-tipo-etapa"
        />
        <label
          >{{ t(k('meta')) }} <input v-model="novaEtapa.meta" inputmode="numeric" data-testid="pc-meta-etapa"
        /></label>
        <SanteSelecao
          v-model="novaEtapa.obrigatoria"
          :rotulo="t(k('obrigatoria'))"
          :opcoes="opcoesObrigatoria"
          data-testid="pc-obrigatoria"
        />
      </div>
      <SanteBotao
        :rotulo="t(k('incluirEtapa'))"
        :desabilitado="novaEtapa.nome.trim().length < 3"
        data-testid="pc-incluir-etapa"
        @acionar="
          gravar(() =>
            incluirEtapa(protocolo!, {
              nome: novaEtapa.nome.trim(),
              tipo: novaEtapa.tipo,
              metaMinutos: numero(novaEtapa.meta),
              obrigatoria: novaEtapa.obrigatoria === 'sim',
            }),
          )
        "
      />
    </template>
  </section>
</template>

<style src="./estilo-enfermagem.css"></style>
<style scoped>
.campos {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.largo {
  width: 100%;
}
.inativo {
  opacity: 0.6;
}
</style>
