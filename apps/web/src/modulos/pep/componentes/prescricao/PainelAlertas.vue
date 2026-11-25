<script setup lang="ts">
// Painel de alertas e justificativa (M24; ficha, seção 7, "componente do editor"): cada alerta com o nível (aviso,
// exige justificativa, bloqueio), a regra e a versão que dispararam; o alerta que exige justificativa pede o texto
// para manter o item; o de bloqueio só sai retirando o item. A decisão vai com o item e fica registrada na gravação.
import type { AlertaPrescricao } from '@sgh/contratos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { reactive } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  alertas: readonly AlertaPrescricao[];
  /** Rótulo do item pela chave (o nome que o prescritor vê). */
  rotulos: Readonly<Record<string, string>>;
  baseInteracoes: 'contratada' | 'nao-contratada';
  impede: boolean;
  /** O paciente (o link para a prescrição a que o alerta se refere, ex.: a dieta ativa de outro profissional). */
  paciente?: number;
}>();
const emit = defineEmits<{
  manter: [item: string, alerta: string, justificativa: string];
  retirar: [item: string];
}>();
const { t } = useI18n();
const textos = reactive<Record<string, string>>({});
const erros = reactive<Record<string, boolean>>({});

function manter(a: AlertaPrescricao): void {
  const j = (textos[a.id + a.item] ?? '').trim();
  if (j.length < 10) {
    erros[a.id + a.item] = true;
    return;
  }
  erros[a.id + a.item] = false;
  emit('manter', a.item, a.id, j);
}
const rotulo = (a: AlertaPrescricao) => (a.item === '*' ? '' : (props.rotulos[a.item] ?? a.item));
</script>

<template>
  <section class="painel" :aria-label="t('pep.presc.alertas.titulo')" data-testid="painel-alertas">
    <h3>{{ t('pep.presc.alertas.titulo') }}</h3>
    <SanteAlerta
      v-if="baseInteracoes === 'nao-contratada'"
      variante="info"
      :texto="t('pep.presc.alertas.base')"
      data-testid="aviso-base-interacoes"
    />
    <p v-if="alertas.length === 0" role="status" data-testid="sem-alertas">
      {{ t('pep.presc.alertas.nenhum') }}
    </p>
    <ul v-else class="lista">
      <li
        v-for="a in alertas"
        :key="a.id + a.item"
        :class="['alerta', a.nivel]"
        :data-testid="`alerta-${a.tipo}`"
      >
        <p class="cabeca">
          <strong>{{ t(`pep.presc.alertas.niveis.${a.nivel}`) }}</strong>
          <span>{{ a.titulo }}</span>
          <span v-if="rotulo(a)" class="item">· {{ rotulo(a) }}</span>
        </p>
        <p>{{ a.detalhe }}</p>
        <p v-if="a.referencia && paciente">
          <RouterLink
            :to="`/pep/paciente/${paciente}/prescricao/${a.referencia.prescricao}`"
            target="_blank"
            rel="noopener"
            data-testid="alerta-referencia"
            >{{ t('pep.presc.alertas.abrirReferencia', { id: a.referencia.prescricao }) }}</RouterLink
          >
        </p>
        <p class="regra">{{ t('pep.presc.alertas.regra', { regra: a.regra, versao: a.versaoRegra }) }}</p>
        <p v-if="a.decisao?.decisao === 'mantido'" class="decidido" data-testid="alerta-mantido">
          {{ t('pep.presc.alertas.mantido') }}: {{ a.decisao.justificativa }}
        </p>
        <template v-else-if="a.nivel === 'justificar' && a.item !== '*'">
          <div class="campo">
            <label :for="`just-${a.id}-${a.item}`">{{ t('pep.presc.alertas.justificativa') }}</label>
            <textarea
              :id="`just-${a.id}-${a.item}`"
              v-model="textos[a.id + a.item]"
              rows="2"
              maxlength="500"
              :aria-invalid="erros[a.id + a.item] ? 'true' : undefined"
              data-testid="justificativa-alerta"
            />
            <span v-if="erros[a.id + a.item]" class="erro">{{
              t('pep.presc.alertas.justificativaCurta')
            }}</span>
          </div>
          <div class="acoes">
            <SanteBotao
              :rotulo="t('pep.presc.alertas.manter')"
              variante="secundario"
              data-testid="manter-alerta"
              @acionar="manter(a)"
            />
            <SanteBotao
              :rotulo="t('pep.presc.alertas.retirar')"
              variante="texto"
              @acionar="emit('retirar', a.item)"
            />
          </div>
        </template>
        <div v-else-if="a.nivel === 'bloqueio' && a.item !== '*'" class="acoes">
          <SanteBotao
            :rotulo="t('pep.presc.alertas.retirar')"
            variante="secundario"
            data-testid="retirar-item-alerta"
            @acionar="emit('retirar', a.item)"
          />
        </div>
      </li>
    </ul>
    <SanteAlerta
      v-if="impede"
      variante="alerta"
      :texto="t('pep.presc.alertas.impede')"
      data-testid="alerta-impede"
    />
  </section>
</template>

<style scoped>
.painel {
  display: grid;
  gap: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda-forte);
  padding: var(--sgh-espaco-2);
}
.lista {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: var(--sgh-espaco-2);
}
.alerta {
  border-left: 4px solid var(--sgh-borda-forte);
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
}
.alerta.bloqueio {
  border-left-color: var(--sgh-alerta);
}
.alerta.justificar {
  border-left-color: var(--sgh-alerta);
}
.alerta.aviso {
  border-left-color: var(--sgh-aviso);
}
.cabeca {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
}
.regra,
.item {
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
textarea {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
  max-width: 48rem;
}
.acoes {
  display: flex;
  gap: var(--sgh-espaco-2);
  flex-wrap: wrap;
}
.erro {
  color: var(--sgh-alerta);
}
p {
  margin: 0;
}
</style>
