<script setup lang="ts">
// Limites do pedido de exame (F8, 05-SADT linha 6): `/sadt/limites`. Três quadros na mesma tela, cada um com o
// formulário curto e a lista: cota por período (exame ou setor, por fonte pagadora; mostra o uso do período), intervalo
// entre pedidos (a repetição proibida no mesmo dia é um clique) e bloqueio pelo último resultado do paciente. A regra
// confere o cadastro na hora; desativar nunca apaga (a liberação já registrada no item segue ligada à regra).
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type AcaoLimite,
  desativarLimite,
  incluirBloqueioResultado,
  incluirCota,
  incluirIntervalo,
  lerOpcoesCatalogo,
  listarLimites,
} from '../api-limites.js';
import { novaChave } from '../api-sadt.js';
import ErroSadt from '../componentes/ErroSadt.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const lista = useQuery({ queryKey: ['sadt', 'limites'], queryFn: listarLimites });
const opcoes = useQuery({ queryKey: ['sadt', 'catalogo', 'opcoes'], queryFn: lerOpcoesCatalogo });
const hoje = new Date().toISOString().slice(0, 10);

const de = (xs: readonly { id: number; nome: string }[] | undefined, vazio: string) => [
  { valor: '', rotulo: vazio },
  ...(xs ?? []).map((x) => ({ valor: String(x.id), rotulo: x.nome })),
];
const exames = computed(() => de(opcoes.data.value?.exames, t('sadt.limites.escolha')));
const examesOuVazio = computed(() => de(opcoes.data.value?.exames, t('sadt.limites.todos')));
const setores = computed(() => de(opcoes.data.value?.setores, t('sadt.limites.todos')));
const analitos = computed(() => de(opcoes.data.value?.analitos, t('sadt.limites.escolha')));
const fontes = computed(() => de(lista.data.value?.fontes, t('sadt.limites.todas')));
const nomeExame = (id: number | null) =>
  id === null ? '' : (opcoes.data.value?.exames.find((e) => e.id === id)?.nome ?? `#${id}`);
const nomeFonte = (id: number | null) =>
  id === null
    ? t('sadt.limites.todas')
    : (lista.data.value?.fontes.find((f) => f.id === id)?.nome ?? `#${id}`);
const acoes = computed(() =>
  (['bloquear', 'exigir_justificativa', 'alertar'] as const).map((a) => ({
    valor: a,
    rotulo: t(`sadt.limites.acoes.${a}`),
  })),
);
const periodos = computed(() =>
  (['dia', 'semana', 'mes', 'competencia'] as const).map((p) => ({
    valor: p,
    rotulo: t(`sadt.limites.periodos.${p}`),
  })),
);
const operadores = computed(() =>
  (['igual', 'diferente', 'maior', 'maior_igual', 'menor', 'menor_igual', 'entre', 'contem'] as const).map(
    (o) => ({
      valor: o,
      rotulo: t(`sadt.limites.operadores.${o}`),
    }),
  ),
);
const idOuNulo = (v: string) => (v ? Number(v) : null);
const numOuNulo = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));

// Cota
const cota = ref({
  exame: '',
  setor: '',
  fonte: '',
  periodo: 'mes',
  quantidade: '',
  percentual: '',
  so: false,
  inicio: hoje,
  fim: '',
});
const cotaValida = computed(
  () =>
    (!!cota.value.exame || !!cota.value.setor) &&
    (cota.value.quantidade.trim() !== '' || (cota.value.percentual.trim() !== '' && !!cota.value.fonte)),
);
// Intervalo
const intervalo = ref({
  exame: '',
  conflitante: '',
  fonte: '',
  mesmoDia: true,
  horas: '',
  acao: 'bloquear' as AcaoLimite,
  mensagem: '',
  inicio: hoje,
});
const intervaloValido = computed(
  () => !!intervalo.value.exame && (intervalo.value.mesmoDia || Number(intervalo.value.horas) > 0),
);
// Último resultado
const resultado = ref({
  exame: '',
  avaliado: '',
  analito: '',
  operador: 'igual',
  valor: '',
  janela: '30',
  acao: 'bloquear' as AcaoLimite,
  mensagem: '',
});
const resultadoValido = computed(
  () =>
    !!resultado.value.exame &&
    !!resultado.value.analito &&
    resultado.value.valor.trim() !== '' &&
    Number(resultado.value.janela) >= 1 &&
    (resultado.value.operador !== 'entre' || /^-?[\d.,]+;-?[\d.,]+$/.test(resultado.value.valor.trim())),
);

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function executar(fn: () => Promise<unknown>, ok: string): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    await fn();
    mensagem.value = ok;
    await cliente.invalidateQueries({ queryKey: ['sadt', 'limites'] });
  } catch (x) {
    erro.value = x;
  }
}
const gravarCota = () =>
  executar(
    () =>
      incluirCota(
        {
          exame: idOuNulo(cota.value.exame),
          setor: idOuNulo(cota.value.setor),
          fontePagadora: idOuNulo(cota.value.fonte),
          periodo: cota.value.periodo,
          quantidadeMaxima: numOuNulo(cota.value.quantidade),
          percentualLimite: numOuNulo(cota.value.percentual),
          permiteExceder: cota.value.so,
          vigenciaInicio: cota.value.inicio,
          vigenciaFim: cota.value.fim || null,
        },
        novaChave('limite.cota'),
      ),
    t('sadt.limites.gravado'),
  );
const gravarIntervalo = () =>
  executar(
    () =>
      incluirIntervalo(
        {
          exame: Number(intervalo.value.exame),
          conflitante: idOuNulo(intervalo.value.conflitante),
          fontePagadora: idOuNulo(intervalo.value.fonte),
          mesmoDia: intervalo.value.mesmoDia,
          intervaloMinimoHoras: Number(intervalo.value.horas || 0),
          acao: intervalo.value.acao,
          mensagem: intervalo.value.mensagem.trim() || null,
          vigenciaInicio: intervalo.value.inicio,
        },
        novaChave('limite.intervalo'),
      ),
    t('sadt.limites.gravado'),
  );
const gravarResultado = () =>
  executar(
    () =>
      incluirBloqueioResultado(
        {
          exame: Number(resultado.value.exame),
          exameAvaliado: idOuNulo(resultado.value.avaliado),
          analito: Number(resultado.value.analito),
          operador: resultado.value.operador,
          valor: resultado.value.valor.trim(),
          janelaDias: Number(resultado.value.janela),
          acao: resultado.value.acao,
          mensagem: resultado.value.mensagem.trim() || null,
        },
        novaChave('limite.resultado'),
      ),
    t('sadt.limites.gravado'),
  );
const desativar = (tipo: 'cota' | 'intervalo' | 'resultado', id: number) =>
  executar(() => desativarLimite(tipo, id, novaChave('limite.desativar')), t('sadt.limites.desativado'));
</script>

<template>
  <section class="limites" data-testid="limites-exame">
    <h1>{{ t('sadt.limites.titulo') }}</h1>
    <p>{{ t('sadt.limites.explicacao') }}</p>
    <p v-if="mensagem" role="status" data-testid="limites-mensagem">{{ mensagem }}</p>
    <ErroSadt v-if="erro" :erro="erro" />
    <ErroSadt v-if="lista.isError.value" :erro="lista.error.value" />

    <fieldset data-testid="limites-cotas">
      <legend>{{ t('sadt.limites.cotas') }}</legend>
      <div class="linha">
        <SanteSelecao
          v-model="cota.exame"
          :rotulo="t('sadt.limites.exame')"
          :opcoes="examesOuVazio"
          data-testid="cota-exame"
        />
        <SanteSelecao v-model="cota.setor" :rotulo="t('sadt.limites.setor')" :opcoes="setores" />
        <SanteSelecao
          v-model="cota.fonte"
          :rotulo="t('sadt.limites.fonte')"
          :opcoes="fontes"
          data-testid="cota-fonte"
        />
        <SanteSelecao v-model="cota.periodo" :rotulo="t('sadt.limites.periodo')" :opcoes="periodos" />
        <label
          >{{ t('sadt.limites.quantidade')
          }}<input v-model="cota.quantidade" inputmode="numeric" data-testid="cota-quantidade"
        /></label>
        <label
          >{{ t('sadt.limites.percentual') }}<input v-model="cota.percentual" inputmode="decimal"
        /></label>
        <label><input v-model="cota.so" type="checkbox" /> {{ t('sadt.limites.permiteExceder') }}</label>
        <label>{{ t('sadt.limites.inicio') }}<input v-model="cota.inicio" type="date" /></label>
        <label>{{ t('sadt.limites.fim') }}<input v-model="cota.fim" type="date" /></label>
        <SanteBotao
          :rotulo="t('sadt.limites.incluir')"
          :desabilitado="!cotaValida"
          data-testid="cota-incluir"
          @acionar="gravarCota"
        />
      </div>
      <p v-if="(lista.data.value?.cotas ?? []).length === 0">{{ t('sadt.limites.nenhum') }}</p>
      <ul>
        <li v-for="c in lista.data.value?.cotas ?? []" :key="c.id" :class="{ inativa: !c.ativo }">
          {{ c.exameNome ?? nomeExame(c.exame) }} · {{ nomeFonte(c.fontePagadora) }} ·
          {{ t(`sadt.limites.periodos.${c.periodo}`) }}
          <template v-if="c.quantidadeMaxima !== null">
            · {{ t('sadt.limites.uso', { usados: c.usoNoPeriodo, limite: c.quantidadeMaxima }) }}
          </template>
          <template v-if="c.percentualLimite !== null"> · {{ c.percentualLimite }}%</template>
          <span v-if="!c.ativo"> · {{ t('sadt.limites.inativa') }}</span>
          <SanteBotao v-else :rotulo="t('sadt.limites.desativar')" @acionar="desativar('cota', c.id)" />
        </li>
      </ul>
    </fieldset>

    <fieldset data-testid="limites-intervalos">
      <legend>{{ t('sadt.limites.intervalos') }}</legend>
      <div class="linha">
        <SanteSelecao
          v-model="intervalo.exame"
          :rotulo="t('sadt.limites.exame')"
          :opcoes="exames"
          data-testid="intervalo-exame"
        />
        <SanteSelecao
          v-model="intervalo.conflitante"
          :rotulo="t('sadt.limites.conflitante')"
          :opcoes="examesOuVazio"
        />
        <SanteSelecao v-model="intervalo.fonte" :rotulo="t('sadt.limites.fonte')" :opcoes="fontes" />
        <label
          ><input v-model="intervalo.mesmoDia" type="checkbox" data-testid="intervalo-mesmo-dia" />
          {{ t('sadt.limites.mesmoDia') }}</label
        >
        <label>{{ t('sadt.limites.horas') }}<input v-model="intervalo.horas" inputmode="numeric" /></label>
        <SanteSelecao v-model="intervalo.acao" :rotulo="t('sadt.limites.acao')" :opcoes="acoes" />
        <label>{{ t('sadt.limites.mensagem') }}<input v-model="intervalo.mensagem" maxlength="500" /></label>
        <SanteBotao
          :rotulo="t('sadt.limites.incluir')"
          :desabilitado="!intervaloValido"
          data-testid="intervalo-incluir"
          @acionar="gravarIntervalo"
        />
      </div>
      <ul>
        <li v-for="r in lista.data.value?.intervalos ?? []" :key="r.id" :class="{ inativa: !r.ativo }">
          {{ nomeExame(r.exame) }}
          <template v-if="r.conflitante !== r.exame">{{
            t('sadt.limites.incompativelCom', { exame: nomeExame(r.conflitante) })
          }}</template>
          <template v-else> · {{ t('sadt.limites.repeticao') }}</template>
          ·
          {{
            r.mesmoDia
              ? t('sadt.limites.mesmoDia')
              : t('sadt.limites.horasCurto', { n: r.intervaloMinimoHoras })
          }}
          ·
          {{ t(`sadt.limites.acoes.${r.acao}`) }}
          <span v-if="!r.ativo"> · {{ t('sadt.limites.inativa') }}</span>
          <SanteBotao v-else :rotulo="t('sadt.limites.desativar')" @acionar="desativar('intervalo', r.id)" />
        </li>
      </ul>
    </fieldset>

    <fieldset data-testid="limites-resultados">
      <legend>{{ t('sadt.limites.resultados') }}</legend>
      <div class="linha">
        <SanteSelecao v-model="resultado.exame" :rotulo="t('sadt.limites.exame')" :opcoes="exames" />
        <SanteSelecao
          v-model="resultado.avaliado"
          :rotulo="t('sadt.limites.exameAvaliado')"
          :opcoes="examesOuVazio"
        />
        <SanteSelecao v-model="resultado.analito" :rotulo="t('sadt.limites.analito')" :opcoes="analitos" />
        <SanteSelecao
          v-model="resultado.operador"
          :rotulo="t('sadt.limites.operador')"
          :opcoes="operadores"
        />
        <label>{{ t('sadt.limites.valor') }}<input v-model="resultado.valor" maxlength="300" /></label>
        <label>{{ t('sadt.limites.janela') }}<input v-model="resultado.janela" inputmode="numeric" /></label>
        <SanteSelecao v-model="resultado.acao" :rotulo="t('sadt.limites.acao')" :opcoes="acoes" />
        <label>{{ t('sadt.limites.mensagem') }}<input v-model="resultado.mensagem" maxlength="500" /></label>
        <SanteBotao
          :rotulo="t('sadt.limites.incluir')"
          :desabilitado="!resultadoValido"
          @acionar="gravarResultado"
        />
      </div>
      <ul>
        <li v-for="b in lista.data.value?.bloqueios ?? []" :key="b.id" :class="{ inativa: !b.ativo }">
          {{ nomeExame(b.exame) }} · {{ t(`sadt.limites.operadores.${b.operador}`) }} {{ b.valor }} ·
          {{ t('sadt.limites.diasCurto', { n: b.janelaDias }) }} ·
          {{ t(`sadt.limites.acoes.${b.acao}`) }}
          <span v-if="!b.ativo"> · {{ t('sadt.limites.inativa') }}</span>
          <SanteBotao v-else :rotulo="t('sadt.limites.desativar')" @acionar="desativar('resultado', b.id)" />
        </li>
      </ul>
    </fieldset>
  </section>
</template>

<style scoped>
.limites {
  display: grid;
  gap: 0.75rem;
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
}
label {
  display: grid;
  gap: 0.25rem;
}
.inativa {
  opacity: 0.6;
}
</style>
