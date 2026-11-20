<script setup lang="ts">
// W0-08, parte 8 (mercado M2): a aba "Alertas e recall" dos equipamentos. A lista dos alertas de tecnovigilância e dos
// recolhimentos do fabricante (filtro pela situação), o registro à mão (a importação da Anvisa é parâmetro desligado) e
// o detalhe com os equipamentos do parque afetados e a ação de campo.
import type { ApoioManutencao, SituacaoAlertaEquipamento } from '@sgh/contratos';
import { SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerAlertas } from '../api-manutencao.js';
import { comTodos, dataBr } from '../comum-manutencao.js';
import DetalheAlerta from './DetalheAlerta.vue';
import ErroManutencao from './ErroManutencao.vue';
import FormAlerta from './FormAlerta.vue';

const props = defineProps<{ apoio: ApoioManutencao }>();
const { t } = useI18n();
const cliente = useQueryClient();

const situacao = ref<SituacaoAlertaEquipamento | null>('aberto');
const opcoesSituacao = computed(() =>
  comTodos(
    t('manutencao.todos'),
    (['aberto', 'encerrado'] as const).map((x) => ({
      valor: x,
      rotulo: t(`manutencao.alertas.situacoes.${x}`),
    })),
  ),
);
const lista = useQuery({
  queryKey: computed(() => ['manutencao', 'alertas', 'lista', situacao.value]),
  queryFn: () => lerAlertas(situacao.value),
});
const aberto = ref<number | null>(null);
const registrando = ref(false);
const mensagem = ref<string | null>(null);
const podeEditar = computed(() => props.apoio.pode.editar);

async function registrado(id: number, m: string) {
  registrando.value = false;
  mensagem.value = m;
  await cliente.invalidateQueries({ queryKey: ['manutencao', 'alertas'] });
  aberto.value = id;
}
</script>

<template>
  <section class="bloco" data-testid="aba-alertas">
    <p class="secundario">{{ t('manutencao.alertas.ajuda') }}</p>
    <p v-if="mensagem" role="status" data-testid="alertas-mensagem">{{ mensagem }}</p>
    <DetalheAlerta
      v-if="aberto !== null"
      :id="aberto"
      :key="aberto"
      :pode-editar="podeEditar"
      :ligada="apoio.gravacao.ligada"
      @fechar="aberto = null"
    />
    <div class="acoes">
      <SanteBotao
        v-if="podeEditar"
        :rotulo="t('manutencao.alertas.novo')"
        :desabilitado="!apoio.gravacao.ligada"
        data-testid="alertas-novo"
        @acionar="registrando = true"
      />
    </div>
    <div class="campos">
      <SanteSelecao
        v-model="situacao"
        :rotulo="t('manutencao.alertas.filtro')"
        :opcoes="opcoesSituacao"
        data-testid="alertas-situacao"
      />
    </div>
    <ErroManutencao v-if="lista.isError.value" :erro="lista.error.value" grupo="alerta" />
    <p v-else-if="!lista.data.value" role="status">{{ t('manutencao.carregando') }}</p>
    <p v-else-if="lista.data.value.length === 0" data-testid="alertas-vazio">
      {{ t('manutencao.alertas.vazio') }}
    </p>
    <div v-else class="rolagem">
      <table class="tabela" data-testid="tabela-alertas">
        <thead>
          <tr>
            <th scope="col">{{ t('manutencao.alertas.campos.numero') }}</th>
            <th scope="col">{{ t('manutencao.alertas.campos.titulo') }}</th>
            <th scope="col">{{ t('manutencao.alertas.campos.fabricante') }}</th>
            <th scope="col">{{ t('manutencao.alertas.campos.faixa') }}</th>
            <th scope="col">{{ t('manutencao.alertas.campos.publicadoEm') }}</th>
            <th scope="col">{{ t('manutencao.alertas.campos.situacao') }}</th>
            <th scope="col">{{ t('manutencao.alertas.campos.acoes') }}</th>
            <th scope="col">{{ t('manutencao.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in lista.data.value" :key="x.id" :data-testid="`alerta-${x.id}`">
            <td>{{ x.numero }}</td>
            <td>{{ t(`manutencao.alertas.tipos.${x.tipo}`) }}: {{ x.titulo }}</td>
            <td>{{ x.fabricante }} {{ x.modelo ?? '' }}</td>
            <td>
              {{
                x.serieInicio
                  ? `${x.serieInicio} - ${x.serieFim}`
                  : t('manutencao.alertas.campos.todasSeries')
              }}
            </td>
            <td>{{ x.publicadoEm ? dataBr(x.publicadoEm) : '' }}</td>
            <td>{{ t(`manutencao.alertas.situacoes.${x.situacao}`) }}</td>
            <td>{{ x.acoes }}</td>
            <td>
              <SanteBotao
                variante="secundario"
                :rotulo="t('manutencao.abrir')"
                :data-testid="`alerta-abrir-${x.id}`"
                @acionar="aberto = x.id"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <SanteDialogo v-model:visivel="registrando" :titulo="t('manutencao.alertas.novo')" largura="56rem">
      <FormAlerta
        v-if="registrando"
        :ligada="apoio.gravacao.ligada"
        @gravado="registrado"
        @cancelar="registrando = false"
      />
    </SanteDialogo>
  </section>
</template>

<style scoped src="./estilo-manutencao.css"></style>
