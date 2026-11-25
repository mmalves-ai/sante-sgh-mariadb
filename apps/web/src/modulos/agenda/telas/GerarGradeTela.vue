<script setup lang="ts">
// Gerar horários por período (ficha do M17, seção 7): `/agenda/consultas/gerar`. Prévia antes de gravar (feriados,
// bloqueios, existentes e o corte de hoje ficam de fora); a gravação manda a assinatura da prévia e o servidor
// recusa se a lista mudou (agenda.gerarGrade).
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { PreviaGrade } from '@sgh/contratos';
import { codigoDaRecusa, gerarGrade, novaChave, previaGrade } from '../api-agenda.js';
import AvisoGravacao from '../componentes/AvisoGravacao.vue';
import ErroAgenda from '../componentes/ErroAgenda.vue';
import { dataBr, horaBr } from '../formato.js';
import { usarAgenda } from '../usar-agenda.js';

const { t } = useI18n();
const cliente = useQueryClient();
const { opcoesAgenda, pode, motivoGravacao } = usarAgenda();
const agenda = ref('');
const de = ref('');
const ate = ref('');
const duracao = ref('');
const feriados = ref(false);
const previa = ref<PreviaGrade | null>(null);
const chave = ref(novaChave('gerar'));
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const podeGerar = pode('agenda.gerarGrade');
const escolhas = computed(() => [{ valor: '', rotulo: t('agenda.escolha') }, ...opcoesAgenda.value]);
const pedido = () => ({
  agenda: Number(agenda.value),
  de: de.value,
  ate: ate.value,
  duracaoMinutos: duracao.value ? Number(duracao.value) : null,
  incluirFeriados: feriados.value,
});

async function verPrevia(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  previa.value = null;
  ocupado.value = true;
  try {
    previa.value = await previaGrade(pedido());
    chave.value = novaChave('gerar');
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
async function gravar(): Promise<void> {
  if (!previa.value) return;
  erro.value = null;
  ocupado.value = true;
  try {
    const r = await gerarGrade({ ...pedido(), assinatura: previa.value.assinatura }, chave.value);
    mensagem.value = r.mensagem;
    previa.value = null;
    await cliente.invalidateQueries({ queryKey: ['agenda'] });
  } catch (e) {
    erro.value = e;
    if (codigoDaRecusa(e) === 'previa-desatualizada') previa.value = null;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="gerar-titulo" data-testid="tela-gerar">
    <h1 id="gerar-titulo">{{ t('agenda.gerar.titulo') }}</h1>
    <p>{{ t('agenda.gerar.texto') }}</p>
    <AvisoGravacao :motivo="motivoGravacao" />
    <form class="filtros" @submit.prevent="verPrevia">
      <SanteSelecao v-model="agenda" :rotulo="t('agenda.agenda')" :opcoes="escolhas" />
      <div class="campo">
        <label for="gerar-de">{{ t('agenda.de') }}</label>
        <input id="gerar-de" v-model="de" type="date" required data-testid="gerar-de" />
      </div>
      <div class="campo">
        <label for="gerar-ate">{{ t('agenda.ate') }}</label>
        <input id="gerar-ate" v-model="ate" type="date" required data-testid="gerar-ate" />
      </div>
      <div class="campo">
        <label for="gerar-duracao">{{ t('agenda.gerar.duracao') }}</label>
        <input id="gerar-duracao" v-model="duracao" type="number" min="5" max="240" step="5" />
      </div>
      <label
        ><input v-model="feriados" type="checkbox" data-testid="gerar-feriados" />
        {{ t('agenda.gerar.feriados') }}</label
      >
      <SanteBotao tipo="submit" :rotulo="t('agenda.gerar.previa')" :desabilitado="!agenda || ocupado" />
    </form>

    <section v-if="previa" class="painel" aria-labelledby="gerar-previa" data-testid="previa-grade">
      <h2 id="gerar-previa">
        {{ t('agenda.gerar.resumoPrevia', { n: previa.horarios, dias: previa.porDia.length }) }}
      </h2>
      <p class="secundario" data-testid="previa-pulados">
        {{
          t('agenda.gerar.pulados', {
            feriados: previa.pulados.feriados.length,
            bloqueados: previa.pulados.bloqueados,
            existentes: previa.pulados.existentes,
            hoje: previa.pulados.cortadosHoje,
          })
        }}
      </p>
      <SanteAlerta v-for="a in previa.alertas" :key="a.codigo" variante="aviso" :texto="a.texto" />
      <p v-if="previa.horarios === 0">{{ t('agenda.gerar.nada') }}</p>
      <table v-else class="tabela">
        <caption class="sgh-visualmente-oculto">
          {{
            t('agenda.gerar.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('agenda.data') }}</th>
            <th scope="col">{{ t('agenda.escalas.dia') }}</th>
            <th scope="col">{{ t('agenda.bloqueios.horarios') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in previa.porDia" :key="d.data" :data-testid="`previa-dia-${d.data}`">
            <td>{{ dataBr(d.data) }}</td>
            <td>{{ d.dia }}</td>
            <td>{{ d.horarios.map(horaBr).join(' · ') }}</td>
          </tr>
        </tbody>
      </table>
      <SanteBotao
        v-if="podeGerar && previa.horarios > 0"
        :rotulo="t('agenda.gerar.gravar', { n: previa.horarios })"
        :desabilitado="ocupado"
        @acionar="gravar"
      />
    </section>
    <p v-if="mensagem" role="status" data-testid="gerar-mensagem">{{ mensagem }}</p>
    <ErroAgenda v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../componentes/estilo-agenda.css"></style>
