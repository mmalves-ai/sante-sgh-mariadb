<script setup lang="ts">
// Baixa por demonstrativo, com glosa no título (ficha do M32, seção 7): `/financeiro/receber/demonstrativos`. O título
// do convênio escolhido mostra a glosa somada dos itens baixados pelo demonstrativo da conta; a glosa aceita, o recurso
// deferido ou indeferido fica no título (o motivo obrigatório), sem mexer no valor gravado do título.
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import AvisoFaturamento from '../../faturamento/componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import BaixaPorDemonstrativo from '../componentes/BaixaPorDemonstrativo.vue';
import GlosaDoTitulo from '../componentes/GlosaDoTitulo.vue';
import { lerTituloReceber, listarTitulosReceber, novaChave, registrarGlosa } from '../api-financeiro.js';
import { data, reais, usarFinanceiro } from '../usar-financeiro.js';

const { t } = useI18n();
const rota = useRoute();
const qc = useQueryClient();
const { pode, motivo, motivoFuncionalidade } = usarFinanceiro();
const titulos = useQuery({
  queryKey: ['financeiro', 'receber', 'convenio-abertos'],
  queryFn: () => listarTitulosReceber({ devedor: 'C', aberto: 'sim' }),
});
const escolhido = ref(typeof rota.query['titulo'] === 'string' ? rota.query['titulo'] : '');
const opcoes = computed(() => [
  { valor: '', rotulo: t('financeiro.escolha') },
  ...(titulos.data.value?.itens ?? []).map((x) => ({
    valor: String(x.id),
    rotulo: `${x.convenio} — ${x.documento} (${data(x.vencimento)}, ${reais(x.valor)})`,
  })),
  ...(escolhido.value && !(titulos.data.value?.itens ?? []).some((x) => String(x.id) === escolhido.value)
    ? [{ valor: escolhido.value, rotulo: escolhido.value }]
    : []),
]);
const titulo = useQuery({
  queryKey: computed(() => ['financeiro', 'receber', 'titulo', Number(escolhido.value)]),
  queryFn: () => lerTituloReceber(Number(escolhido.value)),
  enabled: computed(() => !!escolhido.value),
});
const situacoes = computed(() =>
  (['aceita', 'recurso-deferido', 'recurso-indeferido'] as const).map((s) => ({
    valor: s,
    rotulo: t(`financeiro.demonstrativos.situacoes.${s}`),
  })),
);
const form = reactive({
  item: '',
  situacao: 'aceita' as 'aceita' | 'recurso-deferido' | 'recurso-indeferido',
  valor: '',
  motivo: '',
});
watch(
  () => titulo.data.value?.glosa.glosado,
  (g) => {
    if (g !== undefined) form.valor = String(g);
  },
);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
async function registrar() {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    const r = await registrarGlosa(
      Number(escolhido.value),
      {
        item: form.item ? Number(form.item) : null,
        situacao: form.situacao,
        valor: Number(String(form.valor).replace(',', '.')),
        motivo: form.motivo,
      },
      novaChave('glosa-titulo'),
    );
    mensagem.value = r.mensagem;
    await qc.invalidateQueries({ queryKey: ['financeiro'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="dm-titulo" data-testid="tela-fin-demonstrativos">
    <h1 id="dm-titulo">{{ t('financeiro.demonstrativos.titulo') }}</h1>
    <p>{{ t('financeiro.demonstrativos.texto') }}</p>
    <AvisoFaturamento :motivo="motivoFuncionalidade('contasReceber')" />
    <BaixaPorDemonstrativo />
    <span class="campo">
      <SanteSelecao
        v-model="escolhido"
        :rotulo="t('financeiro.receber.detalhe')"
        :opcoes="opcoes"
        data-testid="dm-titulo-escolhido"
      />
    </span>
    <ErroFaturamento v-if="titulo.error.value" :erro="titulo.error.value" />
    <template v-else-if="titulo.data.value">
      <GlosaDoTitulo :titulo="titulo.data.value" />
      <form class="formulario" data-testid="dm-formulario" @submit.prevent="registrar">
        <h2>{{ t('financeiro.demonstrativos.registrar') }}</h2>
        <span class="campo">
          <label for="dm-item">{{ t('financeiro.demonstrativos.item') }}</label>
          <input id="dm-item" v-model="form.item" inputmode="numeric" data-testid="dm-item" />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="form.situacao"
            :rotulo="t('financeiro.demonstrativos.situacaoGlosa')"
            :opcoes="situacoes"
            data-testid="dm-situacao"
          />
        </span>
        <span class="campo">
          <label for="dm-valor">{{ t('financeiro.valor') }}</label>
          <input id="dm-valor" v-model="form.valor" inputmode="decimal" required data-testid="dm-valor" />
        </span>
        <span class="campo">
          <label for="dm-motivo">{{ t('financeiro.motivo') }}</label>
          <input
            id="dm-motivo"
            v-model="form.motivo"
            minlength="10"
            maxlength="200"
            required
            data-testid="dm-motivo"
          />
        </span>
        <button type="submit" :disabled="gravando || !pode('registrarGlosa')" data-testid="dm-registrar">
          {{ t('financeiro.demonstrativos.registrar') }}
        </button>
        <p v-if="!pode('registrarGlosa')" class="secundario">{{ motivo('registrarGlosa') }}</p>
      </form>
    </template>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="dm-mensagem" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-financeiro.css"></style>
