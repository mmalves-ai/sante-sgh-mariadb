<script setup lang="ts">
// Validação farmacêutica dos ciclos (ficha do M45, seção 7; mina, regra 19; DP-32):
// `/pep/especialidades/oncologia/validacao`. Os ciclos prescritos à espera da validação; o farmacêutico confere a base
// (peso, altura, superfície, função renal) e digita a dose que ELE calculou para cada fármaco (dupla checagem
// independente: a tela não preenche); o servidor compara com a tolerância e valida, uma vez, por outra pessoa, só o
// ciclo com a prescrição dos medicamentos ligada (a fila mostra a ligação).
import { SanteAlerta, SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  lerFilaValidacao,
  lerGravacaoEspecialidade,
  novaChaveEspecialidade,
  validarCiclo,
} from '../api-especialidades.js';
import AvisoEspecialidade from '../componentes/AvisoEspecialidade.vue';
import ErroEspecialidade from '../componentes/ErroEspecialidade.vue';
import { dataLonga, instanteCurto, numero } from '../regras-especialidades.js';

const { t } = useI18n();
const gravacao = useQuery({
  queryKey: ['especialidades', 'oncologia', 'gravacao'],
  queryFn: () => lerGravacaoEspecialidade('oncologia'),
  staleTime: 30_000,
});
const pode = computed(() => gravacao.data.value?.operacoes['validar']?.pode ?? false);
const motivoPode = computed(() => gravacao.data.value?.operacoes['validar']?.motivo ?? null);
const aviso = computed(() =>
  gravacao.data.value && !gravacao.data.value.ligada ? gravacao.data.value.motivo : null,
);
const fila = useQuery({ queryKey: ['especialidades', 'oncologia', 'validacao'], queryFn: lerFilaValidacao });
const doses = reactive<Record<number, string[]>>({});
const observacao = reactive<Record<number, string>>({});
const dosesDe = (id: number, n: number) => (doses[id] ??= Array.from({ length: n }, () => ''));
const observacaoDe = (id: number) => (observacao[id] ??= '');

const erro = ref<unknown>(null);
const erroDe = ref<number | null>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function validar(id: number, n: number): Promise<void> {
  erro.value = null;
  erroDe.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await validarCiclo(
      id,
      {
        doses: dosesDe(id, n).map((d) => Number(d.replace(',', '.'))),
        ...(observacao[id]?.trim() ? { observacao: observacao[id]!.trim() } : {}),
      },
      novaChaveEspecialidade('validar'),
    );
    mensagem.value = r.mensagem;
    await fila.refetch();
  } catch (x) {
    erro.value = x;
    erroDe.value = id;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="validacao-titulo" data-testid="tela-validacao-onco">
    <h1 id="validacao-titulo">{{ t('especialidades.oncologia.validacao') }}</h1>
    <p>{{ t('especialidades.oncologia.validacaoTexto') }}</p>
    <p class="acoes">
      <RouterLink to="/pep/especialidades/oncologia">{{ t('especialidades.voltar') }}</RouterLink>
    </p>
    <AvisoEspecialidade :motivo="aviso" />
    <SanteAlerta
      v-if="mensagem"
      variante="info"
      :texto="mensagem"
      anunciar
      data-testid="validacao-mensagem"
    />
    <p v-if="!pode && gravacao.data.value" class="secundario">{{ motivoPode }}</p>
    <ErroEspecialidade v-if="fila.isError.value" :erro="fila.error.value" />
    <p v-else-if="!fila.data.value" role="status">{{ t('especialidades.carregando') }}</p>
    <p v-else-if="fila.data.value.itens.length === 0">{{ t('especialidades.oncologia.semPendentes') }}</p>
    <article
      v-for="i in fila.data.value?.itens ?? []"
      :key="i.ciclo.id"
      class="painel"
      :data-testid="`validar-${i.ciclo.id}`"
    >
      <h2>
        {{ i.nome }} · {{ t('especialidades.prontuario') }} {{ i.prontuario }} ·
        {{
          t('especialidades.oncologia.cicloLinha', {
            n: i.ciclo.numero,
            codigo: i.ciclo.protocolo.codigo,
            versao: i.ciclo.protocolo.versao,
            data: dataLonga(i.ciclo.dataPrevista),
          })
        }}
      </h2>
      <p class="secundario">
        {{
          t('especialidades.oncologia.base', {
            peso: numero(i.ciclo.pesoKg),
            altura: i.ciclo.alturaCm,
            sc: numero(i.ciclo.superficieM2, 2),
          })
        }}
        <span v-if="i.ciclo.clearanceMlMin !== null">
          ·
          {{
            t('especialidades.oncologia.clearance', {
              cr: numero(i.ciclo.creatininaMgDl, 2),
              tfg: numero(i.ciclo.clearanceMlMin),
            })
          }}</span
        >
        <span v-if="i.ciclo.reducaoPct">
          ·
          {{
            t('especialidades.oncologia.reducao', { pct: i.ciclo.reducaoPct, motivo: i.ciclo.motivoReducao })
          }}</span
        >
        ·
        {{ t('especialidades.oncologia.prescritoPor', { por: i.ciclo.por, em: instanteCurto(i.ciclo.em) }) }}
      </p>
      <p v-if="i.ciclo.curso > 1" class="secundario">
        {{
          i.ciclo.motivoCurso
            ? t('especialidades.oncologia.tratamentoMotivo', {
                curso: i.ciclo.curso,
                motivo: i.ciclo.motivoCurso,
              })
            : t('especialidades.oncologia.tratamento', { curso: i.ciclo.curso })
        }}
      </p>
      <p :data-testid="`validar-prescricoes-${i.ciclo.id}`">
        {{
          i.ciclo.prescricoes.length
            ? t('especialidades.oncologia.prescricoesLigadas', { ids: i.ciclo.prescricoes.join(', ') })
            : t('especialidades.oncologia.semPrescricaoLigada')
        }}
      </p>
      <form class="formulario" @submit.prevent="validar(i.ciclo.id, i.ciclo.doses.length)">
        <div class="grade">
          <div v-for="(d, n) in i.ciclo.doses" :key="n" class="campo">
            <label :for="`dose-${i.ciclo.id}-${n}`">{{
              t('especialidades.oncologia.doseConferida', { farmaco: d.farmaco })
            }}</label>
            <input
              :id="`dose-${i.ciclo.id}-${n}`"
              v-model="dosesDe(i.ciclo.id, i.ciclo.doses.length)[n]"
              type="text"
              inputmode="decimal"
              maxlength="10"
              required
            />
          </div>
        </div>
        <SanteCampoTexto
          :model-value="observacaoDe(i.ciclo.id)"
          :rotulo="t('especialidades.observacao')"
          :max-bytes="200"
          @update:model-value="(v: string) => (observacao[i.ciclo.id] = v)"
        />
        <ErroEspecialidade v-if="erro && erroDe === i.ciclo.id" :erro="erro" />
        <SanteBotao
          v-if="pode"
          tipo="submit"
          :rotulo="t('especialidades.oncologia.validar')"
          :desabilitado="ocupado || i.ciclo.prescricoes.length === 0"
          :data-testid="`validar-gravar-${i.ciclo.id}`"
        />
      </form>
    </article>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="./estilo-especialidades.css"></style>
