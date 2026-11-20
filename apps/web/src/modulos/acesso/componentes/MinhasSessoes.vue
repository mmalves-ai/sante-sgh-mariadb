<script setup lang="ts">
// W1-01 (parte 8b): "Minhas sessões" em Preferências > Segurança. Lista as sessões da própria pessoa no
// estabelecimento (início, último uso, dispositivo resumido; a atual marcada) e encerra uma ou todas as outras.
// A atual não se encerra aqui (é o Sair). Cada encerramento vai à trilha no servidor.
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { buscarMinhasSessoes, encerrarMinhasSessoes } from '../api-identidade.js';

const { t } = useI18n();
const cliente = useQueryClient();
const CHAVE = ['sessao', 'minhas-sessoes'] as const;
const consulta = useQuery({ queryKey: CHAVE, queryFn: () => buscarMinhasSessoes() });
const sessoes = computed(() => consulta.data.value ?? []);
const outras = computed(() => sessoes.value.filter((s) => !s.atual).length);
const aviso = ref('');
const recusa = ref('');
const ocupado = ref(false);

const quando = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR');
};

async function encerrar(ref?: string): Promise<void> {
  if (ocupado.value) return;
  ocupado.value = true;
  aviso.value = '';
  recusa.value = '';
  try {
    const r = await encerrarMinhasSessoes(ref);
    aviso.value = t('identidade.sessoes.encerradas', { n: r.encerradas }, r.encerradas);
    await cliente.invalidateQueries({ queryKey: CHAVE });
  } catch (e) {
    const p = e instanceof ErroApi ? e.problema : null;
    recusa.value = p?.detail || p?.title || t('identidade.sessoes.falha');
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="sessoes" aria-labelledby="sessoes-titulo" data-testid="minhas-sessoes">
    <h2 id="sessoes-titulo">{{ t('identidade.sessoes.titulo') }}</h2>
    <p>{{ t('identidade.sessoes.texto') }}</p>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="sessoes-aviso" />
    <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" anunciar data-testid="sessoes-recusa" />
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="consulta.isPending.value">{{ t('identidade.comum.carregando') }}</p>
    <template v-else>
      <p v-if="sessoes.length === 0" data-testid="sessoes-nenhuma">{{ t('identidade.sessoes.nenhuma') }}</p>
      <div v-else class="sessoes__rolagem">
        <table data-testid="sessoes-lista">
          <caption class="oculto">
            {{
              t('identidade.sessoes.titulo')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('identidade.sessoes.colDispositivo') }}</th>
              <th scope="col">{{ t('identidade.sessoes.colInicio') }}</th>
              <th scope="col">{{ t('identidade.sessoes.colUltimoUso') }}</th>
              <th scope="col">
                <span class="oculto">{{ t('identidade.sessoes.encerrar') }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in sessoes" :key="s.ref" :data-testid="`sessao-${s.ref}`">
              <td>
                {{ s.dispositivo ?? t('identidade.sessoes.dispositivoDesconhecido') }}
                <strong v-if="s.atual" data-testid="sessao-atual">
                  ({{ t('identidade.sessoes.atual') }})</strong
                >
                <template v-else-if="s.bloqueada"> ({{ t('identidade.sessoes.bloqueada') }})</template>
              </td>
              <td>{{ quando(s.inicio) }}</td>
              <td>{{ quando(s.ultimoUso) }}</td>
              <td>
                <SanteBotao
                  v-if="!s.atual"
                  :rotulo="t('identidade.sessoes.encerrar')"
                  variante="texto"
                  :desabilitado="ocupado"
                  :data-testid="`sessao-encerrar-${s.ref}`"
                  @acionar="encerrar(s.ref)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <SanteBotao
        v-if="outras > 0"
        :rotulo="t('identidade.sessoes.encerrarOutras', { n: outras }, outras)"
        variante="secundario"
        :desabilitado="ocupado"
        data-testid="sessoes-encerrar-outras"
        @acionar="encerrar()"
      />
    </template>
  </section>
</template>

<style scoped>
.sessoes {
  margin-top: var(--sgh-espaco-4, 2rem);
}
.sessoes__rolagem {
  overflow-x: auto;
  margin-bottom: var(--sgh-espaco-2);
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
  vertical-align: top;
}
</style>
