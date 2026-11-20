<script setup lang="ts">
// Receituário (regras 6 e 7): simples, controle especial e antimicrobiano, com os campos de cada medicamento; o
// texto é conferido no CP1252 antes de enviar; controle especial e antimicrobiano saem para imprimir e assinar à mão.
import { problemasCp1252, TIPOS_RECEITA, type ItemReceita, type TipoReceita } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { emitirReceita, lerReceitas } from '../../api-documentos.js';
import AvisoConsulta from '../../componentes/documentos/AvisoConsulta.vue';
import ListaDocumentos from '../../componentes/documentos/ListaDocumentos.vue';
import SeletorAtendimento from '../../componentes/documentos/SeletorAtendimento.vue';

const props = defineProps<{ paciente: number }>();
const { t } = useI18n();
const cliente = useQueryClient();
const dados = useQuery({
  queryKey: computed(() => ['pep', 'doc', 'receitas', props.paciente]),
  queryFn: () => lerReceitas(props.paciente),
});
const vazio = (): ItemReceita => ({ medicamento: '', posologia: '', quantidade: '', usoContinuo: false });
const atendimento = ref<number | null>(null);
const tipo = ref<TipoReceita>('simples');
const itens = ref<ItemReceita[]>([vazio()]);
const opcoesTipo = computed(() =>
  TIPOS_RECEITA.map((x) => ({ valor: x, rotulo: t(`pep.doc.receitas.tipos.${x}`) })),
);
const orientacoes = ref('');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const foraCp1252 = computed(() =>
  [
    ...itens.value.flatMap((i) => Object.values(i).filter((v): v is string => typeof v === 'string')),
    orientacoes.value,
  ].some((v) => problemasCp1252(v).length > 0),
);
async function emitir(): Promise<void> {
  erro.value = null;
  if (atendimento.value === null) return;
  try {
    await emitirReceita(props.paciente, {
      atendimento: atendimento.value,
      tipo: tipo.value,
      itens: itens.value.map((i) =>
        Object.fromEntries(Object.entries(i).filter(([, v]) => v !== '' && v !== undefined)),
      ) as ItemReceita[],
      ...(orientacoes.value.trim() ? { orientacoes: orientacoes.value.trim() } : {}),
    });
    mensagem.value = t('pep.doc.receitas.emitida');
    itens.value = [vazio()];
    orientacoes.value = '';
    await cliente.invalidateQueries({ queryKey: ['pep', 'doc'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="aba" aria-labelledby="receitas-titulo" data-testid="aba-receitas-conteudo">
    <h2 id="receitas-titulo">{{ t('pep.doc.receitas.titulo') }}</h2>
    <MensagemErro v-if="dados.isError.value" :erro="dados.error.value" />
    <p v-else-if="!dados.data.value" role="status">{{ t('pep.doc.carregando') }}</p>
    <template v-else>
      <ListaDocumentos
        :paciente="paciente"
        familia="receita"
        :dados="dados.data.value"
        @atualizar="cliente.invalidateQueries({ queryKey: ['pep', 'doc'] })"
      />
      <AvisoConsulta :acao="dados.data.value.emitir" />
      <form
        v-if="dados.data.value.emitir.pode"
        class="form"
        data-testid="form-receita"
        @submit.prevent="emitir"
      >
        <h3>{{ t('pep.doc.receitas.nova') }}</h3>
        <SeletorAtendimento v-model="atendimento" :atendimentos="dados.data.value.atendimentos" />
        <SanteSelecao
          v-model="tipo"
          class="campo"
          data-testid="receita-tipo"
          :rotulo="t('pep.doc.receitas.tipo')"
          :opcoes="opcoesTipo"
        />
        <SanteAlerta v-if="tipo !== 'simples'" variante="info" :texto="t('pep.doc.receitas.assinarMao')" />
        <fieldset v-for="(it, i) in itens" :key="i" class="cartao">
          <legend>{{ t('pep.doc.receitas.item', { n: i + 1 }) }}</legend>
          <div class="linha">
            <label
              ><span>{{ t('pep.doc.receitas.medicamento') }}</span
              ><input
                v-model="it.medicamento"
                maxlength="80"
                required
                :data-testid="`receita-medicamento-${i}`"
            /></label>
            <label
              ><span>{{ t('pep.doc.receitas.concentracao') }}</span
              ><input v-model="it.concentracao" maxlength="60"
            /></label>
            <label
              ><span>{{ t('pep.doc.receitas.forma') }}</span
              ><input v-model="it.forma" maxlength="25"
            /></label>
            <label
              ><span>{{ t('pep.doc.receitas.via') }}</span
              ><input v-model="it.via" maxlength="20"
            /></label>
          </div>
          <div class="linha">
            <label
              ><span>{{ t('pep.doc.receitas.posologia') }}</span
              ><input v-model="it.posologia" maxlength="70" required :data-testid="`receita-posologia-${i}`"
            /></label>
            <label
              ><span>{{ t('pep.doc.receitas.quantidade') }}</span
              ><input
                v-model="it.quantidade"
                maxlength="20"
                required
                :data-testid="`receita-quantidade-${i}`"
            /></label>
            <label
              ><span>{{ t('pep.doc.receitas.duracao') }}</span
              ><input v-model="it.duracao" maxlength="25"
            /></label>
            <label class="marca"
              ><input v-model="it.usoContinuo" type="checkbox" />{{
                t('pep.doc.receitas.usoContinuo')
              }}</label
            >
            <SanteBotao
              v-if="itens.length > 1"
              variante="texto"
              :rotulo="t('pep.doc.receitas.tirarItem', { n: i + 1 })"
              @acionar="itens.splice(i, 1)"
            />
          </div>
        </fieldset>
        <SanteBotao
          variante="secundario"
          :rotulo="t('pep.doc.receitas.incluirItem')"
          :desabilitado="itens.length >= 20"
          @acionar="itens.push(vazio())"
        />
        <label
          ><span>{{ t('pep.doc.receitas.orientacoes') }}</span
          ><textarea v-model="orientacoes" rows="3" maxlength="2000" />
        </label>
        <SanteAlerta v-if="foraCp1252" variante="aviso" :texto="t('pep.reg.editor.foraCp1252', { c: '?' })" />
        <SanteBotao
          tipo="submit"
          :rotulo="t('pep.doc.receitas.emitir')"
          :desabilitado="foraCp1252"
          data-testid="emitir-receita"
        />
      </form>
      <p v-if="mensagem" role="status">{{ mensagem }}</p>
      <MensagemErro v-if="erro" :erro="erro" />
    </template>
  </section>
</template>

<style scoped src="./abas.css"></style>
