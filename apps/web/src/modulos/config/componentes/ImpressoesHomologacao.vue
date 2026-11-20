<script setup lang="ts">
// M36: "Impressão digital: cópia × homologada × conferências × produção" da tela de verificação de schema — por
// estabelecimento, a impressão homologada, as impressões registradas nas conferências (cada uma com a quantidade) e a
// de produção (tirada pela TI na renovação da cópia; a equipe de construção não lê produção). Só leitura do painel
// da homologação (config.coexistencia.ler).
import type { PainelHomologacao } from '@sgh/contratos';
import { useI18n } from 'vue-i18n';

defineProps<{ painel: PainelHomologacao }>();
const { t } = useI18n();
</script>

<template>
  <section aria-labelledby="titulo-impressoes" data-testid="impressoes-homologacao">
    <h2 id="titulo-impressoes">{{ t('config.homologacao.impressoesTitulo') }}</h2>
    <table>
      <caption>
        {{
          t('config.homologacao.impressoesLegenda')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('config.schema.estabelecimento') }}</th>
          <th scope="col">{{ t('config.homologacao.homologada') }}</th>
          <th scope="col">{{ t('config.homologacao.conferencias') }}</th>
          <th scope="col">{{ t('config.homologacao.producao') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="h in painel.hospitais" :key="h.codigo">
          <th scope="row">{{ h.codigo }}</th>
          <td>
            <code v-if="h.impressaoHomologada">{{ h.impressaoHomologada }}</code>
            <span v-else>{{ h.bloqueio ?? t('config.homologacao.nenhuma') }}</span>
          </td>
          <td>
            <span v-if="Object.keys(h.impressoesConferidas).length === 0">{{
              t('config.homologacao.nenhuma')
            }}</span>
            <ul v-else>
              <li v-for="(n, imp) in h.impressoesConferidas" :key="imp">
                {{ t('config.homologacao.quantas', { impressao: imp, n }) }}
              </li>
            </ul>
          </td>
          <td>{{ painel.producao }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
