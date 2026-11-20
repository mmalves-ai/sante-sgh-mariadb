<script setup lang="ts">
// Identificação pendente (ficha do M20, regra 9): os cadastros temporários marcados como paciente não identificado,
// com o prontuário e as características para a identificação. A lista só é lida quando a pessoa abre a seção (a
// leitura vai à trilha: dado pessoal sensível). Identificar = escolher o cadastro de destino da pessoa: a marca é
// encerrada e a unificação dos dois cadastros segue pela fila de duplicidades do cadastro de pacientes.
import type { ResultadoBuscaPaciente } from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { buscarPacientes } from '../../cadastro/api-cadastro.js';
import { identificarPaciente, listarNaoIdentificados, novaChave } from '../api-atendimento.js';
import ErroAtendimento from './ErroAtendimento.vue';

const props = defineProps<{ podeIdentificar: boolean }>();
const { t } = useI18n();
const cliente = useQueryClient();
const aberta = ref(false);
const lista = useQuery({
  queryKey: ['atendimento', 'nao-identificados'],
  queryFn: () => listarNaoIdentificados(),
  enabled: aberta,
});
const pendentes = computed(() => (lista.data.value ?? []).filter((x) => x.identificadoEm === null));
const emIdentificacao = ref<number | null>(null);
const termo = ref('');
const pedido = ref('');
const busca = useQuery({
  queryKey: computed(() => ['atendimento', 'identificar', pedido.value]),
  queryFn: (): Promise<ResultadoBuscaPaciente> => buscarPacientes(pedido.value),
  enabled: computed(() => pedido.value.length >= 2),
});
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function identificar(paciente: number, destino: number): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await identificarPaciente(paciente, destino, novaChave('identificar'));
    mensagem.value = r.mensagem;
    emIdentificacao.value = null;
    pedido.value = '';
    termo.value = '';
    await cliente.invalidateQueries({ queryKey: ['atendimento', 'nao-identificados'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const quando = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}`;
</script>

<template>
  <details
    class="painel"
    data-testid="identificacao-pendente"
    @toggle="aberta = ($event.target as HTMLDetailsElement).open"
  >
    <summary>{{ t('atendimento.naoIdentificado.titulo') }}</summary>
    <p class="secundario">{{ t('atendimento.naoIdentificado.texto') }}</p>
    <ErroAtendimento v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="aberta && !lista.data.value" role="status">{{ t('atendimento.carregando') }}</p>
    <p v-else-if="lista.data.value && pendentes.length === 0">
      {{ t('atendimento.naoIdentificado.nenhum') }}
    </p>
    <ul v-else-if="pendentes.length" class="lista-simples">
      <li v-for="x in pendentes" :key="x.paciente" :data-testid="`nao-identificado-${x.paciente}`">
        <p>
          <strong>{{ t('atendimento.prontuario', { n: x.prontuario }) }}</strong>
          · {{ x.caracteristicas }} ·
          <span class="secundario">{{
            t('atendimento.naoIdentificado.desde', { quando: quando(x.marcadoEm) })
          }}</span>
          ·
          <RouterLink :to="`/cadastros/pacientes/${x.paciente}`">{{
            t('atendimento.naoIdentificado.cadastro')
          }}</RouterLink>
        </p>
        <template v-if="props.podeIdentificar">
          <SanteBotao
            v-if="emIdentificacao !== x.paciente"
            variante="secundario"
            :rotulo="t('atendimento.naoIdentificado.identificar')"
            :data-testid="`identificar-${x.paciente}`"
            @acionar="((emIdentificacao = x.paciente), (pedido = ''), (termo = ''))"
          />
          <template v-else>
            <form class="filtros" role="search" @submit.prevent="pedido = termo.trim()">
              <div class="campo">
                <label :for="`identificar-termo-${x.paciente}`">{{
                  t('atendimento.naoIdentificado.destino')
                }}</label>
                <input
                  :id="`identificar-termo-${x.paciente}`"
                  v-model="termo"
                  type="search"
                  autocomplete="off"
                  data-testid="identificar-termo"
                />
              </div>
              <SanteBotao tipo="submit" variante="secundario" :rotulo="t('atendimento.buscar')" />
            </form>
            <ErroAtendimento v-if="busca.isError.value" :erro="busca.error.value" />
            <ul v-else-if="busca.data.value" class="lista-simples">
              <li v-for="p in busca.data.value.itens.filter((y) => y.id !== x.paciente)" :key="p.id">
                <SanteBotao
                  variante="texto"
                  :rotulo="
                    t('atendimento.naoIdentificado.escolherDestino', {
                      nome: p.nomeSocial ?? p.nome,
                      pront: p.prontuario,
                    })
                  "
                  :desabilitado="ocupado"
                  :data-testid="`identificar-destino-${p.id}`"
                  @acionar="identificar(x.paciente, p.id)"
                />
              </li>
            </ul>
          </template>
        </template>
      </li>
    </ul>
    <p v-if="mensagem" role="status" data-testid="identificacao-mensagem">{{ mensagem }}</p>
    <ErroAtendimento v-if="erro" :erro="erro" />
  </details>
</template>
