<script setup lang="ts">
// Kits e carrinhos de parada rastreáveis (ficha do M28, seção 7): `/suprimentos/kits`. Os carrinhos (kits
// rastreáveis) por local, com os itens, lotes, validades e o saldo de cada um; a conferência com o lacre numerado e
// o checklist (gravada no novo, com o conferente); os kits padrão com o cadastro da composição e dos procedimentos. A reposição pelo documento
// de saída é P2 e segue desligada enquanto a receita não for provada (POL-3).
import type { KitRastreavel } from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { conferirCarrinho, listarKits, novaChave } from '../api-suprimentos.js';
import AvisoSuprimentos from '../componentes/AvisoSuprimentos.vue';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import KitPadraoCadastro from '../componentes/KitPadraoCadastro.vue';
import { data, qtd, quando, usarSuprimentos } from '../usar-suprimentos.js';

const { t } = useI18n();
const cliente = useQueryClient();
const { pode, motivo, motivoFuncionalidade } = usarSuprimentos();
const kits = useQuery({ queryKey: ['suprimentos', 'kits'], queryFn: () => listarKits() });
const aberto = ref<number | null>(null);
const lacre = ref('');
const pendencias = ref('');
const conferidos = ref<Record<number, boolean>>({});
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
function abrir(k: KitRastreavel): void {
  aberto.value = aberto.value === k.id ? null : k.id;
  lacre.value = '';
  pendencias.value = '';
  conferidos.value = {};
}
async function conferir(k: KitRastreavel): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await conferirCarrinho(
      k.id,
      {
        lacre: lacre.value.trim(),
        itensConferidos: k.itens.filter((i) => conferidos.value[i.id]).map((i) => i.id),
        ...(pendencias.value.trim() ? { pendencias: pendencias.value.trim() } : {}),
      },
      novaChave('carrinho'),
    );
    mensagem.value = r.mensagem;
    aberto.value = null;
    await cliente.invalidateQueries({ queryKey: ['suprimentos', 'kits'] });
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="kit-titulo" data-testid="tela-suprimentos-kits">
    <h1 id="kit-titulo">{{ t('suprimentos.kits.titulo') }}</h1>
    <p>{{ t('suprimentos.kits.texto') }}</p>
    <AvisoSuprimentos :motivo="motivoFuncionalidade('suprimentos.kits')" />
    <AvisoSuprimentos
      :motivo="pode('suprimentos.reporKitRastreavel') ? null : motivo('suprimentos.reporKitRastreavel')"
    />
    <ErroSuprimentos v-if="kits.error.value" :erro="kits.error.value" />
    <p v-else-if="!kits.data.value" role="status">{{ t('suprimentos.carregando') }}</p>
    <p v-else-if="kits.data.value.length === 0">{{ t('suprimentos.nenhum') }}</p>
    <div v-for="k in kits.data.value ?? []" :key="k.id" class="painel" :data-testid="`kit-${k.id}`">
      <h2>
        {{ k.nome }} · {{ k.localNome }}
        <span v-if="k.emergencial" class="secundario"> · {{ t('suprimentos.kits.emergencial') }}</span>
      </h2>
      <p>
        <template v-if="k.conferencia">
          {{
            t('suprimentos.kits.ultimaConferencia', {
              lacre: k.conferencia.lacre,
              quem: k.conferencia.conferente,
              em: quando(k.conferencia.em),
            })
          }}
          · {{ k.conferencia.completa ? t('suprimentos.kits.completa') : t('suprimentos.kits.incompleta') }}
        </template>
        <template v-else>{{ t('suprimentos.kits.semConferencia') }}</template>
        <strong v-if="k.vencendo > 0"> · {{ t('suprimentos.kits.vencendo', { n: k.vencendo }) }}</strong>
      </p>
      <SanteBotao
        variante="secundario"
        :rotulo="aberto === k.id ? t('suprimentos.fechar') : t('suprimentos.kits.conferir')"
        :data-testid="`kit-abrir-${k.id}`"
        @acionar="abrir(k)"
      />
      <form v-if="aberto === k.id" @submit.prevent="conferir(k)">
        <table class="tabela">
          <caption>
            {{
              t('suprimentos.kits.checklist')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('suprimentos.kits.conferido') }}</th>
              <th scope="col">{{ t('suprimentos.item') }}</th>
              <th scope="col">{{ t('suprimentos.lote') }}</th>
              <th scope="col">{{ t('suprimentos.quantidade') }}</th>
              <th scope="col">{{ t('suprimentos.saldo') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in k.itens" :key="i.id">
              <td>
                <input
                  :id="`kit-c-${i.id}`"
                  v-model="conferidos[i.id]"
                  type="checkbox"
                  :data-testid="`kit-item-${i.item}`"
                />
                <label :for="`kit-c-${i.id}`" class="sgh-visualmente-oculto"
                  >{{ t('suprimentos.kits.conferido') }} {{ i.nome }}</label
                >
              </td>
              <td>
                {{ i.item }} · {{ i.nome
                }}<span v-if="i.obrigatorio" class="secundario">
                  · {{ t('suprimentos.kits.obrigatorio') }}</span
                >
              </td>
              <td>
                {{ i.lote ?? '—' }}<template v-if="i.validade"> · {{ data(i.validade) }}</template>
              </td>
              <td>{{ qtd(i.quantidade) }}</td>
              <td>{{ qtd(i.saldo) }}</td>
            </tr>
          </tbody>
        </table>
        <span class="campo">
          <label :for="`kit-lacre-${k.id}`">{{ t('suprimentos.kits.lacre') }}</label>
          <input
            :id="`kit-lacre-${k.id}`"
            v-model="lacre"
            maxlength="30"
            :data-testid="`kit-lacre-${k.id}`"
          />
        </span>
        <span class="campo">
          <label :for="`kit-pend-${k.id}`">{{ t('suprimentos.kits.pendencias') }}</label>
          <input :id="`kit-pend-${k.id}`" v-model="pendencias" maxlength="250" />
        </span>
        <SanteBotao
          tipo="submit"
          :rotulo="t('suprimentos.kits.gravarConferencia')"
          :desabilitado="!lacre.trim()"
          :data-testid="`kit-gravar-${k.id}`"
        />
      </form>
    </div>
    <p v-if="mensagem" role="status" data-testid="kit-mensagem">{{ mensagem }}</p>
    <ErroSuprimentos v-if="erro" :erro="erro" />
    <!-- F3.6 (05-SUP linha 13): o kit padrão é cadastrado aqui (composição e procedimentos), não só consultado. -->
    <KitPadraoCadastro :pode-editar="pode('suprimentos.gravarKitPadrao')" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
