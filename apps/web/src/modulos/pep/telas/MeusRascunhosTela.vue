<script setup lang="ts">
// Meus rascunhos (ficha do M22, seção 7): `/pep/rascunhos`, a entrada do item "Registros clínicos" do menu. Os
// rascunhos abertos do profissional (continuar ou descartar) e a busca do paciente para um registro novo.
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { buscarPacientesRegistro, descartarRascunho, listarRascunhos, novaChave } from '../api-registro.js';
import { dataHoraBr } from '../formato.js';

const { t } = useI18n();
const cliente = useQueryClient();
const rascunhos = useQuery({
  queryKey: ['pep', 'reg', 'rascunhos'],
  queryFn: () => listarRascunhos(),
  staleTime: 0,
});
const termo = ref('');
const pedido = ref('');
const busca = useQuery({
  queryKey: computed(() => ['pep', 'reg', 'pacientes', pedido.value]),
  queryFn: () => buscarPacientesRegistro(pedido.value),
  enabled: computed(() => pedido.value.trim().length >= 2),
});
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);

function buscar(): void {
  pedido.value = termo.value.trim();
}
async function descartar(id: number, versao: string): Promise<void> {
  erro.value = null;
  try {
    await descartarRascunho(id, versao, novaChave('descarte'));
    mensagem.value = t('pep.reg.rascunhos.descartado');
    await cliente.invalidateQueries({ queryKey: ['pep', 'reg', 'rascunhos'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="rascunhos-titulo" data-testid="tela-rascunhos">
    <h1 id="rascunhos-titulo">{{ t('pep.reg.rascunhos.titulo') }}</h1>
    <p>{{ t('pep.reg.rascunhos.texto') }}</p>

    <form class="busca" role="search" @submit.prevent="buscar">
      <label for="rascunhos-termo">{{ t('pep.reg.rascunhos.termo') }}</label>
      <input
        id="rascunhos-termo"
        v-model="termo"
        type="search"
        autocomplete="off"
        data-testid="busca-paciente-registro"
      />
      <SanteBotao tipo="submit" :rotulo="t('pep.reg.rascunhos.buscar')" />
    </form>
    <MensagemErro v-if="busca.isError.value" :erro="busca.error.value" />
    <section v-else-if="busca.data.value" aria-labelledby="rascunhos-resultado">
      <h2 id="rascunhos-resultado">
        {{ t('pep.reg.rascunhos.resultado', { n: busca.data.value.itens.length }) }}
      </h2>
      <p v-if="busca.data.value.itens.length === 0">{{ t('pep.reg.rascunhos.nenhum') }}</p>
      <ul v-else class="lista">
        <li v-for="p in busca.data.value.itens" :key="p.id" :data-testid="`registro-paciente-${p.id}`">
          <RouterLink :to="`/pep/${p.id}/registro`">{{
            t('pep.reg.rascunhos.novo', { nome: p.nome })
          }}</RouterLink>
        </li>
      </ul>
    </section>

    <p v-if="mensagem" role="status">{{ mensagem }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <MensagemErro v-if="rascunhos.isError.value" :erro="rascunhos.error.value" />
    <p v-else-if="!rascunhos.data.value" role="status">{{ t('pep.reg.carregando') }}</p>
    <SanteAlerta
      v-else-if="rascunhos.data.value.length === 0"
      variante="info"
      :texto="t('pep.reg.rascunhos.vazio')"
    />
    <table v-else class="tabela" data-testid="tabela-rascunhos">
      <caption>
        {{
          t('pep.reg.rascunhos.legenda', { n: rascunhos.data.value.length })
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('pep.reg.rascunhos.colunas.paciente') }}</th>
          <th scope="col">{{ t('pep.reg.rascunhos.colunas.modelo') }}</th>
          <th scope="col">{{ t('pep.reg.rascunhos.colunas.horario') }}</th>
          <th scope="col">{{ t('pep.reg.rascunhos.colunas.atualizado') }}</th>
          <th scope="col">{{ t('pep.reg.rascunhos.colunas.respostas') }}</th>
          <th scope="col">{{ t('pep.reg.rascunhos.colunas.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rascunhos.data.value" :key="r.id" :data-testid="`rascunho-${r.id}`">
          <td>{{ r.pacienteNome }}</td>
          <td>{{ r.modeloCodigo }} · {{ r.modeloNome }}</td>
          <td>{{ dataHoraBr(r.dataHoraClinica) }}</td>
          <td>{{ dataHoraBr(r.atualizadoEm) }}</td>
          <td>{{ r.respostas }}</td>
          <td class="acoes">
            <RouterLink
              :to="{ path: `/pep/${r.paciente}/registro/${r.modeloCodigo}`, query: { rascunho: r.id } }"
            >
              {{ t('pep.reg.rascunhos.continuar') }}
            </RouterLink>
            <SanteBotao
              variante="destrutivo"
              :rotulo="t('pep.reg.rascunhos.descartar')"
              :confirmacao="
                t('pep.reg.rascunhos.descartarPergunta', {
                  modelo: r.modeloCodigo ?? '',
                  paciente: r.pacienteNome ?? '',
                })
              "
              @acionar="descartar(r.id, r.versao)"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.tela {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-3);
  max-width: 72rem;
}
.busca {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
}
.busca label {
  width: 100%;
  font-weight: 600;
}
.busca input {
  font: inherit;
  flex: 1 1 18rem;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  border-radius: 6px;
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
.lista {
  padding-inline-start: var(--sgh-espaco-4);
}
.tabela {
  border-collapse: collapse;
  width: 100%;
}
.tabela caption {
  text-align: start;
  font-weight: 600;
  padding-bottom: var(--sgh-espaco-1);
}
.tabela th,
.tabela td {
  border-bottom: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  text-align: start;
}
.acoes {
  display: flex;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
</style>
