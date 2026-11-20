<script setup lang="ts">
// Trocas de convênio, clínica, especialidade e médico (ficha do M21, seção 7): `/internacao/:reg/trocas`. Cada troca
// confere o carimbo da internação (outro terminal pode ter mudado) e fica no histórico com a data e quem trocou. A
// troca de especialidade e a do médico ficam em consulta até o cenário controlado (o servidor diz o motivo).
import { CLINICAS_INTERNACAO } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../../agenda/formato.js';
import { buscarMedicos, novaChave, trocar } from '../api-adt.js';
import AvisoAdt from '../componentes/AvisoAdt.vue';
import ErroAdt from '../componentes/ErroAdt.vue';
import ResumoInternacao from '../componentes/ResumoInternacao.vue';
import { hhmm } from '../regras-tela.js';
import { usarAdt } from '../usar-adt.js';
import { usarInternacao } from '../usar-internacao.js';

const props = defineProps<{ reg: string }>();
const { t } = useI18n();
const { apoio, pode, motivo } = usarAdt();
const reg = computed(() => Number(props.reg));
const { ficha, recarregar } = usarInternacao(reg);
const TIPOS = ['convenio', 'clinica', 'especialidade', 'medico'] as const;
type Tipo = (typeof TIPOS)[number];
const OPS: Record<Tipo, string> = {
  convenio: 'internacao.trocarConvenio',
  clinica: 'internacao.trocarClinica',
  especialidade: 'internacao.trocarEspecialidade',
  medico: 'internacao.trocarMedico',
};
const tipo = ref<Tipo>('convenio');
const podeTipo = computed(() => pode(OPS[tipo.value]).value);
const motivoTipo = computed(() => (podeTipo.value ? null : motivo(OPS[tipo.value]).value));
const valor = ref('');
const termoMedico = ref('');
const pedidoMedico = ref('');
const medicos = useQuery({
  queryKey: computed(() => ['adt', 'medicos', pedidoMedico.value]),
  queryFn: () => buscarMedicos(pedidoMedico.value),
  enabled: computed(() => pedidoMedico.value.length >= 2),
});
const opcoes = computed(() => {
  const a = apoio.data.value;
  const lista =
    tipo.value === 'convenio'
      ? (a?.convenios ?? []).map((c) => ({ valor: String(c.codigo), rotulo: c.nome }))
      : tipo.value === 'clinica'
        ? CLINICAS_INTERNACAO.map((c) => ({ valor: c.codigo as string, rotulo: c.rotulo }))
        : tipo.value === 'especialidade'
          ? (a?.especialidades ?? []).map((c) => ({ valor: String(c.codigo), rotulo: c.nome }))
          : (medicos.data.value ?? []).map((m) => ({
              valor: String(m.vinculo),
              rotulo: `${m.nome} (${m.conselho})`,
            }));
  return [{ valor: '', rotulo: t('adt.escolha') }, ...lista];
});
const tipos = computed(() => TIPOS.map((x) => ({ valor: x as string, rotulo: t(`adt.trocas.tipo.${x}`) })));
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function gravar(): Promise<void> {
  const f = ficha.data.value;
  if (!f) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const campo =
      tipo.value === 'clinica'
        ? { clinica: valor.value }
        : tipo.value === 'convenio'
          ? { convenio: Number(valor.value) }
          : tipo.value === 'especialidade'
            ? { especialidade: Number(valor.value) }
            : { medico: Number(valor.value), tipo: 'S' };
    const r = await trocar(
      reg.value,
      { tipo: tipo.value, versao: f.versao, ...campo },
      novaChave(`troca-${tipo.value}`),
    );
    mensagem.value = r.mensagem;
    valor.value = '';
    await recarregar();
  } catch (x) {
    erro.value = x;
    await recarregar();
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="trocas-titulo" data-testid="tela-trocas">
    <h1 id="trocas-titulo">{{ t('adt.trocas.titulo') }}</h1>
    <p>{{ t('adt.trocas.texto') }}</p>
    <ErroAdt v-if="ficha.isError.value" :erro="ficha.error.value" />
    <p v-else-if="!ficha.data.value" role="status">{{ t('adt.carregando') }}</p>
    <template v-else>
      <ResumoInternacao :internacao="ficha.data.value" atalhos />
      <section v-if="!ficha.data.value.alta" class="painel" aria-labelledby="trocas-nova">
        <h2 id="trocas-nova">{{ t('adt.trocas.gravar') }}</h2>
        <div class="filtros">
          <SanteSelecao
            v-model="tipo"
            :rotulo="t('adt.trocas.tipoTroca')"
            :opcoes="tipos"
            data-testid="troca-tipo"
            @update:model-value="valor = ''"
          />
        </div>
        <AvisoAdt :motivo="motivoTipo" />
        <form
          v-if="tipo === 'medico'"
          class="filtros"
          role="search"
          @submit.prevent="pedidoMedico = termoMedico.trim()"
        >
          <SanteCampoTexto v-model="termoMedico" :rotulo="t('adt.admissao.buscarMedico')" :max-bytes="60" />
          <SanteBotao tipo="submit" variante="secundario" :rotulo="t('adt.buscar')" />
        </form>
        <div class="filtros">
          <SanteSelecao
            v-model="valor"
            :rotulo="t('adt.trocas.novo')"
            :opcoes="opcoes"
            data-testid="troca-valor"
          />
        </div>
        <SanteBotao
          :rotulo="t('adt.trocas.gravar')"
          :desabilitado="!podeTipo || !valor || ocupado"
          data-testid="troca-gravar"
          @acionar="gravar"
        />
        <p v-if="mensagem" role="status" data-testid="troca-feita">{{ mensagem }}</p>
        <ErroAdt v-if="erro" :erro="erro" />
      </section>
      <h2>{{ t('adt.trocas.historico') }}</h2>
      <p v-if="ficha.data.value.trocas.length === 0">{{ t('adt.trocas.nenhuma') }}</p>
      <table v-else class="tabela" data-testid="tabela-trocas">
        <caption class="secundario">
          {{
            t('adt.trocas.historico')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('adt.data') }}</th>
            <th scope="col">{{ t('adt.trocas.tipoTroca') }}</th>
            <th scope="col">{{ t('adt.trocas.de') }}</th>
            <th scope="col">{{ t('adt.trocas.para') }}</th>
            <th scope="col">{{ t('adt.trocas.usuario') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(x, i) in ficha.data.value.trocas" :key="i">
            <td>{{ dataBr(x.data) }} {{ hhmm(x.hora) }}</td>
            <td>{{ t(`adt.trocas.tipo.${x.tipo}`) }}</td>
            <td>{{ x.de }}</td>
            <td>{{ x.para }}</td>
            <td>{{ x.usuario }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
