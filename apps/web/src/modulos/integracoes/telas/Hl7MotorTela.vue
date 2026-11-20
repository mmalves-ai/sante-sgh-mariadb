<script setup lang="ts">
// HL7 v2 e o motor de integração (M34; ficha, seção 7 e regra 12): `/admin/integracoes/hl7`. Os canais versionados do
// motor (mensagem, direção, destino; ligado só com a chave do estabelecimento e o parceiro ativo), o endereço e a
// resposta do motor, o caminho da classificação de risco externa (o envio em uso OU o motor, nunca os dois; DP-16) e
// as filas HL7 em uso (só contagens). Ligar ou desligar o canal é ativar o parceiro dele.
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { lerHl7 } from '../api-integracoes.js';

const { t } = useI18n();
const hl7 = useQuery({ queryKey: ['integracoes', 'hl7'], queryFn: () => lerHl7() });
</script>

<template>
  <section class="tela-agenda" aria-labelledby="hl7-titulo" data-testid="tela-hl7">
    <h1 id="hl7-titulo">{{ t('integracoes.hl7.titulo') }}</h1>
    <p>{{ t('integracoes.hl7.texto') }}</p>
    <MensagemErro v-if="hl7.isError.value" :erro="hl7.error.value" />
    <p v-else-if="!hl7.data.value" role="status">{{ t('integracoes.carregando') }}</p>
    <template v-else>
      <p>
        {{
          t('integracoes.hl7.motor', {
            e: hl7.data.value.motor.endereco
              ? `${hl7.data.value.motor.endereco} (${hl7.data.value.motor.acessivel ? t('integracoes.hl7.acessivel') : t('integracoes.hl7.inacessivel')})`
              : t('integracoes.hl7.semMotor'),
          })
        }}
      </p>
      <table class="tabela" data-testid="tabela-canais">
        <caption>
          {{
            t('integracoes.hl7.canais')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('integracoes.hl7.canal') }}</th>
            <th scope="col">{{ t('integracoes.hl7.mensagem') }}</th>
            <th scope="col">{{ t('integracoes.hl7.direcao') }}</th>
            <th scope="col">{{ t('integracoes.hl7.destino') }}</th>
            <th scope="col">{{ t('integracoes.hl7.ligado') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in hl7.data.value.canais" :key="c.canal">
            <td>
              {{ c.canal }} <span class="secundario">{{ c.versao }} · {{ c.descricao }}</span>
            </td>
            <td>{{ c.mensagem }}</td>
            <td>{{ t(`integracoes.monitor.direcoes.${c.direcao}`) }}</td>
            <td>{{ c.destino }}</td>
            <td>{{ c.ligado ? t('integracoes.hl7.ligado') : t('integracoes.hl7.desligado') }}</td>
          </tr>
        </tbody>
      </table>
      <p class="secundario">
        {{ t('integracoes.hl7.configurar') }}
        <RouterLink to="/admin/integracoes/parceiros">{{ t('integracoes.parceiros.titulo') }}</RouterLink>
      </p>
      <section class="painel" aria-labelledby="classif-titulo" data-testid="hl7-classificacao">
        <h2 id="classif-titulo">{{ t('integracoes.hl7.classificacao') }}</h2>
        <p>{{ t(`integracoes.hl7.caminhos.${hl7.data.value.classificacaoExterna.caminho}`) }}</p>
        <p class="secundario">{{ hl7.data.value.classificacaoExterna.decisao }}</p>
      </section>
      <table class="tabela">
        <caption>
          {{
            t('integracoes.hl7.filas')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('integracoes.monitor.fila') }}</th>
            <th scope="col">{{ t('integracoes.monitor.quantidade') }}</th>
            <th scope="col">{{ t('integracoes.monitor.maisAntiga') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in hl7.data.value.filasLegado" :key="f.fila">
            <td>{{ f.fila }}</td>
            <td>{{ f.quantidade }}</td>
            <td>{{ f.maisAntiga ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
