<script setup lang="ts">
// Consulta de um cadastro de prescrição (M24; ficha, seção 7) que não cabe no CRUD genérico: kits de medicamento e de
// solução, receitas padrão, itens não padronizados e os parâmetros do item (pela busca do item). Busca pelo nome,
// lista com os campos traduzidos e os componentes de cada linha (itens do kit, vias e princípios).
import type { LinhaCadastroPrescricao, SecaoCadastroPrescricao } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { lerCadastroPrescricao } from '../../api-prescricao.js';

const props = defineProps<{ secao: SecaoCadastroPrescricao; titulo: string; exigeTermo?: boolean }>();
const { t } = useI18n();
const digitado = ref('');
const termo = ref('');
const pronta = computed(() => !props.exigeTermo || termo.value.trim().length >= 2);
const consulta = useQuery({
  queryKey: computed(() => ['presc', 'cadastro', props.secao, termo.value]),
  queryFn: () => lerCadastroPrescricao(props.secao, termo.value),
  enabled: pronta,
});
const aberto = ref<string | null>(null);

function procurar(): void {
  termo.value = digitado.value.trim();
}

type Valor = LinhaCadastroPrescricao['campos'][string];
function valorDe(campo: string, v: Valor): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? t('pep.presc.cadastros.sim') : t('pep.presc.cadastros.nao');
  if (campo === 'atendimento') {
    const r = t(`pep.presc.cadastros.atendimentos.${String(v)}`);
    return r.startsWith('pep.') ? String(v) : r;
  }
  if (campo === 'tipo') return t(`pep.presc.cadastros.filhosTipo.${String(v)}`);
  if (typeof v === 'number') return v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  return String(v);
}
const campos = (l: LinhaCadastroPrescricao) => Object.entries(l.campos);
</script>

<template>
  <section class="bloco" :aria-label="titulo" :data-testid="`consulta-${secao}`">
    <h2>{{ titulo }}</h2>
    <form class="barra" @submit.prevent="procurar">
      <SanteCampoTexto v-model="digitado" :rotulo="t('pep.presc.cadastros.buscar')" :max-bytes="60" />
      <SanteBotao :rotulo="t('pep.presc.cadastros.procurar')" tipo="submit" />
    </form>
    <p v-if="!pronta" role="status">{{ t('pep.presc.cadastros.minimo') }}</p>
    <MensagemErro v-else-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="!consulta.data.value" role="status">{{ t('pep.presc.carregando') }}</p>
    <template v-else>
      <p v-if="consulta.data.value.linhas.length === 0" role="status">{{ t('pep.presc.cadastros.vazio') }}</p>
      <SanteAlerta
        v-if="consulta.data.value.truncada"
        variante="info"
        :texto="t('pep.presc.cadastros.truncada')"
      />
      <ul class="lista" :data-testid="`lista-${secao}`">
        <li v-for="l in consulta.data.value.linhas" :key="l.id" :class="{ inativo: !l.ativo }">
          <strong>{{ l.nome }}</strong>
          <span v-if="!l.ativo"> · {{ t('pep.presc.cadastros.inativo') }}</span>
          <dl class="campos">
            <template v-for="[c, v] in campos(l)" :key="c">
              <dt>{{ t(`pep.presc.cadastros.campos.${c}`) }}</dt>
              <dd>{{ valorDe(c, v) }}</dd>
            </template>
          </dl>
          <template v-if="l.filhos.length > 0">
            <SanteBotao
              :rotulo="t('pep.presc.cadastros.componentes', { nome: l.nome })"
              variante="texto"
              @acionar="aberto = aberto === l.id ? null : l.id"
            />
            <ul v-if="aberto === l.id" :data-testid="`filhos-${secao}-${l.id}`">
              <li v-for="(f, i) in l.filhos" :key="i">
                {{ f.nome }}
                <span v-for="[c, v] in Object.entries(f.campos)" :key="c">
                  · {{ t(`pep.presc.cadastros.campos.${c}`) }}: {{ valorDe(c, v) }}
                </span>
              </li>
            </ul>
          </template>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.bloco {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.barra {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.lista {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--sgh-espaco-2);
}
.lista > li {
  border-bottom: 1px solid var(--sgh-borda);
  padding-bottom: var(--sgh-espaco-2);
}
.inativo strong {
  text-decoration: line-through;
}
.campos {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
  margin: var(--sgh-espaco-1) 0 0;
}
.campos dt {
  font-weight: 600;
}
.campos dd {
  margin: 0;
}
h2 {
  margin: 0;
}
</style>
