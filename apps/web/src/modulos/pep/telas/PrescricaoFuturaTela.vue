<script setup lang="ts">
// Planejamento e prescrição futura (M24; ficha, seção 7): itens programados para entrar a partir de uma data (o
// editor da prescrição do dia os oferece para confirmação) e os planejamentos anteriores só em consulta.
import {
  type CategoriaPrescritor,
  type GrupoItemPrescricao,
  GRUPOS_ITEM_PRESCRICAO,
  type ItemPrescricao,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import {
  cancelarFutura,
  lerContexto,
  lerDominiosPrescricao,
  lerFuturas,
  programarFutura,
} from '../api-prescricao.js';
import CabecalhoProntuario from '../componentes/CabecalhoProntuario.vue';
import ItemEditor from '../componentes/prescricao/ItemEditor.vue';
import { useConexao } from '../conexao.js';
import { dataHoraBr } from '../formato.js';

const props = defineProps<{ paciente: string }>();
const { t } = useI18n();
const rota = useRoute();
const cliente = useQueryClient();
const online = useConexao();
const id = computed(() => Number(props.paciente));
const contexto = useQuery({
  queryKey: computed(() => ['presc', 'contexto', id.value]),
  queryFn: () => lerContexto(id.value),
});
const dominios = useQuery({
  queryKey: ['presc', 'dominios'],
  queryFn: () => lerDominiosPrescricao(),
  staleTime: 300_000,
});
const c = computed(() => contexto.data.value);
const atendimento = ref(typeof rota.query['atendimento'] === 'string' ? rota.query['atendimento'] : '');
watch(c, (x) => {
  if (x && !atendimento.value) atendimento.value = String(x.atendimentos[0]?.id ?? '');
});
const opcoes = computed(() =>
  (c.value?.atendimentos ?? []).map((a) => ({
    valor: String(a.id),
    rotulo: t('pep.presc.paciente.atendimentoRotulo', {
      tipo: a.tipo,
      numero: a.numero ?? a.id,
      unidade: a.unidade ?? '',
    }),
  })),
);
const chaveQ = computed(() => ['presc', 'futuras', id.value, atendimento.value]);
const futuras = useQuery({
  queryKey: chaveQ,
  queryFn: () => lerFuturas(id.value, Number(atendimento.value)),
  enabled: computed(() => !!atendimento.value),
  staleTime: 0,
});
const categoria = computed<CategoriaPrescritor>(
  () => (c.value?.prescritor?.categoria ?? 'outro') as CategoriaPrescritor,
);
const grupo = ref<GrupoItemPrescricao>('medicamentos');
const aPartirDe = ref('');
const motivo = ref('');
const item = ref<ItemPrescricao | null>(null);
const erro = ref<unknown>(null);
const ok = ref('');
async function programar(): Promise<void> {
  if (!item.value || !aPartirDe.value) return;
  erro.value = null;
  try {
    await programarFutura(id.value, {
      atendimento: Number(atendimento.value),
      aPartirDe: aPartirDe.value,
      item: item.value,
      ...(motivo.value.trim() ? { motivo: motivo.value.trim() } : {}),
    });
    ok.value = t('pep.presc.futura.programadaOk');
    item.value = null;
    await cliente.invalidateQueries({ queryKey: chaveQ.value });
  } catch (e) {
    erro.value = e;
  }
}
const motivoCancelar = ref<Record<number, string>>({});
async function cancelar(fid: number): Promise<void> {
  const m = (motivoCancelar.value[fid] ?? '').trim();
  if (m.length < 5) return;
  erro.value = null;
  try {
    await cancelarFutura(id.value, fid, m);
    await cliente.invalidateQueries({ queryKey: chaveQ.value });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="presc-futura-titulo" data-testid="tela-prescricao-futura">
    <h1 id="presc-futura-titulo">{{ t('pep.presc.futura.titulo') }}</h1>
    <p>
      <RouterLink :to="`/pep/paciente/${id}/prescricao`">{{ t('pep.presc.voltar') }}</RouterLink>
    </p>
    <p>{{ t('pep.presc.futura.texto') }}</p>
    <SanteAlerta v-if="!online" variante="alerta" :texto="t('pep.presc.semConexao')" anunciar />
    <MensagemErro v-if="contexto.isError.value" :erro="contexto.error.value" />
    <p v-else-if="!c || !dominios.data.value" role="status">{{ t('pep.presc.carregando') }}</p>
    <template v-else>
      <CabecalhoProntuario :cabecalho="c.cabecalho" />
      <SanteSelecao v-model="atendimento" :rotulo="t('pep.presc.paciente.atendimento')" :opcoes="opcoes" />
      <section v-if="c.podeCriar && c.prescritor" class="bloco" data-testid="programar-futura">
        <div class="barra">
          <div class="campo">
            <label for="futura-data">{{ t('pep.presc.futura.aPartirDe') }}</label>
            <input id="futura-data" v-model="aPartirDe" type="date" data-testid="futura-data" />
          </div>
          <div class="campo">
            <label for="futura-motivo">{{ t('pep.presc.futura.motivo') }}</label>
            <input id="futura-motivo" v-model="motivo" maxlength="255" />
          </div>
          <SanteSelecao
            v-model="grupo"
            :rotulo="t('pep.presc.editor.abas')"
            :opcoes="GRUPOS_ITEM_PRESCRICAO.map((g) => ({ valor: g, rotulo: t(`pep.presc.grupos.${g}`) }))"
          />
        </div>
        <p v-if="item" role="status" data-testid="futura-item-pronto">
          {{ t(`pep.presc.tipos.${item.detalhe.tipo}`) }}
        </p>
        <ItemEditor
          v-else
          :key="grupo"
          prefixo="futura"
          :grupo="grupo"
          :dominios="dominios.data.value"
          :categoria="categoria"
          :dados="c?.dadosClinicos ?? null"
          @incluir="(i: ItemPrescricao) => (item = i)"
        />
        <SanteBotao
          :rotulo="t('pep.presc.futura.programar')"
          :desabilitado="!item || !aPartirDe || !online"
          data-testid="programar"
          @acionar="programar"
        />
        <SanteAlerta v-if="ok" variante="info" :texto="ok" anunciar data-testid="futura-ok" />
      </section>
      <MensagemErro v-if="erro" :erro="erro" />
      <section class="bloco">
        <h2>{{ t('pep.presc.futura.programadas') }}</h2>
        <p v-if="!futuras.data.value" role="status">{{ t('pep.presc.carregando') }}</p>
        <p v-else-if="futuras.data.value.futuras.length === 0" role="status">
          {{ t('pep.presc.futura.vazio') }}
        </p>
        <ul v-else class="lista" data-testid="lista-futuras">
          <li v-for="f in futuras.data.value.futuras" :key="f.id" :data-testid="`futura-${f.id}`">
            <strong>{{ f.aPartirDe }}</strong> · {{ f.descricao }} ·
            {{ t(`pep.presc.futura.situacoes.${f.situacao}`) }}
            <span v-if="f.situacao === 'programada' && c.podeCriar" class="barra">
              <label :for="`cancelar-${f.id}`" class="oculto">{{
                t('pep.presc.futura.motivoCancelar')
              }}</label>
              <input
                :id="`cancelar-${f.id}`"
                v-model="motivoCancelar[f.id]"
                maxlength="255"
                :placeholder="t('pep.presc.futura.motivoCancelar')"
              />
              <SanteBotao
                :rotulo="t('pep.presc.futura.cancelar', { item: f.descricao })"
                variante="texto"
                @acionar="cancelar(f.id)"
              />
            </span>
          </li>
        </ul>
        <template v-if="futuras.data.value?.planejamentosAntigos.length">
          <h3>{{ t('pep.presc.futura.antigos') }}</h3>
          <ul class="lista">
            <li v-for="a in futuras.data.value.planejamentosAntigos" :key="a.id">
              {{ t('pep.presc.intervalo', { inicio: dataHoraBr(a.inicio), fim: dataHoraBr(a.fim) }) }}
            </li>
          </ul>
        </template>
      </section>
    </template>
  </section>
</template>

<style scoped>
.tela,
.bloco {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.barra {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
  min-height: var(--sgh-alvo-minimo);
}
.lista {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--sgh-espaco-2);
}
.oculto {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
h2,
h3 {
  margin: 0;
}
</style>
