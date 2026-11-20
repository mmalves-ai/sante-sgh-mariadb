<script setup lang="ts">
// Horários-padrão de medicação por unidade (M24; ficha, seção 7): a regra de horário (início do período de 24
// horas, a partir do minuto da prescrição no atendimento externo, padrão do tipo de atendimento), a grade por número
// de doses e os blocos com regra própria (consulta: são as mesmas regras de toda a prescrição do estabelecimento),
// e a grade por classe de medicamento (só desta aplicação, vale para prescrições novas a partir da vigência).
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { gravarGradeClasse, lerHorariosPadrao } from '../api-prescricao.js';
import GrupoDominiosTela from '../../config/telas/GrupoDominiosTela.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const dados = useQuery({ queryKey: ['presc', 'horarios'], queryFn: () => lerHorariosPadrao(), staleTime: 0 });
const h = computed(() => dados.data.value);
const hora = (x: string | null) => (x && x.length === 4 ? `${x.slice(0, 2)}:${x.slice(2)}` : (x ?? ''));
const podeEditar = computed(() => pode('pep.gradeHorario.editar'));
const g = ref({
  unidade: '',
  classe: '',
  numDoses: '2',
  horas: '',
  vigenteDesde: new Date().toISOString().slice(0, 10),
  ativa: true,
});
const erro = ref<unknown>(null);
const aviso = ref('');
const ok = ref('');
async function gravar(): Promise<void> {
  aviso.value = '';
  const horarios = g.value.horas
    .split(',')
    .map((x) => x.trim().replace(':', ''))
    .filter(Boolean);
  if (new Set(horarios).size !== Number(g.value.numDoses)) {
    aviso.value = t('pep.presc.horarios.horasInvalidas');
    return;
  }
  erro.value = null;
  try {
    await gravarGradeClasse({
      unidade: Number(g.value.unidade),
      classe: g.value.classe.trim(),
      numDoses: Number(g.value.numDoses),
      horarios,
      vigenteDesde: g.value.vigenteDesde,
      ativa: g.value.ativa,
    });
    ok.value = t('pep.presc.horarios.gravada');
    await cliente.invalidateQueries({ queryKey: ['presc', 'horarios'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="hor-titulo" data-testid="tela-horarios-padrao">
    <h1 id="hor-titulo">{{ t('pep.presc.horarios.titulo') }}</h1>
    <p>{{ t('pep.presc.horarios.texto') }}</p>
    <MensagemErro v-if="dados.isError.value" :erro="dados.error.value" />
    <p v-else-if="!h" role="status">{{ t('pep.presc.carregando') }}</p>
    <template v-else>
      <section class="bloco" data-testid="regras-horario">
        <h2>{{ t('pep.presc.horarios.regras') }}</h2>
        <article v-for="r in h.regras" :key="r.id" class="regra" :data-testid="`regra-horario-${r.id}`">
          <h3>
            {{ t('pep.presc.horarios.regra', { id: r.id }) }} ·
            {{ t(`pep.presc.horarios.tipoAtendimento.${r.tipoAtendimento === 'E' ? 'E' : 'I'}`) }}
            <span v-if="r.padrao" class="marca">{{ t('pep.presc.horarios.padrao') }}</span>
          </h3>
          <p>
            {{
              r.considerar === 3
                ? t('pep.presc.horarios.considerar')
                : t('pep.presc.horarios.inicio', { hora: hora(r.horarioInicial) })
            }}
          </p>
          <table v-if="r.grade.length">
            <caption>
              {{
                t('pep.presc.horarios.grade')
              }}
            </caption>
            <tbody>
              <tr v-for="x in r.grade" :key="x.doses">
                <th scope="row">{{ t('pep.presc.horarios.doses', { n: x.doses }) }}</th>
                <td class="horas">{{ x.horas.map(hora).join(' · ') }}</td>
              </tr>
            </tbody>
          </table>
        </article>
        <p>{{ t('pep.presc.horarios.blocos', { n: h.blocos.length }) }}</p>
      </section>
      <section class="bloco">
        <h2>{{ t('pep.presc.horarios.porClasse') }}</h2>
        <p v-if="h.porClasse.length === 0" role="status">{{ t('pep.presc.horarios.vazioClasse') }}</p>
        <ul v-else data-testid="grades-classe">
          <li v-for="x in h.porClasse" :key="x.id">
            {{ x.unidade }} · {{ x.classe }} · {{ t('pep.presc.horarios.doses', { n: x.numDoses }) }} ·
            {{ x.horarios.map(hora).join(' · ') }} ·
            {{ x.vigenteDesde }}
          </li>
        </ul>
        <form v-if="podeEditar" class="bloco" data-testid="form-grade-classe" @submit.prevent="gravar">
          <div class="barra">
            <div class="campo">
              <label for="g-unidade">{{ t('pep.presc.horarios.unidade') }}</label>
              <input id="g-unidade" v-model="g.unidade" inputmode="numeric" data-testid="g-unidade" />
            </div>
            <div class="campo">
              <label for="g-classe">{{ t('pep.presc.horarios.classe') }}</label>
              <input id="g-classe" v-model="g.classe" maxlength="40" data-testid="g-classe" />
            </div>
            <div class="campo">
              <label for="g-doses">{{ t('pep.presc.horarios.numDoses') }}</label>
              <input id="g-doses" v-model="g.numDoses" inputmode="numeric" data-testid="g-doses" />
            </div>
            <div class="campo">
              <label for="g-horas">{{ t('pep.presc.horarios.horas') }}</label>
              <input id="g-horas" v-model="g.horas" maxlength="200" data-testid="g-horas" />
            </div>
            <div class="campo">
              <label for="g-desde">{{ t('pep.presc.horarios.desde') }}</label>
              <input id="g-desde" v-model="g.vigenteDesde" type="date" />
            </div>
          </div>
          <SanteBotao :rotulo="t('pep.presc.horarios.gravar')" tipo="submit" data-testid="gravar-grade" />
          <SanteAlerta v-if="aviso" variante="aviso" :texto="aviso" />
          <SanteAlerta v-if="ok" variante="info" :texto="ok" anunciar data-testid="grade-ok" />
        </form>
        <MensagemErro v-if="erro" :erro="erro" />
      </section>
    </template>
    <!-- M24 (P-CAD-1): as tabelas do cadastro no CRUD genérico (a gravação desligada aparece com o motivo). -->
    <section class="bloco" data-testid="edicao-horarios" :aria-label="t('pep.presc.cadastros.edicao')">
      <GrupoDominiosTela subitem="prescricaoHorarios" embutida />
    </section>
  </section>
</template>

<style scoped>
.tela,
.bloco {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.regra {
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2);
}
.regra h3 {
  margin: 0;
  font-size: var(--sgh-fonte-base);
}
.barra {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
  min-height: var(--sgh-alvo-minimo);
}
table {
  border-collapse: collapse;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.horas {
  font-family: var(--sgh-fonte-codigo);
}
.marca {
  margin-left: var(--sgh-espaco-1);
  font-size: var(--sgh-fonte-pequena);
  outline: 1px solid var(--sgh-borda-forte);
  padding: 0 var(--sgh-espaco-1);
}
h2 {
  margin: 0;
}
</style>
