<script setup lang="ts">
// Texto formatado do registro (M15, regra 4): parágrafos e trechos montados pelo servidor (negrito, itálico,
// sublinhado, alinhamento, recuo). Nada de HTML cru: cada trecho é texto. A cor do original vira só destaque
// (o contraste da cor de origem não é garantido nos dois temas).
import type { TextoFormatado } from '@sgh/contratos';

defineProps<{ texto: TextoFormatado }>();
</script>

<template>
  <div class="texto-formatado" data-testid="texto-formatado">
    <p
      v-for="(p, i) in texto.paragrafos"
      :key="i"
      :class="`alinhar-${p.alinhamento}`"
      :style="p.recuo > 0 ? { paddingInlineStart: `${p.recuo * 1.25}rem` } : undefined"
    >
      <span
        v-for="(x, j) in p.trechos"
        :key="j"
        :class="{ negrito: x.negrito, italico: x.italico, sublinhado: x.sublinhado, destaque: x.cor > 0 }"
        >{{ x.texto }}</span
      >
    </p>
  </div>
</template>

<style scoped>
.texto-formatado p {
  margin: 0 0 var(--sgh-espaco-1);
  white-space: pre-wrap;
}
.alinhar-centro {
  text-align: center;
}
.alinhar-direita {
  text-align: right;
}
.alinhar-justificado {
  text-align: justify;
}
.negrito {
  font-weight: 700;
}
.italico {
  font-style: italic;
}
.sublinhado {
  text-decoration: underline;
}
.destaque {
  font-weight: 600;
}
</style>
