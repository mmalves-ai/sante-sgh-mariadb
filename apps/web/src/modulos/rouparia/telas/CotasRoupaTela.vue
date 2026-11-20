<script setup lang="ts">
// Cotas por setor (M55, fatia F2): `/hotelaria/rouparia/cotas`. Escolhido o setor: a cota (o par) de cada peça, o
// estimado no setor (último inventário + entregas − peças coletadas − perdas, com a conta impressa) e a reposição
// sugerida; a edição das cotas do setor (zero tira a cota; só as que mudaram vão ao servidor).
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { gravarCotasRoupa, lerCotaSetorRoupa } from '../api-rouparia.js';
import AvisoRouparia from '../componentes/AvisoRouparia.vue';
import ErroRouparia from '../componentes/ErroRouparia.vue';
import NavRouparia from '../componentes/NavRouparia.vue';
import { cotasAlteradas, instanteCurto, nomeDe } from '../regras-rouparia.js';
import { CHAVE_PAINEL_ROUPARIA, usarPainelRouparia } from '../usar-rouparia.js';

const { t } = useI18n();
const cliente = useQueryClient();
const { painel, d, pode, motivoPode, aviso, opcoesSetor } = usarPainelRouparia();
const setor = ref<number | null>(null);
const situacao = useQuery({
  queryKey: computed(() => ['rouparia', 'cotas', setor.value]),
  queryFn: () => lerCotaSetorRoupa(setor.value!),
  enabled: computed(() => setor.value !== null),
});
const pecasAtivas = computed(() => (d.value?.pecas ?? []).filter((p) => p.ativa));

const valores = reactive<Record<number, string>>({});
watch(
  () => [setor.value, d.value?.cotas] as const,
  ([cc, cotas]) => {
    for (const k of Object.keys(valores)) delete valores[Number(k)];
    if (cc === null || !cotas) return;
    for (const p of pecasAtivas.value) {
      const c = cotas.find((x) => x.centroCusto === cc && x.peca === p.id);
      valores[p.id] = c && c.quantidade > 0 ? String(c.quantidade) : '';
    }
  },
  { immediate: true },
);

const avisos = ref<string[]>([]);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function gravar(): Promise<void> {
  if (setor.value === null || !d.value) return;
  avisos.value = [];
  erro.value = null;
  mensagem.value = null;
  const r = cotasAlteradas(setor.value, valores, d.value.cotas);
  if ('erro' in r) {
    avisos.value = [r.erro];
    return;
  }
  if (r.length === 0) {
    mensagem.value = t('rouparia.cotas.nadaMudou');
    return;
  }
  ocupado.value = true;
  try {
    mensagem.value = (await gravarCotasRoupa({ centroCusto: setor.value, cotas: r })).mensagem;
    await cliente.invalidateQueries({ queryKey: CHAVE_PAINEL_ROUPARIA });
    await cliente.invalidateQueries({ queryKey: ['rouparia', 'cotas'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="cotas-titulo" data-testid="tela-rouparia-cotas">
    <h1 id="cotas-titulo">{{ t('rouparia.cotas.titulo') }}</h1>
    <p>{{ t('rouparia.cotas.texto') }}</p>
    <NavRouparia />
    <AvisoRouparia :motivo="aviso" />
    <SanteAlerta v-if="mensagem" variante="info" :texto="mensagem" anunciar data-testid="cotas-mensagem" />
    <ErroRouparia v-if="painel.isError.value" :erro="painel.error.value" />
    <p v-else-if="!d" role="status">{{ t('rouparia.carregando') }}</p>
    <template v-else>
      <div class="filtros">
        <SanteSelecao
          v-model="setor"
          :rotulo="t('rouparia.cotas.setor')"
          :opcoes="opcoesSetor"
          busca
          data-testid="cotas-setor"
        />
      </div>
      <p v-if="setor === null">{{ t('rouparia.cotas.escolha') }}</p>
      <template v-else>
        <ErroRouparia v-if="situacao.isError.value" :erro="situacao.error.value" />
        <p v-else-if="!situacao.data.value" role="status">{{ t('rouparia.carregando') }}</p>
        <section v-else class="painel" aria-labelledby="cotas-situacao">
          <h2 id="cotas-situacao">{{ t('rouparia.cotas.reposicao') }}</h2>
          <p class="secundario">
            {{
              situacao.data.value.inventarioEm
                ? t('rouparia.cotas.inventario', { em: instanteCurto(situacao.data.value.inventarioEm) })
                : t('rouparia.cotas.semInventario')
            }}
          </p>
          <p v-if="situacao.data.value.itens.length === 0">{{ t('rouparia.cotas.nenhuma') }}</p>
          <table v-else class="tabela" data-testid="cotas-situacao">
            <caption>
              {{
                t('rouparia.cotas.reposicao')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('rouparia.campos.peca') }}</th>
                <th scope="col">{{ t('rouparia.cotas.cota') }}</th>
                <th scope="col">{{ t('rouparia.cotas.estimado') }}</th>
                <th scope="col">{{ t('rouparia.cotas.reposicao') }}</th>
                <th scope="col">{{ t('rouparia.cotas.conta') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="x in situacao.data.value.itens"
                :key="x.peca"
                :data-testid="`cota-${x.peca}`"
                :data-reposicao="x.reposicao"
              >
                <td>{{ nomeDe(d.pecas, (p) => p.id, x.peca) }}</td>
                <td>{{ x.cota }}</td>
                <td>{{ x.estimado }}</td>
                <td>
                  <strong :class="x.reposicao > 0 ? 'alerta-texto' : ''">{{ x.reposicao }}</strong>
                </td>
                <td class="secundario">{{ x.conta }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="painel" aria-labelledby="cotas-editar">
          <h2 id="cotas-editar">{{ t('rouparia.cotas.editar') }}</h2>
          <p v-if="!pode" class="secundario">{{ motivoPode }}</p>
          <form v-else class="formulario" data-testid="cotas-form" @submit.prevent="gravar">
            <div class="grade">
              <div v-for="p in pecasAtivas" :key="p.id" class="campo">
                <label :for="`cota-${p.id}`">{{ p.nome }}</label>
                <input
                  :id="`cota-${p.id}`"
                  v-model="valores[p.id]"
                  type="number"
                  min="0"
                  max="9999"
                  :data-testid="`cota-valor-${p.id}`"
                />
              </div>
            </div>
            <ErroRouparia :erro="erro" :mensagens="avisos" />
            <SanteBotao
              tipo="submit"
              :rotulo="t('rouparia.cotas.gravar')"
              :desabilitado="ocupado"
              data-testid="cotas-gravar"
            />
          </form>
        </section>
      </template>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="./estilo-rouparia.css"></style>
