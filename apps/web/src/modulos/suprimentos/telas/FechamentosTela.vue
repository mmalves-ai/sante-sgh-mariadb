<script setup lang="ts">
// Fechamento mensal (ficha do M28, seção 7; regra 9): `/suprimentos/fechamentos`. Os meses fechados, o próximo a
// fechar e as ocorrências (reabertura com motivo e autor). Fechar e reabrir são P2: desligados até os efeitos do
// fechamento serem conferidos no cenário controlado (POL-3); reabrir exige a marca de desbloqueio e o motivo.
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { fecharMes, lerFechamentos, novaChave, reabrirMes } from '../api-suprimentos.js';
import AvisoSuprimentos from '../componentes/AvisoSuprimentos.vue';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { quando, usarSuprimentos } from '../usar-suprimentos.js';

const { t } = useI18n();
const cliente = useQueryClient();
const { pode, motivo } = usarSuprimentos();
const f = useQuery({ queryKey: ['suprimentos', 'fechamentos'], queryFn: () => lerFechamentos() });
const motivoReabrir = ref('');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const mm = (x: { ano: number; mes: number }) => `${String(x.mes).padStart(2, '0')}/${x.ano}`;
async function fechar(): Promise<void> {
  const p = f.data.value?.proximo;
  if (!p) return;
  erro.value = null;
  mensagem.value = null;
  try {
    mensagem.value = (await fecharMes(p, novaChave('fechar'))).mensagem;
    await cliente.invalidateQueries({ queryKey: ['suprimentos'] });
  } catch (x) {
    erro.value = x;
  }
}
async function reabrir(x: { ano: number; mes: number }): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    mensagem.value = (
      await reabrirMes({ ...x, motivo: motivoReabrir.value.trim() }, novaChave('reabrir'))
    ).mensagem;
    await cliente.invalidateQueries({ queryKey: ['suprimentos'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="fec-titulo" data-testid="tela-suprimentos-fechamentos">
    <h1 id="fec-titulo">{{ t('suprimentos.fechamentos.titulo') }}</h1>
    <p>{{ t('suprimentos.fechamentos.texto') }}</p>
    <AvisoSuprimentos :motivo="pode('suprimentos.fecharMes') ? null : motivo('suprimentos.fecharMes')" />
    <ErroSuprimentos v-if="f.error.value" :erro="f.error.value" />
    <p v-else-if="!f.data.value" role="status">{{ t('suprimentos.carregando') }}</p>
    <template v-else>
      <p data-testid="fec-proximo">
        {{ t('suprimentos.fechamentos.proximo') }} {{ mm(f.data.value.proximo) }}
        <SanteBotao
          v-if="pode('suprimentos.fecharMes')"
          :rotulo="t('suprimentos.fechamentos.fechar')"
          @acionar="fechar"
        />
      </p>
      <span v-if="pode('suprimentos.reabrirMes')" class="campo">
        <label for="fec-motivo">{{ t('suprimentos.fechamentos.motivo') }}</label>
        <input id="fec-motivo" v-model="motivoReabrir" />
      </span>
      <table class="tabela" data-testid="fec-meses">
        <caption>
          {{
            t('suprimentos.fechamentos.fechados')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.competencia') }}</th>
            <th scope="col">{{ t('suprimentos.fechamentos.exportado') }}</th>
            <th scope="col">{{ t('suprimentos.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in f.data.value.fechados" :key="`${x.ano}-${x.mes}`">
            <td>{{ mm(x) }}</td>
            <td>{{ x.exportado ? t('suprimentos.sim') : t('suprimentos.nao') }}</td>
            <td>
              <SanteBotao
                v-if="pode('suprimentos.reabrirMes')"
                variante="texto"
                :rotulo="t('suprimentos.fechamentos.reabrir')"
                :desabilitado="!motivoReabrir.trim()"
                @acionar="reabrir(x)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <h2>{{ t('suprimentos.ocorrencias') }}</h2>
      <ul v-if="f.data.value.ocorrencias.length">
        <li v-for="(o, k) in f.data.value.ocorrencias" :key="k">
          {{ o.tipo }} · {{ mm(o) }} · {{ o.motivo }} · {{ o.autor }} · {{ quando(o.em) }}
        </li>
      </ul>
      <p v-else>{{ t('suprimentos.nenhum') }}</p>
    </template>
    <p v-if="mensagem" role="status">{{ mensagem }}</p>
    <ErroSuprimentos v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
