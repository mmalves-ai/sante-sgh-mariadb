<script setup lang="ts">
// Laboratório de apoio (envio e retorno) (M34; ficha, seção 7 e regra 13): `/sadt/laboratorio/apoio`. A fila dos
// retornos a conferir (o resultado estruturado pelo de-para: elemento, valor, unidade e referência; o que não casa
// segura a aprovação), a aprovação pelo responsável técnico habilitado (`sadt.apoio.conferir`: grava no exame) ou a
// recusa com o motivo; abaixo, o CRUD genérico do de-para (exames, elementos e materiais do laboratório de apoio).
import type { RetornoApoioLido } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import GrupoDominiosTela from '../../config/telas/GrupoDominiosTela.vue';
import RemessaApoio from '../componentes/RemessaApoio.vue';
import { codigoDaRecusa, conferirRetorno, lerInterfacesApoio, lerRetornos } from '../api-integracoes.js';

const { t, te } = useI18n();
const cliente = useQueryClient();
const podeConferir = pode('sadt.apoio.conferir');
const retornos = useQuery({ queryKey: ['integracoes', 'apoio', 'retornos'], queryFn: () => lerRetornos() });
const interfaces = useQuery({
  queryKey: ['integracoes', 'apoio', 'interfaces'],
  queryFn: () => lerInterfacesApoio(),
});
const recusando = ref<RetornoApoioLido | null>(null);
const motivo = ref('');
const erro = ref<unknown>(null);
const feito = ref<string | null>(null);
const recusa = computed(() => {
  const c = codigoDaRecusa(erro.value);
  return c && te(`integracoes.recusas.${c}`) ? `integracoes.recusas.${c}` : null;
});

async function decidir(r: RetornoApoioLido, decisao: 'aprovar' | 'recusar'): Promise<void> {
  erro.value = null;
  feito.value = null;
  try {
    const x = await conferirRetorno(r.recebida, decisao, decisao === 'recusar' ? motivo.value : null);
    feito.value =
      x.situacao === 'processada'
        ? t('integracoes.apoio.aprovado', { n: x.exame })
        : t('integracoes.apoio.recusado');
    recusando.value = null;
    motivo.value = '';
    await cliente.invalidateQueries({ queryKey: ['integracoes', 'apoio', 'retornos'] });
  } catch (e) {
    erro.value = e;
  }
}
const numero = (v: number | null) => (v === null ? '—' : v.toLocaleString('pt-BR'));
</script>

<template>
  <section class="tela-agenda" aria-labelledby="apoio-titulo" data-testid="tela-laboratorio-apoio">
    <h1 id="apoio-titulo">{{ t('integracoes.apoio.titulo') }}</h1>
    <p>{{ t('integracoes.apoio.texto') }}</p>
    <p v-if="interfaces.data.value" class="secundario">
      {{
        t('integracoes.apoio.interfaces', {
          lista: interfaces.data.value.map((i) => `${i.nome ?? i.codigo} (${i.exames})`).join(', ') || '—',
        })
      }}
    </p>
    <h2>{{ t('integracoes.apoio.fila') }}</h2>
    <p v-if="feito" role="status" data-testid="apoio-feito">{{ feito }}</p>
    <div v-if="recusa" role="alert"><SanteAlerta variante="alerta" :texto="t(recusa)" /></div>
    <MensagemErro v-else-if="erro" :erro="erro" />
    <MensagemErro v-if="retornos.isError.value" :erro="retornos.error.value" />
    <p v-else-if="!retornos.data.value" role="status">{{ t('integracoes.carregando') }}</p>
    <p v-else-if="retornos.data.value.length === 0">{{ t('integracoes.apoio.semFila') }}</p>
    <article
      v-for="r in retornos.data.value ?? []"
      :key="r.recebida"
      class="painel"
      :data-testid="`retorno-${r.recebida}`"
    >
      <h3>
        {{ t('integracoes.apoio.exame', { n: r.exame }) }} · {{ r.exameNome ?? '' }} ·
        {{ t('integracoes.apoio.protocolo', { p: r.protocolo }) }}
      </h3>
      <p class="secundario">
        {{ t('integracoes.apoio.paciente', { n: r.paciente.id ?? '—' }) }} ·
        {{ r.recebidoEm.slice(0, 16).replace('T', ' ') }}
      </p>
      <table class="tabela">
        <caption>
          {{
            t('integracoes.apoio.exame', { n: r.exame })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('integracoes.apoio.elemento') }}</th>
            <th scope="col">{{ t('integracoes.apoio.valor') }}</th>
            <th scope="col">{{ t('integracoes.apoio.unidade') }}</th>
            <th scope="col">{{ t('integracoes.apoio.referencia') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in r.elementos" :key="e.elemento">
            <td>
              {{ e.nome }} <span class="secundario">{{ e.codigoApoio }}</span>
            </td>
            <td>{{ e.numerico !== null ? numero(e.numerico) : (e.alfa ?? '—') }}</td>
            <td>{{ e.unidade ?? '—' }}</td>
            <td>{{ e.referencia ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="r.observacao">{{ r.observacao }}</p>
      <div v-if="r.semDePara.length" role="alert">
        <SanteAlerta
          variante="aviso"
          :texto="t('integracoes.apoio.semDePara', { lista: r.semDePara.join(', ') })"
        />
      </div>
      <template v-if="podeConferir">
        <SanteBotao
          :rotulo="t('integracoes.apoio.aprovar')"
          :desabilitado="r.semDePara.length > 0"
          :data-testid="`retorno-aprovar-${r.recebida}`"
          @acionar="decidir(r, 'aprovar')"
        />
        <SanteBotao variante="texto" :rotulo="t('integracoes.apoio.recusar')" @acionar="recusando = r" />
        <form
          v-if="recusando?.recebida === r.recebida"
          class="formulario"
          @submit.prevent="decidir(r, 'recusar')"
        >
          <SanteCampoTexto
            v-model="motivo"
            :rotulo="t('integracoes.apoio.motivoRecusa')"
            :max-bytes="200"
            obrigatorio
          />
          <SanteBotao tipo="submit" variante="secundario" :rotulo="t('integracoes.apoio.recusar')" />
        </form>
      </template>
    </article>
    <RemessaApoio
      v-if="interfaces.data.value?.length"
      :laboratorios="interfaces.data.value.map((i) => ({ codigo: i.codigo, nome: i.nome }))"
    />
    <h2>{{ t('integracoes.apoio.dePara') }}</h2>
    <GrupoDominiosTela subitem="apoioLaboratorio" embutida />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
