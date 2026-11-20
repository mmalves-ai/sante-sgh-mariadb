<script setup lang="ts">
// Painel de leitos ao vivo (M16; ficha, seção 7; regras 1, 4, 14 e 16): grade por bloco e acomodação com livre,
// ocupado e inativo; cartão com iniciais, idade, sexo, dias de internação e convênio; terapia intensiva destacada;
// "atualizado há N s". O servidor avisa a mudança pelo canal de eventos e a tela relê. Abrir o cartão mostra o
// nome (só com a permissão do cadastro; a abertura vai à trilha). As diferenças entre o leito e a internação
// aparecem como aviso.
import type { LeitoPainel, PacienteDoLeito } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import AvisoIndisponivel from '../../onda0/componentes/AvisoIndisponivel.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { lerPacienteDoLeito, lerPainelLeitos } from '../api-internacao.js';
import { formatarData, formatarDataHora, segundosDesde } from '../formato.js';
import { usarAvisosDeLeitos } from '../vigia.js';

const { t } = useI18n();
const cliente = useQueryClient();
let primeira = true;
const painel = useQuery({
  queryKey: ['internacao', 'painel'],
  queryFn: () => {
    const abertura = primeira;
    primeira = false;
    return lerPainelLeitos(abertura);
  },
});
const { conectado } = usarAvisosDeLeitos(
  () => void cliente.invalidateQueries({ queryKey: ['internacao', 'painel'] }),
);

// "Atualizado há N s" (relógio da tela).
const agora = ref(Date.now());
let relogio: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  relogio = setInterval(() => (agora.value = Date.now()), 1_000);
});
onBeforeUnmount(() => clearInterval(relogio));
const ha = computed(() => segundosDesde(painel.data.value?.lidoEm, agora.value));

const filtro = ref<'todos' | 'livre' | 'ocupado' | 'inativo'>('todos');
const opcoesFiltro = computed(() => [
  { valor: 'todos' as const, rotulo: t('internacao.painel.todos') },
  { valor: 'livre' as const, rotulo: t('internacao.painel.soLivres') },
  { valor: 'ocupado' as const, rotulo: t('internacao.painel.soOcupados') },
  { valor: 'inativo' as const, rotulo: t('internacao.painel.soInativos') },
]);
const visivel = (l: LeitoPainel) => filtro.value === 'todos' || l.situacao === filtro.value;

const podeNome = computed(() => pode('cadastro.paciente.ler'));
const aberto = ref<{ leito: string; cartao: NonNullable<LeitoPainel['cartao']> } | null>(null);
const paciente = ref<PacienteDoLeito | null>(null);
const erroPaciente = ref<unknown>(null);
async function abrir(l: LeitoPainel): Promise<void> {
  if (!l.cartao) return;
  aberto.value = { leito: l.leito, cartao: l.cartao };
  paciente.value = null;
  erroPaciente.value = null;
  if (!podeNome.value) return;
  try {
    paciente.value = await lerPacienteDoLeito(l.cartao.internacao);
  } catch (e) {
    erroPaciente.value = e;
  }
}
const dialogo = computed({
  get: () => aberto.value !== null,
  set: (v: boolean) => {
    if (!v) aberto.value = null;
  },
});
const sexo = (s: 'M' | 'F' | null) =>
  s === 'F'
    ? t('internacao.painel.sexoF')
    : s === 'M'
      ? t('internacao.painel.sexoM')
      : t('internacao.painel.semSexo');
const pct = (v: number | null) => (v === null ? '—' : `${String(v).replace('.', ',')}%`);
</script>

<template>
  <section class="tela" aria-labelledby="painel-titulo">
    <h1 id="painel-titulo">{{ t('internacao.painel.titulo') }}</h1>
    <p>{{ t('internacao.painel.texto') }}</p>
    <AvisoIndisponivel v-if="painel.isError.value" :erro="painel.error.value" />
    <MensagemErro v-if="painel.isError.value" :erro="painel.error.value" />
    <p v-else-if="painel.isPending.value">{{ t('internacao.comum.carregando') }}</p>
    <template v-else-if="painel.data.value">
      <div class="cabecalho">
        <p role="status" data-testid="painel-atualizado">
          <strong v-if="conectado">{{ t('internacao.comum.aoVivo') }} · </strong>
          {{ t('internacao.comum.atualizadoHa', { n: ha ?? 0 }) }} ·
          {{ t('internacao.comum.dadosAte', { quando: formatarDataHora(painel.data.value.dadosAte) }) }}
          <span v-if="painel.data.value.destino === 'memoria'"> · {{ t('internacao.comum.memoria') }}</span>
        </p>
        <p v-if="!conectado" class="secundario">{{ t('internacao.comum.semCanal') }}</p>
        <p data-testid="painel-totais">
          {{
            t('internacao.painel.totais', {
              ocupados: painel.data.value.totais.ocupados,
              ativos: painel.data.value.totais.ativos,
              ocupacao: pct(painel.data.value.totais.ocupacao),
              livres: painel.data.value.totais.livres,
              inativos: painel.data.value.totais.inativos,
            })
          }}
          ·
          {{
            t('internacao.painel.intensivos', {
              ocupados: painel.data.value.totais.intensivos.ocupados,
              ativos: painel.data.value.totais.intensivos.ativos,
            })
          }}
        </p>
        <div class="filtro">
          <SanteSelecao
            id="painel-filtro"
            v-model="filtro"
            :rotulo="t('internacao.painel.filtro')"
            :opcoes="opcoesFiltro"
            data-testid="painel-filtro"
          />
          <RouterLink to="/internacao/leitos/divergencias">{{
            t('internacao.painel.divergencias')
          }}</RouterLink>
        </div>
      </div>

      <SanteAlerta
        v-if="painel.data.value.avisos.length"
        :texto="t('internacao.painel.avisos', { n: painel.data.value.avisos.length })"
        variante="aviso"
        data-testid="painel-avisos"
      />
      <details v-if="painel.data.value.avisos.length" class="avisos">
        <summary>{{ t('internacao.painel.avisosTexto') }}</summary>
        <ul>
          <li v-for="a in painel.data.value.avisos" :key="`${a.tipo}-${a.chave}`">
            <strong>{{ a.chave }}</strong
            >: {{ a.mensagem }}
          </li>
        </ul>
      </details>

      <section
        v-for="b in painel.data.value.blocos"
        :key="b.bloco"
        class="bloco"
        :aria-labelledby="`bloco-${b.bloco}`"
        :data-testid="`painel-bloco-${b.bloco}`"
      >
        <h2 :id="`bloco-${b.bloco}`">{{ b.nome }} · {{ b.totais.ocupados }}/{{ b.totais.ativos }}</h2>
        <section
          v-for="a in b.acomodacoes"
          :key="a.acomodacao"
          class="acomodacao"
          :class="{ intensiva: a.intensiva }"
          :aria-labelledby="`ac-${b.bloco}-${a.acomodacao}`"
          :data-testid="`painel-acomodacao-${b.bloco}-${a.acomodacao}`"
        >
          <h3 :id="`ac-${b.bloco}-${a.acomodacao}`">
            {{ a.nome }}
            <span v-if="a.intensiva" class="selo">{{ t('internacao.painel.intensiva') }}</span>
            · {{ a.totais.ocupados }}/{{ a.totais.ativos }}
          </h3>
          <ul class="grade">
            <li
              v-for="l in a.leitos.filter(visivel)"
              :key="l.id"
              class="leito"
              :class="[l.situacao, { intensivo: l.cartao?.intensivo }]"
              :data-testid="`leito-${b.bloco}-${a.acomodacao}-${l.leito}`"
            >
              <component
                :is="l.cartao ? 'button' : 'div'"
                class="cartao"
                :type="l.cartao ? 'button' : undefined"
                @click="abrir(l)"
              >
                <span class="numero">{{ t('internacao.painel.leito', { leito: l.leito }) }}</span>
                <span class="situacao">{{ t(`internacao.painel.${l.situacao}`) }}</span>
                <template v-if="l.cartao">
                  <span class="iniciais" data-testid="cartao-iniciais">{{ l.cartao.iniciais }}</span>
                  <span>
                    {{
                      l.cartao.idade === null
                        ? t('internacao.painel.semIdade')
                        : t('internacao.painel.idade', { n: l.cartao.idade })
                    }}
                    · {{ sexo(l.cartao.sexo) }}
                  </span>
                  <span>{{ t('internacao.painel.dias', { n: l.cartao.diasInternacao }) }}</span>
                  <span>{{ l.cartao.convenio ?? t('internacao.painel.semConvenio') }}</span>
                  <span v-if="l.cartao.intensivo" class="selo">{{ l.cartao.tipoTrecho?.nome }}</span>
                </template>
              </component>
            </li>
          </ul>
        </section>
      </section>
    </template>

    <SanteDialogo v-model:visivel="dialogo" :titulo="t('internacao.painel.paciente')">
      <div v-if="aberto" data-testid="dialogo-paciente">
        <p>
          {{ t('internacao.painel.leito', { leito: aberto.leito }) }} · {{ aberto.cartao.iniciais }} ·
          {{ t('internacao.painel.dias', { n: aberto.cartao.diasInternacao }) }}
        </p>
        <MensagemErro v-if="erroPaciente" :erro="erroPaciente" />
        <dl v-else-if="paciente">
          <dt>{{ t('internacao.painel.nome') }}</dt>
          <dd data-testid="paciente-nome">{{ paciente.nome }}</dd>
          <dt>{{ t('internacao.painel.entrada') }}</dt>
          <dd>{{ formatarData(paciente.entrada) }}</dd>
          <dt>{{ t('internacao.painel.convenio') }}</dt>
          <dd>{{ paciente.convenio ?? '—' }}</dd>
          <dt>{{ t('internacao.painel.clinica') }}</dt>
          <dd>{{ paciente.clinica ?? '—' }}</dd>
        </dl>
        <SanteBotao :rotulo="t('internacao.comum.fechar')" variante="secundario" @acionar="aberto = null" />
      </div>
    </SanteDialogo>
  </section>
</template>

<style scoped>
.cabecalho p {
  margin: var(--sgh-espaco-1) 0;
}
.secundario {
  color: var(--sgh-texto-secundario);
}
.filtro {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
  margin: var(--sgh-espaco-2) 0;
}
.avisos {
  margin: var(--sgh-espaco-2) 0;
}
.bloco h2 {
  margin: var(--sgh-espaco-3) 0 var(--sgh-espaco-1);
}
.acomodacao {
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2);
  margin: var(--sgh-espaco-2) 0;
}
.acomodacao.intensiva {
  border-color: var(--sgh-alerta);
  border-width: 2px;
}
.acomodacao h3 {
  margin: 0 0 var(--sgh-espaco-2);
}
.grade {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
  gap: var(--sgh-espaco-2);
}
.cartao {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  min-height: var(--sgh-alvo-minimo);
  text-align: left;
  font: inherit;
  padding: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda-forte);
  border-left-width: 6px;
  border-radius: 4px;
  background: var(--sgh-fundo-elevado);
  color: var(--sgh-texto);
}
button.cartao {
  cursor: pointer;
}
button.cartao:focus-visible {
  outline: 3px solid var(--sgh-foco);
}
.livre .cartao {
  border-left-color: var(--sgh-sucesso);
}
.ocupado .cartao {
  border-left-color: var(--sgh-primaria);
}
.inativo .cartao {
  border-left-style: dashed;
  border-left-color: var(--sgh-texto-secundario);
  background: var(--sgh-fundo-sutil);
}
.intensivo .cartao {
  border-left-color: var(--sgh-alerta);
}
.numero {
  font-weight: 600;
}
.situacao {
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.iniciais {
  font-size: 1.25em;
  font-weight: 700;
  letter-spacing: 0.05em;
}
.selo {
  display: inline-block;
  font-size: var(--sgh-fonte-pequena);
  border: 1px solid var(--sgh-alerta);
  color: var(--sgh-texto);
  padding: 0 var(--sgh-espaco-1);
  border-radius: 4px;
}
dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
}
dt {
  font-weight: 600;
}
dd {
  margin: 0;
}
</style>
