<script setup lang="ts">
// O conteúdo do espelho de ponto (M52.4), comum à tela do RH e ao próprio espelho: o colaborador, o período, os dias
// (o previsto da escala, as marcações com a desconsiderada riscada e a incluída marcada, as horas por classe, as
// inconsistências e os alertas), os totais, os eventos para a folha, o banco de horas com as contas e a trilha.
import type { EspelhoPonto } from '@sgh/contratos';
import { horasMinutos } from '@sgh/dominio-pessoas';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../comum.js';

defineProps<{ espelho: EspelhoPonto }>();
const { t } = useI18n();
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const semana = (d: string) => SEMANA[new Date(`${d}T12:00:00Z`).getUTCDay()];
const hora = (i: string) => i.slice(11, 16);
const quando = (i: string) => `${dataBr(i.slice(0, 10))} ${hora(i)}`;
</script>

<template>
  <section class="bloco" aria-labelledby="espelho-colaborador" data-testid="espelho-cabecalho">
    <h2 id="espelho-colaborador">{{ espelho.colaborador.nome }}</h2>
    <dl class="dados">
      <dt>{{ t('ponto.espelho.matricula') }}</dt>
      <dd>{{ espelho.colaborador.matricula ?? '—' }}</dd>
      <dt>{{ t('ponto.espelho.lotacao') }}</dt>
      <dd>
        {{ [espelho.colaborador.unidadeNome, espelho.colaborador.setor].filter(Boolean).join(' · ') || '—' }}
      </dd>
      <dt>{{ t('ponto.espelho.regime') }}</dt>
      <dd>{{ espelho.colaborador.regime ?? '—' }}</dd>
      <dt>{{ t('ponto.espelho.estado') }}</dt>
      <dd data-testid="espelho-estado">
        {{
          espelho.estado === 'fechado'
            ? t('ponto.espelho.fechado', { v: espelho.versao })
            : t('ponto.espelho.aberto')
        }}
      </dd>
      <dt>{{ t('ponto.espelho.resumo') }}</dt>
      <dd class="secundario resumo">{{ espelho.hash }}</dd>
    </dl>
  </section>

  <section class="bloco" aria-labelledby="espelho-dias" data-testid="espelho-dias">
    <h2 id="espelho-dias">{{ t('ponto.espelho.titulo') }} · {{ espelho.competencia }}</h2>
    <table class="tabela">
      <thead>
        <tr>
          <th scope="col">{{ t('ponto.espelho.dia') }}</th>
          <th scope="col">{{ t('ponto.espelho.previsto') }}</th>
          <th scope="col">{{ t('ponto.espelho.marcacoes') }}</th>
          <th scope="col">{{ t('ponto.espelho.horas') }}</th>
          <th scope="col">{{ t('ponto.espelho.observacoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="d in espelho.dias" :key="d.dia" :data-testid="`dia-${d.dia}`">
          <th scope="row">
            {{ dataBr(d.dia) }} <span class="secundario">{{ semana(d.dia) }}</span>
          </th>
          <td>
            <span v-for="(p, i) in d.previstos" :key="i">{{ `${hora(p.inicio)}–${hora(p.fim)} ` }}</span>
          </td>
          <td>
            <span
              v-for="(m, i) in d.marcacoes"
              :key="i"
              :class="{ riscada: m.desconsiderada }"
              :title="
                m.desconsiderada
                  ? t('ponto.espelho.desconsiderada')
                  : m.fonte === 'I'
                    ? t('ponto.espelho.incluida')
                    : undefined
              "
            >
              {{ hora(m.instante) }}<sup v-if="m.fonte === 'I'">{{ 'I' }}</sup>
              <span v-if="m.desconsiderada" class="sr-only">({{ t('ponto.espelho.desconsiderada') }})</span>
              <span v-if="m.fonte === 'I'" class="sr-only">({{ t('ponto.espelho.incluida') }})</span>
            </span>
          </td>
          <td>
            <span v-for="h in d.minutos" :key="h.classe" class="hora-classe"
              >{{ h.rotulo }}: {{ horasMinutos(h.minutos) }}</span
            >
          </td>
          <td>
            <span v-if="d.feriado">{{ t('ponto.espelho.feriado') }} </span>
            <span v-if="d.justificativa">{{ d.justificativa }} </span>
            <strong v-for="x in d.inconsistencias" :key="x.codigo" class="inconsistencia"
              >{{ x.rotulo }}
            </strong>
            <span v-for="x in d.alertas" :key="x.codigo" class="secundario">{{ x.rotulo }} </span>
          </td>
        </tr>
      </tbody>
    </table>
  </section>

  <div class="colunas">
    <section class="bloco" aria-labelledby="espelho-totais" data-testid="espelho-totais">
      <h2 id="espelho-totais">{{ t('ponto.espelho.totais') }}</h2>
      <dl class="dados">
        <template v-for="x in espelho.totais" :key="x.classe">
          <dt>{{ x.rotulo }}</dt>
          <dd>{{ horasMinutos(x.minutos) }}</dd>
        </template>
      </dl>
    </section>
    <section class="bloco" aria-labelledby="espelho-eventos" data-testid="espelho-eventos">
      <h2 id="espelho-eventos">{{ t('ponto.espelho.eventos') }}</h2>
      <dl class="dados">
        <template v-for="x in espelho.eventos.filter((e) => e.minutos > 0)" :key="x.codigo">
          <dt>{{ x.rotulo }}</dt>
          <dd>{{ horasMinutos(x.minutos) }}</dd>
        </template>
      </dl>
    </section>
  </div>

  <section class="bloco" aria-labelledby="espelho-banco" data-testid="espelho-banco">
    <h2 id="espelho-banco">{{ t('ponto.banco.titulo') }}</h2>
    <p v-if="!espelho.banco.regra" class="secundario">{{ t('ponto.banco.semRegra') }}</p>
    <dl class="dados">
      <dt>{{ t('ponto.banco.saldoAnterior') }}</dt>
      <dd>{{ horasMinutos(espelho.banco.saldoAnteriorMin) }}</dd>
      <dt>{{ t('ponto.banco.credito') }}</dt>
      <dd>{{ horasMinutos(espelho.banco.creditoMin) }}</dd>
      <dt>{{ t('ponto.banco.debito') }}</dt>
      <dd>{{ horasMinutos(espelho.banco.debitoMin) }}</dd>
      <dt>{{ t('ponto.banco.saldoFinal') }}</dt>
      <dd data-testid="banco-saldo">{{ horasMinutos(espelho.banco.saldoFinalMin) }}</dd>
    </dl>
    <p v-for="(p, i) in espelho.banco.parcelas" :key="i" class="secundario">{{ p }}</p>
  </section>

  <section class="bloco" aria-labelledby="espelho-contas" data-testid="espelho-contas">
    <h2 id="espelho-contas">{{ t('ponto.espelho.conferencia') }}</h2>
    <p v-for="(p, i) in espelho.parcelas" :key="i">{{ p }}</p>
  </section>

  <section
    v-if="espelho.trilha.length > 0"
    class="bloco"
    aria-labelledby="espelho-trilha"
    data-testid="espelho-trilha"
  >
    <h2 id="espelho-trilha">{{ t('ponto.periodo.trilha') }}</h2>
    <ul>
      <li v-for="e in espelho.trilha" :key="e.id" :data-testid="`trilha-${e.acao}`">
        {{ e.acaoRotulo }} · {{ e.registradoPor }} · {{ quando(e.registradoEm) }}
        <span v-if="e.concorda === false"> · {{ t('ponto.meu.naoConcordo') }}</span>
        <span v-if="e.texto" class="secundario"> · {{ e.texto }}</span>
      </li>
    </ul>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
<style scoped>
.riscada {
  text-decoration: line-through;
  color: var(--p-text-muted-color);
}
.hora-classe {
  display: block;
}
.inconsistencia {
  color: var(--p-red-700);
}
.colunas {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
  gap: 1rem;
}
.resumo {
  word-break: break-all;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
