<script setup lang="ts">
// Gerar agenda e grade de horários (ficha do M18, seção 7): `/agenda/exames/gerar`. Prévia antes de gravar (feriados,
// horários existentes e o corte de hoje ficam de fora; sábado e domingo não, como a escala de exames sempre foi); as
// faixas são as da escala da agenda ou as informadas aqui; a gravação manda a impressão da prévia e o servidor recusa
// se a lista mudou (agenda.gerarGradeExame).
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import type { PreviaGradeExame } from '@sgh/contratos';
import { dataBr, horaBr, horaDoContrato } from '../../agenda/formato.js';
import { codigoDaRecusa, gerarGradeExame, novaChave, previaGradeExame } from '../api-exames.js';
import AvisoExame from '../componentes/AvisoExame.vue';
import ErroExame from '../componentes/ErroExame.vue';
import { usarExames } from '../usar-exames.js';

const { t } = useI18n();
const rota = useRoute();
const cliente = useQueryClient();
const { opcoesAgenda, pode, motivoGravacao } = usarExames();
const agenda = ref(typeof rota.query['agenda'] === 'string' ? rota.query['agenda'] : '');
const de = ref('');
const ate = ref('');
const duracao = ref('');
const feriados = ref(false);
const usarFaixas = ref(false);
const faixas = ref<{ semana: string; inicio: string; fim: string }[]>([
  { semana: '2', inicio: '07:00', fim: '11:00' },
]);
const previa = ref<PreviaGradeExame | null>(null);
const chave = ref(novaChave('gerar-exame'));
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const podeGerar = pode('agenda.gerarGradeExame');
const escolhas = computed(() => [{ valor: '', rotulo: t('exames.escolha') }, ...opcoesAgenda.value]);
const dias = computed(() =>
  [2, 3, 4, 5, 6].map((d) => ({ valor: String(d), rotulo: t(`exames.dias.${d}`) })),
);
const pedido = () => ({
  agenda: Number(agenda.value),
  de: de.value,
  ate: ate.value,
  duracaoMinutos: duracao.value ? Number(duracao.value) : null,
  faixas: usarFaixas.value
    ? faixas.value.map((f) => ({
        semana: Number(f.semana),
        inicio: horaDoContrato(f.inicio) ?? f.inicio,
        fim: horaDoContrato(f.fim) ?? f.fim,
      }))
    : null,
  incluirFeriados: feriados.value,
});

async function verPrevia(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  previa.value = null;
  ocupado.value = true;
  try {
    previa.value = await previaGradeExame(pedido());
    chave.value = novaChave('gerar-exame');
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
    const r = await gerarGradeExame({ ...pedido(), assinatura: previa.value.assinatura }, chave.value);
    mensagem.value = r.mensagem;
    previa.value = null;
    await cliente.invalidateQueries({ queryKey: ['exames'] });
  } catch (e) {
    erro.value = e;
    if (codigoDaRecusa(e) === 'previa-desatualizada') previa.value = null;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="gerar-exame-titulo" data-testid="tela-gerar-exame">
    <h1 id="gerar-exame-titulo">{{ t('exames.gerar.titulo') }}</h1>
    <p>{{ t('exames.gerar.texto') }}</p>
    <AvisoExame :motivo="motivoGravacao" />
    <form class="filtros" @submit.prevent="verPrevia">
      <SanteSelecao v-model="agenda" :rotulo="t('exames.agenda')" :opcoes="escolhas" />
      <div class="campo">
        <label for="gerar-exame-de">{{ t('exames.de') }}</label>
        <input id="gerar-exame-de" v-model="de" type="date" required data-testid="gerar-exame-de" />
      </div>
      <div class="campo">
        <label for="gerar-exame-ate">{{ t('exames.ate') }}</label>
        <input id="gerar-exame-ate" v-model="ate" type="date" required data-testid="gerar-exame-ate" />
      </div>
      <div class="campo">
        <label for="gerar-exame-duracao">{{ t('exames.gerar.duracao') }}</label>
        <input id="gerar-exame-duracao" v-model="duracao" type="number" min="5" max="240" step="5" />
      </div>
      <label><input v-model="feriados" type="checkbox" /> {{ t('exames.gerar.feriados') }}</label>
      <label><input v-model="usarFaixas" type="checkbox" /> {{ t('exames.gerar.outrasFaixas') }}</label>
      <SanteBotao tipo="submit" :rotulo="t('exames.gerar.previa')" :desabilitado="!agenda || ocupado" />
    </form>
    <fieldset v-if="usarFaixas" class="painel">
      <legend>{{ t('exames.gerar.faixas') }}</legend>
      <div v-for="(f, i) in faixas" :key="i" class="filtros">
        <SanteSelecao v-model="f.semana" :rotulo="t('exames.escalas.dia')" :opcoes="dias" />
        <div class="campo">
          <label :for="`faixa-ini-${i}`">{{ t('exames.gerar.inicio') }}</label>
          <input
            :id="`faixa-ini-${i}`"
            v-model="f.inicio"
            inputmode="numeric"
            :placeholder="t('exames.horaExemplo')"
          />
        </div>
        <div class="campo">
          <label :for="`faixa-fim-${i}`">{{ t('exames.gerar.fim') }}</label>
          <input
            :id="`faixa-fim-${i}`"
            v-model="f.fim"
            inputmode="numeric"
            :placeholder="t('exames.horaExemplo')"
          />
        </div>
        <SanteBotao
          v-if="faixas.length > 1"
          variante="texto"
          :rotulo="t('exames.gerar.retirarFaixa')"
          @acionar="faixas.splice(i, 1)"
        />
      </div>
      <SanteBotao
        variante="secundario"
        :rotulo="t('exames.gerar.incluirFaixa')"
        @acionar="faixas.push({ semana: '3', inicio: '07:00', fim: '11:00' })"
      />
    </fieldset>

    <section
      v-if="previa"
      class="painel"
      aria-labelledby="gerar-exame-previa"
      data-testid="previa-grade-exame"
    >
      <h2 id="gerar-exame-previa">
        {{ t('exames.gerar.resumoPrevia', { n: previa.horarios, dias: previa.porDia.length }) }}
      </h2>
      <p class="secundario">
        {{
          t('exames.gerar.pulados', {
            feriados: previa.pulados.feriados.length,
            existentes: previa.pulados.existentes,
            hoje: previa.pulados.cortadosHoje,
          })
        }}
      </p>
      <SanteAlerta v-for="a in previa.alertas" :key="a.codigo" variante="aviso" :texto="a.texto" />
      <p v-if="previa.horarios === 0">{{ t('exames.gerar.nada') }}</p>
      <table v-else class="tabela">
        <caption class="sgh-visualmente-oculto">
          {{
            t('exames.gerar.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('exames.data') }}</th>
            <th scope="col">{{ t('exames.escalas.dia') }}</th>
            <th scope="col">{{ t('exames.gerar.horarios') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in previa.porDia" :key="d.data">
            <td>{{ dataBr(d.data) }}</td>
            <td>{{ d.dia }}</td>
            <td>{{ d.horarios.map(horaBr).join(' · ') }}</td>
          </tr>
        </tbody>
      </table>
      <SanteBotao
        v-if="podeGerar && previa.horarios > 0"
        :rotulo="t('exames.gerar.gravar', { n: previa.horarios })"
        :desabilitado="ocupado"
        data-testid="botao-gerar-exame"
        @acionar="gravar"
      />
    </section>
    <p v-if="mensagem" role="status" data-testid="gerar-exame-mensagem">{{ mensagem }}</p>
    <ErroExame v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
