<script setup lang="ts">
// Receituário (regras 6 e 7): simples, controle especial e antimicrobiano, com os campos de cada medicamento; o
// texto é conferido no CP1252 antes de enviar; controle especial e antimicrobiano saem para imprimir e assinar à mão.
// C2-021: o medicamento vem do catálogo por lista sugerida, e o receituário é conferido na hora pela classe do produto
// (Portaria 344/98: controlado só no controle especial; RDC 471/2021: antimicrobiano nunca na simples).
import { problemasCp1252, TIPOS_RECEITA, type ItemReceita, type TipoReceita } from '@sgh/contratos';
import { conferirItensDoTipo, type ClasseDoMedicamento, type ProblemaReceita } from '@sgh/dominio-pep';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { emitirReceita, lerReceitas } from '../../api-documentos.js';
import { buscarProdutos } from '../../api-prescricao.js';
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
/** Sugestões do catálogo por item e a classe do produto escolhido (controlado, antimicrobiano). */
type Sugestao = { nome: string; controlado: boolean; antimicrobiano: boolean };
const sugestoes = ref<Sugestao[][]>([[]]);
const classes = ref<({ controlado: boolean; antimicrobiano: boolean } | null)[]>([null]);
let espera: ReturnType<typeof setTimeout> | null = null;
function digitarMedicamento(i: number): void {
  const termo = (itens.value[i]?.medicamento ?? '').trim();
  const achado = sugestoes.value[i]?.find((x) => x.nome === termo);
  classes.value[i] = achado ? { controlado: achado.controlado, antimicrobiano: achado.antimicrobiano } : null;
  if (achado || termo.length < 3) return;
  if (espera) clearTimeout(espera);
  espera = setTimeout(() => {
    buscarProdutos(termo)
      .then((r) => {
        sugestoes.value[i] = r.map((x) => ({
          nome: x.nome,
          controlado: x.controlado,
          antimicrobiano: x.antimicrobiano,
        }));
        const exato = sugestoes.value[i]?.find((x) => x.nome === (itens.value[i]?.medicamento ?? '').trim());
        if (exato) classes.value[i] = { controlado: exato.controlado, antimicrobiano: exato.antimicrobiano };
      })
      .catch(() => {
        sugestoes.value[i] = [];
      });
  }, 250);
}
function incluirItem(): void {
  itens.value.push(vazio());
  sugestoes.value.push([]);
  classes.value.push(null);
}
function tirarItem(i: number): void {
  itens.value.splice(i, 1);
  sugestoes.value.splice(i, 1);
  classes.value.splice(i, 1);
}
const classesDosItens = computed<ClasseDoMedicamento[]>(() =>
  classes.value.flatMap((c, i) => (c ? [{ sequencia: i + 1, ...c }] : [])),
);
/** Conferência na hora do receituário pelo tipo e pela classe do medicamento escolhido (regra do domínio). */
const problemas = computed<ProblemaReceita[]>(() =>
  conferirItensDoTipo(
    tipo.value,
    itens.value.filter((x) => x.medicamento.trim() !== ''),
    classesDosItens.value,
  ),
);
const problemasDoItem = (i: number): ProblemaReceita[] =>
  problemas.value.filter((p) => p.campo.startsWith(`itens.${i}.`));
/** O receituário que o medicamento escolhido pede, quando o tipo atual não serve. */
const tipoSugerido = computed<TipoReceita | null>(() => {
  if (classes.value.some((c) => c?.controlado))
    return tipo.value === 'controle-especial' ? null : 'controle-especial';
  if (classes.value.some((c) => c?.antimicrobiano) && tipo.value === 'simples') return 'antimicrobiano';
  return null;
});
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
    sugestoes.value = [[]];
    classes.value = [null];
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
        <div v-if="tipoSugerido" class="linha" data-testid="receita-tipo-sugerido">
          <SanteAlerta
            variante="aviso"
            :texto="t('pep.doc.receitas.tipoPedido', { tipo: t(`pep.doc.receitas.tipos.${tipoSugerido}`) })"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('pep.doc.receitas.usarTipo')"
            data-testid="receita-usar-tipo"
            @acionar="tipo = tipoSugerido ?? tipo"
          />
        </div>
        <fieldset v-for="(it, i) in itens" :key="i" class="cartao">
          <legend>{{ t('pep.doc.receitas.item', { n: i + 1 }) }}</legend>
          <div class="linha">
            <label
              ><span>{{ t('pep.doc.receitas.medicamento') }}</span
              ><input
                v-model="it.medicamento"
                maxlength="80"
                required
                autocomplete="off"
                :list="`receita-sugestoes-${i}`"
                :placeholder="t('pep.doc.receitas.buscarCatalogo')"
                :data-testid="`receita-medicamento-${i}`"
                @input="digitarMedicamento(i)"
              />
              <datalist :id="`receita-sugestoes-${i}`">
                <option v-for="s in sugestoes[i] ?? []" :key="s.nome" :value="s.nome" />
              </datalist>
              <small v-if="classes[i]?.controlado">{{ t('pep.doc.receitas.controlado') }}</small>
              <small v-else-if="classes[i]?.antimicrobiano">{{
                t('pep.doc.receitas.antimicrobiano')
              }}</small></label
            >
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
              @acionar="tirarItem(i)"
            />
          </div>
          <div v-if="problemasDoItem(i).length > 0" class="linha" :data-testid="`receita-problema-${i}`">
            <SanteAlerta v-for="p in problemasDoItem(i)" :key="p.campo" variante="aviso" :texto="p.motivo" />
          </div>
        </fieldset>
        <SanteBotao
          variante="secundario"
          :rotulo="t('pep.doc.receitas.incluirItem')"
          :desabilitado="itens.length >= 20"
          @acionar="incluirItem"
        />
        <label
          ><span>{{ t('pep.doc.receitas.orientacoes') }}</span
          ><textarea v-model="orientacoes" rows="3" maxlength="2000" />
        </label>
        <SanteAlerta v-if="foraCp1252" variante="aviso" :texto="t('pep.reg.editor.foraCp1252', { c: '?' })" />
        <SanteBotao
          tipo="submit"
          :rotulo="t('pep.doc.receitas.emitir')"
          :desabilitado="foraCp1252 || problemas.length > 0"
          data-testid="emitir-receita"
        />
      </form>
      <p v-if="mensagem" role="status">{{ mensagem }}</p>
      <MensagemErro v-if="erro" :erro="erro" />
    </template>
  </section>
</template>

<style scoped src="./abas.css"></style>
