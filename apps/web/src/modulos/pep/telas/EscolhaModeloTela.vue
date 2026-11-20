<script setup lang="ts">
// Escolha do modelo do formulário para um registro novo (M22): os modelos do estabelecimento com a situação para
// este profissional (liberado, ainda não liberado, fora da especialidade, fora de uso). Só o liberado abre o
// formulário; os demais mostram o motivo (os profissionais continuam registrando como hoje nos não liberados).
// M23 (evoluções multiprofissionais): com `?categoria=`, a tela destaca os modelos da profissão (os liberados para a
// especialidade do profissional, pelo vínculo modelo × especialidade) e recolhe os demais.
import { CATEGORIAS_ASSISTENCIAIS } from '@sgh/contratos';
import { SanteAlerta } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { listarModelosRegistro } from '../api-registro.js';

const props = defineProps<{ paciente: string }>();
const { t } = useI18n();
const idPaciente = computed(() => Number(props.paciente));
const modelos = useQuery({
  queryKey: computed(() => ['pep', 'reg', 'modelos', idPaciente.value]),
  queryFn: () => listarModelosRegistro(idPaciente.value),
});
const liberados = computed(() => (modelos.data.value ?? []).filter((m) => m.situacao === 'liberado'));
const outros = computed(() => (modelos.data.value ?? []).filter((m) => m.situacao !== 'liberado'));
const rota = useRoute();
/** A profissão pedida pelo item "Evoluções multiprofissionais" ou pelo prontuário (?categoria=). */
const categoria = computed(() => {
  const c = rota.query['categoria'];
  return typeof c === 'string' && (CATEGORIAS_ASSISTENCIAIS as readonly string[]).includes(c) ? c : null;
});
</script>

<template>
  <section class="tela" aria-labelledby="escolha-titulo" data-testid="tela-escolha-modelo">
    <h1 id="escolha-titulo">{{ t('pep.reg.escolha.titulo') }}</h1>
    <p>{{ t('pep.reg.escolha.texto') }}</p>
    <p>
      <RouterLink to="/pep/rascunhos">{{ t('pep.reg.escolha.voltar') }}</RouterLink>
    </p>
    <SanteAlerta
      v-if="categoria"
      variante="info"
      :texto="t('pep.reg.escolha.daCategoria', { categoria: t(`pep.doc.categorias.${categoria}`) })"
      data-testid="escolha-categoria"
    />
    <MensagemErro v-if="modelos.isError.value" :erro="modelos.error.value" />
    <p v-else-if="!modelos.data.value" role="status">{{ t('pep.reg.carregando') }}</p>
    <template v-else>
      <ul class="modelos" :aria-label="t('pep.reg.escolha.situacoes.liberado')">
        <li v-for="m in liberados" :key="m.id" :data-testid="`modelo-${m.codigo}`">
          <RouterLink :to="`/pep/${idPaciente}/registro/${m.codigo}`">
            <strong>{{ m.codigo }}</strong> · {{ m.nome }}
          </RouterLink>
          <span class="nota">{{ t('pep.reg.escolha.uso', { n: m.usoRecente }) }}</span>
        </li>
      </ul>
      <details v-if="outros.length > 0">
        <summary>{{ t('pep.reg.escolha.situacoes.desligado') }} ({{ outros.length }})</summary>
        <ul class="modelos">
          <li v-for="m in outros" :key="m.id" :data-testid="`modelo-${m.codigo}`">
            <strong>{{ m.codigo }}</strong> · {{ m.nome }} —
            {{ t(`pep.reg.escolha.situacoes.${m.situacao}`) }}
            <SanteAlerta v-if="m.motivo" variante="info" :texto="m.motivo" />
          </li>
        </ul>
      </details>
    </template>
  </section>
</template>

<style scoped>
.tela {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-3);
  max-width: 60rem;
}
.modelos {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.modelos li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: baseline;
}
.nota {
  font-size: 0.85em;
  color: var(--sgh-texto-secundario);
}
</style>
