<script setup lang="ts">
// Aba "Alertas de experiência" (W0-06, parte 5d-2): os marcos de 45 e 90 dias do contrato de experiência ainda sem a
// avaliação daquele marco (próximos, de hoje e vencidos). Cada linha abre a avaliação do marco num ciclo de experiência
// aberto; feita a avaliação, o alerta some.
import type { AlertaExperienciaResposta, ApoioAvaliacao } from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../comum.js';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import AbrirAvaliacao from './AbrirAvaliacao.vue';
import { lerAlertasExperiencia, lerCiclos } from './api-avaliacao.js';

const props = defineProps<{ apoio: ApoioAvaliacao }>();
const emit = defineEmits<{ gravado: [r: unknown]; abrir: [id: number] }>();
const { t } = useI18n();
const pode = computed(() => props.apoio.acoes.gerir);
const alertas = useQuery({
  queryKey: ['pessoas', 'avaliacao', 'alertas'],
  queryFn: lerAlertasExperiencia,
});
const ciclos = useQuery({ queryKey: ['pessoas', 'avaliacao', 'ciclos'], queryFn: lerCiclos });
const lista = computed(() => alertas.data.value ?? []);

const alvo = ref<AlertaExperienciaResposta | null>(null);
const dialogo = ref(false);
function pedir(x: AlertaExperienciaResposta): void {
  alvo.value = x;
  dialogo.value = true;
}
function aposAbrir(r: unknown): void {
  emit('gravado', r);
  const id = (r as { id?: unknown } | null)?.id;
  if (typeof id === 'number') emit('abrir', id);
}
const prazo = (x: AlertaExperienciaResposta) =>
  x.dias < 0
    ? t('pessoas.avaliacao.alertas.vencido', { n: -x.dias })
    : x.dias === 0
      ? t('pessoas.avaliacao.alertas.hoje')
      : t('pessoas.avaliacao.alertas.faltam', { n: x.dias });
</script>

<template>
  <section class="bloco" data-testid="aval-alertas">
    <p class="secundario">{{ t('pessoas.avaliacao.alertas.texto') }}</p>
    <ErroPessoas v-if="alertas.isError.value" :erro="alertas.error.value" />
    <p v-else-if="!alertas.data.value" role="status">{{ t('pessoas.carregando') }}</p>
    <p v-else-if="lista.length === 0" data-testid="alertas-vazio">
      {{ t('pessoas.avaliacao.alertas.vazio') }}
    </p>
    <table v-else class="tabela" data-testid="tabela-alertas">
      <thead>
        <tr>
          <th scope="col">{{ t('pessoas.avaliacao.ciclos.colaborador') }}</th>
          <th scope="col">{{ t('pessoas.avaliacao.alertas.setor') }}</th>
          <th scope="col">{{ t('pessoas.avaliacao.alertas.admissao') }}</th>
          <th scope="col">{{ t('pessoas.avaliacao.alertas.marco') }}</th>
          <th scope="col">{{ t('pessoas.avaliacao.alertas.data') }}</th>
          <th scope="col">{{ t('pessoas.avaliacao.alertas.situacao') }}</th>
          <th v-if="pode" scope="col">{{ t('pessoas.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="x in lista"
          :key="`${x.vinculo}-${x.marco}`"
          :data-testid="`alerta-${x.vinculo}-${x.marco}`"
          :data-situacao="x.situacao"
        >
          <th scope="row">{{ x.matricula ? `${x.nome} · ${x.matricula}` : x.nome }}</th>
          <td>{{ x.setor ?? '—' }}</td>
          <td>{{ dataBr(x.admissao) }}</td>
          <td>{{ t('pessoas.avaliacao.ficha.marcoTexto', { m: x.marco }) }}</td>
          <td>{{ dataBr(x.data) }}</td>
          <td>{{ prazo(x) }}</td>
          <td v-if="pode">
            <SanteBotao
              :rotulo="t('pessoas.avaliacao.alertas.avaliar', { nome: x.nome })"
              variante="texto"
              :data-testid="`avaliar-${x.vinculo}-${x.marco}`"
              @acionar="pedir(x)"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <AbrirAvaliacao
      v-model:visivel="dialogo"
      :ciclos="ciclos.data.value ?? []"
      :colaborador="alvo ? { vinculo: alvo.vinculo, nome: alvo.nome } : null"
      :marco="alvo?.marco ?? null"
      @aberta="aposAbrir"
    />
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
