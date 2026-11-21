<script setup lang="ts">
// Tela "Verificação de schema dos dois bancos (versão congelada)" (M02). M36: a impressão da cópia × homologada ×
// conferências × produção (painel da homologação, com config.coexistencia.ler). M58: o cartão da plataforma do banco.
import type { PainelHomologacao, VerificacaoSchemaApi } from '@sgh/contratos';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import {
  buscarPainelHomologacao,
  buscarVerificacaoSchema,
  resumoDiferencas,
  rotuloEstado,
  verificarSchemaAgora,
} from '../api.js';
import ImpressoesHomologacao from '../componentes/ImpressoesHomologacao.vue';

const { t } = useI18n();
const dados = ref<VerificacaoSchemaApi | null>(null);
const erro = ref<string | null>(null);
const verificando = ref(false);

async function carregar(acao: () => Promise<VerificacaoSchemaApi>) {
  erro.value = null;
  try {
    dados.value = await acao();
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e);
  }
}

async function verificar() {
  verificando.value = true;
  await carregar(() => verificarSchemaAgora());
  verificando.value = false;
}

const homologacao = ref<PainelHomologacao | null>(null);

onMounted(async () => {
  await carregar(() => buscarVerificacaoSchema());
  if (!pode('config.coexistencia.ler')) return;
  try {
    homologacao.value = await buscarPainelHomologacao();
  } catch {
    homologacao.value = null; // complementar: a verificação segue sem o painel
  }
});
</script>

<template>
  <section aria-labelledby="titulo-schema">
    <h1 id="titulo-schema">{{ t('config.schema.titulo') }}</h1>
    <p>{{ t('config.schema.texto') }}</p>
    <button type="button" :disabled="verificando" @click="verificar">
      {{ verificando ? t('config.schema.verificando') : t('config.schema.verificar') }}
    </button>
    <p v-if="erro" role="alert">{{ t('config.schema.erro', { erro }) }}</p>
    <table v-if="dados">
      <caption>
        {{
          t('config.schema.legenda')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('config.schema.estabelecimento') }}</th>
          <th scope="col">{{ t('config.schema.verificadaEm') }}</th>
          <th scope="col">{{ t('config.schema.situacao') }}</th>
          <th scope="col">{{ t('config.schema.impressao') }}</th>
          <th scope="col">{{ t('config.schema.divergencias') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="m in dados.marcas" :key="m.estabelecimento">
          <th scope="row">{{ m.estabelecimento }}</th>
          <td>{{ new Date(m.verificadaEm).toLocaleString('pt-BR') }}</td>
          <td>
            {{ rotuloEstado(m.estado)
            }}<span v-if="m.motivo">{{ t('config.schema.motivo', { motivo: m.motivo }) }}</span>
          </td>
          <td>
            <code>{{ m.resumo?.slice(0, 16) ?? '—' }}</code>
          </td>
          <td>{{ resumoDiferencas(m.diferencas) }}</td>
        </tr>
      </tbody>
    </table>
    <p v-if="dados && dados.entreBancos === null">{{ t('config.schema.entreBancosBloqueio') }}</p>
    <ul v-else-if="dados?.entreBancos">
      <li v-for="c in dados.entreBancos" :key="c.a + c.b">
        {{
          t('config.schema.par', {
            a: c.a,
            b: c.b,
            resultado: c.iguais ? t('config.schema.iguais') : c.resumo,
          })
        }}
      </li>
    </ul>
    <ImpressoesHomologacao v-if="homologacao" :painel="homologacao" />
  </section>
</template>
