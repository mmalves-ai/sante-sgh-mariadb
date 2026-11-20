<script setup lang="ts">
// Devolução de doses (ficha do M29, seção 7; regra 6): `/farmacia/devolucoes`. As doses dispensadas ao paciente e a
// sugestão pelos horários marcados como não administrados ou suspensos pela enfermagem, com o lote da saída; a
// devolução estorna a saída e o item da conta pelos gatilhos; a dose ainda não entregue pode ser cancelada.
import type { DoseDispensadaLida } from '@sgh/contratos';
import type { SugestaoDevolucao } from '@sgh/contratos/regras-suprimentos';
import { SanteBotao } from '@sgh/ui';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { cancelarDose, devolver, lerDoses, novaChave } from '../api-farmacia.js';
import AvisoFarmacia from '../componentes/AvisoFarmacia.vue';
import ErroFarmacia from '../componentes/ErroFarmacia.vue';
import { horario, numero, qtd, usarFarmacia } from '../usar-farmacia.js';

const { t } = useI18n();
const { pode, motivo } = usarFarmacia();
const atendimento = ref('');
const local = ref('10');
const doses = ref<DoseDispensadaLida[]>([]);
const sugestoes = ref<SugestaoDevolucao[]>([]);
const qtds = ref<Record<number, string>>({});
const motivoCancelar = ref('');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function abrir(): Promise<void> {
  erro.value = null;
  try {
    const r = await lerDoses(Number(atendimento.value));
    doses.value = r.doses;
    sugestoes.value = r.sugestoes;
    qtds.value = Object.fromEntries(r.sugestoes.map((s) => [s.dose, String(s.quantidade)]));
  } catch (x) {
    erro.value = x;
  }
}
async function devolverDose(d: { dose: number; lote: string | null }, motivoDev: string): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await devolver(
      {
        dose: d.dose,
        local: Number(local.value),
        quantidade: numero(qtds.value[d.dose] ?? '0'),
        ...(d.lote ? { lote: d.lote } : {}),
        motivo: motivoDev,
      },
      novaChave('devolver'),
    );
    mensagem.value = r.mensagem;
    await abrir();
  } catch (x) {
    erro.value = x;
  }
}
async function cancelar(dose: number): Promise<void> {
  erro.value = null;
  try {
    mensagem.value = (await cancelarDose(dose, motivoCancelar.value, novaChave('cancelar'))).mensagem;
    await abrir();
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="devd-titulo" data-testid="tela-farmacia-devolucoes">
    <h1 id="devd-titulo">{{ t('farmacia.devolucoes.titulo') }}</h1>
    <p>{{ t('farmacia.devolucoes.texto') }}</p>
    <AvisoFarmacia :motivo="pode('suprimentos.devolverDose') ? null : motivo('suprimentos.devolverDose')" />
    <div class="filtros">
      <span class="campo">
        <label for="devd-atend">{{ t('farmacia.atendimento') }}</label>
        <input id="devd-atend" v-model="atendimento" inputmode="numeric" data-testid="devd-atendimento" />
      </span>
      <span class="campo">
        <label for="devd-local">{{ t('farmacia.dispensacao.local') }}</label>
        <input id="devd-local" v-model="local" inputmode="numeric" />
      </span>
      <SanteBotao
        variante="secundario"
        :rotulo="t('farmacia.devolucoes.abrir')"
        data-testid="devd-abrir"
        @acionar="abrir"
      />
    </div>
    <ErroFarmacia v-if="erro" :erro="erro" />
    <p v-if="mensagem" role="status" data-testid="devd-mensagem">{{ mensagem }}</p>
    <h2>{{ t('farmacia.devolucoes.sugestoes') }}</h2>
    <p v-if="sugestoes.length === 0">{{ t('farmacia.nenhum') }}</p>
    <table v-else class="tabela" data-testid="devd-sugestoes">
      <caption class="sgh-visualmente-oculto">
        {{
          t('farmacia.devolucoes.sugestoes')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('farmacia.item') }}</th>
          <th scope="col">{{ t('farmacia.motivo') }}</th>
          <th scope="col">{{ t('farmacia.lote') }}</th>
          <th scope="col">{{ t('farmacia.quantidade') }}</th>
          <th scope="col">{{ t('farmacia.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in sugestoes" :key="s.dose" :data-testid="`devd-sugestao-${s.dose}`">
          <td>{{ s.item }}</td>
          <td>{{ t(`farmacia.devolucoes.motivos.${s.motivo}`) }}</td>
          <td>{{ s.lote ?? '—' }}</td>
          <td>
            <label :for="`devd-q-${s.dose}`" class="sgh-visualmente-oculto">{{
              t('farmacia.quantidade')
            }}</label>
            <input :id="`devd-q-${s.dose}`" v-model="qtds[s.dose]" inputmode="decimal" />
          </td>
          <td>
            <SanteBotao
              :rotulo="t('farmacia.devolucoes.devolver')"
              :desabilitado="!pode('suprimentos.devolverDose')"
              :data-testid="`devd-devolver-${s.dose}`"
              @acionar="devolverDose(s, s.motivo)"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <h2>{{ t('farmacia.devolucoes.doses') }}</h2>
    <span class="campo">
      <label for="devd-motivo">{{ t('farmacia.devolucoes.motivoCancelar') }}</label>
      <input id="devd-motivo" v-model="motivoCancelar" maxlength="250" />
    </span>
    <table class="tabela" data-testid="devd-doses">
      <caption class="sgh-visualmente-oculto">
        {{
          t('farmacia.devolucoes.doses')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('farmacia.item') }}</th>
          <th scope="col">{{ t('farmacia.quantidade') }}</th>
          <th scope="col">{{ t('farmacia.lote') }}</th>
          <th scope="col">{{ t('farmacia.situacao') }}</th>
          <th scope="col">{{ t('farmacia.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="d in doses" :key="d.dose" :data-testid="`devd-dose-${d.item}`">
          <td>{{ d.descricao }} · {{ horario(d.dispensadaEm) }}</td>
          <td>{{ qtd(d.quantidade) }}</td>
          <td>{{ d.lote ?? '—' }}</td>
          <td>
            {{
              d.situacaoEntrega === 8
                ? t('farmacia.devolucoes.entregue')
                : t('farmacia.devolucoes.dispensada')
            }}
          </td>
          <td>
            <label :for="`devd-qd-${d.dose}`" class="sgh-visualmente-oculto">{{
              t('farmacia.quantidade')
            }}</label>
            <input
              :id="`devd-qd-${d.dose}`"
              v-model="qtds[d.dose]"
              inputmode="decimal"
              :data-testid="`devd-qtde-${d.dose}`"
            />
            <SanteBotao
              :rotulo="t('farmacia.devolucoes.devolver')"
              :desabilitado="!pode('suprimentos.devolverDose')"
              :data-testid="`devd-devolver-dose-${d.dose}`"
              @acionar="devolverDose(d, 'nao-administrado')"
            />
            <SanteBotao
              v-if="d.situacaoEntrega === 7"
              variante="secundario"
              :rotulo="t('farmacia.devolucoes.cancelar')"
              :desabilitado="!pode('suprimentos.cancelarDispensacao')"
              @acionar="cancelar(d.dose)"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
