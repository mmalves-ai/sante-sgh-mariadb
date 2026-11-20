<script setup lang="ts">
// W0-06: o histórico das correções do SESMT (retificação e anulação do acidente, cancelamento da entrega de EPI): quem,
// quando, o motivo e o que mudou (o valor anterior → o novo). Só os campos que mudaram aparecem; os dados da CAT vêm
// um nível abaixo (cat.cid, cat.lateralidade…).
import type { CorrecaoResposta } from '@sgh/contratos';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../comum.js';

defineProps<{ correcoes: readonly CorrecaoResposta[]; testid: string }>();
const { t, te } = useI18n();

const plano = (o: Readonly<Record<string, unknown>>): Record<string, unknown> => {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object' && !Array.isArray(v))
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) r[`${k}.${k2}`] = v2;
    else r[k] = v;
  }
  return r;
};
const txt = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (v === true) return t('sesmt.sim');
  if (v === false) return t('sesmt.nao');
  const x = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(x)) return dataBr(x);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(x)) return `${dataBr(x.slice(0, 10))} ${x.slice(11, 16)}`;
  return x;
};
const rotuloCampo = (k: string): string => {
  const chave = `sesmt.historico.campos.${k.replace('.', '_')}`;
  return te(chave) ? t(chave) : k;
};
function mudancas(c: CorrecaoResposta): Array<{ campo: string; antes: string; depois: string }> {
  const a = plano(c.antes);
  const d = plano(c.depois);
  return [...new Set([...Object.keys(a), ...Object.keys(d)])]
    .filter((k) => k !== 'versao' && JSON.stringify(a[k] ?? null) !== JSON.stringify(d[k] ?? null))
    .map((k) => ({ campo: rotuloCampo(k), antes: txt(a[k]), depois: txt(d[k]) }));
}
const nomeOperacao = (op: string) => {
  const chave = `sesmt.historico.operacoes.${op.replace('.', '_')}`;
  return te(chave) ? t(chave) : op;
};
</script>

<template>
  <section class="bloco" :aria-label="t('sesmt.historico.titulo')" :data-testid="testid">
    <h3>{{ t('sesmt.historico.titulo') }}</h3>
    <p v-if="correcoes.length === 0" class="secundario">{{ t('sesmt.historico.vazio') }}</p>
    <ul v-else>
      <li v-for="c in correcoes" :key="c.id" :data-testid="`${testid}-${c.id}`">
        {{
          t('sesmt.historico.linha', {
            em: txt(c.em),
            por: c.por,
            operacao: nomeOperacao(c.operacao),
            registro: c.registro,
          })
        }}
        <div class="secundario">{{ c.motivo }}</div>
        <ul class="secundario">
          <li v-for="m in mudancas(c)" :key="m.campo">{{ t('sesmt.historico.mudanca', m) }}</li>
        </ul>
      </li>
    </ul>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
