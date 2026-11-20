<script setup lang="ts">
// Receita de alta (M24, regra 15): os medicamentos ativos da prescrição viram as receitas do receituário do
// prontuário, no receituário certo de cada um (simples, antimicrobiano, controle especial por lista). A pessoa
// informa a quantidade (e a duração) de cada medicamento e emite cada receita pelo receituário, que grava, imprime
// e vai à trilha como qualquer receita. A notificação das listas A e B (talão) é avisada: preenchida e assinada à
// mão até a receita digital (DP-23). Nunca offline.
import type { ReceitaAlta, TipoReceita } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { emitirReceita } from '../../api-documentos.js';
import { lerReceitaAlta } from '../../api-prescricao.js';
import { useConexao } from '../../conexao.js';

const props = defineProps<{ paciente: number; prescricao: number }>();
const { t } = useI18n();
const online = useConexao();
const proposta = ref<ReceitaAlta | null>(null);
const quantidades = ref<Record<string, string>>({});
const duracoes = ref<Record<string, string>>({});
const emitidas = ref<Record<string, number>>({});
const erro = ref<unknown>(null);
const ocupado = ref(false);
const k = (receita: string, item: number) => `${receita}:${item}`;

async function montar(): Promise<void> {
  erro.value = null;
  try {
    const r = await lerReceitaAlta(props.paciente, props.prescricao);
    // Os campos começam vazios (texto, nunca indefinido): a quantidade é da pessoa que prescreve.
    for (const x of r.receitas)
      for (const i of x.itens) {
        quantidades.value[k(x.chave, i.item)] = '';
        duracoes.value[k(x.chave, i.item)] = '';
      }
    proposta.value = r;
  } catch (e) {
    erro.value = e;
  }
}

function pronta(chave: string): boolean {
  const r = proposta.value?.receitas.find((x) => x.chave === chave);
  return !!r && r.itens.every((i) => (quantidades.value[k(chave, i.item)] ?? '').trim().length > 0);
}

async function emitir(chave: string): Promise<void> {
  const p = proposta.value;
  const r = p?.receitas.find((x) => x.chave === chave);
  if (!p || !r) return;
  erro.value = null;
  ocupado.value = true;
  try {
    const g = await emitirReceita(props.paciente, {
      atendimento: p.atendimento,
      tipo: r.tipo as TipoReceita,
      itens: r.itens.map((i) => {
        const duracao = (duracoes.value[k(chave, i.item)] ?? '').trim();
        return {
          medicamento: i.medicamento,
          ...(i.via ? { via: i.via.slice(0, 20) } : {}),
          posologia: i.posologia,
          quantidade: (quantidades.value[k(chave, i.item)] ?? '').trim(),
          ...(duracao ? { duracao } : {}),
          usoContinuo: false,
        };
      }),
    });
    emitidas.value = { ...emitidas.value, [chave]: g.documento };
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="receita-alta nao-imprimir" aria-labelledby="receita-alta-titulo" data-testid="receita-alta">
    <h2 id="receita-alta-titulo">{{ t('pep.presc.alta.titulo') }}</h2>
    <p>{{ t('pep.presc.alta.texto') }}</p>
    <SanteBotao
      v-if="!proposta"
      :rotulo="t('pep.presc.alta.montar')"
      variante="secundario"
      :desabilitado="!online"
      data-testid="montar-receita-alta"
      @acionar="montar"
    />
    <MensagemErro v-if="erro" :erro="erro" />
    <template v-if="proposta">
      <p v-if="proposta.receitas.length === 0" role="status">{{ t('pep.presc.alta.nenhum') }}</p>
      <article
        v-for="r in proposta.receitas"
        :key="r.chave"
        class="receita"
        :data-testid="`receita-alta-${r.chave}`"
      >
        <h3>{{ r.receituario }}</h3>
        <SanteAlerta v-if="r.aviso" variante="aviso" :texto="r.aviso" />
        <ul class="itens">
          <li v-for="i in r.itens" :key="i.item">
            <p>
              <strong>{{ i.medicamento }}</strong> · {{ i.posologia }}
            </p>
            <div class="campos">
              <SanteCampoTexto
                v-model="quantidades[k(r.chave, i.item)]!"
                :rotulo="t('pep.presc.alta.quantidade', { nome: i.medicamento })"
                :max-bytes="20"
                obrigatorio
                :data-testid="`quantidade-${r.chave}-${i.item}`"
              />
              <SanteCampoTexto
                v-model="duracoes[k(r.chave, i.item)]!"
                :rotulo="t('pep.presc.alta.duracao', { nome: i.medicamento })"
                :max-bytes="25"
              />
            </div>
          </li>
        </ul>
        <SanteAlerta
          v-if="emitidas[r.chave]"
          variante="info"
          :texto="t('pep.presc.alta.emitida', { id: emitidas[r.chave] })"
          anunciar
          :data-testid="`receita-emitida-${r.chave}`"
        />
        <SanteBotao
          v-else
          :rotulo="t('pep.presc.alta.emitir', { receituario: r.receituario })"
          :desabilitado="!online || ocupado || !pronta(r.chave)"
          :data-testid="`emitir-${r.chave}`"
          @acionar="emitir(r.chave)"
        />
      </article>
      <p>
        <RouterLink :to="`/pep/paciente/${paciente}/receitas`">{{
          t('pep.presc.alta.verReceitas')
        }}</RouterLink>
      </p>
    </template>
  </section>
</template>

<style scoped>
.receita-alta,
.receita,
.itens {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.receita {
  border: 1px solid var(--sgh-borda);
  border-radius: 4px;
  padding: var(--sgh-espaco-2);
}
.itens {
  list-style: none;
  padding: 0;
}
.campos {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
h2,
h3,
p {
  margin: 0;
}
</style>
