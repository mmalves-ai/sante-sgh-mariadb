<script setup lang="ts">
// Painel interno do verificador público (M49, etapa 3; item `Portais > Verificador público de documentos`; permissão
// `documento.verificador.ler`): o endereço público, o limite de consultas por origem e as consultas dos últimos 30 dias
// por resultado (contagens agregadas: nada de quem consultou além da origem mascarada, que nem aparece aqui). Um campo
// abre a verificação de um código na página pública.
import { SITUACOES_VERIFICACAO } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import ErroAssinatura from '../componentes/ErroAssinatura.vue';
import { lerPainelVerificador } from '../api-assinatura.js';

const { t } = useI18n();
const roteador = useRouter();
const q = useQuery({
  queryKey: ['assinatura', 'verificador', 'painel'],
  queryFn: () => lerPainelVerificador(),
});
const colunas = [...SITUACOES_VERIFICACAO.filter((s) => s !== 'suspenso'), 'barrada'] as const;
const rotulo = (c: (typeof colunas)[number]) =>
  c === 'barrada' ? t('assinatura.verificador.painel.barrada') : t(`assinatura.verificador.situacoes.${c}`);
const codigo = ref('');
const invalido = ref(false);
function abrir() {
  const c = codigo.value.trim();
  invalido.value = !/^[A-Za-z0-9_-]{16,64}$/.test(c);
  if (!invalido.value) void roteador.push({ name: 'assinatura.verificar', params: { codigo: c } });
}
</script>

<template>
  <section
    class="tela-assinatura"
    aria-labelledby="painel-verif-titulo"
    data-testid="tela-painel-verificador"
  >
    <h1 id="painel-verif-titulo">{{ t('assinatura.verificador.painel.titulo') }}</h1>
    <p>{{ t('assinatura.verificador.painel.subtitulo') }}</p>
    <ErroAssinatura v-if="q.isError.value" :erro="q.error.value" />
    <p v-else-if="!q.data.value" role="status">{{ t('assinatura.carregando') }}</p>
    <template v-else>
      <div class="bloco">
        <p>
          {{ t('assinatura.verificador.painel.endereco') }}:
          <code data-testid="painel-verif-endereco">{{
            t('assinatura.verificador.painel.modelo', { endereco: q.data.value.endereco })
          }}</code>
        </p>
        <p data-testid="painel-verif-limite">
          {{ t('assinatura.verificador.painel.limite', { n: q.data.value.limitePorMinuto }) }}
        </p>
      </div>
      <form class="bloco" @submit.prevent="abrir">
        <SanteCampoTexto
          id="painel-verif-codigo"
          v-model="codigo"
          :rotulo="t('assinatura.verificador.codigo')"
          :max-bytes="64"
        />
        <SanteAlerta v-if="invalido" :texto="t('assinatura.verificador.codigoInvalido')" anunciar />
        <SanteBotao :rotulo="t('assinatura.verificador.painel.abrir')" tipo="submit" variante="secundario" />
      </form>
      <p v-if="q.data.value.dias.length === 0" data-testid="painel-verif-vazio">
        {{ t('assinatura.verificador.painel.nenhuma') }}
      </p>
      <table v-else class="tabela" data-testid="painel-verif-tabela">
        <caption class="secundario">
          {{
            t('assinatura.verificador.painel.subtitulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('assinatura.verificador.painel.dia') }}</th>
            <th v-for="c in colunas" :key="c" scope="col">{{ rotulo(c) }}</th>
            <th scope="col">{{ t('assinatura.verificador.painel.total') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in q.data.value.dias" :key="d.dia" :data-dia="d.dia">
            <th scope="row">{{ d.dia.split('-').reverse().join('/') }}</th>
            <td v-for="c in colunas" :key="c" :data-coluna="c">{{ d.porResultado[c] ?? 0 }}</td>
            <td data-coluna="total">{{ d.total }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped src="../estilo-assinatura.css"></style>
